import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalBytes, decodeBase58, decodeBase64url, encodeBase58, strictJson } from '../../src/wire/index.ts';
const bytes = (s: string) => Buffer.from(s);

test('RFC 8785 serialization numbers, escapes and UTF-16 property ordering', () => {
  const input = strictJson(bytes('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\"/","literals":[null,true,false]}'));
  assert.equal(Buffer.from(canonicalBytes(input)).toString(), '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\"/"}');
  const ordered = { '\u20ac': 'Euro Sign', '\r': 'Carriage Return', '\ufb33': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' };
  assert.equal(Buffer.from(canonicalBytes(ordered)).toString(), '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}');
  assert.equal(Buffer.from(canonicalBytes([-0, 1e-6, 1e-7])).toString(), '[0,0.000001,1e-7]');
});
for (const [label, bad] of Object.entries({
  duplicate: '{"a":1,"a":2}', escaped_duplicate: '{"a":1,"\\u0061":2}', nested_duplicate: '{"x":[{"日本":1,"\\u65e5本":2}]}', prototype_duplicate: '{"__proto__":1,"__proto__":2}',
  comment: '{/* no */"a":1}', trailing_comma: '{"a":1,}', trailing_value: '{}{}', missing_value: '{"a":}', empty: '', plus_number: '[+1]', leading_zero: '[01]', infinity: '[1e400]', nan: '[NaN]',
  lone_high_surrogate: '{"a":"\\ud800"}', lone_low_surrogate: '{"a":"\\udfff"}', surrogate_key: '{"\\ud800":1}', bom: '\ufeff{}',
})) test(`strict JSON rejects ${label}; restored clean input passes`, () => {
  assert.throws(() => strictJson(bytes(bad)));
  assert.deepEqual(strictJson(bytes('{"a":"日本🧠","x":[{"a":1},{"a":2}]}')), { a: '日本🧠', x: [{ a: 1 }, { a: 2 }] });
});
for (const bad of [[0xff], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]]) test(`invalid UTF-8 ${bad.join('-')} has a positive control`, () => {
  assert.throws(() => strictJson(Uint8Array.from([34, ...bad, 34])), /INVALID_UTF8/);
  assert.equal(strictJson(bytes('"🧠"')), '🧠');
});
test('canonicalization rejects lossy JS inputs without invoking getters or toJSON', () => {
  let calls = 0;
  const cycle: unknown[] = []; cycle.push(cycle);
  const getter = Object.defineProperty({}, 'a', { enumerable: true, get() { calls++; return 1; } });
  const sparse = new Array(2); sparse[1] = 1;
  const extra = [1]; Object.assign(extra, { extra: 2 });
  const bad = [undefined, NaN, Infinity, 1n, () => 1, Symbol('x'), new Date(), Buffer.from('x'), { a: undefined }, { toJSON() { calls++; return 1; } }, getter, cycle, sparse, extra, { [Symbol('x')]: 1 }, { a: '\ud800' }, { '\udfff': 1 }, Object.defineProperty({}, 'hidden', { value: 1 })];
  for (const input of bad) { assert.throws(() => canonicalBytes(input)); assert.equal(Buffer.from(canonicalBytes({ a: [null, true, '日本'] })).toString(), '{"a":[null,true,"日本"]}'); }
  assert.equal(calls, 0);
  assert.notDeepEqual(canonicalBytes('e\u0301'), canonicalBytes('é'));
  const object = strictJson(bytes('{"__proto__":{"polluted":true}}'));
  assert.equal(Buffer.from(canonicalBytes(object)).toString(), '{"__proto__":{"polluted":true}}');
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});
test('representation codecs reject lengths, alphabets and noncanonical pad bits; clean round trips', () => {
  for (const size of [16, 32, 64]) {
    const input = Buffer.alloc(size, 3); const encoded = encodeBase58(input);
    assert.deepEqual(decodeBase58(encoded, size), Uint8Array.from(input));
    for (const bad of ['', '0', ` ${encoded}`, `${encoded}0`, encodeBase58(Buffer.alloc(size + 1))]) assert.throws(() => decodeBase58(bad, size));
    assert.deepEqual(decodeBase64url(input.toString('base64url'), size), input);
    for (const bad of ['', input.toString('base64url') + '=', '*', Buffer.alloc(size + 1).toString('base64url')]) assert.throws(() => decodeBase64url(bad, size));
  }
  assert.throws(() => decodeBase64url('AAAAAAAAAAAAAAAAAAAAAB', 16));
  assert.equal(decodeBase64url('AAAAAAAAAAAAAAAAAAAAAA', 16).length, 16);
  assert.deepEqual(decodeBase58('1'.repeat(32), 32), new Uint8Array(32));
});
