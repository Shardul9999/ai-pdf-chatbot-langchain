begin;
-- Applies to existing installations as well as the safe bootstrap.
alter table public.documents enable row level security;
alter table public.chat_history enable row level security;
revoke all on public.documents, public.chat_history from public, anon, authenticated;
grant select, insert, update, delete on public.documents, public.chat_history to service_role;
create index if not exists documents_owner_thread_idx on public.documents(user_id, thread_id);
create index if not exists history_owner_session_time_idx on public.chat_history(user_id, session_id, created_at desc, id desc);

-- Remove permissive legacy overloads, including the original three-argument RPC.
drop function if exists public.match_documents(vector, integer, jsonb);
drop function if exists public.match_documents(vector, integer, jsonb, text);
drop function if exists public.match_documents(vector, integer, jsonb, text, text);
create function public.match_documents(
  query_embedding vector(3072), match_count integer, filter jsonb,
  p_user_id text, p_thread_id text
) returns table (id uuid, content text, metadata jsonb, similarity float)
language plpgsql security invoker set search_path = public, extensions, pg_temp as $$
begin
  if p_user_id is null or length(p_user_id) = 0 or p_thread_id is null or length(p_thread_id) = 0 then
    raise exception 'Owner and thread are required';
  end if;
  if match_count is null or match_count < 1 or match_count > 20 then
    raise exception 'Invalid result limit';
  end if;
  return query select d.id, d.content, d.metadata, 1 - (d.embedding <=> query_embedding)
    from public.documents d
    where d.user_id = p_user_id and d.thread_id = p_thread_id and d.metadata @> coalesce(filter, '{}')
    order by d.embedding <=> query_embedding limit match_count;
end;
$$;
revoke all on function public.match_documents(vector, integer, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.match_documents(vector, integer, jsonb, text, text) to service_role;

-- Replacement and quota checks share one transaction. Concurrent uploads for an
-- owner serialize, so a failure rolls back deletion as well as every inserted row.
create or replace function public.replace_documents(p_user_id text, p_thread_id text, p_rows jsonb)
returns void language plpgsql security invoker set search_path = public, extensions, pg_temp as $$
declare existing_count bigint;
begin
  if p_user_id is null or length(p_user_id) = 0 or p_thread_id is null or length(p_thread_id) = 0 then
    raise exception 'Owner and thread are required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Invalid rows'; end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 400 then raise exception 'Invalid row count'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where
    coalesce(length(r->>'content'), 0) = 0 or length(r->>'content') > 1000 or
    coalesce(length(r->'metadata'->>'filename'), 0) = 0 or length(r->'metadata'->>'filename') > 200 or
    jsonb_typeof(r->'embedding') is distinct from 'array'
  ) then raise exception 'Invalid document'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 0));
  delete from public.documents d where d.user_id = p_user_id and d.thread_id = p_thread_id
    and d.metadata->>'filename' in (select r->'metadata'->>'filename' from jsonb_array_elements(p_rows) r);
  select count(*) into existing_count from public.documents where user_id = p_user_id;
  if existing_count + jsonb_array_length(p_rows) > 4000 then raise exception 'Document quota exceeded'; end if;
  insert into public.documents(user_id, thread_id, content, metadata, embedding)
    select p_user_id, p_thread_id, r->>'content', r->'metadata', (r->>'embedding')::vector(3072)
    from jsonb_array_elements(p_rows) r;
end;
$$;
revoke all on function public.replace_documents(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_documents(text, text, jsonb) to service_role;
commit;
