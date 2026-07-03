import { useEffect, useState } from 'react';
import { Loader2, ListTodo, ExternalLink, Settings as SettingsIcon } from 'lucide-react';
import { api } from '../lib/api.js';

// Embute o TaskHub (app de tarefas/hábitos que roda como serviço próprio).
// A URL vem de /taskhub/config. Os agentes operam o mesmo TaskHub via MCP.
export default function Tarefas() {
  const [cfg, setCfg] = useState(null);   // { enabled, url }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.taskhub.config()
      .then((c) => { if (alive) setCfg(c); })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>;
  }

  if (error) {
    return <div className="flex min-h-[60vh] items-center justify-center"><p className="text-sm text-red-400">{error}</p></div>;
  }

  if (!cfg?.enabled || !cfg?.url) {
    return (
      <div className="mx-auto max-w-md">
        <div className="rounded-2xl border border-edge bg-surface/60 p-7 text-center">
          <ListTodo size={28} className="mx-auto mb-3 text-blue-400" />
          <p className="text-sm font-semibold">TaskHub ainda não está conectado</p>
          <p className="mt-2 text-xs text-muted">
            Configure em <strong className="text-body">Configurações → TaskHub</strong>: a URL pública do TaskHub,
            a URL do MCP e o segredo (MCP_SECRET). Depois ligue a integração. Em produção, defina essas
            variáveis no Coolify.
          </p>
          <a href="/settings" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-sm font-medium text-white">
            <SettingsIcon size={15} /> Ir para Configurações
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <a
          href={cfg.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface/60 px-3 py-1.5 text-xs text-muted hover:text-body"
        >
          <ExternalLink size={13} /> Abrir em nova aba
        </a>
      </div>
      <iframe
        title="TaskHub"
        src={cfg.url}
        className="h-[calc(100vh-9rem)] w-full rounded-xl border border-edge bg-white"
        allow="clipboard-read; clipboard-write; microphone"
      />
    </div>
  );
}
