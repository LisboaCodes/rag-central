import { Router } from 'express';
import { listMemory, memoryFacets, memoryGraph, getMemoryItem, memoryStats } from '../services/db.js';
import { editMemoryItem, deleteMemoryItem, addMemoryFact } from '../services/memory.js';
import { logEvent } from '../services/activity.js';

const router = Router();

// GET /memory/graph?project=&limit=&neighbors=&threshold=&hubs=&messages=
// Grafo do "cérebro": nós (conhecimento/fatos/notas/mensagens) + hubs de
// agente/projeto, arestas de similaridade semântica + estruturais.
router.get('/graph', async (req, res, next) => {
  try {
    const project = req.query.project || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 600);
    const neighbors = Math.min(parseInt(req.query.neighbors, 10) || 4, 8);
    const threshold = Math.max(0.3, Math.min(parseFloat(req.query.threshold) || 0.72, 0.98));
    const withHubs = req.query.hubs !== 'false';
    const includeMessages = req.query.messages === 'true';

    const { nodes: raw, links: sim } = await memoryGraph({ project, limit, neighbors, threshold, includeMessages });

    const nodes = raw.map((n) => ({
      id: n.uid, kind: n.kind, label: n.label,
      agent: n.agent || null, project: n.project || null,
      conv: n.conversation_id || null,
      text: String(n.text || '').slice(0, 600), model: n.model, created_at: n.created_at
    }));
    const links = sim.map((e) => ({ source: e.source, target: e.target, type: 'sim', sim: Number(e.sim.toFixed(3)) }));

    if (withHubs) {
      const agentSet = new Set();
      const projectSet = new Set();
      for (const n of raw) {
        if (n.agent) {
          const aid = `agent:${n.agent}`;
          if (!agentSet.has(n.agent)) { agentSet.add(n.agent); nodes.push({ id: aid, kind: 'agent', label: n.agent }); }
          links.push({ source: n.uid, target: aid, type: 'agent' });
        }
        if (n.project) {
          const pid = `project:${n.project}`;
          if (!projectSet.has(n.project)) { projectSet.add(n.project); nodes.push({ id: pid, kind: 'project', label: n.project }); }
          links.push({ source: n.uid, target: pid, type: 'project' });
        }
      }
    }

    res.json({ nodes, links, stats: { nodes: raw.length, sim_edges: sim.length } });
  } catch (err) { next(err); }
});

// GET /memory?kind=&project=&agent=&q=&limit=&offset=
// Central de Memória — tudo que foi aprendido, unificado e paginado.
router.get('/', async (req, res, next) => {
  try {
    const { kind, project, agent, q } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const { items, total } = await listMemory({ kind, project, agent, q, limit, offset });
    res.json({ items, total, limit, offset });
  } catch (err) { next(err); }
});

// GET /memory/facets — valores distintos pros filtros (tipo/projeto/agente)
router.get('/facets', async (req, res, next) => {
  try {
    res.json(await memoryFacets());
  } catch (err) { next(err); }
});

// GET /memory/stats — tamanho do cérebro + crescimento (pro dashboard)
router.get('/stats', async (req, res, next) => {
  try {
    res.json(await memoryStats());
  } catch (err) { next(err); }
});

// POST /memory — adiciona manualmente um fato/nota à memória
// body: { project?, source?, text, agent? }
router.post('/', async (req, res, next) => {
  try {
    const { project, source, text, agent } = req.body || {};
    const result = await addMemoryFact({ project, source, text, agent });
    logEvent('INFO', 'memory', `fato adicionado manualmente (${result.chunks} chunks)`);
    res.json(result);
  } catch (err) { err.status = 400; next(err); }
});

// PATCH /memory/:uid — edita o texto de um item (re-embeda). uid: doc:123 | msg:45
router.patch('/:uid', async (req, res, next) => {
  try {
    const result = await editMemoryItem(req.params.uid, req.body?.text);
    logEvent('INFO', 'memory', `item ${req.params.uid} editado`);
    res.json(result);
  } catch (err) { err.status = 400; next(err); }
});

// DELETE /memory/:uid — apaga um item de memória
router.delete('/:uid', async (req, res, next) => {
  try {
    const result = await deleteMemoryItem(req.params.uid);
    logEvent('INFO', 'memory', `item ${req.params.uid} excluído`);
    res.json(result);
  } catch (err) { err.status = 400; next(err); }
});

// GET /memory/:uid — um item específico (pra abrir direto na edição)
// registrado por último pra não capturar /graph, /facets, etc.
router.get('/:uid', async (req, res, next) => {
  try {
    const item = await getMemoryItem(req.params.uid);
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });
    res.json(item);
  } catch (err) { next(err); }
});

export default router;
