import { getSettings } from './settings.js';
import { sendText } from './whatsapp.js';
import { memoryStats } from './db.js';
import { logEvent } from './activity.js';

// Notificações do sistema via WhatsApp. Envia pro WHATSAPP_NOTIFY_NUMBER
// (o seu número pessoal), respeitando os toggles NOTIFY_*. Best-effort:
// nunca lança — uma falha aqui não pode quebrar o fluxo que chamou.

const lastSent = new Map(); // chave de dedup -> timestamp

export async function notify(text, { flag, key, cooldown = 5 * 60 * 1000 } = {}) {
  try {
    const s = getSettings();
    if (!s.WHATSAPP_ENABLED || !s.WHATSAPP_NOTIFY_NUMBER) return false;
    if (flag && !s[flag]) return false;
    if (key) {
      const now = Date.now();
      if (lastSent.has(key) && now - lastSent.get(key) < cooldown) return false;
      lastSent.set(key, now);
    }
    await sendText(s.WHATSAPP_NOTIFY_NUMBER, text);
    return true;
  } catch {
    return false; // silencioso de propósito (evita loop com NOTIFY_ERRORS)
  }
}

// Resumo diário do cérebro (tamanho + crescimento + tipos).
async function sendDailyDigest() {
  const s = getSettings();
  if (!s.WHATSAPP_ENABLED || !s.WHATSAPP_NOTIFY_NUMBER || !s.NOTIFY_DAILY) return;
  let stats;
  try { stats = await memoryStats(); } catch { return; }
  const series = stats.series || [];
  const today = series.length ? series[series.length - 1].total : stats.total;
  const prev = series.length > 1 ? series[series.length - 2].total : today;
  const grew = today - prev;
  const kinds = (stats.by_kind || []).map((k) => `• ${k.kind}: ${k.n}`).join('\n');
  const msg =
    '🧠 *Resumo do cérebro*\n\n' +
    `Total de memórias: *${stats.total}*\n` +
    `Novas hoje: *${grew >= 0 ? '+' : ''}${grew}*\n\n${kinds}`;
  try { await sendText(s.WHATSAPP_NOTIFY_NUMBER, msg); } catch { /* ignora */ }
}

// Agenda o resumo diário: checa de hora em hora e envia 1x/dia na janela
// das 9h (horário de Brasília, UTC-3).
let lastDigestDay = null;
export function startNotifySchedule() {
  const tick = () => {
    const brt = new Date(Date.now() - 3 * 3600 * 1000);
    const day = brt.toISOString().slice(0, 10);
    const hour = brt.getUTCHours();
    if (hour >= 9 && hour < 21 && lastDigestDay !== day) {
      lastDigestDay = day;
      sendDailyDigest().catch(() => {});
    }
  };
  setInterval(tick, 60 * 60 * 1000); // de hora em hora
  setTimeout(tick, 60 * 1000);       // primeira checagem 1 min após o boot
  logEvent('INFO', 'notify', 'agendador de notificações ativo (resumo diário ~9h BRT)');
}
