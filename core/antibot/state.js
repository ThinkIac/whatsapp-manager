/**
 * core/antibot/state.js
 * Persistência simples do estado combinado do antibot por instância.
 */

import fs from 'fs';

export function loadState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

export function saveState(filePath, state) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(state));
  } catch (err) {
    console.error(`[antibot/state] Falha ao salvar estado em ${filePath}:`, err.message);
  }
}
