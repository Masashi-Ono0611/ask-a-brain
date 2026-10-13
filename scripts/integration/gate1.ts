/** Offline engineering gate. Exact SHA + source digest; never a live Gate1 pass. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactHash,evidenceDirectory,gateReport,revision,verdicts,writeEvidence } from './evidence.ts';
export const testFiles=['test/integration/gate1.test.ts','test/integration/transport.test.ts','test/integration/crash.test.ts','test/acceptance/payment/proofs.test.ts','test/acceptance/payment/live-helpers.test.ts'];
export function main(args:readonly string[]) {
 if(args.length!==2||args[0]!=='--run')throw new Error('USAGE: node scripts/integration/gate1.ts --run ID');
 const root=evidenceDirectory(args[1]!),rev=revision(),items=verdicts();
 const result=spawnSync(process.execPath,['--test',...testFiles],{encoding:'utf8',timeout:120000});
 const output=`${result.stdout??''}${result.stderr??''}`;writeFileSync(join(root,'engineering.log'),output,{flag:'wx',mode:0o600});
 const pass=!result.error&&result.status===0;
 for(const item of ['c','d','e'] as const)items[item]={status:pass?'UNVERIFIED':'FAIL',evidence:['engineering.log'],reason:pass?'Engineering bad/control suite PASS; FakeRpc/in-memory MCP does not prove real devnet/host acceptance.':'Engineering suite failed; paid mode blocked.'};
 writeEvidence(root,'engineering.json',{revision:rev,evidence_class:'SYNTHETIC_ENGINEERING_ONLY',command:['node','--test',...testFiles],exit_code:result.status,signal:result.signal,tests_pass:pass,log_sha256:artifactHash(join(root,'engineering.log')),test_files:testFiles.map(path=>({path,sha256:artifactHash(path)}))});
 writeEvidence(root,'verdict.json',gateReport(rev,items));console.log(JSON.stringify({engineering:pass?'PASS':'FAIL',gate1:'UNVERIFIED',paid_mode:false,evidence:root}));if(!pass)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2));
