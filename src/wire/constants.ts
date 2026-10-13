/**
 * TODO(lead): M03 leaves CPU/PID ceilings to U3/deployment, runtime pins to U2,
 * mint/genesis/program/address pins to verified deployment, and buyer-model
 * spending to approval (D10 subsequently selects subscription replay).
 * Do not turn the 15-minute discovery target or 24-hour refund aim into SLAs.
 * Indefinite armed/liability retention has no numeric expiry. Queue 4 is stated
 * beside seller admission; its scope needs confirmation before implementation.
 * No numeric defaults for these unresolved items are supplied here.
 */
export interface Constant<Value, Unit extends string> { readonly value: Value; readonly unit: Unit }
function constant<const V, const U extends string>(value: V, unit: U): Readonly<Constant<V, U>> {
  if (Array.isArray(value)) Object.freeze(value);
  return Object.freeze({ value, unit });
}
/** Sole M03 parameter module. Units deliberately retain the source table's units. */
export const M03 = Object.freeze({
  // M03 row: Listings / fan-out
  activeListingsBaseline: constant(2, 'listings'), checksPerConsultMax: constant(3, 'checks'), selectedPurchasesMax: constant(1, 'purchases/consult'),
  // M03 row: Slice size
  slicePagesMin: constant(5, 'pages'), slicePagesMax: constant(10, 'pages'), founderSlicePages: constant(5, 'pages'), demoSlicePages: constant(5, 'pages'),
  // M03 row: Worker resource ceiling
  workerMemoryMax: constant(1, 'GiB'),
  // M03 row: Payload
  pageMax: constant(64, 'KiB'), sealedPayloadMax: constant(1, 'MiB'), chunksMax: constant(100, 'chunks'),
  // M03 row: Question
  questionBytesMax: constant(4, 'KiB UTF-8'), questionScalarsMax: constant(2000, 'Unicode scalars'),
  // M03 row: Quote TTL / arm margin
  quoteTtl: constant(300, 'seconds'), armRemainingMin: constant(30, 'seconds'), messageRenewalsMax: constant(3, 'renewals/consult'), clockSkewMax: constant(30, 'seconds'),
  // M03 row: Cache dedup
  dedupWindow: constant(10, 'minutes'),
  // M03 row: Per-buyer/seller free checks
  buyerSellerChecksPerMinute: constant(3, 'checks/minute'), buyerSellerChecksPerDay: constant(20, 'checks/UTC day'),
  buyerSellerActiveMax: constant(1, 'checks'), buyerSellerUnarmedReadyMax: constant(1, 'quotes'),
  // M03 row: Global admission
  ipChecksPerMinute: constant(10, 'checks/minute'), sellerChecksPerDay: constant(100, 'checks/UTC day'),
  sellerActiveJobsMax: constant(2, 'jobs/seller'), queueMax: constant(4, 'jobs'), queueWaitMax: constant(2, 'seconds'),
  // M03 row: Seller inference
  sellerModelCalls: constant(0, 'calls'), sellerInputTokens: constant(0, 'tokens'), sellerOutputTokens: constant(0, 'tokens'), sellerModelSpend: constant(0, 'USD'),
  // M03 row: Extractive preparation
  sectionsMax: constant(5, 'sections'), evidenceMax: constant(16, 'KiB'),
  // M03 row: Output
  answerScalarsMax: constant(1500, 'Unicode scalars'), citationsMin: constant(1, 'citations'), citationsMax: constant(3, 'citations'),
  signedEnvelopeMax: constant(8, 'KiB'), quotedScalarsMax: constant(1000, 'distinct quoted Unicode scalars'),
  // M03 row: HTTP body / fetch
  ingressBodyMax: constant(16, 'KiB'), citedPageMax: constant(64, 'KiB'), citationFetchTotalMax: constant(512, 'KiB'), redirectsAllowed: constant(false, 'policy'),
  // M03 row: Pre-check / response
  precheckMax: constant(30, 'seconds'), readyDeclineResponseMin: constant(2, 'seconds'),
  // M03 row: Payment wait
  paymentForegroundWait: constant(60, 'seconds'), paymentPoll: constant([2, 4, 8, 15], 'seconds'), sellerReconciliationInterval: constant(15, 'seconds'),
  // M03 row: Finality
  finality: constant('finalized', 'commitment'), finalizedMetaErr: constant(null, 'meta.err'), exactMessageAndDeltasRequired: constant(true, 'policy'),
  // M03 row: Reveal / rescue
  revealAttemptMax: constant(10, 'seconds'), revealRetriesMax: constant(2, 'same-ID retries after initial attempt'),
  revealRetryWindow: constant(60, 'seconds'), nonDeliveryAfterFinality: constant(10, 'minutes'),
  // M03 row: Price / fee
  totalAtomic: constant(10000n, 'atomic units'), sellerAtomic: constant(9000n, 'atomic units'), marketplaceAtomic: constant(1000n, 'atomic units'),
  tokenDecimals: constant(6, 'decimals'), marketplaceFeeBps: constant(1000, 'basis points'),
  // M03 row: Devnet purchase caps
  devnetPrincipalPerCall: constant(50000n, 'atomic units/call'), devnetPrincipalPerDay: constant(500000n, 'atomic units/UTC day/payer'),
  // M03 row: SOL fee caps
  feePerPurchaseMax: constant(100000n, 'lamports/purchase'), devnetFeePerDayMax: constant(1000000n, 'lamports/UTC day'),
  // M03 row: Mainnet budget
  mainnetSuccessfulPurchasesMax: constant(1, 'successful purchases/demonstration'), mainnetPrincipal: constant(10000n, 'atomic units'), mainnetAttemptFeeMax: constant(100000n, 'lamports'),
  // M03 row: Retention
  unarmedExpiredRetention: constant(24, 'hours after expiry'), safePaidRetention: constant(30, 'days after finality'),
  unresolvedArmedRetention: constant('until_resolution_unless_revoked', 'policy'), unresolvedLiabilityRetention: constant('until_adjudicated', 'policy'),
  // M03 row: Logs / private staging
  counterRetention: constant(7, 'days'), rejectedDraftRetention: constant(7, 'days unless founder records need'), rawSellerQuestionStorage: constant('request_memory_only', 'policy'),
  // M03 row: Revocation / freshness
  lineageAcknowledgementMaxAge: constant(24, 'hours and before every session'), humanDiscoveryTarget: constant(15, 'minutes (target, not SLA)'),
  eligibilityCheckAt: constant(['quote', 'arm', 'page', 'reveal', 'restore', 'startup'], 'operations'), cdnFeedAllowed: constant(false, 'policy'),
  // M03 row: Revoked content cleanup
  revokedServingBlock: constant('immediate', 'policy'), revokedCopyCleanupMax: constant(24, 'hours'), founderIncidentCopyRetention: constant(7, 'days'),
  // M03 row: Feedback
  feedbackWindow: constant(7, 'days'), observationsPerConsultSource: constant(1, 'observations'), feedbackCorrections: constant('append_only', 'policy'),
  // M03 row: Refund support
  refundRequestWindow: constant(30, 'days'), refundRecoveryAim: constant(24, 'hours (aim, not guarantee)'),
  // M03 row: Replay per arm
  replayWallTimeMax: constant(10, 'minutes/arm'), replayBuyerTokensMax: constant(8000, 'tokens/arm'), replayCallsMax: constant(30, 'task/MCP calls/arm'), replayPaidArmPurchasesMax: constant(1, 'devnet purchases'),
  // M03 row: Discovery spikes
  discoveryInitialCheckMax: constant(30, 'minutes/capability'),
});
