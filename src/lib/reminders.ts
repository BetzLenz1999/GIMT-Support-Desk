import type { Registration, SupabaseRestClient } from "./supabase.js";
import { createActivity, findTimeLog, hasCronEvent, listActiveSupportTicketsForInactivitySweep, listRegistrations, listSupportTicketMessages, recordCronEvent, recordSupportTicketEvent, updateSupportTicket, upsertProofOfWorkReminder } from "./repository.js";
import { sendTeamGroupMessage, sweepExpiredGroupActionMessages } from "./group-notifications.js";
import { dashboardKeyboard, proofOfWorkKeyboard } from "./keyboards.js";
import { TEAM_SCHEDULE, getTeamMember } from "./team-schedule.js";
import { sendMessage } from "./telegram.js";
import type { InlineKeyboardMarkup } from "./telegram-types.js";
import { formatDuration, formatLocal, formatUtc, getRelevantShiftWindow, minutesBetween, signedMinutesBetween, utcDateKey } from "./time.js";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type ReminderLanguage = "en" | "es";

function reminderLanguageForMember(member: Pick<Registration, "member_id" | "member_name">): ReminderLanguage {
  const id = member.member_id.toLowerCase();
  const name = member.member_name.toLowerCase();
  return id === "pablo" || id === "dany" || id === "danny" || name.includes("pablo") || name.includes("dany") || name.includes("danny")
    ? "es"
    : "en";
}


const PRE_SHIFT_ONE_HOUR_MINUTES = 60;
const PRE_SHIFT_MINUTES = 10;
const PRE_OUT_MINUTES = 10;
const PROOF_OF_WORK_REMINDER_MINUTES = 60;
const LATE_AFTER_MINUTES = 5;
const MISSING_OUT_AFTER_MINUTES = 5;
const SUPPORT_TICKET_INACTIVITY_TIMEOUT_MINUTES = 30;
const TEAM_ENCOURAGEMENT_UTC_HOUR = 5; // 1:00 PM Philippines time (Asia/Manila, UTC+8, no DST)
const TEAM_ENCOURAGEMENT_EVENT = "team_encouragement";

function isDueBetween(minutesUntilTarget: number, startMinutesBefore: number, stopMinutesBefore: number): boolean {
  return minutesUntilTarget <= startMinutesBefore && minutesUntilTarget > stopMinutesBefore;
}

function isDueAfter(minutesSinceTarget: number, startMinutesAfter: number): boolean {
  return minutesSinceTarget >= startMinutesAfter;
}

export async function runTimekeepingCron(db: SupabaseRestClient, now = new Date()): Promise<{ sent: number; groupSent: number; encouragementSent: number; sweptExpired: number; inactiveClosedTickets: number; errors: number }> {
  let sent = 0;
  let groupSent = 0;
  let errors = 0;
  const registrations = await listRegistrations(db);

  // Attendance and proof-of-work reminder nudges stay private; group posts are not sent for these events.
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
        sent += await sendOnce(db, registration, window.workDateUtc, "pre_shift_1h", personalMessage, dashboardKeyboard());
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
        sent += await sendOnce(db, registration, window.workDateUtc, "pre_shift", personalMessage, dashboardKeyboard());
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
        sent += await sendOnce(db, registration, window.workDateUtc, "shift_start", personalMessage, dashboardKeyboard());
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
        const latePersonalSent = await sendOnce(db, registration, window.workDateUtc, "late_warning", personalMessage, dashboardKeyboard());
        sent += latePersonalSent;

        if (latePersonalSent > 0) {
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

      // DM each member once while their shift is active so they greet the groups as today's support.
      if (minutesSinceStart >= 0 && minutesUntilEnd > 0) {
        const greetingMessage = language === "es"
          ? `👋 ¡Hola ${member.name}, tu turno ha comenzado!

No olvides saludar a los grupos para que sepan quién está de soporte hoy. Puedes enviar algo como:

"Hola a todos: soy ${member.name}, tu asistente de hoy. ¡No dudes en escribirme si necesitas algo!"

Turno: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC
Local: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}`
          : `👋 Hi ${member.name}, your shift has started!

Don't forget to greet the groups so everyone knows who's on support today. You can send something like:

"Hi everyone! I'm ${member.name}, I'm your assistant today. Feel free to reach out if you need anything."

Shift: ${member.shiftStartUtc}–${member.shiftEndUtc} UTC
Local: ${formatLocal(window.start, member.timezone)} – ${formatLocal(window.end, member.timezone)}`;
        sent += await sendOnce(db, registration, window.workDateUtc, "shift_greeting", greetingMessage, dashboardKeyboard());
      }

      if (hasTimedIn && !hasTimedOut && isDueBetween(minutesUntilEnd, PROOF_OF_WORK_REMINDER_MINUTES, PRE_OUT_MINUTES)) {
        const personalProofMessage = buildProofOfWorkReminderMessage(member.name, window.end, member.timezone, language);
        sent += await sendProofOfWorkOnce(db, registration, window.workDateUtc, window.end, now, "personal", personalProofMessage);
      }

      if (!hasTimedOut && isDueBetween(minutesUntilEnd, PRE_OUT_MINUTES, 0)) {
        const personalMessage = language === "es"
          ? `⏰ Recordatorio de Time Out de 10 minutos

Salida programada: ${formatUtc(window.end)} UTC
Por favor prepárate para hacer Time Out.`
          : `⏰ 10-Minute Time Out Reminder

Scheduled Out: ${formatUtc(window.end)} UTC
Please prepare to Time Out.`;
        sent += await sendOnce(db, registration, window.workDateUtc, "pre_out", personalMessage, dashboardKeyboard());
      }

      if (!hasTimedOut && minutesSinceEnd >= 0 && minutesSinceEnd < MISSING_OUT_AFTER_MINUTES) {
        const personalMessage = language === "es"
          ? `🔴 Turno terminado

Por favor haz Time Out ahora.
UTC: ${formatUtc(now)} UTC
Local: ${formatLocal(now, member.timezone)}`
          : `🔴 Shift Ended

Please Time Out now.
UTC: ${formatUtc(now)} UTC
Local: ${formatLocal(now, member.timezone)}`;
        sent += await sendOnce(db, registration, window.workDateUtc, "shift_end", personalMessage, dashboardKeyboard());
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

        sent += await sendOnce(db, registration, window.workDateUtc, "missing_out", missingOutPersonalMessage, dashboardKeyboard());
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

  let inactiveClosedTickets = 0;
  try {
    inactiveClosedTickets = await sweepInactiveSupportTickets(db, now);
  } catch (error) {
    errors += 1;
    console.error(`Inactive support ticket sweep failed: ${error instanceof Error ? error.message : String(error)}`, error);
  }

  let encouragementSent = 0;
  try {
    encouragementSent = await sendTeamEncouragementReminder(
      db,
      now,
    );
  } catch (error) {
    errors += 1;
    console.error(
      `Team encouragement reminder failed: ${error instanceof Error ? error.message : String(error)}`, error,
    );
  }


  return { sent, groupSent, encouragementSent, sweptExpired, inactiveClosedTickets, errors };
}

async function sendTeamEncouragementReminder(
  db: SupabaseRestClient,
  now: Date,
): Promise<number> {
  const philippinesTarget = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      TEAM_ENCOURAGEMENT_UTC_HOUR,
      0,
    ),
  );
  if (now.getTime() < philippinesTarget.getTime()) return 0;

  const workDateUtc = utcDateKey(now);
  const eventType = TEAM_ENCOURAGEMENT_EVENT;

  const mainEventKey = `team_encouragement:main:${workDateUtc}`;
  const spanishEventKey = `team_encouragement:es:${workDateUtc}`;

  if (
    await hasCronEvent(
      db,
      mainEventKey,
    ) &&
    await hasCronEvent(
      db,
      spanishEventKey,
    )
  ) return 0;

  let sent = 0;

  const mainMessage =
    "🙌 <b>Good afternoon, amazing team!</b>" +
    "\n\nHello Betz, Omar, Moh, Pablo,and Danny 👋" +
    "\n\nLet’s give our best today. Every ticket, every reply,and every small effort helps our community thrive. 💪" +
    "\n\nDo your best — we’ve got this together! 🌟" +
    "\n\n— Community Moderator";

  const spanishMessage =
    "¡Hola Pablo y Danny! 👋" +
    "\n\nComo moderador de la comunidad, les recuerdo que hoy demos lo mejor de nosotros." +
    "\n\nSu trabajo y dedicación hacen una gran diferencia para nuestros usuarios. ¡Ánimo, equipo! 💪🌟";

  if (
    await hasCronEvent(
      db,
      mainEventKey,
    ) === false
  ) {
    const mainSent = await sendTeamGroupMessage(
      mainMessage,
      {
        parseMode: "HTML",
      },
    );
    if (mainSent) {
      await recordCronEvent(
        db,
        mainEventKey,
        "team",
        workDateUtc,
        eventType,
      );
      sent += 1;
    }
  }

  if (
    await hasCronEvent(
      db,
      spanishEventKey,
    ) === false
  ) {
    const spanishSent = await sendTeamGroupMessage(
      spanishMessage,
    );
    if (spanishSent) {
      await recordCronEvent(
        db,
        spanishEventKey,
        "team",
        workDateUtc,
        eventType,
      );
      sent += 1;
    }
  }

  return sent;
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


function buildProofOfWorkReminderMessage(displayName: string, scheduledOut: Date, timezone: string, language: ReminderLanguage = "en"): string {
  if (language === "es") {
    return `Hola ${displayName}, por favor adjunta aquí tu prueba de trabajo. Se aceptan enlaces, notas, enlaces de usuarios/respondientes, cargas de capturas de pantalla, enlaces de capturas de pantalla o cualquier prueba válida.\n\n⚠️ Importante: se acepta un solo envío de prueba por fecha de trabajo. La prueba enviada después de tu Time Out programado se marcará como Late.\n\nSalida programada: ${formatUtc(scheduledOut)} UTC\nLocal: ${formatLocal(scheduledOut, timezone)}`;
  }

  return `Hi ${displayName}, please attach your proof of work here. Links, notes, user/respondent links, screenshot uploads, screenshot links, or any valid proof are accepted.\n\n⚠️ Important: one proof submission is accepted per work date. Proof sent after your scheduled Time Out will be marked Late.\n\nScheduled Out: ${formatUtc(scheduledOut)} UTC\nLocal: ${formatLocal(scheduledOut, timezone)}`;
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

async function sweepInactiveSupportTickets(
  db: SupabaseRestClient,
  now: Date
): Promise<number> {
  const cutoff = new Date(now.getTime() - SUPPORT_TICKET_INACTIVITY_TIMEOUT_MINUTES * 60_000).toISOString();
  const tickets = await listActiveSupportTicketsForInactivitySweep(db);
  if (!tickets.length) return 0;

  const messages = await listSupportTicketMessages(db, tickets.map((ticket) => ticket.id));
  const latestCustomerMessageByTicket = new Map<string, string>();

  for (const message of messages) {
    if (message.sender_type !== "customer") continue;

    const current = latestCustomerMessageByTicket.get(message.ticket_id);
    if (!current || new Date(message.message_date_utc).getTime() > new Date(current).getTime()) {
      latestCustomerMessageByTicket.set(message.ticket_id, message.message_date_utc);
    }
  }

  let closed = 0;
  for (const ticket of tickets) {
    const latestCustomerMessageAt = latestCustomerMessageByTicket.get(ticket.id);
    if (!latestCustomerMessageAt || latestCustomerMessageAt > cutoff) continue;

    const closedAt = now.toISOString();
    const updatedTicket = await updateSupportTicket(db, ticket.id, {
      status: "expired",
      resolution_requested_at: null,
      pending_follow_up_at: null,
      closed_at: closedAt
    });

    await recordSupportTicketEvent(db, {
      ticket_id: ticket.id,
      event_type: "ticket_auto_closed_no_customer_response",
      actor_telegram_user_id: null,
      actor_name: "System",
      actor_type: "system",
      telegram_chat_id: ticket.telegram_chat_id,
      telegram_message_id: null,
      metadata: {
        reason: "No requester message on the active ticket within 30 minutes",
        previousStatus: ticket.status,
        status: updatedTicket.status,
        latestCustomerMessageAt,
        cutoff,
        closedAt
      }
    });

    closed += 1;
  }

  return closed;
}
