import { AI_SUPPORT_REPORT_CATEGORIES, isAiSupportReportCategory } from "../../src/lib/ai-support.js";
import { loadIssueReport } from "../../src/lib/repeated-issue-report.js";
import { getSupabase } from "../../src/lib/supabase.js";

function sendJson(response: any, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}

/**
 * Single repeated-issue report behind its own URL, e.g.
 * /api/web/issue-report?category=MiniPay%20GoodDapp%20Swap%20Failed&from=2025-09-01&to=2025-09-02
 *
 * The window is resolved the same way as the cron report, so a dashboard link
 * and a scheduled report for the same dates agree.
 */
export default async function handler(request: any, response: any) {
  try {
    const url = new URL(request.url ?? "/", "https://example.com");
    const category = url.searchParams.get("category") || url.searchParams.get("issue") || "";

    // No category means "list the options", which keeps the dashboard dropdown
    // in sync with the classifier instead of duplicating the list in app.js.
    if (!category.trim()) {
      sendJson(response, 200, { ok: true, categories: AI_SUPPORT_REPORT_CATEGORIES, report: null });
      return;
    }
    if (!isAiSupportReportCategory(category)) {
      sendJson(response, 404, { ok: false, error: `Unknown issue category: ${category}`, categories: AI_SUPPORT_REPORT_CATEGORIES });
      return;
    }

    const report = await loadIssueReport(getSupabase(), category, new Date(), {
      rangeFrom: url.searchParams.get("from"),
      rangeTo: url.searchParams.get("to")
    });

    sendJson(response, 200, { ok: true, report });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}