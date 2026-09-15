import { optionalEnv } from "../../src/lib/config.js";
import { loadRepeatedIssueReport, formatRepeatedIssueReportText, reportToMetadata, splitReportForTelegram, isValidDateKey } from "../../src/lib/repeated-issue-report.js";
import { createActivity, getAppSetting, upsertAppSetting } from "../../src/lib/repository.js";
import { sendTeamGroupMessage } from "../../src/lib/group-notifications.js";
import { getSupabase } from "../../src/lib/supabase.js";

const LAST_REPORT_DATE_KEY = "repeated_issue_report_last_date";

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
    const db = getSupabase();

    // Manual runs can pass ?force=1 to re-send, or ?from=YYYY-MM-DD&to=YYYY-MM-DD
    // to report a specific window (e.g. September 1 to September 7). A malformed
    // ?to is ignored so it cannot produce an Invalid Date report.
    const force = url.searchParams.get("force") === "1";
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const requestedTo = isValidDateKey(to) ? to : null;
    const requestedFrom = isValidDateKey(from) ? from : null;

    const reportDateKey = requestedTo ?? startedAt.toISOString().slice(0, 10);
    const lastSentDate = await getAppSetting(db, LAST_REPORT_DATE_KEY);
    if (!force && !requestedFrom && !requestedTo && lastSentDate === reportDateKey) {
      sendJson(response, 200, { ok: true, skipped: true, reason: "Report already sent today", reportDate: reportDateKey });
      return;
    }

    console.log(`[cron-repeated-issue-report] started at ${startedAt.toISOString()} (${requestedFrom ?? "default"} -> ${reportDateKey})`);
    const report = await loadRepeatedIssueReport(db, new Date(`${reportDateKey}T00:00:00.000Z`), {
      rangeFrom: requestedFrom,
      rangeTo: requestedTo
    });
    const text = formatRepeatedIssueReportText(report);
    // A report with many categories can exceed Telegram's single-message limit,
    // so continue in follow-up messages instead of truncating the totals.
    let delivered = true;
    for (const chunk of splitReportForTelegram(text)) {
      if (!(await sendTeamGroupMessage(chunk))) delivered = false;
    }

    await createActivity(db, {
      member_id: "system",
      member_name: "System",
      telegram_user_id: null,
      action: "REPEATED_ISSUE_REPORT",
      message: text,
      metadata: { ...reportToMetadata(report), delivered }
    });

    if (delivered) {
      await upsertAppSetting(db, LAST_REPORT_DATE_KEY, reportDateKey);
    }

    console.log(`[cron-repeated-issue-report] completed: categories=${report.categories.length} delivered=${delivered}`);
    sendJson(response, 200, { ok: true, ranAt: startedAt.toISOString(), delivered, report });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, error: "Repeated issue report failed" });
  }
}