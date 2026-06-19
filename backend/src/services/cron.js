import cron from 'node-cron';
import { listCronJobs, getCronJob, markCronRun, memoryStats } from './db.js';
import { chatWithAgent } from './chat.js';
import { syncRss } from './rss-scraper.js';
import { notify } from './notify.js';
import { consolidateAll } from './memory.js';
import { logEvent } from './activity.js';

// Agendador de tarefas (CRON). Carrega os jobs do banco no boot e reescala
// quando a API cria/edita/remove. Horário de Brasília.

const TZ = 'America/Sao_Paulo';
export const CRON_ACTIONS = ['agent_prompt', 'rss_sync', 'brain_digest', 'consolidate'];
const tasks = new Map(); // id (string) -> scheduled task

// executa a ação de um job e retorna um resumo textual do resultado
async function runAction(job) {
  const cfg = job.config || {};
  switch (job.action) {
    case 'agent_prompt': {
      if (!cfg.agent || !cfg.prompt) throw new Error('agent e prompt são obrigatórios');
      const r = await chatWithAgent({ agent: cfg.agent, message: cfg.prompt, project: cfg.project || null });
      const answer = (r.replies || []).map((x) => x.answer).join('\n\n');
      if (cfg.notify) {
        await notify(`⏰ *${job.name}* — ${cfg.agent}\n\n${answer}`.slice(0, 1500), { key: `cron:${job.id}`, cooldown: 0 });
      }
      return `${cfg.agent} respondeu (${answer.length} chars)`;
    }
    case 'rss_sync': {
      const res = await syncRss();
      return `RSS sincronizado: ${res.total} artigos novos`;
    }
    case 'brain_digest': {
      const s = await memoryStats();
      const kinds = (s.by_kind || []).map((k) => `• ${k.kind}: ${k.n}`).join('\n');
      const sent = await notify(`🧠 *${job.name}*\nTotal de memórias: *${s.total}*\n${kinds}`, { key: `cron:${job.id}`, cooldown: 0 });
      return sent ? `resumo enviado (total ${s.total})` : 'WhatsApp não configurado — nada enviado';
    }
    case 'consolidate': {
      const n = await consolidateAll();
      return `${n} conversa(s) consolidada(s)`;
    }
    default:
      throw new Error(`ação desconhecida: ${job.action}`);
  }
}

// roda um job pelo id (usado pelo agendador e pelo "rodar agora")
export async function executeJob(id) {
  const job = await getCronJob(id);
  if (!job) throw new Error('tarefa não encontrada');
  try {
    const result = await runAction(job);
    await markCronRun(id, 'ok', result);
    logEvent('INFO', 'cron', `"${job.name}" ok: ${result}`);
    return { ok: true, result };
  } catch (err) {
    await markCronRun(id, 'error', err.message);
    logEvent('ERROR', 'cron', `"${job.name}" falhou: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function scheduleOne(job) {
  if (!job.enabled) return;
  if (!cron.validate(job.schedule)) {
    logEvent('WARN', 'cron', `expressão inválida em "${job.name}": ${job.schedule}`);
    return;
  }
  const task = cron.schedule(job.schedule, () => { executeJob(job.id).catch(() => {}); }, { timezone: TZ });
  tasks.set(String(job.id), task);
}

// para tudo e reescala a partir do banco (chamado após qualquer mudança)
export async function reloadCron() {
  for (const t of tasks.values()) { try { t.stop(); t.destroy?.(); } catch { /* ignora */ } }
  tasks.clear();
  let jobs = [];
  try { jobs = await listCronJobs(); } catch (e) { logEvent('WARN', 'cron', `não carregou tarefas: ${e.message}`); return; }
  for (const job of jobs) scheduleOne(job);
  logEvent('INFO', 'cron', `agendador recarregado: ${tasks.size} tarefa(s) ativa(s)`);
}

export function startCronSchedule() {
  // espera o banco subir e então agenda
  setTimeout(() => { reloadCron().catch((e) => logEvent('ERROR', 'cron', e.message)); }, 5000);
}
