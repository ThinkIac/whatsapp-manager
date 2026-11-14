export function normalizeWhatsAppNumber(value) {
  const number = String(value || '').replace(/\D/g, '');
  if (number.length < 8 || number.length > 15) {
    throw new Error('Informe um número de WhatsApp válido, com DDI.');
  }
  return number;
}

export function conversationAddress(provider, number) {
  return provider === 'meta_cloud' || provider === 'evolution' ? number : `${number}@s.whatsapp.net`;
}
