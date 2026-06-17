import { Router } from 'express';
import { sendText, connectionState, connect, setWebhook, parseIncoming } from '../services/whatsapp.js';
import { chatWithAgent } from '../services/chat.js';
import { getSettings } from '../services/settings.js';
import { logEvent, recordQuery, recordOutcome } from '../services/activity.js';

const router = Router();

// número do WhatsApp -> conversationId (memória da conversa por contato)
const convByNumber = new Map();

// GET /whatsapp/status — config + estado da conexão
router.get('/status', async (req, res) => {
  const s = getSettings();
  const out = {
    enabled: s.WHATSAPP_ENABLED,
    configured: Boolean(s.WHATSAPP_API_URL && s.WHATSAPP_API_KEY && s.WHATSAPP_INSTANCE),
    instance: s.WHATSAPP_INSTANCE || null,
    agent: s.WHATSAPP_AGENT
  };
  try { out.connection = (await connectionState()).state; } catch (e) { out.connection = null; out.error = e.message; }
  res.json(out);
});

// GET /whatsapp/qr — QR/código pra conectar a instância
router.get('/qr', async (req, res, next) => {
  try { res.json(await connect()); } catch (err) { err.status = 400; next(err); }
});

// POST /whatsapp/setup — registra o webhook deste backend na evolution
// body: { url }  (ex: http://IP-DO-BACKEND:3000/whatsapp/webhook)
router.post('/setup', async (req, res, next) => {
  try {
    const url = req.body?.url;
    if (!url) return res.status(400).json({ error: 'campo "url" obrigatório' });
    res.json(await setWebhook(url));
  } catch (err) { err.status = 400; next(err); }
});

// POST /whatsapp/test — envia mensagem de teste { number, text? }
router.post('/test', async (req, res, next) => {
  try {
    const { number, text } = req.body || {};
    if (!number) return res.status(400).json({ error: 'campo "number" obrigatório' });
    res.json(await sendText(number, text || 'Teste do RAG Central ✅ — seus agentes estão prontos!'));
  } catch (err) { err.status = 400; next(err); }
});

// POST /whatsapp/webhook — recebe eventos da evolution (messages.upsert)
router.post('/webhook', (req, res) => {
  res.json({ ok: true }); // responde rápido; processa em background

  const s = getSettings();
  if (!s.WHATSAPP_ENABLED) return;

  const evt = req.body?.event || '';
  if (evt && !/messages.upsert/i.test(evt)) return;

  const { number, text, fromMe, isGroup } = parseIncoming(req.body);
  if (fromMe || isGroup || !text || !number) return;

  (async () => {
    try {
      const conversationId = convByNumber.get(number) || null;
      const result = await chatWithAgent({
        agent: s.WHATSAPP_AGENT,
        message: text,
        conversationId,
        project: null
      });
      convByNumber.set(number, result.conversationId);
      for (const r of result.replies) {
        recordQuery(r.agent);
        const prefix = result.replies.length > 1 ? `*${r.agent}:* ` : '';
        await sendText(number, prefix + r.answer);
      }
      recordOutcome(true);
      logEvent('INFO', 'whatsapp', `${number}: "${text.slice(0, 40)}" → ${result.replies.map((r) => r.agent).join(', ')}`);
    } catch (err) {
      recordOutcome(false);
      logEvent('ERROR', 'whatsapp', `falha ao responder ${number}: ${err.message}`);
      try { await sendText(number, 'Ops, tive um problema pra responder agora. 🤖'); } catch { /* ignora */ }
    }
  })();
});

export default router;
