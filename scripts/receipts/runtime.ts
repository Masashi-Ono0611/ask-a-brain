/** Protected composition root; never load into the runtime buyer process.
 * Supply a dedicated receipt-source adapter and authenticated operator/checker
 * ports. No real gbrain, wallet, shell, search or network defaults are installed.
 */
import { createReceiptPersistence } from '../../src/broker/receipts/index.ts';
import { createReceiptImporter } from '../../src/broker/import/index.ts';
import type { ReceiptImportDeps } from '../../src/broker/import/index.ts';
import { createOutcomeService } from '../../src/broker/outcomes/index.ts';
import type { OutcomeDeps } from '../../src/broker/outcomes/index.ts';
import type { Id } from '../../src/wire/contracts.ts';

export type ReceiptRuntimeDeps = ReceiptImportDeps & OutcomeDeps & { readonly isReplay?: (consultId: Id) => boolean };
export function composeReceipts(deps: ReceiptRuntimeDeps) {
  const importer = createReceiptImporter(deps), outcomes = createOutcomeService(deps);
  const persistReceipt = createReceiptPersistence({ clock: deps.clock, ...(deps.isReplay ? { isReplay: deps.isReplay } : {}) });
  return { persistReceipt, importer, outcomes, feedback: outcomes.feedback, report: outcomes.report };
}
// Lead/T11: inject persistReceipt/feedback/report into BrokerPorts and importer
// into BrokerDeps.receiptImporter. Schedule importer.retryPending() separately
// from consult/status. It performs no purchase/sign/broadcast operation. Only
// importer.retrieve(authenticatedBuyer, receiptId) may expose imported prose.
// Human/checker/refund methods remain protected and are NOT agent MCP tools.
