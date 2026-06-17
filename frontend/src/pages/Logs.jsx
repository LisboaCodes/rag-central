import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const LEVELS = ['INFO', 'WARN', 'ERROR'];
const SERVICES = ['api', 'ingest', 'query', 'embedding', 'db', 'ollama', 'config'];

const LEVEL_BADGES = {
  INFO: 'bg-blue-500/15 text-blue-400',
  WARN: 'bg-amber-500/15 text-amber-400',
  ERROR: 'bg-red-500/15 text-red-400'
};

export default function Logs() {
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState(null);
  const [levelFilter, setLevelFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api.logs({
        level: levelFilter || undefined,
        service: serviceFilter || undefined,
        limit: 100
      });
      setLogs(r.logs);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [levelFilter, serviceFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  return (
    <div className="space-y-4">
      {/* filtros + auto-refresh */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todos os níveis</option>
          {LEVELS.map((l) => <option key={l}>{l}</option>)}
        </select>
        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Todos os serviços</option>
          {SERVICES.map((s) => <option key={s}>{s}</option>)}
        </select>

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-body/80">
          <span>Auto-refresh</span>
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`relative h-5 w-9 rounded-full transition-colors ${autoRefresh ? 'bg-blue-600' : 'bg-edge'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                autoRefresh ? 'translate-x-4' : ''
              }`}
            />
          </button>
          {autoRefresh && (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              ao vivo
            </span>
          )}
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="overflow-x-auto rounded-xl border border-edge bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-edge text-[11px] uppercase tracking-wider text-muted">
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">Nível</th>
              <th className="px-4 py-3">Serviço</th>
              <th className="px-4 py-3">Mensagem</th>
            </tr>
          </thead>
          <tbody>
            {(logs || []).map((l) => (
              <tr key={l.id} className="border-b border-edge/60 last:border-0 hover:bg-white/[0.02]">
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted">
                  {new Date(l.timestamp).toLocaleString('pt-BR')}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${LEVEL_BADGES[l.level] || LEVEL_BADGES.INFO}`}>
                    {l.level}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-violet-400">{l.service}</td>
                <td className="px-4 py-2.5 text-xs text-body/80">{l.message}</td>
              </tr>
            ))}
            {logs && logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                  Nenhum log com esses filtros. Os logs vivem em memória e resetam quando o backend reinicia.
                </td>
              </tr>
            )}
            {!logs && !error && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">Carregando…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
