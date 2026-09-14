import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function percentage(hits) {
  if (!hits.length || hits.some(hit => !Number.isSafeInteger(hit) || hit < 0)) throw new Error('Missing or invalid coverage counters');
  return hits.filter(hit => hit > 0).length * 100 / hits.length;
}

function sourceCoverage(report, suffix) {
  const files = Object.entries(report).filter(([path]) => path.replaceAll('\\', '/').endsWith('/' + suffix));
  if (files.length !== 1) throw new Error(`Expected one covered source: ${suffix}`);
  return files[0][1];
}

export function moduleBranches(report, suffix) {
  return percentage(Object.values(sourceCoverage(report, suffix).b).flat());
}

export function functionBranches(report, suffix, name) {
  const data = sourceCoverage(report, suffix);
  const functions = Object.values(data.fnMap).filter(fn => fn.name === name);
  if (functions.length !== 1) throw new Error(`Expected one function: ${suffix}:${name}`);
  const range = functions[0].loc;
  const hits = Object.entries(data.branchMap).filter(([, branch]) =>
    branch.loc.start.line >= range.start.line && branch.loc.end.line <= range.end.line,
  ).flatMap(([id]) => data.b[id]);
  return percentage(hits);
}

export function goStatements(profile) {
  const [mode, ...lines] = profile.trim().split(/\r?\n/);
  if (mode !== 'mode: atomic') throw new Error('An atomic Go coverage profile is required');
  const blocks = new Map();
  for (const line of lines) {
    const match = /^(\S+:\d+\.\d+,\d+\.\d+) (\d+) (\d+)$/.exec(line);
    if (!match) throw new Error('Malformed Go coverage block');
    const [, location, count, hits] = match;
    const statements = Number(count), covered = Number(hits) > 0;
    if (!Number.isSafeInteger(statements) || !Number.isSafeInteger(Number(hits))) throw new Error('Invalid Go counter');
    const previous = blocks.get(location);
    if (previous && previous.statements !== statements) throw new Error('Conflicting duplicate coverage block');
    blocks.set(location, { statements, covered: covered || previous?.covered });
  }
  let total = 0, covered = 0;
  for (const block of blocks.values()) { total += block.statements; if (block.covered) covered += block.statements; }
  if (!total) throw new Error('Empty Go coverage profile');
  return covered * 100 / total;
}

export function goFunction(summary, source, name) {
  const entries = summary.split(/\r?\n/).map(line => /^(\S+):\d+:\s+(\S+)\s+(\d+(?:\.\d+)?)%$/.exec(line))
    .filter(match => match && match[1] === source && match[2] === name);
  if (entries.length !== 1) throw new Error(`Expected one Go function: ${source}:${name}`);
  const value = Number(entries[0][3]);
  if (value > 100) throw new Error('Invalid Go percentage');
  return value;
}

export function requireFloor(name, value, floor) {
  if (!Number.isFinite(value) || value < floor) throw new Error(`${name}: ${value.toFixed(2)}% is below ${floor}%`);
  return `${name}: ${value.toFixed(2)}% >= ${floor}%`;
}

function main(kind, directory) {
  if (!directory || !['frontend', 'backend'].includes(kind)) throw new Error('Usage: node tools/quality/coverage.mjs frontend|backend REPORT_DIRECTORY');
  const read = file => readFileSync(resolve(directory, file), 'utf8');
  if (kind === 'frontend') {
    const report = JSON.parse(read('coverage-final.json'));
    for (const name of ['resource-query', 'search-query', 'search-results', 'use-resource-page', 'use-search-page', 'post-editor', 'editor-preview', 'editor-recovery-store', 'use-editor-recovery', 'editor-navigation', 'use-editor-router']) {
      console.log(requireFloor(`${name} branches`, moduleBranches(report, `src/lib/${name}.ts`), 90));
    }
    console.log(requireFloor('Article save/publication branches', functionBranches(report, 'src/components/EditorPageClient.tsx', 'handleSave'), 90));
  } else {
    console.log(requireFloor('All Go statements', goStatements(read('coverage.out')), 68));
    const summary = read('coverage-summary.txt');
    for (const [source, names] of [
      ['internal/search/query.go', ['Query', 'Read']],
      ['internal/searchtext/text.go', ['Extract']],
      ['internal/handlers/posts.go', ['mutatePost']],
      ['internal/migrations/post_versions.go', ['addPostVersions']],
    ]) for (const name of names) console.log(requireFloor(`${source}:${name} statements`, goFunction(summary, `blog-backend/${source}`, name), 90));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(...process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
