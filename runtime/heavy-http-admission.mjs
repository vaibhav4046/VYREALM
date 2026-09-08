// Serialize admission, not execution. Editing/read-only routes never take this
// lock, and cancellation must remain usable while another request is admitted.
export function heavyAdmissionKind(path,method){
 if(method!=='POST')return null;
 if(path==='/api/audio/setup')return 'audio';
 if(path==='/api/runtime/setup')return 'runtime';
 if(/^\/api\/projects\/[a-zA-Z0-9-]+\/production-run$/.test(path))return 'production';
 if(['/api/generation/smoke-test','/api/generation/shot'].includes(path)||/^\/api\/projects\/[a-zA-Z0-9-]+\/original-generation$/.test(path)||/^\/api\/original-generation\/[a-zA-Z0-9-]+\/(animate|retry)$/.test(path))return 'neural';
 return null;
}
export function createHeavyAdmissionGate(){let admitting=false;return async action=>{if(admitting)throw Object.assign(Error('Another heavy operation is being scheduled. Retry after its admission finishes.'),{code:'HEAVY_WORK_BUSY'});admitting=true;try{return await action();}finally{admitting=false;}};}
