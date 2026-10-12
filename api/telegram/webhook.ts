import { optionalEnv } from "../../src/lib/config.js";
import { handleTelegramUpdate } from "../../src/lib/bot.js";
import { getStatsGroupChatIds } from "../../src/lib/group-notifications.js";
import { getSupabase } from "../../src/lib/supabase.js";
import { ensureChatMemberSubscription, getChatMember, getMe, getWebhookInfo } from "../../src/lib/telegram.js";
import type { TelegramUpdate } from "../../src/lib/telegram-types.js";

/** Reports whether the bot is an administrator in each configured stats group. */
async function describeStatsGroupAccess(botId: number): Promise<Array<Record<string, unknown>>> {
  let chatIds: number[];
  try {
    chatIds = getStatsGroupChatIds();
  } catch (error) {
    return [{ error: error instanceof Error ? error.message : String(error) }];
  }

  const results: Array<Record<string, unknown>> = [];
  for (const chatId of chatIds) {
    const member = await getChatMember(chatId, botId);
    results.push({
      chat_id: chatId,
      bot_status: member?.status ?? "unknown",
      // chat_member updates require the bot to be an administrator.
      receives_join_updates: member?.status === "administrator" || member?.status === "creator"
    });
  }
  return results;
}

async function readJsonBody<T>(request: any): Promise<T> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(new TextEncoder().encode(chunk));
    } else {
      chunks.push(chunk as Uint8Array);
    }
  }

  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  return JSON.parse(new TextDecoder().decode(body)) as T;
}

function sendJson(response: any, statusCode: number, payload: Record<string, unknown>) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

function getHeader(request: any, name: string): string | undefined {
  const headers = request.headers ?? {};
  const directValue = headers[name] ?? headers[name.toLowerCase()];
  if (typeof directValue === "string") return directValue;
  if (Array.isArray(directValue)) return directValue[0];

  if (typeof headers.get === "function") {
    const value = headers.get(name) ?? headers.get(name.toLowerCase());
    return value ?? undefined;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name.toLowerCase()) continue;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value[0];
  }

  return undefined;
}

function getRequestUrl(request: any): URL {
  return new URL(request.url || "/", "https://localhost");
}

function hasValidWebhookSecret(request: any): boolean {
  const webhookSecret = optionalEnv("TELEGRAM_WEBHOOK_SECRET");
  if (!webhookSecret) return true;

  const telegramSecret = getHeader(request, "x-telegram-bot-api-secret-token");
  return telegramSecret === webhookSecret;
}

function hasValidDiagnosticSecret(request: any): boolean {
  const url = getRequestUrl(request);
  const providedSecret = url.searchParams.get("secret") ?? getHeader(request, "x-telegram-bot-api-secret-token");
  const webhookSecret = optionalEnv("TELEGRAM_WEBHOOK_SECRET");
  const cronSecret = optionalEnv("CRON_SECRET");

  return Boolean(
    (webhookSecret && providedSecret === webhookSecret) ||
      (cronSecret && providedSecret === cronSecret)
  );
}

function buildUnauthorizedDiagnosticPayload() {
  return {
    ok: true,
    status: "webhook endpoint is deployed",
    diagnostic: "Pass ?secret=<TELEGRAM_WEBHOOK_SECRET or CRON_SECRET> for Telegram diagnostics.",
    configured: {
      telegram_bot_token: Boolean(optionalEnv("TELEGRAM_BOT_TOKEN")),
      telegram_webhook_secret: Boolean(optionalEnv("TELEGRAM_WEBHOOK_SECRET")),
      supabase_url: Boolean(optionalEnv("SUPABASE_URL")),
      supabase_service_role_key: Boolean(optionalEnv("SUPABASE_SERVICE_ROLE_KEY"))
    }
  };
}

async function handleDiagnostics(request: any, response: any) {
  if (!hasValidDiagnosticSecret(request)) {
    sendJson(response, 200, buildUnauthorizedDiagnosticPayload());
    return;
  }

  const diagnostics: Record<string, unknown> = {
    ok: true,
    status: "webhook endpoint is deployed",
    configured: {
      telegram_bot_token: Boolean(optionalEnv("TELEGRAM_BOT_TOKEN")),
      telegram_webhook_secret: Boolean(optionalEnv("TELEGRAM_WEBHOOK_SECRET")),
      supabase_url: Boolean(optionalEnv("SUPABASE_URL")),
      supabase_service_role_key: Boolean(optionalEnv("SUPABASE_SERVICE_ROLE_KEY"))
    }
  };

  if (optionalEnv("TELEGRAM_BOT_TOKEN")) {
    try {
      // Opening this diagnostics URL also repairs a webhook that is missing the
      // chat_member subscription, so group welcomes work without a redeploy.
      await ensureChatMemberSubscription();
      const [bot, webhook] = await Promise.all([getMe(), getWebhookInfo()]);
      diagnostics.telegram = {
        bot: {
          id: bot.id,
          username: bot.username,
          first_name: bot.first_name
        },
        webhook: {
          url: webhook.url,
          pending_update_count: webhook.pending_update_count,
          last_error_date: webhook.last_error_date,
          last_error_message: webhook.last_error_message,
          allowed_updates: webhook.allowed_updates,
          chat_member_subscribed: Array.isArray(webhook.allowed_updates)
            ? webhook.allowed_updates.includes("chat_member")
            : false
        },
        stats_groups: await describeStatsGroupAccess(bot.id)
      };
    } catch (error) {
      diagnostics.telegram = {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  sendJson(response, 200, diagnostics);
}

export default async function handler(request: any, response: any) {
  if (request.method === "GET" || request.method === "HEAD") {
    await handleDiagnostics(request, response);
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  if (!hasValidWebhookSecret(request)) {
    console.warn("Rejected Telegram webhook update because x-telegram-bot-api-secret-token did not match TELEGRAM_WEBHOOK_SECRET.");
    sendJson(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  try {
    // Self-heal the webhook subscription: Telegram omits chat_member from the
    // default update set, so without this a bot registered by the older
    // setWebhook command never receives group joins.
    await ensureChatMemberSubscription();

    const update = await readJsonBody<TelegramUpdate>(request);
    await handleTelegramUpdate(getSupabase(), update);
    sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, error: "Webhook failed" });
  }
}
