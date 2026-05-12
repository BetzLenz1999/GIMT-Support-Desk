import { optionalEnv } from "../../src/lib/config.js";
import { buildDailyReport } from "../../src/lib/daily-report.js";
import { createActivity } from "../../src/lib/repository.js";
import { getSupabase } from "../../src/lib/supabase.js";

function sendJson(response: any, statusCode: number, payload: Record<string, unknown>) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

export default async function handler(request: any, response: any) {
  const cronSecret = optionalEnv("CRON_SECRET");
  const authHeader = request.headers.authorization;
  const url = new URL(request.url ?? "/", "https://example.com");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && url.searchParams.get("secret") !== cronSecret) {
    sendJson(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const startedAt = new Date();
    console.log(`[cron-daily-report] started at ${startedAt.toISOString()}`);
    const db = getSupabase();
    const report = await buildDailyReport(db);
    await createActivity(db, {
      member_id: "system",
      member_name: "System",
      telegram_user_id: null,
      action: "DAILY_REPORT",
      message: report,
      metadata: {}
    });
    console.log("[cron-daily-report] completed");
    sendJson(response, 200, { ok: true, ranAt: startedAt.toISOString(), report });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, error: "Daily report failed" });
  }
}
