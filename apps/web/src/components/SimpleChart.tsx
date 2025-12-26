import "./SimpleChart.css";

type SimpleChartProps = {
  data: Array<{ label: string; value: number }>;
  height?: number;
  className?: string;
};

export default function SimpleChart({
  data,
  height = 200,
  className = "",
}: SimpleChartProps) {
  if (data.length === 0) {
    return (
      <div className={`simple-chart empty ${className}`} style={{ height }}>
        <div className="simple-chart-empty-message">No data available</div>
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className={`simple-chart ${className}`} style={{ height }}>
      <svg width="100%" height={height} className="simple-chart-svg">
        {data.map((item, index) => {
          const barHeight = (item.value / maxValue) * (height - 40);
          const x = (index / data.length) * 100;
          const y = height - barHeight - 20;
          const width = 100 / data.length - 2;

          return (
            <g key={index}>
              <rect
                x={`${x}%`}
                y={y}
                width={`${width}%`}
                height={barHeight}
                fill="#0066cc"
                className="simple-chart-bar"
              />
              <text
                x={`${x + width / 2}%`}
                y={height - 5}
                textAnchor="middle"
                fontSize="10"
                fill="#666"
                className="simple-chart-label"
              >
                {item.label}
              </text>
              <text
                x={`${x + width / 2}%`}
                y={y - 5}
                textAnchor="middle"
                fontSize="11"
                fill="#333"
                fontWeight="600"
                className="simple-chart-value"
              >
                {item.value.toFixed(1)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

