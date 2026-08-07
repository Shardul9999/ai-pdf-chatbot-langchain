// PERF - remove before production
import fs from 'fs/promises';
import path from 'path';

const METRICS_FILE = path.join(process.cwd(), 'performance_metrics.json');

// Appends one metric entry to performance_metrics.json.
// Non-fatal — a write failure never crashes the request.
// NOTE: simple read-modify-write has a race condition under concurrent load;
// acceptable for local dev instrumentation.
export async function appendMetric(
  entry: Record<string, unknown>,
): Promise<void> {
  try {
    let existing: unknown[] = [];
    try {
      const raw = await fs.readFile(METRICS_FILE, 'utf-8');
      existing = JSON.parse(raw);
    } catch {
      // file doesn't exist yet — start with empty array
    }
    existing.push({ ts: new Date().toISOString(), ...entry });
    await fs.writeFile(
      METRICS_FILE,
      JSON.stringify(existing, null, 2),
      'utf-8',
    );
  } catch (err) {
    console.warn('[perf] Failed to write metric:', err); // PERF - remove before production
  }
}
