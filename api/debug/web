import { optionalEnv } from "../../src/lib/config.js";
import { getStoredTeamGroupChatId, getTeamGroupChatId, resetGroupNotificationWarnings } from "../../src/lib/group-notifications.js";
import { listRegistrations } from "../../src/lib/repository.js";
import { getSupabase } from "../../src/lib/supabase.js";
import { TelegramApiError, getChat, getMe } from "../../src/lib/telegram.js";

function sendJson(response: any, statusCode: number, payload: Record<string, unknown>) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload, null, 2));
}

async function buildRegistrationsSection(): Promise<Record<string, unknown>> {
  try {
    const db = getSupabase();
    const rows = await listRegistrations(db);
    const members = rows
      .map((row) => ({
        member_id: row.member_id,
        member_name: row.member_name,
        telegram_user_id: row.telegram_user_id,
        telegram_username: row.telegram_username,
        registered_at: row.registered_at
      }))
      .sort((a, b) => a.member_id.localeCompare(b.member_id));
    return { ok: true, count: members.length, members };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      hint: "Could not query team_registrations. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, and verify the schema migration ran."
    };
  }
}

export default async function handler(request: any, response: any) {
  const cronSecret = optionalEnv("CRON_SECRET");
  if (cronSecret) {
    const authHeader = request.headers.authorization;
    const url = new URL(request.url ?? "/", "https://example.com");
    if (authHeader !== `Bearer ${cronSecret}` && url.searchParams.get("secret") !== cronSecret) {
      sendJson(response, 401, { ok: false, error: "Unauthorized. Pass ?secret=<CRON_SECRET> or Authorization: Bearer <CRON_SECRET>." });
      return;
    }
  }

  const diagnosis: Record<string, unknown> = {};

  diagnosis.registrations = await buildRegistrationsSection();

  try {
    const bot = await getMe();
    diagnosis.bot = bot;
  } catch (error) {
    const description = error instanceof TelegramApiError ? error.description : String(error);
    diagnosis.bot = { ok: false, error: description, hint: "TELEGRAM_BOT_TOKEN is missing or invalid in Vercel." };
    sendJson(response, 200, { ok: false, ...diagnosis });
    return;
  }

  let chatId: number | undefined;
  let envParseError: string | undefined;
  try {
    chatId = getTeamGroupChatId();
  } catch (error) {
    envParseError = error instanceof Error ? error.message : String(error);
  }

  let storedFallback: number | undefined;
  try {
    resetGroupNotificationWarnings();
    storedFallback = await getStoredTeamGroupChatId();
  } catch (error) {
    diagnosis.stored_fallback_chat_id = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  if (storedFallback !== undefined) {
    diagnosis.stored_fallback_chat_id = { value: storedFallback, matches_env: chatId !== undefined && storedFallback === chatId };
  } else if (diagnosis.stored_fallback_chat_id === undefined) {
    diagnosis.stored_fallback_chat_id = {
      value: null,
      hint: "No fallback stored yet. After this deploys, ask a registered member to send any message in the team group; the bot will remember that chat ID here and use it whenever TEAM_GROUP_CHAT_ID env var fails."
    };
  }

  if (envParseError) {
    diagnosis.team_group_chat_id = {
      configured: optionalEnv("TEAM_GROUP_CHAT_ID") ?? null,
      ok: false,
      error: envParseError,
      hint: "TEAM_GROUP_CHAT_ID env var is malformed. The stored fallback above will be used (if any)."
    };
    sendJson(response, 200, { ok: false, ...diagnosis });
    return;
  }

  if (chatId === undefined) {
    diagnosis.team_group_chat_id = {
      configured: null,
      ok: false,
      hint: storedFallback !== undefined
        ? `TEAM_GROUP_CHAT_ID is not set in Vercel. The bot is using the stored fallback ${storedFallback} (auto-detected). To make it explicit, set TEAM_GROUP_CHAT_ID=${storedFallback} in Vercel and redeploy.`
        : "TEAM_GROUP_CHAT_ID is not set in Vercel and no fallback has been auto-detected yet. Send /chatid in the team group to get the value, set it in Vercel, then redeploy."
    };
    sendJson(response, 200, { ok: storedFallback !== undefined, ...diagnosis });
    return;
  }

  diagnosis.team_group_chat_id = { configured: chatId, parsed_ok: true };

  try {
    const chat = await getChat(chatId);
    diagnosis.chat = { ok: true, ...chat };
    sendJson(response, 200, { ok: true, ...diagnosis });
  } catch (error) {
    const description = error instanceof TelegramApiError ? error.description : String(error);
    diagnosis.chat = {
      ok: false,
      error: description,
      hint:
        "Telegram refused getChat for the env var chat ID. Either TEAM_GROUP_CHAT_ID points to a chat that does not exist, or the bot above (matching TELEGRAM_BOT_TOKEN) is not a member of that chat. The auto-fallback will use stored_fallback_chat_id above if any. Compare the bot.username with the bot you actually added to the group; send /chatid in the target group to confirm the chat ID."
    };
    if (storedFallback !== undefined && storedFallback !== chatId) {
      try {
        const fallbackChat = await getChat(storedFallback);
        diagnosis.stored_fallback_chat = { ok: true, ...fallbackChat };
      } catch (fallbackError) {
        const fallbackDescription = fallbackError instanceof TelegramApiError ? fallbackError.description : String(fallbackError);
        diagnosis.stored_fallback_chat = { ok: false, error: fallbackDescription };
      }
    }
    sendJson(response, 200, { ok: false, ...diagnosis });
  }
}
