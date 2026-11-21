import { readChatEvents } from '@/lib/sse';

test('preserves JSON frames and multibyte UTF-8 split across every byte boundary', async () => {
  const expected = [
    {
      event: 'messages/partial',
      data: [{ type: 'ai', content: 'Hello 🌏 नमस्ते' }],
    },
    { event: 'messages', data: [] },
  ];
  const bytes = new TextEncoder().encode(
    expected.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''),
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const b of bytes) controller.enqueue(Uint8Array.of(b));
      controller.close();
    },
  });
  const events = [];
  for await (const event of readChatEvents(stream)) events.push(event);
  expect(events).toEqual(expected);
});

test('rejects truncated frames instead of silently dropping them', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"event":'));
      c.close();
    },
  });
  const consume = async () => {
    for await (const event of readChatEvents(stream)) void event;
  };
  await expect(consume()).rejects.toThrow('Incomplete response');
});
