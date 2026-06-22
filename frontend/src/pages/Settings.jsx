import { useEffect, useState } from 'react';
import { Database, Cloud, Cpu, Braces, Plug, MessagesSquare, GitBranch, Smartphone, Newspaper, ShieldCheck } from 'lucide-react';
import { api, API_BASE } from '../lib/api.js';
import { useAgents } from '../lib/AgentsContext.jsx';

// Ações extras do WhatsApp (status, QR, teste, setup do webhook)
function WhatsAppExtras() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [qr, setQr] = useState(null);
  const [testNum, setTestNum] = useState('');

  const run = async (kind, fn) => {
    setBusy(kind); setMsg(null);
    try { return await fn(); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(''); }
  };

  // webhook PRECISA apontar pro backend (não pro frontend). Em prod o
  // VITE_API_URL é absoluto (ex: https://rag.creativenext.dev); em dev cai
  // no localhost:3000.
  const backendBase = API_BASE.startsWith('http') ? API_BASE : window.location.origin.replace(/:\d+$/, ':3000');
  const webhookUrl = `${backendBase}/whatsapp/webhook`;

  return (
    <div className="space-y-3 border-t border-edge pt-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => run('status', async () => { setStatus(await api.whatsapp.status()); })}
          className="rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-emerald-500 hover:text-emerald-400">
          {busy === 'status' ? '…' : 'Ver status'}
        </button>
        <button type="button" onClick={() => run('qr', async () => { const r = await api.whatsapp.qr(); setQr(r.qr); if (r.code) setMsg({ ok: true, text: `Código de pareamento: ${r.code}` }); })}
          className="rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-emerald-500 hover:text-emerald-400">
          {busy === 'qr' ? '…' : 'Conectar (QR)'}
        </button>
        <button type="button" onClick={() => run('setup', async () => { await api.whatsapp.setup(webhookUrl); setMsg({ ok: true, text: 'Webhook registrado na evolution ✓' }); })}
          className="rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-emerald-500 hover:text-emerald-400">
          {busy === 'setup' ? '…' : 'Registrar webhook'}
        </button>
      </div>

      {status && (
        <div className="rounded-lg bg-background px-3 py-2 text-[11px] text-muted">
          conexão: <span className={status.connection === 'open' ? 'text-emerald-400' : 'text-amber-400'}>{status.connection || status.error || '—'}</span>
          {' · '}instância: {status.instance || '—'}{' · '}agente: {status.agent}{' · '}{status.enabled ? 'ativo' : 'desativado'}
        </div>
      )}
      {qr && <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR" className="h-40 w-40 rounded-lg border border-edge bg-white p-1" />}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-muted">Enviar teste para (número com DDI, ex: 5511999999999)</label>
          <input value={testNum} onChange={(e) => setTestNum(e.target.value)} placeholder="55..." className="inp" />
        </div>
        <button type="button" disabled={!testNum} onClick={() => run('test', async () => { await api.whatsapp.test(testNum); setMsg({ ok: true, text: 'Mensagem de teste enviada ✓' }); })}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
          {busy === 'test' ? '…' : 'Enviar'}
        </button>
      </div>

      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>}

      <p className="rounded-lg bg-background px-3 py-2 text-[10px] text-muted">
        Passo a passo: instale a evolution-api → crie uma instância → preencha URL/key/instância acima e Salve →
        clique <strong>Conectar (QR)</strong> e leia no WhatsApp → <strong>Registrar webhook</strong> →
        ative o toggle. Webhook deste backend: <code className="text-violet-400">{webhookUrl}</code>
      </p>
    </div>
  );
}

function TestButton({ service }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testConnection(service));
    } catch (err) {
      setResult({ ok: false, detail: err.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span className={`max-w-56 truncate text-xs ${result.ok ? 'text-emerald-400' : 'text-red-400'}`} title={result.detail}>
          {result.ok ? '✓' : '✗'} {result.detail}
        </span>
      )}
      <button
        type="button"
        onClick={handleTest}
        disabled={testing}
        className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-body/80 hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-50"
      >
        <Plug size={12} />
        {testing ? 'Testando…' : 'Testar Conexão'}
      </button>
    </div>
  );
}

function Section({ icon: Icon, title, service, children, onSave, saved }) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave?.(); }}
      className="rounded-xl border border-edge bg-surface p-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400">
            <Icon size={15} />
          </span>
          {title}
        </h3>
        {service && <TestButton service={service} />}
      </div>

      <div className="space-y-4">{children}</div>

      {onSave && (
        <div className="mt-5 flex items-center gap-3 border-t border-edge pt-4">
          <button
            type="submit"
            className="rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-xs font-semibold text-white hover:from-blue-500 hover:to-violet-500"
          >
            Salvar
          </button>
          {saved && <span className="text-xs text-emerald-400">Salvo ✓</span>}
        </div>
      )}
    </form>
  );
}

function Input({ label, hint, ...props }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted">{label}</label>
      <input
        className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm placeholder-muted/50 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        {...props}
      />
      {hint && <p className="mt-1 text-[10px] text-muted">{hint}</p>}
    </div>
  );
}

export default function Settings() {
  const { agents } = useAgents();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [savedSection, setSavedSection] = useState(null);

  useEffect(() => {
    api.config().then(setForm).catch((err) => setError(err.message));
  }, []);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setSavedSection(null);
  }

  async function save(section, keys) {
    setError(null);
    try {
      const patch = {};
      for (const k of keys) patch[k] = form[k];
      const updated = await api.updateConfig(patch);
      setForm(updated);
      setSavedSection(section);
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !form) {
    return <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>;
  }
  if (!form) return <p className="py-10 text-center text-sm text-muted">Carregando configurações…</p>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section
          icon={ShieldCheck}
          title="Segurança & Login (2 fatores)"
          saved={savedSection === 'auth'}
          onSave={() => save('auth', ['AUTH_ENABLED', 'AUTH_ALLOWED_EMAILS', 'AUTH_2FA_NUMBER', 'AUTH_SESSION_TTL_HOURS', 'RESEND_API_KEY', 'RESEND_FROM'])}
        >
          <div className="flex items-center justify-between rounded-lg bg-background px-3 py-2">
            <span className="text-sm">Exigir login para acessar o painel</span>
            <button
              type="button"
              onClick={() => set('AUTH_ENABLED', !form.AUTH_ENABLED)}
              className={`relative h-6 w-11 rounded-full transition-colors ${form.AUTH_ENABLED ? 'bg-emerald-600' : 'bg-slate-600'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${form.AUTH_ENABLED ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          <p className="rounded-lg bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">
            ⚠️ Antes de ligar: preencha a <strong>API Key do Resend</strong>, o <strong>e-mail permitido</strong> e o
            <strong> número do 2º fator</strong>, e confirme que o WhatsApp (seção abaixo) está conectado — senão você
            pode se trancar para fora. O Cofre exige este login ligado.
          </p>
          <Input
            label="E-mails permitidos (separados por vírgula)"
            value={form.AUTH_ALLOWED_EMAILS || ''}
            onChange={(e) => set('AUTH_ALLOWED_EMAILS', e.target.value)}
            placeholder="voce@gmail.com"
            hint="Só estes e-mails conseguem fazer login."
          />
          <Input
            label="WhatsApp do 2º fator (com DDI, ex: 5511999999999)"
            value={form.AUTH_2FA_NUMBER || ''}
            onChange={(e) => set('AUTH_2FA_NUMBER', e.target.value)}
            placeholder="55..."
            hint="Número que recebe o código da 2ª etapa, via evolution-api."
          />
          <Input
            label="API Key do Resend"
            value={form.RESEND_API_KEY || ''}
            onChange={(e) => set('RESEND_API_KEY', e.target.value)}
            placeholder="re_…"
            autoComplete="off"
            hint="Crie em resend.com/api-keys. Deixe a versão mascarada (••••) para manter."
          />
          <Input
            label="Remetente do e-mail (from)"
            value={form.RESEND_FROM || ''}
            onChange={(e) => set('RESEND_FROM', e.target.value)}
            placeholder="CERBERUS <login@seu-dominio.com>"
            hint="Use um domínio verificado no Resend. Para teste, onboarding@resend.dev (só envia ao seu próprio e-mail de cadastro)."
          />
          <Input
            label="Duração da sessão (horas)"
            type="number"
            value={form.AUTH_SESSION_TTL_HOURS ?? 12}
            onChange={(e) => set('AUTH_SESSION_TTL_HOURS', e.target.value)}
          />
        </Section>

        <Section icon={Database} title="Banco de Dados" service="db">
          <p className="text-xs text-muted">
            A conexão é definida pela <code className="font-mono text-[11px] text-violet-400">DATABASE_URL</code> no{' '}
            <code className="font-mono text-[11px]">.env</code> do backend (LXC 100) e exige restart para mudar.
            Use o botão acima para validar a conexão e a extensão pgvector.
          </p>
        </Section>

        <Section
          icon={Cpu}
          title="Ollama (LXC 101)"
          service="ollama"
          saved={savedSection === 'ollama'}
          onSave={() => save('ollama', ['OLLAMA_URL', 'OLLAMA_MODEL', 'OLLAMA_CHAT_MODEL'])}
        >
          <Input
            label="URL"
            value={form.OLLAMA_URL}
            onChange={(e) => set('OLLAMA_URL', e.target.value)}
            placeholder="http://ip-do-lxc101:11434"
          />
          <Input
            label="Modelo de embedding"
            value={form.OLLAMA_MODEL}
            onChange={(e) => set('OLLAMA_MODEL', e.target.value)}
          />
          <Input
            label="Modelo de chat (Escritório)"
            value={form.OLLAMA_CHAT_MODEL || ''}
            onChange={(e) => set('OLLAMA_CHAT_MODEL', e.target.value)}
            placeholder="llama3.2:3b"
            hint="Modelo que gera as respostas no chat dos agentes. Precisa estar puxado (ollama pull <modelo>)."
          />
        </Section>

        <Section
          icon={MessagesSquare}
          title="Chat dos Agentes (Escritório)"
          saved={savedSection === 'chat'}
          onSave={() => save('chat', ['CHAT_PROVIDER', 'CHAT_API_BASE', 'CHAT_API_KEY', 'CHAT_MODEL'])}
        >
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Provedor</label>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-background p-1">
              {[
                { v: 'openai', l: 'API (Groq, etc.)' },
                { v: 'ollama', l: 'Ollama local' }
              ].map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => set('CHAT_PROVIDER', p.v)}
                  className={`rounded-md py-2 text-xs font-semibold transition-colors ${
                    form.CHAT_PROVIDER === p.v
                      ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white'
                      : 'text-muted hover:text-body'
                  }`}
                >
                  {p.l}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-muted">
              Use <strong>API</strong> em dev e troque para <strong>Ollama local</strong> em produção.
            </p>
          </div>

          {form.CHAT_PROVIDER === 'ollama' ? (
            <p className="rounded-lg bg-background px-3 py-2 text-[11px] text-muted">
              Usa a URL do Ollama e o <strong>Modelo de chat</strong> definidos na seção “Ollama” acima.
            </p>
          ) : (
            <>
              <Input
                label="Base URL (OpenAI-compatible)"
                value={form.CHAT_API_BASE || ''}
                onChange={(e) => set('CHAT_API_BASE', e.target.value)}
                placeholder="https://api.groq.com/openai/v1"
                hint="Groq: https://api.groq.com/openai/v1 · OpenAI: https://api.openai.com/v1 · Ollama: http://host:11434/v1"
              />
              <Input
                label="API Key"
                value={form.CHAT_API_KEY || ''}
                onChange={(e) => set('CHAT_API_KEY', e.target.value)}
                placeholder="gsk_… (Groq)"
                autoComplete="off"
                hint="Deixe a versão mascarada (••••) para manter a key atual."
              />
              <Input
                label="Modelo"
                value={form.CHAT_MODEL || ''}
                onChange={(e) => set('CHAT_MODEL', e.target.value)}
                placeholder="llama-3.3-70b-versatile"
              />
            </>
          )}
        </Section>

        <Section
          icon={Cloud}
          title="OpenAI (fallback)"
          service="openai"
          saved={savedSection === 'openai'}
          onSave={() => save('openai', ['OPENAI_API_KEY', 'OPENAI_EMBED_MODEL'])}
        >
          <Input
            label="API Key"
            value={form.OPENAI_API_KEY}
            onChange={(e) => set('OPENAI_API_KEY', e.target.value)}
            placeholder="sk-…"
            autoComplete="off"
            hint="Deixe a versão mascarada (••••) para manter a key atual."
          />
          <Input
            label="Modelo de embedding"
            value={form.OPENAI_EMBED_MODEL}
            onChange={(e) => set('OPENAI_EMBED_MODEL', e.target.value)}
          />
        </Section>

        <Section
          icon={GitBranch}
          title="GitHub"
          saved={savedSection === 'github'}
          onSave={() => save('github', ['GITHUB_TOKEN'])}
        >
          <Input
            label="Personal Access Token (PAT)"
            value={form.GITHUB_TOKEN || ''}
            onChange={(e) => set('GITHUB_TOKEN', e.target.value)}
            placeholder="github_pat_… ou ghp_…"
            autoComplete="off"
            hint="Crie em github.com/settings/tokens. Deixe a versão mascarada (••••) para manter o token atual."
          />
          <p className="rounded-lg bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">
            ⚠️ Acesso total: os agentes podem commitar direto nos repos deste token. Use um token de escopo limitado.
          </p>
        </Section>

        <Section
          icon={Newspaper}
          title="Perplexity (novidades / pesquisa web)"
          saved={savedSection === 'perplexity'}
          onSave={() => save('perplexity', ['PERPLEXITY_API_KEY', 'PERPLEXITY_MODEL'])}
        >
          <Input
            label="API Key"
            value={form.PERPLEXITY_API_KEY || ''}
            onChange={(e) => set('PERPLEXITY_API_KEY', e.target.value)}
            placeholder="pplx-…"
            autoComplete="off"
            hint="Crie em perplexity.ai/settings/api. Habilita o quadro de Novidades e a ferramenta de pesquisa web dos agentes."
          />
          <Input
            label="Modelo"
            value={form.PERPLEXITY_MODEL || ''}
            onChange={(e) => set('PERPLEXITY_MODEL', e.target.value)}
            placeholder="sonar"
            hint="sonar (rápido) ou sonar-pro (mais completo)."
          />
        </Section>

        <Section
          icon={Smartphone}
          title="WhatsApp (evolution-api)"
          saved={savedSection === 'whatsapp'}
          onSave={() => save('whatsapp', ['WHATSAPP_ENABLED', 'WHATSAPP_API_URL', 'WHATSAPP_API_KEY', 'WHATSAPP_INSTANCE', 'WHATSAPP_AGENT', 'WHATSAPP_NOTIFY_NUMBER', 'NOTIFY_ERRORS', 'NOTIFY_INGEST', 'NOTIFY_DAILY', 'NOTIFY_NEWS'])}
        >
          <div className="flex items-center justify-between rounded-lg bg-background px-3 py-2">
            <span className="text-sm">Ativar atendimento por WhatsApp</span>
            <button
              type="button"
              onClick={() => set('WHATSAPP_ENABLED', !form.WHATSAPP_ENABLED)}
              className={`relative h-6 w-11 rounded-full transition-colors ${form.WHATSAPP_ENABLED ? 'bg-emerald-600' : 'bg-slate-600'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${form.WHATSAPP_ENABLED ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          <Input label="URL da evolution-api" value={form.WHATSAPP_API_URL || ''} onChange={(e) => set('WHATSAPP_API_URL', e.target.value)} placeholder="http://ip-do-homelab:8080" />
          <Input label="API Key (apikey)" value={form.WHATSAPP_API_KEY || ''} onChange={(e) => set('WHATSAPP_API_KEY', e.target.value)} placeholder="sua AUTHENTICATION_API_KEY" autoComplete="off" hint="Deixe a versão mascarada (••••) para manter." />
          <Input label="Nome da instância" value={form.WHATSAPP_INSTANCE || ''} onChange={(e) => set('WHATSAPP_INSTANCE', e.target.value)} placeholder="ex: cerberus" />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Agente que atende no WhatsApp</label>
            <select value={form.WHATSAPP_AGENT || ''} onChange={(e) => set('WHATSAPP_AGENT', e.target.value)}
              className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
              {agents.map((a) => <option key={a.key} value={a.key}>{a.name} — {a.role}</option>)}
            </select>
          </div>
          {/* notificações do sistema */}
          <div className="space-y-2 border-t border-edge pt-4">
            <p className="text-xs font-semibold text-body/90">🔔 Notificações do sistema</p>
            <Input
              label="Número que RECEBE as notificações (com DDI, ex: 5511999999999)"
              value={form.WHATSAPP_NOTIFY_NUMBER || ''}
              onChange={(e) => set('WHATSAPP_NOTIFY_NUMBER', e.target.value)}
              placeholder="55..."
              hint="Seu número pessoal — onde chegam os alertas (diferente da linha dos agentes)."
            />
            {[
              ['NOTIFY_ERRORS', 'Erros do sistema'],
              ['NOTIFY_INGEST', 'Ingestões concluídas'],
              ['NOTIFY_DAILY', 'Resumo diário do cérebro (~9h)'],
              ['NOTIFY_NEWS', 'Novidades de IA (RSS)']
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between rounded-lg bg-background px-3 py-2">
                <span className="text-sm">{label}</span>
                <button
                  type="button"
                  onClick={() => set(key, !form[key])}
                  className={`relative h-6 w-11 rounded-full transition-colors ${form[key] ? 'bg-emerald-600' : 'bg-slate-600'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${form[key] ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            ))}
          </div>

          <WhatsAppExtras />
        </Section>

        <Section
          icon={Braces}
          title="Embedding & Chunking"
          saved={savedSection === 'embedding'}
          onSave={() => save('embedding', ['EMBEDDING_MODE', 'EMBEDDING_DIMS', 'CHUNK_SIZE', 'CHUNK_OVERLAP', 'CHUNK_UNIT'])}
        >
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Modo</label>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-background p-1">
              {['auto', 'ollama', 'openai'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set('EMBEDDING_MODE', m)}
                  className={`rounded-md py-2 text-xs font-semibold uppercase transition-colors ${
                    form.EMBEDDING_MODE === m
                      ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white'
                      : 'text-muted hover:text-body'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-muted">auto = Ollama primeiro, OpenAI como fallback</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Dimensão do vetor"
              type="number"
              value={form.EMBEDDING_DIMS}
              onChange={(e) => set('EMBEDDING_DIMS', e.target.value)}
              hint="Precisa bater com a coluna vector() do banco."
            />
            <Input
              label={`Chunk size (${form.CHUNK_UNIT})`}
              type="number"
              value={form.CHUNK_SIZE}
              onChange={(e) => set('CHUNK_SIZE', e.target.value)}
            />
            <Input
              label={`Overlap (${form.CHUNK_UNIT})`}
              type="number"
              value={form.CHUNK_OVERLAP}
              onChange={(e) => set('CHUNK_OVERLAP', e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Unidade de chunking</label>
            <select
              value={form.CHUNK_UNIT}
              onChange={(e) => set('CHUNK_UNIT', e.target.value)}
              className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="tokens">tokens (~4 chars)</option>
              <option value="chars">caracteres</option>
            </select>
          </div>
        </Section>
      </div>

      <p className="text-[11px] text-muted">
        Configurações salvas aqui são persistidas em <code className="font-mono">runtime-settings.json</code> no
        backend e têm precedência sobre o .env — sobrevivem a restart.
      </p>
    </div>
  );
}
