import { existsSync } from 'node:fs';
export function blenderRuntimePath({configured,bundled,exists=existsSync}={}) {
  // Keep an operator's explicit setting, including diagnostics for a bad path.
  if(configured)return configured;
  return bundled&&exists(bundled)?bundled:undefined;
}
