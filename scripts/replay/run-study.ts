import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { captureMock } from './capture-inventory-mock.ts';
import { z } from 'zod';
import { bytesHash, canonicalBytes, parseWire, strictJson, sellerPublicKeySchema } from '../../src/wire/index.ts';
import type { Id, SellerPublicKey } from '../../src/wire/contracts.ts';
import { loadSeal, createKnowledge } from './host-knowledge.ts';
import { pinSchema } from './host-config.ts';
import { armSchema } from './host-surface.ts';
import { runHostAttempt } from './run-host-attempt.ts';
import type { HostResult } from './run-host-attempt.ts';
import { readPublicFile } from './request.ts';
const hash = z.string().regex(/^[a-f0-9]{64}$/), path = z.string().startsWith('/').refine((s) => !s.split('/').some((p) => p === '..' || p === '~'));
const requestSchema = z.object({ root: path, output: path, rubric_directory: path, projection_directory: path, sealed_file: path,
  signing_key_file: path, source_questions: path, source_map: path, origin: z.string().url(), pin: pinSchema,
  codex: path, codex_sha256: hash, code_revision: z.string().regex(/^[a-f0-9]{40}$/),
  sealed_sha256: hash, signing_key_sha256: hash, amendment_sha256: hash, error_codes: z.boolean().optional() }).strict();
const protocolHash = '999bf14efe3f7c84bcfbab7d81e32c2e5d3012dcaa48d3842069b52d8cc6175e';
const manifestHash = '09bb7d38a0e6ef2782e73b41bc311e2ea8c4f182b5615167892e4a5c2a72db5c';
export const strata = Object.freeze({ 'no resolution overlap': ['I2'], 'lesson-overlapped': ['I1', 'I4', 'I5', 'I6', 'I8'] });
export function loadHostStudy(requestPath: string) {
  const request = requestSchema.parse(strictJson(readPublicFile(requestPath)));
  const readPinned = (path: string, expected: string) => { const bytes = readPublicFile(path); if (bytesHash(bytes) !== expected) throw new Error('FROZEN_ARTIFACT_CHANGED'); return bytes; };
  const protocol = strictJson(readPinned(join(request.root, 'config/eval/protocol.json'), protocolHash)) as unknown as { incident_order: string[]; rotation: { fixture_id: string; order: ('A' | 'B' | 'C')[] }[] };
  const manifest = strictJson(readPinned(join(request.root, 'fixtures/eval/approved/manifest.json'), manifestHash)) as unknown as { cases: { fixture_id: string; fixture_sha256: string; rubric_sha256: string }[] };
  readPinned(request.codex, request.codex_sha256);
  const revision = spawnSync('git', ['-C', request.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const status = spawnSync('git', ['-C', request.root, 'status', '--porcelain'], { encoding: 'utf8' });
  if (revision.status !== 0 || revision.stdout.trim() !== request.code_revision || status.status !== 0 || status.stdout.trim()) throw new Error('CLEAN_PINNED_REVISION_REQUIRED');
  const amendment = readPinned(join(request.root, 'config/eval/protocol-amendment.json'), request.amendment_sha256);
  const sealBytes = readPinned(request.sealed_file, request.sealed_sha256);
  const key = sellerPublicKeySchema.parse(strictJson(readPinned(request.signing_key_file, request.signing_key_sha256))) as SellerPublicKey;
  const seal = strictJson(sealBytes) as { manifest: unknown };
  const manifestWire = parseWire('manifest', canonicalBytes(seal.manifest));
  const files = new Map<string, Uint8Array>();
  for (const file of manifestWire.payload.files) {
    if (!/^(pages\/[A-Za-z0-9_-]+\.md|question-policy\.json|answer-map\.json)$/.test(file.path)) throw new Error('BUNDLE_PATH_DENIED');
    files.set(file.path, readPinned(join(request.projection_directory, file.path), file.sha256));
  }
  const bundle = loadSeal(sealBytes, files, key);
  const knowledge = createKnowledge(bundle, readPublicFile(request.source_questions), readPublicFile(request.source_map), request.origin);
  const policy = parseWire('question_policy', files.get('question-policy.json')!);
  const cases = manifest.cases.map((c) => ({ ...c,
    fixture: readPinned(join(request.root, `fixtures/eval/approved/public/${c.fixture_id}.json`), c.fixture_sha256),
    rubric: readPinned(join(request.rubric_directory, `${c.fixture_id}.json`), c.rubric_sha256) }));
  const authDirectory = process.env.AAB_CODEX_AUTH_DIR;
  if (!authDirectory) throw new Error('AAB_CODEX_AUTH_DIR_REQUIRED');
  return { request, protocol, cases, knowledge, authDirectory, amendment_sha256: bytesHash(amendment),
    questionCatalog: policy.questions.map((q) => ({ question_id: q.question_id, text: q.text })) };
}
export async function runOne(study: ReturnType<typeof loadHostStudy>, fixture: string, rawArm: string, expectedResidual: string) {
  const arm = armSchema.parse(rawArm), row = study.cases.find((c) => c.fixture_id === fixture);
  if (!row) throw new Error('FIXTURE_DENIED');
  const run = `${fixture}_${arm}` as Id;
  return runHostAttempt({ root: study.request.root, directory: join(study.request.output, run), fixture: row.fixture, rubric: row.rubric,
    arm, run, expectedResidual, pin: study.request.pin, command: { executable: study.request.codex, prefix: [] }, authDirectory: study.authDirectory,
    knowledge: arm === 'A' ? null : study.knowledge, questionCatalog: study.questionCatalog, errorCodes: study.request.error_codes === true });
}
export async function captureStudySurface(study: ReturnType<typeof loadHostStudy>) {
  const results = [];
  for (const arm of ['A', 'B', 'C'] as const) results.push(await captureMock(study.request.root, join(study.request.output, `preflight-${arm}`), arm, study.request.pin, { executable: study.request.codex, prefix: [] }));
  if (new Set(results.map((r) => r.residual_sha256)).size !== 1) throw new Error('ASYMMETRIC_RESIDUAL_SURFACE');
  return results[0]!.residual_sha256;
}
export function stratifiedReport(results: readonly HostResult[]) {
  const allIds = ['I1', 'I2', 'I4', 'I5', 'I6', 'I8'];
  const seen = new Set<string>();
  for (const r of results) { const key = `${r.fixture_id}_${r.arm}`; if (!allIds.includes(r.fixture_id) || seen.has(key)) throw new Error('DUPLICATE_OR_FOREIGN_ATTEMPT'); seen.add(key); }
  const summaries = Object.entries({ pooled: allIds, ...strata }).map(([stratum, ids]) => {
    const overlap = stratum === 'pooled' ? 'mixed: I2 none; I1/I4/I5/I6/I8 lesson-overlapped' : stratum;
    const figure = (value: number | null) => ({ value, overlap });
    const rows = results.filter((r) => ids.includes(r.fixture_id));
    const arms = (['A', 'B', 'C'] as const).map((arm) => {
      const runs = rows.filter((r) => r.arm === arm);
      return { arm, planned: figure(ids.length), attempted: figure(runs.length), unrun: figure(ids.length - runs.length),
        incomplete: figure(runs.filter((r) => r.status === 'incomplete').length),
        pass: figure(runs.filter((r) => r.verdict === 'pass').length), fail: figure(runs.filter((r) => r.verdict === 'fail').length), unknown: figure(runs.filter((r) => r.verdict === 'ungraded').length),
        critical_regression: figure(runs.filter((r) => r.critical_regression).length), wall_ms: figure(runs.some((r) => r.elapsed_ms === null) ? null : runs.reduce((n, r) => n + r.elapsed_ms!, 0)),
        observed_tokens: figure(runs.some((r) => r.tokens === null) || runs.length === 0 ? null : runs.reduce((n, r) => n + r.tokens!, 0)),
        unknown_usage: figure(runs.filter((r) => r.tokens === null).length), token_overruns: figure(runs.filter((r) => r.token_limit_exceeded).length), live_paid: figure(0) };
    });
    const pairs = (['A', 'B'] as const).map((arm) => {
      const cells = { both_pass: 0, both_fail: 0, improvement: 0, regression: 0, unknown: 0 };
      for (const id of ids) {
        const a = rows.find((r) => r.fixture_id === id && r.arm === arm), c = rows.find((r) => r.fixture_id === id && r.arm === 'C');
        if (!a || !c || a.verdict === 'ungraded' || c.verdict === 'ungraded') cells.unknown++;
        else if (a.verdict === c.verdict) cells[a.verdict === 'pass' ? 'both_pass' : 'both_fail']++;
        else cells[c.verdict === 'pass' ? 'improvement' : 'regression']++;
      }
      return { comparison: `${arm}-C`, cells: Object.fromEntries(Object.entries(cells).map(([key, n]) => [key, figure(n)])) };
    });
    return { stratum, arms, pairs, incomplete_triples: figure(ids.filter((id) => ['A', 'B', 'C'].some((arm) => !rows.some((r) => r.fixture_id === id && r.arm === arm && r.status === 'completed'))).length) };
  });
  return { label: 'exploratory', payment_mode_C: 'SIMULATED', live_paid: { value: 0, overlap: 'all strata' },
    human_active_time: 'not measured', model_rpc_hosting_expenses: 'not measured', principal_atomic: '0 (SIMULATED; all strata)',
    summaries, attempts: results.map((r) => ({ ...r, overlap: r.fixture_id === 'I2' ? 'no resolution overlap' : 'lesson-overlapped' })) };
}
export async function executeStudy(rotation: readonly { fixture_id: string; order: readonly ('A' | 'B' | 'C')[] }[], run: (id: string, arm: 'A' | 'B' | 'C') => Promise<HostResult>, record: (results: readonly HostResult[], phase: 'started' | 'finished') => void) {
  const results: HostResult[] = [];
  for (const row of rotation) for (const arm of row.order) {
    const provisional: HostResult = { run: `${row.fixture_id}_${arm}`, fixture_id: row.fixture_id, arm, status: 'incomplete', reason: 'IN_PROGRESS_OBSERVATION_PENDING', verdict: 'ungraded',
      elapsed_ms: null, calls: null, tokens: null, token_limit_exceeded: null, critical_regression: false, payment_mode: arm === 'C' ? 'SIMULATED' : 'none', live_paid: false, residual_sha256: null };
    record([...results, provisional], 'started');
    try { results.push(await run(row.fixture_id, arm)); }
    catch { results.push({ ...provisional, reason: 'ATTEMPT_EXCEPTION' }); }
    record(results, 'finished');
    const residuals = results.flatMap((r) => r.residual_sha256 ? [r.residual_sha256] : []);
    if (new Set(residuals).size > 1) throw new Error('ASYMMETRIC_RESIDUAL_SURFACE');
  }
  return results;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [request, ...extra] = process.argv.slice(2);
  // Single rehearsal attempt (a separately frozen request/output, never a replacement for a study outcome):
  //   node scripts/replay/run-study.ts REQUEST --single FIXTURE ARM
  if (request && extra[0] === '--single') {
    if (extra.length !== 3) throw new Error('SINGLE_NEEDS_FIXTURE_AND_ARM');
    const study = loadHostStudy(request); mkdirSync(study.request.output, { mode: 0o700 });
    const expected = await captureStudySurface(study);
    console.log(JSON.stringify(await runOne(study, extra[1]!, extra[2]!, expected)));
    process.exit(0);
  }
  if (!request || extra.length) throw new Error('REQUEST_REQUIRED');
  const study = loadHostStudy(request); mkdirSync(study.request.output, { mode: 0o700 });
  writeFileSync(join(study.request.output, 'freeze.json'), canonicalBytes({ request: study.request, protocol_sha256: protocolHash, manifest_sha256: manifestHash, amendment_sha256: study.amendment_sha256 }), { flag: 'wx' });
  const expectedResidual = await captureStudySurface(study);
  await executeStudy(study.protocol.rotation, (id, arm) => runOne(study, id, arm, expectedResidual), (results, phase) => {
    // Before-start and terminal snapshots both survive interruption.
    writeFileSync(join(study.request.output, `report-${String(results.length).padStart(2, '0')}-${phase === 'started' ? '0-started' : '1-finished'}.json`), canonicalBytes(stratifiedReport(results)), { flag: 'wx' });
  });
}
