import { eq, inList, limit, order, params, type SupportTicket, type SupportTicketMessage, type TelegramGroup } from "../../src/lib/supabase.js";
import { getSupabase } from "../../src/lib/supabase.js";
import { chunkValues, listSupportTicketMessages } from "../../src/lib/repository.js";
import { buildSupportIssueStats, buildSupportTicketInsight } from "../../src/lib/support-insights.js";
import { buildRepeatedIssueReport, resolveExplicitReportWindow } from "../../src/lib/repeated-issue-report.js";

function sendJson(response: any, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}

function parseInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function gteParam(field: string, value: string): [string, string] {
  return [field, `gte.${value}`];
}

function lteParam(field: string, value: string): [string, string] {
  return [field, `lte.${value}`];
}

export default async function handler(request: any, response: any) {
  try {
    const url = new URL(request.url ?? "/", "https://example.com");
    const assignedMemberId = url.searchParams.get("assigned_member_id");
    const scheduledMemberId = url.searchParams.get("scheduled_member_id");
    const status = url.searchParams.get("status");
    const telegramChatId = url.searchParams.get("telegram_chat_id");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const memberId = url.searchParams.get("member_id");
    const search = (url.searchParams.get("q") || "").trim().toLowerCase();
    const rowLimit = parseInteger(url.searchParams.get("limit"), 200, 1, 1000);

    const filters: [string, string][] = [order("created_at", false), limit(rowLimit)];
    if (assignedMemberId) filters.push(eq("assigned_member_id", assignedMemberId));
    if (scheduledMemberId) filters.push(eq("scheduled_member_id", scheduledMemberId));
    if (status) filters.push(eq("status", status));
    if (telegramChatId) filters.push(eq("telegram_chat_id", telegramChatId));
    if (from) filters.push(gteParam("created_at", `${from}T00:00:00.000Z`));
    if (to) filters.push(lteParam("created_at", `${to}T23:59:59.999Z`));

    const db = getSupabase();
    const tickets = await db.select<SupportTicket>("support_tickets", params(...filters));
    const messages = await listSupportTicketMessages(db, tickets.map((ticket) => ticket.id));
    const chatIds = Array.from(new Set(tickets.map((ticket) => ticket.telegram_chat_id).filter(Boolean)));
    let groups: TelegramGroup[] = [];
    if (chatIds.length > 0) {
      try {
        for (const chunk of chunkValues(chatIds)) {
          groups.push(...(await db.select<TelegramGroup>("telegram_groups", params(inList("telegram_chat_id", chunk)))));
        }
      } catch (error) {
        console.warn(`Could not load telegram_groups metadata for support tickets: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const groupsByChatId = new Map(groups.map((group) => [group.telegram_chat_id, group]));
    const messagesByTicket = messages.reduce<Record<string, SupportTicketMessage[]>>((acc, message) => {
      (acc[message.ticket_id] ??= []).push(message);
      return acc;
    }, {});
    const ticketsWithMessages = tickets.map((ticket) => {
      const ticketMessages = messagesByTicket[ticket.id] ?? [];
      const visibleMessages = ticketMessages.filter((message) => message.sender_type !== "bot");
      return {
        ...ticket,
        group_title: ticket.group_title || groupsByChatId.get(ticket.telegram_chat_id)?.title || null,
        messages: visibleMessages,
        insight: buildSupportTicketInsight(ticket, visibleMessages)
      };
    });

    const searchableTickets = ticketsWithMessages.filter((ticket) => {
      const memberMatches = !memberId || [
        ticket.assigned_member_id,
        ticket.scheduled_member_id,
        ticket.covered_for_member_id
      ].some((value) => value === memberId);
      if (!memberMatches) return false;

      if (!search) return true;
      const haystack = [
        ticket.ticket_code,
        ticket.id,
        ticket.opened_by_name,
        ticket.opened_message_text,
        ticket.status,
        ticket.assigned_member_name,
        ticket.scheduled_member_name,
        ticket.covered_for_member_name,
        ticket.group_title,
        ticket.telegram_chat_id,
        ticket.insight?.category,
        ticket.insight?.dashboard_status,
        ticket.insight?.detected_language?.name,
        ticket.insight?.summary,
        ticket.insight?.next_action,
        ticket.insight?.english_translation_assist,
        ...(ticket.insight?.risk_flags ?? []),
        ...ticket.messages.flatMap((message) => [
          message.sender_name,
          message.sender_type,
          message.message_text,
          message.telegram_message_id
        ])
      ].filter((value) => value != null).join(" ").toLowerCase();
      return haystack.includes(search);
    });

    const coverage = searchableTickets
      .filter((ticket) => ticket.covered_for_member_id && ticket.assigned_member_id)
      .map((ticket) => ({
        ticket_id: ticket.id,
        opened_at: ticket.created_at,
        requester: ticket.opened_by_name,
        scheduled_member_id: ticket.covered_for_member_id,
        scheduled_member_name: ticket.covered_for_member_name,
        accepted_by_member_id: ticket.assigned_member_id,
        accepted_by_member_name: ticket.assigned_member_name,
        accepted_member_was_timed_in: ticket.accepted_member_was_timed_in,
        accepted_during_own_shift: ticket.accepted_during_own_shift
      }));

    const issueStats = buildSupportIssueStats(searchableTickets);

    // The dashboard's repeated-issue panel reports its own window (default: last
    // 7 UTC days) independently of the ticket table filters, so each issue keeps
    // its own reporting period and per-day totals. Missing or malformed values
    // fall back to the default window rather than failing the whole response.
    const reportWindow = resolveExplicitReportWindow(
      new Date(),
      url.searchParams.get("report_from"),
      url.searchParams.get("report_to")
    );
    const repeatedIssueReport = buildRepeatedIssueReport(searchableTickets, reportWindow);

    sendJson(response, 200, {
      ok: true,
      count: searchableTickets.length,
      tickets: searchableTickets,
      coverage,
      issue_stats: issueStats,
      issue_reports: repeatedIssueReport
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
