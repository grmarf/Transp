/** V15.0 — dynamic urban events. */

export const EVENT_TYPES = Object.freeze({
  FESTIVAL: { id: "festival", label: "Festival", icon: "🎪", demandMultiplier: 1.55, fareMultiplier: 1.10, satisfactionDelta: 5, durationDays: 2 },
  MARKET: { id: "market", label: "Marché central", icon: "🛍", demandMultiplier: 1.30, fareMultiplier: 1.05, satisfactionDelta: 2, durationDays: 1 },
  STRIKE: { id: "strike", label: "Mouvement social", icon: "⚠", demandMultiplier: 0.55, fareMultiplier: 0.95, satisfactionDelta: -8, durationDays: 2 },
  HEATWAVE: { id: "heatwave", label: "Canicule", icon: "☀", demandMultiplier: 0.80, fareMultiplier: 1.00, satisfactionDelta: -3, durationDays: 1 }
});

const EVENT_LIST = Object.values(EVENT_TYPES);

function eventType(type) {
  return EVENT_LIST.find(candidate => candidate.id === type) || null;
}

export function activeEvents(state) {
  if (!state?.eventsEnabled) return [];
  return (state.activeEvents || []).filter(event => event.endsDay > (state.elapsedDays || 0));
}

export function eventEffects(state) {
  const events = activeEvents(state);
  return events.reduce((effects, event) => {
    const type = eventType(event.type);
    if (!type) return effects;
    effects.demandMultiplier *= type.demandMultiplier;
    effects.fareMultiplier *= type.fareMultiplier;
    effects.satisfactionDelta += type.satisfactionDelta;
    return effects;
  }, { demandMultiplier: 1, fareMultiplier: 1, satisfactionDelta: 0 });
}

export function eventSummary(state) {
  return activeEvents(state).map(event => {
    const type = eventType(event.type);
    return {
      ...event,
      label: type?.label || event.type,
      icon: type?.icon || "•",
      remainingDays: Math.max(0, event.endsDay - (state.elapsedDays || 0)),
      demandMultiplier: type?.demandMultiplier || 1,
      fareMultiplier: type?.fareMultiplier || 1,
      satisfactionDelta: type?.satisfactionDelta || 0
    };
  });
}

export function triggerEvent(state, type, durationDays = null, log = () => {}, cause = "manual") {
  const definition = eventType(type);
  if (!definition) return null;
  if (!state.eventsEnabled) state.eventsEnabled = true;
  const event = {
    id: state.nextEventId++, type: definition.id,
    startedDay: state.elapsedDays || 0,
    endsDay: (state.elapsedDays || 0) + (durationDays ?? definition.durationDays),
    cause
  };
  state.activeEvents = [...(state.activeEvents || []).filter(e => e.endsDay > (state.elapsedDays || 0)), event];
  state.eventHistory = [...(state.eventHistory || []), event].slice(-20);
  // V20.1 — cooldown étendu à endsDay + 2 : à endsDay + 1 l’événement venait
  // d’expirer et se redéclenchait immédiatement (grèves en boucle).
  state.eventCooldownUntil = Math.max(state.eventCooldownUntil || 0, event.endsDay + 2);
  log(`${definition.icon} ${definition.label} : l'activité de la ville change pour ${event.endsDay - event.startedDay} jour(s).${cause !== "manual" ? ` Cause : ${cause}.` : ""}`);
  return event;
}

export function finishExpiredEvents(state, log = () => {}) {
  const before = state.activeEvents || [];
  const active = before.filter(event => event.endsDay > (state.elapsedDays || 0));
  for (const event of before) {
    if (event.endsDay <= (state.elapsedDays || 0)) {
      const definition = eventType(event.type);
      log(`${definition?.icon || "•"} ${definition?.label || event.type} est terminé.`);
    }
  }
  state.activeEvents = active;
  return before.length - active.length;
}

/**
 * V15.1 — choose an event from the network's actual health rather than a
 * blind random roll. A short cooldown prevents event churn after expiry.
 */
export function startContextualEvent(state, rng, log = () => {}, metrics = {}) {
  if (!state.eventsEnabled || activeEvents(state).length) return null;
  if ((state.eventCooldownUntil || 0) > (state.elapsedDays || 0)) return null;

  const satisfaction = metrics.satisfaction ?? 50;
  const abandonedRate = metrics.abandonedRate ?? 0;
  const serviceRatio = metrics.serviceRatio ?? 0;
  let type = null;
  let cause = "conditions urbaines normales";

  if (satisfaction <= 25 || abandonedRate >= 0.35) {
    type = EVENT_TYPES.STRIKE;
    cause = satisfaction <= 25 ? "satisfaction réseau très faible" : "trop de passagers abandonnent leur trajet";
  } else if (satisfaction >= 78 && serviceRatio >= 0.35) {
    type = EVENT_TYPES.FESTIVAL;
    cause = "réseau performant et satisfaction élevée";
  } else if (serviceRatio >= 0.20 && rng() < 0.45) {
    type = EVENT_TYPES.MARKET;
    cause = "fréquentation suffisante pour soutenir un marché central";
  } else if (rng() < 0.08) {
    type = EVENT_TYPES.HEATWAVE;
    cause = "variation climatique saisonnière";
  }
  return type ? triggerEvent(state, type.id, type.durationDays, log, cause) : null;
}

// Kept as a compatibility alias for integrations written against V15.0.
export const startDailyEvent = startContextualEvent;

export function eventJournal(state) {
  return eventSummary(state).map(event => ({
    type: event.satisfactionDelta >= 0 ? "positive" : "warning",
    text: `${event.icon} ${event.label} actif : demande ×${event.demandMultiplier.toFixed(2)}, encore ${event.remainingDays} jour(s).${event.cause && event.cause !== "manual" ? ` Cause : ${event.cause}.` : ""}`
  }));
}

export function eventDemandMultiplier(state) { return eventEffects(state).demandMultiplier; }
export function eventFareMultiplier(state) { return eventEffects(state).fareMultiplier; }
export function eventSatisfactionDelta(state) { return eventEffects(state).satisfactionDelta; }
