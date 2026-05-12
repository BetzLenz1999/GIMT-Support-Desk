import { optionalEnv } from "../../src/lib/config.js";
import { handleTelegramUpdate } from "../../src/lib/bot.js";
import { getSupabase } from "../../src/lib/supabase.js";
import type { TelegramUpdate } from "../../src/lib/telegram-types.js";

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

export default async function handler(request: any, response: any) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const webhookSecret = optionalEnv("TELEGRAM_WEBHOOK_SECRET");
  const telegramSecret = request.headers["x-telegram-bot-api-secret-token"];
  if (webhookSecret && telegramSecret !== webhookSecret) {
    sendJson(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const update = await readJsonBody<TelegramUpdate>(request);
    await handleTelegramUpdate(getSupabase(), update);
    sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, error: "Webhook failed" });
  }
}
