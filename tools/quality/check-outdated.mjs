import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkOutdated(report, status) {
  if (![0, 1].includes(status) || !report || Array.isArray(report) || typeof report !== 'object' || 'error' in report) throw new Error('Dependency version lookup failed');
  const entries = Object.values(report);
  if (status === 1 && !entries.length) throw new Error('Version lookup failed without a report');
  if (entries.some(value => !value || typeof value.current !== 'string' || typeof value.wanted !== 'string' || typeof value.latest !== 'string')) throw new Error('Invalid dependency version report');
  return entries.length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(`${checkOutdated(JSON.parse(readFileSync(process.argv[2], 'utf8')), Number(process.argv[3]))} dependencies have newer versions (information only)`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
