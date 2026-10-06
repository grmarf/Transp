/** Passenger agents and intermodal metrics. */
export const PASSENGER_STATES = Object.freeze({
  WAITING: "WAITING", BOARDING: "BOARDING", ON_VEHICLE: "ON_VEHICLE",
  TRANSFERRING: "TRANSFERRING", ARRIVED: "ARRIVED", ABANDONED: "ABANDONED"
});

let nextPassengerId = 1;

export function createPassenger({ id = null, originId, destinationId, createdAt = 0, demographic = null }) {
  return {
    // Correction : id explicite optionnel, l'appelant qui gere un compteur
    // d'etat (sauvegardes) n'ecrase plus l'id du compteur du module.
    id: id ?? nextPassengerId++, originId, destinationId, currentStopId: originId,
    state: PASSENGER_STATES.WAITING, itinerary: null, legIndex: 0,
    vehicleId: null, createdAt, waitedMinutes: 0, arrivedAt: null,
    transfersDone: 0, travelMinutes: 0, demographic
  };
}

export function resetPassengerIds() { nextPassengerId = 1; }

export function waitingPassengers(state, stopId) {
  return state.passengers.filter(p => p.currentStopId === stopId && p.state === PASSENGER_STATES.WAITING);
}

export function passengerStats(state) {
  const counts = Object.fromEntries(Object.values(PASSENGER_STATES).map(s => [s, 0]));
  for (const p of state.passengers) counts[p.state] = (counts[p.state] || 0) + 1;
  return counts;
}

export function waitStats(state) {
  let waitingCount = 0, waitedTotal = 0, abandonedCount = 0;
  for (const p of state.passengers) {
    if (p.state === PASSENGER_STATES.WAITING || p.state === PASSENGER_STATES.TRANSFERRING) {
      waitingCount++; waitedTotal += p.waitedMinutes || 0;
    } else if (p.state === PASSENGER_STATES.ABANDONED) abandonedCount++;
  }
  return { waitingCount, avgWaitMinutes: waitingCount ? waitedTotal / waitingCount : 0, abandonedCount };
}

export function intermodalStats(state) {
  let arrived = 0, totalTransfers = 0, totalTravel = 0, withTransfer = 0;
  for (const p of state.passengers) {
    if (p.state !== PASSENGER_STATES.ARRIVED) continue;
    arrived++;
    const transfers = p.transfersDone || 0;
    totalTransfers += transfers;
    totalTravel += p.travelMinutes || 0;
    if (transfers > 0) withTransfer++;
  }
  return {
    arrivedCount: arrived,
    avgTransfersPerTrip: arrived ? totalTransfers / arrived : 0,
    avgTravelMinutes: arrived ? totalTravel / arrived : 0,
    shareWithTransfer: arrived ? withTransfer / arrived : 0
  };
}
