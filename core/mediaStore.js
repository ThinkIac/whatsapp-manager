/**
 * core/mediaStore.js
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, '..', 'media');

const EXT_BY_TYPE = { image: 'jpg', audio: 'ogg', video: 'mp4', document: 'bin', sticker: 'webp' };

function guessExt({ filename, mimetype, mediaType }) {
  if (filename && filename.includes('.')) return filename.split('.').pop();
  if (mimetype && mimetype.includes('/')) return mimetype.split('/')[1].split(';')[0];
  return EXT_BY_TYPE[mediaType] || 'bin';
}

export function saveMedia(conversationId, buffer, { mediaType, mimetype, filename }) {
  const dir = path.join(MEDIA_DIR, conversationId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = guessExt({ filename, mimetype, mediaType });
  const savedName = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(dir, savedName), buffer);
  return { filename: savedName, mimetype: mimetype || 'application/octet-stream' };
}

export function readMedia(conversationId, filename) {
  const filePath = path.join(MEDIA_DIR, conversationId, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

export function removeConversationMedia(conversationId) {
  fs.rmSync(path.join(MEDIA_DIR, conversationId), { recursive: true, force: true });
}
