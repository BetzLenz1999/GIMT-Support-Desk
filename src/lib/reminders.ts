import type { GroupActionType, Registration, SupabaseRestClient, SupportTicket } from "./supabase.js";
import { createActivity, findTimeLog, hasCronEvent, listRegistrations, listSupportTicketsPendingResolutionTimeout, recordCronEvent, recordGroupActionMessage, recordSupportTicketEvent, recordSupportTicketMessage, updateSupportTicket, upsertProofOfWorkReminder } from "./repository.js";
import { sendTeamGroupMessage, sendTeamGroupMessageWithResult, sweepExpiredGroupActionMessages } from "./group-notifications.js";
import { dashboardKeyboard, groupProofOfWorkKeyboard, groupTimeInKeyboard, groupTimeOutKeyboard, proofOfWorkKeyboard } from "./keyboards.js";
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

type ReminderLanguage = "en" | "es";

function reminderLanguageForMember(member: Pick<Registration, "member_id" | "member_name">): ReminderLanguage {
  const id = member.member_id.toLowerCase();
  const name = member.member_name.toLowerCase();
  return id === "pablo" || id === "dany" || id === "danny" || name.includes("pablo") || name.includes("dany") || name.includes("danny")
    ? "es"
    : "en";
}

function buildNextUpLine(currentMemberId: string, registrations: Registration[], language: ReminderLanguage = "en"): string {
  const next = getNextScheduledMember(currentMemberId);
  if (!next) return "";
  const nextRegistration = registrations.find((r) => r.member_id === next.id);
  const nextDisplay = nextRegistration ? buildMention(nextRegistration) : `<b>${escapeHtml(next.name)}</b>`;
  return language === "es"
    ? `\n\n🔁 Siguiente: ${nextDisplay} — por favor prepárate para hacer Time In.`
    : `\n\n🔁 Up next: ${nextDisplay} — please prepare to Time In.`;
}

const PRE_SHIFT_ONE_HOUR_MINUTES = 60;
const PRE_SHIFT_MINUTES = 10;
const PRE_OUT_MINUTES = 10;
const PROOF_OF_WORK_REMINDER_MINUTES = 60;
const LATE_AFTER_MINUTES = 5;
const MISSING_OUT_AFTER_MINUTES = 5;
const SUPPORT_TICKET_RESOLUTION_TIMEOUT_MINUTES = 30;

function isDueBetween(minutesUntilTarget: number, startMinutesBefore: number, stopMinutesBefore: number): boolean {
  return minutesUntilTarget <= startMinutesBefore && minutesUntilTarget > stopMinutesBefore;
}

function isDueAfter(minutesSinceTarget: number, startMinutesAfter: number): boolean {
  return minutesSinceTarget >= startMinutesAfter;
}

export async function runTimekeepingCron(db: SupabaseRestClient, now = new Date()): Promise<{ sent: number; groupSent: number; sweptExpired: number; pendingFollowUpTickets: number; errors: number }> {
  let sent = 0;
  let groupSent = 0;
  let errors = 0;
  const registrations = await listRegistrations(db);

  for (const registration of registrations) {
    try {
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
      const language = reminderLanguageForMember(registration);

      if (!hasTimedIn && isDueBetween(minutesUntilStart, PRE_SHIFT_ONE_HOUR_MINUTES, PRE_SHIFT_MINUTES)) {
        const startsIn = formatDuration(minutesBetween(now, window.start));
        const personalMessage = language === "es"
          ? `⏰ Recordatorio de Time In de 1 hora: tu turno empieza en ${startsIn}.

Turno: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC
Local: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}`
          : `⏰ 1-Hour Time In Reminder: your shift starts in ${startsIn}.

Shift: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC
Local: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}`;
        const groupMessage = language === "es"
          ? `👥 Recordatorio de Time In del equipo (1 hora)

El turno de ${mention} empieza en ${startsIn}.
Turno: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC
Local: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}

👇 Toca abajo para hacer Time In o abre mi DM.`
          : `👥 1-Hour Team Time In Reminder

${mention}'s shift starts in ${startsIn}.
Shift: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC
Local: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}

👇 Tap below to Time In, or open my DM.`;
        sent += await sendOnce(db, registration, window.workDateUtc, "pre_shift_1h", personalMessage, dashboardKeyboard());
        groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "pre_shift_1h", groupMessage, groupTimeInKeyboard(member.id), "time_in");
      }

      if (!hasTimedIn && isDueBetween(minutesUntilStart, PRE_SHIFT_MINUTES, 0)) {
        const startsIn = formatDuration(minutesBetween(now, window.start));
        const personalMessage = language === "es"
          ? `⏰ Recordatorio de Time In de 10 minutos: tu turno empieza en ${startsIn}.

Turno: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC
Local: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}`
          : `⏰ 10-Minute Time In Reminder: your shift starts in ${startsIn}.

Shift: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC
Local: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}`;
        const groupMessage = language === "es"
          ? `👥 Recordatorio de Time In del equipo (10 minutos)

El turno de ${mention} empieza en ${startsIn}.
Turno: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC
Local: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}

👇 Toca abajo para hacer Time In o abre mi DM.`
          : `👥 10-Minute Team Time In Reminder

${mention}'s shift starts in ${startsIn}.
Shift: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC
Local: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}

👇 Tap below to Time In, or open my DM.`;
        sent += await sendOnce(db, registration, window.workDateUtc, "pre_shift", personalMessage, dashboardKeyboard());
        groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "pre_shift", groupMessage, groupTimeInKeyboard(member.id), "time_in");
      }

      if (!hasTimedIn && minutesSinceStart >= 0 && minutesSinceStart < LATE_AFTER_MINUTES) {
        const personalMessage = language === "es"
          ? `🟢 Turno iniciado

Por favor haz Time In ahora.
UTC: ${formatUtc(now)} UTC
Local: ${formatLocal(now, member.timezone)}`
          : `🟢 Shift Started

Please Time In now.
UTC: ${formatUtc(now)} UTC
Local: ${formatLocal(now, member.timezone)}`;
        const groupMessage = language === "es"
          ? `🟢 Turno iniciado: ${mention}

Por favor asegúrense de que la cobertura esté activa.
UTC: ${formatUtc(now)} UTC
Local: ${formatLocal(now, member.timezone)}

👇 Toca abajo para hacer Time In o abre mi DM.`
          : `🟢 Shift Started: ${mention}

Please make sure coverage is active.
UTC: ${formatUtc(now)} UTC
Local: ${formatLocal(now, member.timezone)}

👇 Tap below to Time In, or open my DM.`;
        sent += await sendOnce(db, registration, window.workDateUtc, "shift_start", personalMessage, dashboardKeyboard());
        groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "shift_start", groupMessage, groupTimeInKeyboard(member.id), "time_in");
      }

      if (!log?.actual_in_utc && isDueAfter(minutesSinceStart, LATE_AFTER_MINUTES)) {
        const personalMessage = language === "es"
          ? `⚠️ Alerta de retraso

Aún no has hecho Time In.
Entrada programada: ${formatUtc(window.start)} UTC
Hora actual: ${formatUtc(now)} UTC
Retraso: ${formatDuration(minutesSinceStart)}`
          : `⚠️ Late Alert

You have not timed in yet.
Scheduled In: ${formatUtc(window.start)} UTC
Current: ${formatUtc(now)} UTC
Late By: ${formatDuration(minutesSinceStart)}`;
        const groupMessage = language === "es"
          ? `⚠️ Alerta de retraso del equipo

${mention} aún no ha hecho Time In.
Entrada programada: ${formatUtc(window.start)} UTC
Hora actual: ${formatUtc(now)} UTC
Retraso: ${formatDuration(minutesSinceStart)}

👇 Toca abajo para hacer Time In o abre mi DM.`
          : `⚠️ Team Late Alert

${mention} has not timed in yet.
Scheduled In: ${formatUtc(window.start)} UTC
Current: ${formatUtc(now)} UTC
Late By: ${formatDuration(minutesSinceStart)}

👇 Tap below to Time In, or open my DM.`;
        const latePersonalSent = await sendOnce(db, registration, window.workDateUtc, "late_warning", personalMessage, dashboardKeyboard());
        const lateGroupSent = await sendGroupOnce(db, member.id, window.workDateUtc, "late_warning", groupMessage, groupTimeInKeyboard(member.id), "time_in");
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
        const personalProofMessage = buildProofOfWorkReminderMessage(member.name, window.end, member.timezone, language);
        const groupProofMessage = buildProofOfWorkReminderMessage(mention, window.end, member.timezone, language);
        sent += await sendProofOfWorkOnce(db, registration, window.workDateUtc, window.end, now, "personal", personalProofMessage);
        groupSent += await sendProofOfWorkGroupOnce(db, registration, window.workDateUtc, window.end, now, groupProofMessage, language);
      }

      if (!hasTimedOut && isDueBetween(minutesUntilEnd, PRE_OUT_MINUTES, 0)) {
        const endsIn = formatDuration(minutesBetween(now, window.end));
        const nextLine = buildNextUpLine(member.id, registrations, language);
        const personalMessage = language === "es"
          ? `⏰ Recordatorio de Time Out de 10 minutos

Salida programada: ${formatUtc(window.end)} UTC
Por favor prepárate para hacer Time Out.`
          : `⏰ 10-Minute Time Out Reminder

Scheduled Out: ${formatUtc(window.end)} UTC
Please prepare to Time Out.`;
        const groupMessage = language === "es"
          ? `👥 Recordatorio de Time Out del equipo (10 minutos)

El turno de ${mention} termina en ${endsIn}.
Salida programada: ${formatUtc(window.end)} UTC
Local: ${formatLocal(window.end, member.timezone)}${nextLine}

👇 Toca abajo para hacer Time Out o abre mi DM.`
          : `👥 10-Minute Team Time Out Reminder

${mention}'s shift ends in ${endsIn}.
Scheduled Out: ${formatUtc(window.end)} UTC
Local: ${formatLocal(window.end, member.timezone)}${nextLine}

👇 Tap below to Time Out, or open my DM.`;
        sent += await sendOnce(db, registration, window.workDateUtc, "pre_out", personalMessage, dashboardKeyboard());
        groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "pre_out", groupMessage, groupTimeOutKeyboard(member.id), "time_out");
      }

      if (!hasTimedOut && minutesSinceEnd >= 0 && minutesSinceEnd < MISSING_OUT_AFTER_MINUTES) {
        const nextLine = buildNextUpLine(member.id, registrations, language);
        const personalMessage = language === "es"
          ? `🔴 Turno terminado

Por favor haz Time Out ahora.
UTC: ${formatUtc(now)} UTC
Local: ${formatLocal(now, member.timezone)}`
          : `🔴 Shift Ended

Please Time Out now.
UTC: ${formatUtc(now)} UTC
Local: ${formatLocal(now, member.timezone)}`;
        const groupMessage = language === "es"
          ? `🔴 Turno terminado: ${mention}

Por favor asegúrense de que ${mention} haga Time Out.
Salida programada: ${formatUtc(window.end)} UTC
Local: ${formatLocal(window.end, member.timezone)}${nextLine}

👇 Toca abajo para hacer Time Out o abre mi DM.`
          : `🔴 Shift Ended: ${mention}

Please make sure ${mention} times out.
Scheduled Out: ${formatUtc(window.end)} UTC
Local: ${formatLocal(window.end, member.timezone)}${nextLine}

👇 Tap below to Time Out, or open my DM.`;
        sent += await sendOnce(db, registration, window.workDateUtc, "shift_end", personalMessage, dashboardKeyboard());
        groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "shift_end", groupMessage, groupTimeOutKeyboard(member.id), "time_out");
      }

      if (!hasTimedOut && isDueAfter(minutesSinceEnd, MISSING_OUT_AFTER_MINUTES)) {
        const missingOutPersonalMessage = hasTimedIn
          ? language === "es"
            ? `⚠️ Falta Time Out

Aún no has hecho Time Out.
Salida programada: ${formatUtc(window.end)} UTC
Hora actual: ${formatUtc(now)} UTC`
            : `⚠️ Missing Time Out

You have not timed out yet.
Scheduled Out: ${formatUtc(window.end)} UTC
Current: ${formatUtc(now)} UTC`
          : language === "es"
            ? `⚠️ Falta Time Out

No hay Time In ni Time Out registrado para este turno. Por favor abre el bot y actualiza tu asistencia.
Salida programada: ${formatUtc(window.end)} UTC
Hora actual: ${formatUtc(now)} UTC`
            : `⚠️ Missing Time Out

No Time In or Time Out is recorded for this shift yet. Please open the bot and update your attendance.
Scheduled Out: ${formatUtc(window.end)} UTC
Current: ${formatUtc(now)} UTC`;
        const missingOutGroupMessage = hasTimedIn
          ? language === "es"
            ? `⚠️ Falta Time Out del equipo

${mention} aún no ha hecho Time Out.
Salida programada: ${formatUtc(window.end)} UTC
Hora actual: ${formatUtc(now)} UTC

👇 Toca abajo para hacer Time Out o abre mi DM.`
            : `⚠️ Team Missing Time Out

${mention} has not timed out yet.
Scheduled Out: ${formatUtc(window.end)} UTC
Current: ${formatUtc(now)} UTC

👇 Tap below to Time Out, or open my DM.`
          : language === "es"
            ? `⚠️ Falta Time Out del equipo

${mention} no tiene Time In ni Time Out registrado para este turno.
Salida programada: ${formatUtc(window.end)} UTC
Hora actual: ${formatUtc(now)} UTC

👇 Toca abajo para hacer Time Out o abre mi DM.`
            : `⚠️ Team Missing Time Out

${mention} has no Time In or Time Out recorded for this shift yet.
Scheduled Out: ${formatUtc(window.end)} UTC
Current: ${formatUtc(now)} UTC

👇 Tap below to Time Out, or open my DM.`;

        sent += await sendOnce(db, registration, window.workDateUtc, "missing_out", missingOutPersonalMessage, dashboardKeyboard());
        groupSent += await sendGroupOnce(db, member.id, window.workDateUtc, "missing_out", missingOutGroupMessage, groupTimeOutKeyboard(member.id), "time_out");
      }
    } catch (error) {
      errors += 1;
      console.error(
        `Timekeeping reminders failed for member ${registration.member_id}: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  try {
    groupSent += await sendUnregisteredMembersReminder(db, now, registrations);
  } catch (error) {
    errors += 1;
    console.error(`Unregistered members reminder failed: ${error instanceof Error ? error.message : String(error)}`, error);
  }

  let sweptExpired = 0;
  try {
    sweptExpired = await sweepExpiredGroupActionMessages(db, now);
  } catch (error) {
    errors += 1;
    console.error(`Expired group action sweep failed: ${error instanceof Error ? error.message : String(error)}`, error);
  }

  let pendingFollowUpTickets = 0;
  try {
    pendingFollowUpTickets = await sweepPendingSupportTicketResolutionPrompts(db, now);
  } catch (error) {
    errors += 1;
    console.error(`Pending support ticket resolution sweep failed: ${error instanceof Error ? error.message : String(error)}`, error);
  }

  return { sent, groupSent, sweptExpired, pendingFollowUpTickets, errors };
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
  message: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<number> {
  const eventKey = `${registration.member_id}:${workDateUtc}:${eventType}`;
  if (await hasCronEvent(db, eventKey)) return 0;

  try {
    await sendMessage(registration.telegram_chat_id, message, { replyMarkup });
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


function buildProofOfWorkReminderMessage(displayName: string, scheduledOut: Date, timezone: string, language: ReminderLanguage = "en"): string {
  if (language === "es") {
    return `Hola ${displayName}, por favor adjunta aquí tu prueba de trabajo antes de que termine tu horario. Se aceptan enlaces, notas, enlaces de usuarios/respondientes, enlaces de capturas de pantalla o cualquier prueba válida.\n\n⚠️ Importante: el envío de prueba solo funciona mientras tienes Time In activo. Se cierra después de tu Time Out programado.\n\nSalida programada: ${formatUtc(scheduledOut)} UTC\nLocal: ${formatLocal(scheduledOut, timezone)}`;
  }

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
  message: string,
  language: ReminderLanguage = "en"
): Promise<number> {
  const eventType = "group_proof_of_work_1h";
  const eventKey = `group:${registration.member_id}:${workDateUtc}:proof_of_work_1h`;
  if (await hasCronEvent(db, eventKey)) return 0;

  const sendAtUtc = new Date(scheduledOutUtc.getTime() - PROOF_OF_WORK_REMINDER_MINUTES * 60_000).toISOString();
  const heading = language === "es" ? "👥 Recordatorio de prueba de trabajo" : "👥 Proof of Work Reminder";
  const sent = await sendTeamGroupMessageWithResult(`${heading}\n\n${message}`, { replyMarkup: groupProofOfWorkKeyboard(), parseMode: "HTML" });
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


function ticketLabel(ticket: Pick<SupportTicket, "ticket_code" | "id">): string {
  return ticket.ticket_code ?? ticket.id.slice(0, 8);
}

async function sweepPendingSupportTicketResolutionPrompts(
  db: SupabaseRestClient,
  now: Date
): Promise<number> {
  const cutoff = new Date(now.getTime() - SUPPORT_TICKET_RESOLUTION_TIMEOUT_MINUTES * 60_000).toISOString();
  const tickets = await listSupportTicketsPendingResolutionTimeout(db, cutoff);
  let moved = 0;

  for (const ticket of tickets) {
    const movedAt = now.toISOString();
    const updatedTicket = await updateSupportTicket(db, ticket.id, {
      status: "pending_follow_up",
      pending_follow_up_at: movedAt
    });

    await recordSupportTicketEvent(db, {
      ticket_id: ticket.id,
      event_type: "ticket_pending_follow_up",
      actor_telegram_user_id: null,
      actor_name: "System",
      actor_type: "system",
      telegram_chat_id: ticket.telegram_chat_id,
      telegram_message_id: null,
      metadata: {
        reason: "No requester response to resolution prompt within 30 minutes",
        resolutionRequestedAt: ticket.resolution_requested_at,
        pendingFollowUpAt: movedAt
      }
    });

    const text = `⏳ Ticket #${ticketLabel(updatedTicket)} moved to Pending Follow-up. No Solved / Not Solved response was received within 30 minutes. If ${ticket.opened_by_name} still needs help, they can send a new message and this same ticket will reopen instead of creating a new one.`;
    try {
      const sent = await sendMessage(ticket.telegram_chat_id, text, { replyToMessageId: ticket.opened_message_id });
      await recordSupportTicketMessage(db, {
        ticket_id: ticket.id,
        telegram_chat_id: sent.chat.id,
        telegram_message_id: sent.message_id,
        reply_to_message_id: ticket.opened_message_id,
        telegram_user_id: null,
        sender_name: "Bot",
        sender_type: "bot",
        message_text: text,
        message_date_utc: movedAt
      });
    } catch (error) {
      console.error(
        `Failed to notify pending follow-up for support ticket ${ticket.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    moved += 1;
  }

  return moved;
}
