import { requireEnv } from "./config.js";
import { fetchWithRetry } from "./http.js";

export type Registration = {
  id: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  member_id: string;
  member_name: string;
  timezone: string;
  registered_at: string;
  updated_at: string;
};

export type TimeLog = {
  id: string;
  member_id: string;
  member_name: string;
  telegram_user_id: number;
  work_date_utc: string;
  scheduled_in_utc: string;
  scheduled_out_utc: string;
  actual_in_utc: string | null;
  actual_out_utc: string | null;
  late_minutes: number;
  early_out_minutes: number;
  overtime_minutes: number;
  worked_minutes: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ActivityLog = {
  id: string;
  member_id: string;
  member_name: string;
  telegram_user_id: number | null;
  action: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ConversationState = {
  telegram_user_id: number;
  state: string;
  payload: Record<string, unknown>;
  updated_at: string;
};

export type ProofOfWorkReminder = {
  id: string;
  member_id: string;
  member_name: string;
  telegram_user_id: number;
  work_date_utc: string;
  scheduled_out_utc: string;
  send_at_utc: string;
  sent_at_utc: string | null;
  channel: string;
  message: string;
  status: string;
  submitted_at_utc: string | null;
  created_at: string;
  updated_at: string;
};

export type ProofOfWorkSubmission = {
  id: string;
  member_id: string;
  member_name: string;
  telegram_user_id: number;
  work_date_utc: string;
  scheduled_out_utc: string;
  submitted_at_utc: string;
  proof_content: string;
  proof_type: string;
  status: string;
  source_chat_id: number | null;
  created_at: string;
};

export type ShiftRequest = {
  id: string;
  requester_member_id: string;
  requester_member_name: string;
  target_member_id: string;
  target_member_name: string;
  work_date_utc: string;
  reason: string;
  status: "pending" | "accepted" | "rejected" | string;
  created_at: string;
  responded_at: string | null;
};

export type GroupMessageStat = {
  id: string;
  member_id: string;
  member_name: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  work_date_utc: string;
  message_count: number;
  last_message_at_utc: string | null;
  created_at: string;
  updated_at: string;
};

export type TelegramGroup = {
  telegram_chat_id: number;
  title: string | null;
  type: string;
  is_active: boolean;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
};

export type GroupMessageStatWithGroup = GroupMessageStat & {
  group_title: string | null;
  group_type: string | null;
};

export type SavedCommand = {
  id: string;
  owner_telegram_user_id: number;
  owner_member_id: string;
  owner_member_name: string;
  command_name: string;
  source_chat_id: number;
  source_message_id: number;
  source_message_text: string | null;
  created_at: string;
  updated_at: string;
};

export type AppSetting = {
  key: string;
  value: string;
  updated_at: string;
};

export type GroupActionType =
  | "time_in"
  | "time_out"
  | "proof_of_work"
  | "time_in_ack"
  | "time_out_ack"
  | "proof_of_work_ack";

export type GroupActionMessage = {
  id: string;
  member_id: string;
  work_date_utc: string;
  action_type: GroupActionType;
  event_type: string;
  telegram_chat_id: number;
  telegram_message_id: number;
  expires_at: string | null;
  created_at: string;
  cleared_at: string | null;
};

export type SupportTicketStatus =
  | "open"
  | "accepted"
  | "pending_user_resolution"
  | "pending_follow_up"
  | "solved_closed"
  | "not_solved_closed"
  | "closed_by_team"
  | "expired";

export type SupportTicketResolution = "solved" | "not_solved";

export type SupportTicket = {
  id: string;
  ticket_code: string | null;
  telegram_chat_id: number;
  group_title: string | null;
  opened_by_telegram_user_id: number;
  opened_by_name: string;
  opened_message_id: number;
  opened_message_text: string;
  status: SupportTicketStatus;
  assigned_member_id: string | null;
  assigned_member_name: string | null;
  scheduled_member_id: string | null;
  scheduled_member_name: string | null;
  accepted_by_telegram_user_id: number | null;
  accepted_member_was_timed_in: boolean | null;
  accepted_during_own_shift: boolean | null;
  covered_for_member_id: string | null;
  covered_for_member_name: string | null;
  accepted_at: string | null;
  resolution_requested_at: string | null;
  resolved_by_telegram_user_id: number | null;
  resolution: SupportTicketResolution | null;
  resolved_at: string | null;
  pending_follow_up_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportTicketAttachment = {
  type: "photo";
  bucket: string;
  path: string;
  url: string;
  telegram_file_id?: string;
  telegram_file_unique_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
  content_type?: string | null;
};

export type SupportTicketMessage = {
  id: string;
  ticket_id: string;
  telegram_chat_id: number;
  telegram_message_id: number;
  reply_to_message_id: number | null;
  telegram_user_id: number | null;
  sender_name: string;
  sender_type: "customer" | "team_member" | "bot" | "unknown";
  message_text: string;
  attachments: SupportTicketAttachment[];
  message_date_utc: string;
  created_at: string;
};

export type SupportTicketEvent = {
  id: string;
  ticket_id: string;
  event_type: string;
  actor_telegram_user_id: number | null;
  actor_name: string;
  actor_type: "customer" | "team_member" | "bot" | "system";
  telegram_chat_id: number;
  telegram_message_id: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type QueryValue = string | number | boolean;

export type SupabaseRestClient = {
  select<T>(table: string, params?: URLSearchParams): Promise<T[]>;
  insert<T>(table: string, payload: Record<string, unknown> | Record<string, unknown>[]): Promise<T[]>;
  update<T>(table: string, payload: Record<string, unknown>, params: URLSearchParams): Promise<T[]>;
  upsert<T>(table: string, payload: Record<string, unknown>, onConflict: string): Promise<T[]>;
  delete(table: string, params: URLSearchParams): Promise<void>;
  rpc<T>(functionName: string, payload: Record<string, unknown>): Promise<T>;
  uploadObject(bucket: string, path: string, body: Uint8Array, contentType?: string | null): Promise<void>;
  getPublicObjectUrl(bucket: string, path: string): string;
};

function getSupabaseKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY");
  }

  return key;
}

export function eq(field: string, value: QueryValue): [string, string] {
  return [field, `eq.${value}`];
}

export function isNull(field: string, value = true): [string, string] {
  return [field, value ? "is.null" : "not.is.null"];
}

export function lte(field: string, value: string | number): [string, string] {
  return [field, `lte.${value}`];
}

export function inList(field: string, values: ReadonlyArray<string | number>): [string, string] {
  return [field, `in.(${values.map((v) => String(v)).join(",")})`];
}

export function order(field: string, ascending = true): [string, string] {
  return ["order", `${field}.${ascending ? "asc" : "desc"}`];
}

export function limit(count: number): [string, string] {
  return ["limit", String(count)];
}

export function params(...entries: [string, string][]): URLSearchParams {
  const searchParams = new URLSearchParams();
  for (const [key, value] of entries) {
    searchParams.append(key, value);
  }
  return searchParams;
}

export function getSupabase(): SupabaseRestClient {
  const baseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const key = getSupabaseKey();

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchWithRetry(`${baseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        prefer: "return=representation",
        ...(init.headers ?? {})
      }
    }, { timeoutMs: 10000 });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase REST error ${response.status}: ${errorText}`);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async function storageRequest(path: string, init: RequestInit = {}): Promise<void> {
    const response = await fetchWithRetry(`${baseUrl}/storage/v1/${path}`, {
      ...init,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        ...(init.headers ?? {})
      }
    }, { timeoutMs: 20000 });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase Storage error ${response.status}: ${errorText}`);
    }
  }

  return {
    select<T>(table: string, searchParams: URLSearchParams = new URLSearchParams()) {
      if (!searchParams.has("select")) searchParams.set("select", "*");
      return request<T[]>(`${table}?${searchParams.toString()}`);
    },
    insert<T>(table: string, payload: Record<string, unknown> | Record<string, unknown>[]) {
      return request<T[]>(table, { method: "POST", body: JSON.stringify(payload) });
    },
    update<T>(table: string, payload: Record<string, unknown>, searchParams: URLSearchParams) {
      return request<T[]>(`${table}?${searchParams.toString()}`, { method: "PATCH", body: JSON.stringify(payload) });
    },
    upsert<T>(table: string, payload: Record<string, unknown>, onConflict: string) {
      return request<T[]>(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(payload)
      });
    },
    rpc<T>(functionName: string, payload: Record<string, unknown>) {
      return request<T>(`rpc/${functionName}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    },
    async delete(table, searchParams) {
      await request<void>(`${table}?${searchParams.toString()}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    },
    async uploadObject(bucket, path, body, contentType = "application/octet-stream") {
      await storageRequest(`object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST",
        headers: {
          "content-type": contentType || "application/octet-stream",
          "cache-control": "3600",
          "x-upsert": "true"
        },
        body: Buffer.from(body)
      });
    },
    getPublicObjectUrl(bucket, path) {
      return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    }
  };
}
