import { optionalEnv } from "../../src/lib/config.js";
import { buildCommunityDailySummary, formatCommunityDailySummary } from "../../src/lib/community-daily-summary.js";
import { buildDailyReport } from "../../src/lib/daily-report.js";
import { sendTeamGroupMessage } from "../../src/lib/group-notifications.js";
import { createActivity, getAppSetting, listSupportTicketsInRange, upsertAppSetting } from "../../src/lib/repository.js";
import { getSupabase } from "../../src/lib/supabase.js";
import { utcDateKey } from "../../src/lib/time.js";

const LAST_SUPPORT_SUMMARY_DATE_KEY = "community_support_daily_summary_last_date";

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
    const reportDate = utcDateKey(new Date(startedAt.getTime() - 24 * 60 * 60_000));
    const force = url.searchParams.get("force") === "1";
    console.log(`[cron-daily-report] started at ${startedAt.toISOString()} for ${reportDate} (UTC)`);
    const db = getSupabase();
    const attendanceReport = await buildDailyReport(db, startedAt);
    await createActivity(db, {
      member_id: "system",
      member_name: "System",
      telegram_user_id: null,
      action: "DAILY_REPORT",
      message: attendanceReport,
      metadata: { reportDate }
    });

    const tickets = await listSupportTicketsInRange(db, reportDate, reportDate);
    const communitySummary = buildCommunityDailySummary(tickets, reportDate);
    const communitySummaryText = formatCommunityDailySummary(communitySummary);
    const lastSentDate = await getAppSetting(db, LAST_SUPPORT_SUMMARY_DATE_KEY);
    let delivered = false;
    let skipped = false;
    if (!force && lastSentDate === reportDate) {
      skipped = true;
    } else {
      delivered = await sendTeamGroupMessage(communitySummaryText);
      if (delivered) await upsertAppSetting(db, LAST_SUPPORT_SUMMARY_DATE_KEY, reportDate);
      await createActivity(db, {
        member_id: "system",
        member_name: "System",
        telegram_user_id: null,
        action: "COMMUNITY_SUPPORT_DAILY_SUMMARY",
        message: communitySummaryText,
        metadata: { ...communitySummary, delivered }
      });
    }
    console.log(`[cron-daily-report] completed: date=${reportDate}, tickets=${communitySummary.total_tickets}, delivered=${delivered}, skipped=${skipped}`);
    sendJson(response, 200, {
      ok: true,
      ranAt: startedAt.toISOString(),
      reportDate,
      attendanceReport,
      communitySummary,
      communitySummaryText,
      delivered,
      skipped
    });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, error: "Daily report failed" });
  }
}
