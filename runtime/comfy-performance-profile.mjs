/** Opt-in launch profiles for the pinned local ComfyUI runtime. These retain the
 * existing GPU/offload budget; only intermediate-result caching differs.
 * RAM headroom is an upstream eviction trigger, not a hard process RSS limit. */
export const COMFY_DEFAULT_PROFILE = 'conservative';
export const COMFY_PERFORMANCE_PROFILES = Object.freeze({
  conservative:Object.freeze({id:'conservative',qualification:'existing',cacheArgs:Object.freeze(['--cache-none']),minimumRamGiB:0}),
  'ram-pressure-4gb':Object.freeze({id:'ram-pressure-4gb',qualification:'unmeasured',cacheArgs:Object.freeze(['--cache-ram','4','4']),minimumRamGiB:14,activeHeadroomGiB:4,inactiveHeadroomGiB:4}),
});
const beforeCache=['--listen','127.0.0.1','--port','8188','--lowvram','--disable-dynamic-vram','--disable-smart-memory'];
const afterCache=['--disable-api-nodes','--disable-all-custom-nodes','--whitelist-custom-nodes','ComfyUI-GGUF','--disable-auto-launch','--reserve-vram','1','--disable-async-offload','--use-pytorch-cross-attention'];
export function comfyLaunchProfile({profile=COMFY_DEFAULT_PROFILE,totalRamBytes,cliSource}={}) {
  if(typeof profile!=='string'||!Object.hasOwn(COMFY_PERFORMANCE_PROFILES,profile))throw Object.assign(new Error('COMFY_PERFORMANCE_PROFILE: Unknown bounded local runtime profile'),{code:'COMFY_PERFORMANCE_PROFILE'});
  const selected=COMFY_PERFORMANCE_PROFILES[profile];
  if(profile!=='conservative'){
    if(!Number.isFinite(totalRamBytes)||totalRamBytes<selected.minimumRamGiB*1024**3)throw Object.assign(new Error('COMFY_CACHE_RAM_BUDGET: This candidate requires at least14GiB of installed RAM'),{code:'COMFY_CACHE_RAM_BUDGET'});
    // The registered runtime code is integrity-checked by its launcher before
    // reaching here. Do not silently pass flags to an older incompatible CLI.
    if(typeof cliSource!=='string'||!cliSource.includes('"--cache-ram"')||!cliSource.includes('inactive-cache/pin threshold'))throw Object.assign(new Error('COMFY_CACHE_VERSION: The installed CLI lacks the two-threshold RAM-pressure cache'),{code:'COMFY_CACHE_VERSION'});
  }
  return {...selected,args:[...beforeCache,...selected.cacheArgs,...afterCache],cacheScope:profile==='conservative'?'No node result reuse':'Upstream intermediate result cache; identical prompt/encoder ancestry can reuse conditioning',memoryLimitClaim:false,measuredSpeedup:null};
}
