import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, Eye, MousePointerClick, AlertTriangle, Send, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';

const PAGE = 50;

function fmt(ts) {
  return ts ? new Date(ts).toLocaleString('pt-BR') : '—';
}

// A "jornada" de um e-mail: enviado → entregue → aberto → clicado. Bounce e
// falha são becos sem saída. Mostramos o estágio mais avançado alcançado.
function stage(e) {
  if (e.status === 'failed') return { label: 'Falhou', cls: 'bg-red-500/15 text-red-400', icon: XCircle };
  if (e.bounced_at) return { label: 'Bounce', cls: 'bg-red-500/15 text-red-400', icon: AlertTriangle };
  if (e.clicked_at) return { label: 'Clicado', cls: 'bg-violet-500/15 text-violet-400', icon: MousePointerClick };
  if (e.opened_at) return { label: 'Aberto', cls: 'bg-emerald-500/15 text-emerald-400', icon: Eye };
  if (e.delivered_at) return { label: 'Entregue', cls: 'bg-blue-500/15 text-blue-400', icon: CheckCheck };
  return { label: 'Enviado', cls: 'bg-slate-500/15 text-slate-300', icon: Send };
}

// Quem realmente pediu o envio. O app ("rag") é grosso demais: o que interessa
// é se foi a DARLENE numa conversa, o login, ou um teste do painel.
function origem(e) {
  const m = e.meta || {};
  if (m.agente) return `${m.agente}${m.conversa ? ` · conversa #${m.conversa}` : ''}`;
  if (m.origem === 'login') return 'código de login';
  if (m.origem === 'painel') return `teste do painel${m.por ? ` · ${m.por}` : ''}`;
  return null;
}

function Stat({ label, value, tone = 'text-body' }) {
  return (
    <div className="rounded-xl border border-edge bg-surface px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone}`}>{value ?? '—'}</p>
    </div>
  );
}

export default function Emails() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await api.emails.list({
        status: status || undefined,
        search: search.trim() || undefined,
        limit: PAGE,
        offset: page * PAGE
      });
      setData(r);
      setError(null);
    } catch (err) {
      setError(err.message);
      setData(null);
    }
  }, [status, search, page]);

  useEffect(() => { load(); }, [load]);
  // o webhook do Resend chega depois do envio: revisita de tempos em tempos
  useEffect(() => {
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const s = data?.stats;
  const emails = data?.emails || [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Total" value={s?.total} />
        <Stat label="Enviados" value={s?.enviados} />
        <Stat label="Entregues" value={s?.entregues} tone="text-blue-400" />
        <Stat label="Abertos" value={s?.abertos} tone="text-emerald-400" />
        <Stat label="Bounces" value={s?.bounces} tone="text-amber-400" />
        <Stat label="Falhas" value={s?.falhas} tone="text-red-400" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(0); }}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todos os status</option>
          <option value="sent">Enviados</option>
          <option value="failed">Falhas</option>
        </select>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="Buscar por assunto ou destinatário…"
          className="min-w-[260px] flex-1 rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <span className="text-xs text-muted">{total} registro{total === 1 ? '' : 's'}</span>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="overflow-x-auto rounded-xl border border-edge bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-edge text-[11px] uppercase tracking-wider text-muted">
              <th className="px-4 py-3">Enviado em</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Destinatário</th>
              <th className="px-4 py-3">Assunto</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3">Aberto em</th>
            </tr>
          </thead>
          <tbody>
            {emails.map((e) => {
              const st = stage(e);
              const Icon = st.icon;
              return (
                <tr key={e.id} className="border-b border-edge/60 last:border-0 align-top hover:bg-white/[0.02]">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted">{fmt(e.sent_at)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${st.cls}`}>
                      <Icon size={11} /> {st.label}
                    </span>
                    {e.error && <p className="mt-1 max-w-[240px] text-[10px] text-red-400/80">{e.error}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-body/80">{(e.recipients || []).join(', ')}</td>
                  <td className="px-4 py-2.5 text-xs text-body/80">{e.subject}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-violet-400">{e.app}</span>
                    {origem(e) && <p className="mt-0.5 text-[10px] text-muted">{origem(e)}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted">
                    {fmt(e.opened_at)}
                    {e.opens > 1 && <span className="ml-1 text-[10px] text-emerald-400">({e.opens}×)</span>}
                  </td>
                </tr>
              );
            })}
            {data && emails.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                  Nenhum e-mail com esses filtros.
                </td>
              </tr>
            )}
            {!data && !error && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">Carregando…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-lg border border-edge px-3 py-1.5 text-xs text-body/80 disabled:opacity-40 hover:bg-white/5"
          >
            Anterior
          </button>
          <span className="text-xs text-muted">página {page + 1} de {Math.ceil(total / PAGE)}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * PAGE >= total}
            className="rounded-lg border border-edge px-3 py-1.5 text-xs text-body/80 disabled:opacity-40 hover:bg-white/5"
          >
            Próxima
          </button>
        </div>
      )}

      <p className="text-center text-[11px] text-muted">
        "Aberto" é medido por pixel de imagem e o Gmail pré-carrega imagens — trate como indicador, não como verdade.
        Entrega e abertura só aparecem se o webhook do Resend estiver ligado.
      </p>
    </div>
  );
}
