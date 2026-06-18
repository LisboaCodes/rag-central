import { useEffect, useState } from 'react';
import { Newspaper, RefreshCw, ExternalLink, Sparkles, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAgents, hexOf } from '../lib/AgentsContext.jsx';
import { Avatar } from './Agents.jsx';

export default function Novidades() {
  const { agents } = useAgents();
  const [enabled, setEnabled] = useState(null);
  const [items, setItems] = useState(null);
  const [raw, setRaw] = useState(null);
  const [citations, setCitations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // briefing por agente
  const [briefAgent, setBriefAgent] = useState(null);
  const [brief, setBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);

  // RSS (alimenta a base sozinho)
  const [rss, setRss] = useState(null);
  const [syncing, setSyncing] = useState(false);

  function loadStatus() {
    api.news.status().then((s) => { setEnabled(s.enabled); setRss(s.rss); }).catch(() => setEnabled(false));
  }
  useEffect(() => { loadStatus(); }, []);

  async function syncRss() {
    setSyncing(true);
    try { await api.news.sync(); loadStatus(); } catch { /* ignore */ }
    finally { setSyncing(false); }
  }

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await api.news.latest();
      setItems(r.items); setRaw(r.raw); setCitations(r.citations || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (enabled) load(); /* eslint-disable-next-line */ }, [enabled]);

  async function getBrief(a) {
    setBriefAgent(a); setBrief(null); setBriefLoading(true);
    try { setBrief(await api.news.brief(a.key)); } catch (err) { setBrief({ brief: `Erro: ${err.message}`, citations: [] }); }
    finally { setBriefLoading(false); }
  }

  const RssPanel = (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><Newspaper size={16} /> Feed automático (RSS → base de conhecimento)</p>
        <button onClick={syncRss} disabled={syncing} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-blue-500 disabled:opacity-50">
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Puxa OpenAI, Anthropic, HuggingFace, VentureBeat e TechCrunch a cada 6h e ingere na base (projeto <code className="text-violet-400">novidades-ia</code>) — os agentes passam a conhecer as novidades.
      </p>
      {rss && (
        <p className="mt-2 text-[11px] text-muted">
          📥 <strong className="text-body">{rss.totalIngested}</strong> artigos na base ·
          última sync: {rss.lastSync ? new Date(rss.lastSync).toLocaleString('pt-BR') : 'ainda não'}
          {rss.running && <span className="text-emerald-400"> · rodando…</span>}
        </p>
      )}
    </div>
  );

  if (enabled === false) {
    return (
      <div className="space-y-4">
        {RssPanel}
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm">
          <p className="mb-2 flex items-center gap-2 font-semibold text-amber-400"><AlertTriangle size={16} /> Perplexity não configurada (opcional)</p>
          <p className="text-body/80">O quadro com resumos por IA usa a Perplexity. Crie uma chave em{' '}
            <a href="https://www.perplexity.ai/settings/api" target="_blank" rel="noreferrer" className="text-blue-400 underline">perplexity.ai/settings/api</a>{' '}
            e cole em <strong>Configurações → Perplexity</strong>. (O feed RSS acima funciona sem isso.)</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {RssPanel}
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold"><Newspaper size={16} /> Novidades do mundo de IA</p>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:border-blue-500 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      {loading && !items && <p className="py-8 text-center text-sm text-muted">Buscando as últimas novidades…</p>}

      {/* cards de novidades */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items?.map((it, i) => (
          <div key={i} className="flex flex-col rounded-xl border border-edge bg-surface p-4">
            <p className="mb-1 font-semibold leading-snug">{it.titulo}</p>
            <p className="mb-3 flex-1 text-xs text-muted">{it.resumo}</p>
            {it.fonte && (
              <a href={it.fonte} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:underline">
                <ExternalLink size={11} /> fonte
              </a>
            )}
          </div>
        ))}
      </div>
      {raw && <div className="whitespace-pre-wrap rounded-xl border border-edge bg-surface p-4 text-sm text-body/90">{raw}</div>}

      {/* briefing por agente (tema que ele domina) */}
      <div className="rounded-xl border border-edge bg-surface p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} className="text-violet-400" /> Peça um resumo da área de um agente</p>
        <div className="flex flex-wrap gap-2">
          {agents.map((a) => (
            <button key={a.key} onClick={() => getBrief(a)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:border-blue-500 ${briefAgent?.key === a.key ? 'border-blue-500' : 'border-edge'}`}>
              <Avatar agent={a} size={20} /> {a.name}
            </button>
          ))}
        </div>

        {briefAgent && (
          <div className="mt-4 rounded-lg border border-edge bg-background p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: hexOf(briefAgent.color) }} />
              {briefAgent.name} — novidades de {briefAgent.role}
            </p>
            {briefLoading ? <p className="text-sm text-muted">{briefAgent.name} está pesquisando…</p> : (
              <>
                <p className="whitespace-pre-wrap text-sm text-body/90">{brief?.brief}</p>
                {brief?.citations?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2 border-t border-edge pt-2">
                    {brief.citations.slice(0, 8).map((c, j) => (
                      <a key={j} href={c} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:underline">
                        <ExternalLink size={10} /> {String(c).replace(/^https?:\/\//, '').split('/')[0]}
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
