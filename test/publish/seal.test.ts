import test from 'node:test';
import assert from 'node:assert/strict';
import { createBundleScanner, createPublisher, validateBundle } from '../../src/publish/index.ts';
import { M03, bytesHash, canonicalBytes, payloadHash } from '../../src/wire/index.ts';
import { approvalFor, clock, fakeEngine, fixture, harness, worksheet } from './helpers.ts';

test('scan alone and structurally valid forged approval cannot acquire a sealing ticket', async () => {
  const h = harness(); const scans = createBundleScanner(fakeEngine(), h.clock).scan(h.input.files, h.input.manifest.files);
  const forged = validateBundle(h.input, approvalFor(h.input).approval, scans);
  await assert.rejects(h.publisher.sealBundle(forged, h.signer), /VALIDATION_TICKET/); assert.equal(h.calls(), 0);
  const sealed = await h.publisher.sealBundle(h.publisher.scanAndValidate(h.input), h.signer);
  assert.equal(h.calls(), 1); assert.equal(sealed.manifest.payload.approval_id, h.input.manifest.approval_id);
});
for (const field of ['whole_page_download', 'rights_confirmed', 'origins_unchanged', 'originals_scan_passed', 'lineage_complete', 'withdrawn', 'review_sha256']) test(`protected ${field} denial cannot be overridden by scans; clean approval succeeds`, async () => {
  const h = harness(); const approval = approvalFor(h.input);
  const denied = { ...approval, [field]: field === 'withdrawn' ? true : field === 'review_sha256' ? h.input.manifest.policy_sha256 : false };
  const bytes = canonicalBytes(denied); const bad = createPublisher({ authority: { read: () => bytes, approvalBytesSha256: bytesHash(bytes) }, worksheet: worksheet(h.input), scanner: createBundleScanner(fakeEngine(), h.clock), signingKey: h.signingKey, clock: h.clock, sealActor: 'test' });
  assert.throws(() => bad.scanAndValidate(h.input), /AUTHORITY_DENIED/); assert.equal(h.calls(), 0);
  assert.ok(await h.publisher.sealBundle(h.publisher.scanAndValidate(h.input), h.signer));
});
test('changed or missing approval bytes block before signing, including whitespace-only edits', async () => {
  const h = harness(); const valid = h.publisher.scanAndValidate(h.input); const original = canonicalBytes(approvalFor(h.input));
  for (const bytes of [Buffer.concat([original, Buffer.from('\n')]), canonicalBytes({ ...approvalFor(h.input), approval: { ...approvalFor(h.input).approval, actor: 'human', payload_sha256: h.input.manifest.policy_sha256 } }), new Uint8Array()]) {
    h.changeApproval(bytes); await assert.rejects(h.publisher.sealBundle(valid, h.signer), /PROTECTED_APPROVAL_CHANGED/); assert.equal(h.calls(), 0);
  }
  h.changeApproval(original); assert.ok(await h.publisher.sealBundle(valid, h.signer));
});
test('changed approved metadata/files invalidate validation; restored bytes can seal', async () => {
  const h = harness(); const valid = h.publisher.scanAndValidate(h.input);
  const file = valid.files.get('pages/p1.md')!; const saved = file[0]!; file[0] = 65;
  await assert.rejects(h.publisher.sealBundle(valid, h.signer), /FILE_CHANGED/); file[0] = saved;
  const metadata = valid.manifest as { gate_version: string }; metadata.gate_version = 'changed';
  await assert.rejects(h.publisher.sealBundle(valid, h.signer), /VALIDATION_TICKET/); metadata.gate_version = h.input.manifest.gate_version;
  assert.equal(h.calls(), 0); assert.ok(await h.publisher.sealBundle(valid, h.signer));
});
test('stale/future acknowledgment and signature-time withdrawal block; restored fresh authority passes', async () => {
  const h = harness(); const valid = h.publisher.scanAndValidate(h.input);
  h.clock.advance(M03.lineageAcknowledgementMaxAge.value * 3600000 + 1);
  await assert.rejects(h.publisher.sealBundle(valid, h.signer), /STALE_AUTHORITY/); assert.equal(h.calls(), 0);
  const fresh = harness(); const ticket = fresh.publisher.scanAndValidate(fresh.input);
  await assert.rejects(fresh.publisher.sealBundle(ticket, { async sign(kind, payload, approval) {
    const signature = await fresh.signer.sign(kind, payload, approval); fresh.changeApproval(new Uint8Array()); return signature;
  } }), /PROTECTED_APPROVAL_CHANGED/);
  fresh.changeApproval(canonicalBytes(approvalFor(fresh.input))); assert.ok(await fresh.publisher.sealBundle(ticket, fresh.signer));
  const future = { ...approvalFor(fresh.input), acknowledged_at: '2099-01-01T00:00:00.000Z' };
  const bytes = canonicalBytes(future); const bad = createPublisher({ authority: { read: () => bytes, approvalBytesSha256: bytesHash(bytes) }, worksheet: worksheet(fresh.input), scanner: createBundleScanner(fakeEngine(), fresh.clock), signingKey: fresh.signingKey, clock: fresh.clock, sealActor: 'test' });
  assert.throws(() => bad.scanAndValidate(fresh.input), /STALE_AUTHORITY/); assert.ok(fresh.publisher.scanAndValidate(fresh.input));
});
test('signer payload substitution, wrong key and invalid signature are rejected; exact Ed25519 seal passes', async () => {
  const h = harness(); const other = harness(); const valid = h.publisher.scanAndValidate(h.input);
  await assert.rejects(h.publisher.sealBundle(valid, other.signer), /SIGNATURE/);
  await assert.rejects(h.publisher.sealBundle(valid, { async sign(kind, payload, approval) {
    const signed = await h.signer.sign(kind, payload, approval); return { ...signed, signature: { ...signed.signature, value: Buffer.alloc(64).toString('base64url') } };
  } }), /SIGNATURE/);
  await assert.rejects(h.publisher.sealBundle(valid, { async sign(kind, payload, approval) {
    const signed = await h.signer.sign(kind, payload, approval); return { ...signed, payload: { ...signed.payload, version: 2 } };
  } }), /SIGNER_CHANGED_PAYLOAD/);
  assert.ok(await h.publisher.sealBundle(valid, h.signer));
});
test('list stays suspended, requires repin, rechecks current authority and enforces demo/key identity', async () => {
  const h = harness(); const sealed = await h.publisher.sealBundle(h.publisher.scanAndValidate(h.input), h.signer);
  assert.throws(() => h.publisher.proposeListing(sealed, { ...h.deployment, listing_kind: 'independent' }), /DEMO/);
  assert.throws(() => h.publisher.proposeListing(sealed, { ...h.deployment, signing_key: harness().signingKey }), /KEY_MISMATCH/);
  const proposal = h.publisher.proposeListing(sealed, h.deployment);
  assert.equal(proposal.listing.status, 'suspended'); assert.equal(proposal.requires_human_repin, true); assert.equal(proposal.manifest_sha256, payloadHash(h.input.manifest));
  h.changeApproval(new Uint8Array()); assert.throws(() => h.publisher.proposeListing(sealed, h.deployment), /PROTECTED_APPROVAL_CHANGED/);
  h.changeApproval(canonicalBytes(approvalFor(h.input))); assert.deepEqual(h.publisher.proposeListing(sealed, h.deployment), proposal);
});
test('approval parsing rejects duplicate/unknown fields with clean protected counterpart', () => {
  const input = fixture(); const h0 = harness(input); const good = canonicalBytes(approvalFor(input));
  const malformed = [Buffer.from(Buffer.from(good).toString().replace('"v":1', '"v":1,"v":1')), canonicalBytes({ ...approvalFor(input), injected: true })];
  for (const bytes of malformed) {
    const p = createPublisher({ authority: { read: () => bytes, approvalBytesSha256: bytesHash(bytes) }, worksheet: worksheet(input), scanner: createBundleScanner(fakeEngine(), clock()), signingKey: h0.signingKey, clock: clock(), sealActor: 'test' });
    assert.throws(() => p.scanAndValidate(input)); assert.ok(h0.publisher.scanAndValidate(input));
  }
});
test('test signing cannot handle real-origin worksheet; clean synthetic scope still seals', async () => {
  const h = harness();
  assert.throws(() => createPublisher({ authority: h.authority, worksheet: worksheet(h.input).map((r) => ({ ...r, origin: 'personal-public' })), scanner: createBundleScanner(fakeEngine(), h.clock), signingKey: h.signingKey, clock: h.clock, sealActor: 'test' }), /TEST_SCOPE_REQUIRED/);
  assert.ok(await h.publisher.sealBundle(h.publisher.scanAndValidate(h.input), h.signer));
});
test('approval withdrawal during scanner execution blocks ticket issuance; restored approval passes', () => {
  const h = harness(); const scanner = createBundleScanner(fakeEngine(), h.clock);
  const changed = createPublisher({ authority: h.authority, worksheet: worksheet(h.input), scanner: { scan(files, inventory) { const result = scanner.scan(files, inventory); h.changeApproval(new Uint8Array()); return result; } }, signingKey: h.signingKey, clock: h.clock, sealActor: 'test' });
  assert.throws(() => changed.scanAndValidate(h.input), /PROTECTED_APPROVAL_CHANGED/); assert.equal(h.calls(), 0);
  h.changeApproval(canonicalBytes(approvalFor(h.input))); assert.ok(h.publisher.scanAndValidate(h.input));
});
