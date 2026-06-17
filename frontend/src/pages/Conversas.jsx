import { useEffect, useState } from 'react';
import { Trash2, MessageSquare, Brain, RefreshCw, User } from 'lucide-react';
import { useAgents, hexOf } from '../lib/AgentsContext.jsx';
import { api } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';

export default function Conversas() {
  const { agents, byKey } = useAgents();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');     // agente
  const [selected, setSelected] = useState(null); // id
  const [thread, setThread] = useState(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [consolidated, setConsolidated] = useState(null);

  async function consolidate(id) {
    setConsolidating(true); setConsolidated(null); setError(null);
    try {
      const r = await api.consolidateConversation(id);
      setConsolidated(r.summary);
    } catch (err) { setError(err.message); }
    finally { setConsolidating(false); }
  }

  async function refresh() {
    setError(null);
    try {
      const r = await api.conversations(filter || undefined);
      setList(r.conversations);
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [filter]);

  async function open(id) {
    setSelected(id); setLoadingThread(true); setThread(null); setConsolidated(null);
    try { setThread(await api.conversation(id)); } catch (err) { setError(err.message); }
    finally { setLoadingThread(false); }
  }

  async function remove(id, e) {
    e.stopPropagation();
    if (!confirm('Apagar esta conversa e todas as mensagens?')) return;
    try {
      await api.deleteConversation(id);
      if (selected === id) { setSelected(null); setThread(null); }
      refresh();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Memória dos agentes — todo o histórico de conversas fica salvo no banco e é o que os
        agentes <strong className="text-body">relembram</strong> em conversas futuras.
      </p>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="flex items-center gap-2">
        <select
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setSelected(null); setThread(null); }}
          className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todos os agentes</option>
          {agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
        </select>
        <button onClick={refresh} className="rounded-lg border border-edge p-2 text-muted hover:text-body">
          <RefreshCw size={14} />
        </button>
        <span className="text-xs text-muted">{list?.length ?? '…'} conversas</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* lista de threads */}
        <div className="space-y-2 lg:col-span-1">
          {list?.length === 0 && <p className="text-sm text-muted">Nenhuma conversa ainda.</p>}
          {list?.map((c) => {
            const ag = byKey(c.agent);
            return (
              <button
                key={c.id}
                onClick={() => open(c.id)}
                className={`flex w-full items-start gap-3 rounded-xl border bg-surface p-3 text-left transition-colors hover:border-blue-500 ${
                  selected === c.id ? 'border-blue-500 ring-1 ring-blue-500/40' : 'border-edge'
                }`}
              >
                <span
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-white"
                  style={{ background: hexOf(ag?.color) }}
                >
                  {c.agent}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.title || `Conversa #${c.id}`}</p>
                  <p className="truncate text-[11px] text-muted">{c.last_message}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[10px] text-muted/70">
                    <span className="flex items-center gap-1"><MessageSquare size={9} /> {c.message_count}</span>
                    <span>{timeAgo(c.updated_at)}</span>
                  </p>
                </div>
                <button onClick={(e) => remove(c.id, e)} className="rounded p-1 text-muted hover:text-red-400" aria-label="Apagar">
                  <Trash2 size={13} />
                </button>
              </button>
            );
          })}
        </div>

        {/* thread selecionada */}
        <div className="lg:col-span-2">
          {!selected && (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-edge text-sm text-muted">
              Selecione uma conversa para ver as mensagens
            </div>
          )}
          {loadingThread && <p className="py-10 text-center text-sm text-muted">Carregando…</p>}
          {thread && (
            <div className="rounded-xl border border-edge bg-surface">
              <div className="flex items-start justify-between gap-2 border-b border-edge px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{thread.title || `Conversa #${thread.id}`}</p>
                  <p className="text-[11px] text-muted">
                    Agente {thread.agent} · {thread.messages.length} mensagens · criada {timeAgo(thread.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => consolidate(thread.id)}
                  disabled={consolidating}
                  title="Resume esta conversa em fatos e guarda na base de conhecimento"
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-violet-500 hover:text-violet-400 disabled:opacity-50"
                >
                  <Brain size={13} /> {consolidating ? 'Consolidando…' : 'Consolidar memória'}
                </button>
              </div>
              {consolidated && (
                <div className="border-b border-edge bg-violet-500/5 px-4 py-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-violet-400">
                    <Brain size={12} /> Memória consolidada (salva na base):
                  </p>
                  <p className="whitespace-pre-wrap text-xs text-body/90">{consolidated}</p>
                </div>
              )}
              <div className="max-h-[480px] space-y-3 overflow-y-auto p-4">
                {thread.messages.map((m) => {
                  const ag = m.agent ? byKey(m.agent) : null;
                  return (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className="max-w-[85%]">
                        <div className="mb-1 flex items-center gap-1.5">
                          {m.role === 'user'
                            ? <span className="flex items-center gap-1 text-[10px] font-bold text-muted"><User size={9} /> Você</span>
                            : (
                              <span className="flex items-center gap-1 text-[10px] font-bold text-muted">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: hexOf(ag?.color) }} />
                                {m.agent}
                              </span>
                            )}
                          <span className="text-[9px] text-muted/60">{timeAgo(m.created_at)}</span>
                        </div>
                        <div className={`rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-background text-body'}`}>
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
