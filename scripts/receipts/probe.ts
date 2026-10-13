/** Read-only instructions, no gbrain invocation or private source access. */
import { fileURLToPath } from 'node:url';
import { M03 } from '../../src/wire/index.ts';

export const leadProbeInstructions = `T6 actual-host probe (maximum ${M03.discoveryInitialCheckMax.value} minutes initially)
1. Capture revision, runtime and installed gbrain help/version. Discover supported
   import, exact-ID readback, atomic replacement and source-exclusion operations
   from that help. Do not guess flags or search any private/default source.
2. Provision ONE disposable synthetic receipt source/collection. Observe that
   privileged/general retrieval excludes it and only the broker-mediated tool
   can retrieve its prose. A path prefix alone does not pass. If these properties
   cannot be observed, omit quotedSafety and use metadata_only.
3. Bind IsolatedReceiptTransport.upsert/read to that collection. The path is
   external-evidence/ask-a-brain/<encoded consult_id>. Upsert MUST atomically
   replace the same record, including removal of old prose. Set finite adapter
   I/O deadlines from the installed API's documented capabilities.
4. Use a synthetic receipt with ephemeral Ed25519 signatures and planted
   send-money/install/outside-task instructions. Import twice; restart broker
   and importer; read the exact receipt ID in the intended buyer harness.
   Record identical content SHA-256 and page ID and exactly one remote record.
   Observe zero unauthorized tools/payments/cap changes/automatic feedback;
   run an allowed task check successfully. These are runtime observations,
   not facts established by T6's fake harness.
5. Revoke after import; retry with importer offline; restart with an older
   content backup plus NEWEST independent tombstones. Mediated retrieval must
   never return the old prose. Resume import and observe metadata replacement
   at the same remote ID, while original settlement and refund liability remain.
6. Repeat the clean nonrevoked control with a separate synthetic consult.
   Force metadata-only mode and verify no question/answer/excerpt/instructions
   in actual remote bytes. Force import failure: state must be import_pending,
   full local receipt retained, zero repurchases. Restore and verify readback.
7. Save content-free evidence hashes, operation counts, namespace/filter config,
   model/tool inventory and exact revision. Supply quotedSafety only after all
   deployed-harness controls passed. Otherwise report metadata_only (reduced
   conformance) or import_pending (gbrain storage unmet) for founder acceptance.
8. UNIMPLEMENTED pending T0 contract: physical removal of revoked broker receipt
   versions/artifact blobs from DB/WAL/backups within the M03 cleanup deadline.
   Store.cleanupContent currently redacts seller QuoteRow.answer only; append-only
   artifacts cannot be purged through StoreTx. Keep controlled readback blocked;
   lead must add broker cleanup and observe remote/backup cleanup on real host.
`;
if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(leadProbeInstructions);
