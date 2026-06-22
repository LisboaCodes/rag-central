import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Vault, Lock, Unlock, Plus, Eye, EyeOff, Copy, Pencil, Trash2, Mail, CreditCard,
  CalendarClock, Loader2, ShieldCheck, X, ExternalLink, Bot
} from 'lucide-react';
import { api } from '../lib/api.js';

const CYCLES = [
  { value: 'monthly', label: 'Mensal' },
  { value: 'yearly', label: 'Anual' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'once', label: 'Único' }
];

export default function Cofre() {
  const [status, setStatus] = useState(null);   // {initialized, unlocked}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshStatus = useCallback(async () => {
    try { setStatus(await api.vault.status()); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  if (loading) return <Centered><Loader2 className="animate-spin text-muted" /></Centered>;
  if (error && !status) return <Centered><p className="text-sm text-red-400">{error}</p></Centered>;

  if (!status?.initialized) return <SetupOrUnlock mode="setup" onDone={refreshStatus} />;
  if (!status?.unlocked) return <SetupOrUnlock mode="unlock" onDone={refreshStatus} />;
  return <VaultContent status={status} onLock={refreshStatus} onStatusChange={refreshStatus} />;
}

function Centered({ children }) {
  return <div className="flex min-h-[60vh] items-center justify-center">{children}</div>;
}

// --- setup (1ª senha-mestra) ou unlock -------------------------------------
function SetupOrUnlock({ mode, onDone }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (mode === 'setup' && pw !== pw2) { setError('As senhas não conferem'); return; }
    setLoading(true); setError('');
    try {
      if (mode === 'setup') await api.vault.setup(pw);
      else await api.vault.unlock(pw);
      onDone();
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-2xl border border-edge bg-surface/60 p-7">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-rose-600">
            {mode === 'setup' ? <ShieldCheck size={20} className="text-white" /> : <Lock size={20} className="text-white" />}
          </div>
          <div>
            <p className="text-sm font-bold">{mode === 'setup' ? 'Criar senha-mestra' : 'Cofre bloqueado'}</p>
            <p className="text-[11px] text-muted">
              {mode === 'setup' ? 'Ela cifra todo o cofre. Não dá pra recuperar se perder.' : 'Informe a senha-mestra para abrir.'}
            </p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="password" required autoFocus value={pw} onChange={(e) => setPw(e.target.value)}
            placeholder={mode === 'setup' ? 'Nova senha-mestra (mín. 8)' : 'Senha-mestra'}
            className="w-full rounded-lg border border-edge bg-[#0d0f18] px-3 py-2.5 text-sm outline-none focus:border-amber-500"
          />
          {mode === 'setup' && (
            <input
              type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)}
              placeholder="Confirmar senha-mestra"
              className="w-full rounded-lg border border-edge bg-[#0d0f18] px-3 py-2.5 text-sm outline-none focus:border-amber-500"
            />
          )}
          <button type="submit" disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-rose-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Unlock size={16} />}
            {mode === 'setup' ? 'Criar e abrir cofre' : 'Abrir cofre'}
          </button>
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
        </form>
      </div>
    </div>
  );
}

// --- conteúdo do cofre aberto ----------------------------------------------
function VaultContent({ status, onLock, onStatusChange }) {
  const [accounts, setAccounts] = useState([]);
  const [services, setServices] = useState([]);
  const [error, setError] = useState('');
  const [editAccount, setEditAccount] = useState(null);   // {} novo, {id...} edição, null fechado
  const [editService, setEditService] = useState(null);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([api.vault.accounts(true), api.vault.services(true)]);
      setAccounts(a.accounts || []);
      setServices(s.services || []);
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function lock() { try { await api.vault.lock(); } finally { onLock(); } }

  const totalMonthly = useMemo(() => services.reduce((sum, s) => sum + monthlyCost(s), 0), [services]);
  const expiringSoon = useMemo(() => services.filter((s) => daysUntil(s.expires_on) !== null && daysUntil(s.expires_on) <= 30), [services]);

  return (
    <div className="space-y-6">
      {/* topo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Vault size={18} className="text-amber-400" />
          <span>Cofre aberto · {accounts.length} contas · {services.length} serviços</span>
        </div>
        <button onClick={lock} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:bg-white/5">
          <Lock size={14} /> Bloquear cofre
        </button>
      </div>

      {/* resumo */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard icon={CreditCard} label="Gasto mensal estimado" value={fmtMoney(totalMonthly)} tone="blue" />
        <SummaryCard icon={CalendarClock} label="Vencendo em 30 dias" value={String(expiringSoon.length)} tone={expiringSoon.length ? 'amber' : 'muted'} />
        <SummaryCard icon={Mail} label="Contas de e-mail" value={String(accounts.length)} tone="violet" />
      </div>

      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}

      <AgentAccessPanel status={status} onChange={onStatusChange} />

      {/* contas de e-mail */}
      <Section title="Contas de e-mail" icon={Mail} onAdd={() => setEditAccount({})}>
        {accounts.length === 0
          ? <Empty>Nenhuma conta ainda. Adicione seu primeiro e-mail.</Empty>
          : <div className="grid gap-3 md:grid-cols-2">
              {accounts.map((a) => (
                <AccountCard key={a.id} a={a} services={services}
                  onEdit={() => setEditAccount(a)}
                  onDelete={() => removeAccount(a.id, load, setError)} />
              ))}
            </div>}
      </Section>

      {/* serviços */}
      <Section title="Serviços" icon={CreditCard} onAdd={() => setEditService({})}>
        {services.length === 0
          ? <Empty>Nenhum serviço cadastrado.</Empty>
          : <div className="grid gap-3 md:grid-cols-2">
              {services.map((s) => (
                <ServiceCard key={s.id} s={s} account={accounts.find((a) => a.id === s.account_id)}
                  onEdit={() => setEditService(s)}
                  onDelete={() => removeService(s.id, load, setError)} />
              ))}
            </div>}
      </Section>

      {editAccount && (
        <AccountModal entry={editAccount} onClose={() => setEditAccount(null)} onSaved={() => { setEditAccount(null); load(); }} />
      )}
      {editService && (
        <ServiceModal entry={editService} accounts={accounts} onClose={() => setEditService(null)} onSaved={() => { setEditService(null); load(); }} />
      )}
    </div>
  );
}

// painel: liberar a IA (secretária) a operar o cofre sozinha
function AgentAccessPanel({ status, onChange }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const enabled = status?.agentAccessEnabled;
  const secretOk = status?.agentSecretConfigured;

  async function enable(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try { await api.vault.agentAccess(pw, true); setPw(''); setOpen(false); onChange(); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  async function disable() {
    if (!confirm('Revogar o acesso da IA ao cofre?')) return;
    setLoading(true); setError('');
    try { await api.vault.agentAccess('', false); onChange(); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  return (
    <div className="rounded-xl border border-edge bg-surface/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-violet-400" />
          <div>
            <p className="text-sm font-semibold">Acesso da IA (secretária)</p>
            <p className="text-[11px] text-muted">
              {enabled ? 'A DARLENE pode anotar e consultar o cofre no chat.' : 'Libere para a DARLENE guardar/consultar dados no cofre.'}
            </p>
          </div>
        </div>
        {enabled
          ? <button onClick={disable} disabled={loading} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-muted hover:text-red-400">Revogar acesso</button>
          : <button onClick={() => setOpen((v) => !v)} disabled={!secretOk} className="rounded-lg bg-violet-500/15 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-500/25 disabled:opacity-40">Liberar acesso</button>}
      </div>

      {!secretOk && !enabled && (
        <p className="mt-2 rounded-lg bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">
          Configure o <code>VAULT_AGENT_SECRET</code> em Configurações → Segurança antes de liberar (cifra a chave guardada).
        </p>
      )}

      {open && !enabled && (
        <form onSubmit={enable} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-[11px] text-muted">Confirme a senha-mestra para autorizar</label>
            <input type="password" required autoFocus value={pw} onChange={(e) => setPw(e.target.value)}
              className="w-full rounded-lg border border-edge bg-[#0d0f18] px-3 py-2 text-sm outline-none focus:border-violet-500" />
          </div>
          <button type="submit" disabled={loading} className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {loading && <Loader2 size={15} className="animate-spin" />} Autorizar
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

async function removeAccount(id, load, setError) {
  if (!confirm('Excluir esta conta de e-mail?')) return;
  try { await api.vault.removeAccount(id); load(); } catch (err) { setError(err.message); }
}
async function removeService(id, load, setError) {
  if (!confirm('Excluir este serviço?')) return;
  try { await api.vault.removeService(id); load(); } catch (err) { setError(err.message); }
}

// --- cartões ---------------------------------------------------------------
function AccountCard({ a, services, onEdit, onDelete }) {
  const used = services.filter((s) => s.account_id === a.id).length;
  return (
    <div className="rounded-xl border border-edge bg-surface/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{a.label || a.email}</p>
          <p className="truncate text-xs text-muted">{a.email}{a.provider ? ` · ${a.provider}` : ''}</p>
        </div>
        <CardActions onEdit={onEdit} onDelete={onDelete} />
      </div>
      <div className="mt-3 space-y-2">
        <SecretRow label="Senha" value={a.password} has={a.hasPassword} />
        {a.notes && <p className="text-xs text-muted">{a.notes}</p>}
        <p className="text-[11px] text-muted/70">{used} serviço(s) usam este e-mail</p>
      </div>
    </div>
  );
}

function ServiceCard({ s, account, onEdit, onDelete }) {
  const d = daysUntil(s.expires_on);
  const expTone = d === null ? 'muted' : d < 0 ? 'red' : d <= 30 ? 'amber' : 'muted';
  return (
    <div className="rounded-xl border border-edge bg-surface/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
            {s.name}
            {s.url && <a href={withHttp(s.url)} target="_blank" rel="noreferrer" className="text-muted hover:text-blue-400"><ExternalLink size={12} /></a>}
          </p>
          <p className="truncate text-xs text-muted">
            {s.category ? `${s.category} · ` : ''}{account ? account.email : 'sem e-mail vinculado'}
          </p>
        </div>
        <CardActions onEdit={onEdit} onDelete={onDelete} />
      </div>
      <div className="mt-3 space-y-2">
        {s.login && <InfoRow label="Login" value={s.login} copyable />}
        <SecretRow label="Senha" value={s.password} has={s.hasPassword} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {s.cost != null && <span><span className="text-muted">Valor:</span> {fmtMoney(s.cost, s.currency)}{cycleLabel(s.billing_cycle) ? `/${cycleLabel(s.billing_cycle)}` : ''}</span>}
          {s.started_on && <span><span className="text-muted">Desde:</span> {fmtDate(s.started_on)}</span>}
        </div>
        {s.expires_on && (
          <p className={`text-xs ${toneText(expTone)}`}>
            <CalendarClock size={12} className="mr-1 inline" />
            {d < 0 ? `Venceu em ${fmtDate(s.expires_on)}` : `Vence ${fmtDate(s.expires_on)}${d <= 30 ? ` (${d}d)` : ''}`}
          </p>
        )}
        {s.notes && <p className="text-xs text-muted">{s.notes}</p>}
      </div>
    </div>
  );
}

function CardActions({ onEdit, onDelete }) {
  return (
    <div className="flex shrink-0 gap-1">
      <button onClick={onEdit} className="rounded p-1 text-muted hover:bg-white/5 hover:text-body"><Pencil size={14} /></button>
      <button onClick={onDelete} className="rounded p-1 text-muted hover:bg-white/5 hover:text-red-400"><Trash2 size={14} /></button>
    </div>
  );
}

function SecretRow({ label, value, has }) {
  const [show, setShow] = useState(false);
  if (!has) return <InfoRow label={label} value={<span className="text-muted/60">—</span>} />;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <code className="font-mono">{show ? (value || '') : '••••••••'}</code>
        <button onClick={() => setShow((v) => !v)} className="text-muted hover:text-body">{show ? <EyeOff size={13} /> : <Eye size={13} />}</button>
        <button onClick={() => copy(value)} className="text-muted hover:text-body"><Copy size={13} /></button>
      </span>
    </div>
  );
}

function InfoRow({ label, value, copyable }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className="truncate font-mono">{value}</span>
        {copyable && <button onClick={() => copy(value)} className="text-muted hover:text-body"><Copy size={13} /></button>}
      </span>
    </div>
  );
}

// --- modais ----------------------------------------------------------------
function AccountModal({ entry, onClose, onSaved }) {
  const editing = Boolean(entry.id);
  const [form, setForm] = useState({
    label: entry.label || '', email: entry.email || '', provider: entry.provider || '',
    password: entry.password || '', notes: entry.notes || ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      if (editing) await api.vault.updateAccount(entry.id, form);
      else await api.vault.addAccount(form);
      onSaved();
    } catch (err) { setError(err.message); setLoading(false); }
  }

  return (
    <Modal title={editing ? 'Editar conta de e-mail' : 'Nova conta de e-mail'} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Apelido"><input value={form.label} onChange={set('label')} placeholder="Gmail pessoal" className={inputCls} /></Field>
        <Field label="E-mail *"><input type="email" required value={form.email} onChange={set('email')} placeholder="voce@gmail.com" className={inputCls} /></Field>
        <Field label="Provedor"><input value={form.provider} onChange={set('provider')} placeholder="Gmail, Outlook…" className={inputCls} /></Field>
        <Field label="Senha"><input value={form.password} onChange={set('password')} placeholder="••••••••" className={inputCls} /></Field>
        <Field label="Notas"><textarea value={form.notes} onChange={set('notes')} rows={2} className={inputCls} /></Field>
        <ModalActions loading={loading} error={error} onClose={onClose} />
      </form>
    </Modal>
  );
}

function ServiceModal({ entry, accounts, onClose, onSaved }) {
  const editing = Boolean(entry.id);
  const [form, setForm] = useState({
    name: entry.name || '', account_id: entry.account_id || '', login: entry.login || '', password: entry.password || '',
    url: entry.url || '', category: entry.category || '', cost: entry.cost ?? '', currency: entry.currency || 'BRL',
    billing_cycle: entry.billing_cycle || 'monthly', started_on: dateInput(entry.started_on), expires_on: dateInput(entry.expires_on),
    notes: entry.notes || ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const body = { ...form, account_id: form.account_id || null };
      if (editing) await api.vault.updateService(entry.id, body);
      else await api.vault.addService(body);
      onSaved();
    } catch (err) { setError(err.message); setLoading(false); }
  }

  return (
    <Modal title={editing ? 'Editar serviço' : 'Novo serviço'} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Nome *"><input required value={form.name} onChange={set('name')} placeholder="Netflix, AWS, ChatGPT…" className={inputCls} /></Field>
        <Field label="E-mail vinculado">
          <select value={form.account_id} onChange={set('account_id')} className={inputCls}>
            <option value="">— nenhum —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label || a.email}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Login"><input value={form.login} onChange={set('login')} className={inputCls} /></Field>
          <Field label="Senha"><input value={form.password} onChange={set('password')} placeholder="••••••••" className={inputCls} /></Field>
        </div>
        <Field label="URL"><input value={form.url} onChange={set('url')} placeholder="https://…" className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoria"><input value={form.category} onChange={set('category')} placeholder="Streaming, Cloud…" className={inputCls} /></Field>
          <Field label="Ciclo">
            <select value={form.billing_cycle} onChange={set('billing_cycle')} className={inputCls}>
              {CYCLES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor"><input type="number" step="0.01" value={form.cost} onChange={set('cost')} placeholder="0,00" className={inputCls} /></Field>
          <Field label="Moeda"><input value={form.currency} onChange={set('currency')} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Criação / início"><input type="date" value={form.started_on} onChange={set('started_on')} className={inputCls} /></Field>
          <Field label="Vencimento"><input type="date" value={form.expires_on} onChange={set('expires_on')} className={inputCls} /></Field>
        </div>
        <Field label="Notas"><textarea value={form.notes} onChange={set('notes')} rows={2} className={inputCls} /></Field>
        <ModalActions loading={loading} error={error} onClose={onClose} />
      </form>
    </Modal>
  );
}

// --- pequenos componentes / helpers ----------------------------------------
const inputCls = 'w-full rounded-lg border border-edge bg-[#0d0f18] px-3 py-2 text-sm outline-none focus:border-amber-500';

function Section({ title, icon: Icon, onAdd, children }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon size={16} className="text-amber-400" />{title}</h2>
        <button onClick={onAdd} className="flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/25">
          <Plus size={14} /> Adicionar
        </button>
      </div>
      {children}
    </section>
  );
}

function SummaryCard({ icon: Icon, label, value, tone }) {
  return (
    <div className="rounded-xl border border-edge bg-surface/60 p-4">
      <div className="flex items-center gap-2 text-xs text-muted"><Icon size={14} className={toneText(tone)} />{label}</div>
      <p className={`mt-1 text-xl font-bold ${toneText(tone)}`}>{value}</p>
    </div>
  );
}

function Empty({ children }) {
  return <p className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-muted">{children}</p>;
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div className="mt-10 w-full max-w-md rounded-2xl border border-edge bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-body"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-[11px] text-muted">{label}</span>{children}</label>;
}

function ModalActions({ loading, error, onClose }) {
  return (
    <>
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded-lg border border-edge px-4 py-2 text-sm text-muted hover:bg-white/5">Cancelar</button>
        <button type="submit" disabled={loading} className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {loading && <Loader2 size={15} className="animate-spin" />} Salvar
        </button>
      </div>
    </>
  );
}

function toneText(tone) {
  return {
    blue: 'text-blue-400', amber: 'text-amber-400', violet: 'text-violet-400',
    red: 'text-red-400', muted: 'text-muted'
  }[tone] || 'text-body';
}

async function copy(text) { try { await navigator.clipboard.writeText(text || ''); } catch { /* ignore */ } }
function withHttp(u) { return /^https?:\/\//i.test(u) ? u : `https://${u}`; }
function cycleLabel(c) { return ({ monthly: 'mês', yearly: 'ano', weekly: 'sem', once: '' })[c] ?? ''; }
function monthlyCost(s) {
  const v = Number(s.cost) || 0;
  return ({ monthly: v, yearly: v / 12, weekly: v * 4.345, once: 0 })[s.billing_cycle] ?? v;
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr); if (isNaN(d)) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr); if (isNaN(d)) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}
function dateInput(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr); if (isNaN(d)) return '';
  return d.toISOString().slice(0, 10);
}
function fmtMoney(v, currency = 'BRL') {
  const n = Number(v) || 0;
  try { return n.toLocaleString('pt-BR', { style: 'currency', currency }); }
  catch { return `${currency} ${n.toFixed(2)}`; }
}
