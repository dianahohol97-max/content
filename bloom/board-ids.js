/**
 * bloom focus — Pinterest board name → board ID map
 * Retrieved from the hellobloomfocus Pinterest account via Make listBoards.
 * Used by the Make posting scenario to route each pin to the correct board.
 */

export const BOARD_IDS = {
  "ADHD Tips & Science":        "1143562599072621935",
  "ADHD Productivity":          "1143562599072621939",
  "ADHD Planners & Printables": "1143562599072621941",
  "ADHD Morning Routines":      "1143562599072621943",
  "Dopamine & Focus":           "1143562599072621944",
  "Neurodivergent Life":        "1143562599072621947",
};

// Fallback board if a pin's board name doesn't match
export const DEFAULT_BOARD_ID = "1143562599072621935"; // ADHD Tips & Science
