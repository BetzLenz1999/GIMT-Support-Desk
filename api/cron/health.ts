import { optionalEnv } from "../../src/lib/config.js";
import { checkCronStaleness, readCronFreshness } from "../../src/lib/cron-health.js";
import { getSupabase } from "../../src/lib/supabase.js";

function sendJson(response: any, statusCode: number, payload: Record<string, unknown>) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload, null, 2));
}

/**
 * Reports timekeeping-cron freshness and, on a stalled scheduler, posts a
 * one-time team alert.
 *
 * Point an uptime monitor (for example UptimeRobot or cron-job.org) at this
 * path and treat a 503 as down. The monitor keeps alerting on the stalled
 * schedule, while the team-group alert (sent at most once per re-alert window)
 * tells the team that reminders stopped. Pass ?alert=0 to skip the group alert,
 * or ?secret=<CRON_SECRET> when CRON_SECRET is configured.
 */
export default async function handler(request: any, response: any) {
  const cronSecret = optionalEnv("CRON_SECRET");
  const authHeader = request.headers?.authorization;
  const url = new URL(request.url ?? "/", "https://example.com");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && url.searchParams.get("secret") !== cronSecret) {
    sendJson(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const shouldAlert = url.searchParams.get("alert") !== "0";

    const staleness = shouldAlert ? await checkCronStaleness(db, now) : { ...(await readCronFreshness(db, now)), alerted: false };

    const payload = {
      ok: !staleness.stale,
      status: staleness.stale ? "stale" : "healthy",
      checkedAt: now.toISOString(),
      lastRunAt: staleness.lastRunAt?.toISOString() ?? null,
      ageMinutes: staleness.ageMinutes,
      staleAfterMinutes: staleness.staleAfterMinutes,
      stale: staleness.stale,
      reason: staleness.reason,
      alertSent: staleness.alerted
    };

    sendJson(response, staleness.stale ? 503 : 200, payload);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, error: "Health check failed" });
  }
}
