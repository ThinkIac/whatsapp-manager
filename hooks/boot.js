import * as baileysManager from '../core/baileysManager.js';
import { handleIncomingMessage } from '../core/conversationEngine.js';

let wired = false;

export async function onBoot(payload, context) {
  /**
   * @register_hook boot
   */
  if (!wired) {
    wired = true;

    baileysManager.onIncomingMessage(handleIncomingMessage);

    baileysManager.reconnectAllKnownInstances().catch((err) =>
      console.error('[whatsapp-manager] Falha ao reconectar instâncias existentes:', err.message)
    );

  }

  return payload;
}
