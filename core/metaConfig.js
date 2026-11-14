const ENV_PREFIX = 'WHATSAPP_MANAGER_ENV_META_';

// Credenciais são isoladas no arquivo local do pacote e carregadas apenas no
// processo do runtime. O arquivo é ignorado pelo Git e nunca é retornado pela
// API, UI ou logs.
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch {}

export function readMetaConfig(env = process.env) {
  return {
    accessToken: String(env[`${ENV_PREFIX}ACCESS_TOKEN`] || ''),
    appSecret: String(env[`${ENV_PREFIX}APP_SECRET`] || ''),
    verifyToken: String(env[`${ENV_PREFIX}VERIFY_TOKEN`] || ''),
    phoneNumberId: String(env[`${ENV_PREFIX}PHONE_NUMBER_ID`] || ''),
    whatsappBusinessAccountId: String(env[`${ENV_PREFIX}WABA_ID`] || ''),
    apiVersion: String(env[`${ENV_PREFIX}API_VERSION`] || 'v25.0'),
  };
}

export function metaPublicConfig(config = readMetaConfig()) {
  return {
    configured: Boolean(config.accessToken && config.appSecret && config.verifyToken && config.phoneNumberId),
    phoneNumberId: config.phoneNumberId || null,
    whatsappBusinessAccountId: config.whatsappBusinessAccountId || null,
  };
}

export function assertMetaConfig(config = readMetaConfig()) {
  const missing = ['accessToken', 'appSecret', 'verifyToken', 'phoneNumberId'].filter((key) => !config[key]);
  if (missing.length) throw new Error(`Meta Cloud API não configurada: ${missing.join(', ')}`);
  return config;
}
