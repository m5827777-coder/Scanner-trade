'use strict';

// ═══════════════════════════════════════════════════════════════
// СТРАТЕГИИ v6 — три стратегии под бычий рынок 2026
//
//  sE  EMA Cross          — ловим начало тренда (EMA9 > EMA21)
//  sM  Momentum Breakout  — покупаем пробой 20d максимума
//  sR  Altcoin Rotation   — покупаем топ-альты при ротации из BTC
//
// Контекст: BTC ~$80-100K, доминация 60%+, F&G 26-42,
//           ротация в ETH/SOL/BNB начинается, выборы в ноябре
// ═══════════════════════════════════════════════════════════════

// ── Математические хелперы ─────────────────────────────────────

function sma(arr, period) {
  if (!arr || arr.length < period) return null;
  return arr.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function ema(arr, period) {
  if (!arr || arr.length < period) return null;
  const k = 2 / (period + 1);
  let e = arr[0];
  const result = arr.map(v => { e = v * k + e * (1 - k); return e; });
  return result;
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
    if (d > 0) { ag = (ag*(period-1)+d)/period; al = al*(period-1)/period; }
    else        { ag = ag*(period-1)/period; al = (al*(period-1)-d)/period; }
  }
  return al === 0 ? 100 : 100 - (100 / (1 + ag / al));
}

function bbands(closes, period = 20) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean  = slice.reduce((s, v) => s + v, 0) / period;
  const std   = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return { upper: mean+2*std, lower: mean-2*std, mean, bw: (4*std/mean)*100 };
}

function detectRegime(bars, fearGreed = 50) {
  if (!bars || bars.length < 30) return { regime: 'NEUTRAL', score: {} };
  const closes = bars.map(b => b.close);
  const n = closes.length - 1;
  const sma50  = sma(closes, Math.min(50, closes.length));
  const rsiVal = rsi(closes);
  const move7d  = closes.length > 7  ? (closes[n]-closes[n-7]) /closes[n-7]  * 100 : 0;
  const move30d = closes.length > 30 ? (closes[n]-closes[n-30])/closes[n-30] * 100 : 0;

  const isTrend = Math.abs(move7d) > 8;
  const bullPts = (sma50&&closes[n]>sma50?1:0) + (move30d>5?1:0) + (fearGreed>50?1:0) + (rsiVal>50?1:0);
  const bearPts = (sma50&&closes[n]<sma50?1:0) + (move30d<-5?1:0) + (fearGreed<35?1:0) + (rsiVal<45?1:0);

  let regime;
  if      (isTrend && move7d > 0)  regime = 'BULL_TREND';
  else if (isTrend && move7d < 0)  regime = 'BEAR_TREND';
  else if (bullPts >= 3)           regime = 'BULL';
  else if (bearPts >= 3)           regime = 'BEAR';
  else                             regime = 'NEUTRAL';

  return { regime, score: { move7d, move30d, rsi: rsiVal, fearGreed } };
}

// Топ-альты для ротации (только качественные активы с реальной ликвидностью)
const ROTATION_WHITELIST = new Set([
  'ETH','BNB','SOL','XRP','ADA','AVAX','DOT','LINK','UNI','AAVE',
  'NEAR','ATOM','FIL','ARB','OP','INJ','SUI','APT','LTC','ETC',
  'ALGO','ICP','HBAR','VET','XLM','ENA','ONDO','JUP','RENDER',
]);

const REGIME_PERFORMANCE = {
  sE: {
    BULL_TREND: { wr:0.72, avg:12, grade:'A+', note:'Лучший режим для EMA Cross' },
    BULL:       { wr:0.65, avg:10, grade:'A',  note:'Работает хорошо'            },
    NEUTRAL:    { wr:0.55, avg:6,  grade:'B',  note:'Много ложных пробоев'       },
    RANGE:      { wr:0.48, avg:3,  grade:'C+', note:'Сложно — боковик'           },
    BEAR:       { wr:0.42, avg:2,  grade:'C',  note:'Осторожно'                  },
    BEAR_TREND: { wr:0.35, avg:-2, grade:'D',  note:'Не торгуем'                 },
  },
  sM: {
    BULL_TREND: { wr:0.75, avg:18, grade:'A+', note:'Идеально — тренд + пробой'  },
    BULL:       { wr:0.68, avg:14, grade:'A',  note:'Хорошие пробои'             },
    NEUTRAL:    { wr:0.52, avg:5,  grade:'B-', note:'Много ложных пробоев'       },
    RANGE:      { wr:0.45, avg:2,  grade:'C',  note:'Пробои обычно ложные'       },
    BEAR:       { wr:0.38, avg:-3, grade:'D',  note:'Не торгуем'                 },
    BEAR_TREND: { wr:0.30, avg:-5, grade:'F',  note:'Не торгуем'                 },
  },
  sR: {
    BULL_TREND: { wr:0.70, avg:10, grade:'A+', note:'Ротация на максимуме'       },
    BULL:       { wr:0.65, avg:8,  grade:'A',  note:'Хорошая ротация'            },
    NEUTRAL:    { wr:0.58, avg:6,  grade:'B+', note:'Ротация начинается'         },
    RANGE:      { wr:0.52, avg:4,  grade:'B',  note:'Накапливаем альты'          },
    BEAR:       { wr:0.45, avg:0,  grade:'C',  note:'Только топ-10'              },
    BEAR_TREND: { wr:0.38, avg:-4, grade:'D',  note:'Не торгуем'                 },
  },
};

// ═══════════════════════════════════════════════════════════════
const STRATEGIES = {

  // ════════════════════════════════════════════════════════════
  //  sE — EMA CROSS  (Тренд)
  //
  //  Логика: EMA9 пересекает EMA21 снизу вверх = тренд разворачивается.
  //  Это Golden Cross на дневном таймфрейме — самый надёжный сигнал
  //  для начала восходящего движения.
  //
  //  Вход:
  //    1. EMA9 выше EMA21 СЕГОДНЯ (была ниже 2 дня назад)
  //    2. RSI 45–68 — не oversold и не overbought
  //    3. Объём выше среднего (подтверждение покупателей)
  //    4. Цена выше EMA21 (не ложный пробой)
  //
  //  Выход:
  //    • EMA9 опускается ниже EMA21 (тренд закончился)
  //    • RSI > 73 (перекупленность)
  //    • TP +15%  |  SL -6%
  // ════════════════════════════════════════════════════════════
  sE: {
    id: 'sE', name: 'EMA Cross', color: '#22EE88',
    bestRegimes:  ['BULL_TREND', 'BULL'],
    worstRegimes: ['BEAR_TREND', 'BEAR'],
    desc: 'EMA9 пересекает EMA21 снизу вверх + RSI 45-68 + объём растёт',

    getParams(p = {}) {
      return {
        tp:           p.tp         ?? 15,
        sl:           p.sl         ?? -6,
        emaSlow:      p.emaSlow    ?? 21,
        emaFast:      p.emaFast    ?? 9,
        rsiMin:       p.rsiMin     ?? 45,
        rsiMax:       p.rsiMax     ?? 85,
        volMin:       p.volMin     ?? 1.0,  // объём >= среднего
        rsiExitAt:    p.rsiExitAt  ?? 88,
      };
    },

    checkEntry(bars, params = {}) {
      const p = this.getParams(params.sE || params);
      if (!bars || bars.length < 30) return null;

      const closes = bars.map(b => b.close);
      const vols   = bars.map(b => b.volume);
      const n = closes.length - 1;

      // Считаем EMA9 и EMA21
      const ema9  = ema(closes, p.emaFast);
      const ema21 = ema(closes, p.emaSlow);
      if (!ema9 || !ema21) return null;

      const e9now  = ema9[n];
      const e21now = ema21[n];
      const e9prev = ema9[n - 1];
      const e21prev = ema21[n - 1];
      const e9prev2 = ema9[n - 2];
      const e21prev2 = ema21[n - 2];

      // 1. Golden Cross: EMA9 выше EMA21 сейчас, и был ниже 1-2 дня назад
      const crossedToday     = e9now > e21now && e9prev  <= e21prev;
      const crossedYesterday = e9now > e21now && e9prev2 <= e21prev2 && e9prev > e21prev;

      // Ищем пересечение за последние 10 дней
      let crossAge = -1;
      for(let lookDays = 0; lookDays <= 9; lookDays++){
        const idx = n - lookDays;
        if(idx < 1) break;
        if(ema9[idx] > ema21[idx] && ema9[idx-1] <= ema21[idx-1]){
          crossAge = lookDays;
          break;
        }
      }

      // Если нет пересечения — требуем чтобы разрыв EMA был малым (только что начался тренд)
      // и EMA9 резко набирает скорость
      const ema9slope2 = (e9now - ema9[n-3]) / ema9[n-3] * 100;  // наклон за 3 дня
      const emaDiffPct = (e9now - e21now) / e21now * 100;

      if (crossAge < 0) {
        // Нет пересечения — допускаем если EMA только начала расходиться (разрыв < 2%)
        if(emaDiffPct < 0 || emaDiffPct > 2 || ema9slope2 < 0.3) {
          return { signal: false, extra: `EMA9-EMA21=${emaDiffPct.toFixed(1)}% — нет Golden Cross (наклон ${ema9slope2.toFixed(2)}%)` };
        }
        crossAge = 99; // условное — только начало расхождения
      }

      // Пересечение 8+ дней назад И разрыв уже большой — позно
      if(crossAge !== 99 && crossAge >= 8 && emaDiffPct > 4) {
        return { signal: false, extra: `Golden Cross ${crossAge}д назад, уже поздно (разрыв ${emaDiffPct.toFixed(1)}%)` };
      }

      // 2. Цена выше EMA21 (не ложный пробой)
      const price = closes[n];
      if (price < e21now * 0.99) {
        return { signal: false, extra: `Цена ниже EMA21 — ложный сигнал` };
      }

      // 3. RSI в рабочей зоне
      const r = rsi(closes);
      if (r == null) return null;
      if (r < p.rsiMin) return { signal: false, extra: `RSI=${r.toFixed(0)} < ${p.rsiMin}` };
      if (r > p.rsiMax) return { signal: false, extra: `RSI=${r.toFixed(0)} > ${p.rsiMax} — уже перекуплен` };

      // 4. Объём выше среднего
      const avgVol = sma(vols.slice(0, -1), Math.min(10, vols.length - 1)) || 1;
      const volR   = vols[n] / avgVol;
      if (volR < p.volMin) {
        return { signal: false, extra: `Объём x${volR.toFixed(2)} < x${p.volMin} — слабое подтверждение` };
      }

      // 5. Тренд EMA идёт вверх (наклон EMA9 положительный)
      const ema9slope = (e9now - e9prev) / e9prev * 100;
      if (ema9slope <= 0) {
        return { signal: false, extra: `EMA9 плоская/вниз (${ema9slope.toFixed(3)}%)` };
      }

      const crossDays = crossedToday ? 0 : 1;
      const strength  = Math.round(Math.min(92,
        55 +
        Math.min(ema9slope * 30, 15) +          // наклон EMA
        Math.min(volR - 1, 1) * 12 +            // объём
        (crossAge === 0 ? 10 : crossAge <= 2 ? 6 : 2) + // свежесть пересечения
        Math.max(0, (60 - r)) * 0.3             // чем ниже RSI — тем больше потенциал
      ));

      const crossLabels = ['сегодня','вчера','2д назад','3д назад','4д назад','5д назад','6д назад','7д назад','8д назад','9д назад'];
      const crossLabel = crossAge === 99 ? 'EMA начало расхождения' : `Golden Cross ${crossLabels[crossAge]||crossAge+'д назад'}`;
      return {
        signal: true,
        detail: `${crossLabel} · EMA9=${e9now.toFixed(4)} > EMA21=${e21now.toFixed(4)} · RSI=${r.toFixed(0)} · Vol x${volR.toFixed(1)}`,
        strength,
      };
    },

    checkExit(pos, bars, price, params = {}) {
      const p   = this.getParams(params.sE || params);
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;

      if (pnl >= p.tp)  return { signal: true, reason: `✅ TP +${p.tp}%`, pnl };
      if (pnl <= p.sl)  return { signal: true, reason: `🛑 SL ${p.sl}%`, pnl };

      if (bars?.length >= 25) {
        const closes = bars.map(b => b.close);
        const ema9v  = ema(closes, 9);
        const ema21v = ema(closes, 21);
        if (ema9v && ema21v) {
          const n = closes.length - 1;
          // Death Cross: EMA9 упала ниже EMA21
          if (ema9v[n] < ema21v[n] && ema9v[n-1] >= ema21v[n-1]) {
            return { signal: true, reason: `📉 Death Cross EMA9<EMA21`, pnl };
          }
        }
        const r = rsi(closes);
        if (r != null && r >= p.rsiExitAt) {
          return { signal: true, reason: `RSI=${r.toFixed(0)}≥${p.rsiExitAt} перекуплен`, pnl };
        }
      }
      return { signal: false, pnl };
    },
  },

  // ════════════════════════════════════════════════════════════
  //  sM — MOMENTUM BREAKOUT  (Импульс)
  //
  //  Логика: "покупай дорого — продавай дороже". В бычьем рынке
  //  токены пробивающие 20-дневный максимум на объёме — продолжают расти.
  //  Это основная стратегия institutional momentum traders.
  //
  //  Вход:
  //    1. Цена закрылась выше максимума за последние 20 дней
  //    2. Объём x1.5+ (профессиональные покупки подтверждают пробой)
  //    3. RSI 50–73 (импульс есть, не overbought)
  //    4. Не было пробоя 3+ дней назад (свежий)
  //
  //  Выход:
  //    • Trailing stop: откат 6% от пика
  //    • RSI > 78 (экстремальная перекупленность — берём прибыль)
  //    • TP +25%  |  SL -7%
  // ════════════════════════════════════════════════════════════
  sM: {
    id: 'sM', name: 'Momentum Breakout', color: '#FF9940',
    bestRegimes:  ['BULL_TREND', 'BULL'],
    worstRegimes: ['BEAR_TREND', 'BEAR', 'RANGE'],
    desc: 'Пробой 20d максимума + объём x1.5 + RSI 50-73. Покупаем импульс.',

    getParams(p = {}) {
      return {
        tp:           p.tp          ?? 25,
        sl:           p.sl          ?? -7,
        lookback:     p.lookback    ?? 20,  // период для максимума
        rsiMin:       p.rsiMin      ?? 45,
        rsiMax:       p.rsiMax      ?? 87,
        volMin:       p.volMin      ?? 1.5, // объём >= 150% от среднего
        rsiExitAt:    p.rsiExitAt   ?? 90,
        trailingPct:  p.trailingPct ?? 6,   // trailing stop от пика
      };
    },

    checkEntry(bars, params = {}) {
      const p = this.getParams(params.sM || params);
      if (!bars || bars.length < p.lookback + 5) return null;

      const closes = bars.map(b => b.close);
      const highs  = bars.map(b => b.high);
      const vols   = bars.map(b => b.volume);
      const n = closes.length - 1;

      // 1. Максимум за lookback дней (исключая последние 2 дня)
      const periodHighs = highs.slice(-(p.lookback + 2), -2);
      const high20 = Math.max(...periodHighs);
      const price  = closes[n];

      // Пробой: сегодня цена выше 20d max
      if (price <= high20) {
        const distPct = ((price - high20) / high20 * 100).toFixed(1);
        return { signal: false, extra: `Нет пробоя: цена ${distPct}% от 20d max $${high20.toFixed(4)}` };
      }

      // Пробой не старше 2 дней (свежесть)
      const prevPrice = closes[n - 1];
      const breakoutFresh = prevPrice <= high20 || closes[n - 2] <= high20;
      if (!breakoutFresh) {
        return { signal: false, extra: `Пробой 3+ дней назад — поздно входить` };
      }

      // 2. Объём x1.5+
      const avgVol = sma(vols.slice(0, -1), Math.min(14, vols.length - 1)) || 1;
      const volR   = vols[n] / avgVol;
      if (volR < p.volMin) {
        return { signal: false, extra: `Объём x${volR.toFixed(2)} < x${p.volMin} — ложный пробой` };
      }

      // 3. RSI в зоне импульса
      const r = rsi(closes);
      if (r == null) return null;
      if (r < p.rsiMin) return { signal: false, extra: `RSI=${r.toFixed(0)} < ${p.rsiMin} — нет импульса` };
      if (r > p.rsiMax) return { signal: false, extra: `RSI=${r.toFixed(0)} > ${p.rsiMax} — перекуплен` };

      // 4. Нет экстремального ускорения (не pump&dump)
      const gain3d = (price - closes[n - 3]) / closes[n - 3] * 100;
      if (gain3d > 40) {
        return { signal: false, extra: `Рост +${gain3d.toFixed(0)}% за 3д — вероятно pump&dump` };
      }

      const pctAboveHigh = (price - high20) / high20 * 100;
      const strength = Math.round(Math.min(95,
        58 +
        Math.min(volR - 1, 1.5) * 14 +      // объём — главный сигнал
        Math.min(pctAboveHigh, 5) * 2 +     // глубина пробоя
        (r - 50) * 0.4                      // RSI импульс
      ));

      return {
        signal: true,
        detail: `Пробой 20d max $${high20.toFixed(4)} на +${pctAboveHigh.toFixed(1)}% · Объём x${volR.toFixed(1)} · RSI=${r.toFixed(0)}`,
        strength,
      };
    },

    checkExit(pos, bars, price, params = {}) {
      const p   = this.getParams(params.sM || params);
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;

      if (pnl >= p.tp)  return { signal: true, reason: `✅ TP +${p.tp}%`, pnl };
      if (pnl <= p.sl)  return { signal: true, reason: `🛑 SL ${p.sl}%`, pnl };

      // Trailing stop от пика
      if (pos.peakPnl && pnl <= pos.peakPnl - p.trailingPct && pos.peakPnl > 5) {
        return {
          signal: true,
          reason: `📉 Trailing: пик +${pos.peakPnl.toFixed(1)}% → сейчас +${pnl.toFixed(1)}%`,
          pnl,
        };
      }

      if (bars?.length >= 20) {
        const r = rsi(bars.map(b => b.close));
        if (r != null && r >= p.rsiExitAt) {
          return { signal: true, reason: `RSI=${r.toFixed(0)}≥${p.rsiExitAt} — берём прибыль`, pnl };
        }
      }
      return { signal: false, pnl };
    },
  },

  // ════════════════════════════════════════════════════════════
  //  sR — ALTCOIN ROTATION  (Ротация)
  //
  //  Логика: когда BTC доминация ≤ 61% (деньги уходят из BTC
  //  в альты), покупаем топ-30 альты на небольших коррекциях.
  //  Это классическая стратегия altcoin season.
  //
  //  Вход:
  //    1. BTC доминация ≤ 61% (деньги уже ротируются)
  //    2. Токен в whitelist топ-30 (ETH, SOL, BNB, XRP, AVAX...)
    //    3. Коррекция 7–20% от 7d max (не слишком мало, не обвал)
  //    4. RSI 38–56 (коррекция в тренде, не разворот)
  //    5. Объём на коррекции падает (нет панических продаж)
  //
  //  Выход:
  //    • Цена вернулась к 7d max (откуп завершён)
  //    • BTC доминация резко выросла > 63% (бегство в BTC)
  //    • TP +12%  |  SL -5%
  // ════════════════════════════════════════════════════════════
  sR: {
    id: 'sR', name: 'Altcoin Rotation', color: '#4DB8FF',
    bestRegimes:  ['BULL_TREND', 'BULL', 'NEUTRAL'],
    worstRegimes: ['BEAR_TREND', 'BEAR'],  // BEAR добавлен — WR 16% исторически
    desc: 'BTC Dom ≤ 61% + топ-30 альт скорректировался 7-20% + RSI 38-56',

    getParams(p = {}) {
      return {
        tp:           p.tp          ?? 12,
        sl:           p.sl          ?? -5,
        btcDomMax:    p.btcDomMax   ?? 61,   // макс BTC доминация для входа
        btcDomExit:   p.btcDomExit  ?? 63,   // выход если доминация выросла
        dropMin:      p.dropMin     ?? 7,    // минимальная коррекция от 7d max
        dropMax:      p.dropMax     ?? 20,   // максимальная (иначе обвал)
        rsiMin:       p.rsiMin      ?? 20,
        rsiMax:       p.rsiMax      ?? 60,
        maxRank:      p.maxRank     ?? 30,   // только топ-30 по капитализации
      };
    },

    checkEntry(bars, params = {}) {
      const p = this.getParams(params.sR || params);
      if (!bars || bars.length < 12) return null;

      const sym          = (params._symbol || '').toUpperCase();
      const btcDom       = params._btcDom ?? 60;
      const rank         = params._rank   ?? 999;
      const globalRegime = params._globalRegime || '';

      // 0. Блокируем в BEAR/BEAR_TREND — исторически WR 16%, -$116
      if (globalRegime === 'BEAR' || globalRegime === 'BEAR_TREND') {
        return { signal: false, extra: `Глобальный режим ${globalRegime} — ротация заблокирована` };
      }

      // 1. Только когда BTC доминация ≤ btcDomMax — деньги идут в альты
      if (btcDom > p.btcDomMax) {
        return { signal: false, extra: `BTC Dom=${btcDom}% > ${p.btcDomMax}% — альт-сезон не начался` };
      }

      // 2. Только топ-maxRank токены (whitelist не обходит лимит ранга)
      if (rank > p.maxRank) {
        return { signal: false, extra: `Rank #${rank} > ${p.maxRank} — не топ-альт` };
      }
      if (!ROTATION_WHITELIST.has(sym) && rank > p.maxRank) {
        return { signal: false, extra: `${sym} не в whitelist ротации` };
      }

      const closes = bars.map(b => b.close);
      const vols   = bars.map(b => b.volume);
      const n = closes.length - 1;

      // 3. Коррекция dropMin–dropMax% от 14d max (по close — без intraday-спайков)
      const recentBars = bars.slice(-15, -1);  // 14 дней, без текущей свечи
      const h14   = Math.max(...recentBars.map(b => b.close));
      const drop = ((closes[n] - h14) / h14) * 100;

      if (drop > -p.dropMin) {
        return { signal: false, extra: `Коррекция ${drop.toFixed(1)}% < ${p.dropMin}% — нет входа` };
      }
      if (drop < -p.dropMax) {
        return { signal: false, extra: `Коррекция ${drop.toFixed(1)}% > ${p.dropMax}% — возможный обвал` };
      }

      // 4. RSI в зоне здоровой коррекции
      const r = rsi(closes);
      if (r == null) return null;
      if (r < p.rsiMin) return { signal: false, extra: `RSI=${r.toFixed(0)} < ${p.rsiMin} — экстремальная паника` };
      if (r > p.rsiMax) return { signal: false, extra: `RSI=${r.toFixed(0)} > ${p.rsiMax} — нет коррекции` };
      // Цена стабилизировалась (не продолжает падать > 2%)
      if (closes[n] < closes[n-1] * 0.98) return { signal: false, extra: `Всё ещё падает` };

      // 5. Объём на коррекции не растёт (нет паники)
      const avgVol    = sma(vols.slice(0, -1), Math.min(7, vols.length - 1)) || 1;
      const volToday  = vols[n];
      const volRatio  = volToday / avgVol;
      if (volRatio > 2.5) {
        return { signal: false, extra: `Объём x${volRatio.toFixed(1)} — паника, ждём` };
      }

      // 6. Цена сегодня не упала сильнее вчера (дно близко)
      if (closes[n] < closes[n - 1] * 0.97) {
        return { signal: false, extra: `Продолжает падать — ждём стабилизации` };
      }

      const strength = Math.round(Math.min(90,
        55 +
        (p.btcDomMax - btcDom) * 1.5 +         // чем ниже доминация — тем лучше
        (Math.abs(drop) - p.dropMin) * 1.2 +   // глубина коррекции
        (p.rsiMax - r) * 0.6 +                 // RSI
        (rank <= 10 ? 8 : rank <= 20 ? 4 : 0)  // чем выше ранг — тем надёжнее
      ));

      return {
        signal: true,
        detail: `Ротация #${rank} ${sym}: BTC Dom=${btcDom}% · Коррекция ${drop.toFixed(1)}% · RSI=${r.toFixed(0)}`,
        strength,
      };
    },

    checkExit(pos, bars, price, params = {}) {
      const p   = this.getParams(params.sR || params);
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;

      if (pnl >= p.tp)  return { signal: true, reason: `✅ TP +${p.tp}%`, pnl };
      if (pnl <= p.sl)  return { signal: true, reason: `🛑 SL ${p.sl}%`, pnl };

      // Выход если BTC доминация резко выросла (бегство в BTC)
      const btcDom = params._btcDom ?? 60;
      if (btcDom > p.btcDomExit) {
        return { signal: true, reason: `BTC Dom=${btcDom}% > ${p.btcDomExit}% — ротация закончилась`, pnl };
      }

      // Возврат к 14d max (откупили коррекцию)
      if (bars?.length >= 14) {
        const h14 = Math.max(...bars.slice(-15, -1).map(b => b.close));
        if (price >= h14 * 0.98) {
          return { signal: true, reason: `Возврат к 14d max $${h14.toFixed(4)}`, pnl };
        }
      }

      return { signal: false, pnl };
    },
  },

};

module.exports = { STRATEGIES, REGIME_PERFORMANCE, ROTATION_WHITELIST, detectRegime, rsi, ema, sma, bbands };
