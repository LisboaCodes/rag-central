import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Upload, FolderOpen, Search, Bot, Building2, GitBranch, MessagesSquare, Newspaper, ScrollText, Settings, BrainCircuit, Brain, Network, CalendarClock
} from 'lucide-react';
import { useStatus } from '../lib/StatusContext.jsx';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, title: 'Dashboard', subtitle: 'Visão geral do sistema' },
  { to: '/ingest', label: 'Ingestão', icon: Upload, title: 'Ingestão de Documentos', subtitle: 'Envie arquivos ou texto para a base de conhecimento' },
  { to: '/sources', label: 'Fontes Indexadas', icon: FolderOpen, title: 'Fontes Indexadas', subtitle: 'Documentos e arquivos na base vetorial' },
  { to: '/search', label: 'Busca Semântica', icon: Search, title: 'Busca Semântica', subtitle: 'Consulte a base como os agentes fazem' },
  { to: '/agents', label: 'Agentes', icon: Bot, title: 'Agentes', subtitle: 'Agentes de IA conectados ao RAG' },
  { to: '/conversas', label: 'Conversas', icon: MessagesSquare, title: 'Conversas & Memória', subtitle: 'Histórico de conversas que os agentes relembram' },
  { to: '/memoria', label: 'Memória', icon: Brain, title: 'Central de Memória', subtitle: 'Tudo que os agentes aprenderam — veja, edite e exclua' },
  { to: '/cerebro', label: 'Cérebro', icon: Network, title: 'Cérebro Visual', subtitle: 'Grafo do conhecimento — como o cérebro está conectado e evoluindo' },
  { to: '/agendamentos', label: 'Agendamentos', icon: CalendarClock, title: 'Agendamentos (CRON)', subtitle: 'Tarefas que rodam sozinhas no horário definido' },
  { to: '/office', label: 'Escritório', icon: Building2, title: 'Escritório Virtual', subtitle: 'Seus agentes em um escritório 2D em tempo real' },
  { to: '/novidades', label: 'Novidades IA', icon: Newspaper, title: 'Novidades de IA', subtitle: 'Últimas do mundo de IA e APIs (via Perplexity)' },
  { to: '/github', label: 'GitHub', icon: GitBranch, title: 'GitHub', subtitle: 'Repositórios linkados — navegar, visualizar e commitar' },
  { to: '/logs', label: 'Logs do Sistema', icon: ScrollText, title: 'Logs do Sistema', subtitle: 'Eventos e diagnóstico em tempo real' },
  { to: '/settings', label: 'Configurações', icon: Settings, title: 'Configurações', subtitle: 'Serviços, embedding e aplicação' }
];

function StatusDot({ ok }) {
  return <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />;
}

export default function Sidebar({ open, onClose }) {
  const { status, error } = useStatus();

  const items = [
    { name: 'API', ok: Boolean(status) && !error, label: status && !error ? 'Online' : 'Offline' },
    { name: 'PostgreSQL', ok: status?.database?.connected, label: status?.database?.connected ? 'Online' : 'Offline' },
    { name: 'pgvector', ok: Boolean(status?.database?.pgvector), label: status?.database?.pgvector ? 'Online' : 'Offline' },
    { name: 'Ollama (LXC 101)', ok: status?.ollama?.online, label: status?.ollama?.online ? 'Online' : 'Offline' },
    { name: 'OpenAI API', ok: status?.openai?.configured, label: status?.openai?.configured ? 'Ativo' : 'Sem key' }
  ];

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[220px] flex-col border-r border-edge bg-sidebar
          ${open ? 'flex' : 'hidden'} lg:flex`}
      >
        {/* logo */}
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600">
            <BrainCircuit size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide">RAG CENTRAL</p>
            <p className="text-[10px] text-muted">Central de Conhecimento</p>
          </div>
        </div>

        {/* navegação */}
        <nav className="mt-2 flex flex-col gap-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'border-blue-500 bg-gradient-to-r from-blue-500/15 to-violet-500/5 font-medium text-blue-400'
                    : 'border-transparent text-muted hover:bg-white/5 hover:text-body'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* status do sistema (dados reais do /status) */}
        <div className="mx-3 mt-auto rounded-xl border border-edge bg-surface/60 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Status do Sistema
          </p>
          {!status && !error ? (
            <p className="text-[11px] text-muted">Carregando…</p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((s) => (
                <li key={s.name} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-2 text-body/80">
                    <StatusDot ok={s.ok} />
                    {s.name}
                  </span>
                  <span className={s.ok ? 'text-emerald-400' : 'text-red-400'}>{s.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* rodapé */}
        <div className="px-5 py-4 text-center">
          <p className="text-[11px] text-muted">RAG Central v1.0.0</p>
          <p className="text-[10px] text-muted/70">© 2026 Rafael · Homelab</p>
        </div>
      </aside>
    </>
  );
}
