import { getProxy } from 'logos';
import { readMedia } from '../core/mediaStore.js';

const db = getProxy('whatsapp-manager');

export async function getMedia(req) {
  /**
   * @register_router media/:conversationId/:filename
   */
  const { conversationId, filename } = req.params;
  const buffer = readMedia(conversationId, filename);
  if (!buffer) return { status: 404, message: 'Mídia não encontrada' };

  const msg = db.message.findOne({ conversationId, mediaUrl: filename });
  const mimetype = msg?.mediaType || 'application/octet-stream';

  return { filename, mimetype, base64: buffer.toString('base64') };
}
