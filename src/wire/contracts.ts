/** Frozen T0 ports. Untrusted input remains unknown until T1 runtime validation.
 * Supporting record decisions are documented inline; no SDK or database types escape.
 * All amounts are unsigned u64 decimal strings on wire; arithmetic uses bigint.
 *
 * T0 decisions where the stack supplied semantics but not complete record shapes
 * (lead review required before downstream changes; no application authorization):
 * 1. Atomic and Lamports have separate string brands and share the SPL u64 bound.
 *    Other string brands use one unique-symbol type tag; validation belongs to T1.
 * 2. Wire records use snake_case; port-only chain/RPC records use camelCase as in
 *    BlockhashWindow/SignResult. Factory contracts are type aliases (CreateBroker,
 *    etc.), not ambient runtime exports that Node cannot actually execute.
 * 3. WireKind keys are the lower-case artifact/operation names below; signed wire
 *    artifacts include envelopes, while SignedTypes maps to payloads only.
 * 4. QuestionPolicy stores all preexpanded combinations as ApprovedQuestion rows,
 *    each binding text/hash, template values, scope and approval hash.
 * 5. ConsultState describes admission only; payment/content/delivery/refund/import/
 *    feedback use separate unions. Receipt uses null for unknown amounts, nullable
 *    settlement, hash-addressed artifact_refs, and explicit registry/manifest/arm/
 *    question-policy hashes. Runtime cross-field validation is T1/T3/T6 work.
 * 6. Store uses the fifteen RowTypes below, string keys, version 1 on insertion,
 *    CAS increments, indexed equality filters and an exclusive key cursor. Rows
 *    are JSON records; artifacts use base64 blobs and are also append-only. Scans
 *    are bounded to 1..1000 rows as an adapter resource bound (not an M03 limit).
 *    QuoteRow stores the presigned answer with its quote; outbox references receipt
 *    keys by foreign key. Outcome/refund corrections carry nullable original IDs;
 *    uniqueness for observations applies to originals, permitting corrections.
 * 7. RPC evidence keeps raw bytes, compiled instructions and indexed balances;
 *    provider errors are JsonValue data. Reconciliation is a discriminated union,
 *    with two origin-bearing observations required for the expiry alternative.
 * 8. ExpectedPayment binds quote/payer/blockhash/message hash; UnsignedPayment also
 *    carries decoded instructions/accounts. ApprovalDecision includes approvalRef;
 *    SignRequest embeds the approval decision rather than a bare boolean/string.
 * 9. Explicit user override: TestSignerConfig injects keyBytes, never a key path.
 *    Its local-simulation scope uses an Id namespace; Network stays two-valued.
 *    HumanSignerIpcConfig is endpoint + expectedPublicKey only. T0 stub always
 *    denies signing and never consumes bytes; operational signers remain T2.
 * 10. Eligibility/revocation use monotonic generation + timestamps/digests;
 *     TombstoneJournal only appends and reads. Bundle records carry file maps,
 *     explicit public approval/scanner attestation; proposal requires human repin.
 * 11. BrokerDeps/SellerDeps use named injected ports; seller map keys are origins.
 *     BrokerPolicy is an explicit frozen policy record, with no default mainnet
 *     activation. ImportResult has quoted/metadata_only/import_pending variants;
 *     readback carries receipt/page/mode/hash. ReceiptArtifacts is a hash/blob map.
 * 12. Evaluation views/spec/results/grades and SDK-neutral StdioTransport are the
 *     minimal typed records below; TaskEvidence binds operation/artifact/time and
 *     ToolExposurePolicy lists named methods. T7/T8 validate implementation fit.
 * 13. AabError is the transport record, not an Error subclass. Common's internal
 *     FoundationError uses these codes; its converter emits fixed code text and
 *     defaults retryable=false rather than guessing domain retry safety.
 */
declare const brand: unique symbol;
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };
export type Atomic = Brand<string, 'Atomic'>;
export type Lamports = Brand<string, 'Lamports'>;
export type Sha256 = Brand<string, 'Sha256'>;
/** A genesis identifier is base58 text of 32..44 characters, not a public key.
 * Address is a narrower lexical subtype for legacy callers; a GenesisHash cannot
 * be used as an Address without 32-byte public-key validation. */
export type GenesisHash = Brand<string, 'GenesisHash' | 'Address'>;
export type Address = Brand<string, 'Address'>;
export type Signature = Brand<string, 'Signature'>;
export type Uuid = Brand<string, 'Uuid'>;
export type Id = Brand<string, 'Id'>;
export type IsoTime = Brand<string, 'IsoTime'>;
export type ReceiptId = Id;
export type Network = 'devnet' | 'mainnet-beta';
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface Signed<T> { readonly payload: T; readonly signature: { readonly key_id: Id; readonly algorithm: 'Ed25519'; readonly value: string } }
export interface SellerPublicKey { readonly id: Id; readonly algorithm: 'Ed25519'; readonly public_key: Address }
export interface Price { readonly network: Network; readonly asset_id: Address; readonly amount_atomic: Atomic }
export interface PaymentTerms {
  readonly rail: 'solana-split-v1'; readonly network: Network; readonly genesis_hash: GenesisHash;
  readonly asset: 'TEST' | 'USDC'; readonly mint: Address; readonly decimals: 6; readonly token_program: Address;
  readonly total_atomic: Atomic; readonly seller_owner: Address; readonly seller_token_account: Address;
  readonly marketplace_owner: Address; readonly marketplace_token_account: Address;
}
export interface Listing {
  readonly seller_id: Id; readonly display_name: string; readonly operator_id: Id;
  readonly listing_kind: 'independent' | 'founder' | 'demo'; readonly status: 'active' | 'suspended';
  readonly endpoint: string; readonly topics: readonly string[]; readonly signing_key: SellerPublicKey;
  readonly slice: { readonly id: Id; readonly manifest_sha256: Sha256; readonly manifest_url: string; readonly approved_at: IsoTime };
  readonly payment: PaymentTerms & { readonly fee_bps: number };
}
export interface Registry { readonly v: 1; readonly registry_version: Id; readonly listings: readonly Listing[] }
export interface Manifest {
  readonly v: 1; readonly seller_id: Id; readonly slice_id: Id; readonly created_at: IsoTime;
  readonly gate_version: Id; readonly approval_id: Id; readonly version: number;
  readonly previous_manifest_hash: Sha256 | null; readonly policy_sha256: Sha256;
  readonly pages: readonly { readonly page_id: Id; readonly content_sha256: Sha256; readonly size_bytes: number }[];
  readonly files: readonly { readonly path: string; readonly size_bytes: number; readonly sha256: Sha256 }[];
}
export interface Quote extends PaymentTerms {
  readonly v: 1; readonly quote_id: Id; readonly nonce: string; readonly request_id: Uuid;
  readonly buyer_id: Id; readonly payer: Address; readonly seller_id: Id; readonly registry_version: Id;
  readonly question_sha256: Sha256; readonly slice_id: Id; readonly manifest_sha256: Sha256; readonly answer_sha256: Sha256;
  readonly issued_at: IsoTime; readonly expires_at: IsoTime; readonly seller_atomic: Atomic; readonly fee_atomic: Atomic;
  readonly memo: string; readonly delivery: 'immutable-answer-after-finalized'; readonly refund_terms: 'aab-prototype-refund-v1';
}
/** Authenticated broker assertion: old message has durable no-sign proof.
 * Seller additionally verifies expiry on its two pinned providers. */
export interface ArmRenewal { readonly previous_arm_sha256: Sha256; readonly unsigned_message_sha256: Sha256 }
export interface ArmRequest { readonly renewal?: ArmRenewal | undefined; readonly quote_id: Id; readonly message_base64: string; readonly message_sha256: Sha256; readonly recent_blockhash: Address; readonly last_valid_block_height: number }
export interface Arm extends Omit<ArmRequest, 'message_base64' | 'renewal'> { readonly v: 1; readonly buyer_id: Id; readonly quote_sha256: Sha256; readonly armed_at: IsoTime }
export interface Citation { readonly id: Id; readonly page_id: Id; readonly content_sha256: Sha256; readonly byte_start: number; readonly byte_end: number; readonly excerpt: string; readonly source_url: string }
export interface Answer {
  readonly v: 1; readonly quote_id: Id; readonly seller_id: Id; readonly buyer_id: Id; readonly question_sha256: Sha256;
  readonly slice_id: Id; readonly manifest_sha256: Sha256; readonly commitment_salt: string; readonly created_at: IsoTime;
  readonly answer: string; readonly claims: readonly { readonly text: string; readonly citation_ids: readonly Id[] }[];
  readonly citations: readonly Citation[]; readonly abstain: false; readonly engine_version: Id;
}
export interface ProofLocator { readonly v: 1; readonly consult_id: Id; readonly quote_id: Id; readonly quote_sha256: Sha256; readonly arm_ticket_sha256: Sha256; readonly network: Network; readonly genesis_hash: GenesisHash; readonly transaction_signature: Signature; readonly message_sha256: Sha256 }
export interface SignedTypes { manifest: Manifest; quote: Quote; arm: Arm; answer: Answer }
export type SignedKind = keyof SignedTypes;
export interface WireTypes {
  quote_disposition: QuoteDisposition; payment_view: PaymentView; answer_disposition: AnswerDisposition; eligibility: Eligibility;
  registry: Registry; listing: Listing; manifest: Signed<Manifest>; quote: Signed<Quote>; arm: Signed<Arm>; answer: Signed<Answer>;
  proof: ProofLocator; receipt: Receipt; outcome: Outcome; question_policy: QuestionPolicy;
  consult_input: ConsultInput; quote_request: QuoteRequest; arm_request: ArmRequest;
}
export type WireKind = keyof WireTypes;
export type ParseWire = <K extends WireKind>(kind: K, bytes: Uint8Array) => WireTypes[K];
export type CanonicalBytes = <T extends JsonValue>(payload: T) => Uint8Array;
export type PayloadHash = <T extends JsonValue>(payload: T) => Sha256;
export type VerifyEnvelope = <K extends SignedKind>(kind: K, value: Signed<SignedTypes[K]>, key: SellerPublicKey) => void;
export type VerifyCitations = (answer: Signed<Answer>, manifest: Signed<Manifest>, pages: ReadonlyMap<Id, Uint8Array>) => void;
export type ResolveQuestion = (policy: QuestionPolicy, input: ConsultInput) => ApprovedQuestion;

export interface ConsultInput { readonly request_id: Uuid; readonly question_id: Id; readonly template_values?: Readonly<Record<string, string>>; readonly max_price: Price }
export interface BuyerContext { readonly buyer_id: Id; readonly payer: Address; readonly session_id: Id }
/** Each record is one fully expanded approved combination; runtime performs exact matching. */
export interface ApprovedQuestion { readonly question_id: Id; readonly text: string; readonly question_sha256: Sha256; readonly template_values: Readonly<Record<string, string>>; readonly topic: string; readonly allowed_origins: readonly string[]; readonly allowed_networks: readonly Network[]; readonly approval_sha256: Sha256 }
export interface QuestionPolicy { readonly v: 1; readonly policy_id: Id; readonly approved_at: IsoTime; readonly approval_sha256: Sha256; readonly questions: readonly ApprovedQuestion[] }
export interface QuoteRequest { readonly v: 1; readonly request_id: Uuid; readonly request_nonce: string; readonly buyer_id: Id; readonly payer: Address; readonly seller_id: Id; readonly registry_version: Id; readonly slice_id: Id; readonly network: Network; readonly question: string; readonly max_total_atomic: Atomic }
export interface Decline { readonly status: 'declined'; readonly abstain: true; readonly quote: null; readonly charged_atomic: Atomic; readonly reason: 'unavailable' }
export type QuoteDisposition = Decline | { readonly status: 'ready'; readonly quote: Signed<Quote> };
export interface ListingDisposition { readonly seller_id: Id; readonly status: 'ready' | 'declined' | 'unavailable'; readonly quote_id: Id | null; readonly code: AabErrorCode | null }
// Orthogonal M06 dimensions. No aggregate state can overwrite payment history.
export type ConsultState = 'precheck_running' | 'declined' | 'precheck_failed' | 'quote_issued' | 'quote_expired' | 'approval_required' | 'cancelled';
export type PaymentState = 'not_applicable' | 'payment_pending' | 'payment_finalized' | 'payment_failed' | 'underpaid' | 'overpaid';
export type ContentState = 'eligible' | 'superseded' | 'revoked' | 'unknown';
export type DeliveryState = 'not_applicable' | 'pending' | 'delivered' | 'delivery_failed' | 'verification_failed' | 'recovery_required';
export type RefundState = 'none' | 'refund_pending' | 'partial_refund' | 'refunded';
export type ImportState = 'not_applicable' | 'import_pending' | 'quoted' | 'metadata_only';
export type FeedbackState = 'none' | 'recorded';
export interface States { readonly payment_state: PaymentState; readonly content_state: ContentState; readonly delivery_state: DeliveryState; readonly refund_state: RefundState; readonly import_state: ImportState; readonly feedback_state: FeedbackState }
export interface AnswerView { readonly text: string; readonly citations: readonly Citation[]; readonly answer_sha256: Sha256; readonly verified: true; readonly untrusted_content: true }
export interface ConsultView extends States { readonly consult_id: Id; readonly receipt_id: ReceiptId; readonly consult_state: ConsultState; readonly dispositions: readonly ListingDisposition[]; readonly purchase_amount_atomic: Atomic | null; readonly network_fee_lamports: Lamports | null; readonly answer: AnswerView | null; readonly message: string }
export type Classification = 'technical_verification' | 'replay' | 'independent';
export type Verification = boolean | 'not_applicable';
export interface Receipt extends States {
  readonly content_redacted_at?: IsoTime | undefined;
  /** Legacy receipts omit this field; current persistence normalizes to null. */
  readonly approval_ref?: Id | null;
  readonly v: 1; readonly receipt_id: ReceiptId; readonly request_id: Uuid; readonly buyer_id: Id; readonly seller_id: Id | null;
  readonly classification: Classification; readonly question: string; readonly question_policy_sha256: Sha256;
  readonly quote_id: Id | null; readonly quote_sha256: Sha256 | null; readonly answer_sha256: Sha256 | null;
  readonly registry_sha256: Sha256; readonly manifest_sha256: Sha256 | null; readonly arm_ticket_sha256: Sha256 | null;
  readonly dispositions: readonly ListingDisposition[]; readonly network: Network; readonly asset: 'TEST' | 'USDC';
  readonly total_atomic: Atomic | null; readonly seller_atomic: Atomic | null; readonly fee_atomic: Atomic | null;
  readonly network_fee_lamports: Lamports | null; readonly transaction_signature: Signature | null; readonly finalized_slot: number | null;
  readonly explorer_url: string | null; readonly settlement: SettlementEvidence | null;
  readonly verified: { readonly chain: Verification; readonly seller_signature: Verification; readonly answer_commitment: Verification; readonly source_hashes: Verification };
  readonly artifact_refs: Readonly<Record<string, Sha256>>;
  readonly refund: { readonly status: RefundState; readonly returned_atomic: Atomic; readonly transactions: readonly Signature[] };
  readonly latency_ms: { readonly precheck: number | null; readonly finality: number | null; readonly delivery: number | null };
  readonly gbrain: { readonly page_id: Id | null; readonly sync_state: ImportState };
}
export type ReasonCode = 'prevented_missed_check' | 'unblocked_task' | 'already_known' | 'incorrect' | 'not_actionable' | 'other';
export type OutcomeSource = 'agent' | 'human' | 'task_check' | 'replay' | 'service_failure';
export interface Outcome { readonly v: 1; readonly feedback_id: Id; readonly consult_id: Id; readonly quote_id: Id | null; readonly answer_sha256: Sha256 | null; readonly buyer_id: Id; readonly seller_id: Id; readonly source: OutcomeSource; readonly useful: boolean | null; readonly verdict?: 'pass' | 'fail' | 'unknown' | undefined; readonly run_sha256?: Sha256 | null | undefined; readonly reason_code: ReasonCode; readonly transaction_signature: Signature | null; readonly classification: Classification; readonly eligible_for_trust: boolean; readonly exclusion_reason: string | null; readonly recorded_at: IsoTime; readonly corrects: Id | null }
export interface AgentFeedbackInput { readonly consult_id: Id; readonly useful: boolean; readonly reason_code: ReasonCode }
export interface FindInput { readonly topic: string }
export interface ListingSummary { readonly seller_id: Id; readonly label: string; readonly kind: Listing['listing_kind']; readonly topics: readonly string[]; readonly price: Price; readonly trust_display: string }
export interface FindOutput { readonly listings: readonly ListingSummary[] }
export interface StatusInput { readonly consult_id: Id }
export interface FeedbackOutput { readonly feedback_id: Id; readonly source: 'agent'; readonly eligible_for_trust: false }
export interface ReportInput { readonly date_utc: string }
export interface ReportOutput { readonly markdown: string; readonly receipt_ids: readonly ReceiptId[]; readonly gbrain_pending_count: number }
export type AabErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED' | 'UNKNOWN_SELLER' | 'POLICY_DENIED' | 'BUDGET_EXCEEDED' | 'APPROVAL_REQUIRED' | 'RATE_LIMITED' | 'QUOTE_EXPIRED' | 'IDEMPOTENCY_CONFLICT' | 'NETWORK_MISMATCH' | 'PAYMENT_UNCERTAIN' | 'PAYMENT_INVALID' | 'SELLER_UNAVAILABLE' | 'VERIFICATION_FAILED' | 'RECEIPT_STORE_UNAVAILABLE' | 'INTERNAL_ERROR' | 'CONTENT_REVOKED' | 'NOT_READY' | 'STATE_CONFLICT' | 'BUDGET_EXHAUSTED' | 'EXPIRED_BEFORE_APPROVAL';
/** Data-only transport shape; message is a trusted fixed string, never an exception. */
export interface AabError { readonly code: AabErrorCode; readonly retryable: boolean; readonly consult_id: Id | null; readonly message: string }

export interface Clock { now(): IsoTime; monotonicMs(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> }
export interface Versioned<T> { readonly version: number; readonly value: T }
// Row payloads remain role-local. Only explicitly declared fields are indexable.
export interface ConsultRow { readonly buyer_id: Id; readonly request_id: Uuid; readonly body_sha256: Sha256; readonly view: ConsultView | null;
  readonly broker?: BrokerJournal | null; readonly quote_id?: Id | null; readonly disposition?: Decline | null }
export type BrokerStage = 'precheck' | 'selected' | 'reviewing' | 'approved' | 'reserved' | 'arming' | 'armed' | 'signing' | 'signed' | 'settled' | 'closed';
export interface BrokerJournal {
  readonly contentRedactedAt?: IsoTime;
  readonly renewal?: ArmRenewal | undefined; readonly renewalCount?: number;
  readonly v: 1; readonly stage: BrokerStage; readonly input: ConsultInput; readonly question: ApprovedQuestion;
  readonly aliasOf: Id | null; readonly createdAt: IsoTime; readonly registryHash: Sha256; readonly policyHash: Sha256;
  readonly listing: Listing | null; readonly quote: Signed<Quote> | null; readonly approval: ApprovalDecision | null;
  readonly messageBase64: string | null; readonly messageHash: Sha256 | null; readonly blockhash: BlockhashWindow | null;
  readonly estimatedFee: string | null; readonly finalizedAt: IsoTime | null; readonly revealAttempts: number;
  readonly answerArtifact: Sha256 | null; readonly manifestArtifact: Sha256 | null;
  readonly pageArtifacts: readonly { readonly pageId: Id; readonly sha256: Sha256 }[];
}
export interface BrokerConsultRow extends ConsultRow { readonly broker: BrokerJournal; readonly view: ConsultView }
export interface SellerRequestRecord { readonly quote_id: Id | null; readonly disposition: Decline | null }
export type SellerRequestRow = ConsultRow & SellerRequestRecord;
export interface FreeCheckRow { readonly buyer_id: Id; readonly seller_id: Id; readonly window: string; readonly count: number; readonly consultId?: Id | null; readonly expiresAt?: string | null }
export interface QuoteRow { readonly seller_request_key: string; readonly quote: Signed<Quote>; readonly answer: Signed<Answer> | null;
  readonly body_sha256?: Sha256 | null; readonly dedup_sha256?: Sha256 | null;
  readonly payment_state?: PaymentState; readonly delivery_state?: DeliveryState; readonly refund_state?: RefundState;
  readonly requested_recovery_atomic?: string | null; readonly proof?: ProofLocator | null; readonly failure_evidence_sha256?: Sha256 | null;
  readonly redacted_at?: IsoTime | null;
}
/** Required current seller metadata; legacy QuoteRow remains readable for repair. */
export interface SellerQuoteRow extends QuoteRow {
  readonly body_sha256: Sha256; readonly dedup_sha256: Sha256;
  readonly payment_state: PaymentState; readonly delivery_state: DeliveryState; readonly refund_state: RefundState;
  readonly requested_recovery_atomic: string; readonly proof: ProofLocator | null;
}
export interface ArmRow { readonly renewal?: ArmRenewal | undefined; readonly renewalCount?: number; readonly quote_id: Id; readonly message_sha256: Sha256; readonly arm: Signed<Arm>; readonly expected?: ExpectedPayment | null }
export interface ReservationRow { readonly consult_id: Id; readonly payer: Address; readonly day_utc: string; readonly principal: Atomic; readonly maximum_fee: Lamports; readonly status: 'held' | 'resolved'; readonly network?: Network | null; readonly actualPrincipal?: Atomic | null; readonly actualFee?: Lamports | null }
export interface SignedTransactionRow { readonly request_id: Uuid; readonly quote_id: Id; readonly genesis: GenesisHash; readonly signature: Signature; readonly message_sha256: Sha256; readonly transaction_base64: string; readonly transaction_sha256?: Sha256 | null; readonly approval_ref?: Id | null }
/** Required current broker facts. Legacy null/missing fields require repair,
 * never a guessed network, synthetic authorization or released reservation. */
export interface BrokerReservationRow extends ReservationRow { readonly network: Network; readonly actualPrincipal: Atomic | null; readonly actualFee: Lamports | null }
export interface BrokerSignedTransactionRow extends SignedTransactionRow { readonly broadcastAttempted?: boolean; readonly transaction_sha256: Sha256; readonly approval_ref: Id }
export interface SellerArmRow extends ArmRow { readonly expected: ExpectedPayment }
export interface FreeCheckLease extends FreeCheckRow { readonly consultId: Id | null; readonly expiresAt: string | null }
export interface ReconciledReceipt extends Receipt { readonly approval_ref: Id | null }
export interface ArtifactRow { readonly redacted_at?: IsoTime; readonly sha256: Sha256; readonly bytes_base64: string }
export interface OutboxRow { readonly receipt_id: ReceiptId; readonly mode: 'quoted' | 'metadata_only'; readonly attempts: number; readonly state: ImportState }
export interface RefundRow { readonly consult_id: Id; readonly genesis: GenesisHash; readonly signature: Signature; readonly amount_atomic: Atomic; readonly recorded_at: IsoTime; readonly corrects: Id | null }
export interface LedgerEvent { readonly event_id: Id; readonly consult_id: Id; readonly code: string; readonly recorded_at: IsoTime; readonly counters: Readonly<Record<string, number>> }
export interface RowTypes {
  consults: ConsultRow; free_checks: FreeCheckRow; quotes: QuoteRow; arms: ArmRow; reservations: ReservationRow;
  signed_transactions: SignedTransactionRow; settlements: SettlementEvidence; receipts: Receipt; artifacts: ArtifactRow;
  outbox: OutboxRow; outcomes: Outcome; refunds: RefundRow; eligibility: Eligibility; tombstones: Revocation; events: LedgerEvent;
}
export type TableName = keyof RowTypes;
export type MutableTable = Exclude<TableName, 'settlements' | 'events' | 'outcomes' | 'refunds' | 'tombstones' | 'artifacts'>;
export interface IndexedFields {
  consults: 'buyer_id' | 'request_id'; free_checks: 'buyer_id' | 'seller_id' | 'window'; quotes: 'seller_request_key';
  arms: 'quote_id' | 'message_sha256'; reservations: 'consult_id' | 'payer' | 'day_utc' | 'status' | 'network';
  signed_transactions: 'request_id' | 'quote_id' | 'genesis' | 'signature'; settlements: 'genesis' | 'signature' | 'quote_id';
  receipts: 'receipt_id' | 'request_id' | 'buyer_id'; artifacts: 'sha256'; outbox: 'receipt_id' | 'state';
  outcomes: 'consult_id' | 'source'; refunds: 'consult_id' | 'genesis' | 'signature'; eligibility: 'slice_id' | 'manifest_sha256';
  tombstones: 'slice_id' | 'manifest_sha256'; events: 'event_id' | 'consult_id';
}
/** Cursor is the last returned primary key (exclusive); scans sort by primary key. */
export type StoreQuery<K extends TableName> = { readonly where?: Readonly<Partial<Pick<RowTypes[K], IndexedFields[K] & keyof RowTypes[K]>>>; readonly limit: number; readonly cursor?: string };
export interface Store { transaction<T>(body: (tx: StoreTx) => T): T; read<K extends TableName>(table: K, key: string): Versioned<RowTypes[K]> | null; scan<K extends TableName>(table: K, query: StoreQuery<K>): readonly Versioned<RowTypes[K]>[]; /** Optional for legacy Store wrappers; absent means cleanup unavailable. */
  cleanupBrokerContent?(request: BrokerContentCleanupRequest): BrokerContentCleanupResult;
  cleanupContent?(request: ContentCleanupRequest): ContentCleanupResult;
  checkpoint(): void; close(): void }
export interface StoreTx { read<K extends TableName>(table: K, key: string): Versioned<RowTypes[K]> | null; scan<K extends TableName>(table: K, query: StoreQuery<K>): readonly Versioned<RowTypes[K]>[]; insert<K extends TableName>(table: K, key: string, row: RowTypes[K]): void; compareAndSet<K extends MutableTable>(table: K, key: string, expectedVersion: number, row: RowTypes[K]): void; append(event: LedgerEvent): void }

/** Removes only the embedded seller answer, never financial records or tombstones.
 * Caller quiesces serving; external bundle copies/backups require separate cleanup. */
export interface ContentCleanupRequest { readonly quote_id: Id; readonly expectedVersion: number; readonly now: IsoTime }
export interface ContentCleanupResult { readonly quote_id: Id; readonly redacted: boolean; readonly reason: 'revoked' | 'expired_unarmed' | 'paid_retention' | 'already_redacted' }

export interface BlockhashWindow { readonly blockhash: Address; readonly lastValidBlockHeight: number; readonly observedAt: IsoTime }
export interface AccountInfo { readonly address: Address; readonly owner: Address; readonly lamports: Lamports; readonly executable: boolean; readonly data: Uint8Array }
export interface AccountSnapshot { readonly slot: number; readonly observedAt: IsoTime; readonly accounts: readonly (AccountInfo | null)[] }
export interface SignatureObservation { readonly signature: Signature; readonly status: 'absent' | 'processed' | 'confirmed' | 'finalized'; readonly slot: number | null; readonly err: JsonValue; readonly observedAt: IsoTime }
export interface CompiledInstruction { readonly programIdIndex: number; readonly accountIndices: readonly number[]; readonly data: Uint8Array }
export interface TokenBalance { readonly accountIndex: number; readonly mint: Address; readonly owner: Address; readonly programId: Address; readonly decimals: number; readonly amount: Atomic }
export interface FinalizedTransaction { readonly genesis: GenesisHash; readonly signature: Signature; readonly transaction: Uint8Array; readonly message: Uint8Array; readonly slot: number; readonly commitment: 'finalized'; readonly observedAt: IsoTime; readonly accountKeys: readonly Address[]; readonly instructions: readonly CompiledInstruction[]; readonly meta: { readonly err: JsonValue; readonly fee: Lamports; readonly preTokenBalances: readonly TokenBalance[]; readonly postTokenBalances: readonly TokenBalance[] } }
export interface PayerAccounts { readonly payer: Address; readonly tokenAccount: Address }
export interface ExpectedPayment { readonly quote: Signed<Quote>; readonly payer: PayerAccounts; readonly blockhash: BlockhashWindow; readonly messageHash: Sha256 }
export interface DecodedPayment { readonly payer: PayerAccounts; readonly accountKeys: readonly Address[]; readonly instructions: readonly CompiledInstruction[]; readonly recentBlockhash: Address; readonly memo: string }
export interface UnsignedPayment { readonly message: Uint8Array; readonly messageHash: Sha256; readonly expected: ExpectedPayment; readonly decoded: DecodedPayment }
export interface SignedPayment { readonly transaction: Uint8Array; readonly signature: Signature; readonly messageHash: Sha256 }
export interface SettlementEvidence { readonly genesis: GenesisHash; readonly signature: Signature; readonly quote_id: Id; readonly message_sha256: Sha256; readonly slot: number; readonly observed_at: IsoTime; readonly commitment: 'finalized'; readonly meta_err: null; readonly actual_fee: Lamports; readonly payer_debit: Atomic; readonly seller_credit: Atomic; readonly marketplace_credit: Atomic; readonly transaction_sha256: Sha256 }
export interface ExpiryObservation { readonly origin: string; readonly genesis: GenesisHash; readonly finalizedHeight: number; readonly signature: SignatureObservation }
export type Reconciliation = { readonly status: 'finalized_success'; readonly evidence: SettlementEvidence } | { readonly status: 'finalized_failure'; readonly actualFee: Lamports; readonly transaction: FinalizedTransaction } | { readonly status: 'expired'; readonly observations: readonly [ExpiryObservation, ExpiryObservation] } | { readonly status: 'pending'; readonly reason: AabErrorCode };
export interface RpcClient {
  genesis(signal?: AbortSignal): Promise<GenesisHash>; latestBlockhash(signal?: AbortSignal): Promise<BlockhashWindow>;
  finalizedHeight(signal?: AbortSignal): Promise<number>; feeForMessage(message: Uint8Array, signal?: AbortSignal): Promise<Lamports | null>;
  accounts(addresses: readonly Address[], signal?: AbortSignal): Promise<AccountSnapshot>;
  signatureStatus(signature: Signature, signal?: AbortSignal): Promise<SignatureObservation>;
  finalizedTransaction(signature: Signature, signal?: AbortSignal): Promise<FinalizedTransaction | null>;
  broadcastIdentical(signedTransaction: Uint8Array, signal?: AbortSignal): Promise<Signature>;
}
export interface OfferReview { readonly quote: Signed<Quote>; readonly quoteHash: Sha256; readonly terms: string }
export interface ApprovalDecision { readonly status: 'approved' | 'denied'; readonly reviewedHash: Sha256; readonly actor: 'test' | 'human'; readonly at: IsoTime; readonly approvalRef: Id }
export interface SignRequest { readonly requestId: Uuid; readonly quoteId: Id; readonly network: Network; readonly genesis: GenesisHash; readonly message: Uint8Array; readonly messageHash: Sha256; readonly expectedPayer: Address; readonly quote: Signed<Quote>; readonly arm: Signed<Arm>; readonly manifestHash: Sha256; readonly registryHash: Sha256; readonly questionPolicyHash: Sha256; readonly reservationId: Id; readonly estimatedFee: Lamports; readonly maximumFee: Lamports; readonly blockhash: BlockhashWindow; readonly offerApproval: ApprovalDecision }
export type ExpiryRefusal = { readonly status: 'denied'; readonly reason: 'EXPIRED_BEFORE_APPROVAL'; readonly messageHash: Sha256 };
export type SignResult = ExpiryRefusal | { readonly status: 'denied'; readonly reason: Exclude<AabErrorCode, 'EXPIRED_BEFORE_APPROVAL'> } | { readonly status: 'signed'; readonly messageHash: Sha256; readonly publicKey: Address; readonly signature: Signature; readonly approvalRef: Id };
export interface Signer { publicKey(): Promise<Address>; sign(request: SignRequest): Promise<SignResult>; recover(requestId: Uuid, messageHash: Sha256): Promise<SignResult | null> }
export interface OfferApproval { review(offer: OfferReview): Promise<ApprovalDecision> }
/** User override of stack's key-path proposal: source injection, never filesystem authority.
 * T0 stub never invokes the source or signs. T2 implements actual test signing.
 */
export type TestSignerConfig = { readonly publicKey: Address; readonly keyBytes: () => Uint8Array | Promise<Uint8Array> } & ({ readonly network: 'devnet'; readonly genesis: GenesisHash } | { readonly network: 'local-simulation'; readonly namespace: Id });
export interface HumanSignerIpcConfig { readonly endpoint: string; readonly expectedPublicKey: Address }
export type CreateTestSigner = (config: TestSignerConfig) => Signer;
export type CreateHumanCliSigner = (config: HumanSignerIpcConfig) => Signer;
export type BuildLegacyPayment = (quote: Signed<Quote>, payer: PayerAccounts, blockhash: BlockhashWindow) => UnsignedPayment;
export type ValidateLegacyMessage = (message: Uint8Array, expected: ExpectedPayment) => DecodedPayment;
export type AttachSignature = (payment: UnsignedPayment, signed: SignResult) => SignedPayment;
export type VerifyFinalizedPayment = (tx: FinalizedTransaction, expected: ExpectedPayment) => SettlementEvidence;
export type ReconcilePayment = (expected: ExpectedPayment, signature: Signature, primary: RpcClient, secondary: RpcClient) => Promise<Reconciliation>;

export interface Eligibility { readonly slice_id: Id; readonly manifest_sha256: Sha256; readonly state: ContentState; readonly generation: number; readonly acknowledged_at: IsoTime; readonly checked_at: IsoTime }
export interface Revocation { readonly slice_id: Id; readonly manifest_sha256: Sha256; readonly generation: number; readonly revoked_at: IsoTime; readonly reason: 'safety' | 'rights'; readonly approval_id: Id }
/** Protected operator attestation, independent of content backups. Digest is
 * SHA-256(JCS(revocations sorted by slice_id + ':' + manifest_sha256 using code
 * point order)); generation is the newest journal generation (zero if empty).
 * acknowledged_at attests this session's lineage/rights check, not file mtime. */
export interface TombstoneAttestation { readonly generation: number; readonly tombstones_sha256: Sha256; readonly acknowledged_at: IsoTime }
export interface TombstoneJournal { append(revocation: Revocation): Promise<void>; readAll(): Promise<readonly Revocation[]>;
  /** Legacy journal requires SellerConfig.authority; absence never proves freshness. */
  newestState?(): Promise<TombstoneAttestation> }
export interface AttestedTombstoneJournal extends TombstoneJournal { newestState(): Promise<TombstoneAttestation> }
export type PaymentView = { readonly payment_state: PaymentState; readonly delivery_state: DeliveryState; readonly evidence: SettlementEvidence | null };
export type AnswerDisposition = { readonly status: 'ready'; readonly answer: Signed<Answer> } | { readonly status: 'pending' } | { readonly status: 'withheld'; readonly code: AabErrorCode };
/** Transport must propagate cancellation and stop new work at this absolute UTC
 * deadline; cancellation never proves an armed payment failed. */
export interface SellerCallOptions { readonly signal?: AbortSignal; readonly deadline?: IsoTime }
export interface SellerClient { quote(context: BuyerContext, input: QuoteRequest, peerIp?: string, options?: SellerCallOptions): Promise<QuoteDisposition>; arm(context: BuyerContext, input: ArmRequest, options?: SellerCallOptions): Promise<Signed<Arm>>; payment(context: BuyerContext, proof: ProofLocator, options?: SellerCallOptions): Promise<PaymentView>; answer(context: BuyerContext, quoteId: Id, options?: SellerCallOptions): Promise<AnswerDisposition>; manifest(sliceId: Id, options?: SellerCallOptions): Promise<Signed<Manifest>>; page(sliceId: Id, pageId: Id, options?: SellerCallOptions): Promise<Uint8Array>; eligibility(sliceId: Id, manifestHash: Sha256, options?: SellerCallOptions): Promise<Eligibility> }
export interface SealAuthorization<K extends SignedKind> { readonly kind: K; readonly payloadHash: Sha256; readonly approvalId: Id; readonly actor: 'test' | 'human' }
export interface SellerSealSigner { sign<K extends SignedKind>(kind: K, payload: SignedTypes[K], approval: SealAuthorization<K>): Promise<Signed<SignedTypes[K]>> }
export interface AnswerContext { readonly quote_id: Id; readonly buyer_id: Id; readonly created_at: IsoTime; readonly commitment_salt: string }
export interface PreparedAnswer { readonly answer: Answer; readonly answer_sha256: Sha256 }
export interface PublicApproval { readonly approval_id: Id; readonly payload_sha256: Sha256; readonly approved_at: IsoTime; readonly actor: 'human' }
/** bundle_sha256 is SHA-256 of RFC8785 JCS(manifest.files), not the manifest,
 * concatenated contents, an archive, or a recursively self-hashed inventory. */
export interface ScanAttestation { readonly bundle_sha256: Sha256; readonly scanner_version: string; readonly scanner_sha256: Sha256; readonly scanned_at: IsoTime; readonly passed: true }
export interface BundleInput { readonly manifest: Manifest; readonly files: ReadonlyMap<string, Uint8Array> }
export interface ValidatedBundle extends BundleInput { readonly approval: PublicApproval; readonly scans: ScanAttestation }
export interface SealedBundle { readonly manifest: Signed<Manifest>; readonly files: ReadonlyMap<string, Uint8Array>; readonly approval: PublicApproval; readonly scans: ScanAttestation }
export interface PublicDeployment { readonly endpoint: string; readonly operator_id: Id; readonly listing_kind: Listing['listing_kind']; readonly payment: Listing['payment']; readonly signing_key: SellerPublicKey }
export interface ListingProposal { readonly listing: Listing; readonly manifest_sha256: Sha256; readonly requires_human_repin: true }
export interface BrokerPolicy { readonly policy_id: Id; readonly registry_sha256: Sha256; readonly question_policy_sha256: Sha256; readonly buyer: BuyerContext; readonly networks: readonly Network[]; readonly principal_per_call: Atomic; readonly principal_per_day: Atomic; readonly fee_per_call: Lamports; readonly fee_per_day: Lamports; readonly mainnet_enabled: boolean }
/** Optional only for legacy bindBroker(ports) composition. Named factories must
 * refuse missing ports; no permissive runtime defaults. */
export interface BrokerDeps { readonly brokerPorts?: BrokerPorts; readonly policy: BrokerPolicy; readonly registry: Registry; readonly questionPolicy: QuestionPolicy; readonly store: Store; readonly clock: Clock; readonly signer: Signer; readonly offerApproval: OfferApproval; readonly primaryRpc: RpcClient; readonly secondaryRpc: RpcClient; readonly sellers: ReadonlyMap<string, SellerClient>; readonly receiptImporter: ReceiptImporter }
export interface SellerDeps { readonly config?: SellerConfig; readonly bundle: SealedBundle; readonly store: Store; readonly clock: Clock; readonly signer: SellerSealSigner; readonly primaryRpc: RpcClient; readonly secondaryRpc: RpcClient; readonly tombstones: TombstoneJournal }
type BrokerNumberLimit = 'messageRenewalsMax' | 'checksPerConsultMax' | 'questionBytesMax' | 'questionScalarsMax' | 'quoteTtl' | 'armRemainingMin' | 'clockSkewMax' | 'dedupWindow' | 'buyerSellerChecksPerMinute' | 'buyerSellerChecksPerDay' | 'buyerSellerActiveMax' | 'buyerSellerUnarmedReadyMax' | 'precheckMax' | 'ingressBodyMax' | 'signedEnvelopeMax' | 'lineageAcknowledgementMaxAge' | 'revealAttemptMax' | 'revealRetriesMax' | 'revealRetryWindow' | 'nonDeliveryAfterFinality' | 'citedPageMax' | 'citationFetchTotalMax' | 'tokenDecimals' | 'marketplaceFeeBps';
type BrokerBigintLimit = 'totalAtomic' | 'sellerAtomic' | 'marketplaceAtomic' | 'devnetPrincipalPerCall' | 'devnetPrincipalPerDay' | 'feePerPurchaseMax' | 'devnetFeePerDayMax' | 'mainnetPrincipal' | 'mainnetAttemptFeeMax';
export type BrokerLimits = Readonly<Record<BrokerNumberLimit, { readonly value: number }>> & Readonly<Record<BrokerBigintLimit, { readonly value: bigint }>>;
export interface BrokerPorts {
  readonly limits: BrokerLimits;
  readonly parseWire: ParseWire;
  readonly canonicalBytes: CanonicalBytes;
  readonly payloadHash: PayloadHash;
  readonly resolveQuestion: ResolveQuestion;
  readonly verifyEnvelope: VerifyEnvelope;
  readonly verifyCitations: VerifyCitations;
  readonly buildLegacyPayment: BuildLegacyPayment;
  readonly validateLegacyMessage: ValidateLegacyMessage;
  readonly attachSignature: AttachSignature;
  readonly verifyFinalizedPayment: VerifyFinalizedPayment;
  readonly reconcilePayment: ReconcilePayment;
  readonly payer: PayerAccounts;
  /** Protected composition config, never MCP arguments. Distinct enrolled endpoints. */
  readonly rpcOrigins: readonly [string, string];
  readonly persistReceipt: PersistReceipt;
  /** T6 owns these authenticated operations. Missing adapter fails closed. */
  readonly feedback?: MarketApi['feedback'];
  readonly report?: MarketApi['report'];
}

type SellerNumberLimit = 'messageRenewalsMax' | 'slicePagesMin' | 'slicePagesMax' | 'pageMax' | 'sealedPayloadMax' | 'chunksMax' | 'questionBytesMax' | 'questionScalarsMax' | 'quoteTtl' | 'armRemainingMin' | 'clockSkewMax' | 'dedupWindow' | 'buyerSellerChecksPerMinute' | 'buyerSellerChecksPerDay' | 'buyerSellerActiveMax' | 'buyerSellerUnarmedReadyMax' | 'ipChecksPerMinute' | 'sellerChecksPerDay' | 'sellerActiveJobsMax' | 'queueMax' | 'queueWaitMax' | 'sectionsMax' | 'evidenceMax' | 'answerScalarsMax' | 'citationsMin' | 'citationsMax' | 'signedEnvelopeMax' | 'quotedScalarsMax' | 'ingressBodyMax' | 'readyDeclineResponseMin' | 'precheckMax' | 'lineageAcknowledgementMaxAge' | 'nonDeliveryAfterFinality' | 'sellerReconciliationInterval' | 'tokenDecimals' | 'marketplaceFeeBps';
/** Composition root must supply M03 unchanged; not configurable caps. */
export type SellerLimits = Readonly<Record<SellerNumberLimit, { readonly value: number }>> & Readonly<Record<'totalAtomic' | 'sellerAtomic' | 'marketplaceAtomic', { readonly value: bigint }>>;
export interface SellerWire {
  readonly parse: ParseWire; readonly canonical: CanonicalBytes; readonly hash: PayloadHash;
  readonly verify: VerifyEnvelope; readonly citations: VerifyCitations;
  /** Same duplicate-key/unknown-version/UTF-8 discipline as T1 JSON parsing. */
  readonly json: (bytes: Uint8Array) => unknown;
}
/** Exclusive UTF-8 byte offsets into pages/{page_id}.md; IDs are opaque. */
export interface Span { readonly page_id: Id; readonly byte_start: number; readonly byte_end: number }
/** Frozen answer-map.json shape. question-policy.json stores QuestionPolicy.
 * This supersedes the early T1 synthetic questions/citations fixture layout. */
export interface AnswerMap { readonly v: 1; readonly engine_version: Id; readonly entries: readonly { readonly question_id: Id; readonly question_sha256: Sha256; readonly support: 'supported' | 'declined' | 'stale' | 'contradictory'; readonly spans: readonly Span[] }[] }
export interface PreparationConfig { readonly origin: string; readonly limits: SellerLimits; readonly wire: SellerWire }
export type AuthoritySnapshot = TombstoneAttestation;
export interface Invitation { readonly token_sha256: Sha256; readonly origin: string; readonly buyer: BuyerContext }
export interface SellerConfig extends PreparationConfig {
  readonly listing: Listing; readonly registryVersion: Id; readonly invitations: readonly Invitation[];
  readonly sealActor: 'human' | 'test';
  /** Trusted protected operator port: attests newest independent journal, per session. */
  readonly authority: () => Promise<AuthoritySnapshot>;
  /** Measured trusted host clock offset; unknown must return NaN or throw. */
  readonly clockSkewMs: () => number;
  readonly payerAccounts: (buyer: BuyerContext) => ExpectedPayment['payer'];
  readonly validateMessage: ValidateLegacyMessage; readonly reconcile: ReconcilePayment;
  readonly worker: { prepare(question: ApprovedQuestion, context: AnswerContext, signal: AbortSignal): Promise<ReturnType<PrepareAnswer>> };
  /** Mandatory fail-closed output scanner; deploy a local scanner, never a model. */
  readonly scanOutput: (answer: Answer) => Promise<void>;
}

export interface BrokerRuntimeDeps extends BrokerDeps { readonly brokerPorts: BrokerPorts }
export interface SellerRuntimeDeps extends SellerDeps { readonly config: SellerConfig }
export interface MarketApi { find(context: BuyerContext, input: FindInput): Promise<FindOutput>; consult(context: BuyerContext, input: ConsultInput, options?: SellerCallOptions): Promise<ConsultView>; status(context: BuyerContext, input: StatusInput, options?: SellerCallOptions): Promise<ConsultView>; feedback(context: BuyerContext, input: AgentFeedbackInput): Promise<FeedbackOutput>; report(context: BuyerContext, input: ReportInput): Promise<ReportOutput> }
export interface RecoverySummary { readonly pending: number; readonly resolved: number; readonly failed: number }
export interface ReceiptArtifacts { readonly blobs: ReadonlyMap<Sha256, Uint8Array> }
export type ImportResult = { readonly status: 'quoted' | 'metadata_only'; readonly page_id: Id } | { readonly status: 'import_pending'; readonly code: AabErrorCode };
export interface ImportedRecord { readonly receipt_id: ReceiptId; readonly page_id: Id; readonly mode: 'quoted' | 'metadata_only'; readonly content_sha256: Sha256 }
export interface ReceiptImporter { importReceipt(receipt: Receipt, mode: 'quoted' | 'metadata_only'): Promise<ImportResult>; readback(receiptId: ReceiptId): Promise<ImportedRecord | null> }
export type PrepareAnswer = (bundle: SealedBundle, question: ApprovedQuestion, context: AnswerContext) => PreparedAnswer | Decline;
export type CreateSellerService = (deps: SellerRuntimeDeps) => SellerClient;
export type RevokeSlice = (store: Store, revocation: Revocation, journal: TombstoneJournal) => Promise<void>;
export type CreateBroker = (deps: BrokerDeps) => MarketApi;
export type ResumePending = (deps: BrokerDeps) => Promise<RecoverySummary>;
export type PersistReceipt = (tx: StoreTx, receipt: Receipt, artifacts: ReceiptArtifacts) => ReceiptId;
export type ValidateBundle = (input: BundleInput, approval: PublicApproval, scans: ScanAttestation) => ValidatedBundle;
export type SealBundle = (bundle: ValidatedBundle, signer: SellerSealSigner) => Promise<SealedBundle>;
export type ProposeListing = (bundle: SealedBundle, deployment: PublicDeployment) => ListingProposal;
export interface FixtureIdInput { readonly fixture_id: Id }
export interface FixIdInput extends FixtureIdInput { readonly fix_id: Id }
export interface FinishInput extends FixtureIdInput { readonly evidence_ids: readonly Id[] }
export interface QuestionIdInput { readonly question_id: Id }
export interface FixtureView { readonly fixture_id: Id; readonly description: string; readonly files: Readonly<Record<string, string>> }
export interface TaskEvidence { readonly fixture_id: Id; readonly evidence_id: Id; readonly operation: 'inspect_fixture' | 'check_leftovers' | 'apply_fixture_fix' | 'verify_fixture' | 'finish_with_evidence'; readonly passed: boolean; readonly artifact_sha256: Sha256; readonly recorded_at: IsoTime }
export interface ChecklistView { readonly selection?: AnswerMap['entries'][number]; readonly corpus_sha256?: Sha256; readonly map_sha256?: Sha256; readonly question_id: Id; readonly pages: readonly { readonly page_id: Id; readonly text: string; readonly sha256: Sha256 }[] }
export interface TaskTools { inspect_fixture(input: FixtureIdInput): Promise<FixtureView>; check_leftovers(input: FixtureIdInput): Promise<TaskEvidence>; apply_fixture_fix(input: FixIdInput): Promise<TaskEvidence>; verify_fixture(input: FixtureIdInput): Promise<TaskEvidence>; finish_with_evidence(input: FinishInput): Promise<TaskEvidence>; read_checklist(input: QuestionIdInput): Promise<ChecklistView> }
export interface RunSpec extends Partial<FrozenRunBinding> { readonly run_id: Id; readonly fixture_id: Id; readonly arm: 'A' | 'B' | 'C'; readonly question_id: Id; readonly model: string; readonly config_sha256: Sha256; readonly fixture_sha256: Sha256; readonly started_at: IsoTime }
export interface RunResult extends Partial<RunEvidence> { readonly run_id: Id; readonly status: 'completed' | 'failed' | 'unrun'; readonly evidence: readonly TaskEvidence[]; readonly tokens: number | null; readonly calls: number; readonly elapsed_ms: number; readonly consult_ids: readonly Id[] }
export interface Grade { readonly run_id: Id; readonly verdict: 'pass' | 'fail' | 'ungraded'; readonly reason_code: string; readonly evidence_ids: readonly Id[] }
/** SDK-neutral transport capability; T7 bridges the installed MCP transport. */
export interface StdioTransport { start(): Promise<void>; send(message: JsonValue): Promise<void>; close(): Promise<void>; onmessage?: (message: unknown) => void }
export interface ToolExposurePolicy { readonly market: readonly ('find' | 'consult' | 'status' | 'feedback' | 'report')[]; readonly task: readonly (keyof TaskTools)[] }
export type ServeMcp = (market: MarketApi, tools: TaskTools, transport: StdioTransport, policy: ToolExposurePolicy) => Promise<void>;
export type RunArm = (spec: FrozenRun, options?: SellerCallOptions) => Promise<AttemptResult>;
export interface GradeRun { (spec: RunSpec, evidence: TaskEvidence): Grade; (attempt: AttemptResult, source: ArtifactSource): Promise<ReplayGrade> }
export type RenderReplayReport = (runs: readonly RunResult[], grades: readonly Grade[]) => string;

export interface MatchedChecklist extends ChecklistView { readonly selection: AnswerMap['entries'][number]; readonly corpus_sha256: Sha256; readonly map_sha256: Sha256 }

export interface FrozenRunBinding {
  readonly study_sha256: Sha256; readonly rubric_sha256: Sha256; readonly corpus_sha256: Sha256;
  readonly round: number; readonly case_index: number; readonly primary: boolean;
}

export interface FrozenRun extends Omit<RunSpec, keyof FrozenRunBinding>, FrozenRunBinding {}

export interface ActionRecord { readonly evidence: TaskEvidence; readonly files: Readonly<Record<string, string>>; readonly input: unknown }

export interface Observation { readonly fixture_id: Id; readonly initial_sha256: Sha256; readonly files: Readonly<Record<string, string>>; readonly actions: readonly ActionRecord[]; readonly finished: boolean }

export interface Metrics {
  readonly effective_model: string; readonly config_sha256: Sha256; readonly tokens: number | null;
  readonly model_ms: number | null; readonly human_active_ms: number | null; readonly chain_ms: number | null;
  readonly model_expense_usd: string | null; readonly rpc_expense_usd: string | null; readonly hosting_expense_usd: string | null;
}

export interface Accounting {
  readonly principal_atomic: string | null; readonly network_fee_lamports: string | null;
  readonly payment_state: string; readonly delivery_state: string; readonly refund_state: string;
}

export interface RunEvidence {
  readonly spec: FrozenRun; readonly reason_code: string; readonly usage: Metrics | null;
  readonly observation: Observation | null; readonly purchases_reserved: number; readonly rejected_calls: number;
  readonly accounting: readonly Accounting[]; readonly simulated: true; readonly historical_n: 0;
  readonly compliant_primary: false; readonly limitations: readonly string[];
}

export interface AttemptResult extends Omit<RunResult, keyof RunEvidence>, RunEvidence {}

export interface ReplayGrade extends Grade { readonly critical_regression: boolean }

export interface ArtifactSource { fixture(id: Id): Uint8Array; rubric(id: Id): Uint8Array; corpus(): Uint8Array }

/** Protected, quiesced broker cleanup. External imported copies/backups remain operator-owned. */
export interface BrokerContentCleanupRequest { readonly receipt_id: Id; readonly expectedVersion: number; readonly now: IsoTime }
export interface BrokerContentCleanupResult { readonly receipt_id: Id; readonly redacted: boolean; readonly artifacts_redacted: number; readonly reason: ContentCleanupResult['reason'] }
