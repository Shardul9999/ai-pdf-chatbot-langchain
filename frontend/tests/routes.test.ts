jest.mock('@/lib/auth', () => ({
  getCurrentUserId: jest.fn().mockResolvedValue('owner-a'),
}));
jest.mock('@/lib/ratelimit', () => ({
  checkRateLimit: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('@/lib/server-db', () => ({
  getDatabase: jest.fn(),
  requireEnv: jest.fn().mockReturnValue('test-key'),
}));
jest.mock('@/lib/graphs/shared/retrieval', () => ({
  retrieveDocuments: jest.fn(),
  createEmbeddings: jest.fn(),
  EMBEDDING_DIMENSIONS: 3072,
}));
jest.mock('@/lib/pdf', () => ({ processPDF: jest.fn() }));
jest.mock('@langchain/groq', () => ({ ChatGroq: jest.fn() }));
import { getDatabase } from '@/lib/server-db';
import {
  retrieveDocuments,
  createEmbeddings,
} from '@/lib/graphs/shared/retrieval';
import { processPDF } from '@/lib/pdf';
import { ChatGroq } from '@langchain/groq';
import { POST as chat } from '@/app/api/chat/route';
import { POST as ingest } from '@/app/api/ingest/route';
import { GET as history } from '@/app/api/history/route';
import { GET as documents, DELETE as remove } from '@/app/api/documents/route';
import { GET as download } from '@/app/api/documents/download/route';
import { Document } from '@langchain/core/documents';

const query = () => {
  const builder: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'eq',
    'order',
    'limit',
    'range',
    'or',
    'abortSignal',
    'delete',
    'insert',
  ])
    builder[method] = jest.fn().mockReturnValue(builder);
  builder.then = jest.fn((resolve) =>
    resolve({ data: [], error: null, count: 1 }),
  );
  return builder;
};
let builder: ReturnType<typeof query>;
let rpc: jest.Mock;
beforeEach(() => {
  builder = query();
  rpc = jest.fn().mockReturnValue(builder);
  jest.mocked(getDatabase).mockReturnValue({
    from: jest.fn().mockReturnValue(builder),
    rpc,
  } as never);
  jest.mocked(retrieveDocuments).mockResolvedValue([]);
  jest.mocked(ChatGroq).mockImplementation(
    () =>
      ({
        stream: async function* () {
          yield { content: 'Answer' };
        },
      }) as never,
  );
});
const request = (body: unknown) =>
  new Request('https://app.test/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
test.each([
  {},
  null,
  { message: 12, threadId: 'thread-a' },
  { message: ' ', threadId: 'thread-a' },
  { message: 'x'.repeat(8001), threadId: 'thread-a' },
  { message: 'x', threadId: 'a', sessionId: 'b' },
])('rejects invalid chat input %j', async (body) => {
  expect((await chat(request(body))).status).toBe(400);
  expect(retrieveDocuments).not.toHaveBeenCalled();
});
test('chat scopes retrieval and history, loads newest turns, persists before completion', async () => {
  const response = await chat(
    request({ message: 'Question', threadId: 'thread-a' }),
  );
  const text = await response.text();
  expect(text).toContain('"event":"messages"');
  expect(retrieveDocuments).toHaveBeenCalledWith(
    'owner-a',
    'thread-a',
    'Question',
    expect.any(AbortSignal),
  );
  expect(builder.eq).toHaveBeenCalledWith('user_id', 'owner-a');
  expect(builder.eq).toHaveBeenCalledWith('session_id', 'thread-a');
  expect(builder.order).toHaveBeenCalledWith('created_at', {
    ascending: false,
  });
  expect(builder.insert).toHaveBeenCalledWith([
    expect.objectContaining({ user_id: 'owner-a', role: 'user' }),
    expect.objectContaining({
      user_id: 'owner-a',
      role: 'assistant',
      content: 'Answer',
    }),
  ]);
});
test('failed history writes emit an error and never a success event', async () => {
  builder.insert.mockImplementation(() => {
    builder.then.mockImplementation((resolve) =>
      resolve({ error: { message: 'db private details' } }),
    );
    return builder;
  });
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const text = await (
    await chat(request({ message: 'Question', threadId: 'thread-a' }))
  ).text();
  expect(text).toContain('"event":"error"');
  expect(text).not.toContain('"event":"messages"');
  expect(text).not.toContain('db private');
  spy.mockRestore();
});
test.each([history, documents, download])(
  'read routes isolate every query by authenticated owner',
  async (handler) => {
    await handler(
      new Request(
        'https://app.test/api?sessionId=thread-a&threadId=thread-a&filename=notes.pdf',
      ),
    );
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'owner-a');
  },
);
test('delete requires owner, thread and filename together', async () => {
  const res = await remove(
    new Request('https://app.test/api/documents', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: 'thread-a', filename: 'notes.pdf' }),
    }),
  );
  expect(res.status).toBe(200);
  expect(builder.eq.mock.calls).toEqual([
    ['user_id', 'owner-a'],
    ['thread_id', 'thread-a'],
    ['metadata->>filename', 'notes.pdf'],
  ]);
});
function upload() {
  const form = new FormData();
  form.append('threadId', 'thread-a');
  form.append(
    'files',
    new File(['%PDF-test'], 'notes.pdf', { type: 'application/pdf' }),
  );
  return new Request('https://app.test/api/ingest', {
    method: 'POST',
    body: form,
  });
}
test('rejects an invalid embedding without shifting or storing vectors', async () => {
  jest.mocked(processPDF).mockResolvedValue([
    new Document({
      pageContent: 'Text',
      metadata: { filename: 'notes.pdf' },
    }),
  ]);
  jest.mocked(createEmbeddings).mockReturnValue({
    embedDocuments: jest.fn().mockResolvedValue([[]]),
  } as never);
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  expect((await ingest(upload())).status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
  spy.mockRestore();
});
test('stores a validated upload through one atomic owner-scoped RPC', async () => {
  jest.mocked(processPDF).mockResolvedValue([
    new Document({
      pageContent: 'Text',
      metadata: { filename: 'notes.pdf' },
    }),
  ]);
  jest.mocked(createEmbeddings).mockReturnValue({
    embedDocuments: jest.fn().mockResolvedValue([Array(3072).fill(0.1)]),
  } as never);
  expect((await ingest(upload())).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith(
    'replace_documents',
    expect.objectContaining({
      p_user_id: 'owner-a',
      p_thread_id: 'thread-a',
      p_rows: [
        expect.objectContaining({
          content: 'Text',
          metadata: expect.objectContaining({
            filename: 'notes.pdf',
            chunk_index: 0,
          }),
        }),
      ],
    }),
  );
});
