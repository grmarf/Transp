import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { generateDemand } from '../src/engine.js';
import { createDailyReport } from '../src/reports.js';
import { applySeasonalGrowth, currentSeason, seasonAtDay, seasonDemandMultiplier, seasonFareMultiplier, seasonSummary } from '../src/seasons.js';

assert.equal(seasonAtDay(0).id, 'spring');
assert.equal(seasonAtDay(7).id, 'summer');
assert.equal(seasonAtDay(14).id, 'autumn');
assert.equal(seasonAtDay(21).id, 'winter');
assert.equal(seasonAtDay(28).id, 'spring');

const cityA = createCity('V19-DEMAND');
const baseline = createState(cityA);
const summer = createState(createCity('V19-DEMAND'));
summer.seasonsEnabled = true;
summer.elapsedDays = 7;
assert.equal(currentSeason(summer).id, 'summer');
assert.equal(seasonDemandMultiplier(summer), 1.18);
assert.equal(seasonFareMultiplier(summer), 1.05);
const random = () => 0.5;
generateDemand(baseline, random);
generateDemand(summer, random);
assert.ok(Math.abs(summer.totalGenerated / baseline.totalGenerated - 1.18) < 0.000001);

const populationBefore = summer.city.stops[0].population;
applySeasonalGrowth(summer);
assert.ok(summer.city.stops[0].population > populationBefore);
const summary = seasonSummary(summer);
assert.equal(summary.dayInSeason, 1);
assert.equal(summary.daysRemaining, 7);

const report = createDailyReport(summer, { season: summary, satisfaction: 80, net: 10 });
assert.equal(report.season, 'summer');

console.log(JSON.stringify({ ok: true, season: summary.id, demandMultiplier: seasonDemandMultiplier(summer) }));
