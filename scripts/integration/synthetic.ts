/** Public synthetic fixture ONLY. This is not founder content/scanner approval.
 * No keys are emitted; caller supplies ephemeral/test-only seal capabilities. */
import { M03, bytesHash, canonicalBytes, payloadHash, signEnvelope, parseWire, verifyEnvelope, verifyCitations, strictJson } from '../../src/wire/index.ts';
import { importCliKey, DEVNET_GENESIS, TOKEN_PROGRAM } from '../../src/chain/index.ts';
import { atomicFromBigint } from '../../src/common/index.ts';
import type { Address, AnswerMap, Clock, Id, Listing, Manifest, QuestionPolicy, SealedBundle, SellerSealSigner, SellerWire } from '../../src/wire/contracts.ts';
export const wire: SellerWire = { parse: parseWire, canonical: canonicalBytes, hash: payloadHash, verify: verifyEnvelope, citations: verifyCitations, json: strictJson };
export const id = (value: string): Id => value as Id;
export interface Addresses { buyer: Address; seller: Address; marketplace: Address; mint: Address; buyerAta: Address; sellerAta: Address; marketplaceAta: Address }
export function syntheticMarket(clock: Clock, addresses: Addresses, origins: readonly [string, string], sealKeys: readonly [Uint8Array, Uint8Array], content?: string) {
  const approval = bytesHash(Buffer.from('T11_SYNTHETIC_NOT_FOUNDER_APPROVAL'));
  const questions: QuestionPolicy = { v: 1, policy_id: id('gate1-questions'), approved_at: clock.now(), approval_sha256: approval,
    questions: ['Check completion evidence.', 'Check leftovers.', 'Unsupported approved question.'].map((text, i) => ({ question_id: id(`q${i}`), text, question_sha256: bytesHash(Buffer.from(text)), template_values: {}, topic: 'synthetic', allowed_origins: origins, allowed_networks: ['devnet'], approval_sha256: approval })) };
  const sellers = origins.map((origin, n) => {
    const key = importCliKey(sealKeys[n]!), keyId = id(`seal-${n}`), sellerId = id(`seller-${n}`), sliceId = id(`slice-${n}`);
    const signer: SellerSealSigner = { async sign(kind, payload, authorization) { return signEnvelope(kind, payload, keyId, key.key, authorization); } };
    const text = content ?? '確認してから完了と記録する。\nLimits: public synthetic test evidence only.\n';
    const pageBytes = Buffer.from(text);
    const pages = Array.from({ length: M03.slicePagesMin.value }, (_, i) => ({ page_id: id(`p${i}`), content_sha256: bytesHash(pageBytes), size_bytes: pageBytes.length }));
    const map: AnswerMap = { v: 1, engine_version: id('synthetic-extract-v1'), entries: questions.questions.map((q, i) => ({ question_id: q.question_id, question_sha256: q.question_sha256,
      support: n === 1 && i < 2 ? 'supported' : 'declined', spans: n === 1 && i < 2 ? [{ page_id: id('p0'), byte_start: 0, byte_end: pageBytes.length }] : [] })) };
    const files = new Map<string, Uint8Array>(pages.map(p => [`pages/${p.page_id}.md`, Uint8Array.from(pageBytes)]));
    files.set('question-policy.json', canonicalBytes(questions)); files.set('answer-map.json', canonicalBytes(map));
    const manifest: Manifest = { v: 1, seller_id: sellerId, slice_id: sliceId, created_at: clock.now(), gate_version: id('synthetic-gate1'), approval_id: id('synthetic-approval'), version: 1,
      previous_manifest_hash: null, policy_sha256: payloadHash(questions), pages, files: [...files].map(([path, data]) => ({ path, size_bytes: data.length, sha256: bytesHash(data) })).sort((a,b) => a.path < b.path ? -1 : 1) };
    const bundle: SealedBundle = { files, manifest: signEnvelope('manifest', manifest, keyId, key.key, { kind: 'manifest', actor: 'test', approvalId: manifest.approval_id, payloadHash: payloadHash(manifest) }),
      approval: { actor: 'human', approval_id: manifest.approval_id, payload_sha256: payloadHash(manifest), approved_at: clock.now() },
      scans: { bundle_sha256: payloadHash(manifest.files), scanner_version: 'SYNTHETIC_NOT_SCANNER_ACCEPTANCE', scanner_sha256: approval, scanned_at: clock.now(), passed: true } };
    const listing: Listing = { seller_id: sellerId, display_name: 'Synthetic Gate1 rehearsal', operator_id: id('same-test-operator'), listing_kind: 'demo', status: 'active', endpoint: origin, topics: ['synthetic'],
      signing_key: { id: keyId, algorithm: 'Ed25519', public_key: key.publicKey }, slice: { id: sliceId, manifest_sha256: payloadHash(manifest), manifest_url: `${origin}/v1/slices/${sliceId}/manifest`, approved_at: clock.now() },
      payment: { rail: 'solana-split-v1', network: 'devnet', genesis_hash: DEVNET_GENESIS, asset: 'TEST', mint: addresses.mint, token_program: TOKEN_PROGRAM, decimals: M03.tokenDecimals.value, total_atomic: atomicFromBigint(M03.totalAtomic.value), seller_owner: addresses.seller, seller_token_account: addresses.sellerAta, marketplace_owner: addresses.marketplace, marketplace_token_account: addresses.marketplaceAta, fee_bps: M03.marketplaceFeeBps.value } };
    return { bundle, listing, signer };
  });
  return { questions, sellers, registry: { v: 1 as const, registry_version: id('synthetic-registry'), listings: sellers.map(s => s.listing) } };
}
