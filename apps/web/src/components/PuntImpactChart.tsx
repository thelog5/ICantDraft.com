import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type PuntImpactChartProps = {
  data: Array<{
    category: string;
    gain: number;
    loss: number;
  }>;
};

export default function PuntImpactChart({ data }: PuntImpactChartProps) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis dataKey="category" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="gain" fill="#00a651" name="Gain from Punt" />
        <Bar dataKey="loss" fill="#e31837" name="Loss if Kept" />
      </BarChart>
    </ResponsiveContainer>
  );
}

