import { useEffect, useState } from 'react';
import { Search as SearchIcon, FileText } from 'lucide-react';
import { api } from '../lib/api.js';

// destaca os termos da busca no texto do chunk
function Highlight({ text, query }) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (!terms.length) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const splitter = new RegExp(`(${escaped})`, 'gi');
  const matcher = new RegExp(`^(${escaped})$`, 'i');
  return text.split(splitter).map((part, i) =>
    matcher.test(part)
      ? <mark key={i} className="rounded bg-amber-500/30 px-0.5 text-amber-200">{part}</mark>
      : part
  );
}

function scoreColor(s) {
  if (s >= 0.8) return 'text-emerald-400';
  if (s >= 0.6) return 'text-amber-400';
  return 'text-muted';
}

export default function Search() {
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const [topK, setTopK] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [searched, setSearched] = useState('');

  useEffect(() => {
    api.sourceProjects().then((r) => setProjects(r.projects)).catch(() => {});
  }, []);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api.query({
        question: query,
        project: project || undefined,
        top_k: topK,
        agent: 'dashboard'
      });
      setResult(r);
      setSearched(query);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-edge bg-surface p-5">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="relative">
            <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Faça uma pergunta à base de conhecimento…"
              className="w-full rounded-xl border border-edge bg-background py-3.5 pl-11 pr-4 text-sm placeholder-muted/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Projeto</label>
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
                className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">Todos os projetos</option>
                {projects.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-xs">
                <label className="font-medium text-muted">Top-K</label>
                <span className="font-semibold text-blue-400">{topK}</span>
              </div>
              <input
                type="range" min="1" max="20" value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="mt-2 w-full accent-blue-500"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white hover:from-blue-500 hover:to-violet-500 disabled:opacity-60"
              >
                {busy ? 'Buscando…' : 'Buscar'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {result && !busy && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{result.count} resultados para “{searched}”</span>
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] text-violet-400">
              {result.embedding_model}
            </span>
            {result.fallback && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                fallback OpenAI
              </span>
            )}
          </div>

          {result.count === 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
              Nada encontrado. A busca só compara chunks embedados pelo mesmo modelo da pergunta
              ({result.embedding_model}) — se a base usa outro modelo, re-indexe as fontes ou
              ajuste o modo de embedding nas Configurações.
            </div>
          )}

          {result.results.map((r) => (
            <div key={r.id} className="rounded-xl border border-edge bg-surface p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 font-medium text-blue-400">
                    {r.project}
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-muted">
                    <FileText size={12} />
                    {r.source_path} · chunk #{r.chunk_index}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500"
                      style={{ width: `${Math.max(r.similarity, 0) * 100}%` }}
                    />
                  </div>
                  <span className={`text-sm font-bold ${scoreColor(r.similarity)}`}>
                    {(r.similarity * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-body/80">
                <Highlight text={r.chunk_text} query={searched} />
              </p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
