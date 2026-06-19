import { useEffect, useRef, useState } from 'react';
import { MessageSquare, X, Plus, Pencil, Trash2, Upload, Bot } from 'lucide-react';
import AgentChat from '../components/AgentChat.jsx';
import { useStatus } from '../lib/StatusContext.jsx';
import { useAgents, hexOf } from '../lib/AgentsContext.jsx';

const COLORS = ['purple', 'green', 'gold', 'blue', 'orange'];

// Avatar: foto se houver, senão círculo colorido com iniciais.
export function Avatar({ agent, size = 48 }) {
  const style = { width: size, height: size };
  if (agent?.avatar_url) {
    return <img src={agent.avatar_url} alt={agent.name} style={style} className="shrink-0 rounded-full object-cover ring-2 ring-white/10" />;
  }
  return (
    <span
      style={{ ...style, background: hexOf(agent?.color) }}
      className="flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white/10"
    >
      {(agent?.name || '?').slice(0, 6)}
    </span>
  );
}

const empty = {
  name: '', role: '', bio: '', persona: '', gender: '', model: '', color: 'blue', avatar_url: '', sprite_url: '',
  chat_provider: 'default', chat_api_base: '', chat_api_key: '', chat_model: ''
};

// presets pra facilitar a escolha da API (OpenAI-compatible)
const API_PRESETS = [
  { label: 'MiMo (Xiaomi)', base: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
  { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { label: 'DeepSeek', base: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { label: 'Anthropic (Claude API)', base: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6' },
  { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: '' }
];

function Editor({ initial, onClose, onSaved }) {
  const { refresh } = useAgents();
  const [form, setForm] = useState(initial || empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const spriteRef = useRef(null);
  const isEdit = Boolean(initial?.key);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // modelos disponíveis (das APIs já configuradas)
  const [models, setModels] = useState({ openai: [], ollama: [] });
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { api } = await import('../lib/api.js');
        setModels(await api.models.list(initial?.key));
      } catch { /* sem modelos */ }
    })();
  }, [initial?.key]);

  async function buscarModelos() {
    setLoadingModels(true);
    try {
      const { api } = await import('../lib/api.js');
      const r = await api.models.listFor(form.chat_api_base, form.chat_api_key);
      setModels((m) => ({ ...m, openai: r.openai || [] }));
    } catch { /* ignore */ }
    finally { setLoadingModels(false); }
  }

  function pickImage(e, field) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) { setError('Imagem muito grande (máx 1MB). Use um link ou comprima.'); return; }
    const reader = new FileReader();
    reader.onload = () => set(field, reader.result);
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!form.name.trim()) { setError('Nome é obrigatório'); return; }
    setSaving(true); setError(null);
    try {
      const { api } = await import('../lib/api.js');
      if (isEdit) await api.agents.update(initial.key, form);
      else await api.agents.create(form);
      await refresh();
      onSaved?.();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-edge bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{isEdit ? `Editar ${initial.key}` : 'Novo agente'}</h3>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-body"><X size={18} /></button>
        </div>

        {error && <p className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-400">{error}</p>}

        <div className="space-y-3">
          {/* avatar */}
          <div className="flex items-center gap-4">
            <Avatar agent={form} size={64} />
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-blue-500">
                  <Upload size={12} /> Enviar foto
                </button>
                {form.avatar_url && (
                  <button onClick={() => set('avatar_url', '')} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-muted hover:text-red-400">Remover</button>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e, 'avatar_url')} />
              </div>
              <input
                value={form.avatar_url?.startsWith('data:') ? '' : (form.avatar_url || '')}
                onChange={(e) => set('avatar_url', e.target.value)}
                placeholder="ou cole uma URL de imagem (foto/rosto)"
                className="w-full rounded-lg border border-edge bg-background px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* sprite (boneco do escritório) */}
          <div className="flex items-center gap-4 rounded-lg border border-edge bg-background/40 p-2">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-background">
              {form.sprite_url
                ? <img src={form.sprite_url} alt="sprite" className="max-h-14 max-w-14 object-contain" style={{ imageRendering: 'pixelated' }} />
                : <span className="text-[9px] text-muted">sem sprite</span>}
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-[11px] font-medium text-body/80">Sprite no escritório (corpo inteiro, PNG transparente)</p>
              <div className="flex gap-2">
                <button onClick={() => spriteRef.current?.click()} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-blue-500">
                  <Upload size={12} /> Enviar sprite
                </button>
                {form.sprite_url && (
                  <button onClick={() => set('sprite_url', '')} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-muted hover:text-red-400">Remover</button>
                )}
                <input ref={spriteRef} type="file" accept="image/png,image/*" className="hidden" onChange={(e) => pickImage(e, 'sprite_url')} />
              </div>
              <input
                value={form.sprite_url?.startsWith('data:') ? '' : (form.sprite_url || '')}
                onChange={(e) => set('sprite_url', e.target.value)}
                placeholder="ou cole uma URL do sprite"
                className="w-full rounded-lg border border-edge bg-background px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <Field label="Nome">
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="ex: SOFIA" className="inp" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Função (o que faz)">
              <input value={form.role} onChange={(e) => set('role', e.target.value)} placeholder="ex: Analista de Dados" className="inp" />
            </Field>
            <Field label="Gênero">
              <input value={form.gender} onChange={(e) => set('gender', e.target.value)} placeholder="feminino / masculino / —" className="inp" />
            </Field>
          </div>
          <Field label="Modelo (rótulo de exibição)">
            <input list="all-models" value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="escolha ou digite — ex: mimo-v2.5-pro" className="inp" />
            <datalist id="all-models">
              {[...models.openai, ...models.ollama].map((m) => <option key={m} value={m} />)}
            </datalist>
          </Field>

          {/* conexão de IA deste agente */}
          <div className="rounded-lg border border-edge bg-background/40 p-3 space-y-3">
            <Field label="Qual IA este agente usa?">
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-background p-1">
                {[
                  { v: 'default', l: 'Padrão' },
                  { v: 'openai', l: 'API própria' },
                  { v: 'anthropic', l: 'Claude (API)' },
                  { v: 'ollama', l: 'Ollama' },
                  { v: 'claude-cli', l: 'Claude CLI' }
                ].map((p) => (
                  <button key={p.v} type="button" onClick={() => set('chat_provider', p.v)}
                    className={`rounded-md py-1.5 text-[11px] font-semibold transition-colors ${form.chat_provider === p.v ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white' : 'text-muted hover:text-body'}`}>
                    {p.l}
                  </button>
                ))}
              </div>
            </Field>

            {form.chat_provider === 'default' && (
              <p className="text-[11px] text-muted">Usa o provedor global definido em <strong>Configurações → Chat dos Agentes</strong>.</p>
            )}

            {form.chat_provider === 'anthropic' && (
              <>
                <Field label="Modelo Claude">
                  <input value={form.chat_model || ''} onChange={(e) => { set('chat_model', e.target.value); set('model', e.target.value || 'Claude'); }}
                    placeholder="sonnet / opus / haiku ou ID completo (vazio = padrão)" className="inp" />
                </Field>
                <p className="text-[11px] text-muted">
                  Usa a <strong>API oficial da Anthropic</strong> com a chave global <code className="text-violet-400">ANTHROPIC_API_KEY</code> (env). Funciona em produção/Docker (não precisa do CLI).
                </p>
              </>
            )}

            {form.chat_provider === 'claude-cli' && (
              <>
                <Field label="Modelo (opcional)">
                  <input value={form.chat_model || ''} onChange={(e) => { set('chat_model', e.target.value); set('model', e.target.value || 'Claude CLI'); }}
                    placeholder="sonnet / opus / haiku (vazio = padrão do CLI)" className="inp" />
                </Field>
                <p className="text-[11px] text-muted">
                  Usa o binário <code className="text-violet-400">claude</code> <strong>logado no host</strong> (sem API key). Em produção/Docker não há binário — se a <code>ANTHROPIC_API_KEY</code> estiver setada, cai automaticamente na <strong>API da Anthropic</strong>.
                </p>
              </>
            )}

            {form.chat_provider === 'openai' && (
              <>
                <Field label="Modelo">
                  <input list="openai-models" value={form.chat_model || ''}
                    onChange={(e) => { set('chat_model', e.target.value); set('model', e.target.value); }}
                    placeholder="escolha um modelo da lista" className="inp" />
                  <datalist id="openai-models">
                    {models.openai.map((m) => <option key={m} value={m} />)}
                  </datalist>
                  <p className="mt-1 text-[10px] text-muted">
                    {models.openai.length > 0
                      ? `${models.openai.length} modelos disponíveis (das chaves já salvas) — é só escolher.`
                      : 'Sem modelos listados — verifique a chave global em Configurações.'}
                  </p>
                </Field>

                <details className="rounded-lg border border-edge/60 bg-background/40 px-3 py-2">
                  <summary className="cursor-pointer text-[11px] text-muted">Avançado: usar outra API/chave (opcional)</summary>
                  <div className="mt-2 space-y-2">
                    <p className="text-[10px] text-muted">Deixe em branco para usar a <strong>chave e endpoint globais</strong> já salvos. Preencha só se este agente usa uma API/chave diferente.</p>
                    <div>
                      <label className="mb-1 block text-[11px] text-muted">Preset</label>
                      <select onChange={(e) => { const p = API_PRESETS[e.target.value]; if (p) { set('chat_api_base', p.base); if (p.model) { set('chat_model', p.model); set('model', p.model); } } }}
                        defaultValue="" className="inp">
                        <option value="">escolha pra preencher…</option>
                        {API_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
                      </select>
                    </div>
                    <input value={form.chat_api_base || ''} onChange={(e) => set('chat_api_base', e.target.value)} placeholder="Base URL (vazio = global)" className="inp" />
                    <input value={form.chat_api_key || ''} onChange={(e) => set('chat_api_key', e.target.value)} placeholder="API Key (vazio = global · ••••  mantém)" autoComplete="off" className="inp" />
                    <button type="button" onClick={buscarModelos} className="rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-blue-500">
                      {loadingModels ? 'listando…' : '🔄 listar modelos dessa API'}
                    </button>
                  </div>
                </details>
              </>
            )}

            {form.chat_provider === 'ollama' && (
              <>
                <Field label="URL do Ollama (vazio = a global)">
                  <input value={form.chat_api_base || ''} onChange={(e) => set('chat_api_base', e.target.value)} placeholder="http://ip-do-lxc101:11434" className="inp" />
                </Field>
                <Field label="Modelo do Ollama">
                  <input list="ollama-models" value={form.chat_model || ''}
                    onChange={(e) => { set('chat_model', e.target.value); if (!form.model) set('model', e.target.value); }}
                    placeholder="escolha ou digite — ex: llama3.1" className="inp" />
                  <datalist id="ollama-models">
                    {models.ollama.map((m) => <option key={m} value={m} />)}
                  </datalist>
                </Field>
              </>
            )}
          </div>

          <Field label="Bio (curta)">
            <input value={form.bio} onChange={(e) => set('bio', e.target.value)} placeholder="uma linha sobre o agente" className="inp" />
          </Field>
          <Field label="Particularidades / Persona (system prompt)">
            <textarea value={form.persona} onChange={(e) => set('persona', e.target.value)} rows={4}
              placeholder="Como ele pensa, fala e age. Ex: 'Você é a SOFIA, analista de dados. Objetiva, gosta de números e gráficos...'"
              className="inp resize-y" />
          </Field>
          <Field label="Cor">
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} onClick={() => set('color', c)} style={{ background: hexOf(c) }}
                  className={`h-7 w-7 rounded-full ring-2 ${form.color === c ? 'ring-white' : 'ring-transparent'}`} />
              ))}
            </div>
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-edge pt-4">
          <button onClick={onClose} className="rounded-lg border border-edge px-4 py-2 text-sm text-muted hover:text-body">Cancelar</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}

export default function Agents() {
  const { status } = useStatus();
  const runtime = status?.activity?.agents || {};
  const { agents, loading, refresh } = useAgents();
  const [openKeys, setOpenKeys] = useState([]); // chats abertos simultâneos
  const [editing, setEditing] = useState(null); // agent | {} (novo)

  const toggleChat = (key) => setOpenKeys((ks) => (ks.includes(key) ? ks.filter((k) => k !== key) : [...ks, key]));
  const closeChat = (key) => setOpenKeys((ks) => ks.filter((k) => k !== key));

  async function remove(a, e) {
    e.stopPropagation();
    if (!confirm(`Excluir o agente ${a.key}? (as conversas dele continuam salvas)`)) return;
    const { api } = await import('../lib/api.js');
    await api.agents.remove(a.key);
    closeChat(a.key);
    refresh();
  }

  const openAgents = openKeys.map((k) => agents.find((a) => a.key === k)).filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          <strong className="text-body">Clique pra abrir o chat</strong> — pode abrir <strong className="text-body">vários ao mesmo tempo</strong> (conversas paralelas, em tempo real). Passe o mouse pra editar.
        </p>
        <button onClick={() => setEditing(empty)} className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-3 py-2 text-xs font-semibold text-white">
          <Plus size={14} /> Novo agente
        </button>
      </div>

      {loading && <p className="py-8 text-center text-sm text-muted">Carregando agentes…</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const s = runtime[a.key] || {};
          const active = Boolean(s.queries);
          return (
            <div
              key={a.key}
              onClick={() => toggleChat(a.key)}
              className={`group relative cursor-pointer rounded-xl border bg-surface p-5 transition-colors hover:border-blue-500 ${
                openKeys.includes(a.key) ? 'border-blue-500 ring-1 ring-blue-500/40' : 'border-edge'
              }`}
            >
              <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button onClick={(e) => { e.stopPropagation(); setEditing(a); }} className="rounded bg-background/80 p-1.5 text-muted hover:text-blue-400"><Pencil size={13} /></button>
                <button onClick={(e) => remove(a, e)} className="rounded bg-background/80 p-1.5 text-muted hover:text-red-400"><Trash2 size={13} /></button>
              </div>

              <div className="mb-3 flex items-center gap-3">
                <Avatar agent={a} size={52} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{a.name}</p>
                  <p className="truncate text-xs text-muted">{a.model || '—'}</p>
                  <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-500'}`} />
                    {active ? 'Ativo' : 'Sem atividade'}
                  </span>
                </div>
              </div>
              <p className="text-sm font-medium text-body/90">{a.role || 'Sem função definida'}</p>
              {a.bio && <p className="mt-1 line-clamp-2 text-xs text-muted">{a.bio}</p>}
              <div className="mt-3 flex items-center gap-1.5 border-t border-edge pt-3 text-xs text-muted">
                <MessageSquare size={12} /> {s.queries || 0} consultas
              </div>
            </div>
          );
        })}

        {/* card "novo" */}
        <button onClick={() => setEditing(empty)} className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge text-muted transition-colors hover:border-blue-500 hover:text-blue-400">
          <Bot size={22} />
          <span className="text-sm font-medium">Criar novo agente</span>
        </button>
      </div>

      {openAgents.length > 0 && (
        <div className={`grid grid-cols-1 gap-4 ${openAgents.length > 1 ? 'xl:grid-cols-2' : ''}`}>
          {openAgents.map((a) => (
            <div key={a.key} className="flex h-[520px] flex-col overflow-hidden rounded-xl border border-edge bg-surface">
              <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
                <Avatar agent={a} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{a.name}</p>
                  <p className="truncate text-[11px] text-muted">{a.role} · {a.model}</p>
                </div>
                <button onClick={() => closeChat(a.key)} className="rounded p-1 text-muted hover:bg-white/10 hover:text-body"><X size={16} /></button>
              </div>
              <AgentChat agent={a} className="min-h-0 flex-1" />
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Editor initial={editing.key ? editing : null} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />
      )}
    </div>
  );
}
