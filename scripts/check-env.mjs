import { existsSync } from 'node:fs';
// Shell/hosting variables take precedence. Local files are never bundled.
for (const path of ['.env.local', '.env'])
  if (existsSync(path)) process.loadEnvFile(path);
const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
];
const invalid = required.filter((name) => !process.env[name]?.trim());
for (const name of ['SUPABASE_URL', 'UPSTASH_REDIS_REST_URL']) {
  try {
    if (new URL(process.env[name]).protocol !== 'https:') invalid.push(name);
  } catch {
    invalid.push(name);
  }
}
if (invalid.length) {
  console.error(
    `Missing or invalid configuration: ${[...new Set(invalid)].join(', ')}`,
  );
  process.exit(1);
}
console.log('Required service configuration is present.');
