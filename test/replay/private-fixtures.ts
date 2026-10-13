/** The approved lesson text (CC BY 4.0, founder-approved) is kept out of the public export.
 * Full tree: missing private fixtures is a hard failure (never a silent green).
 * Public export: a `PUBLIC_EXPORT` marker at the repo root, written by scripts/publish/export-public.ts, permits an explicit skip. */
import { existsSync } from 'node:fs';
const at = (p: string) => new URL(p, import.meta.url);
const present = existsSync(at('../../fixtures/eval/approved/lessons/L1.md')) && existsSync(at('./approved-answer-map.json'));
export function privateSkip(): string | false {
  if (present) return false;
  if (existsSync(at('../../PUBLIC_EXPORT'))) return 'needs the private approved lesson fixtures (not in the public export)';
  throw new Error('PRIVATE_FIXTURES_MISSING_IN_FULL_TREE');
}
