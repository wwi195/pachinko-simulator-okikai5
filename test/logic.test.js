'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../logic.js');

function withMockRandom(values, fn) {
  const original = Math.random;
  let i = 0;
  Math.random = () => values[Math.min(i++, values.length - 1)];
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test('SPIN_RATE_OPTIONS lists the four selectable rates with 16 as default', () => {
  assert.deepEqual(logic.SPIN_RATE_OPTIONS, [16, 18, 20, 22]);
  assert.equal(logic.DEFAULT_SPIN_RATE, 16);
});

test('calcSpinCost returns balls-per-spin for a given spins-per-1000-yen rate', () => {
  assert.equal(logic.calcSpinCost(16), 250 / 16);
  assert.equal(logic.calcSpinCost(22), 250 / 22);
});

test('SPEC_ORDER lists amai then middle', () => {
  assert.deepEqual(logic.SPEC_ORDER, ['amai', 'middle']);
});

test('amai spec: pNormalHit is 1/99.9, normal hit types are odd/even 50/50 at 5R/350 each, only odd enters rush', () => {
  const spec = logic.SPECS.amai;
  assert.equal(spec.pNormalHit, 1 / 99.9);
  assert.deepEqual(spec.normalHitTypeOrder, ['odd', 'even']);
  assert.deepEqual(spec.normalHitTypes.odd,  { weight: 0.5, rounds: 5, balls: 350, actual: 300, entersRush: true,  displayPercent: 50 });
  assert.deepEqual(spec.normalHitTypes.even, { weight: 0.5, rounds: 5, balls: 350, actual: 300, entersRush: false, displayPercent: 50 });
});

test('amai spec: rush hit types are big(10R/700/10%) and small(3R/210/90%)', () => {
  const spec = logic.SPECS.amai;
  assert.deepEqual(spec.rushHitTypeOrder, ['big', 'small']);
  assert.deepEqual(spec.rushHitTypes.big,   { weight: 0.10, rounds: 10, balls: 700, actual: 600, displayPercent: 10 });
  assert.deepEqual(spec.rushHitTypes.small, { weight: 0.90, rounds: 3,  balls: 210, actual: 180, displayPercent: 90 });
});

test('middle spec: pNormalHit is 1/319.68, odd=7R/700/58%(rush) even=3R/300/42%(rush), both enter rush', () => {
  const spec = logic.SPECS.middle;
  assert.equal(spec.pNormalHit, 1 / 319.68);
  assert.deepEqual(spec.normalHitTypes.odd,  { weight: 0.58, rounds: 7, balls: 700, actual: 630, entersRush: true, displayPercent: 58 });
  assert.deepEqual(spec.normalHitTypes.even, { weight: 0.42, rounds: 3, balls: 300, actual: 270, entersRush: true, displayPercent: 42 });
});

test('middle spec: rush hit types are big(10R/1000/20%) and small(3R/300/80%)', () => {
  const spec = logic.SPECS.middle;
  assert.deepEqual(spec.rushHitTypes.big,   { weight: 0.20, rounds: 10, balls: 1000, actual: 900, displayPercent: 20 });
  assert.deepEqual(spec.rushHitTypes.small, { weight: 0.80, rounds: 3,  balls: 300,  actual: 270, displayPercent: 80 });
});

test('spinNormal returns hit under spec.pNormalHit, miss otherwise', () => {
  const spec = logic.SPECS.amai;
  assert.equal(withMockRandom([0], () => logic.spinNormal(spec)), 'hit');
  assert.equal(withMockRandom([0.5], () => logic.spinNormal(spec)), 'miss');
});

test('rollNormalHitType picks odd under 50%, even otherwise (amai)', () => {
  const spec = logic.SPECS.amai;
  assert.equal(withMockRandom([0],    () => logic.rollNormalHitType(spec)), 'odd');
  assert.equal(withMockRandom([0.49], () => logic.rollNormalHitType(spec)), 'odd');
  assert.equal(withMockRandom([0.5],  () => logic.rollNormalHitType(spec)), 'even');
  assert.equal(withMockRandom([0.99], () => logic.rollNormalHitType(spec)), 'even');
});

test('rollNormalHitType picks odd under 58%, even otherwise (middle)', () => {
  const spec = logic.SPECS.middle;
  assert.equal(withMockRandom([0.57], () => logic.rollNormalHitType(spec)), 'odd');
  assert.equal(withMockRandom([0.58], () => logic.rollNormalHitType(spec)), 'even');
});

test('P_RUSH_CHANCE is 1/3.99, RUSH_JITAN_COUNT is 6, RUSH_RESERVE_COUNT is 2', () => {
  assert.equal(logic.P_RUSH_CHANCE, 1 / 3.99);
  assert.equal(logic.RUSH_JITAN_COUNT, 6);
  assert.equal(logic.RUSH_RESERVE_COUNT, 2);
});

test('spinRushChance returns hit when the draw beats P_RUSH_CHANCE, miss otherwise', () => {
  assert.equal(withMockRandom([0], () => logic.spinRushChance()), 'hit');
  assert.equal(withMockRandom([0.5], () => logic.spinRushChance()), 'miss');
});

test('rollRushHitType picks big under weight threshold, small otherwise (middle)', () => {
  const spec = logic.SPECS.middle;
  assert.equal(withMockRandom([0],    () => logic.rollRushHitType(spec)), 'big');
  assert.equal(withMockRandom([0.19], () => logic.rollRushHitType(spec)), 'big');
  assert.equal(withMockRandom([0.2],  () => logic.rollRushHitType(spec)), 'small');
  assert.equal(withMockRandom([0.99], () => logic.rollRushHitType(spec)), 'small');
});

test('createRushState starts with a fresh 6/2 cycle and zeroed counters', () => {
  assert.deepEqual(logic.createRushState(), {
    jitanRemaining: 6,
    reserveRemaining: 2,
    totalHits: 0,
    actualBalls: 0,
  });
});

test('applyRushChance: a miss with jitan remaining decrements jitanRemaining only', () => {
  const spec = logic.SPECS.middle;
  const state = logic.createRushState();
  const { rushState, outcome } = withMockRandom([0.5], () => logic.applyRushChance(state, spec));
  assert.equal(outcome, 'miss');
  assert.deepEqual(rushState, { jitanRemaining: 5, reserveRemaining: 2, totalHits: 0, actualBalls: 0 });
});

test('applyRushChance: a miss on the last jitan spin (1->0) is still just a miss while reserve remains', () => {
  const spec = logic.SPECS.middle;
  const state = { jitanRemaining: 1, reserveRemaining: 2, totalHits: 0, actualBalls: 0 };
  const { rushState, outcome } = withMockRandom([0.5], () => logic.applyRushChance(state, spec));
  assert.equal(outcome, 'miss');
  assert.deepEqual(rushState, { jitanRemaining: 0, reserveRemaining: 2, totalHits: 0, actualBalls: 0 });
});

test('applyRushChance: once jitan is exhausted, a miss decrements reserveRemaining instead', () => {
  const spec = logic.SPECS.middle;
  const state = { jitanRemaining: 0, reserveRemaining: 2, totalHits: 0, actualBalls: 0 };
  const { rushState, outcome } = withMockRandom([0.5], () => logic.applyRushChance(state, spec));
  assert.equal(outcome, 'miss');
  assert.deepEqual(rushState, { jitanRemaining: 0, reserveRemaining: 1, totalHits: 0, actualBalls: 0 });
});

test('applyRushChance: a miss on the very last reserve chance ends the RUSH', () => {
  const spec = logic.SPECS.middle;
  const state = { jitanRemaining: 0, reserveRemaining: 1, totalHits: 0, actualBalls: 0 };
  const { rushState, outcome } = withMockRandom([0.5], () => logic.applyRushChance(state, spec));
  assert.equal(outcome, 'rush_end');
  assert.equal(rushState.reserveRemaining, 0);
});

test('applyRushChance: a hit rolls a bonus type, returns balls(表示)/actual(実質)/rounds, resets to 6/2, and accumulates actual', () => {
  const spec = logic.SPECS.middle;
  const state = { jitanRemaining: 3, reserveRemaining: 2, totalHits: 2, actualBalls: 900 };
  // draws: [0]=spinRushChance hit, [0]=rollRushHitType->'big' (1000表示/900実質/10R)
  const { rushState, outcome, hitType, balls, actual, rounds } =
    withMockRandom([0, 0], () => logic.applyRushChance(state, spec));
  assert.equal(outcome, 'hit');
  assert.equal(hitType, 'big');
  assert.equal(balls, 1000);
  assert.equal(actual, 900);
  assert.equal(rounds, 10);
  assert.deepEqual(rushState, { jitanRemaining: 6, reserveRemaining: 2, totalHits: 3, actualBalls: 1800 });
});

test('applyRushChance: a hit during the reserve phase uses the same rush hit table as jitan phase', () => {
  const spec = logic.SPECS.amai;
  const state = { jitanRemaining: 0, reserveRemaining: 2, totalHits: 0, actualBalls: 0 };
  // draws: [0]=spinRushChance hit, [0]=rollRushHitType->'big' (700表示/600実質/10R)
  const { outcome, hitType, balls, actual } = withMockRandom([0, 0], () => logic.applyRushChance(state, spec));
  assert.equal(outcome, 'hit');
  assert.equal(hitType, 'big');
  assert.equal(balls, 700);
  assert.equal(actual, 600);
});

test('BALL_TO_YEN is 4', () => {
  assert.equal(logic.BALL_TO_YEN, 4);
});

test('ballsToYen floors fractional balls then converts at 4 yen/ball', () => {
  assert.equal(logic.ballsToYen(1000), 4000);
  assert.equal(logic.ballsToYen(250.7), 1000);
  assert.equal(logic.ballsToYen(0), 0);
});
