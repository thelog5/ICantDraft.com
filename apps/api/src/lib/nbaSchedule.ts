/**
 * NBA Team Schedule Fetcher
 * Fetches real NBA game schedules from ESPN's public NBA API
 */

interface NBAGame {
  id: string;
  date: string;
  homeTeam: { id: string; abbreviation: string };
  awayTeam: { id: string; abbreviation: string };
}

interface TeamSchedule {
  teamId: string;
  teamName: string;
  games: { date: string; opponent: string; isHome: boolean }[];
}

// ESPN Fantasy proTeamId to ESPN NBA team ID mapping
const FANTASY_TO_NBA_TEAM_MAP: Record<number, string> = {
  1: '1',   // Atlanta Hawks
  2: '2',   // Boston Celtics
  3: '3',   // New Orleans Pelicans (formerly Hornets)
  4: '4',   // Chicago Bulls
  5: '5',   // Cleveland Cavaliers
  6: '6',   // Dallas Mavericks
  7: '7',   // Denver Nuggets
  8: '8',   // Detroit Pistons
  9: '9',   // Golden State Warriors
  10: '10', // Houston Rockets
  11: '11', // Indiana Pacers
  12: '12', // LA Clippers
  13: '13', // LA Lakers
  14: '14', // Miami Heat
  15: '15', // Milwaukee Bucks
  16: '16', // Minnesota Timberwolves
  17: '17', // Brooklyn Nets (formerly NJ Nets)
  18: '18', // New York Knicks
  19: '19', // Orlando Magic
  20: '20', // Philadelphia 76ers
  21: '21', // Phoenix Suns
  22: '22', // Portland Trail Blazers
  23: '23', // Sacramento Kings
  24: '24', // San Antonio Spurs
  25: '25', // Oklahoma City Thunder (formerly Seattle)
  26: '26', // Utah Jazz
  27: '27', // Washington Wizards
  28: '28', // Toronto Raptors
  29: '29', // Memphis Grizzlies
  30: '30', // Charlotte Hornets (expansion)
};

/**
 * Fetch NBA schedule for a date range from ESPN's public NBA API
 */
export async function fetchNBASchedule(
  startDate: Date,
  endDate: Date
): Promise<Map<string, Date[]>> {
  try {
    const teamSchedules = new Map<string, Date[]>();
    
    // Expand the date range by 1 day on each side to account for timezone differences
    const expandedStart = new Date(startDate);
    expandedStart.setDate(expandedStart.getDate() - 1);
    const expandedEnd = new Date(endDate);
    expandedEnd.setDate(expandedEnd.getDate() + 1);
    
    // ESPN NBA scoreboard API - we'll need to fetch for each day in range
    const currentDate = new Date(expandedStart);
    
    while (currentDate <= expandedEnd) {
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '');
      const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`;
      
      try {
        const response: globalThis.Response = await fetch(url);
        if (!response.ok) {
          console.warn(`[NBA Schedule] Failed to fetch schedule for ${dateStr}: ${response.status}`);
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }
        
        const data: any = await response.json();
        const events = data?.events || [];
        
        if (events.length > 0) {
          console.log(`[NBA Schedule] Found ${events.length} games on ${dateStr}`);
        }
        
        for (const event of events) {
          // ESPN returns game date/time in ISO format (UTC)
          // NBA games are scheduled in Eastern Time
          // A game at 10 PM ET on Wednesday = 3 AM UTC on Thursday
          // We need the date to be Wednesday, not Thursday
          
          const gameDateTimeUTC = new Date(event.date);
          
          // Convert UTC time to Eastern Time and extract the date
          // Use Intl.DateTimeFormat to get date components in ET timezone
          const etFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
          
          const etParts = etFormatter.formatToParts(gameDateTimeUTC);
          const etYear = parseInt(etParts.find(p => p.type === 'year')!.value);
          const etMonth = parseInt(etParts.find(p => p.type === 'month')!.value) - 1; // 0-indexed
          const etDay = parseInt(etParts.find(p => p.type === 'day')!.value);
          
          // Create a date object at midnight UTC for the ET date
          // This ensures consistent date comparison later
          const gameDate = new Date(Date.UTC(etYear, etMonth, etDay));
          
          const competitions = event.competitions || [];
          const gameName = event.name || 'Unknown';
          
          for (const competition of competitions) {
            const competitors = competition.competitors || [];
            
            for (const competitor of competitors) {
              const teamId = competitor.team?.id;
              const teamName = competitor.team?.abbreviation || teamId;
              if (!teamId) continue;
              
              if (!teamSchedules.has(teamId)) {
                teamSchedules.set(teamId, []);
              }
              
              // Only add if not already present (avoid duplicates)
              const existing = teamSchedules.get(teamId)!;
              const dateKey = gameDate.toISOString().split('T')[0];
              if (!existing.some(d => d.toISOString().split('T')[0] === dateKey)) {
                const utcDate = gameDateTimeUTC.toISOString().split('T')[0];
                console.log(`[NBA Schedule] ${teamName} plays on ${dateKey} (UTC shows ${utcDate}, game: ${gameName})`);
                teamSchedules.get(teamId)!.push(gameDate);
              }
            }
          }
        }
      } catch (err) {
        console.error(`[NBA Schedule] Error fetching schedule for ${dateStr}:`, err);
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`[NBA Schedule] Fetched schedules for ${teamSchedules.size} teams`);
    return teamSchedules;
  } catch (error) {
    console.error('[NBA Schedule] Failed to fetch NBA schedule:', error);
    return new Map();
  }
}

/**
 * Get game dates for a player based on their proTeamId
 */
export function getPlayerSchedule(
  proTeamId: number,
  nbaSchedules: Map<string, Date[]>
): Date[] {
  const nbaTeamId = FANTASY_TO_NBA_TEAM_MAP[proTeamId];
  if (!nbaTeamId) {
    return [];
  }
  
  return nbaSchedules.get(nbaTeamId) || [];
}

/**
 * Cache for NBA schedules (1 hour TTL)
 */
interface ScheduleCache {
  schedules: Map<string, Date[]>;
  fetchedAt: number;
  startDate: string;
  endDate: string;
}

let scheduleCache: ScheduleCache | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Get NBA schedules with caching
 */
export async function getCachedNBASchedule(
  startDate: Date,
  endDate: Date
): Promise<Map<string, Date[]>> {
  const startKey = startDate.toISOString().split('T')[0];
  const endKey = endDate.toISOString().split('T')[0];
  
  // Check if cache is valid
  if (scheduleCache && 
      scheduleCache.startDate === startKey &&
      scheduleCache.endDate === endKey &&
      Date.now() - scheduleCache.fetchedAt < CACHE_TTL) {
    console.log('[NBA Schedule] Using cached schedule data');
    return scheduleCache.schedules;
  }
  
  // Fetch fresh data
  console.log(`[NBA Schedule] Fetching fresh schedule data for ${startKey} to ${endKey}`);
  const schedules = await fetchNBASchedule(startDate, endDate);
  
  // Update cache
  scheduleCache = {
    schedules,
    fetchedAt: Date.now(),
    startDate: startKey,
    endDate: endKey,
  };
  
  return schedules;
}

