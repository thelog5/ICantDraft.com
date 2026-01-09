/**
 * Demo mode utilities
 * When DEMO_MODE=true, the app only uses database snapshot data
 * and never calls ESPN APIs or requires ESPN credentials
 */

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

export function requireNonDemoMode(feature: string = 'This feature'): void {
  if (isDemoMode()) {
    throw new Error(`${feature} is not available in demo mode`);
  }
}

export function getDemoConfig() {
  return {
    isDemoMode: isDemoMode(),
    demoLeagueId: process.env.DEMO_LEAGUE_ID || null,
    demoTeamId: process.env.DEMO_TEAM_ID || null,
  };
}

// Log demo mode status on module load
if (isDemoMode()) {
  console.log('🎭 DEMO MODE: ENABLED');
  console.log('   - ESPN API calls are disabled');
  console.log('   - Using database snapshot data only');
  console.log('   - Demo League ID:', process.env.DEMO_LEAGUE_ID || 'Not set');
  console.log('   - Demo Team ID:', process.env.DEMO_TEAM_ID || 'Not set');
} else {
  console.log('🔴 DEMO MODE: DISABLED (Live mode)');
}

