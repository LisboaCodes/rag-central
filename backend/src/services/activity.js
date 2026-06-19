// Telemetria em memória: logs de eventos, contadores e estatísticas por
// agente. Reseta a cada restart — suficiente pro dashboard; persistência
// em tabela fica pra fase 2 se fizer falta.

const MAX_EVENTS = 500;
const HOUR_MS = 3_600_000;

const startedAt = Date.now();
const events = [];
let nextId = 1;

const counters = { queries: 0, ingests: 0, ok: 0, failed: 0 };
const embeddingsByProvider = {}; // 'ollama' -> n
const agentStats = {};           // 'MEL' -> { queries, last_query_at }
const queryBuckets = new Map();  // epochHour -> contagem

export function logEvent(level, service, message) {
  events.unshift({
    id: nextId++,
    timestamp: new Date().toISOString(),
    level,
    service,
    message
  });
  if (events.length > MAX_EVENTS) events.pop();

  // notifica erros no WhatsApp (best-effort, dedup por mensagem, cooldown 10min).
  // import dinâmico evita ciclo activity↔notify; notify não loga (sem recursão).
  if (level === 'ERROR') {
    import('./notify.js')
      .then((m) => m.notify(`🛑 *Erro* (${service})\n${message}`.slice(0, 500), {
        flag: 'NOTIFY_ERRORS', key: `err:${service}:${message}`.slice(0, 140), cooldown: 10 * 60 * 1000
      }))
      .catch(() => {});
  }
}

export function recordOutcome(ok) {
  if (ok) counters.ok++;
  else counters.failed++;
}

export function recordQuery(agent) {
  counters.queries++;
  const hour = Math.floor(Date.now() / HOUR_MS);
  queryBuckets.set(hour, (queryBuckets.get(hour) || 0) + 1);
  for (const k of queryBuckets.keys()) {
    if (k < hour - 24) queryBuckets.delete(k);
  }
  if (agent) {
    const key = String(agent).trim().toUpperCase();
    if (key) {
      const s = agentStats[key] || (agentStats[key] = { queries: 0, last_query_at: null });
      s.queries++;
      s.last_query_at = new Date().toISOString();
    }
  }
}

export function recordIngest() {
  counters.ingests++;
}

export function recordEmbeddings(model, count) {
  const provider = String(model || '').split('/')[0] || 'desconhecido';
  embeddingsByProvider[provider] = (embeddingsByProvider[provider] || 0) + count;
}

export function getLogs({ level, service, limit = 100 } = {}) {
  let out = events;
  if (level) out = out.filter((e) => e.level === level);
  if (service) out = out.filter((e) => e.service === service);
  return out.slice(0, Math.min(parseInt(limit, 10) || 100, MAX_EVENTS));
}

// série das últimas 24 horas pro gráfico do dashboard
export function getQuerySeries() {
  const nowHour = Math.floor(Date.now() / HOUR_MS);
  const series = [];
  for (let i = 23; i >= 0; i--) {
    const h = nowHour - i;
    const date = new Date(h * HOUR_MS);
    series.push({
      hour: `${String(date.getHours()).padStart(2, '0')}:00`,
      queries: queryBuckets.get(h) || 0
    });
  }
  return series;
}

export function getActivitySummary() {
  const total = counters.ok + counters.failed;
  return {
    started_at: new Date(startedAt).toISOString(),
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    queries: counters.queries,
    ingests: counters.ingests,
    success_rate: total ? counters.ok / total : 1,
    embeddings_by_provider: embeddingsByProvider,
    agents: agentStats
  };
}
