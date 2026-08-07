-- Scope documents to the chat thread they were uploaded in, so "New chat"
-- gives a clean document context instead of retrieving every PDF the user
-- has ever uploaded. Additive only — existing rows keep working (thread_id
-- is nullable; null means "no thread filter", i.e. matches nothing new but
-- doesn't break the column).

alter table documents add column if not exists thread_id text;

create index if not exists documents_thread_id_idx on documents(thread_id);

create or replace function match_documents (
  query_embedding vector(3072),
  match_count int DEFAULT null,
  filter jsonb DEFAULT '{}',
  p_user_id text DEFAULT null,
  p_thread_id text DEFAULT null
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
    and (p_thread_id is null or documents.thread_id = p_thread_id)
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;
