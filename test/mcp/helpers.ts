import { readFileSync } from 'node:fs';
import { FixedClock } from '../../src/common/index.ts';
import { createTaskTools, parseCorpus, parseFixture } from '../../src/eval/index.ts';
import type { BuyerContext, ConsultInput, Id, MarketApi } from '../../src/wire/contracts.ts';
import { createRunGateway } from '../../scripts/runtime/gateway.ts';
import { buyer, consultInput, syntheticMarket } from '../../scripts/eval/synthetic.ts';
import type { Arm } from '../../src/mcp/index.ts';
export function setup(arm: Arm = 'C', marketOverride?: MarketApi) {
  const clock = new FixedClock('2026-10-09T00:00:00.000Z');
  const fixture = parseFixture(readFileSync(new URL('../../fixtures/eval/synthetic/s1.json', import.meta.url)));
  const corpus = parseCorpus(readFileSync(new URL('../../fixtures/eval/synthetic/corpus.json', import.meta.url)));
  const controller = createTaskTools(fixture, corpus, arm, clock, 't7' as Id);
  const contexts: BuyerContext[] = [], dispatches: string[] = [];
  const base = marketOverride ?? syntheticMarket();
  const market: MarketApi = {
    async find(ctx, arg) { contexts.push(ctx); dispatches.push('find'); return base.find(ctx, arg); },
    async consult(ctx, arg) { contexts.push(ctx); dispatches.push('consult'); return base.consult(ctx, arg); },
    async status(ctx, arg) { contexts.push(ctx); dispatches.push('status'); return base.status(ctx, arg); },
    async feedback(ctx, arg) { contexts.push(ctx); dispatches.push('feedback'); return base.feedback(ctx, arg); },
    async report(ctx, arg) { contexts.push(ctx); dispatches.push('report'); return base.report(ctx, arg); },
  };
  const questionId = corpus.map.entries[0]!.question_id;
  const options = { arm, buyer, fixtureId: fixture.fixture_id, questionId, tools: controller.tools, market, clock };
  const gateway = createRunGateway(options);
  return { ...options, gateway, controller, contexts, dispatches, input: consultInput(questionId) as ConsultInput };
}
