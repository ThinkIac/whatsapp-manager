// Provider bridges are optional packages. The manager owns conversations,
// campaigns and persistence; a bridge owns a protocol connection only.
const BRIDGES = [
  { id: 'baileys', module: '../../whatsapp-baileys/bridge.js' },
  { id: 'evolution', module: '../../whatsapp-evolution/bridge.js' },
  { id: 'whatsmeow', module: '../../whatsapp-whatsmeow/bridge.js' },
];

const loaded = new Map();

async function load(entry) {
  if (loaded.has(entry.id)) return loaded.get(entry.id);
  try {
    const bridge = await import(new URL(entry.module, import.meta.url));
    if (!bridge.provider || bridge.provider.id !== entry.id) throw new Error('Contrato de bridge inválido');
    loaded.set(entry.id, bridge.provider);
    return bridge.provider;
  } catch {
    loaded.set(entry.id, null);
    return null;
  }
}

export async function bridgeFor(provider) {
  const entry = BRIDGES.find((item) => item.id === provider);
  return entry ? load(entry) : null;
}

export async function listProviderBridges() {
  const bridges = await Promise.all(BRIDGES.map(async (entry) => load(entry)));
  return bridges.filter(Boolean).map((bridge) => ({ ...bridge.manifest, id: bridge.id }));
}

export async function requireBridge(provider) {
  const bridge = await bridgeFor(provider);
  if (!bridge) throw new Error(`O bridge whatsapp-${provider} não está instalado ou não está disponível.`);
  return bridge;
}
