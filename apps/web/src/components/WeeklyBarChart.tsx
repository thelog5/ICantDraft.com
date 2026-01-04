import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type WeeklyBarChartProps = {
  data: Array<{
    category: string;
    myTeam: number;
    opponent: number;
    leagueAvg: number;
    isPercentage?: boolean;
    rawTeamValue?: number;
    rawOpponentValue?: number;
    rawLeagueAvg?: number;
  }>;
};

type TooltipPayload = {
  name: string;
  value: number;
  color: string;
  payload: {
    isPercentage?: boolean;
    rawTeamValue?: number;
    rawOpponentValue?: number;
    rawLeagueAvg?: number;
  };
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
};

// Custom tooltip to show raw values
const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    const dataPoint = payload[0]?.payload;
    const isPercentage = dataPoint?.isPercentage ?? false;
    
    return (
      <div style={{
        backgroundColor: '#fff',
        padding: '12px 14px',
        border: '1px solid #e5e5e5',
        borderRadius: '6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        pointerEvents: 'none'
      }}>
        <p style={{ margin: '0 0 10px 0', fontWeight: 700, fontSize: '1rem' }}>{label}</p>
        {payload.map((entry: TooltipPayload, index: number) => {
          let displayValue = entry.value;
          
          // Get the correct raw value based on the entry name
          if (entry.name === "Your Team" && dataPoint.rawTeamValue !== undefined) {
            displayValue = dataPoint.rawTeamValue;
          } else if (entry.name === "Opponent" && dataPoint.rawOpponentValue !== undefined) {
            displayValue = dataPoint.rawOpponentValue;
          } else if (entry.name === "League Avg" && dataPoint.rawLeagueAvg !== undefined) {
            displayValue = dataPoint.rawLeagueAvg;
          }
          
          return (
            <p key={index} style={{ margin: '5px 0', color: entry.color, fontSize: '1rem', fontWeight: 600 }}>
              {entry.name}: {isPercentage 
                ? `${(displayValue * 100).toFixed(1)}%` 
                : displayValue.toFixed(1)}
            </p>
          );
        })}
      </div>
    );
  }
  return null;
};

export default function WeeklyBarChart({ data }: WeeklyBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 20, right: 30, left: 50, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis dataKey="category" tick={{ fontSize: 11 }} />
        <YAxis 
          tick={{ fontSize: 11 }} 
          domain={[0, 100]}
          label={{ 
            value: 'Normalized Scale (0-100)', 
            angle: -90, 
            position: 'left', 
            style: { fontSize: '0.75rem', textAnchor: 'middle' },
            offset: -10
          }}
        />
        <Tooltip 
          content={<CustomTooltip />} 
          cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
          animationDuration={0}
          isAnimationActive={false}
        />
        <Legend wrapperStyle={{ fontSize: '0.875rem' }} />
        <Bar dataKey="myTeam" fill="#0066cc" name="Your Team" />
        <Bar dataKey="opponent" fill="#999" name="Opponent" />
        <Bar dataKey="leagueAvg" fill="#ffb81c" name="League Avg" />
      </BarChart>
    </ResponsiveContainer>
  );
}

