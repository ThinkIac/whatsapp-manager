import { listProviderBridges } from '../core/bridgeRegistry.js';
import { PROVIDER_FEATURES } from '../core/providerContract.js';

export async function listProviders() {
  /** @register_router providers @method GET */
  return {
    defaultProvider: 'meta_cloud',
    providers: [
      { id: 'meta_cloud', label: 'Meta Cloud API', connection: 'external', official: true, features: Object.fromEntries(PROVIDER_FEATURES.map((name) => [name, ['text', 'media', 'incoming', 'groups'].includes(name)])) },
      ...(await listProviderBridges()).map((bridge) => ({ ...bridge, official: false })),
    ],
  };
}
