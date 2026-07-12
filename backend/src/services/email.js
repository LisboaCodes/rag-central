import axios from 'axios';
import { getSettings } from './settings.js';

// Cliente do email-api (send.creativenext.dev) — o serviço central de email.
// O RAG não conhece mais o Resend: manda pra cá com a chave DELE (EMAIL_API_KEY)
// e o serviço central decide o provedor, faz failover e registra o envio.

export function emailConfigured() {
  const s = getSettings();
  return Boolean(s.EMAIL_API_URL && s.EMAIL_API_KEY);
}

// Quais agentes podem usar a ferramenta de envio (EMAIL_AGENT_KEYS, csv).
// Mesmo modelo do cofre: um agente que não está na lista não enxerga a tool.
export function agentAllowed(agentKey) {
  if (!agentKey) return false;
  const allowed = String(getSettings().EMAIL_AGENT_KEYS || '')
    .split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
  return allowed.includes(String(agentKey).toUpperCase());
}

function client() {
  const s = getSettings();
  if (!emailConfigured()) throw new Error('email-api não configurado (EMAIL_API_URL / EMAIL_API_KEY)');
  return axios.create({
    baseURL: s.EMAIL_API_URL,
    headers: { Authorization: `Bearer ${s.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 20000
  });
}

function describe(err) {
  const d = err.response?.data;
  return d?.error?.formErrors?.join('; ') || d?.error || d?.message || err.message;
}

// `meta` vai pro registro do email-api: é o que responde "quem pediu esse
// e-mail?" quando você olha o painel depois (qual agente, qual conversa).
// `idempotencyKey` evita que um retry nosso vire dois e-mails pro destinatário.
export async function sendEmail({ to, subject, html, text, replyTo, meta, idempotencyKey }) {
  try {
    const headers = idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey) } : undefined;
    const { data } = await client().post('/send', { to, subject, html, text, replyTo, meta }, { headers });
    return { ok: true, id: data?.id || null, provider: data?.provider || null, duplicate: Boolean(data?.duplicate) };
  } catch (err) {
    throw new Error(`email-api: ${describe(err)}`);
  }
}

// Registro dos envios (a tela de Emails do painel lê daqui).
export async function listEmails({ status, search, limit = 50, offset = 0 } = {}) {
  try {
    const { data } = await client().get('/emails', { params: { status, search, limit, offset } });
    return data;
  } catch (err) {
    throw new Error(`email-api: ${describe(err)}`);
  }
}

// E-mail bonitinho com o código de verificação (login).
export async function sendLoginCode(to, code) {
  const subject = `Seu código CERBERUS: ${code}`;
  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#1a1d2e">
      <h2 style="margin:0 0 4px">CERBERUS · RAG Central</h2>
      <p style="color:#6b7280;margin:0 0 20px">Código de verificação do login</p>
      <div style="font-size:34px;font-weight:700;letter-spacing:8px;background:#0d0f18;color:#fff;border-radius:12px;padding:18px;text-align:center">${code}</div>
      <p style="color:#6b7280;font-size:13px;margin-top:18px">Expira em 5 minutos. Se você não tentou entrar, ignore este e-mail.</p>
    </div>`;
  return sendEmail({
    to, subject, html,
    text: `Seu código CERBERUS é ${code} (expira em 5 minutos).`,
    meta: { origem: 'login' }
  });
}
