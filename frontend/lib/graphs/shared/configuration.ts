/**
 * Shared configuration helpers for the in-process RAG pipeline.
 * Ported from backend/src/shared/configuration.ts.
 */

export type RetrieverProvider = 'supabase' | 'memory';

export interface BaseConfiguration {
  retrieverProvider: RetrieverProvider;
  k: number;
}

/**
 * Resolve runtime configuration with env-var-aware fallback.
 * Defaults to 'supabase'; falls back to 'memory' if Supabase env vars are absent.
 */
export function ensureBaseConfiguration(
  overrides: Partial<BaseConfiguration> = {},
): BaseConfiguration {
  const hasSupabaseKeys = !!(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const requestedProvider = overrides.retrieverProvider ?? 'supabase';

  const retrieverProvider: RetrieverProvider =
    requestedProvider === 'supabase' && !hasSupabaseKeys
      ? 'memory'
      : requestedProvider;

  return {
    retrieverProvider,
    k: overrides.k ?? 5,
  };
}
