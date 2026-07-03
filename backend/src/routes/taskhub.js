import { Router } from 'express';
import { getSettings } from '../services/settings.js';
import { taskhubEnabled, listMcpTools, pingTaskhub } from '../services/taskhub.js';

const router = Router();

// URL pública que o iframe da página "Tarefas" carrega. Preferimos
// TASKHUB_PUBLIC_URL; senão derivamos da URL do MCP (tira o /api/mcp).
function publicUrl() {
  const s = getSettings();
  if (s.TASKHUB_PUBLIC_URL) return s.TASKHUB_PUBLIC_URL;
  const mcp = String(s.TASKHUB_MCP_URL || '').replace(/\/+$/, '');
  return mcp.replace(/\/api\/mcp$/, '');
}

// GET /taskhub/config — o que o frontend precisa pra embutir o TaskHub.
router.get('/config', (req, res) => {
  res.json({ enabled: taskhubEnabled(), url: taskhubEnabled() ? publicUrl() : '' });
});

// GET /taskhub/status — testa a conexão MCP (usado nas Configurações).
router.get('/status', async (req, res) => {
  if (!taskhubEnabled()) return res.json({ ok: false, detail: 'TaskHub desabilitado ou sem URL/segredo' });
  try {
    const r = await pingTaskhub();
    res.json({ ok: true, server: r.server, detail: r.instructions || 'Conectado' });
  } catch (err) {
    res.json({ ok: false, detail: err.message });
  }
});

// GET /taskhub/tools — lista as ferramentas MCP (diagnóstico).
router.get('/tools', async (req, res) => {
  if (!taskhubEnabled()) return res.status(400).json({ error: 'TaskHub desabilitado' });
  try {
    const tools = await listMcpTools({ force: req.query.force === '1' });
    res.json({ count: tools.length, tools: tools.map((t) => ({ name: t.name, description: t.description })) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
