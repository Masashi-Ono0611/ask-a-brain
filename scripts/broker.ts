/** Protected composition root. Never import this from the buyer bundle. */
import { bindBroker } from '../src/broker/index.ts';
import { M03, canonicalBytes, payloadHash, parseWire, resolveQuestion, verifyEnvelope, verifyCitations } from '../src/wire/index.ts';
import { buildLegacyPayment, validateLegacyMessage, attachSignature, reconcilePayment, verifyFinalizedPayment } from '../src/chain/index.ts';
import { createReceiptPersistence } from '../src/broker/receipts/index.ts';
import { createOutcomeService } from '../src/broker/outcomes/index.ts';
import type { OutcomeDeps } from '../src/broker/outcomes/index.ts';
import type { BrokerDeps, BrokerPorts } from '../src/wire/contracts.ts';
import { createRunGateway, listenGateway } from './runtime/gateway.ts';
import type { GatewayOptions } from './runtime/gateway.ts';
export function composeBroker(deps: BrokerDeps, options: Pick<BrokerPorts, 'payer' | 'rpcOrigins'> & Pick<OutcomeDeps, 'authorizeHuman' | 'verifyRun' | 'verifyRefund'>) {
  const outcomes = createOutcomeService({ ...options, store: deps.store, clock: deps.clock, buyer: deps.policy.buyer });
  const ports: BrokerPorts = { ...options, limits: M03, canonicalBytes, payloadHash, parseWire, resolveQuestion, verifyEnvelope, verifyCitations,
    buildLegacyPayment, validateLegacyMessage, attachSignature, reconcilePayment, verifyFinalizedPayment,
    persistReceipt: createReceiptPersistence({ clock: deps.clock }), feedback: outcomes.feedback, report: outcomes.report };
  const bound = bindBroker(ports);
  return { market: bound.createBroker(deps), resume: () => bound.resumePending(deps), outcomes, ports };
}
export async function startBrokerGateway(path: string, options: GatewayOptions) {
  const gateway = createRunGateway(options), server = await listenGateway(path, gateway);
  return { gateway, server, async close() { gateway.close(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); } };
}
