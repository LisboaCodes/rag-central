import { Router } from 'express';
import { emailConfigured, listEmails, sendEmail } from '../services/email.js';

const router = Router();

// GET /emails — o painel lê o registro de envios do email-api (todos os apps,
// não só o RAG). A chave do email-api fica no backend; o front nunca a vê.
router.get('/', async (req, res, next) => {
  try {
    if (!emailConfigured()) {
      return res.status(503).json({ error: 'email-api não configurado (EMAIL_API_URL / EMAIL_API_KEY nas Configurações)' });
    }
    const { status, search, limit, offset } = req.query;
    res.json(await listEmails({
      status: status || undefined,
      search: search || undefined,
      limit: Math.min(parseInt(limit || '50', 10) || 50, 200),
      offset: parseInt(offset || '0', 10) || 0
    }));
  } catch (err) {
    next(err);
  }
});

// POST /emails/test — envia um e-mail de teste pelo painel (útil pra validar
// a configuração sem depender de um agente).
router.post('/test', async (req, res, next) => {
  try {
    const { to, subject, html } = req.body || {};
    if (!to) return res.status(400).json({ error: 'informe "to"' });
    const r = await sendEmail({
      to,
      subject: subject || 'Teste — RAG Central',
      html: html || '<p>Teste de envio pelo painel do RAG Central.</p>',
      meta: { origem: 'painel', por: req.user?.email || null }
    });
    res.json(r);
  } catch (err) {
    next(err);
  }
});

export default router;
