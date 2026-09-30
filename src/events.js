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

export function triggerEvent(state, type, durationDays = null, log = () => {}) {
  const definition = eventType(type);
  if (!definition) return null;
  if (!state.eventsEnabled) state.eventsEnabled = true;
  const event = {
    id: state.nextEventId++, type: definition.id,
    startedDay: state.elapsedDays || 0,
    endsDay: (state.elapsedDays || 0) + (durationDays ?? definition.durationDays)
  };
  state.activeEvents = [...(state.activeEvents || []).filter(e => e.endsDay > (state.elapsedDays || 0)), event];
  state.eventHistory = [...(state.eventHistory || []), event].slice(-20);
  log(`${definition.icon} ${definition.label} : l'activité de la ville change pour ${event.endsDay - event.startedDay} jour(s).`);
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

/** Start at most one random event per day when the browser enables V15 events. */
export function startDailyEvent(state, rng, log = () => {}) {
  if (!state.eventsEnabled || activeEvents(state).length || rng() >= 0.32) return null;
  const definition = EVENT_LIST[Math.floor(rng() * EVENT_LIST.length)];
  return triggerEvent(state, definition.id, definition.durationDays, log);
}

export function eventJournal(state) {
  return eventSummary(state).map(event => ({
    type: event.satisfactionDelta >= 0 ? "positive" : "warning",
    text: `${event.icon} ${event.label} actif : demande ×${event.demandMultiplier.toFixed(2)}, encore ${event.remainingDays} jour(s).`
  }));
}

export function eventDemandMultiplier(state) { return eventEffects(state).demandMultiplier; }
export function eventFareMultiplier(state) { return eventEffects(state).fareMultiplier; }
export function eventSatisfactionDelta(state) { return eventEffects(state).satisfactionDelta; }
