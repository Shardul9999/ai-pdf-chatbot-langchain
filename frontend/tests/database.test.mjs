import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { readFileSync } from 'node:fs';

let db;
const embedding = JSON.stringify(Array(3072).fill(0.1));
const rows = (content) =>
  JSON.stringify([
    {
      content,
      metadata: { filename: 'notes.pdf', chunk_index: 0 },
      embedding: JSON.parse(embedding),
    },
  ]);
const replace = (owner, thread, content) =>
  db.query('select replace_documents($1, $2, $3::jsonb)', [
    owner,
    thread,
    rows(content),
  ]);
const migration = (name) =>
  readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );

before(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(
    'create role anon; create role authenticated; create role service_role bypassrls;',
  );
  for (const name of [
    '001_add_user_id_and_rls.sql',
    '002_add_thread_id.sql',
    '003_production_hardening.sql',
  ])
    await db.exec(migration(name));
});
after(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec('reset role; delete from documents; delete from chat_history;');
});

test('retrieval isolates owner and thread, and rejects missing scope', async () => {
  await replace('alice', 'one', 'Alice one');
  await replace('bob', 'one', 'Bob one');
  await replace('alice', 'two', 'Alice two');
  await db.exec('set role service_role');
  const result = await db.query(
    'select * from match_documents($1::vector, 5, $2::jsonb, $3, $4)',
    [embedding, '{}', 'alice', 'one'],
  );
  assert.deepEqual(
    result.rows.map((row) => row.content),
    ['Alice one'],
  );
  await assert.rejects(
    db.query(
      'select * from match_documents($1::vector, 5, $2::jsonb, null, null)',
      [embedding, '{}'],
    ),
    /Owner and thread/,
  );
});
for (const role of ['anon', 'authenticated'])
  test(`${role} cannot read tables or invoke service RPCs`, async () => {
    await replace('alice', 'one', 'Private');
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query('select * from documents'),
      /permission denied/,
    );
    await assert.rejects(
      db.query('select * from chat_history'),
      /permission denied/,
    );
    await assert.rejects(
      replace('alice', 'one', 'Attack'),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        'select * from match_documents($1::vector, 5, $2::jsonb, $3, $4)',
        [embedding, '{}', 'alice', 'one'],
      ),
      /permission denied/,
    );
  });
test('failed replacement rolls back deletion; successful replacement preserves other owners', async () => {
  await replace('alice', 'one', 'Original');
  await replace('bob', 'one', 'Bob');
  const malformed = JSON.stringify([
    {
      content: 'Replacement',
      metadata: { filename: 'notes.pdf' },
      embedding: [0.1],
    },
  ]);
  await assert.rejects(
    db.query('select replace_documents($1, $2, $3::jsonb)', [
      'alice',
      'one',
      malformed,
    ]),
  );
  assert.equal(
    (await db.query("select content from documents where user_id = 'alice'"))
      .rows[0].content,
    'Original',
  );
  await replace('alice', 'one', 'New');
  assert.deepEqual(
    (await db.query('select content from documents order by content')).rows.map(
      (r) => r.content,
    ),
    ['Bob', 'New'],
  );
});
test('bootstrap reruns preserve existing data', async () => {
  await replace('alice', 'one', 'Keep me');
  await db.exec(migration('001_add_user_id_and_rls.sql'));
  assert.equal(
    (await db.query('select content from documents')).rows[0].content,
    'Keep me',
  );
});
test('legacy permissive RPC overloads are removed', async () => {
  const result = await db.query(
    "select pronargs from pg_proc where proname = 'match_documents'",
  );
  assert.deepEqual(
    result.rows.map((r) => r.pronargs),
    [5],
  );
});

test('storage quota rejects excess uploads without altering existing rows', async () => {
  await db.exec(
    "insert into documents(user_id, thread_id, content, metadata) select 'alice', 'old', 'old text', '{\"filename\":\"old.pdf\"}'::jsonb from generate_series(1, 4000)",
  );
  await assert.rejects(
    replace('alice', 'new', 'Overflow'),
    /Document quota exceeded/,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from documents where user_id = 'alice'",
      )
    ).rows[0].count,
    4000,
  );
});
