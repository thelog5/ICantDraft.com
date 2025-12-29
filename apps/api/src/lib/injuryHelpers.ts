// Helper functions for injury status and projected games calculation

export type InjuryStatus = "ACTIVE" | "DTD" | "OUT" | "IR" | "SUSP" | "NA";

export type InjuryInfo = {
  status: InjuryStatus;
  description: string | null;
  estimatedReturnDate: string | null; // ISO date string
};

/**
 * Extracts injury information from ESPN player meta
 * ESPN stores injury data in various formats:
 * - p.injuryStatus (string or object)
 * - p.injured (boolean)
 * - p.injuryStatus.status (string)
 * - p.injuryStatus.description (string)
 * - p.injuryStatus.returnDate (string or number timestamp)
 */
export function extractInjuryInfo(playerMeta: any, lineupSlotId: number | null): InjuryInfo {
  const defaultInfo: InjuryInfo = {
    status: "ACTIVE",
    description: null,
    estimatedReturnDate: null,
  };

  // Check if player is on IL slot (lineupSlotId === 21)
  if (lineupSlotId === 21) {
    return {
      status: "IR",
      description: "On Injured List",
      estimatedReturnDate: null,
    };
  }

  // Try to extract from injuryStatus field
  const injuryStatus = playerMeta?.injuryStatus;
  
  if (!injuryStatus) {
    // Check injured boolean flag
    if (playerMeta?.injured === true) {
      return {
        status: "OUT",
        description: "Injured",
        estimatedReturnDate: null,
      };
    }
    return defaultInfo;
  }

  // Handle string format
  if (typeof injuryStatus === "string") {
    const statusUpper = injuryStatus.toUpperCase();
    let status: InjuryStatus = "ACTIVE";
    
    if (statusUpper.includes("IR") || statusUpper.includes("INJURED LIST")) {
      status = "IR";
    } else if (statusUpper.includes("OUT")) {
      status = "OUT";
    } else if (statusUpper.includes("DTD") || statusUpper.includes("DAY-TO-DAY") || statusUpper.includes("DAY TO DAY")) {
      status = "DTD";
    } else if (statusUpper.includes("SUSP")) {
      status = "SUSP";
    } else if (statusUpper === "NA" || statusUpper === "N/A") {
      status = "NA";
    }

    return {
      status,
      description: injuryStatus,
      estimatedReturnDate: null,
    };
  }

  // Handle object format
  if (typeof injuryStatus === "object" && injuryStatus !== null) {
    const statusStr = typeof injuryStatus.status === "string" 
      ? injuryStatus.status.toUpperCase() 
      : null;
    
    let status: InjuryStatus = "ACTIVE";
    if (statusStr) {
      if (statusStr.includes("IR") || statusStr.includes("INJURED LIST")) {
        status = "IR";
      } else if (statusStr.includes("OUT")) {
        status = "OUT";
      } else if (statusStr.includes("DTD") || statusStr.includes("DAY-TO-DAY")) {
        status = "DTD";
      } else if (statusStr.includes("SUSP")) {
        status = "SUSP";
      } else if (statusStr === "NA" || statusStr === "N/A") {
        status = "NA";
      }
    }

    const description = typeof injuryStatus.description === "string" 
      ? injuryStatus.description 
      : typeof injuryStatus.injury === "string"
      ? injuryStatus.injury
      : null;

    // Parse return date (could be string, number timestamp, or date object)
    let returnDate: string | null = null;
    if (injuryStatus.returnDate) {
      if (typeof injuryStatus.returnDate === "string") {
        returnDate = injuryStatus.returnDate;
      } else if (typeof injuryStatus.returnDate === "number") {
        // Assume it's a timestamp
        returnDate = new Date(injuryStatus.returnDate).toISOString();
      }
    } else if (injuryStatus.expectedReturn) {
      if (typeof injuryStatus.expectedReturn === "string") {
        returnDate = injuryStatus.expectedReturn;
      } else if (typeof injuryStatus.expectedReturn === "number") {
        returnDate = new Date(injuryStatus.expectedReturn).toISOString();
      }
    }

    return {
      status,
      description,
      estimatedReturnDate: returnDate,
    };
  }

  return defaultInfo;
}

/**
 * Calculates projected games played for a player in a given week/scoring period
 * 
 * @param teamGamesThisWeek - Number of games the player's NBA team plays in the scoring period
 * @param injuryInfo - Injury information for the player
 * @param scoringPeriodStartDate - Start date of the scoring period (ISO string)
 * @param scoringPeriodEndDate - End date of the scoring period (ISO string)
 * @returns Projected games played (0 to teamGamesThisWeek)
 */
export function calculateProjectedGamesThisWeek(
  teamGamesThisWeek: number,
  injuryInfo: InjuryInfo,
  scoringPeriodStartDate?: string,
  scoringPeriodEndDate?: string
): number {
  // IR/OUT players don't play
  if (injuryInfo.status === "IR" || injuryInfo.status === "OUT") {
    // Check if return date indicates they'll miss all games
    if (injuryInfo.estimatedReturnDate && scoringPeriodEndDate) {
      const returnDate = new Date(injuryInfo.estimatedReturnDate);
      const periodEnd = new Date(scoringPeriodEndDate);
      
      // If return date is after period end, they miss all games
      if (returnDate > periodEnd) {
        return 0;
      }
      
      // If return date is during the period, they might play some games
      // For now, conservative estimate: if return date is in second half of period, play 50% of games
      const periodStart = scoringPeriodStartDate ? new Date(scoringPeriodStartDate) : new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
      const periodDuration = periodEnd.getTime() - periodStart.getTime();
      const timeUntilReturn = returnDate.getTime() - periodStart.getTime();
      
      if (timeUntilReturn > periodDuration * 0.5) {
        // Return in second half: play 50% of games
        return Math.ceil(teamGamesThisWeek * 0.5);
      } else if (timeUntilReturn > 0) {
        // Return in first half: play most games (75%)
        return Math.ceil(teamGamesThisWeek * 0.75);
      }
      // Return date is before period start: play all games
      return teamGamesThisWeek;
    }
    
    // No return date info: assume they miss all games
    return 0;
  }

  // DTD (Day-to-Day) players: conservative reduction
  // Subtract 1 game OR apply 0.7 multiplier (whichever gives fewer games)
  // This is deterministic and documented
  if (injuryInfo.status === "DTD") {
    const subtractOne = Math.max(0, teamGamesThisWeek - 1);
    const multiplyBy07 = Math.ceil(teamGamesThisWeek * 0.7);
    return Math.min(subtractOne, multiplyBy07);
  }

  // SUSP players: typically miss all games
  if (injuryInfo.status === "SUSP") {
    return 0;
  }

  // ACTIVE or NA players: play full schedule
  return teamGamesThisWeek;
}

