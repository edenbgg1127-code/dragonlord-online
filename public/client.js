/* ============================================================
   龍領主 Online — 前端客戶端 v3
   （有機地形迷宮、立體奇觀、技能圈、自動攻擊、中崙學園）
   ============================================================ */
'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const cv = $('#game'), ctx = cv.getContext('2d');
let W = innerWidth, H = innerHeight;
let viewScale = 1, VW = W, VH = H;   // 小螢幕自動拉遠鏡頭，看到更多地圖
function resize() {
  W = innerWidth; H = innerHeight; cv.width = W; cv.height = H;
  viewScale = Math.max(0.5, Math.min(1, Math.min(W, H) / 720));
  VW = W / viewScale; VH = H / viewScale;
}
addEventListener('resize', resize); resize();

const TIER_COLORS = ['#9fa6b2', '#8a99ad', '#a9c7d8', '#8f5fc0', '#5ecfbb', '#ff6b45'];
const QCOLOR = (q) => q === 6 ? '#ffffff' : GAME.QUALITIES[q].color;

/* ---------------- 圖片 ---------------- */
const SPRITES = {};
['warrior', 'archer', 'assassin', 'slime', 'goblin', 'bat', 'spider', 'imp', 'skeleton', 'golem', 'cultist', 'dragon']
  .forEach((n) => { const i = new Image(); i.src = 'sprites/' + n + '.png'; SPRITES[n] = i; });

/* ---------------- 音效 ---------------- */
let AC = null;
function ac() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); return AC; }
function tone(f, dur, type = 'square', vol = 0.12, slide = 0) {
  try {
    const a = ac(), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = f;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), a.currentTime + dur);
    g.gain.value = vol; g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  } catch (e) {}
}
function noise(dur, vol = 0.2) {
  try {
    const a = ac(), n = a.sampleRate * dur, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource(), g = a.createGain();
    g.gain.value = vol; s.buffer = buf; s.connect(g); g.connect(a.destination); s.start();
  } catch (e) {}
}
const SND = {
  hit: () => { tone(90, .1, 'square', .15, -40); noise(.06, .12); },
  crit: () => { tone(70, .16, 'sawtooth', .2, -30); noise(.1, .2); },
  swing: () => noise(.07, .06),
  shoot: () => tone(700, .08, 'sine', .06, -500),
  coin: () => { tone(1100, .07, 'square', .06); setTimeout(() => tone(1500, .09, 'square', .06), 60); },
  level: () => [440, 550, 660, 880].forEach((f, i) => setTimeout(() => tone(f, .18, 'triangle', .12), i * 90)),
  enhOk: () => [520, 660, 880].forEach((f, i) => setTimeout(() => tone(f, .15, 'triangle', .14), i * 80)),
  enhFail: () => [330, 250, 180].forEach((f, i) => setTimeout(() => tone(f, .2, 'sawtooth', .1), i * 100)),
  pick: () => tone(900, .09, 'sine', .08, 300),
  heal: () => tone(500, .25, 'sine', .1, 250),
  die: () => tone(150, .5, 'sawtooth', .15, -100),
  hurt: () => tone(140, .12, 'square', .12, -60),
  skill: () => { tone(300, .15, 'sawtooth', .1, 300); noise(.1, .1); },
  boom: () => { tone(60, .4, 'sawtooth', .22, -30); noise(.25, .25); },
  key: () => [660, 880, 1320].forEach((f, i) => setTimeout(() => tone(f, .2, 'triangle', .12), i * 110))
};

/* ============================================================
   裝備外觀系統（程式繪製，階級越高越華麗）
   ============================================================ */
const GEAR_PAL = [
  { main: '#9aa3ad', dark: '#5a6169', light: '#dbe1e8', gem: '#c8ced6', trim: '#787f88' }, // 新手
  { main: '#8fa4b2', dark: '#4a5a66', light: '#d6e6f0', gem: '#69b7d9', trim: '#6a8393' }, // 岩石
  { main: '#8098bb', dark: '#3d4e6b', light: '#d3e2f7', gem: '#5aa0e0', trim: '#5c7396' }, // 精鋼
  { main: '#5b4c80', dark: '#281e3d', light: '#b298e2', gem: '#b26eff', trim: '#3e3160' }, // 黑暗
  { main: '#4ec3b1', dark: '#1f6a60', light: '#aef3e7', gem: '#8ff5df', trim: '#2d8d80' }, // 秘銀
  { main: '#e0692f', dark: '#7a2a10', light: '#ffc98a', gem: '#ffd24a', trim: '#b8451c' }  // 龍神
];
const tierOf = (item) => GAME.GEAR_TIERS[item.tier].tier;

function withGlow(g, col, blur, fn) {
  g.save(); g.shadowColor = col; g.shadowBlur = blur; fn(); g.restore();
}
/* 每個部位的向量造型，畫在 64×64 的座標系中 */
function paintGear(g, slot, tier, q, plus, cls) {
  const P = GEAR_PAL[tier];
  const fancy = tier >= 3, epic = tier >= 4, legend = tier >= 5;
  const grad = (x0, y0, x1, y1) => {
    const lg = g.createLinearGradient(x0, y0, x1, y1);
    lg.addColorStop(0, P.light); lg.addColorStop(0.45, P.main); lg.addColorStop(1, P.dark);
    return lg;
  };
  g.lineJoin = 'round'; g.lineCap = 'round';
  const outline = () => { g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 2; g.stroke(); };

  if (slot === 'weapon') {
    if (cls === 'archer') {                                   // 弓
      g.strokeStyle = P.dark; g.lineWidth = 7;
      g.beginPath(); g.arc(38, 32, 22, -2.1, 2.1); g.stroke();
      g.strokeStyle = P.main; g.lineWidth = 4;
      g.beginPath(); g.arc(38, 32, 22, -2.1, 2.1); g.stroke();
      if (fancy) {                                            // 弓翼裝飾
        g.fillStyle = P.trim;
        g.beginPath(); g.moveTo(24, 12); g.lineTo(14, 6); g.lineTo(20, 18); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(24, 52); g.lineTo(14, 58); g.lineTo(20, 46); g.closePath(); g.fill();
      }
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(28, 11); g.lineTo(20, 32); g.lineTo(28, 53); g.stroke();
      if (epic) withGlow(g, P.gem, 12, () => {                 // 能量箭
        g.strokeStyle = P.gem; g.lineWidth = 3;
        g.beginPath(); g.moveTo(18, 32); g.lineTo(52, 32); g.stroke();
        g.fillStyle = P.gem; g.beginPath(); g.moveTo(56, 32); g.lineTo(48, 27); g.lineTo(48, 37); g.closePath(); g.fill();
      });
    } else if (cls === 'assassin') {                          // 匕首
      g.fillStyle = '#33383f'; g.fillRect(16, 40, 8, 14);      // 握把
      g.fillStyle = P.trim; g.fillRect(12, 36, 16, 6);         // 護手
      g.fillStyle = grad(24, 34, 52, 10);
      g.beginPath();
      g.moveTo(20, 36); g.lineTo(46, 10); g.lineTo(54, 8); g.lineTo(50, 16); g.lineTo(26, 42);
      g.closePath(); g.fill(); outline();
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(24, 36); g.lineTo(47, 13); g.stroke();
      if (fancy) { g.fillStyle = P.gem; g.beginPath(); g.arc(20, 39, 3.4, 0, TAU); g.fill(); }
      if (epic) withGlow(g, P.gem, 14, () => {
        g.strokeStyle = P.gem; g.lineWidth = 2;
        g.beginPath(); g.moveTo(22, 34); g.lineTo(48, 10); g.stroke();
      });
    } else {                                                   // 劍
      g.fillStyle = '#4a3520'; g.fillRect(28, 44, 8, 14);      // 握把
      g.fillStyle = P.trim;
      g.beginPath(); g.moveTo(16, 42); g.lineTo(48, 42); g.lineTo(44, 48); g.lineTo(20, 48); g.closePath(); g.fill();
      if (fancy) {                                             // 華麗護手翼
        g.beginPath(); g.moveTo(16, 42); g.lineTo(8, 34); g.lineTo(20, 40); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(48, 42); g.lineTo(56, 34); g.lineTo(44, 40); g.closePath(); g.fill();
      }
      g.fillStyle = grad(24, 42, 40, 6);
      g.beginPath();
      g.moveTo(26, 42); g.lineTo(28, 12); g.lineTo(32, 4); g.lineTo(36, 12); g.lineTo(38, 42);
      g.closePath(); g.fill(); outline();
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(32, 40); g.lineTo(32, 9); g.stroke();
      g.fillStyle = P.gem; g.beginPath(); g.arc(32, 52, 4.2, 0, TAU); g.fill();
      if (legend) withGlow(g, P.gem, 16, () => {
        g.fillStyle = P.gem;
        g.beginPath(); g.moveTo(32, 2); g.lineTo(36, 12); g.lineTo(32, 9); g.lineTo(28, 12); g.closePath(); g.fill();
      });
    }
  } else if (slot === 'helmet') {
    g.fillStyle = grad(18, 14, 46, 50);
    g.beginPath();
    g.moveTo(16, 44); g.quadraticCurveTo(16, 12, 32, 12); g.quadraticCurveTo(48, 12, 48, 44);
    g.lineTo(42, 44); g.lineTo(42, 30); g.lineTo(22, 30); g.lineTo(22, 44);
    g.closePath(); g.fill(); outline();
    g.fillStyle = P.dark; g.fillRect(22, 30, 20, 8);            // 面罩縫
    g.fillStyle = P.trim; g.fillRect(30, 14, 4, 22);            // 鼻樑
    if (fancy) {                                                // 角
      g.fillStyle = P.trim;
      g.beginPath(); g.moveTo(18, 22); g.quadraticCurveTo(4, 12, 8, 2); g.quadraticCurveTo(16, 12, 22, 18); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(46, 22); g.quadraticCurveTo(60, 12, 56, 2); g.quadraticCurveTo(48, 12, 42, 18); g.closePath(); g.fill();
    }
    if (epic) withGlow(g, P.gem, 12, () => { g.fillStyle = P.gem; g.beginPath(); g.arc(32, 20, 4, 0, TAU); g.fill(); });
  } else if (slot === 'chest') {
    g.fillStyle = grad(16, 12, 48, 54);
    g.beginPath();
    g.moveTo(22, 14); g.lineTo(42, 14); g.lineTo(48, 22); g.lineTo(46, 52); g.lineTo(18, 52); g.lineTo(16, 22);
    g.closePath(); g.fill(); outline();
    g.fillStyle = P.trim;                                       // 肩甲
    g.beginPath(); g.ellipse(16, 20, 10, 7, -0.3, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(48, 20, 10, 7, 0.3, 0, TAU); g.fill();
    g.strokeStyle = P.dark; g.lineWidth = 2;
    g.beginPath(); g.moveTo(32, 16); g.lineTo(32, 50); g.stroke();
    if (fancy) { g.fillStyle = P.gem; g.beginPath(); g.arc(32, 28, 5, 0, TAU); g.fill(); }
    if (legend) withGlow(g, P.gem, 14, () => {                  // 龍鱗紋
      g.strokeStyle = P.gem; g.lineWidth = 1.6;
      for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < 3; c2++) {
        g.beginPath(); g.arc(24 + c2 * 8, 36 + r * 6, 4, 0.2, Math.PI - 0.2); g.stroke();
      }
    });
  } else if (slot === 'legs') {
    g.fillStyle = grad(18, 12, 46, 56);
    g.beginPath();
    g.moveTo(18, 10); g.lineTo(46, 10); g.lineTo(44, 30); g.lineTo(38, 54); g.lineTo(30, 54);
    g.lineTo(32, 32); g.lineTo(26, 54); g.lineTo(18, 54); g.lineTo(20, 30);
    g.closePath(); g.fill(); outline();
    g.fillStyle = P.trim; g.fillRect(18, 10, 28, 6);
    if (fancy) { g.fillStyle = P.gem; g.beginPath(); g.arc(24, 22, 3.2, 0, TAU); g.fill(); g.beginPath(); g.arc(40, 22, 3.2, 0, TAU); g.fill(); }
  } else if (slot === 'boots') {
    g.fillStyle = grad(16, 14, 48, 52);
    g.beginPath();
    g.moveTo(20, 12); g.lineTo(34, 12); g.lineTo(34, 38); g.lineTo(50, 42); g.lineTo(50, 52); g.lineTo(20, 52);
    g.closePath(); g.fill(); outline();
    g.fillStyle = P.trim; g.fillRect(18, 12, 18, 6);
    g.fillStyle = P.dark; g.fillRect(18, 48, 34, 5);
    if (fancy) {                                                 // 脛甲翼
      g.fillStyle = P.trim;
      g.beginPath(); g.moveTo(20, 24); g.lineTo(8, 20); g.lineTo(20, 32); g.closePath(); g.fill();
    }
    if (epic) withGlow(g, P.gem, 10, () => { g.fillStyle = P.gem; g.fillRect(24, 24, 6, 6); });
  } else if (slot === 'cape') {
    g.fillStyle = grad(14, 8, 50, 56);
    g.beginPath();
    g.moveTo(24, 10); g.lineTo(40, 10); g.quadraticCurveTo(54, 30, 48, 56);
    g.lineTo(40, 46); g.lineTo(32, 56); g.lineTo(24, 46); g.lineTo(16, 56);
    g.quadraticCurveTo(10, 30, 24, 10);
    g.closePath(); g.fill(); outline();
    g.fillStyle = P.trim;                                        // 領扣
    g.beginPath(); g.moveTo(22, 12); g.lineTo(42, 12); g.lineTo(38, 18); g.lineTo(26, 18); g.closePath(); g.fill();
    if (fancy) { g.fillStyle = P.gem; g.beginPath(); g.arc(32, 15, 3.6, 0, TAU); g.fill(); }
    if (legend) withGlow(g, P.gem, 14, () => {
      g.strokeStyle = P.gem; g.lineWidth = 2;
      g.beginPath(); g.moveTo(20, 30); g.quadraticCurveTo(32, 40, 44, 30); g.stroke();
    });
  }
  // 品質光暈（紫以上）
  if (q >= 3) {
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = q >= 6 ? 0.22 : 0.13 + (q - 3) * 0.04;
    g.fillStyle = q === 6 ? '#ffffff' : GAME.QUALITIES[q].color;
    g.fillRect(0, 0, 64, 64);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
}
const dropImgCache = {};
function dropIcon(d) {                       // 地上掉落物的圖示
  const key = [d.tier, d.slot, d.q, d.plus, d.cls || 'warrior'].join('_');
  if (!dropImgCache[key]) {
    const im = new Image();
    im.src = gearIconURL({ tier: d.tier, slot: d.slot, q: d.q, plus: d.plus, cls: d.cls }, 'warrior');
    dropImgCache[key] = im;
  }
  return dropImgCache[key];
}
const iconCache = {};
function gearIconURL(item, fallbackCls) {
  const cls = item.cls || fallbackCls || 'warrior';
  const key = [item.tier, item.slot, item.q, Math.min(item.plus, 10), cls].join('_');
  if (iconCache[key]) return iconCache[key];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  paintGear(g, item.slot, tierOf(item), item.q, item.plus, cls);
  if (item.plus >= 7) {                                          // 高強化外光
    g.save(); g.globalCompositeOperation = 'destination-over';
    g.shadowColor = '#ffd76e'; g.shadowBlur = 16;
    g.fillStyle = '#ffd76e55'; g.fillRect(6, 6, 52, 52); g.restore();
  }
  const url = c.toDataURL();
  iconCache[key] = url;
  return url;
}
/* 職業說明文字 */
function gearClassText(item) {
  if (item.slot !== 'weapon') return { text: '全職業可裝備', ok: true };
  const ok = item.cls === myCls;
  return { text: '限定職業：' + GAME.CLASSES[item.cls].name, ok };
}

/* ---------------- 網路 ---------------- */
let ws = null, myId = null, myCls = null, myName = null, mapId = 0;
let me = { x: 0, y: 0, dir: 1, snapped: false, idx: 0, idy: 0 };
let meData = null;
let stPrev = null, stCur = null, stPrevAt = 0, stCurAt = 0;
let dead = false;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host);
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    $('#auth-err').textContent = '與伺服器斷線，請重新整理頁面';
    setTimeout(() => location.reload(), 2500);
  };
}
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

/* ---------------- 訊息 ---------------- */
const anns = $('#announce'), msgs = $('#msgs');
function announce(msg, ms = 5000) {
  const d = document.createElement('div'); d.className = 'ann'; d.textContent = msg;
  anns.appendChild(d); setTimeout(() => d.remove(), ms);
}
function toast(msg, ms = 4000) {
  const d = document.createElement('div'); d.className = 'm'; d.textContent = msg;
  msgs.appendChild(d); while (msgs.children.length > 6) msgs.firstChild.remove();
  setTimeout(() => d.remove(), ms);
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function handle(m) {
  switch (m.t) {
    case 'auth':
      if (!m.ok) { $('#auth-err').textContent = m.msg; return; }
      showCharScreen(m.chars || []);
      break;
    case 'charErr': $('#char-err').textContent = m.msg; break;
    case 'enter':
      myId = m.you; myCls = m.cls; myName = m.name; mapId = m.mapId;
      me.snapped = false;
      prerenderMap(mapId);
      setupSkillbar();
      $('#screen-login').classList.add('hidden');
      $('#screen-char').classList.add('hidden');
      $('#hud').classList.remove('hidden');
      $('#zone').textContent = GAME.MAPS[mapId].name;
      break;
    case 'map':
      mapId = m.mapId; me.snapped = false; stPrev = stCur = null;
      prerenderMap(mapId);
      $('#zone').textContent = GAME.MAPS[mapId].name;
      announce('進入 ' + GAME.MAPS[mapId].name);
      break;
    case 'state':
      stPrev = stCur; stPrevAt = stCurAt;
      stCur = m; stCurAt = performance.now();
      break;
    case 'me':
      meData = m;
      if (m.dead && !dead) { dead = true; $('#deathview').classList.remove('hidden'); SND.die(); }
      if (!m.dead) { dead = false; $('#deathview').classList.add('hidden'); }
      updateHUD();
      if (!$('#bag').classList.contains('hidden')) renderBag();
      if (!$('#smith').classList.contains('hidden')) renderSmith();
      break;
    case 'ev': handleEvent(m); break;
    case 'msg':
      toast(m.msg);
      if (m.msg.startsWith('🔑')) SND.key();
      break;
    case 'loot': toast('💰 +' + m.gold.toLocaleString() + ' 金幣'); SND.coin(); break;
    case 'memento': announce('🏅 獲得首殺紀念道具【' + m.name + '】！已放入背包'); SND.level(); break;
    case 'announce': announce(m.msg); break;
    case 'chat': {
      const d = document.createElement('div'); d.className = 'c';
      d.innerHTML = '<b>' + esc(m.name) + '</b>：' + esc(m.msg);
      const log = $('#chatlog'); log.appendChild(d);
      while (log.children.length > 8) log.firstChild.remove();
      setTimeout(() => d.remove(), 15000);
      break;
    }
    case 'dead': dead = true; $('#deathview').classList.remove('hidden'); SND.die(); break;
    case 'enhance': {
      const fx = $('#enhfx');
      if (m.ok) { fx.textContent = '✨ 強化成功！【' + m.name + '】 → +' + m.plus; fx.style.color = '#8fd98f'; SND.enhOk(); }
      else { fx.textContent = '💥 強化失敗…【' + m.name + '】 → +' + m.plus; fx.style.color = '#ff8a80'; SND.enhFail(); shake(8); }
      break;
    }
  }
}

/* ---------------- 特效 ---------------- */
let effects = [], shakeAmt = 0;
const mobFlash = {};
function shake(n) { shakeAmt = Math.max(shakeAmt, n); }
function holderPos(id) {
  if (id === myId) return { x: me.x, y: me.y };
  const p = stCur && stCur.players.find((q) => q.id === id);
  if (!p) return null;
  return { x: p._x !== undefined ? p._x : p.x, y: p._y !== undefined ? p._y : p.y };
}
function spawnParticles(src, n, col, life) {
  const t = performance.now();
  const base = src.id ? holderPos(src.id) : src;
  if (!base) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 260;
    effects.push({
      type: 'part', x: base.x, y: base.y - 22,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 60,
      col, life: life || 300, t0: t, sz: 2 + Math.random() * 3
    });
  }
}
function handleEvent(m) {
  const t = performance.now();
  switch (m.kind) {
    case 'dmg':
      effects.push({ type: 'num', x: m.x + (Math.random() * 30 - 15), y: m.y, val: m.val, crit: m.crit, ply: m.ply, t0: t });
      if (m.mob) mobFlash[m.mob] = t;
      if (m.ply) markCombat(m.ply);
      if (m.ply === myId) { shake(7); SND.hurt(); } else SND[m.crit ? 'crit' : 'hit']();
      break;
    case 'atk':
      if (m.id !== myId) {
        effects.push({ type: 'slash', id: m.id, ang: m.ang, cls: m.cls, t0: t });
        startSwing(m.id, m.ang);
      }
      break;
    case 'die':
      effects.push({ type: 'puff', x: m.x, y: m.y, t0: t, big: !!GAME.MOBS[m.kind].boss });
      if (GAME.MOBS[m.kind].boss) shake(12);
      break;
    case 'pdie': effects.push({ type: 'puff', x: m.x, y: m.y, t0: t, big: true }); break;
    case 'levelup':
      effects.push({ type: 'ring', x: m.x, y: m.y, t0: t, id: m.id });
      if (m.id === myId) { announce('🎉 升級！你現在是 ' + m.lvl + ' 級'); SND.level(); }
      break;
    case 'heal': effects.push({ type: 'heal', id: m.id, t0: t }); if (m.id === myId) SND.heal(); break;
    case 'pick': effects.push({ type: 'spark', x: m.x, y: m.y, t0: t }); SND.pick(); break;
    case 'chestOpen': break;
    case 'whirl':
      markCombat(m.id);
      effects.push({ type: 'whirl', id: m.id, r: m.r, t0: t });
      effects.push({ type: 'shock', id: m.id, r: m.r, t0: t, col: '#ffe27a' });
      spawnParticles(m, 22, '#ffd76e', 260);
      if (m.id === myId) shake(9);
      SND.skill(); break;
    case 'dash':
      markCombat(m.id);
      effects.push({ type: 'trail', x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, t0: t, col: '#ffd76e' });
      effects.push({ type: 'ghost', id: m.id, x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, t0: t, col: '#ffd76e' });
      effects.push({ type: 'shock', x: m.x1, y: m.y1, r: 120, t0: t, col: '#ffb35a' });
      if (m.id === myId) shake(10);
      SND.skill(); break;
    case 'blink':
      markCombat(m.id);
      effects.push({ type: 'trail', x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, t0: t, col: '#b58aff' });
      effects.push({ type: 'ghost', id: m.id, x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, t0: t, col: '#b58aff' });
      effects.push({ type: 'shock', x: m.x1, y: m.y1, r: 110, t0: t, col: '#c9a2ff' });
      effects.push({ type: 'crossfx', x: m.x1, y: m.y1, t0: t, col: '#e0c8ff' });
      if (m.id === myId) shake(8);
      SND.skill(); break;
    case 'cone':
      markCombat(m.id);
      effects.push({ type: 'cone', id: m.id, ang: m.ang, r: m.r, t0: t });
      effects.push({ type: 'poisoncloud', id: m.id, ang: m.ang, r: m.r, t0: t });
      SND.skill(); break;
    case 'boom':
      effects.push({ type: 'boomfx', x: m.x, y: m.y, r: m.r, t0: t });
      effects.push({ type: 'shock', x: m.x, y: m.y, r: m.r * 1.5, t0: t, col: '#ffca6e' });
      effects.push({ type: 'flash', t0: t, col: '255,180,90' });
      spawnParticles({ x: m.x, y: m.y }, 26, '#ff9a2a', 340);
      SND.boom(); shake(14); break;
  }
}

/* ---------------- 登入 / 選角 ---------------- */
let regMode = false, selCls = null;
$('#tab-login').onclick = () => { regMode = false; $('#tab-login').classList.add('on'); $('#tab-reg').classList.remove('on'); $('#btn-auth').textContent = '登入'; };
$('#tab-reg').onclick = () => { regMode = true; $('#tab-reg').classList.add('on'); $('#tab-login').classList.remove('on'); $('#btn-auth').textContent = '註冊並登入'; };
$('#btn-auth').onclick = () => { ac(); send({ t: regMode ? 'register' : 'login', u: $('#in-user').value, p: $('#in-pass').value }); };
$('#btn-guest').onclick = () => { ac(); send({ t: 'guest' }); };
$$('.cls').forEach((el) => el.onclick = () => {
  $$('.cls').forEach((x) => x.classList.remove('on'));
  el.classList.add('on'); selCls = el.dataset.cls;
});
$('#btn-create').onclick = () => {
  if (!selCls) { $('#char-err').textContent = '請先選擇職業'; return; }
  send({ t: 'createChar', cls: selCls, name: $('#in-charname').value });
};
function showCharScreen(chars) {
  $('#screen-login').classList.add('hidden');
  $('#screen-char').classList.remove('hidden');
  const list = $('#charlist'); list.innerHTML = '';
  chars.forEach((c, i) => {
    const d = document.createElement('div'); d.className = 'charrow';
    d.innerHTML = `<img src="sprites/${GAME.CLASSES[c.cls].sprite}.png"><div><b>${esc(c.name)}</b>
      <div style="font-size:12px;color:#9aa">${GAME.CLASSES[c.cls].name}．Lv.${c.lvl}</div></div>
      <div style="margin-left:auto;color:var(--gold)">進入 ▶</div>`;
    d.onclick = () => send({ t: 'pickChar', i });
    list.appendChild(d);
  });
}

/* ---------------- 輸入 ---------------- */
const keys = {};
let mouse = { x: 0, y: 0 };
let lastAtkSent = 0;
let camX = 0, camY = 0;

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter' && e.target.id === 'chatin') {
      const v = e.target.value.trim();
      if (v) send({ t: 'chat', msg: v });
      e.target.value = ''; e.target.style.display = 'none'; e.target.blur();
    }
    return;
  }
  keys[e.key.toLowerCase()] = true;
  const k = e.key.toLowerCase();
  if (k === 'b') togglePanel('bag');
  if (k === 'q') castSkill(0, true);
  if (k === 'e') castSkill(1, true);
  if (k === 'r') usePotion();
  if (k === 'f') doInteract();
  if (k === 'enter') { const c = $('#chatin'); c.style.display = 'block'; c.focus(); }
  if (k === 'escape') ['bag', 'shop', 'gearshop', 'smith', 'help'].forEach((p) => $('#' + p).classList.add('hidden'));
  if (k === ' ') { e.preventDefault(); tryAttack(aimAtNearest() || (me.dir > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 })); }
  sendMove();
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; sendMove(); });
cv.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', (e) => {
  ac();
  if (!myId || dead) return;
  const wx = camX + e.clientX / viewScale, wy = camY + e.clientY / viewScale;
  if (stCur) for (const d of stCur.drops) {
    if ((d.x - wx) ** 2 + (d.y - wy) ** 2 < 45 * 45) { send({ t: 'pickup' }); return; }
  }
  tryAttack({ x: wx - me.x, y: wy - me.y });
});

let moveSent = '';
function sendMove(adx, ady) {
  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup']) dy -= 1;
  if (keys['s'] || keys['arrowdown']) dy += 1;
  if (keys['a'] || keys['arrowleft']) dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;
  if (!dx && !dy && typeof joy !== 'undefined' && joy.active) { dx = joy.vx; dy = joy.vy; }
  if (!dx && !dy && typeof touchDir !== 'undefined') {   // 桌機點方向鍵
    dx = (touchDir.right ? 1 : 0) - (touchDir.left ? 1 : 0);
    dy = (touchDir.down ? 1 : 0) - (touchDir.up ? 1 : 0);
  }
  if (!dx && !dy && adx !== undefined) { dx = adx; dy = ady; }
  const sig = dx.toFixed(2) + ',' + dy.toFixed(2);
  if (sig !== moveSent) { moveSent = sig; send({ t: 'move', dx, dy }); }
  me.idx = dx; me.idy = dy;
}
setInterval(() => sendMove(autoVec.x, autoVec.y), 400);

function tryAttack(aim) {
  if (!myCls || dead || !aim) return;
  const c = GAME.CLASSES[myCls];
  const t = performance.now();
  if (t - lastAtkSent < c.atkCd) return;
  lastAtkSent = t;
  send({ t: 'atk', ax: aim.x, ay: aim.y });
  const ang = Math.atan2(aim.y, aim.x);
  me.dir = aim.x >= 0 ? 1 : -1;
  effects.push({ type: 'slash', id: myId, ang, cls: myCls, t0: t });
  startSwing(myId, ang);
  if (myCls === 'archer') SND.shoot(); else SND.swing();
}
function usePotion() {
  if (meData && meData.potions > 0 && meData.potionCd <= 0) send({ t: 'potion' });
}
function nearestEnemy(maxD) {
  if (!stCur) return null;
  let best = null, bd = (maxD || 700) ** 2;
  const ok = (x, y) => GAME.hasLOS(mapId, me.x, me.y, x, y);   // 隔牆的目標不鎖定
  for (const mb of stCur.mobs) {
    const dd = (mb.x - me.x) ** 2 + (mb.y - me.y) ** 2;
    if (dd < bd && ok(mb.x, mb.y)) { bd = dd; best = mb; }
  }
  for (const g of stCur.guards) {
    const dd = (g.x - me.x) ** 2 + (g.y - me.y) ** 2;
    if (dd < bd && ok(g.x, g.y)) { bd = dd; best = g; }
  }
  return best;
}
function aimAtNearest() {
  const e = nearestEnemy(760);
  if (!e) return null;
  // 與伺服器一致：都用「腳底座標」算角度，近距離才不會歪掉（修正自動攻擊打空的問題）
  return { x: e.x - me.x, y: e.y - me.y };
}

/* ---------------- 技能 ---------------- */
function setupSkillbar() {
  const sks = GAME.SKILLS[myCls] || [];
  sks.forEach((sk, i) => {
    const el = $('#sk' + i);
    el.querySelector('.ic').textContent = sk.icon;
    el.querySelector('.nm').textContent = sk.name;
    el.title = `${sk.name}（${sk.key}）— ${sk.desc}`;
    el.onclick = () => castSkill(i, false);
  });
  $('#atkbtn').onclick = () => tryAttack(aimAtNearest() || { x: me.dir, y: 0 });
}
function castSkill(i, useMouse) {
  if (!meData || dead) return;
  if ((meData.skillCd || [])[i] > 0) return;
  let aim = aimAtNearest();
  if (useMouse) {
    const wx = camX + mouse.x / viewScale, wy = camY + mouse.y / viewScale;
    const mAim = { x: wx - me.x, y: wy - me.y };
    if (Math.hypot(mAim.x, mAim.y) > 40) aim = mAim;
  }
  if (!aim) aim = { x: me.dir, y: 0 };
  send({ t: 'skill', i, ax: aim.x, ay: aim.y });
  me.dir = aim.x >= 0 ? 1 : -1;
}

/* ---------------- 手機浮動虛擬搖桿（以手指落點為圓心） ---------------- */
const dpad = $('#dpad');
const touchDir = { up: 0, down: 0, left: 0, right: 0 };   // 桌機用方向鍵
const joy = { id: null, ox: 0, oy: 0, vx: 0, vy: 0, active: false };

function idlePos() {
  const m = 18;
  return { x: m + dpad.offsetWidth / 2, y: innerHeight - m - dpad.offsetHeight / 2 };
}
function placeDpad(x, y) { dpad.style.left = x + 'px'; dpad.style.top = y + 'px'; }
function resetDpad() {
  const p0 = idlePos();
  placeDpad(p0.x, p0.y);
  dpad.classList.remove('act');
  $$('#dpad .dk[data-dir]').forEach((k) => k.classList.remove('on'));
  dpad.style.setProperty('--tx', '0px'); dpad.style.setProperty('--ty', '0px');
}
addEventListener('resize', resetDpad);
setTimeout(resetDpad, 60);

function dpadVec() {
  if (joy.active && (joy.vx || joy.vy)) return { x: joy.vx, y: joy.vy };
  const dx = (touchDir.right ? 1 : 0) - (touchDir.left ? 1 : 0);
  const dy = (touchDir.down ? 1 : 0) - (touchDir.up ? 1 : 0);
  return (dx || dy) ? { x: dx, y: dy } : null;
}
function highlightDirs(vx, vy) {
  const on = { up: vy < -0.35, down: vy > 0.35, left: vx < -0.35, right: vx > 0.35 };
  $$('#dpad .dk[data-dir]').forEach((k) => k.classList.toggle('on', !!on[k.dataset.dir]));
}
function applyDpad() {
  const v = dpadVec();
  if (v) sendMove(v.x, v.y);
  else sendMove();
}
/* 判斷觸控是否落在搖桿感應區（左半螢幕下方，且不在按鈕上） */
function isJoyZone(t) {
  if (t.clientX > innerWidth * 0.52) return false;
  if (t.clientY < innerHeight * 0.30) return false;
  const el = document.elementFromPoint(t.clientX, t.clientY);
  if (el && el.closest('#combat,#actionbar,.panel,#helpbtn,#minimap,.screen,#chatbox')) return false;
  return true;
}
function joyStart(t) {
  joy.id = t.identifier; joy.ox = t.clientX; joy.oy = t.clientY;
  joy.vx = joy.vy = 0; joy.active = true;
  placeDpad(t.clientX, t.clientY);
  dpad.classList.add('act');
  highlightDirs(0, 0);
}
function joyMove(t) {
  const R = Math.max(34, dpad.offsetWidth * 0.42);
  let dx = t.clientX - joy.ox, dy = t.clientY - joy.oy;
  const len = Math.hypot(dx, dy);
  if (len < 14) { joy.vx = joy.vy = 0; highlightDirs(0, 0); dpad.style.setProperty('--tx', '0px'); dpad.style.setProperty('--ty', '0px'); applyDpad(); return; }
  const k = Math.min(1, len / R);
  joy.vx = (dx / len) * k; joy.vy = (dy / len) * k;
  // 拇指拉太遠時搖桿跟著移動（避免手指跑出感應範圍）
  if (len > R * 1.6) {
    joy.ox += dx - (dx / len) * R * 1.6;
    joy.oy += dy - (dy / len) * R * 1.6;
    placeDpad(joy.ox, joy.oy);
    dx = t.clientX - joy.ox; dy = t.clientY - joy.oy;
  }
  const cl = Math.min(len, R);
  dpad.style.setProperty('--tx', (dx / len) * cl + 'px');
  dpad.style.setProperty('--ty', (dy / len) * cl + 'px');
  highlightDirs(joy.vx, joy.vy);
  applyDpad();
}
function joyEnd() {
  joy.id = null; joy.active = false; joy.vx = joy.vy = 0;
  resetDpad(); applyDpad();
}
document.addEventListener('touchstart', (e) => {
  if (!myId) return;
  for (const t of e.changedTouches) {
    if (joy.id === null && isJoyZone(t)) { ac(); joyStart(t); e.preventDefault(); }
  }
}, { passive: false });
document.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) if (t.identifier === joy.id) { joyMove(t); e.preventDefault(); }
}, { passive: false });
['touchend', 'touchcancel'].forEach((evt) => document.addEventListener(evt, (e) => {
  for (const t of e.changedTouches) if (t.identifier === joy.id) joyEnd();
}, { passive: true }));

// 桌機也可用滑鼠按方向鍵
$$('#dpad .dk[data-dir]').forEach((k) => {
  k.addEventListener('mousedown', (e) => { e.preventDefault(); touchDir[k.dataset.dir] = 1; highlightDirs(
    (touchDir.right ? 1 : 0) - (touchDir.left ? 1 : 0), (touchDir.down ? 1 : 0) - (touchDir.up ? 1 : 0)); applyDpad(); });
});
addEventListener('mouseup', () => {
  if (touchDir.up || touchDir.down || touchDir.left || touchDir.right) {
    for (const k in touchDir) touchDir[k] = 0;
    highlightDirs(0, 0); applyDpad();
  }
});

/* 觸控攻擊：右半螢幕點擊＝朝該方向攻擊 */
cv.addEventListener('touchstart', (e) => {
  ac();
  if (!myId || dead || !e.touches.length) return;
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id || isJoyZone(t)) continue;      // 搖桿手指不觸發攻擊
    const wx = camX + t.clientX / viewScale, wy = camY + t.clientY / viewScale;
    if (stCur) {
      let picked = false;
      for (const d of stCur.drops) {
        if ((d.x - wx) ** 2 + (d.y - wy) ** 2 < 70 * 70) { send({ t: 'pickup' }); picked = true; break; }
      }
      if (picked) continue;
    }
    tryAttack({ x: wx - me.x, y: wy - me.y });
  }
}, { passive: true });
// 技能／按鈕觸控即時回饋
['sk0', 'sk1', 'atkbtn'].forEach((id) => {
  const el = $('#' + id);
  el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); ac(); el.click(); }, { passive: false });
});
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => { if (e.target === cv || dpad.contains(e.target)) e.preventDefault(); });

/* ---------------- 自動攻擊 ---------------- */
let auto = false, autoVec = { x: undefined, y: undefined };
$('#autobtn').onclick = () => {
  auto = !auto;
  $('#autobtn').classList.toggle('on', auto);
  if (!auto) { autoVec = { x: undefined, y: undefined }; sendMove(); }
};
setInterval(() => {
  if (!auto || !myId || dead || !stCur) return;
  const manual = keys['w'] || keys['a'] || keys['s'] || keys['d'] || keys['arrowup'] || keys['arrowdown'] || keys['arrowleft'] || keys['arrowright'] || !!dpadVec();
  const c = GAME.CLASSES[myCls];
  const e = nearestEnemy(820);
  if (!e) { autoVec = { x: 0, y: 0 }; if (!manual) sendMove(0, 0); return; }
  const d = Math.hypot(e.x - me.x, e.y - me.y);
  const reach = (c.range >= 200 ? c.range * 0.85 : c.range + (e.kind ? GAME.MOBS[e.kind].size * 0.7 : 20));
  if (d <= reach) {
    autoVec = { x: 0, y: 0 };
    if (!manual) sendMove(0, 0);
    tryAttack({ x: e.x - me.x, y: e.y - me.y });
  } else if (!manual) {
    autoVec = { x: (e.x - me.x) / d, y: (e.y - me.y) / d };
    sendMove(autoVec.x, autoVec.y);
  }
}, 250);

/* ---------------- 互動偵測 ---------------- */
let interact = null;
function findInteract() {
  interact = null;
  if (!myId || dead) { $('#hint').classList.add('hidden'); return; }
  const md = GAME.MAPS[mapId];
  const near = (x, y, r) => (me.x - x) ** 2 + (me.y - y) ** 2 < r * r;
  if (stCur) for (const d of stCur.drops) {
    if (near(d.x, d.y, 90)) { interact = { type: 'pickup', label: '✋ 撿取【' + d.name + '】' }; break; }
  }
  if (!interact && mapId < 3) {
    for (const b of GAME.TOWN.buildings) {
      if (near(b.x, b.y, 170)) {
        interact = b.key === 'inn'
          ? { type: 'inn', label: `🛏 住宿旅店 — 休息一晚全滿血（${GAME.INN_PRICE} 金幣）` }
          : { type: b.key === 'gear' ? 'gearshop' : b.key, label: b.icon + ' ' + b.label };
        break;
      }
    }
  }
  if (!interact && md.portalNext && near(md.portalNext.x, md.portalNext.y, 170))
    interact = { type: 'portal', dir: 'next', label: '🌀 前往下一張地圖' };
  if (!interact && md.portalPrev && near(md.portalPrev.x, md.portalPrev.y, 170))
    interact = { type: 'portal', dir: 'prev', label: '🌀 返回上一張地圖' };
  if (!interact && md.centerPortal && near(md.centerPortal.x, md.centerPortal.y, 200))
    interact = { type: 'portal', dir: 'center', label: `🌋 ${md.centerPortal.name}（需 ${GAME.KEYS_NEEDED} 把${GAME.KEY_NAME}）` };
  if (!interact && stCur) for (const c of stCur.chests) {
    if (!c.open && near(c.x, c.y, 120)) { interact = { type: 'chest', id: c.id, label: '📦 開啟寶箱' }; break; }
  }
  const h = $('#hint');
  if (interact) { h.textContent = '按 F — ' + interact.label; h.classList.remove('hidden'); }
  else h.classList.add('hidden');
}
function doInteract() {
  if (!interact) { send({ t: 'pickup' }); return; }
  if (interact.type === 'pickup') send({ t: 'pickup' });
  else if (interact.type === 'chest') send({ t: 'chest', id: interact.id });
  else if (interact.type === 'portal') send({ t: 'portal', dir: interact.dir });
  else if (interact.type === 'inn') send({ t: 'buy', what: 'inn' });
  else togglePanel(interact.type, true);
}

/* ---------------- 面板 ---------------- */
function togglePanel(id, forceOpen) {
  const el = $('#' + id);
  const open = el.classList.contains('hidden');
  if (!open && !forceOpen) { el.classList.add('hidden'); return; }
  ['bag', 'shop', 'gearshop', 'smith', 'help'].forEach((p) => $('#' + p).classList.add('hidden'));
  el.classList.remove('hidden');
  if (id === 'bag') renderBag(true);
  if (id === 'gearshop') renderGearShop();
  if (id === 'smith') renderSmith(true);
}
$$('.x').forEach((x) => x.onclick = () => $('#' + x.dataset.close).classList.add('hidden'));
$('#ab-bag').onclick = () => togglePanel('bag');
$('#ab-pick').onclick = () => doInteract();
$('#ab-potion').onclick = usePotion;
$('#helpbtn').onclick = () => togglePanel('help');
$('#btn-respawn').onclick = () => send({ t: 'respawn' });
$$('[data-buy]').forEach((b) => b.onclick = () => send({ t: 'buy', what: b.dataset.buy, n: +(b.dataset.n || 0) }));

/* ---- 物品 ---- */
function itemStats(it) {
  const t = GAME.GEAR_TIERS[it.tier];
  const mul = GAME.QUALITIES[it.q].mul * (1 + it.plus * GAME.ENHANCE_BONUS);
  if (it.slot === 'weapon') return { atk: Math.floor(t.wAtk * mul) };
  return { def: Math.floor(t.aDef * mul), hp: Math.floor(t.aHp * mul) };
}
function cellHTML(it) {
  if (!it) return '';
  if (it.kind === 'memento') return `<div class="cell q4" data-uid="${it.uid}">🏅<span style="font-size:8px">${it.name}</span></div>`;
  const bad = it.slot === 'weapon' && it.cls !== myCls;
  return `<div class="cell q${it.q}${bad ? ' bad' : ''}" data-uid="${it.uid}"
    style="background-image:url(${gearIconURL(it, myCls)})">${it.plus ? `<span class="plus">+${it.plus}</span>` : ''}${bad ? '<span class="lock">🚫</span>' : ''}</div>`;
}
const tooltip = $('#tooltip');
function bindTips(container, lookup) {
  container.querySelectorAll('.cell,[data-uid]').forEach((el) => {
    const it = lookup(el.dataset.uid);
    if (!it) return;
    const show = (e) => {
      let html = '';
      if (it.kind === 'memento') {
        html = `<div class="tn" style="color:var(--q-gold)">${it.name}</div>`;
        html += `<div style="color:#9aa">${it.desc}</div><div style="color:#c66">🔒 不可交易・不可丟棄</div>`;
      } else {
        const qc = it.q === 6 ? '#fff' : GAME.QUALITIES[it.q].color;
        html = `<div class="tiphead"><img src="${gearIconURL(it, myCls)}" class="tipicon">
          <div><div class="tn" style="color:${qc}">${it.name}${it.plus ? ' +' + it.plus : ''}</div>
          <div style="font-size:11px;color:${qc}">${GAME.QUALITIES[it.q].name}．${GAME.SLOT_NAMES[it.slot]}</div></div></div>`;
        const st = itemStats(it);
        if (st.atk) html += `<div>⚔ 攻擊力 <b style="color:#ffd76e">+${st.atk}</b></div>`;
        if (st.def) html += `<div>🛡 防禦 <b style="color:#8fd98f">+${st.def}</b></div>`;
        if (st.hp) html += `<div>❤ 生命 <b style="color:#ff9a8f">+${st.hp}</b></div>`;
        const cinfo = gearClassText(it);
        html += `<div style="margin-top:4px;color:${cinfo.ok ? '#8fd98f' : '#ff8a80'}">
          ${cinfo.ok ? '✔' : '🚫'} ${cinfo.text}${cinfo.ok ? '' : '（你無法裝備）'}</div>`;
        if (it.plus < 10) html += `<div style="font-size:11px;color:#8b90a8">下次強化成功率 ${GAME.ENHANCE_RATES[it.plus] * 100}%</div>`;
      }
      tooltip.innerHTML = html; tooltip.classList.remove('hidden');
      tooltip.style.left = Math.min(innerWidth - 250, e.clientX + 14) + 'px';
      tooltip.style.top = Math.min(innerHeight - 190, e.clientY + 10) + 'px';
    };
    el.onmouseenter = show;
    el.addEventListener('touchstart', (ev) => {          // 手機長按看說明
      const t0 = ev.touches[0];
      show({ clientX: t0.clientX - 130, clientY: t0.clientY - 180 });
      clearTimeout(el._tt); el._tt = setTimeout(() => tooltip.classList.add('hidden'), 2600);
    }, { passive: true });
    el.onmouseleave = () => tooltip.classList.add('hidden');
  });
}

/* ---- 背包 ---- */
let selUid = null;
let bagSig = '';
function bagSignature() {
  if (!meData) return '';
  return JSON.stringify([
    meData.gold, meData.arrows, meData.potions, meData.scrolls, meData.keys, meData.lvl,
    meData.inv.map((i) => i.uid + ':' + i.plus),
    GAME.SLOTS.map((s) => (meData.equip[s] ? meData.equip[s].uid + ':' + meData.equip[s].plus : '-'))
  ]);
}
function renderBag(force) {
  if (!meData) return;
  const sig = bagSignature();
  if (!force && sig === bagSig) return;      // 內容沒變就不重畫（避免清掉選取與說明）
  bagSig = sig;
  $('#baginfo').innerHTML = `💰 <b style="color:var(--gold)">${meData.gold.toLocaleString()}</b>　🏹 ${meData.arrows}　🧪 ${meData.potions}　📜 ${meData.scrolls}　🔑 ${meData.keys}/${GAME.KEYS_NEEDED}　（${meData.inv.length}/40）`;
  const eq = $('#equipslots'); eq.innerHTML = '';
  GAME.SLOTS.forEach((s) => {
    const it = meData.equip[s];
    const d = document.createElement('div');
    d.className = 'slot' + (it ? ' q' + it.q : '');
    if (it) {
      d.style.backgroundImage = `url(${gearIconURL(it, myCls)})`;
      d.innerHTML = `${it.plus ? `<span class="plus">+${it.plus}</span>` : ''}<span class="sname">${it.name}</span>`;
      d.dataset.uid = it.uid; d.title = '點擊卸下'; d.onclick = () => send({ t: 'unequip', slot: s });
    } else d.innerHTML = GAME.SLOT_NAMES[s];
    eq.appendChild(d);
  });
  bindTips(eq, (u) => GAME.SLOTS.map((s) => meData.equip[s]).find((i) => i && i.uid === u));
  const grid = $('#invgrid'); grid.innerHTML = '';
  meData.inv.forEach((it) => grid.insertAdjacentHTML('beforeend', cellHTML(it)));
  for (let i = meData.inv.length; i < 24; i++) grid.insertAdjacentHTML('beforeend', '<div class="cell"></div>');
  grid.querySelectorAll('.cell[data-uid]').forEach((el) => {
    el.onclick = () => {
      const uid = el.dataset.uid;
      if (selUid === uid) { send({ t: 'equip', uid }); return; }  // 再點一次＝裝備
      selUid = uid;
      refreshSelection();
    };
  });
  bindTips(grid, (u) => meData.inv.find((i) => i.uid === u));
  refreshSelection();
  drawDoll();
}
function refreshSelection() {
  const grid = $('#invgrid');
  grid.querySelectorAll('.cell').forEach((c2) => c2.classList.remove('sel'));
  const el = selUid && grid.querySelector(`.cell[data-uid="${selUid}"]`);
  if (el) el.classList.add('sel');
  const it = selUid && meData && meData.inv.find((i) => i.uid === selUid);
  const btn = $('#btn-equip');
  if (it && it.kind === 'equip') {
    const bad = it.slot === 'weapon' && it.cls !== myCls;
    btn.textContent = bad ? '🚫 此職業不可裝備' : '裝備【' + it.name + '】';
    btn.disabled = bad;
  } else { btn.textContent = '裝備'; btn.disabled = !it; }
}
$('#btn-equip').onclick = () => { if (selUid) send({ t: 'equip', uid: selUid }); };
$('#btn-drop').onclick = () => { if (selUid) send({ t: 'drop', uid: selUid }); };

/* ---- 裝備店 ---- */
function renderGearShop() {
  if (!meData || mapId >= 3) return;
  const tierKey = ['novice', 'steel', 'mithril'][mapId];
  const t = GAME.GEAR_TIERS[tierKey];
  const list = $('#gearlist'); list.innerHTML =
    `<div style="font-size:12px;color:#9aa;margin-bottom:8px">本店販售【${t.name}】系列（本區城鎮限定）｜💰 ${meData.gold.toLocaleString()}</div>`;
  GAME.SLOTS.forEach((s) => {
    const name = s === 'weapon' ? GAME.WEAPON_SUFFIX[tierKey][myCls] : t.name + GAME.SLOT_NAMES[s];
    const price = s === 'weapon' ? t.price.weapon : t.price.armor;
    const stats = s === 'weapon' ? `⚔ +${t.wAtk}` : `🛡 +${t.aDef}　❤ +${t.aHp}`;
    list.insertAdjacentHTML('beforeend',
      `<div class="shoprow"><span class="nm">${name}<br><small style="color:#889">${stats}</small></span>
       <span class="pr">${price.toLocaleString()} 💰</span>
       <button class="sbtn" style="flex:0 0 64px" data-slot="${s}">購買</button></div>`);
  });
  list.querySelectorAll('[data-slot]').forEach((b) => b.onclick = () => send({ t: 'buy', what: 'gear', slot: b.dataset.slot }));
}

/* ---- 鐵匠鋪 ---- */
let enhUid = null;
let smithSig = '';
function renderSmith(force) {
  if (!meData) return;
  const sig = bagSignature();
  if (!force && sig === smithSig) return;
  smithSig = sig;
  $('#scrolln').textContent = meData.scrolls;
  const grid = $('#smithgrid'); grid.innerHTML = '';
  const all = [];
  GAME.SLOTS.forEach((s) => { if (meData.equip[s]) all.push(Object.assign({ _eq: true }, meData.equip[s])); });
  meData.inv.forEach((it) => { if (it.kind === 'equip') all.push(it); });
  all.forEach((it) => grid.insertAdjacentHTML('beforeend', cellHTML(it)));
  grid.querySelectorAll('.cell[data-uid]').forEach((el, i) => {
    if (all[i]._eq) el.style.boxShadow = 'inset 0 0 0 2px #5ecfbb66';
    el.onclick = () => {
      enhUid = el.dataset.uid;
      grid.querySelectorAll('.cell').forEach((c2) => c2.classList.remove('sel'));
      el.classList.add('sel');
      const it = all.find((x) => x.uid === enhUid);
      const rate = it.plus < 10 ? (GAME.ENHANCE_RATES[it.plus] * 100) : 0;
      $('#enh-target').innerHTML = cellHTML(it) +
        `<div><b>${it.name}${it.plus ? ' +' + it.plus : ''}</b><div style="font-size:12px;color:#9aa">
        ${it.plus >= 10 ? '已達最高強化' : `強化至 +${it.plus + 1} 成功率 <b style="color:var(--gold)">${rate}%</b>${it.plus > 0 ? '，失敗會降至 +' + (it.plus - 1) : ''}`}</div></div>`;
      $('#enhfx').textContent = '';
    };
  });
  bindTips(grid, (u) => all.find((i) => i.uid === u));
}
$('#btn-enhance').onclick = () => { if (enhUid) send({ t: 'enhance', uid: enhUid }); };

/* ---------------- HUD ---------------- */
function updateHUD() {
  const m = meData;
  $('#hpfill').style.width = (m.hp / m.maxHp * 100) + '%';
  $('#hptext').textContent = `${m.hp} / ${m.maxHp}`;
  $('#xpfill').style.width = (m.xp / m.xpNeed * 100) + '%';
  $('#xptext').textContent = `Lv.${m.lvl}　${m.xp.toLocaleString()} / ${m.xpNeed.toLocaleString()} EXP`;
  const keyPart = (mapId === 2 || m.keys > 0) && !(m.flags || {}).portalOpen ? `<span style="color:#ffd76e">🔑 ${m.keys}/${GAME.KEYS_NEEDED}</span>` : '';
  $('#stats').innerHTML = `<span>⚔ ${m.atk}</span><span>🛡 ${m.def}</span>
    <span class="gold-ico">💰 ${m.gold.toLocaleString()}</span>
    ${myCls === 'archer' ? `<span>🏹 ${m.arrows}</span>` : ''}<span>📜 ${m.scrolls}</span>${keyPart}`;
  $('#potn').textContent = '×' + m.potions;
  const cd = $('#potcd');
  if (m.potionCd > 0) { cd.classList.remove('hidden'); cd.textContent = Math.ceil(m.potionCd / 1000); }
  else cd.classList.add('hidden');
  (GAME.SKILLS[myCls] || []).forEach((sk, i) => {
    const el = $('#sk' + i);
    const left = (m.skillCd || [])[i] || 0;
    const frac = left / sk.cd;
    el.querySelector('.cdov').style.background = left > 0
      ? `conic-gradient(#000000cc ${frac * 360}deg, transparent 0deg)` : 'none';
    el.querySelector('.cdtx').textContent = left > 800 ? Math.ceil(left / 1000) : '';
  });
}

/* ============================================================
   地圖預先繪製 v3 — 有機地形 + 立體奇觀
   ============================================================ */
let mapCanvas = null, mmBase = null;
const TAU = Math.PI * 2;

function noiseMaker(seed) {
  const rand = GAME.mulberry32(seed);
  const perm = new Float32Array(512);
  for (let i = 0; i < 512; i++) perm[i] = rand();
  const val = (xi, yi) => perm[((yi * 97 + xi * 13) % 512 + 512) % 512];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = val(xi, yi), b = val(xi + 1, yi), c2 = val(xi, yi + 1), d = val(xi + 1, yi + 1);
    return a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy;
  };
}

function labelText(x2, txt, x, y, size, fill, stroke) {
  x2.font = 'bold ' + size + 'px "Microsoft JhengHei",sans-serif';
  x2.textAlign = 'center';
  x2.strokeStyle = stroke || 'rgba(0,0,0,.75)'; x2.lineWidth = Math.max(3, size / 4);
  x2.lineJoin = 'round';
  x2.strokeText(txt, x, y);
  x2.fillStyle = fill; x2.fillText(txt, x, y);
}

function vignette(x2, w, h, color) {
  const g = x2.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, color);
  x2.fillStyle = g; x2.fillRect(0, 0, w, h);
}

/* ---- 主入口 ---- */
function prerenderMap(mi) {
  const md = GAME.MAPS[mi];
  const T = GAME.TILE;
  const { g, tw, th } = GAME.getGrid(mi);
  const c = document.createElement('canvas');
  c.width = md.w; c.height = md.h;
  const x2 = c.getContext('2d');
  const R = GAME.mulberry32(555 + mi);
  const N = noiseMaker(700 + mi * 31);

  // 城鎮外框（地形繪製要避開，城鎮由 drawTown 自己畫）
  const TZ = mi < 3 ? { x0: GAME.TOWN.x0 - 60, y0: GAME.TOWN.y0 - 60, x1: GAME.TOWN.x1 + 60, y1: GAME.TOWN.y1 + 60 } : null;
  const inTZ = (px, py) => TZ && px > TZ.x0 && px < TZ.x1 && py > TZ.y0 && py < TZ.y1;

  // 收集障礙 tile（含些許亂數擾動的圓心，讓輪廓有機）
  const tiles = [];
  if (mi < 3) {
    const jit = GAME.mulberry32(31 + mi);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      if (!g[y * tw + x]) continue;
      const px = x * T + T / 2 + (jit() - 0.5) * 14;
      const py = y * T + T / 2 + (jit() - 0.5) * 14;
      if (inTZ(px, py)) continue;
      tiles.push({ x: px, y: py, tx: x, ty: y, n: N(x * 0.085, y * 0.085), r: jit() });
    }
  }

  if (mi === 0) renderPeak(x2, md, R, N, tiles, g, tw, th, inTZ);
  else if (mi === 1) renderSanctum(x2, md, R, N, tiles, g, tw, th, inTZ);
  else if (mi === 2) renderVolcano(x2, md, R, N, tiles, g, tw, th, inTZ);
  else drawSchool(x2, R);

  if (mi < 3) drawTown(x2, md, R);
  if (md.bossArena) drawBossArena(x2, md, R);

  /* ---- 傳送門 ---- */
  function portal(x, y, label, color) {
    // 座台
    x2.fillStyle = 'rgba(0,0,0,.35)'; x2.beginPath(); x2.ellipse(x, y + 30, 74, 22, 0, 0, TAU); x2.fill();
    x2.fillStyle = '#4a4257'; x2.beginPath(); x2.ellipse(x, y + 22, 68, 20, 0, 0, TAU); x2.fill();
    x2.fillStyle = '#5d5470'; x2.beginPath(); x2.ellipse(x, y + 16, 68, 20, 0, 0, TAU); x2.fill();
    for (let i = 0; i < 6; i++) { // 環石
      const a = i / 6 * TAU;
      const sx = x + Math.cos(a) * 58, sy = y + 14 + Math.sin(a) * 15;
      x2.fillStyle = '#3b3348'; x2.fillRect(sx - 5, sy - 20, 10, 20);
      x2.fillStyle = color; x2.fillRect(sx - 2, sy - 16, 4, 7);
    }
    const pg = x2.createRadialGradient(x, y - 12, 4, x, y - 12, 58);
    pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.35, color); pg.addColorStop(1, color + '00');
    x2.fillStyle = pg; x2.beginPath(); x2.ellipse(x, y - 12, 44, 56, 0, 0, TAU); x2.fill();
    x2.strokeStyle = color; x2.lineWidth = 3; x2.globalAlpha = .7;
    x2.beginPath(); x2.ellipse(x, y - 12, 34, 46, 0, 0, TAU); x2.stroke(); x2.globalAlpha = 1;
    label.split('\n').forEach((L, i) => labelText(x2, L, x, y - 86 + i * 20, 15, '#fff'));
  }
  if (md.portalNext) {
    const req = mi === 0 ? '需擊敗 岩石魔像' : '需擊敗 黑暗信徒＋Lv.150';
    portal(md.portalNext.x, md.portalNext.y, '→ ' + GAME.MAPS[mi + 1].name.split('（')[0] + '\n' + req, '#9b6ef0');
  }
  if (md.portalPrev) portal(md.portalPrev.x, md.portalPrev.y, '← 返回 ' + GAME.MAPS[mi - 1].name.split('（')[0], '#9b6ef0');
  if (md.centerPortal) drawVolcanicGate(x2, md.centerPortal);

  // 比例尺
  labelText(x2, mi < 3 ? '主要地圖比例 1:4000' : '學園區域比例 1:500', 190, 108, 14, 'rgba(255,255,255,.75)');

  // 氛圍
  vignette(x2, c.width, c.height,
    ['rgba(25,40,70,.30)', 'rgba(10,2,26,.42)', 'rgba(26,4,0,.40)', 'rgba(4,18,4,.22)'][mi]);

  mapCanvas = c;
  mmBase = document.createElement('canvas');
  mmBase.width = 150; mmBase.height = 110;
  const mg = mmBase.getContext('2d');
  mg.drawImage(c, 0, 0, 150, 110);
  mg.fillStyle = '#00000040'; mg.fillRect(0, 0, 150, 110);
}

/* ---- 地形遮罩合成（把 tile 群組融成連續的有機地形） ---- */
const MSC = 0.5; // 遮罩用半解析度，邊緣更柔
function makeMask(md, pts, r) {
  const m = document.createElement('canvas');
  m.width = md.w * MSC; m.height = md.h * MSC;
  const q = m.getContext('2d');
  q.fillStyle = '#fff';
  for (const p of pts) { q.beginPath(); q.arc(p.x * MSC, p.y * MSC, r * MSC, 0, TAU); q.fill(); }
  return m;
}
function makeRibbon(md, pts, r) { // 相鄰格用圓頭粗線串起 → 連續河道
  const m = document.createElement('canvas');
  m.width = md.w * MSC; m.height = md.h * MSC;
  const q = m.getContext('2d');
  q.strokeStyle = '#fff'; q.fillStyle = '#fff';
  q.lineCap = 'round'; q.lineWidth = r * 2 * MSC;
  const byTile = new Map();
  for (const p of pts) byTile.set(p.tx + '_' + p.ty, p);
  for (const p of pts) {
    let linked = false;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const nb = byTile.get((p.tx + dx) + '_' + (p.ty + dy));
      if (!nb) continue;
      linked = true;
      q.beginPath(); q.moveTo(p.x * MSC, p.y * MSC); q.lineTo(nb.x * MSC, nb.y * MSC); q.stroke();
    }
    if (!linked) { q.beginPath(); q.arc(p.x * MSC, p.y * MSC, r * MSC, 0, TAU); q.fill(); }
  }
  return m;
}
function tintMask(mask, color) {
  const m = document.createElement('canvas');
  m.width = mask.width; m.height = mask.height;
  const q = m.getContext('2d');
  q.drawImage(mask, 0, 0);
  q.globalCompositeOperation = 'source-in';
  q.fillStyle = color; q.fillRect(0, 0, m.width, m.height);
  return m;
}
function innerMask(mask, dx, dy) { // 遮罩與其位移版本的交集 → 內部受光面
  const m = document.createElement('canvas');
  m.width = mask.width; m.height = mask.height;
  const q = m.getContext('2d');
  q.drawImage(mask, dx * MSC, dy * MSC);
  q.globalCompositeOperation = 'destination-in';
  q.drawImage(mask, 0, 0);
  return m;
}
function blit(x2, md, layer, dx = 0, dy = 0, alpha = 1) {
  x2.globalAlpha = alpha;
  x2.drawImage(layer, dx, dy, md.w, md.h);
  x2.globalAlpha = 1;
}
function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.substr(i, 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.substr(i, 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
/* 擠出式立體地形：把遮罩往上堆疊成有高度的岩壁（45 度俯視感） */
function extrude(x2, md, mask, h, colBottom, colTop, topColor, topHi) {
  blit(x2, md, tintMask(mask, '#000000'), h * 0.5, h * 0.75, 0.38);   // 投影
  const bands = 5, cols = [];
  for (let b = 0; b < bands; b++) cols.push(tintMask(mask, mixHex(colBottom, colTop, b / (bands - 1))));
  for (let i = 0; i <= h; i += 2) {                                    // 側面（由下往上疊）
    const b = Math.min(bands - 1, Math.floor(i / h * bands));
    blit(x2, md, cols[b], 0, -i);
  }
  blit(x2, md, tintMask(mask, mixHex(colTop, '#000000', 0.25)), 0, -h); // 頂面暗邊（強化輪廓）
  blit(x2, md, tintMask(innerMask(mask, -3, -3), topColor), 0, -h);     // 頂面
  if (topHi) {
    blit(x2, md, tintMask(innerMask(mask, -10, -13), topHi), 0, -h, 0.85); // 受光
    blit(x2, md, tintMask(innerMask(mask, -22, -30), topHi), 0, -h, 0.5);
  }
}
/* 凹陷地形：河道／熔岩往下沉，加內陰影 */
function recess(x2, md, maskOuter, layers) {
  blit(x2, md, tintMask(maskOuter, '#000000'), 0, -5, 0.35);
  for (const [mask, col, a] of layers) blit(x2, md, tintMask(mask, col), 0, 0, a === undefined ? 1 : a);
}

/* ============ 地圖一：碎裂之峰（雪原＋冰河峽谷＋雪山） ============ */
function renderPeak(x2, md, R, N, tiles, g, tw, th, inTZ) {
  const w = md.w, h = md.h;
  // 雪原底（明亮白雪地）
  const bg = x2.createLinearGradient(0, 0, w * 0.3, h);
  bg.addColorStop(0, '#fbfdff'); bg.addColorStop(0.5, '#eef4fa'); bg.addColorStop(1, '#dfe9f3');
  x2.fillStyle = bg; x2.fillRect(0, 0, w, h);
  for (let i = 0; i < 700; i++) { // 雪丘光影
    const x = R() * w, y = R() * h, r = 20 + R() * 90;
    x2.globalAlpha = 0.05 + R() * 0.05;
    x2.fillStyle = R() < 0.5 ? '#ffffff' : '#c6d6e5';
    x2.beginPath(); x2.ellipse(x, y, r, r * 0.5, 0, 0, TAU); x2.fill();
  }
  x2.globalAlpha = 1;
  for (let i = 0; i < 300; i++) { // 雪地足跡紋理
    const x = R() * w, y = R() * h;
    x2.globalAlpha = 0.05 + R() * 0.06;
    x2.fillStyle = '#a9bfd4';
    x2.beginPath(); x2.ellipse(x, y, 4 + R() * 8, 2 + R() * 3, R() * 3, 0, TAU); x2.fill();
  }
  x2.globalAlpha = 1;

  const canyon = tiles.filter((t) => t.n < 0.42);
  const ridge = tiles.filter((t) => t.n >= 0.42);
  // 冰河峽谷（雕進雪原的深藍水道，連續有機形狀）
  // 冰河峽谷（下沉的水道）
  recess(x2, md, makeRibbon(md, canyon, 36), [
    [makeRibbon(md, canyon, 36), '#b3cfe2'],
    [makeRibbon(md, canyon, 28), '#3f6f9a'],
    [makeRibbon(md, canyon, 19), '#2a5480'],
    [makeRibbon(md, canyon, 10), '#1c3d61']
  ]);
  for (const t of canyon) if (t.r < 0.13) { // 流水光
    x2.strokeStyle = 'rgba(190,225,245,.55)'; x2.lineWidth = 2;
    x2.beginPath(); x2.arc(t.x, t.y - 4, 9, Math.PI * 1.1, Math.PI * 1.9); x2.stroke();
  }
  // 連綿雪山山脈（立體擠出：岩壁側面 → 雪頂）
  const mr = makeMask(md, ridge, 34);
  // 深色岩壁 + 白雪頂（對照原始設定圖）
  extrude(x2, md, mr, 44, '#1e2c40', '#5b7089', '#f4f9fd', '#ffffff');
  for (const t of ridge) if (t.r < 0.06) { // 岩壁裂紋
    x2.strokeStyle = 'rgba(45,62,86,.45)'; x2.lineWidth = 2;
    x2.beginPath(); x2.moveTo(t.x - 8, t.y + 4); x2.lineTo(t.x - 1, t.y - 8); x2.lineTo(t.x + 8, t.y); x2.stroke();
  }

  // 立體雪山奇觀（大型山峰群）
  const inTZ2 = (px, py) => inTZ(px, py) || inTZ(px - 160, py) || inTZ(px + 160, py) || inTZ(px, py + 160);
  const peaks = sampleClusters(g, tw, th, (x, y) => N(x * 0.085, y * 0.085) >= 0.5, 14, 300, inTZ2);
  peaks.sort((a, b) => a[1] - b[1]);
  for (const [px, py] of peaks) drawMountain(x2, px, py, 80 + R() * 70);

  // 雪松
  for (let i = 0; i < 90; i++) {
    const x = R() * w, y = R() * h;
    const tx = Math.floor(x / 40), ty = Math.floor(y / 40);
    if (g[ty * tw + tx] || inTZ(x, y)) continue;
    drawPine(x2, x, y, 12 + R() * 14);
  }
  // 冰晶點綴
  for (let i = 0; i < 160; i++) {
    const x = R() * w, y = R() * h;
    if (inTZ(x, y)) continue;
    x2.globalAlpha = .5 + R() * .5; x2.fillStyle = '#ffffff';
    x2.fillRect(x, y, 2, 2);
  }
  x2.globalAlpha = 1;

  if (md.landmark) drawRuneAltar(x2, md.landmark);
}
function drawMountain(x2, x, y, s) {
  x2.fillStyle = 'rgba(30,45,70,.32)';
  x2.beginPath(); x2.ellipse(x + s * 0.28, y + s * 0.10, s * 1.05, s * 0.30, 0, 0, TAU); x2.fill();
  const peakX = x - s * 0.08, peakY = y - s * 1.45;
  // 右暗面
  x2.fillStyle = '#5f7188';
  x2.beginPath(); x2.moveTo(peakX, peakY); x2.lineTo(x + s, y); x2.lineTo(peakX + s * 0.10, y); x2.closePath(); x2.fill();
  // 左亮面
  x2.fillStyle = '#93a7bc';
  x2.beginPath(); x2.moveTo(peakX, peakY); x2.lineTo(peakX + s * 0.10, y); x2.lineTo(x - s * 0.95, y); x2.closePath(); x2.fill();
  // 雪帽（鋸齒下緣）
  const snowY = peakY + s * 0.55;
  x2.fillStyle = '#f6fafd';
  x2.beginPath(); x2.moveTo(peakX, peakY);
  const lx = peakX - s * 0.36, rx2 = peakX + s * 0.40;
  x2.lineTo(rx2, snowY);
  x2.lineTo(rx2 - s * 0.12, snowY - s * 0.10);
  x2.lineTo(rx2 - s * 0.24, snowY + s * 0.06);
  x2.lineTo(peakX - s * 0.05, snowY - s * 0.12);
  x2.lineTo(lx + s * 0.10, snowY + s * 0.05);
  x2.lineTo(lx, snowY - s * 0.06);
  x2.closePath(); x2.fill();
  x2.fillStyle = '#d9e6f0';
  x2.beginPath(); x2.moveTo(peakX, peakY); x2.lineTo(rx2, snowY); x2.lineTo(peakX + s * 0.06, snowY - s * 0.02); x2.closePath(); x2.fill();
}
function drawPine(x2, x, y, s) {
  x2.fillStyle = 'rgba(30,45,70,.25)'; x2.beginPath(); x2.ellipse(x + 3, y + 3, s * 0.8, s * 0.3, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#3d3226'; x2.fillRect(x - 2, y - 4, 4, 6);
  for (let i = 0; i < 3; i++) {
    const ss = s * (1 - i * 0.26), yy = y - 6 - i * s * 0.55;
    x2.fillStyle = '#33584c';
    x2.beginPath(); x2.moveTo(x, yy - ss); x2.lineTo(x + ss * 0.75, yy); x2.lineTo(x - ss * 0.75, yy); x2.closePath(); x2.fill();
    x2.fillStyle = '#e9f1f7';
    x2.beginPath(); x2.moveTo(x, yy - ss); x2.lineTo(x + ss * 0.4, yy - ss * 0.45); x2.lineTo(x - ss * 0.4, yy - ss * 0.45); x2.closePath(); x2.fill();
  }
}
function drawRuneAltar(x2, lm) {
  const { x, y } = lm;
  // 石臺
  x2.fillStyle = 'rgba(30,45,70,.3)'; x2.beginPath(); x2.ellipse(x + 8, y + 22, 120, 40, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#9db1c4'; x2.beginPath(); x2.ellipse(x, y + 10, 112, 38, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#b9cadb'; x2.beginPath(); x2.ellipse(x, y + 2, 112, 38, 0, 0, TAU); x2.fill();
  x2.strokeStyle = '#7fb8dd'; x2.lineWidth = 2; x2.globalAlpha = .7;
  x2.beginPath(); x2.ellipse(x, y + 2, 84, 27, 0, 0, TAU); x2.stroke();
  x2.beginPath(); x2.ellipse(x, y + 2, 52, 17, 0, 0, TAU); x2.stroke(); x2.globalAlpha = 1;
  // 中央光柱
  const beam = x2.createLinearGradient(x, y - 190, x, y + 6);
  beam.addColorStop(0, 'rgba(120,210,255,0)'); beam.addColorStop(1, 'rgba(120,210,255,.35)');
  x2.fillStyle = beam;
  x2.beginPath(); x2.moveTo(x - 14, y + 4); x2.lineTo(x - 34, y - 190); x2.lineTo(x + 34, y - 190); x2.lineTo(x + 14, y + 4); x2.closePath(); x2.fill();
  // 漂浮符文巨石（立體）
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i / 5 * TAU;
    const rx = x + Math.cos(a) * 130, ry = y + Math.sin(a) * 46 - 2;
    const lift = 26 + (i % 3) * 14, s = 20 + (i % 2) * 7;
    x2.fillStyle = 'rgba(30,45,70,.35)';
    x2.beginPath(); x2.ellipse(rx, ry + 14, s * 0.9, s * 0.32, 0, 0, TAU); x2.fill();
    const by = ry - lift;
    x2.fillStyle = '#6e8096';
    x2.beginPath();
    x2.moveTo(rx - s * 0.7, by); x2.lineTo(rx - s * 0.3, by - s); x2.lineTo(rx + s * 0.55, by - s * 0.85);
    x2.lineTo(rx + s * 0.75, by + s * 0.15); x2.lineTo(rx, by + s * 0.55); x2.closePath(); x2.fill();
    x2.fillStyle = '#93a7bc';
    x2.beginPath();
    x2.moveTo(rx - s * 0.7, by); x2.lineTo(rx - s * 0.3, by - s); x2.lineTo(rx + s * 0.2, by - s * 0.5); x2.lineTo(rx - s * 0.15, by + s * 0.3); x2.closePath(); x2.fill();
    x2.save();
    x2.shadowColor = '#5fd0ff'; x2.shadowBlur = 12;
    x2.strokeStyle = '#8fe1ff'; x2.lineWidth = 3;
    x2.beginPath(); x2.moveTo(rx - 4, by - s * 0.55); x2.lineTo(rx + 4, by - s * 0.25); x2.moveTo(rx + 4, by - s * 0.55); x2.lineTo(rx - 4, by - s * 0.25);
    x2.stroke(); x2.restore();
  }
  labelText(x2, '✦ ' + '符文祭壇', x, y - 152, 19, '#bfe9ff');
  labelText(x2, '古老的寶箱在此重現', x, y - 130, 12, 'rgba(191,233,255,.8)');
}

/* ============ 地圖二：黑暗聖殿（荊棘魔域＋哥德遺跡） ============ */
function renderSanctum(x2, md, R, N, tiles, g, tw, th, inTZ) {
  const w = md.w, h = md.h;
  // 霧氣暗林地表（對照原始設定圖的暗影灣澤）
  const bg = x2.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#243328'); bg.addColorStop(0.5, '#1d2a22'); bg.addColorStop(1, '#16211b');
  x2.fillStyle = bg; x2.fillRect(0, 0, w, h);
  for (let i = 0; i < 520; i++) {
    const x = R() * w, y = R() * h, r = 24 + R() * 80;
    x2.globalAlpha = 0.05 + R() * 0.06;
    x2.fillStyle = R() < 0.5 ? '#31462f' : '#0e1712';
    x2.beginPath(); x2.ellipse(x, y, r, r * 0.55, 0, 0, TAU); x2.fill();
  }
  x2.globalAlpha = 1;
  for (let i = 0; i < 200; i++) { // 沼澤水窪
    const x = R() * w, y = R() * h;
    if (inTZ(x, y)) continue;
    x2.globalAlpha = 0.35;
    x2.fillStyle = '#2b4a44';
    x2.beginPath(); x2.ellipse(x, y, 16 + R() * 30, (8 + R() * 14), 0, 0, TAU); x2.fill();
    x2.globalAlpha = 0.18; x2.fillStyle = '#7fd8c0';
    x2.beginPath(); x2.ellipse(x - 4, y - 3, 8 + R() * 12, 4 + R() * 5, 0, 0, TAU); x2.fill();
  }
  x2.globalAlpha = 1;

  // 暗林岩嶺（立體擠出：黑綠岩壁＋苔蘚頂）
  const ms = makeMask(md, tiles, 34);
  extrude(x2, md, ms, 40, '#080e0a', '#22331f', '#2f4a33', '#476b45');
  for (const t of tiles) if (t.r < 0.05) { // 水晶尖刺（黑暗信徒領地氣息）
    x2.save(); x2.shadowColor = '#a06ee0'; x2.shadowBlur = 10;
    x2.fillStyle = '#9d6ee0';
    x2.beginPath(); x2.moveTo(t.x, t.y - 30); x2.lineTo(t.x + 7, t.y - 8); x2.lineTo(t.x, t.y - 2); x2.lineTo(t.x - 7, t.y - 8); x2.closePath(); x2.fill();
    x2.fillStyle = '#cfa8ff';
    x2.beginPath(); x2.moveTo(t.x, t.y - 30); x2.lineTo(t.x + 3, t.y - 12); x2.lineTo(t.x - 3, t.y - 12); x2.closePath(); x2.fill();
    x2.restore();
  }

  // 斷柱與拱門遺跡
  const ruins = sampleClusters(g, tw, th, () => true, 12, 340, inTZ, true);
  for (const [px, py] of ruins) {
    if (R() < 0.4) drawArchRuin(x2, px, py, 40 + R() * 22);
    else drawPillar(x2, px, py, 26 + R() * 20);
  }
  // 暗林樹木（對照設定圖的深綠密林）
  const trees = [];
  for (let i = 0; i < 130; i++) {
    const x = R() * w, y = R() * h;
    const tx = Math.floor(x / 40), ty = Math.floor(y / 40);
    if (g[ty * tw + tx] || inTZ(x, y)) continue;
    trees.push([x, y, R()]);
  }
  trees.sort((a, b) => a[1] - b[1]);
  for (const [x, y, r] of trees) {
    if (r < 0.28) { drawDeadTree(x2, x, y, 20 + r * 60); continue; }
    const s = 22 + r * 22;
    x2.fillStyle = 'rgba(0,0,0,.45)';
    x2.beginPath(); x2.ellipse(x + 5, y + 4, s * 0.7, s * 0.24, 0, 0, TAU); x2.fill();
    x2.fillStyle = '#221a12'; x2.fillRect(x - 3, y - s * 0.55, 6, s * 0.55);   // 樹幹
    for (let k = 0; k < 3; k++) {                                              // 三層樹冠
      const ss = s * (1 - k * 0.22), yy = y - s * 0.5 - k * s * 0.34;
      x2.fillStyle = ['#1d3324', '#274430', '#31573b'][k];
      x2.beginPath(); x2.ellipse(x, yy, ss * 0.62, ss * 0.42, 0, 0, TAU); x2.fill();
      x2.fillStyle = ['#2a4a33', '#356045', '#417a52'][k];
      x2.beginPath(); x2.ellipse(x - ss * 0.14, yy - ss * 0.1, ss * 0.4, ss * 0.26, 0, 0, TAU); x2.fill();
    }
  }
  // 地面霧氣
  for (let i = 0; i < 60; i++) {
    const x = R() * w, y = R() * h;
    x2.globalAlpha = 0.06 + R() * 0.05; x2.fillStyle = '#cfe4dc';
    x2.beginPath(); x2.ellipse(x, y, 70 + R() * 130, 26 + R() * 44, 0, 0, TAU); x2.fill();
  }
  x2.globalAlpha = 1;
  // 螢光蕈與燭光
  for (let i = 0; i < 70; i++) {
    const x = R() * w, y = R() * h;
    if (inTZ(x, y)) continue;
    x2.save(); x2.shadowBlur = 8;
    if (R() < 0.6) { x2.shadowColor = '#7be0c8'; x2.fillStyle = '#7be0c8'; }
    else { x2.shadowColor = '#e0b06e'; x2.fillStyle = '#ffce7a'; }
    x2.beginPath(); x2.arc(x, y, 2.4, 0, TAU); x2.fill(); x2.restore();
  }
  // 月光斜射光束
  x2.save(); x2.globalAlpha = 0.045; x2.fillStyle = '#bfe0d0';
  for (let i = 0; i < 4; i++) {
    const bx = w * (0.15 + i * 0.22);
    x2.beginPath();
    x2.moveTo(bx, -50); x2.lineTo(bx + 220, -50); x2.lineTo(bx - 140, h + 50); x2.lineTo(bx - 340, h + 50);
    x2.closePath(); x2.fill();
  }
  x2.restore();

  if (md.landmark) drawDarkAltar(x2, md.landmark);
}
function drawPillar(x2, x, y, s) {
  x2.fillStyle = 'rgba(0,0,0,.45)'; x2.beginPath(); x2.ellipse(x + 4, y + 4, s * 0.55, s * 0.2, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#241b38'; x2.fillRect(x - s * 0.42, y - s * 1.7, s * 0.84, s * 1.7);
  x2.fillStyle = '#3d2f5c'; x2.fillRect(x - s * 0.42, y - s * 1.7, s * 0.3, s * 1.7);
  x2.fillStyle = '#170f28';
  x2.beginPath(); // 斷裂頂
  x2.moveTo(x - s * 0.42, y - s * 1.7);
  x2.lineTo(x - s * 0.1, y - s * 1.95); x2.lineTo(x + 2, y - s * 1.62); x2.lineTo(x + s * 0.25, y - s * 1.85); x2.lineTo(x + s * 0.42, y - s * 1.7);
  x2.lineTo(x + s * 0.42, y - s * 1.55); x2.lineTo(x - s * 0.42, y - s * 1.55);
  x2.closePath(); x2.fill();
  x2.fillStyle = '#2c2144'; x2.fillRect(x - s * 0.52, y - s * 0.16, s * 1.04, s * 0.2);
}
function drawArchRuin(x2, x, y, s) {
  drawPillar(x2, x - s, y, s * 0.6);
  drawPillar(x2, x + s, y, s * 0.6);
  x2.strokeStyle = '#3d2f5c'; x2.lineWidth = s * 0.28;
  x2.beginPath(); x2.arc(x, y - s * 1.02, s, Math.PI * 1.05, Math.PI * 1.95); x2.stroke();
  x2.strokeStyle = '#241b38'; x2.lineWidth = s * 0.12;
  x2.beginPath(); x2.arc(x, y - s * 1.02, s * 1.06, Math.PI * 1.05, Math.PI * 1.95); x2.stroke();
}
function drawDeadTree(x2, x, y, s) {
  x2.fillStyle = 'rgba(0,0,0,.4)'; x2.beginPath(); x2.ellipse(x + 3, y + 3, s * 0.5, s * 0.18, 0, 0, TAU); x2.fill();
  x2.strokeStyle = '#0f0a18'; x2.lineWidth = 5; x2.lineCap = 'round';
  x2.beginPath(); x2.moveTo(x, y); x2.quadraticCurveTo(x - s * 0.2, y - s * 0.8, x - s * 0.1, y - s * 1.3); x2.stroke();
  x2.lineWidth = 2.5;
  x2.beginPath(); x2.moveTo(x - s * 0.14, y - s * 0.7); x2.quadraticCurveTo(x - s * 0.7, y - s, x - s * 0.85, y - s * 1.25); x2.stroke();
  x2.beginPath(); x2.moveTo(x - s * 0.12, y - s * 0.95); x2.quadraticCurveTo(x + s * 0.4, y - s * 1.3, x + s * 0.6, y - s * 1.6); x2.stroke();
  x2.save(); x2.shadowColor = '#7b4fa0'; x2.shadowBlur = 16;
  x2.fillStyle = 'rgba(123,79,160,.28)';
  x2.beginPath(); x2.arc(x - s * 0.1, y - s * 1.35, s * 0.4, 0, TAU); x2.fill(); x2.restore();
}
function drawDarkAltar(x2, lm) {
  const { x, y } = lm;
  // 大教堂剪影
  const bx = x, by = y - 36;
  x2.fillStyle = 'rgba(0,0,0,.5)'; x2.beginPath(); x2.ellipse(x + 8, y + 40, 180, 46, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#0f0a1c';
  x2.beginPath();
  x2.moveTo(bx - 170, by + 60);
  x2.lineTo(bx - 170, by - 60); x2.lineTo(bx - 150, by - 60); x2.lineTo(bx - 150, by - 100); x2.lineTo(bx - 130, by - 140); x2.lineTo(bx - 110, by - 100); x2.lineTo(bx - 110, by - 70);
  x2.lineTo(bx - 50, by - 70); x2.lineTo(bx - 50, by - 120); x2.lineTo(bx, by - 185); x2.lineTo(bx + 50, by - 120); x2.lineTo(bx + 50, by - 70);
  x2.lineTo(bx + 110, by - 70); x2.lineTo(bx + 110, by - 100); x2.lineTo(bx + 130, by - 140); x2.lineTo(bx + 150, by - 100); x2.lineTo(bx + 150, by - 60); x2.lineTo(bx + 170, by - 60);
  x2.lineTo(bx + 170, by + 60);
  x2.closePath(); x2.fill();
  x2.fillStyle = '#1c1330';
  x2.fillRect(bx - 170, by + 8, 340, 52);
  // 玫瑰窗與尖拱窗
  x2.save(); x2.shadowColor = '#b26eff'; x2.shadowBlur = 18;
  x2.fillStyle = '#8a4fd8';
  x2.beginPath(); x2.arc(bx, by - 108, 22, 0, TAU); x2.fill();
  x2.fillStyle = '#c9a2ff';
  x2.beginPath(); x2.arc(bx, by - 108, 10, 0, TAU); x2.fill();
  const win = (wx, wy, s2) => {
    x2.fillStyle = '#7b3ff0';
    x2.beginPath(); x2.moveTo(wx - s2, wy); x2.lineTo(wx - s2, wy - s2 * 1.6); x2.arc(wx, wy - s2 * 1.6, s2, Math.PI, 0); x2.lineTo(wx + s2, wy); x2.closePath(); x2.fill();
  };
  win(bx - 130, by + 44, 9); win(bx - 80, by + 44, 11); win(bx, by + 40, 14); win(bx + 80, by + 44, 11); win(bx + 130, by + 44, 9);
  x2.restore();
  // 祭壇與燭火
  x2.fillStyle = '#241b38'; x2.fillRect(x - 60, y + 34, 120, 18);
  x2.fillStyle = '#3d2f5c'; x2.fillRect(x - 52, y + 22, 104, 14);
  for (let i = 0; i < 6; i++) {
    const cx2 = x - 62 + i * 25, cy = y + 18;
    x2.fillStyle = '#d8cfc0'; x2.fillRect(cx2 - 1.5, cy - 8, 3, 8);
    x2.save(); x2.shadowColor = '#ffb35a'; x2.shadowBlur = 8;
    x2.fillStyle = '#ffce7a'; x2.beginPath(); x2.arc(cx2, cy - 11, 2.6, 0, TAU); x2.fill(); x2.restore();
  }
  // 漩渦
  x2.save(); x2.shadowColor = '#8a4fd8'; x2.shadowBlur = 22;
  const sg = x2.createRadialGradient(x, y - 230, 2, x, y - 230, 40);
  sg.addColorStop(0, '#e8d5ff'); sg.addColorStop(.6, '#7b3ff0'); sg.addColorStop(1, '#7b3ff000');
  x2.fillStyle = sg; x2.beginPath(); x2.arc(x, y - 230, 40, 0, TAU); x2.fill(); x2.restore();
  labelText(x2, '✦ 魔法祭壇', x, y - 275, 19, '#dcb8ff');
  labelText(x2, '被詛咒的寶箱在此重現', x, y - 253, 12, 'rgba(220,184,255,.8)');
}

/* ============ 地圖三：火山王座（黑曜岩＋熔岩河＋火山） ============ */
function renderVolcano(x2, md, R, N, tiles, g, tw, th, inTZ) {
  const w = md.w, h = md.h;
  const bg = x2.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#241410'); bg.addColorStop(0.55, '#2e1c14'); bg.addColorStop(1, '#1d100c');
  x2.fillStyle = bg; x2.fillRect(0, 0, w, h);
  for (let i = 0; i < 520; i++) {
    const x = R() * w, y = R() * h, r = 18 + R() * 70;
    x2.globalAlpha = 0.05 + R() * 0.07;
    x2.fillStyle = R() < 0.5 ? '#3c2418' : '#120a06';
    x2.beginPath(); x2.ellipse(x, y, r, r * 0.55, 0, 0, TAU); x2.fill();
  }
  x2.globalAlpha = 1;
  // 地面龜裂
  x2.strokeStyle = 'rgba(0,0,0,.35)'; x2.lineWidth = 2;
  for (let i = 0; i < 90; i++) {
    let x = R() * w, y = R() * h;
    if (inTZ(x, y)) continue;
    x2.beginPath(); x2.moveTo(x, y);
    for (let j = 0; j < 3; j++) { x += (R() - 0.5) * 80; y += (R() - 0.5) * 60; x2.lineTo(x, y); }
    x2.stroke();
  }

  const lava = tiles.filter((t) => t.n < 0.40);
  const rock = tiles.filter((t) => t.n >= 0.40);
  // 熔岩河：外光暈 → 岩岸 → 岩漿 → 白熱中心（連續河道）
  blit(x2, md, tintMask(makeRibbon(md, lava, 50), '#ff6e1a'), 0, 0, 0.14);
  recess(x2, md, makeRibbon(md, lava, 32), [
    [makeRibbon(md, lava, 32), '#170b06'],
    [makeRibbon(md, lava, 24), '#c8420a'],
    [makeRibbon(md, lava, 17), '#ff7a1a'],
    [makeRibbon(md, lava, 10), '#ffb23a'],
    [makeRibbon(md, lava, 4), '#ffe27a']
  ]);
  for (const t of lava) if (t.r < 0.3) {
    x2.fillStyle = '#fff3b8'; x2.beginPath(); x2.arc(t.x + (t.r - 0.15) * 20, t.y, 4.5, 0, TAU); x2.fill();
  }
  // 黑曜岩山脈（立體擠出）
  const mk = makeMask(md, rock, 34);
  extrude(x2, md, mk, 32, '#0d0805', '#3b271b', '#513a29', '#7a5a40');
  for (const t of rock) if (t.r < 0.14) {
    x2.save(); x2.shadowColor = '#ff7a1a'; x2.shadowBlur = 7;
    x2.strokeStyle = '#ff8a2a'; x2.lineWidth = 2;
    x2.beginPath(); x2.moveTo(t.x - 9, t.y + 4); x2.lineTo(t.x - 2, t.y - 5); x2.lineTo(t.x + 7, t.y + 1); x2.stroke();
    x2.restore();
  }

  // 立體火山奇觀
  const inTZ3 = (px, py) => inTZ(px, py) || inTZ(px - 170, py) || inTZ(px + 170, py) || inTZ(px, py + 170);
  const cones = sampleClusters(g, tw, th, (x, y) => N(x * 0.085, y * 0.085) >= 0.5, 7, 460, inTZ3);
  cones.sort((a, b) => a[1] - b[1]);
  for (const [px, py] of cones) drawVolcanoCone(x2, px, py, 90 + R() * 60);

  // 飄浮餘燼
  for (let i = 0; i < 140; i++) {
    const x = R() * w, y = R() * h;
    if (inTZ(x, y)) continue;
    x2.save(); x2.shadowColor = '#ff9a3a'; x2.shadowBlur = 6;
    x2.globalAlpha = .4 + R() * .6;
    x2.fillStyle = R() < .5 ? '#ffb35a' : '#ff7a1a';
    x2.beginPath(); x2.arc(x, y, 1.6 + R() * 1.4, 0, TAU); x2.fill();
    x2.restore();
  }
  x2.globalAlpha = 1;

  if (md.landmark) drawRockThrone(x2, md.landmark);
}
function drawVolcanoCone(x2, x, y, s) {
  x2.fillStyle = 'rgba(0,0,0,.5)';
  x2.beginPath(); x2.ellipse(x + s * 0.2, y + s * 0.08, s * 1.15, s * 0.30, 0, 0, TAU); x2.fill();
  const topY = y - s * 1.15, rimL = x - s * 0.34, rimR = x + s * 0.34;
  // 右暗面
  x2.fillStyle = '#231410';
  x2.beginPath(); x2.moveTo(rimR, topY); x2.lineTo(x + s, y); x2.lineTo(x + s * 0.05, y); x2.lineTo(x + s * 0.05, topY + s * 0.1); x2.closePath(); x2.fill();
  // 左亮面
  x2.fillStyle = '#4b3125';
  x2.beginPath(); x2.moveTo(rimL, topY); x2.lineTo(x + s * 0.05, topY + s * 0.1); x2.lineTo(x + s * 0.05, y); x2.lineTo(x - s, y); x2.closePath(); x2.fill();
  // 火山口
  x2.fillStyle = '#120a06'; x2.beginPath(); x2.ellipse(x, topY + 2, s * 0.36, s * 0.13, 0, 0, TAU); x2.fill();
  x2.save(); x2.shadowColor = '#ff7a1a'; x2.shadowBlur = 26;
  const cg = x2.createRadialGradient(x, topY + 2, 1, x, topY + 2, s * 0.3);
  cg.addColorStop(0, '#ffe27a'); cg.addColorStop(.7, '#ff7a1a'); cg.addColorStop(1, '#c33d08');
  x2.fillStyle = cg; x2.beginPath(); x2.ellipse(x, topY + 3, s * 0.27, s * 0.09, 0, 0, TAU); x2.fill();
  x2.restore();
  // 岩漿流
  x2.save(); x2.shadowColor = '#ff7a1a'; x2.shadowBlur = 10;
  x2.strokeStyle = '#ff8a2a'; x2.lineWidth = 6; x2.lineCap = 'round';
  x2.beginPath(); x2.moveTo(x - s * 0.12, topY + 6);
  x2.quadraticCurveTo(x - s * 0.3, y - s * 0.5, x - s * 0.22, y - 4); x2.stroke();
  x2.strokeStyle = '#ffd54a'; x2.lineWidth = 2.4;
  x2.beginPath(); x2.moveTo(x - s * 0.12, topY + 6);
  x2.quadraticCurveTo(x - s * 0.3, y - s * 0.5, x - s * 0.22, y - 4); x2.stroke();
  x2.restore();
  // 煙
  x2.fillStyle = 'rgba(70,60,60,.4)';
  x2.beginPath(); x2.arc(x + s * 0.1, topY - s * 0.22, s * 0.14, 0, TAU); x2.fill();
  x2.fillStyle = 'rgba(90,80,80,.28)';
  x2.beginPath(); x2.arc(x + s * 0.22, topY - s * 0.44, s * 0.19, 0, TAU); x2.fill();
  x2.fillStyle = 'rgba(110,100,100,.16)';
  x2.beginPath(); x2.arc(x + s * 0.30, topY - s * 0.70, s * 0.26, 0, TAU); x2.fill();
}
function drawRockThrone(x2, lm) {
  const { x, y } = lm;
  x2.fillStyle = 'rgba(0,0,0,.5)'; x2.beginPath(); x2.ellipse(x + 8, y + 34, 150, 42, 0, 0, TAU); x2.fill();
  // 三層臺階
  for (let i = 0; i < 3; i++) {
    const wd = 150 - i * 26, hy = y + 30 - i * 14;
    x2.fillStyle = i % 2 ? '#2c1a12' : '#33201622';
    x2.fillStyle = i % 2 ? '#2c1a12' : '#3a251a';
    x2.fillRect(x - wd, hy - 10, wd * 2, 16);
    x2.fillStyle = 'rgba(255,140,40,.15)'; x2.fillRect(x - wd, hy - 10, wd * 2, 3);
  }
  // 王座本體
  const g2 = x2.createLinearGradient(x - 60, 0, x + 60, 0);
  g2.addColorStop(0, '#4a2c1c'); g2.addColorStop(.5, '#33201400'); g2.addColorStop(.5, '#3a2517'); g2.addColorStop(1, '#241410');
  x2.fillStyle = '#3a2517';
  x2.beginPath();
  x2.moveTo(x - 62, y - 4);
  x2.lineTo(x - 62, y - 120); x2.lineTo(x - 40, y - 96); x2.lineTo(x - 40, y - 150); x2.lineTo(x - 14, y - 118);
  x2.lineTo(x, y - 170);
  x2.lineTo(x + 14, y - 118); x2.lineTo(x + 40, y - 150); x2.lineTo(x + 40, y - 96); x2.lineTo(x + 62, y - 120);
  x2.lineTo(x + 62, y - 4);
  x2.closePath(); x2.fill();
  x2.fillStyle = '#54321e';
  x2.beginPath();
  x2.moveTo(x - 62, y - 4); x2.lineTo(x - 62, y - 120); x2.lineTo(x - 40, y - 96); x2.lineTo(x - 40, y - 4);
  x2.closePath(); x2.fill();
  x2.fillStyle = '#1c0f08'; x2.fillRect(x - 34, y - 88, 68, 84); // 座位陰影
  x2.save(); x2.shadowColor = '#ff5a1a'; x2.shadowBlur = 16;   // 王座紅光
  x2.strokeStyle = 'rgba(255,90,26,.8)'; x2.lineWidth = 3;
  x2.beginPath(); x2.moveTo(x - 34, y - 88); x2.lineTo(x + 34, y - 88); x2.stroke();
  x2.restore();
  // 火盆
  for (const s of [-1, 1]) {
    const fx = x + s * 108, fy = y + 8;
    x2.fillStyle = '#1c0f08'; x2.fillRect(fx - 8, fy - 26, 16, 26);
    x2.fillStyle = '#33201a'; x2.beginPath(); x2.ellipse(fx, fy - 28, 15, 6, 0, 0, TAU); x2.fill();
    x2.save(); x2.shadowColor = '#ff8a2a'; x2.shadowBlur = 18;
    x2.fillStyle = '#ff9a2a';
    x2.beginPath(); x2.moveTo(fx - 8, fy - 30); x2.quadraticCurveTo(fx - 5, fy - 46, fx, fy - 52);
    x2.quadraticCurveTo(fx + 6, fy - 42, fx + 8, fy - 30); x2.closePath(); x2.fill();
    x2.fillStyle = '#ffe27a';
    x2.beginPath(); x2.moveTo(fx - 3, fy - 31); x2.quadraticCurveTo(fx, fy - 42, fx + 3, fy - 31); x2.closePath(); x2.fill();
    x2.restore();
  }
  labelText(x2, '♛ 岩石王座', x, y - 196, 19, '#ffca7a');
  labelText(x2, '龍鱗寶箱在此重現', x, y - 174, 12, 'rgba(255,202,122,.8)');
}
function drawVolcanicGate(x2, cp) {
  const { x, y } = cp;
  // 環形黑石與熔岩溝
  x2.save(); x2.shadowColor = '#7b2ff0'; x2.shadowBlur = 30;
  const pg = x2.createRadialGradient(x, y, 6, x, y, 118);
  pg.addColorStop(0, '#efe0ff'); pg.addColorStop(0.35, '#8a3ff0'); pg.addColorStop(0.75, '#31135e'); pg.addColorStop(1, '#31135e00');
  x2.fillStyle = pg; x2.beginPath(); x2.arc(x, y, 118, 0, TAU); x2.fill();
  x2.restore();
  x2.strokeStyle = '#c9a2ff'; x2.lineWidth = 3; x2.globalAlpha = .8;
  for (let i = 0; i < 3; i++) { x2.beginPath(); x2.arc(x, y, 52 + i * 22, i * 1.1, i * 1.1 + 4.6); x2.stroke(); }
  x2.globalAlpha = 1;
  // 巨石環
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + 0.4;
    const sx = x + Math.cos(a) * 158, sy = y + Math.sin(a) * 120;
    x2.fillStyle = 'rgba(0,0,0,.5)'; x2.beginPath(); x2.ellipse(sx + 4, sy + 20, 16, 6, 0, 0, TAU); x2.fill();
    x2.fillStyle = '#1a0f0a'; x2.fillRect(sx - 11, sy - 44, 22, 62);
    x2.fillStyle = '#33221a'; x2.fillRect(sx - 11, sy - 44, 8, 62);
    x2.save(); x2.shadowColor = '#b26eff'; x2.shadowBlur = 8;
    x2.fillStyle = '#c9a2ff'; x2.fillRect(sx - 3, sy - 34, 6, 16); x2.restore();
  }
  // 鑰匙孔
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i - 1) * 0.85;
    const kx = x + Math.cos(a) * 96, ky = y + Math.sin(a) * 74;
    x2.fillStyle = '#120a1f'; x2.beginPath(); x2.arc(kx, ky, 13, 0, TAU); x2.fill();
    x2.strokeStyle = '#ffd76e'; x2.lineWidth = 2; x2.stroke();
    x2.font = '13px sans-serif'; x2.textAlign = 'center'; x2.fillStyle = '#ffd76e';
    x2.fillText('🔑', kx, ky + 5);
  }
  labelText(x2, cp.name, x, y - 150, 18, '#e8c874');
  labelText(x2, `集齊 ${GAME.KEYS_NEEDED} 把${GAME.KEY_NAME}即可進入 → 中崙學園`, x, y - 128, 13, '#ffd9a0');
}

/* ---- 大型地物取樣（在夠厚的障礙群中挑點） ---- */
function sampleClusters(g, tw, th, classFn, need, minDist, inTZ, onOpen) {
  const spots = [];
  for (let y = 5; y < th - 5 && spots.length < need; y += 2) {
    for (let x = 5; x < tw - 5 && spots.length < need; x += 2) {
      const blockedHere = !!g[y * tw + x];
      if (onOpen ? blockedHere : !blockedHere) continue;
      if (!classFn(x, y)) continue;
      if (!onOpen) {
        let cnt = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g[(y + dy) * tw + x + dx]) cnt++;
        if (cnt < 13) continue;
      } else {
        // 找開闊地（遺跡擺在路旁）
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!g[(y + dy) * tw + x + dx]) cnt++;
        if (cnt < 9) continue;
      }
      const px = x * 40 + 20, py = y * 40 + 20;
      if (inTZ && inTZ(px, py)) continue;
      if (spots.some((s) => (s[0] - px) ** 2 + (s[1] - py) ** 2 < minDist * minDist)) continue;
      spots.push([px, py]);
    }
  }
  return spots;
}

/* ============ 城鎮（1:200，精緻版） ============ */
function drawTown(x2, md, R) {
  const T = GAME.TOWN;
  const floorC = { peak: ['#cbbfa8', '#b7a98f'], sanctum: ['#6a6180', '#565070'], volcano: ['#8a7360', '#75604e'] }[md.theme];
  // 地板
  const fg = x2.createRadialGradient(T.cx, T.cy, 60, T.cx, T.cy, 560);
  fg.addColorStop(0, floorC[0]); fg.addColorStop(1, floorC[1]);
  x2.fillStyle = fg;
  x2.fillRect(T.x0 + 34, T.y0 + 34, T.x1 - T.x0 - 68, T.y1 - T.y0 - 68);
  for (let i = 0; i < 220; i++) { // 石板
    x2.fillStyle = i % 2 ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.05)';
    x2.fillRect(T.x0 + 40 + R() * (T.x1 - T.x0 - 100), T.y0 + 40 + R() * (T.y1 - T.y0 - 100), 18 + R() * 8, 9 + R() * 5);
  }
  // 中央大道
  x2.fillStyle = 'rgba(255,255,255,.07)';
  x2.fillRect(T.x0 + 40, T.gateY0 + 8, T.x1 - T.x0 - 80, T.gateY1 - T.gateY0 - 16);

  // ---- 城牆（帶垛口與四角塔樓） ----
  const wallC = '#645646', wallTop = '#7d6e5b', wallHi = '#93836c';
  const strip = (x, y, w2, h2) => {
    x2.fillStyle = 'rgba(0,0,0,.35)'; x2.fillRect(x + 5, y + 7, w2, h2);
    x2.fillStyle = wallC; x2.fillRect(x, y, w2, h2);
    x2.fillStyle = wallTop; x2.fillRect(x, y, w2, Math.min(14, h2));
    // 垛口
    x2.fillStyle = 'rgba(0,0,0,.25)';
    if (w2 > h2) { for (let xx = x + 10; xx < x + w2 - 10; xx += 40) x2.fillRect(xx, y, 14, 6); }
    else { for (let yy = y + 10; yy < y + h2 - 10; yy += 40) x2.fillRect(x, yy, 6, 14); }
  };
  strip(T.x0, T.y0, T.x1 - T.x0, 40);                    // 北牆
  strip(T.x0, T.y1 - 40, T.x1 - T.x0, 40);               // 南牆
  strip(T.x0, T.y0, 40, T.gateY0 - T.y0);                // 西牆上段
  strip(T.x0, T.gateY1, 40, T.y1 - T.gateY1);            // 西牆下段
  strip(T.x1 - 40, T.y0, 40, T.gateY0 - T.y0);           // 東牆上段
  strip(T.x1 - 40, T.gateY1, 40, T.y1 - T.gateY1);       // 東牆下段
  for (const [tx, ty] of [[T.x0, T.y0], [T.x1, T.y0], [T.x0, T.y1], [T.x1, T.y1]]) { // 角塔
    x2.fillStyle = 'rgba(0,0,0,.35)'; x2.beginPath(); x2.arc(tx + 5, ty + 7, 34, 0, TAU); x2.fill();
    x2.fillStyle = wallC; x2.beginPath(); x2.arc(tx, ty, 34, 0, TAU); x2.fill();
    x2.fillStyle = wallHi; x2.beginPath(); x2.arc(tx - 5, ty - 7, 24, 0, TAU); x2.fill();
    x2.fillStyle = '#8c4a3a';
    x2.beginPath(); x2.arc(tx, ty, 16, 0, TAU); x2.fill();
  }
  // 城門（木門開啟）
  for (const s of [0, 1]) {
    const gx = s ? T.x1 - 20 : T.x0 + 20;
    x2.fillStyle = '#4a3category'; x2.fillStyle = '#4a331f';
    x2.fillRect(gx - 14, T.gateY0 - 14, 28, 14);
    x2.fillRect(gx - 14, T.gateY1, 28, 14);
    x2.fillStyle = '#6b4a2a';
    x2.fillRect(gx - (s ? -6 : 10), T.gateY0 + 4, 4, T.gateY1 - T.gateY0 - 8);
    labelText(x2, s ? '東門' : '西門', gx, T.gateY0 - 24, 14, '#ffe9b0');
  }

  // ---- 建築（立體屋） ----
  const roofColors = { gear: ['#a05242', '#7a3c30'], shop: ['#4a7ba0', '#38607e'], smith: ['#6a6a72', '#4e4e56'], inn: ['#8a5f9e', '#6c4880'] };
  for (const b of T.buildings) {
    const wd = b.w, hh = b.h, x = b.x, y = b.y;
    x2.fillStyle = 'rgba(0,0,0,.38)'; x2.fillRect(x - wd / 2 + 8, y - hh / 2 + 10, wd, hh);
    const wg = x2.createLinearGradient(0, y - hh / 2, 0, y + hh / 2);
    wg.addColorStop(0, '#8f7a63'); wg.addColorStop(1, '#6d5a47');
    x2.fillStyle = wg; x2.fillRect(x - wd / 2, y - hh / 2, wd, hh);
    x2.strokeStyle = 'rgba(0,0,0,.25)'; x2.lineWidth = 2;
    x2.strokeRect(x - wd / 2, y - hh / 2, wd, hh);
    // 屋頂
    const rc = roofColors[b.key];
    const rg2 = x2.createLinearGradient(x - wd / 2, 0, x + wd / 2, 0);
    rg2.addColorStop(0, rc[0]); rg2.addColorStop(1, rc[1]);
    x2.fillStyle = rg2;
    x2.beginPath();
    x2.moveTo(x - wd / 2 - 14, y - hh / 2);
    x2.lineTo(x + wd / 2 + 14, y - hh / 2);
    x2.lineTo(x + wd / 2 - 12, y - hh / 2 - 42);
    x2.lineTo(x - wd / 2 + 12, y - hh / 2 - 42);
    x2.closePath(); x2.fill();
    x2.fillStyle = 'rgba(255,255,255,.16)';
    x2.beginPath();
    x2.moveTo(x - wd / 2 - 14, y - hh / 2); x2.lineTo(x - wd / 2 + 12, y - hh / 2 - 42);
    x2.lineTo(x - wd / 2 + 26, y - hh / 2 - 42); x2.lineTo(x - wd / 2 + 2, y - hh / 2);
    x2.closePath(); x2.fill();
    x2.fillStyle = 'rgba(0,0,0,.3)'; x2.fillRect(x - wd / 2 - 14, y - hh / 2 - 2, wd + 28, 5);
    // 門與窗
    x2.fillStyle = '#2e2118';
    x2.beginPath(); x2.moveTo(x - 13, y + hh / 2); x2.lineTo(x - 13, y + hh / 2 - 24); x2.arc(x, y + hh / 2 - 24, 13, Math.PI, 0); x2.lineTo(x + 13, y + hh / 2); x2.closePath(); x2.fill();
    x2.save(); x2.shadowColor = '#ffce7a'; x2.shadowBlur = 9;
    x2.fillStyle = '#ffd98a';
    x2.fillRect(x - wd / 2 + 16, y - 12, 18, 14); x2.fillRect(x + wd / 2 - 34, y - 12, 18, 14);
    x2.restore();
    x2.strokeStyle = '#5b4632'; x2.lineWidth = 2;
    x2.strokeRect(x - wd / 2 + 16, y - 12, 18, 14); x2.strokeRect(x + wd / 2 - 34, y - 12, 18, 14);
    // 招牌
    x2.font = '20px sans-serif'; x2.textAlign = 'center';
    x2.fillText(b.icon, x, y - hh / 2 - 50);
    const tw2 = b.label.length * 16 + 18;
    x2.fillStyle = 'rgba(20,14,8,.68)';
    x2.beginPath(); x2.roundRect(x - tw2 / 2, y + hh / 2 + 8, tw2, 24, 6); x2.fill();
    x2.strokeStyle = 'rgba(232,200,116,.5)'; x2.lineWidth = 1.5; x2.stroke();
    labelText(x2, b.label, x, y + hh / 2 + 25, 15, '#ffe9b0', 'rgba(0,0,0,0)');
  }

  // ---- 莊嚴復活點（天使石像＋聖光） ----
  const s = T.statue;
  const beam = x2.createLinearGradient(s.x, s.y - 210, s.x, s.y + 10);
  beam.addColorStop(0, 'rgba(255,244,190,0)'); beam.addColorStop(1, 'rgba(255,244,190,.34)');
  x2.fillStyle = beam;
  x2.beginPath(); x2.moveTo(s.x - 20, s.y + 8); x2.lineTo(s.x - 46, s.y - 210); x2.lineTo(s.x + 46, s.y - 210); x2.lineTo(s.x + 20, s.y + 8); x2.closePath(); x2.fill();
  x2.fillStyle = 'rgba(0,0,0,.3)'; x2.beginPath(); x2.ellipse(s.x + 4, s.y + 20, 52, 15, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#b9c2d4'; x2.beginPath(); x2.ellipse(s.x, s.y + 14, 48, 14, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#d3dbe8'; x2.beginPath(); x2.ellipse(s.x, s.y + 8, 48, 14, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#c5cedd'; x2.beginPath(); x2.ellipse(s.x, s.y + 2, 33, 10, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#e8edf5'; x2.fillRect(s.x - 8, s.y - 52, 16, 56);
  x2.beginPath(); x2.arc(s.x, s.y - 60, 13, 0, TAU); x2.fill();
  x2.fillStyle = '#f4f7fb';
  x2.beginPath(); x2.moveTo(s.x - 8, s.y - 50); x2.quadraticCurveTo(s.x - 46, s.y - 72, s.x - 34, s.y - 22); x2.closePath(); x2.fill();
  x2.beginPath(); x2.moveTo(s.x + 8, s.y - 50); x2.quadraticCurveTo(s.x + 46, s.y - 72, s.x + 34, s.y - 22); x2.closePath(); x2.fill();
  x2.save(); x2.shadowColor = '#fff3b8'; x2.shadowBlur = 14;
  x2.strokeStyle = '#ffedad'; x2.lineWidth = 2.5;
  x2.beginPath(); x2.arc(s.x, s.y - 76, 9, 0, TAU); x2.stroke(); x2.restore();
  labelText(x2, '復活點', s.x, s.y + 46, 15, '#fff6d8');

  // ---- 中央廣場（噴水池）----
  const p = T.plaza;
  x2.fillStyle = 'rgba(255,255,255,.05)'; x2.beginPath(); x2.arc(p.x, p.y, p.r, 0, TAU); x2.fill();
  x2.strokeStyle = 'rgba(0,0,0,.18)'; x2.lineWidth = 3;
  x2.beginPath(); x2.arc(p.x, p.y, p.r, 0, TAU); x2.stroke();
  x2.fillStyle = 'rgba(0,0,0,.3)'; x2.beginPath(); x2.ellipse(p.x + 6, p.y + 10, 62, 22, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#9aa3ad'; x2.beginPath(); x2.ellipse(p.x, p.y + 4, 60, 21, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#5f8fb0'; x2.beginPath(); x2.ellipse(p.x, p.y, 50, 17, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#8fc4e0'; x2.beginPath(); x2.ellipse(p.x - 8, p.y - 3, 28, 9, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#b8c0c9'; x2.fillRect(p.x - 7, p.y - 40, 14, 40);
  x2.beginPath(); x2.ellipse(p.x, p.y - 42, 20, 7, 0, 0, TAU); x2.fill();
  x2.save(); x2.globalAlpha = .55; x2.strokeStyle = '#cfe9f7'; x2.lineWidth = 3;
  for (const sd of [-1, 1]) {
    x2.beginPath(); x2.moveTo(p.x, p.y - 46);
    x2.quadraticCurveTo(p.x + sd * 30, p.y - 62, p.x + sd * 38, p.y - 6); x2.stroke();
  }
  x2.restore();
  for (let i = 0; i < 4; i++) { // 四座路燈
    const a = Math.PI / 4 + i * Math.PI / 2;
    const fx = p.x + Math.cos(a) * (p.r - 10), fy = p.y + Math.sin(a) * (p.r - 10);
    x2.fillStyle = '#4a4a52'; x2.fillRect(fx - 3, fy - 30, 6, 30);
    x2.save(); x2.shadowColor = '#ffd98a'; x2.shadowBlur = 14;
    x2.fillStyle = '#ffe6a8'; x2.beginPath(); x2.arc(fx, fy - 35, 6, 0, TAU); x2.fill(); x2.restore();
  }
  labelText(x2, '中央廣場', p.x, p.y - p.r - 12, 15, '#ffe9b0');

  // 城名
  const nm = `${md.townName}（1:200）`;
  x2.fillStyle = 'rgba(20,14,8,.6)';
  x2.beginPath(); x2.roundRect(T.cx - nm.length * 11 - 16, T.y0 - 46, nm.length * 22 + 32, 34, 8); x2.fill();
  labelText(x2, nm, T.cx, T.y0 - 21, 21, '#ffe9b0');
}

/* ============ BOSS 領地（遠離城鎮的鬥技場） ============ */
function drawBossArena(x2, md, R) {
  const a = md.bossArena;
  const theme = md.theme;
  const pal = {
    peak:    { floor: '#8b98a8', ring: '#5d6b7d', glow: '#7fd0ff', pillar: '#6e7c8c' },
    sanctum: { floor: '#3a2c56', ring: '#241a38', glow: '#b26eff', pillar: '#2c2144' },
    volcano: { floor: '#4a2f22', ring: '#2a1912', glow: '#ff7a1a', pillar: '#33221a' }
  }[theme];
  // 地坪
  x2.fillStyle = 'rgba(0,0,0,.4)'; x2.beginPath(); x2.ellipse(a.x + 10, a.y + 14, a.r + 12, (a.r + 12) * 0.78, 0, 0, TAU); x2.fill();
  const fg = x2.createRadialGradient(a.x, a.y, 20, a.x, a.y, a.r);
  fg.addColorStop(0, pal.floor); fg.addColorStop(1, pal.ring);
  x2.fillStyle = fg; x2.beginPath(); x2.ellipse(a.x, a.y, a.r, a.r * 0.82, 0, 0, TAU); x2.fill();
  // 環紋
  x2.strokeStyle = pal.glow; x2.globalAlpha = .35; x2.lineWidth = 4;
  for (let i = 1; i <= 3; i++) { x2.beginPath(); x2.ellipse(a.x, a.y, a.r - i * 46, (a.r - i * 46) * 0.82, 0, 0, TAU); x2.stroke(); }
  x2.globalAlpha = 1;
  // 破碎地磚
  for (let i = 0; i < 90; i++) {
    const ang = R() * TAU, rr = Math.sqrt(R()) * (a.r - 20);
    x2.fillStyle = 'rgba(0,0,0,.14)';
    x2.fillRect(a.x + Math.cos(ang) * rr - 11, a.y + Math.sin(ang) * rr * 0.82 - 6, 22, 12);
  }
  // 立體石柱環
  for (let i = 0; i < 8; i++) {
    const ang = i / 8 * TAU + 0.3;
    const px = a.x + Math.cos(ang) * (a.r - 24), py = a.y + Math.sin(ang) * (a.r - 24) * 0.82;
    const hgt = 62 + (i % 3) * 16;
    x2.fillStyle = 'rgba(0,0,0,.45)'; x2.beginPath(); x2.ellipse(px + 8, py + 8, 20, 8, 0, 0, TAU); x2.fill();
    x2.fillStyle = pal.pillar; x2.fillRect(px - 14, py - hgt, 28, hgt);
    x2.fillStyle = mixHex(pal.pillar, '#ffffff', 0.22); x2.fillRect(px - 14, py - hgt, 10, hgt);
    x2.fillStyle = mixHex(pal.pillar, '#ffffff', 0.35);
    x2.beginPath(); x2.ellipse(px, py - hgt, 14, 5, 0, 0, TAU); x2.fill();
    x2.save(); x2.shadowColor = pal.glow; x2.shadowBlur = 12;
    x2.fillStyle = pal.glow; x2.fillRect(px - 4, py - hgt * 0.62, 8, 16); x2.restore();
  }
  // 中央法陣
  x2.save(); x2.globalAlpha = .45; x2.strokeStyle = pal.glow; x2.lineWidth = 3;
  x2.beginPath(); x2.ellipse(a.x, a.y, 74, 60, 0, 0, TAU); x2.stroke();
  for (let i = 0; i < 5; i++) {
    const s1 = -Math.PI / 2 + i / 5 * TAU, s2 = -Math.PI / 2 + ((i + 2) % 5) / 5 * TAU;
    x2.beginPath();
    x2.moveTo(a.x + Math.cos(s1) * 74, a.y + Math.sin(s1) * 60);
    x2.lineTo(a.x + Math.cos(s2) * 74, a.y + Math.sin(s2) * 60);
    x2.stroke();
  }
  x2.restore();
  const bn = md.boss ? GAME.MOBS[md.boss].name : '';
  labelText(x2, '⚔ ' + a.name, a.x, a.y - a.r * 0.82 - 46, 21, '#ffcf9a');
  if (bn) labelText(x2, `【${bn}】的領地`, a.x, a.y - a.r * 0.82 - 22, 14, 'rgba(255,207,154,.85)');
}

/* ============ 中崙學園（1:500，精緻版） ============ */
function drawSchool(x2, R) {
  const S = GAME.SCHOOL;
  const W2 = 2240, H2 = 1600;
  // 草地
  const gg = x2.createLinearGradient(0, 0, 0, H2);
  gg.addColorStop(0, '#79b968'); gg.addColorStop(1, '#69ab58');
  x2.fillStyle = gg; x2.fillRect(0, 0, W2, H2);
  for (let y = 0; y < H2; y += 90) { x2.fillStyle = 'rgba(255,255,255,.045)'; if ((y / 90) % 2) x2.fillRect(0, y, W2, 90); }
  for (let i = 0; i < 260; i++) {
    x2.fillStyle = R() < .5 ? 'rgba(255,255,255,.05)' : 'rgba(30,80,30,.06)';
    x2.beginPath(); x2.ellipse(R() * W2, R() * H2, 14 + R() * 40, 8 + R() * 20, 0, 0, TAU); x2.fill();
  }
  // 步道
  const path = (x, y, w3, h3) => {
    x2.fillStyle = '#d9d3c2'; x2.fillRect(x, y, w3, h3);
    x2.strokeStyle = 'rgba(0,0,0,.15)'; x2.lineWidth = 2; x2.strokeRect(x, y, w3, h3);
  };
  path(1090, 420, 60, 1120);          // 中央南北向
  path(340, 750, 810, 56);            // 往操場
  path(1150, 750, 330, 56);           // 往主大樓入口
  path(500, 390, 650, 50);            // 北側連通

  // 操場（1:500）
  const tr = S.track;
  x2.fillStyle = 'rgba(0,0,0,.18)'; x2.beginPath(); x2.ellipse(tr.cx + 10, tr.cy + 12, tr.rx + 26, tr.ry + 26, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#d8cfc0'; x2.beginPath(); x2.ellipse(tr.cx, tr.cy, tr.rx + 24, tr.ry + 24, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#c05a3e'; x2.beginPath(); x2.ellipse(tr.cx, tr.cy, tr.rx, tr.ry, 0, 0, TAU); x2.fill();
  x2.strokeStyle = 'rgba(255,255,255,.75)'; x2.lineWidth = 2;
  for (let i = 1; i <= 5; i++) { x2.beginPath(); x2.ellipse(tr.cx, tr.cy, tr.rx - i * 13, tr.ry - i * 13, 0, 0, TAU); x2.stroke(); }
  x2.fillStyle = '#6fb85e'; x2.beginPath(); x2.ellipse(tr.cx, tr.cy, tr.rx - 80, tr.ry - 80, 0, 0, TAU); x2.fill();
  // 足球場
  x2.strokeStyle = 'rgba(255,255,255,.85)'; x2.lineWidth = 3;
  x2.strokeRect(tr.cx - 235, tr.cy - 135, 470, 270);
  x2.beginPath(); x2.arc(tr.cx, tr.cy, 52, 0, TAU); x2.stroke();
  x2.beginPath(); x2.moveTo(tr.cx, tr.cy - 135); x2.lineTo(tr.cx, tr.cy + 135); x2.stroke();
  x2.strokeRect(tr.cx - 235, tr.cy - 66, 42, 132); x2.strokeRect(tr.cx + 193, tr.cy - 66, 42, 132);
  // 看台
  for (let i = 0; i < 4; i++) {
    x2.fillStyle = i % 2 ? '#b9c2cc' : '#a6b0bc';
    x2.fillRect(tr.cx - 190 + i * 2, tr.cy - tr.ry - 66 + i * 12, 380 - i * 4, 12);
  }
  labelText(x2, '操場', tr.cx, tr.cy + tr.ry + 46, 16, '#fffbe8');

  // 北棟建築
  const building = (r, label) => {
    x2.fillStyle = 'rgba(0,0,0,.3)'; x2.fillRect(r.x0 + 10, r.y0 + 12, r.x1 - r.x0, r.y1 - r.y0);
    const bg2 = x2.createLinearGradient(0, r.y0, 0, r.y1);
    bg2.addColorStop(0, '#ded5c2'); bg2.addColorStop(1, '#c4baa6');
    x2.fillStyle = bg2; x2.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    x2.fillStyle = '#9c9384'; x2.fillRect(r.x0, r.y0, r.x1 - r.x0, 16); // 屋頂帶
    x2.fillStyle = '#6d675c'; x2.fillRect(r.x0, r.y0 + 16, r.x1 - r.x0, 4);
    x2.fillStyle = '#7c8ba0';
    for (let x = r.x0 + 18; x < r.x1 - 34; x += 46) for (let y = r.y0 + 34; y < r.y1 - 26; y += 42) {
      x2.fillRect(x, y, 28, 20);
      x2.fillStyle = 'rgba(255,255,255,.35)'; x2.fillRect(x, y, 28, 6); x2.fillStyle = '#7c8ba0';
    }
    labelText(x2, label, (r.x0 + r.x1) / 2, r.y1 + 28, 17, '#fffbe8');
  };
  building(S.northA, S.northA.label);
  building(S.northB, S.northB.label);

  // 籃球場
  for (const ct of S.courts) {
    x2.fillStyle = 'rgba(0,0,0,.2)'; x2.fillRect(ct.x0 + 6, ct.y0 + 8, ct.x1 - ct.x0, ct.y1 - ct.y0);
    x2.fillStyle = '#3f6f9e'; x2.fillRect(ct.x0, ct.y0, ct.x1 - ct.x0, ct.y1 - ct.y0);
    x2.fillStyle = '#4b81b5'; x2.fillRect(ct.x0 + 8, ct.y0 + 8, ct.x1 - ct.x0 - 16, ct.y1 - ct.y0 - 16);
    x2.strokeStyle = '#fff'; x2.lineWidth = 2;
    x2.strokeRect(ct.x0 + 8, ct.y0 + 8, ct.x1 - ct.x0 - 16, ct.y1 - ct.y0 - 16);
    x2.beginPath(); x2.moveTo((ct.x0 + ct.x1) / 2, ct.y0 + 8); x2.lineTo((ct.x0 + ct.x1) / 2, ct.y1 - 8); x2.stroke();
    x2.beginPath(); x2.arc((ct.x0 + ct.x1) / 2, (ct.y0 + ct.y1) / 2, 22, 0, TAU); x2.stroke();
    for (const bx of [ct.x0 + 8, ct.x1 - 8]) {
      x2.beginPath(); x2.arc(bx, (ct.y0 + ct.y1) / 2, 16, 0, TAU); x2.stroke();
    }
  }
  labelText(x2, '籃球場', (S.courts[0].x0 + S.courts[1].x1) / 2, S.courts[0].y1 + 26, 15, '#fffbe8');

  // ---- 主大樓（含 707 班王座）----
  const M = S.main;
  x2.fillStyle = 'rgba(0,0,0,.32)'; x2.fillRect(M.x0 + 12, M.y0 + 14, M.x1 - M.x0, M.y1 - M.y0);
  // 外牆
  const wallB = '#8b8272';
  x2.fillStyle = wallB; x2.fillRect(M.x0, M.y0, M.x1 - M.x0, M.y1 - M.y0);
  // 室內地板
  x2.fillStyle = '#ded7c8'; x2.fillRect(M.x0 + 40, M.y0 + 40, M.x1 - M.x0 - 80, M.y1 - M.y0 - 80);
  for (let y = M.y0 + 90; y < M.y1 - 40; y += 50) {
    x2.strokeStyle = 'rgba(0,0,0,.08)'; x2.lineWidth = 1.5;
    x2.beginPath(); x2.moveTo(M.x0 + 40, y); x2.lineTo(M.x1 - 40, y); x2.stroke();
  }
  // 走廊置物櫃
  x2.fillStyle = '#b0a790';
  for (let y = M.y0 + 60; y < M.y1 - 60; y += 80) x2.fillRect(M.x1 - 66, y, 22, 52);
  // 門口（西面缺口）
  x2.fillStyle = '#c9c2b2'; x2.fillRect(M.x0, M.doorY0, 40, M.doorY1 - M.doorY0);
  x2.fillStyle = '#d9d3c2'; x2.fillRect(M.x0 - 70, M.doorY0 + 10, 74, M.doorY1 - M.doorY0 - 20); // 入口平台
  labelText(x2, '◀ 大樓入口', M.x0 + 96, (M.doorY0 + M.doorY1) / 2 + 5, 14, '#544a38', 'rgba(255,255,255,.5)');
  // 牆頂高光
  x2.fillStyle = 'rgba(255,255,255,.18)'; x2.fillRect(M.x0, M.y0, M.x1 - M.x0, 10);
  labelText(x2, '中崙學園 主大樓', (M.x0 + M.x1) / 2, M.y0 - 16, 17, '#fffbe8');

  // 707 王座教室
  const r7 = S.room707;
  x2.fillStyle = 'rgba(0,0,0,.4)'; x2.fillRect(r7.x - 186, r7.y - 156, 372, 312);
  x2.fillStyle = '#6e1806'; x2.fillRect(r7.x - 180, r7.y - 150, 360, 300);
  x2.fillStyle = '#8e2408'; x2.fillRect(r7.x - 164, r7.y - 134, 328, 268);
  // 紅毯
  const cg2 = x2.createLinearGradient(r7.x - 164, 0, r7.x, 0);
  cg2.addColorStop(0, '#a8351263'); cg2.addColorStop(1, '#c04a18');
  x2.fillStyle = '#a52d0e'; x2.fillRect(r7.x - 164, r7.y - 26, 328, 52);
  x2.strokeStyle = '#ffd76e'; x2.lineWidth = 2;
  x2.strokeRect(r7.x - 160, r7.y - 22, 320, 44);
  // 王座
  x2.fillStyle = 'rgba(0,0,0,.4)'; x2.beginPath(); x2.ellipse(r7.x + 6, r7.y - 28, 66, 18, 0, 0, TAU); x2.fill();
  x2.fillStyle = '#3a2210'; x2.fillRect(r7.x - 52, r7.y - 118, 104, 34);
  x2.fillStyle = '#5a3316'; x2.fillRect(r7.x - 44, r7.y - 112, 88, 74);
  x2.fillStyle = '#764421'; x2.fillRect(r7.x - 44, r7.y - 112, 30, 74);
  x2.save(); x2.shadowColor = '#ffd76e'; x2.shadowBlur = 14;
  x2.fillStyle = '#ffd76e';
  x2.beginPath();
  x2.moveTo(r7.x - 34, r7.y - 118); x2.lineTo(r7.x - 22, r7.y - 146); x2.lineTo(r7.x - 8, r7.y - 120);
  x2.lineTo(r7.x, r7.y - 152); x2.lineTo(r7.x + 8, r7.y - 120); x2.lineTo(r7.x + 22, r7.y - 146); x2.lineTo(r7.x + 34, r7.y - 118);
  x2.closePath(); x2.fill(); x2.restore();
  // 兩側旗幟
  for (const sd of [-1, 1]) {
    const fx = r7.x + sd * 120;
    x2.fillStyle = '#4a1004';
    x2.beginPath(); x2.moveTo(fx - 16, r7.y - 130); x2.lineTo(fx + 16, r7.y - 130); x2.lineTo(fx + 16, r7.y - 52); x2.lineTo(fx, r7.y - 34); x2.lineTo(fx - 16, r7.y - 52); x2.closePath(); x2.fill();
    x2.strokeStyle = '#ffd76e'; x2.lineWidth = 2; x2.stroke();
    x2.save(); x2.shadowColor = '#ff8a2a'; x2.shadowBlur = 8;
    x2.fillStyle = '#ff9a2a'; x2.beginPath(); x2.arc(fx, r7.y - 86, 8, 0, TAU); x2.fill(); x2.restore();
  }
  const rg = x2.createRadialGradient(r7.x, r7.y - 40, 10, r7.x, r7.y - 40, 230);
  rg.addColorStop(0, 'rgba(255,122,26,.30)'); rg.addColorStop(1, 'rgba(255,122,26,0)');
  x2.fillStyle = rg; x2.fillRect(r7.x - 230, r7.y - 270, 460, 460);
  labelText(x2, '👑 ' + r7.label, r7.x, r7.y + 134, 19, '#ffe9b0');

  // 樹木
  for (let i = 0; i < 60; i++) {
    const x = 80 + R() * (W2 - 160), y = 80 + R() * (H2 - 160);
    const tx = Math.floor(x / 40), ty = Math.floor(y / 40);
    const { g, tw } = GAME.getGrid(3);
    if (g[ty * tw + tx]) continue;
    if (x > S.main.x0 - 60 && x < S.main.x1 + 40 && y > S.main.y0 - 40 && y < S.main.y1 + 40) continue;
    if ((x - tr.cx) ** 2 / ((tr.rx + 70) ** 2) + (y - tr.cy) ** 2 / ((tr.ry + 70) ** 2) < 1) continue;
    if (x > 1060 && x < 1180) continue;
    x2.fillStyle = 'rgba(0,0,0,.25)'; x2.beginPath(); x2.ellipse(x + 4, y + 5, 17, 7, 0, 0, TAU); x2.fill();
    x2.fillStyle = '#3f7c34'; x2.beginPath(); x2.arc(x, y - 6, 16, 0, TAU); x2.fill();
    x2.fillStyle = '#549a44'; x2.beginPath(); x2.arc(x - 4, y - 11, 11, 0, TAU); x2.fill();
  }
  // 校門
  const sp = S.spawn;
  for (const sd of [-1, 1]) {
    x2.fillStyle = 'rgba(0,0,0,.3)'; x2.fillRect(sp.x + sd * 90 - 8 + 4, sp.y - 66 + 6, 20, 66);
    x2.fillStyle = '#b8b0a0'; x2.fillRect(sp.x + sd * 90 - 10, sp.y - 66, 20, 66);
    x2.fillStyle = '#d3ccbc'; x2.fillRect(sp.x + sd * 90 - 10, sp.y - 66, 8, 66);
  }
  x2.fillStyle = '#8b8272'; x2.fillRect(sp.x - 100, sp.y - 78, 200, 18);
  labelText(x2, '中崙學園', sp.x, sp.y - 64, 15, '#fffbe8');
  labelText(x2, '中崙城鎮與學園區域', 1120, 64, 23, '#fffbe8');
}

/* ---------------- 攻擊動作 ---------------- */
const swings = {};            // id → { t0, ang }
const SWING_MS = 300;
const combatUntil = {};       // id → 何時脫離戰鬥（脫戰後收起武器）
const COMBAT_MS = 4000;
function startSwing(id, ang) { swings[id] = { t0: performance.now(), ang }; markCombat(id); }
function markCombat(id) { if (id) combatUntil[id] = performance.now() + COMBAT_MS; }
function inCombat(id) { return !!(id && combatUntil[id] > performance.now()); }

/* 揮舞中的武器（依職業畫出不同兵器） */
function drawSwingWeapon(g, cls, w2, h, prog, dir, qcol, tier) {
  const WP = GEAR_PAL[tier === undefined ? 0 : tier];
  const ease = prog < 0.35 ? (prog / 0.35) * -0.55 : -0.55 + ((prog - 0.35) / 0.65) * 2.5; // 先舉起再劈下
  g.save();
  g.translate(dir * w2 * 0.18, -h * 0.52);
  g.rotate(dir * ease);
  const glow = qcol || '#ffffff';
  g.shadowColor = glow; g.shadowBlur = 14;
  if (cls === 'warrior') {
    g.fillStyle = '#6b5236'; g.fillRect(-4, -4, 10, 8);                       // 握把
    g.fillStyle = WP.trim; g.fillRect(4, -9, 6, 18);                          // 護手
    const lg = g.createLinearGradient(10, 0, h * 0.62, 0);
    lg.addColorStop(0, WP.light); lg.addColorStop(0.5, WP.main); lg.addColorStop(1, WP.light);
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(10, -7); g.lineTo(h * 0.5, -5); g.lineTo(h * 0.62, 0); g.lineTo(h * 0.5, 5); g.lineTo(10, 7);
    g.closePath(); g.fill();
  } else if (cls === 'assassin') {
    g.fillStyle = '#3a3f4d'; g.fillRect(-3, -3, 9, 6);
    const lg = g.createLinearGradient(6, 0, h * 0.34, 0);
    lg.addColorStop(0, WP.main); lg.addColorStop(1, WP.light);
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(6, -5); g.lineTo(h * 0.3, -2); g.lineTo(h * 0.34, 0); g.lineTo(h * 0.3, 3); g.lineTo(6, 5);
    g.closePath(); g.fill();
  } else {
    g.strokeStyle = WP.main; g.lineWidth = 4;                                  // 弓身
    g.beginPath(); g.arc(0, 0, h * 0.28, -1.1, 1.1); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.5;                  // 弓弦
    const pull = (1 - Math.min(1, prog * 1.6)) * h * 0.16;
    g.beginPath();
    g.moveTo(Math.cos(-1.1) * h * 0.28, Math.sin(-1.1) * h * 0.28);
    g.lineTo(-pull, 0);
    g.lineTo(Math.cos(1.1) * h * 0.28, Math.sin(1.1) * h * 0.28);
    g.stroke();
  }
  g.restore();
}

/* 非戰鬥時把武器收在背上／腰間 */
function drawSheathed(g, wv, w2, h, dir, cls) {
  const P = GEAR_PAL[wv[0]];
  g.save();
  if (cls === 'archer') {                       // 弓背在背後
    g.translate(-dir * w2 * 0.12, -h * 0.52);
    g.rotate(dir * 0.55);
    g.strokeStyle = P.dark; g.lineWidth = 4;
    g.beginPath(); g.arc(0, 0, h * 0.19, -1.9, 1.9); g.stroke();
    g.strokeStyle = P.main; g.lineWidth = 2.2;
    g.beginPath(); g.arc(0, 0, h * 0.19, -1.9, 1.9); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.cos(-1.9) * h * 0.19, Math.sin(-1.9) * h * 0.19);
    g.lineTo(Math.cos(1.9) * h * 0.19, Math.sin(1.9) * h * 0.19); g.stroke();
  } else if (cls === 'assassin') {              // 匕首插在腰間
    g.translate(-dir * w2 * 0.20, -h * 0.42);
    g.rotate(dir * 1.15);
    g.fillStyle = '#2f333c'; g.fillRect(-2.5, -2, 5, 7);
    g.fillStyle = P.main;
    g.beginPath(); g.moveTo(-2.5, -3); g.lineTo(-1.6, -h * 0.15); g.lineTo(0, -h * 0.17);
    g.lineTo(1.6, -h * 0.15); g.lineTo(2.5, -3); g.closePath(); g.fill();
  } else {                                      // 長劍斜背在背上
    g.translate(-dir * w2 * 0.10, -h * 0.50);
    g.rotate(dir * -0.72);
    g.fillStyle = '#3a2a18'; g.fillRect(-3, 0, 6, 9);         // 握把
    g.fillStyle = P.trim; g.fillRect(-6, -3, 12, 4);          // 護手
    const gs = g.createLinearGradient(0, 0, 0, -h * 0.34);
    gs.addColorStop(0, P.main); gs.addColorStop(1, P.light);
    g.fillStyle = gs;
    g.beginPath(); g.moveTo(-3, -3); g.lineTo(-2, -h * 0.32); g.lineTo(0, -h * 0.36);
    g.lineTo(2, -h * 0.32); g.lineTo(3, -3); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.stroke();
  }
  g.restore();
}

/* ---------------- 紙娃娃：把裝備畫在身上 ---------------- */
function drawGearOnBody(g, vis, w2, h, dir, cls, hideWeapon, armed) {
  const now2 = performance.now();
  const piece = (v) => ({ P: GEAR_PAL[v[0]], q: v[1], plus: v[2], tier: v[0] });
  // 護腿
  if (vis.legs) {
    const { P, q, tier } = piece(vis.legs);
    g.fillStyle = P.main; g.strokeStyle = P.dark; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-w2 * 0.16, -h * 0.46); g.lineTo(w2 * 0.16, -h * 0.46);
    g.lineTo(w2 * 0.135, -h * 0.22); g.lineTo(w2 * 0.035, -h * 0.22);
    g.lineTo(w2 * 0.022, -h * 0.34); g.lineTo(-w2 * 0.022, -h * 0.34);
    g.lineTo(-w2 * 0.035, -h * 0.22); g.lineTo(-w2 * 0.135, -h * 0.22);
    g.closePath(); g.fill(); g.stroke();
    if (tier >= 3) { g.fillStyle = P.gem; g.beginPath(); g.arc(-w2 * 0.09, -h * 0.39, 1.8, 0, TAU); g.fill(); g.beginPath(); g.arc(w2 * 0.09, -h * 0.39, 1.8, 0, TAU); g.fill(); }
  }
  // 靴子
  if (vis.boots) {
    const { P, tier } = piece(vis.boots);
    g.fillStyle = P.main; g.strokeStyle = P.dark; g.lineWidth = 1.2;
    for (const sd of [-1, 1]) {
      g.beginPath();
      g.rect(sd * w2 * 0.035 - (sd < 0 ? w2 * 0.095 : 0), -h * 0.22, w2 * 0.095, h * 0.185);
      g.fill(); g.stroke();
    }
    g.fillStyle = P.trim; g.fillRect(-w2 * 0.14, -h * 0.045, w2 * 0.28, h * 0.028);
    if (tier >= 4) { g.fillStyle = P.gem; g.fillRect(-w2 * 0.115, -h * 0.17, w2 * 0.035, h * 0.035); g.fillRect(w2 * 0.08, -h * 0.17, w2 * 0.035, h * 0.035); }
  }
  // 胸甲＋肩甲
  if (vis.chest) {
    const { P, tier } = piece(vis.chest);
    const g1 = g.createLinearGradient(-w2 * 0.3, -h * 0.72, w2 * 0.3, -h * 0.42);
    g1.addColorStop(0, P.light); g1.addColorStop(0.5, P.main); g1.addColorStop(1, P.dark);
    g.fillStyle = g1; g.strokeStyle = P.dark; g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(-w2 * 0.145, -h * 0.72); g.lineTo(w2 * 0.145, -h * 0.72);
    g.lineTo(w2 * 0.19, -h * 0.65); g.lineTo(w2 * 0.165, -h * 0.46);
    g.lineTo(-w2 * 0.165, -h * 0.46); g.lineTo(-w2 * 0.19, -h * 0.65);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = P.trim;                                        // 肩甲
    g.beginPath(); g.ellipse(-w2 * 0.19, -h * 0.69, w2 * 0.085, h * 0.042, -0.3, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(w2 * 0.19, -h * 0.69, w2 * 0.085, h * 0.042, 0.3, 0, TAU); g.fill();
    if (tier >= 3) { g.fillStyle = P.gem; g.beginPath(); g.arc(0, -h * 0.635, w2 * 0.04, 0, TAU); g.fill(); }
    if (tier >= 5) {                                             // 龍鱗
      g.strokeStyle = P.gem; g.globalAlpha = .7; g.lineWidth = 1;
      for (let r = 0; r < 2; r++) for (let c2 = 0; c2 < 3; c2++) {
        g.beginPath(); g.arc(-w2 * 0.075 + c2 * w2 * 0.075, -h * 0.57 + r * h * 0.045, w2 * 0.037, 0.2, Math.PI - 0.2); g.stroke();
      }
      g.globalAlpha = 1;
    }
  }
  // 頭盔
  if (vis.helmet) {
    const { P, tier } = piece(vis.helmet);
    const hy = -h * 0.865, hw = w2 * 0.125;
    const g2 = g.createLinearGradient(-hw, hy - h * 0.06, hw, hy + h * 0.06);
    g2.addColorStop(0, P.light); g2.addColorStop(0.55, P.main); g2.addColorStop(1, P.dark);
    g.fillStyle = g2; g.strokeStyle = P.dark; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-hw, hy + h * 0.05);
    g.quadraticCurveTo(-hw, hy - h * 0.07, 0, hy - h * 0.07);
    g.quadraticCurveTo(hw, hy - h * 0.07, hw, hy + h * 0.05);
    g.lineTo(hw * 0.55, hy + h * 0.05); g.lineTo(hw * 0.55, hy + h * 0.005);
    g.lineTo(-hw * 0.55, hy + h * 0.005); g.lineTo(-hw * 0.55, hy + h * 0.05);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = P.trim; g.fillRect(-w2 * 0.015, hy - h * 0.05, w2 * 0.03, h * 0.055);  // 鼻樑
    if (tier >= 3) {                                              // 角
      g.fillStyle = P.trim;
      for (const sd of [-1, 1]) {
        g.beginPath();
        g.moveTo(sd * hw * 0.85, hy - h * 0.02);
        g.quadraticCurveTo(sd * hw * 1.9, hy - h * 0.055, sd * hw * 1.55, hy - h * 0.085);
        g.quadraticCurveTo(sd * hw * 1.15, hy - h * 0.045, sd * hw * 0.7, hy - h * 0.03);
        g.closePath(); g.fill();
      }
    }
    if (tier >= 4) withGlow(g, P.gem, 8, () => { g.fillStyle = P.gem; g.beginPath(); g.arc(0, hy - h * 0.028, w2 * 0.026, 0, TAU); g.fill(); });
  }
  // 武器（未揮舞時掛在手上）
  if (vis.weapon && !hideWeapon) {
    const { P, q, plus, tier } = piece(vis.weapon);
    if (armed === false) { drawSheathed(g, vis.weapon, w2, h, dir, cls); } else {
    const hx = dir * w2 * 0.34, hy = -h * 0.50;
    g.save(); g.translate(hx, hy); g.rotate(dir * 0.5);
    if (cls === 'archer') {
      g.strokeStyle = P.main; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, h * 0.15, -2.0, 2.0); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.cos(-2) * h * 0.15, Math.sin(-2) * h * 0.15);
      g.lineTo(Math.cos(2) * h * 0.15, Math.sin(2) * h * 0.15); g.stroke();
    } else {
      const L = cls === 'assassin' ? h * 0.2 : h * 0.36;
      g.fillStyle = '#3a2a18'; g.fillRect(-3, -2, 6, 8);
      g.fillStyle = P.trim; g.fillRect(-6, -5, 12, 4);
      const gw = g.createLinearGradient(0, 0, 0, -L);
      gw.addColorStop(0, P.main); gw.addColorStop(1, P.light);
      g.fillStyle = gw;
      g.beginPath(); g.moveTo(-3, -5); g.lineTo(-2, -L); g.lineTo(0, -L - 4); g.lineTo(2, -L); g.lineTo(3, -5);
      g.closePath(); g.fill();
      if (tier >= 3) { g.fillStyle = P.gem; g.beginPath(); g.arc(0, 2, 2.2, 0, TAU); g.fill(); }
    }
    g.restore();
    }
    if (plus >= 7) {                                              // 高強化光環
      g.strokeStyle = QCOLOR(q); g.globalAlpha = 0.35 + Math.sin(now2 / 180) * 0.22;
      g.lineWidth = 2; g.beginPath(); g.ellipse(0, -h * 0.06, w2 * 0.5, h * 0.07, 0, 0, TAU); g.stroke();
      g.globalAlpha = 1;
    }
  }
}

function drawChar(g, cls, x, y, h, dir, vis, hpRatio, name, lvl, deadFlag, wanted, isMe, swingId) {
  const img = SPRITES[GAME.CLASSES[cls].sprite];
  if (!img.complete) return;
  const w2 = img.width / img.height * h;
  const bob = Math.sin(performance.now() / 130 + x) * 1.5;
  // 揮砍狀態
  let sw = null;
  if (swingId && swings[swingId]) {
    const age = performance.now() - swings[swingId].t0;
    if (age < SWING_MS) sw = { p: age / SWING_MS };
    else delete swings[swingId];
  }
  g.save();
  g.translate(x, y + bob);
  if (deadFlag) g.globalAlpha = 0.35;
  g.fillStyle = '#00000055'; g.beginPath(); g.ellipse(0, 2, w2 * 0.34, 7, 0, 0, 7); g.fill();
  if (sw) { // 出招時身體前傾＋微微下蹲
    const lean = Math.sin(sw.p * Math.PI) * 0.16;
    g.translate(dir * Math.sin(sw.p * Math.PI) * w2 * 0.12, Math.sin(sw.p * Math.PI) * 3);
    g.rotate(dir * lean);
  }
  if (vis && vis.cape) {                                    // 披風（畫在身後，會飄動）
    const [tier, q] = vis.cape;
    const P = GEAR_PAL[tier];
    const sway = Math.sin(performance.now() / 240 + x * 0.02) * 4;
    const cx = -dir * w2 * 0.16;
    const cg = g.createLinearGradient(cx, -h * 0.78, cx, -h * 0.05);
    cg.addColorStop(0, P.main); cg.addColorStop(1, P.dark);
    g.fillStyle = cg; g.strokeStyle = P.dark; g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(cx - dir * w2 * 0.10, -h * 0.78);
    g.quadraticCurveTo(cx - dir * w2 * 0.52, -h * 0.5, cx - dir * w2 * 0.40 + sway, -h * 0.10);
    g.lineTo(cx - dir * w2 * 0.22 + sway * 0.6, -h * 0.18);
    g.lineTo(cx - dir * w2 * 0.14 + sway * 0.3, -h * 0.06);
    g.lineTo(cx + dir * w2 * 0.10, -h * 0.30);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = P.trim;                                   // 領扣
    g.fillRect(cx - dir * w2 * 0.14, -h * 0.80, w2 * 0.24, h * 0.04);
    if (tier >= 5) withGlow(g, P.gem, 10, () => {
      g.strokeStyle = P.gem; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx - dir * w2 * 0.34, -h * 0.44);
      g.quadraticCurveTo(cx - dir * w2 * 0.28, -h * 0.3, cx - dir * w2 * 0.34, -h * 0.16); g.stroke();
    });
  }
  g.scale(dir, 1);
  g.drawImage(img, -w2 / 2, -h, w2, h);
  g.scale(dir, 1);
  if (vis) drawGearOnBody(g, vis, w2, h, dir, cls, !!sw, swingId ? inCombat(swingId) : true);
  // 揮舞的武器（畫在最上層）
  if (sw) {
    const wq = vis && vis.weapon ? QCOLOR(vis.weapon[1]) : '#ffffff';
    drawSwingWeapon(g, cls, w2, h, sw.p, dir, wq, vis && vis.weapon ? vis.weapon[0] : 0);
  }
  g.restore();
  if (name !== undefined) {
    g.font = (isMe ? 'bold ' : '') + '12px sans-serif'; g.textAlign = 'center';
    g.fillStyle = isMe ? '#ffe9a0' : wanted ? '#ff8a80' : '#e7e9f2';
    g.strokeStyle = '#000a'; g.lineWidth = 3;
    const label = (wanted ? '☠ ' : '') + `Lv.${lvl} ${name}`;
    g.strokeText(label, x, y - h - 18); g.fillText(label, x, y - h - 18);
    g.fillStyle = '#000a'; g.fillRect(x - 24, y - h - 12, 48, 5);
    g.fillStyle = hpRatio > 0.35 ? '#5fd35f' : '#e04c3c';
    g.fillRect(x - 24, y - h - 12, 48 * Math.max(0, hpRatio), 5);
  }
}

function drawDoll() {
  const dc = $('#dollcv'), g = dc.getContext('2d');
  g.clearRect(0, 0, dc.width, dc.height);
  if (!meData) return;
  const vis = {};
  GAME.SLOTS.forEach((s) => {
    const it = meData.equip[s];
    if (it) vis[s] = [GAME.GEAR_TIERS[it.tier].tier, it.q, it.plus];
  });
  drawChar(g, myCls, dc.width / 2, dc.height - 24, 170, 1, vis, undefined);
  g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#e8c874';
  g.fillText(`${myName}　Lv.${meData.lvl} ${GAME.CLASSES[myCls].name}`, dc.width / 2, 16);
}

/* ---------------- 主渲染迴圈 ---------------- */
function lerp(a, b, t) { return a + (b - a) * t; }
function getInterp() {
  if (!stCur) return null;
  if (!stPrev) return { st: stCur, f: 1 };
  const span = Math.max(40, stCurAt - stPrevAt);
  const f = Math.min(1.35, (performance.now() - stCurAt) / span);
  return { st: stCur, prev: stPrev, f };
}
function ipos(cur, prevList, f, key = 'uid') {
  if (!prevList) return { x: cur.x, y: cur.y };
  const pv = prevList.find((p) => p[key] === cur[key]);
  if (!pv) return { x: cur.x, y: cur.y };
  return { x: lerp(pv.x, cur.x, Math.min(1, f)), y: lerp(pv.y, cur.y, Math.min(1, f)) };
}

let lastFrame = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const nowT = performance.now();
  const dt = Math.min(0.05, (nowT - lastFrame) / 1000);
  lastFrame = nowT;
  ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, W, H);
  if (!myId || !mapCanvas) return;
  const MW = GAME.MAPS[mapId].w, MH = GAME.MAPS[mapId].h;

  const it = getInterp();
  const meSrv = it && it.st.players.find((p) => p.id === myId);
  if (meSrv) {
    if (!me.snapped) { me.x = meSrv.x; me.y = meSrv.y; me.snapped = true; }
    if (!dead && (me.idx || me.idy)) {
      const sp = GAME.CLASSES[myCls].speed;
      const len = Math.hypot(me.idx, me.idy) || 1;
      const nx = me.x + me.idx / len * sp * dt, ny = me.y + me.idy / len * sp * dt;
      if (!GAME.blockedAt(mapId, nx, ny)) { me.x = nx; me.y = ny; }
      else if (!GAME.blockedAt(mapId, nx, me.y)) me.x = nx;
      else if (!GAME.blockedAt(mapId, me.x, ny)) me.y = ny;
    }
    const dx = meSrv.x - me.x, dy = meSrv.y - me.y;
    const d = Math.hypot(dx, dy);
    if (d > 160) { me.x = meSrv.x; me.y = meSrv.y; }
    else { me.x += dx * 0.08; me.y += dy * 0.08; }
    me.x = Math.max(40, Math.min(MW - 40, me.x));
    me.y = Math.max(40, Math.min(MH - 40, me.y));
  }

  camX = lerp(camX, Math.max(0, Math.min(MW - VW, me.x - VW / 2)), 0.12);
  camY = lerp(camY, Math.max(0, Math.min(MH - VH, me.y - VH / 2)), 0.12);
  if (MW < VW) camX = (MW - VW) / 2;
  if (MH < VH) camY = (MH - VH) / 2;
  let ox = 0, oy = 0;
  if (shakeAmt > 0.3) { ox = (Math.random() - 0.5) * shakeAmt; oy = (Math.random() - 0.5) * shakeAmt; shakeAmt *= 0.86; }

  ctx.save();
  ctx.scale(viewScale, viewScale);
  ctx.translate(-camX + ox, -camY + oy);
  ctx.drawImage(mapCanvas, 0, 0);

  if (it) {
    const st = it.st, f = it.f, pv = it.prev;
    for (const c of st.chests) {
      ctx.save(); ctx.translate(c.x, c.y);
      ctx.fillStyle = '#00000044'; ctx.beginPath(); ctx.ellipse(0, 8, 22, 7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = c.open ? '#5c4326' : '#8a6b3a';
      ctx.fillRect(-18, -12, 36, 22);
      ctx.fillStyle = c.open ? '#3a2c1a' : '#a5854e';
      ctx.fillRect(-18, -18, 36, 10);
      ctx.fillStyle = c.open ? '#333' : '#ffd76e'; ctx.fillRect(-3, -10, 6, 8);
      if (!c.open) {
        ctx.strokeStyle = '#ffd76e88'; ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5 + Math.sin(nowT / 300) * 0.3;
        ctx.strokeRect(-21, -21, 42, 34); ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    for (const d of st.drops) {
      const pulse = 0.6 + Math.sin(nowT / 250 + d.x) * 0.3;
      const col = d.q === 6 ? `hsl(${(nowT / 10) % 360},80%,70%)` : GAME.QUALITIES[d.q].color;
      ctx.save(); ctx.translate(d.x, d.y);
      const gr = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
      gr.addColorStop(0, col); gr.addColorStop(1, '#0000');
      ctx.globalAlpha = pulse; ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      const dimg = d.slot ? dropIcon(d) : null;
      if (dimg && dimg.complete) {
        const bobY = Math.sin(nowT / 400 + d.x) * 3;
        ctx.drawImage(dimg, -17, -20 + bobY, 34, 34);
      } else {
        ctx.fillStyle = col; ctx.strokeStyle = '#000';
        ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 0); ctx.lineTo(0, 10); ctx.lineTo(-8, 0); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = col; ctx.strokeStyle = '#000a'; ctx.lineWidth = 3;
      ctx.strokeText(d.name, 0, -16); ctx.fillText(d.name, 0, -16);
      ctx.restore();
    }
    // 依 Y 軸深度排序（後方的先畫，做出前後遮擋的立體感）
    const ents = [];
    for (const mb of st.mobs) ents.push({ y: mb.y, kind: 'mob', o: mb });
    for (const gd of st.guards) ents.push({ y: gd.y, kind: 'guard', o: gd });
    for (const pl of st.players) if (!pl.dead) ents.push({ y: pl.id === myId ? me.y : pl.y, kind: 'player', o: pl });
    ents.sort((a, b) => a.y - b.y);

    for (const ent of ents) {
      if (ent.kind === 'guard') {
        const gd = ent.o;
        const p = ipos(gd, pv && pv.guards, f);
        drawChar(ctx, 'warrior', p.x, p.y, 62, gd.dir || 1, { chest: [2, 2, 0], helmet: [2, 2, 0] }, gd.hp / gd.maxHp, '城鎮士兵', '⚔', false, false, false);
        continue;
      }
      if (ent.kind === 'player') {
        const pl = ent.o;
        const p = pl.id === myId ? { x: me.x, y: me.y } : ipos(pl, pv && pv.players, f, 'id');
        const dir = pl.id === myId ? me.dir : pl.dir;
        drawChar(ctx, pl.cls, p.x, p.y, 74, dir || 1, pl.vis, pl.hp / pl.maxHp, pl.name, pl.lvl, pl.dead, pl.wanted, pl.id === myId, pl.id);
        pl._x = p.x; pl._y = p.y;
        continue;
      }
      const mb = ent.o;
      const p = ipos(mb, pv && pv.mobs, f);
      const info = GAME.MOBS[mb.kind];
      const img = SPRITES[info.sprite];
      const hh = info.size * 1.5;
      if (img.complete) {
        const ww = img.width / img.height * hh;
        ctx.save(); ctx.translate(p.x, p.y);
        const fl = mobFlash[mb.uid] && nowT - mobFlash[mb.uid] < 120;
        ctx.fillStyle = '#00000055'; ctx.beginPath(); ctx.ellipse(0, 3, ww * 0.32, 8, 0, 0, 7); ctx.fill();
        ctx.scale(mb.dir || 1, 1);
        if (fl) ctx.filter = 'brightness(2.2)';
        if (mb.boss) {
          ctx.shadowColor = mb.boss === 'grand' ? '#ff5a1a' : '#c084ff';
          ctx.shadowBlur = 24 + Math.sin(nowT / 200) * 8;
        }
        ctx.drawImage(img, -ww / 2, -hh, ww, hh);
        ctx.restore();
        if (mb.po) {
          ctx.fillStyle = '#7ee06e';
          for (let j = 0; j < 3; j++) {
            const a = nowT / 300 + j * 2.1;
            ctx.globalAlpha = 0.7;
            ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * 16, p.y - hh * 0.6 + Math.sin(a * 1.3) * 10, 4, 0, 7); ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }
      const bw = mb.boss ? 90 : 44;
      ctx.font = (mb.boss ? 'bold 13px' : '11px') + ' sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = mb.boss ? '#ffb36e' : '#ffd2c8'; ctx.strokeStyle = '#000a'; ctx.lineWidth = 3;
      const lbl = `Lv.${info.lvl} ${info.name}`;
      ctx.strokeText(lbl, p.x, p.y - hh - 14); ctx.fillText(lbl, p.x, p.y - hh - 14);
      ctx.fillStyle = '#000a'; ctx.fillRect(p.x - bw / 2, p.y - hh - 9, bw, mb.boss ? 7 : 5);
      ctx.fillStyle = mb.rg ? '#4fd37a' : '#e04c3c';
      ctx.fillRect(p.x - bw / 2, p.y - hh - 9, bw * Math.max(0, mb.hp / mb.maxHp), mb.boss ? 7 : 5);
      if (mb.rg) { // 快速回血提示
        ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#7dff9b';
        ctx.strokeText('回血中…', p.x, p.y - hh - 26); ctx.fillText('回血中…', p.x, p.y - hh - 26);
      }
    }
    for (const pr of st.projectiles) {
      const p = ipos(pr, pv && pv.projectiles, f);
      const a = Math.atan2(pr.vy, pr.vx);
      ctx.save(); ctx.translate(p.x, p.y - 18); ctx.rotate(a);
      if (pr.bomb) {
        ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.fill();
        ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.stroke();
      } else {
        ctx.strokeStyle = '#e8d9a0'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(10, 0); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath();
        ctx.moveTo(12, 0); ctx.lineTo(6, -3); ctx.lineTo(6, 3); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    const age = nowT - e.t0;
    if (e.type === 'num') {
      if (age > 850) { effects.splice(i, 1); continue; }
      const prog = age / 850;
      ctx.globalAlpha = 1 - prog;
      ctx.font = (e.crit ? 'bold 26px' : 'bold 18px') + ' sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = e.ply ? '#ff6e6e' : e.crit ? '#ffd93b' : '#fff';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
      const yy = e.y - prog * 46;
      ctx.strokeText(e.val, e.x, yy); ctx.fillText(e.val, e.x, yy);
      if (e.crit) { ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#ffd93b'; ctx.fillText('爆擊!', e.x, yy - 22); }
      ctx.globalAlpha = 1;
    } else if (e.type === 'slash') {
      if (age > 160) { effects.splice(i, 1); continue; }
      const hp2 = holderPos(e.id);
      if (!hp2) continue;
      const prog = age / 160;
      ctx.save(); ctx.translate(hp2.x, hp2.y - 28); ctx.rotate(e.ang);
      ctx.strokeStyle = e.cls === 'assassin' ? '#9fe8ff' : '#ffffff';
      ctx.globalAlpha = (1 - prog) * 0.9; ctx.lineWidth = 4 - prog * 2;
      const r = e.cls === 'warrior' ? 78 : 56;
      ctx.beginPath(); ctx.arc(0, 0, r * (0.7 + prog * 0.4), -0.9 + prog * 0.5, 0.9 + prog * 0.5); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.type === 'whirl') {
      if (age > 520) { effects.splice(i, 1); continue; }
      const hp2 = holderPos(e.id);
      if (!hp2) continue;
      const prog = age / 520;
      ctx.save(); ctx.translate(hp2.x, hp2.y - 24);
      ctx.scale(1, 0.62);                                  // 俯視角壓扁
      ctx.rotate(prog * 11);
      ctx.shadowColor = '#ffd76e'; ctx.shadowBlur = 18;
      for (let j = 0; j < 4; j++) {                        // 多層刀光
        ctx.globalAlpha = (1 - prog) * (1 - j * 0.18);
        ctx.strokeStyle = j % 2 ? '#fff6d0' : '#ffc94a';
        ctx.lineWidth = 8 - j * 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, e.r * (0.35 + prog * 0.8) - j * 10, j * 1.6, j * 1.6 + 2.6);
        ctx.stroke();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.type === 'shock') {                        // 衝擊波環
      if (age > 420) { effects.splice(i, 1); continue; }
      const prog = age / 420;
      const c0 = e.id ? holderPos(e.id) : { x: e.x, y: e.y };
      if (!c0) continue;
      ctx.save(); ctx.translate(c0.x, c0.y - 16); ctx.scale(1, 0.55);
      ctx.globalAlpha = (1 - prog) * 0.85;
      ctx.strokeStyle = e.col; ctx.lineWidth = 7 * (1 - prog) + 1;
      ctx.shadowColor = e.col; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(0, 0, e.r * (0.25 + prog * 1.05), 0, TAU); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.type === 'trail') {
      if (age > 380) { effects.splice(i, 1); continue; }
      const prog = age / 380;
      ctx.save();
      ctx.globalAlpha = (1 - prog) * 0.85;
      ctx.shadowColor = e.col; ctx.shadowBlur = 20;
      ctx.strokeStyle = e.col; ctx.lineCap = 'round';
      ctx.lineWidth = 22 * (1 - prog);
      ctx.beginPath(); ctx.moveTo(e.x0, e.y0 - 26); ctx.lineTo(e.x1, e.y1 - 26); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6 * (1 - prog);
      ctx.beginPath(); ctx.moveTo(e.x0, e.y0 - 26); ctx.lineTo(e.x1, e.y1 - 26); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.type === 'ghost') {                        // 衝刺殘影
      if (age > 420) { effects.splice(i, 1); continue; }
      const prog = age / 420;
      const pl = stCur && stCur.players.find((q) => q.id === e.id);
      const cls = e.id === myId ? myCls : (pl && pl.cls);
      if (!cls) continue;
      ctx.save();
      for (let j = 1; j <= 3; j++) {
        const t2 = j / 4;
        ctx.globalAlpha = (1 - prog) * 0.3 * (1 - t2 * 0.4);
        const gx = e.x0 + (e.x1 - e.x0) * t2, gy = e.y0 + (e.y1 - e.y0) * t2;
        ctx.filter = 'saturate(0.2) brightness(1.4)';
        drawChar(ctx, cls, gx, gy, 74, e.x1 >= e.x0 ? 1 : -1, null, undefined);
      }
      ctx.restore(); ctx.globalAlpha = 1; ctx.filter = 'none';
    } else if (e.type === 'crossfx') {                      // 十字斬光
      if (age > 300) { effects.splice(i, 1); continue; }
      const prog = age / 300;
      ctx.save(); ctx.translate(e.x, e.y - 26);
      ctx.globalAlpha = 1 - prog;
      ctx.shadowColor = e.col; ctx.shadowBlur = 22;
      ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
      ctx.lineWidth = 7 * (1 - prog) + 2;
      const L = 40 + prog * 70;
      ctx.beginPath();
      ctx.moveTo(-L, -L * 0.6); ctx.lineTo(L, L * 0.6);
      ctx.moveTo(L, -L * 0.6); ctx.lineTo(-L, L * 0.6);
      ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.type === 'cone') {
      if (age > 420) { effects.splice(i, 1); continue; }
      const hp2 = holderPos(e.id);
      if (!hp2) continue;
      const prog = age / 420;
      ctx.save(); ctx.translate(hp2.x, hp2.y - 24); ctx.rotate(e.ang); ctx.scale(1, 0.7);
      const rr = e.r * (0.45 + prog * 0.7);
      const gr = ctx.createRadialGradient(0, 0, 6, 0, 0, rr);
      gr.addColorStop(0, 'rgba(190,255,170,.85)'); gr.addColorStop(0.6, 'rgba(110,220,110,.45)'); gr.addColorStop(1, 'rgba(60,160,60,0)');
      ctx.fillStyle = gr; ctx.globalAlpha = (1 - prog);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, rr, -0.85, 0.85); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#c9ff9a'; ctx.lineWidth = 3 * (1 - prog) + 1;
      ctx.beginPath(); ctx.arc(0, 0, rr, -0.85, 0.85); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.type === 'poisoncloud') {                  // 毒霧粒子
      if (age > 700) { effects.splice(i, 1); continue; }
      const hp2 = holderPos(e.id);
      if (!hp2) continue;
      const prog = age / 700;
      ctx.save(); ctx.globalAlpha = (1 - prog) * 0.55;
      for (let j = 0; j < 10; j++) {
        const a2 = e.ang + (j / 10 - 0.5) * 1.5;
        const rr = e.r * (0.3 + prog * 0.8) * (0.6 + (j % 3) * 0.2);
        ctx.fillStyle = j % 2 ? '#8fe07a' : '#5fbf55';
        ctx.beginPath();
        ctx.arc(hp2.x + Math.cos(a2) * rr, hp2.y - 24 + Math.sin(a2) * rr * 0.7, 10 + prog * 12, 0, TAU);
        ctx.fill();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.type === 'part') {                         // 粒子
      if (age > e.life) { effects.splice(i, 1); continue; }
      const prog = age / e.life, tt = age / 1000;
      ctx.globalAlpha = 1 - prog;
      ctx.fillStyle = e.col;
      ctx.shadowColor = e.col; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(e.x + e.vx * tt, e.y + e.vy * tt + 300 * tt * tt, e.sz * (1 - prog * 0.5), 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    } else if (e.type === 'boomfx') {
      if (age > 450) { effects.splice(i, 1); continue; }
      const prog = age / 450;
      ctx.globalAlpha = 1 - prog;
      const gr = ctx.createRadialGradient(e.x, e.y, 4, e.x, e.y, e.r * prog + 20);
      gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.5, '#ff9a2a'); gr.addColorStop(1, '#ff3a0000');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * prog + 20, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (e.type === 'puff') {
      if (age > 500) { effects.splice(i, 1); continue; }
      const prog = age / 500, n = e.big ? 14 : 7;
      ctx.globalAlpha = 1 - prog;
      for (let j = 0; j < n; j++) {
        const a = j / n * Math.PI * 2;
        const r = prog * (e.big ? 90 : 44);
        ctx.fillStyle = j % 2 ? '#ccc' : '#888';
        ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * r, e.y - 20 + Math.sin(a) * r, (e.big ? 12 : 7) * (1 - prog), 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (e.type === 'ring') {
      if (age > 900) { effects.splice(i, 1); continue; }
      const hp2 = e.id === myId ? { x: me.x, y: me.y } : { x: e.x, y: e.y };
      const prog = age / 900;
      ctx.globalAlpha = 1 - prog;
      ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 5 - prog * 4;
      ctx.beginPath(); ctx.arc(hp2.x, hp2.y - 20, 10 + prog * 70, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (e.type === 'heal') {
      if (age > 700) { effects.splice(i, 1); continue; }
      const hp2 = holderPos(e.id);
      if (!hp2) continue;
      const prog = age / 700;
      ctx.globalAlpha = 1 - prog;
      ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#7dff9b';
      for (let j = 0; j < 3; j++) ctx.fillText('+', hp2.x + (j - 1) * 16, hp2.y - 50 - prog * 40 - j * 8);
      ctx.globalAlpha = 1;
    } else if (e.type === 'spark') {
      if (age > 400) { effects.splice(i, 1); continue; }
      const prog = age / 400;
      ctx.globalAlpha = 1 - prog;
      ctx.fillStyle = '#ffe27a';
      for (let j = 0; j < 6; j++) {
        const a = j / 6 * Math.PI * 2 + prog * 2;
        ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * prog * 34, e.y + Math.sin(a) * prog * 34, 3, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  // 全螢幕閃光（爆炸等）
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    if (e.type !== 'flash') continue;
    const age = nowT - e.t0;
    if (age > 220) { effects.splice(i, 1); continue; }
    ctx.fillStyle = `rgba(${e.col},${(1 - age / 220) * 0.28})`;
    ctx.fillRect(0, 0, W, H);
  }

  if (W > 820 && mapId < 3 && GAME.inTownRect(mapId, me.x, me.y)) {
    ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#9fe8b0aa';
    ctx.fillText('🕊 城鎮區域 — 小怪不會進入（PvP 例外，城鎮殺人會被士兵追殺！）', W / 2, H - 150);
  }
  findInteract();
  drawMinimap();
}
requestAnimationFrame(frame);

/* ---------------- 小地圖 ---------------- */
const mmcv = $('#minimap'), mmg = mmcv.getContext('2d');
function drawMinimap() {
  if (!stCur || !mmBase) return;
  const MW = GAME.MAPS[mapId].w, MH = GAME.MAPS[mapId].h;
  const sx = mmcv.width / MW, sy = mmcv.height / MH;
  mmg.clearRect(0, 0, 150, 110);
  mmg.drawImage(mmBase, 0, 0);
  for (const mb of stCur.mobs) {
    mmg.fillStyle = mb.boss ? '#ff8a3b' : '#d05050';
    mmg.beginPath(); mmg.arc(mb.x * sx, mb.y * sy, mb.boss ? 3.5 : 1.6, 0, 7); mmg.fill();
  }
  for (const c of stCur.chests) {
    if (c.open) continue;
    mmg.fillStyle = '#ffd76e'; mmg.fillRect(c.x * sx - 1.5, c.y * sy - 1.5, 3, 3);
  }
  for (const pl of stCur.players) {
    mmg.fillStyle = pl.id === myId ? '#ffffff' : '#6ec0ff';
    mmg.beginPath(); mmg.arc((pl.id === myId ? me.x : pl.x) * sx, (pl.id === myId ? me.y : pl.y) * sy, 2.4, 0, 7); mmg.fill();
  }
  const md = GAME.MAPS[mapId];
  mmg.fillStyle = '#b06ef0';
  if (md.portalNext) mmg.fillRect(md.portalNext.x * sx - 2, md.portalNext.y * sy - 2, 4, 4);
  if (md.portalPrev) mmg.fillRect(md.portalPrev.x * sx - 2, md.portalPrev.y * sy - 2, 4, 4);
  if (md.centerPortal) { mmg.fillStyle = '#e779ff'; mmg.fillRect(md.centerPortal.x * sx - 3, md.centerPortal.y * sy - 3, 6, 6); }
}

connect();
