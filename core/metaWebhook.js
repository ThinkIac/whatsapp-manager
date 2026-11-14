import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyMetaWebhook({ rawBody, signature, appSecret }) {
  if (!rawBody || !signature || !appSecret || !signature.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const received = Buffer.from(signature.slice(7));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function webhookChallenge(query, verifyToken) {
  if (query?.['hub.mode'] !== 'subscribe' || !verifyToken || query?.['hub.verify_token'] !== verifyToken) return { status: 403, body: 'Forbidden' };
  return { status: 200, body: String(query['hub.challenge'] || ''), headers: { 'content-type': 'text/plain' } };
}

export function metaChanges(payload) {
  return (payload?.entry || []).flatMap((entry) => entry.changes || []).filter((change) => change.field === 'messages').map((change) => change.value || {});
}

export function webhookDiagnostic({ outcome, received = 0, statuses = 0, now = new Date() }) {
  return { outcome, received: Number(received) || 0, statuses: Number(statuses) || 0, at: now.toISOString() };
}
