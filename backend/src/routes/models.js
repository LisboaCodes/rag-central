import { Router } from 'express';
import axios from 'axios';
import { getSettings } from '../services/settings.js';
import { getAgent } from '../services/db.js';

const router = Router();

// lista modelos de um endpoint OpenAI-compatible (GET /models)
async function listOpenAI(base, key) {
  if (!base || !key) return [];
  try {
    const { data } = await axios.get(`${String(base).replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${key}` }, timeout: 15000
    });
    const arr = data?.data || data?.models || [];
    return [...new Set(arr.map((m) => m.id || m.name || m).filter(Boolean))].sort();
  } catch { return []; }
}

// lista modelos do Ollama (GET /api/tags)
async function listOllama(url) {
  if (!url) return [];
  try {
    const { data } = await axios.get(`${String(url).replace(/\/+$/, '')}/api/tags`, { timeout: 8000 });
    return (data?.models || []).map((m) => m.name).filter(Boolean).sort();
  } catch { return []; }
}

// GET /models — modelos do provedor GLOBAL + Ollama (o que já temos)
router.get('/', async (req, res) => {
  const s = getSettings();
  let openai = [];
  if (req.query.agent) {
    // usa a config (chave real) de um agente específico
    const a = await getAgent(req.query.agent);
    if (a?.chat_provider === 'openai') openai = await listOpenAI(a.chat_api_base || s.CHAT_API_BASE, a.chat_api_key || s.CHAT_API_KEY);
    else if (a?.chat_provider === 'ollama') return res.json({ openai: [], ollama: await listOllama(a.chat_api_base || s.OLLAMA_URL) });
    else openai = await listOpenAI(s.CHAT_API_BASE, s.CHAT_API_KEY);
  } else {
    openai = s.CHAT_API_KEY ? await listOpenAI(s.CHAT_API_BASE, s.CHAT_API_KEY) : [];
  }
  res.json({ openai, ollama: await listOllama(s.OLLAMA_URL) });
});

// POST /models — lista de um provedor OpenAI-compatible informado { base, key }
// (se a key vier vazia/mascarada, usa a global)
router.post('/', async (req, res) => {
  const s = getSettings();
  const base = req.body?.base || s.CHAT_API_BASE;
  let key = req.body?.key;
  if (!key || String(key).startsWith('••••')) key = s.CHAT_API_KEY;
  res.json({ openai: await listOpenAI(base, key) });
});

export default router;
