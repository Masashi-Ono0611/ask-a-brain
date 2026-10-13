import type { BundleInput, Clock, Id, IsoTime, PublicApproval, Sha256 } from '../wire/contracts.ts';
import { M03, bytesHash, canonicalBytes, payloadHash, strictJson } from '../wire/index.ts';
import { decodeUtf8 } from '../common/index.ts';
import { hash, id, record, requirePublish, time, validateInput } from './validation.ts';

/** Local worksheet uses an opaque reference instead of private lineage contents.
 * Founder maintains the actual nonempty evidence map outside this process. */
export interface ReviewRow {
  readonly page_id: Id;
  readonly visibility: 'public'; readonly origin: 'personal-public' | 'synthetic'; readonly sensitivity: 'none';
  readonly review_status: 'approved'; readonly derived_from: 'founder-private-map';
  readonly reviewer: Id; readonly last_reviewed: IsoTime; readonly license: 'CC BY 4.0'; readonly right_to_sell: Id;
}
export interface ReviewPacket {
  readonly v: 1; readonly kind: 'inert-review-only'; readonly manifest_sha256: Sha256; readonly inventory_sha256: Sha256;
  readonly manifest: BundleInput['manifest']; readonly worksheet: readonly ReviewRow[];
  readonly public_files: readonly { readonly path: string; readonly sha256: Sha256; readonly utf8: string }[];
  readonly whole_page_download: true; readonly self_review_disclosed: true;
  readonly limitations: 'Scans are not consent. English/Japanese markers are incomplete. Founder must read all bytes, verify rights and maintain private lineage; copied public bytes cannot be recalled.';
}
export function createReviewPacket(input: BundleInput, worksheet: readonly ReviewRow[]): ReviewPacket {
  const snapshot = validateInput(input);
  requirePublish(worksheet.length === snapshot.manifest.pages.length, 'WORKSHEET_INVENTORY');
  const seen = new Set<string>();
  for (const row of worksheet) {
    record(row, ['page_id', 'visibility', 'origin', 'sensitivity', 'review_status', 'derived_from', 'reviewer', 'last_reviewed', 'license', 'right_to_sell']);
    id(row.page_id); id(row.reviewer); id(row.right_to_sell); time(row.last_reviewed);
    requirePublish(!seen.has(row.page_id) && snapshot.manifest.pages.some((p) => p.page_id === row.page_id), 'WORKSHEET_INVENTORY'); seen.add(row.page_id);
    requirePublish(row.visibility === 'public' && ['personal-public', 'synthetic'].includes(row.origin) && row.sensitivity === 'none' && row.review_status === 'approved' && row.derived_from === 'founder-private-map' && row.license === 'CC BY 4.0', 'PROHIBITED_ORIGIN_OR_RIGHTS');
  }
  return { v: 1, kind: 'inert-review-only', manifest_sha256: payloadHash(snapshot.manifest), inventory_sha256: payloadHash(snapshot.manifest.files), manifest: snapshot.manifest,
    worksheet: structuredClone([...worksheet].sort((a, b) => a.page_id < b.page_id ? -1 : a.page_id > b.page_id ? 1 : 0)),
    public_files: snapshot.manifest.files.map((f) => ({ path: f.path, sha256: f.sha256, utf8: decodeUtf8(snapshot.files.get(f.path)!) })),
    whole_page_download: true, self_review_disclosed: true,
    limitations: 'Scans are not consent. English/Japanese markers are incomplete. Founder must read all bytes, verify rights and maintain private lineage; copied public bytes cannot be recalled.' };
}
/** Plain text, never Markdown/HTML: escape markup, terminal controls and bidi.
 * Decoding JSON string literals recovers exact bytes; hashes always bind originals. */
export function inertText(value: unknown): Uint8Array {
  const text = new TextDecoder().decode(canonicalBytes(value));
  return Buffer.from(text.replace(/[<>&\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) + '\n');
}
/** NOT a wire artifact. Protected operator-only approval record; never put this
 * beside candidate files or accept its pin from candidate/MCP arguments. */
export interface PublisherApproval {
  readonly v: 1; readonly approval: PublicApproval; readonly review_sha256: Sha256;
  readonly whole_page_download: true; readonly rights_confirmed: true; readonly origins_unchanged: true;
  readonly originals_scan_passed: true; readonly lineage_complete: true;
  readonly withdrawn: false; readonly acknowledged_at: IsoTime;
}
export interface ApprovalAuthority {
  readonly approvalBytesSha256: Sha256;
  /** Must read current protected bytes every time. Missing/changed is denial. */
  readonly read: () => Uint8Array;
}
export function authorize(input: BundleInput, packet: ReviewPacket, authority: ApprovalAuthority, clock: Clock): PublicApproval {
  hash(authority.approvalBytesSha256); const bytes = Uint8Array.from(authority.read());
  requirePublish(bytesHash(bytes) === authority.approvalBytesSha256, 'PROTECTED_APPROVAL_CHANGED');
  const row = record(strictJson(bytes, { integerNumbersOnly: true }), ['v', 'approval', 'review_sha256', 'whole_page_download', 'rights_confirmed', 'origins_unchanged', 'originals_scan_passed', 'lineage_complete', 'withdrawn', 'acknowledged_at']);
  requirePublish(row.v === 1 && row.review_sha256 === payloadHash(packet) && row.whole_page_download === true && row.rights_confirmed === true && row.origins_unchanged === true && row.originals_scan_passed === true && row.lineage_complete === true && row.withdrawn === false, 'APPROVAL_AUTHORITY_DENIED');
  time(row.acknowledged_at); time(clock.now());
  const age = Date.parse(clock.now()) - Date.parse(String(row.acknowledged_at));
  requirePublish(age >= -M03.clockSkewMax.value * 1000 && age <= M03.lineageAcknowledgementMaxAge.value * 3600000, 'STALE_AUTHORITY');
  const approval = record(row.approval, ['approval_id', 'payload_sha256', 'approved_at', 'actor']);
  id(approval.approval_id); hash(approval.payload_sha256); time(approval.approved_at);
  requirePublish(approval.actor === 'human' && approval.approval_id === input.manifest.approval_id && approval.payload_sha256 === payloadHash(input.manifest) && Date.parse(String(approval.approved_at)) <= Date.parse(clock.now()) + M03.clockSkewMax.value * 1000, 'APPROVAL_MISMATCH');
  return approval as unknown as PublicApproval;
}
