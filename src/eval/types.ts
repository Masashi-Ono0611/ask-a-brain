/** Role-local orchestration ports; shared replay records are re-exported. */
import type { AnswerMap, BuyerContext, ChecklistView, Clock, Id, MarketApi, RunSpec, Sha256, TaskTools, Observation, ArtifactSource, Metrics } from '../wire/contracts.ts';
export type Arm = RunSpec['arm'];
export type Files = Readonly<Record<string, string>>;
export interface Predicate { readonly file_id: Id; readonly equals: string }
export interface Fixture {
  readonly v: 1; readonly fixture_id: Id; readonly label: 'synthetic'; readonly family_id: Id;
  readonly prompt: string; readonly files: Files;
  readonly fixes: readonly { readonly fix_id: Id; readonly description: string; readonly changes: Files }[];
  readonly checks: readonly Predicate[]; readonly leftovers: readonly Predicate[];
}
export interface Rubric {
  readonly v: 1; readonly fixture_id: Id; readonly label: 'synthetic'; readonly canary: string;
  readonly pass: readonly Predicate[]; readonly fail: readonly Predicate[]; readonly critical_regression: readonly Predicate[];
}
export interface Corpus { readonly v: 1; readonly pages: ChecklistView['pages']; readonly map: AnswerMap }

export interface FrozenCase { readonly fixture_id: Id; readonly fixture_sha256: Sha256; readonly rubric_sha256: Sha256; readonly question_id: Id }
export interface Study {
  readonly v: 1; readonly study_id: Id; readonly mode: 'synthetic'; readonly repeat_rounds: number; readonly cases: readonly FrozenCase[];
  readonly corpus_sha256: Sha256; readonly model: string; readonly effective_model: string;
  readonly config_sha256: Sha256; readonly question_policy_sha256: Sha256; readonly code_revision: string;
  readonly token_enforcement: 'unverified' | 'synthetic_meter';
}

export interface BuyerSession {
  readonly fixture_id: Id; readonly question_id: Id; readonly prompt: string; readonly tools: readonly string[];
  /** Sole capability. Raw UTF-8 JSON admits duplicate/unknown-field checks. */
  call(bytes: Uint8Array): Promise<unknown>;
}
/** Trusted supervisor port, NOT a model-controlled metrics/tool response. */
export interface Driver { execute(session: BuyerSession, signal: AbortSignal): Promise<Metrics> }

export interface JournalEvent { readonly kind: 'start' | 'call' | 'result'; readonly run_id: Id; readonly data: unknown }
export interface Journal { append(event: JournalEvent): void; read(): readonly JournalEvent[] }
export interface RunnerDependencies {
  readonly study: Study; readonly source: ArtifactSource; readonly clock: Clock; readonly journal: Journal;
  readonly driver: Driver; readonly market: MarketApi; readonly buyer: BuyerContext;
}
export interface ToolController { readonly tools: TaskTools; snapshot(): Observation; close(): void }

export type { MatchedChecklist, FrozenRun, ActionRecord, Observation, Metrics, Accounting, AttemptResult, ReplayGrade } from '../wire/contracts.ts';
export type { ArtifactSource } from '../wire/contracts.ts';
