import type { GroupActionType, Registration, SupabaseRestClient } from "./supabase.js";
import { createActivity, findTimeLog, hasCronEvent, listRegistrations, recordCronEvent, recordGroupActionMessage, upsertProofOfWorkReminder } from "./repository.js";
import { sendTeamGroupMessage, sendTeamGroupMessageWithResult, sweepExpiredGroupActionMessages } from "./group-notifications.js";
import { groupProofOfWorkKeyboard, groupTimeInKeyboard, groupTimeOutKeyboard, proofOfWorkKeyboard } from "./keyboards.js";
import { TEAM_SCHEDULE, getNextScheduledMember, getTeamMember } from "./team-schedule.js";
import { sendMessage } from "./telegram.js";
import type { InlineKeyboardMarkup } from "./telegram-types.js";
import { formatDuration, formatLocal, formatUtc, getRelevantShiftWindow, minutesBetween, signedMinutesBetween, utcDateKey } from "./time.js";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildMention(registration: Pick<Registration, "telegram_user_id" | "member_name">): string {
  return `<a href="tg://user?id=${registration.telegram_user_id}">${escapeHtml(registration.member_name)}</a>`;
}

function buildNextUpLine(currentMemberId: string, registrations: Registration[]): string {
  const next = getNextScheduledMember(currentMemberId);
  if (!next) return "";
  const nextRegistration = registrations.find((r) => r.member_id === next.id);
  const nextDisplay = nextRegistration ? buildMention(nextRegistration) : `<b>${escapeHtml(next.name)}</b>`;
  return `\n\n🔁 Up next: ${nextDisplay} — please prepare to Time In.`;
}

const PRE_SHIFT_ONE_HOUR_MINUTES = 60;
const PRE_SHIFT_MINUTES = 10;
const PRE_OUT_MINUTES = 10;
const PROOF_OF_WORK_REMINDER_MINUTES = 60;
const LATE_AFTER_MINUTES = 5;
const MISSING_OUT_AFTER_MINUTES = 5;

function isDueBetween(minutesUntilTarget: number, startMinutesBefore: number, stopMinutesBefore: number): boolean {
  return minutesUntilTarget <= startMinutesBefore && minutesUntilTarget > stopMinutesBefore;
}

function isDueAfter(minutesSinceTarget: number, startMinutesAfter: number): boolean {
  return minutesSinceTarget >= startMinutesAfter;
}

export async function runTimekeepingCron(db: SupabaseRestClient, now = new Date()): Promise<{ sent: number; groupSent: number; sweptExpired: number }> {
  let sent = 0;
  let groupSent = 0;
  const registrations = await listRegistrations(db);

  for (const registration of registrations) {
    const member = getTeamMember(registration.member_id);
    if (!member) continue;

    const window = getRelevantShiftWindow(member, now);
    const log = await findTimeLog(db, member.id, window.workDateUtc);
    const hasTimedIn = Boolean(log?.actual_in_utc);
    const hasTimedOut = Boolean(log?.actual_out_utc);

    const minutesUntilStart = signedMinutesBetween(now, window.start);
    const minutesSinceStart = signedMinutesBetween(window.start, now);
    const minutesUntilEnd = signedMinutesBetween(now, window.end);
    const minutesSinceEnd = signedMinutesBetween(window.end, now);

    const mention = buildMention(registration);

    if (!hasTimedIn && isDueBetween(minutesUntilStart, PRE_SHIFT_ONE_HOUR_MINUTES, PRE_SHIFT_MINUTES)) {
      const startsIn = formatDuration(minutesBetween(now, window.start));
      sent += await sendOnce(db, registration, window.workDateUtc, "pre_shift_1h", `⏰ Reminder: your shift starts in ${startsIn}.\n\nShift: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC\nLocal: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}`);
      groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "pre_shift_1h", `👥 Team Time In Reminder\n\n${mention}'s shift starts in ${startsIn}.\nShift: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC\nLocal: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}`);
    }

    if (!hasTimedIn && isDueBetween(minutesUntilStart, PRE_SHIFT_MINUTES, 0)) {
      const startsIn = formatDuration(minutesBetween(now, window.start));
      sent += await sendOnce(db, registration, window.workDateUtc, "pre_shift", `⏰ Reminder: your shift starts in ${startsIn}.\n\nShift: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC\nLocal: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}`);
      groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "pre_shift", `👥 Team Reminder\n\n${mention}'s shift starts in ${startsIn}.\nShift: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC\nLocal: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}\n\n👇 Tap below to Time In, or open my DM.`, groupTimeInKeyboard(member.id), "time_in");
    }

    if (!hasTimedIn && minutesSinceStart >= 0 && minutesSinceStart < LATE_AFTER_MINUTES) {
      sent += await sendOnce(db, registration, window.workDateUtc, "shift_start", `🟢 Shift Started\n\nPlease Time In now.\nUTC: ${formatUtc(now)} UTC\nLocal: ${formatLocal(now, member.timezone)}`);
      groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "shift_start", `🟢 Shift Started: ${mention}\n\nPlease make sure coverage is active.\nUTC: ${formatUtc(now)} UTC\nLocal: ${formatLocal(now, member.timezone)}\n\n👇 Tap below to Time In, or open my DM.`, groupTimeInKeyboard(member.id), "time_in");
    }

    if (!log?.actual_in_utc && isDueAfter(minutesSinceStart, LATE_AFTER_MINUTES)) {
      const latePersonalSent = await sendOnce(db, registration, window.workDateUtc, "late_warning", `⚠️ Late Alert

You have not timed in yet.
Scheduled In: ${formatUtc(window.start)} UTC
Current: ${formatUtc(now)} UTC
Late By: ${formatDuration(minutesSinceStart)}`);
      const lateGroupSent = await sendGroupOnce(db, member.id, window.workDateUtc, "late_warning", `⚠️ Team Late Alert

${mention} has not timed in yet.
Scheduled In: ${formatUtc(window.start)} UTC
Current: ${formatUtc(now)} UTC
Late By: ${formatDuration(minutesSinceStart)}

👇 Tap below to Time In, or open my DM.`, groupTimeInKeyboard(member.id), "time_in");
      sent += latePersonalSent;
      groupSent += lateGroupSent;

      if (latePersonalSent > 0 || lateGroupSent > 0) {
        await createActivity(db, {
          member_id: member.id,
          member_name: member.name,
          telegram_user_id: registration.telegram_user_id,
          action: "LATE_ALERT",
          message: `${member.name} has not timed in. Late by ${formatDuration(minutesSinceStart)}.`,
          metadata: { minutesSinceStart }
        });
      }
    }

    if (hasTimedIn && !hasTimedOut && isDueBetween(minutesUntilEnd, PROOF_OF_WORK_REMINDER_MINUTES, PRE_OUT_MINUTES)) {
      const personalProofMessage = buildProofOfWorkReminderMessage(member.name, window.end, member.timezone);
      const groupProofMessage = buildProofOfWorkReminderMessage(mention, window.end, member.timezone);
      sent += await sendProofOfWorkOnce(db, registration, window.workDateUtc, window.end, now, "personal", personalProofMessage);
      groupSent += await sendProofOfWorkGroupOnce(db, registration, window.workDateUtc, window.end, now, groupProofMessage);
    }

    if (!hasTimedOut && isDueBetween(minutesUntilEnd, PRE_OUT_MINUTES, 0)) {
      const endsIn = formatDuration(minutesBetween(now, window.end));
      const nextLine = buildNextUpLine(member.id, registrations);
      sent += await sendOnce(db, registration, window.workDateUtc, "pre_out", `⏰ Shift ending soon.\n\nScheduled Out: ${formatUtc(window.end)} UTC\nPlease prepare to Time Out.`);
      groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "pre_out", `👥 Team Time Out Reminder\n\n${mention}'s shift ends in ${endsIn}.\nScheduled Out: ${formatUtc(window.end)} UTC\nLocal: ${formatLocal(window.end, member.timezone)}${nextLine}\n\n👇 Tap below to Time Out, or open my DM.`, groupTimeOutKeyboard(member.id), "time_out");
    }

    if (!hasTimedOut && minutesSinceEnd >= 0 && minutesSinceEnd < MISSING_OUT_AFTER_MINUTES) {
      const nextLine = buildNextUpLine(member.id, registrations);
      sent += await sendOnce(db, registration, window.workDateUtc, "shift_end", `🔴 Shift Ended\n\nPlease Time Out now.\nUTC: ${formatUtc(now)} UTC\nLocal: ${formatLocal(now, member.timezone)}`);
      groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "shift_end", `🔴 Shift Ended: ${mention}\n\nPlease make sure ${mention} times out.\nScheduled Out: ${formatUtc(window.end)} UTC\nLocal: ${formatLocal(window.end, member.timezone)}${nextLine}\n\n👇 Tap below to Time Out, or open my DM.`, groupTimeOutKeyboard(member.id), "time_out");
    }

    if (!hasTimedOut && isDueAfter(minutesSinceEnd, MISSING_OUT_AFTER_MINUTES)) {
      const missingOutPersonalMessage = hasTimedIn
        ? `⚠️ Missing Time Out\n\nYou have not timed out yet.\nScheduled Out: ${formatUtc(window.end)} UTC\nCurrent: ${formatUtc(now)} UTC`
        : `⚠️ Missing Time Out\n\nNo Time In or Time Out is recorded for this shift yet. Please open the bot and update your attendance.\nScheduled Out: ${formatUtc(window.end)} UTC\nCurrent: ${formatUtc(now)} UTC`;
      const missingOutGroupMessage = hasTimedIn
        ? `⚠️ Team Missing Time Out\n\n${mention} has not timed out yet.\nScheduled Out: ${formatUtc(window.end)} UTC\nCurrent: ${formatUtc(now)} UTC\n\n👇 Tap below to Time Out, or open my DM.`
        : `⚠️ Team Missing Time Out\n\n${mention} has no Time In or Time Out recorded for this shift yet.\nScheduled Out: ${formatUtc(window.end)} UTC\nCurrent: ${formatUtc(now)} UTC\n\n👇 Tap below to Time Out, or open my DM.`;

      sent += await sendOnce(db, registration, window.workDateUtc, "missing_out", missingOutPersonalMessage);
      groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "missing_out", missingOutGroupMessage, groupTimeOutKeyboard(member.id), "time_out");
    }
  }

  groupSent += await sendUnregisteredMembersReminder(db, now, registrations);

  const sweptExpired = await sweepExpiredGroupActionMessages(db, now);

  return { sent, groupSent, sweptExpired };
}

async function sendUnregisteredMembersReminder(
  db: SupabaseRestClient,
  now: Date,
  registrations: Registration[]
): Promise<number> {
  const registeredIds = new Set(registrations.map((r) => r.member_id));
  const unregistered = TEAM_SCHEDULE.filter((member) => !registeredIds.has(member.id));
  if (unregistered.length === 0) return 0;

  const workDateUtc = utcDateKey(now);
  const eventKey = `unregistered_reminder:${workDateUtc}`;
  if (await hasCronEvent(db, eventKey)) return 0;

  const names = unregistered.map((member) => `• <b>${escapeHtml(member.name)}</b>`).join("\n");
  const message = `📢 <b>Registration Reminder</b>\n\nThe following team members are not yet registered with the timekeeping bot:\n${names}\n\nPlease open a private chat with me and send /start to register. You'll be able to receive shift reminders and use Time In/Out buttons after that.`;

  const sent = await sendTeamGroupMessage(message, { parseMode: "HTML" });
  if (!sent) return 0;

  await recordCronEvent(db, eventKey, "team", workDateUtc, "unregistered_reminder");
  return 1;
}

async function sendOnce(
  db: SupabaseRestClient,
  registration: { telegram_chat_id: number; member_id: string },
  workDateUtc: string,
  eventType: string,
  message: string
): Promise<number> {
  const eventKey = `${registration.member_id}:${workDateUtc}:${eventType}`;
  if (await hasCronEvent(db, eventKey)) return 0;

  try {
    await sendMessage(registration.telegram_chat_id, message);
  } catch (error) {
    console.error(
      `Failed to send personal reminder ${eventKey} to chat ${registration.telegram_chat_id}: ${error instanceof Error ? error.message : String(error)}`
    );
    return 0;
  }

  await recordCronEvent(db, eventKey, registration.member_id, workDateUtc, eventType);
  return 1;
}

async function sendGroupOnce(
  db: SupabaseRestClient,
  memberId: string,
  workDateUtc: string,
  eventType: string,
  message: string,
  replyMarkup?: InlineKeyboardMarkup,
  actionType?: GroupActionType
): Promise<number> {
  const eventKey = `group:${memberId}:${workDateUtc}:${eventType}`;
  if (await hasCronEvent(db, eventKey)) return 0;

  const sent = await sendTeamGroupMessageWithResult(message, { parseMode: "HTML", replyMarkup });
  if (!sent) return 0;

  await recordCronEvent(db, eventKey, memberId, workDateUtc, `group_${eventType}`);

  if (actionType && replyMarkup) {
    await recordGroupActionMessage(db, {
      member_id: memberId,
      work_date_utc: workDateUtc,
      action_type: actionType,
      event_type: eventType,
      telegram_chat_id: sent.chat.id,
      telegram_message_id: sent.message_id
    });
  }

  return 1;
}


function buildProofOfWorkReminderMessage(displayName: string, scheduledOut: Date, timezone: string): string {
  return `Hi ${displayName}, please attach your proof of work here before your work time ends. Links, notes, user/respondent links, screenshot links, or any valid proof are accepted.\n\n⚠️ Important: proof submission only works while you are actively timed in. It closes after your scheduled Time Out.\n\nScheduled Out: ${formatUtc(scheduledOut)} UTC\nLocal: ${formatLocal(scheduledOut, timezone)}`;
}

async function sendProofOfWorkOnce(
  db: SupabaseRestClient,
  registration: { telegram_chat_id: number; telegram_user_id: number; member_id: string; member_name: string },
  workDateUtc: string,
  scheduledOutUtc: Date,
  now: Date,
  channel: "personal",
  message: string
): Promise<number> {
  const eventType = "proof_of_work_1h";
  const eventKey = `${registration.member_id}:${workDateUtc}:${eventType}`;
  if (await hasCronEvent(db, eventKey)) return 0;

  const sendAtUtc = new Date(scheduledOutUtc.getTime() - PROOF_OF_WORK_REMINDER_MINUTES * 60_000).toISOString();

  try {
    await sendMessage(registration.telegram_chat_id, message, { replyMarkup: proofOfWorkKeyboard() });
  } catch (error) {
    console.error(
      `Failed to send personal proof-of-work reminder ${eventKey} to chat ${registration.telegram_chat_id}: ${error instanceof Error ? error.message : String(error)}`
    );
    await upsertProofOfWorkReminder(db, {
      member_id: registration.member_id,
      member_name: registration.member_name,
      telegram_user_id: registration.telegram_user_id,
      work_date_utc: workDateUtc,
      scheduled_out_utc: scheduledOutUtc.toISOString(),
      send_at_utc: sendAtUtc,
      sent_at_utc: null,
      channel,
      message,
      status: "failed",
      submitted_at_utc: null
    });
    return 0;
  }

  await recordCronEvent(db, eventKey, registration.member_id, workDateUtc, eventType);
  await upsertProofOfWorkReminder(db, {
    member_id: registration.member_id,
    member_name: registration.member_name,
    telegram_user_id: registration.telegram_user_id,
    work_date_utc: workDateUtc,
    scheduled_out_utc: scheduledOutUtc.toISOString(),
    send_at_utc: sendAtUtc,
    sent_at_utc: now.toISOString(),
    channel,
    message,
    status: "sent",
    submitted_at_utc: null
  });
  return 1;
}

async function sendProofOfWorkGroupOnce(
  db: SupabaseRestClient,
  registration: { telegram_user_id: number; member_id: string; member_name: string },
  workDateUtc: string,
  scheduledOutUtc: Date,
  now: Date,
  message: string
): Promise<number> {
  const eventType = "group_proof_of_work_1h";
  const eventKey = `group:${registration.member_id}:${workDateUtc}:proof_of_work_1h`;
  if (await hasCronEvent(db, eventKey)) return 0;

  const sendAtUtc = new Date(scheduledOutUtc.getTime() - PROOF_OF_WORK_REMINDER_MINUTES * 60_000).toISOString();
  const sent = await sendTeamGroupMessageWithResult(`👥 Proof of Work Reminder\n\n${message}`, { replyMarkup: groupProofOfWorkKeyboard(), parseMode: "HTML" });
  if (!sent) {
    await upsertProofOfWorkReminder(db, {
      member_id: registration.member_id,
      member_name: registration.member_name,
      telegram_user_id: registration.telegram_user_id,
      work_date_utc: workDateUtc,
      scheduled_out_utc: scheduledOutUtc.toISOString(),
      send_at_utc: sendAtUtc,
      sent_at_utc: null,
      channel: "group",
      message,
      status: "failed",
      submitted_at_utc: null
    });
    return 0;
  }

  await recordCronEvent(db, eventKey, registration.member_id, workDateUtc, eventType);

  await recordGroupActionMessage(db, {
    member_id: registration.member_id,
    work_date_utc: workDateUtc,
    action_type: "proof_of_work",
    event_type: "proof_of_work_1h",
    telegram_chat_id: sent.chat.id,
    telegram_message_id: sent.message_id
  });
  await upsertProofOfWorkReminder(db, {
    member_id: registration.member_id,
    member_name: registration.member_name,
    telegram_user_id: registration.telegram_user_id,
    work_date_utc: workDateUtc,
    scheduled_out_utc: scheduledOutUtc.toISOString(),
    send_at_utc: sendAtUtc,
    sent_at_utc: now.toISOString(),
    channel: "group",
    message,
    status: "sent",
    submitted_at_utc: null
  });
  return 1;
}
