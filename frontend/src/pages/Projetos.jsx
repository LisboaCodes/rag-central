import { useEffect, useState, useCallback, useRef } from 'react';
import {
  FolderGit2, Plus, Play, Square, Download, Trash2, Terminal, Save, FileCode, Folder,
  FilePlus, FolderPlus, Upload, GitBranch, RefreshCw, Loader2, ChevronRight, ChevronDown, Eraser, Settings2
} from 'lucide-react';
import { api } from '../lib/api.js';

const STATUS_TONE = {
  running: { txt: 'text-emerald-400', dot: 'bg-emerald-500', label: 'rodando' },
  exited: { txt: 'text-muted', dot: 'bg-slate-500', label: 'parado' },
  stopping: { txt: 'text-amber-400', dot: 'bg-amber-500', label: 'parando…' },
  idle: { txt: 'text-muted', dot: 'bg-slate-600', label: 'ocioso' }
};

export default function Projetos() {
  const [projects, setProjects] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.projects.list(); setProjects(r.projects); setError(''); }
    catch (err) { setError(err.message); setProjects([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true); setError('');
    try { const r = await api.projects.create(newName.trim()); setNewName(''); await load(); setSelected(r.name); }
    catch (err) { setError(err.message); } finally { setCreating(false); }
  }

  if (selected) return <ProjectDetail name={selected} onBack={() => { setSelected(null); load(); }} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted">Rode scripts e projetos no servidor, edite o código e acompanhe o console ao vivo.</p>
        <button onClick={load} className="ml-auto rounded-lg border border-edge bg-surface p-2 text-muted hover:text-body"><RefreshCw size={15} /></button>
      </div>

      <form onSubmit={create} className="flex gap-2 rounded-xl border border-edge bg-surface p-3">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="nome do projeto (ex: meu-bot)"
          className="flex-1 rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        <button type="submit" disabled={creating} className="flex items-center gap-1.5 rounded-lg bg-blue-500/15 px-3 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/25 disabled:opacity-50">
          {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Criar
        </button>
      </form>

      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}

      {!projects ? <p className="py-10 text-center text-sm text-muted">Carregando…</p>
        : projects.length === 0 ? (
          <div className="rounded-xl border border-edge bg-surface p-10 text-center text-sm text-muted">
            <FolderGit2 className="mx-auto mb-3 opacity-40" size={28} />
            Nenhum projeto ainda. Crie um acima, depois importe do GitHub ou suba arquivos.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const t = STATUS_TONE[p.status?.status] || STATUS_TONE.idle;
              return (
                <button key={p.name} onClick={() => setSelected(p.name)}
                  className="rounded-xl border border-edge bg-surface p-4 text-left transition-colors hover:border-blue-500/40">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold"><FolderGit2 size={15} className="text-blue-400" />{p.name}</span>
                    <span className="flex items-center gap-1.5 text-[11px]"><span className={`h-2 w-2 rounded-full ${t.dot}`} />{t.label}</span>
                  </div>
                  <p className="mt-2 truncate font-mono text-[11px] text-muted">{p.config?.start || 'sem comando de execução'}</p>
                </button>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ---- detalhe do projeto ---------------------------------------------------
function ProjectDetail({ name, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState({ status: 'idle' });
  const [openFile, setOpenFile] = useState(null);      // { path, content, dirty }
  const [savingFile, setSavingFile] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.projects.get(name); setData(r); setStatus(r.status || { status: 'idle' }); setError(''); }
    catch (err) { setError(err.message); }
  }, [name]);
  useEffect(() => { load(); }, [load]);

  // console ao vivo
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    const ctrl = new AbortController();
    setLogs([]);
    api.streamProjectLogs(name, {
      onLog: (l) => setLogs((prev) => [...prev.slice(-1200), l]),
      onStatus: (s) => setStatus((cur) => ({ ...cur, ...s })),
      signal: ctrl.signal
    }).catch(() => {});
    return () => ctrl.abort();
  }, [name]);

  async function act(fn) {
    setError('');
    try { await fn(); await load(); } catch (err) { setError(err.message); }
  }

  async function openPath(path) {
    try { const f = await api.projects.file(name, path); setOpenFile({ path, content: f.content, dirty: false }); }
    catch (err) { setError(err.message); }
  }
  async function saveOpen() {
    if (!openFile) return;
    setSavingFile(true);
    try { await api.projects.saveFile(name, openFile.path, openFile.content); setOpenFile((f) => ({ ...f, dirty: false })); }
    catch (err) { setError(err.message); } finally { setSavingFile(false); }
  }

  const running = status.status === 'running';
  const t = STATUS_TONE[status.status] || STATUS_TONE.idle;

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-muted hover:text-body">← Projetos</button>
        <span className="flex items-center gap-2 text-sm font-semibold"><FolderGit2 size={16} className="text-blue-400" />{name}</span>
        <span className="flex items-center gap-1.5 text-[11px]"><span className={`h-2 w-2 rounded-full ${t.dot}`} /><span className={t.txt}>{t.label}</span>{status.exitCode != null && status.status === 'exited' && <span className="text-muted/70">(código {status.exitCode})</span>}</span>

        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => act(() => api.projects.install(name))} disabled={running}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-blue-500/50 hover:text-blue-300 disabled:opacity-40" title="Rodar comando de instalação">
            <Download size={13} /> Instalar
          </button>
          {running ? (
            <button onClick={() => act(() => api.projects.stop(name))} className="flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/25">
              <Square size={13} /> Parar
            </button>
          ) : (
            <button onClick={() => act(() => api.projects.start(name))} className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25">
              <Play size={13} /> Iniciar
            </button>
          )}
          <button onClick={() => setShowConfig((v) => !v)} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-muted hover:text-body">
            <Settings2 size={13} /> Config
          </button>
          <button onClick={() => { if (confirm(`Excluir o projeto "${name}" e todos os arquivos?`)) act(() => api.projects.remove(name)).then(onBack); }}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-muted hover:text-red-400">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}

      {showConfig && data && <ConfigPanel name={name} config={data.config} onSaved={() => { setShowConfig(false); load(); }} />}

      <ImportBar name={name} onDone={load} />

      {/* editor: árvore + arquivo */}
      <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
        <div className="rounded-xl border border-edge bg-surface p-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Arquivos</span>
            <div className="flex gap-1">
              <button title="Novo arquivo" onClick={() => newEntry(name, 'file', load, setError)} className="rounded p-1 text-muted hover:text-body"><FilePlus size={13} /></button>
              <button title="Nova pasta" onClick={() => newEntry(name, 'dir', load, setError)} className="rounded p-1 text-muted hover:text-body"><FolderPlus size={13} /></button>
            </div>
          </div>
          <div className="max-h-[360px] overflow-auto">
            {data?.tree?.length ? <Tree nodes={data.tree} onOpen={openPath} active={openFile?.path}
              onDelete={(p) => { if (confirm(`Excluir ${p}?`)) act(() => api.projects.deleteEntry(name, p)); }} />
              : <p className="px-2 py-4 text-center text-[11px] text-muted">vazio</p>}
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-surface p-2">
          {openFile ? (
            <>
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted"><FileCode size={13} />{openFile.path}{openFile.dirty && <span className="text-amber-400">●</span>}</span>
                <button onClick={saveOpen} disabled={savingFile || !openFile.dirty}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-500/15 px-3 py-1 text-[11px] text-blue-300 hover:bg-blue-500/25 disabled:opacity-40">
                  {savingFile ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Salvar
                </button>
              </div>
              <textarea
                value={openFile.content}
                onChange={(e) => setOpenFile((f) => ({ ...f, content: e.target.value, dirty: true }))}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveOpen(); } }}
                spellCheck={false}
                className="h-[340px] w-full resize-none rounded-lg border border-edge bg-[#0d0f18] p-3 font-mono text-xs leading-relaxed outline-none focus:border-blue-500"
              />
            </>
          ) : (
            <div className="flex h-[380px] items-center justify-center text-sm text-muted">Selecione um arquivo para editar</div>
          )}
        </div>
      </div>

      <Console name={name} logs={logs} onClear={() => api.projects.clearLogs(name).then(() => setLogs([]))} onRun={(cmd) => act(() => api.projects.run(name, cmd))} running={running} />
    </div>
  );
}

// ---- config (install/start/type) ------------------------------------------
function ConfigPanel({ name, config, onSaved }) {
  const [form, setForm] = useState({ install: config?.install || '', start: config?.start || '', type: config?.type || 'oneshot' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  async function save(e) {
    e.preventDefault(); setSaving(true); setErr('');
    try { await api.projects.setConfig(name, form); onSaved(); } catch (e2) { setErr(e2.message); setSaving(false); }
  }
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-blue-500/30 bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Comando de instalação (setup)" hint="ex: pip install -r requirements.txt">
          <input value={form.install} onChange={(e) => setForm({ ...form, install: e.target.value })} placeholder="pip install -r requirements.txt" className={inp} />
        </Field>
        <Field label="Comando de execução (start)" hint="ex: python main.py">
          <input value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} placeholder="python main.py" className={inp} />
        </Field>
      </div>
      <div className="flex items-end justify-between gap-3">
        <Field label="Tipo">
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inp}>
            <option value="oneshot">Script (roda e termina)</option>
            <option value="service">Serviço (fica ligado)</option>
          </select>
        </Field>
        <button type="submit" disabled={saving} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50">
          {saving ? 'Salvando…' : 'Salvar config'}
        </button>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </form>
  );
}

// ---- importar GitHub / upload ---------------------------------------------
function ImportBar({ name, onDone }) {
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  async function importGh(e) {
    e.preventDefault();
    if (!repo.trim()) return;
    setBusy('gh'); setMsg(null);
    try { const r = await api.projects.importGithub(name, repo.trim(), ref.trim() || undefined); setMsg({ ok: true, text: `Importados ${r.imported}/${r.total} arquivos.` }); onDone(); }
    catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(''); }
  }
  async function upload(e) {
    const files = e.target.files;
    if (!files?.length) return;
    setBusy('up'); setMsg(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const r = await api.projects.upload(name, fd);
      setMsg({ ok: true, text: `${r.saved.length} arquivo(s) enviados.` }); onDone();
    } catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-surface p-3">
      <form onSubmit={importGh} className="flex flex-1 flex-wrap items-center gap-2">
        <GitBranch size={15} className="text-muted" />
        <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" className="flex-1 min-w-[140px] rounded-lg border border-edge bg-background px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="branch (opcional)" className="w-32 rounded-lg border border-edge bg-background px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
        <button type="submit" disabled={busy === 'gh'} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:text-body disabled:opacity-50">
          {busy === 'gh' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Importar
        </button>
      </form>
      <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:text-body">
        {busy === 'up' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir arquivos
        <input ref={fileRef} type="file" multiple className="hidden" onChange={upload} />
      </label>
      {msg && <span className={`w-full text-[11px] ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</span>}
    </div>
  );
}

// ---- árvore de arquivos ----------------------------------------------------
function Tree({ nodes, onOpen, onDelete, active, depth = 0 }) {
  return (
    <ul>
      {nodes.map((n) => <TreeNode key={n.path} n={n} onOpen={onOpen} onDelete={onDelete} active={active} depth={depth} />)}
    </ul>
  );
}
function TreeNode({ n, onOpen, onDelete, active, depth }) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: `${depth * 12 + 4}px` };
  if (n.type === 'dir') {
    return (
      <li>
        <div style={pad} className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-body/80 hover:bg-white/5">
          <button onClick={() => setOpen((v) => !v)} className="flex flex-1 items-center gap-1 truncate">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Folder size={12} className="text-amber-400/80" />{n.name}{n.skipped && <span className="text-[10px] text-muted/60">(oculto)</span>}
          </button>
        </div>
        {open && n.children?.length > 0 && <Tree nodes={n.children} onOpen={onOpen} onDelete={onDelete} active={active} depth={depth + 1} />}
      </li>
    );
  }
  return (
    <li>
      <div style={pad} className={`group flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-white/5 ${active === n.path ? 'bg-blue-500/10 text-blue-300' : 'text-body/80'}`}>
        <button onClick={() => onOpen(n.path)} className="flex flex-1 items-center gap-1 truncate"><FileCode size={12} className="text-muted" />{n.name}</button>
        <button onClick={() => onDelete(n.path)} className="opacity-0 group-hover:opacity-100"><Trash2 size={11} className="text-muted hover:text-red-400" /></button>
      </div>
    </li>
  );
}

// ---- console ao vivo -------------------------------------------------------
function Console({ name, logs, onClear, onRun, running }) {
  const boxRef = useRef(null);
  const [cmd, setCmd] = useState('');
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [logs]);
  return (
    <div className="rounded-xl border border-edge bg-[#0a0c14]">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold text-muted"><Terminal size={14} className="text-emerald-400" /> Console — {name}</span>
        <button onClick={onClear} className="flex items-center gap-1 text-[11px] text-muted hover:text-body"><Eraser size={12} /> limpar</button>
      </div>
      <div ref={boxRef} className="h-72 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 ? <p className="text-muted/50">— sem saída ainda — clique em Instalar/Iniciar ou rode um comando abaixo —</p>
          : logs.map((l, i) => (
            <div key={i} className={l.stream === 'stderr' ? 'text-red-400' : l.stream === 'system' ? 'text-blue-400/80' : 'text-body/90'}>
              <span className="whitespace-pre-wrap break-all">{l.line}</span>
            </div>
          ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (cmd.trim() && !running) { onRun(cmd.trim()); setCmd(''); } }}
        className="flex items-center gap-2 border-t border-edge px-3 py-2">
        <span className="font-mono text-xs text-emerald-400">$</span>
        <input value={cmd} onChange={(e) => setCmd(e.target.value)} disabled={running}
          placeholder={running ? 'processo rodando… pare antes de rodar outro comando' : 'rodar um comando avulso (ex: ls, python -V)'}
          className="flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted/50 disabled:opacity-50" />
      </form>
    </div>
  );
}

// ---- helpers ---------------------------------------------------------------
const inp = 'w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none';
function Field({ label, hint, children }) {
  return <label className="block"><span className="mb-1 block text-[11px] text-muted">{label}</span>{children}{hint && <span className="mt-1 block text-[10px] text-muted/60">{hint}</span>}</label>;
}
async function newEntry(name, kind, load, setError) {
  const path = prompt(kind === 'dir' ? 'Nome da nova pasta (ex: src):' : 'Nome do novo arquivo (ex: main.py):');
  if (!path) return;
  try { await api.projects.createEntry(name, path, kind); load(); } catch (err) { setError(err.message); }
}
