import { test } from 'node:test';
import assert from 'node:assert/strict';
import { functionBranches, goFunction, goStatements, moduleBranches, percentage, requireFloor } from './coverage.mjs';

test('Go merges duplicate blocks across test binaries without diluting uncovered statements', () => {
  assert.equal(goStatements('mode: atomic\na.go:1.1,2.1 2 0\na.go:1.1,2.1 2 1\na.go:3.1,4.1 2 0'), 50);
});
test('empty, malformed, non-atomic and conflicting Go reports fail closed', () => {
  for (const value of ['', 'mode: count\na.go:1.1,2.1 2 1', 'mode: atomic', 'mode: atomic\nbad', 'mode: atomic\na.go:1.1,2.1 2 1\na.go:1.1,2.1 3 0']) assert.throws(() => goStatements(value));
});
test('focused Go gates require the named function rather than a global or same-name substitute', () => {
  const summary = 'other.go:1: Read 100.0%\nsource.go:2: Read 89.9%';
  assert.equal(goFunction(summary, 'source.go', 'Read'), 89.9);
  assert.throws(() => requireFloor('Read', goFunction(summary, 'source.go', 'Read'), 90));
  assert.throws(() => goFunction(summary, 'missing.go', 'Read'));
});
test('publication measurement counts every nested decision and excludes unrelated UI branches', () => {
  const report = { 'C:\\app\\src\\editor.ts': { fnMap: { 0: { name: 'save', loc: { start: { line: 10 }, end: { line: 20 } } } },
    branchMap: { 0: { loc: { start: { line: 11 }, end: { line: 12 } } }, 1: { loc: { start: { line: 30 }, end: { line: 31 } } } }, b: { 0: [1, 0], 1: [1, 1] } } };
  assert.equal(functionBranches(report, 'src/editor.ts', 'save'), 50);
  assert.equal(moduleBranches(report, 'src/editor.ts'), 75);
  assert.throws(() => functionBranches(report, 'src/editor.ts', 'renamed'));
  assert.throws(() => functionBranches({}, 'src/editor.ts', 'save'));
});
test('thresholds reject missing counters and preserve the exact boundary', () => {
  assert.throws(() => percentage([])); assert.throws(() => percentage([NaN])); assert.throws(() => percentage([-1]));
  assert.throws(() => requireFloor('test', 89.99, 90));
  assert.match(requireFloor('test', 90, 90), /90.00/);
});
