import { buildSupportIssueStats, buildSupportTicketInsight } from "./support-insights.js";
import { isOpenTicketStatus } from "./repeated-issue-report.js";
import type { SupportTicket } from "./supabase.js";
import { formatReportDate, isValidDateKey } from "./repeated-issue-report.js";

export type CommunityDailySummaryCategory = {
  category: string;
  count: number;
  open_count: number;
  sample_summary: string;
};

export type CommunityDailySummary = {
  date: string;
  total_tickets: number;
  open_tickets: number;
  resolved_tickets: number;
  needs_moderator_review: number;
  categories: CommunityDailySummaryCategory[];
  highlights: string[];
};

function sanitizeSampleSummary(value: string): string {
  return value
    .replace(/(?:seed phrase|recovery phrase|private key|secret phrase|mnemonic)\s*[:=]?\s*(?:[a-z]+\s+){5,}[a-z]*/gi, "[wallet credentials redacted]")
    .replace(/\b0x[a-f0-9]{40,64}\b/gi, "[wallet address redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email redacted]")
    .replace(/\b(?:\+?\d[\d ().-]{7,}\d)\b/g, "[phone redacted]");
}

export function buildCommunityDailySummary(tickets: SupportTicket[], date: string): CommunityDailySummary {
  if (!isValidDateKey(date)) throw new Error(`Invalid summary date: ${date}`);
  const dayTickets = tickets.filter((ticket) => ticket.created_at.slice(0, 10) === date);
  const stats = buildSupportIssueStats(dayTickets.map((ticket) => ({
    ...ticket,
    insight: buildSupportTicketInsight(ticket)
  })));
  const categories = stats
    .filter((stat) => !stat.is_rollup)
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
    .map((stat) => ({
      category: stat.category,
      count: stat.count,
      open_count: stat.open_count,
      sample_summary: sanitizeSampleSummary(stat.sample_summary)
    }));
  const openTickets = dayTickets.filter((ticket) => isOpenTicketStatus(ticket.status));
  const resolvedTickets = dayTickets.filter((ticket) => ["solved_closed", "closed_by_team"].includes(ticket.status)).length;
  const needsModeratorReview = dayTickets.filter((ticket) => {
    const insight = buildSupportTicketInsight(ticket);
    return insight.dashboard_status === "Needs Moderator Review" || insight.dashboard_status === "Escalated to Moderator";
  }).length;
  const highlights = categories.slice(0, 3).map((category) => `${category.category} (${category.count})`);
  return {
    date,
    total_tickets: dayTickets.length,
    open_tickets: openTickets.length,
    resolved_tickets: resolvedTickets,
    needs_moderator_review: needsModeratorReview,
    categories,
    highlights
  };
}

export function formatCommunityDailySummary(summary: CommunityDailySummary): string {
  const lines = [
    `🧾 Community Support Summary — ${formatReportDate(summary.date)} (UTC)`,
    `New questions/tickets: ${summary.total_tickets}`,
    `Current status — Open: ${summary.open_tickets} · Resolved: ${summary.resolved_tickets} · Needs moderator review: ${summary.needs_moderator_review}`
  ];
  if (!summary.categories.length) {
    lines.push("", "No community support tickets were recorded on this date.");
    return lines.join("\n");
  }
  lines.push("", "Top questions by topic:");
  for (const category of summary.categories.slice(0, 5)) {
    lines.push(`• ${category.category} — ${category.count}${category.open_count ? ` (${category.open_count} open)` : ""}`);
    if (category.sample_summary) lines.push(`  Highlight: ${category.sample_summary.slice(0, 220)}`);
  }
  if (summary.needs_moderator_review > 0) {
    lines.push("", `⚑ Follow up: ${summary.needs_moderator_review} ticket(s) need moderator review.`);
  }
  return lines.join("\n");
}
