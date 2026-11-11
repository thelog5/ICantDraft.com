type IconName = 'chart' | 'shield' | 'alert' | 'info' | 'refresh' | 'ball';
const paths: Record<IconName, string> = {
  chart: 'M4 4v16h16M8 16v-5m5 5V7m5 9v-7',
  shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',
  alert: 'm12 3 10 18H2L12 3Zm0 6v5m0 3v.1',
  info: 'M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6',
  ball: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM2 12h20M12 2v20M5 5c8 1 13 6 14 14M19 5C11 6 6 11 5 19',
};
export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{display:'inline-block',verticalAlign:'-0.15em',flexShrink:0}}><path d={paths[name]}/></svg>;
}
