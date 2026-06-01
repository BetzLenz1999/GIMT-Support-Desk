create extension if not exists pgcrypto;

create table if not exists public.team_registrations (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  telegram_chat_id bigint not null,
  telegram_username text,
  telegram_first_name text,
  telegram_last_name text,
  member_id text not null unique,
  member_name text not null,
  timezone text not null,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.time_logs (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  member_name text not null,
  telegram_user_id bigint not null,
  work_date_utc date not null,
  scheduled_in_utc timestamptz not null,
  scheduled_out_utc timestamptz not null,
  actual_in_utc timestamptz,
  actual_out_utc timestamptz,
  late_minutes integer not null default 0,
  early_out_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  worked_minutes integer not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id, work_date_utc)
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  member_name text not null,
  telegram_user_id bigint,
  action text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.excuses (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  member_name text not null,
  telegram_user_id bigint not null,
  work_date_utc date not null,
  type text not null,
  reason text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz
);

create table if not exists public.shift_requests (
  id uuid primary key default gen_random_uuid(),
  requester_member_id text not null,
  requester_member_name text not null,
  target_member_id text not null,
  target_member_name text not null,
  work_date_utc date not null,
  reason text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create table if not exists public.conversation_states (
  telegram_user_id bigint primary key,
  state text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.cron_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  member_id text not null,
  work_date_utc date not null,
  event_type text not null,
  sent_at timestamptz not null default now()
);

create table if not exists public.group_action_messages (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  work_date_utc date not null,
  action_type text not null check (
    action_type in (
      'time_in', 'time_out', 'proof_of_work',
      'time_in_ack', 'time_out_ack', 'proof_of_work_ack'
    )
  ),
  event_type text not null,
  telegram_chat_id bigint not null,
  telegram_message_id bigint not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);

create index if not exists time_logs_work_date_idx on public.time_logs(work_date_utc);
create index if not exists activity_logs_created_at_idx on public.activity_logs(created_at desc);
create index if not exists cron_events_member_date_idx on public.cron_events(member_id, work_date_utc);
create index if not exists group_action_messages_pending_idx
  on public.group_action_messages(member_id, work_date_utc, action_type)
  where cleared_at is null;
create index if not exists group_action_messages_expires_idx
  on public.group_action_messages(expires_at)
  where cleared_at is null and expires_at is not null;

create table if not exists public.proof_of_work_reminders (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  member_name text not null,
  telegram_user_id bigint not null,
  work_date_utc date not null,
  scheduled_out_utc timestamptz not null,
  send_at_utc timestamptz not null,
  sent_at_utc timestamptz,
  channel text not null check (channel in ('personal', 'group')),
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'submitted', 'failed')),
  submitted_at_utc timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id, work_date_utc, channel)
);

create table if not exists public.proof_of_work_submissions (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  member_name text not null,
  telegram_user_id bigint not null,
  work_date_utc date not null,
  scheduled_out_utc timestamptz not null,
  submitted_at_utc timestamptz not null default now(),
  proof_content text not null check (length(btrim(proof_content)) > 0),
  proof_type text not null default 'text' check (proof_type in ('link', 'text', 'mixed', 'screenshot')),
  status text not null default 'submitted' check (status in ('submitted', 'late')),
  source_chat_id bigint,
  source_media_group_id text,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(member_id, work_date_utc)
);

create index if not exists proof_of_work_reminders_member_date_idx on public.proof_of_work_reminders(member_id, work_date_utc);
create index if not exists proof_of_work_reminders_status_send_idx on public.proof_of_work_reminders(status, send_at_utc);
create index if not exists proof_of_work_submissions_member_date_idx on public.proof_of_work_submissions(member_id, work_date_utc);


create table if not exists public.telegram_groups (
  telegram_chat_id bigint primary key,
  title text,
  type text not null,
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_groups_active_idx on public.telegram_groups(is_active, last_seen_at desc);

create table if not exists public.group_message_stats (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  member_name text not null,
  telegram_user_id bigint not null,
  telegram_chat_id bigint not null,
  work_date_utc date not null,
  message_count integer not null default 0,
  last_message_at_utc timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, telegram_chat_id, work_date_utc)
);

create index if not exists group_message_stats_member_date_idx on public.group_message_stats(member_id, work_date_utc desc);
create index if not exists group_message_stats_date_idx on public.group_message_stats(work_date_utc desc);

create table if not exists public.saved_commands (
  id uuid primary key default gen_random_uuid(),
  owner_telegram_user_id bigint not null,
  owner_member_id text not null,
  owner_member_name text not null,
  command_name text not null check (command_name ~ '^[a-z][a-z0-9_]{0,31}$'),
  source_chat_id bigint not null,
  source_message_id bigint not null,
  source_message_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_telegram_user_id, command_name)
);

create index if not exists saved_commands_owner_idx
  on public.saved_commands(owner_telegram_user_id, command_name);

create or replace function public.increment_group_message_count(
  p_member_id text,
  p_member_name text,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint,
  p_work_date_utc date,
  p_message_at_utc timestamptz
) returns public.group_message_stats
language plpgsql
as $$
declare
  result public.group_message_stats;
begin
  insert into public.group_message_stats (
    member_id, member_name, telegram_user_id, telegram_chat_id, work_date_utc, message_count, last_message_at_utc
  ) values (
    p_member_id, p_member_name, p_telegram_user_id, p_telegram_chat_id, p_work_date_utc, 1, p_message_at_utc
  )
  on conflict (member_id, telegram_chat_id, work_date_utc) do update set
    message_count = public.group_message_stats.message_count + 1,
    last_message_at_utc = greatest(
      coalesce(public.group_message_stats.last_message_at_utc, p_message_at_utc),
      p_message_at_utc
    ),
    member_name = excluded.member_name,
    telegram_user_id = excluded.telegram_user_id,
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

create index if not exists proof_of_work_submissions_submitted_idx on public.proof_of_work_submissions(submitted_at_utc desc);

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text unique,
  telegram_chat_id bigint not null,
  group_title text,
  opened_by_telegram_user_id bigint not null,
  opened_by_name text not null,
  opened_message_id bigint not null,
  opened_message_text text not null,
  status text not null default 'open' check (
    status in ('open', 'accepted', 'pending_user_resolution', 'pending_follow_up', 'solved_closed', 'not_solved_closed', 'closed_by_team', 'expired')
  ),
  assigned_member_id text,
  assigned_member_name text,
  scheduled_member_id text,
  scheduled_member_name text,
  accepted_by_telegram_user_id bigint,
  accepted_member_was_timed_in boolean,
  accepted_during_own_shift boolean,
  covered_for_member_id text,
  covered_for_member_name text,
  accepted_at timestamptz,
  resolution_requested_at timestamptz,
  resolved_by_telegram_user_id bigint,
  resolution text check (resolution is null or resolution in ('solved', 'not_solved')),
  resolved_at timestamptz,
  pending_follow_up_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  telegram_chat_id bigint not null,
  telegram_message_id bigint not null,
  reply_to_message_id bigint,
  telegram_user_id bigint,
  sender_name text not null,
  sender_type text not null check (sender_type in ('customer', 'team_member', 'bot', 'unknown')),
  message_text text not null,
  message_date_utc timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  event_type text not null,
  actor_telegram_user_id bigint,
  actor_name text not null,
  actor_type text not null check (actor_type in ('customer', 'team_member', 'bot', 'system')),
  telegram_chat_id bigint not null,
  telegram_message_id bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists public.support_tickets
  add column if not exists ticket_code text;

create unique index if not exists support_tickets_ticket_code_key on public.support_tickets(ticket_code) where ticket_code is not null;
create index if not exists support_tickets_chat_user_status_idx on public.support_tickets(telegram_chat_id, opened_by_telegram_user_id, status, created_at desc);
create index if not exists support_tickets_chat_status_idx on public.support_tickets(telegram_chat_id, status, created_at desc);
create index if not exists support_tickets_opened_by_idx on public.support_tickets(opened_by_telegram_user_id, created_at desc);
create index if not exists support_tickets_assigned_member_idx on public.support_tickets(assigned_member_id, created_at desc);
create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id, created_at);
create index if not exists support_ticket_events_ticket_idx on public.support_ticket_events(ticket_id, created_at);


alter table if exists public.support_tickets
  add column if not exists scheduled_member_id text,
  add column if not exists scheduled_member_name text,
  add column if not exists accepted_member_was_timed_in boolean,
  add column if not exists accepted_during_own_shift boolean,
  add column if not exists covered_for_member_id text,
  add column if not exists covered_for_member_name text;
create index if not exists support_tickets_scheduled_member_idx on public.support_tickets(scheduled_member_id, created_at desc);
create index if not exists support_tickets_covered_for_member_idx on public.support_tickets(covered_for_member_id, created_at desc);


alter table if exists public.support_tickets
  add column if not exists pending_follow_up_at timestamptz;
create index if not exists support_tickets_pending_follow_up_idx
  on public.support_tickets(status, resolution_requested_at)
  where status = 'pending_user_resolution' and resolution_requested_at is not null;

alter table if exists public.support_tickets
  drop constraint if exists support_tickets_status_check;
alter table if exists public.support_tickets
  add constraint support_tickets_status_check check (
    status in ('open', 'accepted', 'pending_user_resolution', 'pending_follow_up', 'solved_closed', 'not_solved_closed', 'closed_by_team', 'expired')
  );

insert into storage.buckets (id, name, public)
values ('support-ticket-attachments', 'support-ticket-attachments', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('proof-of-work-attachments', 'proof-of-work-attachments', true)
on conflict (id) do update set public = excluded.public;

alter table if exists public.support_ticket_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table if exists public.proof_of_work_submissions
  add column if not exists source_media_group_id text,
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table if exists public.proof_of_work_submissions
  drop constraint if exists proof_of_work_submissions_proof_type_check,
  add constraint proof_of_work_submissions_proof_type_check check (proof_type in ('link', 'text', 'mixed', 'screenshot'));

create index if not exists proof_of_work_submissions_media_group_idx on public.proof_of_work_submissions(telegram_user_id, source_media_group_id) where source_media_group_id is not null;
