import { readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateCaptureSegment } from '../runtime/capture-integrity.mjs';

const runDir = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass the stopped capture directory to audit');
const state = JSON.parse(await readFile(join(runDir,'run-status.json'),'utf8'));
if (state.state !== 'stopped') throw new Error('Only stopped captures may receive an append-only audit');
const digest = value => createHash('sha256').update(value).digest('hex');
const hashFile = path => new Promise((ok,bad) => { const h=createHash('sha256'), s=createReadStream(path); s.on('data',b=>h.update(b)); s.on('error',bad); s.on('end',()=>ok(h.digest('hex'))); });
const journalPath = join(runDir,'journal.jsonl');
const journal = await readFile(journalPath,'utf8');
let previousEventHash = null, sequence = 0;
for (const line of journal.trim().split('\n')) {
  const {eventHash,...entry}=JSON.parse(line);
  if (entry.previousEventHash !== previousEventHash || entry.sequence !== sequence+1 || digest(JSON.stringify(entry)) !== eventHash) throw new Error('Existing journal chain failed validation; refusing to append');
  previousEventHash=eventHash; sequence=entry.sequence;
}
const exec = promisify(execFile), records=[];
for (const file of (await readdir(runDir)).filter(file=>/^segment-.*\.json$/.test(file)).sort()) {
  const original=JSON.parse(await readFile(join(runDir,file),'utf8'));
  let probe=null, videoHash=null;
  try {
    const path=join(runDir,original.file);
    const result=await exec(resolve('workers/tools/ffprobe.exe'),['-v','error','-show_entries','format=duration','-of','json',path],{windowsHide:true,timeout:15000});
    probe=JSON.parse(result.stdout); videoHash=await hashFile(path);
  } catch {}
  const validation=validateCaptureSegment({wallSeconds:original.realElapsedSeconds,capturedSeconds:Number(probe?.format?.duration),probeAvailable:Boolean(probe)});
  const hashMatches=Boolean(videoHash && videoHash===original.sha256);
  records.push({index:original.index,file:original.file,originalRecord:file,originalRecordSha256:await hashFile(join(runDir,file)),videoSha256:videoHash,originalHashMatches:hashMatches,...validation,state:hashMatches ? validation.state : 'incomplete'});
}
const at=new Date().toISOString(), file=`timing-audit-${at.replace(/[:.]/g,'-')}.json`;
const audit={schemaVersion:1,at,type:'append-only-recording-correction',runDir,originalJournalSha256:digest(journal),previousEventHash,sourceStateSha256:await hashFile(join(runDir,'run-status.json')),overallState:'partial-recording',reason:'Recording ended after a service/browser interruption; original finalization wording did not validate elapsed time. Prior evidence is preserved.',segments:records,notes:['Complete means a segment matches wall-clock duration within 2 seconds. It does not prove the app was available for every frame or that the whole production was recorded.','Incomplete segments remain original unretimed bytes. Missing footage has not been reconstructed or concealed.','No audio was recorded by Playwright.']};
await writeFile(join(runDir,file),JSON.stringify(audit,null,2),{flag:'wx'});
const entry={sequence:sequence+1,at,type:'capture_integrity_correction',file,sha256:await hashFile(join(runDir,file)),incompleteSegments:records.filter(r=>r.state==='incomplete').map(r=>r.index),overallState:audit.overallState,previousEventHash};
await appendFile(journalPath,JSON.stringify({...entry,eventHash:digest(JSON.stringify(entry))})+'\n');
console.log(JSON.stringify({file:join(runDir,file),segments:records.map(({index,state,wallSeconds,capturedSeconds,missingSeconds})=>({index,state,wallSeconds,capturedSeconds,missingSeconds}))},null,2));
