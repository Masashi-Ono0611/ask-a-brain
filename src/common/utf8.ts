export interface Utf8Options { readonly forbidBom?: boolean }
/** Reject lone UTF-16 surrogates before TextEncoder can silently replace them. */
export function assertUnicodeScalars(text: string, options: Utf8Options = {}): void {
  if (typeof text !== 'string') throw new TypeError('INVALID_UNICODE');
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = text.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new TypeError('INVALID_UNICODE');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError('INVALID_UNICODE');
  }
  if ((options.forbidBom ?? true) && text.charCodeAt(0) === 0xfeff) throw new TypeError('UTF8_BOM_FORBIDDEN');
}
export function encodeUtf8(text: string, options: Utf8Options = {}): Uint8Array {
  assertUnicodeScalars(text, options);
  return new TextEncoder().encode(text);
}
export function decodeUtf8(bytes: Uint8Array, options: Utf8Options = {}): string {
  // ignoreBOM means preserve it, allowing explicit rejection instead of stripping.
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assertUnicodeScalars(text, options);
  return text;
}
