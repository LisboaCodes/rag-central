import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../services/auth.js';
import * as proj from '../services/projects.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// O runner executa código no host — sempre exige login.
router.use(requireAuth);

// ---- projetos -------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try { res.json({ projects: await proj.listProjects(), root: proj.projectsRoot() }); } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try { res.json(await proj.createProject(req.body?.name)); } catch (err) { next(err); }
});
router.delete('/:name', async (req, res, next) => {
  try { res.json(await proj.deleteProject(req.params.name)); } catch (err) { next(err); }
});

// status + config
router.get('/:name', async (req, res, next) => {
  try {
    res.json({
      name: req.params.name,
      status: proj.getStatus(req.params.name),
      config: await proj.readConfig(req.params.name),
      tree: await proj.getTree(req.params.name)
    });
  } catch (err) { next(err); }
});
router.put('/:name/config', async (req, res, next) => {
  try { res.json(await proj.writeConfig(req.params.name, req.body || {})); } catch (err) { next(err); }
});

// ---- arquivos / editor ----------------------------------------------------
router.get('/:name/tree', async (req, res, next) => {
  try { res.json({ tree: await proj.getTree(req.params.name) }); } catch (err) { next(err); }
});
router.get('/:name/file', async (req, res, next) => {
  try { res.json(await proj.readProjectFile(req.params.name, req.query.path)); } catch (err) { next(err); }
});
router.put('/:name/file', async (req, res, next) => {
  try { res.json(await proj.writeProjectFile(req.params.name, req.body?.path, req.body?.content)); } catch (err) { next(err); }
});
router.post('/:name/entry', async (req, res, next) => {
  try { res.json(await proj.createEntry(req.params.name, req.body?.path, req.body?.kind === 'dir' ? 'dir' : 'file')); } catch (err) { next(err); }
});
router.delete('/:name/file', async (req, res, next) => {
  try { res.json(await proj.deleteEntry(req.params.name, req.query.path)); } catch (err) { next(err); }
});
router.post('/:name/upload', upload.array('files', 50), async (req, res, next) => {
  try {
    const dir = req.body?.dir || '';
    const saved = [];
    for (const f of req.files || []) saved.push(await proj.saveUpload(req.params.name, `${dir ? dir + '/' : ''}${f.originalname}`, f.buffer));
    res.json({ saved });
  } catch (err) { next(err); }
});
router.post('/:name/import-github', async (req, res, next) => {
  try { res.json(await proj.importFromGithub(req.params.name, req.body?.repo, req.body?.ref)); } catch (err) { next(err); }
});

// ---- execução / console ---------------------------------------------------
router.post('/:name/start', async (req, res, next) => {
  try { res.json(await proj.startProject(req.params.name)); } catch (err) { next(err); }
});
router.post('/:name/install', async (req, res, next) => {
  try { res.json(await proj.installProject(req.params.name)); } catch (err) { next(err); }
});
router.post('/:name/run', async (req, res, next) => {
  try { res.json(proj.runCommand(req.params.name, req.body?.command, { label: 'manual' })); } catch (err) { next(err); }
});
router.post('/:name/stop', (req, res) => { res.json(proj.stopProject(req.params.name)); });
router.post('/:name/clear-logs', (req, res) => { res.json(proj.clearLogs(req.params.name)); });

// SSE: console ao vivo. Consumido via fetch+ReadableStream no front (envia o
// Authorization por header, igual o chat) — por isso fica atrás do requireAuth.
router.get('/:name/logs/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  const unsub = proj.subscribeLogs(req.params.name, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* */ } }, 25000);
  req.on('close', () => { clearInterval(ping); unsub(); });
});

export default router;
