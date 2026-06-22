import { useCallback, useEffect, useState } from 'react';
import { Clock, Play, Trash2, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAgents } from '../lib/AgentsContext.jsx';
import { fmtDateTime, timeAgo } from '../lib/format.js';

const ACTIONS = {
  agent_prompt: 'Agente roda um prompt',
  rss_sync: 'Sincronizar RSS',
  brain_digest: 'Resumo do cérebro (WhatsApp)',
  consolidate: 'Consolidar memória'
};

// presets com 'daily'/'weekdays' usam o seletor de horário (HH:MM)
const PRESETS = [
  { label: 'Todo dia (escolha a hora)', cron: 'daily' },
  { label: 'Dias úteis (escolha a hora)', cron: 'weekdays' },
  { label: 'A cada hora', cron: '0 * * * *' },
  { label: 'A cada 6 horas', cron: '0 */6 * * *' },
  { label: 'Toda segunda às 9h', cron: '0 9 * * 1' },
  { label: 'Personalizado (cron)', cron: 'custom' }
];

const pad = (n) => String(n).padStart(2, '0');

// monta a expressão cron a partir do preset + horário escolhido
function computeSchedule(preset, time) {
  const [hh, mm] = (time || '09:00').split(':');
  if (preset === 'daily') return `${Number(mm)} ${Number(hh)} * * *`;
  if (preset === 'weekdays') return `${Number(mm)} ${Number(hh)} * * 1-5`;
  return preset;
}

// descreve uma expressão cron de forma amigável
function describeCron(expr) {
  let m = expr.match(/^(\d+) (\d+) \* \* \*$/);
  if (m) return `Todo dia às ${pad(m[2])}:${pad(m[1])}`;
  m = expr.match(/^(\d+) (\d+) \* \* 1-5$/);
  if (m) return `Dias úteis às ${pad(m[2])}:${pad(m[1])}`;
  return PRESETS.find((p) => p.cron === expr)?.label || expr;
}

// se a expressão for diária/dias-úteis, devolve {preset, time} pra reabrir no editor
function decodeSchedule(expr) {
  let m = expr.match(/^(\d+) (\d+) \* \* \*$/);
  if (m) return { preset: 'daily', time: `${pad(m[2])}:${pad(m[1])}` };
  m = expr.match(/^(\d+) (\d+) \* \* 1-5$/);
  if (m) return { preset: 'weekdays', time: `${pad(m[2])}:${pad(m[1])}` };
  if (PRESETS.some((p) => p.cron === expr)) return { preset: expr, time: '09:00' };
  return { preset: 'custom', time: '09:00' };
}

const EMPTY = { name: '', action: 'agent_prompt', schedule: '0 9 * * *', enabled: true, config: { agent: '', prompt: '', project: '', notify: true } };

export default function Agendamentos() {
  const { agents } = useAgents();
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null); // job em edição/criação
  const [presetSel, setPresetSel] = useState('daily');
  const [dailyTime, setDailyTime] = useState('09:00');
  const [serverClock, setServerClock] = useState(null); // { base: Date(server), at: ms local da resposta }

  const load = useCallback(async () => {
    try {
      const r = await api.cron.list();
      setJobs(r.jobs);
      if (r.server?.nowISO) setServerClock({ base: new Date(r.server.nowISO).getTime(), at: Date.now(), tz: r.server.tz });
      setError(null);
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // relógio do servidor ao vivo (extrapola do horário recebido + tempo decorrido)
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const serverTimeStr = serverClock
    ? new Date(serverClock.base + (nowMs - serverClock.at)).toLocaleString('pt-BR', { timeZone: serverClock.tz || 'America/Sao_Paulo' })
    : '—';

  function openNew() {
    setEditing({ ...EMPTY, config: { ...EMPTY.config } });
    setPresetSel('daily'); setDailyTime('09:00');
    setEditing((e) => ({ ...e, schedule: computeSchedule('daily', '09:00') }));
  }
  function openEdit(j) {
    setEditing({ id: j.id, name: j.name, action: j.action, schedule: j.schedule, enabled: j.enabled, config: { agent: '', prompt: '', project: '', notify: true, ...(j.config || {}) } });
    const d = decodeSchedule(j.schedule);
    setPresetSel(d.preset); setDailyTime(d.time);
  }

  // ao mudar preset ou horário, recalcula a expressão cron
  function pickPreset(value) {
    setPresetSel(value);
    if (value !== 'custom') setEditing((ed) => ({ ...ed, schedule: computeSchedule(value, dailyTime) }));
  }
  function pickTime(value) {
    setDailyTime(value);
    if (presetSel === 'daily' || presetSel === 'weekdays') {
      setEditing((ed) => ({ ...ed, schedule: computeSchedule(presetSel, value) }));
    }
  }

  async function save() {
    const e = editing;
    if (!e.name.trim()) return setError('Dê um nome à tarefa.');
    if (e.action === 'agent_prompt' && (!e.config.agent || !e.config.prompt.trim())) return setError('Escolha o agente e escreva o prompt.');
    setBusy('save'); setError(null); setNotice(null);
    const body = { name: e.name.trim(), action: e.action, schedule: e.schedule.trim(), enabled: e.enabled, config: e.config };
    try {
      if (e.id) await api.cron.update(e.id, body);
      else await api.cron.create(body);
      setNotice('Tarefa salva.');
      setEditing(null);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  async function toggle(j) {
    setBusy(j.id);
    try { await api.cron.update(j.id, { enabled: !j.enabled }); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  async function runNow(j) {
    setBusy(j.id); setNotice(null); setError(null);
    try {
      const r = await api.cron.run(j.id);
      setNotice(r.ok ? `"${j.name}" executada: ${r.result}` : `"${j.name}" falhou: ${r.error}`);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  async function remove(j) {
    if (!window.confirm(`Excluir a tarefa "${j.name}"?`)) return;
    setBusy(j.id);
    try { await api.cron.remove(j.id); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  function setCfg(patch) { setEditing((e) => ({ ...e, config: { ...e.config, ...patch } })); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted">
          Tarefas que rodam sozinhas no horário definido (horário de Brasília).
        </p>
        <span className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-2.5 py-1 text-[11px] text-muted" title="Horário atual do servidor (fuso usado pelo agendador)">
          <Clock size={12} className="text-blue-400" /> Servidor: <span className="font-mono text-body/80">{serverTimeStr}</span>
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={load} className="rounded-lg border border-edge bg-surface p-2 text-muted hover:text-body" title="Atualizar"><RefreshCw size={15} /></button>
          <button onClick={openNew} className="flex items-center gap-1.5 rounded-lg bg-blue-500/15 px-3 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/25">
            <Plus size={15} /> Nova tarefa
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">{notice}</div>}

      {/* formulário */}
      {editing && (
        <div className="space-y-3 rounded-xl border border-blue-500/30 bg-surface p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{editing.id ? 'Editar tarefa' : 'Nova tarefa'}</h3>
            <button onClick={() => setEditing(null)} className="text-muted hover:text-body"><X size={16} /></button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted">Nome</label>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="ex: Relatório diário de tráfego" className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">O que faz</label>
              <select value={editing.action} onChange={(e) => setEditing({ ...editing, action: e.target.value })}
                className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          {/* config específica do agente */}
          {editing.action === 'agent_prompt' && (
            <div className="space-y-3 rounded-lg border border-edge bg-background/50 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted">Agente</label>
                  <select value={editing.config.agent} onChange={(e) => setCfg({ agent: e.target.value })}
                    className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                    <option value="">escolha…</option>
                    {agents.map((a) => <option key={a.key} value={a.key}>{a.name} — {a.role}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Projeto (RAG, opcional)</label>
                  <input value={editing.config.project} onChange={(e) => setCfg({ project: e.target.value })}
                    placeholder="filtra a base por projeto" className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Prompt</label>
                <textarea value={editing.config.prompt} onChange={(e) => setCfg({ prompt: e.target.value })}
                  rows={3} placeholder="o que o agente deve fazer…" className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={!!editing.config.notify} onChange={(e) => setCfg({ notify: e.target.checked })} className="accent-blue-500" />
                Enviar o resultado no WhatsApp (número de notificações)
              </label>
            </div>
          )}
          {editing.action === 'brain_digest' && (
            <p className="rounded-lg bg-background/50 px-3 py-2 text-[11px] text-muted">Envia o resumo do cérebro pro número de notificações (configure em Configurações → WhatsApp).</p>
          )}

          {/* agendamento */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted">Quando</label>
              <select value={presetSel} onChange={(e) => pickPreset(e.target.value)}
                className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                {PRESETS.map((p) => <option key={p.cron} value={p.cron}>{p.label}</option>)}
              </select>
            </div>
            {(presetSel === 'daily' || presetSel === 'weekdays') && (
              <div>
                <label className="mb-1 block text-xs text-muted">Horário (Brasília)</label>
                <input type="time" value={dailyTime} onChange={(e) => pickTime(e.target.value)}
                  className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
            )}
            {presetSel === 'custom' && (
              <div>
                <label className="mb-1 block text-xs text-muted">Expressão cron</label>
                <input value={editing.schedule} onChange={(e) => setEditing({ ...editing, schedule: e.target.value })}
                  placeholder="ex: 0 9 * * 1-5" className="w-full rounded-lg border border-edge bg-background px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none" />
                <p className="mt-1 text-[10px] text-muted/70">min hora dia mês dia-da-semana</p>
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted/70">Vai rodar: <strong className="text-body/80">{describeCron(editing.schedule)}</strong> <span className="font-mono">({editing.schedule})</span></p>

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} className="accent-emerald-500" />
              Ativa
            </label>
            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-edge px-3 py-2 text-sm text-muted hover:text-body">Cancelar</button>
              <button onClick={save} disabled={busy === 'save'} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50">
                {busy === 'save' ? 'Salvando…' : 'Salvar tarefa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* lista */}
      {!jobs ? (
        <p className="py-10 text-center text-sm text-muted">Carregando…</p>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-edge bg-surface p-10 text-center text-sm text-muted">
          <Clock className="mx-auto mb-3 opacity-40" size={28} />
          Nenhuma tarefa agendada ainda. Crie uma em <strong className="text-body">Nova tarefa</strong>.
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((j) => {
            const working = busy === j.id;
            return (
              <div key={j.id} className="rounded-xl border border-edge bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${j.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                  <span className="text-sm font-semibold">{j.name}</span>
                  <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] text-blue-300">{ACTIONS[j.action] || j.action}</span>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-muted">⏰ {describeCron(j.schedule)}</span>
                  {j.config?.agent && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-muted">👤 {j.config.agent}</span>}
                  <div className="ml-auto flex gap-1">
                    <button onClick={() => runNow(j)} disabled={working} className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-emerald-400 disabled:opacity-50" title="Rodar agora"><Play size={14} /></button>
                    <button onClick={() => toggle(j)} disabled={working} className="rounded-lg px-2 py-1.5 text-[11px] text-muted hover:bg-white/5 hover:text-body disabled:opacity-50" title="Ativar/desativar">{j.enabled ? 'pausar' : 'ativar'}</button>
                    <button onClick={() => openEdit(j)} disabled={working} className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-blue-400 disabled:opacity-50" title="Editar"><Pencil size={14} /></button>
                    <button onClick={() => remove(j)} disabled={working} className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-red-400 disabled:opacity-50" title="Excluir"><Trash2 size={14} /></button>
                  </div>
                </div>
                {j.config?.prompt && <p className="mt-2 line-clamp-2 text-xs text-body/70">{j.config.prompt}</p>}
                {j.last_run_at && (
                  <p className="mt-2 text-[11px]">
                    <span className={j.last_status === 'ok' ? 'text-emerald-400' : 'text-red-400'}>
                      {j.last_status === 'ok' ? '✓' : '✕'} última: {timeAgo(j.last_run_at)}
                    </span>
                    <span className="text-muted/70" title={fmtDateTime(j.last_run_at)}> — {j.last_result}</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
