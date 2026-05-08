-- MotivateMe Supabase schema (phase 1: structure only — no data migration).
-- Idempotent: safe to re-run as the schema evolves.
--
-- Apply via:
--   1. Open the Supabase project's SQL editor and paste this file, OR
--   2. psql "$SUPABASE_DB_URL" -f server/supabase/schema.sql
--
-- After this runs, the backend can talk to public.tasks under the user's JWT
-- and Row Level Security will enforce per-user isolation. The server's
-- service-role key bypasses RLS and is reserved for the reminder scheduler.

begin;

-- pgcrypto provides gen_random_uuid(). Supabase preinstalls it; create-if-missing
-- keeps this script portable to a fresh Postgres.
create extension if not exists pgcrypto;

-- =========================================================================
-- tasks
-- =========================================================================
create table if not exists public.tasks (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,

  title                    text not null check (length(btrim(title)) > 0),
  description              text not null default '',

  reminder_at              timestamptz not null,
  reminder_offset_minutes  integer not null default 0
                             check (reminder_offset_minutes >= 0
                                and reminder_offset_minutes <= 1440),
  repeat_interval_minutes  integer not null default 0
                             check (repeat_interval_minutes >= 0
                                and repeat_interval_minutes <= 1440),
  next_reminder_at         timestamptz,
  reminder_count           integer not null default 0
                             check (reminder_count >= 0),

  quote_preference         jsonb not null default jsonb_build_object(
                             'mode', 'motivation',
                             'customMessage', ''
                           ),
  nudge_tone               text not null default 'supportive'
                             check (nudge_tone in ('supportive','direct','tough')),
  last_reminder            jsonb,

  completed                boolean not null default false,
  reminded_at              timestamptz,

  -- "order" is a SQL reserved word; quoted identifier preserves the requested name.
  -- double precision lets the client insert between two values without a full rewrite.
  "order"                  double precision not null default 0,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- =========================================================================
-- Indexes
-- =========================================================================
-- Task lists for one user (most common read).
create index if not exists tasks_user_id_idx
  on public.tasks (user_id);

-- Active task ordering per user (drives Today Focus + Active list).
create index if not exists tasks_user_id_order_idx
  on public.tasks (user_id, "order");

-- Scheduler tick: due, unfinished tasks across all users.
create index if not exists tasks_due_unfinished_idx
  on public.tasks (next_reminder_at)
  where completed = false and next_reminder_at is not null;

-- =========================================================================
-- updated_at trigger
-- =========================================================================
create or replace function public.set_tasks_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_tasks_updated_at();

-- =========================================================================
-- Row Level Security
-- =========================================================================
alter table public.tasks enable row level security;

-- Drop and recreate so policy bodies always reflect this file.
drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own
  on public.tasks
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists tasks_insert_own on public.tasks;
create policy tasks_insert_own
  on public.tasks
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- USING gates the existing row, WITH CHECK gates the proposed new row.
-- Both must equal auth.uid() so a user cannot reassign user_id to themselves
-- and cannot edit a row they don't own.
drop policy if exists tasks_update_own on public.tasks;
create policy tasks_update_own
  on public.tasks
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists tasks_delete_own on public.tasks;
create policy tasks_delete_own
  on public.tasks
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- =========================================================================
-- Privileges
-- =========================================================================
-- service_role bypasses RLS by default and keeps full access (used by the scheduler).
-- anon should never touch this table.
revoke all on table public.tasks from anon;
grant  select, insert, update, delete on table public.tasks to authenticated;

commit;
