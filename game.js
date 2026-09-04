'use strict';
window.addEventListener('error', e => { (window.__errs = window.__errs || []).push(String(e.message)); });
window.addEventListener('unhandledrejection', e => { (window.__errs = window.__errs || []).push('REJ: ' + String((e.reason && e.reason.stack) || e.reason)); });
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PARAMS = new URLSearchParams(location.search);
const AUTO = PARAMS.get('auto') === '1';
let seed = Number(PARAMS.get('seed') || 987654321);

/* 音效 */
let sfxOn = true, AC = null;
function ac() { if (!AC) try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} if (AC && AC.state === 'suspended') AC.resume(); return AC; }
function tone(f, d, t, v, dl) { if (!sfxOn || QUICK) return; const c = ac(); if (!c) return; const s = c.currentTime + (dl || 0); const o = c.createOscillator(), g = c.createGain(); o.type = t || 'sine'; o.frequency.value = f; g.gain.setValueAtTime(v || .12, s); g.gain.exponentialRampToValueAtTime(.001, s + d); o.connect(g); g.connect(c.destination); o.start(s); o.stop(s + d + .02); }
function sfx(n) { if (!sfxOn || QUICK) return; const m = { flip: [700, .05, 'triangle', .06], draw: [520, .07, 'triangle', .08], swap: [440, .06, 'triangle', .07], discard: [200, .09, 'sine', .1], bid: [880, .06, 'square', .05], pass: [330, .05, 'triangle', .05], win: [660, .1, 'triangle', .1] }; if (n === 'hu') { [523, 659, 784, 1047].forEach((f, i) => tone(f, .16, 'triangle', .12, i * .12)); return; } const p = m[n]; if (p) tone(p[0], p[1], p[2], p[3]); }

/* 背景音乐（清单由 music-manifest.js 生成）：开局随机播通用曲池；
   胡牌时切到对应组合曲池播随机一曲，播完自动回到通用曲池 */
const BGM_MAN = window.BGM_MANIFEST || { root: [], units: {} };
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

/* 引擎与状态引用（开局后赋值） */
const ENGINE = window.MahjongEngine;
let G = null, WAVES = null, ALLCARDS = null, UNIT_ORDER = null, huScore = () => 0;
const DEFAULT_UNITS = ['illumination STARS', "L'Antica", 'noctchill', '放課後クライマックスガールズ'];
const QUICK = AUTO;

/* UI 状态 */
const UI = { pick: null, sel: new Set(), banner: null, bidAsk: null, discardAsk: null, darkPick: null, peekPick: null, spyView: null, forcedTarget: null, swap: null, codexOpen: false, rulesOpen: false };
let pendingActRes = null;
let prevHandUids = null;
const FRESH_UIDS = new Set();

function myTurnActive() { return !!G && G.turn === 0 && !G.over && !!pendingActRes && G.ap > 0 && !UI.pick; }
function resolveAct(a) { if (pendingActRes) { const r = pendingActRes; pendingActRes = null; r(a); } }

/* 新卡飞入动画：与上次渲染的 uid 快照对比 */
function animateHandInsert(uids) {
  uids.forEach((uid, i) => {
    const el = document.querySelector(`#handRow .tile[data-uid="${uid}"]`);
    if (!el || !el.animate) return;
    const r = el.style.getPropertyValue('--r') || '0deg';
    const ty = el.style.getPropertyValue('--ty') || '0px';
    el.animate([
      { transform: 'translateY(150px) scale(.55)', opacity: 0, filter: 'brightness(2)' },
      { transform: 'translateY(26px) scale(1.06)', opacity: 1, filter: 'brightness(1.45)', offset: 0.72 },
      { transform: `rotate(${r}) translateY(${ty})`, opacity: 1, filter: 'brightness(1)' }
    ], { duration: 430, delay: Math.min(i, 8) * 80, easing: 'cubic-bezier(.2,.85,.3,1.04)', fill: 'backwards' });
  });
}
/* 明牌列发牌下落动画 */
function dealIn(uid, delay) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`#displayGrid .tile[data-uid="${uid}"]`);
    if (el && el.animate) el.animate([{ transform: 'translateY(-46px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, delay: delay || 0, fill: 'backwards' });
  });
}

/* ---------- 人类玩家 agent：把引擎的交互请求映射到 UI 弹窗 ---------- */
const uiAgent = {
  isAI: false,
  async act(ctx, pi) {
    return new Promise(res => { pendingActRes = res; render(); });
  },
  async chooseCards(ctx, pi, req) {
    return new Promise(res => {
      UI.pick = { side: req.side, n: req.up2 ? 'up2' : req.nAny ? 'any' : req.n, nAny: !!req.nAny, up2: !!req.up2, cap: req.nAny ? 99 : req.up2 ? 2 : req.n, exact: !!req.exact, res, cancelable: !!req.cancelable };
      UI.sel = new Set(); render();
    });
  },
  async chooseFromDark(ctx, pi, darkCards) {
    return new Promise(res => { UI.darkPick = { cards: darkCards, res }; render(); });
  },
  async peekChoose(ctx, pi, top) {
    return new Promise(res => { UI.peekPick = { cards: top, res }; render(); });
  },
  async chooseTarget(ctx, pi, cands) {
    return new Promise(res => { UI.forcedTarget = { cands, res }; render(); });
  },
  async viewSpy(ctx, pi, target) {
    return new Promise(res => { UI.spyView = { hand: target.hand.slice(), name: target.name, res }; render(); });
  },
  async askEffect(ctx, pi, card) {
    return new Promise(res => { UI.discardAsk = { card, res }; render(); });
  },
  async decideBid(ctx, pi, auctionCards, need) {
    return new Promise(res => { UI.bidAsk = { card: auctionCards, need, res }; render(); });
  },
  async payCards(ctx, pi, n) {
    return this.chooseCards(ctx, pi, { side: 'hand', n, exact: true });
  },
  async chooseHu(ctx, pi, waveKeys) {
    return new Promise(res => { UI.waveChoose = { keys: waveKeys, res }; render(); });
  },
};

/* ---------- 渲染 ---------- */
function cardImg(c, cls, side, idx, style) {
  const attrs = side !== undefined ? ` data-side="${side}" data-idx="${idx}"` : '';
  return `<div class="tile ${cls || ''}" data-uid="${c.uid}"${attrs}${style ? ` style="${style}"` : ''} title="${c.name.replace(/"/g, '&quot;')}"><img src="${c.img}" draggable="false"><img class="pv" src="${c.img}" draggable="false" alt=""></div>`;
}
function backTile() { return '<div class="tileback"></div>'; }
function waveMini(tk) { const w = WAVES[tk]; if (!w) return ''; return `<span class="wavemini" title="${w.unit}">${w.ids.map(id => { const c = ALLCARDS.find(x => x.waveKey === tk && x.idol === id); return `<img src="${c.img}">`; }).join('')}</span>`; }
function doneChip(d) { const w = WAVES[d.waveKey]; return `<span class="donechip">${w.unit} · ${w.size} 人 <b>+${d.total}</b><span class="donepop">${waveMini(d.waveKey)}</span></span>`; }
function seatHtml(p, isTurn) { return `<div class="seat ${isTurn ? 'turn' : ''}"><div class="plate"><span class="pname">${p.name}</span><span class="pscore">${p.score} 分</span></div><div class="backs">${p.hand.map(backTile).join('')}</div><div class="donerow">${p.done.map(d => doneChip(d)).join('')}</div></div>`; }

function render() {
  if (!G) return;
  const me = G.players[0];
  $('#seatsRow').innerHTML = G.players.slice(1).map((p, k) => seatHtml(p, G.turn === k + 1 && !G.over)).join('');
  $('#statusPill').textContent = `第 ${Math.min(G.round, ENGINE.MAX_ROUND)} / ${ENGINE.MAX_ROUND} 回合`;
  $('#deckCount').textContent = `${G.deck.length} 张`;
  $('#darkCount').textContent = `${G.dark.length} 张`;
  $('#deckPile').classList.toggle('pileempty', !G.deck.length);
  $('#darkPile').classList.toggle('pileempty', !G.dark.length);
  $('#auctionGrid').innerHTML = (G.auctionCards || []).map((c, k) => cardImg(c, 'mini2b', 'auc', k)).join('');
  $('#showInfo').innerHTML = `<div>当前出价 <b class="abid">${G.showBid ? G.showBid.bid : 0}</b> 张暗牌${G.showBid && G.showBid.bidder !== null ? '（' + G.players[G.showBid.bidder].name + '）' : ''}</div>${UI.bidAsk ? `<div class="ask">是否出价 ${UI.bidAsk.need} 张？<button data-bid="yes">出价</button> <button data-bid="no">放弃</button></div>` : '<div class="dim">等待轮次结束开拍</div>'}`;
  /* 听牌提醒：某组合只差 1 张成套时标记，缺牌在明牌列则单独高亮 */
  const tenpai = { waves: new Set(), missing: new Set() };
  for (const key in WAVES) {
    const w = WAVES[key];
    const held = w.ids.filter(id => me.hand.some(c => c.waveKey === key && c.idol === id));
    if (w.size > 1 && held.length === w.size - 1) {
      tenpai.waves.add(key);
      const mid = w.ids.find(id => !me.hand.some(c => c.waveKey === key && c.idol === id));
      const md = G.display.find(d => d && d.waveKey === key && d.idol === mid);
      if (md) tenpai.missing.add(md.uid);
    }
  }
  $('#displayGrid').innerHTML = G.display.map((c, idx) => {
    if (!c) return '<div class="tile empty"></div>';
    const clickable = myTurnActive() ? 'clickable' : '';
    const target = UI.swap && UI.swap.idx === idx ? ' swaptarget' : '';
    const miss = tenpai.missing.has(c.uid) ? ' missing' : '';
    return cardImg(c, clickable + target + miss, 'display', idx);
  }).join('');
  $('#mePlate').innerHTML = `<span class="pname">${me.name}</span><span class="pscore">${me.score} 分</span><span class="medone">${me.done.map(d => doneChip(d)).join('')}</span>`;
  const fanStyle = (idx, n) => { const off = idx - (n - 1) / 2; return `--r:${(off * 3.5).toFixed(1)}deg;--ty:${(off * off * 1.5).toFixed(0)}px`; };
  const handUids = me.hand.map(c => c.uid);
  if (prevHandUids) handUids.filter(u => !prevHandUids.has(u)).forEach(u => FRESH_UIDS.add(u));
  prevHandUids = new Set(handUids);
  let fi = 0;
  $('#handRow').innerHTML = me.hand.map((c, idx) => {
    const picked = UI.pick && UI.pick.side === 'hand' && UI.sel.has(c.uid) ? 'picked' : '';
    const isFresh = FRESH_UIDS.has(c.uid);
    let style = fanStyle(idx, me.hand.length);
    if (isFresh) style += `;animation-delay:${Math.min(fi++, 8) * 80}ms`;
    const cls = `${picked} big${UI.swap ? ' swapsrc' : ''}${tenpai.waves.has(c.waveKey) ? ' tenpai' : ''}${isFresh ? ' freshcard' : ''}`;
    return cardImg(c, cls, 'hand', idx, style);
  }).join('');
  animateHandInsert([...FRESH_UIDS].filter(u => handUids.includes(u)));
  const myTurn = G.turn === 0 && !G.over;
  $('#apPill').textContent = `行动点 ${'●'.repeat(Math.max(0, G.ap))}${'○'.repeat(Math.max(0, ENGINE.AP_PER_TURN - G.ap))}`;
  $('#actions').innerHTML = myTurn && pendingActRes && !UI.pick ? `<button data-act="draw">摸牌</button><button data-act="pass">结束回合</button>` : '';
  $('#turnHint').textContent = G.over ? '已结束' : myTurn ? (pendingActRes && G.ap > 0 && !UI.pick ? `你的回合：点击手牌发动效果，或摸牌（剩余 ${G.ap} 点）` : '…') : '等待对手…';
  $('#pickHint').innerHTML = UI.pick ? `选 ${UI.pick.side === 'hand' ? '手牌' : '明牌列'}${UI.pick.nAny ? '' : UI.pick.n === 'up2' ? '至多 2 张' : ` ${UI.pick.n} 张`}（已选 ${UI.sel.size}${UI.pick.exact ? '/' + UI.pick.n : ''}）${UI.pick.cancelable ? ' <button data-act="cancelPick">取消</button>' : ''}` : (UI.swap ? `点一张手牌与明牌列交换（1 行动点） <button data-act="cancelSwap">取消</button>` : '');
  $('#pickConfirm').innerHTML = (UI.pick && UI.sel.size > 0 && (!UI.pick.exact || UI.sel.size === UI.pick.n)) ? `<button data-act="confirmPay">确认（已选 ${UI.sel.size}${UI.pick.exact ? '/' + UI.pick.n : ''} 张）</button>` : '';
  $('#discardPanel').innerHTML = UI.discardAsk ? `<div class="dlgbox discard-dlg"><h3>发动效果</h3><div class="payrow">${cardImg(UI.discardAsk.card, 'mini2b')}<div class="dsc"><div class="dname">${UI.discardAsk.card.name}</div><div class="ddesc">${ENGINE.UNIT_EFFECT[UI.discardAsk.card.unit].name}</div><div class="ddesc">${ENGINE.UNIT_EFFECT[UI.discardAsk.card.unit].desc}</div></div></div><div style="margin-top:10px"><button data-act="confirmDiscard" style="background:#d99a26;color:#fff;font-weight:700;border:none;border-radius:8px;padding:8px 20px;font-size:14px">确认弃牌发动</button><button data-act="cancelDiscard" style="margin-left:8px">取消</button></div></div>` : '';
  $('#darkModal').innerHTML = UI.darkPick ? `<div class="dlgbox"><h3>暗堆回收：选 1 张</h3><div class="payrow">${UI.darkPick.cards.map((c, k) => cardImg(c, 'mini2b darkcard', 'dark', k)).join('')}</div><button data-act="darkCancel">取消</button></div>` : '';
  $('#peekModal').innerHTML = UI.peekPick ? `<div class="dlgbox"><h3>牌山精选：选 1 张入手</h3><div class="payrow">${UI.peekPick.cards.map((c, k) => cardImg(c, 'mini2b peekcard', 'peek', k)).join('')}</div></div>` : '';
  $('#spyModal').innerHTML = UI.spyView ? `<div class="dlgbox"><h3>查验 · ${UI.spyView.name} 的手牌</h3><div class="payrow">${UI.spyView.hand.map(c => cardImg(c, 'mini2b')).join('')}</div><button data-act="spyClose">知道了</button></div>` : '';
  $('#targetModal').innerHTML = UI.forcedTarget ? `<div class="dlgbox"><h3>强制交换：选择对手</h3><div class="eflist">${UI.forcedTarget.cands.map(p2 => `<div class="efrow"><span class="efname">${p2.name}</span><button data-target="${G.players.indexOf(p2)}">指定</button></div>`).join('')}</div><button data-act="targetCancel">取消</button></div>` : '';
  $('#waveChoose').innerHTML = UI.waveChoose ? `<div class="dlgbox"><h3>选择要胡的轮次</h3><div class="payrow">${UI.waveChoose.keys.map(k => `<span class="wavepick" data-wave="${k}">${waveMini(k)}</span>`).join('')}</div></div>` : '';
  $('#banner').innerHTML = UI.banner ? (UI.banner.kind === 'trade' ? `<div class="toast"><div class="ttitle">拍卖成交</div><div class="trow">${UI.banner.pay.map(c => cardImg(c, 'ttile')).join('')} <b>→</b> ${UI.banner.cards.map(c => cardImg(c, 'ttile')).join('')}</div><div class="tsub">${UI.banner.wp.name} 付出 ${UI.banner.bid} 张暗牌</div></div>` : `<div class="toast hu"><div class="ttitle">胡牌！+${UI.banner.total} 分</div><div class="tsub">${UI.banner.p.name} · ${UI.banner.unit} 同一轮次全员</div><div class="trow">${waveMini(UI.banner.tk)}</div></div>`) : '';
  $('#codexModal').style.display = UI.codexOpen ? 'flex' : 'none';
  if (UI.codexOpen) $('#codexInner').innerHTML = codexHtml();
  $('#rulesModal').style.display = UI.rulesOpen ? 'flex' : 'none';
  if (UI.rulesOpen) $('#rulesInner').innerHTML = rulesHtml();
  $('#log').innerHTML = G.logs.slice(-40).map(l => `<div>${l}</div>`).join('');
  $('#log').scrollTop = 999999;
}

/* ---------- 图鉴与规则 ---------- */
function codexHtml() {
  const units = [...new Set(Object.values(WAVES).map(w => w.unit))].sort((a, b) => UNIT_ORDER[a] - UNIT_ORDER[b]);
  return units.map(u => {
    const waves = Object.values(WAVES).filter(w => w.unit === u).sort((a, b) => a.idx - b.idx);
    const wavesHtml = waves.map(w => {
      const done = G.players[0].done.some(d => d.waveKey === w.key);
      const cards = w.ids.map(id => {
        const c = ALLCARDS.find(x => x.waveKey === w.key && x.idol === id);
        if (!c) return '';
        const held = G.players[0].hand.some(h => h.uid === c.uid);
        return cardImg(c, `codexcard${held ? ' held' : ''}`);
      }).join('');
      return `<div class="codexwave"><div class="codexhead">${done ? '✅ ' : ''}${w.size} 人套 · ${ENGINE.huScore(w.size)} 分${done ? ' · 已胡' : ''}</div><div class="payrow">${cards}</div></div>`;
    }).join('');
    return `<h4>${u}</h4>${wavesHtml}`;
  }).join('');
}
function rulesHtml() {
  const sizes = [...new Set(Object.values(WAVES).map(w => w.size))].sort((a, b) => a - b);
  const effects = Object.keys(ENGINE.UNIT_EFFECT).map(u => `<tr><td class="uname">${u}</td><td>${ENGINE.UNIT_EFFECT[u].name}</td><td>${ENGINE.UNIT_EFFECT[u].desc}</td></tr>`).join('');
  return `<h3>游戏规则</h3>
  <p><b>目标：</b>共 ${ENGINE.MAX_ROUND} 回合，收集“同组合 · 同轮次”的全部成员（胡牌）得分，终局总分最高者胜。</p>
  <p><b>每回合 2 行动点：</b></p>
  <ul><li>摸牌：从牌山摸 1 张（1 点）</li>
  <li>交换：点击明牌列 1 张 → 再点手牌 1 张，两张互换（1 点）</li>
  <li>弃牌发动：点击手牌 1 张 → 确认弃掉并发动组合效果（1 点，每回合一次）</li>
  <li>结束回合（0 点）</li></ul>
  <p><b>胡牌：</b>手牌集齐某轮次全部成员自动胡牌；胡后从牌山补 (人数 − 2) 张，2 人组不补。</p>
  <p><b>计分（本局牌池 ${ALLCARDS.length} 张）：</b>${sizes.map(k => k + ' 人套 ' + ENGINE.huScore(k) + ' 分').join('，')}。分值 ∝ 套内共处牌对数 C(k,2)。</p>
  <p><b>拍卖：</b>每轮结束举行整包竞拍，出价即支付的暗牌张数，价高者得；无人出价则整包进入明牌列。</p>
  <p><b>听牌提醒：</b>某组合只差 1 张成套时，手牌组员蓝色呼吸高亮，缺牌若在明牌列则粉色高亮。</p>
  <h4>组合效果（点击手牌 → 确认弃牌发动，1 行动点）</h4>
  <table class="ruletbl"><tr><th>组合</th><th>效果</th><th>说明</th></tr>${effects}</table>`;
}

/* ---------- 事件 ---------- */
document.addEventListener('click', async e => {
  if (e.target.classList && e.target.classList.contains('modal')) { UI.codexOpen = false; UI.rulesOpen = false; render(); return; }
  const t = e.target.closest('[data-uid],[data-act],[data-bid],[data-wave],[data-target],[data-panel]');
  if (!t) return;
  if (t.dataset.panel) { UI.codexOpen = t.dataset.panel === 'codex' ? !UI.codexOpen : false; UI.rulesOpen = t.dataset.panel === 'rules' ? !UI.rulesOpen : false; render(); return; }
  if (t.dataset.act === 'closePanel') { UI.codexOpen = false; UI.rulesOpen = false; render(); return; }
  /* 回合动作：按钮与点选解析为动作对象，交给引擎执行 */
  if (t.dataset.act === 'draw' && pendingActRes) { resolveAct({ type: 'draw' }); return; }
  if (t.dataset.act === 'pass' && pendingActRes) { resolveAct({ type: 'pass' }); return; }
  /* 弃牌发动确认（引擎调用 agent.askEffect 后弹出） */
  if (t.dataset.act === 'confirmDiscard' && UI.discardAsk) { const r = UI.discardAsk.res; UI.discardAsk = null; render(); if (r) r(true); return; }
  if (t.dataset.act === 'cancelDiscard' && UI.discardAsk) { const r = UI.discardAsk.res; UI.discardAsk = null; render(); if (r) r(false); return; }
  /* 选牌确认/取消（引擎调用 agent.chooseCards 后弹出） */
  if (t.dataset.act === 'confirmPay' && UI.pick) {
    if (UI.pick.exact ? UI.sel.size !== UI.pick.n : UI.sel.size < 1) return;
    const cards = [...UI.sel].map(uid => (UI.pick.side === 'hand' ? G.players[0].hand : G.display).find(c => c.uid === uid)).filter(Boolean);
    const r = UI.pick.res; UI.pick = null; UI.sel = new Set(); render(); if (r) r(cards); return;
  }
  if (t.dataset.act === 'cancelPick' && UI.pick) { const r = UI.pick.res; UI.pick = null; UI.sel = new Set(); render(); if (r) r(null); return; }
  if (t.dataset.act === 'cancelSwap' && UI.swap) { UI.swap = null; render(); return; }
  /* 出价 */
  if (t.dataset.bid && UI.bidAsk) { const r = UI.bidAsk.res; UI.bidAsk = null; render(); if (r) r(t.dataset.bid === 'yes'); return; }
  /* 多胡选择 */
  if (t.dataset.wave && UI.waveChoose) { const r = UI.waveChoose.res; UI.waveChoose = null; render(); if (r) r(t.dataset.wave); return; }
  /* 暗堆 / 牌山精选 / 查验 / 强制交换目标 */
  if (t.dataset.act === 'darkCancel' && UI.darkPick) { const r = UI.darkPick.res; UI.darkPick = null; render(); if (r) r(null); return; }
  if (t.dataset.uid && t.dataset.side === 'dark' && UI.darkPick) { const card = UI.darkPick.cards[Number(t.dataset.idx)]; if (!card) return; const r = UI.darkPick.res; UI.darkPick = null; render(); if (r) r(card); return; }
  if (t.dataset.uid && t.dataset.side === 'peek' && UI.peekPick) { const card = UI.peekPick.cards[Number(t.dataset.idx)]; if (!card) return; const r = UI.peekPick.res; UI.peekPick = null; render(); if (r) r(card); return; }
  if (t.dataset.act === 'spyClose' && UI.spyView) { const r = UI.spyView.res; UI.spyView = null; render(); if (r) r(); return; }
  if (t.dataset.act === 'targetCancel' && UI.forcedTarget) { const r = UI.forcedTarget.res; UI.forcedTarget = null; render(); if (r) r(null); return; }
  if (t.dataset.target && UI.forcedTarget) { const idx = Number(t.dataset.target); const r = UI.forcedTarget.res; UI.forcedTarget = null; render(); if (r) r(G.players[idx]); return; }
  /* 点明牌列：自己回合开始交换（或作为交换目标切换） */
  if (t.dataset.uid && !UI.pick && !UI.discardAsk && t.dataset.side === 'display' && myTurnActive()) { UI.swap = { idx: Number(t.dataset.idx) }; render(); return; }
  /* 交换中点手牌 → 完成交换动作 */
  if (t.dataset.uid && UI.swap && t.dataset.side === 'hand') {
    const idx = UI.swap.idx;
    UI.swap = null;
    resolveAct({ type: 'swap', displayIdx: idx, handIdx: Number(t.dataset.idx) });
    return;
  }
  /* 点手牌：自己回合 → 发动组合效果（引擎向 agent.askEffect 请求确认） */
  if (t.dataset.uid && !UI.pick && !UI.swap && !UI.discardAsk && t.dataset.side === 'hand' && myTurnActive()) {
    resolveAct({ type: 'effect', handIdx: Number(t.dataset.idx) });
    return;
  }
});

/* ---------- 图鉴/规则/音效/履历按钮 ---------- */
document.querySelectorAll('#helpBtns button').forEach(b => {
  b.addEventListener('click', () => { UI.codexOpen = b.dataset.panel === 'codex' ? !UI.codexOpen : false; UI.rulesOpen = b.dataset.panel === 'rules' ? !UI.rulesOpen : false; render(); });
});
$('#sfxBtn').addEventListener('click', () => { sfxOn = !sfxOn; $('#sfxBtn').textContent = sfxOn ? '🔊 音效:开' : '🔇 音效:关'; if (bgmEl) { if (sfxOn) bgmEl.play().catch(() => {}); else bgmEl.pause(); } });
$('#logBtn').addEventListener('click', () => { document.body.classList.toggle('logOpen'); });

/* ---------- 开局 ---------- */
function show(sel) { for (const id of ['#setupModal', '#scoreModal']) $(id).style.display = 'none'; if (sel) $(sel).style.display = 'flex'; }
function renderSetup() {
  $('#unitList').innerHTML = [...DATA].sort((a, b) => ENGINE.UNIT_SORT.indexOf(a.unit) - ENGINE.UNIT_SORT.indexOf(b.unit)).map(u => {
    const on = DEFAULT_UNITS.includes(u.unit) ? 'checked' : '';
    const waves = u.waves.filter(w => Object.keys(w).length).length;
    return `<label class="unitopt"><input type="checkbox" data-unit="${u.unit}" ${on}> ${u.unit}（${u.idols.length} 人 / ${waves} 轮次）</label>`;
  }).join('');
}
function showScore(result) {
  $('#scoreTitle').textContent = result.exhausted ? '牌尽流局' : '结算';
  $('#scoreBody').innerHTML = G.players.map(p => `<tr><td>${p.name}</td><td><b>${p.score}</b></td><td>${p.done.map(d => waveMini(d.waveKey)).join(' ')}</td></tr>`).join('');
  show('#scoreModal');
}
function startGame(units, aiCount, wavesPerUnit) {
  const names = ['你']; for (let i = 1; i <= aiCount; i++) names.push('对手' + i);
  const aiFlags = [false]; for (let i = 1; i <= aiCount; i++) aiFlags.push(true);
  const agents = names.map((n, i) => aiFlags[i] ? ENGINE.aiAgent() : uiAgent);
  const game = ENGINE.createGame({
    DATA, units, wavesPerUnit, seed: seed + Date.now() % 100000,
    playerNames: names, aiFlags, agents,
    quick: false,
    onUpdate: render,
    onEvent: ev => {
      if (ev.type === 'sfx') sfx(ev.name);
      else if (ev.type === 'hu') playUnitTrack(ev.unit);
      else if (ev.type === 'banner') UI.banner = ev.kind ? { ...ev } : null;
      else if (ev.type === 'spyShow') { UI.spyView = { hand: ev.hand, name: ev.name, res: null }; setTimeout(() => { UI.spyView = null; render(); }, 1800); }
      render();
    },
    onDeal: dealIn,
  });
  G = game.G; WAVES = game.WAVES; ALLCARDS = game.ALLCARDS; UNIT_ORDER = game.UNIT_ORDER;
  window.G = G;
  game.done.then(result => showScore(result));
  render();
}
$('#startBtn').addEventListener('click', () => {
  ac(); initBgm();
  const units = [...document.querySelectorAll('input[data-unit]:checked')].map(x => x.dataset.unit);
  if (units.length < 2) { alert('至少选择 2 个组合'); return; }
  const aiCount = Number(document.querySelector('input[name=ai]:checked').value);
  const wavesPerUnit = Number(document.querySelector('input[name=wpu]:checked').value) || 0;
  show(''); startGame(units, aiCount, wavesPerUnit);
});

if (AUTO) {
  show(''); sfxOn = false;
  const names = ['AI甲', 'AI乙', 'AI丙', 'AI丁'];
  const agents = names.map(() => ENGINE.aiAgent());
  const units = DATA.map(u => u.unit);
  const game = ENGINE.createGame({
    DATA, units, wavesPerUnit: 3, seed, playerNames: names,
    aiFlags: names.map(() => true), agents, quick: true,
    onUpdate: render, onEvent: () => {}, onDeal: () => {},
  });
  G = game.G; WAVES = game.WAVES; ALLCARDS = game.ALLCARDS; UNIT_ORDER = game.UNIT_ORDER; window.G = G;
  game.done.then(result => { window.__result = result; document.title = 'AUTO_DONE'; }).catch(err => { window.__result = { error: String(err) }; document.title = 'AUTO_ERROR'; });
  render();
} else {
  renderSetup(); show('#setupModal');
}
