import { useEffect, useState } from 'react';
import { RefreshCw, Upload, Search, Settings2, AlertTriangle, Info, Brain, ArrowUpRight } from 'lucide-react';
import MetricCard from '../components/MetricCard.jsx';
import ServiceStatus from '../components/ServiceStatus.jsx';
import AgentCard from '../components/AgentCard.jsx';
import QueryChart from '../components/charts/QueryChart.jsx';
import DonutChart from '../components/charts/FileTypeChart.jsx';
import EmbeddingChart from '../components/charts/EmbeddingChart.jsx';
import { useStatus } from '../lib/StatusContext.jsx';
import { api } from '../lib/api.js';
import { fmtNumber, timeAgo, fmtTime } from '../lib/format.js';
import { useAgents } from '../lib/AgentsContext.jsx';

const PALETTE = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#f97316', '#64748b'];
const BAR_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500', 'bg-amber-500'];

const LOG_BADGES = {
  INFO: { label: 'Info', classes: 'bg-blue-500/15 text-blue-400' },
  WARN: { label: 'Aviso', classes: 'bg-amber-500/15 text-amber-400' },
  ERROR: { label: 'Erro', classes: 'bg-red-500/15 text-red-400' }
};

const LOG_ICONS = {
  ingest: { Icon: Upload, classes: 'bg-emerald-500/15 text-emerald-400' },
  query: { Icon: Search, classes: 'bg-blue-500/15 text-blue-400' },
  embedding: { Icon: AlertTriangle, classes: 'bg-amber-500/15 text-amber-400' },
  config: { Icon: Settings2, classes: 'bg-violet-500/15 text-violet-400' }
};

const BRAIN_KIND = {
  fato:      { color: '#a78bfa', label: 'Fatos' },
  nota:      { color: '#34d399', label: 'Notas' },
  documento: { color: '#60a5fa', label: 'Docs' },
  mensagem:  { color: '#22d3ee', label: 'Mensagens' }
};

// mini-gráfico de linha (SVG puro) pra mostrar o cérebro crescendo
function Sparkline({ values, color = '#8b5cf6', w = 240, h = 56 }) {
  if (!values || values.length < 2) return <div className="h-14" />;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const stepX = w / (values.length - 1);
  const pts = values.map((v, i) => [i * stepX, h - 4 - ((v - min) / span) * (h - 10)]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark)" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={color} />
    </svg>
  );
}

export default function Dashboard() {
  const { status, error, updatedAt, refresh } = useStatus();
  const { agents: roster } = useAgents();
  const [recentLogs, setRecentLogs] = useState([]);
  const [brain, setBrain] = useState(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const load = () => api.logs({ limit: 5 }).then((r) => setRecentLogs(r.logs)).catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const load = () => api.memory.stats().then(setBrain).catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  async function setMode(mode) {
    setSwitching(true);
    try {
      await api.updateConfig({ EMBEDDING_MODE: mode });
      await refresh();
    } finally {
      setSwitching(false);
    }
  }

  if (!status && !error) {
    return (
      <div className="flex items-center gap-2 py-20 text-sm text-muted justify-center">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-blue-500" />
        Consultando /status…
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        API offline: {error} — verifique se o backend está rodando (porta 3000).
      </div>
    );
  }

  const { stats, ollama, openai, embedding, activity, query_series } = status;
  const mode = (embedding?.mode || 'auto').toUpperCase();

  // provedores de embedding: contagem persistida no banco por modelo
  const byProvider = { ollama: 0, openai: 0 };
  for (const m of stats?.by_model || []) {
    const provider = m.embedding_model.split('/')[0];
    if (byProvider[provider] !== undefined) byProvider[provider] += m.chunks;
  }
  const totalEmb = byProvider.ollama + byProvider.openai;
  const pct = (n) => (totalEmb ? Math.round((n / totalEmb) * 100) : 0);

  const services = [
    {
      name: 'PostgreSQL (LXC 100)',
      status: status.database?.connected ? 'Online' : 'Offline',
      tone: status.database?.connected ? 'green' : 'red',
      detail: status.database?.version || '—',
      icon: 'database'
    },
    {
      name: 'pgvector',
      status: status.database?.pgvector ? 'Online' : 'Offline',
      tone: status.database?.pgvector ? 'green' : 'red',
      detail: status.database?.pgvector || '—',
      icon: 'box'
    },
    {
      name: 'Ollama (LXC 101)',
      status: ollama?.online ? 'Online' : 'Offline',
      tone: ollama?.online ? 'green' : 'red',
      detail: embedding?.ollama_model || '—',
      icon: 'cpu'
    },
    {
      name: 'OpenAI API',
      status: openai?.configured ? 'Ativo' : 'Sem key',
      tone: openai?.configured ? 'yellow' : 'red',
      detail: openai?.model || '—',
      icon: 'cloud'
    }
  ];

  const agents = roster.map((a) => {
    const s = activity?.agents?.[a.key] || {};
    return {
      ...a,
      queries: fmtNumber(s.queries || 0),
      lastQuery: s.last_query_at ? timeAgo(s.last_query_at) : '—',
      online: true
    };
  });

  const metrics = [
    { id: 'chunks', label: 'Chunks Indexados', value: fmtNumber(stats?.total_chunks ?? 0), sub: `${fmtNumber(stats?.sources ?? 0)} fontes`, subTone: 'muted', icon: 'database', color: 'blue' },
    { id: 'projects', label: 'Projetos', value: fmtNumber(stats?.projects ?? 0), sub: 'na base vetorial', subTone: 'muted', icon: 'folder', color: 'purple' },
    { id: 'files', label: 'Arquivos', value: fmtNumber(stats?.sources ?? 0), sub: 'fontes indexadas', subTone: 'muted', icon: 'file', color: 'green' },
    { id: 'success', label: 'Taxa de Sucesso', value: `${((activity?.success_rate ?? 1) * 100).toFixed(1).replace('.', ',')}%`, sub: 'desde o último boot', subTone: 'muted', icon: 'activity', color: 'yellow' },
    { id: 'lastIngest', label: 'Última Ingestão', value: stats?.last_ingested_at ? timeAgo(stats.last_ingested_at) : '—', sub: `${fmtNumber(activity?.ingests ?? 0)} nesta sessão`, subTone: 'muted', icon: 'clock', color: 'gray' }
  ];

  const fileTypeData = (stats?.by_type || []).map((t, i) => ({
    name: t.type, value: t.chunks, color: PALETTE[i % PALETTE.length]
  }));
  const modelData = (stats?.by_model || []).map((m, i) => ({
    name: m.embedding_model.split('/')[1] || m.embedding_model,
    value: m.chunks,
    color: m.embedding_model.startsWith('ollama/')
      ? '#10b981'
      : m.embedding_model.startsWith('openai/')
        ? '#3b82f6'
        : PALETTE[i % PALETTE.length]
  }));
  const maxProject = Math.max(1, ...(stats?.by_project || []).map((p) => p.chunks));

  return (
    <div className="space-y-4">
      {/* atualizado em */}
      <div className="flex items-center justify-end gap-2 text-xs text-muted">
        {error && <span className="text-amber-400">última atualização falhou — exibindo dados anteriores</span>}
        <span>Atualizado às {updatedAt ? fmtTime(updatedAt.toISOString()) : '—'}</span>
        <button onClick={refresh} className="rounded-lg p-1.5 hover:bg-white/5 hover:text-body" aria-label="Atualizar">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* linha 1 — métricas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {metrics.map((m) => <MetricCard key={m.id} {...m} />)}
      </div>

      {/* cérebro — tamanho e crescimento */}
      {brain && (
        <div className="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-5 md:flex-row md:items-center">
          <div className="flex items-center gap-4 md:w-64">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 text-violet-400">
              <Brain size={22} />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted">Tamanho do Cérebro</p>
              <p className="text-2xl font-bold leading-tight">{fmtNumber(brain.total)} <span className="text-sm font-normal text-muted">memórias</span></p>
              {(() => {
                const s = brain.series || [];
                const grew = s.length ? s[s.length - 1].total - s[0].total : 0;
                return <p className="text-[11px] text-emerald-400">+{fmtNumber(grew)} nos últimos 14 dias</p>;
              })()}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 md:flex-1">
            {(brain.by_kind || []).map((k) => {
              const meta = BRAIN_KIND[k.kind] || { color: '#94a3b8', label: k.kind };
              return (
                <span key={k.kind} className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-body/80">
                  <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                  {meta.label}: <strong className="text-body">{fmtNumber(k.n)}</strong>
                </span>
              );
            })}
          </div>

          <div className="md:w-72">
            <Sparkline values={(brain.series || []).map((p) => p.total)} />
          </div>

          <a href="/cerebro" className="flex shrink-0 items-center gap-1 self-start rounded-lg border border-edge px-3 py-2 text-xs font-medium text-muted hover:border-violet-500/50 hover:text-violet-400 md:self-center">
            Ver cérebro <ArrowUpRight size={13} />
          </a>
        </div>
      )}

      {/* linha 2 — serviços / modo embedding / agentes */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-10">
        <div className="xl:col-span-4">
          <ServiceStatus services={services} />
        </div>

        <div className="rounded-xl border border-edge bg-surface p-5 xl:col-span-3">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Modo de Embedding</h3>
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-blue-400">
              {mode}
            </span>
          </div>
          <p className="mb-4 text-[11px] text-muted">Ollama primeiro, OpenAI como fallback</p>

          <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-background p-1">
            {['AUTO', 'OLLAMA', 'OPENAI'].map((m) => (
              <button
                key={m}
                disabled={switching}
                onClick={() => setMode(m.toLowerCase())}
                className={`rounded-md py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-60 ${
                  mode === m
                    ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white'
                    : 'text-muted hover:text-body'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-body/80">Uso do Ollama</span>
                <span className="font-bold">{pct(byProvider.ollama)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-background">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct(byProvider.ollama)}%` }} />
              </div>
              <p className="mt-1 text-[10px] text-muted">{fmtNumber(byProvider.ollama)} embeddings na base</p>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-body/80">Uso do OpenAI</span>
                <span className="font-bold">{pct(byProvider.openai)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-background">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct(byProvider.openai)}%` }} />
              </div>
              <p className="mt-1 text-[10px] text-muted">{fmtNumber(byProvider.openai)} embeddings na base</p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <button
              disabled={switching}
              onClick={() => setMode('ollama')}
              className="flex-1 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-body/80 hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-60"
            >
              Forçar Ollama
            </button>
            <button
              disabled={switching}
              onClick={() => setMode('openai')}
              className="flex-1 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-body/80 hover:border-blue-500/50 hover:text-blue-400 disabled:opacity-60"
            >
              Forçar OpenAI
            </button>
            <a href="/settings" className="rounded-lg border border-edge p-2 text-muted hover:text-body" aria-label="Configurações de embedding">
              <Settings2 size={14} />
            </a>
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-surface p-5 xl:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Agentes Conectados</h3>
            <a href="/agents" className="text-[11px] text-blue-400 hover:underline">Ver todos</a>
          </div>
          {agents.map((a) => <AgentCard key={a.key} agent={a} />)}
        </div>
      </div>

      {/* linha 3 — gráfico de consultas / atividade recente */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="rounded-xl border border-edge bg-surface p-5 xl:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Consultas RAG</h3>
              <p className="text-[11px] text-muted">
                {fmtNumber(activity?.queries ?? 0)} consultas nas últimas 24 horas
              </p>
            </div>
          </div>
          <QueryChart data={query_series || []} />
        </div>

        <div className="rounded-xl border border-edge bg-surface p-5 xl:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Atividade Recente</h3>
            <a href="/logs" className="text-[11px] text-blue-400 hover:underline">Ver todos</a>
          </div>
          {recentLogs.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted">Nenhum evento ainda nesta sessão.</p>
          ) : (
            <ul>
              {recentLogs.map((l) => {
                const { Icon, classes } = LOG_ICONS[l.service] || { Icon: Info, classes: 'bg-slate-500/15 text-slate-400' };
                const badge = LOG_BADGES[l.level] || LOG_BADGES.INFO;
                return (
                  <li key={l.id} className="flex items-center gap-3 border-b border-edge/60 py-3 last:border-0 last:pb-0 first:pt-0">
                    <span className="w-9 shrink-0 font-mono text-[11px] text-muted">{fmtTime(l.timestamp)}</span>
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${classes}`}>
                      <Icon size={14} />
                    </div>
                    <p className="min-w-0 flex-1 truncate text-xs text-body/80" title={l.message}>{l.message}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.classes}`}>
                      {badge.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* linha 4 — top projetos / tipos de arquivo / modelos */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[6fr_7fr_7fr]">
        <div className="rounded-xl border border-edge bg-surface p-5">
          <h3 className="mb-4 text-sm font-semibold">Top Projetos</h3>
          {!stats?.by_project?.length ? (
            <p className="py-8 text-center text-xs text-muted">Sem projetos ainda.</p>
          ) : (
            <ul className="space-y-3.5">
              {stats.by_project.map((p, i) => (
                <li key={p.project}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="truncate text-body/80">{p.project}</span>
                    <span className="font-semibold text-muted">{fmtNumber(p.chunks)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-background">
                    <div
                      className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                      style={{ width: `${Math.round((p.chunks / maxProject) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-edge bg-surface p-5">
          <h3 className="mb-4 text-sm font-semibold">Tipos de Arquivos</h3>
          <DonutChart data={fileTypeData} />
        </div>

        <div className="rounded-xl border border-edge bg-surface p-5">
          <h3 className="mb-4 text-sm font-semibold">Modelos de Embedding</h3>
          <EmbeddingChart data={modelData} />
        </div>
      </div>
    </div>
  );
}
