import { createHash, generateKeyPairSync, sign, verify, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import canonicalize from 'canonicalize';
import { parseTree, getNodeValue } from 'jsonc-parser';
import type { Node as JsonNode, ParseError } from 'jsonc-parser';
import { z } from 'zod';
import { openStore, FixedClock, decodeUtf8, encodeUtf8, FoundationError } from '../../src/common/index.ts';
import { M03 } from '../../src/wire/constants.ts';
import type { Address, AnswerContext, Atomic, BuyerContext, FinalizedTransaction, Id, IsoTime, JsonValue, Manifest, QuoteRequest, Revocation, RpcClient, SealedBundle, Sha256, Signature, Signed, SignedKind, SignedTypes, Uuid, WireTypes } from '../../src/wire/contracts.ts';
import type { SellerDependencies, SellerWire, SellerConfig } from '../../src/seller/index.ts';
import { createSellerService, createExtractiveWorker, createSellerHandler } from '../../src/seller/index.ts';
import { jsonValue } from '../../src/seller/ports.ts';

export const hash = (value: Uint8Array | string): Sha256 => createHash('sha256').update(value).digest('hex') as Sha256;
export const bytes = (value: unknown): Uint8Array => encodeUtf8(canonicalize(value)!);
export const payloadHash = (value: unknown): Sha256 => hash(bytes(value));
const id = z.string().regex(/^[A-Za-z0-9_-]+$/); const sha = z.string().regex(/^[a-f0-9]{64}$/); const amount = z.string().regex(/^(0|[1-9][0-9]*)$/); const network = z.enum(['devnet', 'mainnet-beta']);
const quoteRequest = z.object({ v: z.literal(1), request_id: z.string().uuid(), request_nonce: id, buyer_id: id, payer: id, seller_id: id, registry_version: id, slice_id: id, network,
  question: z.string().refine((s) => encodeUtf8(s).length <= M03.questionBytesMax.value * 1024 && [...s].length <= M03.questionScalarsMax.value), max_total_atomic: amount }).strict();
const armRequest = z.object({ quote_id: id, message_base64: z.string(), message_sha256: sha, recent_blockhash: id, last_valid_block_height: z.number().int().nonnegative() }).strict();
const proof = z.object({ v: z.literal(1), consult_id: id, quote_id: id, quote_sha256: sha, arm_ticket_sha256: sha, network, genesis_hash: id, transaction_signature: id, message_sha256: sha }).strict();
const policy = z.object({ v: z.literal(1), policy_id: id, approved_at: z.string().datetime(), approval_sha256: sha, questions: z.array(z.object({ question_id: id, text: z.string(), question_sha256: sha, template_values: z.record(z.string()), topic: z.string(), allowed_origins: z.array(z.string()), allowed_networks: z.array(network), approval_sha256: sha }).strict()) }).strict();
export function strictJson(raw: Uint8Array): unknown {
  const text = decodeUtf8(raw); const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || errors.length) throw new FoundationError('INVALID_INPUT');
  const visit = (node: JsonNode): void => {
    if (node.type === 'object') {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children?.[0]?.value as string;
        if (keys.has(key)) throw new FoundationError('INVALID_INPUT'); keys.add(key);
      }
    }
    if (node.type === 'string') encodeUtf8(node.value as string, { forbidBom: false });
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree); return getNodeValue(tree) as unknown;
}
export function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'aab-seller-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'seller.db'); let store = openStore(path); t.after(() => store.close());
  const clock = new FixedClock('2026-10-09T00:00:00.000Z');
  const origin = 'https://seller.invalid'; const key = generateKeyPairSync('ed25519');
  let seals = 0; let preparations = 0; let scans = 0; let rpcReads = 0; let mode: 'pending' | 'confirmed' | 'finalized' | 'failure' | 'invalid' | 'throw' = 'pending';
  const seal = <K extends SignedKind>(kind: K, payload: SignedTypes[K]): Signed<SignedTypes[K]> => ({ payload, signature: { key_id: 'test-seal' as Id, algorithm: 'Ed25519', value: sign(null, Buffer.concat([Buffer.from(`ask-a-brain/v1/${kind}\n`), bytes(payload)]), key.privateKey).toString('base64url') } });
  const wire: SellerWire = {
    canonical: bytes, hash: payloadHash, json: strictJson,
    parse(kind, raw) {
      const schemas = { quote_request: quoteRequest, arm_request: armRequest, proof, question_policy: policy };
      if (!(kind in schemas)) throw new Error('TEST_WIRE_KIND_UNSUPPORTED');
      return schemas[kind as keyof typeof schemas].parse(strictJson(raw)) as unknown as WireTypes[typeof kind];
    },
    verify(kind, envelope, publicKey) {
      if (publicKey.id !== envelope.signature.key_id || envelope.signature.algorithm !== 'Ed25519' || !verify(null, Buffer.concat([Buffer.from(`ask-a-brain/v1/${kind}\n`), bytes(envelope.payload)]), key.publicKey, Buffer.from(envelope.signature.value, 'base64url'))) throw new FoundationError('VERIFICATION_FAILED');
    },
    citations(answer, manifest, pages) {
      for (const citation of answer.payload.citations) {
        const page = pages.get(citation.page_id); const declared = manifest.payload.pages.find((p) => p.page_id === citation.page_id);
        if (!page || !declared || hash(page) !== citation.content_sha256 || citation.content_sha256 !== declared.content_sha256 || decodeUtf8(page.subarray(citation.byte_start, citation.byte_end)) !== citation.excerpt) throw new FoundationError('VERIFICATION_FAILED');
      }
    },
  };
  const content = encodeUtf8('確認してから完了と記録する。\nLimits: this is a synthetic example.\n');
  const pages = Array.from({ length: M03.slicePagesMin.value }, (_, i) => ({ page_id: `p${i + 1}` as Id, size_bytes: content.length, content_sha256: hash(content) }));
  const questions = Array.from({ length: 10 }, (_, i) => ({ question_id: `q${i}` as Id, text: `Synthetic question ${i}?`, question_sha256: hash(`Synthetic question ${i}?`), template_values: {}, topic: 'testing', allowed_origins: [origin], allowed_networks: ['devnet'] as const, approval_sha256: hash('synthetic-approval') }));
  const questionPolicy = { v: 1 as const, policy_id: 'policy' as Id, approved_at: clock.now(), approval_sha256: hash('synthetic-approval'), questions };
  const answerMap = { v: 1 as const, engine_version: 'extract-v1' as Id, entries: questions.map((q, i) => ({ question_id: q.question_id, question_sha256: q.question_sha256, support: i < 8 ? 'supported' as const : 'declined' as const, spans: i < 8 ? [{ page_id: 'p1' as Id, byte_start: 0, byte_end: content.length }] : [] })) };
  const files = new Map<string, Uint8Array>(pages.map((p) => [`pages/${p.page_id}.md`, Uint8Array.from(content)])); files.set('question-policy.json', bytes(questionPolicy)); files.set('answer-map.json', bytes(answerMap));
  const manifest: Manifest = { v: 1, seller_id: 'seller' as Id, slice_id: 'slice' as Id, created_at: clock.now(), gate_version: 'gate' as Id, approval_id: 'approval' as Id, version: 1, previous_manifest_hash: null, policy_sha256: payloadHash(questionPolicy), pages,
    files: [...files].map(([path, data]) => ({ path, size_bytes: data.length, sha256: hash(data) })).sort((a, b) => a.path.localeCompare(b.path)) };
  const bundle: SealedBundle = { manifest: seal('manifest', manifest), files, approval: { approval_id: manifest.approval_id, payload_sha256: payloadHash(manifest), approved_at: clock.now(), actor: 'human' }, scans: { bundle_sha256: payloadHash(manifest.files), scanner_version: 'synthetic-scanner', scanner_sha256: hash('scanner'), scanned_at: clock.now(), passed: true } };
  const buyer: BuyerContext = { buyer_id: 'buyer' as Id, payer: 'payer' as Address, session_id: 'session' as Id }; const other: BuyerContext = { buyer_id: 'other' as Id, payer: 'other-payer' as Address, session_id: 'other-session' as Id };
  const token = randomUUID(); const otherToken = randomUUID();
  let journal: Revocation[] = []; let journalError = false; let authorityError = false; let generation = 0; let acknowledged = clock.now();
  const rpc: RpcClient = {
    async genesis() { return 'genesis' as Address; }, async latestBlockhash() { return { blockhash: 'blockhash' as Address, lastValidBlockHeight: 100, observedAt: clock.now() }; },
    async finalizedHeight() { return 1; }, async feeForMessage() { return '1' as never; }, async accounts() { return { slot: 1, observedAt: clock.now(), accounts: [] }; },
    async signatureStatus(signature) { return { signature, status: mode === 'confirmed' ? 'confirmed' : mode === 'pending' ? 'absent' : 'finalized', slot: 1, err: null, observedAt: clock.now() }; },
    async finalizedTransaction(signature) { rpcReads++; if (mode === 'throw') throw new Error('RPC_OFFLINE'); if (mode === 'pending' || mode === 'confirmed') return null; return { signature, slot: 1 } as FinalizedTransaction; },
    async broadcastIdentical() { throw new Error('NO_BROADCAST_CAPABILITY'); },
  };
  const config: SellerConfig = {
    rpcOrigins: ['https://one.invalid', 'https://two.invalid'], origin, limits: M03, wire, registryVersion: 'registry' as Id, sealActor: 'test',
    listing: { seller_id: manifest.seller_id, display_name: 'Synthetic seller', operator_id: 'same-founder' as Id, listing_kind: 'demo', status: 'active', endpoint: origin, topics: ['testing'], signing_key: { id: 'test-seal' as Id, algorithm: 'Ed25519', public_key: 'test-key-is-ephemeral' as Address }, slice: { id: manifest.slice_id, manifest_sha256: payloadHash(manifest), manifest_url: `${origin}/v1/slices/slice/manifest`, approved_at: clock.now() },
      payment: { rail: 'solana-split-v1', network: 'devnet', genesis_hash: 'genesis' as Address, asset: 'TEST', mint: 'mint' as Address, decimals: 6, token_program: 'token-program' as Address, total_atomic: M03.totalAtomic.value.toString() as Atomic, seller_owner: 'seller-owner' as Address, seller_token_account: 'seller-ata' as Address, marketplace_owner: 'market-owner' as Address, marketplace_token_account: 'market-ata' as Address, fee_bps: M03.marketplaceFeeBps.value } },
    invitations: [{ origin, buyer, token_sha256: hash(token) }, { origin, buyer: other, token_sha256: hash(otherToken) }],
    async authority() { if (authorityError) throw new Error('AUTHORITY_OFFLINE'); return { generation, acknowledged_at: acknowledged, tombstones_sha256: payloadHash([...journal].sort((a, b) => `${a.slice_id}:${a.manifest_sha256}`.localeCompare(`${b.slice_id}:${b.manifest_sha256}`))) }; },
    clockSkewMs() { return 0; },
    payerAccounts(context) { return { payer: context.payer, tokenAccount: `${context.payer}-ata` as Address }; },
    validateMessage(message, expected) {
      if (decodeUtf8(message) !== `synthetic:${expected.quote.payload.quote_id}:${expected.payer.payer}` || hash(message) !== expected.messageHash) throw new FoundationError('PAYMENT_INVALID');
      return { payer: expected.payer, accountKeys: [], instructions: [], recentBlockhash: expected.blockhash.blockhash, memo: expected.quote.payload.memo };
    },
    async reconcile(expected, signature, primary, secondary) {
      const [a, b] = await Promise.all([primary.finalizedTransaction(signature), secondary.finalizedTransaction(signature)]);
      if (!a || !b) return { status: 'pending', reason: 'PAYMENT_UNCERTAIN' };
      if (mode === 'failure') return { status: 'finalized_failure', actualFee: '1' as never, transaction: a };
      return { status: 'finalized_success', evidence: { genesis: expected.quote.payload.genesis_hash, signature, quote_id: expected.quote.payload.quote_id, message_sha256: expected.messageHash, slot: 1, observed_at: clock.now(), commitment: 'finalized', meta_err: null, actual_fee: '1' as never, payer_debit: expected.quote.payload.total_atomic, seller_credit: mode === 'invalid' ? '1' as Atomic : expected.quote.payload.seller_atomic, marketplace_credit: expected.quote.payload.fee_atomic, transaction_sha256: hash('synthetic-transaction') } };
    },
    worker: { async prepare(question, context, signal) { preparations++; return createExtractiveWorker(bundle, config).prepare(question, context, signal); } },
    async scanOutput() { scans++; },
  };
  const deps: SellerDependencies = { bundle, store, clock, config, primaryRpc: Object.assign(rpc, { origin: 'https://one.invalid' }), secondaryRpc: { ...rpc, origin: 'https://two.invalid' } as RpcClient,
    signer: { async sign(kind, payload, approval) { if (approval.payloadHash !== payloadHash(payload)) throw new Error('INVALID_APPROVAL'); seals++; return seal(kind, payload); } },
    tombstones: { async readAll() { if (journalError) throw new Error('JOURNAL_OFFLINE'); return structuredClone(journal); }, async append(revocation) { if (journalError) throw new Error('JOURNAL_OFFLINE'); if (!journal.some((r) => r.manifest_sha256 === revocation.manifest_sha256)) journal.push(revocation); generation = Math.max(generation, revocation.generation); } },
  };
  let service = createSellerService(deps);
  return {
    directory, path, clock, bundle, config, deps, buyer, other, token, otherToken, questions, answerMap, wire, seal,
    get service() { return service; }, get store() { return store; }, get counts() { return { seals, preparations, scans, rpcReads }; },
    setMode(value: typeof mode) { mode = value; }, setJournalError(value: boolean) { journalError = value; }, setAuthorityError(value: boolean) { authorityError = value; },
    setAcknowledged(value: IsoTime) { acknowledged = value; }, setJournal(value: Revocation[]) { journal = value; },
    request(index = 0, context = buyer): QuoteRequest { return { v: 1, request_id: randomUUID() as Uuid, request_nonce: 'request-nonce', buyer_id: context.buyer_id, payer: context.payer, seller_id: manifest.seller_id, registry_version: config.registryVersion, slice_id: manifest.slice_id, network: 'devnet', question: questions[index]!.text, max_total_atomic: M03.totalAtomic.value.toString() as Atomic }; },
    context(): AnswerContext { return { quote_id: 'quote' as Id, buyer_id: buyer.buyer_id, created_at: clock.now(), commitment_salt: 'synthetic-salt' }; },
    revocation(): Revocation { return { slice_id: manifest.slice_id, manifest_sha256: payloadHash(manifest), generation: generation + 1, revoked_at: clock.now(), reason: 'safety', approval_id: 'withdrawal' as Id }; },
    async restart(dbPath = path) { store.close(); store = openStore(dbPath); service = createSellerService({ ...deps, store }); await service.start(); return service; },
    handler() { return createSellerHandler(service, wire, M03, config.origin); },
  };
}
export async function settle<T>(f: ReturnType<typeof fixture>, pending: Promise<T>): Promise<T> {
  let done = false; void pending.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 100 && !done; i++) { await new Promise<void>((r) => setImmediate(r)); f.clock.advance(100); }
  return pending;
}
export async function purchase(f: ReturnType<typeof fixture>, request = f.request()) {
  const disposition = await settle(f, f.service.quote(f.buyer, request)); if (disposition.status !== 'ready') throw new Error('EXPECTED_READY');
  const quote = disposition.quote;
  const message = encodeUtf8(`synthetic:${quote.payload.quote_id}:${f.buyer.payer}`);
  const armInput = { quote_id: quote.payload.quote_id, message_base64: Buffer.from(message).toString('base64'), message_sha256: hash(message), recent_blockhash: 'blockhash' as Address, last_valid_block_height: 100 };
  const arm = await f.service.arm(f.buyer, armInput);
  const proofLocator = { v: 1 as const, consult_id: 'consult' as Id, quote_id: quote.payload.quote_id, quote_sha256: payloadHash(quote.payload), arm_ticket_sha256: payloadHash(arm.payload), network: 'devnet' as const, genesis_hash: quote.payload.genesis_hash, transaction_signature: 'synthetic-signature' as Signature, message_sha256: armInput.message_sha256 };
  return { quote, arm, armInput, proof: proofLocator, request };
}
/** Re-seal only synthetic public fixture bytes after a deliberate mutation. */
export function reseal(f: ReturnType<typeof fixture>, files: ReadonlyMap<string, Uint8Array>): SealedBundle {
  const manifest = { ...f.bundle.manifest.payload, files: [...files].map(([path, data]) => ({ path, size_bytes: data.length, sha256: hash(data) })).sort((a, b) => a.path.localeCompare(b.path)),
    pages: f.bundle.manifest.payload.pages.map((p) => { const data = files.get(`pages/${p.page_id}.md`)!; return { ...p, size_bytes: data.length, content_sha256: hash(data) }; }) };
  return { ...f.bundle, files, manifest: f.seal('manifest', manifest), approval: { ...f.bundle.approval, payload_sha256: payloadHash(manifest) }, scans: { ...f.bundle.scans, bundle_sha256: payloadHash(manifest.files) } };
}
