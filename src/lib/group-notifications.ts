import { optionalEnv } from "./config.js";
import {
  getAppSetting,
  hasCronEvent,
  listExpiredGroupActionMessages,
  listPendingGroupActionMessages,
  markGroupActionMessageCleared,
  recordCronEvent,
  upsertAppSetting
} from "./repository.js";
import { getSupabase, type GroupActionType, type Registration, type SupabaseRestClient } from "./supabase.js";
import { TelegramApiError, deleteMessage, sendMessage, type SendMessageOptions, type SentTelegramMessage } from "./telegram.js";

const TEAM_GROUP_CHAT_ID_ENV = "TEAM_GROUP_CHAT_ID";
const TEAM_STATS_GROUP_CHAT_IDS_ENV = "TEAM_STATS_GROUP_CHAT_IDS";
const GOODMARKET_CHAT_ID_ENV = "GOODMARKET_CHAT_ID";
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

export function getGoodMarketChatId(): number | undefined {
  const raw = optionalEnv(GOODMARKET_CHAT_ID_ENV);
  if (!raw) return undefined;

  const cleaned = raw.trim().replace(/^["']|["']$/g, "");
  if (!cleaned) return undefined;

  const chatId = Number(cleaned);
  if (!Number.isSafeInteger(chatId)) {
    throw new Error(
      `${GOODMARKET_CHAT_ID_ENV} must be a valid Telegram chat ID integer (got ${JSON.stringify(raw)}). Send "/chatid@YourBotUsername" in the GoodMarket group and copy the value (it should look like -1001234567890).`
    );
  }

  return chatId;
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildMemberMention(registration: Pick<Registration, "telegram_username" | "telegram_user_id" | "member_name">): string {
  const displayName = escapeHtml(registration.member_name);
  if (registration.telegram_username?.trim()) {
    return `@${escapeHtml(registration.telegram_username.trim())} (${displayName})`;
  }
  return `<a href="tg://user?id=${registration.telegram_user_id}">${displayName}</a>`;
}

export function getSupportIntroTargetChatIds(): number[] {
  // Support introductions are public-facing messages. Never send them to the
  // private primary notification group; it may only receive attendance and
  // reminder notifications through TEAM_GROUP_CHAT_ID.
  return getStatsGroupChatIds();
}

function supportIntroActiveKey(chatId: number): string {
  return `support_intro_active:${chatId}`;
}

async function deleteActiveSupportIntro(db: SupabaseRestClient, chatId: number): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await getAppSetting(db, supportIntroActiveKey(chatId));
  } catch (error) {
    console.warn(
      `Could not read active support intro for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }
  if (!raw) return;

  let messageId: number | undefined;
  try {
    const parsed = JSON.parse(raw) as { messageId?: unknown };
    if (typeof parsed.messageId === "number" && Number.isSafeInteger(parsed.messageId)) {
      messageId = parsed.messageId;
    }
  } catch {
    // Legacy/plain value stored before JSON tracking; nothing to delete.
    return;
  }
  if (messageId === undefined) return;

  await deleteMessage(chatId, messageId);
}

async function rememberActiveSupportIntro(
  db: SupabaseRestClient,
  chatId: number,
  messageId: number,
  registration: Pick<Registration, "member_id">,
  workDateUtc: string
): Promise<void> {
  try {
    await upsertAppSetting(
      db,
      supportIntroActiveKey(chatId),
      JSON.stringify({ messageId, memberId: registration.member_id, workDateUtc })
    );
  } catch (error) {
    console.warn(
      `Could not persist active support intro for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function sendSupportIntroToGroups(
  db: SupabaseRestClient,
  registration: Pick<Registration, "telegram_user_id" | "telegram_username" | "member_id" | "member_name">,
  workDateUtc: string
): Promise<number> {
  const chatIds = getSupportIntroTargetChatIds();
  let sent = 0;
  for (const chatId of chatIds) {
    const eventKey = `support_intro:${chatId}:${registration.member_id}:${workDateUtc}`;
    if (await hasCronEvent(db, eventKey)) continue;

    const mention = buildMemberMention(registration);
    const message =
      "👋 <b>Hi everyone!</b>\n\n" +
      `Your assistant today is ${mention} — ask anything about ` +
      "GoodDollar, face verification, swap, bridge,and more. We're here to help you! 🚀";

    let posted: SentTelegramMessage;
    try {
      posted = await sendMessage(chatId, message, { parseMode: "HTML" });
    } catch (error) {
      console.error(
        `Failed to send support intro to chat ${chatId} for ${registration.member_id}/${workDateUtc}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    // Remove the previous shift's "assistant today" intro so each group shows
    // only the current on-duty assistant instead of a duplicate. Done after the
    // new intro is posted so a send failure never leaves the group without one.
    await deleteActiveSupportIntro(db, chatId);
    await rememberActiveSupportIntro(db, chatId, posted.message_id, registration, workDateUtc);

    try {
      await recordCronEvent(db, eventKey, registration.member_id, workDateUtc, "support_intro");
    } catch (error) {
      console.error(
        `Failed to record support intro cron event ${eventKey}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    sent += 1;
  }
  return sent;
}
