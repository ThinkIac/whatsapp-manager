// Stable contract implemented by optional whatsapp-* bridge packages.
// A bridge must expose { id, manifest, sendText?, sendMedia?, create?, qr?,
// disconnect?, remove?, present? }. It must never own Manager data models.
export const PROVIDER_FEATURES = ['text', 'media', 'incoming', 'groups', 'groupManagement', 'proxy', 'antiBan'];

export function normalizeProviderManifest(manifest = {}) {
  return {
    label: String(manifest.label || 'Bridge WhatsApp'),
    connection: manifest.connection === 'qr' ? 'qr' : 'external',
    features: Object.fromEntries(PROVIDER_FEATURES.map((name) => [name, manifest.features?.[name] === true])),
    experimental: manifest.experimental === true,
  };
}
