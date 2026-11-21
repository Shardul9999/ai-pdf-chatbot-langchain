import { createEmbeddings } from '@/lib/graphs/shared/retrieval';
const realFetch = global.fetch;
beforeEach(() => {
  process.env.GOOGLE_API_KEY = 'test-key';
});
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.GOOGLE_API_KEY;
});
test('embeds in order with a cancellable authenticated request', async () => {
  const controller = new AbortController();
  const first = Array(3072).fill(0.1),
    second = Array(3072).fill(0.2);
  const mockFetch = jest
    .fn()
    .mockResolvedValue(
      Response.json({ embeddings: [{ values: first }, { values: second }] }),
    );
  global.fetch = mockFetch;
  expect(
    await createEmbeddings(controller.signal).embedDocuments([
      'first',
      'second',
    ]),
  ).toEqual([first, second]);
  const init = mockFetch.mock.calls[0][1];
  expect(init.headers['x-goog-api-key']).toBe('test-key');
  expect(
    JSON.parse(init.body).requests.map(
      (r: { content: { parts: { text: string }[] } }) =>
        r.content.parts[0].text,
    ),
  ).toEqual(['first', 'second']);
  controller.abort();
  expect(init.signal.aborted).toBe(true);
});
test('rejects provider errors and missing or mismatched vectors', async () => {
  for (const result of [
    {},
    { embeddings: [{ values: [] }] },
    { embeddings: [{ values: Array(3072).fill('bad') }] },
  ]) {
    global.fetch = jest.fn().mockResolvedValue(Response.json(result));
    await expect(createEmbeddings().embedQuery('question')).rejects.toThrow(
      'Invalid embedding response',
    );
  }
  global.fetch = jest
    .fn()
    .mockResolvedValue(new Response('secret details', { status: 429 }));
  await expect(createEmbeddings().embedQuery('question')).rejects.toThrow(
    'Embedding service unavailable',
  );
});
