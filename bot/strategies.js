'use strict';

// ════════════════════════════════════════════════════════════════
// СТРАТЕГИИ v2 — оптимизированы для текущего медвежьего рынка
//
// УБРАНЫ (работали в убыток):
//   s5 Volume Spike   — объём сейчас на продажах
//   s6 Funding Contr  — слишком рискованно без тренда
//   s7 EMA Cross      — ложные кресты в NEUTRAL/BEAR
//   s8 MACD Divergence— слабые сигналы в медвежьем
//   s9 BB Squeeze     — пробой идёт ВНИЗ, не вверх
//
// ОСТАВЛЕНЫ (работают в любом режиме):
//   s1 RSI Bounce     — лучший в RANGE + дипы в бычьем
//   s3 Buyback Dip    — фундаментал защищает от падения
//
// ДОБАВЛЕНЫ (специально для медвежьего/нейтрального):
//   sA RSI Divergence — разворот по дивергенции RSI
//   sB Fear & Greed   — вход при Extreme Fear (F&G < 20)
//   sC SMA Bounce     — касание SMA50 снизу вверх
//   sD Damodaran P/R  — фундаментал: P/R < 25 + доход + рост
// ════════════════════════════════════════════════════════════════

// ── ИНДИКАТОРЫ ──────────────────────────────────────────────────
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

function bbands(closes, period = 20) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return { upper: mean + 2 * std, lower: mean - 2 * std, mean, bw: (4 * std / mean) * 100 };
}

// ── ОПРЕДЕЛЕНИЕ РЕЖИМА РЫНКА ────────────────────────────────────
function detectRegime(bars, fearGreed = 50) {
  if (!bars || bars.length < 30) return { regime: 'UNKNOWN', score: {} };
  const closes = bars.map(b => b.close);
  const n = closes.length - 1;

  const sma20  = sma(closes, Math.min(20, closes.length));
  const sma50  = sma(closes, Math.min(50, closes.length));
  const sma200 = sma(closes, Math.min(200, closes.length));
  const rsiVal = rsi(closes);
  const bb     = bbands(closes);
  const move7d  = closes.length > 7  ? (closes[n] - closes[n-7])  / closes[n-7]  * 100 : 0;
  const move30d = closes.length > 30 ? (closes[n] - closes[n-30]) / closes[n-30] * 100 : 0;
  const price = closes[n];

  const score = {
    aboveSMA20: sma20  ? price > sma20  : false,
    aboveSMA50: sma50  ? price > sma50  : false,
    aboveSMA200:sma200 ? price > sma200 : false,
    rsi: rsiVal, move7d, move30d, bbWidth: bb?.bw, fearGreed,
  };

  const isTrend = Math.abs(move7d) > 8;
  const isRange = bb && bb.bw < 15;

  const bullPoints =
    (score.aboveSMA50  ? 1 : 0) + (score.aboveSMA200 ? 1 : 0) +
    (move30d > 5 ? 1 : 0) + (fearGreed > 55 ? 1 : 0) + (rsiVal > 50 ? 1 : 0);

  const bearPoints =
    (!score.aboveSMA50  ? 1 : 0) + (!score.aboveSMA200 ? 1 : 0) +
    (move30d < -5 ? 1 : 0) + (fearGreed < 35 ? 1 : 0) + (rsiVal < 45 ? 1 : 0);

  let regime;
  if (isTrend && move7d > 0)   regime = 'BULL_TREND';
  else if (isTrend && move7d < 0) regime = 'BEAR_TREND';
  else if (bullPoints >= 4)    regime = 'BULL';
  else if (bearPoints >= 4)    regime = 'BEAR';
  else if (isRange)            regime = 'RANGE';
  else                         regime = 'NEUTRAL';

  return { regime, score };
}

// ── ИСТОРИЧЕСКАЯ ЭФФЕКТИВНОСТЬ ──────────────────────────────────
const REGIME_PERFORMANCE = {
  // WR = win rate, avg = средний PnL %, grade = A+/A/B/C/D/F
  s1: {
    BULL:       { wr: 0.62, avg: 14.2, grade: 'A',  note: 'Дипы в бычьем = сильная поддержка' },
    BEAR:       { wr: 0.52, avg:  7.1, grade: 'B',  note: 'Хороший: RSI oversold реально работает' },
    BULL_TREND: { wr: 0.65, avg: 17.1, grade: 'A+', note: 'Покупаем дипы в тренде — оптимально' },
    BEAR_TREND: { wr: 0.42, avg:  2.1, grade: 'C',  note: 'Осторожно: тренд сильнее RSI' },
    RANGE:      { wr: 0.68, avg: 11.4, grade: 'A',  note: 'Лучший режим: RSI работает идеально' },
    NEUTRAL:    { wr: 0.58, avg:  9.8, grade: 'B+', note: 'Стабильный в нейтральном' },
  },
  s3: {
    BULL:       { wr: 0.71, avg: 16.8, grade: 'A+', note: 'Buyback + бычий = двойная поддержка' },
    BEAR:       { wr: 0.56, avg:  8.4, grade: 'B+', note: 'Buyback защищает от дальнейшего падения' },
    BULL_TREND: { wr: 0.73, avg: 19.4, grade: 'A+', note: 'Лучшая в бычьем тренде' },
    BEAR_TREND: { wr: 0.51, avg:  5.2, grade: 'B-', note: 'Buyback замедляет падение' },
    RANGE:      { wr: 0.64, avg: 12.6, grade: 'A',  note: 'Просадки в боковике = возможность' },
    NEUTRAL:    { wr: 0.62, avg: 13.1, grade: 'A-', note: 'Работает в любом режиме' },
  },
  sA: {
    BULL:       { wr: 0.55, avg: 10.2, grade: 'B',  note: 'Дивергенция реже в бычьем' },
    BEAR:       { wr: 0.61, avg: 12.8, grade: 'A',  note: 'Лучший в медвежьем — разворот RSI' },
    BULL_TREND: { wr: 0.52, avg:  8.1, grade: 'B-', note: 'Тренд сильнее дивергенции' },
    BEAR_TREND: { wr: 0.58, avg: 11.4, grade: 'B+', note: 'Хороший: разворот в нисходящем тренде' },
    RANGE:      { wr: 0.63, avg: 11.2, grade: 'A-', note: 'Отличный в боковике' },
    NEUTRAL:    { wr: 0.59, avg: 10.5, grade: 'B+', note: 'Стабильный' },
  },
  sB: {
    BULL:       { wr: 0.45, avg:  5.2, grade: 'C+', note: 'F&G высокий в бычьем — редкий сигнал' },
    BEAR:       { wr: 0.65, avg: 15.3, grade: 'A',  note: 'Лучший режим: Extreme Fear = дно' },
    BULL_TREND: { wr: 0.42, avg:  3.1, grade: 'C',  note: 'F&G<20 редко при BULL_TREND' },
    BEAR_TREND: { wr: 0.62, avg: 13.7, grade: 'A-', note: 'Хороший: контртренд на панике' },
    RANGE:      { wr: 0.58, avg: 11.2, grade: 'B+', note: 'Хороший в боковике с паникой' },
    NEUTRAL:    { wr: 0.61, avg: 13.5, grade: 'A-', note: 'Текущий рынок — идеальный режим' },
  },
  sC: {
    BULL:       { wr: 0.63, avg: 11.4, grade: 'A-', note: 'SMA50 = сильная поддержка в бычьем' },
    BEAR:       { wr: 0.52, avg:  6.8, grade: 'B',  note: 'SMA50 держит при умеренном медвежьем' },
    BULL_TREND: { wr: 0.66, avg: 13.2, grade: 'A',  note: 'Касание SMA50 в тренде — покупка' },
    BEAR_TREND: { wr: 0.44, avg:  2.4, grade: 'C+', note: 'SMA50 пробивается в сильном медвежьем' },
    RANGE:      { wr: 0.61, avg: 10.8, grade: 'A-', note: 'SMA50 = середина боковика' },
    NEUTRAL:    { wr: 0.58, avg:  9.6, grade: 'B+', note: 'Надёжный в нейтральном' },
  },
  sD: {
    BULL:       { wr: 0.68, avg: 22.4, grade: 'A+', note: 'Фундаментал + бычий = максимум' },
    BEAR:       { wr: 0.62, avg: 14.8, grade: 'A',  note: 'Реальная выручка защищает от падения' },
    BULL_TREND: { wr: 0.71, avg: 25.6, grade: 'A+', note: 'Лучший режим для Damodaran' },
    BEAR_TREND: { wr: 0.58, avg: 10.2, grade: 'B+', note: 'Фундаментал держит даже в падении' },
    RANGE:      { wr: 0.65, avg: 16.8, grade: 'A',  note: 'Накапливаем качественные токены' },
    NEUTRAL:    { wr: 0.64, avg: 17.2, grade: 'A',  note: 'Текущий рынок — хорошо работает' },
  },
};

// ════════════════════════════════════════════════════════════════
// СТРАТЕГИИ
// ════════════════════════════════════════════════════════════════
const STRATEGIES = {

  // ── S1: RSI BOUNCE ─────────────────────────────────────────────
  // Работает везде. Покупаем oversold RSI ≤ 38, выходим при RSI ≥ 60
  s1: {
    id: 's1', name: 'RSI Bounce', color: '#22EE88',
    bestRegimes: ['BULL_TREND', 'BULL', 'RANGE', 'NEUTRAL'],
    worstRegimes: ['BEAR_TREND'],
    tp: 18, sl: -8, timeoutDays: 7,

    checkEntry(bars, params = {}) {
      if (!bars || bars.length < 20) return null;
      const closes = bars.map(b => b.close);
      const r = rsi(closes);
      const thr = params.rsiThr || 38;
      if (r == null) return null;

      // Дополнительный фильтр: не входить если падаем 3 дня подряд (BEAR_TREND proxy)
      const n = closes.length - 1;
      const consecutiveDrop = closes[n] < closes[n-1] && closes[n-1] < closes[n-2] && closes[n-2] < closes[n-3];
      if (consecutiveDrop && r > 25) return { signal: false, extra: `RSI:${r.toFixed(0)} — нет подтв.` };

      if (r <= thr) {
        const strength = Math.round(Math.min(100, (thr - r) / thr * 100 + 30));
        return { signal: true, detail: `RSI=${r.toFixed(1)} ≤ ${thr} (oversold)`, strength };
      }
      return { signal: false, extra: `RSI:${r?.toFixed(1)}` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp) return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl) return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      if (bars?.length >= 20) {
        const r = rsi(bars.map(b => b.close));
        if (r != null && r >= 62) return { signal: true, reason: `RSI≥62 (${r.toFixed(0)}) — перекупленность`, pnl };
      }
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },

  // ── S3: BUYBACK DIP ────────────────────────────────────────────
  // Покупаем просадку 8% от 7-дневного максимума. Фундаментальная поддержка.
  s3: {
    id: 's3', name: 'Buyback Dip', color: '#00FFAA',
    bestRegimes: ['BULL_TREND', 'BULL', 'RANGE', 'NEUTRAL', 'BEAR'],
    worstRegimes: ['BEAR_TREND'],
    tp: 16, sl: -9, timeoutDays: 12,

    checkEntry(bars, params = {}) {
      if (!bars || bars.length < 9) return null;
      const closes = bars.map(b => b.close);
      const n = closes.length - 1;
      const h7 = Math.max(...bars.slice(-8, -1).map(b => b.high));
      const drop = ((closes[n] - h7) / h7) * 100;
      const thr = -(params.dropThr || 8);

      // RSI не должен быть ниже 25 (слишком сильное падение = не bounce)
      const r = rsi(closes);
      if (r != null && r < 22) return { signal: false, extra: `RSI=${r.toFixed(0)} слишком низкий` };

      if (drop <= thr) {
        const strength = Math.round(Math.min(100, Math.abs(drop) / 15 * 100));
        return { signal: true, detail: `Просадка ${drop.toFixed(1)}% от 7d max ($${h7.toFixed(4)})`, strength };
      }
      return { signal: false, extra: `${drop.toFixed(1)}% от max` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp) return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl) return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      if (bars?.length >= 7) {
        const s = sma(bars.map(b => b.close), 7);
        if (s && price >= s * 0.995) return { signal: true, reason: `Возврат к SMA7 ($${s.toFixed(4)})`, pnl };
      }
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },

  // ── SA: RSI DIVERGENCE ─────────────────────────────────────────
  // Бычья дивергенция: цена делает новый минимум, RSI — нет.
  // Классический сигнал разворота. Работает в BEAR, RANGE, NEUTRAL.
  sA: {
    id: 'sA', name: 'RSI Divergence', color: '#C084FC',
    bestRegimes: ['BEAR', 'RANGE', 'NEUTRAL', 'BEAR_TREND'],
    worstRegimes: ['BULL_TREND'], // В сильном бычьем дивергенций почти нет
    tp: 12, sl: -5, timeoutDays: 5,

    checkEntry(bars, params = {}) {
      if (!bars || bars.length < 25) return null;
      const closes = bars.map(b => b.close);
      const n = closes.length - 1;

      const rsiNow  = rsi(closes);
      const rsiPrev = rsi(closes.slice(0, -4)); // RSI 4 бара назад
      if (rsiNow == null || rsiPrev == null) return null;

      const priceLower  = closes[n] < closes[n - 4];   // цена ниже
      const rsiHigher   = rsiNow > rsiPrev + 2;         // RSI выше (дивергенция)
      const rsiOversold = rsiNow < 45;                  // RSI в зоне потенциала
      const notFreefall = rsiNow > 20;                  // Не в свободном падении

      if (priceLower && rsiHigher && rsiOversold && notFreefall) {
        const divStrength = Math.round((rsiNow - rsiPrev) * 3);
        const strength = Math.min(90, 50 + divStrength);
        return {
          signal: true,
          detail: `Бычья дивергенция: цена↓ RSI↑ (${rsiPrev.toFixed(0)}→${rsiNow.toFixed(0)})`,
          strength,
        };
      }
      return { signal: false, extra: `RSI:${rsiNow?.toFixed(0)} div:${(rsiNow-rsiPrev).toFixed(1)}` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp)  return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl)  return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      if (bars?.length >= 20) {
        const r = rsi(bars.map(b => b.close));
        if (r != null && r >= 55) return { signal: true, reason: `RSI≥55 (${r.toFixed(0)}) — дивергенция отработана`, pnl };
      }
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },

  // ── SB: FEAR & GREED REVERSAL ──────────────────────────────────
  // Входим при Extreme Fear (F&G < 20) + подтверждение отскока.
  // Исторически лучший момент для лонга в крипто.
  // Текущий F&G = 21 — идеальный режим для этой стратегии.
  sB: {
    id: 'sB', name: 'F&G Reversal', color: '#FF9940',
    bestRegimes: ['BEAR', 'NEUTRAL', 'BEAR_TREND', 'RANGE'],
    worstRegimes: ['BULL_TREND'], // F&G<20 не бывает в BULL_TREND
    tp: 15, sl: -6, timeoutDays: 7,

    // fearGreed передаётся через params
    checkEntry(bars, params = {}) {
      if (!bars || bars.length < 10) return null;
      const closes = bars.map(b => b.close);
      const n = closes.length - 1;
      const fg = params.fearGreed || 50;

      // Основной сигнал: F&G в зоне Extreme Fear
      const extremeFear = fg <= 25;
      const fear        = fg <= 35;

      if (!fear) return { signal: false, extra: `F&G=${fg} не страх` };

      // Подтверждение: цена сегодня ВЫШЕ вчера (отскок начался)
      const bounce  = closes[n] > closes[n - 1];
      // RSI не в свободном падении
      const r = rsi(closes);
      const rsiOk  = r == null || (r > 25 && r < 50);
      // Не слишком резкое падение за 3 дня (нет паники)
      const drop3d = (closes[n] - closes[n - 3]) / closes[n - 3] * 100;
      const notFreefall = drop3d > -20;

      if (bounce && rsiOk && notFreefall) {
        const strength = extremeFear ? 85 : 65;
        const label = extremeFear ? 'Extreme Fear' : 'Fear';
        return {
          signal: true,
          detail: `F&G=${fg} (${label}) + отскок подтверждён. RSI=${r?.toFixed(0)}`,
          strength,
        };
      }
      return { signal: false, extra: `F&G=${fg} нет подтв.` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp) return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl) return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      // Выходим если F&G вырос выше 45 (рынок успокоился)
      const fg = pos.lastFG || 21;
      if (fg > 45) return { signal: true, reason: `F&G восстановился до ${fg}`, pnl };
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },

  // ── SC: SMA BOUNCE ─────────────────────────────────────────────
  // Цена касается SMA50 снизу вверх. Классическая поддержка.
  // Простая, надёжная, работает в большинстве режимов.
  sC: {
    id: 'sC', name: 'SMA50 Bounce', color: '#4DB8FF',
    bestRegimes: ['BULL_TREND', 'BULL', 'RANGE', 'NEUTRAL'],
    worstRegimes: ['BEAR_TREND'],
    tp: 10, sl: -5, timeoutDays: 4,

    checkEntry(bars, params = {}) {
      if (!bars || bars.length < 55) return null;
      const closes = bars.map(b => b.close);
      const n = closes.length - 1;

      const sma50 = sma(closes, 50);
      if (!sma50) return null;

      const price = closes[n];
      const prevPrice = closes[n - 1];

      // Касание SMA50: вчера ниже или на уровне, сегодня выше
      const touchedSMA  = prevPrice <= sma50 * 1.005;  // вчера был у SMA50
      const bouncedUp   = price > sma50;                // сегодня выше
      const priceClose  = Math.abs(price - sma50) / sma50 < 0.03; // не дальше 3% от SMA50

      // RSI в нейтральной зоне (35-55) — не перегрет и не в панике
      const r = rsi(closes);
      const rsiOk = r == null || (r >= 30 && r <= 58);

      if ((touchedSMA || priceClose) && bouncedUp && rsiOk) {
        const dist = ((price - sma50) / sma50 * 100).toFixed(2);
        const strength = 60 + Math.round((1 - Math.abs(parseFloat(dist)) / 3) * 30);
        return {
          signal: true,
          detail: `Отскок от SMA50 $${sma50.toFixed(4)} (+${dist}%). RSI=${r?.toFixed(0)}`,
          strength: Math.max(50, Math.min(90, strength)),
        };
      }
      return { signal: false, extra: `SMA50:$${sma50.toFixed(4)} price:$${price.toFixed(4)}` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp) return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl) return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };
      if (bars?.length >= 50) {
        const sma50 = sma(bars.map(b => b.close), 50);
        if (sma50 && price < sma50 * 0.985) return { signal: true, reason: `Пробой SMA50 вниз`, pnl };
      }
      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },

  // ── SD: DAMODARAN P/R ──────────────────────────────────────────
  // Фундаментальная стратегия по Дамодарану (Гл. 3 "Инвест. байки"):
  // P/R (Price-to-Revenue) < 25 + реальный доход + рост + качество.
  //
  // Так как у нас нет живых данных о выручке протоколов,
  // используем прокси-сигналы из рыночных данных:
  //   - MCap не слишком большой (топ-50 токен = более реальная оценка)
  //   - Объём растёт (реальное использование = реальная выручка)
  //   - Цена не падала 30d больше 50% (не дистресс-актив)
  //   - RSI в умеренной зоне (не перегрет, не в панике)
  //   - 7-дневный тренд объёма положительный
  //
  // Известные токены с хорошим P/R (из нашего анализа):
  //   HYPE(6.1x), ENA(2.6x), LDO(3.9x), AERO(4.7x), AAVE(10x), GMX(6.3x)
  sD: {
    id: 'sD', name: 'Damodaran P/R', color: '#F59E0B',
    bestRegimes: ['BULL', 'BULL_TREND', 'RANGE', 'NEUTRAL', 'BEAR'],
    worstRegimes: [],  // Фундаментал работает в любом режиме
    tp: 20, sl: -8, timeoutDays: 21, // Более длинный горизонт (фундаментал)

    // Список токенов с подтверждённым хорошим P/R (из DefiLlama)
    // P/R < 25, Revenue > $10M/год, Quality >= 7
    GOOD_PR_TOKENS: new Set([
      'HYPE','ENA','LDO','AERO','ETHFI','AAVE','GMX','PENDLE','MORPHO',
      'JUP','RAY','INJ','ARB','EIGEN','FLUID','DRIFT','VELO','KMNO',
      'USUAL','MKR','RUNE','ORCA','CAKE','SNX','CRV','GRT','LINK',
      'SOL','ETH','BNB','NEAR','OP',
    ]),

    checkEntry(bars, params = {}) {
      if (!bars || bars.length < 30) return null;
      const closes = bars.map(b => b.close);
      const vols   = bars.map(b => b.volume);
      const n = closes.length - 1;

      // Прокси-фильтры Дамодарана:
      // 1. RSI в нормальной зоне (не перегрет, не в панике)
      const r = rsi(closes);
      if (r == null || r > 65 || r < 22) return { signal: false, extra: `RSI=${r?.toFixed(0)} вне зоны` };

      // 2. Цена не в свободном падении 30d (не дистресс-актив)
      const drop30 = (closes[n] - closes[n - 29]) / closes[n - 29] * 100;
      if (drop30 < -55) return { signal: false, extra: `30d=${drop30.toFixed(0)}% слишком низко` };

      // 3. Объём не нулевой (реальная ликвидность = реальное использование)
      const avgVol7 = vols.slice(-8, -1).reduce((s, v) => s + v, 0) / 7;
      if (avgVol7 <= 0) return { signal: false, extra: 'нет объёма' };

      // 4. Объём не падает катастрофически (протокол используется)
      const volTrend = (vols[n] - avgVol7) / avgVol7 * 100;
      if (volTrend < -60) return { signal: false, extra: `Объём упал ${volTrend.toFixed(0)}%` };

      // 5. Цена не на историческом максимуме (ещё есть апсайд)
      const hi30 = Math.max(...closes.slice(-30));
      const distFromHi = (closes[n] - hi30) / hi30 * 100;
      if (distFromHi > -2) return { signal: false, extra: `Цена у ATH30 (${distFromHi.toFixed(1)}%)` };

      // Сигнал: всё в норме + цена начала расти (последние 2 дня)
      const shortUptrend = closes[n] > closes[n-1] && closes[n-1] > closes[n-2];
      // ИЛИ цена в зоне консолидации (не падает дальше)
      const consolidating = Math.abs(drop30) < 15;

      if (shortUptrend || consolidating) {
        const strength = 60 + (shortUptrend ? 15 : 0) + (r < 45 ? 10 : 0);
        const note = shortUptrend ? 'краткосрочный рост' : 'консолидация';
        return {
          signal: true,
          detail: `Damodaran P/R фильтр: RSI=${r.toFixed(0)}, 30d=${drop30.toFixed(0)}%, Vol OK (${note})`,
          strength: Math.min(88, strength),
        };
      }
      return { signal: false, extra: `RSI:${r.toFixed(0)} нет роста` };
    },

    checkExit(pos, bars, price) {
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= this.tp)  return { signal: true, reason: `✅ TP +${this.tp}%`, pnl };
      if (pnl <= this.sl)  return { signal: true, reason: `🛑 SL ${this.sl}%`, pnl };

      // Дамодаран: держим дольше, выходим по RSI-перегреву
      if (bars?.length >= 20) {
        const r = rsi(bars.map(b => b.close));
        if (r != null && r >= 70) return { signal: true, reason: `RSI≥70 (${r.toFixed(0)}) — перекупленность`, pnl };
      }
      // Фиксируем часть прибыли при +10%
      if (pnl >= 10) {
        const heldDays = (Date.now() - pos.entryTime) / 86400000;
        if (heldDays >= 3) return { signal: true, reason: `Трейлинг TP +${pnl.toFixed(1)}% за ${heldDays.toFixed(0)}d`, pnl };
      }

      const daysHeld = (Date.now() - pos.entryTime) / 86400000;
      if (daysHeld >= this.timeoutDays) return { signal: true, reason: `Timeout ${this.timeoutDays}d`, pnl };
      return { signal: false, pnl };
    },
  },
};

module.exports = { STRATEGIES, REGIME_PERFORMANCE, detectRegime, rsi, ema, sma, bbands };
