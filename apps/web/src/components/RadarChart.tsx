import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";

type RadarChartProps = {
  data: Array<{ category: string; value: number }>;
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

