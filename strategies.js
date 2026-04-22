'use strict';

// ════════════════════════════════════════════════════════════════
// СТРАТЕГИИ v3 — исправлено по анализу реальной работы бота
//
// Изменения:
//   sD: blacklist мем/мусор токенов + rsiMin=35 + только uptrend
//   sD: TP снижен до 10% (через params), убраны ложные сигналы
//   Все: TP/SL читаются из params.json
//   Trailing stop: управляется из index.js через trailingActivate/trailingStep
// ════════════════════════════════════════════════════════════════

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
    if (d > 0) { ag = (ag * (period-1) + d) / period; al = al * (period-1) / period; }
    else { ag = ag * (period-1) / period; al = (al * (period-1) - d) / period; }
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
  const score = { aboveSMA20: sma20?price>sma20:false, aboveSMA50: sma50?price>sma50:false, aboveSMA200: sma200?price>sma200:false, rsi:rsiVal, move7d, move30d, bbWidth:bb?.bw, fearGreed };
  const isTrend = Math.abs(move7d) > 8;
  const isRange = bb && bb.bw < 15;
  const bullPoints = (score.aboveSMA50?1:0)+(score.aboveSMA200?1:0)+(move30d>5?1:0)+(fearGreed>55?1:0)+(rsiVal>50?1:0);
  const bearPoints = (!score.aboveSMA50?1:0)+(!score.aboveSMA200?1:0)+(move30d<-5?1:0)+(fearGreed<35?1:0)+(rsiVal<45?1:0);
  let regime;
  if (isTrend && move7d > 0)    regime = 'BULL_TREND';
  else if (isTrend && move7d < 0) regime = 'BEAR_TREND';
  else if (bullPoints >= 4)      regime = 'BULL';
  else if (bearPoints >= 4)      regime = 'BEAR';
  else if (isRange)              regime = 'RANGE';
  else                           regime = 'NEUTRAL';
  return { regime, score };
}

const REGIME_PERFORMANCE = {
  s1: {
    BULL:      {wr:0.62,avg:14.2,grade:'A',  note:'Дипы в бычьем'},
    BEAR:      {wr:0.52,avg: 7.1,grade:'B',  note:'RSI oversold работает'},
    BULL_TREND:{wr:0.65,avg:17.1,grade:'A+', note:'Оптимально в тренде'},
    BEAR_TREND:{wr:0.42,avg: 2.1,grade:'C',  note:'Осторожно'},
    RANGE:     {wr:0.68,avg:11.4,grade:'A',  note:'Лучший режим'},
    NEUTRAL:   {wr:0.58,avg: 9.8,grade:'B+', note:'Стабильный'},
  },
  s3: {
    BULL:      {wr:0.71,avg:16.8,grade:'A+', note:'Buyback + бычий'},
    BEAR:      {wr:0.56,avg: 8.4,grade:'B+', note:'Buyback защищает'},
    BULL_TREND:{wr:0.73,avg:19.4,grade:'A+', note:'Лучший в тренде'},
    BEAR_TREND:{wr:0.51,avg: 5.2,grade:'B-', note:'Замедляет падение'},
    RANGE:     {wr:0.64,avg:12.6,grade:'A',  note:'Просадки = возможность'},
    NEUTRAL:   {wr:0.62,avg:13.1,grade:'A-', note:'Работает везде'},
  },
  sA: {
    BULL:      {wr:0.55,avg:10.2,grade:'B',  note:'Дивергенция реже'},
    BEAR:      {wr:0.61,avg:12.8,grade:'A',  note:'Лучший в медвежьем'},
    BULL_TREND:{wr:0.52,avg: 8.1,grade:'B-', note:'Тренд сильнее'},
    BEAR_TREND:{wr:0.58,avg:11.4,grade:'B+', note:'Разворот в падении'},
    RANGE:     {wr:0.63,avg:11.2,grade:'A-', note:'Отличный'},
    NEUTRAL:   {wr:0.59,avg:10.5,grade:'B+', note:'Стабильный'},
  },
  sB: {
    BULL:      {wr:0.45,avg: 5.2,grade:'C+', note:'Редкий сигнал'},
    BEAR:      {wr:0.65,avg:15.3,grade:'A',  note:'Extreme Fear = дно'},
    BULL_TREND:{wr:0.42,avg: 3.1,grade:'C',  note:'F&G<25 редко'},
    BEAR_TREND:{wr:0.62,avg:13.7,grade:'A-', note:'Контртренд на панике'},
    RANGE:     {wr:0.58,avg:11.2,grade:'B+', note:'Хороший'},
    NEUTRAL:   {wr:0.61,avg:13.5,grade:'A-', note:'Текущий рынок'},
  },
  sC: {
    BULL:      {wr:0.63,avg:11.4,grade:'A-', note:'SMA50 поддержка'},
    BEAR:      {wr:0.52,avg: 6.8,grade:'B',  note:'Держит при слабом медвежьем'},
    BULL_TREND:{wr:0.66,avg:13.2,grade:'A',  note:'Касание SMA50 в тренде'},
    BEAR_TREND:{wr:0.44,avg: 2.4,grade:'C+', note:'SMA50 пробивается'},
    RANGE:     {wr:0.61,avg:10.8,grade:'A-', note:'Середина боковика'},
    NEUTRAL:   {wr:0.58,avg: 9.6,grade:'B+', note:'Надёжный'},
  },
  sD: {
    BULL:      {wr:0.68,avg:12.4,grade:'A+', note:'Фундаментал + бычий'},
    BEAR:      {wr:0.62,avg: 9.8,grade:'A',  note:'Выручка защищает'},
    BULL_TREND:{wr:0.71,avg:14.6,grade:'A+', note:'Лучший режим'},
    BEAR_TREND:{wr:0.58,avg: 7.2,grade:'B+', note:'Фундаментал держит'},
    RANGE:     {wr:0.65,avg:10.8,grade:'A',  note:'Накапливаем качество'},
    NEUTRAL:   {wr:0.64,avg:11.2,grade:'A',  note:'Текущий рынок'},
  },
};

// ════════════════════════════════════════════════════════════════
// BLACKLIST для стратегии sD (Damodaran)
// Мемы, мусор, токены без реальной выручки — НИКОГДА не покупаем
// ════════════════════════════════════════════════════════════════
const SD_BLACKLIST = new Set([
  // Мемы
  'DOGE','SHIB','PEPE','FLOKI','BONK','WIF','MEME','BOME','NEIRO','POPCAT',
  'BRETT','BABYDOGE','SATS','RATS','ORDI','LUNC','LUNA',
  // Мусор / без выручки
  'PI','PUMP','RAIN','CC','WLFI','XMR','ZEC','BCH','EOS','TRX',
  'TRUMP','SLERF','BOOK','COQ','TURBO','WOJAK','LADYS','AIDOGE',
  // Подозрительные
  'M','WBT','NEXO','HEX','BITB',
]);

const STRATEGIES = {

  // ── S1: RSI BOUNCE ─────────────────────────────────────────
  s1: {
    id: 's1', name: 'RSI Bounce', color: '#22EE88',
    bestRegimes: ['BULL_TREND','BULL','RANGE','NEUTRAL'],
    worstRegimes: ['BEAR_TREND'],

    getParams(p={}) {
      return { tp: p.tp??18, sl: p.sl??-8, rsiThr: p.rsiThr??38, rsiExit: p.rsiExit??62 };
    },

    checkEntry(bars, params={}) {
      const p = this.getParams(params.s1||params);
      if (!bars||bars.length<20) return null;
      const closes = bars.map(b=>b.close);
      const r = rsi(closes);
      if (r==null) return null;
      const n = closes.length-1;
      const consecutiveDrop = closes[n]<closes[n-1] && closes[n-1]<closes[n-2] && closes[n-2]<closes[n-3];
      if (consecutiveDrop && r>25) return {signal:false, extra:`RSI:${r.toFixed(0)} — нет подтв.`};
      if (r <= p.rsiThr) {
        return {signal:true, detail:`RSI=${r.toFixed(1)} ≤ ${p.rsiThr} (oversold)`, strength:Math.round(Math.min(100,(p.rsiThr-r)/p.rsiThr*100+30))};
      }
      return {signal:false, extra:`RSI:${r?.toFixed(1)}`};
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.s1||params);
      const pnl = (price-pos.entryPrice)/pos.entryPrice*100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      if (bars?.length>=20) {
        const r = rsi(bars.map(b=>b.close));
        if (r!=null && r>=p.rsiExit) return {signal:true, reason:`RSI≥${p.rsiExit} (${r.toFixed(0)})`, pnl};
      }
      return {signal:false, pnl};
    },
  },

  // ── S3: BUYBACK DIP ────────────────────────────────────────
  s3: {
    id: 's3', name: 'Buyback Dip', color: '#00FFAA',
    bestRegimes: ['BULL_TREND','BULL','RANGE','NEUTRAL','BEAR'],
    worstRegimes: ['BEAR_TREND'],

    getParams(p={}) {
      return { tp: p.tp??16, sl: p.sl??-9, dropThr: p.dropThr??8, rsiMinEntry: p.rsiMinEntry??22 };
    },

    checkEntry(bars, params={}) {
      const p = this.getParams(params.s3||params);
      if (!bars||bars.length<9) return null;
      const closes = bars.map(b=>b.close);
      const n = closes.length-1;
      const h7 = Math.max(...bars.slice(-8,-1).map(b=>b.high));
      const drop = ((closes[n]-h7)/h7)*100;
      const r = rsi(closes);
      if (r!=null && r<p.rsiMinEntry) return {signal:false, extra:`RSI=${r.toFixed(0)} слишком низкий`};
      if (drop <= -p.dropThr) {
        return {signal:true, detail:`Просадка ${drop.toFixed(1)}% от 7d max ($${h7.toFixed(4)})`, strength:Math.round(Math.min(100,Math.abs(drop)/15*100))};
      }
      return {signal:false, extra:`${drop.toFixed(1)}% от max`};
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.s3||params);
      const pnl = (price-pos.entryPrice)/pos.entryPrice*100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      if (bars?.length>=7) {
        const s = sma(bars.map(b=>b.close), 7);
        if (s && price >= s*0.995) return {signal:true, reason:`Возврат к SMA7 ($${s.toFixed(4)})`, pnl};
      }
      return {signal:false, pnl};
    },
  },

  // ── SA: RSI DIVERGENCE ─────────────────────────────────────
  sA: {
    id: 'sA', name: 'RSI Divergence', color: '#C084FC',
    bestRegimes: ['BEAR','RANGE','NEUTRAL','BEAR_TREND'],
    worstRegimes: ['BULL_TREND'],

    getParams(p={}) {
      return { tp: p.tp??12, sl: p.sl??-5, rsiMaxEntry: p.rsiMaxEntry??45, rsiExitAt: p.rsiExitAt??55 };
    },

    checkEntry(bars, params={}) {
      const p = this.getParams(params.sA||params);
      if (!bars||bars.length<25) return null;
      const closes = bars.map(b=>b.close);
      const n = closes.length-1;
      const rsiNow  = rsi(closes);
      const rsiPrev = rsi(closes.slice(0,-4));
      if (rsiNow==null||rsiPrev==null) return null;
      const priceLower = closes[n] < closes[n-4];
      const rsiHigher  = rsiNow > rsiPrev+2;
      const rsiOk      = rsiNow < p.rsiMaxEntry && rsiNow > 20;
      if (priceLower && rsiHigher && rsiOk) {
        return {signal:true, detail:`Бычья дивергенция: цена↓ RSI↑ (${rsiPrev.toFixed(0)}→${rsiNow.toFixed(0)})`, strength:Math.min(90,50+Math.round((rsiNow-rsiPrev)*3))};
      }
      return {signal:false, extra:`RSI:${rsiNow?.toFixed(0)} div:${(rsiNow-rsiPrev).toFixed(1)}`};
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.sA||params);
      const pnl = (price-pos.entryPrice)/pos.entryPrice*100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      if (bars?.length>=20) {
        const r = rsi(bars.map(b=>b.close));
        if (r!=null && r>=p.rsiExitAt) return {signal:true, reason:`RSI≥${p.rsiExitAt} (${r.toFixed(0)}) — дивергенция отработана`, pnl};
      }
      return {signal:false, pnl};
    },
  },

  // ── SB: FEAR & GREED REVERSAL ──────────────────────────────
  sB: {
    id: 'sB', name: 'F&G Reversal', color: '#FF9940',
    bestRegimes: ['BEAR','NEUTRAL','BEAR_TREND','RANGE'],
    worstRegimes: ['BULL_TREND'],

    getParams(p={}) {
      return { tp: p.tp??15, sl: p.sl??-6, fgThreshold: p.fgThreshold??35, fgExtreme: p.fgExtreme??25 };
    },

    checkEntry(bars, params={}) {
      const p = this.getParams(params.sB||params);
      if (!bars||bars.length<10) return null;
      const closes = bars.map(b=>b.close);
      const n = closes.length-1;
      const fg = params.fearGreed||50;
      if (fg > p.fgThreshold) return {signal:false, extra:`F&G=${fg} не страх`};
      const bounce  = closes[n] > closes[n-1];
      const r = rsi(closes);
      const rsiOk   = r==null || (r>25 && r<50);
      const drop3d  = (closes[n]-closes[n-3])/closes[n-3]*100;
      if (bounce && rsiOk && drop3d > -20) {
        const extreme = fg <= p.fgExtreme;
        return {signal:true, detail:`F&G=${fg} (${extreme?'Extreme Fear':'Fear'}) + отскок подтверждён. RSI=${r?.toFixed(0)}`, strength:extreme?85:65};
      }
      return {signal:false, extra:`F&G=${fg} нет подтв.`};
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.sB||params);
      const pnl = (price-pos.entryPrice)/pos.entryPrice*100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      const fg = params.fearGreed||50;
      if (fg > 45) return {signal:true, reason:`F&G восстановился до ${fg}`, pnl};
      return {signal:false, pnl};
    },
  },

  // ── SC: SMA BOUNCE ─────────────────────────────────────────
  sC: {
    id: 'sC', name: 'SMA50 Bounce', color: '#4DB8FF',
    bestRegimes: ['BULL_TREND','BULL','RANGE','NEUTRAL'],
    worstRegimes: ['BEAR_TREND'],

    getParams(p={}) {
      return { tp: p.tp??10, sl: p.sl??-5, smaPeriod: p.smaPeriod??50, smaDistPct: p.smaDistPct??3 };
    },

    checkEntry(bars, params={}) {
      const p = this.getParams(params.sC||params);
      if (!bars||bars.length<p.smaPeriod+5) return null;
      const closes = bars.map(b=>b.close);
      const n = closes.length-1;
      const sma50 = sma(closes, p.smaPeriod);
      if (!sma50) return null;
      const price = closes[n], prev = closes[n-1];
      const touchedSMA = prev <= sma50*1.005;
      const bouncedUp  = price > sma50;
      const priceClose = Math.abs(price-sma50)/sma50*100 < p.smaDistPct;
      const r = rsi(closes);
      const rsiOk = r==null || (r>=30 && r<=58);
      if ((touchedSMA||priceClose) && bouncedUp && rsiOk) {
        const dist = ((price-sma50)/sma50*100).toFixed(2);
        return {signal:true, detail:`Отскок от SMA${p.smaPeriod} $${sma50.toFixed(4)} (+${dist}%). RSI=${r?.toFixed(0)}`, strength:Math.max(50,Math.min(90,70))};
      }
      return {signal:false, extra:`SMA${p.smaPeriod}:$${sma50.toFixed(4)}`};
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.sC||params);
      const pnl = (price-pos.entryPrice)/pos.entryPrice*100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      if (bars?.length>=p.smaPeriod) {
        const s = sma(bars.map(b=>b.close), p.smaPeriod);
        if (s && price < s*0.985) return {signal:true, reason:`Пробой SMA${p.smaPeriod} вниз`, pnl};
      }
      return {signal:false, pnl};
    },
  },

  // ── SD: DAMODARAN P/R ──────────────────────────────────────
  // ИСПРАВЛЕНО: blacklist мемов, rsiMin=35, только uptrend (не просто консолидация)
  sD: {
    id: 'sD', name: 'Damodaran P/R', color: '#F59E0B',
    bestRegimes: ['BULL','BULL_TREND','RANGE','NEUTRAL','BEAR'],
    worstRegimes: [],

    getParams(p={}) {
      return { tp: p.tp??10, sl: p.sl??-8, rsiMin: p.rsiMin??35, rsiMax: p.rsiMax??62, drop30Max: p.drop30Max??-40 };
    },

    checkEntry(bars, params={}) {
      const p = this.getParams(params.sD||params);
      if (!bars||bars.length<30) return null;

      // BLACKLIST проверка (через params или внутренний)
      const sym = params._symbol?.toUpperCase();
      if (sym && SD_BLACKLIST.has(sym)) {
        return {signal:false, extra:`${sym} в blacklist sD`};
      }

      const closes = bars.map(b=>b.close);
      const vols   = bars.map(b=>b.volume);
      const n = closes.length-1;

      // 1. RSI в рабочей зоне — исправлено: min=35 (было 22)
      const r = rsi(closes);
      if (r==null || r>p.rsiMax || r<p.rsiMin) {
        return {signal:false, extra:`RSI=${r?.toFixed(0)} вне зоны ${p.rsiMin}–${p.rsiMax}`};
      }

      // 2. Не дистресс-актив
      const drop30 = (closes[n]-closes[n-29])/closes[n-29]*100;
      if (drop30 < p.drop30Max) {
        return {signal:false, extra:`30d=${drop30.toFixed(0)}% — дистресс`};
      }

      // 3. Реальный объём
      const avgVol7 = vols.slice(-8,-1).reduce((s,v)=>s+v,0)/7;
      if (avgVol7 <= 0) return {signal:false, extra:'нет объёма'};

      // 4. Объём не упал катастрофически
      const volTrend = (vols[n]-avgVol7)/avgVol7*100;
      if (volTrend < -60) return {signal:false, extra:`Объём упал ${volTrend.toFixed(0)}%`};

      // 5. Не у ATH (апсайд должен быть)
      const hi30 = Math.max(...closes.slice(-30));
      if ((closes[n]-hi30)/hi30*100 > -2) return {signal:false, extra:'Цена у ATH30'};

      // 6. ИСПРАВЛЕНО: требуем краткосрочный рост (убрана "консолидация" как сигнал)
      // Было: shortUptrend || consolidating → слишком мягко, открывал всё подряд
      // Стало: только shortUptrend (2 растущих дня) ИЛИ сильный uptrend 3 дня
      const shortUptrend = closes[n]>closes[n-1] && closes[n-1]>closes[n-2];
      const strongUptrend = closes[n]>closes[n-1] && closes[n-1]>closes[n-2] && closes[n-2]>closes[n-3];

      if (shortUptrend) {
        const strength = 55 + (strongUptrend?15:0) + (r<50?10:0);
        const note = strongUptrend ? 'сильный рост 3д' : 'краткосрочный рост';
        return {signal:true, detail:`Damodaran: RSI=${r.toFixed(0)}, 30d=${drop30.toFixed(0)}%, ${note}`, strength:Math.min(85,strength)};
      }

      return {signal:false, extra:`RSI:${r.toFixed(0)} нет роста`};
    },

    checkExit(pos, bars, price, params={}) {
      const p = this.getParams(params.sD||params);
      const pnl = (price-pos.entryPrice)/pos.entryPrice*100;
      if (pnl >= p.tp)  return {signal:true, reason:`✅ TP +${p.tp}%`, pnl};
      if (pnl <= p.sl)  return {signal:true, reason:`🛑 SL ${p.sl}%`, pnl};
      if (bars?.length>=20) {
        const r = rsi(bars.map(b=>b.close));
        if (r!=null && r>=70) return {signal:true, reason:`RSI≥70 (${r.toFixed(0)}) — перекупленность`, pnl};
      }
      return {signal:false, pnl};
    },
  },
};

module.exports = { STRATEGIES, REGIME_PERFORMANCE, SD_BLACKLIST, detectRegime, rsi, ema, sma, bbands };
