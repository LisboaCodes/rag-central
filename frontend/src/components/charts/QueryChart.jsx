import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';

const TOOLTIP_STYLE = {
  backgroundColor: '#13151e',
  border: '1px solid #2a2d3e',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#e2e8f0'
};

export default function QueryChart({ data }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="queryGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#2a2d3e" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="hour"
            stroke="#64748b"
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: '#2a2d3e' }}
            interval={3}
          />
          <YAxis
            stroke="#64748b"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v.toLocaleString('pt-BR')}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [value.toLocaleString('pt-BR'), 'Consultas']}
            labelStyle={{ color: '#64748b' }}
          />
          <Area
            type="monotone"
            dataKey="queries"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#queryGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
