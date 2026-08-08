import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export const rateLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  analytics: true,
  prefix: 'pdf-chatbot',
});

export async function checkRateLimit(
  identifier: string,
): Promise<{ success: boolean; limit: number; remaining: number }> {
  try {
    return await rateLimiter.limit(identifier);
  } catch (err) {
    console.error('[ratelimit] Upstash unreachable, failing open:', err);
    return { success: true, limit: 0, remaining: 0 };
  }
}
