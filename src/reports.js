/** V18.0 — daily operating reports and recommendations. */

export function createDailyReport(state, metrics = {}) {
  const satisfaction = Math.round(metrics.satisfaction ?? 0);
  const recommendations = [];
  if (satisfaction < 50) recommendations.push("Renforcez les lignes saturées ou ajoutez un véhicule.");
  if ((metrics.avgWaitMinutes ?? 0) > 45) recommendations.push("Réduisez l'attente moyenne en augmentant la fréquence.");
  if ((metrics.abandonedCount ?? 0) > 0) recommendations.push("Analysez les arrêts où les passagers abandonnent leur trajet.");
  if ((metrics.net ?? 0) < 0) recommendations.push("Le bilan est négatif : surveillez les lignes déficitaires.");
  if (!recommendations.length) recommendations.push("Le réseau est stable : continuez à développer la couverture.");

  return {
    day: state.elapsedDays || 0,
    income: metrics.income ?? 0,
    expenses: metrics.expenses ?? 0,
    net: metrics.net ?? 0,
    satisfaction,
    arrived: metrics.arrived ?? state.totalArrived ?? 0,
    abandonedCount: metrics.abandonedCount ?? 0,
    avgWaitMinutes: metrics.avgWaitMinutes ?? 0,
    events: (metrics.events || []).map(event => event.type || event),
    contractsCompleted: metrics.contractsCompleted || 0,
    goalsCompleted: metrics.goalsCompleted || 0,
    season: metrics.season?.id || null,
    recommendations
  };
}

export function recordDailyReport(state, report, limit = 14) {
  if (!Array.isArray(state.dailyReports)) state.dailyReports = [];
  state.dailyReports.push(report);
  if (state.dailyReports.length > limit) state.dailyReports.shift();
  state.latestReport = report;
  return report;
}

export function latestReport(state) {
  return state.latestReport || state.dailyReports?.at(-1) || null;
}
