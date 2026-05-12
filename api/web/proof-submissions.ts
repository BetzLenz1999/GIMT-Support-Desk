import { eq, limit, order, params, type ProofOfWorkSubmission } from "../../src/lib/supabase.js";
import { getSupabase } from "../../src/lib/supabase.js";

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
    const memberId = url.searchParams.get("member_id");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const rowLimit = parseInteger(url.searchParams.get("limit"), 100, 1, 500);

    const filters: [string, string][] = [order("submitted_at_utc", false), limit(rowLimit)];
    if (memberId) filters.push(eq("member_id", memberId));
    if (from) filters.push(gteParam("work_date_utc", from));
    if (to) filters.push(lteParam("work_date_utc", to));

    const db = getSupabase();
    const rows = await db.select<ProofOfWorkSubmission>("proof_of_work_submissions", params(...filters));

    sendJson(response, 200, { ok: true, count: rows.length, submissions: rows });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
