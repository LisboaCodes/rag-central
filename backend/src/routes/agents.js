import { Router } from 'express';
import { listAgents, getAgent, createAgent, updateAgent, deleteAgent } from '../services/db.js';
import { logEvent } from '../services/activity.js';

const router = Router();
const MASK = '••••';

// nunca devolve a chave de API do agente em texto puro
function maskAgent(a) {
  if (!a) return a;
  const out = { ...a };
  if (out.chat_api_key) out.chat_api_key = `${MASK}${String(out.chat_api_key).slice(-4)}`;
  return out;
}

// GET /agents — lista todos os agentes (chave mascarada)
router.get('/', async (req, res, next) => {
  try { res.json({ agents: (await listAgents()).map(maskAgent) }); } catch (err) { next(err); }
});

// POST /agents — cria um agente
router.post('/', async (req, res, next) => {
  try {
    const a = req.body || {};
    if (!a.name && !a.key) return res.status(400).json({ error: 'nome é obrigatório' });
    if (typeof a.chat_api_key === 'string' && a.chat_api_key.startsWith(MASK)) delete a.chat_api_key;
    const created = await createAgent(a);
    logEvent('INFO', 'agents', `agente criado: ${created.key}`);
    res.json(maskAgent(created));
  } catch (err) {
    if (err.code === '23505') { err.status = 409; err.message = 'já existe um agente com esse nome'; }
    else err.status = 400;
    next(err);
  }
});

// PUT /agents/:key — atualiza (se a chave vier mascarada, mantém a atual)
router.put('/:key', async (req, res, next) => {
  try {
    const patch = req.body || {};
    if (typeof patch.chat_api_key === 'string' && patch.chat_api_key.startsWith(MASK)) delete patch.chat_api_key;
    const updated = await updateAgent(req.params.key, patch);
    if (!updated) return res.status(404).json({ error: 'agente não encontrado' });
    logEvent('INFO', 'agents', `agente atualizado: ${updated.key}`);
    res.json(maskAgent(updated));
  } catch (err) { err.status = 400; next(err); }
});

// DELETE /agents/:key — remove
router.delete('/:key', async (req, res, next) => {
  try {
    const n = await deleteAgent(req.params.key);
    res.json({ deleted: n });
  } catch (err) { next(err); }
});

export default router;
