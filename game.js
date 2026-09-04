'use strict';
window.addEventListener('error', e => { (window.__errs = window.__errs || []).push(String(e.message)); });
window.addEventListener('unhandledrejection', e => { (window.__errs = window.__errs || []).push('REJ: ' + String((e.reason && e.reason.stack) || e.reason)); });
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PARAMS = new URLSearchParams(location.search);
const AUTO = PARAMS.get('auto') === '1';
const QUICK = AUTO;
let _seed = Number(PARAMS.get('seed') || 987654321);
function rnd() { _seed ^= _seed << 13; _seed ^= _seed >>> 17; _seed ^= _seed << 5; return (_seed >>> 0) / 4294967296; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function pickCards(side, n, cancelable) {
  const nAny = n === 'any', up2 = n === 'up2';
  const cap = nAny ? 99 : up2 ? 2 : n;
  return new Promise(res => { UI.pick = { side, n, nAny, cap, exact: !nAny && !up2, res, cancelable: !!cancelable }; UI.sel = new Set(); render(); });
}
let sfxOn = true, AC = null;
/* 背景音乐（清单由 music-manifest.js 生成）：开局随机播通用曲池；
   胡牌时切到对应组合曲池播随机一曲，播完自动回到通用曲池 */
const BGM_MAN = (typeof BGM_MANIFEST !== 'undefined') ? BGM_MANIFEST : { root: [], units: {} };
const BGM_TRACKS = BGM_MAN.root, BGM_UNIT = BGM_MAN.units;
let bgmEl = null, bgmIdx = -1, bgmPool = BGM_TRACKS, bgmSpecial = false;
function bgmNext() {
  if (!bgmEl || !bgmPool.length || !sfxOn) return;
  let i;
  do { i = Math.floor(Math.random() * bgmPool.length); } while (bgmPool.length > 1 && i === bgmIdx);
  bgmIdx = i;
  bgmEl.src = 'assets/music/' + encodeURI(bgmPool[i]);
  bgmEl.play().catch(() => {});
}
function bgmEnded() {
  if (bgmSpecial) { bgmSpecial = false; bgmPool = BGM_TRACKS; bgmIdx = -1; }
  bgmNext();
}
function playUnitTrack(unit) {
  const tracks = BGM_UNIT[unit];
  if (!bgmEl || !sfxOn || !tracks || !tracks.length) return;
  bgmPool = tracks; bgmSpecial = true;
  bgmIdx = Math.floor(Math.random() * tracks.length);
  bgmEl.src = 'assets/music/' + encodeURI(unit + '/' + tracks[bgmIdx]);
  bgmEl.play().catch(() => {});
}
function initBgm() {
  if (bgmEl || !BGM_TRACKS.length) return;
  bgmEl = document.getElementById('bgm');
  bgmEl.volume = 0.25;
  bgmEl.addEventListener('ended', bgmEnded);
  bgmNext();
}
function ac() { if (!AC) try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {} if (AC && AC.state === 'suspended') AC.resume(); return AC; }
function tone(f, d, t, v, dl) { if (!sfxOn || QUICK) return; const c = ac(); if (!c) return; const s = c.currentTime + (dl||0); const o = c.createOscillator(), g = c.createGain(); o.type = t||'sine'; o.frequency.value = f; g.gain.setValueAtTime(v||.12, s); g.gain.exponentialRampToValueAtTime(.001, s+d); o.connect(g); g.connect(c.destination); o.start(s); o.stop(s+d+.02); }
function sfx(n) { if (!sfxOn || QUICK) return; const m = {flip:[700,.05,'triangle',.06],draw:[520,.07,'triangle',.08],swap:[440,.06,'triangle',.07],discard:[200,.09,'sine',.1],bid:[880,.06,'square',.05],pass:[330,.05,'triangle',.05],win:[660,.1,'triangle',.1]}; if(n==='hu'){[523,659,784,1047].forEach((f,i)=>tone(f,.16,'triangle',.12,i*.12));return;} const p=m[n]; if(p)tone(p[0],p[1],p[2],p[3]); }
const HAND_MAX = 10, MAX_ROUND = 12, DISPLAY_SIZE = 7, AP_PER_TURN = 2;
const DEFAULT_UNITS = ['illumination STARS', "L'Antica", 'noctchill', '放課後クライマックスガールズ'];
/* 不启用的组合：开局列表与牌池直接排除 */
const EXCLUDED_UNITS = ['B小町'];
for (const u of EXCLUDED_UNITS) { const i = DATA.findIndex(d => d.unit === u); if (i >= 0) DATA.splice(i, 1); }
/* 官方组合顺序：手牌 / 明牌列 / 开局列表默认按此排布 */
const UNIT_SORT = ['illumination STARS', "L'Antica", '放課後クライマックスガールズ', 'ALSTROEMERIA', 'Straylight', 'noctchill', 'SHHis', 'CoMETIK'];
const UNIT_ORDER = {};
DATA.forEach((u, i) => { UNIT_ORDER[u.unit] = 100 + i; });
UNIT_SORT.forEach((u, i) => { if (u in UNIT_ORDER) UNIT_ORDER[u] = i; });
let WAVES = {}, ALLCARDS = [];
function buildPool(un, wpu) {
  WAVES = {}; ALLCARDS = [];
  let uid = 0;
  DATA.forEach((u) => {
    if (!un.includes(u.unit)) return;
    let idxs = u.waves.map((w, wi) => wi).filter(wi => Object.keys(u.waves[wi]).length);
    shuffle(idxs);
    if (wpu) idxs = idxs.slice(0, wpu);
    for (const wi of idxs) {
      const w = u.waves[wi], key = u.unit + '|' + wi, ids = Object.keys(w);
      WAVES[key] = { key, unit: u.unit, idx: wi, ids, size: ids.length };
      for (const idol of ids) { const c = w[idol]; ALLCARDS.push({ uid: 'c' + (uid++), id: c.id, name: c.name, unit: u.unit, idol, waveKey: key, img: c.f }); }
    }
  });
}
const UNIT_EFFECT = {
  'illumination STARS': { key: 'draw2', name: '摸 2 张', desc: '从牌山摸 2 张入手' },
  "L'Antica": { key: 'take2', name: '明牌列扫 2', desc: '从明牌列拿 2 张入手，空位从牌山补 2 张，再弃 1 张手牌' },
  'noctchill': { key: 'darkpick', name: '暗堆回收', desc: '看暗堆选 1 张入手，然后弃 1 张手牌' },
  '放課後クライマックスガールズ': { key: 'peek4', name: '牌山精选', desc: '看牌山顶 4 张，选 1 张入手，其余放回' },
  'Straylight': { key: 'reshuffle', name: '市场重置', desc: '明牌列全部洗回牌山，重新翻开' },
  'ALSTROEMERIA': { key: 'refresh', name: '手牌重整', desc: '任意张手牌放回牌山，摸相同张数' },
  'CoMETIK': { key: 'spy', name: '查验', desc: '查看一名对手的全部手牌' },
  'SHHis': { key: 'forcedswap', name: '强制交换', desc: '选最多 2 张手牌，与一名对手等量交换' }
};
const UNIT_NAME_RE = new RegExp('(' + Object.keys(UNIT_EFFECT).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g');
const wrapUnit = s => s.replace(UNIT_NAME_RE, '<span class="uname">$1</span>');

const G = { players: [], display: [], deck: [], dark: [], auctionCards: [], showBid: null, turn: 0, round: 1, ap: 0, over: false, exhausted: false, logs: [] };
const UI = { pick: null, sel: new Set(), banner: null, bidAsk: null, mainRes: null, anim: {}, waveChoose: null, discardAsk: null, darkPick: null, peekPick: null, spyView: null, forcedTarget: null, spyCloseRes: null, swap: null };
function log(m) { G.logs.push(m); if (G.logs.length > 300) G.logs.shift(); }
function drawCards(n) { const out = []; while (n-- > 0) { if (G.deck.length <= 8 && G.dark.length) { G.deck = shuffle(G.deck.concat(G.dark.splice(0))); log('弃牌洗回牌山'); } if (!G.deck.length) break; out.push(G.deck.pop()); } return out; }
function sortHand(p) { p.hand.sort((a, b) => (UNIT_ORDER[a.unit] - UNIT_ORDER[b.unit]) || (a.waveKey < b.waveKey ? -1 : a.waveKey > b.waveKey ? 1 : 0) || (a.idol < b.idol ? -1 : a.idol > b.idol ? 1 : 0)); }
function sortDisplay() { G.display.sort((a, b) => { if (!a && !b) return 0; if (!a) return 1; if (!b) return -1; return (UNIT_ORDER[a.unit] - UNIT_ORDER[b.unit]) || (a.waveKey < b.waveKey ? -1 : a.waveKey > b.waveKey ? 1 : 0) || (a.idol < b.idol ? -1 : a.idol > b.idol ? 1 : 0); }); }
function sortDark() { G.dark.sort((a, b) => (UNIT_ORDER[a.unit] - UNIT_ORDER[b.unit]) || (a.waveKey < b.waveKey ? -1 : a.waveKey > b.waveKey ? 1 : 0) || (a.idol < b.idol ? -1 : a.idol > b.idol ? 1 : 0)); }
/* 计分：套牌分值与其内部必须同时在手牌共存的牌对数 C(k,2) 成正比。
   2 人套（1 个约束）为基准 20 分，四舍五入到 5 */
function comb(n, k) { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }
const HU_SCORE = {};
function huScore(k) {
  if (HU_SCORE[k]) return HU_SCORE[k];
  HU_SCORE[k] = k < 2 ? 10 : Math.round(20 * comb(k, 2) / 5) * 5;
  return HU_SCORE[k];
}
function makePlayer(name, ai) { return { name, ai, hand: [], done: [], score: 0, auctioned: false }; }
async function startGame(un, aiC, wpu) {
  buildPool(un, wpu);
  G.players = [makePlayer('你', false)];
  for (let i = 1; i <= aiC; i++) G.players.push(makePlayer('对手' + i, true));
  G.deck = shuffle(ALLCARDS.slice());
  for (const p of G.players) { p.hand = G.deck.splice(0, 7); sortHand(p); }
  G.display = []; G.dark = []; G.turn = 0; G.round = 1; G.over = false; G.exhausted = false; G.logs = [];
  while (G.display.length < DISPLAY_SIZE) { const c = drawCards(1)[0]; if (!c) break; G.display.push(c); }
  const sizes = [...new Set(Object.values(WAVES).map(w => w.size))].sort((a, b) => a - b);
  log('计分：' + sizes.map(k => k + '人套 ' + huScore(k) + ' 分').join('，') + '（按牌池 ' + ALLCARDS.length + ' 张计算）');
  log('游戏开始'); render(); gameLoop();
}
async function gameLoop() {
  const P = G.players.length;
  while (!G.over) {
    if (!G.deck.length && !G.dark.length) { G.over = true; G.exhausted = true; log('牌已尽，流局'); break; }
    for (let k = 0; k < P && !G.over; k++) { G.turn = k; await playTurn(k); }
    if (G.over) break;
    await roundAuction(Math.min(G.round, P));
    if (G.over) break;
    await huSweep();
    G.deck = shuffle(G.deck.concat(G.display.splice(0)));
    log('明牌列洗牌重排');
    let dl = 0;
    while (G.display.length < DISPLAY_SIZE) { const c = drawCards(1)[0]; if (!c) break; G.display.push(c); animate(c.uid, 'deal-in', dl); dl += 70; }
    G.round++;
    if (G.round > MAX_ROUND) G.over = true;
    render();
  }
  log('游戏结束');
  if (AUTO) { window.__result = { scores: G.players.map(p => ({ name: p.name, score: p.score, done: p.done.length })), round: G.round, hands: G.players.map(p => p.hand.length), display: G.display.length, deck: G.deck.length, dark: G.dark.length, exhausted: G.exhausted }; document.title = 'AUTO_DONE'; }
  else showScore();
}
function piecesOf(p, wk) { let n = 0; for (const id of WAVES[wk].ids) if (p.hand.some(c => c.waveKey === wk && c.idol === id)) n++; return n; }
function canHu(p) { return Object.keys(WAVES).filter(tk => WAVES[tk].ids.every(id => p.hand.some(c => c.waveKey === tk && c.idol === id))); }
async function huSweep() {
  for (let g = 0; g < 12; g++) {
    let fired = false;
    for (const p of G.players) {
      const hu = canHu(p);
      if (hu.length) { let tk; if (hu.length === 1) tk = hu[0]; else if (p.ai) tk = hu.slice().sort((a, b) => WAVES[b].size - WAVES[a].size)[0]; else tk = await pickWaveFromList(hu); await doHu(p, tk); fired = true; }
    }
    if (!fired) break;
  }
}
async function playTurn(i) {
  const p = G.players[i]; p.auctioned = false; p.effectUsed = false;
  log(`—— ${p.name} 的回合 ——`); G.ap = AP_PER_TURN; render();
  let guard = 0;
  while (G.ap > 0 && guard++ < 12) {
    let acted = false;
    if (p.ai) acted = await aiAP(p, i); else acted = await humanAP(p);
    if (!acted) break;
    G.ap = Math.max(0, G.ap - 1); render(); await huSweep();
  }
  while (p.hand.length > HAND_MAX) {
    let c;
    if (p.ai) c = aiLowest(p); else c = (await pickCards('hand', 1, false))[0];
    if (!c) break;
    p.hand.splice(p.hand.indexOf(c), 1); G.dark.push(c); sfx('discard'); log(`${p.name} 弃掉 ${c.name}`); render();
  }
  render();
}
async function doHu(p, tk) {
  const w = WAVES[tk];
  const cards = w.ids.map(id => p.hand.find(c => c.waveKey === tk && c.idol === id));
  const total = huScore(w.size);
  p.score += total;
  for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
  p.done.push({ waveKey: tk, cards, total });
  const refill = Math.max(0, w.size - 2);
  if (refill) { p.hand.push(...drawCards(refill)); sortHand(p); }
  sfx('hu');
  log(`★ ${p.name} 胡牌！${w.unit} 同一轮次全员（${w.size} 人）+${total} 分` + (refill ? `，从牌山补 ${refill} 张` : ''));
  playUnitTrack(w.unit);
  if (!QUICK) { UI.banner = { kind: 'hu', p, tk, total }; render(); await sleep(1800); UI.banner = null; }
  render();
}
function pickWaveFromList(keys) { return new Promise(res => { UI.waveChoose = { keys, res }; render(); }); }
function animate(uid, kind, delay) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`#displayGrid .tile[data-uid="${uid}"]`);
    if (el && el.animate) el.animate([{ transform: 'translateY(-46px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, delay: delay || 0, fill: 'backwards' });
  });
}
function humanAP(p) { return new Promise(res => { UI.mainRes = res; render(); }); }
function consumeMain() { const r = UI.mainRes; UI.mainRes = null; return r; }
function restoreMain(r) { UI.mainRes = r; render(); }
function swapAtDisplay(idx, pi, handCard) {
  const p = G.players[pi], card = G.display[idx];
  if (!card || !handCard) return false;
  G.display[idx] = handCard;
  p.hand.splice(p.hand.indexOf(handCard), 1); p.hand.push(card); sortHand(p);
  sfx('swap'); log(`${p.name} 用 ${handCard.name} 换走 ${card.name}`);
  return true;
}
async function roundAuction(n) {
  n = Math.min(n, G.players.length);
  G.auctionCards = [];
  for (let k = 0; k < n; k++) { const c = drawCards(1)[0]; if (!c) break; G.auctionCards.push(c); }
  if (!G.auctionCards.length) return;
  log(`—— 本场拍卖：整包 ${G.auctionCards.length} 张 ——`); sfx('bid');
  const P = G.players.length;
  let bid = 0, winner = -1;
  const active = []; for (let k = 0; k < P; k++) active.push(k);
  let raised = true;
  while (raised && active.length) {
    raised = false;
    for (const pi of [...active]) {
      if (pi === winner) continue; // 当前最高价者绝不自己加价，其余全部放弃即成交
      const need = bid + 1, pl = G.players[pi];
      if (pl.hand.length < need) { active.splice(active.indexOf(pi), 1); continue; }
      let want = false;
      if (pl.ai) want = aiWantsBundleBid(pi, need); else want = await humanBidDecide(G.auctionCards, need);
      if (want) { bid = need; winner = pi; raised = true; G.showBid = { bid, bidder: pi }; sfx('bid'); log(`${pl.name} 出价 ${bid} 张暗牌`); render(); if (!QUICK) await sleep(900); }
      else { active.splice(active.indexOf(pi), 1); log(`${pl.name} 放弃`); sfx('pass'); }
    }
  }
  G.showBid = null;
  if (winner < 0) {
    for (const card of G.auctionCards) { const old = G.display.length >= DISPLAY_SIZE ? G.display.shift() : null; if (old) G.dark.push(old); G.display.push(card); }
    log(`无人出价，整包 ${G.auctionCards.length} 张进入明牌列`); sfx('pass'); render(); return;
  }
  const wp = G.players[winner];
  const pay = wp.ai ? aiPickPay(wp, bid) : await humanPickPay(bid);
  for (const c of pay) wp.hand.splice(wp.hand.indexOf(c), 1);
  G.dark.push(...pay); wp.hand.push(...G.auctionCards); sortHand(wp); sfx('win');
  log(`拍卖成交：${wp.name} 以 ${bid} 张暗牌拍得整包 ${G.auctionCards.length} 张`);
  UI.banner = { kind: 'trade', pay, cards: G.auctionCards.slice(), wp, bid };
  render(); if (!QUICK) await sleep(1700); UI.banner = null; render();
}
function aiWantsBundleBid(pi, need) { const p = G.players[pi]; if (p.hand.length < need + 1) return false; const sum = G.auctionCards.reduce((s, c) => s + cardValueFor(p, c), 0); return sum >= 1.2 + need * 0.6 && rnd() < 0.85; }
async function humanBidDecide(card, need) { const yes = await new Promise(res => { UI.bidAsk = { card, need, res }; render(); }); UI.bidAsk = null; render(); if (!yes) sfx('pass'); return yes === true; }
async function humanPickPay(bid) { return (await pickCards('hand', bid, false)) || []; }
function cardValueFor(p, c) { const w = WAVES[c.waveKey]; if (!w) return 0; const k = piecesOf(p, c.waveKey); return (k + 1) * (k + 1) / w.size; }
function aiPickPay(p, bid) { return p.hand.slice().sort((a, b) => cardValueFor(p, a) - cardValueFor(p, b)).slice(0, bid); }
function aiLowest(p) { return p.hand.slice().sort((a, b) => cardValueFor(p, a) - cardValueFor(p, b))[0]; }
async function aiAP(p, i) {
  const scored = G.display.map((c, idx) => ({ idx, v: c ? cardValueFor(p, c) : -1 }));
  scored.sort((a, b) => b.v - a.v);
  const best = scored[0], low = aiLowest(p);
  if (best && best.v >= 1 && best.v > cardValueFor(p, low) + 0.3) { swapAtDisplay(best.idx, i, low); render(); return true; }
  if (p.hand.length < HAND_MAX - 1) { const c = drawCards(1)[0]; if (c) { p.hand.push(c); sortHand(p); sfx('draw'); log(`${p.name} 从牌山摸进 1 张`); render(); return true; } }
  if (best && best.v >= 0.7) { swapAtDisplay(best.idx, i, low); render(); return true; }
  return false;
}
async function applyUnitEffect(p, unit, i, card) {
  const key = (UNIT_EFFECT[unit] || {}).key;
  switch (key) {
    case 'draw2': { const got = drawCards(2); p.hand.push(...got); sortHand(p); sfx('draw'); break; }
    case 'take2': {
      let picks;
      if (p.ai) picks = G.display.map((c, idx) => ({ c, idx, v: c ? cardValueFor(p, c) : -1 })).sort((a, b) => b.v - a.v).slice(0, 2).filter(x => x.c).map(x => x.c);
      else picks = await pickCards('display', 2, true);
      if (!picks || picks.length === 0) break;
      for (const c of picks) { const idx = G.display.indexOf(c); if (idx >= 0) G.display[idx] = drawCards(1)[0] || null; p.hand.push(c); }
      sfx('swap');
      let pay;
      if (p.ai) pay = aiLowest(p);
      else pay = (await pickCards('hand', 1, false))[0];
      if (pay) { p.hand.splice(p.hand.indexOf(pay), 1); G.dark.push(pay); sfx('discard'); log(`${p.name} 追加弃掉 ${pay.name}`); }
      break;
    }
    case 'darkpick': {
      if (!G.dark.length) break;
      let dc;
      if (p.ai) dc = G.dark[Math.floor(rnd() * G.dark.length)];
      else dc = await pickFromDark();
      if (!dc) break;
      G.dark.splice(G.dark.indexOf(dc), 1); p.hand.push(dc); sortHand(p);
      let pay;
      if (p.ai) pay = aiLowest(p); else pay = (await pickCards('hand', 1, false))[0];
      if (pay) { p.hand.splice(p.hand.indexOf(pay), 1); G.dark.push(pay); sfx('discard'); }
      break;
    }
    case 'peek4': {
      const top = [];
      for (let k = 0; k < 4; k++) { const c = drawCards(1)[0]; if (c) top.push(c); }
      if (!top.length) break;
      let chosen;
      if (p.ai) chosen = top.slice().sort((a, b) => cardValueFor(p, b) - cardValueFor(p, a))[0];
      else chosen = await pickFromPeek(top);
      top.splice(top.indexOf(chosen), 1);
      p.hand.push(chosen); sortHand(p);
      G.deck.push(...top); sfx('draw');
      break;
    }
    case 'reshuffle': {
      G.deck = shuffle(G.deck.concat(G.display.splice(0)));
      while (G.display.length < DISPLAY_SIZE) { const c = drawCards(1)[0]; if (!c) break; G.display.push(c); }
      sfx('swap'); break;
    }
    case 'refresh': {
      let sel;
      if (p.ai) { sel = p.hand.slice().sort((a, b) => cardValueFor(p, a) - cardValueFor(p, b)).filter(c => cardValueFor(p, c) <= 0.5).slice(0, 3); if (!sel.length) break; }
      else { sel = await pickCards('hand', 'any', true); if (!sel || !sel.length) break; }
      for (const c of sel) p.hand.splice(p.hand.indexOf(c), 1);
      G.deck = shuffle(G.deck.concat(sel));
      const fresh = drawCards(sel.length);
      p.hand.push(...fresh); sortHand(p); sfx('draw');
      break;
    }
    case 'spy': {
      let target;
      if (p.ai) { const cands = G.players.filter(x => x !== p); target = cands[Math.floor(rnd() * cands.length)]; }
      else target = await pickForcedTarget(G.players.filter(x => x !== p));
      if (!target) break;
      UI.spyView = { hand: target.hand.slice(), name: target.name };
      render();
      if (p.ai) await sleep(1800); else await spyCloseWait();
      UI.spyView = null; break;
    }
    case 'forcedswap': {
      let give;
      if (p.ai) give = aiPickPay(p, 1 + (rnd() < 0.4 ? 1 : 0));
      else give = await pickCards('hand', 'up2', true);
      if (!give || !give.length) break;
      const cands = G.players.filter(x => x !== p && x.hand.length >= give.length);
      if (!cands.length) break;
      let target;
      if (p.ai) target = cands[Math.floor(rnd() * cands.length)];
      else target = await pickForcedTarget(cands);
      if (!target) break;
      let theirs;
      if (target.ai) theirs = aiPickPay(target, give.length);
      else theirs = await humanPickPay(give.length);
      for (const c of theirs) target.hand.splice(target.hand.indexOf(c), 1);
      for (const c of give) p.hand.splice(p.hand.indexOf(c), 1);
      target.hand.push(...give); p.hand.push(...theirs);
      sortHand(p); sortHand(target); sfx('swap');
      log(`强制交换：${p.name} 与 ${target.name} 交换了 ${give.length} 张手牌`);
      break;
    }
  }
}
async function castEffect(p, unit, i) {
  p.effectUsed = true;
  const self = p.hand.find(c => c.unit === unit);
  if (!self) return false;
  if (unit === 'noctchill' && !G.dark.length) return false;
  p.hand.splice(p.hand.indexOf(self), 1);
  G.dark.push(self);
  log(`${p.name} 弃牌发动【${UNIT_EFFECT[unit].name}】`);
  await applyUnitEffect(p, unit, i, self); sortHand(p);
  return true;
}
function pickFromDark() { return new Promise(res => { UI.darkPick = { res }; render(); }); }
function pickFromPeek(cards) { return new Promise(res => { UI.peekPick = { cards, res }; render(); }); }
function pickSpyTarget(pIdx) { return new Promise(res => { UI.spyTarget = { res }; render(); }); }
function pickForcedTarget(cands) { return new Promise(res => { UI.forcedTarget = { cands, res }; render(); }); }
function spyCloseWait() { return new Promise(res => { UI.spyCloseWait = res; }); }
function cardImg(c, cls, side, idx, style) {
  const attrs = side !== undefined ? ` data-side="${side}" data-idx="${idx}"` : '';
  return `<div class="tile ${cls || ''}" data-uid="${c.uid}"${attrs}${style ? ` style="${style}"` : ''} title="${esc(c.name)}"><img src="${c.img}" draggable="false"><img class="pv" src="${c.img}" draggable="false" alt=""></div>`;
}
function backTile() { return '<div class="tileback"></div>'; }
function waveMini(tk) { const w = WAVES[tk]; if (!w) return ''; return `<span class="wavemini" title="${esc(w.unit)}">${w.ids.map(id => { const c = ALLCARDS.find(c => c.waveKey === tk && c.idol === id); return `<img src="${c.img}">`; }).join('')}</span>`; }
function doneChip(d) { const w = WAVES[d.waveKey]; return `<span class="donechip">${esc(w.unit)} · ${w.size} 人 <b>+${d.total}</b><span class="donepop">${waveMini(d.waveKey)}</span></span>`; }
function seatHtml(p, isTurn) { return `<div class="seat ${isTurn ? 'turn' : ''}"><div class="plate"><span class="pname">${esc(p.name)}</span><span class="pscore">${p.score} 分</span></div><div class="backs">${p.hand.map(backTile).join('')}</div><div class="donerow">${p.done.map(d => doneChip(d)).join('')}</div></div>`; }
function myTurnActive() { return G.turn === 0 && !G.over && !!UI.mainRes && G.ap > 0 && !UI.pick; }
function render() {
  if (!G.players.length) return;
  const me = G.players[0]; sortHand(me);
  $('#seatsRow').innerHTML = G.players.slice(1).map((p, k) => seatHtml(p, G.turn === k + 1 && !G.over)).join('');
  $('#statusPill').textContent = `第 ${Math.min(G.round, MAX_ROUND)} / ${MAX_ROUND} 回合`;
  $('#deckCount').textContent = `${G.deck.length} 张`;
  $('#darkCount').textContent = `${G.dark.length} 张`;
  $('#deckPile').classList.toggle('pileempty', !G.deck.length);
  $('#darkPile').classList.toggle('pileempty', !G.dark.length);
  $('#auctionGrid').innerHTML = (G.auctionCards || []).map((c, k) => cardImg(c, 'mini2b', 'auc', k)).join('');
  $('#showInfo').innerHTML = `<div>当前出价 <b class="abid">${G.showBid ? G.showBid.bid : 0}</b> 张暗牌${G.showBid && G.showBid.bidder !== null ? '（' + esc(G.players[G.showBid.bidder].name) + '）' : ''}</div>${UI.bidAsk ? `<div class="ask">是否出价 ${UI.bidAsk.need} 张？<button data-bid="yes">出价</button> <button data-bid="no">放弃</button></div>` : '<div class="dim">等待轮次结束开拍</div>'}`;
  sortDisplay(); sortDark();
  $('#displayGrid').innerHTML = G.display.map((c, idx) => { if (!c) return '<div class="tile empty"></div>'; const clickable = myTurnActive() ? 'clickable' : ''; const target = UI.swap && UI.swap.idx === idx ? ' swaptarget' : ''; return cardImg(c, clickable + target, 'display', idx); }).join('');
  $('#mePlate').innerHTML = `<span class="pname">${esc(me.name)}</span><span class="pscore">${me.score} 分</span><span class="medone">${me.done.map(d => doneChip(d)).join('')}</span>`;
  const fanStyle = (idx, n) => { const off = idx - (n - 1) / 2; return `--r:${(off * 3.5).toFixed(1)}deg;--ty:${(off * off * 1.5).toFixed(0)}px`; };
  $('#handRow').innerHTML = me.hand.map((c, idx) => { const picked = UI.pick && UI.pick.side === 'hand' && UI.sel.has(c.uid) ? 'picked' : ''; return cardImg(c, `${picked} big${UI.swap ? ' swapsrc' : ''}`, 'hand', idx, fanStyle(idx, me.hand.length)); }).join('');
  const myTurn = G.turn === 0 && !G.over;
  $('#apPill').textContent = `行动点 ${'●'.repeat(Math.max(0, G.ap))}${'○'.repeat(Math.max(0, AP_PER_TURN - G.ap))}`;
  $('#actions').innerHTML = myTurn && UI.mainRes && !UI.pick ? `<button data-act="draw">摸牌</button><button data-act="pass">结束回合</button>` : '';
  $('#turnHint').textContent = G.over ? '已结束' : myTurn ? (UI.mainRes && !UI.pick && G.ap > 0 ? `你的回合：点击手牌发动效果，或摸牌（剩余 ${G.ap} 点）` : '…') : '等待对手…';
  $('#pickHint').innerHTML = UI.pick ? `选 ${UI.pick.side === 'hand' ? '手牌' : '明牌列'}${UI.pick.nAny ? '' : UI.pick.n === 'up2' ? '至多 2 张' : ` ${UI.pick.n} 张`}（已选 ${UI.sel.size}${UI.pick.exact ? '/' + UI.pick.n : ''}）${UI.pick.cancelable ? ' <button data-act="cancelPick">取消</button>' : ''}` : (UI.swap ? `点一张手牌与明牌列交换（1 行动点） <button data-act="cancelSwap">取消</button>` : '');
  $('#pickConfirm').innerHTML = (UI.pick && UI.sel.size > 0 && (!UI.pick.exact || UI.sel.size === UI.pick.n)) ? `<button data-act="confirmPay">确认（已选 ${UI.sel.size}${UI.pick.exact ? '/' + UI.pick.n : ''} 张）</button>` : '';
  $('#discardPanel').innerHTML = UI.discardAsk ? `<div class="dlgbox discard-dlg"><h3>发动效果</h3><div class="payrow">${cardImg(UI.discardAsk.card, 'mini2b')}<div class="dsc"><div class="dname">${esc(UI.discardAsk.card.name)}</div><div class="ddesc">${esc(UNIT_EFFECT[UI.discardAsk.card.unit].name)}</div><div class="ddesc">${esc(UNIT_EFFECT[UI.discardAsk.card.unit].desc)}</div></div></div><div style="margin-top:10px"><button data-act="confirmDiscard" style="background:#d99a26;color:#fff;font-weight:700;border:none;border-radius:8px;padding:8px 20px;font-size:14px">确认弃牌发动</button><button data-act="cancelDiscard" style="margin-left:8px">取消</button></div></div>` : '';
  $('#darkModal').innerHTML = UI.darkPick ? `<div class="dlgbox"><h3>暗堆回收：选 1 张</h3><div class="payrow">${G.dark.map((c, k) => cardImg(c, 'mini2b darkcard', 'dark', k)).join('')}</div><button data-act="darkCancel">取消</button></div>` : '';
  $('#peekModal').innerHTML = UI.peekPick ? `<div class="dlgbox"><h3>牌山精选：选 1 张入手</h3><div class="payrow">${UI.peekPick.cards.map((c, k) => cardImg(c, 'mini2b peekcard', 'peek', k)).join('')}</div></div>` : '';
  $('#spyModal').innerHTML = UI.spyView ? `<div class="dlgbox"><h3>查验 · ${esc(UI.spyView.name)} 的手牌</h3><div class="payrow">${UI.spyView.hand.map(c => cardImg(c, 'mini2b')).join('')}</div><button data-act="spyClose">知道了</button></div>` : '';
  $('#targetModal').innerHTML = UI.forcedTarget ? `<div class="dlgbox"><h3>强制交换：选择对手</h3><div class="eflist">${UI.forcedTarget.cands.map(p2 => `<div class="efrow"><span class="efname">${esc(p2.name)}</span><button data-target="${G.players.indexOf(p2)}">指定</button></div>`).join('')}</div><button data-act="targetCancel">取消</button></div>` : '';
  $('#waveChoose').innerHTML = UI.waveChoose ? `<div class="dlgbox"><h3>选择要胡的轮次</h3><div class="payrow">${UI.waveChoose.keys.map(k => `<span class="wavepick" data-wave="${k}">${waveMini(k)}</span>`).join('')}</div></div>` : '';
  $('#banner').innerHTML = UI.banner ? (UI.banner.kind === 'trade' ? `<div class="toast"><div class="ttitle">拍卖成交</div><div class="trow">${UI.banner.pay.map(c => cardImg(c, 'ttile')).join('')} <b>→</b> ${UI.banner.cards.map(c => cardImg(c, 'ttile')).join('')}</div><div class="tsub">${esc(UI.banner.wp.name)} 付出 ${UI.banner.bid} 张暗牌</div></div>` : `<div class="toast hu"><div class="ttitle">胡牌！+${UI.banner.total} 分</div><div class="tsub">${esc(UI.banner.p.name)} · <span class="uname">${esc(WAVES[UI.banner.tk].unit)}</span> 同一轮次全员</div><div class="trow">${waveMini(UI.banner.tk)}</div></div>`) : '';
  $('#log').innerHTML = G.logs.slice(-40).map(l => `<div>${wrapUnit(esc(l))}</div>`).join('');
  $('#log').scrollTop = 999999;
}
function myTurnActive() { return G.turn === 0 && !G.over && !!UI.mainRes && G.ap > 0 && !UI.pick; }

/* ================= 事件 ================= */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-uid],[data-act],[data-bid],[data-wave],[data-target]');
  if (!t) return;
  if (t.dataset.uid && UI.pick) {
    const side = t.dataset.side;
    if (side !== UI.pick.side) return;
    const pool = side === 'hand' ? G.players[0].hand : G.display;
    const card = pool[Number(t.dataset.idx)];
    if (!card) return;
    if (UI.sel.has(card.uid)) UI.sel.delete(card.uid); else UI.sel.add(card.uid);
    if (UI.sel.size > UI.pick.cap) UI.sel.delete(UI.sel.values().next().value);
    if (UI.pick.cap === 1 && UI.sel.size === 1) {
      const cards = [...UI.sel].map(uid => pool.find(c => c.uid === uid));
      const res = UI.pick.res; UI.pick = null; UI.sel = new Set(); res(cards);
    }
    render(); return;
  }
  /* 自己回合点击明牌列：开始交换，再点手牌完成（1 行动点） */
  if (t.dataset.uid && !UI.pick && !UI.discardAsk && t.dataset.side === 'display' && myTurnActive()) { UI.swap = { idx: Number(t.dataset.idx) }; render(); return; }
  if (t.dataset.uid && UI.swap) {
    if (t.dataset.side === 'hand') {
      const card = G.players[0].hand[Number(t.dataset.idx)];
      if (!card) return;
      const idx = UI.swap.idx;
      UI.swap = null;
      if (swapAtDisplay(idx, 0, card)) { const res = consumeMain(); render(); if (res) res(true); }
      else render();
      return;
    }
    if (t.dataset.side === 'display') { UI.swap = { idx: Number(t.dataset.idx) }; render(); }
    return;
  }
  if (t.dataset.act === 'cancelSwap' && UI.swap) { UI.swap = null; render(); return; }
  /* 自己回合点击手牌：主动弃牌发动组合效果（每回合一次，不耗行动点） */
  if (t.dataset.uid && !UI.pick && !UI.swap && !UI.discardAsk && t.dataset.side === 'hand' && myTurnActive()) {
    const card = G.players[0].hand[Number(t.dataset.idx)];
    const eff = card && UNIT_EFFECT[card.unit];
    if (card && eff && !G.players[0].effectUsed && !(card.unit === 'noctchill' && !G.dark.length)) {
      UI.discardAsk = { card };
      render();
    }
    return;
  }
  if (t.dataset.act === 'confirmDiscard' && UI.discardAsk) {
    const card = UI.discardAsk.card;
    UI.discardAsk = null;
    const res = consumeMain();
    render();
    await castEffect(G.players[0], card.unit, 0);
    render();
    if (res) res(true);
    return;
  }
  if (t.dataset.act === 'cancelDiscard' && UI.discardAsk) { UI.discardAsk = null; render(); return; }
  if (t.dataset.act === 'cancelPick' && UI.pick) { const res = UI.pick.res; UI.pick = null; UI.sel = new Set(); res(null); render(); return; }
  if (t.dataset.act === 'confirmPay' && UI.pick) {
    if (UI.pick.exact ? UI.sel.size !== UI.pick.n : UI.sel.size < 1) return;
    const pool = UI.pick.side === 'hand' ? G.players[0].hand : G.display;
    const cards = [...UI.sel].map(uid => pool.find(c => c.uid === uid)).filter(Boolean);
    const res = UI.pick.res; UI.pick = null; UI.sel = new Set(); res(cards); render(); return;
  }
  if (t.dataset.bid && UI.bidAsk) { const r = UI.bidAsk.res; UI.bidAsk = null; render(); r(t.dataset.bid === 'yes'); return; }
  if (t.dataset.wave && UI.waveChoose) { const r = UI.waveChoose.res; UI.waveChoose = null; render(); r(t.dataset.wave); return; }
  if (t.dataset.act === 'darkCancel' && UI.darkPick) { const r = UI.darkPick.res; UI.darkPick = null; render(); r(null); return; }
  if (t.dataset.uid && t.dataset.side === 'dark' && UI.darkPick) { const card = G.dark[Number(t.dataset.idx)]; if (!card) return; const r = UI.darkPick.res; UI.darkPick = null; render(); r(card); return; }
  if (t.dataset.uid && t.dataset.side === 'peek' && UI.peekPick) { const card = UI.peekPick.cards[Number(t.dataset.idx)]; if (!card) return; const r = UI.peekPick.res; UI.peekPick = null; render(); r(card); return; }
  if (t.dataset.act === 'spyClose' && UI.spyView) { UI.spyView = null; const r = UI.spyCloseWait; UI.spyCloseWait = null; render(); if (r) r(); return; }
  if (t.dataset.act === 'targetCancel' && UI.forcedTarget) { const r = UI.forcedTarget.res; UI.forcedTarget = null; render(); r(null); return; }
  if (t.dataset.target && UI.forcedTarget) { const idx = Number(t.dataset.target); const r = UI.forcedTarget.res; UI.forcedTarget = null; render(); r(G.players[idx]); return; }
  if (t.dataset.act && UI.mainRes && G.ap > 0 && !UI.pick && !UI.discardAsk) {
    UI.swap = null;
    const act = t.dataset.act; const res = consumeMain(); render();
    let acted = false, endTurn = false;
    if (act === 'pass') { G.ap = 0; endTurn = true; }
    else if (act === 'draw') { const c = drawCards(1)[0]; if (c) { G.players[0].hand.push(c); sortHand(G.players[0]); sfx('draw'); log('你 从牌山摸进 1 张'); acted = true; } else log('牌山已空'); }
    render();
    if (acted || endTurn) res(true); else { UI.mainRes = res; render(); }
  }
});

async function humanAP(p) { return new Promise(res => { UI.mainRes = res; render(); }); }

/* ================= setup ================= */
function renderSetup() {
  $('#unitList').innerHTML = [...DATA].sort((a, b) => UNIT_ORDER[a.unit] - UNIT_ORDER[b.unit]).map(u => { const on = DEFAULT_UNITS.includes(u.unit) ? 'checked' : ''; const waves = u.waves.filter(w => Object.keys(w).length).length; return `<label class="unitopt"><input type="checkbox" data-unit="${esc(u.unit)}" ${on}> ${esc(u.unit)}（${u.idols.length} 人 / ${waves} 轮次）</label>`; }).join('');
}
$('#startBtn').addEventListener('click', () => {
  ac();
  initBgm();
  const units = [...document.querySelectorAll('input[data-unit]:checked')].map(x => x.dataset.unit);
  if (units.length < 2) { alert('至少选择 2 个组合'); return; }
  const aiCount = Number(document.querySelector('input[name=ai]:checked').value);
  const wavesPerUnit = Number(document.querySelector('input[name=wpu]:checked').value) || 0;
  show(''); startGame(units, aiCount, wavesPerUnit);
});
function show(sel) { for (const id of ['#setupModal', '#scoreModal']) $(id).style.display = 'none'; if (sel) $(sel).style.display = 'flex'; }
function showScore() { $('#scoreTitle').textContent = G.exhausted ? '牌尽流局' : '结算'; $('#scoreBody').innerHTML = G.players.map(p => `<tr><td>${esc(p.name)}</td><td><b>${p.score}</b></td><td>${p.done.map(d => waveMini(d.waveKey)).join(' ')}</td></tr>`).join(''); show('#scoreModal'); }
$('#scoreClose').addEventListener('click', () => location.reload());
$('#sfxBtn').addEventListener('click', () => { sfxOn = !sfxOn; $('#sfxBtn').textContent = sfxOn ? '🔊 音效:开' : '🔇 音效:关'; if (bgmEl) { if (sfxOn) bgmEl.play().catch(() => {}); else bgmEl.pause(); } });
$('#logBtn').addEventListener('click', () => { document.body.classList.toggle('logOpen'); });

if (AUTO) {
  show(''); sfxOn = false;
  (async () => { try {
    buildPool(DEFAULT_UNITS, 3);
    for (const name of ['AI甲', 'AI乙', 'AI丙']) G.players.push(makePlayer(name, true));
    G.deck = shuffle(ALLCARDS.slice());
    for (const p of G.players) p.hand = G.deck.splice(0, 7);
    while (G.display.length < DISPLAY_SIZE) { const c = drawCards(1)[0]; if (!c) break; G.display.push(c); }
    await gameLoop();
  } catch (err) { window.__result = { error: String((err && err.stack) || err) }; document.title = 'AUTO_ERROR'; }
  })();
} else { renderSetup(); show('#setupModal'); }
