import type { BrokerPorts as WireBrokerPorts, CreateBroker, ExpectedPayment, ResumePending, RpcClient } from '../wire/contracts.ts';
export type { BrokerLimits, BrokerRuntimeDeps } from '../wire/contracts.ts';
/** CONTRACT REQUEST: promote this protected port to wire/contracts.ts.
 * Until then existing compositions use the real chain validator by default. */
export interface BrokerPorts extends WireBrokerPorts {
  readonly validatePaymentAccounts?: (expected: ExpectedPayment, rpc: RpcClient) => Promise<void>;
}
export interface BoundBroker { readonly createBroker: CreateBroker; readonly resumePending: ResumePending }
