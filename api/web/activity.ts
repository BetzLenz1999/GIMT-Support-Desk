import { eq, limit, order, params, type ActivityLog } from "../../src/lib/supabase.js";
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

export default async function handler(request: any, response: any) {
  try {
    const url = new URL(request.url ?? "/", "https://example.com");
    const memberId = url.searchParams.get("member_id");
    const action = url.searchParams.get("action");
    const rowLimit = parseInteger(url.searchParams.get("limit"), 50, 1, 200);

    const filters: [string, string][] = [order("created_at", false), limit(rowLimit)];
    if (memberId) filters.push(eq("member_id", memberId));
    if (action) filters.push(eq("action", action));

    const db = getSupabase();
    const activities = await db.select<ActivityLog>("activity_logs", params(...filters));

    sendJson(response, 200, { ok: true, count: activities.length, activities });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
