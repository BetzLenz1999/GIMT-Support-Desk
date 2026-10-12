import type { GroupActionType, ProofOfWorkSubmission, Registration, SupabaseRestClient, SupportTicket, SupportTicketAttachment } from "./supabase.js";
import { dashboardKeyboard, excuseTypeKeyboard, homeKeyboard, proofOfWorkKeyboard, registrationKeyboard, supportReplyKeyboard, swapResponseKeyboard, swapTargetKeyboard, confirmAbsentKeyboard } from "./keyboards.js";
import {
  clearConversationState,
  createActivity,
  createProofOfWorkSubmission,
  createSupportTicket,
  findLatestCustomerSupportTicketMessage,
  findActiveSupportTicketByMessageReference,
  findActiveSupportTicketForUser,
  findApprovedSwapsForMember,
  findRegistrationByMemberId,
  findRegistrationByUser,
  findProofOfWorkSubmission,
  findProofOfWorkSubmissionByMediaGroup,
  findSavedCommandForTeam,
  findSupportTicketById,
  findTimeLog,
  listRecentBotSupportTicketMessages,
  listTeamInboxDmsByTicket,
  listRegistrations,
  getConversationState,
  getOrCreateTimeLog,
  incrementGroupMessageCount,
  listRecentActivities,
  markProofOfWorkReminderSubmitted,
  updateProofOfWorkSubmission,
  recordGroupActionMessage,
  recordSupportTicketEvent,
  recordSupportTicketMessage,
  setConversationState,
  updateSupportTicket,
  updateTimeLog,
  upsertRegistration,
  upsertSavedCommand,
  upsertTeamInboxDm,
  upsertTelegramGroup
} from "./repository.js";
import {
  clearGroupActionMessages,
  getStatsGroupChatIds,
  getStoredTeamGroupChatId,
  getTeamGroupChatId,
  isStatsGroupEnabled,
  rememberTeamGroupChatId,
  sendTeamGroupMessage,
  sendTeamGroupMessageWithResult
} from "./group-notifications.js";
import { getTeamMember, TEAM_SCHEDULE, type TeamMember } from "./team-schedule.js";
import { answerCallbackQuery, copyMessage, deleteMessage, downloadFile, editMessageText, getChatMember, getFile, sendMessage, type SentTelegramMessage } from "./telegram.js";
import type { TelegramCallbackQuery, TelegramChat, TelegramChatMemberUpdated, TelegramMessage, TelegramUpdate, TelegramUser } from "./telegram-types.js";
import { getSupportMode, isTeamInboxEnabled, TEAM_INBOX_PRIMARY_GRACE_MINUTES } from "./config.js";
import {
  buildMemberTicketStats,
  formatMemberTicketStatsReply,
  formatSelfOnlyNotice,
  isSelfTicketStatsCommand,
  parseSelfTicketStatsRequest
} from "./member-ticket-stats.js";
import { detectAiSupportTemplate, type AiSupportDashboardStatus, type AiSupportMatch } from "./ai-support.js";
import { isBeforeScheduledTime, calculateEarlyOutMinutes, calculateLateMinutes, calculateOvertimeMinutes, formatDuration, formatLocal, formatUtc, getRelevantShiftWindow, getShiftProgress, getShiftWindowForDate, signedMinutesBetween, utcDateKey } from "./time.js";

export async function handleTelegramUpdate(db: SupabaseRestClient, update: TelegramUpdate): Promise<void> {
  try {
    if (update.callback_query) {
      await handleCallback(db, update.callback_query);
      return;
    }

    if (update.my_chat_member) {
      await handleBotChatMemberUpdate(db, update.my_chat_member);
      return;
    }

    if (update.message) {
      await handleMessage(db, update.message);
    }
  } catch (error) {
    await handleTelegramUpdateError(update, error);
  }
}

async function handleTelegramUpdateError(update: TelegramUpdate, error: unknown): Promise<void> {
  console.error(`Telegram update ${update.update_id} failed:`, error);

  const fallbackText = "Sorry, I couldn't process that request. Please try again or send /menu to refresh the bot.";

  if (update.callback_query) {
    try {
      await answerCallbackQuery(update.callback_query.id, fallbackText, { showAlert: true });
    } catch (sendError) {
      console.error(`Failed to answer fallback callback for update ${update.update_id}:`, sendError);
    }
    return;
  }

  if (update.message) {
    try {
      await sendMessage(update.message.chat.id, fallbackText, { replyToMessageId: update.message.message_id });
    } catch (sendError) {
      console.error(`Failed to send fallback error message for update ${update.update_id}:`, sendError);
    }
  }
}

async function handleMessage(db: SupabaseRestClient, message: TelegramMessage): Promise<void> {
  const text = message.text?.trim() ?? "";
  const command = getCommand(text);

  if (message.new_chat_members?.some((member) => member.is_bot)) {
    return;
  }

  // Join events come through as service messages (no "from" user)that would
  // otherwise flow into the regular message path. Send the welcome and stop
  // there; joining should never open a support ticket or count as a chat message.
  if (isGroupChat(message.chat) && message.new_chat_members?.length) {
    await welcomeNewStatsGroupMembers(db, message);
    return;
  }

  if (isChatIdCommand(command)) {
    await sendMessage(message.chat.id, buildChatIdText(message.chat));
    return;
  }

  if (isGroupChat(message.chat) && (command === "/start" || command === "/menu" || command === "/help")) {
    await sendMessage(message.chat.id, buildChatIdText(message.chat));
    return;
  }

  const user = message.from;
  if (!user) return;

  if (command === "/start" || command === "/menu" || command === "/help") {
    await clearConversationState(db, user.id);
    const registration = await findRegistrationByUser(db, user.id);

    if (!registration) {
      const registrations = await listRegistrations(db);
      const registeredMemberIds = new Set(registrations.map((row) => row.member_id));
      const availableMembers = TEAM_SCHEDULE.filter((member) => !registeredMemberIds.has(member.id));

      if (availableMembers.length === 0) {
        await sendMessage(
          message.chat.id,
          "Registration is already complete for all 5 team members (Betz, Omar, Moh, Pablo, and Dany). This bot is closed to new users. If you believe this is wrong, please contact the team admin."
        );
        return;
      }

      await sendMessage(message.chat.id, "Welcome to Team Time Management Bot 👋\n\nPlease select your name:", {
        replyMarkup: registrationKeyboard(registeredMemberIds)
      });
      return;
    }

    await sendMessage(message.chat.id, await buildDashboardText(db, registration.member_id, user.id), {
      replyMarkup: dashboardKeyboard()
    });
    return;
  }

  if (isGroupChat(message.chat)) {
    await trackGroupMessage(db, message, user);
    return;
  }

  const state = await getConversationState(db, user.id);
  if (state) {
    await handleStatefulReply(db, message, state.state, state.payload);
    return;
  }

  if (await appendProofOfWorkMediaGroupAttachment(db, message, user, { waitForSubmission: true })) {
    return;
  }

  if (text.startsWith("/")) {
    console.info(
      `Ignoring unknown private command "${command}" from Telegram user ${user.id} in chat ${message.chat.id}. No frontend response will be sent.`
    );
    return;
  }

  await sendMessage(message.chat.id, "Please use the buttons below.", { replyMarkup: dashboardKeyboard() });
}

/** Welcomes people only in the explicitly configured public support/stat groups. */
async function welcomeNewStatsGroupMembers(db: SupabaseRestClient, message: TelegramMessage): Promise<void> {
  let statsChatIds: number[];
  try {
    statsChatIds = getStatsGroupChatIds();
  } catch (error) {
    console.error("Invalid TEAM_STATS_GROUP_CHAT_IDS while handling group welcome", error);
    return;
  }

  // An empty list means stats are permissive for backwards compatibility, but
  // group welcomes are opt-in to avoid posting unexpectedly in every group.
  if (!statsChatIds.includes(message.chat.id)) return;

  await rememberTelegramGroup(db, message.chat);
  const members = (message.new_chat_members ?? []).filter((member) => !member.is_bot);
  if (!members.length) return;

  const names = members.map((member) => escapeHtmlForMention(getTelegramUserDisplayName(member))).join(", ");
  await sendMessage(
    message.chat.id,
    `👋 Hey ${names}, welcome to <b>GoodDollar</b>! We're glad to have you on board. 🚀\n\nThis channel is where we push forward the conversation around building a people-powered, decentralized basic income on the blockchain — sharing current news and ideas along the way.\n\n✨ <a href="https://goodwallet.xyz">Start claiming</a> — sign up and get your G$\n💬 <a href="https://t.me/GoodDollarX">Telegram Community</a>\n🛠️ <a href="https://t.me/+2pQlOfCBG11iYzFk">Support Team</a>\n\nHappy claiming! 🎉`,
    { parseMode: "HTML", replyToMessageId: message.message_id }
  );
}

const trackGroupMessageWarnings = {
  envMismatchLogged: new Set<string>(),
  unregisteredUser: new Set<number>()
};

async function trackGroupMessage(
  db: SupabaseRestClient,
  message: TelegramMessage,
  user: TelegramUser
): Promise<void> {
  if (user.is_bot) return;

  const registration = await findRegistrationByUser(db, user.id);
  if (!registration) {
    if (!trackGroupMessageWarnings.unregisteredUser.has(user.id)) {
      trackGroupMessageWarnings.unregisteredUser.add(user.id);
      const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || String(user.id);
      console.warn(
        `trackGroupMessage: skipped message from Telegram user ${user.id} (${displayName}) in chat ${message.chat.id} because they have no row in team_registrations. They must DM the bot and /start to register before their messages are counted. Further warnings for this user are suppressed until the next cold start.`
      );
    }

    const messageText = message.text?.trim() ?? "";
    const supportText = messageText || message.caption?.trim() || "";
    const isSlashCommand = messageText.startsWith("/");

    if (isSlashCommand) {
      const admin = await isUserChatAdmin(message.chat.id, user.id);
      if (admin) {
        await rememberTelegramGroup(db, message.chat);
        const adminSaver: Saver = {
          telegram_user_id: user.id,
          member_id: `admin_${user.id}`,
          member_name: getTelegramUserDisplayName(user)
        };

        if (isSaveCommand(message)) {
          await runSaveCommandSafely(db, message, adminSaver);
          return;
        }

        if (await runSavedCommandPlaybackSafely(db, message, adminSaver)) {
          return;
        }

        console.info(
          `Ignoring unknown group command "${getCommand(messageText)}" from group admin ${user.id} in chat ${message.chat.id}. No frontend response will be sent.`
        );
        return;
      }

      console.info(
        `Ignoring slash command "${getCommand(messageText)}" from unregistered non-admin user ${user.id} in chat ${message.chat.id}. No ticket opened, no frontend response sent.`
      );
      return;
    }

    const activeTicket = await findActiveSupportTicketForUser(db, message.chat.id, user.id);
    if (activeTicket) {
      if (getSupportMode() === "ai" && isAiSupportTicket(activeTicket)) {
        await handleAiSupportTicketFollowUp(db, activeTicket, message, user);
        return;
      }

      await recordCustomerTicketFollowUp(db, activeTicket, message, user);
      return;
    }

    await clearConversationState(db, user.id);
    if (getSupportMode() === "ai") {
      await handleAiSupportMessage(db, message, user);
      return;
    }

    if (isSupportTicketOpeningText(supportText)) {
      await openSupportTicket(db, message, user);
      return;
    }

    console.info(
      `Ignoring non-support message from unregistered user ${user.id} in chat ${message.chat.id}. No support ticket opened.`
    );
    return;
  }

  await rememberTelegramGroup(db, message.chat);

  let envChatId: number | undefined;
  try {
    envChatId = getTeamGroupChatId();
  } catch (error) {
    console.error("Invalid TEAM_GROUP_CHAT_ID", error);
  }

  let shouldCountStats = true;
  try {
    shouldCountStats = isStatsGroupEnabled(message.chat.id);
  } catch (error) {
    console.error("Invalid TEAM_STATS_GROUP_CHAT_IDS", error);
  }

  // Resolve the main group before answering self-stats. When TEAM_GROUP_CHAT_ID
  // is unset this records or inherits the stored chat ID, so the reply is
  // correctly restricted to the main group on the very first message that asks.
  if (shouldCountStats) {
    if (envChatId === undefined) {
      await rememberTeamGroupChatId(db, message.chat.id);
    } else if (envChatId === message.chat.id) {
      await rememberTeamGroupChatId(db, message.chat.id, { force: true });
    }
  }

  // A registered member asking for their own handled-ticket count is answered
  // only in the main group. This runs before the saved-command playback so an
  // unknown /mystats command is not swallowed silently.
  if (await tryReplyWithSelfTicketStats(db, message, registration)) return;

  if (isSaveCommand(message)) {
    await runSaveCommandSafely(db, message, registration);
    return;
  }

  if (await runSavedCommandPlaybackSafely(db, message, registration)) {
    return;
  }

  const now = message.date ? new Date(message.date * 1000) : new Date();

  if (shouldCountStats) {
    if (envChatId !== undefined && envChatId !== message.chat.id) {
      const key = `${message.chat.id}->${envChatId}`;
      if (!trackGroupMessageWarnings.envMismatchLogged.has(key)) {
        trackGroupMessageWarnings.envMismatchLogged.add(key);
        console.warn(
          `trackGroupMessage: registered member ${registration.member_id} messaged in chat ${message.chat.id} but TEAM_GROUP_CHAT_ID env var is ${envChatId}. Counting stats for this group without changing the notification fallback. To make this the primary notification group, set TEAM_GROUP_CHAT_ID=${message.chat.id} in Vercel and redeploy.`
        );
      }
    }

    try {
      await incrementGroupMessageCount(db, {
        member_id: registration.member_id,
        member_name: registration.member_name,
        telegram_user_id: user.id,
        telegram_chat_id: message.chat.id,
        work_date_utc: utcDateKey(now),
        message_at_utc: now.toISOString()
      });
    } catch (error) {
      console.error("Failed to record group message stat", error);
    }
  }

  await recordTeamTicketReplyIfReferenced(db, message, registration);
}

/**
 * Answers a registered member's self-stats question inside the main group only.
 * Returns true when the message was handled so the caller stops processing it.
 * Any failure is logged and returns false, leaving normal group handling intact.
 */
async function tryReplyWithSelfTicketStats(
  db: SupabaseRestClient,
  message: TelegramMessage,
  registration: Registration
): Promise<boolean> {
  const text = message.text?.trim() ?? "";
  if (!text) return false;

  const isCommand = isSelfTicketStatsCommand(text);

  let selfChatId: number | undefined;
  try {
    selfChatId = getTeamGroupChatId();
  } catch (error) {
    console.error("Invalid TEAM_GROUP_CHAT_ID while checking self ticket stats", error);
  }

  // TEAM_GROUP_CHAT_ID may be unset; fall back to the chat the bot remembered.
  if (selfChatId === undefined) {
    try {
      selfChatId = await getStoredTeamGroupChatId();
    } catch (error) {
      console.error("Could not read stored team group chat id while checking self ticket stats", error);
    }
  }

  // Only the main group is answered. Other groups keep their current behavior,
  // and outside the main group only the explicit command is recognized.
  if (selfChatId !== undefined && message.chat.id !== selfChatId) {
    if (!isCommand) return false;
    await sendMessage(
      message.chat.id,
      "ℹ️ Ticket stats are only available in the main team group.",
      { replyToMessageId: message.message_id }
    );
    return true;
  }

  const request = parseSelfTicketStatsRequest(text, registration.member_id);
  if (!request) return false;

  try {
    if (request.otherMemberName) {
      await sendMessage(
        message.chat.id,
        formatSelfOnlyNotice(request.otherMemberName, registration.member_name),
        { replyToMessageId: message.message_id }
      );
      return true;
    }

    const stats = await buildMemberTicketStats(
      db,
      registration.member_id,
      registration.member_name,
      request.window
    );

    await sendMessage(message.chat.id, formatMemberTicketStatsReply(stats), {
      replyToMessageId: message.message_id
    });
    return true;
  } catch (error) {
    console.error(
      `Failed to answer self ticket stats for ${registration.member_id} in chat ${message.chat.id}:`,
      error
    );
    return false;
  }
}

async function handleBotChatMemberUpdate(db: SupabaseRestClient, update: TelegramChatMemberUpdated): Promise<void> {
  const status = update.new_chat_member.status;
  if (!isGroupChat(update.chat) || (status !== "member" && status !== "administrator")) return;

  await rememberTelegramGroup(db, update.chat);

  let envChatId: number | undefined;
  try {
    envChatId = getTeamGroupChatId();
  } catch (error) {
    console.error("Invalid TEAM_GROUP_CHAT_ID", error);
  }
  if (envChatId === undefined) {
    await rememberTeamGroupChatId(db, update.chat.id);
  } else if (envChatId === update.chat.id) {
    await rememberTeamGroupChatId(db, update.chat.id, { force: true });
  }

}

async function rememberTelegramGroup(db: SupabaseRestClient, chat: TelegramChat): Promise<void> {
  try {
    await upsertTelegramGroup(db, {
      telegram_chat_id: chat.id,
      title: chat.title ?? null,
      type: chat.type,
      is_active: true
    });
  } catch (error) {
    console.warn(
      `Could not save Telegram group ${chat.id} metadata: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function getCommand(text: string): string {
  return text.split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? "";
}

function isChatIdCommand(command: string): boolean {
  return ["/chatid", "/chat_id", "/groupid", "/group_id", "/id"].includes(command);
}

const SAVED_COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const RESERVED_SAVED_COMMAND_NAMES = new Set([
  "1",
  "chat_id",
  "chatid",
  "group_id",
  "groupid",
  "help",
  "id",
  "menu",
  "mystats",
  "mytickets",
  "personal",
  "save",
  "start"
]);

const SAVE_COMMAND_ALIASES = new Set(["/save", "/personal"]);

function isSaveCommand(message: TelegramMessage): boolean {
  return SAVE_COMMAND_ALIASES.has(getCommand(message.text?.trim() ?? ""));
}

function parseSavedCommandName(rawName: string | undefined): string | null {
  const cleaned = rawName?.trim().replace(/^\//, "").split("@")[0]?.toLowerCase() ?? "";
  if (!SAVED_COMMAND_NAME_PATTERN.test(cleaned)) return null;
  if (RESERVED_SAVED_COMMAND_NAMES.has(cleaned)) return null;
  return cleaned;
}

function getSaveCommandName(message: TelegramMessage): string | null {
  const [, rawName] = message.text?.trim().split(/\s+/, 2) ?? [];
  return parseSavedCommandName(rawName);
}

function getDynamicSavedCommandName(message: TelegramMessage): string | null {
  const text = message.text?.trim() ?? "";
  if (!text.startsWith("/")) return null;

  const firstToken = text.split(/\s+/, 1)[0] ?? "";
  if (!firstToken) return null;

  return parseSavedCommandName(firstToken);
}

function hasBotMention(commandText: string): boolean {
  return commandText.includes("@");
}

function getMessagePreview(message: TelegramMessage): string | null {
  return message.text ?? message.caption ?? null;
}

function isGroupChat(chat: TelegramChat): boolean {
  return chat.type === "group" || chat.type === "supergroup";
}

function buildChatIdText(chat: TelegramChat): string {
  return `Chat ID: ${chat.id}\nChat type: ${chat.type}${chat.title ? `\nTitle: ${chat.title}` : ""}`;
}

function escapeHtmlForMention(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SUCCESS_ACK_TTL_MINUTES = 5;

async function postExpiringGroupAck(
  db: SupabaseRestClient,
  memberId: string,
  workDateUtc: string,
  ackType: GroupActionType,
  text: string
): Promise<void> {
  const sent = await sendTeamGroupMessageWithResult(text, { parseMode: "HTML" });
  if (!sent) return;

  const expiresAt = new Date(Date.now() + SUCCESS_ACK_TTL_MINUTES * 60_000).toISOString();
  await recordGroupActionMessage(db, {
    member_id: memberId,
    work_date_utc: workDateUtc,
    action_type: ackType,
    event_type: "success_ack",
    telegram_chat_id: sent.chat.id,
    telegram_message_id: sent.message_id,
    expires_at: expiresAt
  });
}

function buildTimeInAckText(mention: string, scheduled: Date, actual: Date, timezone: string, lateMinutes: number, swap: SwapInfo | null = null): string {
  const coverLine = swap ? `\nCovering: ${escapeHtmlForMention(swap.counterpartMemberName)}'s shift (approved swap)` : "";
  return `🟢 Time In: ${mention}${coverLine}\nScheduled: ${formatUtc(scheduled)} UTC\nActual: ${formatUtc(actual)} UTC\nLocal: ${formatLocal(actual, timezone)}\nStatus: ${lateMinutes > 0 ? `Late by ${formatDuration(lateMinutes)}` : "On time"}`;
}

function buildTimeOutAckText(
  mention: string,
  scheduledOut: Date,
  actualOut: Date,
  workedMinutes: number,
  earlyOutMinutes: number,
  overtimeMinutes: number,
  swap: SwapInfo | null = null
): string {
  const coverLine = swap ? `\nCovering: ${escapeHtmlForMention(swap.counterpartMemberName)}'s shift (approved swap)` : "";
  return `🔴 Time Out: ${mention}${coverLine}\nScheduled Out: ${formatUtc(scheduledOut)} UTC\nActual Out: ${formatUtc(actualOut)} UTC\nWorked: ${formatDuration(workedMinutes)}\n${earlyOutMinutes > 0 ? `Early By: ${formatDuration(earlyOutMinutes)}` : `Overtime: ${formatDuration(overtimeMinutes)}`}`;
}

function buildSwapMetadata(swap: SwapInfo | null): Record<string, unknown> {
  if (!swap) return {};
  return {
    swap: {
      requestId: swap.requestId,
      role: swap.role,
      counterpartMemberId: swap.counterpartMemberId,
      counterpartMemberName: swap.counterpartMemberName,
      workDateUtc: swap.workDateUtc
    }
  };
}

function buildProofOfWorkAckText(mention: string, status: string, proofType: string): string {
  return `📎 Proof of Work Submitted: ${mention}\nStatus: ${status === "late" ? "Late" : "Submitted"}\nType: ${proofType}`;
}


function getTelegramUserDisplayName(user: TelegramUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || String(user.id);
}

function isSupportTicketOpeningText(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;

  const command = getCommand(normalized);
  if (command === "/support" || command === "/ticket") return true;
  if (["help", "hello", "hi"].includes(normalized)) return true;
  return ["complaint", "issue", "problem", "not working"].some((trigger) => normalized.includes(trigger));
}

function buildTicketCode(now = new Date()): string {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "X");
  return `SUP-${datePart}-${randomPart}`;
}

function ticketLabel(ticket: Pick<SupportTicket, "ticket_code" | "id">): string {
  return ticket.ticket_code ?? ticket.id.slice(0, 8);
}

const SUPPORT_TICKET_ATTACHMENT_BUCKET = "support-ticket-attachments";
const PROOF_OF_WORK_ATTACHMENT_BUCKET = "proof-of-work-attachments";

function supportMessageText(message: TelegramMessage): string {
  const text = message.text?.trim() || message.caption?.trim() || "";
  if (message.photo?.length) {
    return text ? `${text}\n\n[photo attachment]` : "[photo attachment]";
  }
  return text || "[non-text message]";
}

async function saveTelegramPhotoAttachments(
  db: SupabaseRestClient,
  bucket: string,
  objectPathPrefix: string,
  message: TelegramMessage,
  warningContext: string
): Promise<SupportTicketAttachment[]> {
  if (!message.photo?.length) return [];

  const largestPhoto = [...message.photo].sort((a, b) => {
    const aArea = a.width * a.height;
    const bArea = b.width * b.height;
    if (aArea !== bArea) return bArea - aArea;
    return (b.file_size ?? 0) - (a.file_size ?? 0);
  })[0];
  const fallbackAttachment: SupportTicketAttachment = {
    type: "photo",
    bucket: "telegram",
    path: `telegram/${largestPhoto.file_unique_id ?? largestPhoto.file_id}`,
    url: `/api/web/telegram-photo?file_id=${encodeURIComponent(largestPhoto.file_id)}`,
    telegram_file_id: largestPhoto.file_id,
    telegram_file_unique_id: largestPhoto.file_unique_id,
    file_size: largestPhoto.file_size,
    width: largestPhoto.width,
    height: largestPhoto.height,
    content_type: null
  };

  try {
    const telegramFile = await getFile(largestPhoto.file_id);
    fallbackAttachment.file_size = telegramFile.file_size ?? largestPhoto.file_size;
    if (!telegramFile.file_path) throw new Error("Telegram did not return a file_path for this photo.");

    const downloaded = await downloadFile(telegramFile.file_path);
    const extension = fileExtensionFromPath(telegramFile.file_path) || "jpg";
    const objectPath = `${objectPathPrefix}/${message.message_id}/${largestPhoto.file_unique_id ?? largestPhoto.file_id}.${extension}`;
    const contentType = downloaded.contentType || contentTypeForExtension(extension);

    await db.uploadObject(bucket, objectPath, downloaded.bytes, contentType);

    return [{
      type: "photo",
      bucket,
      path: objectPath,
      url: db.getPublicObjectUrl(bucket, objectPath),
      telegram_file_id: largestPhoto.file_id,
      telegram_file_unique_id: largestPhoto.file_unique_id,
      file_size: telegramFile.file_size ?? largestPhoto.file_size,
      width: largestPhoto.width,
      height: largestPhoto.height,
      content_type: contentType
    }];
  } catch (error) {
    console.warn(
      `Failed to save Telegram photo attachment for ${warningContext}, message ${message.message_id}; using Telegram proxy fallback: ${error instanceof Error ? error.message : String(error)}`
    );
    return [fallbackAttachment];
  }
}

async function saveSupportTicketAttachments(
  db: SupabaseRestClient,
  ticketId: string,
  message: TelegramMessage
): Promise<SupportTicketAttachment[]> {
  return saveTelegramPhotoAttachments(
    db,
    SUPPORT_TICKET_ATTACHMENT_BUCKET,
    ticketId,
    message,
    `support ticket ${ticketId}`
  );
}

async function saveProofOfWorkAttachments(
  db: SupabaseRestClient,
  memberId: string,
  workDateUtc: string,
  message: TelegramMessage
): Promise<SupportTicketAttachment[]> {
  return saveTelegramPhotoAttachments(
    db,
    PROOF_OF_WORK_ATTACHMENT_BUCKET,
    `${memberId}/${workDateUtc}`,
    message,
    `proof of work ${memberId}/${workDateUtc}`
  );
}

function fileExtensionFromPath(path: string): string | null {
  const lastSegment = path.split("/").pop() ?? "";
  const match = /\.([a-z0-9]+)$/i.exec(lastSegment);
  return match?.[1]?.toLowerCase() ?? null;
}

function contentTypeForExtension(extension: string): string {
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}

type SupportTicketOpenOptions = {
  concernText?: string;
  sourceMessageId?: number;
};

async function deleteCallbackMessage(chatId: number, callback: TelegramCallbackQuery): Promise<void> {
  const messageId = callback.message?.message_id;
  if (messageId) await deleteMessage(chatId, messageId);
}

async function createSupportTicketWithCode(
  db: SupabaseRestClient,
  payload: Omit<SupportTicket, "id" | "created_at" | "updated_at" | "ticket_code">
): Promise<SupportTicket> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await createSupportTicket(db, { ...payload, ticket_code: buildTicketCode() });
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.toLowerCase().includes("duplicate")) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function removePreviousTicketBotPrompts(
  db: SupabaseRestClient,
  ticket: SupportTicket,
  chatId: number,
  options: { exceptMessageId?: number } = {}
): Promise<void> {
  const botMessages = await listRecentBotSupportTicketMessages(db, ticket.id);
  const deletedMessageIds = new Set<number>();

  for (const botMessage of botMessages) {
    if (botMessage.telegram_chat_id !== chatId) continue;
    if (botMessage.telegram_message_id === options.exceptMessageId) continue;
    if (deletedMessageIds.has(botMessage.telegram_message_id)) continue;

    deletedMessageIds.add(botMessage.telegram_message_id);
    await deleteMessage(chatId, botMessage.telegram_message_id);
  }
}

async function recordCustomerTicketFollowUp(
  db: SupabaseRestClient,
  ticket: SupportTicket,
  message: TelegramMessage,
  user: TelegramUser
): Promise<void> {
  const messageDate = message.date ? new Date(message.date * 1000) : new Date();
  const attachments = await saveSupportTicketAttachments(db, ticket.id, message);
  await recordSupportTicketMessage(db, {
    ticket_id: ticket.id,
    telegram_chat_id: message.chat.id,
    telegram_message_id: message.message_id,
    reply_to_message_id: message.reply_to_message?.message_id ?? null,
    telegram_user_id: user.id,
    sender_name: ticket.opened_by_name || getTelegramUserDisplayName(user),
    sender_type: "customer",
    message_text: supportMessageText(message),
    attachments,
    message_date_utc: messageDate.toISOString()
  });

  await recordSupportTicketEvent(db, {
    ticket_id: ticket.id,
    event_type: "customer_follow_up",
    actor_telegram_user_id: user.id,
    actor_name: ticket.opened_by_name || getTelegramUserDisplayName(user),
    actor_type: "customer",
    telegram_chat_id: message.chat.id,
    telegram_message_id: message.message_id,
    metadata: { ticketCode: ticket.ticket_code, attachments }
  });

  let currentTicket = ticket;
  if (ticket.status === "pending_follow_up") {
    currentTicket = await updateSupportTicket(db, ticket.id, {
      status: ticket.assigned_member_id ? "accepted" : "open",
      resolution_requested_at: null,
      pending_follow_up_at: null
    });

    await recordSupportTicketEvent(db, {
      ticket_id: ticket.id,
      event_type: "ticket_reopened_by_customer",
      actor_telegram_user_id: user.id,
      actor_name: ticket.opened_by_name || getTelegramUserDisplayName(user),
      actor_type: "customer",
      telegram_chat_id: message.chat.id,
      telegram_message_id: message.message_id,
      metadata: { previousStatus: ticket.status, reopenedStatus: currentTicket.status }
    });
  }

  await removePreviousTicketBotPrompts(db, currentTicket, message.chat.id);
  await notifyTeamMembersOfSupportMessage(db, currentTicket, supportMessageText(message));
}
function isTeamInboxTargetChat(chatId: number): boolean {
  try {
    if (getStatsGroupChatIds().includes(chatId)) return true;
  } catch (error) {
    console.error("Invalid TEAM_STATS_GROUP_CHAT_IDS in team inbox target check", error);
  }
  try {
    return getTeamGroupChatId() === chatId;
  } catch (error) {
    console.error("Invalid TEAM_GROUP_CHAT_ID in team inbox target check", error);
    return false;
  }
}

// TEMPORARY: only whitelisted members receive team inbox forwards. Set to
// [] (or remove the filter) to notify every registered team member again..
const TEAM_INBOX_RECIPIENT_MEMBER_IDS: string[] = ["betz"];

type TeamMemberPreview = { id: string; name: string };

function findTicketPrimaryMember(ticket: SupportTicket): TeamMemberPreview | null {
  if (ticket.scheduled_member_id && ticket.scheduled_member_name) {
    return { id: ticket.scheduled_member_id, name: ticket.scheduled_member_name };
  }
  const member = findScheduledMemberAt(new Date(ticket.created_at));
  return member ? { id: member.id, name: member.name } : null;
}

async function getTicketPrimaryMember(db: SupabaseRestClient, ticket: SupportTicket): Promise<TeamMemberPreview | null> {
  const scheduled = findTicketPrimaryMember(ticket);
  if (scheduled) return scheduled;

  if (ticket.assigned_member_id && ticket.assigned_member_name) {

    return { id: ticket.assigned_member_id, name: ticket.assigned_member_name };
  }

  const registration = await findRegistrationByMemberId(db, ticket.assigned_member_id ?? "");
  if (registration && registration.member_id && registration.member_name) {

    return { id: registration.member_id, name: registration.member_name };
  }

  return null;
}

async function isPrimaryTimedIn(db: SupabaseRestClient, member: TeamMemberPreview): Promise<boolean> {
  const registration = await findRegistrationByMemberId(db, member.id);
  if (!registration) return false;
  return isRegistrationTimedIn(db, registration, { id: member.id, name: member.name } as TeamMember);
}

async function notifyTeamMembersOfSupportMessage(
  db: SupabaseRestClient,
  ticket: SupportTicket,
  followUpText?: string,
  replyUpdate?: { replierName: string; replyText: string; badge?: string }
): Promise<void> {
  if (!isTeamInboxEnabled()) return;
  if (!isTeamInboxTargetChat(ticket.telegram_chat_id)) return;

  const registrations = await listRegistrations(db);
  const recipients = TEAM_INBOX_RECIPIENT_MEMBER_IDS.length > 0
    ? registrations.filter((registration) => TEAM_INBOX_RECIPIENT_MEMBER_IDS.includes(registration.member_id))
    : registrations;
  const latestCustomerMessage = await findLatestCustomerSupportTicketMessage(db, ticket.id);
  const sourceCustomerMessageId = latestCustomerMessage?.telegram_message_id ?? ticket.opened_message_id;

  if (replyUpdate) {
    const dms = await listTeamInboxDmsByTicket(db, ticket.id);
    for (const memberRegistration of recipients) {
      const dmChatId = memberRegistration.telegram_chat_id ?? memberRegistration.telegram_user_id;
      const existingDm = dms.find((dm) => dm.dm_chat_id === dmChatId && dm.member_id === memberRegistration.member_id);
      if (!existingDm) continue;

      const badgeNote = replyUpdate.badge
        ? ` — [🛟 Temporary Assistant · covering ${escapeHtmlForMention(replyUpdate.badge)}]`
        : "";
      const baseNote = `\n\nGroup: ${escapeHtmlForMention(ticket.group_title ?? String(ticket.telegram_chat_id))}`;
      const updatedText = `💬 <b>${escapeHtmlForMention(replyUpdate.replierName)} replied:</b>\n“${escapeHtmlForMention(truncateMessage(replyUpdate.replyText, 200))}”${baseNote}${badgeNote}`;

      try {
        await editMessageText(
          dmChatId,
          existingDm.dm_message_id,
          updatedText,
          {
            parseMode: "HTML",
            replyMarkup: supportReplyKeyboard(ticket.id, existingDm.source_telegram_message_id ?? sourceCustomerMessageId)
          }
        );
      } catch (error) {
        console.warn(
          `Could not update DM for ${memberRegistration.member_name} (${dmChatId}) about reply on ticket ${ticket.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return;
  }

  const primaryMember = await getTicketPrimaryMember(db, ticket);
  const primaryTimedIn = primaryMember ? await isPrimaryTimedIn(db, primaryMember) : false;
  const now = new Date();
  const graceEndMs = new Date(ticket.created_at).getTime() + TEAM_INBOX_PRIMARY_GRACE_MINUTES * 60 * 1000;
  // The scheduled responder gets the full grace period even when they have not
  // timed in yet. Attendance is not a substitute for giving that responder the
  // first opportunity to answer a newly opened customer request.
  const canTemporaryAssist = !primaryMember || now.getTime() > graceEndMs;

  const header = followUpText
    ? `📩 <b>New follow-up from ${escapeHtmlForMention(ticket.opened_by_name)}</b>\n\n`
    : `📩 <b>New support message from ${escapeHtmlForMention(ticket.opened_by_name)}</b>\n\n`;
  const eligibilityNote =
    !primaryMember
      ? ""
      : canTemporaryAssist
        ? `\n\n🛟 Temporary assistant window is open — ${escapeHtmlForMention(primaryMember.name)} has not replied within ${TEAM_INBOX_PRIMARY_GRACE_MINUTES} minutes.`
        : `\n\n⏳ ${escapeHtmlForMention(primaryMember.name)} is the scheduled responder for this ticket.You can reply as temporary assistant after ${TEAM_INBOX_PRIMARY_GRACE_MINUTES} minutes.`;
  const messageText = followUpText ?? ticket.opened_message_text;
  const notificationPrefix =
    header +
    `Group: ${escapeHtmlForMention(ticket.group_title ?? String(ticket.telegram_chat_id))}\n`;

  for (const memberRegistration of recipients) {
    const dmChatId = memberRegistration.telegram_chat_id ?? memberRegistration.telegram_user_id;
    try {
      const sent = await sendCompleteTeamInboxMessage(
        dmChatId,
        notificationPrefix,
        messageText,
        eligibilityNote,
        supportReplyKeyboard(ticket.id, sourceCustomerMessageId)
      );
      await upsertTeamInboxDm(db, {
        ticket_id: ticket.id,
        member_id: memberRegistration.member_id,
        member_name: memberRegistration.member_name,
        telegram_user_id: memberRegistration.telegram_user_id,
        dm_chat_id: dmChatId,
        dm_message_id: sent.message_id,
        source_telegram_message_id: sourceCustomerMessageId
      });
    } catch (error) {
      console.warn(
        `Could not notify ${memberRegistration.member_name} (${dmChatId}) about support ticket ${ticket.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

async function pushTeamInboxUpdate(
  db: SupabaseRestClient,
  options: {
    registration: Registration;
    dmChatId: number;
    ticket: SupportTicket;
    existingDm: { dm_message_id: number; source_telegram_message_id?: number | null };
    text: string;
    reply?: { replierName: string; replyText: string; badge?: string }
  }
): Promise<void> {
  const { registration, dmChatId, ticket, existingDm, text, reply } = options;
 
  const attachmentNote = reply ? `\n\n💬 <b>${escapeHtmlForMention(reply.replierName)} replied:</b>\n“${escapeHtmlForMention(truncateMessage(reply.replyText, 200))}”` : "";
  const badgeNote = reply?.badge ? ` — [🛟 Temporary Assistant · covering ${escapeHtmlForMention(reply.badge)}]` : "";
 

  try {
    await editMessageText(
      dmChatId,
      existingDm.dm_message_id,

      `${text}${attachmentNote}${badgeNote}`,
      {
        parseMode: "HTML",
        replyMarkup: supportReplyKeyboard(ticket.id, existingDm.source_telegram_message_id ?? ticket.opened_message_id)
      }
    );
  } catch (error) {
    console.warn(
      `Could not update team inbox DM for ${registration.member_name} (${dmChatId}) on ticket ${ticket.id}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function truncateMessage(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

/**
 * Sends every character of a customer message to the team inbox. Telegram limits
 * a single message to 4096 characters, so long source messages are continued in
 * additional DMs rather than being shortened to a preview.
 */
async function sendCompleteTeamInboxMessage(
  chatId: number,
  prefix: string,
  messageText: string,
  suffix: string,
  replyMarkup: ReturnType<typeof supportReplyKeyboard>
): Promise<SentTelegramMessage> {
  const firstMessagePrefix = `${prefix}Message: “`;
  const continuationPrefix = "Message (continued): “";
  const closingQuote = "”";
  const chunks = splitTelegramText(messageText, firstMessagePrefix.length + closingQuote.length + suffix.length, continuationPrefix.length + closingQuote.length);

  let firstSent: SentTelegramMessage | null = null;
  for (const [index, chunk] of chunks.entries()) {
    const isFirst = index === 0;
    const isLast = index === chunks.length - 1;
    const text =
      `${isFirst ? firstMessagePrefix : continuationPrefix}${escapeHtmlForMention(chunk)}${closingQuote}` +
      (isLast ? suffix : "");
    const sent = await sendMessage(chatId, text, {
      parseMode: "HTML",
      ...(isFirst ? { replyMarkup } : {})
    });
    if (isFirst) firstSent = sent;
  }

  if (!firstSent) throw new Error("Team inbox notification did not produce a message.");
  return firstSent;
}

function splitTelegramText(text: string, firstMessageOverhead: number, continuationMessageOverhead: number): string[] {
  const firstChunkLength = TELEGRAM_MESSAGE_MAX_LENGTH - firstMessageOverhead;
  const continuationChunkLength = TELEGRAM_MESSAGE_MAX_LENGTH - continuationMessageOverhead;
  if (firstChunkLength < 1 || continuationChunkLength < 1) {
    throw new Error("Team inbox notification header is too long for Telegram.");
  }

  const characters = Array.from(text);
  if (characters.length === 0) return [""];

  const chunks: string[] = [];
  let offset = 0;
  let chunkLength = firstChunkLength;
  while (offset < characters.length) {
    chunks.push(characters.slice(offset, offset + chunkLength).join(""));
    offset += chunkLength;
    chunkLength = continuationChunkLength;
  }
  return chunks;
}

async function getReplyEligibility(
  db: SupabaseRestClient,
  registration: Registration,
  ticket: SupportTicket
): Promise<{ allowed: boolean; primary: boolean; temporaryAssist: boolean; primaryMember: TeamMemberPreview | null; primaryTimedIn: boolean; reason?: string }> {
  const primaryMember = await getTicketPrimaryMember(db, ticket);
  const primaryTimedIn = primaryMember ? await isPrimaryTimedIn(db, primaryMember) : false;

  if (primaryMember) {
    const isPrimary = primaryMember.id === registration.member_id;

    if (isPrimary) {
      return { allowed: true, primary: true, temporaryAssist: false, primaryMember, primaryTimedIn };
    }

    const now = new Date();
    const graceEndMs = new Date(ticket.created_at).getTime() + TEAM_INBOX_PRIMARY_GRACE_MINUTES * 60 * 1000;
    if (now.getTime() <= graceEndMs) {

      return {
        allowed: false,
        primary: false,
        temporaryAssist: false,
        primaryMember,
        primaryTimedIn,
        reason: `⏳ ${escapeHtmlForMention(primaryMember.name)} is the scheduled responder for this ticket.You can reply as temporary assistant after ${TEAM_INBOX_PRIMARY_GRACE_MINUTES} minutes.`
      };
    }

    return { allowed: true, primary: false, temporaryAssist: true, primaryMember, primaryTimedIn };
  }

  if (ticket.assigned_member_id && ticket.assigned_member_id !== registration.member_id) {
    return {
      allowed: false,
      primary: false,
      temporaryAssist: false,
      primaryMember,
      primaryTimedIn,
      reason: `Si ${escapeHtmlForMention(ticket.assigned_member_name ?? ticket.assigned_member_id)} na ang humahawak ng ticket na ito.`
    };
  }

  return { allowed: true, primary: false, temporaryAssist: false, primaryMember, primaryTimedIn };
}
 
async function handleSupportReplyCallback(
  db: SupabaseRestClient,
  callback: TelegramCallbackQuery,
  chatId: number,
  messageId: number
): Promise<void> {
  const [, , ticketId, sourceMessageIdValue] = callback.data?.split(":") ?? [];
  const sourceMessageId = Number(sourceMessageIdValue);
  if (!ticketId) {
    await answerCallbackQuery(callback.id);
    return;
  }
 
  const ticket = await findSupportTicketById(db, ticketId);
   if (!ticket || isTicketClosed(ticket)) {
      await answerCallbackQuery(
        callback.id,
        ticket ? "This support ticket is already closed." : "Support ticket not found.",
        { showAlert: true }
      );
      return;
    } 
  const registration = await findRegistrationByUser(db, callback.from.id);
   if (!registration) {
     await answerCallbackQuery(callback.id, "Only registered team members can reply to support messages.", { showAlert: true });
     return;
   }
 
  const eligibility = await getReplyEligibility(db, registration, ticket);
   if (!eligibility.allowed) {
     await answerCallbackQuery(callback.id, eligibility.reason ?? "You can't reply to this ticket yet.", { showAlert: true });
     return;
   }
 
   await answerCallbackQuery(callback.id, "Type your reply below.The bot will post it in the group with your name signature.");
 
   const groupTitle = ticket.group_title ?? String(ticket.telegram_chat_id);
   const customerName = ticket.opened_by_name;
   // Buttons sent before source message IDs were added cannot identify their
   // original customer message, so retain the previous latest-message fallback.
   const replyToMessageId = Number.isSafeInteger(sourceMessageId)
     ? sourceMessageId
     : (await findLatestCustomerSupportTicketMessage(db, ticket.id))?.telegram_message_id ?? ticket.opened_message_id;
 
   await setConversationState(db, callback.from.id, "awaiting_support_reply", {
     ticketId: ticket.id,
     telegramChatId: ticket.telegram_chat_id,
     chatTitle: groupTitle,
     customerName,
     replyToMessageId,
     primary: eligibility.primary || false,
     temporaryAssist: eligibility.temporaryAssist || false
   });
 
   await editMessageText(
     chatId,
     messageId,
     `📩 Replying to ${customerName}'s selected message in ${groupTitle}.\n\nType your reply or send a photo below. The bot will post it as a reply to that selected customer message in the group with your name signature.`,
     { replyMarkup: homeKeyboard() }
   );
 }
 
 async function handleSupportReplyMessage(
   db: SupabaseRestClient,
   message: TelegramMessage,
   registration: Registration,
   payload: Record<string, unknown>
 ): Promise<void> {
   const ticketId = String(payload.ticketId ?? "");
   const chatId = Number(payload.telegramChatId ?? NaN);
   const ticket = ticketId ? await findSupportTicketById(db, ticketId) : null;
   if (!ticket || isTicketClosed(ticket) || !Number.isSafeInteger(chatId)) {
     await clearConversationState(db, registration.telegram_user_id);
     await sendMessage(
       message.chat.id,
       "This support ticket is no longer active,so the reply was not posted in the group.",
       { replyMarkup: dashboardKeyboard() }
     );
     return;
   }

   const replyText = message.text?.trim() || message.caption?.trim() || "";
   const hasPhoto = Boolean(message.photo?.length);
   if (!replyText && !hasPhoto) {
     await sendMessage(
       message.chat.id,
       "Please send a text reply or a photo for the support conversation.",
       { replyMarkup: homeKeyboard() }
     );
     return;
   }

   const eligibility = await getReplyEligibility(db, registration, ticket);
   if (!eligibility.allowed) {
     await sendMessage(
       message.chat.id,
       eligibility.reason ?? "You can't reply to this ticket yet.",
       { replyMarkup: homeKeyboard() }
     );
     return;
   }

   await clearConversationState(db, registration.telegram_user_id);

   const messageDate = message.date ? new Date(message.date * 1000) : new Date();
   const supportMention = buildSupportMention(registration, eligibility);

   const reply = await postSupportReplyAsBot(
     db,
     ticket,
     registration,
     {
       chatId,
       text: replyText,
       mention: supportMention,
       sentAt: messageDate,
       replyToMessageId: Number(payload.replyToMessageId),
       sourceChatId: message.chat.id,
       sourceMessageId: message.message_id,
       hasPhoto,
       badge: eligibility.temporaryAssist ? eligibility.primaryMember?.name : undefined
     }
   );

   if (!reply) {
     await sendMessage(
       message.chat.id,
       "I couldn't post the reply in the group.Please try again later.",
       { replyMarkup: dashboardKeyboard() }
     );
     return;
   }

  await sendMessage(
    message.chat.id,
    hasPhoto
      ? "✅ Your photo reply was posted in the group with your name signature."
      : "✅ Your reply was posted in the group with your name signature.",
     { replyMarkup: dashboardKeyboard() }
   );
 }

function buildSupportMention(registration: Registration, eligibility?: { temporaryAssist: boolean; primaryMember: TeamMemberPreview | null }): string {
   const displayName = escapeHtmlForMention(registration.member_name);
   const mention = registration.telegram_username?.trim()
     ? `@${escapeHtmlForMention(registration.telegram_username.trim())} (<a href="tg://user?id=${registration.telegram_user_id}">${displayName}</a>)`
     : `<a href="tg://user?id=${registration.telegram_user_id}">${displayName}</a>`;
   const badge = eligibility?.temporaryAssist && eligibility.primaryMember?.name
     ? ` [🛟 Temporary Assistant · covering ${escapeHtmlForMention(eligibility.primaryMember.name)}]`
     : "";
   return mention + badge;
 
 }

async function postSupportReplyAsBot(
  db: SupabaseRestClient,
  ticket: SupportTicket,
  registration: Registration,
  input: {
    chatId: number;

    text: string;
    mention: string;
    sentAt: Date;
    replyToMessageId: number;
    sourceChatId: number;
    sourceMessageId: number;
    hasPhoto: boolean;
    badge?: string
  }
): Promise<SentTelegramMessage | null> {

  const replyBody = `📩 ${escapeHtmlForMention(input.text)}\n\n— ${input.mention}`;
  const replyToMessageId = Number.isSafeInteger(input.replyToMessageId)
    ? input.replyToMessageId
    : ticket.opened_message_id;

  try {
    const sent = input.hasPhoto
      ? await copyMessage(input.chatId, input.sourceChatId, input.sourceMessageId, {
          caption: replyBody,
          parseMode: "HTML",
          replyToMessageId
        })
      : await sendMessage(input.chatId, replyBody, {
          parseMode: "HTML",
          replyToMessageId
        });

    await recordSupportTicketMessage(db, {
      ticket_id: ticket.id,
      telegram_chat_id: input.chatId,
      telegram_message_id: sent.message_id,
      reply_to_message_id: replyToMessageId,
      telegram_user_id: registration.telegram_user_id,
      sender_name: registration.member_name,
      sender_type: "team_member",
      message_text: replyBody,
      message_date_utc: input.sentAt.toISOString()
    });

    await recordSupportTicketEvent(db, {
      ticket_id: ticket.id,
      event_type: "support_reply_posted",
      actor_telegram_user_id: registration.telegram_user_id,
      actor_name: registration.member_name,
      actor_type: "team_member",
      telegram_chat_id: input.chatId,
      telegram_message_id: sent.message_id,
      metadata: { replyText: input.text, repliedToMessageId: replyToMessageId }
    });

    if (!ticket.assigned_member_id) {
      try {
        await connectTicketToTeamMember(db, ticket, registration, {
          chatId: input.chatId,
          telegramMessageId: sent.message_id,
          replyToMessageId,
          eventType: "ticket_accepted"
        });
      } catch (connectError) {
        console.warn(`Could not connect support reply to team member: ${connectError instanceof Error ? connectError.message : String(connectError)}`);
      }
    }

    try {
      await notifyTeamMembersOfSupportMessage(db, ticket, undefined, {
        replierName: registration.member_name,
        replyText: input.text,
        badge: input.badge
      });
    } catch (broadcastError) {
      console.warn(`Could not broadcast support reply update for ticket ${ticket.id}: ${broadcastError instanceof Error ? broadcastError.message : String(broadcastError)}`);
    }

    return sent;
  } catch (error) {
    console.error(`Failed to post support reply for ticket ${ticket.id}and chat ${input.chatId}:`, error);
    return null;
  }
}

type Saver = Pick<Registration, "telegram_user_id" | "member_id" | "member_name">;

async function isUserChatAdmin(chatId: number, userId: number): Promise<boolean> {
  const chatMember = await getChatMember(chatId, userId);
  if (!chatMember) return false;
  return chatMember.status === "creator" || chatMember.status === "administrator";
}

async function runSaveCommandSafely(
  db: SupabaseRestClient,
  message: TelegramMessage,
  saver: Saver
): Promise<void> {
  try {
    await handleSaveCommand(db, message, saver);
  } catch (error) {
    console.error(
      `handleSaveCommand failed for user ${saver.telegram_user_id} in chat ${message.chat.id}:`,
      error
    );
    try {
      await sendMessage(
        message.chat.id,
        "I couldn't save that just now. Please try again in a moment, or reply /save <name> to a post you sent.",
        { replyToMessageId: message.message_id }
      );
    } catch (sendError) {
      console.error(`Failed to send /save error message in chat ${message.chat.id}:`, sendError);
    }
  }
}

async function runSavedCommandPlaybackSafely(
  db: SupabaseRestClient,
  message: TelegramMessage,
  saver: Saver
): Promise<boolean> {
  try {
    return await handleSavedCommandPlayback(db, message, saver);
  } catch (error) {
    console.error(
      `handleSavedCommandPlayback failed for user ${saver.telegram_user_id} in chat ${message.chat.id}:`,
      error
    );
    return true;
  }
}

async function handleSaveCommand(
  db: SupabaseRestClient,
  message: TelegramMessage,
  saver: Saver
): Promise<void> {
  const commandName = getSaveCommandName(message);
  if (!commandName) {
    await sendMessage(
      message.chat.id,
      "Please use /save with a valid command name, like /save tutorial. Use letters, numbers, and underscores only.",
      { replyToMessageId: message.message_id }
    );
    return;
  }

  const sourceMessage = message.reply_to_message;
  if (!sourceMessage) {
    await sendMessage(message.chat.id, `Please reply /save ${commandName} to the post you want to save.`, {
      replyToMessageId: message.message_id
    });
    return;
  }

  if (!sourceMessage.from || sourceMessage.from.id !== saver.telegram_user_id) {
    await sendMessage(message.chat.id, "You can only save posts that you originally sent.", {
      replyToMessageId: message.message_id
    });
    return;
  }

  await upsertSavedCommand(db, {
    owner_telegram_user_id: saver.telegram_user_id,
    owner_member_id: saver.member_id,
    owner_member_name: saver.member_name,
    command_name: commandName,
    source_chat_id: sourceMessage.chat.id,
    source_message_id: sourceMessage.message_id,
    source_message_text: getMessagePreview(sourceMessage)
  });

  await sendMessage(message.chat.id, `This is now saved! Use /${commandName} to show it again.`, {
    replyToMessageId: message.message_id
  });
}

async function handleSavedCommandPlayback(
  db: SupabaseRestClient,
  message: TelegramMessage,
  saver: Saver
): Promise<boolean> {
  const commandName = getDynamicSavedCommandName(message);
  if (!commandName) return false;

  const savedCommand = await findSavedCommandForTeam(db, commandName, saver.telegram_user_id);
  if (!savedCommand) {
    const firstToken = message.text?.trim().split(/\s+/, 1)[0] ?? "";
    if (hasBotMention(firstToken)) return false;

    console.info(
      `Ignoring unknown group command /${commandName} from saver ${saver.member_id} (Telegram user ${saver.telegram_user_id}) in chat ${message.chat.id}. No frontend response will be sent.`
    );
    return true;
  }

  await sendMessage(message.chat.id, `This is from ${savedCommand.owner_member_name}! Here’s saved ${commandName} 👇`, {
    replyToMessageId: message.message_id
  });

  try {
    await copyMessage(message.chat.id, savedCommand.source_chat_id, savedCommand.source_message_id);
  } catch (error) {
    console.error(`Failed to copy saved command /${commandName}`, error);
    await sendMessage(
      message.chat.id,
      `I found /${commandName}, but I could not repost the original message. It may have been deleted or is no longer available.`,
      { replyToMessageId: message.message_id }
    );
  }

  return true;
}

async function recordTeamTicketReplyIfReferenced(
  db: SupabaseRestClient,
  message: TelegramMessage,
  registration: Registration
): Promise<void> {
  const replyToMessageId = message.reply_to_message?.message_id;
  if (!replyToMessageId) return;

  const ticket = await findActiveSupportTicketByMessageReference(db, message.chat.id, replyToMessageId);
  if (!ticket) return;

  const messageDate = message.date ? new Date(message.date * 1000) : new Date();
  const attachments = await saveSupportTicketAttachments(db, ticket.id, message);
  await recordSupportTicketMessage(db, {
    ticket_id: ticket.id,
    telegram_chat_id: message.chat.id,
    telegram_message_id: message.message_id,
    reply_to_message_id: replyToMessageId,
    telegram_user_id: registration.telegram_user_id,
    sender_name: registration.member_name,
    sender_type: "team_member",
    message_text: supportMessageText(message),
    attachments,
    message_date_utc: messageDate.toISOString()
  });

  if (shouldConnectReplyToTeamMember(ticket, registration)) {
    const member = getTeamMember(registration.member_id);
    if (!member) return;

    await connectTicketToTeamMember(db, ticket, registration, {
      chatId: message.chat.id,
      telegramMessageId: message.message_id,
      replyToMessageId: ticket.opened_message_id,
      eventType: ticket.status === "open" ? "ticket_accepted" : "ticket_handler_reassigned"
    });
  }
}

function getTicketScheduledMember(ticket: SupportTicket): Pick<TeamMember, "id" | "name"> | null {
  if (ticket.scheduled_member_id && ticket.scheduled_member_name) {
    return { id: ticket.scheduled_member_id, name: ticket.scheduled_member_name };
  }
  return findScheduledMemberAt(new Date(ticket.created_at));
}

function shouldConnectReplyToTeamMember(ticket: SupportTicket, registration: Registration): boolean {
  if (isTicketClosed(ticket) || ticket.status === "pending_user_resolution") return false;
  if (!ticket.assigned_member_id) return true;
  return ticket.assigned_member_id !== registration.member_id;
}

type TicketConnectionOptions = {
  chatId: number;
  telegramMessageId: number | null;
  replyToMessageId: number;
  eventType?: "ticket_accepted" | "ticket_handler_reassigned";
};

async function connectTicketToTeamMember(
  db: SupabaseRestClient,
  ticket: SupportTicket,
  registration: Registration,
  options: TicketConnectionOptions
): Promise<SupportTicket> {
  const member = getTeamMember(registration.member_id);
  if (!member) return ticket;

  const acceptedAt = new Date();
  const now = acceptedAt.toISOString();
  const wasTimedIn = await isRegistrationTimedIn(db, registration, member);
  const acceptedDuringOwnShift = isMemberScheduledAt(member, acceptedAt);
  const scheduledMember = getTicketScheduledMember(ticket);
  const coveredForMember = scheduledMember && scheduledMember.id !== registration.member_id ? scheduledMember : null;
  const eventType = options.eventType ?? "ticket_accepted";

  const updatedTicket = await updateSupportTicket(db, ticket.id, {
    status: "accepted",
    assigned_member_id: registration.member_id,
    assigned_member_name: registration.member_name,
    scheduled_member_id: scheduledMember?.id ?? null,
    scheduled_member_name: scheduledMember?.name ?? null,
    accepted_by_telegram_user_id: registration.telegram_user_id,
    accepted_member_was_timed_in: wasTimedIn,
    accepted_during_own_shift: acceptedDuringOwnShift,
    covered_for_member_id: coveredForMember?.id ?? null,
    covered_for_member_name: coveredForMember?.name ?? null,
    accepted_at: now
  });

  await recordSupportTicketEvent(db, {
    ticket_id: ticket.id,
    event_type: eventType,
    actor_telegram_user_id: registration.telegram_user_id,
    actor_name: registration.member_name,
    actor_type: "team_member",
    telegram_chat_id: options.chatId,
    telegram_message_id: options.telegramMessageId,
    metadata: {
      memberId: registration.member_id,
      acceptedMemberWasTimedIn: wasTimedIn,
      acceptedDuringOwnShift,
      scheduledMemberId: scheduledMember?.id ?? null,
      scheduledMemberName: scheduledMember?.name ?? null,
      coveredForMemberId: coveredForMember?.id ?? null,
      coveredForMemberName: coveredForMember?.name ?? null
    }
  });

  if (coveredForMember || !wasTimedIn || !acceptedDuringOwnShift) {
    await recordSupportTicketEvent(db, {
      ticket_id: ticket.id,
      event_type: "ticket_coverage_logged",
      actor_telegram_user_id: registration.telegram_user_id,
      actor_name: registration.member_name,
      actor_type: "team_member",
      telegram_chat_id: options.chatId,
      telegram_message_id: options.telegramMessageId,
      metadata: {
        acceptedMemberWasTimedIn: wasTimedIn,
        acceptedDuringOwnShift,
        scheduledMemberId: scheduledMember?.id ?? null,
        scheduledMemberName: scheduledMember?.name ?? null,
        coveredForMemberId: coveredForMember?.id ?? null,
        coveredForMemberName: coveredForMember?.name ?? null
      }
    });
  }

  await removePreviousTicketBotPrompts(db, updatedTicket, options.chatId);
  return updatedTicket;
}

async function openSupportTicket(
  db: SupabaseRestClient,
  message: TelegramMessage,
  user: TelegramUser,
  options: SupportTicketOpenOptions = {}
): Promise<void> {
  await rememberTelegramGroup(db, message.chat);

  const openedByName = getTelegramUserDisplayName(user);
  const messageDate = message.date ? new Date(message.date * 1000) : new Date();
  const scheduledMember = findScheduledMemberAt(messageDate);
  const scheduledRegistration = scheduledMember ? await findRegistrationByMemberId(db, scheduledMember.id) : null;
  const scheduledMemberIsActive = scheduledMember && scheduledRegistration
    ? await isRegistrationTimedIn(db, scheduledRegistration, scheduledMember)
    : false;
  const sourceMessageId = options.sourceMessageId ?? message.message_id;
  const concernText = options.concernText ?? supportMessageText(message);
  const acceptedAt = scheduledMemberIsActive ? new Date().toISOString() : null;
  const ticket = await createSupportTicketWithCode(db, {
    telegram_chat_id: message.chat.id,
    group_title: message.chat.title ?? null,
    opened_by_telegram_user_id: user.id,
    opened_by_name: openedByName,
    opened_message_id: sourceMessageId,
    opened_message_text: concernText,
    status: scheduledMemberIsActive ? "accepted" : "open",
    assigned_member_id: scheduledMemberIsActive ? scheduledMember?.id ?? null : null,
    assigned_member_name: scheduledMemberIsActive ? scheduledMember?.name ?? null : null,
    scheduled_member_id: scheduledMember?.id ?? null,
    scheduled_member_name: scheduledMember?.name ?? null,
    accepted_by_telegram_user_id: scheduledMemberIsActive ? scheduledRegistration?.telegram_user_id ?? null : null,
    accepted_member_was_timed_in: scheduledMemberIsActive ? true : null,
    accepted_during_own_shift: scheduledMemberIsActive && scheduledMember ? isMemberScheduledAt(scheduledMember, messageDate) : null,
    covered_for_member_id: null,
    covered_for_member_name: null,
    accepted_at: acceptedAt,
    resolution_requested_at: null,
    resolved_by_telegram_user_id: null,
    resolution: null,
    resolved_at: null,
    pending_follow_up_at: null,
    closed_at: null
  });

  const attachments = await saveSupportTicketAttachments(db, ticket.id, message);

  await recordSupportTicketMessage(db, {
    ticket_id: ticket.id,
    telegram_chat_id: message.chat.id,
    telegram_message_id: sourceMessageId,
    reply_to_message_id: message.reply_to_message?.message_id ?? null,
    telegram_user_id: user.id,
    sender_name: openedByName,
    sender_type: "customer",
    message_text: concernText,
    attachments,
    message_date_utc: messageDate.toISOString()
  });

  await recordSupportTicketEvent(db, {
    ticket_id: ticket.id,
    event_type: "ticket_opened",
    actor_telegram_user_id: user.id,
    actor_name: openedByName,
    actor_type: "customer",
    telegram_chat_id: message.chat.id,
    telegram_message_id: sourceMessageId,
    metadata: { groupTitle: message.chat.title ?? null, concern: concernText, attachments }
  });

  await notifyTeamMembersOfSupportMessage(db, ticket);
}


const AI_SUPPORT_TICKET_PREFIX = "[AI Support]";
function isAiSupportTicket(ticket: SupportTicket): boolean {
  return ticket.opened_message_text.startsWith(AI_SUPPORT_TICKET_PREFIX);
}

function aiSupportConcernText(originalText: string, match: AiSupportMatch): string {
  return `${AI_SUPPORT_TICKET_PREFIX}\nCategory: ${match.category}\nDashboard status: ${match.defaultDashboardStatus}\nOriginal question: ${originalText}`;
}

function aiSupportMetadata(match: AiSupportMatch, dashboardStatus?: AiSupportDashboardStatus): Record<string, unknown> {
  return {
    supportMode: "ai",
    aiFlow: true,
    category: match.category,
    dashboardStatus: dashboardStatus ?? match.defaultDashboardStatus,
    alwaysEscalate: match.alwaysEscalate,
    escalateIf: match.escalateIf,
    matchedKeywords: match.matchedKeywords
  };
}

async function handleAiSupportMessage(
  db: SupabaseRestClient,
  message: TelegramMessage,
  user: TelegramUser
): Promise<void> {
  await rememberTelegramGroup(db, message.chat);

  const openedByName = getTelegramUserDisplayName(user);
  const messageDate = message.date ? new Date(message.date * 1000) : new Date();
  const originalText = supportMessageText(message);
  const match = detectAiSupportTemplate(originalText, Boolean(message.photo?.length));
  const scheduledMember = findScheduledMemberAt(messageDate);
  const scheduledRegistration = scheduledMember ? await findRegistrationByMemberId(db, scheduledMember.id) : null;
  const scheduledMemberIsActive = scheduledMember && scheduledRegistration
    ? await isRegistrationTimedIn(db, scheduledRegistration, scheduledMember)
    : false;
  const acceptedAt = scheduledMemberIsActive ? new Date().toISOString() : null;
  const ticket = await createSupportTicketWithCode(db, {
    telegram_chat_id: message.chat.id,
    group_title: message.chat.title ?? null,
    opened_by_telegram_user_id: user.id,
    opened_by_name: openedByName,
    opened_message_id: message.message_id,
    opened_message_text: aiSupportConcernText(originalText, match),
    status: scheduledMemberIsActive ? "accepted" : "open",
    assigned_member_id: scheduledMemberIsActive ? scheduledMember?.id ?? null : null,
    assigned_member_name: scheduledMemberIsActive ? scheduledMember?.name ?? null : null,
    scheduled_member_id: scheduledMember?.id ?? null,
    scheduled_member_name: scheduledMember?.name ?? null,
    accepted_by_telegram_user_id: scheduledMemberIsActive ? scheduledRegistration?.telegram_user_id ?? null : null,
    accepted_member_was_timed_in: scheduledMemberIsActive ? true : null,
    accepted_during_own_shift: scheduledMemberIsActive && scheduledMember ? isMemberScheduledAt(scheduledMember, messageDate) : null,
    covered_for_member_id: null,
    covered_for_member_name: null,
    accepted_at: acceptedAt,
    resolution_requested_at: null,
    resolved_by_telegram_user_id: null,
    resolution: null,
    resolved_at: null,
    pending_follow_up_at: null,
    closed_at: null
  });

  const attachments = await saveSupportTicketAttachments(db, ticket.id, message);
  await recordSupportTicketMessage(db, {
    ticket_id: ticket.id,
    telegram_chat_id: message.chat.id,
    telegram_message_id: message.message_id,
    reply_to_message_id: message.reply_to_message?.message_id ?? null,
    telegram_user_id: user.id,
    sender_name: openedByName,
    sender_type: "customer",
    message_text: originalText,
    attachments,
    message_date_utc: messageDate.toISOString()
  });

  await recordSupportTicketEvent(db, {
    ticket_id: ticket.id,
    event_type: "ai_support_case_logged",
    actor_telegram_user_id: user.id,
    actor_name: openedByName,
    actor_type: "customer",
    telegram_chat_id: message.chat.id,
    telegram_message_id: message.message_id,
    metadata: { ...aiSupportMetadata(match), originalQuestion: originalText, attachments }
  });

  await notifyTeamMembersOfSupportMessage(db, ticket);
}

async function handleAiSupportTicketFollowUp(
  db: SupabaseRestClient,
  ticket: SupportTicket,
  message: TelegramMessage,
  user: TelegramUser
): Promise<void> {
  const match = detectAiSupportTemplate(supportMessageText(message), Boolean(message.photo?.length));
  if (ticket.status === "open" || ticket.status === "accepted") {
    await recordCustomerTicketFollowUp(db, ticket, message, user);
    return;
  }

  const messageDate = message.date ? new Date(message.date * 1000) : new Date();
  const attachments = await saveSupportTicketAttachments(db, ticket.id, message);
  await recordSupportTicketMessage(db, {
    ticket_id: ticket.id,
    telegram_chat_id: message.chat.id,
    telegram_message_id: message.message_id,
    reply_to_message_id: message.reply_to_message?.message_id ?? null,
    telegram_user_id: user.id,
    sender_name: ticket.opened_by_name || getTelegramUserDisplayName(user),
    sender_type: "customer",
    message_text: supportMessageText(message),
    attachments,
    message_date_utc: messageDate.toISOString()
  });

  const updatedTicket = await updateSupportTicket(db, ticket.id, {
    status: "open",
    resolution_requested_at: null
  });

  await recordSupportTicketEvent(db, {
    ticket_id: ticket.id,
    event_type: "ai_support_needs_moderator",
    actor_telegram_user_id: user.id,
    actor_name: ticket.opened_by_name || getTelegramUserDisplayName(user),
    actor_type: "customer",
    telegram_chat_id: message.chat.id,
    telegram_message_id: message.message_id,
    metadata: { ...aiSupportMetadata(match, "Needs Moderator Review"), reason: "customer_follow_up_after_auto_reply", attachments }
  });

  await removePreviousTicketBotPrompts(db, updatedTicket, message.chat.id);
  await notifyTeamMembersOfSupportMessage(db, updatedTicket, supportMessageText(message));
}

async function handleAiSupportCallback(db: SupabaseRestClient, callback: TelegramCallbackQuery): Promise<void> {
  const data = callback.data ?? "";
  const [, , ticketId] = data.split(":");
  const chatId = callback.message?.chat.id;

  if (!chatId || !ticketId) {
    await answerCallbackQuery(callback.id);
    return;
  }

  const ticket = await findSupportTicketById(db, ticketId);
  if (!ticket || !isAiSupportTicket(ticket)) {
    await answerCallbackQuery(callback.id, "AI support case not found.", { showAlert: true });
    return;
  }

  await answerCallbackQuery(callback.id, "AI resolution buttons are disabled; tickets auto-close after 1 hour without requester messages.", { showAlert: true });
  await deleteCallbackMessage(chatId, callback);
  await removePreviousTicketBotPrompts(db, ticket, chatId, { exceptMessageId: callback.message?.message_id });
}

async function handleTicketCallback(db: SupabaseRestClient, callback: TelegramCallbackQuery): Promise<void> {
  const data = callback.data ?? "";
  const [, action, ticketId] = data.split(":");
  const chatId = callback.message?.chat.id;

  if (!chatId || !ticketId) {
    await answerCallbackQuery(callback.id);
    return;
  }

  if (action === "acc") {
    await handleTicketAccept(db, callback, ticketId, chatId);
    return;
  }

  if (action === "res") {
    await answerCallbackQuery(callback.id, "Resolution prompts are disabled; tickets auto-close after 1 hour without requester messages.", { showAlert: true });
    await deleteCallbackMessage(chatId, callback);
    return;
  }

  if (action === "sol" || action === "nsol") {
    await answerCallbackQuery(callback.id, "Solved / Not Solved buttons are disabled; tickets auto-close after 1 hour without requester messages.", { showAlert: true });
    await deleteCallbackMessage(chatId, callback);
    return;
  }

  await answerCallbackQuery(callback.id);
}

async function handleTicketAccept(
  db: SupabaseRestClient,
  callback: TelegramCallbackQuery,
  ticketId: string,
  chatId: number
): Promise<void> {
  const ticket = await findSupportTicketById(db, ticketId);
  if (!ticket) {
    await answerCallbackQuery(callback.id, "Ticket not found.", { showAlert: true });
    return;
  }

  const registration = await findRegistrationByUser(db, callback.from.id);
  if (!registration) {
    await answerCallbackQuery(callback.id, "Only registered team members can accept tickets.", { showAlert: true });
    return;
  }

  const member = getTeamMember(registration.member_id);
  if (!member) {
    await answerCallbackQuery(callback.id, "Only registered team members can accept tickets.", { showAlert: true });
    return;
  }

  if (isTicketClosed(ticket)) {
    await answerCallbackQuery(callback.id, "This ticket is already closed.", { showAlert: true });
    await deleteCallbackMessage(chatId, callback);
    return;
  }

  if (ticket.status !== "open") {
    await answerCallbackQuery(callback.id, "This ticket is already assigned.", { showAlert: true });
    await deleteCallbackMessage(chatId, callback);
    return;
  }

  await answerCallbackQuery(callback.id, "Ticket accepted.");
  await deleteCallbackMessage(chatId, callback);
  await connectTicketToTeamMember(db, ticket, registration, {
    chatId,
    telegramMessageId: callback.message?.message_id ?? null,
    replyToMessageId: ticket.opened_message_id,
    eventType: "ticket_accepted"
  });

}

async function isRegistrationTimedIn(
  db: SupabaseRestClient,
  registration: Registration,
  member: TeamMember
): Promise<boolean> {
  const { window } = await getEffectiveShiftContext(db, member, new Date());
  const log = await findTimeLog(db, registration.member_id, window.workDateUtc);
  return Boolean(log?.actual_in_utc && !log.actual_out_utc);
}

function isMemberScheduledAt(member: TeamMember, at: Date): boolean {
  const todayWindow = getShiftWindowForDate(member, utcDateKey(at));
  const yesterdayWindow = getShiftWindowForDate(member, utcDateKey(new Date(at.getTime() - 24 * 60 * 60 * 1000)));
  return [todayWindow, yesterdayWindow].some((window) => at >= window.start && at < window.end);
}

function findScheduledMemberAt(at: Date): TeamMember | null {
  return TEAM_SCHEDULE.find((member) => isMemberScheduledAt(member, at)) ?? null;
}

const SWAP_POST_SHIFT_BUFFER_MS = 2 * 60 * 60 * 1000;
const SWAP_PRE_SHIFT_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

type ShiftWindow = ReturnType<typeof getShiftWindowForDate>;

type SwapInfo = {
  requestId: string;
  workDateUtc: string;
  role: "requester" | "target";
  counterpartMemberId: string;
  counterpartMemberName: string;
};

type ShiftContext = {
  window: ShiftWindow;
  swap: SwapInfo | null;
};

function buildSwapInfo(swap: { id: string; work_date_utc: string; requester_member_id: string; requester_member_name: string; target_member_id: string; target_member_name: string }, memberId: string): SwapInfo {
  const role: "requester" | "target" = swap.requester_member_id === memberId ? "requester" : "target";
  const counterpartMemberId = role === "requester" ? swap.target_member_id : swap.requester_member_id;
  const counterpartMemberName = role === "requester" ? swap.target_member_name : swap.requester_member_name;
  return {
    requestId: swap.id,
    workDateUtc: swap.work_date_utc,
    role,
    counterpartMemberId,
    counterpartMemberName
  };
}

async function getEffectiveShiftContext(
  db: SupabaseRestClient,
  member: TeamMember,
  now: Date = new Date()
): Promise<ShiftContext> {
  const today = utcDateKey(now);
  const yesterday = utcDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const tomorrow = utcDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const swaps = await findApprovedSwapsForMember(db, member.id, [yesterday, today, tomorrow]);

  type Candidate = { swap: typeof swaps[number]; window: ShiftWindow; distance: number };
  const candidates: Candidate[] = [];
  for (const swap of swaps) {
    const info = buildSwapInfo(swap, member.id);
    const counterpart = getTeamMember(info.counterpartMemberId);
    if (!counterpart) continue;
    const window = getShiftWindowForDate(counterpart, swap.work_date_utc);
    if (now.getTime() > window.end.getTime() + SWAP_POST_SHIFT_BUFFER_MS) continue;
    if (now.getTime() < window.start.getTime() - SWAP_PRE_SHIFT_LOOKAHEAD_MS) continue;
    const distance = Math.abs(now.getTime() - window.start.getTime());
    candidates.push({ swap, window, distance });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.distance - b.distance);
    const best = candidates[0];
    return {
      window: best.window,
      swap: buildSwapInfo(best.swap, member.id)
    };
  }

  return { window: getRelevantShiftWindow(member, now), swap: null };
}

function isTicketClosed(ticket: SupportTicket): boolean {
  return Boolean(ticket.closed_at) || ticket.status.endsWith("_closed") || ticket.status === "expired";
}

async function handleCallback(db: SupabaseRestClient, callback: TelegramCallbackQuery): Promise<void> {
  const data = callback.data ?? "";
  const message = callback.message;
  const chatId = message?.chat.id;
  const messageId = message?.message_id;

  const isGroupActionCallback =
    data.startsWith("group:time:in:") || data.startsWith("group:time:out:");
  const isTicketCallback = data.startsWith("t:");
  const isAiSupportCallback = data.startsWith("ai:");
  const isSupportReplyCallback = data.startsWith("support:reply:");
  const isRegistrationCallback = data.startsWith("register:");
  if (!isGroupActionCallback && !isTicketCallback && !isAiSupportCallback && !isSupportReplyCallback && !isRegistrationCallback) {
    await answerCallbackQuery(callback.id);
  }

  if (!chatId || !messageId) {
    if (isGroupActionCallback || isTicketCallback || isAiSupportCallback || isSupportReplyCallback || isRegistrationCallback) await answerCallbackQuery(callback.id);
    return;
  }

  if (message && isGroupChat(message.chat)) {
    if (isTicketCallback) {
      await handleTicketCallback(db, callback);
      return;
    }

    if (isAiSupportCallback) {
      await handleAiSupportCallback(db, callback);
      return;
    }

    if (isGroupActionCallback) {
      const parts = data.split(":");
      const action = parts[2];
      const targetMemberId = parts[3];
      const targetMember = getTeamMember(targetMemberId);
      const registration = await findRegistrationByUser(db, callback.from.id);

      if (!targetMember) {
        await answerCallbackQuery(callback.id);
        return;
      }

      if (!registration || registration.member_id !== targetMemberId) {
        await answerCallbackQuery(
          callback.id,
          `Only ${targetMember.name} can press this button.`,
          { showAlert: true }
        );
        return;
      }

      await answerCallbackQuery(callback.id);

      if (action === "in") {
        await handleGroupTimeIn(db, chatId, messageId, registration, targetMember);
      } else if (action === "out") {
        await handleGroupTimeOut(db, chatId, messageId, registration, targetMember);
      }
      return;
    }

    const name = callback.from.first_name ?? "Hi";
    await sendMessage(
      chatId,
      `📩 ${name}, please continue in my private chat (DM), not here in the group.\n\nFor proof of work submission:\n1. Tap my profile above → “Send Message” (or send me /start in DM)\n2. In DM, tap “📎 Submit Proof”\n3. Send your proof there.`
    );
    return;
  }

  if (isSupportReplyCallback) {
    await handleSupportReplyCallback(db, callback, chatId, messageId);
    return;
  }

  if (data.startsWith("register:")) {
    const member = getTeamMember(data.split(":")[1]);
    if (!member) {
      await answerCallbackQuery(callback.id);
      return;
    }

    const existingRegistration = await findRegistrationByUser(db, callback.from.id);
    if (existingRegistration) {
      await answerCallbackQuery(
        callback.id,
        `You are already registered as ${existingRegistration.member_name}. Registration changes are locked.`,
        { showAlert: true }
      );
      await editMessageText(chatId, messageId, await buildDashboardText(db, existingRegistration.member_id, callback.from.id), {
        replyMarkup: dashboardKeyboard()
      });
      return;
    }

    const existingMemberRegistration = await findRegistrationByMemberId(db, member.id);
    if (existingMemberRegistration) {
      await answerCallbackQuery(
        callback.id,
        `${member.name} is already registered. Please choose your own unregistered name.`,
        { showAlert: true }
      );
      return;
    }

    await answerCallbackQuery(callback.id);
    await upsertRegistration(db, callback.from, chatId, member);
    await createActivity(db, {
      member_id: member.id,
      member_name: member.name,
      telegram_user_id: callback.from.id,
      action: "REGISTER",
      message: `${member.name} registered in the bot.`,
      metadata: { username: callback.from.username ?? null }
    });
    await editMessageText(chatId, messageId, await buildDashboardText(db, member.id, callback.from.id), {
      replyMarkup: dashboardKeyboard()
    });
    return;
  }

  const registration = await findRegistrationByUser(db, callback.from.id);
  if (!registration) {
    await editMessageText(chatId, messageId, "Please register first by selecting your name:", {
      replyMarkup: registrationKeyboard()
    });
    return;
  }

  if (data === "dashboard:refresh" || data === "status:me") {
    await clearConversationState(db, callback.from.id);
    await editMessageText(chatId, messageId, await buildDashboardText(db, registration.member_id, callback.from.id), {
      replyMarkup: dashboardKeyboard()
    });
    return;
  }

  if (data === "time:in") {
    await handleTimeIn(db, chatId, messageId, registration.member_id, callback.from.id);
    return;
  }

  if (data === "time:out") {
    await handleTimeOut(db, chatId, messageId, registration.member_id, callback.from.id);
    return;
  }

  if (data === "proof:start") {
    const proofEligibility = await getProofSubmissionEligibility(db, registration.member_id);
    if (!proofEligibility.allowed && !proofEligibility.appendable) {
      await clearConversationState(db, callback.from.id);
      await editMessageText(chatId, messageId, proofEligibility.message, { replyMarkup: dashboardKeyboard() });
      return;
    }

    const window = proofEligibility.window;
    await setConversationState(db, callback.from.id, "awaiting_proof_of_work", {
      workDateUtc: window.workDateUtc
    });

    const prompt = proofEligibility.allowed
      ? `Please attach or type your proof of work now. Links, notes, user/respondent links, screenshot uploads, screenshot links, or any valid non-empty text are accepted. You can send several screenshots together as an album.\n\nScheduled Out: ${formatUtc(window.end)} UTC. Proof submitted after this time will be marked Late.`
      : `You already submitted proof of work for ${window.workDateUtc}. Send more screenshots, links, or notes now and they will be added to that submission.`;

    await editMessageText(chatId, messageId, prompt, { replyMarkup: homeKeyboard() });
    return;
  }

  if (data === "activity:list") {
    await editMessageText(chatId, messageId, await buildActivityText(db), { replyMarkup: homeKeyboard() });
    return;
  }

  if (data === "excuse:start") {
    await editMessageText(chatId, messageId, "What type of excuse do you want to submit?", {
      replyMarkup: excuseTypeKeyboard()
    });
    return;
  }

  if (data.startsWith("excuse:type:")) {
    const excuseType = data.split(":")[2];
    await setConversationState(db, callback.from.id, "awaiting_excuse_reason", { excuseType });
    await editMessageText(chatId, messageId, "Please type your reason for this excuse:", { replyMarkup: homeKeyboard() });
    return;
  }

  if (data === "absent:start") {
    await editMessageText(chatId, messageId, "Mark yourself absent for today's UTC work date?", {
      replyMarkup: confirmAbsentKeyboard()
    });
    return;
  }

  if (data === "absent:confirm") {
    await setConversationState(db, callback.from.id, "awaiting_absent_reason");
    await editMessageText(chatId, messageId, "Please type your reason for absence:", { replyMarkup: homeKeyboard() });
    return;
  }

  if (data === "swap:start") {
    await editMessageText(chatId, messageId, "Who do you want to request a shift swap with?", {
      replyMarkup: swapTargetKeyboard(registration.member_id)
    });
    return;
  }

  if (data.startsWith("swap:target:")) {
    const targetMemberId = data.split(":")[2];
    await setConversationState(db, callback.from.id, "awaiting_swap_reason", { targetMemberId });
    await editMessageText(chatId, messageId, "Please type your reason for the shift swap request:", {
      replyMarkup: homeKeyboard()
    });
    return;
  }

  if (data.startsWith("swap:accept:") || data.startsWith("swap:reject:")) {
    await handleSwapResponse(db, chatId, messageId, data, callback.from);
  }
}

async function handleStatefulReply(
  db: SupabaseRestClient,
  message: TelegramMessage,
  state: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (isGroupChat(message.chat)) return;

  const user = message.from;
  if (!user) return;

  const registration = await findRegistrationByUser(db, user.id);
  if (!registration) {
    await sendMessage(message.chat.id, "Please register first.", { replyMarkup: registrationKeyboard() });
    return;
  }

  if (state === "awaiting_support_reply") {
    await handleSupportReplyMessage(db, message, registration, payload);
    return;
  }

  if (state === "awaiting_proof_of_work") {
    const now = new Date();
    const proofEligibility = await getProofSubmissionEligibility(db, registration.member_id, now);
    if (!proofEligibility.allowed && !proofEligibility.appendable) {
      await clearConversationState(db, user.id);
      await sendMessage(message.chat.id, proofEligibility.message, { replyMarkup: dashboardKeyboard() });
      return;
    }

    const window = proofEligibility.window;
    const content = proofContentFromMessage(message);
    if (!content) {
      await sendMessage(message.chat.id, "Please send a link, note, or screenshot/photo as your proof of work.", { replyMarkup: homeKeyboard() });
      return;
    }

    await clearConversationState(db, user.id);

    const attachments = await saveProofOfWorkAttachments(db, registration.member_id, window.workDateUtc, message);

    // Already submitted for this work date: append the new screenshots/links/text
    // to the existing submission instead of rejecting it.
    if (!proofEligibility.allowed) {
      await appendToExistingProofSubmission(db, proofEligibility.existing, content, attachments, message);
      return;
    }

    const swap = proofEligibility.swap;
    const status = now.getTime() > window.end.getTime() ? "late" : "submitted";
    const proofType = getProofType(content, attachments.length);

    const basePayload = {
      member_id: registration.member_id,
      member_name: registration.member_name,
      telegram_user_id: user.id,
      work_date_utc: window.workDateUtc,
      scheduled_out_utc: window.end.toISOString(),
      submitted_at_utc: now.toISOString(),
      proof_content: content,
      proof_type: proofType,
      status,
      source_chat_id: message.chat.id
    };

    let attachmentsPersisted = attachments.length > 0;
    try {
      await createProofOfWorkSubmission(db, {
        ...basePayload,
        ...(message.media_group_id ? { source_media_group_id: message.media_group_id } : {}),
        ...(attachments.length > 0 ? { attachments } : {})
      });
    } catch (error) {
      if (isUniqueViolationError(error)) {
        // A concurrent album message (or a quick repeat) may have already created
        // today's submission. Merge into it rather than surfacing a generic error.
        const existing = await findProofOfWorkSubmission(db, registration.member_id, window.workDateUtc);
        if (!existing) throw error;
        await appendToExistingProofSubmission(db, existing, content, attachments, message);
        return;
      }
      if (attachments.length > 0 && isMissingProofColumnError(error)) {
        // The attachments/source_media_group_id columns aren't in the database
        // yet (supabase/schema.sql not applied). Don't lose the proof: record
        // the text/links and tell the member their screenshot wasn't stored.
        console.error("proof_of_work_submissions is missing attachment columns; saving text-only:", error);
        await createProofOfWorkSubmission(db, { ...basePayload, proof_type: getProofType(content, 0) });
        attachmentsPersisted = false;
      } else {
        throw error;
      }
    }

    const effectiveType = attachmentsPersisted ? proofType : getProofType(content, 0);

    await markProofOfWorkReminderSubmitted(db, registration.member_id, window.workDateUtc, now.toISOString());

    await createActivity(db, {
      member_id: registration.member_id,
      member_name: registration.member_name,
      telegram_user_id: user.id,
      action: "PROOF_OF_WORK_SUBMITTED",
      message: `${registration.member_name} submitted proof of work with status: ${status}.${swap ? ` (covering ${swap.counterpartMemberName})` : ""}`,
      metadata: { proofType: effectiveType, status, workDateUtc: window.workDateUtc, attachmentCount: attachmentsPersisted ? attachments.length : 0, ...buildSwapMetadata(swap) }
    });

    const storageWarning = attachments.length > 0 && !attachmentsPersisted
      ? "\n\n⚠️ Screenshot received but not stored yet — the database needs the proof attachment migration (apply supabase/schema.sql). Your notes/links were saved."
      : "";
    await sendMessage(
      message.chat.id,
      `✅ Thank you, ${registration.member_name}. Your proof of work has been submitted successfully.\n\nStatus: ${status === "late" ? "Late" : "Submitted"}\nType: ${effectiveType}${storageWarning}`,
      { replyMarkup: dashboardKeyboard() }
    );

    await clearGroupActionMessages(db, registration.member_id, window.workDateUtc, "proof_of_work");

    const proofMention = `<a href="tg://user?id=${user.id}">${escapeHtmlForMention(registration.member_name)}</a>`;
    await postExpiringGroupAck(
      db,
      registration.member_id,
      window.workDateUtc,
      "proof_of_work_ack",
      buildProofOfWorkAckText(proofMention, status, effectiveType)
    );
    return;
  }

  const reason = message.text?.trim();
  if (!reason) return;

  await clearConversationState(db, user.id);

  if (state === "awaiting_excuse_reason") {
    const excuseType = String(payload.excuseType ?? "other");
    await db.insert("excuses", {
      member_id: registration.member_id,
      member_name: registration.member_name,
      telegram_user_id: user.id,
      work_date_utc: getRelevantShiftWindow(getTeamMember(registration.member_id)!).workDateUtc,
      type: excuseType,
      reason,
      status: "pending"
    });

    await createActivity(db, {
      member_id: registration.member_id,
      member_name: registration.member_name,
      telegram_user_id: user.id,
      action: "EXCUSE",
      message: `${registration.member_name} submitted a ${excuseType} excuse: ${reason}`,
      metadata: { excuseType, reason }
    });
    await sendMessage(message.chat.id, `📝 Excuse submitted.\n\nType: ${excuseType}\nReason: ${reason}\nStatus: Pending`, {
      replyMarkup: dashboardKeyboard()
    });

    const excuseMention = `<a href="tg://user?id=${user.id}">${escapeHtmlForMention(registration.member_name)}</a>`;
    await sendTeamGroupMessage(
      `📝 Excuse Submitted: ${excuseMention}\nType: ${excuseType}\nReason: ${escapeHtmlForMention(reason)}\nStatus: Pending`,
      { parseMode: "HTML" }
    );
    return;
  }

  if (state === "awaiting_absent_reason") {
    const member = getTeamMember(registration.member_id)!;
    const window = getRelevantShiftWindow(member);
    const log = await getOrCreateTimeLog(db, registration, window.workDateUtc, window.start, window.end);
    await updateTimeLog(db, log.id, { status: "absent" });
    await db.insert("excuses", {
      member_id: registration.member_id,
      member_name: registration.member_name,
      telegram_user_id: user.id,
      work_date_utc: window.workDateUtc,
      type: "absent",
      reason,
      status: "pending"
    });
    await createActivity(db, {
      member_id: registration.member_id,
      member_name: registration.member_name,
      telegram_user_id: user.id,
      action: "ABSENT",
      message: `${registration.member_name} marked absent: ${reason}`,
      metadata: { reason }
    });
    await sendMessage(message.chat.id, `🚫 Absence recorded.\n\nReason: ${reason}`, { replyMarkup: dashboardKeyboard() });

    const absentMention = `<a href="tg://user?id=${user.id}">${escapeHtmlForMention(registration.member_name)}</a>`;
    await sendTeamGroupMessage(
      `🚫 Absence Recorded: ${absentMention}\nWork date (UTC): ${window.workDateUtc}\nReason: ${escapeHtmlForMention(reason)}`,
      { parseMode: "HTML" }
    );
    return;
  }

  if (state === "awaiting_swap_reason") {
    const targetMemberId = String(payload.targetMemberId);
    const targetMember = getTeamMember(targetMemberId);
    if (!targetMember) return;

    const [data] = await db.insert<{ id: string }>("shift_requests", {
      requester_member_id: registration.member_id,
      requester_member_name: registration.member_name,
      target_member_id: targetMember.id,
      target_member_name: targetMember.name,
      work_date_utc: getRelevantShiftWindow(getTeamMember(registration.member_id)!).workDateUtc,
      reason,
      status: "pending"
    });
    if (!data) throw new Error("Unable to create shift request");

    await createActivity(db, {
      member_id: registration.member_id,
      member_name: registration.member_name,
      telegram_user_id: user.id,
      action: "SHIFT_SWAP_REQUEST",
      message: `${registration.member_name} requested a shift swap with ${targetMember.name}: ${reason}`,
      metadata: { targetMemberId, reason }
    });

    const targetRegistration = await findRegistrationByMemberId(db, targetMember.id);
    if (targetRegistration) {
      await sendMessage(
        targetRegistration.telegram_chat_id,
        `🔁 Shift Swap Request\n\n${registration.member_name} wants to swap shift with you.\n\nReason: ${reason}`,
        { replyMarkup: swapResponseKeyboard(String(data.id)) }
      );
    }

    await sendMessage(message.chat.id, `🔁 Shift swap request sent to ${targetMember.name}.`, {
      replyMarkup: dashboardKeyboard()
    });

    const requesterMention = `<a href="tg://user?id=${user.id}">${escapeHtmlForMention(registration.member_name)}</a>`;
    const targetMention = targetRegistration
      ? `<a href="tg://user?id=${targetRegistration.telegram_user_id}">${escapeHtmlForMention(targetMember.name)}</a>`
      : `<b>${escapeHtmlForMention(targetMember.name)}</b>`;
    await sendTeamGroupMessage(
      `🔁 Shift Swap Requested\nFrom: ${requesterMention}\nTo: ${targetMention}\nReason: ${escapeHtmlForMention(reason)}\nStatus: Pending`,
      { parseMode: "HTML" }
    );
  }
}


type ProofWindow = ReturnType<typeof getProofSubmissionShiftWindow>;

type ProofSubmissionEligibility =
  | { allowed: true; window: ProofWindow; swap: SwapInfo | null }
  | { allowed: false; appendable: true; window: ProofWindow; swap: SwapInfo | null; existing: ProofOfWorkSubmission; message: string }
  | { allowed: false; appendable?: false; message: string };

async function getProofSubmissionEligibility(
  db: SupabaseRestClient,
  memberId: string,
  now = new Date()
): Promise<ProofSubmissionEligibility> {
  const member = getTeamMember(memberId);
  if (!member) {
    return { allowed: false, message: "Your team profile was not found. Please contact the admin." };
  }

  const effective = await getEffectiveShiftContext(db, member, now);
  const window = effective.swap
    ? effective.window
    : getProofSubmissionShiftWindow(member, now);
  const log = await findTimeLog(db, member.id, window.workDateUtc);

  if (now.getTime() < window.start.getTime()) {
    return {
      allowed: false,
      message: `📎 Proof of Work is not open yet. Please Time In first when your shift starts.${effective.swap ? `\nCovering: ${effective.swap.counterpartMemberName}'s shift (approved swap)` : ""}\n\nShift Start: ${formatUtc(window.start)} UTC\nScheduled Out: ${formatUtc(window.end)} UTC`
    };
  }

  if (!log?.actual_in_utc) {
    return {
      allowed: false,
      message: `📎 Proof of Work is only available after you Time In for your active shift. Please Time In first.${effective.swap ? `\nCovering: ${effective.swap.counterpartMemberName}'s shift (approved swap)` : ""}\n\nScheduled Out: ${formatUtc(window.end)} UTC`
    };
  }

  const existingSubmission = await findProofOfWorkSubmission(db, member.id, window.workDateUtc);
  if (existingSubmission) {
    return {
      allowed: false,
      appendable: true,
      window,
      swap: effective.swap,
      existing: existingSubmission,
      message: `📎 You have already submitted proof of work for this work date.\n\nWork Date: ${window.workDateUtc}\nSubmitted: ${formatUtc(new Date(existingSubmission.submitted_at_utc))} UTC\nStatus: ${existingSubmission.status === "late" ? "Late" : "Submitted"}`
    };
  }

  return { allowed: true, window, swap: effective.swap };
}

function getProofSubmissionShiftWindow(member: NonNullable<ReturnType<typeof getTeamMember>>, now: Date) {
  const dayMs = 24 * 60 * 60 * 1000;
  const today = utcDateKey(now);
  const yesterday = utcDateKey(new Date(now.getTime() - dayMs));
  const tomorrow = utcDateKey(new Date(now.getTime() + dayMs));
  const windows = [
    getShiftWindowForDate(member, yesterday),
    getShiftWindowForDate(member, today),
    getShiftWindowForDate(member, tomorrow)
  ];

  const activeOrRecentWindow = windows
    .filter((window) => now.getTime() >= window.start.getTime())
    .sort((a, b) => b.start.getTime() - a.start.getTime())[0];

  return activeOrRecentWindow ?? getRelevantShiftWindow(member, now);
}

function proofContentFromMessage(message: TelegramMessage): string {
  const text = message.text?.trim() || message.caption?.trim() || "";
  if (text) return text;
  if (message.photo?.length) return "[screenshot attachment]";
  return "";
}

function isUniqueViolationError(error: unknown): boolean {
  const messageText = error instanceof Error ? error.message : String(error);
  return /\b409\b/.test(messageText) || /duplicate key|already exists|23505/i.test(messageText);
}

// Database hasn't had supabase/schema.sql applied, so the attachments /
// source_media_group_id columns don't exist yet.
function isMissingProofColumnError(error: unknown): boolean {
  const messageText = error instanceof Error ? error.message : String(error);
  return /PGRST204/i.test(messageText)
    || /could not find the '.*' column/i.test(messageText)
    || /column .*(attachments|source_media_group_id).* does not exist/i.test(messageText)
    || /\b42703\b/.test(messageText);
}

function mergeProofAttachments(
  existing: SupportTicketAttachment[] | undefined,
  incoming: SupportTicketAttachment[]
): SupportTicketAttachment[] {
  const base = Array.isArray(existing) ? existing : [];
  const seenPaths = new Set(base.map((attachment) => attachment.path));
  return [...base, ...incoming.filter((attachment) => !seenPaths.has(attachment.path))];
}

function mergeProofContent(existing: string, incoming: string): string {
  const current = (existing ?? "").trim();
  const addition = (incoming ?? "").trim();
  if (!current) return addition;
  if (!addition || current.includes(addition)) return current;
  return `${current}\n${addition}`;
}

function countScreenshots(attachments: SupportTicketAttachment[]): number {
  return attachments.filter((attachment) => attachment.type === "photo").length;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function appendToExistingProofSubmission(
  db: SupabaseRestClient,
  existing: ProofOfWorkSubmission,
  content: string,
  attachments: SupportTicketAttachment[],
  message: TelegramMessage
): Promise<void> {
  const mergedAttachments = mergeProofAttachments(existing.attachments, attachments);
  const mergedContent = mergeProofContent(existing.proof_content, content);
  const proofType = getProofType(mergedContent, mergedAttachments.length);

  await updateProofOfWorkSubmission(db, existing.id, {
    proof_content: mergedContent,
    proof_type: proofType,
    attachments: mergedAttachments,
    ...(message.media_group_id && !existing.source_media_group_id
      ? { source_media_group_id: message.media_group_id }
      : {})
  });

  const screenshotCount = countScreenshots(mergedAttachments);
  const screenshotLine = screenshotCount > 0 ? `\nScreenshots: ${screenshotCount}` : "";
  await sendMessage(
    message.chat.id,
    `✅ Added to your proof of work for ${existing.work_date_utc}.${screenshotLine}\nType: ${proofType}`,
    { replyMarkup: dashboardKeyboard() }
  );
}

async function appendProofOfWorkMediaGroupAttachment(
  db: SupabaseRestClient,
  message: TelegramMessage,
  user: TelegramUser,
  options: { waitForSubmission?: boolean } = {}
): Promise<boolean> {
  if (!message.media_group_id || !message.photo?.length || isGroupChat(message.chat)) return false;

  let submission = await findProofOfWorkSubmissionByMediaGroup(db, user.id, message.media_group_id);
  // The first album message may not have committed its submission yet; retry a
  // couple of times so racing sibling photos still attach to the same proof.
  if (!submission && options.waitForSubmission) {
    for (let attempt = 0; attempt < 3 && !submission; attempt += 1) {
      await delay(400);
      submission = await findProofOfWorkSubmissionByMediaGroup(db, user.id, message.media_group_id);
    }
  }
  if (!submission) return false;

  const attachments = await saveProofOfWorkAttachments(db, submission.member_id, submission.work_date_utc, message);
  if (!attachments.length) return true;

  const mergedAttachments = mergeProofAttachments(submission.attachments, attachments);
  const proofType = getProofType(submission.proof_content, mergedAttachments.length);

  await updateProofOfWorkSubmission(db, submission.id, {
    attachments: mergedAttachments,
    proof_type: proofType
  });
  await sendMessage(
    message.chat.id,
    `✅ Added screenshot ${countScreenshots(mergedAttachments)} to your proof of work for ${submission.work_date_utc}.`,
    { replyMarkup: dashboardKeyboard() }
  );
  return true;
}

function getProofType(content: string, attachmentCount = 0): string {
  const hasUrl = /https?:\/\/\S+/i.test(content);
  const textWithoutUrls = content.replace(/https?:\/\/\S+/gi, "").replace(/\[screenshot attachment\]/gi, "").trim();

  if (attachmentCount > 0 && (hasUrl || textWithoutUrls)) return "mixed";
  if (attachmentCount > 0) return "screenshot";
  if (hasUrl && textWithoutUrls) return "mixed";
  if (hasUrl) return "link";
  return "text";
}

async function handleTimeIn(db: SupabaseRestClient, chatId: number, messageId: number, memberId: string, userId: number) {
  const registration = await findRegistrationByUser(db, userId);
  const member = getTeamMember(memberId);
  if (!registration || !member) return;

  const now = new Date();
  const { window, swap } = await getEffectiveShiftContext(db, member, now);
  const swapLine = swap ? `\n🔁 Covering ${swap.counterpartMemberName}'s shift (approved swap)` : "";

  const existing = await findTimeLog(db, registration.member_id, window.workDateUtc);

  if (existing?.actual_in_utc) {
    await editMessageText(chatId, messageId, `⚠️ You already timed in at ${formatUtc(new Date(existing.actual_in_utc))} UTC.`, {
      replyMarkup: dashboardKeyboard()
    });
    return;
  }

  if (isBeforeScheduledTime(window.start, now)) {
    await editMessageText(
      chatId,
      messageId,
      `⚠️ Time In is not open yet.\n\n👤 ${registration.member_name}${swapLine}\nScheduled start: ${formatUtc(window.start)} UTC\nLocal: ${formatLocal(window.start, member.timezone)}\n\nTime In is available at the scheduled start time.`,
      { replyMarkup: dashboardKeyboard() }
    );
    const mention = `<a href="tg://user?id=${registration.telegram_user_id}">${escapeHtmlForMention(registration.member_name)}</a>`;
    await sendTeamGroupMessage(`⚠️ Early Time In Blocked

${mention} tried to Time In before the allowed window.${swap ? `\nCovering: ${escapeHtmlForMention(swap.counterpartMemberName)}'s shift (approved swap)` : ""}
Scheduled start: ${formatUtc(window.start)} UTC
Local: ${formatLocal(window.start, member.timezone)}
Available from: ${formatUtc(window.start)} UTC`, { parseMode: "HTML" });
    return;
  }

  const log = existing ?? await getOrCreateTimeLog(db, registration, window.workDateUtc, window.start, window.end);

  const lateMinutes = calculateLateMinutes(window.start, now);
  const status = lateMinutes > 0 ? "late" : "on_time";
  await updateTimeLog(db, log.id, {
    actual_in_utc: now.toISOString(),
    late_minutes: lateMinutes,
    status
  });

  const message = lateMinutes > 0
    ? `${registration.member_name} timed in late by ${formatDuration(lateMinutes)}.${swap ? ` (covering ${swap.counterpartMemberName})` : ""}`
    : `${registration.member_name} timed in on time.${swap ? ` (covering ${swap.counterpartMemberName})` : ""}`;

  await createActivity(db, {
    member_id: registration.member_id,
    member_name: registration.member_name,
    telegram_user_id: userId,
    action: "TIME_IN",
    message,
    metadata: { lateMinutes, ...buildSwapMetadata(swap) }
  });

  await editMessageText(
    chatId,
    messageId,
    `✅ Time In recorded.\n\n👤 ${registration.member_name}${swapLine}\nScheduled: ${formatUtc(window.start)} UTC\nActual: ${formatUtc(now)} UTC\nLocal: ${formatLocal(now, member.timezone)}\nStatus: ${lateMinutes > 0 ? `Late by ${formatDuration(lateMinutes)}` : "On time"}`,
    { replyMarkup: dashboardKeyboard() }
  );

  await clearGroupActionMessages(db, registration.member_id, window.workDateUtc, "time_in");

  const mention = `<a href="tg://user?id=${registration.telegram_user_id}">${escapeHtmlForMention(registration.member_name)}</a>`;
  await postExpiringGroupAck(
    db,
    registration.member_id,
    window.workDateUtc,
    "time_in_ack",
    buildTimeInAckText(mention, window.start, now, member.timezone, lateMinutes, swap)
  );
}

async function handleTimeOut(db: SupabaseRestClient, chatId: number, messageId: number, memberId: string, userId: number) {
  const registration = await findRegistrationByUser(db, userId);
  const member = getTeamMember(memberId);
  if (!registration || !member) return;

  const now = new Date();
  const { window, swap } = await getEffectiveShiftContext(db, member, now);
  const swapLine = swap ? `\n🔁 Covering ${swap.counterpartMemberName}'s shift (approved swap)` : "";
  const log = await findTimeLog(db, registration.member_id, window.workDateUtc);

  if (!log?.actual_in_utc) {
    await editMessageText(chatId, messageId, "⚠️ You cannot time out because no Time In was recorded for this shift.", {
      replyMarkup: dashboardKeyboard()
    });
    return;
  }

  if (log.actual_out_utc) {
    await editMessageText(chatId, messageId, `⚠️ You already timed out at ${formatUtc(new Date(log.actual_out_utc))} UTC.`, {
      replyMarkup: dashboardKeyboard()
    });
    return;
  }

  if (isBeforeScheduledTime(window.end, now)) {
    await editMessageText(
      chatId,
      messageId,
      `⚠️ Time Out is not open yet.\n\n👤 ${registration.member_name}${swapLine}\nScheduled out: ${formatUtc(window.end)} UTC\nLocal: ${formatLocal(window.end, member.timezone)}\n\nTime Out is available at the scheduled end time.`,
      { replyMarkup: dashboardKeyboard() }
    );
    const mention = `<a href="tg://user?id=${registration.telegram_user_id}">${escapeHtmlForMention(registration.member_name)}</a>`;
    await sendTeamGroupMessage(`⚠️ Early Time Out Blocked

${mention} tried to Time Out before the scheduled end.${swap ? `\nCovering: ${escapeHtmlForMention(swap.counterpartMemberName)}'s shift (approved swap)` : ""}
Scheduled out: ${formatUtc(window.end)} UTC
Local: ${formatLocal(window.end, member.timezone)}
Available from: ${formatUtc(window.end)} UTC`, { parseMode: "HTML" });
    return;
  }

  const earlyOutMinutes = calculateEarlyOutMinutes(window.end, now);
  const overtimeMinutes = calculateOvertimeMinutes(window.end, now);
  const workedMinutes = Math.max(0, signedMinutesBetween(new Date(log.actual_in_utc), now));
  const status = earlyOutMinutes > 0 ? "early_out" : "completed";

  await updateTimeLog(db, log.id, {
    actual_out_utc: now.toISOString(),
    early_out_minutes: earlyOutMinutes,
    overtime_minutes: overtimeMinutes,
    worked_minutes: workedMinutes,
    status
  });

  await createActivity(db, {
    member_id: registration.member_id,
    member_name: registration.member_name,
    telegram_user_id: userId,
    action: "TIME_OUT",
    message: `${registration.member_name} timed out. Worked ${formatDuration(workedMinutes)}.${swap ? ` (covered ${swap.counterpartMemberName})` : ""}`,
    metadata: { earlyOutMinutes, overtimeMinutes, workedMinutes, ...buildSwapMetadata(swap) }
  });

  await editMessageText(
    chatId,
    messageId,
    `🔴 Time Out recorded.\n\n👤 ${registration.member_name}${swapLine}\nScheduled Out: ${formatUtc(window.end)} UTC\nActual Out: ${formatUtc(now)} UTC\nWorked: ${formatDuration(workedMinutes)}\n${earlyOutMinutes > 0 ? `Early By: ${formatDuration(earlyOutMinutes)}` : `Overtime: ${formatDuration(overtimeMinutes)}`}`,
    { replyMarkup: dashboardKeyboard() }
  );

  await clearGroupActionMessages(db, registration.member_id, window.workDateUtc, "time_out");

  const mention = `<a href="tg://user?id=${registration.telegram_user_id}">${escapeHtmlForMention(registration.member_name)}</a>`;
  await postExpiringGroupAck(
    db,
    registration.member_id,
    window.workDateUtc,
    "time_out_ack",
    buildTimeOutAckText(mention, window.end, now, workedMinutes, earlyOutMinutes, overtimeMinutes, swap)
  );
}

async function handleGroupTimeIn(
  db: SupabaseRestClient,
  chatId: number,
  clickedMessageId: number,
  registration: Registration,
  member: TeamMember
): Promise<void> {
  const now = new Date();
  const { window, swap } = await getEffectiveShiftContext(db, member, now);
  const swapLine = swap ? `\n🔁 Covering ${swap.counterpartMemberName}'s shift (approved swap)` : "";
  const existing = await findTimeLog(db, registration.member_id, window.workDateUtc);
  const mention = `<a href="tg://user?id=${registration.telegram_user_id}">${escapeHtmlForMention(registration.member_name)}</a>`;

  if (existing?.actual_in_utc) {
    await deleteMessage(chatId, clickedMessageId);
    return;
  }

  if (isBeforeScheduledTime(window.start, now)) {
    await sendMessage(
      chatId,
      `⚠️ ${mention}, Time In is not open yet.${swap ? `\nCovering: ${escapeHtmlForMention(swap.counterpartMemberName)}'s shift (approved swap)` : ""}\nScheduled start: ${formatUtc(window.start)} UTC\nLocal: ${formatLocal(window.start, member.timezone)}\nTime In is available at the scheduled start time.`,
      { parseMode: "HTML" }
    );
    return;
  }

  const log = existing ?? await getOrCreateTimeLog(db, registration, window.workDateUtc, window.start, window.end);
  const lateMinutes = calculateLateMinutes(window.start, now);
  const status = lateMinutes > 0 ? "late" : "on_time";

  await updateTimeLog(db, log.id, {
    actual_in_utc: now.toISOString(),
    late_minutes: lateMinutes,
    status
  });

  const activityMessage = lateMinutes > 0
    ? `${registration.member_name} timed in late by ${formatDuration(lateMinutes)}.${swap ? ` (covering ${swap.counterpartMemberName})` : ""}`
    : `${registration.member_name} timed in on time.${swap ? ` (covering ${swap.counterpartMemberName})` : ""}`;

  await createActivity(db, {
    member_id: registration.member_id,
    member_name: registration.member_name,
    telegram_user_id: registration.telegram_user_id,
    action: "TIME_IN",
    message: activityMessage,
    metadata: { lateMinutes, source: "group", ...buildSwapMetadata(swap) }
  });

  await clearGroupActionMessages(db, registration.member_id, window.workDateUtc, "time_in");
  await deleteMessage(chatId, clickedMessageId);

  await postExpiringGroupAck(
    db,
    registration.member_id,
    window.workDateUtc,
    "time_in_ack",
    buildTimeInAckText(mention, window.start, now, member.timezone, lateMinutes, swap)
  );

  await sendPersonalDmAck(
    db,
    registration,
    `✅ Time In recorded.\n\n👤 ${registration.member_name}${swapLine}\nScheduled: ${formatUtc(window.start)} UTC\nActual: ${formatUtc(now)} UTC\nLocal: ${formatLocal(now, member.timezone)}\nStatus: ${lateMinutes > 0 ? `Late by ${formatDuration(lateMinutes)}` : "On time"}`
  );
}

async function handleGroupTimeOut(
  db: SupabaseRestClient,
  chatId: number,
  clickedMessageId: number,
  registration: Registration,
  member: TeamMember
): Promise<void> {
  const now = new Date();
  const { window, swap } = await getEffectiveShiftContext(db, member, now);
  const swapLine = swap ? `\n🔁 Covering ${swap.counterpartMemberName}'s shift (approved swap)` : "";
  const log = await findTimeLog(db, registration.member_id, window.workDateUtc);
  const mention = `<a href="tg://user?id=${registration.telegram_user_id}">${escapeHtmlForMention(registration.member_name)}</a>`;

  if (!log?.actual_in_utc) {
    await sendMessage(chatId, `⚠️ ${mention} cannot time out because no Time In was recorded for this shift.`, { parseMode: "HTML" });
    return;
  }

  if (log.actual_out_utc) {
    await deleteMessage(chatId, clickedMessageId);
    return;
  }

  if (isBeforeScheduledTime(window.end, now)) {
    await sendMessage(
      chatId,
      `⚠️ ${mention}, Time Out is not open yet.${swap ? `\nCovering: ${escapeHtmlForMention(swap.counterpartMemberName)}'s shift (approved swap)` : ""}\nScheduled out: ${formatUtc(window.end)} UTC\nLocal: ${formatLocal(window.end, member.timezone)}\nTime Out is available at the scheduled end time.`,
      { parseMode: "HTML" }
    );
    return;
  }

  const earlyOutMinutes = calculateEarlyOutMinutes(window.end, now);
  const overtimeMinutes = calculateOvertimeMinutes(window.end, now);
  const workedMinutes = Math.max(0, signedMinutesBetween(new Date(log.actual_in_utc), now));
  const status = earlyOutMinutes > 0 ? "early_out" : "completed";

  await updateTimeLog(db, log.id, {
    actual_out_utc: now.toISOString(),
    early_out_minutes: earlyOutMinutes,
    overtime_minutes: overtimeMinutes,
    worked_minutes: workedMinutes,
    status
  });

  await createActivity(db, {
    member_id: registration.member_id,
    member_name: registration.member_name,
    telegram_user_id: registration.telegram_user_id,
    action: "TIME_OUT",
    message: `${registration.member_name} timed out. Worked ${formatDuration(workedMinutes)}.${swap ? ` (covered ${swap.counterpartMemberName})` : ""}`,
    metadata: { earlyOutMinutes, overtimeMinutes, workedMinutes, source: "group", ...buildSwapMetadata(swap) }
  });

  await clearGroupActionMessages(db, registration.member_id, window.workDateUtc, "time_out");
  await deleteMessage(chatId, clickedMessageId);

  await postExpiringGroupAck(
    db,
    registration.member_id,
    window.workDateUtc,
    "time_out_ack",
    buildTimeOutAckText(mention, window.end, now, workedMinutes, earlyOutMinutes, overtimeMinutes, swap)
  );

  await sendPersonalDmAck(
    db,
    registration,
    `🔴 Time Out recorded.\n\n👤 ${registration.member_name}${swapLine}\nScheduled Out: ${formatUtc(window.end)} UTC\nActual Out: ${formatUtc(now)} UTC\nWorked: ${formatDuration(workedMinutes)}\n${earlyOutMinutes > 0 ? `Early By: ${formatDuration(earlyOutMinutes)}` : `Overtime: ${formatDuration(overtimeMinutes)}`}`
  );
}

async function sendPersonalDmAck(
  db: SupabaseRestClient,
  registration: Registration,
  text: string
): Promise<void> {
  const dmChatId = registration.telegram_chat_id ?? registration.telegram_user_id;
  if (!dmChatId) return;
  try {
    await sendMessage(dmChatId, text, { replyMarkup: dashboardKeyboard() });
  } catch (error) {
    console.warn(
      `Could not send personal DM ack to ${registration.member_id} (${dmChatId}): ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleSwapResponse(db: SupabaseRestClient, chatId: number, messageId: number, data: string, user: TelegramUser) {
  const [, action, requestId] = data.split(":");
  const status = action === "accept" ? "accepted" : "rejected";
  const [request] = await db.update<{
    id: string;
    requester_member_id: string;
    requester_member_name: string;
    target_member_id: string;
    target_member_name: string;
    work_date_utc: string;
  }>("shift_requests", { status, responded_at: new Date().toISOString() }, new URLSearchParams([["id", `eq.${requestId}`]]));
  if (!request) throw new Error("Shift request not found");

  await createActivity(db, {
    member_id: request.target_member_id,
    member_name: request.target_member_name,
    telegram_user_id: user.id,
    action: `SHIFT_SWAP_${status.toUpperCase()}`,
    message: `${request.target_member_name} ${status} ${request.requester_member_name}'s shift swap request.`,
    metadata: {
      requestId,
      workDateUtc: request.work_date_utc,
      requesterMemberId: request.requester_member_id,
      targetMemberId: request.target_member_id
    }
  });

  if (status === "accepted") {
    const requesterMember = getTeamMember(request.requester_member_id);
    const targetMember = getTeamMember(request.target_member_id);
    const requesterWindow = requesterMember ? getShiftWindowForDate(requesterMember, request.work_date_utc) : null;
    const targetWindow = targetMember ? getShiftWindowForDate(targetMember, request.work_date_utc) : null;
    const detailLines: string[] = [];
    if (requesterWindow) {
      detailLines.push(`• ${request.target_member_name} now covers ${request.requester_member_name}'s shift: ${formatUtc(requesterWindow.start)}–${formatUtc(requesterWindow.end)} UTC`);
    }
    if (targetWindow) {
      detailLines.push(`• ${request.requester_member_name} now covers ${request.target_member_name}'s shift: ${formatUtc(targetWindow.start)}–${formatUtc(targetWindow.end)} UTC`);
    }
    detailLines.push(`• Auto-reverts the next day. Use Time In on the dashboard during the effective hours.`);
    await editMessageText(
      chatId,
      messageId,
      `✅ Shift swap accepted for ${request.work_date_utc}.\n\n${detailLines.join("\n")}`,
      { replyMarkup: dashboardKeyboard() }
    );
  } else {
    await editMessageText(chatId, messageId, `Shift swap request ${status}.`, { replyMarkup: dashboardKeyboard() });
  }

  const responderMention = `<a href="tg://user?id=${user.id}">${escapeHtmlForMention(request.target_member_name)}</a>`;
  if (status === "accepted") {
    const requesterMember = getTeamMember(request.requester_member_id);
    const targetMember = getTeamMember(request.target_member_id);
    const requesterWindow = requesterMember ? getShiftWindowForDate(requesterMember, request.work_date_utc) : null;
    const targetWindow = targetMember ? getShiftWindowForDate(targetMember, request.work_date_utc) : null;
    const detailLines: string[] = [];
    if (requesterWindow) {
      detailLines.push(`${escapeHtmlForMention(request.target_member_name)} covers ${escapeHtmlForMention(request.requester_member_name)}'s shift: ${formatUtc(requesterWindow.start)}–${formatUtc(requesterWindow.end)} UTC`);
    }
    if (targetWindow) {
      detailLines.push(`${escapeHtmlForMention(request.requester_member_name)} covers ${escapeHtmlForMention(request.target_member_name)}'s shift: ${formatUtc(targetWindow.start)}–${formatUtc(targetWindow.end)} UTC`);
    }
    await sendTeamGroupMessage(
      `🔁 Shift Swap Accepted for ${request.work_date_utc}\n${responderMention} accepted ${escapeHtmlForMention(request.requester_member_name)}'s request.\n${detailLines.join("\n")}\n(Auto-reverts the next day.)`,
      { parseMode: "HTML" }
    );
  } else {
    await sendTeamGroupMessage(
      `🔁 Shift Swap Rejected\n${responderMention} rejected ${escapeHtmlForMention(request.requester_member_name)}'s shift swap request.`,
      { parseMode: "HTML" }
    );
  }

  if (status === "accepted") {
    try {
      const requesterRegistration = await findRegistrationByMemberId(db, request.requester_member_id);
      if (requesterRegistration) {
        const requesterMember = getTeamMember(request.requester_member_id);
        const targetMember = getTeamMember(request.target_member_id);
        const requesterWindow = requesterMember ? getShiftWindowForDate(requesterMember, request.work_date_utc) : null;
        const targetWindow = targetMember ? getShiftWindowForDate(targetMember, request.work_date_utc) : null;
        const lines: string[] = [
          `✅ ${request.target_member_name} accepted your shift swap for ${request.work_date_utc}.`
        ];
        if (requesterWindow) {
          lines.push(`• ${request.target_member_name} now covers your shift: ${formatUtc(requesterWindow.start)}–${formatUtc(requesterWindow.end)} UTC.`);
        }
        if (targetWindow) {
          lines.push(`• You now cover ${request.target_member_name}'s shift: ${formatUtc(targetWindow.start)}–${formatUtc(targetWindow.end)} UTC.`);
        }
        lines.push(`• Auto-reverts the next day.`);
        await sendPersonalDmAck(db, requesterRegistration, lines.join("\n"));
      }
    } catch (error) {
      console.warn(`Could not DM requester about accepted swap: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function buildDashboardText(db: SupabaseRestClient, memberId: string, userId: number): Promise<string> {
  const member = getTeamMember(memberId);
  if (!member) return "Unknown member.";

  const now = new Date();
  const { window, swap } = await getEffectiveShiftContext(db, member, now);
  const log = await findTimeLog(db, member.id, window.workDateUtc);
  const status = log ? formatLogStatus(log) : "Not yet timed in";

  const baseShiftLine = `${member.shiftStartUtc}–${member.shiftEndUtc} UTC`;
  const swapHeader = swap
    ? `\n\n🔁 Active Swap (${swap.workDateUtc}):\nYou're covering ${swap.counterpartMemberName}'s shift today.\nEffective: ${formatUtc(window.start)}–${formatUtc(window.end)} UTC`
    : "";
  const effectiveShiftLine = swap
    ? `Original: ${baseShiftLine}\nEffective today: ${formatUtc(window.start)}–${formatUtc(window.end)} UTC\n${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}`
    : `${baseShiftLine}\n${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}`;
  const progress = swap ? getShiftProgressForWindow(window, now) : getShiftProgress(member, now);

  return `👤 ${member.name}\n🌍 UTC Now: ${formatUtc(now)} UTC\n🏠 Local Now: ${formatLocal(now, member.timezone)}${swapHeader}\n\n🕒 Your Shift:\n${effectiveShiftLine}\n\n📌 Today:\n${status}\n\n⏳ Timer:\n${progress}\n\nUse the buttons below.`;
}

function getShiftProgressForWindow(window: ShiftWindow, now: Date): string {
  if (now < window.start) {
    return `Starts in ${formatDuration(Math.max(0, Math.floor((window.start.getTime() - now.getTime()) / 60000)))}`;
  }
  if (now <= window.end) {
    return `Shift active — ${formatDuration(Math.max(0, Math.floor((window.end.getTime() - now.getTime()) / 60000)))} remaining`;
  }
  return `Shift ended ${formatDuration(Math.max(0, Math.floor((now.getTime() - window.end.getTime()) / 60000)))} ago`;
}

function formatLogStatus(log: { actual_in_utc: string | null; actual_out_utc: string | null; status: string; late_minutes: number }) {
  if (log.status === "absent") return "Absent";
  if (!log.actual_in_utc) return "Not yet timed in";
  if (!log.actual_out_utc) {
    return log.late_minutes > 0 ? `Timed in — Late by ${formatDuration(log.late_minutes)}` : "Timed in — On time";
  }
  return `Completed — ${log.status}`;
}

async function buildActivityText(db: SupabaseRestClient): Promise<string> {
  const activities = await listRecentActivities(db, 10);
  if (activities.length === 0) return "📢 Public Activity\n\nNo activity yet.";

  return `📢 Public Activity\n\n${activities
    .map((activity, index) => `${index + 1}. ${activity.member_name} — ${activity.action} — ${formatUtc(new Date(activity.created_at))} UTC\n${activity.message}`)
    .join("\n\n")}`;
}
