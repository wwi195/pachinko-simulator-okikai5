'use strict';

const game = {
  state: 'spec_select',
  specKey: null,
  mode: 'normal',
  spinRate: DEFAULT_SPIN_RATE,
  mochiDama: 0,
  toushi: 0,
  totalSpins: 0,
  currentSpins: 0,
  lastHitSpins: 0,
  normalHitCounts: { odd: 0, even: 0 },
  rushEntryCount: 0,
  totalRushHits: 0,
  rushHitCounts: { big: 0, small: 0 },
  rushSessionHitCounts: { big: 0, small: 0 },
  rushEntryBalls: 0, // RUSH突入契機（初当たり）の実質獲得出玉
  rushCycleSpins: 0, // 直近のRUSH突入/当選から何回転目か
  allRushStats: { rushTotalSpins: 0 },
  rush: null,
  pending: {},
  log: [],
};

function currentSpec() {
  return SPECS[game.specKey];
}

function addLog(text, type = '') {
  game.log.unshift({ text, type });
  if (game.log.length > 50) game.log.pop();
  renderLog();
}

// ---- 球数・投資 ----

function consumeSpinCost() {
  const cost = calcSpinCost(game.spinRate);
  if (game.mochiDama >= cost) {
    game.mochiDama -= cost;
  } else {
    const shortfall = cost - game.mochiDama;
    game.mochiDama = 0;
    const units = Math.ceil(shortfall / 250);
    game.toushi += units * 1000;
    game.mochiDama = units * 250 - shortfall;
  }
}

function addBalls(n) {
  game.mochiDama += n;
}

function handleSpinRateChange(value) {
  game.spinRate = Number(value);
  render();
}

// ---- スペック選択 ----

function handleSpecSelect(key) {
  game.specKey = key;
  setState('normal_idle');
}

// ---- 通常時ハンドラ ----

// 1回転処理。演出発生など画面遷移が起きたら true を返す
function runNormalSpin() {
  const spec = currentSpec();
  game.totalSpins++;
  game.currentSpins++;
  consumeSpinCost();
  const result = spinNormal(spec);

  if (result === 'hit') {
    const typeKey = rollNormalHitType(spec);
    const info = spec.normalHitTypes[typeKey];
    game.normalHitCounts[typeKey]++;
    addBalls(info.actual); // 収支には実質獲得出玉を計上
    game.currentSpins = 0;
    game.lastHitSpins = game.totalSpins;
    game.pending = {
      typeKey, rounds: info.rounds, balls: info.balls, actual: info.actual,
      entersRush: info.entersRush, displayPercent: info.displayPercent,
    };
    const label = typeKey === 'odd' ? '奇数揃い' : '偶数揃い';
    addLog(`${label}！ ＋${info.balls}球`, 'win');
    setState('hit_result');
    return true;
  }

  return false;
}

function handleStart() {
  if (!runNormalSpin()) {
    setState('lose_result');
  }
}

function autoSpin(count) {
  for (let i = 0; i < count; i++) {
    if (runNormalSpin()) return;
  }
  setState('normal_idle');
}

function handleHitContinue() {
  if (game.pending.entersRush) {
    game.rush = createRushState();
    game.rushSessionHitCounts = { big: 0, small: 0 };
    game.rushEntryBalls = game.pending.actual; // 初当たりの実質獲得出玉をRUSH側の総獲得出玉に持ち越す
    game.rushCycleSpins = 0;
    game.mode = 'rush';
    game.rushEntryCount++;
    addLog('超旋風RUSH突入！', 'rush');
    setState('rush_idle');
  } else {
    backToNormal();
  }
}

function backToNormal() {
  game.mode = 'normal';
  setState('normal_idle');
}

// ---- 超旋風RUSH中ハンドラ ----
// 1サイクル=時短6変動＋残保留（ファイナルチャンス）2個=計8変動。
// サイクル内で1回でも当たればフルリセットして継続、8変動全て外れたら終了。

// 1チャンス消化して game の集計を更新する。画面遷移はここでは行わない。
function resolveRushSpin() {
  const spec = currentSpec();
  game.allRushStats.rushTotalSpins++;
  game.rushCycleSpins++;
  const wasFinalChance = game.rush.jitanRemaining === 0;
  const { rushState, outcome, hitType, balls, rounds, actual } = applyRushChance(game.rush, spec);
  game.rush = rushState;

  if (outcome === 'hit') {
    game.totalRushHits++;
    game.rushHitCounts[hitType]++;
    game.rushSessionHitCounts[hitType]++;
    addBalls(actual); // 収支には実質獲得出玉を計上
    addLog(`${rounds}R！ ＋${balls}球`, 'rush'); // 表示出玉は今まで通り
  } else if (outcome === 'rush_end') {
    addLog('超旋風RUSH終了 → リザルトへ');
  }

  return { outcome, hitType, balls, rounds, wasFinalChance, spinsThisCycle: game.rushCycleSpins };
}

// hit/rush_end なら画面遷移して true、miss なら何もせず false を返す
function finishRushSpin(result) {
  if (result.outcome === 'hit') {
    const spec = currentSpec();
    const hitPercent = spec.rushHitTypes[result.hitType].displayPercent;
    game.pending = {
      hitType: result.hitType, balls: result.balls, rounds: result.rounds,
      spinsThisCycle: result.spinsThisCycle, hitPercent, wasFinalChance: result.wasFinalChance,
    };
    game.rushCycleSpins = 0;
    setState('rush_hit_result');
    return true;
  }
  if (result.outcome === 'rush_end') {
    setState('rush_result');
    return true;
  }
  return false;
}

// 時短中「1回転」ボタン。
function handleRushSpin() {
  const result = resolveRushSpin();
  if (!finishRushSpin(result)) {
    setState('rush_idle');
  }
}

// ファイナルチャンス「PUSH」ボタン。保留1個を消費して即座に当否を表示する。
function handleFinalChancePush() {
  const result = resolveRushSpin();
  if (!finishRushSpin(result)) {
    setState('rush_idle');
  }
}

function handleRushHitContinue() {
  setState('rush_idle');
}

// applyRushChance（logic.js）は最大8回の外れで必ずhitかrush_endに解決するため、
// この無限ループは有限回で終了する。
function handleRushSkip() {
  for (;;) {
    const result = resolveRushSpin();
    if (result.outcome !== 'miss') {
      finishRushSpin(result);
      return;
    }
  }
}

function handleRushResultEnd() {
  addLog('超旋風RUSH終了 → 通常時へ');
  game.mode = 'normal';
  game.rush = null;
  setState('normal_idle');
}

// ---- 退店・リセット ----

function handleTaiten() {
  setState('taiten_result');
}

function resetGame() {
  game.state = 'spec_select';
  game.specKey = null;
  game.mode = 'normal';
  game.spinRate = DEFAULT_SPIN_RATE;
  game.mochiDama = 0;
  game.toushi = 0;
  game.totalSpins = 0;
  game.currentSpins = 0;
  game.lastHitSpins = 0;
  game.normalHitCounts = { odd: 0, even: 0 };
  game.rushEntryCount = 0;
  game.totalRushHits = 0;
  game.rushHitCounts = { big: 0, small: 0 };
  game.rushSessionHitCounts = { big: 0, small: 0 };
  game.rushEntryBalls = 0;
  game.rushCycleSpins = 0;
  game.allRushStats = { rushTotalSpins: 0 };
  game.rush = null;
  game.pending = {};
  game.log = [];
  render();
}

// ---- 状態セット & レンダリング ----

function setState(state) {
  game.state = state;
  render();
}

function render() {
  renderHeader();
  renderModeBadge();
  renderMainScreen();
  renderRushStats();
}

function renderHeader() {
  const mochiInt = Math.floor(game.mochiDama);
  document.getElementById('mochi-dama').textContent = mochiInt.toLocaleString();
  document.getElementById('toushi-value').textContent = game.toushi.toLocaleString();

  const shuushi = game.mochiDama > 0 ? Math.floor(game.mochiDama) * 4 - game.toushi : -game.toushi;
  const shuushiEl = document.getElementById('shuushi-value');
  shuushiEl.textContent = (shuushi >= 0 ? '+' : '') + shuushi.toLocaleString();
  shuushiEl.className = 'money-value ' + (shuushi >= 0 ? 'green' : 'red');

  document.getElementById('current-spins').textContent = game.currentSpins.toLocaleString();
  document.getElementById('total-spins-disp').textContent = game.totalSpins.toLocaleString();
  document.getElementById('fee-block').textContent = `${game.spinRate}回転/千円`;

  const rushCountEl = document.getElementById('rush-count');
  if (game.mode === 'rush') {
    rushCountEl.textContent = game.rush.jitanRemaining > 0
      ? `${game.rush.jitanRemaining}／${game.rush.reserveRemaining}`
      : `－／${game.rush.reserveRemaining}`;
  } else {
    rushCountEl.textContent = '－';
  }

  const normalFirstHit = game.normalHitCounts.odd + game.normalHitCounts.even;
  document.getElementById('normal-first-hit').textContent = normalFirstHit + '回';
  document.getElementById('normal-first-prob').textContent = normalFirstHit > 0 && game.totalSpins > 0
    ? '1/' + Math.round(game.totalSpins / normalFirstHit).toLocaleString()
    : '1/―';

  const rushRate = normalFirstHit > 0
    ? Math.round(game.rushEntryCount / normalFirstHit * 100)
    : 0;
  document.getElementById('rush-entry-info').textContent =
    `(超旋風RUSH突入${game.rushEntryCount}回・${rushRate}%)`;

  const totalHitCount = normalFirstHit + game.totalRushHits;
  document.getElementById('total-hit-count').textContent = totalHitCount + '回';
}

function renderModeBadge() {
  const el = document.getElementById('mode-badge');
  if (game.mode === 'rush' && game.rush) {
    if (game.rush.jitanRemaining > 0) {
      el.textContent = '超旋風RUSH中';
      el.className = 'rush';
    } else {
      el.textContent = 'ファイナルチャンス';
      el.className = 'final';
    }
  } else {
    el.textContent = '通常時';
    el.className = '';
  }
}

function renderMainScreen() {
  document.getElementById('main-screen').innerHTML = buildScreen(game.state);
}

function renderRushStats() {
  const h = game.rushHitCounts;
  document.getElementById('rs-hits').textContent = game.totalRushHits + '回';
  document.getElementById('rs-spins').textContent = game.allRushStats.rushTotalSpins + '回';
  document.getElementById('rs-big').textContent = h.big + '回';
  document.getElementById('rs-small').textContent = h.small + '回';
}

function renderLog() {
  const el = document.getElementById('log-list');
  el.innerHTML = game.log.map(item =>
    `<div class="log-item ${item.type}">${item.text}</div>`
  ).join('');
}

function spinRateOptionsHtml() {
  return SPIN_RATE_OPTIONS.map(rate =>
    `<option value="${rate}" ${rate === game.spinRate ? 'selected' : ''}>${rate}回転</option>`
  ).join('');
}

function tenThousandYenSpins() {
  return game.spinRate * 10;
}

function buildScreen(state) {
  switch (state) {

    case 'spec_select': {
      return `<div class="screen spec-select-screen">
        <p class="spec-select-title">スペックを選択してください</p>
        <button class="spec-btn" onclick="handleSpecSelect('amai')">
          <span class="spec-btn-name">${SPECS.amai.label}</span>
          <span class="spec-btn-sub">RUSH突入率 50%／時短6回＋残保留2個</span>
        </button>
        <button class="spec-btn" onclick="handleSpecSelect('middle')">
          <span class="spec-btn-name">${SPECS.middle.label}</span>
          <span class="spec-btn-sub">RUSH突入率 100%／時短6回＋残保留2個</span>
        </button>
      </div>`;
    }

    case 'normal_idle': {
      const spec = currentSpec();
      return `<div class="screen">
        <button class="btn-start" onclick="handleStart()">START</button>
        <p class="prob-hint">大当たり確率 1/${(1 / spec.pNormalHit).toFixed(spec.key === 'middle' ? 2 : 1)}（${spec.label.split('（')[0]}）</p>
        <div class="spin-rate-block">
          <span class="spin-rate-label">1000円あたりの回転数</span>
          <select class="spin-rate-select" onchange="handleSpinRateChange(this.value)">
            ${spinRateOptionsHtml()}
          </select>
        </div>
        <div class="auto-spin-btns">
          <div class="auto-spin-wrap">
            <button class="btn-auto" onclick="autoSpin(${tenThousandYenSpins()})">${tenThousandYenSpins()}回転回す</button>
            <p class="spin-cost-hint">約10,000円消費</p>
          </div>
        </div>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;
    }

    case 'lose_result':
      return `<div class="screen">
        <p class="result-main lose">はずれ</p>
        <button class="btn-sub" onclick="backToNormal()" style="margin-top:8px;">続ける</button>
      </div>`;

    case 'hit_result': {
      const p = game.pending;
      const label = p.typeKey === 'odd' ? '奇数揃い' : '偶数揃い';
      return `<div class="screen">
        <p class="result-main win">${label}！</p>
        <p class="prob-hint">振り分け ${p.displayPercent}%</p>
        <div class="vibun-box ${p.entersRush ? 'rush-box' : 'normal-box'}">
          <p class="bonus-main ${p.entersRush ? 'premium' : 'standard'}">${p.rounds}R</p>
          <p class="bonus-sub">＋${p.balls.toLocaleString()}球獲得</p>
          ${p.entersRush ? '<p class="rush-announce">🌊 超旋風RUSH突入！</p>' : '<p class="rush-announce miss">ラッシュ非突入</p>'}
        </div>
        <button class="btn-action" onclick="handleHitContinue()">▶ ${p.entersRush ? 'RUSHへ' : '通常へ'}</button>
      </div>`;
    }

    case 'rush_idle': {
      const chainCount = game.rush.totalHits + 1; // 初当たり含む連チャン数
      const totalBalls = game.rushEntryBalls + game.rush.actualBalls; // 初当たり含む総獲得出玉（実質）

      if (game.rush.jitanRemaining > 0) {
        return `<div class="screen">
        <p class="chain-label">${chainCount}連チャン中</p>
        <p class="rush-title">超旋風RUSH</p>
        <p class="rush-total-balls">総獲得出玉 ${totalBalls.toLocaleString()}球</p>
        <p class="rush-sub">時短残り <span>${game.rush.jitanRemaining}</span> 回</p>
        <div class="rush-spin-btns">
          <button class="btn-rush-spin" onclick="handleRushSpin()">1回転</button>
          <button class="btn-rush-spin skip" onclick="handleRushSkip()">スキップ</button>
        </div>
        <p class="prob-hint">当選確率 1/3.99</p>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;
      }

      return `<div class="screen">
        <p class="chain-label">${chainCount}連チャン中</p>
        <p class="rush-title final-title">ファイナルチャンス</p>
        <p class="rush-total-balls">総獲得出玉 ${totalBalls.toLocaleString()}球</p>
        <p class="rush-sub">残保留 <span>${game.rush.reserveRemaining}</span></p>
        <button class="btn-action final-push" onclick="handleFinalChancePush()">PUSH</button>
        <p class="prob-hint">当選確率 1/3.99</p>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;
    }

    case 'rush_hit_result': {
      const p = game.pending;
      return `<div class="screen">
        <p class="result-sub">${p.spinsThisCycle}回転で当選</p>
        <div class="vibun-box rush-box">
          <p class="bonus-main standard">${p.rounds}R</p>
          <p class="bonus-sub">＋${p.balls.toLocaleString()}球獲得</p>
          <p class="prob-hint">振り分け ${p.hitPercent}%</p>
        </div>
        <button class="btn-action" onclick="handleRushHitContinue()">▶ RUSH継続へ</button>
      </div>`;
    }

    case 'rush_result': {
      const h = game.rushSessionHitCounts;
      const chainCount = game.rush.totalHits + 1; // 初当たり含む連チャン数
      const totalBalls = game.rushEntryBalls + game.rush.actualBalls; // 初当たり含む総獲得出玉（実質）
      const lines = [];
      if (h.big > 0) lines.push(`<div class="result-row"><span class="rr-label">大ラウンド</span><span class="rr-val">×${h.big}回</span></div>`);
      if (h.small > 0) lines.push(`<div class="result-row"><span class="rr-label">小ラウンド</span><span class="rr-val">×${h.small}回</span></div>`);
      if (lines.length === 0) lines.push(`<p style="color:#888; font-size:13px;">RUSH中の当たりなし</p>`);
      return `<div class="screen">
        <p class="rush-result-title">超旋風RUSH リザルト</p>
        <div class="rush-result-box">
          <div class="result-row highlight">
            <span class="rr-label">連チャン数（初当たり含む）</span>
            <span class="rr-val gold">${chainCount}連</span>
          </div>
          <div class="result-row">
            <span class="rr-label">獲得出玉（初当たり含む）</span>
            <span class="rr-val gold">${totalBalls.toLocaleString()}球</span>
          </div>
          <hr class="result-hr">
          <p class="rr-section">ボーナス内訳</p>
          ${lines.join('')}
        </div>
        <button class="btn-action" onclick="handleRushResultEnd()" style="margin-top:16px;">▶ 通常へ戻る</button>
      </div>`;
    }

    case 'taiten_result': {
      const mochi = Math.floor(game.mochiDama);
      const mochiYen = mochi * 4;
      const shuushi = mochiYen - game.toushi;
      const shuushiColor = shuushi >= 0 ? '#2e9e5b' : '#d24141';
      const shuushiSign = shuushi >= 0 ? '＋' : '';
      const normalFirstHit = game.normalHitCounts.odd + game.normalHitCounts.even;
      return `<div class="screen">
        <p style="font-size:22px; font-weight:bold; color:#555;">退店します</p>
        <div class="rush-result-box" style="max-width:320px;">
          <p class="rr-section" style="margin-bottom:8px;">収支発表</p>
          <div class="result-row">
            <span class="rr-label">総回転数</span>
            <span class="rr-val">${game.totalSpins.toLocaleString()}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">投資金額</span>
            <span class="rr-val" style="color:#d24141;">${game.toushi.toLocaleString()}円</span>
          </div>
          <div class="result-row">
            <span class="rr-label">持ち球換算</span>
            <span class="rr-val">${mochiYen.toLocaleString()}円</span>
          </div>
          <hr class="result-hr">
          <div class="result-row highlight">
            <span class="rr-label" style="font-weight:bold;">収支</span>
            <span class="rr-val" style="color:${shuushiColor}; font-size:22px;">
              ${shuushiSign}${shuushi.toLocaleString()}円
            </span>
          </div>
          <hr class="result-hr">
          <div class="result-row">
            <span class="rr-label">図柄揃い</span>
            <span class="rr-val">${normalFirstHit}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">超旋風RUSH中当たり</span>
            <span class="rr-val">${game.totalRushHits}回</span>
          </div>
        </div>
        <button class="btn-action" onclick="resetGame()" style="margin-top:8px;">▶ 最初の画面に戻る</button>
      </div>`;
    }

    default:
      return `<div class="screen"><p>...</p></div>`;
  }
}

render();
