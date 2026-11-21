jest.mock('@/lib/auth', () => ({ getCurrentUserId: jest.fn() }));
jest.mock('@/lib/ratelimit', () => ({ checkRateLimit: jest.fn() }));
import { getCurrentUserId } from '@/lib/auth';
import { checkRateLimit } from '@/lib/ratelimit';
import {
  authorize,
  apiError,
  readJson,
  readBody,
  filenameSchema,
  sessionSchema,
} from '@/lib/api';

beforeEach(() => {
  jest.mocked(getCurrentUserId).mockResolvedValue('owner');
  jest.mocked(checkRateLimit).mockResolvedValue({ success: true } as never);
});
test('rejects unauthenticated and cross-origin mutations', async () => {
  jest.mocked(getCurrentUserId).mockRejectedValue(new Error('Unauthorized'));
  await expect(
    authorize(new Request('https://app.test/api/chat'), 'chat'),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    authorize(
      new Request('https://app.test/api/chat', {
        method: 'POST',
        headers: { origin: 'https://other.test' },
      }),
      'chat',
    ),
  ).rejects.toMatchObject({ status: 403 });
});
test('limits by authenticated owner and operation', async () => {
  await authorize(new Request('https://app.test/api/chat'), 'chat');
  expect(checkRateLimit).toHaveBeenCalledWith('owner', 'chat');
  jest.mocked(checkRateLimit).mockResolvedValue({ success: false } as never);
  await expect(
    authorize(new Request('https://app.test/api/chat'), 'chat'),
  ).rejects.toMatchObject({ status: 429 });
});
test('rate limit service failures fail closed', async () => {
  jest
    .mocked(checkRateLimit)
    .mockRejectedValue(new Error('secret provider failure'));
  await expect(
    authorize(new Request('https://app.test/api/chat'), 'chat'),
  ).rejects.toThrow();
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const response = apiError(new Error('secret provider failure'));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('secret');
  spy.mockRestore();
});
test('enforces body limits even without Content-Length', async () => {
  const req = new Request('https://app.test', {
    method: 'POST',
    body: '12345',
  });
  await expect(readBody(req, 4)).rejects.toMatchObject({ status: 413 });
});
test('rejects malformed JSON and invalid identifiers', async () => {
  await expect(
    readJson(
      new Request('https://app.test', {
        method: 'POST',
        body: '{',
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  ).rejects.toMatchObject({ status: 400 });
  for (const name of ['../a.pdf', 'a\\b.pdf', 'a\r\nb.pdf', ''])
    expect(filenameSchema.safeParse(name).success).toBe(false);
  expect(filenameSchema.safeParse('研究.pdf').success).toBe(true);
  expect(sessionSchema.safeParse('a&user_id=other').success).toBe(false);
});
