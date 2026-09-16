'use strict';

const SPIN_RATE_OPTIONS = [16, 18, 20, 22];
const DEFAULT_SPIN_RATE = 16;

function calcSpinCost(spinRate) {
  return 250 / spinRate;
}

// 1ラウンドあたりの投入コスト（実質減算分）。フォーマット共通の基準値。
// actual(実質) = balls(表示) - ROUND_INVESTMENT * rounds
const ROUND_INVESTMENT = 10;

// ---- スペック定義（甘デジ／ミドル） ----
// 通常時（特図1）の図柄揃い振り分けと、RUSH中（電サポ）の振り分けはスペックごとに異なる。
// RUSH中の当選確率・時短/残保留の回数はスペック共通。

const SPECS = {
  amai: {
    key: 'amai',
    label: '甘デジ（1/99.9）',
    pNormalHit: 1 / 99.9,
    normalHitTypeOrder: ['odd', 'even'],
    normalHitTypes: {
      odd:  { weight: 0.50, rounds: 5, balls: 350, actual: 350 - ROUND_INVESTMENT * 5, entersRush: true,  displayPercent: 50 },
      even: { weight: 0.50, rounds: 5, balls: 350, actual: 350 - ROUND_INVESTMENT * 5, entersRush: false, displayPercent: 50 },
    },
    rushHitTypeOrder: ['big', 'small'],
    rushHitTypes: {
      big:   { weight: 0.10, rounds: 10, balls: 700, actual: 700 - ROUND_INVESTMENT * 10, displayPercent: 10 },
      small: { weight: 0.90, rounds: 3,  balls: 210, actual: 210 - ROUND_INVESTMENT * 3,  displayPercent: 90 },
    },
  },
  middle: {
    key: 'middle',
    label: 'ミドル（1/319.68）',
    pNormalHit: 1 / 319.68,
    normalHitTypeOrder: ['odd', 'even'],
    normalHitTypes: {
      odd:  { weight: 0.58, rounds: 7, balls: 700, actual: 700 - ROUND_INVESTMENT * 7, entersRush: true, displayPercent: 58 },
      even: { weight: 0.42, rounds: 3, balls: 300, actual: 300 - ROUND_INVESTMENT * 3, entersRush: true, displayPercent: 42 },
    },
    rushHitTypeOrder: ['big', 'small'],
    rushHitTypes: {
      big:   { weight: 0.20, rounds: 10, balls: 1000, actual: 1000 - ROUND_INVESTMENT * 10, displayPercent: 20 },
      small: { weight: 0.80, rounds: 3,  balls: 300,  actual: 300 - ROUND_INVESTMENT * 3,   displayPercent: 80 },
    },
  },
};
const SPEC_ORDER = ['amai', 'middle'];

function spinNormal(spec) {
  return Math.random() < spec.pNormalHit ? 'hit' : 'miss';
}

function rollNormalHitType(spec) {
  const r = Math.random();
  let cumulative = 0;
  for (const key of spec.normalHitTypeOrder) {
    cumulative += spec.normalHitTypes[key].weight;
    if (r < cumulative) return key;
  }
  return spec.normalHitTypeOrder[spec.normalHitTypeOrder.length - 1];
}

// ---- RUSH（時短6回＋残保留2個＝計8変動の1サイクル制） ----
// サイクル内で最低1回当たれば時短・残保留とも初期値にフルリセットして継続、
// 8変動すべて外れたら終了。RUSH中の当選確率・振り分けは時短/残保留どちらの
// 消化中でも同じテーブルを使う。

const P_RUSH_CHANCE = 1 / 3.99;
const RUSH_JITAN_COUNT = 6;
const RUSH_RESERVE_COUNT = 2;

function spinRushChance() {
  return Math.random() < P_RUSH_CHANCE ? 'hit' : 'miss';
}

function rollRushHitType(spec) {
  const r = Math.random();
  let cumulative = 0;
  for (const key of spec.rushHitTypeOrder) {
    cumulative += spec.rushHitTypes[key].weight;
    if (r < cumulative) return key;
  }
  return spec.rushHitTypeOrder[spec.rushHitTypeOrder.length - 1];
}

function createRushState() {
  return {
    jitanRemaining: RUSH_JITAN_COUNT,
    reserveRemaining: RUSH_RESERVE_COUNT,
    totalHits: 0,
    actualBalls: 0, // 収支計上用の実質獲得出玉の累計（表示出玉ではない）
  };
}

function applyRushChance(rushState, spec) {
  const result = spinRushChance();

  if (result === 'hit') {
    const hitType = rollRushHitType(spec);
    const info = spec.rushHitTypes[hitType];
    const newState = {
      jitanRemaining: RUSH_JITAN_COUNT,
      reserveRemaining: RUSH_RESERVE_COUNT,
      totalHits: rushState.totalHits + 1,
      actualBalls: rushState.actualBalls + info.actual,
    };
    return { rushState: newState, outcome: 'hit', hitType, balls: info.balls, actual: info.actual, rounds: info.rounds };
  }

  if (rushState.jitanRemaining > 0) {
    const newState = { ...rushState, jitanRemaining: rushState.jitanRemaining - 1 };
    // reserveRemainingは必ずjitanRemaining===0になってから消化されるため、
    // ここでreserveRemainingが同時に0になることは通常のプレイでは起こらない
    // （createRushState()からの遷移では常に成立する不変条件）。防御的な分岐として残す。
    if (newState.jitanRemaining === 0 && newState.reserveRemaining === 0) {
      return { rushState: newState, outcome: 'rush_end' };
    }
    return { rushState: newState, outcome: 'miss' };
  }

  const newState = { ...rushState, reserveRemaining: rushState.reserveRemaining - 1 };
  if (newState.reserveRemaining === 0) {
    return { rushState: newState, outcome: 'rush_end' };
  }
  return { rushState: newState, outcome: 'miss' };
}

// ---- 収支換算 ----

const BALL_TO_YEN = 4;

function ballsToYen(balls) {
  return Math.floor(balls) * BALL_TO_YEN;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SPIN_RATE_OPTIONS,
    DEFAULT_SPIN_RATE,
    calcSpinCost,
    ROUND_INVESTMENT,
    SPECS,
    SPEC_ORDER,
    spinNormal,
    rollNormalHitType,
    P_RUSH_CHANCE,
    RUSH_JITAN_COUNT,
    RUSH_RESERVE_COUNT,
    spinRushChance,
    rollRushHitType,
    createRushState,
    applyRushChance,
    BALL_TO_YEN,
    ballsToYen,
  };
}
