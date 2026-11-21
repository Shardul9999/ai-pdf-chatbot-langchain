-- Safe bootstrap: existing rows are retained; legacy rows without an owner remain
-- inaccessible through the API. Never infer ownership from untrusted metadata.
create extension if not exists vector;
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  content text,
  metadata jsonb,
  embedding vector(3072)
);
alter table public.documents add column if not exists user_id text;
create index if not exists documents_user_id_idx on public.documents(user_id);
create table if not exists public.chat_history (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  session_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb,
  created_at timestamptz default now()
);
alter table public.chat_history add column if not exists user_id text;
create index if not exists chat_history_user_id_idx on public.chat_history(user_id);
create index if not exists chat_history_session_id_idx on public.chat_history(session_id);
alter table public.documents enable row level security;
alter table public.chat_history enable row level security;
revoke all on public.documents, public.chat_history from public, anon, authenticated;
grant select, insert, update, delete on public.documents, public.chat_history to service_role;
