import { assertProvider, ProviderError } from './provider-contract.mjs';
import { createComfyUIProvider } from './comfyui.mjs';

export function createProviderRegistry({ providers = [], ...options } = {}) {
  const map = new Map();
  const register = provider => { assertProvider(provider); map.set(provider.id, provider); return provider; };
  register(createComfyUIProvider(options));
  for (const provider of providers) register(provider);
  return {
    register,
    get(id) { return map.get(id); },
    list() { return [...map.values()]; },
    async inspect() {
      const reports = [];
      for (const provider of map.values()) {
        try { const health = await provider.health_check(); reports.push({ id: provider.id, ...provider.capabilities(), health }); }
        catch (error) { reports.push({ id: provider.id, status: 'blocked', diagnostic: { code: error.code || 'PROVIDER_HEALTH_FAILED', reason: error.message } }); }
      }
      return reports;
    },
  };
}

export { ProviderError };
