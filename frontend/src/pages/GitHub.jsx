import { useEffect, useState } from 'react';
import {
  GitBranch, Folder, FileCode, ChevronRight, Lock, Globe, RefreshCw, Save, GitCommit, AlertTriangle
} from 'lucide-react';
import { api } from '../lib/api.js';

function Crumbs({ path, onGo }) {
  const parts = path ? path.split('/') : [];
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
      <button onClick={() => onGo('')} className="hover:text-blue-400">raiz</button>
      {parts.map((p, i) => {
        const full = parts.slice(0, i + 1).join('/');
        return (
          <span key={full} className="flex items-center gap-1">
            <ChevronRight size={11} />
            <button onClick={() => onGo(full)} className="hover:text-blue-400">{p}</button>
          </span>
        );
      })}
    </div>
  );
}

export default function GitHubPage() {
  const [user, setUser] = useState(null);
  const [repos, setRepos] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [repo, setRepo] = useState(null);     // full_name
  const [path, setPath] = useState('');
  const [node, setNode] = useState(null);     // { type:'dir'|'file', ... }
  const [navErr, setNavErr] = useState(null);
  const [navLoading, setNavLoading] = useState(false);

  // edição de arquivo
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null);

  // indexação do repo na base
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState(null);

  async function indexRepo() {
    setIndexing(true); setIndexResult(null);
    try {
      const r = await api.github.index({ repo });
      setIndexResult({ ok: true, ...r });
    } catch (err) {
      setIndexResult({ ok: false, error: err.message });
    } finally { setIndexing(false); }
  }

  useEffect(() => {
    (async () => {
      try {
        const [u, r] = await Promise.all([api.github.whoami(), api.github.repos()]);
        setUser(u); setRepos(r.repos);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    })();
  }, []);

  async function openRepo(r) {
    setRepo(r.full_name); setPath(''); setNode(null); setEditing(false); setCommitResult(null); setIndexResult(null);
    loadPath(r.full_name, '');
  }

  async function loadPath(rp, p) {
    setNavLoading(true); setNavErr(null); setEditing(false); setCommitResult(null);
    try {
      const data = await api.github.contents(rp, p);
      setNode(data); setPath(p);
      if (data.type === 'file') { setDraft(data.content ?? ''); setCommitMsg(`update ${data.name} via RAG Central`); }
    } catch (err) { setNavErr(err.message); }
    finally { setNavLoading(false); }
  }

  async function commit() {
    setCommitting(true); setCommitResult(null);
    try {
      const res = await api.github.putFile({ repo, path: node.path, content: draft, message: commitMsg });
      setCommitResult({ ok: true, ...res });
      setEditing(false);
      // recarrega pra pegar o novo sha
      loadPath(repo, node.path);
    } catch (err) {
      setCommitResult({ ok: false, error: err.message });
    } finally { setCommitting(false); }
  }

  if (loading) return <p className="py-10 text-center text-sm text-muted">Conectando ao GitHub…</p>;

  if (error) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm">
        <p className="mb-2 flex items-center gap-2 font-semibold text-amber-400">
          <AlertTriangle size={16} /> GitHub não conectado
        </p>
        <p className="text-body/80">{error}</p>
        <p className="mt-3 text-xs text-muted">
          Gere um Personal Access Token em{' '}
          <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="text-blue-400 underline">
            github.com/settings/tokens
          </a>{' '}
          e cole em <strong>Configurações → GitHub</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <GitBranch size={16} />
          {user && (
            <span className="text-muted">
              conectado como <strong className="text-body">{user.login}</strong>
            </span>
          )}
        </div>
        {repo && (
          <button onClick={() => { setRepo(null); setNode(null); }} className="text-xs text-blue-400 hover:underline">
            ← todos os repositórios
          </button>
        )}
      </div>

      {/* lista de repos */}
      {!repo && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {repos?.map((r) => (
            <button
              key={r.full_name}
              onClick={() => openRepo(r)}
              className="rounded-xl border border-edge bg-surface p-4 text-left transition-colors hover:border-blue-500"
            >
              <div className="mb-1 flex items-center gap-2">
                {r.private ? <Lock size={13} className="text-amber-400" /> : <Globe size={13} className="text-emerald-400" />}
                <span className="truncate font-semibold">{r.name}</span>
              </div>
              <p className="mb-2 line-clamp-2 h-8 text-xs text-muted">{r.description || 'sem descrição'}</p>
              <div className="flex items-center gap-3 text-[10px] text-muted">
                {r.language && <span>{r.language}</span>}
                <span>{r.default_branch}</span>
                {r.open_issues > 0 && <span>{r.open_issues} issues</span>}
              </div>
            </button>
          ))}
          {repos?.length === 0 && <p className="text-sm text-muted">Nenhum repositório acessível por este token.</p>}
        </div>
      )}

      {/* navegação dentro do repo */}
      {repo && (
        <div className="rounded-xl border border-edge bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{repo}</p>
              <Crumbs path={path} onGo={(p) => loadPath(repo, p)} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={indexRepo}
                disabled={indexing}
                title="Lê todos os arquivos de texto do repo e indexa na base de conhecimento"
                className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-violet-500 hover:text-violet-400 disabled:opacity-50"
              >
                <RefreshCw size={12} className={indexing ? 'animate-spin' : ''} /> {indexing ? 'Indexando…' : 'Indexar na base'}
              </button>
              <button onClick={() => loadPath(repo, path)} className="rounded p-1.5 text-muted hover:bg-white/10 hover:text-body">
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {indexResult && (
            <p className={`border-b border-edge px-4 py-2 text-xs ${indexResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {indexResult.ok
                ? `✓ Indexado: ${indexResult.indexed} arquivos · ${indexResult.chunks} chunks no projeto "${indexResult.project}"${indexResult.failed ? ` (${indexResult.failed} falharam)` : ''}`
                : `✗ ${indexResult.error}`}
            </p>
          )}

          {navLoading && <p className="px-4 py-6 text-center text-sm text-muted">Carregando…</p>}
          {navErr && <p className="px-4 py-6 text-center text-sm text-red-400">{navErr}</p>}

          {/* diretório */}
          {!navLoading && node?.type === 'dir' && (
            <ul className="divide-y divide-edge/60">
              {path !== '' && (
                <li>
                  <button onClick={() => loadPath(repo, path.split('/').slice(0, -1).join(''))} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-muted hover:bg-white/5">
                    <Folder size={14} /> ..
                  </button>
                </li>
              )}
              {node.entries.map((e) => (
                <li key={e.path}>
                  <button onClick={() => loadPath(repo, e.path)} className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-white/5">
                    {e.type === 'dir' ? <Folder size={14} className="text-blue-400" /> : <FileCode size={14} className="text-muted" />}
                    <span className="flex-1 truncate text-left">{e.name}</span>
                    {e.type === 'file' && <span className="text-[10px] text-muted">{(e.size / 1024).toFixed(1)} KB</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* arquivo */}
          {!navLoading && node?.type === 'file' && (
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{node.name}</span>
                {!editing ? (
                  <button onClick={() => setEditing(true)} className="rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-blue-500 hover:text-blue-400">
                    Editar
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setEditing(false); setDraft(node.content ?? ''); }} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-muted hover:text-body">
                      Cancelar
                    </button>
                  </div>
                )}
              </div>

              <textarea
                value={editing ? draft : (node.content ?? '')}
                onChange={(e) => setDraft(e.target.value)}
                readOnly={!editing}
                spellCheck={false}
                className={`h-96 w-full resize-y rounded-lg border border-edge p-3 font-mono text-xs leading-relaxed outline-none ${
                  editing ? 'bg-background focus:border-blue-500' : 'bg-background/50 text-body/80'
                }`}
              />

              {editing && (
                <div className="mt-3 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="flex items-center gap-1.5 text-[11px] text-amber-400">
                    <AlertTriangle size={12} /> Isso vai commitar direto no branch padrão do repositório.
                  </p>
                  <input
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    placeholder="Mensagem do commit"
                    className="w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={commit}
                    disabled={committing || !commitMsg.trim()}
                    className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {committing ? <RefreshCw size={13} className="animate-spin" /> : <GitCommit size={13} />}
                    {committing ? 'Commitando…' : 'Commitar'}
                  </button>
                </div>
              )}

              {commitResult && (
                <p className={`mt-2 text-xs ${commitResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {commitResult.ok
                    ? `✓ Commit ${commitResult.commit?.sha?.slice(0, 7)} feito com sucesso`
                    : `✗ ${commitResult.error}`}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
