// Test-only helper: reads sections of the applied Supabase migrations so database
// tests exercise the exact SQL that runs on the live backend.
import { readFile, readdir } from 'node:fs/promises';

const DIR = new URL('../../../supabase/migrations/', import.meta.url);

export async function migrationSection(start, end) {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, DIR), 'utf8');
    const from = sql.indexOf(start);
    if (from === -1) continue;
    const to = end ? sql.indexOf(end, from + start.length) : sql.length;
    if (to === -1) throw new Error(`Section end "${end}" not found in ${file}`);
    return sql.slice(from, to);
  }
  throw new Error(`Section "${start}" not found in supabase/migrations`);
}
