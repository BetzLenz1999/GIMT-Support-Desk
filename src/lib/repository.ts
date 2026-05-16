import { eq, inList, isNull, limit, lte, order, params, type ActivityLog, type AppSetting, type ConversationState, type GroupActionMessage, type GroupActionType, type GroupMessageStat, type ProofOfWorkReminder, type ProofOfWorkSubmission, type Registration, type SavedCommand, type SupportTicket, type SupportTicketEvent, type SupportTicketMessage, type SupportTicketStatus, type SupabaseRestClient, type TelegramGroup, type TimeLog } from "./supabase.js";
import type { TelegramUser } from "./telegram-types.js";
import type { TeamMember } from "./team-schedule.js";

function single<T>(rows: T[]): T {
  if (!rows[0]) throw new Error("Expected one row, received none");
  return rows[0];
}

const ACTIVE_SUPPORT_TICKET_STATUSES: SupportTicketStatus[] = [
  "open",
  "accepted",
  "pending_user_resolution",
  "pending_follow_up"
];


export async function upsertRegistration(
  db: SupabaseRestClient,
  user: TelegramUser,
  chatId: number,
  member: TeamMember
): Promise<Registration> {
  const rows = await db.upsert<Registration>(
    "team_registrations",
    {
      telegram_user_id: user.id,
      telegram_chat_id: chatId,
      telegram_username: user.username ?? null,
      telegram_first_name: user.first_name ?? null,
      telegram_last_name: user.last_name ?? null,
      member_id: member.id,
      member_name: member.name,
      timezone: member.timezone,
      updated_at: new Date().toISOString()
    },
    "telegram_user_id"
  );

  return single(rows);
}

export async function findRegistrationByUser(db: SupabaseRestClient, telegramUserId: number): Promise<Registration | null> {
  const rows = await db.select<Registration>("team_registrations", params(eq("telegram_user_id", telegramUserId), limit(1)));
  return rows[0] ?? null;
}

export async function findRegistrationByMemberId(db: SupabaseRestClient, memberId: string): Promise<Registration | null> {
  const rows = await db.select<Registration>("team_registrations", params(eq("member_id", memberId), limit(1)));
  return rows[0] ?? null;
}

export async function listRegistrations(db: SupabaseRestClient): Promise<Registration[]> {
  return db.select<Registration>("team_registrations");
}

export async function upsertSavedCommand(
  db: SupabaseRestClient,
  input: {
    owner_telegram_user_id: number;
    owner_member_id: string;
    owner_member_name: string;
    command_name: string;
    source_chat_id: number;
    source_message_id: number;
    source_message_text?: string | null;
  }
): Promise<SavedCommand> {
  const rows = await db.upsert<SavedCommand>(
    "saved_commands",
    {
      owner_telegram_user_id: input.owner_telegram_user_id,
      owner_member_id: input.owner_member_id,
      owner_member_name: input.owner_member_name,
      command_name: input.command_name,
      source_chat_id: input.source_chat_id,
      source_message_id: input.source_message_id,
      source_message_text: input.source_message_text ?? null,
      updated_at: new Date().toISOString()
    },
    "owner_telegram_user_id,command_name"
  );

  return single(rows);
}

export async function findSavedCommandForUser(
  db: SupabaseRestClient,
  ownerTelegramUserId: number,
  commandName: string
): Promise<SavedCommand | null> {
  const rows = await db.select<SavedCommand>(
    "saved_commands",
    params(eq("owner_telegram_user_id", ownerTelegramUserId), eq("command_name", commandName), limit(1))
  );
  return rows[0] ?? null;
}

export async function getAppSetting(db: SupabaseRestClient, key: string): Promise<string | null> {
  const rows = await db.select<AppSetting>("app_settings", params(eq("key", key), limit(1)));
  return rows[0]?.value ?? null;
}

export async function upsertAppSetting(db: SupabaseRestClient, key: string, value: string): Promise<void> {
  await db.upsert<AppSetting>(
    "app_settings",
    { key, value, updated_at: new Date().toISOString() },
    "key"
  );
}

export async function getOrCreateTimeLog(
  db: SupabaseRestClient,
  registration: Registration,
  workDateUtc: string,
  scheduledInUtc: Date,
  scheduledOutUtc: Date
): Promise<TimeLog> {
  const existing = await findTimeLog(db, registration.member_id, workDateUtc);
  if (existing) return existing;

  const rows = await db.insert<TimeLog>("time_logs", {
    member_id: registration.member_id,
    member_name: registration.member_name,
    telegram_user_id: registration.telegram_user_id,
    work_date_utc: workDateUtc,
    scheduled_in_utc: scheduledInUtc.toISOString(),
    scheduled_out_utc: scheduledOutUtc.toISOString(),
    status: "pending"
  });

  return single(rows);
}

export async function findTimeLog(db: SupabaseRestClient, memberId: string, workDateUtc: string): Promise<TimeLog | null> {
  const rows = await db.select<TimeLog>("time_logs", params(eq("member_id", memberId), eq("work_date_utc", workDateUtc), limit(1)));
  return rows[0] ?? null;
}

export async function updateTimeLog(db: SupabaseRestClient, id: string, payload: Partial<TimeLog>): Promise<TimeLog> {
  const rows = await db.update<TimeLog>("time_logs", { ...payload, updated_at: new Date().toISOString() }, params(eq("id", id)));
  return single(rows);
}

export async function createActivity(
  db: SupabaseRestClient,
  payload: Omit<ActivityLog, "id" | "created_at">
): Promise<ActivityLog> {
  return single(await db.insert<ActivityLog>("activity_logs", payload));
}

export async function listRecentActivities(db: SupabaseRestClient, rowLimit = 10): Promise<ActivityLog[]> {
  return db.select<ActivityLog>("activity_logs", params(order("created_at", false), limit(rowLimit)));
}

export async function setConversationState(
  db: SupabaseRestClient,
  telegramUserId: number,
  state: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await db.upsert<ConversationState>(
    "conversation_states",
    {
      telegram_user_id: telegramUserId,
      state,
      payload,
      updated_at: new Date().toISOString()
    },
    "telegram_user_id"
  );
}

export async function getConversationState(db: SupabaseRestClient, telegramUserId: number): Promise<ConversationState | null> {
  const rows = await db.select<ConversationState>("conversation_states", params(eq("telegram_user_id", telegramUserId), limit(1)));
  return rows[0] ?? null;
}

export async function clearConversationState(db: SupabaseRestClient, telegramUserId: number): Promise<void> {
  await db.delete("conversation_states", params(eq("telegram_user_id", telegramUserId)));
}

export async function hasCronEvent(db: SupabaseRestClient, eventKey: string): Promise<boolean> {
  const rows = await db.select<{ id: string }>("cron_events", params(eq("event_key", eventKey), limit(1)));
  return rows.length > 0;
}

export async function recordCronEvent(
  db: SupabaseRestClient,
  eventKey: string,
  memberId: string,
  workDateUtc: string,
  eventType: string
): Promise<void> {
  await db.insert("cron_events", {
    event_key: eventKey,
    member_id: memberId,
    work_date_utc: workDateUtc,
    event_type: eventType
  });
}


export async function upsertProofOfWorkReminder(
  db: SupabaseRestClient,
  payload: Omit<ProofOfWorkReminder, "id" | "created_at" | "updated_at">
): Promise<ProofOfWorkReminder> {
  return single(await db.upsert<ProofOfWorkReminder>(
    "proof_of_work_reminders",
    { ...payload, updated_at: new Date().toISOString() },
    "member_id,work_date_utc,channel"
  ));
}

export async function findProofOfWorkSubmission(
  db: SupabaseRestClient,
  memberId: string,
  workDateUtc: string
): Promise<ProofOfWorkSubmission | null> {
  const rows = await db.select<ProofOfWorkSubmission>(
    "proof_of_work_submissions",
    params(eq("member_id", memberId), eq("work_date_utc", workDateUtc), limit(1))
  );
  return rows[0] ?? null;
}

export async function createProofOfWorkSubmission(
  db: SupabaseRestClient,
  payload: Omit<ProofOfWorkSubmission, "id" | "created_at">
): Promise<ProofOfWorkSubmission> {
  return single(await db.insert<ProofOfWorkSubmission>("proof_of_work_submissions", payload));
}

export async function markProofOfWorkReminderSubmitted(
  db: SupabaseRestClient,
  memberId: string,
  workDateUtc: string,
  submittedAtUtc: string
): Promise<void> {
  await db.update(
    "proof_of_work_reminders",
    { status: "submitted", submitted_at_utc: submittedAtUtc, updated_at: new Date().toISOString() },
    params(eq("member_id", memberId), eq("work_date_utc", workDateUtc))
  );
}

const ACTION_PROMPT_TYPES = new Map<GroupActionType, GroupActionType[]>([
  ["time_in", ["time_in"]],
  ["time_out", ["time_out"]],
  ["proof_of_work", ["proof_of_work"]]
]);

export async function recordGroupActionMessage(
  db: SupabaseRestClient,
  payload: {
    member_id: string;
    work_date_utc: string;
    action_type: GroupActionType;
    event_type: string;
    telegram_chat_id: number;
    telegram_message_id: number;
    expires_at?: string | null;
  }
): Promise<void> {
  try {
    await db.insert<GroupActionMessage>("group_action_messages", {
      member_id: payload.member_id,
      work_date_utc: payload.work_date_utc,
      action_type: payload.action_type,
      event_type: payload.event_type,
      telegram_chat_id: payload.telegram_chat_id,
      telegram_message_id: payload.telegram_message_id,
      expires_at: payload.expires_at ?? null
    });
  } catch (error) {
    console.warn(
      `Failed to record group_action_messages row for ${payload.member_id}/${payload.work_date_utc}/${payload.action_type}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function listPendingGroupActionMessages(
  db: SupabaseRestClient,
  memberId: string,
  workDateUtc: string,
  actionType: GroupActionType
): Promise<GroupActionMessage[]> {
  const matchTypes = ACTION_PROMPT_TYPES.get(actionType) ?? [actionType];
  try {
    return await db.select<GroupActionMessage>(
      "group_action_messages",
      params(
        eq("member_id", memberId),
        eq("work_date_utc", workDateUtc),
        inList("action_type", matchTypes),
        isNull("cleared_at", true)
      )
    );
  } catch (error) {
    console.warn(
      `Failed to list pending group_action_messages for ${memberId}/${workDateUtc}/${actionType}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

export async function listExpiredGroupActionMessages(
  db: SupabaseRestClient,
  nowUtcIso: string,
  rowLimit = 100
): Promise<GroupActionMessage[]> {
  try {
    return await db.select<GroupActionMessage>(
      "group_action_messages",
      params(
        isNull("cleared_at", true),
        isNull("expires_at", false),
        lte("expires_at", nowUtcIso),
        order("expires_at", true),
        limit(rowLimit)
      )
    );
  } catch (error) {
    console.warn(
      `Failed to list expired group_action_messages: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

export async function markGroupActionMessageCleared(db: SupabaseRestClient, id: string): Promise<void> {
  try {
    await db.update<GroupActionMessage>(
      "group_action_messages",
      { cleared_at: new Date().toISOString() },
      params(eq("id", id))
    );
  } catch (error) {
    console.warn(
      `Failed to mark group_action_messages ${id} cleared: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}


export async function upsertTelegramGroup(
  db: SupabaseRestClient,
  input: {
    telegram_chat_id: number;
    title?: string | null;
    type: string;
    is_active?: boolean;
  }
): Promise<TelegramGroup> {
  const now = new Date().toISOString();
  const rows = await db.upsert<TelegramGroup>(
    "telegram_groups",
    {
      telegram_chat_id: input.telegram_chat_id,
      title: input.title ?? null,
      type: input.type,
      is_active: input.is_active ?? true,
      last_seen_at: now,
      updated_at: now
    },
    "telegram_chat_id"
  );

  return single(rows);
}

export async function incrementGroupMessageCount(
  db: SupabaseRestClient,
  input: {
    member_id: string;
    member_name: string;
    telegram_user_id: number;
    telegram_chat_id: number;
    work_date_utc: string;
    message_at_utc: string;
  }
): Promise<GroupMessageStat | null> {
  const result = await db.rpc<GroupMessageStat | GroupMessageStat[] | null>(
    "increment_group_message_count",
    {
      p_member_id: input.member_id,
      p_member_name: input.member_name,
      p_telegram_user_id: input.telegram_user_id,
      p_telegram_chat_id: input.telegram_chat_id,
      p_work_date_utc: input.work_date_utc,
      p_message_at_utc: input.message_at_utc
    }
  );

  if (!result) return null;
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

export async function createSupportTicket(
  db: SupabaseRestClient,
  payload: Omit<SupportTicket, "id" | "created_at" | "updated_at">
): Promise<SupportTicket> {
  return single(await db.insert<SupportTicket>("support_tickets", payload));
}

export async function findSupportTicketById(db: SupabaseRestClient, ticketId: string): Promise<SupportTicket | null> {
  const rows = await db.select<SupportTicket>("support_tickets", params(eq("id", ticketId), limit(1)));
  return rows[0] ?? null;
}

export async function findActiveSupportTicketForUser(
  db: SupabaseRestClient,
  telegramChatId: number,
  telegramUserId: number
): Promise<SupportTicket | null> {
  const rows = await db.select<SupportTicket>(
    "support_tickets",
    params(
      eq("telegram_chat_id", telegramChatId),
      eq("opened_by_telegram_user_id", telegramUserId),
      inList("status", ACTIVE_SUPPORT_TICKET_STATUSES),
      order("created_at", false),
      limit(1)
    )
  );
  return rows[0] ?? null;
}

export async function findActiveSupportTicketByMessageReference(
  db: SupabaseRestClient,
  telegramChatId: number,
  telegramMessageId: number
): Promise<SupportTicket | null> {
  const messages = await db.select<SupportTicketMessage>(
    "support_ticket_messages",
    params(
      eq("telegram_chat_id", telegramChatId),
      eq("telegram_message_id", telegramMessageId),
      order("created_at", false),
      limit(1)
    )
  );
  const message = messages[0];
  if (!message) return null;

  const ticket = await findSupportTicketById(db, message.ticket_id);
  if (!ticket || !ACTIVE_SUPPORT_TICKET_STATUSES.includes(ticket.status)) return null;
  return ticket;
}

export async function listSupportTicketMessages(
  db: SupabaseRestClient,
  ticketIds: string[]
): Promise<SupportTicketMessage[]> {
  if (!ticketIds.length) return [];
  return db.select<SupportTicketMessage>(
    "support_ticket_messages",
    params(inList("ticket_id", ticketIds), order("message_date_utc", true))
  );
}

export async function listRecentBotSupportTicketMessages(
  db: SupabaseRestClient,
  ticketId: string,
  rowLimit = 20
): Promise<SupportTicketMessage[]> {
  return db.select<SupportTicketMessage>(
    "support_ticket_messages",
    params(
      eq("ticket_id", ticketId),
      eq("sender_type", "bot"),
      order("created_at", false),
      limit(rowLimit)
    )
  );
}


export async function listActiveSupportTicketsForInactivitySweep(
  db: SupabaseRestClient,
  rowLimit = 200
): Promise<SupportTicket[]> {
  return db.select<SupportTicket>(
    "support_tickets",
    params(
      inList("status", ACTIVE_SUPPORT_TICKET_STATUSES),
      order("created_at", true),
      limit(rowLimit)
    )
  );
}

export async function updateSupportTicket(
  db: SupabaseRestClient,
  ticketId: string,
  payload: Partial<SupportTicket>
): Promise<SupportTicket> {
  return single(await db.update<SupportTicket>(
    "support_tickets",
    { ...payload, updated_at: new Date().toISOString() },
    params(eq("id", ticketId))
  ));
}

export async function recordSupportTicketMessage(
  db: SupabaseRestClient,
  payload: Omit<SupportTicketMessage, "id" | "created_at" | "attachments"> & Pick<Partial<SupportTicketMessage>, "attachments">
): Promise<SupportTicketMessage> {
  return single(await db.insert<SupportTicketMessage>("support_ticket_messages", {
    ...payload,
    attachments: payload.attachments ?? []
  }));
}

export async function recordSupportTicketEvent(
  db: SupabaseRestClient,
  payload: Omit<SupportTicketEvent, "id" | "created_at">
): Promise<SupportTicketEvent> {
  return single(await db.insert<SupportTicketEvent>("support_ticket_events", payload));
}
