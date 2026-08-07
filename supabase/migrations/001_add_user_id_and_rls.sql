-- Drop existing tables (dev data only, confirmed acceptable)
drop table if exists documents cascade;
drop table if exists chat_history cascade;

-- documents table with user_id
create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  content text,
  metadata jsonb,
  embedding vector(3072)
);

create index documents_user_id_idx on documents(user_id);

-- match_documents function with user_id filter
create or replace function match_documents (
  query_embedding vector(3072),
  match_count int DEFAULT null,
  filter jsonb DEFAULT '{}',
  p_user_id text DEFAULT null
) returns table (id uuid, content text, metadata jsonb, similarity float)
language plpgsql as $$
#variable_conflict use_column
begin
  return query
  select id, content, metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where metadata @> filter
    and (p_user_id is null or documents.user_id = p_user_id)
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- chat_history table with user_id
create table chat_history (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  session_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb,
  created_at timestamptz default now()
);

create index chat_history_user_id_idx on chat_history(user_id);
create index chat_history_session_id_idx on chat_history(session_id);

-- Enable RLS
alter table documents enable row level security;
alter table chat_history enable row level security;

-- Service role bypass policies (primary auth gate is Clerk in Next.js API routes)
create policy "service_role full access" on documents
  for all using (auth.role() = 'service_role');
create policy "service_role full access" on chat_history
  for all using (auth.role() = 'service_role');
