/** Founder TTY ceremony only. Existing helper creates ephemeral OS-temp keys.
 * This does NOT execute devnet or certify host/runtime isolation. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceDirectory,revision,writeEvidence,gateReport,verdicts } from './evidence.ts';
export function main(args:readonly string[]) {
 if(args.length!==2||args[0]!=='--run')throw new Error('USAGE: node scripts/integration/gate1-human.ts --run ID (founder controlling TTY required)');
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('FOUNDER_TTY_REQUIRED');
 const rev=revision();if(rev.dirty)throw new Error('COMMIT_REVIEWED_REVISION_FIRST');
 const root=evidenceDirectory(args[1]!),items=verdicts();
 const result=spawnSync(process.execPath,['scripts/chain/human-smoke.ts'],{stdio:'inherit'});
 writeEvidence(root,`human-${Date.now()}.json`,{revision:rev,evidence:'EPHEMERAL_HUMAN_CLI_JOURNAL_CEREMONY_ONLY',exit_code:result.status,signal:result.signal,host_isolation:'UNVERIFIED',live_human_devnet:'UNVERIFIED'});
 items.f={status:result.status===0?'UNVERIFIED':'FAIL',evidence:[],reason:'TTY helper alone does not prove OS isolation, runtime canaries, or human-signed devnet broker purchase.'};
 writeEvidence(root,`human-verdict-${Date.now()}.json`,gateReport(rev,items));if(result.status!==0)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2));
