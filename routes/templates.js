import { getProxy } from 'logos';
import { clientForInstance, isMetaInstance } from '../core/providerRouter.js';
import { normalizeTemplateBody } from '../core/templateVariables.js';

const db = getProxy('whatsapp-manager');

function templateInput(input = {}) {
  const name = String(input.name || '').trim();
  const language = String(input.language || '').trim();
  const category = String(input.category || '').trim().toUpperCase();
  const components = Array.isArray(input.components) ? input.components.map((component) => ({ ...component })) : [];
  if (!name || !language || !category || !components.length) throw new Error('Nome, idioma, categoria e pelo menos um componente são obrigatórios.');
  const body = components.find((component) => component.type === 'BODY');
  if (!body?.text) throw new Error('O corpo do template é obrigatório.');
  const header = components.find((component) => component.type === 'HEADER');
  if (header?.text?.includes('{{')) throw new Error('Variáveis no cabeçalho ainda não são suportadas pelo editor. Use o corpo do template.');
  const normalizedBody = normalizeTemplateBody(body.text, input.examples);
  body.text = normalizedBody.text;
  if (normalizedBody.example) body.example = normalizedBody.example;
  return { name, language, category, components };
}

function metaInstance(instanceId) {
  const instance = db.instance[instanceId];
  if (!instance) return { error: { status: 404, message: 'Instância não encontrada' } };
  if (!isMetaInstance(instance)) return { error: { status: 400, message: 'Templates oficiais estão disponíveis apenas para instâncias Meta Cloud API.' } };
  return { instance };
}

export async function syncMetaTemplates(req) {
  /**
   * @register_router templates/sync
   * @method POST
   */
  const { instance, error } = metaInstance(req.body?.instanceId);
  if (error) return error;
  try {
    const templates = await clientForInstance(instance).listMessageTemplates(instance.whatsappBusinessAccountId);
    return { success: true, templates };
  } catch (error) {
    return { status: error.status || 502, message: error.message };
  }
}

export async function listMetaTemplates(req) {
  /**
   * @register_router templates/list
   */
  const { instance, error } = metaInstance(req.query?.instanceId);
  if (error) return error;
  try { return { templates: await clientForInstance(instance).listMessageTemplates(instance.whatsappBusinessAccountId) }; }
  catch (error) { return { status: error.status || 502, message: error.message }; }
}

export async function createMetaTemplate(req) {
  /**
   * @register_router templates/create
   * @method POST
   */
  const { instance, error } = metaInstance(req.body?.instanceId);
  if (error) return error;
  try { return { success: true, result: await clientForInstance(instance).createMessageTemplate(instance.whatsappBusinessAccountId, templateInput({ ...(req.body?.template || {}), examples: req.body?.examples })) }; }
  catch (error) { return { status: error.status || 400, message: error.message }; }
}

export async function updateMetaTemplate(req) {
  /**
   * @register_router templates/update
   * @method POST
   */
  const { instance, error } = metaInstance(req.body?.instanceId);
  if (error) return error;
  try { return { success: true, result: await clientForInstance(instance).updateMessageTemplate(req.body?.templateId, templateInput({ ...(req.body?.template || {}), examples: req.body?.examples })) }; }
  catch (error) { return { status: error.status || 400, message: error.message }; }
}

export async function deleteMetaTemplate(req) {
  /**
   * @register_router templates/delete
   * @method POST
   */
  const { instance, error } = metaInstance(req.body?.instanceId);
  if (error) return error;
  try { return { success: true, result: await clientForInstance(instance).deleteMessageTemplate(instance.whatsappBusinessAccountId, { id: req.body?.templateId, name: req.body?.templateName }) }; }
  catch (error) { return { status: error.status || 400, message: error.message }; }
}
