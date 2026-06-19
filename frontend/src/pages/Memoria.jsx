import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Brain, Trash2, Pencil, Check, X, Plus, RefreshCw, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtDateTime, timeAgo } from '../lib/format.js';

// tipos de memória → rótulo + cor do badge
const KIND_META = {
  fato:      { label: 'Fato consolidado', cls: 'bg-violet-500/15 text-violet-300' },
  nota:      { label: 'Nota de agente',   cls: 'bg-emerald-500/15 text-emerald-300' },
  documento: { label: 'Documento',        cls: 'bg-blue-500/15 text-blue-300' },
  mensagem:  { label: 'Mensagem',         cls: 'bg-slate-500/15 text-slate-300' }
};
const kindOf = (k) => KIND_META[k] || { label: k, cls: 'bg-slate-500/15 text-slate-300' };

const PAGE = 60;

export default function Memoria() {
  const [data, setData] = useState(null);        // { items, total }
  const [facets, setFacets] = useState({ kinds: [], projects: [], agents: [] });
  const [filters, setFilters] = useState({ kind: '', project: '', agent: '', q: '' });
  const [qInput, setQInput] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);        // uid em operação
  const [editing, setEditing] = useState(null);  // { uid, text }
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ project: 'memoria-agentes', source: '', text: '' });
  const [focused, setFocused] = useState(null); // item aberto via ?uid= (vindo do grafo)
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(async (reset = true) => {
    try {
      const off = reset ? 0 : offset;
      const r = await api.memory.list({ ...filters, limit: PAGE, offset: off });
      setData((prev) =>
        reset || !prev ? r : { ...r, items: [...prev.items, ...r.items] }
      );
      setOffset(off + PAGE);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [filters, offset]);

  const loadFacets = useCallback(async () => {
    try { setFacets(await api.memory.facets()); } catch { /* ignora */ }
  }, []);

  // recarrega do zero quando os filtros mudam
  useEffect(() => { setOffset(0); load(true); /* eslint-disable-next-line */ }, [filters]);
  useEffect(() => { loadFacets(); }, [loadFacets]);

  // veio do grafo com ?uid=doc:123 → abre o item direto na edição
  useEffect(() => {
    const uid = searchParams.get('uid');
    if (!uid) return;
    api.memory.get(uid)
      .then((it) => { setFocused(it); setEditing({ uid: it.uid, text: it.text }); })
      .catch((err) => setError(err.message));
    // limpa o parâmetro da URL pra não reabrir ao navegar
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line
  }, []);

  function applySearch(e) {
    e.preventDefault();
    setFilters((f) => ({ ...f, q: qInput.trim() }));
  }

  async function refreshAll() {
    setNotice(null); setError(null);
    setOffset(0);
    await Promise.all([load(true), loadFacets()]);
  }

  async function saveEdit() {
    const { uid, text } = editing;
    setBusy(uid); setError(null); setNotice(null);
    try {
      await api.memory.update(uid, text);
      setData((d) => ({ ...d, items: d.items.map((it) => (it.uid === uid ? { ...it, text } : it)) }));
      setFocused((f) => (f && f.uid === uid ? { ...f, text } : f));
      setNotice('Memória atualizada e re-indexada.');
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(it) {
    if (!window.confirm(`Excluir esta memória (${kindOf(it.kind).label})? Essa ação é permanente.`)) return;
    setBusy(it.uid); setError(null); setNotice(null);
    try {
      await api.memory.remove(it.uid);
      setData((d) => ({ ...d, items: d.items.filter((x) => x.uid !== it.uid), total: Math.max(0, (d.total || 1) - 1) }));
      setFocused((f) => (f && f.uid === it.uid ? null : f));
      setNotice('Memória excluída.');
      loadFacets();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleAdd() {
    if (!draft.text.trim()) return;
    setBusy('add'); setError(null); setNotice(null);
    try {
      await api.memory.add(draft);
      setNotice('Fato adicionado à memória.');
      setAdding(false);
      setDraft({ project: 'memoria-agentes', source: '', text: '' });
      await refreshAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>;
  }
  if (!data) {
    return <p className="py-10 text-center text-sm text-muted">Carregando memória…</p>;
  }

  const items = data.items;
  // item aberto via grafo aparece no topo, mesmo que não esteja na página atual
  const displayItems = focused && !items.some((i) => i.uid === focused.uid)
    ? [focused, ...items]
    : items;
  const hasMore = items.length < data.total;

  return (
    <div className="space-y-4">
      {/* barra de filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filters.kind}
          onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todos os tipos</option>
          {facets.kinds.map((k) => (
            <option key={k.kind} value={k.kind}>{kindOf(k.kind).label} ({k.n})</option>
          ))}
        </select>
        <select
          value={filters.project}
          onChange={(e) => setFilters((f) => ({ ...f, project: e.target.value }))}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todos os projetos</option>
          {facets.projects.map((p) => <option key={p.project} value={p.project}>{p.project} ({p.n})</option>)}
        </select>
        <select
          value={filters.agent}
          onChange={(e) => setFilters((f) => ({ ...f, agent: e.target.value }))}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todos os agentes</option>
          {facets.agents.map((a) => <option key={a.agent} value={a.agent}>{a.agent} ({a.n})</option>)}
        </select>

        <form onSubmit={applySearch} className="flex items-center gap-2">
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Buscar no texto…"
            className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button type="submit" className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-muted hover:text-body">Buscar</button>
        </form>

        <button onClick={refreshAll} className="rounded-lg border border-edge bg-surface p-2 text-muted hover:text-body" title="Atualizar">
          <RefreshCw size={15} />
        </button>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted">{data.total} memórias</span>
          <Link
            to="/ingest"
            className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-2 text-sm font-medium text-muted hover:text-body"
            title="Subir arquivos .md / .pdf / .txt para a base de conhecimento"
          >
            <Upload size={15} /> Subir .md
          </Link>
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-500/15 px-3 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/25"
          >
            <Plus size={15} /> Adicionar fato
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">{notice}</div>}

      {/* formulário de adicionar fato manual */}
      {adding && (
        <div className="space-y-3 rounded-xl border border-blue-500/30 bg-surface p-4">
          <div className="flex flex-wrap gap-3">
            <input
              value={draft.project}
              onChange={(e) => setDraft((d) => ({ ...d, project: e.target.value }))}
              placeholder="Projeto (ex: memoria-agentes)"
              className="flex-1 rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <input
              value={draft.source}
              onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
              placeholder="Fonte/título (opcional)"
              className="flex-1 rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <textarea
            value={draft.text}
            onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            placeholder="O que você quer que os agentes lembrem para sempre…"
            rows={4}
            className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="rounded-lg border border-edge px-3 py-2 text-sm text-muted hover:text-body">Cancelar</button>
            <button
              onClick={handleAdd}
              disabled={busy === 'add' || !draft.text.trim()}
              className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {busy === 'add' ? 'Salvando…' : 'Salvar na memória'}
            </button>
          </div>
        </div>
      )}

      {/* lista de memórias */}
      {displayItems.length === 0 ? (
        <div className="rounded-xl border border-edge bg-surface p-10 text-center text-sm text-muted">
          <Brain className="mx-auto mb-3 opacity-40" size={28} />
          Nada na memória com esses filtros ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {displayItems.map((it) => {
            const meta = kindOf(it.kind);
            const isEditing = editing?.uid === it.uid;
            const working = busy === it.uid;
            const isFocused = focused?.uid === it.uid;
            return (
              <div key={it.uid} className={`rounded-xl border bg-surface p-4 ${isFocused ? 'border-blue-500/60 ring-1 ring-blue-500/40' : 'border-edge'}`}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded-full px-2.5 py-0.5 font-medium ${meta.cls}`}>{meta.label}</span>
                  {it.agent && <span className="rounded-full bg-white/5 px-2 py-0.5 text-muted">👤 {it.agent}</span>}
                  {it.project && <span className="rounded-full bg-white/5 px-2 py-0.5 text-muted">{it.project}</span>}
                  <span className="text-muted/70">{it.ref}</span>
                  <span className="ml-auto text-muted/60" title={fmtDateTime(it.created_at)}>{timeAgo(it.created_at)}</span>
                  {!isEditing && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditing({ uid: it.uid, text: it.text })}
                        disabled={working}
                        className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-blue-400 disabled:opacity-50"
                        title="Editar"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(it)}
                        disabled={working}
                        className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-red-400 disabled:opacity-50"
                        title="Excluir"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editing.text}
                      onChange={(e) => setEditing((ed) => ({ ...ed, text: e.target.value }))}
                      rows={Math.min(12, Math.max(3, Math.ceil(editing.text.length / 80)))}
                      className="w-full rounded-lg border border-edge bg-background px-3 py-2 font-mono text-[13px] focus:border-blue-500 focus:outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditing(null)}
                        className="flex items-center gap-1 rounded-lg border border-edge px-3 py-1.5 text-xs text-muted hover:text-body"
                      >
                        <X size={13} /> Cancelar
                      </button>
                      <button
                        onClick={saveEdit}
                        disabled={working || !editing.text.trim()}
                        className="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                      >
                        <Check size={13} /> {working ? 'Salvando…' : 'Salvar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm text-body/85">{it.text}</p>
                )}
              </div>
            );
          })}

          {hasMore && (
            <div className="pt-2 text-center">
              <button
                onClick={() => load(false)}
                className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm text-muted hover:text-body"
              >
                Carregar mais ({data.total - items.length} restantes)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
