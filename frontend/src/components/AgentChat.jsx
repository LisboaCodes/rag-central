import { useEffect, useRef, useState } from 'react';
import { Send, FileText, Brain, Wrench, Paperclip, X } from 'lucide-react';
import { useAgents, hexOf } from '../lib/AgentsContext.jsx';
import { API_BASE } from '../lib/api.js';

const readDataUrl = (file) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.readAsDataURL(file);
});

// formatação estilo WhatsApp: *negrito* _itálico_ ~tachado~ `mono`
function fmt(text) {
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g;
  const out = [];
  let last = 0, m, k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0], inner = t.slice(1, -1);
    if (t[0] === '*') out.push(<strong key={k++}>{inner}</strong>);
    else if (t[0] === '_') out.push(<em key={k++}>{inner}</em>);
    else if (t[0] === '~') out.push(<span key={k++} className="line-through">{inner}</span>);
    else out.push(<code key={k++} className="rounded bg-black/20 px-1 text-[0.85em]">{inner}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Chat reutilizável com um agente (com memória + agente-a-agente via @menção).
// Gerencia conversationId e histórico internamente; reseta ao trocar de agente.
// props:
//   agent     — entrada do roster (primário da conversa)
//   onReply   — callback(agentNames[]) disparado quando chegam respostas
//   className — estilos do container
export default function AgentChat({ agent, onReply, className = '' }) {
  const { byKey } = useAgents();
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState([]); // {kind,name,type,dataUrl}
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef(null);
  const fileRef = useRef(null);

  // troca de agente → nova conversa
  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    setInput('');
    setAttachments([]);
  }, [agent.key]);

  async function addFiles(fileList) {
    const arr = Array.from(fileList || []).slice(0, 5);
    const items = [];
    for (const f of arr) {
      if (f.size > 8 * 1024 * 1024) continue; // 8MB máx por arquivo
      const dataUrl = await readDataUrl(f);
      items.push({ kind: f.type.startsWith('image/') ? 'image' : 'file', name: f.name || 'colado.png', type: f.type, dataUrl });
    }
    if (items.length) setAttachments((a) => [...a, ...items].slice(0, 6));
  }

  function onPaste(e) {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(files); }
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  // atualiza a última mensagem (a que está sendo "digitada" via streaming)
  const patchLast = (fn) => setMessages((m) => {
    if (!m.length) return m;
    const copy = [...m];
    copy[copy.length - 1] = fn(copy[copy.length - 1]);
    return copy;
  });

  async function send() {
    const text = input.trim();
    if ((!text && !attachments.length) || sending) return;
    const atts = attachments;
    const images = atts.filter((a) => a.kind === 'image').map((a) => a.dataUrl);
    const files = atts.filter((a) => a.kind === 'file').map((a) => ({ name: a.name, type: a.type, dataUrl: a.dataUrl }));
    setInput('');
    setAttachments([]);
    setMessages((m) => [...m, { role: 'user', content: text, attachments: atts }]);
    setSending(true);
    const cur = { agent: null, text: '' }; // texto acumulado do agente atual (p/ onReply)

    try {
      const resp = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.key, message: text, conversationId, images, files })
      });
      if (!resp.ok || !resp.body) throw new Error(`Falha ao iniciar streaming (HTTP ${resp.status})`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handle = (ev) => {
        switch (ev.type) {
          case 'meta':
            setConversationId(ev.conversationId);
            break;
          case 'agent_start':
            cur.agent = ev.agent; cur.text = '';
            setMessages((m) => [...m, { role: 'assistant', agent: ev.agent, content: '', streaming: true, toolsUsed: [] }]);
            break;
          case 'token':
            cur.text += ev.delta || '';
            patchLast((last) => ({ ...last, content: last.content + (ev.delta || '') }));
            break;
          case 'tool':
            patchLast((last) => ({ ...last, toolsUsed: [...(last.toolsUsed || []), ev.name] }));
            break;
          case 'agent_done':
            patchLast((last) => ({ ...last, streaming: false, sources: ev.sources, memories: ev.memories, toolsUsed: ev.toolsUsed }));
            onReply?.([{ agent: ev.agent, answer: cur.text }]);
            break;
          case 'error':
            setMessages((m) => [...m, { role: 'error', content: ev.message }]);
            break;
          default:
            break;
        }
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          try { handle(JSON.parse(line.slice(5).trim())); } catch { /* ignora linha parcial */ }
        }
      }
    } catch (err) {
      setMessages((m) => [...m, { role: 'error', content: err.message }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`flex flex-col ${className}`}>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="mt-6 text-center text-xs text-muted">
            <p>Converse com {agent.name} 👋</p>
            <p className="mt-1 text-[10px] text-muted/70">
              Dica: mencione outro agente com <code className="text-violet-400">@NOME</code> (ex: @JOANNA) para chamá-lo à conversa.
            </p>
          </div>
        )}
        {messages.map((m, i) => {
          const ag = m.agent ? byKey(m.agent) : null;
          return (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[85%]">
                {m.role === 'assistant' && (
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: hexOf(ag?.color) }} />
                    <span className="text-[10px] font-bold text-muted">{ag?.name || m.agent}</span>
                    {m.memories?.length > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] text-violet-400" title="Usou memória de conversas anteriores">
                        <Brain size={9} /> memória
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={`rounded-2xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : m.role === 'error'
                        ? 'bg-red-500/15 text-red-300'
                        : 'bg-surface text-body'
                  }`}
                >
                  {m.attachments?.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {m.attachments.map((a, k) => a.kind === 'image'
                        ? <img key={k} src={a.dataUrl} alt={a.name} className="h-20 w-20 rounded-lg object-cover ring-1 ring-white/20" />
                        : <span key={k} className="inline-flex items-center gap-1 rounded bg-black/25 px-2 py-1 text-[10px]"><FileText size={11} /> {a.name}</span>
                      )}
                    </div>
                  )}
                  {m.toolsUsed?.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {m.toolsUsed.map((t, k) => (
                        <span key={k} className="inline-flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                          <Wrench size={9} /> {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {(m.content || m.role !== 'user') && (
                  <p className="whitespace-pre-wrap break-words">
                    {fmt(m.content || '')}
                    {m.streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current align-middle" />}
                  </p>
                  )}
                  {m.sources?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 border-t border-edge/60 pt-2">
                      {m.sources.map((s, j) => (
                        <span key={j} className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted">
                          <FileText size={9} /> {s.source_path?.split(/[\\/]/).pop()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {sending && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-surface px-3 py-2 text-sm text-muted">{agent.name} está pensando…</div>
          </div>
        )}
      </div>

      <div className="border-t border-edge p-3">
        {/* preview dos anexos pendentes */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, k) => (
              <div key={k} className="relative">
                {a.kind === 'image'
                  ? <img src={a.dataUrl} alt={a.name} className="h-14 w-14 rounded-lg object-cover ring-1 ring-edge" />
                  : <span className="flex h-14 items-center gap-1 rounded-lg border border-edge bg-surface px-2 text-[10px] text-muted"><FileText size={12} /> {a.name.slice(0, 14)}</span>}
                <button onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== k))}
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className={`flex items-end gap-2 rounded-lg ${dragging ? 'ring-2 ring-blue-500' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        >
          <button
            onClick={() => fileRef.current?.click()}
            title="Anexar imagem ou arquivo"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge text-muted hover:border-blue-500 hover:text-blue-400"
          >
            <Paperclip size={15} />
          </button>
          <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.json,.js,.ts,.py,.csv,.yml,.yaml,.html,.css" className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder={`Mensagem para ${agent.name}…  (cole um print com Ctrl+V)`}
            className="max-h-24 flex-1 resize-none rounded-lg border border-edge bg-surface px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            onClick={send}
            disabled={sending || (!input.trim() && !attachments.length)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white disabled:opacity-40"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
