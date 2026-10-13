import test from 'node:test';
import assert from 'node:assert/strict';
import type { Id } from '../../src/wire/contracts.ts';
import type { LogRecord } from '../../src/common/index.ts';
import { createLogger, FixedClock, FoundationError, transportError } from '../../src/common/index.ts';
test('logger allows only IDs, fixed codes and safe counters; never exception text', () => {
  const lines: string[] = []; const log = createLogger(new FixedClock('2026-10-09T00:00:00Z'), (line) => lines.push(line));
  log({ code: 'CHECK_PASSED', ids: { consult_id: 'c_1' as Id }, counters: { attempts: 1 } });
  assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]!).counters.attempts, 1);
  for (const record of [
    { code: 'CHECK_PASSED', body: 'not allowed' }, { code: 'remote prose' },
    { code: 'CHECK_PASSED', ids: { token: 'not allowed' } },
    { code: 'CHECK_PASSED', ids: { consult_id: 'bad\ncontrol' } },
    { code: 'CHECK_PASSED', counters: { attempts: NaN } },
  ]) assert.throws(() => log(record as unknown as LogRecord));
  assert.equal(lines.length, 1);
  assert.deepEqual(transportError(new Error('private body')), { code: 'INTERNAL_ERROR', retryable: false, consult_id: null, message: 'INTERNAL_ERROR' });
  assert.equal(transportError(new FoundationError('NOT_READY')).code, 'NOT_READY');
});
