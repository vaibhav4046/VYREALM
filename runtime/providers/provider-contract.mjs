/**
 * Contract shared by local and optional remote providers.
 * Providers must return structured results and diagnostics; callers should
 * never infer availability from a button or a static catalogue entry.
 */
export const PROVIDER_METHODS = Object.freeze([
  'health_check', 'capabilities', 'install_instructions', 'estimate_resources',
  'generate_image', 'generate_video', 'animate_image', 'transcribe',
  'synthesize_speech', 'animate_avatar', 'upscale', 'interpolate',
  'cancel', 'retrieve_result',
]);

export class ProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.details = details;
  }
}

export function assertProvider(provider) {
  if (!provider || typeof provider !== 'object') throw new ProviderError('INVALID_PROVIDER', 'Provider must be an object');
  const missing = PROVIDER_METHODS.filter(name => typeof provider[name] !== 'function');
  if (missing.length) throw new ProviderError('INVALID_PROVIDER', `Provider is missing methods: ${missing.join(', ')}`, { missing });
  if (typeof provider.id !== 'string' || !provider.id) throw new ProviderError('INVALID_PROVIDER', 'Provider must expose a stable id');
  return provider;
}

export function unavailable(operation, providerId, reason, details = {}) {
  return {
    status: 'blocked',
    operation,
    provider: providerId,
    diagnostic: { code: 'CAPABILITY_UNAVAILABLE', reason, ...details },
  };
}
