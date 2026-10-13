/** Abrupt exit only after real SQLite signer WAL commits; ephemeral keys die here. */
import { writeFileSync } from 'node:fs';
import { harness, settle } from './harness.ts';
const locator=process.argv[2];if(!locator)throw new Error('TEMP_LOCATOR_REQUIRED');
const h=await harness();h.faults.lostSign=true;
const view=await settle(h,h.broker.market.consult(h.buyer,h.request()));
if(h.counts.sign!==1||h.counts.broadcast!==0||view.payment_state!=='payment_pending')throw new Error('CRASH_PRECONDITION');
h.savePublicRecovery();writeFileSync(locator,h.directory,{mode:0o600});
process.kill(process.pid,'SIGKILL');
