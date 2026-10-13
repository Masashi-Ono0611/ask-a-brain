import type { ListingProposal, PublicDeployment, SealedBundle } from '../wire/contracts.ts';
import { parseWire, payloadHash, validateWire, verifyEnvelope } from '../wire/index.ts';
import { guardText, record, validateBundle } from './validation.ts';
/** Pure proposal only. For current protected approval/rights use the same method
 * on createPublisher. No registry, network, filesystem or activation capability. */
export function proposeListing(bundle: SealedBundle, deployment: PublicDeployment): ListingProposal {
  record(deployment, ['endpoint', 'operator_id', 'listing_kind', 'payment', 'signing_key']);
  validateBundle({ manifest: bundle.manifest.payload, files: bundle.files }, bundle.approval, bundle.scans);
  verifyEnvelope('manifest', bundle.manifest, deployment.signing_key);
  const manifest = bundle.manifest.payload; const manifest_sha256 = payloadHash(manifest);
  const policy = parseWire('question_policy', bundle.files.get('question-policy.json')!);
  const topics = [...new Set(policy.questions.map((q) => q.topic))].sort();
  topics.forEach((topic) => guardText(Buffer.from(topic), true));
  const listing = validateWire('listing', { seller_id: manifest.seller_id, display_name: `${deployment.listing_kind === 'demo' ? 'Synthetic demo ' : ''}${manifest.seller_id}`,
    operator_id: deployment.operator_id, listing_kind: deployment.listing_kind, status: 'suspended', endpoint: deployment.endpoint,
    topics, signing_key: deployment.signing_key, slice: { id: manifest.slice_id, manifest_sha256, manifest_url: `${deployment.endpoint}/v1/slices/${manifest.slice_id}/manifest`, approved_at: bundle.approval.approved_at }, payment: deployment.payment });
  return { listing, manifest_sha256, requires_human_repin: true };
}
