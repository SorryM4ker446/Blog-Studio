import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOutdated } from './check-outdated.mjs';

test('ordinary newer versions are information while execution failures remain failures', () => {
  assert.equal(checkOutdated({}, 0), 0);
  assert.equal(checkOutdated({ library: { current: '1.0.0', wanted: '1.0.1', latest: '2.0.0' } }, 1), 1);
  for (const [report, status] of [[{}, 1], [{ error: { code: 'ENETUNREACH' } }, 1], [[], 0], [{ library: {} }, 1], [{}, 2]]) assert.throws(() => checkOutdated(report, status));
});
