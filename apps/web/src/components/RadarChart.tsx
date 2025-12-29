import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";

type RadarChartProps = {
  data: Array<{ category: string; value: number; rawValue?: number }>;
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    payload: { category: string; value: number; rawValue?: number };
  }>;
  coordinate?: { x: number; y: number };
};

const CustomTooltip = ({ active, payload, coordinate }: CustomTooltipProps) => {
  if (active && payload && payload.length > 0 && coordinate) {
    const data = payload[0].payload;
    return (
      <div 
        className="radar-tooltip"
        style={{
          position: "absolute",
          left: `${coordinate.x}px`,
          top: `${coordinate.y}px`,
          transform: "translate(-50%, -100%)",
          marginTop: "-10px",
          pointerEvents: "none",
        }}
      >
        <div className="tooltip-category">{data.category}</div>
        <div className="tooltip-value">{data.rawValue !== undefined ? data.rawValue.toFixed(1) : data.value.toFixed(1)}</div>
      </div>
    );
  }
  return null;
};

export default function TeamRadarChart({ data }: RadarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data}>
        <PolarGrid />
        <PolarAngleAxis
          dataKey="category"
          tick={{ fontSize: 12, fill: "#666" }}
        />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} />
        <Tooltip 
          content={<CustomTooltip />}
          cursor={false}
          wrapperStyle={{ outline: "none" }}
        />
        <Radar
          name="Team"
          dataKey="value"
          stroke="#0066cc"
          fill="#0066cc"
          fillOpacity={0.3}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

