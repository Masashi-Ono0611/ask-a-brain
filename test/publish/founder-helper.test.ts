import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import type { HumanTerminal } from '../../src/chain/index.ts';
import type { SellerPublicKey } from '../../src/wire/contracts.ts';
import { M03, bytesHash, canonicalBytes, encodeBase58, parseWire, payloadHash, strictJson, verifyEnvelope } from '../../src/wire/index.ts';
import { createReviewPacket, inertText } from '../../src/publish/index.ts';
import type { PublisherApproval } from '../../src/publish/index.ts';
import { protectedLocation, runFounderHelper } from '../../scripts/publish/founder-seal-helper.ts';
import { fixture, harness, temporary, worksheet, writeProjection } from './helpers.ts';

const phrases = ['yes review', 'yes originals', 'yes lineage', 'yes rights', 'yes download', 'yes cc-by'];
function setup(t: TestContext) {
  const root = temporary(t), safe = join(root, 'protected'); mkdirSync(safe, { mode: 0o700 });
  const input = fixture(), projection = join(root, 'projection'); writeProjection(projection, input);
  const manifest = join(root, 'manifest.json'), review = join(root, 'review.txt'), scan = join(root, 'scan.json');
  const packet = createReviewPacket(input, worksheet(input));
  writeFileSync(manifest, canonicalBytes(input.manifest)); writeFileSync(review, inertText(packet));
  const attestation = { bundle_sha256: payloadHash(input.manifest.files), scanner_version: '0.0.0-test', scanner_sha256: bytesHash(Buffer.from('synthetic scanner')), scanned_at: new Date().toISOString(), passed: true };
  writeFileSync(scan, canonicalBytes(attestation));
  const key = join(safe, 'seller.pk8'), approval = join(safe, 'approval.json'), signed = join(safe, 'signed.json');
  const displays: string[] = [], reports: string[] = []; let response: (display: string, index: number) => string = (display) => display.match(/Type exactly: (.+)\n$/)![1]!;
  let tty = true;
  const terminal: HumanTerminal = { isTTY: () => tty, async approve(display) { displays.push(display); return response(display, displays.length - 1); } };
  // Test-only policy: permit only this mkdtemp root; still exercise every other
  // production path/owner/mode/worktree check. No equivalent CLI option exists.
  const protect = (path: string) => {
    assert.ok(path.startsWith(`${root}/`), 'synthetic helper attempted to leave its temp directory');
    return protectedLocation(path, []);
  };
  const run = (args: readonly string[]) => runFounderHelper(args, { terminal, protectPath: protect, report: (line) => { reports.push(line); } });
  const approve = () => run(['approve', projection, manifest, review, scan, approval]);
  const sign = () => run(['sign', key, manifest, signed]);
  const init = () => run(['init-key', key]);
  const restoreTerminal = () => { tty = true; displays.length = 0; response = display => display.match(/Type exactly: (.+)\n$/)![1]!; };
  return { root, safe, input, projection, manifest, review, scan, packet, attestation, key, approval, signed, displays, reports, terminal, protect, run, approve, sign, init, restoreTerminal,
    setResponse(fn: typeof response) { response = fn; }, setTTY(value: boolean) { tty = value; } };
}

test('clean ceremony writes strict current approval and domain-separated verified signature without key disclosure', async t => {
  const h = setup(t); const before = Date.now();
  await h.init(); await h.approve(); await h.sign();
  for (const path of [h.key, h.approval, h.signed]) assert.equal(lstatSync(path).mode & 0o777, 0o600);
  const approval = strictJson(readFileSync(h.approval)) as unknown as PublisherApproval;
  assert.deepEqual(approval, { v: 1, approval: { approval_id: h.input.manifest.approval_id, payload_sha256: payloadHash(h.input.manifest), approved_at: approval.approval.approved_at, actor: 'human' },
    review_sha256: payloadHash(h.packet), whole_page_download: true, rights_confirmed: true, origins_unchanged: true, originals_scan_passed: true, lineage_complete: true, withdrawn: false, acknowledged_at: approval.approval.approved_at });
  assert.ok(Date.parse(approval.approval.approved_at) >= before && Date.parse(approval.approval.approved_at) <= Date.now());
  assert.deepEqual(h.displays.slice(0, phrases.length).map(d => d.match(/Type exactly: (.+)\n$/)![1]), phrases);
  for (const digest of [payloadHash(h.input.manifest), payloadHash(h.input.manifest.files), payloadHash(h.packet), bytesHash(readFileSync(h.review)), bytesHash(readFileSync(h.scan))]) assert.ok(h.displays[0]!.includes(digest));
  assert.ok(h.displays[0]!.includes('"passed":true'));
  assert.equal(JSON.parse(h.reports[1]!).approval_file_sha256, bytesHash(readFileSync(h.approval)));
  const secret = readFileSync(h.key);
  try {
    const privateKey = createPrivateKey({ key: secret, type: 'pkcs8', format: 'der' });
    const raw = Buffer.from(createPublicKey(privateKey).export({ format: 'jwk' }).x!, 'base64url');
    assert.deepEqual(JSON.parse(h.reports[0]!), { public_key: encodeBase58(raw), sha256: bytesHash(raw) });
    const envelope = parseWire('manifest', readFileSync(h.signed));
    const publicKey = JSON.parse(h.reports[2]!).signing_key as SellerPublicKey;
    assert.equal(publicKey.id, `seller-${bytesHash(raw)}`); verifyEnvelope('manifest', envelope, publicKey);
    const signature = Buffer.from(envelope.signature.value, 'base64url');
    assert.equal(verify(null, Buffer.concat([Buffer.from('ask-a-brain/v1/manifest\n'), canonicalBytes(h.input.manifest)]), createPublicKey(privateKey), signature), true);
    assert.equal(verify(null, Buffer.concat([Buffer.from('ask-a-brain/v1/answer\n'), canonicalBytes(h.input.manifest)]), createPublicKey(privateKey), signature), false);
    const log = h.reports.join('\n') + h.displays.join('\n');
    for (const value of [secret.toString('base64'), secret.toString('hex'), privateKey.export({ format: 'jwk' }).d!]) assert.equal(log.includes(value), false);
  } finally { secret.fill(0); }
});

for (const [index, phrase] of phrases.entries()) test(`approval requires separate exact ${phrase}; restored clean counterpart passes`, async t => {
  const h = setup(t);
  h.setResponse((display, i) => i === index ? `${phrase} ` : display.match(/Type exactly: (.+)\n$/)![1]!);
  await assert.rejects(h.approve(), /EXACT_PHRASE_REQUIRED/); assert.equal(existsSync(h.approval), false); assert.equal(h.displays.length, index + 1);
  h.restoreTerminal(); await h.approve(); assert.equal(existsSync(h.approval), true);
});

for (const phrase of ['', 'yes', 'SIGN', `sign ${'0'.repeat(64)}`]) test(`wrong signing phrase ${JSON.stringify(phrase)} rejects before reading key; clean pair signs`, async t => {
  const h = setup(t); h.setResponse(() => phrase);
  await assert.rejects(h.sign(), /EXACT_PHRASE_REQUIRED/); assert.equal(existsSync(h.signed), false);
  h.restoreTerminal(); await h.init(); await h.sign(); assert.equal(existsSync(h.signed), true);
});

for (const command of ['init-key', 'approve', 'sign'] as const) test(`${command} rejects non-TTY before I/O; clean scripted terminal passes`, async t => {
  const h = setup(t); const action = command === 'init-key' ? h.init : command === 'approve' ? h.approve : h.sign;
  h.setTTY(false); await assert.rejects(action(), /FOUNDER_TTY_REQUIRED/);
  assert.equal(h.displays.length, 0); assert.equal(h.reports.length, 0);
  h.setTTY(true); if (command === 'sign') await h.init(); await action();
  assert.equal(existsSync(command === 'init-key' ? h.key : command === 'approve' ? h.approval : h.signed), true);
});

test('CLI has no scripted terminal, environment or stdin approval path', async t => {
  const h = setup(t);
  for (const args of [['init-key', h.key], ['approve', h.projection, h.manifest, h.review, h.scan, h.approval], ['sign', h.key, h.manifest, h.signed]]) {
    const child = spawn(process.execPath, ['scripts/publish/founder-seal-helper.ts', ...args], { detached: true,
      env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8', AAB_TEST_TTY: 'true', AAB_APPROVE: 'true' } });
    let stdout = '', stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; }); child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.stdin.end(`${phrases.join('\n')}\nsign ${payloadHash(h.input.manifest)}\n`);
    const [status] = await once(child, 'close');
    assert.equal(status, 1); assert.equal(stdout, ''); assert.match(stderr, /FOUNDER_HELPER_FAILED_CLOSED/);
  }
  for (const path of [h.key, h.approval, h.signed]) assert.equal(existsSync(path), false);
});

for (const command of ['approve', 'sign'] as const) test(`${command} refuses loss of controlling TTY while awaiting input; restored pair passes`, async t => {
  const h = setup(t); if (command === 'sign') await h.init();
  h.setResponse(display => { h.setTTY(false); return display.match(/Type exactly: (.+)\n$/)![1]!; });
  const action = command === 'approve' ? h.approve : h.sign;
  await assert.rejects(action(), /FOUNDER_TTY_REQUIRED/); assert.equal(existsSync(command === 'approve' ? h.approval : h.signed), false);
  h.restoreTerminal(); await action();
});

for (const command of ['init-key', 'approve', 'sign'] as const) test(`${command} never overwrites existing output; fresh destination succeeds`, async t => {
  const h = setup(t); if (command === 'sign') await h.init();
  const path = command === 'init-key' ? h.key : command === 'approve' ? h.approval : h.signed;
  const original = Buffer.from('existing synthetic sentinel'); writeFileSync(path, original, { mode: 0o600 });
  const action = command === 'init-key' ? h.init : command === 'approve' ? h.approve : h.sign;
  await assert.rejects(action(), /OUTPUT_EXISTS/); assert.ok(readFileSync(path).equals(original));
  rmSync(path); await action(); assert.equal(lstatSync(path).mode & 0o777, 0o600);
});

for (const command of ['init-key', 'approve', 'sign'] as const) test(`${command} rejects missing, extra and empty arguments; exact command passes`, async t => {
  const h = setup(t); if (command === 'sign') await h.init();
  const args = command === 'init-key' ? [command, h.key] : command === 'approve' ? [command, h.projection, h.manifest, h.review, h.scan, h.approval] : [command, h.key, h.manifest, h.signed];
  for (const invalid of [args.slice(0, -1), [...args, 'extra'], [...args.slice(0, -1), '']]) await assert.rejects(h.run(invalid), /INVALID_ARGUMENTS/);
  await assert.rejects(h.run(['unknown']), /INVALID_ARGUMENTS/);
  assert.equal(h.displays.length, 0); await h.run(args);
});

test('bounded input reads and symlink parent reject before review; exact restored bytes pass', async t => {
  const h = setup(t); const original = readFileSync(h.manifest);
  writeFileSync(h.manifest, Buffer.alloc(M03.sealedPayloadMax.value * 1024 * 1024 + 1));
  await assert.rejects(h.approve(), /NONREGULAR_OR_OVERSIZE/); writeFileSync(h.manifest, original);
  const alias = join(h.root, 'input-alias'); symlinkSync(h.root, alias);
  await assert.rejects(h.run(['approve', h.projection, join(alias, 'manifest.json'), h.review, h.scan, h.approval]), /DIRECTORY_LINK/);
  assert.equal(h.displays.length, 0); assert.equal(existsSync(h.approval), false); await h.approve();
});

test('exclusive final write rejects an output created during approval and preserves it; clean pair succeeds', async t => {
  const h = setup(t);
  h.setResponse((display, index) => { if (index === phrases.length - 1) writeFileSync(h.approval, 'synthetic race sentinel'); return display.match(/Type exactly: (.+)\n$/)![1]!; });
  await assert.rejects(h.approve(), /OUTPUT_EXISTS/); assert.equal(readFileSync(h.approval, 'utf8'), 'synthetic race sentinel');
  rmSync(h.approval); h.restoreTerminal(); await h.approve();
});

test('repo, linked worktree, symlink, temporary and unprotected directory guards with restored clean paths', async t => {
  const h = setup(t);
  await assert.rejects(runFounderHelper(['init-key', resolve('never-create-founder-key')], { terminal: h.terminal, protectPath: protectedLocation, report() { assert.fail('no output'); } }), /REPOSITORY_PATH_FORBIDDEN/);
  for (const directoryGit of [false, true]) {
    const marker = join(h.safe, '.git'); if (directoryGit) mkdirSync(marker); else writeFileSync(marker, 'gitdir: synthetic-worktree');
    await assert.rejects(h.init(), /REPOSITORY_PATH_FORBIDDEN/); assert.equal(existsSync(h.key), false);
    rmSync(marker, { recursive: true }); await h.init(); rmSync(h.key);
  }
  assert.throws(() => protectedLocation(h.key), /TEMPORARY_PATH_FORBIDDEN/);
  for (const path of ['/tmp/aab-never-create-key', '/private/tmp/aab-never-create-key']) {
    if (existsSync(dirname(path))) assert.throws(() => protectedLocation(path), /TEMPORARY_PATH_FORBIDDEN|DIRECTORY_LINK/);
  }
  assert.throws(() => protectedLocation('relative-key'), /CANONICAL_ABSOLUTE_PATH_REQUIRED/);
  assert.throws(() => protectedLocation(`${h.safe}/../protected/key`), /CANONICAL_ABSOLUTE_PATH_REQUIRED/);
  const alias = join(h.root, 'alias'); symlinkSync(h.safe, alias);
  assert.throws(() => protectedLocation(join(alias, 'key'), []), /DIRECTORY_LINK/);
  chmodSync(h.safe, 0o755); await assert.rejects(h.init(), /PROTECTED_DIRECTORY_REQUIRED/);
  chmodSync(h.safe, 0o700); await h.init(); assert.equal(existsSync(h.key), true);
});

for (const target of ['manifest', 'review', 'scan', 'page'] as const) test(`approve refuses changed ${target} during typed review; restoring exact bytes passes`, async t => {
  const h = setup(t); const path = target === 'page' ? join(h.projection, 'pages/p1.md') : h[target]; const original = readFileSync(path);
  h.setResponse((display, index) => { if (index === 0) writeFileSync(path, Buffer.concat([original, Buffer.from(' ')])); return display.match(/Type exactly: (.+)\n$/)![1]!; });
  await assert.rejects(h.approve(), /INPUT_CHANGED|FILE_CHANGED/); assert.equal(existsSync(h.approval), false);
  writeFileSync(path, original); h.restoreTerminal(); await h.approve();
});

for (const semantic of [false, true]) test(`sign refuses ${semantic ? 'semantic' : 'whitespace-only'} manifest byte change after display; restored pair signs`, async t => {
  const h = setup(t); await h.init(); const original = readFileSync(h.manifest);
  h.setResponse(display => { writeFileSync(h.manifest, semantic ? canonicalBytes({ ...h.input.manifest, version: 2 }) : Buffer.concat([original, Buffer.from('\n')])); return display.match(/Type exactly: (.+)\n$/)![1]!; });
  await assert.rejects(h.sign(), /INPUT_CHANGED/); assert.equal(existsSync(h.signed), false);
  writeFileSync(h.manifest, original); h.restoreTerminal(); await h.sign();
});

const invalidInputs: readonly { name: string; target: 'manifest' | 'review' | 'scan'; change: (original: Buffer) => Uint8Array }[] = [
  { name: 'manifest duplicate key', target: 'manifest', change: b => Buffer.from(b.toString().replace('"v":1', '"v":1,"v":1')) },
  { name: 'manifest unknown field', target: 'manifest', change: b => canonicalBytes({ ...JSON.parse(b.toString()), extra: true }) },
  { name: 'manifest invalid UTF8', target: 'manifest', change: () => Buffer.from([0xff]) },
  { name: 'manifest metadata mismatch', target: 'manifest', change: b => canonicalBytes({ ...JSON.parse(b.toString()), version: 2 }) },
  { name: 'review duplicate key', target: 'review', change: b => Buffer.from(b.toString().replace('"v":1', '"v":1,"v":1')) },
  { name: 'review unknown field', target: 'review', change: b => canonicalBytes({ ...JSON.parse(b.toString()), extra: true }) },
  { name: 'review invalid UTF8', target: 'review', change: () => Buffer.from([0xff]) },
  { name: 'review manifest hash mismatch', target: 'review', change: b => canonicalBytes({ ...JSON.parse(b.toString()), manifest_sha256: '0'.repeat(64) }) },
  { name: 'review inventory hash mismatch', target: 'review', change: b => canonicalBytes({ ...JSON.parse(b.toString()), inventory_sha256: '0'.repeat(64) }) },
  { name: 'review exact public bytes mismatch', target: 'review', change: b => { const r = JSON.parse(b.toString()); r.public_files[0].utf8 += ' '; return canonicalBytes(r); } },
  { name: 'review worksheet unknown field', target: 'review', change: b => { const r = JSON.parse(b.toString()); r.worksheet[0].extra = true; return canonicalBytes(r); } },
  { name: 'review prohibited origin', target: 'review', change: b => { const r = JSON.parse(b.toString()); r.worksheet[0].origin = 'business'; return canonicalBytes(r); } },
  { name: 'review missing worksheet', target: 'review', change: () => canonicalBytes({ v: 1 }) },
  { name: 'scan false verdict', target: 'scan', change: b => canonicalBytes({ ...JSON.parse(b.toString()), passed: false }) },
  { name: 'scan inventory hash mismatch', target: 'scan', change: b => canonicalBytes({ ...JSON.parse(b.toString()), bundle_sha256: '0'.repeat(64) }) },
  { name: 'scan invalid scanner digest', target: 'scan', change: b => canonicalBytes({ ...JSON.parse(b.toString()), scanner_sha256: 'bad' }) },
  { name: 'scan invalid date', target: 'scan', change: b => canonicalBytes({ ...JSON.parse(b.toString()), scanned_at: 'bad' }) },
  { name: 'scan empty version', target: 'scan', change: b => canonicalBytes({ ...JSON.parse(b.toString()), scanner_version: '' }) },
  { name: 'scan unknown field', target: 'scan', change: b => canonicalBytes({ ...JSON.parse(b.toString()), extra: true }) },
  { name: 'scan duplicate key', target: 'scan', change: b => Buffer.from(b.toString().replace('"passed":true', '"passed":true,"passed":true')) },
  { name: 'scan invalid UTF8', target: 'scan', change: () => Buffer.from([0xff]) },
];
for (const c of invalidInputs) test(`${c.name} refuses before prompts or writes; restored input passes`, async t => {
  const h = setup(t), path = h[c.target], original = readFileSync(path);
  writeFileSync(path, c.change(original));
  await assert.rejects(h.approve()); assert.equal(h.displays.length, 0); assert.equal(existsSync(h.approval), false);
  writeFileSync(path, original); await h.approve(); assert.equal(existsSync(h.approval), true);
});

test('unlisted projection and symlink/hardlink inputs reject; restored inventory passes', async t => {
  const h = setup(t); const extra = join(h.projection, 'unlisted'); writeFileSync(extra, 'synthetic');
  await assert.rejects(h.approve(), /UNLISTED_OR_LINK/); rmSync(extra);
  const original = readFileSync(h.review), backup = join(h.root, 'review-backup'); writeFileSync(backup, original); rmSync(h.review);
  symlinkSync(backup, h.review); await assert.rejects(h.approve(), /NONREGULAR_OR_OVERSIZE/); rmSync(h.review);
  linkSync(backup, h.review); await assert.rejects(h.approve(), /NONREGULAR_OR_OVERSIZE/); rmSync(h.review); writeFileSync(h.review, original);
  assert.equal(existsSync(h.approval), false); await h.approve();
});

for (const kind of ['mode', 'symlink', 'hardlink', 'directory', 'trailing-bytes', 'wrong-algorithm', 'oversize'] as const) test(`key ${kind} rejects without signature; clean key succeeds`, async t => {
  const h = setup(t); await h.init(); const original = readFileSync(h.key), backup = join(h.safe, 'backup.pk8');
  try {
    if (kind === 'mode') chmodSync(h.key, 0o644);
    if (kind === 'directory') { rmSync(h.key); mkdirSync(h.key); }
    if (kind === 'symlink' || kind === 'hardlink') { writeFileSync(backup, original, { mode: 0o600 }); rmSync(h.key); if (kind === 'symlink') symlinkSync(backup, h.key); else linkSync(backup, h.key); }
    if (kind === 'trailing-bytes') writeFileSync(h.key, Buffer.concat([original, Buffer.from([0])]));
    if (kind === 'wrong-algorithm') {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const other = privateKey.export({ format: 'der', type: 'pkcs8' }); try { writeFileSync(h.key, other); } finally { other.fill(0); }
    }
    if (kind === 'oversize') writeFileSync(h.key, Buffer.alloc(M03.sealedPayloadMax.value * 1024 * 1024 + 1));
    await assert.rejects(h.sign()); assert.equal(existsSync(h.signed), false);
    rmSync(h.key, { recursive: true }); if (existsSync(backup)) rmSync(backup); writeFileSync(h.key, original, { mode: 0o600 });
    h.restoreTerminal(); await h.sign(); assert.equal(existsSync(h.signed), true);
  } finally { original.fill(0); }
});

test('terminal output escapes hostile scanner metadata; clean and escaped attestation pairs pass without control bytes', async t => {
  const h = setup(t); writeFileSync(h.scan, canonicalBytes({ ...h.attestation, scanner_version: 'synthetic\u001b[2J\u202e\u009b' }));
  await h.approve(); const display = h.displays.join('\n'); assert.doesNotMatch(display, /[\u001b\u202e\u009b]/u); assert.match(display, /\\u001b/);
  rmSync(h.approval); writeFileSync(h.scan, canonicalBytes(h.attestation)); h.restoreTerminal(); await h.approve();
});

test('helper outputs pass actual operator seal/list with synthetic scanner; changed protected approval blocks list', async t => {
  const h = setup(t); await h.init(); await h.approve(); await h.sign();
  const signingKey = JSON.parse(h.reports[2]!).signing_key as SellerPublicKey;
  const write = (name: string, data: unknown) => { const path = join(h.root, name); writeFileSync(path, canonicalBytes(data)); return path; };
  const executable = join(h.root, 'synthetic-scanner');
  const script = `#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]==='version'){console.log('0.0.0')}else{const text=fs.readFileSync(0,'utf8');const findings=[];text.split('\\n').forEach((s,i)=>{for(const [prefix,RuleID] of [['api_key =','generic-api-key'],['AAB_SCAN_START_','aab-coverage-start'],['AAB_SCAN_END_','aab-coverage-end']])if(s.includes(prefix))findings.push({RuleID,StartLine:i+1});});fs.writeFileSync(process.argv[process.argv.indexOf('--report-path')+1],JSON.stringify(findings));process.exitCode=findings.length?17:0;}\n`;
  writeFileSync(executable, script, { mode: 0o700 });
  const config = realpathSync(resolve('config/scanner/gitleaks.toml'));
  const pins = write('pins.json', { executable, executableSha256: bytesHash(Buffer.from(script)), version: '0.0.0', config, configSha256: bytesHash(readFileSync(config)) });
  const rows = write('worksheet.json', worksheet(h.input));
  const job = write('job.json', { manifest: h.manifest, projection: h.projection, worksheet: rows,
    scanner_pins: pins, scanner_pins_sha256: bytesHash(readFileSync(pins)), approval: h.approval, approval_sha256: bytesHash(readFileSync(h.approval)), signing_key: signingKey,
    deployment: { ...harness().deployment, signing_key: signingKey }, seal_actor: 'human' });
  const jobHash = bytesHash(readFileSync(job)), sealed = join(h.root, 'sealed.json'), proposal = join(h.root, 'proposal.txt');
  const invoke = (...args: string[]) => spawnSync(process.execPath, ['scripts/publish/operator.ts', ...args], { encoding: 'utf8' });
  const seal = invoke('seal', job, jobHash, h.signed, sealed); assert.equal(seal.status, 0, seal.stderr); assert.match(seal.stdout, /SEALED_INACTIVE/);
  const list = invoke('list', job, jobHash, sealed, proposal); assert.equal(list.status, 0, list.stderr);
  const value = JSON.parse(readFileSync(proposal, 'utf8')); assert.equal(value.listing.status, 'suspended'); assert.equal(value.requires_human_repin, true);
  const original = readFileSync(h.approval); writeFileSync(h.approval, Buffer.concat([original, Buffer.from('\n')]));
  const blocked = join(h.root, 'blocked.txt'); assert.equal(invoke('list', job, jobHash, sealed, blocked).status, 1); assert.equal(existsSync(blocked), false);
  writeFileSync(h.approval, original); assert.equal(invoke('list', job, jobHash, sealed, blocked).status, 0);
  console.log(`synthetic fixture hashes: manifest=${payloadHash(h.input.manifest)} inventory=${payloadHash(h.input.manifest.files)} review=${payloadHash(h.packet)}`);
});
