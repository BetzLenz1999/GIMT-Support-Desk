import { listSupportTicketsInRange } from "./repository.js";
import { isOpenTicketStatus, isValidDateKey, formatReportDate } from "./repeated-issue-report.js";
import { resolveTicketCategory } from "./support-insights.js";
import { TEAM_SCHEDULE } from "./team-schedule.js";
import { utcDateKey } from "./time.js";
import type { SupabaseRestClient, SupportTicket } from "./supabase.js";

const DAY_MS = 24 * 60 * 60_000;

/** Commands a registered member can use to ask for their own ticket count. */
const SELF_STATS_COMMANDS = ["/mystats", "/mytickets"];

const MONTH_INDEXES: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

const MONTH_PATTERN =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const RANGE_SEPARATOR = "(?:to|until|through|thru|up to|hangang|hanggang|-)";

const MONTH_DAY_RANGE_PATTERN = new RegExp(
  `\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\s*${RANGE_SEPARATOR}\\s*(?:(${MONTH_PATTERN})\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`,
  "i"
);
const MONTH_DAY_SINGLE_PATTERN = new RegExp(
  `\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`,
  "i"
);
const ISO_RANGE_PATTERN = /(\d{4}-\d{2}-\d{2})\s*(?:to|until|through|thru|-)\s*(\d{4}-\d{2}-\d{2})/i;
const ISO_SINGLE_PATTERN = /\b(\d{4}-\d{2}-\d{2})\b/;

/**
 * Ticket-handled date window. A single day has `from === to`. The window is
 * inclusive and expressed as UTC date keys so it matches how the dashboard and
 * repeated-issue report scope tickets.
 */
export type MemberTicketStatsWindow = {
  from: string;
  to: string;
  label: string;
};

export type SelfTicketStatsRequest = {
  window: MemberTicketStatsWindow;
  /** A teammate named in the message, when it is not the sender. */
  otherMemberName: string | null;
};

export type MemberTicketStatsCategory = {
  category: string;
  count: number;
};

export type MemberTicketStats = {
  memberId: string;
  memberName: string;
  window: MemberTicketStatsWindow;
  total: number;
  open: number;
  closed: number;
  categories: MemberTicketStatsCategory[];
};

function toDateKey(year: number, monthIndex: number, day: number): string | null {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return null;
  return utcDateKey(date);
}

function singleDayWindow(dateKey: string): MemberTicketStatsWindow {
  return { from: dateKey, to: dateKey, label: formatReportDate(dateKey) };
}

function rangeWindow(from: string, to: string): MemberTicketStatsWindow {
  if (from === to) return singleDayWindow(from);
  return { from, to, label: `${formatReportDate(from)} to ${formatReportDate(to)}` };
}

function todayWindow(now: Date): MemberTicketStatsWindow {
  return singleDayWindow(utcDateKey(now));
}

/**
 * Resolves "September 1" against the current year, stepping back a year when the
 * bare date would land in the future (e.g. "September 1" asked in January).
 */
function resolveYear(explicitYear: number | undefined, monthIndex: number, day: number, now: Date): number | null {
  if (explicitYear !== undefined) return explicitYear;
  const thisYear = now.getUTCFullYear();
  const candidate = toDateKey(thisYear, monthIndex, day);
  if (!candidate) return null;
  return candidate > utcDateKey(now) ? thisYear - 1 : thisYear;
}

function matchMonthDayRange(text: string, now: Date): MemberTicketStatsWindow | null {
  const match = text.match(MONTH_DAY_RANGE_PATTERN);
  if (!match) return null;

  const startMonth = MONTH_INDEXES[match[1].toLowerCase()];
  const startDay = Number(match[2]);
  const startYearRaw = match[3] ? Number(match[3]) : undefined;
  // The second month is optional ("Sep 1 to 7"), so reuse the first one.
  const endMonth = match[4] !== undefined ? MONTH_INDEXES[match[4].toLowerCase()] : startMonth;
  const endDay = Number(match[5]);
  const endYearRaw = match[6] ? Number(match[6]) : undefined;

  if (startMonth === undefined || endMonth === undefined) return null;

  // A trailing year ("Sep 1 to 7, 2025") applies to both ends of the range.
  const startYear = startYearRaw ?? endYearRaw ?? resolveYear(undefined, startMonth, startDay, now);
  if (startYear === null) return null;
  let endYear = endYearRaw ?? startYear;

  const from = toDateKey(startYear, startMonth, startDay);
  let to = toDateKey(endYear, endMonth, endDay);
  if (!from || !to) return null;

  // A range like "December 20 to January 5" crosses the new year, so roll the
  // end forward instead of producing a window that ends before it starts.
  if (to < from && endMonth < startMonth) {
    endYear += 1;
    to = toDateKey(endYear, endMonth, endDay);
    if (!to) return null;
  }

  return from <= to ? rangeWindow(from, to) : rangeWindow(to, from);
}

function matchMonthDaySingle(text: string, now: Date): MemberTicketStatsWindow | null {
  const match = text.match(MONTH_DAY_SINGLE_PATTERN);
  if (!match) return null;

  const monthIndex = MONTH_INDEXES[match[1].toLowerCase()];
  const day = Number(match[2]);
  const explicitYear = match[3] ? Number(match[3]) : undefined;
  if (monthIndex === undefined) return null;

  const year = resolveYear(explicitYear, monthIndex, day, now);
  if (year === null) return null;
  const dateKey = toDateKey(year, monthIndex, day);
  return dateKey ? singleDayWindow(dateKey) : null;
}

function matchIsoRange(text: string, now: Date): MemberTicketStatsWindow | null {
  const match = text.match(ISO_RANGE_PATTERN);
  if (!match) return null;
  if (!isValidDateKey(match[1]) || !isValidDateKey(match[2])) return null;
  return match[1] <= match[2] ? rangeWindow(match[1], match[2]) : rangeWindow(match[2], match[1]);
}

function matchIsoSingle(text: string): MemberTicketStatsWindow | null {
  const match = text.match(ISO_SINGLE_PATTERN);
  if (!match || !isValidDateKey(match[1])) return null;
  return singleDayWindow(match[1]);
}

function addDays(dateKey: string, days: number): string {
  return utcDateKey(new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() + days * DAY_MS));
}

function matchRelativeWindow(text: string, now: Date): MemberTicketStatsWindow | null {
  const today = utcDateKey(now);

  if (/\b(today|ngayon|ngayong araw)\b/.test(text)) return singleDayWindow(today);
  if (/\b(yesterday|kahapon)\b/.test(text)) return singleDayWindow(addDays(today, -1));

  const lastDays = text.match(/\b(?:last|past|previous|nakaraang)\s+(\d{1,3})\s+days?\b/);
  if (lastDays) {
    const days = Math.min(Math.max(Number(lastDays[1]), 1), 366);
    return rangeWindow(addDays(today, -(days - 1)), today);
  }

  if (/\b(?:last|past|previous|nakaraang)\s+week\b/.test(text)) {
    return rangeWindow(addDays(today, -6), today);
  }

  if (/\b(?:this|current|ngayong)\s+week\b/.test(text)) {
    // UTC week starts on Monday; `getUTCDay()` returns 0 for Sunday.
    const weekdayOffset = (new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7;
    return rangeWindow(addDays(today, -weekdayOffset), today);
  }

  return null;
}

/** Resolves a date expression to an inclusive UTC window, or null when none is present. */
export function resolveMemberStatsWindow(text: string, now = new Date()): MemberTicketStatsWindow | null {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  return (
    matchIsoRange(normalized, now) ??
    matchIsoSingle(normalized) ??
    matchMonthDayRange(normalized, now) ??
    matchMonthDaySingle(normalized, now) ??
    matchRelativeWindow(normalized, now)
  );
}

function hasTicketNoun(text: string): boolean {
  return /\btickets?\b|\bticket['’]s\b/.test(text);
}

/**
 * Natural-language trigger. Kept deliberately strict so ordinary team chatter
 * ("my ticket is not working") does not get mistaken for a stats request: a
 * ticket noun alone is not enough, a quantity/stat/handle word must also appear.
 */
function isNaturalLanguageStatsQuery(text: string): boolean {
  if (!hasTicketNoun(text)) return false;
  return /\b(how many|ilang|ilan|count|total|dami|pila)\b/.test(text)
    || /\b(stats?|summary|report)\b/.test(text)
    || /\b(handled|handle|na-?handle|nahandle|hawak)\b/.test(text);
}

const MEMBER_ALIASES: Record<string, string> = { danny: "dany", daniel: "dany" };

function findOtherMemberName(text: string, selfMemberId: string): string | null {
  for (const member of TEAM_SCHEDULE) {
    if (member.id === selfMemberId) continue;
    if (new RegExp(`\\b${member.name.toLowerCase()}\\b`).test(text)) return member.name;
  }

  for (const [alias, memberId] of Object.entries(MEMBER_ALIASES)) {
    if (memberId === selfMemberId) continue;
    if (new RegExp(`\\b${alias}\\b`).test(text)) {
      return TEAM_SCHEDULE.find((member) => member.id === memberId)?.name ?? null;
    }
  }

  return null;
}

function getCommandToken(text: string): string {
  return text.trim().split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? "";
}

/** True when the message uses the explicit self-stats command form. */
export function isSelfTicketStatsCommand(text: string): boolean {
  return SELF_STATS_COMMANDS.includes(getCommandToken(text));
}

/**
 * Returns the stats request when the message asks for the sender's own handled
 * tickets, otherwise null so the message falls through to normal group handling.
 * The default window is today.
 */
export function parseSelfTicketStatsRequest(
  text: string,
  selfMemberId: string,
  now = new Date()
): SelfTicketStatsRequest | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const isCommand = SELF_STATS_COMMANDS.includes(getCommandToken(trimmed));
  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (!isCommand && !isNaturalLanguageStatsQuery(normalized)) return null;

  return {
    window: resolveMemberStatsWindow(trimmed, now) ?? todayWindow(now),
    otherMemberName: isCommand ? null : findOtherMemberName(normalized, selfMemberId)
  };
}

function isClosedTicket(ticket: SupportTicket): boolean {
  return Boolean(ticket.closed_at) || ticket.status === "expired" || ticket.status.endsWith("_closed");
}

/**
 * Counts the tickets a member handles in a date window. "Handled" is the
 * assigned handler (`assigned_member_id`), which is what the dashboard shows as
 * the responder, scoped by ticket open date to stay reconcilable with the
 * existing repeated-issue report.
 */
export async function buildMemberTicketStats(
  db: SupabaseRestClient,
  memberId: string,
  memberName: string,
  window: MemberTicketStatsWindow
): Promise<MemberTicketStats> {
  const tickets = await listSupportTicketsInRange(db, window.from, window.to);
  const handled = tickets.filter((ticket) => ticket.assigned_member_id === memberId);

  const countsByCategory = new Map<string, number>();
  for (const ticket of handled) {
    const category = resolveTicketCategory(ticket);
    countsByCategory.set(category, (countsByCategory.get(category) ?? 0) + 1);
  }

  return {
    memberId,
    memberName,
    window,
    total: handled.length,
    open: handled.filter((ticket) => isOpenTicketStatus(ticket.status)).length,
    closed: handled.filter(isClosedTicket).length,
    categories: [...countsByCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
  };
}

const MAX_CATEGORY_LINES = 8;

/** Plain-text reply, kept markup-free so it reads cleanly in the group. */
export function formatMemberTicketStatsReply(stats: MemberTicketStats): string {
  const lines: string[] = [];
  lines.push(`🎫 Handled Tickets — ${stats.memberName}`);
  lines.push(`Period: ${stats.window.label}`);
  lines.push(`Total handled: ${stats.total}`);

  if (stats.total > 0) {
    lines.push(`Open: ${stats.open} · Closed: ${stats.closed}`);
    lines.push("");
    lines.push("By issue:");
    for (const entry of stats.categories.slice(0, MAX_CATEGORY_LINES)) {
      lines.push(`• ${entry.category} — ${entry.count}`);
    }
    const hidden = stats.categories.length - MAX_CATEGORY_LINES;
    if (hidden > 0) lines.push(`…and ${hidden} more issue${hidden === 1 ? "" : "s"}`);
    lines.push("");
    lines.push("Counts tickets assigned to you (open date inside the period).");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("No tickets handled in this period.");
  return lines.join("\n");
}

/** Reply sent when a member asks about a teammate instead of themselves. */
export function formatSelfOnlyNotice(otherMemberName: string, memberName: string): string {
  return (
    `ℹ️ ${memberName}, I can only show your own ticket count. ` +
    `You asked about ${otherMemberName}. Try "how many tickets did I handle today".`
  );
}
