import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeUtf8, decodeUtf8, assertUnicodeScalars } from '../../src/common/index.ts';
test('UTF-8 round-trips exact bytes and does not normalize composed/decomposed text', () => {
  for (const text of ['', 'hello', '日本語 🧠', 'e\u0301', '\u00e9', 'a\ufeffb']) assert.equal(decodeUtf8(encodeUtf8(text)), text);
  assert.notDeepEqual(encodeUtf8('e\u0301'), encodeUtf8('\u00e9'));
});
test('strict UTF-8 rejects overlong, truncated, surrogate and out-of-range sequences', () => {
  for (const bytes of [[0x80], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xff]]) assert.throws(() => decodeUtf8(Uint8Array.from(bytes)));
  for (const text of ['\ud800', '\udfff', 'x\ud800x', '\udc00\ud800']) {
    assert.throws(() => encodeUtf8(text)); assert.throws(() => assertUnicodeScalars(text));
  }
});
test('wire BOM rejected by default and preserved only with explicit allowance', () => {
  const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]);
  assert.throws(() => decodeUtf8(bytes), /BOM/); assert.throws(() => encodeUtf8('\ufeffa'), /BOM/);
  assert.equal(decodeUtf8(bytes, { forbidBom: false }), '\ufeffa');
  assert.deepEqual(encodeUtf8('\ufeffa', { forbidBom: false }), bytes);
});
