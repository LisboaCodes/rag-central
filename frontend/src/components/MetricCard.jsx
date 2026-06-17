import { Database, FolderOpen, FileText, Activity, Clock } from 'lucide-react';

const ICONS = {
  database: Database,
  folder: FolderOpen,
  file: FileText,
  activity: Activity,
  clock: Clock
};

const COLORS = {
  blue: 'bg-blue-500/15 text-blue-400',
  purple: 'bg-violet-500/15 text-violet-400',
  green: 'bg-emerald-500/15 text-emerald-400',
  yellow: 'bg-amber-500/15 text-amber-400',
  gray: 'bg-slate-500/15 text-slate-400'
};

export default function MetricCard({ icon, value, label, sub, subTone = 'muted', color = 'blue' }) {
  const Icon = ICONS[icon] || Database;
  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${COLORS[color]}`}>
        <Icon size={18} />
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
      {sub && (
        <p className={`mt-2 text-[11px] ${subTone === 'green' ? 'text-emerald-400' : 'text-muted'}`}>
          {sub}
        </p>
      )}
    </div>
  );
}
