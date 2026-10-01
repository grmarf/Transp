/** V19.0 — seasonal city calendar. */

export const SEASONS = Object.freeze([
  { id: "spring", label: "Printemps", icon: "🌱", demandMultiplier: 1.05, fareMultiplier: 1.00, growthMultiplier: 1.04 },
  { id: "summer", label: "Été", icon: "☀", demandMultiplier: 1.18, fareMultiplier: 1.05, growthMultiplier: 1.02 },
  { id: "autumn", label: "Automne", icon: "🍂", demandMultiplier: 0.95, fareMultiplier: 1.00, growthMultiplier: 0.99 },
  { id: "winter", label: "Hiver", icon: "❄", demandMultiplier: 0.82, fareMultiplier: 1.08, growthMultiplier: 0.96 }
]);

const DAYS_PER_SEASON = 7;

export function seasonAtDay(day = 0) {
  return SEASONS[Math.floor(Math.max(0, day) / DAYS_PER_SEASON) % SEASONS.length];
}

export function currentSeason(state) {
  return seasonAtDay(state?.elapsedDays || 0);
}

function enabled(state) { return !!state?.seasonsEnabled; }

export function seasonDemandMultiplier(state) { return enabled(state) ? currentSeason(state).demandMultiplier : 1; }
export function seasonFareMultiplier(state) { return enabled(state) ? currentSeason(state).fareMultiplier : 1; }
export function seasonGrowthMultiplier(state) { return enabled(state) ? currentSeason(state).growthMultiplier : 1; }

export function seasonSummary(state) {
  const season = currentSeason(state);
  const dayInSeason = (state?.elapsedDays || 0) % DAYS_PER_SEASON;
  return { ...season, dayInSeason: dayInSeason + 1, daysRemaining: DAYS_PER_SEASON - dayInSeason };
}

export function applySeasonalGrowth(state) {
  if (!enabled(state)) return;
  const factor = seasonGrowthMultiplier(state);
  for (const stop of state.city.stops) {
    stop.population = Math.max(1, Math.round(stop.population * factor));
    stop.jobs = Math.max(1, Math.round(stop.jobs * factor));
    stop.commerce = Math.max(1, Math.round(stop.commerce * factor));
    stop.density = Math.max(1, Math.round(stop.density * factor));
  }
}
