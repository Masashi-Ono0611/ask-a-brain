import { z } from 'zod';
import type { Address, Atomic, GenesisHash, Id, IsoTime, Lamports, Sha256, Signature, Uuid } from './contracts.ts';
import { M03 } from './constants.ts';
import { decodeBase58, decodeBase64url } from './encoding.ts';
import { scalarString } from './json.ts';

function accepts(body: () => unknown): boolean { try { body(); return true; } catch { return false; } }
export const text = z.string().refine((s) => accepts(() => scalarString(s)), 'INVALID_UNICODE');
export const nonempty = text.refine((s) => s.length > 0, 'EMPTY_TEXT');
export const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const id = nonempty.refine((s) => s.split('/').every((p) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(p)), 'INVALID_ID').transform((s) => s as Id);
export const hash = z.string().regex(/^[a-f0-9]{64}$/).transform((s) => s as Sha256);
export const address = z.string().refine((s) => accepts(() => decodeBase58(s, 32)), 'INVALID_ADDRESS').transform((s) => s as Address);
// Frozen RPC identifier syntax; decoded public-key width belongs only to address.
export const genesis = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'INVALID_GENESIS').transform((s) => s as GenesisHash);
export const chainSignature = z.string().refine((s) => accepts(() => decodeBase58(s, 64)), 'INVALID_SIGNATURE').transform((s) => s as Signature);
export const nonce = z.string().refine((s) => accepts(() => decodeBase64url(s, 16)), 'INVALID_NONCE');
export const sealSignature = z.string().refine((s) => accepts(() => decodeBase64url(s, 64)), 'INVALID_SIGNATURE');
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/).transform((s) => s as Uuid);
export const time = z.string().refine((s) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)) return false;
  const value = Date.parse(s); return Number.isFinite(value) && new Date(value).toISOString() === s.replace(/(?<!\.\d{3})Z$/, '.000Z');
}, 'INVALID_TIME').transform((s) => s as IsoTime);
const amount = z.string().regex(/^(0|[1-9][0-9]{0,19})$/).refine((s) => /^(0|[1-9][0-9]{0,19})$/.test(s) && BigInt(s) < (1n << 64n), 'INVALID_AMOUNT');
export const atomic = amount.transform((s) => s as Atomic);
export const lamports = amount.transform((s) => s as Lamports);
export const network = z.enum(['devnet', 'mainnet-beta']);
export const question = nonempty.refine((s) => Buffer.byteLength(s) <= M03.questionBytesMax.value * 1024 && [...s].length <= M03.questionScalarsMax.value, 'QUESTION_LIMIT');
export const path = nonempty.refine((s) => s.split('/').every((p) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(p)), 'INVALID_PATH');
/** Syntax only. DNS resolution, enrolled loopback exceptions and egress are caller policy. */
export function parsedUrl(s: string): URL | null {
  try {
    const url = new URL(s);
    if (url.username || url.password || url.hash || url.href !== s || /[\\\s]/.test(s)) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) return null;
    for (const segment of url.pathname.split('/')) {
      const decoded = decodeURIComponent(segment);
      if (decoded === '..' || decoded === '.' || /[\\\x00-\x1f]/.test(decoded)) return null;
    }
    return url;
  } catch { return null; }
}
export const url = nonempty.refine((s) => parsedUrl(s) !== null, 'INVALID_URL');
export const origin = nonempty.refine((s) => {
  const u = parsedUrl(`${s}/`); return u !== null && u.origin === s;
}, 'INVALID_ORIGIN');
export const templateValues = z.record(z.string().refine((s) => id.safeParse(s).success && !['__proto__', 'constructor', 'prototype'].includes(s)), text).refine((r) => !Object.keys(r).some((k) => ['__proto__', 'constructor', 'prototype'].includes(k)), 'INVALID_TEMPLATE_KEY');
export function unique(values: readonly unknown[]): boolean { return new Set(values).size === values.length; }
export function sorted(values: readonly string[]): boolean { return values.every((v, i) => i === 0 || values[i - 1]! < v); }
export function issue(context: z.RefinementCtx, ok: boolean, message: string): void { if (!ok) context.addIssue({ code: 'custom', message }); }
