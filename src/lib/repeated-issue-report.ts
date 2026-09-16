import { listSupportTicketsInRange } from "./repository.js";
import { buildSupportIssueStats, resolveTicketCategory, splitDateRange, type SupportIssueDailyCount, type SupportIssueStat, type SupportTicketInsight } from "./support-insights.js";
import { utcDateKey } from "./time.js";
import type { SupabaseRestClient, SupportTicket } from "./supabase.js";

export type RepeatedIssueReportRow = SupportIssueStat & {
  /** Number of tickets opened on the report's ISO date. */
  today_count: number;
};

export type RepeatedIssueReport = {
  generated_at: string;
  /** ISO date the report was produced for (the day the cron ran). */
  report_date: string;
  /** Inclusive reporting window covered by this report, e.g. 2025-09-01 to 2025-09-07. */
  range_from: string;
  range_to: string;
  range_days: number;
  total_tickets: number;
  today_total: number;
  categories: RepeatedIssueReportRow[];
};

const DEFAULT_RANGE_DAYS = 7;
/** Upper bound so a hand-written range cannot build an unbounded daily breakdown. */
export const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60_000;

export type RepeatedIssueReportWindow = {
  reportDate: Date;
  rangeFrom: string;
  rangeTo: string;
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed calendar date key, rejecting e.g. "bogus" or "2025-02-31". */
export function isValidDateKey(value: string | null | undefined): value is string {
  if (!value || !DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && utcDateKey(parsed) === value;
}

/** Default window: the report date plus the six UTC days before it. */
export function resolveReportWindow(reportDate = new Date(), days = DEFAULT_RANGE_DAYS): RepeatedIssueReportWindow {
  return {
    reportDate,
    rangeTo: utcDateKey(reportDate),
    rangeFrom: utcDateKey(new Date(reportDate.getTime() - (days - 1) * DAY_MS))
  };
}

/**
 * Builds a window from explicit ISO date keys, falling back to a relative range
 * for anything missing or malformed. Inverted ranges are swapped, and overly
 * long ranges keep their end date but are clamped to `MAX_RANGE_DAYS`.
 */
export function resolveExplicitReportWindow(
  reportDate: Date,
  rangeFrom?: string | null,
  rangeTo?: string | null,
  days = DEFAULT_RANGE_DAYS
): RepeatedIssueReportWindow {
  const fallback = resolveReportWindow(reportDate, days);
  let from = isValidDateKey(rangeFrom) ? rangeFrom : fallback.rangeFrom;
  let to = isValidDateKey(rangeTo) ? rangeTo : fallback.rangeTo;

  if (from > to) [from, to] = [to, from];

  const fromTime = new Date(`${from}T00:00:00.000Z`).getTime();
  const toTime = new Date(`${to}T00:00:00.000Z`).getTime();
  if ((toTime - fromTime) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    from = utcDateKey(new Date(toTime - (MAX_RANGE_DAYS - 1) * DAY_MS));
  }

  return { reportDate, rangeFrom: from, rangeTo: to };
}

/**
 * Builds the recurring "repeated issue" report for a date window. Each category
 * keeps its own first/last date plus per-day counts so a reader can see both the
 * total and the reporting period for every repeated issue.
 */
export function buildRepeatedIssueReport(
  tickets: SupportTicket[],
  window: RepeatedIssueReportWindow
): RepeatedIssueReport {
  const { rangeFrom, rangeTo } = window;
  const reportDateKey = utcDateKey(window.reportDate);

  const inRange = tickets.filter((ticket) => {
    const day = ticket.created_at.slice(0, 10);
    return day >= rangeFrom && day <= rangeTo;
  });

  const categories: RepeatedIssueReportRow[] = buildSupportIssueStats(inRange).map((stat) => ({
    ...stat,
    today_count: stat.daily_counts.find((day) => day.date === reportDateKey)?.count ?? 0
  }));

  return {
    generated_at: window.reportDate.toISOString(),
    report_date: reportDateKey,
    range_from: rangeFrom,
    range_to: rangeTo,
    range_days: splitDateRange(rangeFrom, rangeTo).length,
    total_tickets: inRange.length,
    today_total: inRange.filter((ticket) => ticket.created_at.slice(0, 10) === reportDateKey).length,
    categories
  };
}

export async function loadRepeatedIssueReport(
  db: SupabaseRestClient,
  reportDate = new Date(),
  options: { days?: number; rangeFrom?: string | null; rangeTo?: string | null } = {}
): Promise<RepeatedIssueReport> {
  const window = resolveExplicitReportWindow(reportDate, options.rangeFrom, options.rangeTo, options.days ?? DEFAULT_RANGE_DAYS);
  const tickets = await listSupportTicketsInRange(db, window.rangeFrom, window.rangeTo);
  return buildRepeatedIssueReport(tickets, window);
}

/** Human-readable date, e.g. "September 1, 2025". */
export function formatReportDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

/**
 * Plain-text report, kept free of markup so it survives copy/paste into the
 * support group or a ticket note.
 */
export function formatRepeatedIssueReportText(report: RepeatedIssueReport): string {
  const lines: string[] = [];
  lines.push("📊 Repeated Issue Report");
  lines.push(`Report date: ${formatReportDate(report.report_date)}`);
  lines.push(`Period: ${formatReportDate(report.range_from)} to ${formatReportDate(report.range_to)} (${dayWord(report.range_days)})`);
  lines.push(`Tickets in period: ${report.total_tickets}`);
  lines.push(`Tickets today: ${report.today_total}`);

  if (report.categories.length === 0) {
    lines.push("");
    lines.push("No support tickets were recorded in this period.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("Issues by total reports:");
  for (const category of report.categories) {
    lines.push(
      `• ${category.category} — ${category.count} total` +
      ` (${category.today_count} today, ${category.open_count} open)`
    );
    lines.push(
      `   Report period: ${formatReportDate(category.period_from ?? report.range_from)}` +
      ` to ${formatReportDate(category.period_to ?? report.range_to)}`
    );
    const busiest = topDays(category, 3);
    if (busiest.length > 0) {
      lines.push(`   Busiest days: ${busiest.map((day) => `${day.date}: ${day.count}`).join(" · ")}`);
    }
  }

  return lines.join("\n");
}

function dayWord(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** One row in a single-issue report's ticket list. */
export type IssueReportTicket = {
  id: string;
  ticket_code: string | null;
  created_at: string;
  status: string;
  opened_by_name: string;
  group_title: string | null;
  telegram_chat_id: number | null;
  summary: string;
};

/**
 * A single repeated issue expanded over its own date range, e.g.
 * "MiniPay GoodDapp Swap Failed" from 2025-09-01 to 2025-09-02. Unlike the
 * whole-report summary, `daily_counts` covers every day in the window so days
 * with zero reports are visible rather than missing.
 */
export type IssueReport = {
  generated_at: string;
  category: string;
  range_from: string;
  range_to: string;
  range_days: number;
  total_tickets: number;
  open_count: number;
  closed_count: number;
  solved_count: number;
  not_solved_count: number;
  first_at: string | null;
  latest_at: string | null;
  daily_counts: SupportIssueDailyCount[];
  busiest_day: SupportIssueDailyCount | null;
  tickets: IssueReportTicket[];
};

const OPEN_STATUSES = ["open", "accepted", "pending_user_resolution", "pending_follow_up"];

export function isOpenTicketStatus(status: string): boolean {
  return OPEN_STATUSES.includes(status);
}

function toIssueReportTicket(ticket: SupportTicket & { insight?: SupportTicketInsight }): IssueReportTicket {
  return {
    id: ticket.id,
    ticket_code: ticket.ticket_code,
    created_at: ticket.created_at,
    status: ticket.status,
    opened_by_name: ticket.opened_by_name,
    group_title: ticket.group_title,
    telegram_chat_id: ticket.telegram_chat_id ?? null,
    summary: ticket.insight?.summary ?? ""
  };
}

/**
 * Builds the per-issue report the dashboard links to. Tickets are matched with
 * the same classifier the bot uses, then scoped to the requested window.
 */
export function buildIssueReport(
  category: string,
  tickets: Array<SupportTicket & { insight?: SupportTicketInsight }>,
  window: RepeatedIssueReportWindow
): IssueReport {
  const { rangeFrom, rangeTo } = window;
  const days = splitDateRange(rangeFrom, rangeTo);

  const matched = tickets.filter((ticket) => {
    if (resolveTicketCategory(ticket) !== category) return false;
    const day = ticket.created_at.slice(0, 10);
    return day >= rangeFrom && day <= rangeTo;
  });

  const countsByDay = new Map<string, number>();
  for (const ticket of matched) {
    const day = ticket.created_at.slice(0, 10);
    countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1);
  }

  const dailyCounts = days.map((date) => ({ date, count: countsByDay.get(date) ?? 0 }));
  const busiestDay = dailyCounts.reduce<SupportIssueDailyCount | null>(
    (best, day) => (day.count > 0 && (!best || day.count > best.count) ? day : best),
    null
  );

  const createdTimes = matched.map((ticket) => ticket.created_at).sort();
  const statuses = matched.map((ticket) => ticket.status);

  return {
    generated_at: window.reportDate.toISOString(),
    category,
    range_from: rangeFrom,
    range_to: rangeTo,
    range_days: days.length,
    total_tickets: matched.length,
    open_count: statuses.filter(isOpenTicketStatus).length,
    closed_count: matched.filter((ticket) => Boolean(ticket.closed_at) || ticket.status === "expired" || ticket.status.endsWith("_closed")).length,
    solved_count: statuses.filter((status) => status === "solved_closed").length,
    not_solved_count: statuses.filter((status) => status === "not_solved_closed").length,
    first_at: createdTimes[0] ?? null,
    latest_at: createdTimes[createdTimes.length - 1] ?? null,
    daily_counts: dailyCounts,
    busiest_day: busiestDay,
    tickets: matched
      .map(toIssueReportTicket)
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
  };
}

/**
 * Loads every ticket in the window from the database and narrows it to one
 * issue, so a shared report link works without the dashboard's current filters.
 */
export async function loadIssueReport(
  db: SupabaseRestClient,
  category: string,
  reportDate = new Date(),
  options: { days?: number; rangeFrom?: string | null; rangeTo?: string | null } = {}
): Promise<IssueReport> {
  const window = resolveExplicitReportWindow(reportDate, options.rangeFrom, options.rangeTo, options.days ?? DEFAULT_RANGE_DAYS);
  const tickets = await listSupportTicketsInRange(db, window.rangeFrom, window.rangeTo);
  return buildIssueReport(category, tickets, window);
}

/** Plain-text version of a single-issue report, for copy/paste or Telegram. */
export function formatIssueReportText(report: IssueReport): string {
  const lines: string[] = [];
  lines.push(`Issue Report: ${report.category}`);
  lines.push(`Period: ${formatReportDate(report.range_from)} to ${formatReportDate(report.range_to)} (${dayWord(report.range_days)})`);
  lines.push(`Total reports: ${report.total_tickets}`);
  lines.push(`Open: ${report.open_count} · Closed: ${report.closed_count}`);
  if (report.busiest_day) {
    lines.push(`Busiest day: ${formatReportDate(report.busiest_day.date)} (${report.busiest_day.count})`);
  }
  const activeDays = report.daily_counts.filter((day) => day.count > 0);
  lines.push(
    activeDays.length
      ? `Daily: ${activeDays.map((day) => `${day.date}: ${day.count}`).join(" · ")}`
      : "Daily: no reports in this period"
  );
  return lines.join("\n");
}

function topDays(category: RepeatedIssueReportRow, maxDays: number): Array<{ date: string; count: number }> {
  return category.daily_counts
    .filter((day) => day.count > 0)
    .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))
    .slice(0, maxDays);
}

export function reportToMetadata(report: RepeatedIssueReport): Record<string, unknown> {
  return {
    reportDate: report.report_date,
    rangeFrom: report.range_from,
    rangeTo: report.range_to,
    totalTickets: report.total_tickets,
    todayTotal: report.today_total,
    categories: report.categories.map((category) => ({
      category: category.category,
      total: category.count,
      today: category.today_count,
      open: category.open_count,
      periodFrom: category.period_from,
      periodTo: category.period_to,
      dailyCounts: category.daily_counts
    }))
  };
}

/** Telegram caps a single message at 4096 characters. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Splits the report into Telegram-sized messages on line boundaries, so a
 * category and its report period never get cut in half.
 */
export function splitReportForTelegram(text: string, maxLength = TELEGRAM_MESSAGE_LIMIT): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);
    // A single line longer than the limit (should not happen today) still needs
    // to be delivered, so hard-split it rather than dropping it.
    let remainder = line;
    while (remainder.length > maxLength) {
      chunks.push(remainder.slice(0, maxLength));
      remainder = remainder.slice(maxLength);
    }
    current = remainder;
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}
