import { Router } from 'express';
import OpenAI from 'openai';
import { getSettings, updateSettings } from '../services/settings.js';
import { pool } from '../services/db.js';
import { checkOllama } from '../services/embedding.js';
import { logEvent } from '../services/activity.js';

const router = Router();

const KEY_MASK_PREFIX = '••••';

function masked(settings) {
  const out = { ...settings };
  if (out.OPENAI_API_KEY) {
    out.OPENAI_API_KEY = `${KEY_MASK_PREFIX}${out.OPENAI_API_KEY.slice(-4)}`;
  }
  if (out.CHAT_API_KEY) {
    out.CHAT_API_KEY = `${KEY_MASK_PREFIX}${out.CHAT_API_KEY.slice(-4)}`;
  }
  if (out.GITHUB_TOKEN) {
    out.GITHUB_TOKEN = `${KEY_MASK_PREFIX}${out.GITHUB_TOKEN.slice(-4)}`;
  }
  if (out.WHATSAPP_API_KEY) {
    out.WHATSAPP_API_KEY = `${KEY_MASK_PREFIX}${out.WHATSAPP_API_KEY.slice(-4)}`;
  }
  if (out.PERPLEXITY_API_KEY) {
    out.PERPLEXITY_API_KEY = `${KEY_MASK_PREFIX}${out.PERPLEXITY_API_KEY.slice(-4)}`;
  }
  return out;
}

// GET /config — configurações atuais (API key mascarada)
router.get('/', (req, res) => {
  res.json(masked(getSettings()));
});

// PUT /config — atualiza e persiste (sobrevive a restart via runtime-settings.json)
router.put('/', (req, res, next) => {
  try {
    const patch = { ...(req.body || {}) };
    // se o front mandou a key mascarada de volta, não sobrescreve a real
    if (typeof patch.OPENAI_API_KEY === 'string' && patch.OPENAI_API_KEY.startsWith(KEY_MASK_PREFIX)) {
      delete patch.OPENAI_API_KEY;
    }
    if (typeof patch.CHAT_API_KEY === 'string' && patch.CHAT_API_KEY.startsWith(KEY_MASK_PREFIX)) {
      delete patch.CHAT_API_KEY;
    }
    if (typeof patch.GITHUB_TOKEN === 'string' && patch.GITHUB_TOKEN.startsWith(KEY_MASK_PREFIX)) {
      delete patch.GITHUB_TOKEN;
    }
    if (typeof patch.WHATSAPP_API_KEY === 'string' && patch.WHATSAPP_API_KEY.startsWith(KEY_MASK_PREFIX)) {
      delete patch.WHATSAPP_API_KEY;
    }
    if (typeof patch.PERPLEXITY_API_KEY === 'string' && patch.PERPLEXITY_API_KEY.startsWith(KEY_MASK_PREFIX)) {
      delete patch.PERPLEXITY_API_KEY;
    }
    const updated = updateSettings(patch);
    logEvent('INFO', 'config', `Configurações atualizadas: ${Object.keys(patch).join(', ') || 'nenhuma mudança'}`);
    res.json(masked(updated));
  } catch (err) {
    err.status = 400;
    next(err);
  }
});

// POST /config/test — body { service: 'db' | 'ollama' | 'openai' }
// Testa a conexão real com o serviço e retorna { ok, detail }.
router.post('/test', async (req, res) => {
  const { service } = req.body || {};
  const s = getSettings();
  try {
    if (service === 'db') {
      const v = await pool.query(`
        SELECT current_setting('server_version') AS pg,
               (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector
      `);
      return res.json({ ok: true, detail: `PostgreSQL ${v.rows[0].pg} · pgvector ${v.rows[0].pgvector || 'inativo'}` });
    }
    if (service === 'ollama') {
      const ollama = await checkOllama();
      if (!ollama.online) return res.json({ ok: false, detail: `Offline: ${ollama.error}` });
      return res.json({
        ok: true,
        detail: ollama.model_available
          ? `Online — ${s.OLLAMA_MODEL} disponível`
          : `Online, mas o modelo ${s.OLLAMA_MODEL} não foi puxado`
      });
    }
    if (service === 'openai') {
      if (!s.OPENAI_API_KEY) return res.json({ ok: false, detail: 'OPENAI_API_KEY não configurada' });
      const client = new OpenAI({ apiKey: s.OPENAI_API_KEY });
      await client.models.list();
      return res.json({ ok: true, detail: 'API key válida' });
    }
    res.status(400).json({ error: 'service deve ser db, ollama ou openai' });
  } catch (err) {
    res.json({ ok: false, detail: err.message });
  }
});

export default router;
