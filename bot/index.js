'use strict';
const fetch      = require('node-fetch');
const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');
const { STRATEGIES, REGIME_PERFORMANCE, detectRegime } = require('./strategies');

// CONFIG
const CFG = {
  positionSize: 100, cooldownMin: 60, maxOpenPos: 50, minHoldMin: 0,
tgToken: process.env.TG_TOKEN   || '',
tgChat:  process.env.TG_CHAT_ID || '',
  emailTo:   process.env.EMAIL_TO || '',
  gmailUser: process.env.GMAIL_USER     || '',
  gmailPass: process.env.GMAIL_APP_PASS || '',
  action:    process.env.ACTION         || 'scan',
  isReport:  process.env.IS_REPORT_RUN  === 'true',
  tokens: ['BTC','ETH','BNB','SOL','XRP','DOGE','ADA','AVAX','LINK','DOT','MATIC','SHIB','LTC','UNI','ATOM','ETC','XLM','NEAR','BCH','APT','ICP','OP','ARB','INJ','FIL','HBAR','VET','AAVE','GRT','MKR','CRV','SNX','LDO','RUNE','FTM','SAND','AXS','RENDER','SUI','SEI'],
  params: { rsiThr:32, dropThr:12, volThr:55, fundingProxy:12, emaFast:9, emaSlow:21, bbWidth:13 },
};

const STRAT_IDS = Object.keys(STRATEGIES);
const ROOT      = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'state.json');
const DASH_FILE  = path.join(ROOT, 'dashboard', 'index.html');
const LOG_FILE   = path.join(ROOT, 'data', 'trades.log');

const fp  = n => (!n||isNaN(n))?'—':n>=1000?n.toFixed(0):n>=1?n.toFixed(4):n>=0.001?n.toFixed(6):n.toFixed(8);
const fm  = n => (!n||isNaN(n))?'—':n>=1e9?'$'+(n/1e9).toFixed(2)+'B':n>=1e6?'$'+(n/1e6).toFixed(1)+'M':'$'+n.toFixed(0);
const pct = (n,d=2)=>n==null?'—':(n>=0?'+':'')+n.toFixed(d)+'%';
const utc = ()=>new Date().toISOString().replace('T',' ').slice(0,19)+' UTC';
const durFmt = ms=>{if(ms<0)return'—';const m=Math.floor(ms/60000);if(m<60)return m+'м';const h=Math.floor(m/60);if(h<24)return h+'ч '+(m%60)+'м';return Math.floor(h/24)+'д '+h%24+'ч';};

function log(msg){const l=`[${utc()}] ${msg}`;console.log(l);try{fs.appendFileSync(LOG_FILE,l+'\n');}catch{}}

const emptyState=()=>({openPositions:[],closedTrades:[],cooldowns:{},scanCount:0,startedAt:new Date().toISOString(),lastScan:null,lastReport:null,marketRegime:'UNKNOWN',fearGreed:50,totalStats:{trades:0,wins:0,losses:0,totalPnl:0,invested:0},byStrategy:{},byRegime:{}});

function loadState(){try{if(fs.existsSync(STATE_FILE))return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}catch{}return emptyState();}
function saveState(st){fs.mkdirSync(path.dirname(STATE_FILE),{recursive:true});st.lastScan=new Date().toISOString();fs.writeFileSync(STATE_FILE,JSON.stringify(st,null,2));}

const canEnter=(st,sym,sid)=>Date.now()-(st.cooldowns[`${sym}_${sid}`]||0)>CFG.cooldownMin*60000;
const markEnter=(st,sym,sid)=>{st.cooldowns[`${sym}_${sid}`]=Date.now();};
const hasOpen=(st,sym,sid)=>st.openPositions.some(p=>p.symbol===sym&&p.stratId===sid);

function updStats(st,t){
  const win=t.pnl>=0,ts=st.totalStats;
  ts.trades++;ts.invested+=CFG.positionSize;ts.totalPnl+=t.pnlUsd;
  if(win)ts.wins++;else ts.losses++;
  if(!st.byStrategy[t.stratId])st.byStrategy[t.stratId]={trades:0,wins:0,pnl:0};
  const bs=st.byStrategy[t.stratId];bs.trades++;bs.pnl+=t.pnlUsd;if(win)bs.wins++;
  if(t.regime){
    if(!st.byRegime[t.regime])st.byRegime[t.regime]={};
    if(!st.byRegime[t.regime][t.stratId])st.byRegime[t.regime][t.stratId]={trades:0,wins:0,pnl:0};
    const br=st.byRegime[t.regime][t.stratId];br.trades++;br.pnl+=t.pnlUsd;if(win)br.wins++;
  }
}

// TELEGRAM
async function tg(text){
  if(!CFG.tgToken||!CFG.tgChat)return;
  try{const r=await fetch(`https://api.telegram.org/bot${CFG.tgToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CFG.tgChat,text,parse_mode:'HTML'})});const d=await r.json();if(!d.ok)log('[TG] '+d.description);}catch(e){log('[TG ERR] '+e.message);}
}

const msgEntry=(tok,sid,entry,regime)=>{const s=STRATEGIES[sid];const rp=REGIME_PERFORMANCE[sid]?.[regime];return[`📈 <b>ВХОД — ${s.name}</b>`,`<b>${tok.symbol}</b> #${tok.rank} · $${fp(tok.price)}`,``,`📌 ${entry.detail}`,`💰 $${CFG.positionSize} · Режим: <b>${regime}</b>`,rp?`📊 WR в этом режиме: ${(rp.wr*100).toFixed(0)}% avg:${pct(rp.avg)}`:'',`🎯 TP:+${s.tp}% SL:${s.sl}% Timeout:${s.timeoutDays}d`,`<i>${utc()}</i>`].filter(Boolean).join('\n');};
const msgExit=(pos,price,reason,pnlP,pnlU,held)=>{const ok=pnlP>=0;return[`${ok?'✅':'❌'} <b>ВЫХОД — ${STRATEGIES[pos.stratId]?.name}</b>`,`<b>${pos.symbol}</b> · ${pos.regime}`,``,`📌 ${reason}`,``,`Вход: $${fp(pos.entryPrice)} → Выход: $${fp(price)}`,``,`${ok?'🟢':'🔴'} <b>PnL: ${pct(pnlP)} / ${pnlU>=0?'+':''}$${pnlU.toFixed(2)}</b>`,`⏱ ${durFmt(held)}`,`<i>${utc()}</i>`].join('\n');};

// EMAIL
async function sendEmail(subject,html){
  if(!CFG.gmailUser||!CFG.gmailPass){log('[EMAIL] Нет credentials');return;}
  try{const t=nodemailer.createTransport({service:'gmail',auth:{user:CFG.gmailUser,pass:CFG.gmailPass}});await t.sendMail({from:`"🤖 TradingBot" <${CFG.gmailUser}>`,to:CFG.emailTo,subject,html});log(`[EMAIL] ✅ → ${CFG.emailTo}`);}catch(e){log('[EMAIL ERR] '+e.message);}
}

function buildEmail(st){
  const ts=st.totalStats;const wr=ts.trades?(ts.wins/ts.trades*100).toFixed(1):'0';const roi=ts.invested>0?(ts.totalPnl/ts.invested*100).toFixed(2):'0';
  const pnlC=ts.totalPnl>=0?'#22EE88':'#FF4466';const sixH=Date.now()-6*3600000;
  const rec=st.closedTrades.filter(t=>t.exitTime&&t.exitTime>sixH);const recPnl=rec.reduce((s,t)=>s+(t.pnlUsd||0),0);
  const srows=Object.entries(STRATEGIES).map(([sid,s])=>{const bs=st.byStrategy[sid]||{trades:0,wins:0,pnl:0};const bwr=bs.trades?(bs.wins/bs.trades*100).toFixed(0)+'%':'—';const col=(bs.pnl||0)>=0?'#22EE88':'#FF4466';return`<tr style="border-bottom:1px solid #1d2b38"><td style="padding:8px;color:${s.color};font-weight:bold">${s.name}</td><td style="padding:8px;text-align:center">${bs.trades}</td><td style="padding:8px;text-align:center">${bs.wins}</td><td style="padding:8px;text-align:center">${bwr}</td><td style="padding:8px;text-align:right;color:${col};font-weight:bold">${(bs.pnl||0)>=0?'+':''}$${(bs.pnl||0).toFixed(2)}</td><td style="padding:8px;font-size:10px;color:#5a7f9a">${s.bestRegimes.join(', ')}</td></tr>`;}).join('');
  const trows=st.closedTrades.slice(0,25).map(t=>{const col=(t.pnl||0)>=0?'#22EE88':'#FF4466';const s=STRATEGIES[t.stratId];const dur=t.exitTime?durFmt(t.exitTime-t.entryTime):'—';return`<tr style="border-bottom:1px solid #1d2b38"><td style="padding:6px;font-size:10px;color:#5a7f9a">${new Date(t.entryTime).toLocaleString('ru-RU',{timeZone:'UTC',hour12:false})}</td><td style="padding:6px;font-weight:bold">${t.symbol}</td><td style="padding:6px;color:${s?.color||'#fff'};font-size:10px">${s?.name||t.stratId}</td><td style="padding:6px;font-family:monospace">$${fp(t.entryPrice)}</td><td style="padding:6px;font-family:monospace">$${fp(t.exitPrice)}</td><td style="padding:6px;color:${col};font-weight:bold;font-family:monospace">${(t.pnlUsd||0)>=0?'+':''}$${(t.pnlUsd||0).toFixed(2)}</td><td style="padding:6px;color:${col};font-weight:bold">${(t.pnl||0)>=0?'+':''}${(t.pnl||0).toFixed(2)}%</td><td style="padding:6px;color:#ffd23f;font-size:10px">${t.regime||'—'}</td><td style="padding:6px;font-size:10px;color:#5a7f9a">${dur}</td><td style="padding:6px;font-size:10px;color:#5a7f9a">${t.exitReason||'—'}</td></tr>`;}).join('');
  return`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{background:#0a0d11;color:#d4e8f8;font-family:'Courier New',monospace;padding:20px;margin:0}.w{max-width:960px;margin:0 auto}h1{font-size:26px;color:#00ffaa;letter-spacing:3px;margin-bottom:4px}.sub{font-size:11px;color:#5a7f9a;margin-bottom:18px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:18px}.kpi{background:#111820;border:1px solid #1d2b38;padding:12px}.k{font-size:9px;color:#5a7f9a;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}.v{font-size:20px;font-weight:bold;font-family:'Courier New',monospace}.sec{font-size:13px;font-weight:bold;color:#00ffaa;letter-spacing:2px;margin:18px 0 8px;border-bottom:1px solid #1d2b38;padding-bottom:5px}table{width:100%;border-collapse:collapse;font-size:11px;background:#111820}thead tr{background:#1a2b3c}th{padding:8px;text-align:left;font-size:9px;color:#5a7f9a;text-transform:uppercase;letter-spacing:1px}.foot{margin-top:18px;font-size:10px;color:#5a7f9a;text-align:center;border-top:1px solid #1d2b38;padding-top:10px}</style></head><body><div class="w"><h1>🤖 TRADING BOT — 6-ЧАСОВОЙ ОТЧЁТ</h1><div class="sub">${new Date().toLocaleString('ru-RU',{timeZone:'UTC',hour12:false})} UTC · Сканов: ${st.scanCount} · Режим: ${st.marketRegime} · F&G: ${st.fearGreed}</div><div class="grid"><div class="kpi"><div class="k">Всего сделок</div><div class="v" style="color:#00ffaa">${ts.trades}</div></div><div class="kpi"><div class="k">Win Rate</div><div class="v" style="color:${parseFloat(wr)>=50?'#22EE88':'#FF4466'}">${wr}%</div></div><div class="kpi"><div class="k">Итого PnL</div><div class="v" style="color:${pnlC}">${ts.totalPnl>=0?'+':''}$${ts.totalPnl.toFixed(2)}</div></div><div class="kpi"><div class="k">ROI</div><div class="v" style="color:${parseFloat(roi)>=0?'#22EE88':'#FF4466'}">${roi}%</div></div><div class="kpi"><div class="k">Вложено</div><div class="v">$${ts.invested.toFixed(0)}</div></div><div class="kpi"><div class="k">Победы</div><div class="v" style="color:#22EE88">${ts.wins}</div></div><div class="kpi"><div class="k">Убытки</div><div class="v" style="color:#FF4466">${ts.losses}</div></div><div class="kpi"><div class="k">Открытых</div><div class="v" style="color:#ffd23f">${st.openPositions.length}</div></div><div class="kpi"><div class="k">За 6ч сделок</div><div class="v" style="color:${recPnl>=0?'#22EE88':'#FF4466'}">${rec.length}</div></div><div class="kpi"><div class="k">PnL за 6ч</div><div class="v" style="color:${recPnl>=0?'#22EE88':'#FF4466'}">${recPnl>=0?'+':''}$${recPnl.toFixed(2)}</div></div></div><div class="sec">📊 PnL ПО СТРАТЕГИЯМ</div><table><thead><tr><th>Стратегия</th><th>Сделок</th><th>Побед</th><th>WR%</th><th style="text-align:right">PnL $</th><th>Лучшие режимы</th></tr></thead><tbody>${srows}</tbody></table><div class="sec">📋 ПОСЛЕДНИЕ 25 СДЕЛОК</div><table><thead><tr><th>Дата</th><th>Токен</th><th>Стратегия</th><th>Вход</th><th>Выход</th><th style="text-align:right">PnL $</th><th style="text-align:right">PnL %</th><th>Режим</th><th>Длит.</th><th>Причина</th></tr></thead><tbody>${trows}</tbody></table><div class="foot">🤖 Autonomous Trading Bot · Paper $${CFG.positionSize}/сделка · Not Financial Advice · Следующий отчёт через 6ч</div></div></body></html>`;
}

function buildDash(st){
  const ts=st.totalStats;const wr=ts.trades?(ts.wins/ts.trades*100).toFixed(1):'0';const roi=ts.invested>0?(ts.totalPnl/ts.invested*100).toFixed(2):'0';const pnlC=ts.totalPnl>=0?'#22EE88':'#FF4466';
  const rc=st.marketRegime?.includes('BULL')?'#22EE88':st.marketRegime?.includes('BEAR')?'#FF4466':'#FFD23F';const fc=st.fearGreed>55?'#22EE88':st.fearGreed<35?'#FF4466':'#FFD23F';
  const srows=Object.entries(STRATEGIES).map(([sid,s])=>{const bs=st.byStrategy[sid]||{trades:0,wins:0,pnl:0};const bwr=bs.trades?(bs.wins/bs.trades*100).toFixed(0)+'%':'—';const avg=bs.trades?(bs.pnl/bs.trades).toFixed(2):'—';const col=(bs.pnl||0)>=0?'#22EE88':'#FF4466';return`<tr><td style="color:${s.color};font-weight:700;padding:7px 8px">${s.name}</td><td style="padding:7px 8px">${bs.trades}</td><td style="padding:7px 8px;color:#22EE88">${bs.wins}</td><td style="padding:7px 8px">${bwr}</td><td style="padding:7px 8px;color:${col};font-weight:700">${(bs.pnl||0)>=0?'+':''}$${(bs.pnl||0).toFixed(2)}</td><td style="padding:7px 8px;color:${parseFloat(avg||0)>=0?'#22EE88':'#FF4466'}">${avg!=='—'?(parseFloat(avg)>=0?'+':'')+'$'+avg:'—'}</td><td style="padding:7px 8px;font-size:8px;color:#5a7f9a">${s.bestRegimes.join(', ')}</td></tr>`;}).join('');
  const orows=st.openPositions.length?st.openPositions.map((p,i)=>{const s=STRATEGIES[p.stratId];return`<tr><td style="color:#5a7f9a">${i+1}</td><td style="font-weight:700">${p.symbol}</td><td style="color:${s?.color||'#fff'};font-size:9px">${s?.name}</td><td>$${fp(p.entryPrice)}</td><td style="color:#ffd23f;font-size:9px">${p.regime||'—'}</td><td style="color:#5a7f9a;font-size:9px">${durFmt(Date.now()-p.entryTime)}</td><td style="font-size:8px;color:#5a7f9a">${(p.entrySignal||'').slice(0,30)}</td></tr>`;}).join(''):'<tr><td colspan="7" style="text-align:center;color:#5a7f9a;padding:14px">Нет открытых позиций</td></tr>';
  const crows=st.closedTrades.length?st.closedTrades.slice(0,50).map((t,i)=>{const col=(t.pnl||0)>=0?'#22EE88':'#FF4466';const s=STRATEGIES[t.stratId];const dur=t.exitTime?durFmt(t.exitTime-t.entryTime):'—';return`<tr><td style="color:#5a7f9a;font-size:9px">${st.closedTrades.length-i}</td><td style="font-size:9px;color:#5a7f9a;white-space:nowrap">${new Date(t.entryTime).toLocaleString('ru-RU',{timeZone:'UTC',hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td><td style="font-weight:700">${t.symbol}</td><td style="color:${s?.color||'#fff'};font-size:9px">${s?.name||t.stratId}</td><td>$${fp(t.entryPrice)}</td><td>$${fp(t.exitPrice)}</td><td style="font-weight:700;color:${col};font-family:monospace">${(t.pnlUsd||0)>=0?'+':''}$${(t.pnlUsd||0).toFixed(2)}</td><td style="font-weight:700;color:${col}">${(t.pnl||0)>=0?'+':''}${(t.pnl||0).toFixed(2)}%</td><td style="color:#5a7f9a;font-size:9px">${dur}</td><td style="color:#ffd23f;font-size:9px">${t.regime||'—'}</td><td style="font-size:8px;color:#5a7f9a">${t.exitReason||'—'}</td></tr>`;}).join(''):'<tr><td colspan="11" style="text-align:center;color:#5a7f9a;padding:14px">Нет закрытых сделок</td></tr>';
  return`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="900"><title>🤖 Trading Bot Live</title><style>@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0d11;color:#d4e8f8;font-family:'Space Mono',monospace;font-size:11px;padding:16px}h1{font-family:'Bebas Neue';font-size:36px;letter-spacing:3px;line-height:1}h1 span{color:#00ffaa}.hd{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #253545}.strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:14px}.sc{background:#111820;border:1px solid #253545;padding:10px 12px}.lb{font-size:7px;color:#5a7f9a;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px}.vl{font-family:'Bebas Neue';font-size:22px}.sec{margin-bottom:14px}.st{font-family:'Bebas Neue';font-size:14px;letter-spacing:2px;margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid #253545}.tscroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:10px}thead tr{border-bottom:2px solid #253545}th{padding:6px 8px;font-size:8px;color:#5a7f9a;text-transform:uppercase;letter-spacing:1px;text-align:left;white-space:nowrap}td{padding:5px 8px;border-bottom:1px solid #1d2b38;vertical-align:middle}tr:hover td{background:rgba(255,255,255,.015)}.badge{display:inline-block;padding:2px 8px;font-size:8px;font-weight:700}footer{margin-top:14px;padding-top:10px;border-top:1px solid #253545;text-align:center;font-size:8px;color:#5a7f9a}</style></head><body>
<div class="hd"><div><h1>🤖 AUTO <span>TRADING</span> BOT</h1><div style="font-size:9px;color:#5a7f9a;margin-top:3px">GitHub Actions · Paper $${CFG.positionSize}/сделка · 7 стратегий · 40 токенов · Без задержек</div></div><div style="text-align:right;font-size:9px"><div style="color:#5a7f9a">Обновлено: <span style="color:#00ffaa">${st.lastScan?new Date(st.lastScan).toLocaleString('ru-RU',{timeZone:'UTC',hour12:false})+' UTC':'—'}</span></div><div style="color:#5a7f9a;margin-top:3px">Сканов: <b>${st.scanCount}</b> · Email 6ч → m5827777@gmail.com</div><div style="margin-top:5px"><span class="badge" style="background:rgba(${st.marketRegime?.includes('BULL')?'34,238,136':st.marketRegime?.includes('BEAR')?'255,68,102':'255,210,63'},.15);color:${rc}">📊 ${st.marketRegime}</span> <span class="badge" style="background:rgba(255,210,63,.1);color:${fc}">😱 F&G:${st.fearGreed}</span></div></div></div>
<div class="strip"><div class="sc"><div class="lb">Всего сделок</div><div class="vl" style="color:#00ffaa">${ts.trades}</div></div><div class="sc"><div class="lb">Открытых</div><div class="vl" style="color:#ffd23f">${st.openPositions.length}</div></div><div class="sc"><div class="lb">Закрытых</div><div class="vl">${st.closedTrades.length}</div></div><div class="sc"><div class="lb">Победы</div><div class="vl" style="color:#22EE88">${ts.wins}</div></div><div class="sc"><div class="lb">Убытки</div><div class="vl" style="color:#FF4466">${ts.losses}</div></div><div class="sc"><div class="lb">Win Rate</div><div class="vl" style="color:${parseFloat(wr)>=50?'#22EE88':'#FF4466'}">${wr}%</div></div><div class="sc"><div class="lb">Итого PnL $</div><div class="vl" style="color:${pnlC}">${ts.totalPnl>=0?'+':''}$${ts.totalPnl.toFixed(2)}</div></div><div class="sc"><div class="lb">Вложено</div><div class="vl">$${ts.invested.toFixed(0)}</div></div><div class="sc"><div class="lb">ROI</div><div class="vl" style="color:${parseFloat(roi)>=0?'#22EE88':'#FF4466'}">${roi}%</div></div></div>
<div class="sec"><div class="st" style="color:#ff9940">📊 PnL ПО СТРАТЕГИЯМ</div><div class="tscroll"><table><thead><tr><th>Стратегия</th><th>Сделок</th><th>Победы</th><th>WR%</th><th>Итого $</th><th>Avg $</th><th>Лучшие режимы</th></tr></thead><tbody>${srows}</tbody></table></div></div>
<div class="sec"><div class="st" style="color:#ffd23f">📂 ОТКРЫТЫЕ (${st.openPositions.length})</div><div class="tscroll"><table><thead><tr><th>#</th><th>Токен</th><th>Стратегия</th><th>Вход $</th><th>Режим</th><th>Удержано</th><th>Сигнал</th></tr></thead><tbody>${orows}</tbody></table></div></div>
<div class="sec"><div class="st" style="color:#22EE88">📋 ЗАКРЫТЫЕ (последние 50 из ${st.closedTrades.length})</div><div class="tscroll"><table><thead><tr><th>#</th><th>Дата</th><th>Токен</th><th>Стратегия</th><th>Вход $</th><th>Выход $</th><th>PnL $</th><th>PnL %</th><th>Длит.</th><th>Режим</th><th>Причина выхода</th></tr></thead><tbody>${crows}</tbody></table></div></div>
<footer>🤖 Autonomous Trading Bot · GitHub Actions каждые 15 мин · Email 6ч → ${CFG.emailTo} · Not Financial Advice</footer>
</body></html>`;
}

// API
async function fetchCG(){const stables=new Set(['usdt','usdc','dai','busd','fdusd','usde','tusd','usdp','pyusd','usdd','frax','lusd']);const r=await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h');if(!r.ok)throw new Error('CG '+r.status);return(await r.json()).filter(c=>!stables.has(c.symbol.toLowerCase()));}
async function fetchFG(){try{const r=await fetch('https://api.alternative.me/fng/?limit=1');const d=await r.json();return parseInt(d?.data?.[0]?.value||50);}catch{return 50;}}
async function fetchK(sym,limit=40){try{const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=${limit}`);if(!r.ok)return null;const d=await r.json();if(!Array.isArray(d)||!d.length)return null;return d.map(c=>({date:new Date(c[0]).toISOString().slice(0,10),open:+c[1],high:+c[2],low:+c[3],close:+c[4],volume:+c[5]}));}catch{return null;}}

async function main(){
  fs.mkdirSync(path.dirname(LOG_FILE),{recursive:true});
  log('═'.repeat(50));log(`🤖 Bot v3 | action=${CFG.action} | report=${CFG.isReport}`);log('═'.repeat(50));
  const state=loadState();if(!state.startedAt)state.startedAt=new Date().toISOString();

  if(CFG.action==='reset_state'){const f=emptyState();fs.writeFileSync(STATE_FILE,JSON.stringify(f,null,2));log('✅ Reset');fs.mkdirSync(path.dirname(DASH_FILE),{recursive:true});fs.writeFileSync(DASH_FILE,buildDash(f));return;}

  if(CFG.action==='close_all'){
    log(`Closing ${state.openPositions.length}...`);
    for(const pos of state.openPositions){const bars=await fetchK(pos.symbol,3);const price=bars?bars[bars.length-1].close:pos.entryPrice;const pP=(price-pos.entryPrice)/pos.entryPrice*100;const pU=CFG.positionSize*pP/100;const held=Date.now()-pos.entryTime;const c={...pos,exitPrice:price,exitTime:Date.now(),exitReason:'🛑 Закрытие',pnl:pP,pnlUsd:pU,total:CFG.positionSize+pU,regime:state.marketRegime};state.closedTrades.unshift(c);updStats(state,c);log(`  CLOSE ${pos.symbol}/${pos.stratId} PnL=${pct(pP)}`);await tg(msgExit(pos,price,'🛑 Закрытие',pP,pU,held));await new Promise(r=>setTimeout(r,350));}
    state.openPositions=[];saveState(state);fs.mkdirSync(path.dirname(DASH_FILE),{recursive:true});fs.writeFileSync(DASH_FILE,buildDash(state));return;
  }

  if(CFG.action==='report'){const ts2=state.totalStats;const wr2=ts2.trades?(ts2.wins/ts2.trades*100).toFixed(0):'0';await sendEmail(`🤖 Trading Bot | WR:${wr2}% | PnL:${ts2.totalPnl>=0?'+':''}$${ts2.totalPnl.toFixed(2)}`,buildEmail(state));await tg(`📊 <b>Отчёт → ${CFG.emailTo}</b>\nWR:${wr2}% · PnL:${ts2.totalPnl>=0?'+':''}$${ts2.totalPnl.toFixed(2)}\n<i>${utc()}</i>`);return;}

  // SCAN
  state.scanCount++;log(`📡 Scan #${state.scanCount}`);
  const fg=await fetchFG();state.fearGreed=fg;
  const btc=await fetchK('BTC',210);const{regime}=btc?detectRegime(btc,fg):{regime:'NEUTRAL'};
  state.marketRegime=regime;log(`🌡 F&G=${fg} Regime=${regime} Open=${state.openPositions.length}`);

  // EXITS — no min hold
  const toClose=[];
  for(const pos of state.openPositions){
    const bars=await fetchK(pos.symbol,40);if(!bars||!bars.length)continue;
    const price=bars[bars.length-1].close;const s=STRATEGIES[pos.stratId];if(!s)continue;
    const ex=s.checkExit(pos,bars,price);
    if(ex.signal){
      const pU=CFG.positionSize*ex.pnl/100;const held=Date.now()-pos.entryTime;
      const c={...pos,exitPrice:price,exitTime:Date.now(),exitReason:ex.reason,pnl:ex.pnl,pnlUsd:pU,total:CFG.positionSize+pU,regime:state.marketRegime};
      state.closedTrades.unshift(c);updStats(state,c);toClose.push(pos.id);
      log(`  ${ex.pnl>=0?'✅':'❌'} CLOSE ${pos.symbol}/${pos.stratId}: ${ex.reason} PnL=${pct(ex.pnl)} held=${durFmt(held)}`);
      await tg(msgExit(pos,price,ex.reason,ex.pnl,pU,held));await new Promise(r=>setTimeout(r,400));
    }else{log(`  📂 HOLD ${pos.symbol}/${pos.stratId} PnL=${pct(ex.pnl)}`);}
  }
  state.openPositions=state.openPositions.filter(p=>!toClose.includes(p.id));

  // ENTRIES
  log(`🔎 Scanning ${CFG.tokens.length} tokens...`);
  let cgData;try{cgData=await fetchCG();}catch(e){log('[CG] '+e.message);}
  const pm={};if(cgData)cgData.forEach(c=>{pm[c.symbol.toUpperCase()]=c;});
  let opened=0;
  for(const sym of CFG.tokens){
    if(state.openPositions.length>=CFG.maxOpenPos)break;
    const cg=pm[sym];if(!cg)continue;
    const bars=await fetchK(sym,40);if(!bars||bars.length<25){await new Promise(r=>setTimeout(r,200));continue;}
    const{regime:tr}=detectRegime(bars,fg);
    for(const sid of STRAT_IDS){
      if(state.openPositions.length>=CFG.maxOpenPos)break;
      if(hasOpen(state,sym,sid)||!canEnter(state,sym,sid))continue;
      const s=STRATEGIES[sid];if(s.worstRegimes.includes(tr))continue;
      const entry=s.checkEntry(bars,CFG.params);if(!entry?.signal)continue;
      const price=bars[bars.length-1].close;
      const pos={id:`${sym}_${sid}_${Date.now()}`,symbol:sym,name:cg.name,rank:cg.market_cap_rank,stratId:sid,entryPrice:price,entryTime:Date.now(),entryDate:new Date().toISOString(),entrySignal:entry.detail,strength:entry.strength||50,regime:tr,size:CFG.positionSize};
      state.openPositions.push(pos);markEnter(state,sym,sid);opened++;
      log(`  📈 ENTRY ${sym}/${sid} [${tr}]: ${entry.detail} @ $${price}`);
      await tg(msgEntry({symbol:sym,name:cg.name,rank:cg.market_cap_rank,price,mcap:cg.market_cap,chg24:cg.price_change_percentage_24h},sid,entry,tr));
      await new Promise(r=>setTimeout(r,350));
    }
    await new Promise(r=>setTimeout(r,250));
  }
  log(`✅ Opened:${opened} Total open:${state.openPositions.length}`);

  saveState(state);
  fs.mkdirSync(path.dirname(DASH_FILE),{recursive:true});
  fs.writeFileSync(DASH_FILE,buildDash(state));

  // 6h email
  const lastRpt=state.lastReport?new Date(state.lastReport).getTime():0;
  if(CFG.isReport||(Date.now()-lastRpt>6*3600000)){
    state.lastReport=new Date().toISOString();saveState(state);
    const ts2=state.totalStats;const wr2=ts2.trades?(ts2.wins/ts2.trades*100).toFixed(0):'0';
    await sendEmail(`🤖 Bot 6ч | WR:${wr2}% | PnL:${ts2.totalPnl>=0?'+':''}$${ts2.totalPnl.toFixed(2)} | Сканов:${state.scanCount}`,buildEmail(state));
    await tg(`📊 <b>6ч отчёт → ${CFG.emailTo}</b>\nWR:${wr2}% · PnL:${ts2.totalPnl>=0?'+':''}$${ts2.totalPnl.toFixed(2)}\nОткрытых:${state.openPositions.length} · Сканов:${state.scanCount}\n<i>${utc()}</i>`);
    log(`📧 6h report sent`);
  }

  const ts2=state.totalStats;
  log(`\n📊 WR=${ts2.trades?(ts2.wins/ts2.trades*100).toFixed(1):0}% PnL=$${ts2.totalPnl.toFixed(2)} Trades=${ts2.trades}`);
}

main().catch(e=>{log('❌ '+e.message);console.error(e.stack);process.exit(1);});
