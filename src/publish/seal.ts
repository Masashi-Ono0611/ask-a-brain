import type { BundleInput, Clock, PublicDeployment, SealedBundle, SellerPublicKey, SellerSealSigner, ValidatedBundle } from '../wire/contracts.ts';
import { bytesHash, canonicalBytes, payloadHash, verifyEnvelope } from '../wire/index.ts';
import type { ApprovalAuthority, ReviewRow } from './review.ts';
import type { BundleScanner } from './scan.ts';
import { authorize, createReviewPacket } from './review.ts';
import { cloneInput, requirePublish, validateBundle, validateInput } from './validation.ts';
import { proposeListing } from './list.ts';

export interface PublisherConfig {
  readonly authority: ApprovalAuthority; readonly worksheet: readonly ReviewRow[];
  readonly scanner: BundleScanner; readonly signingKey: SellerPublicKey; readonly clock: Clock;
  readonly sealActor: 'human' | 'test';
}
/** Trusted composition only, never pass this config from candidate/HTTP/MCP input.
 * The public approval/hash record alone does not authenticate a human. */
export function createPublisher(config: PublisherConfig) {
  const authority = { ...config.authority }; const worksheet = structuredClone(config.worksheet);
  const signingKey = structuredClone(config.signingKey); const clock = config.clock;
  const scan = config.scanner.scan.bind(config.scanner); const actor = config.sealActor;
  requirePublish(actor === 'human' || (actor === 'test' && worksheet.every((r) => r.origin === 'synthetic')), 'TEST_SCOPE_REQUIRED');
  function current(input: BundleInput): ValidatedBundle {
    const snapshot = validateInput(input); const packet = createReviewPacket(snapshot, worksheet);
    const approval = authorize(snapshot, packet, authority, clock);
    const manifestBytes = canonicalBytes(snapshot.manifest);
    scan(new Map([['manifest.json', manifestBytes]]), [{ path: 'manifest.json', size_bytes: manifestBytes.length, sha256: bytesHash(manifestBytes) }]);
    const scans = scan(new Map([...snapshot.files].map(([p, b]) => [p, Uint8Array.from(b)])), structuredClone(snapshot.manifest.files));
    // Approval may be withdrawn or changed while the scanner runs.
    authorize(snapshot, packet, authority, clock);
    return validateBundle(snapshot, approval, scans);
  }
  const tickets = new WeakMap<object, string>();
  function fingerprint(bundle: ValidatedBundle): string { return payloadHash({ manifest: bundle.manifest, approval: bundle.approval, scans: bundle.scans }); }
  function scanAndValidate(input: BundleInput): ValidatedBundle {
    const bundle = current(input); tickets.set(bundle, fingerprint(bundle)); return bundle;
  }
  async function sealBundle(bundle: ValidatedBundle, signer: SellerSealSigner): Promise<SealedBundle> {
    requirePublish(tickets.get(bundle) === fingerprint(bundle), 'VALIDATION_TICKET_REQUIRED');
    validateBundle(bundle, bundle.approval, bundle.scans);
    const checked = current(bundle); const approvedHash = payloadHash(checked.manifest);
    const signature = await signer.sign('manifest', structuredClone(checked.manifest), {
      kind: 'manifest', payloadHash: approvedHash, approvalId: checked.approval.approval_id, actor,
    });
    requirePublish(payloadHash(signature.payload) === approvedHash, 'SIGNER_CHANGED_PAYLOAD');
    verifyEnvelope('manifest', signature, signingKey);
    authorize(checked, createReviewPacket(checked, worksheet), authority, clock);
    return { manifest: structuredClone(signature), files: cloneInput(checked).files, approval: checked.approval, scans: checked.scans };
  }
  function list(bundle: SealedBundle, deployment: PublicDeployment) {
    verifyEnvelope('manifest', bundle.manifest, signingKey);
    requirePublish(payloadHash(deployment.signing_key) === payloadHash(signingKey), 'DEPLOYMENT_KEY_MISMATCH');
    const checked = current({ manifest: bundle.manifest.payload, files: bundle.files });
    requirePublish(payloadHash(checked.approval) === payloadHash(bundle.approval), 'APPROVAL_MISMATCH');
    requirePublish(!worksheet.some((r) => r.origin === 'synthetic') || deployment.listing_kind === 'demo', 'SYNTHETIC_MUST_BE_DEMO');
    return proposeListing({ ...bundle, ...checked, manifest: bundle.manifest }, deployment);
  }
  return { scanAndValidate, sealBundle, proposeListing: list };
}
