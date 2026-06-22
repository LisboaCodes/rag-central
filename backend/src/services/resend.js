import axios from 'axios';
import { getSettings } from './settings.js';

// Cliente mínimo da Resend (resend.com) para enviar o código de login por
// e-mail. Sem SDK — só um POST autenticado. Configure RESEND_API_KEY e
// RESEND_FROM nas Configurações (ou .env).

export function resendConfigured() {
  return Boolean(getSettings().RESEND_API_KEY);
}

export async function sendEmail({ to, subject, html, text }) {
  const s = getSettings();
  if (!s.RESEND_API_KEY) throw new Error('RESEND_API_KEY não configurada');
  try {
    const { data } = await axios.post(
      'https://api.resend.com/emails',
      { from: s.RESEND_FROM, to: Array.isArray(to) ? to : [to], subject, html, text },
      { headers: { Authorization: `Bearer ${s.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    return { ok: true, id: data?.id || null };
  } catch (err) {
    const detail = err.response?.data?.message || err.response?.data?.error || err.message;
    throw new Error(`Resend: ${detail}`);
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
  return sendEmail({ to, subject, html, text: `Seu código CERBERUS é ${code} (expira em 5 minutos).` });
}
