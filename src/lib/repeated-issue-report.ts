import { listSupportTicketsInRange } from "./repository.js";
import { buildSupportIssueStats, splitDateRange, type SupportIssueStat } from "./support-insights.js";
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
const DAY_MS = 24 * 60 * 60_000;

export type RepeatedIssueReportWindow = {
  reportDate: Date;
  rangeFrom: string;
  rangeTo: string;
};

/** Default window: the report date plus the six UTC days before it. */
export function resolveReportWindow(reportDate = new Date(), days = DEFAULT_RANGE_DAYS): RepeatedIssueReportWindow {
  return {
    reportDate,
    rangeTo: utcDateKey(reportDate),
    rangeFrom: utcDateKey(new Date(reportDate.getTime() - (days - 1) * DAY_MS))
  };
}

/** Builds a window from explicit ISO date keys, falling back to a relative range. */
export function resolveExplicitReportWindow(
  reportDate: Date,
  rangeFrom?: string | null,
  rangeTo?: string | null,
  days = DEFAULT_RANGE_DAYS
): RepeatedIssueReportWindow {
  const fallback = resolveReportWindow(reportDate, days);
  return {
    reportDate,
    rangeFrom: rangeFrom || fallback.rangeFrom,
    rangeTo: rangeTo || fallback.rangeTo
  };
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
