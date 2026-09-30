export const INITIAL_MONEY = 50000;

export function createState(city, scenario = null) {
  return {
    version: "14.0",
    city,
    network: null,
    money: scenario?.startingMoney ?? INITIAL_MONEY,
    time: 8 * 60,
    elapsedDays: 0,
    speed: 1,
    paused: false,
    // V9.0: null in classic/free play (all existing tests) — createState(city)
    // alone is unchanged, so nothing that omits the 2nd argument is affected.
    scenario: scenario ? { ...scenario, status: "active" } : null,
    nextLineId: 1,
    nextVehicleId: 1,
    selectedStop: null,
    lineMode: false,
    pendingStops: [],
    // V12.0 — line editing: non-null while the player is choosing new stops
    // to append to an existing line (as opposed to building a brand new one).
    extendingLineId: null,
    lines: [],
    vehicles: [],
    passengers: [],
    nextPassengerId: 1,
    transported: 0,
    totalDemand: 0,
    totalGenerated: 0,
    totalBoarded: 0,
    totalArrived: 0,
    logs: [],
    // V11.0 — per-day financial history (last 14 days), for cash-flow
    // trend display; dailyBaseline is the cumulative income/expenses total
    // recorded at the last day boundary, used to derive each day's delta.
    dailyStats: [],
    dailyBaseline: { income: 0, expenses: 0 },
    journal: [],
    showHeatmap: false,
  };
}
