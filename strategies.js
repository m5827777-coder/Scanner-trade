'use strict';

// ════════════════════════════════════════════════════════════════
// СТРАТЕГИИ v4 — высокая избирательность
//
// Принцип: лучше 3 сделки в неделю с WR=80%, чем 50 сделок с WR=55%
//
// Ключевые изменения vs v3:
//   s1:  RSI≤38→≤30 + подтверждение объёмом
//   s3:  dropThr 8%→12% + объём на отскоке + RSI не выше 50
//   sA:  разница RSI 2→5 + строже зона входа (≤40)
//   sB:  F&G≤35→≤25 (только Extreme Fear) + RSI≤40
//   sC:  дистанция от SMA50 3%→1.5% (точное касание)
//   sD:  УБРАНА консолидация, только реальный дип:
//        RSI 30–48 + 7d падение ≥5% + рост объёма
//   ALL: minStrength=72 — слабые сигналы отфильтрованы
// ════════════════════════════════════════════════════════════════

function sma(arr, period) {
  if (!arr || arr.length < period) return null;
  return arr.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function ema(arr, period) {
  if (!arr || arr.length < period) return arr.map(() => null);
  const k = 2 / (period + 1);
  let e = arr[0];
  return arr.map(v => { e = v * k + e * (1 - k); return e; });
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
    else { ag = ag*(period-1)/period; al = (al*(period-1)-d)/period; }
  }
  return al === 0 ? 100 : 100 - (100 / (1 + ag / al));
}

function bbands(closes, period = 20) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return { upper: mean + 2*std, lower: mean - 2*std, mean, bw: (4*std/mean)*100 };
}

function detectRegime(bars, fearGreed = 50) {
  if (!bars || bars.length < 30) return { regime: 'UNKNOWN', score: {} };
  const closes = bars.map(b => b.close);
  const n = closes.length - 1;
  const sma20  = sma(closes, Math.min(20, closes.length));
  const sma50  = sma(closes, Math.min(50, closes.length));
  const sma200 = sma(closes, Math.min(200, closes.length));
  const rsiVal = rsi(closes);
  const bb     = bbands(closes);
  const move7d  = closes.length > 7  ? (closes[n]-closes[n-7])  /closes[n-7]  *100 : 0;
  const move30d = closes.length > 30 ? (closes[n]-closes[n-30]) /closes[n-30] *100 : 0;
  const price = closes[n];

  const bullPts = (sma50?price>sma50:0) + (sma200?price>sma200:0) + (move30d>5?1:0) + (fearGreed>55?1:0) + (rsiVal>50?1:0);
  const bearPts = (sma50?price<sma50:0) + (sma200?price<sma200:0) + (move30d<-5?1:0) + (fearGreed<35?1:0) + (rsiVal<45?1:0);
  const isTrend = Math.abs(move7d) > 8;
  const isRange = bb && bb.bw < 15;

  let regime;
  if (isTrend && move7d > 0)     regime = 'BULL_TREND';
  else if (isTrend && move7d < 0) regime = 'BEAR_TREND';
  else if (bullPts >= 4)          regime = 'BULL';
  else if (bearPts >= 4)          regime = 'BEAR';
  else if (isRange)               regime = 'RANGE';
  else                            regime = 'NEUTRAL';

  return { regime, score: { move7d, move30d, rsi: rsiVal, fearGreed } };
}

// ── Blacklist sD — токены без реальной выручки ────────────────
const SD_BLACKLIST = new Set([
  'DOGE','SHIB','PEPE','FLOKI','BONK','WIF','MEME','BOME','NEIRO','POPCAT',
  'BRETT','BABYDOGE','SATS','RATS','ORDI','LUNC','LUNA','TRUMP','SLERF',
  'PI','PUMP','RAIN','CC','WLFI','XMR','ZEC','BCH','EOS','TRX',
  'BOOK','COQ','TURBO','WOJAK','LADYS','AIDOGE','M','WBT','NEXO','HEX',
]);

const REGIME_PERFORMANCE = {
  s1:{BULL_TREND:{wr:0.65,avg:17,grade:'A+'},BULL:{wr:0.62,avg:14,grade:'A'},RANGE:{wr:0.70,avg:13,grade:'A+'},NEUTRAL:{wr:0.60,avg:11,grade:'B+'},BEAR:{wr:0.55,avg:8,grade:'B'},BEAR_TREND:{wr:0.42,avg:3,grade:'C'}},
  s3:{BULL_TREND:{wr:0.75,avg:18,grade:'A+'},BULL:{wr:0.72,avg:16,grade:'A+'},RANGE:{wr:0.67,avg:14,grade:'A'},NEUTRAL:{wr:0.65,avg:13,grade:'A'},BEAR:{wr:0.58,avg:9,grade:'B+'},BEAR_TREND:{wr:0.50,avg:5,grade:'B-'}},
  sA:{BULL_TREND:{wr:0.52,avg:8,grade:'B-'},BULL:{wr:0.56,avg:11,grade:'B'},RANGE:{wr:0.65,avg:13,grade:'A'},NEUTRAL:{wr:0.62,avg:12,grade:'A-'},BEAR:{wr:0.63,avg:14,grade:'A'},BEAR_TREND:{wr:0.60,avg:12,grade:'B+'}},
  sB:{BULL_TREND:{wr:0.40,avg:3,grade:'C'},BULL:{wr:0.44,avg:5,grade:'C+'},RANGE:{wr:0.60,avg:13,grade:'B+'},NEUTRAL:{wr:0.63,avg:14,grade:'A'},BEAR:{wr:0.68,avg:17,grade:'A+'},BEAR_TREND:{wr:0.65,avg:15,grade:'A'}},
  sC:{BULL_TREND:{wr:0.68,avg:14,grade:'A'},BULL:{wr:0.65,avg:12,grade:'A-'},RANGE:{wr:0.64,avg:12,grade:'A-'},NEUTRAL:{wr:0.60,avg:10,grade:'B+'},BEAR:{wr:0.52,avg:7,grade:'B'},BEAR_TREND:{wr:0.43,avg:2,grade:'C+'}},
  sD:{BULL_TREND:{wr:0.72,avg:16,grade:'A+'},BULL:{wr:0.70,avg:14,grade:'A+'},RANGE:{wr:0.67,avg:13,grade:'A'},NEUTRAL:{wr:0.65,avg:12,grade:'A'},BEAR:{wr:0.63,avg:11,grade:'A'},BEAR_TREND:{wr:0.58,avg:8,grade:'B+'}},
};

// ════════════════════════════════════════════════════════════════
// СТРАТЕГИИ
// ════════════════════════════════════════════════════════════════
const STRATEGIES = {

  // ══════════════════════════════════════════════════════════
  // S1: RSI BOUNCE
  // Вход: RSI ≤ 30 (реальный oversold, не просто 38)
  //       + подтверждение: объём выше среднего
  //       + цена не в свободном падении
  // ══════════════════════════════════════════════════════════
  s1: {
    id:'s1', name:'RSI Bounce', color:'#22EE88',
    bestRegimes:['BULL_TREND','BULL','RANGE','NEUTRAL'],
    worstRegimes:['BEAR_TREND'],
    desc:'Покупаем при RSI ≤ 30 + объём выше среднего. Только реальный oversold.',

    getParams(p={}) {
      return {
        tp:  p.tp  ?? 20,
        sl:  p.sl  ?? -7,
        rsiThr:    p.rsiThr    ?? 30,
        rsiExit:   p.rsiExit   ?? 65,
        minVolSpike: p.minVolSpike ?? 1.3,
      };
    },

    checkEntry(bars, params={}) {
      const p  = this.getParams(params.s1 || params);
      if (!bars || bars.length < 22) return null;

      const closes = bars.map(b => b.close);
      const vols   = bars.map(b => b.volume);
      const n = closes.length - 1;

      const r = rsi(closes);
      if (r == null) return null;

      // 1. RSI должен быть по-настоящему oversold
      if (r > p.rsiThr) return {signal:false, extra:`RSI=${r.toFixed(0)} > ${p.rsiThr}`};

      // 2. Нет свободного падения 4 дня подряд
      const freeFall = closes[n]<closes[n-1] && closes[n-1]<closes[n-2]
                    && closes[n-2]<closes[n-3] && closes[n-3]<closes[n-4];
      if (freeFall) return {signal:false, extra:`Свободное падение — RSI=${r.toFixed(0)}`};

      // 3. Объём сегодня выше среднего (подтверждение паники/отскока)
      const avgVol = sma(vols.slice(0,-1), Math.min(14, vols.length-1)) || 1;
      const volRatio = vols[n] / avgVol;
      if (volRatio < p.minVolSpike) {
        return {signal:false, extra:`Объём слабый x${volRatio.toFixed(1)} (нужно x${p.minVolSpike})`};
      }

      // 4. Вчера цена начала разворот (не надо ловить нож в моменте)
      const bounce = closes[n] >= closes[n-1] * 0.99;
      if (!bounce) return {signal:false, extra:`Нет подтверждения разворота`};

      const strength = Math.round(
        40 +
        (p.rsiThr - r) * 2.5 +         // чем глубже oversold — тем лучше
        Math.min(volRatio - 1, 1) * 20  // объём до +20
      );

      return {
        signal: true,
        detail: `RSI=${r.toFixed(1)} ≤ ${p.rsiThr} · Объём x${volRatio.toFixed(1)} · Разворот`,
        strength: Math.min(95, strength),
      };
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.s1 || params);
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      if (bars?.length >= 20) {
        const r = rsi(bars.map(b => b.close));
        if (r != null && r >= p.rsiExit) return {signal:true, reason:`RSI≥${p.rsiExit} (${r.toFixed(0)})`, pnl};
      }
      return {signal:false, pnl};
    },
  },

  // ══════════════════════════════════════════════════════════
  // S3: BUYBACK DIP
  // Вход: падение ≥12% от 7d max (было 8%)
  //       + объём растёт на отскоке (подтверждение дна)
  //       + RSI не ниже 25 (не в панике) и не выше 50
  // ══════════════════════════════════════════════════════════
  s3: {
    id:'s3', name:'Buyback Dip', color:'#00FFAA',
    bestRegimes:['BULL_TREND','BULL','RANGE','NEUTRAL','BEAR'],
    worstRegimes:['BEAR_TREND'],
    desc:'Просадка ≥12% от 7d max + подтверждение объёмом на отскоке.',

    getParams(p={}) {
      return {
        tp:  p.tp  ?? 18,
        sl:  p.sl  ?? -8,
        dropThr:     p.dropThr     ?? 12,
        rsiMinEntry: p.rsiMinEntry ?? 25,
        rsiMaxEntry: p.rsiMaxEntry ?? 50,
        volConfirm:  p.volConfirm  !== false,
      };
    },

    checkEntry(bars, params={}) {
      const p = this.getParams(params.s3 || params);
      if (!bars || bars.length < 10) return null;

      const closes = bars.map(b => b.close);
      const vols   = bars.map(b => b.volume);
      const n = closes.length - 1;

      // 1. Просадка от 7-дневного максимума
      const h7   = Math.max(...bars.slice(-8, -1).map(b => b.high));
      const drop  = ((closes[n] - h7) / h7) * 100;
      if (drop > -p.dropThr) {
        return {signal:false, extra:`Просадка ${drop.toFixed(1)}% < ${p.dropThr}%`};
      }

      // 2. RSI не в панике и не перекуплен
      const r = rsi(closes);
      if (r != null && r < p.rsiMinEntry) {
        return {signal:false, extra:`RSI=${r.toFixed(0)} < ${p.rsiMinEntry} — паника`};
      }
      if (r != null && r > p.rsiMaxEntry) {
        return {signal:false, extra:`RSI=${r.toFixed(0)} > ${p.rsiMaxEntry} — перекуплен`};
      }

      // 3. Объём сегодня выше позавчерашнего (деньги заходят обратно)
      if (p.volConfirm) {
        const volToday = vols[n];
        const volAvg   = sma(vols.slice(1, -1), Math.min(7, vols.length-2)) || 1;
        const volRatio = volToday / volAvg;
        if (volRatio < 1.1) {
          return {signal:false, extra:`Объём не подтверждает x${volRatio.toFixed(1)}`};
        }
      }

      // 4. Сегодня цена выше вчерашней (отскок начался)
      if (closes[n] <= closes[n-1]) {
        return {signal:false, extra:`Нет отскока: сегодня ≤ вчера`};
      }

      const strength = Math.round(Math.min(98,
        50 +
        Math.min(Math.abs(drop) - p.dropThr, 15) * 2.5 +  // глубина дипа
        (r ? Math.max(0, p.rsiMaxEntry - r) * 0.5 : 0)    // чем ниже RSI — тем лучше
      ));

      return {
        signal: true,
        detail: `Просадка ${drop.toFixed(1)}% от 7d max ($${h7.toFixed(4)}) · RSI=${r?.toFixed(0)} · Отскок`,
        strength,
      };
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.s3 || params);
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      if (bars?.length >= 7) {
        const s = sma(bars.map(b => b.close), 7);
        if (s && price >= s * 0.997) return {signal:true, reason:`Возврат к SMA7 ($${s.toFixed(4)})`, pnl};
      }
      return {signal:false, pnl};
    },
  },

  // ══════════════════════════════════════════════════════════
  // SA: RSI DIVERGENCE
  // Вход: разница RSI ≥5 (было ≥2), RSI≤40 (было ≤45)
  //       + подтверждение: объём не падает
  // ══════════════════════════════════════════════════════════
  sA: {
    id:'sA', name:'RSI Divergence', color:'#C084FC',
    bestRegimes:['BEAR','RANGE','NEUTRAL','BEAR_TREND'],
    worstRegimes:['BULL_TREND'],
    desc:'Бычья дивергенция: цена даёт новый минимум, RSI — нет. Разница ≥5 пунктов.',

    getParams(p={}) {
      return {
        tp:  p.tp  ?? 15,
        sl:  p.sl  ?? -5,
        rsiMaxEntry:    p.rsiMaxEntry    ?? 40,
        rsiExitAt:      p.rsiExitAt      ?? 58,
        minDivStrength: p.minDivStrength ?? 5,
      };
    },

    checkEntry(bars, params={}) {
      const p = this.getParams(params.sA || params);
      if (!bars || bars.length < 30) return null;

      const closes = bars.map(b => b.close);
      const vols   = bars.map(b => b.volume);
      const n = closes.length - 1;

      const rsiNow  = rsi(closes);
      const rsiPrev = rsi(closes.slice(0, -4));
      if (rsiNow == null || rsiPrev == null) return null;

      // 1. Цена даёт новый минимум
      const priceLower = closes[n] < closes[n-4] && closes[n] < closes[n-2];
      if (!priceLower) return {signal:false, extra:`Цена не на минимуме`};

      // 2. RSI выше предыдущего значения — дивергенция
      const divDiff = rsiNow - rsiPrev;
      if (divDiff < p.minDivStrength) {
        return {signal:false, extra:`Дивергенция слабая: RSI diff=${divDiff.toFixed(1)} < ${p.minDivStrength}`};
      }

      // 3. RSI в зоне oversold (≤40, было ≤45)
      if (rsiNow > p.rsiMaxEntry || rsiNow < 15) {
        return {signal:false, extra:`RSI=${rsiNow.toFixed(0)} вне зоны 15–${p.rsiMaxEntry}`};
      }

      // 4. Объём не рухнул (иначе никого нет в рынке)
      const volAvg = sma(vols.slice(0,-1), 7) || 1;
      if (vols[n] < volAvg * 0.5) {
        return {signal:false, extra:`Объём слишком низкий`};
      }

      const strength = Math.round(Math.min(95,
        55 + divDiff * 3 + (p.rsiMaxEntry - rsiNow) * 0.8
      ));

      return {
        signal: true,
        detail: `Бычья дивергенция: цена↓ RSI↑ (${rsiPrev.toFixed(0)}→${rsiNow.toFixed(0)}, Δ=${divDiff.toFixed(1)})`,
        strength,
      };
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.sA || params);
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      if (bars?.length >= 20) {
        const r = rsi(bars.map(b => b.close));
        if (r != null && r >= p.rsiExitAt) return {signal:true, reason:`RSI≥${p.rsiExitAt} (${r.toFixed(0)})`, pnl};
      }
      return {signal:false, pnl};
    },
  },

  // ══════════════════════════════════════════════════════════
  // SB: FEAR & GREED REVERSAL
  // Вход: только Extreme Fear (F&G≤25), не просто Fear (≤35)
  //       RSI≤40 + отскок + не в свободном падении
  // ══════════════════════════════════════════════════════════
  sB: {
    id:'sB', name:'F&G Reversal', color:'#FF9940',
    bestRegimes:['BEAR','NEUTRAL','BEAR_TREND','RANGE'],
    worstRegimes:['BULL_TREND'],
    desc:'Только Extreme Fear (F&G≤25) + RSI≤40 + подтверждённый отскок.',

    getParams(p={}) {
      return {
        tp:  p.tp  ?? 20,
        sl:  p.sl  ?? -7,
        fgThreshold: p.fgThreshold ?? 25,
        fgExtreme:   p.fgExtreme   ?? 15,
        rsiMaxEntry: p.rsiMaxEntry ?? 40,
      };
    },

    checkEntry(bars, params={}) {
      const p  = this.getParams(params.sB || params);
      if (!bars || bars.length < 14) return null;

      const closes = bars.map(b => b.close);
      const vols   = bars.map(b => b.volume);
      const n = closes.length - 1;
      const fg = params.fearGreed || 50;

      // 1. Только Extreme Fear (≤25), не просто Fear
      if (fg > p.fgThreshold) {
        return {signal:false, extra:`F&G=${fg} > ${p.fgThreshold} — недостаточно страха`};
      }

      // 2. RSI в зоне oversold (строже: ≤40)
      const r = rsi(closes);
      if (r != null && r > p.rsiMaxEntry) {
        return {signal:false, extra:`RSI=${r.toFixed(0)} > ${p.rsiMaxEntry}`};
      }
      if (r != null && r < 18) {
        return {signal:false, extra:`RSI=${r.toFixed(0)} < 18 — паника, ждём`};
      }

      // 3. Цена сегодня выше вчера И позавчера (отскок начался всерьёз)
      const strongBounce = closes[n] > closes[n-1] && closes[n-1] > closes[n-2];
      if (!strongBounce) {
        return {signal:false, extra:`Нет 2-дневного отскока`};
      }

      // 4. Падение за 7 дней есть (есть что откупать)
      const drop7 = (closes[n] - closes[n-7]) / closes[n-7] * 100;
      if (drop7 > -5) {
        return {signal:false, extra:`Нет достаточного падения: 7d=${drop7.toFixed(1)}%`};
      }

      // 5. Объём на отскоке выше среднего
      const volAvg = sma(vols.slice(0,-1), 7) || 1;
      const volRatio = vols[n] / volAvg;
      if (volRatio < 1.1) {
        return {signal:false, extra:`Объём слабый x${volRatio.toFixed(1)}`};
      }

      const extreme = fg <= p.fgExtreme;
      const strength = Math.round(Math.min(95,
        60 +
        (p.fgThreshold - fg) * 1.5 +
        (r ? Math.max(0, p.rsiMaxEntry - r) : 0) * 0.5 +
        (extreme ? 10 : 0)
      ));

      return {
        signal: true,
        detail: `F&G=${fg}${extreme?' (Extreme Fear)':''} · RSI=${r?.toFixed(0)} · Отскок 2д · 7d=${drop7.toFixed(1)}%`,
        strength,
      };
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.sB || params);
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      const fg = params.fearGreed || 50;
      if (fg > 50) return {signal:true, reason:`F&G восстановился до ${fg} (нейтральный)`, pnl};
      return {signal:false, pnl};
    },
  },

  // ══════════════════════════════════════════════════════════
  // SC: SMA50 BOUNCE
  // Вход: цена точно касается SMA50 (±1.5%, было ±3%)
  //       + RSI не выше 52 + подтверждение отскока
  // ══════════════════════════════════════════════════════════
  sC: {
    id:'sC', name:'SMA50 Bounce', color:'#4DB8FF',
    bestRegimes:['BULL_TREND','BULL','RANGE','NEUTRAL'],
    worstRegimes:['BEAR_TREND'],
    desc:'Точное касание SMA50 (±1.5%) + отскок вверх. RSI нейтральный.',

    getParams(p={}) {
      return {
        tp:  p.tp  ?? 12,
        sl:  p.sl  ?? -5,
        smaPeriod:   p.smaPeriod   ?? 50,
        smaDistPct:  p.smaDistPct  ?? 1.5,
        rsiMaxEntry: p.rsiMaxEntry ?? 52,
      };
    },

    checkEntry(bars, params={}) {
      const p = this.getParams(params.sC || params);
      if (!bars || bars.length < p.smaPeriod + 5) return null;

      const closes = bars.map(b => b.close);
      const n = closes.length - 1;
      const sma50 = sma(closes, p.smaPeriod);
      if (!sma50) return null;

      const price    = closes[n];
      const prevPrice = closes[n-1];
      const prev2    = closes[n-2];

      // 1. Вчера ИЛИ позавчера цена касалась SMA50 снизу (±1.5%)
      const touch     = Math.abs(prevPrice - sma50) / sma50 * 100;
      const touch2    = Math.abs(prev2 - sma50) / sma50 * 100;
      const wasTouching = (touch <= p.smaDistPct || touch2 <= p.smaDistPct) && prevPrice <= sma50 * 1.01;
      if (!wasTouching) {
        return {signal:false, extra:`SMA50 $${sma50.toFixed(4)} — нет касания (dist=${touch.toFixed(1)}%)`};
      }

      // 2. Сегодня цена выше SMA50 — пробой вверх
      if (price <= sma50) {
        return {signal:false, extra:`Цена ещё ниже SMA50`};
      }

      // 3. RSI нейтральный, не перекуплен
      const r = rsi(closes);
      if (r != null && r > p.rsiMaxEntry) {
        return {signal:false, extra:`RSI=${r.toFixed(0)} > ${p.rsiMaxEntry} — перекуплен`};
      }
      if (r != null && r < 28) {
        return {signal:false, extra:`RSI=${r.toFixed(0)} — слишком слабо для SMA-отскока`};
      }

      // 4. Цена выше SMA50 не слишком далеко (иначе пропустили вход)
      const distNow = (price - sma50) / sma50 * 100;
      if (distNow > p.smaDistPct * 1.5) {
        return {signal:false, extra:`Цена ушла далеко от SMA50: +${distNow.toFixed(1)}%`};
      }

      const strength = Math.round(Math.min(90,
        62 + (p.smaDistPct - touch) * 5 + (r ? (52 - r) * 0.4 : 0)
      ));

      return {
        signal: true,
        detail: `Пробой SMA${p.smaPeriod} $${sma50.toFixed(4)} · dist=${distNow.toFixed(2)}% · RSI=${r?.toFixed(0)}`,
        strength,
      };
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.sC || params);
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      if (bars?.length >= p.smaPeriod) {
        const s = sma(bars.map(b => b.close), p.smaPeriod);
        if (s && price < s * 0.988) return {signal:true, reason:`Пробой SMA${p.smaPeriod} вниз`, pnl};
      }
      return {signal:false, pnl};
    },
  },

  // ══════════════════════════════════════════════════════════
  // SD: DAMODARAN P/R — полная переработка
  //
  // Было: RSI 22-65 + "консолидация" → открывал 36/50 за 1 скан
  // Стало: RSI 30-48 + реальный дип 7d≥5% + рост объёма
  //        Требует 3 условия ОДНОВРЕМЕННО:
  //        (A) RSI в зоне умеренного oversold (30–48)
  //        (B) 7-дневное падение ≥5% (есть что откупать)
  //        (C) Объём растёт — деньги заходят
  //
  // Результат: 2-5 сигналов в неделю, не 36 за один скан
  // ══════════════════════════════════════════════════════════
  sD: {
    id:'sD', name:'Damodaran P/R', color:'#F59E0B',
    bestRegimes:['BULL','BULL_TREND','RANGE','NEUTRAL','BEAR'],
    worstRegimes:[],
    desc:'Фундаментальный дип: RSI 30–48 + падение 7d≥5% + рост объёма. Без мемов.',

    getParams(p={}) {
      return {
        tp:  p.tp  ?? 15,
        sl:  p.sl  ?? -8,
        rsiMin:     p.rsiMin     ?? 30,
        rsiMax:     p.rsiMax     ?? 48,
        drop7Min:   p.drop7Min   ?? 5,
        drop30Max:  p.drop30Max  ?? -35,
        volSpikeMin: p.volSpikeMin ?? 1.2,
      };
    },

    checkEntry(bars, params={}) {
      const p   = this.getParams(params.sD || params);
      if (!bars || bars.length < 35) return null;

      // BLACKLIST — мемы и мусор никогда
      const sym = (params._symbol || '').toUpperCase();
      if (sym && SD_BLACKLIST.has(sym)) {
        return {signal:false, extra:`${sym} в blacklist (мем/мусор)`};
      }

      const closes = bars.map(b => b.close);
      const vols   = bars.map(b => b.volume);
      const n = closes.length - 1;

      // ── УСЛОВИЕ A: RSI в зоне умеренного oversold ─────────
      const r = rsi(closes);
      if (r == null || r < p.rsiMin || r > p.rsiMax) {
        return {signal:false, extra:`RSI=${r?.toFixed(0)} вне зоны ${p.rsiMin}–${p.rsiMax}`};
      }

      // ── УСЛОВИЕ B: 7-дневное падение (есть дип для входа) ─
      const drop7  = (closes[n] - closes[n-7])  / closes[n-7]  * 100;
      const drop30 = (closes[n] - closes[n-29]) / closes[n-29] * 100;

      if (Math.abs(drop7) < p.drop7Min) {
        return {signal:false, extra:`7d=${drop7.toFixed(1)}% — нет дипа (нужно ≤-${p.drop7Min}%)`};
      }
      if (drop7 > 0) {
        return {signal:false, extra:`7d=${drop7.toFixed(1)}% — рост, а не дип`};
      }
      if (drop30 < p.drop30Max) {
        return {signal:false, extra:`30d=${drop30.toFixed(0)}% — дистресс-актив`};
      }

      // ── УСЛОВИЕ C: Объём растёт (деньги заходят обратно) ──
      const avgVol7 = sma(vols.slice(-8, -1), 7) || 1;
      const volRatio = vols[n] / avgVol7;
      if (volRatio < p.volSpikeMin) {
        return {signal:false, extra:`Объём x${volRatio.toFixed(2)} < x${p.volSpikeMin} — нет интереса`};
      }

      // ── УСЛОВИЕ D: Не у ATH (должен быть апсайд) ──────────
      const hi30 = Math.max(...closes.slice(-30));
      const distFromHigh = (closes[n] - hi30) / hi30 * 100;
      if (distFromHigh > -3) {
        return {signal:false, extra:`Цена у ATH30 (${distFromHigh.toFixed(1)}%)`};
      }

      // ── УСЛОВИЕ E: Начало разворота (хотя бы 1 зелёный день) ─
      if (closes[n] <= closes[n-1]) {
        return {signal:false, extra:`Нет разворота: сегодня ≤ вчера`};
      }

      const strength = Math.round(Math.min(92,
        52 +
        Math.min(Math.abs(drop7) - p.drop7Min, 10) * 2 +  // глубина дипа
        (p.rsiMax - r) * 1.2 +                             // чем ниже RSI — тем лучше
        Math.min(volRatio - 1, 1) * 12                     // объём
      ));

      return {
        signal: true,
        detail: `Damodaran дип: RSI=${r.toFixed(0)}, 7d=${drop7.toFixed(1)}%, Объём x${volRatio.toFixed(1)}`,
        strength,
      };
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.sD || params);
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      if (bars?.length >= 20) {
        const r = rsi(bars.map(b => b.close));
        if (r != null && r >= 70) return {signal:true, reason:`RSI≥70 (${r.toFixed(0)})`, pnl};
      }
      return {signal:false, pnl};
    },
  },
};

module.exports = { STRATEGIES, REGIME_PERFORMANCE, SD_BLACKLIST, detectRegime, rsi, ema, sma, bbands };
