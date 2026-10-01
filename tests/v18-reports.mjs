import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { createDailyReport, latestReport, recordDailyReport } from '../src/reports.js';

const state = createState(createCity('V18-REPORTS'));
const warning = createDailyReport(state, {
  income: 100, expenses: 250, net: -150, satisfaction: 35,
  arrived: 10, abandonedCount: 4, avgWaitMinutes: 70,
  events: [{ type: 'strike' }], contractsCompleted: 1, goalsCompleted: 2
});
assert.equal(warning.day, 0);
assert.equal(warning.net, -150);
assert.equal(warning.events[0], 'strike');
assert.equal(warning.recommendations.length, 4);

recordDailyReport(state, warning);
assert.equal(latestReport(state), warning);
for (let day = 1; day <= 15; day++) {
  state.elapsedDays = day;
  recordDailyReport(state, createDailyReport(state, { income: day, expenses: 0, net: day, satisfaction: 80 }));
}
assert.equal(state.dailyReports.length, 14);
assert.equal(state.dailyReports[0].day, 2);
assert.equal(latestReport(state).day, 15);
assert.equal(latestReport(state).recommendations.length, 1);

console.log(JSON.stringify({ ok: true, retained: state.dailyReports.length, latestDay: latestReport(state).day }));
