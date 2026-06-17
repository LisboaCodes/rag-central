import { useEffect, useRef, useState } from 'react';
import { UploadCloud, FileText, X } from 'lucide-react';
import { api } from '../lib/api.js';

const ACCEPT = '.md,.txt,.pdf,.js,.php,.py,.json,.ts,.jsx,.tsx,.yml,.yaml,.sql,.sh,.csv';

export default function Ingest() {
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState('');
  const [files, setFiles] = useState([]);
  const [text, setText] = useState('');
  const [chunkSize, setChunkSize] = useState(512);
  const [overlapPct, setOverlapPct] = useState(12);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // null | {done, total} | 'done'
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api.projects().then((r) => setProjects(r.projects)).catch(() => {});
  }, []);

  const overlapTokens = Math.round((chunkSize * overlapPct) / 100);

  function addFiles(list) {
    setFiles((f) => [...f, ...Array.from(list)]);
    setPreview(null);
    setResult(null);
  }

  function buildForm(file) {
    const fd = new FormData();
    if (file) fd.append('file', file);
    else fd.append('text', text);
    fd.append('project', project.trim());
    fd.append('chunk_size', chunkSize);
    fd.append('chunk_overlap', overlapTokens);
    fd.append('chunk_unit', 'tokens');
    return fd;
  }

  function validate() {
    if (!project.trim()) return 'Informe o projeto.';
    if (!files.length && !text.trim()) return 'Envie um arquivo ou cole um texto.';
    return null;
  }

  async function handlePreview() {
    const v = validate();
    if (v) return setError(v);
    setBusy(true); setError(null); setResult(null);
    try {
      // preview do primeiro arquivo (ou do texto avulso)
      const r = await api.ingestPreview(buildForm(files[0]));
      setPreview(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleIngest() {
    const v = validate();
    if (v) return setError(v);
    setBusy(true); setError(null); setResult(null);

    const jobs = files.length ? files : [null]; // null = texto avulso
    const outcomes = [];
    try {
      for (let i = 0; i < jobs.length; i++) {
        setProgress({ done: i, total: jobs.length });
        outcomes.push(await api.ingest(buildForm(jobs[i])));
      }
      setProgress('done');
      setResult(outcomes);
      setPreview(null);
      setFiles([]);
      setText('');
      const newProjects = outcomes.map((o) => o.project).filter((p) => !projects.includes(p));
      if (newProjects.length) setProjects([...projects, ...newProjects].sort());
    } catch (err) {
      setError(`${err.message}${outcomes.length ? ` (${outcomes.length} de ${jobs.length} fontes já ingeridas)` : ''}`);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <div className="space-y-4 xl:col-span-3">
        {/* drag & drop */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? 'border-blue-500 bg-blue-500/5' : 'border-edge bg-surface hover:border-blue-500/50'
          }`}
        >
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
            <UploadCloud size={22} />
          </div>
          <p className="text-sm font-medium">Arraste arquivos aqui ou clique para selecionar</p>
          <p className="mt-1 text-xs text-muted">.md · .txt · .pdf · .js · .php · .py · .json · .ts e outros</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {files.length > 0 && (
          <div className="rounded-xl border border-edge bg-surface p-4">
            <ul className="space-y-2">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <FileText size={15} className="shrink-0 text-blue-400" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-xs text-muted">{(f.size / 1024).toFixed(1)} KB</span>
                  <button
                    onClick={() => { setFiles(files.filter((_, j) => j !== i)); setPreview(null); }}
                    className="rounded p-1 text-muted hover:text-red-400"
                    aria-label="Remover"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-xl border border-edge bg-surface p-5">
          <label className="mb-1.5 block text-sm font-medium">Texto avulso</label>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setPreview(null); }}
            placeholder="Cole aqui markdown, código, anotações… (usado quando nenhum arquivo é enviado)"
            className="min-h-32 w-full rounded-lg border border-edge bg-background px-3 py-2 font-mono text-xs placeholder-muted/60 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {result && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            {result.map((r) => (
              <p key={r.source_path}>
                ✓ {r.source_path}: {r.chunks} chunks via <code>{r.embedding_model}</code>
                {r.fallback && ' (fallback OpenAI)'}
              </p>
            ))}
          </div>
        )}

        {preview && (
          <div className="rounded-xl border border-edge bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Preview — {preview.count} chunks</h3>
              <span className="font-mono text-[11px] text-muted">{preview.source_path}</span>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {preview.chunks.map((c) => (
                <div key={c.index} className="rounded-lg border border-edge bg-background p-3">
                  <div className="mb-1 flex justify-between text-[10px] text-muted">
                    <span>chunk #{c.index}</span>
                    <span>{c.chars} chars</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-body/80">{c.text}</pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* painel de configuração */}
      <div className="xl:col-span-2">
        <div className="space-y-5 rounded-xl border border-edge bg-surface p-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Projeto</label>
            <input
              list="projects-list"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="escolha ou digite um novo"
              className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm placeholder-muted/50 focus:border-blue-500 focus:outline-none"
            />
            <datalist id="projects-list">
              {projects.map((p) => <option key={p} value={p} />)}
            </datalist>
          </div>

          <div>
            <div className="mb-1.5 flex justify-between text-sm">
              <label className="font-medium">Chunk size</label>
              <span className="text-blue-400">{chunkSize} tokens</span>
            </div>
            <input
              type="range" min="128" max="2048" step="64"
              value={chunkSize}
              onChange={(e) => { setChunkSize(Number(e.target.value)); setPreview(null); }}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-[10px] text-muted"><span>128</span><span>2048</span></div>
          </div>

          <div>
            <div className="mb-1.5 flex justify-between text-sm">
              <label className="font-medium">Overlap</label>
              <span className="text-violet-400">{overlapPct}% ({overlapTokens} tokens)</span>
            </div>
            <input
              type="range" min="0" max="50"
              value={overlapPct}
              onChange={(e) => { setOverlapPct(Number(e.target.value)); setPreview(null); }}
              className="w-full accent-violet-500"
            />
            <div className="flex justify-between text-[10px] text-muted"><span>0%</span><span>50%</span></div>
          </div>

          <div className="space-y-2 border-t border-edge pt-4">
            <button
              onClick={handlePreview}
              disabled={busy}
              className="w-full rounded-lg border border-edge px-4 py-2 text-sm font-medium text-body/80 hover:border-blue-500/50 hover:text-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy && !progress ? 'Gerando…' : 'Gerar preview dos chunks'}
            </button>
            <button
              onClick={handleIngest}
              disabled={busy || !preview}
              title={!preview ? 'Gere o preview primeiro' : ''}
              className="w-full rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white hover:from-blue-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy && progress ? 'Ingerindo…' : 'Iniciar Ingestão'}
            </button>
            {files.length > 1 && (
              <p className="text-center text-[10px] text-muted">
                {files.length} arquivos — o preview mostra o primeiro; a ingestão processa todos.
              </p>
            )}
          </div>

          {progress && progress !== 'done' && (
            <div>
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="text-muted">Processando arquivo {progress.done + 1} de {progress.total}…</span>
                <span className="font-semibold">{Math.round((progress.done / progress.total) * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
