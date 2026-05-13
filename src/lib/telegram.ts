import { requireEnv } from "./config.js";
import type { InlineKeyboardMarkup } from "./telegram-types.js";

export type SendMessageOptions = {
  replyMarkup?: InlineKeyboardMarkup;
  parseMode?: "HTML" | "MarkdownV2";
  replyToMessageId?: number;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export class TelegramApiError extends Error {
  readonly method: string;
  readonly description: string;

  constructor(method: string, description: string) {
    super(`Telegram API ${method} failed: ${description}`);
    this.name = "TelegramApiError";
    this.method = method;
    this.description = description;
  }
}

async function telegramApi<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = (await response.json()) as TelegramApiResponse<T>;

  if (!response.ok || !data.ok) {
    throw new TelegramApiError(method, data.description ?? response.statusText);
  }

  return data.result as T;
}

export type SentTelegramMessage = {
  message_id: number;
  chat: { id: number };
};

export async function sendMessage(
  chatId: number,
  text: string,
  options: SendMessageOptions = {}
): Promise<SentTelegramMessage> {
  return telegramApi<SentTelegramMessage>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode,
    reply_markup: options.replyMarkup,
    reply_to_message_id: options.replyToMessageId
  });
}

export async function deleteMessage(chatId: number, messageId: number): Promise<boolean> {
  try {
    await telegramApi<boolean>("deleteMessage", {
      chat_id: chatId,
      message_id: messageId
    });
    return true;
  } catch (error) {
    if (error instanceof TelegramApiError) {
      const description = error.description.toLowerCase();
      if (
        description.includes("message to delete not found") ||
        description.includes("message can't be deleted") ||
        description.includes("message_id_invalid")
      ) {
        return false;
      }
    }
    console.warn(`deleteMessage failed for chat ${chatId} message ${messageId}:`, error);
    return false;
  }
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  options: SendMessageOptions = {}
) {
  return telegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: options.parseMode,
    reply_markup: options.replyMarkup
  });
}

export type AnswerCallbackOptions = {
  showAlert?: boolean;
};

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  options: AnswerCallbackOptions = {}
) {
  return telegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: options.showAlert
  });
}

export type TelegramBotInfo = {
  id: number;
  is_bot: boolean;
  first_name?: string;
  username?: string;
};

export async function getMe(): Promise<TelegramBotInfo> {
  return telegramApi<TelegramBotInfo>("getMe", {});
}

export type TelegramChatInfo = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  description?: string;
};

export async function getChat(chatId: number): Promise<TelegramChatInfo> {
  return telegramApi<TelegramChatInfo>("getChat", { chat_id: chatId });
}
