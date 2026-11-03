import { buildCommunityDailySummary } from "../../src/lib/community-daily-summary.js";
import { isValidDateKey } from "../../src/lib/repeated-issue-report.js";
import { listSupportTicketsInRange } from "../../src/lib/repository.js";
import { getSupabase } from "../../src/lib/supabase.js";
import { utcDateKey } from "../../src/lib/time.js";

function sendJson(response: any, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}

export default async function handler(request: any, response: any) {
  try {
    const url = new URL(request.url ?? "/", "https://example.com");
    const requestedDate = url.searchParams.get("date");
    const date = requestedDate || utcDateKey(new Date());
    if (!isValidDateKey(date)) {
      sendJson(response, 400, { ok: false, error: "date must be a valid YYYY-MM-DD UTC date" });
      return;
    }
    const tickets = await listSupportTicketsInRange(getSupabase(), date, date);
    sendJson(response, 200, { ok: true, summary: buildCommunityDailySummary(tickets, date) });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
