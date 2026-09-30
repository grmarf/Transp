/** V16.0 — persistent network progression and milestone rewards. */

export const PROGRESSION_GOALS = Object.freeze([
  { id: "first-line", label: "Première ligne", description: "Créer une première ligne de transport.", reward: 2000, reputation: 5, test: state => state.lines.length >= 1, progress: state => Math.min(1, state.lines.length) },
  { id: "ridership-100", label: "Premiers 100 passagers", description: "Transporter 100 passagers jusqu'à destination.", reward: 3000, reputation: 8, test: state => state.totalArrived >= 100, progress: state => Math.min(1, state.totalArrived / 100) },
  { id: "network-builder", label: "Bâtisseur de réseau", description: "Exploiter au moins trois lignes.", reward: 5000, reputation: 10, test: state => state.lines.length >= 3, progress: state => Math.min(1, state.lines.length / 3) },
  { id: "intermodal-city", label: "Ville intermodale", description: "Faire fonctionner au moins une correspondance.", reward: 4500, reputation: 10, test: (_state, metrics) => (metrics.transferShare || 0) >= 0.1, progress: (_state, metrics) => Math.min(1, (metrics.transferShare || 0) / 0.1) },
  { id: "happy-city", label: "Ville satisfaite", description: "Atteindre 75% de satisfaction réseau.", reward: 6000, reputation: 15, test: (_state, metrics) => (metrics.satisfaction || 0) >= 75, progress: (_state, metrics) => Math.min(1, (metrics.satisfaction || 0) / 75) },
  { id: "metro-pioneer", label: "Pionnier du métro", description: "Ouvrir une ligne de métro.", reward: 7500, reputation: 20, test: state => state.lines.some(line => line.mode === "metro"), progress: state => state.lines.some(line => line.mode === "metro") ? 1 : 0 }
]);

export function ensureProgression(state) {
  if (!Array.isArray(state.completedGoals)) state.completedGoals = [];
  if (!Array.isArray(state.progressionHistory)) state.progressionHistory = [];
  if (!Number.isFinite(state.reputation)) state.reputation = 0;
  return state;
}

export function progressionRank(reputation = 0) {
  if (reputation >= 50) return "Icône de la ville";
  if (reputation >= 30) return "Opérateur reconnu";
  if (reputation >= 15) return "Gestionnaire apprécié";
  if (reputation >= 5) return "Opérateur débutant";
  return "Nouveau venu";
}

export function evaluateProgression(state, metrics = {}, log = () => {}) {
  ensureProgression(state);
  const unlocked = [];
  for (const goal of PROGRESSION_GOALS) {
    if (state.completedGoals.includes(goal.id) || !goal.test(state, metrics)) continue;
    state.completedGoals.push(goal.id);
    state.reputation += goal.reputation;
    const completion = { id: goal.id, day: state.elapsedDays || 0, reward: goal.reward, reputation: goal.reputation };
    state.progressionHistory.push(completion);
    state.money += goal.reward;
    unlocked.push({ ...goal, completion });
    log(`🏆 Objectif « ${goal.label} » atteint : +${goal.reward.toLocaleString("fr-FR")} € et +${goal.reputation} réputation.`);
  }
  return unlocked;
}

export function progressionSummary(state, metrics = {}) {
  ensureProgression(state);
  return {
    reputation: state.reputation,
    rank: progressionRank(state.reputation),
    completed: state.completedGoals.length,
    total: PROGRESSION_GOALS.length,
    goals: PROGRESSION_GOALS.map(goal => ({
      ...goal,
      completed: state.completedGoals.includes(goal.id),
      progress: Math.max(0, Math.min(1, goal.progress(state, metrics)))
    }))
  };
}
