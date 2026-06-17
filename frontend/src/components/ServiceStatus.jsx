import { Database, Box, Cpu, Cloud } from 'lucide-react';

const ICONS = { database: Database, box: Box, cpu: Cpu, cloud: Cloud };

const TONES = {
  green: { dot: 'bg-emerald-500', text: 'text-emerald-400' },
  yellow: { dot: 'bg-amber-500', text: 'text-amber-400' },
  red: { dot: 'bg-red-500', text: 'text-red-400' }
};

export default function ServiceStatus({ services }) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <h3 className="mb-4 text-sm font-semibold">Status dos Serviços</h3>
      <ul>
        {services.map((s) => {
          const Icon = ICONS[s.icon] || Database;
          const tone = TONES[s.tone] || TONES.green;
          return (
            <li
              key={s.name}
              className="flex items-center justify-between gap-3 border-b border-edge/60 py-3 last:border-0 last:pb-0 first:pt-0"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-muted">
                  <Icon size={15} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm">{s.name}</p>
                  <p className={`flex items-center gap-1.5 text-[11px] ${tone.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                    {s.status}
                  </p>
                </div>
              </div>
              <span className="shrink-0 font-mono text-xs text-muted">{s.detail}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
