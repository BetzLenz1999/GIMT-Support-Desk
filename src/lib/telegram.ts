import { optionalEnv, requireEnv } from "./config.js";
import { fetchWithRetry } from "./http.js";
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
  const response = await fetchWithRetry(`https://api.telegram.org/bot${token}/${method}`, {
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


export type TelegramFile = {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
};

export async function getFile(fileId: string): Promise<TelegramFile> {
  return telegramApi<TelegramFile>("getFile", { file_id: fileId });
}

export async function downloadFile(filePath: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetchWithRetry(`https://api.telegram.org/file/bot${token}/${filePath}`, {}, { timeoutMs: 15000 });
  if (!response.ok) {
    const errorText = await response.text();
    throw new TelegramApiError("downloadFile", `${response.status} ${response.statusText}: ${errorText}`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type")
  };
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

export type CopyMessageOptions = {
  caption?: string;
  parseMode?: "HTML" | "MarkdownV2";
  replyToMessageId?: number;
};

export async function copyMessage(
  chatId: number,
  fromChatId: number,
  messageId: number,
  options: CopyMessageOptions = {}
): Promise<SentTelegramMessage> {
  const copied = await telegramApi<{ message_id: number }>("copyMessage", {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    caption: options.caption,
    parse_mode: options.parseMode,
    reply_to_message_id: options.replyToMessageId
  });
  return { ...copied, chat: { id: chatId } };
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
  try {
    return await telegramApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options.parseMode,
      reply_markup: options.replyMarkup
    });
  } catch (error) {
    if (!(error instanceof TelegramApiError)) throw error;

    const description = error.description.toLowerCase();
    if (description.includes("message is not modified")) return false;

    if (
      description.includes("message to edit not found") ||
      description.includes("message can't be edited") ||
      description.includes("message_id_invalid")
    ) {
      console.warn(
        `editMessageText failed for chat ${chatId} message ${messageId}; sending a new message instead: ${error.description}`
      );
      return sendMessage(chatId, text, options);
    }

    throw error;
  }
}

export type AnswerCallbackOptions = {
  showAlert?: boolean;
};

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  options: AnswerCallbackOptions = {}
) {
  try {
    return await telegramApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: options.showAlert
    });
  } catch (error) {
    if (!(error instanceof TelegramApiError)) throw error;

    console.warn(`answerCallbackQuery failed for callback ${callbackQueryId}: ${error.description}`);
    return false;
  }
}
export type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
};

export async function getWebhookInfo(): Promise<TelegramWebhookInfo> {
  return telegramApi<TelegramWebhookInfo>("getWebhookInfo", {});
}

export type SetWebhookOptions = {
  url: string;
  secretToken?: string;
  allowedUpdates?: string[];
};

export async function setWebhook(options: SetWebhookOptions): Promise<boolean> {
  return telegramApi<boolean>("setWebhook", {
    url: options.url,
    secret_token: options.secretToken,
    allowed_updates: options.allowedUpdates
  });
}

/** Update types this bot handles. Telegram excludes chat_member from the default set. */
export const REQUIRED_WEBHOOK_UPDATES = ["message", "callback_query", "my_chat_member", "chat_member"];

let webhookSubscriptionChecked = false;

/**
 * Re-registers the existing webhook with chat_member in allowed_updates when it
 * is missing. Telegram omits chat_member from the default update set, so a bot
 * whose webhook was registered without it never receives group joins and cannot
 * welcome new members. Reuses the webhook's current URL, so it is a no-op until
 * the subscription is actually incomplete. Runs at most once per warm instance.
 */
export async function ensureChatMemberSubscription(): Promise<void> {
  if (webhookSubscriptionChecked) return;
  webhookSubscriptionChecked = true;

  let info: TelegramWebhookInfo;
  try {
    info = await getWebhookInfo();
  } catch (error) {
    webhookSubscriptionChecked = false;
    console.warn("Could not read webhook info to verify chat_member subscription:", error);
    return;
  }

  if (!info.url) return;
  if (Array.isArray(info.allowed_updates) && info.allowed_updates.includes("chat_member")) return;

  // Keep any extra update types the deployment already subscribed to; only add
  // the ones this bot needs. The bot handles message, callback_query,
  // my_chat_member and chat_member, so this list is complete for it.
  const allowedUpdates = Array.from(new Set([...(info.allowed_updates ?? []), ...REQUIRED_WEBHOOK_UPDATES]));

  try {
    await setWebhook({
      url: info.url,
      secretToken: optionalEnv("TELEGRAM_WEBHOOK_SECRET"),
      allowedUpdates
    });
    console.warn(
      `Re-registered webhook ${info.url} with allowed_updates=${allowedUpdates.join(",")} so group joins (chat_member) are delivered. Previous allowed_updates: ${JSON.stringify(info.allowed_updates ?? "default")}.`
    );
  } catch (error) {
    webhookSubscriptionChecked = false;
    console.error("Failed to re-register webhook with chat_member subscription:", error);
  }
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

export type TelegramChatMemberStatus =
  | "creator"
  | "administrator"
  | "member"
  | "restricted"
  | "left"
  | "kicked";

export type TelegramChatMember = {
  status: TelegramChatMemberStatus;
  user: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
};

export async function getChatMember(chatId: number, userId: number): Promise<TelegramChatMember | null> {
  try {
    return await telegramApi<TelegramChatMember>("getChatMember", {
      chat_id: chatId,
      user_id: userId
    });
  } catch (error) {
    if (error instanceof TelegramApiError) {
      console.warn(`getChatMember failed for chat ${chatId} user ${userId}: ${error.description}`);
      return null;
    }
    throw error;
  }
}
