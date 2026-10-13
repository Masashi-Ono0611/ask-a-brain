/** Testable ceremony port. The CLI never accepts a terminal/approval override. */
import type { HumanHelperConfig, SignJournal } from '../../src/chain/index.ts';
import type { SignRequest, SignResult, Signature } from '../../src/wire/contracts.ts';
import { HumanSigningHelper, handleHumanSignerMessage, attachSignature, validateSignRequest, validateLegacyMessage } from '../../src/chain/index.ts';
import { bytesHash, canonicalBytes, strictJson } from '../../src/wire/index.ts';
import { FoundationError } from '../../src/common/index.ts';

export function requestBytes(request: SignRequest): Uint8Array {
  return canonicalBytes({ ...request, message: Buffer.from(request.message).toString('base64') });
}
export function readRequest(bytes: Uint8Array): SignRequest {
  const row = strictJson(bytes) as unknown as SignRequest & { message: string };
  if (!row || typeof row.message !== 'string') throw new Error('INVALID_REQUEST');
  const message = Buffer.from(row.message, 'base64');
  if (message.toString('base64') !== row.message) throw new Error('INVALID_BASE64');
  const request = { ...row, message }; validateSignRequest(request); return request;
}
export interface CeremonyEvidence {
  messageHash: string; signature: string; tty: boolean; exactPhrase: boolean;
  substituted_message_sha256: string; substitution_refused: boolean; substitution_signatures: number;
}
export function validateCeremonyEvidence(request: SignRequest, human: CeremonyEvidence, signature: Signature): void {
  if (!human || Object.keys(human).sort().join(',') !== 'exactPhrase,messageHash,signature,substituted_message_sha256,substitution_refused,substitution_signatures,tty' ||
      human.tty!==true||human.exactPhrase!==true||human.substitution_refused!==true||human.substitution_signatures!==0 ||
      human.signature!==signature||human.messageHash!==request.messageHash||!/^[a-f0-9]{64}$/.test(human.substituted_message_sha256)||human.substituted_message_sha256===request.messageHash)throw new Error('HUMAN_LIVE_EVIDENCE_REQUIRED');
}
/** Recovery never invokes sign or key loading, even if the previous reply was lost. */
export function recoverCeremony(request: SignRequest, journal: SignJournal, evidence: CeremonyEvidence | null): SignResult | null {
  const result=journal.read(request.requestId,request.messageHash);
  if(result?.status==='signed') {
    if(!evidence)throw new Error('MISSING_ORIGINAL_TTY_EVIDENCE');
    validateCeremonyEvidence(request,evidence,result.signature);
    const expected=validateSignRequest(request);
    attachSignature({message:request.message,messageHash:request.messageHash,expected,decoded:validateLegacyMessage(request.message,expected)},result);
  }
  return result;
}
export function createCeremony(request: SignRequest, config: HumanHelperConfig) {
  const frozen = readRequest(requestBytes(request)); const digest = bytesHash(requestBytes(frozen));
  let typed = false, tty = false, loads = 0;
  const helper = new HumanSigningHelper({ ...config,
    terminal: { isTTY: () => config.terminal.isTTY(), async approve(display) {
      tty = config.terminal.isTTY();
      const answer = await config.terminal.approve(`Fee payer: ${frozen.expectedPayer}\n${display}`);
      typed = tty && answer === `approve ${frozen.messageHash}`; return answer;
    } },
    keyBytes: async () => {
      // Conservative adapter: once key loading starts, any later failure stays
      // on original-message recovery, including expiry during the loader.
      if (!config.journal.begin) throw new FoundationError('NOT_READY');
      config.journal.begin(frozen); loads++; return config.keyBytes();
    },
    authorize: async (input, expected) => {
      if (bytesHash(requestBytes(input)) !== digest) throw new FoundationError('PAYMENT_INVALID');
      await config.authorize(input, expected);
    },
  });
  return { helper, async sign(): Promise<{ result: SignResult; evidence: CeremonyEvidence | null }> {
    let result: SignResult;
    try { result = await helper.sign(frozen); }
    catch (error) {
      if (error instanceof Error && error.message === 'EXPIRED_BEFORE_APPROVAL') {
        if (!config.journal.expired) throw new FoundationError('PAYMENT_UNCERTAIN');
        config.journal.expired(frozen); // Throws after any possible signing attempt.
      }
      throw error;
    }
    if (result.status !== 'signed') return { result, evidence: null };
    const expected = validateSignRequest(frozen);
    attachSignature({ message: frozen.message, messageHash: frozen.messageHash, expected, decoded: validateLegacyMessage(frozen.message, expected) }, result);
    // Deliberately reach the helper's IPC parser, bypassing client-side validation.
    const changed = Uint8Array.from(frozen.message); changed[changed.length - 1]! ^= 1;
    const before = loads;
    const reply = strictJson(await handleHumanSignerMessage(canonicalBytes({ operation: 'sign', value: { ...frozen, message: Buffer.from(changed).toString('base64') } }), helper));
    const refused = JSON.stringify(reply) === JSON.stringify({ ok: false, result: null });
    if (!refused || loads !== before) throw new Error('SUBSTITUTION_NOT_REFUSED');
    return { result, evidence: { messageHash: frozen.messageHash, signature: result.signature, tty, exactPhrase: typed,
      substituted_message_sha256: bytesHash(changed), substitution_refused: true, substitution_signatures: 0 } };
  } };
}
