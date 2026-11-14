const variablePattern = /{{\s*([^{}\s]+)\s*}}/g;

export function templateParameters(template = {}) {
  const body = (template.components || []).find((component) => component.type === 'BODY');
  const tokens = [...String(body?.text || '').matchAll(variablePattern)].map((match) => match[1]);
  return tokens.map((token, position) => ({ index: position + 1, token: `{{${token}}` + '}' }));
}

export function normalizeTemplateBody(text, examples) {
  const tokens = [...String(text || '').matchAll(variablePattern)].map((match) => match[1]);
  if (!tokens.length) return { text: String(text || '').trim(), variables: [], example: undefined };

  const numeric = tokens.every((token) => /^\d+$/.test(token));
  if (numeric && tokens.some((token, index) => Number(token) !== index + 1)) {
    throw new Error('As variáveis numéricas devem ser uma sequência contínua, começando em {{1}}.');
  }
  if (!numeric && tokens.some((token) => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(token))) {
    throw new Error('Use nomes de variável com letras, números e _, ou variáveis numéricas como {{1}}.');
  }
  if (!Array.isArray(examples) || examples.length !== tokens.length || examples.some((value) => !String(value || '').trim())) {
    throw new Error('Informe um exemplo para cada variável do corpo antes de enviar à Meta.');
  }

  const variables = tokens.map((token, index) => ({ index: index + 1, label: token }));
  let position = 0;
  return {
    text: numeric ? String(text).trim() : String(text).replace(variablePattern, () => `{{${++position}}}`),
    variables,
    example: { body_text: [examples.map((value) => String(value).trim())] },
  };
}
