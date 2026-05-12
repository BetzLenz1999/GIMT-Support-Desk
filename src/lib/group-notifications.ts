import { optionalEnv } from "./config.js";
import {
  getAppSetting,
  listExpiredGroupActionMessages,
  listPendingGroupActionMessages,
  markGroupActionMessageCleared,
  upsertAppSetting
} from "./repository.js";
import { getSupabase, type GroupActionType, type SupabaseRestClient } from "./supabase.js";
import { TelegramApiError, deleteMessage, sendMessage, type SendMessageOptions, type SentTelegramMessage } from "./telegram.js";

const TEAM_GROUP_CHAT_ID_ENV = "TEAM_GROUP_CHAT_ID";
const TEAM_STATS_GROUP_CHAT_IDS_ENV = "TEAM_STATS_GROUP_CHAT_IDS";
const TEAM_GROUP_CHAT_ID_DB_KEY = "team_group_chat_id";

let missingChatIdWarned = false;
let inaccessibleChatWarned: number | undefined;
let storedFallbackUsedWarned: number | undefined;
let storedFallbackCache: number | undefined;
let storedFallbackChecked = false;
let lastRememberedChatId: number | undefined;

export function getTeamGroupChatId(): number | undefined {
  const raw = optionalEnv(TEAM_GROUP_CHAT_ID_ENV);
  if (!raw) return undefined;

  const cleaned = raw.trim().replace(/^["']|["']$/g, "");
  if (!cleaned) return undefined;

  const chatId = Number(cleaned);
  if (!Number.isSafeInteger(chatId)) {
    throw new Error(
      `${TEAM_GROUP_CHAT_ID_ENV} must be a valid Telegram chat ID integer (got ${JSON.stringify(raw)}). Send "/chatid@YourBotUsername" in the team group and copy the value (it should look like -1001234567890).`
    );
  }

  return chatId;
}


function parseChatIdList(raw: string, envName: string): number[] {
  const chatIds: number[] = [];
  const seen = new Set<number>();
  for (const part of raw.split(/[\s,]+/)) {
    const cleaned = part.trim().replace(/^["']|["']$/g, "");
    if (!cleaned) continue;
    const chatId = Number(cleaned);
    if (!Number.isSafeInteger(chatId)) {
      throw new Error(
        `${envName} must contain Telegram chat ID integers separated by commas or spaces (invalid value: ${JSON.stringify(part)}). Each ID should look like -1001234567890.`
      );
    }
    if (!seen.has(chatId)) {
      seen.add(chatId);
      chatIds.push(chatId);
    }
  }
  return chatIds;
}

export function getStatsGroupChatIds(): number[] {
  const raw = optionalEnv(TEAM_STATS_GROUP_CHAT_IDS_ENV);
  if (!raw) return [];
  return parseChatIdList(raw, TEAM_STATS_GROUP_CHAT_IDS_ENV);
}

export function isStatsGroupEnabled(chatId: number): boolean {
  const statsChatIds = getStatsGroupChatIds();
  return statsChatIds.length === 0 || statsChatIds.includes(chatId);
}

function isChatNotFoundError(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) return false;
  const description = error.description.toLowerCase();
  return description.includes("chat not found") || description.includes("bot was kicked") || description.includes("bot is not a member");
}

export function resetGroupNotificationWarnings(): void {
  missingChatIdWarned = false;
  inaccessibleChatWarned = undefined;
  storedFallbackUsedWarned = undefined;
  storedFallbackCache = undefined;
  storedFallbackChecked = false;
  lastRememberedChatId = undefined;
}

async function loadStoredFallback(): Promise<number | undefined> {
  if (storedFallbackChecked) return storedFallbackCache;
  storedFallbackChecked = true;
  try {
    const value = await getAppSetting(getSupabase(), TEAM_GROUP_CHAT_ID_DB_KEY);
    if (value) {
      const parsed = Number(value.trim());
      if (Number.isSafeInteger(parsed)) {
        storedFallbackCache = parsed;
      }
    }
  } catch (error) {
    console.warn(
      `Could not read ${TEAM_GROUP_CHAT_ID_DB_KEY} from app_settings (fallback unavailable): ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return storedFallbackCache;
}

export async function rememberTeamGroupChatId(
  db: SupabaseRestClient,
  chatId: number,
  options: { force?: boolean } = {}
): Promise<void> {
  if (!Number.isSafeInteger(chatId)) return;
  if (lastRememberedChatId === chatId) return;

  const existingChatId = await loadStoredFallback();
  if (!options.force && existingChatId !== undefined && existingChatId !== chatId) {
    return;
  }

  try {
    await upsertAppSetting(db, TEAM_GROUP_CHAT_ID_DB_KEY, String(chatId));
    lastRememberedChatId = chatId;
    storedFallbackCache = chatId;
    storedFallbackChecked = true;
  } catch (error) {
    console.warn(
      `Could not persist ${TEAM_GROUP_CHAT_ID_DB_KEY}=${chatId} to app_settings: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function getStoredTeamGroupChatId(): Promise<number | undefined> {
  return loadStoredFallback();
}

async function trySendWithFallback(
  envChatId: number | undefined,
  text: string,
  options: SendMessageOptions
): Promise<SentTelegramMessage | null> {
  if (envChatId !== undefined) {
    try {
      return await sendMessage(envChatId, text, options);
    } catch (error) {
      if (!isChatNotFoundError(error)) {
        console.error("Failed to send team group message", error);
        return null;
      }
      if (inaccessibleChatWarned !== envChatId) {
        inaccessibleChatWarned = envChatId;
        const description = error instanceof TelegramApiError ? error.description : String(error);
        console.error(
          `Telegram refused sendMessage to ${TEAM_GROUP_CHAT_ID_ENV}=${envChatId}: "${description}". The bot configured by TELEGRAM_BOT_TOKEN is not a member of that chat (or the chat ID is wrong). Fix: (1) in the target group, send "/chatid@YourBotUsername" to verify the chat ID, (2) compare it with ${TEAM_GROUP_CHAT_ID_ENV} in Vercel, (3) make sure THIS bot (matching TELEGRAM_BOT_TOKEN) is a member of that group, (4) redeploy. Further occurrences for chat ${envChatId} will be suppressed until the next cold start.`
        );
      }
    }
  }

  const storedChatId = await loadStoredFallback();
  if (storedChatId === undefined || storedChatId === envChatId) {
    return null;
  }

  try {
    const result = await sendMessage(storedChatId, text, options);
    if (storedFallbackUsedWarned !== storedChatId) {
      storedFallbackUsedWarned = storedChatId;
      console.warn(
        `Auto-fallback: ${TEAM_GROUP_CHAT_ID_ENV} env var (${envChatId ?? "unset"}) was unusable, but the bot saw a registered member message in chat ${storedChatId}, so reminders were sent there. To make this permanent and silence this warning, set ${TEAM_GROUP_CHAT_ID_ENV}=${storedChatId} in Vercel and redeploy.`
      );
    }
    return result;
  } catch (error) {
    console.error(`Auto-fallback also failed for chat ${storedChatId}`, error);
    return null;
  }
}

export async function sendTeamGroupMessageWithResult(
  text: string,
  options: SendMessageOptions = {}
): Promise<SentTelegramMessage | null> {
  let envChatId: number | undefined;
  try {
    envChatId = getTeamGroupChatId();
  } catch (error) {
    console.error("Invalid TEAM_GROUP_CHAT_ID", error);
    envChatId = undefined;
  }

  if (envChatId === undefined && !missingChatIdWarned) {
    missingChatIdWarned = true;
    console.warn(
      `${TEAM_GROUP_CHAT_ID_ENV} is not set. Falling back to app_settings.${TEAM_GROUP_CHAT_ID_DB_KEY} if a registered member has messaged in the team group. Send "/chatid@YourBotUsername" in the team group to retrieve the chat ID, then set ${TEAM_GROUP_CHAT_ID_ENV} in Vercel and redeploy.`
    );
  }

  return trySendWithFallback(envChatId, text, options);
}

export async function sendTeamGroupMessage(text: string, options: SendMessageOptions = {}): Promise<boolean> {
  const result = await sendTeamGroupMessageWithResult(text, options);
  return result !== null;
}

export async function clearGroupActionMessages(
  db: SupabaseRestClient,
  memberId: string,
  workDateUtc: string,
  actionType: GroupActionType
): Promise<number> {
  const rows = await listPendingGroupActionMessages(db, memberId, workDateUtc, actionType);
  let cleared = 0;
  for (const row of rows) {
    await deleteMessage(row.telegram_chat_id, row.telegram_message_id);
    await markGroupActionMessageCleared(db, row.id);
    cleared += 1;
  }
  return cleared;
}

export async function sweepExpiredGroupActionMessages(
  db: SupabaseRestClient,
  now: Date = new Date()
): Promise<number> {
  const rows = await listExpiredGroupActionMessages(db, now.toISOString());
  let cleared = 0;
  for (const row of rows) {
    await deleteMessage(row.telegram_chat_id, row.telegram_message_id);
    await markGroupActionMessageCleared(db, row.id);
    cleared += 1;
  }
  return cleared;
}
