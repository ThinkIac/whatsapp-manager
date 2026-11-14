import { dispatchEvent } from 'logos';

export const WHATSAPP_EVENTS = Object.freeze([
  { name: 'whatsapp:instance:created', description: 'Instância criada e aguardando conexão.' },
  { name: 'whatsapp:instance:connected', description: 'Sessão conectada ao WhatsApp.' },
  { name: 'whatsapp:instance:disconnected', description: 'Sessão desconectada, com dados preservados.' },
  { name: 'whatsapp:instance:deleted', description: 'Instância e seus dados locais apagados.' },
  { name: 'whatsapp:antiban:updated', description: 'Configuração anti-ban da instância alterada.' },
  { name: 'whatsapp:antiban:risk', description: 'Risco anti-ban mudou de faixa.' },
  { name: 'whatsapp:message:received', description: 'Mensagem recebida e persistida.' },
  { name: 'whatsapp:message:sent', description: 'Mensagem enviada com sucesso.' },
  { name: 'whatsapp:message:delivered', description: 'Mensagem entregue ao destinatário.' },
  { name: 'whatsapp:message:read', description: 'Mensagem lida pelo destinatário.' },
  { name: 'whatsapp:message:failed', description: 'Falha ao enviar uma mensagem.' },
]);

export async function emitWhatsappEvent(name, payload) {
  try {
    return await dispatchEvent(name, payload);
  } catch (error) {
    console.error(`[whatsapp-manager] Falha ao emitir ${name}:`, error.message);
    return null;
  }
}
