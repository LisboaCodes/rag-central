import { Router } from 'express';
import { listAgents, getAgent, createAgent, updateAgent, deleteAgent } from '../services/db.js';
import { logEvent } from '../services/activity.js';

const router = Router();

// GET /agents — lista todos os agentes
router.get('/', async (req, res, next) => {
  try { res.json({ agents: await listAgents() }); } catch (err) { next(err); }
});

// POST /agents — cria um agente
router.post('/', async (req, res, next) => {
  try {
    const a = req.body || {};
    if (!a.name && !a.key) return res.status(400).json({ error: 'nome é obrigatório' });
    const created = await createAgent(a);
    logEvent('INFO', 'agents', `agente criado: ${created.key}`);
    res.json(created);
  } catch (err) {
    if (err.code === '23505') { err.status = 409; err.message = 'já existe um agente com esse nome'; }
    else err.status = 400;
    next(err);
  }
});

// PUT /agents/:key — atualiza
router.put('/:key', async (req, res, next) => {
  try {
    const updated = await updateAgent(req.params.key, req.body || {});
    if (!updated) return res.status(404).json({ error: 'agente não encontrado' });
    logEvent('INFO', 'agents', `agente atualizado: ${updated.key}`);
    res.json(updated);
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
