import { Router } from 'express';
import { listConversations, getConversation, deleteConversation } from '../services/db.js';
import { consolidateConversation } from '../services/memory.js';
import { logEvent } from '../services/activity.js';

const router = Router();

// POST /conversations/:id/consolidate — resume a conversa em fatos na base
router.post('/:id/consolidate', async (req, res, next) => {
  try {
    const result = await consolidateConversation(parseInt(req.params.id, 10));
    logEvent('INFO', 'memory', `conversa ${req.params.id} consolidada (${result.chunks} chunks)`);
    res.json(result);
  } catch (err) { err.status = 400; next(err); }
});

// GET /conversations?agent=MEL — lista threads (todas, ou de um agente)
router.get('/', async (req, res, next) => {
  try {
    const agent = req.query.agent ? String(req.query.agent).toUpperCase() : null;
    res.json({ conversations: await listConversations(agent) });
  } catch (err) {
    next(err);
  }
});

// GET /conversations/:id — uma thread com todas as mensagens
router.get('/:id', async (req, res, next) => {
  try {
    const conv = await getConversation(parseInt(req.params.id, 10));
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    res.json(conv);
  } catch (err) {
    next(err);
  }
});

// DELETE /conversations/:id — apaga a thread (e mensagens em cascata)
router.delete('/:id', async (req, res, next) => {
  try {
    const n = await deleteConversation(parseInt(req.params.id, 10));
    res.json({ deleted: n });
  } catch (err) {
    next(err);
  }
});

export default router;
