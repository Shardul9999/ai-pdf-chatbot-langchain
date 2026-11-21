import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export type RateLimitScope = 'chat' | 'ingest' | 'read' | 'delete';
const limits: Record<RateLimitScope, number> = {
  chat: 10,
  ingest: 3,
  read: 60,
  delete: 20,
};
const limiters = new Map<RateLimitScope, Ratelimit>();

export async function checkRateLimit(
  identifier: string,
  scope: RateLimitScope = 'chat',
) {
  // Lazy initialization allows build-time imports without runtime secrets.
  let limiter = limiters.get(scope);
  if (!limiter) {
    if (
      !process.env.UPSTASH_REDIS_REST_URL ||
      !process.env.UPSTASH_REDIS_REST_TOKEN
    ) {
      throw new Error('Rate limiter is not configured');
    }
    limiter = new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      }),
      limiter: Ratelimit.slidingWindow(limits[scope], '1 m'),
      prefix: `pdf-chatbot:${scope}`,
      analytics: false,
      timeout: 0, // Disable Upstash's fail-open timeout. Outages must reject work.
    });
    limiters.set(scope, limiter);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      limiter.limit(identifier),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Rate limit timeout')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
