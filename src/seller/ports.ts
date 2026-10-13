/** Compatibility export names for the shared contracts; no duplicate row shapes. */
import type { Answer, Signed, JsonValue } from '../wire/contracts.ts';
export type { SellerLimits, SellerWire, Span, AnswerMap, PreparationConfig, AuthoritySnapshot, Invitation, SellerArmRow, SellerQuoteRow, SellerRequestRecord, SellerRuntimeDeps as SellerDependencies } from '../wire/contracts.ts';
export function jsonValue(value: unknown): JsonValue { return value as JsonValue; }
export type PreparedEnvelope = Signed<Answer>;

/** Local adapter pending T0 SellerConfig.rpcOrigins contract addition. Missing pins fail closed. */
export type SellerConfig = import('../wire/contracts.ts').SellerConfig & { readonly rpcOrigins?: readonly [string, string] };
