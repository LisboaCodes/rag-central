import { Fragment, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2, Eye } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';

const TYPE_COLORS = {
  md: 'bg-emerald-500/15 text-emerald-400',
  php: 'bg-violet-500/15 text-violet-400',
  js: 'bg-amber-500/15 text-amber-400',
  ts: 'bg-blue-500/15 text-blue-400',
  py: 'bg-blue-500/15 text-blue-400',
  json: 'bg-orange-500/15 text-orange-400',
  pdf: 'bg-red-500/15 text-red-400'
};
const TYPE_FALLBACK = 'bg-slate-500/15 text-slate-400';

const typeOf = (path) => (path.includes('.') ? path.split('.').pop().toLowerCase() : 'txt');
const keyOf = (s) => `${s.project}::${s.source_path}`;

export default function Sources() {
  const [sources, setSources] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [expanded, setExpanded] = useState(null); // { key, chunks }

  const load = useCallback(async () => {
    try {
      const r = await api.sources();
      setSources(r.sources);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error && !sources) {
    return <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>;
  }
  if (!sources) {
    return <p className="py-10 text-center text-sm text-muted">Carregando fontes…</p>;
  }

  const projects = [...new Set(sources.map((s) => s.project))].sort();
  const types = [...new Set(sources.map((s) => typeOf(s.source_path)))].sort();
  const filtered = sources.filter(
    (s) =>
      (!projectFilter || s.project === projectFilter) &&
      (!typeFilter || typeOf(s.source_path) === typeFilter)
  );

  async function handleDelete(s) {
    if (!window.confirm(`Apagar os ${s.chunks} chunks de "${s.source_path}" (${s.project})?`)) return;
    setBusyKey(keyOf(s)); setNotice(null); setError(null);
    try {
      const r = await api.deleteSource(s.project, s.source_path);
      setNotice(`${r.deleted_chunks} chunks apagados de ${s.source_path}.`);
      if (expanded?.key === keyOf(s)) setExpanded(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleReindex(s) {
    setBusyKey(keyOf(s)); setNotice(null); setError(null);
    try {
      const r = await api.reindexSource(s.project, s.source_path);
      setNotice(`${r.reindexed_chunks} chunks re-embedados via ${r.embedding_model}${r.fallback ? ' (fallback OpenAI)' : ''}.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleChunks(s) {
    const key = keyOf(s);
    if (expanded?.key === key) return setExpanded(null);
    setBusyKey(key); setError(null);
    try {
      const r = await api.chunks(s.project, s.source_path);
      setExpanded({ key, chunks: r.chunks });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todos os projetos</option>
          {projects.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todos os tipos</option>
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <button
          onClick={load}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-muted hover:text-body"
        >
          Atualizar
        </button>
        <span className="ml-auto text-xs text-muted">{filtered.length} fontes</span>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">{notice}</div>}

      {sources.length === 0 ? (
        <div className="rounded-xl border border-edge bg-surface p-10 text-center text-sm text-muted">
          Nenhuma fonte indexada ainda — use a página <a href="/ingest" className="text-blue-400 hover:underline">Ingestão</a>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-edge bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-edge text-[11px] uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Projeto</th>
                <th className="px-4 py-3">Arquivo</th>
                <th className="px-4 py-3">Chunks</th>
                <th className="px-4 py-3">Modelo</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const key = keyOf(s);
                const type = typeOf(s.source_path);
                const busy = busyKey === key;
                return (
                  <Fragment key={key}>
                    <tr className="border-b border-edge/60 last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                          {s.project}
                        </span>
                      </td>
                      <td className="max-w-72 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${TYPE_COLORS[type] || TYPE_FALLBACK}`}>
                            {type}
                          </span>
                          <span className="truncate font-mono text-xs text-body/80" title={s.source_path}>
                            {s.source_path}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">{s.chunks}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted">{s.embedding_models}</td>
                      <td className="px-4 py-3 text-xs text-muted">{fmtDateTime(s.last_ingested_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => toggleChunks(s)}
                            disabled={busy}
                            className={`rounded-lg p-2 hover:bg-white/5 disabled:opacity-50 ${expanded?.key === key ? 'text-blue-400' : 'text-muted hover:text-blue-400'}`}
                            title="Ver chunks"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            onClick={() => handleReindex(s)}
                            disabled={busy}
                            className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-emerald-400 disabled:opacity-50"
                            title="Re-indexar com o modo de embedding atual"
                          >
                            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />
                          </button>
                          <button
                            onClick={() => handleDelete(s)}
                            disabled={busy}
                            className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-red-400 disabled:opacity-50"
                            title="Deletar"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded?.key === key && (
                      <tr className="border-b border-edge/60 bg-background/60">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                            {expanded.chunks.map((c) => (
                              <div key={c.id} className="rounded-lg border border-edge bg-surface p-3">
                                <p className="mb-1 text-[10px] text-muted">
                                  chunk #{c.chunk_index} · id {c.id} · {c.embedding_model}
                                </p>
                                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-body/70">{c.chunk_text}</pre>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
