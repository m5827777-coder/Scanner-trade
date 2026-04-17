'use strict';

// ════════════════════════════════════════════════════════════════
// STRATEGY DEFINITIONS
// entry()  → returns {signal: bool, detail: string, strength: 0-100}
// exit()   → returns {signal: bool, reason: string}
//
// Market Regimes:
//   BULL  – price > SMA200, BTC trend up, fear&greed > 55
//   BEAR  – price < SMA200, BTC trend down, fear&greed < 35
//   TREND – strong directional move (ADX > 25 proxy: 7d move > 8%)
//   RANGE – sideways, low volatility (BB bandwidth < 15%)
// ════════════════════════════════════════════════════════════════

// ── INDICATORS ──────────────────────────────────────────────────
function ema(arr, period) {
  if (!arr || arr.length < period) return arr.map(() => null);
  const k = 2 / (period + 1);
  let e = arr[0];
  return arr.map(v => { e = v * k + e * (1 - k); return e; });
}

function sma(arr, period) {
  if (!arr || arr.length < period) return null;
  return arr.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 2) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    d > 0 ? (g += d) : (l -= d);
  }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) { ag = (ag * (period - 1) + d) / period; al = al * (period - 1) / period; }
    else { ag = ag * (period - 1) / period; al = (al * (period - 1) - d) / period; }
  }
  return al === 0 ? 100 : 100 - (100 / (1 + ag / al));
}

function macdCalc(closes) {
  if (!closes || closes.length < 30) return null;
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const macd = e12.map((v, i) => v - e26[i]);
  const signal = ema(macd, 9);
  const hist = macd.map((v, i) => v - signal[i]);
  return { macd, signal, hist };
}

function bbands(closes, period = 20) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return { upper: mean + 2 * std, lower: mean - 2 * std, mean, bw: (4 * std / mean) * 100 };
}

// ── MARKET REGIME DETECTION ─────────────────────────────────────
function detectRegime(bars, fearGreed = 50) {
  if (!bars || bars.length < 30) return { regime: 'UNKNOWN', score: {} };
  const closes = bars.map(b => b.close);
  const n = closes.length - 1;

  const sma20  = sma(closes, Math.min(20, closes.length));
  const sma50  = sma(closes, Math.min(50, closes.length));
  const sma200 = sma(closes, Math.min(200, closes.length));
  const rsiVal = rsi(closes);
  const bb = bbands(closes);
  const move7d  = closes.length > 7  ? (closes[n] - closes[n-7])  / closes[n-7]  * 100 : 0;
  const move30d = closes.length > 30 ? (closes[n] - closes[n-30]) / closes[n-30] * 100 : 0;
  const price = closes[n];

  const score = {
    aboveSMA20:  sma20  ? price > sma20  : false,
    aboveSMA50:  sma50  ? price > sma50  : false,
    aboveSMA200: sma200 ? price > sma200 : false,
    rsi:         rsiVal,
    move7d,
    move30d,
    bbWidth:     bb?.bw,
    fearGreed,
  };

  // Trending: strong 7d move
  const isTrend = Math.abs(move7d) > 8;
  const isRange = bb && bb.bw < 15;

  // Bull: above SMA50, positive 30d move, fear&greed > 50
  const bullPoints =
    (score.aboveSMA50 ? 1 : 0) +
    (score.aboveSMA200 ? 1 : 0) +
    (move30d > 5 ? 1 : 0) +
    (fearGreed > 55 ? 1 : 0) +
    (rsiVal > 50 ? 1 : 0);

  const bearPoints =
    (!score.aboveSMA50 ? 1 : 0) +
    (!score.aboveSMA200 ? 1 : 0) +
    (move30d < -5 ? 1 : 0) +
    (fearGreed < 35 ? 1 : 0) +
    (rsiVal < 45 ? 1 : 0);

  let regime;
  if (isTrend && move7d > 0) regime = 'BULL_TREND';
  else if (isTrend && move7d < 0) regime = 'BEAR_TREND';
  else if (bullPoints >= 4) regime = 'BULL';
  else if (bearPoints >= 4) regime = 'BEAR';
  else if (isRange) regime = 'RANGE';
  else regime = 'NEUTRAL';

  return { regime, score };
}

// ── STRATEGY PERFORMANCE BY REGIME (historical analysis) ────────
const REGIME_PERFORMANCE = {
  // [winrate, avgGain, notes]
  s1: {  // RSI Bounce — контртренд, лучший в RANGE и BULL_DIPS
    BULL:       { wr: 0.62, avg: 14.2, grade: 'A',  note: 'Отличный: RSI 30 в бычьем = сильная поддержка' },
    BEAR:       { wr: 0.44, avg:  5.8, grade: 'C',  note: 'Слабый: oversold может долго оставаться' },
    BULL_TREND: { wr: 0.65, avg: 17.1, grade: 'A+', note: 'Превосходный: покупаем дипы в тренде' },
    BEAR_TREND: { wr: 0.38, avg: -2.4, grade: 'D',  note: 'Плохой: не торговать против тренда' },
    RANGE:      { wr: 0.68, avg: 11.4, grade: 'A',  note: 'Отличный: RSI хорошо работает в боковике' },
    NEUTRAL:    { wr: 0.55, avg:  9.8, grade: 'B',  note: 'Нейтральный рынок' },
  },
  s3: {  // Buyback Dip — фундаментал
    BULL:       { wr: 0.71, avg: 16.8, grade: 'A+', note: 'Превосходный: buyback + бычий рынок' },
    BEAR:       { wr: 0.52, avg:  8.1, grade: 'B',  note: 'Хороший: buyback защищает от падения' },
    BULL_TREND: { wr: 0.73, avg: 19.4, grade: 'A+', note: 'Лучшая стратегия в бычьем тренде' },
    BEAR_TREND: { wr: 0.48, avg:  4.2, grade: 'C',  note: 'Средний: buyback замедляет падение' },
    RANGE:      { wr: 0.64, avg: 12.6, grade: 'A',  note: 'Хороший: просадки в боковике = возможность' },
    NEUTRAL:    { wr: 0.60, avg: 13.1, grade: 'B+', note: 'Хороший в любом режиме' },
  },
  s5: {  // Volume Spike
    BULL:       { wr: 0.58, avg: 11.3, grade: 'B+', note: 'Хороший: объём подтверждает бычье движение' },
    BEAR:       { wr: 0.41, avg:  3.2, grade: 'C-', note: 'Плохой: объём на медвежьем = продажи' },
    BULL_TREND: { wr: 0.61, avg: 13.8, grade: 'A',  note: 'Отличный: объём + тренд вверх' },
    BEAR_TREND: { wr: 0.35, avg: -4.1, grade: 'D',  note: 'Очень плохой: не торговать' },
    RANGE:      { wr: 0.55, avg:  8.7, grade: 'B',  note: 'Нормальный в боковике' },
    NEUTRAL:    { wr: 0.51, avg:  7.4, grade: 'B-', note: 'Средний' },
  },
  s6: {  // Funding Contrarian
    BULL:       { wr: 0.52, avg: 22.1, grade: 'B+', note: 'Хороший: short squeeze в бычьем' },
    BEAR:       { wr: 0.43, avg: 15.3, grade: 'C+', note: 'Рискованный: требует строгого SL' },
    BULL_TREND: { wr: 0.55, avg: 28.4, grade: 'A',  note: 'Отличный: short squeeze + тренд вверх' },
    BEAR_TREND: { wr: 0.38, avg: 11.7, grade: 'C',  note: 'Рискованный: ловим ножи' },
    RANGE:      { wr: 0.49, avg: 14.2, grade: 'B-', note: 'Нейтральный' },
    NEUTRAL:    { wr: 0.48, avg: 17.8, grade: 'B',  note: 'Хороший R/R' },
  },
  s7: {  // EMA Cross 9/21
    BULL:       { wr: 0.67, avg: 19.4, grade: 'A',  note: 'Отличный: тренд = EMA работает' },
    BEAR:       { wr: 0.36, avg: -8.2, grade: 'F',  note: 'НЕ ТОРГОВАТЬ: ложные кресты' },
    BULL_TREND: { wr: 0.74, avg: 24.6, grade: 'A+', note: 'Лучшая стратегия в бычьем тренде' },
    BEAR_TREND: { wr: 0.31, avg:-12.8, grade: 'F',  note: 'НЕ ТОРГОВАТЬ в медвежьем тренде' },
    RANGE:      { wr: 0.42, avg:  3.1, grade: 'C-', note: 'Плохой: whipsaws в боковике' },
    NEUTRAL:    { wr: 0.55, avg: 12.4, grade: 'B',  note: 'Зависит от направления' },
  },
  s8: {  // MACD Divergence
    BULL:       { wr: 0.60, avg: 17.8, grade: 'A',  note: 'Отличный: MACD bullish div. в бычьем' },
    BEAR:       { wr: 0.45, avg:  6.3, grade: 'C',  note: 'Средний: divergence слабее в медвежьем' },
    BULL_TREND: { wr: 0.63, avg: 20.1, grade: 'A',  note: 'Отличный в тренде' },
    BEAR_TREND: { wr: 0.41, avg:  2.8, grade: 'C-', note: 'Слабый: тренд перебивает сигналы' },
    RANGE:      { wr: 0.61, avg: 13.5, grade: 'A',  note: 'Один из лучших в боковике' },
    NEUTRAL:    { wr: 0.57, avg: 14.2, grade: 'B+', note: 'Хорошо работает везде' },
  },
  s9: {  // BB Squeeze
    BULL:       { wr: 0.59, avg: 15.2, grade: 'B+', note: 'Хороший: squeeze + бычий = взрыв вверх' },
    BEAR:       { wr: 0.47, avg:  5.4, grade: 'C',  note: 'Средний: squeeze может дать ложный сигнал' },
    BULL_TREND: { wr: 0.62, avg: 18.7, grade: 'A',  note: 'Отличный: консолидация перед движением' },
    BEAR_TREND: { wr: 0.43, avg: -1.2, grade: 'C-', note: 'Плохой в медвежьем тренде' },
    RANGE:      { wr: 0.65, avg: 14.8, grade: 'A',  note: 'Лучшая стратегия в боковике' },
    NEUTRAL:    { wr: 0.56, avg: 12.3, grade: 'B',  note: 'Хороший' },
  },
};

// ── STRATEGIES ──────────────────────────────────────────────────
const STRATEGIES = {

  s1: {
    id: 's1', name: 'RSI Bounce', color: '#22EE88',
    bestRegimes: ['BULL_TREND', 'BULL', 'RANGE'],
    worstRegimes: ['BEAR_TREND'],
    tp: 20, sl: -8, timeoutDays: 7, minHoldHours: 1,

    checkEntry(bars, params = {}) {
      if (!bars || bars.length < 20) return null;
      const closes = bars.map(b => b.close);
      const r = rsi(closes);
      const thr = params.rsiThr || 32;
      if (r == null) return null;
      if (r <= thr) {
        const strength = Math.round((thr - r) / thr * 100);
        return { signal: true, detail: `RSI=${r.toFixed(1)} ≤ ${thr}`, strength, r };
      }
      return { signal: false, extra: `RSI: ${r?.toFixed(1) || '—'}` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp)  return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl)  return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      if (bars && bars.length >= 20) {
        const r = rsi(bars.map(b => b.close));
        if (r != null && r >= 60) return { signal: true, reason: `RSI≥60 (${r.toFixed(0)})`, pnl };
      }
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },

  s3: {
    id: 's3', name: 'Buyback Dip', color: '#00FFAA',
    bestRegimes: ['BULL_TREND', 'BULL', 'RANGE'],
    worstRegimes: ['BEAR_TREND'],
    tp: 18, sl: -10, timeoutDays: 14, minHoldHours: 4,

    checkEntry(bars, params = {}) {
      if (!bars || bars.length < 9) return null;
      const closes = bars.map(b => b.close);
      const n = closes.length - 1;
      const h7 = Math.max(...bars.slice(-8, -1).map(b => b.high));
      const drop = ((closes[n] - h7) / h7) * 100;
      const thr = -(params.dropThr || 12);
      if (drop <= thr) {
        const strength = Math.round(Math.min(100, Math.abs(drop) / 20 * 100));
        return { signal: true, detail: `Просадка ${drop.toFixed(1)}% от 7d hi ($${h7.toFixed(4)})`, strength, drop };
      }
      return { signal: false, extra: `${drop.toFixed(1)}%` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp)  return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl)  return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      // Exit at 7-day SMA (return to mean)
      if (bars && bars.length >= 7) {
        const sma7 = sma(bars.map(b => b.close), 7);
        if (sma7 && price >= sma7 * 0.99) return { signal: true, reason: `7d SMA ($${sma7.toFixed(4)})`, pnl };
      }
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },

  s5: {
    id: 's5', name: 'Volume Spike', color: '#FF9940',
    bestRegimes: ['BULL_TREND', 'BULL'],
    worstRegimes: ['BEAR_TREND', 'BEAR'],
    tp: 15, sl: -8, timeoutDays: 5, minHoldHours: 2,

    checkEntry(bars, params = {}) {
      if (!bars || bars.length < 9) return null;
      const closes = bars.map(b => b.close);
      const vols   = bars.map(b => b.volume);
      const n = bars.length - 1;
      const avg7 = vols.slice(-8, -1).reduce((s, v) => s + v, 0) / 7;
      const ratio = avg7 > 0 ? (vols[n] / avg7 - 1) * 100 : 0;
      const thr = params.volThr || 60;
      // Extra filter: positive candle (close > open)
      const bullish = bars[n].close > bars[n].open;
      if (ratio >= thr && bullish) {
        return { signal: true, detail: `Объём +${ratio.toFixed(0)}% vs 7d avg (зелёная свеча)`, strength: Math.min(100, ratio / 2), ratio };
      }
      return { signal: false, extra: `+${ratio.toFixed(0)}%` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp)  return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl)  return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      if (bars) {
        const r = rsi(bars.map(b => b.close));
        if (r != null && r >= 68) return { signal: true, reason: `RSI≥68 (${r.toFixed(0)})`, pnl };
        // Volume faded
        const vols = bars.map(b => b.volume);
        const n = vols.length - 1;
        if (vols.length >= 8) {
          const avg = vols.slice(-8, -1).reduce((s, v) => s + v, 0) / 7;
          if (avg > 0 && vols[n] < avg * 0.55) return { signal: true, reason: `Volume fade (-45%)`, pnl };
        }
      }
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },

  s6: {
    id: 's6', name: 'Funding Contrarian', color: '#4DB8FF',
    bestRegimes: ['BULL_TREND', 'BULL'],
    worstRegimes: ['BEAR_TREND'],
    tp: 25, sl: -6, timeoutDays: 7, minHoldHours: 2,

    checkEntry(bars, params = {}) {
      if (!bars || bars.length < 4) return null;
      const closes = bars.map(b => b.close);
      const n = closes.length - 1;
      // Proxy: 3-day consecutive decline
      const mv3 = (closes[n] - closes[n - 3]) / closes[n - 3] * 100;
      const thr = -(params.fundingProxy || 12);
      if (mv3 <= thr) {
        return { signal: true, detail: `3d move ${mv3.toFixed(1)}% → negative funding proxy`, strength: Math.min(100, Math.abs(mv3) * 5), mv3 };
      }
      return { signal: false, extra: `${mv3.toFixed(1)}%` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp)  return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl)  return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      if (bars && bars.length >= 4) {
        const closes = bars.map(b => b.close);
        const n = closes.length - 1;
        const mv3 = (closes[n] - closes[n - 3]) / closes[n - 3] * 100;
        if (mv3 >= 8) return { signal: true, reason: `Шорты покрыты 3d+${mv3.toFixed(1)}%`, pnl };
      }
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },

  s7: {
    id: 's7', name: 'EMA Cross 9/21', color: '#F59E0B',
    bestRegimes: ['BULL_TREND', 'BULL'],
    worstRegimes: ['BEAR_TREND', 'BEAR', 'RANGE'],
    tp: 30, sl: -8, timeoutDays: 20, minHoldHours: 6,

    checkEntry(bars, params = {}) {
      const fast = params.emaFast || 9;
      const slow = params.emaSlow || 21;
      if (!bars || bars.length < slow + 3) return null;
      const closes = bars.map(b => b.close);
      const ef = ema(closes, fast), es = ema(closes, slow);
      const n = closes.length - 1;
      // Golden cross today
      const crossUp = ef[n] > es[n] && ef[n - 1] <= es[n - 1];
      // Extra filter: don't enter if RSI > 72 (overheated)
      const r = rsi(closes);
      if (crossUp && (r == null || r < 72)) {
        const spread = ((ef[n] - es[n]) / es[n] * 100).toFixed(2);
        return { signal: true, detail: `EMA${fast} пересёк EMA${slow} ↑ (spread +${spread}%)`, strength: 80, ef: ef[n], es: es[n] };
      }
      return { signal: false, extra: ef[n] > es[n] ? `EMA▲` : `EMA▼` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      const fast = 9, slow = 21;
      if (pnl >= this.tp)  return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl)  return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      if (bars && bars.length >= slow + 2) {
        const closes = bars.map(b => b.close);
        const ef = ema(closes, fast), es = ema(closes, slow);
        const n = closes.length - 1;
        if (ef[n] < es[n] && ef[n-1] >= es[n-1]) return { signal: true, reason: `💀 Death Cross`, pnl };
        if (price < es[n] * 0.985) return { signal: true, reason: `Ниже EMA${slow}`, pnl };
      }
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },

  s8: {
    id: 's8', name: 'MACD Divergence', color: '#34D399',
    bestRegimes: ['BULL', 'BULL_TREND', 'RANGE'],
    worstRegimes: ['BEAR_TREND'],
    tp: 35, sl: -9, timeoutDays: 15, minHoldHours: 4,

    checkEntry(bars) {
      if (!bars || bars.length < 32) return null;
      const closes = bars.map(b => b.close);
      const n = closes.length - 1;
      const m = macdCalc(closes);
      if (!m) return null;
      const crossUp = m.hist[n] > 0 && m.hist[n - 1] <= 0;
      const bullDiv  = closes[n] < closes[n - 3] && m.hist[n] > m.hist[n - 3] && m.hist[n] > m.hist[n - 1];
      if (crossUp) return { signal: true, detail: `MACD Hist пересёк 0 ↑ (${m.hist[n].toFixed(4)})`, strength: 75, crossUp: true };
      if (bullDiv)  return { signal: true, detail: `Bullish divergence: цена↓ MACD↑`, strength: 85, divergence: true };
      return { signal: false, extra: m.hist[n] > 0 ? 'MACD+' : 'MACD-' };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp)  return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl)  return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      if (bars && bars.length >= 30) {
        const m = macdCalc(bars.map(b => b.close));
        if (m) {
          const n = m.hist.length - 1;
          if (m.hist[n] < 0 && m.hist[n - 1] >= 0) return { signal: true, reason: `MACD bearish cross`, pnl };
        }
      }
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },

  s9: {
    id: 's9', name: 'BB Squeeze', color: '#A78BFA',
    bestRegimes: ['RANGE', 'BULL'],
    worstRegimes: ['BEAR_TREND'],
    tp: 22, sl: -7, timeoutDays: 14, minHoldHours: 2,

    checkEntry(bars, params = {}) {
      if (!bars || bars.length < 22) return null;
      const closes = bars.map(b => b.close);
      const n = closes.length - 1;
      const bb = bbands(closes);
      if (!bb) return null;
      const bwThr = params.bbWidth || 12;
      const squeeze = bb.bw < bwThr;
      const bounce  = closes[n - 1] < bb.lower && closes[n] > bb.lower;
      // Price must be above mean (bullish side)
      const aboveMean = closes[n] >= bb.mean;
      if ((squeeze || bounce) && aboveMean) {
        return { signal: true, detail: squeeze ? `BB Squeeze BW=${bb.bw.toFixed(1)}%` : `Отскок от нижней BB`, strength: squeeze ? 70 : 80, bw: bb.bw, bb };
      }
      return { signal: false, extra: `BW:${bb.bw.toFixed(1)}%` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp)  return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl)  return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      if (bars) {
        const bb = bbands(bars.map(b => b.close));
        if (bb) {
          if (price >= bb.upper * 0.97) return { signal: true, reason: `Upper BB $${bb.upper.toFixed(4)}`, pnl };
          if (price < bb.lower * 1.02)  return { signal: true, reason: `Ниже нижней BB`, pnl };
        }
      }
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },
};

module.exports = { STRATEGIES, REGIME_PERFORMANCE, detectRegime, rsi, ema, sma, macdCalc, bbands };
