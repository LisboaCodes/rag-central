export const AGENT_COLORS = {
  purple: 'bg-violet-600',
  green: 'bg-emerald-600',
  gold: 'bg-amber-600',
  blue: 'bg-blue-600',
  orange: 'bg-orange-600'
};

export default function AgentCard({ agent }) {
  return (
    <div className="flex items-center gap-3 border-b border-edge/60 py-3 last:border-0 last:pb-0 first:pt-0">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${AGENT_COLORS[agent.color]} text-[9px] font-bold text-white ring-2 ring-white/10`}
      >
        {agent.name}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{agent.name}</p>
        <p className="truncate text-[11px] text-muted">{agent.model}</p>
        <p className="truncate text-[11px] text-muted/80">{agent.role}</p>
      </div>
      <div className="hidden shrink-0 text-right sm:block">
        <p className="text-[10px] text-muted">Última query</p>
        <p className="text-xs text-emerald-400">{agent.lastQuery}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[10px] text-muted">Total consultas</p>
        <p className="text-sm font-bold">{agent.queries}</p>
      </div>
    </div>
  );
}
