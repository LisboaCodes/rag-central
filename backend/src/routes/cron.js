import { Router } from 'express';
import cron from 'node-cron';
import { listCronJobs, createCronJob, updateCronJob, deleteCronJob } from '../services/db.js';
import { reloadCron, executeJob, CRON_ACTIONS } from '../services/cron.js';
import { logEvent } from '../services/activity.js';

const router = Router();

// GET /cron — lista as tarefas agendadas
router.get('/', async (req, res, next) => {
  try { res.json({ jobs: await listCronJobs(), actions: CRON_ACTIONS }); } catch (err) { next(err); }
});

// POST /cron — cria uma tarefa
router.post('/', async (req, res, next) => {
  try {
    const { name, schedule, action, config, enabled } = req.body || {};
    if (!name || !schedule || !action) return res.status(400).json({ error: 'name, schedule e action são obrigatórios' });
    if (!CRON_ACTIONS.includes(action)) return res.status(400).json({ error: `action inválida (use ${CRON_ACTIONS.join(', ')})` });
    if (!cron.validate(schedule)) return res.status(400).json({ error: 'expressão cron inválida' });
    const job = await createCronJob({ name, schedule, action, config: config || {}, enabled: enabled !== false });
    await reloadCron();
    logEvent('INFO', 'cron', `tarefa criada: ${name} (${schedule})`);
    res.json(job);
  } catch (err) { err.status = 400; next(err); }
});

// PUT /cron/:id — edita uma tarefa
router.put('/:id', async (req, res, next) => {
  try {
    const patch = req.body || {};
    if (patch.schedule && !cron.validate(patch.schedule)) return res.status(400).json({ error: 'expressão cron inválida' });
    if (patch.action && !CRON_ACTIONS.includes(patch.action)) return res.status(400).json({ error: 'action inválida' });
    const job = await updateCronJob(parseInt(req.params.id, 10), patch);
    if (!job) return res.status(404).json({ error: 'tarefa não encontrada' });
    await reloadCron();
    res.json(job);
  } catch (err) { err.status = 400; next(err); }
});

// DELETE /cron/:id — remove
router.delete('/:id', async (req, res, next) => {
  try {
    const n = await deleteCronJob(parseInt(req.params.id, 10));
    await reloadCron();
    res.json({ deleted: n });
  } catch (err) { next(err); }
});

// POST /cron/:id/run — roda a tarefa agora (manual)
router.post('/:id/run', async (req, res, next) => {
  try { res.json(await executeJob(parseInt(req.params.id, 10))); } catch (err) { err.status = 400; next(err); }
});

export default router;
