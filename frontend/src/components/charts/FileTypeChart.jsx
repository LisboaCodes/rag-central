import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

const TOOLTIP_STYLE = {
  backgroundColor: '#13151e',
  border: '1px solid #2a2d3e',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#e2e8f0'
};

// Donut genérico com legenda lateral: data = [{ name, value, color }]
export default function FileTypeChart({ data, mono = false, unit = '' }) {
  if (!data?.length) {
    return <p className="py-10 text-center text-xs text-muted">Sem dados ainda — faça uma ingestão.</p>;
  }
  return (
    <div className="flex items-center gap-4">
      <div className="h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={42}
              outerRadius={64}
              paddingAngle={3}
              stroke="none"
            >
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => `${v.toLocaleString('pt-BR')}${unit}`} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-2">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-body/80">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} />
              <span className={`truncate ${mono ? 'font-mono text-[11px]' : ''}`}>{d.name}</span>
            </span>
            <span className="shrink-0 font-semibold text-muted">{d.value.toLocaleString('pt-BR')}{unit}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
