/** V2.6 — passenger agents */

export const PASSENGER_STATES = Object.freeze({
  WAITING: "WAITING",
  BOARDING: "BOARDING",
  ON_VEHICLE: "ON_VEHICLE",
  TRANSFERRING: "TRANSFERRING",
  ARRIVED: "ARRIVED",
  ABANDONED: "ABANDONED"
});

let nextPassengerId = 1;

export function createPassenger({ originId, destinationId, createdAt = 0 }) {
  return {
    id: nextPassengerId++,
    originId,
    destinationId,
    currentStopId: originId,
    state: PASSENGER_STATES.WAITING,
    itinerary: null,
    legIndex: 0,
    vehicleId: null,
    createdAt,
    waitedMinutes: 0,
    arrivedAt: null
  };
}

export function resetPassengerIds() {
  nextPassengerId = 1;
}

export function waitingPassengers(state, stopId) {
  return state.passengers.filter(p =>
    p.currentStopId === stopId && p.state === PASSENGER_STATES.WAITING
  );
}

export function passengerStats(state) {
  const counts = Object.fromEntries(Object.values(PASSENGER_STATES).map(s => [s, 0]));
  for (const p of state.passengers) counts[p.state] = (counts[p.state] || 0) + 1;
  return counts;
}

/** V3.0 — real waiting-time metrics, derived from passenger agents.
 * Replaces the legacy origin.waitingByDestination bucket (never decremented
 * since V2.3) as the basis for satisfaction and the UI's wait indicator.
 */
export function waitStats(state) {
  let waitingCount = 0;
  let waitedTotal = 0;
  let abandonedCount = 0;

  for (const p of state.passengers) {
    if (p.state === PASSENGER_STATES.WAITING || p.state === PASSENGER_STATES.TRANSFERRING) {
      waitingCount++;
      waitedTotal += p.waitedMinutes;
    } else if (p.state === PASSENGER_STATES.ABANDONED) {
      abandonedCount++;
    }
  }

  return {
    waitingCount,
    avgWaitMinutes: waitingCount ? waitedTotal / waitingCount : 0,
    abandonedCount
  };
}
