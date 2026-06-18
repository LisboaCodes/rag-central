import { Router } from 'express';
import { askPerplexity, perplexityEnabled } from '../services/perplexity.js';
import { syncRss, getRssStatus } from '../services/rss-scraper.js';
import { getAgent } from '../services/db.js';
import { logEvent } from '../services/activity.js';

const router = Router();

// GET /news/status — Perplexity + última sync do RSS e total ingerido
router.get('/status', async (req, res) => {
  res.json({ enabled: perplexityEnabled(), rss: await getRssStatus() });
});

// POST /news/sync — dispara o scraper de RSS manualmente
router.post('/sync', async (req, res, next) => {
  try {
    const result = await syncRss();
    res.json(result);
  } catch (err) { err.status = 500; next(err); }
});

function parseItems(text) {
  try {
    const clean = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const arr = JSON.parse(clean);
    if (Array.isArray(arr)) return arr.map((x) => ({ titulo: x.titulo || x.title, resumo: x.resumo || x.summary, fonte: x.fonte || x.url }));
  } catch { /* não veio JSON */ }
  return null;
}

// GET /news — últimas novidades do mundo de IA (quadro)
router.get('/', async (req, res, next) => {
  try {
    const prompt =
      'Liste as 6 novidades MAIS RECENTES e relevantes do mundo de Inteligência Artificial ' +
      '(novos modelos, APIs de IA, lançamentos, ferramentas para devs). ' +
      'Responda APENAS com um JSON array: [{"titulo":"...","resumo":"1-2 frases","fonte":"url"}]. Sem texto fora do JSON.';
    const { text, citations } = await askPerplexity(prompt, { recency: 'week' });
    const items = parseItems(text);
    logEvent('INFO', 'news', `quadro de novidades atualizado (${items?.length || 0} itens)`);
    res.json({ items: items || [], raw: items ? null : text, citations });
  } catch (err) { err.status = 400; next(err); }
});

// GET /news/brief?agent=MEL — novidades do tema que o agente domina
router.get('/brief', async (req, res, next) => {
  try {
    const key = String(req.query.agent || '').toUpperCase();
    const agent = await getAgent(key);
    if (!agent) return res.status(404).json({ error: 'agente não encontrado' });
    const foco = agent.role || agent.name;
    const prompt =
      `Você está atualizando ${agent.name}, responsável por "${foco}". ` +
      `Traga as novidades MAIS RECENTES e úteis da área de "${foco}" (foco em IA quando fizer sentido), ` +
      'em até 5 tópicos curtos e diretos, em português, citando as fontes.';
    const { text, citations } = await askPerplexity(prompt, { recency: 'week' });
    res.json({ agent: key, brief: text, citations });
  } catch (err) { err.status = 400; next(err); }
});

export default router;
