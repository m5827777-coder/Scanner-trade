'use strict';

// ═══════════════════════════════════════════════════════════════
// СТРАТЕГИИ v5 DCA — только s3 (Buyback Dip)
//
// Логика: DCA в просадку + частичный выход
//   Вход:  просадка ≥15% от 7d max + RSI 15-30 + объём выше нормы
//   Выход: ½ позиции при возврате к SMA7
//          ½ позиции при TP +18%
//   SL:    нет (DCA — при падении докупаем, не стопируемся)
//   Макс:  5 входов на токен, 1 неделя между входами
// ═══════════════════════════════════════════════════════════════

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
  const move7d  = closes.length > 7  ? (closes[n]-closes[n-7]) /closes[n-7]  *100 : 0;
  const move30d = closes.length > 30 ? (closes[n]-closes[n-30])/closes[n-30] *100 : 0;
  const isTrend = Math.abs(move7d) > 8;

  let regime;
  if (isTrend && move7d > 0)     regime = 'BULL_TREND';
  else if (isTrend && move7d < 0) regime = 'BEAR_TREND';
  else if ((sma50 && closes[n]>sma50) && move30d>5) regime = 'BULL';
  else if ((sma50 && closes[n]<sma50) && move30d<-5) regime = 'BEAR';
  else                            regime = 'NEUTRAL';

  return { regime, score: { move7d, move30d, rsi: rsiVal, fearGreed } };
}

const REGIME_PERFORMANCE = {
  s3: {
    BULL_TREND: { wr:0.75, avg:18, grade:'A+', note:'Лучший режим для дипов' },
    BULL:       { wr:0.72, avg:16, grade:'A+', note:'Дипы откупаются быстро' },
    RANGE:      { wr:0.67, avg:14, grade:'A',  note:'Хорошая волатильность'  },
    NEUTRAL:    { wr:0.65, avg:13, grade:'A',  note:'Работает стабильно'     },
    BEAR:       { wr:0.55, avg:8,  grade:'B',  note:'DCA защищает'           },
    BEAR_TREND: { wr:0.48, avg:4,  grade:'C+', note:'Осторожно, глубокий дип'},
  },
};

// ═══════════════════════════════════════════════════════════════
// S3: BUYBACK DIP (DCA версия)
// ═══════════════════════════════════════════════════════════════
const STRATEGIES = {
  s3: {
    id: 's3',
    name: 'Buyback Dip DCA',
    color: '#00FFAA',
    bestRegimes:  ['BULL_TREND','BULL','RANGE','NEUTRAL'],
    worstRegimes: [],   // нет запрещённых режимов — DCA работает везде

    getParams(p = {}) {
      return {
        tp:         p.tp         ?? 18,   // TP для второй ½
        dropThr:    p.dropThr    ?? 15,   // минимальная просадка от 7d max (%)
        rsiMin:     p.rsiMin     ?? 15,   // RSI нижняя граница (ниже — паника)
        rsiMax:     p.rsiMax     ?? 30,   // RSI верхняя граница (выше — не oversold)
        volMult:    p.volMult    ?? 1.0,  // объём должен быть ≥ среднего за 7д
      };
    },

    // ── ВХОД ────────────────────────────────────────────────────
    checkEntry(bars, params = {}) {
      const p = this.getParams(params.s3 || params);
      if (!bars || bars.length < 20) return null;

      const closes = bars.map(b => b.close);
      const vols   = bars.map(b => b.volume);
      const n = closes.length - 1;

      // 1. Просадка от 7-дневного максимума ≥15%
      const h7   = Math.max(...bars.slice(-8, -1).map(b => b.high));
      const drop = ((closes[n] - h7) / h7) * 100;
      if (drop > -p.dropThr) {
        return { signal: false, extra: `Просадка ${drop.toFixed(1)}% < ${p.dropThr}%` };
      }

      // 2. RSI в зоне реального oversold (15–30)
      const r = rsi(closes);
      if (r == null) return null;
      if (r < p.rsiMin) {
        return { signal: false, extra: `RSI=${r.toFixed(0)} < ${p.rsiMin} — паника, ждём` };
      }
      if (r > p.rsiMax) {
        return { signal: false, extra: `RSI=${r.toFixed(0)} > ${p.rsiMax} — не oversold` };
      }

      // 3. Объём сегодня ≥ среднего за 7 дней (покупатели заходят)
      const avgVol = sma(vols.slice(0, -1), Math.min(7, vols.length - 1)) || 1;
      const volR   = vols[n] / avgVol;
      if (volR < p.volMult) {
        return { signal: false, extra: `Объём x${volR.toFixed(2)} < x${p.volMult} — нет интереса` };
      }

      // 4. Цена сегодня ≥ вчерашней — хоть минимальный разворот
      if (closes[n] < closes[n - 1] * 0.998) {
        return { signal: false, extra: `Цена всё ещё падает` };
      }

      const strength = Math.round(Math.min(95,
        55 +
        Math.min(Math.abs(drop) - p.dropThr, 15) * 2 +  // глубина дипа
        (p.rsiMax - r) * 1.5 +                           // чем ниже RSI — тем лучше
        Math.min(volR - 1, 2) * 8                        // объём
      ));

      return {
        signal: true,
        detail: `Дип ${drop.toFixed(1)}% · RSI=${r.toFixed(0)} · Объём x${volR.toFixed(1)}`,
        strength,
      };
    },

    // ── ВЫХОД (частичный) ────────────────────────────────────────
    // Возвращает: { signal, half, reason, pnl }
    //   half=true  → закрыть ½ позиции (SMA7 достигнута)
    //   half=false → закрыть полностью (TP +18%)
    checkExit(pos, bars, price, params = {}) {
      const p   = this.getParams(params.s3 || params);
      const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;

      // TP +18% — закрыть всё (или вторую ½ если первая уже закрыта)
      if (pnl >= p.tp) {
        return { signal: true, half: false, reason: `✅ TP +${p.tp}% полная фиксация`, pnl };
      }

      // SMA7 — закрыть первую ½ (только если ещё не закрывали)
      if (!pos.halfClosed && bars?.length >= 7) {
        const sma7 = sma(bars.map(b => b.close), 7);
        if (sma7 && price >= sma7 * 0.997) {
          return {
            signal: true,
            half:   true,
            reason: `📊 SMA7 $${sma7.toFixed(4)} — фиксируем ½`,
            pnl,
          };
        }
      }

      // После закрытия первой ½ — ждём только TP +18%
      if (pos.halfClosed) {
        return { signal: false, pnl, extra: `Ждём TP+18% (½ закрыта) · текущий ${pnl.toFixed(1)}%` };
      }

      return { signal: false, pnl };
    },
  },
};

module.exports = { STRATEGIES, REGIME_PERFORMANCE, detectRegime, rsi, ema, sma, bbands };
