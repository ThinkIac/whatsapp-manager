const LEGACY_TEMPLATE_TEXT = /^\[Template: ([^\]]+)\]$/;

function componentOfType(components, type) {
  return (components || []).find((component) => String(component?.type || '').toUpperCase() === type);
}

/**
 * Produz o texto que o operador efetivamente enviou, sem alterar o payload
 * oficial armazenado para reenvio. A Meta aceita componentes em maiúsculas ou
 * minúsculas, então a comparação precisa ser insensível a caixa.
 */
export function templateDisplayText(template, components, fallbackName = '') {
  const body = componentOfType(template?.components, 'BODY');
  const source = String(body?.text || '').trim();
  if (!source) return fallbackName ? `Template: ${fallbackName}` : '';

  const sentBody = componentOfType(components, 'BODY');
  const values = (sentBody?.parameters || [])
    .map((parameter) => parameter?.text ?? parameter?.payload ?? parameter?.image?.link ?? '')
    .map((value) => String(value));
  let position = 0;
  return source.replace(/{{\s*([^{}\s]+)\s*}}/g, (_, token) => {
    const numeric = Number(token);
    const index = Number.isInteger(numeric) && numeric > 0 ? numeric - 1 : position;
    position += 1;
    return values[index] ?? `{{${token}}}`;
  });
}

export function templateMessageData({ name, languageCode = 'pt_BR', components } = {}) {
  return {
    templateName: String(name || '').trim() || null,
    templateLanguageCode: String(languageCode || 'pt_BR'),
    templateComponents: Array.isArray(components) && components.length ? JSON.stringify(components) : null,
  };
}

export function templateForRetry(message = {}) {
  const name = message.templateName || String(message.text || '').match(LEGACY_TEMPLATE_TEXT)?.[1];
  if (!name) return null;

  let components;
  try { components = message.templateComponents ? JSON.parse(message.templateComponents) : undefined; }
  catch { return { error: 'Os parâmetros originais deste template não puderam ser lidos. Envie-o novamente pela opção de template.' }; }
  return { name, languageCode: message.templateLanguageCode || 'pt_BR', components };
}
