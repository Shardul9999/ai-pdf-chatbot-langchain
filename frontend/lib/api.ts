import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUserId } from '@/lib/auth';
import { checkRateLimit, type RateLimitScope } from '@/lib/ratelimit';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const sessionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/);
export const filenameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (name) => !/[\x00-\x1f\x7f/\\]/.test(name) && name !== '.' && name !== '..',
    'Invalid filename',
  );

export async function authorize(req: Request, scope: RateLimitScope) {
  // Cookie-authenticated mutations must originate from this application.
  const origin = req.headers.get('origin');
  if (
    !['GET', 'HEAD'].includes(req.method) &&
    origin &&
    origin !== new URL(req.url).origin
  ) {
    throw new ApiError(403, 'Invalid request origin');
  }
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    throw new ApiError(401, 'Unauthorized');
  }
  const result = await checkRateLimit(userId, scope);
  if (!result.success)
    throw new ApiError(
      429,
      'Rate limit exceeded. Please try again in a minute.',
    );
  return userId;
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message },
      {
        status: error.status,
        headers: error.status === 429 ? { 'Retry-After': '60' } : undefined,
      },
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'Invalid request parameters' },
      { status: 400 },
    );
  }
  // Avoid logging provider payloads, document text, user input, or secrets.
  console.error('[api] Request failed', {
    type: error instanceof Error ? error.name : 'UnknownError',
  });
  return NextResponse.json(
    { error: 'Service temporarily unavailable. Please try again.' },
    { status: 503 },
  );
}

/** Count actual bytes, including chunked requests, before JSON/multipart parsing. */
export async function readBody(
  req: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length'));
  if (declared > maxBytes) throw new ApiError(413, 'Request is too large');
  if (!req.body) throw new ApiError(400, 'Request body is required');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, 'Request is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJson(req: Request): Promise<unknown> {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    throw new ApiError(415, 'Content-Type must be application/json');
  }
  const body = await readBody(req, 32 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new ApiError(400, 'Invalid JSON body');
  }
}
