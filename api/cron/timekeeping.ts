import { optionalEnv } from "../../src/lib/config.js";
import { runTimekeepingCron } from "../../src/lib/reminders.js";
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
    const result = await runTimekeepingCron(getSupabase());
    sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, error: "Cron failed" });
  }
}
