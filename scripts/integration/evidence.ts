/** Gate evidence never grants runtime activation. Missing proof stays UNVERIFIED. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalBytes, bytesHash } from '../../src/wire/index.ts';
export const gateItems = ['a','b','c','d','e','f'] as const;
export type GateItem = typeof gateItems[number];
export interface Verdict { status: 'PASS' | 'FAIL' | 'UNVERIFIED'; evidence: string[]; reason: string }
export function revision() {
  const sha = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const dirty = execFileSync('git',['status','--porcelain','--untracked-files=all','--','.',':(exclude)docs/evidence/gate1'],{encoding:'utf8'}).trim().length > 0;
  const hash = createHash('sha256');
  function walk(path:string): void { for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name < b.name ? -1 : 1)) { const p=join(path,entry.name); if(entry.isDirectory()) walk(p); else if(entry.isFile()) {hash.update(p);hash.update(readFileSync(p));} } }
  for(const path of ['src','scripts','test','config']) walk(path);
  for(const path of ['package.json','package-lock.json','tsconfig.json']) {hash.update(path);hash.update(readFileSync(path));}
  return {sha,dirty,source_sha256:hash.digest('hex'),node:process.version};
}
export function verdicts(): Record<GateItem,Verdict> { return Object.fromEntries(gateItems.map(k=>[k,{status:'UNVERIFIED',evidence:[],reason:'Required observation not recorded on this revision.'}])) as unknown as Record<GateItem,Verdict>; }
export function gateReport(rev:ReturnType<typeof revision>, items:Record<GateItem,Verdict>) {
  return {v:1,revision:rev,recorded_at:new Date().toISOString(),network:'devnet',items,gate1:!rev.dirty && gateItems.every(k=>items[k].status==='PASS') ? 'PASS' : 'UNVERIFIED_OR_FAILED',paid_mode:false,mainnet_enabled:false,
    activation:'Separate founder acceptance and remaining gates are required even if Gate1 passes.'};
}
export function evidenceDirectory(run:string):string {
  if(!/^[A-Za-z0-9_-]+$/.test(run)) throw new Error('INVALID_RUN');
  const root=resolve('docs/evidence/gate1'), path=join(root,run); mkdirSync(path,{recursive:true,mode:0o700});
  // Reject any redirected evidence path; public artifacts must stay in owned tree.
  for(const p of [resolve('docs'),resolve('docs/evidence'),root,path]) if(lstatSync(p).isSymbolicLink()) throw new Error('EVIDENCE_SYMLINK'); return path;
}
export function writeEvidence(root:string,name:string,value:unknown):void {
  if(!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('INVALID_EVIDENCE_NAME');
  writeFileSync(join(root,name),canonicalBytes(value),{flag:'wx',mode:0o600});
}
export function artifactHash(path:string) {return bytesHash(readFileSync(path));}
