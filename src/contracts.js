/** V17.0 — renewable network contracts. */

export const CONTRACT_TYPES = Object.freeze([
  { id: "ridership", label: "Plan de fréquentation", description: "Transporter 25 passagers pendant la période.", target: 25, reward: 1800, reputation: 3, metric: state => state.totalArrived },
  { id: "service", label: "Qualité de service", description: "Maintenir 65% de satisfaction.", target: 65, reward: 2200, reputation: 4, metric: (_state, metrics) => metrics.satisfaction || 0 },
  { id: "coverage", label: "Desserte urbaine", description: "Desservir au moins 35% de la population.", target: 0.35, reward: 2600, reputation: 5, metric: (_state, metrics) => metrics.coverage || 0 },
  { id: "intermodal", label: "Correspondances fluides", description: "Atteindre 10% de trajets avec correspondance.", target: 0.1, reward: 3000, reputation: 6, metric: (_state, metrics) => metrics.transferShare || 0 }
]);

export function ensureContracts(state) {
  if (!Array.isArray(state.activeContracts)) state.activeContracts = [];
  if (!Array.isArray(state.contractHistory)) state.contractHistory = [];
  if (!Number.isFinite(state.contractCycle)) state.contractCycle = 0;
  return state;
}

function selectContracts(cycle) {
  return [CONTRACT_TYPES[cycle % CONTRACT_TYPES.length], CONTRACT_TYPES[(cycle + 1) % CONTRACT_TYPES.length]];
}

export function refreshContracts(state, day = state.elapsedDays || 0) {
  ensureContracts(state);
  if (state.activeContracts.length && state.contractsEndDay > day) return false;
  state.contractCycle += 1;
  state.contractsEndDay = day + 3;
  state.activeContracts = selectContracts(state.contractCycle).map(contract => ({ id: contract.id, cycle: state.contractCycle, startedDay: day, completed: false }));
  return true;
}

export function contractSummary(state, metrics = {}) {
  ensureContracts(state);
  return state.activeContracts.map(active => {
    const type = CONTRACT_TYPES.find(contract => contract.id === active.id);
    const value = type?.metric(state, metrics) ||
 0;
    return { ...active, ...type, value, progress: Math.max(0, Math.min(1, value / type.target)), remainingDays: Math.max(0, (state.contractsEndDay || 0) - (state.elapsedDays || 0)) };
  });
}

export function evaluateContracts(state, metrics = {}, log = () => {}) {
  ensureContracts(state);
  const completed = [];
  for (const contract of contractSummary(state, metrics)) {
    const active = state.activeContracts.find(item => item.id === contract.id);
    if (!active || active.completed || contract.value < contract.target) continue;
    active.completed = true;
    state.money += contract.reward;
    state.reputation = (state.reputation || 0) + contract.reputation;
    const result = { id: contract.id, cycle: active.cycle, day: state.elapsedDays || 0, reward: contract.reward, reputation: contract.reputation };
    state.contractHistory.push(result);
    completed.push({ ...contract, result });
    log(`📜 Contrat « ${contract.label} » rempli : +${contract.reward.toLocaleString("fr-FR")} € et +${contract.reputation} réputation.`);
  }
  state.contractHistory = state.contractHistory.slice(-30);
  return completed;
}
