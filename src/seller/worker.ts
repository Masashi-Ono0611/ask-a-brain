/** Host mounts approved bundle only. This entry has no controller/key/store/chain imports. */
import type { SealedBundle } from '../wire/contracts.ts';
import type { PreparationConfig, SellerConfig } from './ports.ts';
import { prepareAnswer } from './preparation.ts';
export function createExtractiveWorker(bundle: SealedBundle, config: PreparationConfig): SellerConfig['worker'] {
  // Take ownership of bytes; subsequent caller mutation cannot alter approved output.
  const snapshot = { ...structuredClone(bundle), files: new Map([...bundle.files].map(([k, v]) => [k, Uint8Array.from(v)])) };
  return { async prepare(question, context, signal) {
    signal.throwIfAborted();
    const result = prepareAnswer(snapshot, question, context, config);
    signal.throwIfAborted(); return result;
  } };
}
