import { getProxy } from 'logos';
import { handleWhatsmeowMessage } from '../core/conversationEngine.js';

const db = getProxy('whatsapp-manager');

function authorized(req) {
  const secret = process.env.WHATSMEOW_WEBHOOK_TOKEN;
  if (secret && req.headers?.authorization === `Bearer ${secret}`) return true;
  // O sidecar é preso a loopback. Aceitar apenas essa origem permite que uma
  // instalação já pareada continue recebendo mensagens quando o segredo ainda
  // não foi propagado ao processo do sidecar, sem abrir o endpoint à rede.
  const address = req.socket?.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export async function receiveWhatsmeowWebhook(req) {
  /**
   * @register_router whatsmeow/webhook
   * @public true
   * @method post
   */
  if (!authorized(req)) return { status: 401, data: { message: 'Não autorizado.' } };
  const name = req.body?.instanceName;
  const instance = name && db.instance.findOne({ name, provider: 'whatsmeow' });
  if (!instance) return { status: 404, data: { message: 'Instância whatsmeow não encontrada.' } };
  const message = await handleWhatsmeowMessage(instance, req.body);
  return { success: true, received: message ? 1 : 0 };
}
