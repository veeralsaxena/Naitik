import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

function BreakdownTooltip({ active, payload }) {
  if (!active || !payload?.length) {
    return null;
  }

  const entry = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{entry.name}</strong>
      <span>{entry.value}%</span>
      <small>{entry.contributes_to_risk ? 'Contributed to risk' : 'Within acceptable bounds'}</small>
    </div>
  );
}

export default function SignalBreakdown({ signalBreakdown }) {
  if (!signalBreakdown?.length) {
    return <div className="analysis-empty">No signal breakdown available.</div>;
  }

  return (
    <div className="signal-chart">
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={signalBreakdown} layout="vertical" margin={{ top: 0, right: 24, left: 20, bottom: 0 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis
            dataKey="name"
            type="category"
            width={110}
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#b7c5d8', fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}
          />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<BreakdownTooltip />} />
          <Bar dataKey="value" radius={[0, 12, 12, 0]} barSize={18}>
            {signalBreakdown.map((entry) => (
              <Cell key={entry.name} fill={entry.contributes_to_risk ? '#ff7d50' : '#2bc7a0'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
