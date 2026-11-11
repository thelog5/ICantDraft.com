/** Ranks are already direction-aware (including turnovers). */
export function rankDisplay(rank: number, totalTeams: number) {
  if (!Number.isFinite(rank) || rank < 1 || rank > totalTeams) {
    return { label: '—', color: '#626b78', percentile: 0, description: 'Rank unavailable' };
  }
  const percentile = totalTeams > 1 ? ((totalTeams - rank) / (totalTeams - 1)) * 100 : 50;
  const lastTwo = rank % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'} as Record<number,string>)[rank % 10] || 'th';
  const tied = !Number.isInteger(rank);
  return {
    label: tied ? `${rank.toFixed(1)} avg` : `${rank}${suffix}`,
    color: percentile >= 70 ? '#23734d' : percentile >= 40 ? '#626b78' : '#b83b46',
    percentile,
    description: `${tied ? 'Average rank for tied teams: ' : 'Rank '}${rank} of ${totalTeams}`,
  };
}
