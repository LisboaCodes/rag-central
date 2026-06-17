import axios from 'axios';
import { getSettings } from './settings.js';

// Cliente da evolution-api (WhatsApp). Preencher URL/key/instância nas
// Configurações depois de instalar no homelab.

function cfg() {
  const s = getSettings();
  if (!s.WHATSAPP_API_URL) throw new Error('WHATSAPP_API_URL não configurada');
  if (!s.WHATSAPP_API_KEY) throw new Error('WHATSAPP_API_KEY não configurada');
  if (!s.WHATSAPP_INSTANCE) throw new Error('WHATSAPP_INSTANCE não configurada');
  return s;
}

function client(s) {
  return axios.create({
    baseURL: s.WHATSAPP_API_URL,
    timeout: 20000,
    headers: { apikey: s.WHATSAPP_API_KEY, 'Content-Type': 'application/json' }
  });
}

const wrap = (err) => new Error(`evolution-api: ${err.response?.data?.message || err.response?.data?.error || err.message}`);

// envia uma mensagem de texto. number = só dígitos (ex: 5511999999999)
export async function sendText(number, text) {
  const s = cfg();
  const num = String(number).replace(/\D/g, '');
  try {
    const { data } = await client(s).post(`/message/sendText/${s.WHATSAPP_INSTANCE}`, { number: num, text });
    return { ok: true, id: data?.key?.id || null };
  } catch (err) { throw wrap(err); }
}

// estado da conexão da instância (open = conectado)
export async function connectionState() {
  const s = cfg();
  try {
    const { data } = await client(s).get(`/instance/connectionState/${s.WHATSAPP_INSTANCE}`);
    return { state: data?.instance?.state || data?.state || 'desconhecido' };
  } catch (err) { throw wrap(err); }
}

// QR / pareamento para conectar a instância ao WhatsApp
export async function connect() {
  const s = cfg();
  try {
    const { data } = await client(s).get(`/instance/connect/${s.WHATSAPP_INSTANCE}`);
    return { qr: data?.base64 || data?.qrcode?.base64 || null, code: data?.pairingCode || data?.code || null, raw: data };
  } catch (err) { throw wrap(err); }
}

// registra o webhook da evolution apontando pra este backend
export async function setWebhook(url) {
  const s = cfg();
  try {
    const body = { webhook: { enabled: true, url, webhookByEvents: false, events: ['MESSAGES_UPSERT'] } };
    const { data } = await client(s).post(`/webhook/set/${s.WHATSAPP_INSTANCE}`, body);
    return { ok: true, data };
  } catch (err) { throw wrap(err); }
}

// extrai { number, text, fromMe, isGroup } de um payload messages.upsert
export function parseIncoming(payload) {
  const d = payload?.data || payload;
  const key = d?.key || {};
  const remoteJid = key.remoteJid || '';
  const msg = d?.message || {};
  const text = msg.conversation
    || msg.extendedTextMessage?.text
    || msg.imageMessage?.caption
    || msg.videoMessage?.caption
    || '';
  return {
    number: remoteJid.replace(/@.*/, ''),
    text: String(text || '').trim(),
    fromMe: Boolean(key.fromMe),
    isGroup: remoteJid.endsWith('@g.us') || remoteJid.includes('broadcast'),
    pushName: d?.pushName || null
  };
}
