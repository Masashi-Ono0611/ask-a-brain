/** Trusted operator request, never model-visible. Source files stay on the host. */
import { readFileSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { z } from 'zod';
import { strictJson } from '../../src/wire/index.ts';
import type { ArtifactSource, FrozenRun } from '../../src/wire/contracts.ts';
import { imagePin } from './docker.ts';
import { parseDocumentation } from './config.ts';
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().regex(/^[A-Za-z0-9_-]+$/);
const specSchema = z.object({ run_id: id, fixture_id: id, arm: z.enum(['A', 'B', 'C']), question_id: id, model: z.string().min(1),
  config_sha256: hash, fixture_sha256: hash, started_at: z.string().datetime(), study_sha256: hash, rubric_sha256: hash, corpus_sha256: hash,
  round: z.number().int().nonnegative(), case_index: z.number().int().nonnegative(), primary: z.boolean() }).strict();
const path = z.string().startsWith('/').refine((s) => !s.includes('\0') && !s.split('/').includes('..') && !s.split('/').includes('~'));
const requestSchema = z.object({ spec: specSchema, directory: path, journal: path, image: imagePin,
  fixture: path, rubric: path, corpus: path, documentation: path.optional() }).strict();
export function parseRequest(bytes: Uint8Array) { return requestSchema.parse(strictJson(bytes)); }
export function readPublicFile(path: string): Buffer {
  // macOS /tmp and /var are OS directory aliases. Do not reject those; open
  // the final component without following a link and validate the opened inode.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!fstatSync(fd).isFile()) throw new Error('SOURCE_PATH_DENIED'); return readFileSync(fd); } finally { closeSync(fd); }
}
export function loadRequest(path: string) {
  const request = parseRequest(readPublicFile(path));
  const spec = request.spec as FrozenRun;
  const fixture = readPublicFile(request.fixture), corpus = readPublicFile(request.corpus), rubric = readPublicFile(request.rubric);
  const source: ArtifactSource = { fixture(id) { if (id !== spec.fixture_id) throw new Error('FIXTURE_DENIED'); return fixture; },
    rubric(id) { if (id !== spec.fixture_id) throw new Error('FIXTURE_DENIED'); return rubric; }, corpus: () => corpus };
  return { spec, source, directory: request.directory, journalPath: request.journal, image: request.image,
    ...(request.documentation ? { documentation: parseDocumentation(readPublicFile(request.documentation)) } : {}) };
}
