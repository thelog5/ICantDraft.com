import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type WeeklyBarChartProps = {
  data: Array<{
    category: string;
    myTeam: number;
    opponent: number;
    leagueAvg: number;
    isPercentage?: boolean;
  }>;
};

type TooltipPayload = {
  name: string;
  value: number;
  color: string;
  payload: {
    isPercentage?: boolean;
  };
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
};

// Custom tooltip to format percentages
const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    const isPercentage = payload[0]?.payload?.isPercentage ?? false;
    
    return (
      <div style={{
        backgroundColor: '#fff',
        padding: '10px',
        border: '1px solid #e5e5e5',
        borderRadius: '4px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <p style={{ margin: '0 0 8px 0', fontWeight: 600 }}>{label}</p>
        {payload.map((entry: TooltipPayload, index: number) => (
          <p key={index} style={{ margin: '4px 0', color: entry.color, fontSize: '0.875rem' }}>
            {entry.name}: {isPercentage 
              ? `${entry.value.toFixed(1)}%` 
              : entry.value.toFixed(1)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function WeeklyBarChart({ data }: WeeklyBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis dataKey="category" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: '0.875rem' }} />
        <Bar dataKey="myTeam" fill="#0066cc" name="Your Team" />
        <Bar dataKey="opponent" fill="#999" name="Opponent" />
        <Bar dataKey="leagueAvg" fill="#ffb81c" name="League Avg" />
      </BarChart>
    </ResponsiveContainer>
  );
}

