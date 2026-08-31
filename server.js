/* ============================================================
   龍領主 Online — 遊戲伺服器 v2
   Node.js + express + ws，伺服器權威模擬
   （迷宮地形碰撞、技能、鑰匙傳送門、中崙學園魔王）
   ============================================================ */
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const G = require('./public/shared/gamedata.js');   // 放在 public 內，Cloudflare 才吃得到

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ---------------- 資料庫 ----------------
   預設存在本機 data/db.json。
   若設定環境變數 DATABASE_URL（免費的 Neon / Supabase 等 Postgres），
   進度改存雲端資料庫 → Render 免費方案重新部署也不會遺失！ */
const DATABASE_URL = process.env.DATABASE_URL;
let pgClient = null;
let db = { accounts: {}, guests: {}, market: [] };

function loadFromFile() {
  try {
    if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) { console.error('讀取存檔失敗，使用空資料庫', e); }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
async function initStore() {
  if (DATABASE_URL) {
    const { Pool } = require('pg');
    const needSSL = !/localhost|127\.0\.0\.1/.test(DATABASE_URL);
    // 連線資訊診斷（不會印出密碼）
    try {
      const u = new URL(DATABASE_URL);
      const user = decodeURIComponent(u.username || '(未指定)');
      console.log(`→ 連線目標：主機=${u.hostname} 連接埠=${u.port || 5432} 使用者=${user} 資料庫=${u.pathname.slice(1)}`);
      if (/pooler\.supabase\.com/.test(u.hostname) && !user.includes('.')) {
        console.warn('⚠ 這是 Supabase pooler，但使用者名稱缺少專案代號（應為 postgres.專案代號）');
      }
      if (/^db\..*\.supabase\.co$/.test(u.hostname)) {
        console.warn('⚠ 你用的是 Supabase「Direct connection」，Render 無法連線（IPv6）。請改用 Connect → Session pooler 的字串。');
      }
      if (!u.password) console.warn('⚠ 連線字串沒有密碼');
      else if (/^\[.*\]$/.test(decodeURIComponent(u.password))) console.warn('⚠ 密碼還是 [YOUR-PASSWORD] 佔位符，請換成真正的密碼');
    } catch (e) {
      console.warn('⚠ DATABASE_URL 格式無法解析，請確認整串完整複製（開頭應為 postgresql://）');
    }
    // 用連線池：閒置斷線會自動重連（Supabase / Neon 都會在閒置時斷開）
    pgClient = new Pool({
      connectionString: DATABASE_URL,
      ssl: needSSL ? { rejectUnauthorized: false } : false,
      max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000
    });
    pgClient.on('error', (e) => console.error('資料庫連線中斷（將自動重連）：', e.message));
    await pgClient.query('CREATE TABLE IF NOT EXISTS savegame (id INT PRIMARY KEY, data TEXT NOT NULL)');
    const r = await pgClient.query('SELECT data FROM savegame WHERE id = 1');
    if (r.rows.length) {
      try { db = JSON.parse(r.rows[0].data); } catch (e) { console.error('雲端存檔解析失敗，使用空資料庫', e); }
    }
    console.log('✔ 已連接雲端資料庫（DATABASE_URL），玩家進度將永久保存');
  } else {
    loadFromFile();
    console.log('ℹ 使用本機檔案存檔 data/db.json（想永久保存進度可設定 DATABASE_URL，見 README）');
  }
  if (!db.accounts) db.accounts = {};
  if (!db.guests) db.guests = {};
  if (!Array.isArray(db.market)) db.market = [];   // 二手商店寄賣清單（跨重開機保存）
}

let dbDirty = false;
function saveDB() {
  if (!dbDirty) return;
  dbDirty = false;
  if (pgClient) {
    pgClient.query(
      'INSERT INTO savegame (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1',
      [JSON.stringify(db)]
    ).catch((e) => { console.error('雲端存檔失敗', e.message); dbDirty = true; });
  } else {
    fs.writeFile(DB_FILE, JSON.stringify(db), (e) => { if (e) console.error('存檔失敗', e); });
  }
}
setInterval(saveDB, 15000);
// 保持資料庫活躍（Supabase 免費方案閒置一週會自動暫停）
setInterval(() => {
  if (pgClient) pgClient.query('SELECT 1').catch(() => {});
}, 6 * 60 * 60 * 1000);
function flushExit() {
  if (pgClient) {
    pgClient.query(
      'INSERT INTO savegame (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1',
      [JSON.stringify(db)]
    ).then(() => process.exit(0)).catch(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  } else {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) {}
    process.exit(0);
  }
}
process.on('SIGINT', flushExit);
process.on('SIGTERM', flushExit);

function hashPass(pass, salt) { return crypto.scryptSync(String(pass), salt, 32).toString('hex'); }

/* ---------------- 小工具 ---------------- */
let uidCounter = 1;
const uid = () => (uidCounter++).toString(36) + Date.now().toString(36).slice(-4);
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => Date.now();

const inTown = (mi, x, y) => G.inTownRect(mi, x, y);
function respawnPoint(mi) {
  if (mi === 3) return { mapId: 2, x: G.TOWN.statue.x, y: G.TOWN.statue.y };  // 王的領域陣亡 → 回燼火鎮
  return { mapId: mi, x: G.TOWN.statue.x, y: G.TOWN.statue.y };
}
// 帶碰撞的移動（先試全移動，再試單軸滑行）
function tryMove(mi, x, y, nx, ny) {
  if (!G.blockedAt(mi, nx, ny)) return { x: nx, y: ny };
  if (!G.blockedAt(mi, nx, y)) return { x: nx, y };
  if (!G.blockedAt(mi, x, ny)) return { x, y: ny };
  return { x, y };
}
function randomOpenSpot(mi, filter) {
  const md = G.MAPS[mi];
  for (let i = 0; i < 300; i++) {
    const x = rnd(120, md.w - 120), y = rnd(120, md.h - 120);
    if (G.blockedAt(mi, x, y)) continue;
    if (filter && !filter(x, y)) continue;
    return { x, y };
  }
  return { x: md.w / 2, y: md.h / 2 };
}

/* ---------------- 裝備工廠 ---------------- */
function makeEquip(tierKey, slot, q, forClass) {
  const t = G.GEAR_TIERS[tierKey];
  const item = { uid: uid(), kind: 'equip', tier: tierKey, slot, q, plus: 0 };
  if (slot === 'weapon') {
    item.cls = forClass;
    item.name = G.WEAPON_SUFFIX[tierKey][forClass];
  } else item.name = t.name + G.SLOT_NAMES[slot];
  return item;
}
function equipStats(item) {
  const t = G.GEAR_TIERS[item.tier];
  const mul = G.QUALITIES[item.q].mul * (1 + item.plus * G.ENHANCE_BONUS);
  if (item.slot === 'weapon') return { atk: Math.floor(t.wAtk * mul), def: 0, hp: 0 };
  return { atk: 0, def: Math.floor(t.aDef * mul), hp: Math.floor(t.aHp * mul) };
}
function rollQuality(table) {
  let r = Math.random();
  for (const [q, p] of table) { if (r < p) return q; r -= p; }
  return table === G.BOSS_QUALITY_ROLL ? 1 : 0;
}
// BOSS 掉寶：品質由該 BOSS 固定（第1區＝金、第2區＝紅、大BOSS＝彩）
function bossDropItems(mobInfo, mainClass) {
  const dn = mobInfo.dropN || [1, 3];
  const n = rndi(dn[0], dn[1]);
  const items = [];
  const classes = ['warrior', 'archer', 'assassin'];
  for (let i = 0; i < n; i++) {
    const q = mobInfo.dropQ !== undefined ? mobInfo.dropQ : rollQuality(G.BOSS_QUALITY_ROLL);
    const slot = G.SLOTS[rndi(0, G.SLOTS.length - 1)];
    // 武器 80% 掉擊殺者可用的職業，避免撿到一堆不能裝的武器
    const forClass = (mainClass && Math.random() < 0.8) ? mainClass : classes[rndi(0, 2)];
    const it = makeEquip(mobInfo.gearTier, slot, q, forClass);
    it.boss = 1;                 // 標記為 BOSS 掉落：二手商店最低售價 150 萬
    items.push(it);
  }
  return items;
}

/* ---------------- 玩家數值 ---------------- */
function calcStats(p) {
  const c = G.CLASSES[p.cls];
  let atk = c.atkBase + p.lvl * c.atkPer;
  let def = 2 + p.lvl * 0.35;
  let hp = c.hpBase + p.lvl * c.hpPer;
  for (const s of G.SLOTS) {
    const it = p.equip[s];
    if (!it) continue;
    const st = equipStats(it);
    atk += st.atk; def += st.def; hp += st.hp;
  }
  def *= c.defMul;
  return { atk: Math.floor(atk), def: Math.floor(def), maxHp: Math.floor(hp) };
}

/* ---------------- 世界 ---------------- */
const world = G.MAPS.map(() => ({ mobs: [], drops: [], projectiles: [], guards: [], chests: [] }));

// 寶箱（隨機位置，開啟後 3 分鐘換地點重生）
function placeChest(mi, ch) {
  const md = G.MAPS[mi];
  // 每張圖的 0 號寶箱固定出現在奇觀（祭壇／王座）上
  if (md.landmark && ch.id.endsWith('_0')) {
    ch.x = md.landmark.x; ch.y = md.landmark.y - 10; ch.openAt = 0;
    return;
  }
  const pos = randomOpenSpot(mi, (x, y) => {
    if (inTown(mi, x, y)) return false;
    if (md.portalPrev && dist2(x, y, md.portalPrev.x, md.portalPrev.y) < 300 ** 2) return false;
    if (md.portalNext && dist2(x, y, md.portalNext.x, md.portalNext.y) < 300 ** 2) return false;
    if (md.centerPortal && dist2(x, y, md.centerPortal.x, md.centerPortal.y) < 300 ** 2) return false;
    return true;
  });
  ch.x = pos.x; ch.y = pos.y; ch.openAt = 0;
}
world.forEach((w, mi) => {
  for (let i = 0; i < G.MAPS[mi].chestN; i++) {
    const ch = { id: mi + '_' + i, x: 0, y: 0, openAt: 0 };
    placeChest(mi, ch);
    w.chests.push(ch);
  }
});

// 怪物 / BOSS 生成
function bossHome(mi) {
  if (mi === 3) return { x: G.SCHOOL.room707.x, y: G.SCHOOL.room707.y };
  const a = G.MAPS[mi].bossArena;
  return a ? { x: a.x, y: a.y } : { x: G.TOWN.plaza.x, y: G.TOWN.plaza.y };
}
function spawnMob(mapId, kind, isBoss) {
  const md = G.MOBS[kind];
  const m = G.MAPS[mapId];
  let x, y;
  if (isBoss) {
    const h = bossHome(mapId);
    x = h.x + rnd(-30, 30); y = h.y + rnd(-30, 30);
  } else {
    const idx = m.mobs.indexOf(kind);   // 低級怪在西半邊、高級怪在東半邊
    const xMin = idx === 1 ? m.w * 0.45 : 150;
    const xMax = idx === 1 ? m.w - 150 : m.w * 0.55;
    const pos = randomOpenSpot(mapId, (px, py) =>
      px >= xMin && px <= xMax && !inTown(mapId, px, py) &&
      !(m.centerPortal && dist2(px, py, m.centerPortal.x, m.centerPortal.y) < 350 ** 2));
    x = pos.x; y = pos.y;
  }
  const mul = md.mul || 1;
  const hp = G.mobHP(md.lvl) * mul;
  world[mapId].mobs.push({
    uid: uid(), kind, mapId, x, y, hx: x, hy: y,
    hp, maxHp: hp, atk: G.mobATK(md.lvl) * mul, lvl: md.lvl,
    boss: md.boss || null, atkAt: 0, dir: 1, wanderAt: 0, wx: x, wy: y, dead: false, poison: null
  });
}
world.forEach((w, mi) => {
  const m = G.MAPS[mi];
  m.mobs.forEach((k) => { for (let i = 0; i < G.MOB_COUNT_EACH; i++) spawnMob(mi, k, false); });
  if (m.boss) spawnMob(mi, m.boss, true);
});

/* ---------------- 連線 ---------------- */
const app = express();
app.set('trust proxy', true);

/* ---- 版本標記：讓瀏覽器每次更新後自動抓到新檔案（解決手機快取舊版） ---- */
function buildTag() {
  const h = crypto.createHash('md5');
  for (const f of ['public/client.js', 'public/index.html', 'public/shared/gamedata.js']) {
    try { h.update(String(fs.statSync(path.join(__dirname, f)).mtimeMs)); } catch (e) {}
  }
  return h.digest('hex').slice(0, 8);
}
const BUILD = buildTag();
console.log('遊戲版本（build）：' + BUILD);

app.get(['/', '/index.html'], (req, res) => {
  let html;
  try { html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'); }
  catch (e) { return res.status(500).send('index.html 讀取失敗'); }
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.type('html').send(html.replace(/__V__/g, BUILD));
});
app.get('/version', (req, res) => res.json({ build: BUILD }));

const staticOpts = {
  setHeaders(res, filePath) {
    if (/\.(js|css|html)$/i.test(filePath)) res.set('Cache-Control', 'no-cache');
    else res.set('Cache-Control', 'public, max-age=86400');
  }
};
app.use(express.static(path.join(__dirname, 'public'), staticOpts));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

const sockets = new Set();
const players = new Map();
const bots = [];                    // 每區的假人（AI 陪玩），行為與玩家相同但沒有連線
/* 世界中所有「像玩家的實體」＝真實玩家 ＋ 假人 */
function allPlayers() {
  const out = [];
  for (const ws of sockets) if (ws.player) out.push(ws.player);
  for (const b of bots) out.push(b);
  return out;
}
const accountSockets = new Map();
const chatHistory = [];             // 全服聊天記錄（最近 60 則）   // 帳號key → Set(連線)，確保一個帳號只有一個角色在線

function authKeyOf(ws) { return ws.auth ? (ws.auth.guest ? 'g:' : 'a:') + ws.auth.key : null; }
function bindAccount(ws) {
  const k = authKeyOf(ws);
  if (!k) return;
  if (!accountSockets.has(k)) accountSockets.set(k, new Set());
  accountSockets.get(k).add(ws);
}
function unbindAccount(ws) {
  const k = authKeyOf(ws);
  if (!k || !accountSockets.has(k)) return;
  const s = accountSockets.get(k);
  s.delete(ws);
  if (!s.size) accountSockets.delete(k);
}
/* 同帳號的其他連線一律踢下線（含把角色移出世界） */
function kickOthers(ws) {
  const k = authKeyOf(ws);
  if (!k || !accountSockets.has(k)) return;
  for (const other of [...accountSockets.get(k)]) {
    if (other === ws) continue;
    try {
      if (other.player) {
        persist(other);
        players.delete(other.player.id);
        broadcastMap(other.player.mapId, { t: 'bye', id: other.player.id });
        other.player = null;
      }
      send(other, { t: 'kicked', msg: '你的帳號已在其他裝置登入，此連線已中斷。' });
      setTimeout(() => { try { other.close(); } catch (e) {} }, 120);
    } catch (e) {}
    accountSockets.get(k).delete(other);
  }
}
/* 立刻把某個角色移出世界（回選角／登出用） */
function leaveWorld(ws, silent) {
  if (ws.player) { const tr = tradeOf(ws.player); if (tr) endTrade(tr, '對方離開了世界，交易取消。'); }
  if (!ws.player) return;
  setTimeout(pushRoster, 60);
  persist(ws);
  const p = ws.player;
  players.delete(p.id);
  broadcastMap(p.mapId, { t: 'bye', id: p.id });
  // 移除追殺他的士兵
  for (const w of world) w.guards = w.guards.filter((g) => g.targetId !== p.id);
  ws.player = null;
  if (!silent) {
    const acc = accountOf(ws);
    send(ws, { t: 'auth', ok: true, chars: (acc ? acc.chars : []).map(charSummary), back: true });
  }
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcastMap(mapId, obj) {
  const s = JSON.stringify(obj);
  for (const ws of sockets) if (ws.player && ws.player.mapId === mapId && ws.readyState === 1) ws.send(s);
}
function broadcastAll(obj) {
  if (obj.t === 'announce') {
    const line = { t: 'chat', sys: 1, msg: obj.msg };
    chatHistory.push(line);
    if (chatHistory.length > 60) chatHistory.shift();
  }
  const s = JSON.stringify(obj);
  for (const ws of sockets) if (ws.player && ws.readyState === 1) ws.send(s);
}
function ev(mapId, kind, data) { broadcastMap(mapId, Object.assign({ t: 'ev', kind }, data)); }

/* ---------------- 角色 ---------------- */
function newChar(cls, name) {
  const p = {
    id: uid(), name, cls, lvl: 1, xp: 0, gold: 200,
    mapId: 0, x: G.TOWN.statue.x + rnd(-50, 50), y: G.TOWN.statue.y + rnd(-40, 40), dir: 1,
    inv: [], equip: { weapon: null, helmet: null, chest: null, legs: null, boots: null, cape: null },
    arrows: cls === 'archer' ? 500 : 0, potions: 2, scrolls: 0, keys: 0, keyPity: 0,
    reborn: 0, bagExtra: 0,
    flags: {}, hp: 0, atkAt: 0, potionAt: 0, skillAt: [0, 0, 0], dead: false,
    input: { dx: 0, dy: 0 }, lastHurt: 0, guardUntil: 0, poison: null,
    pvpAt: 0, stealthUntil: 0, ambush: false, slowUntil: 0, slowMul: 1
  };
  p.equip.weapon = makeEquip('novice', 'weapon', 0, cls);
  p.hp = calcStats(p).maxHp;
  return p;
}
function serializeChar(p) {
  return {
    id: p.id, name: p.name, cls: p.cls, lvl: p.lvl, xp: p.xp, gold: p.gold,
    mapId: p.mapId, inv: p.inv, equip: p.equip,
    arrows: p.arrows, potions: p.potions, scrolls: p.scrolls, keys: p.keys, keyPity: p.keyPity,
    reborn: p.reborn || 0, bagExtra: p.bagExtra || 0,
    flags: p.flags
  };
}
function loadChar(saved) {
  const p = newChar(saved.cls, saved.name);
  Object.assign(p, {
    id: saved.id, lvl: saved.lvl, xp: saved.xp, gold: saved.gold, mapId: saved.mapId || 0,
    inv: saved.inv || [], equip: Object.assign(p.equip, saved.equip || {}),
    arrows: saved.arrows || 0, potions: saved.potions || 0, scrolls: saved.scrolls || 0,
    keys: saved.keys || 0, keyPity: saved.keyPity || 0, flags: saved.flags || {},
    reborn: saved.reborn || 0, bagExtra: saved.bagExtra || 0
  });
  if (p.mapId === 3 && !p.flags.portalOpen) p.mapId = 2;
  const rp = respawnPoint(p.mapId === 3 ? 2 : p.mapId);
  if (p.mapId === 3) { p.x = G.SCHOOL.spawn.x; p.y = G.SCHOOL.spawn.y; }
  else { p.mapId = rp.mapId; p.x = rp.x + rnd(-50, 50); p.y = rp.y + rnd(-40, 40); }
  p.hp = calcStats(p).maxHp;
  return p;
}
function invCap(p) { return G.bagCap(p.bagExtra || 0); }
function invFull(p) { return p.inv.length >= invCap(p); }

function accountOf(ws) {
  if (ws.auth.guest) {
    if (!db.guests[ws.auth.key]) db.guests[ws.auth.key] = { chars: [] };
    return db.guests[ws.auth.key];
  }
  return db.accounts[ws.auth.key];
}
function persist(ws) {
  if (!ws.player || !ws.auth) return;
  const acc = accountOf(ws);
  if (!acc) return;
  const i = acc.chars.findIndex((c) => c.id === ws.player.id);
  const data = serializeChar(ws.player);
  if (i >= 0) acc.chars[i] = data; else acc.chars.push(data);
  dbDirty = true;
}

/* ---------------- 戰鬥 ---------------- */
function giveXP(p, amount) {
  if (p.lvl >= G.LEVEL_CAP) return;
  if (p.reborn) amount = Math.floor(amount * G.REBIRTH_XP_MUL);   // 一轉後經驗 150%
  p.xp += amount;
  let leveled = false;
  while (p.lvl < G.LEVEL_CAP && p.xp >= G.xpNeed(p.lvl)) {
    p.xp -= G.xpNeed(p.lvl); p.lvl++; leveled = true;
  }
  if (leveled) {
    p.hp = calcStats(p).maxHp;
    ev(p.mapId, 'levelup', { id: p.id, lvl: p.lvl, x: p.x, y: p.y });
  }
}

function dropToGround(mapId, x, y, item) {
  world[mapId].drops.push({ uid: uid(), x: x + rnd(-45, 45), y: y + rnd(-45, 45), item, bornAt: now() });
}

function killMob(mapId, mob, killer) {
  mob.dead = true;
  const md = G.MOBS[mob.kind];
  const w = world[mapId];
  if (killer && killer.ws) {
    const xpMul = mob.boss === 'grand' ? G.XP_MUL_GRAND : mob.boss === 'mini' ? G.XP_MUL_MINI : 1;
    giveXP(killer, Math.floor(G.mobXP(md.lvl) * xpMul));
    const gold = rndi(md.gold[0], md.gold[1]);
    killer.gold += gold;
    send(killer.ws, { t: 'loot', gold });
  }
  if (mob.boss && killer && killer.ws) {
    for (const item of bossDropItems(md, killer.cls)) dropToGround(mapId, mob.x, mob.y, item);
    if (md.memento && !killer.flags[mob.kind]) {
      killer.flags[mob.kind] = true;
      killer.inv.push({ uid: uid(), kind: 'memento', id: md.memento.id, name: md.memento.name, desc: md.memento.desc, untradeable: true });
      send(killer.ws, { t: 'memento', name: md.memento.name, desc: md.memento.desc });
    }
    if (mob.kind === 'dragon' && !killer.flags.dragon) killer.flags.dragon = true;
    broadcastAll({ t: 'announce', msg: `⚔ ${killer.name} 擊敗了【${md.name}】！` });
  }
  ev(mapId, 'die', { x: mob.x, y: mob.y, kind: mob.kind });
  const delay = mob.boss ? md.respawn : G.MOB_RESPAWN;
  const isBoss = !!mob.boss;
  setTimeout(() => {
    const idx = w.mobs.indexOf(mob);
    if (idx >= 0) w.mobs.splice(idx, 1);
    spawnMob(mapId, mob.kind, isBoss);
  }, delay);
}

function damageMob(mapId, mob, dmg, attacker, opts) {
  if (mob.dead) return;
  mob.hp -= dmg;
  mob.lastFight = now();
  ev(mapId, 'dmg', { x: mob.x, y: mob.y - 20, val: Math.floor(dmg), crit: (opts && opts.crit) || false, mob: mob.uid });
  if (mob.hp <= 0) killMob(mapId, mob, attacker);
}

function damagePlayer(victim, dmg, source) {
  if (victim.dead) return;
  // 假人：被玩家主動攻擊 → 反擊該玩家 20 秒
  if (victim.bot && source && source.type === 'player' && source.ref) {
    victim.grudgeId = source.ref.id;
    victim.grudgeUntil = now() + 20000;
  }
  // 玩家互毆 → 雙方 20 秒內不能住旅店
  if (source && source.type === 'player' && source.ref) {
    victim.pvpAt = now();
    source.ref.pvpAt = now();
  }
  const def = calcStats(victim).def;
  const eff = Math.max(1, Math.floor(dmg * (100 / (100 + def)) * rnd(0.9, 1.1)));
  victim.hp -= eff;
  victim.lastHurt = now();
  ev(victim.mapId, 'dmg', { x: victim.x, y: victim.y - 30, val: eff, ply: victim.id });
  if (victim.hp <= 0) {
    victim.hp = 0; victim.dead = true; victim.poison = null;
    ev(victim.mapId, 'pdie', { id: victim.id, x: victim.x, y: victim.y });
    if (source.type === 'player') {
      const killer = source.ref;
      broadcastAll({ t: 'announce', msg: `☠ ${killer.name} 擊殺了 ${victim.name}！` });
      if (Math.abs(killer.lvl - victim.lvl) <= G.PVP_LEVEL_RANGE && Math.random() < G.PVP_DROP_CHANCE) {
        const pool = [];
        for (const s of G.SLOTS) if (victim.equip[s]) pool.push({ from: 'equip', slot: s });
        victim.inv.forEach((it, i) => { if (it.kind === 'equip') pool.push({ from: 'inv', i }); });
        if (pool.length) {
          const pick = pool[rndi(0, pool.length - 1)];
          let item;
          if (pick.from === 'equip') { item = victim.equip[pick.slot]; victim.equip[pick.slot] = null; }
          else { item = victim.inv.splice(pick.i, 1)[0]; }
          dropToGround(victim.mapId, victim.x, victim.y, item);
          if (victim.ws) send(victim.ws, { t: 'msg', msg: `你掉落了【${item.name}】！` });
        }
      }
      if (inTown(victim.mapId, victim.x, victim.y)) spawnGuards(killer);
    }
    if (victim.bot) { victim.respawnAt = now() + G.DUMMY_RESPAWN; setTimeout(pushRoster, 60); }
    else {
      const tr = tradeOf(victim); if (tr) endTrade(tr, '有人陣亡，交易取消。');
      send(victim.ws, { t: 'dead' });
    }
  }
}

function spawnGuards(killer) {
  const mapId = killer.mapId;
  if (mapId === 3) return; // 王的領域沒有城鎮士兵
  const w = world[mapId];
  w.guards = w.guards.filter((g) => g.targetId !== killer.id);
  const s = G.TOWN.statue;
  for (let i = 0; i < G.GUARD_COUNT; i++) {
    const ang = (i / G.GUARD_COUNT) * Math.PI * 2;
    w.guards.push({
      uid: uid(), targetId: killer.id, lvl: killer.lvl,
      x: s.x + Math.cos(ang) * 90, y: s.y + Math.sin(ang) * 90,
      hp: G.mobHP(killer.lvl) * 2, maxHp: G.mobHP(killer.lvl) * 2,
      atk: G.mobATK(killer.lvl) * 1.6, atkAt: 0, until: now() + G.GUARD_DURATION, dir: 1
    });
  }
  killer.guardUntil = now() + G.GUARD_DURATION;
  broadcastMap(mapId, { t: 'announce', msg: `🛡 ${killer.name} 在城鎮中行兇，士兵出動追殺！` });
}

/* ---- 對區域內所有敵人造成傷害（技能用，隔牆無效） ---- */
function hitArea(p, cx, cy, radius, dmg, opts) {
  const w = world[p.mapId];
  let hit = 0;
  for (const mob of w.mobs) {
    if (mob.dead) continue;
    const r = radius + G.MOBS[mob.kind].size * 0.6;
    if (dist2(cx, cy, mob.x, mob.y) > r * r) continue;
    if (!G.hasLOS(p.mapId, cx, cy, mob.x, mob.y)) continue;
    damageMob(p.mapId, mob, dmg * rnd(0.9, 1.1), p, opts);
    if (opts && opts.poison) mob.poison = { left: opts.poison.ticks, dmg: opts.poison.dmg, owner: p.id, nextAt: now() + 1000 };
    if (opts && opts.knock) knockBack(p.mapId, mob, cx, cy, opts.knock);
    hit++;
  }
  for (const g of [...w.guards]) {
    if (dist2(cx, cy, g.x, g.y) > (radius + 30) ** 2) continue;
    if (!G.hasLOS(p.mapId, cx, cy, g.x, g.y)) continue;
    g.hp -= dmg; ev(p.mapId, 'dmg', { x: g.x, y: g.y - 25, val: Math.floor(dmg) });
    if (g.hp <= 0) w.guards.splice(w.guards.indexOf(g), 1);
    hit++;
  }
  for (const q of allPlayers()) {
    if (q === p || q.mapId !== p.mapId || q.dead) continue;
    if (dist2(cx, cy, q.x, q.y) > (radius + 26) ** 2) continue;
    if (!G.hasLOS(p.mapId, cx, cy, q.x, q.y)) continue;
    damagePlayer(q, dmg, { type: 'player', ref: p });
    if (opts && opts.knock) knockBack(p.mapId, q, cx, cy, opts.knock);
    hit++;
  }
  return hit;
}
/* 把目標從 (cx,cy) 往外推 dist 距離（碰到地形就停下） */
function knockBack(mapId, ent, cx, cy, dist) {
  const dx = ent.x - cx, dy = ent.y - cy;
  const d = Math.hypot(dx, dy) || 1;
  const step = 12, steps = Math.max(1, Math.round(dist / step));
  for (let i = 0; i < steps; i++) {
    const nx = ent.x + (dx / d) * step, ny = ent.y + (dy / d) * step;
    if (G.blockedAt(mapId, nx, ny)) break;
    ent.x = nx; ent.y = ny;
  }
}

/* ---- 隱身現形（攻擊或放技能時呼叫） ---- */
function breakStealth(p) {
  if (p.stealthUntil && p.stealthUntil > now()) {
    p.stealthUntil = 0;
    ev(p.mapId, 'reveal', { id: p.id, x: p.x, y: p.y });
  }
}

/* ---------------- 普通攻擊 ---------------- */
function playerAttack(p, aim) {
  const c = G.CLASSES[p.cls];
  const t = now();
  if (p.dead || t - p.atkAt < c.atkCd) return;
  p.atkAt = t;
  if (c.usesArrows) {
    if (p.arrows <= 0) { if (p.ws) send(p.ws, { t: 'msg', msg: '箭矢用完了！回城鎮商店購買（1 金幣/支）' }); return; }
    p.arrows--;
  }
  const st = calcStats(p);
  const ang = Math.atan2(aim.y, aim.x);
  p.dir = aim.x >= 0 ? 1 : -1;
  ev(p.mapId, 'atk', { id: p.id, cls: p.cls, ang });

  let crit = Math.random() < c.crit;
  let ambushMul = 1;
  if (p.ambush) {                       // 隱身後的第一次普攻：370% 必定爆擊感
    const sk3 = G.REBIRTH_SKILLS[p.cls];
    ambushMul = (sk3 && sk3.ambush) || 1;
    p.ambush = false; crit = true;
    ev(p.mapId, 'ambush', { id: p.id, x: p.x, y: p.y });
  }
  breakStealth(p);                      // 普攻會現形
  const dmg = st.atk * c.dmgMul * ambushMul * (crit ? (c.critMul || 2.0) : 1) * rnd(0.9, 1.1);

  if (p.cls === 'archer') {
    world[p.mapId].projectiles.push({
      uid: uid(), owner: p.id, x: p.x, y: p.y - 20,
      vx: Math.cos(ang) * 620, vy: Math.sin(ang) * 620,
      dmg, left: c.range, crit
    });
    return;
  }
  // 近戰扇形（隔牆無效）
  const w = world[p.mapId];
  for (const mob of w.mobs) {
    if (mob.dead) continue;
    const r = c.range + G.MOBS[mob.kind].size;
    if (dist2(p.x, p.y, mob.x, mob.y) > r * r) continue;
    const ma = Math.atan2(mob.y - p.y, mob.x - p.x);
    let da = Math.abs(ma - ang); if (da > Math.PI) da = Math.PI * 2 - da;
    if (da > c.arc / 2 + 0.35) continue;
    if (!G.hasLOS(p.mapId, p.x, p.y, mob.x, mob.y)) continue;
    damageMob(p.mapId, mob, dmg, p, { crit });
  }
  for (const g of [...w.guards]) {
    if (dist2(p.x, p.y, g.x, g.y) > (c.range + 30) ** 2) continue;
    if (!G.hasLOS(p.mapId, p.x, p.y, g.x, g.y)) continue;
    g.hp -= dmg; ev(p.mapId, 'dmg', { x: g.x, y: g.y - 25, val: Math.floor(dmg), crit });
    if (g.hp <= 0) w.guards.splice(w.guards.indexOf(g), 1);
  }
  for (const q of allPlayers()) {
    if (q === p || q.mapId !== p.mapId || q.dead) continue;
    if (dist2(p.x, p.y, q.x, q.y) > (c.range + 26) ** 2) continue;
    const ma = Math.atan2(q.y - p.y, q.x - p.x);
    let da = Math.abs(ma - ang); if (da > Math.PI) da = Math.PI * 2 - da;
    if (da > c.arc / 2 + 0.35) continue;
    if (!G.hasLOS(p.mapId, p.x, p.y, q.x, q.y)) continue;
    damagePlayer(q, dmg, { type: 'player', ref: p });
  }
}

/* ---------------- 技能 ---------------- */
function castSkill(p, idx, aim) {
  const sk = G.skillsOf(p.cls, p.reborn)[idx];
  if (!sk || p.dead) return;
  const t = now();
  if (!p.skillAt[idx]) p.skillAt[idx] = 0;
  if (t - p.skillAt[idx] < sk.cd) return;
  if (sk.type !== 'stealth') breakStealth(p);   // 放技能會現形
  if (sk.arrows) {
    if (p.arrows < sk.arrows) { if (p.ws) send(p.ws, { t: 'msg', msg: `箭矢不足（需要 ${sk.arrows} 支）` }); return; }
    p.arrows -= sk.arrows;
  }
  p.skillAt[idx] = t;
  const st = calcStats(p);
  const c = G.CLASSES[p.cls];
  const base = st.atk * sk.mul;
  const ang = Math.atan2(aim.y, aim.x) || 0;
  p.dir = aim.x >= 0 ? 1 : -1;

  switch (sk.type) {
    case 'aoe': { // 旋風斬
      ev(p.mapId, 'whirl', { id: p.id, r: sk.radius });
      hitArea(p, p.x, p.y, sk.radius, base);
      break;
    }
    case 'dash': { // 衝鋒
      const x0 = p.x, y0 = p.y;
      let x = p.x, y = p.y;
      const step = 18, n = Math.floor(sk.dist / step);
      for (let i = 0; i < n; i++) {
        const nx = x + Math.cos(ang) * step, ny = y + Math.sin(ang) * step;
        if (G.blockedAt(p.mapId, nx, ny)) break;
        x = nx; y = ny;
      }
      p.x = x; p.y = y;
      ev(p.mapId, 'dash', { id: p.id, x0, y0, x1: x, y1: y });
      hitArea(p, x, y, sk.radius, base);
      break;
    }
    case 'multi': { // 三連矢
      ev(p.mapId, 'atk', { id: p.id, cls: p.cls, ang });
      for (let i = 0; i < sk.count; i++) {
        const a = ang + (i - (sk.count - 1) / 2) * sk.spread;
        world[p.mapId].projectiles.push({
          uid: uid(), owner: p.id, x: p.x, y: p.y - 20,
          vx: Math.cos(a) * 620, vy: Math.sin(a) * 620,
          dmg: base * rnd(0.9, 1.1), left: c.range
        });
      }
      break;
    }
    case 'bomb': { // 爆裂箭
      ev(p.mapId, 'atk', { id: p.id, cls: p.cls, ang });
      world[p.mapId].projectiles.push({
        uid: uid(), owner: p.id, x: p.x, y: p.y - 20,
        vx: Math.cos(ang) * 560, vy: Math.sin(ang) * 560,
        dmg: base, left: c.range, bomb: sk.radius
      });
      break;
    }
    case 'blink': { // 影襲
      const x0 = p.x, y0 = p.y;
      let x = p.x, y = p.y;
      const step = 18, n = Math.floor(sk.dist / step);
      for (let i = 0; i < n; i++) {
        const nx = x + Math.cos(ang) * step, ny = y + Math.sin(ang) * step;
        if (G.blockedAt(p.mapId, nx, ny)) break;
        x = nx; y = ny;
      }
      p.x = x; p.y = y;
      ev(p.mapId, 'blink', { id: p.id, x0, y0, x1: x, y1: y });
      hitArea(p, x, y, sk.radius, base, { crit: true });
      break;
    }
    case 'slam': {   // 【戰士・震地斬】跳起插劍、大範圍爆擊並擊退
      const crit = Math.random() < sk.crit;
      const dmg = base * (crit ? (c.critMul || 2.0) : 1);
      ev(p.mapId, 'slam', { id: p.id, x: p.x, y: p.y, r: sk.radius });
      hitArea(p, p.x, p.y, sk.radius, dmg, { crit, knock: sk.knock });
      break;
    }
    case 'slowshot': { // 【射手・緩速箭】不耗箭矢，命中減速
      const crit = Math.random() < sk.crit;
      ev(p.mapId, 'atk', { id: p.id, cls: p.cls, ang });
      world[p.mapId].projectiles.push({
        uid: uid(), owner: p.id, x: p.x, y: p.y - 20,
        vx: Math.cos(ang) * 640, vy: Math.sin(ang) * 640,
        dmg: base * (crit ? (c.critMul || 2.0) : 1), left: c.range * 1.2, crit,
        slow: { mul: sk.slowMul, ms: sk.slowMs }, ice: 1
      });
      break;
    }
    case 'stealth': {  // 【刺客・隱身突襲】隱身 3 秒＋下一次普攻 370%
      p.stealthUntil = t + sk.dur;
      p.ambush = true;
      ev(p.mapId, 'vanish', { id: p.id, x: p.x, y: p.y });
      break;
    }
    case 'cone': { // 毒刃
      ev(p.mapId, 'cone', { id: p.id, ang, r: sk.radius });
      const w = world[p.mapId];
      const poison = { ticks: sk.poison.ticks, dmg: st.atk * sk.poison.mul };
      for (const mob of w.mobs) {
        if (mob.dead) continue;
        const r = sk.radius + G.MOBS[mob.kind].size * 0.6;
        if (dist2(p.x, p.y, mob.x, mob.y) > r * r) continue;
        const ma = Math.atan2(mob.y - p.y, mob.x - p.x);
        let da = Math.abs(ma - ang); if (da > Math.PI) da = Math.PI * 2 - da;
        if (da > sk.arc / 2) continue;
        if (!G.hasLOS(p.mapId, p.x, p.y, mob.x, mob.y)) continue;
        damageMob(p.mapId, mob, base * rnd(0.9, 1.1), p);
        mob.poison = { left: poison.ticks, dmg: poison.dmg, owner: p.id, nextAt: now() + 1000 };
      }
      for (const q of allPlayers()) {
        if (q === p || q.mapId !== p.mapId || q.dead) continue;
        if (dist2(p.x, p.y, q.x, q.y) > (sk.radius + 26) ** 2) continue;
        const ma = Math.atan2(q.y - p.y, q.x - p.x);
        let da = Math.abs(ma - ang); if (da > Math.PI) da = Math.PI * 2 - da;
        if (da > sk.arc / 2) continue;
        if (!G.hasLOS(p.mapId, p.x, p.y, q.x, q.y)) continue;
        damagePlayer(q, base, { type: 'player', ref: p });
      }
      break;
    }
  }
}

/* ---------------- 城鎮設施 ---------------- */
function nearBuilding(p, key) {
  if (p.mapId === 3) return false;
  const b = G.TOWN.buildings.find((x) => x.key === key);
  return b && dist2(p.x, p.y, b.x, b.y) < 220 * 220;
}

/* ================= 二手商店（全服寄賣） =================
   玩家把不要的裝備掛上去自訂售價，全伺服器都看得到、都能用金幣買走。
   BOSS 掉落的裝備最低售價 150 萬；寶箱／商店裝備不限價。 */
function marketList() {
  return db.market.map((l) => ({
    id: l.id, price: l.price, seller: l.sellerName, at: l.at,
    item: l.item, boss: l.item.boss ? 1 : 0
  }));
}
function pushMarket(target) {
  const payload = { t: 'market', list: marketList() };
  if (target) send(target, payload);
  else for (const ws of sockets) if (ws.player) send(ws, payload);
}
// 賣家可能不在線上：直接把錢記進存檔裡的角色
function payOut(listing, amount) {
  const live = players.get(listing.sellerCharId);
  if (live) { live.gold += amount; if (live.ws) send(live.ws, { t: 'msg', msg: `💰 你的【${listing.item.name}】賣出了，入帳 ${amount.toLocaleString()} 金幣！` }); return; }
  const acc = listing.sellerGuest ? db.guests[listing.sellerKey] : db.accounts[listing.sellerKey];
  if (!acc) return;
  const c = acc.chars.find((x) => x.id === listing.sellerCharId);
  if (c) { c.gold = (c.gold || 0) + amount; dbDirty = true; }
}

/* ================= 交易所（玩家對玩家面交） =================
   雙方各自放入裝備與金幣，兩邊都按下「確認」才成交。
   任一方改動內容會取消雙方的確認狀態，避免掉包。 */
const trades = new Map();          // tradeId -> { a, b }
let tradeSeq = 1;
function tradeOf(p) { return p.tradeId ? trades.get(p.tradeId) : null; }
function tradeSideOf(tr, p) { return tr.a.p === p ? tr.a : tr.b; }
function tradeOther(tr, p) { return tr.a.p === p ? tr.b : tr.a; }
function tradeItemView(p, side) {
  return side.items.map((u) => p.inv.find((it) => it.uid === u)).filter(Boolean);
}
function pushTrade(tr) {
  for (const side of [tr.a, tr.b]) {
    const me = side, other = tradeOther(tr, side.p);
    send(side.p.ws, {
      t: 'trade', act: 'state', id: tr.id,
      other: { name: other.p.name, cls: other.p.cls, lvl: other.p.lvl },
      mine: { items: tradeItemView(me.p, me), gold: me.gold, ok: me.ok },
      theirs: { items: tradeItemView(other.p, other), gold: other.gold, ok: other.ok }
    });
  }
}
function endTrade(tr, reason) {
  if (!tr || tr.done) return;
  tr.done = true;
  trades.delete(tr.id);
  for (const side of [tr.a, tr.b]) {
    side.p.tradeId = null;
    if (side.p.ws) send(side.p.ws, { t: 'trade', act: 'end', msg: reason });
  }
}
function settleTrade(tr) {
  const A = tr.a, B = tr.b;
  const aItems = tradeItemView(A.p, A), bItems = tradeItemView(B.p, B);
  if (aItems.length !== A.items.length || bItems.length !== B.items.length) return endTrade(tr, '交易物品有變動，已取消。');
  if (A.p.gold < A.gold || B.p.gold < B.gold) return endTrade(tr, '金幣不足，交易取消。');
  if (aItems.some((i) => i.untradeable) || bItems.some((i) => i.untradeable)) return endTrade(tr, '含有無法交易的道具，已取消。');
  if (A.p.inv.length - aItems.length + bItems.length > invCap(A.p)) return endTrade(tr, `${A.p.name} 的背包空間不足，交易取消。`);
  if (B.p.inv.length - bItems.length + aItems.length > invCap(B.p)) return endTrade(tr, `${B.p.name} 的背包空間不足，交易取消。`);
  for (const it of aItems) A.p.inv.splice(A.p.inv.indexOf(it), 1);
  for (const it of bItems) B.p.inv.splice(B.p.inv.indexOf(it), 1);
  A.p.inv.push(...bItems); B.p.inv.push(...aItems);
  A.p.gold += B.gold - A.gold;
  B.p.gold += A.gold - B.gold;
  persist(A.p.ws); persist(B.p.ws);
  endTrade(tr, '✅ 交易完成！');
}

function handleAction(ws, m) {
  const p = ws.player;
  if (!p) return;
  if (p.dead && m.t !== 'respawn' && m.t !== 'chat' && m.t !== 'move') return; // 死亡時只能復活/聊天
  const w = world[p.mapId];
  const md = G.MAPS[p.mapId];
  switch (m.t) {
    case 'view': {          // 前端回報螢幕看得到多大範圍，伺服器只送這個範圍內的東西
      p.vw = clamp(Math.round(+m.w || 0), 600, 5000);
      p.vh = clamp(Math.round(+m.h || 0), 400, 5000);
      break;
    }
    case 'move': {
      p.input = { dx: clamp(+m.dx || 0, -1, 1), dy: clamp(+m.dy || 0, -1, 1) };
      break;
    }
    case 'atk': {
      const ax = +m.ax || 0, ay = +m.ay || 0;
      if (ax || ay) playerAttack(p, { x: ax, y: ay });
      break;
    }
    case 'skill': {
      const ax = +m.ax || 0, ay = +m.ay || 0;
      castSkill(p, clamp(Math.floor(+m.i || 0), 0, 2), { x: ax || p.dir, y: ay });
      break;
    }
    case 'potion': {
      const t = now();
      if (p.dead || p.potions <= 0 || t - p.potionAt < G.POTION_CD) return;
      p.potionAt = t; p.potions--;
      const st = calcStats(p);
      p.hp = Math.min(st.maxHp, p.hp + Math.floor(st.maxHp * G.POTION_HEAL));
      ev(p.mapId, 'heal', { id: p.id, x: p.x, y: p.y });
      break;
    }
    case 'pickup': {
      let best = null, bd = 90 * 90;
      for (const d of w.drops) {
        const dd = dist2(p.x, p.y, d.x, d.y);
        if (dd < bd) { bd = dd; best = d; }
      }
      if (best) {
        if (invFull(p)) { send(ws, { t: 'msg', msg: '背包已滿！' }); return; }
        w.drops.splice(w.drops.indexOf(best), 1);
        p.inv.push(best.item);
        send(ws, { t: 'msg', msg: `獲得【${best.item.name}】` });
        ev(p.mapId, 'pick', { x: best.x, y: best.y });
      }
      break;
    }
    case 'chest': {
      const ch = w.chests.find((c) => c.id === m.id);
      if (!ch || ch.openAt) return;
      if (dist2(p.x, p.y, ch.x, ch.y) > 130 * 130) return;
      ch.openAt = now();
      // 火山王座的寶箱：5% 開出火山鑰匙（含保底累加）
      if (p.mapId === 2 && p.keys < G.KEYS_NEEDED && !p.flags.portalOpen) {
        const chance = G.KEY_CHANCE + p.keyPity * G.KEY_PITY;
        if (Math.random() < chance) {
          p.keys++; p.keyPity = 0;
          send(ws, { t: 'msg', msg: `🔑 開出了【${G.KEY_NAME}】！（${p.keys}/${G.KEYS_NEEDED}）` });
          broadcastAll({ t: 'announce', msg: `🔑 ${p.name} 找到了第 ${p.keys} 把${G.KEY_NAME}！` });
          ev(p.mapId, 'chestOpen', { id: ch.id });
          break;
        } else p.keyPity++;
      }
      const roll = Math.random();
      if (roll < 0.45) {
        const n = rndi(1, 2); p.potions += n;
        send(ws, { t: 'msg', msg: `寶箱獲得 快速回血瓶 ×${n}` });
      } else if (roll < 0.8) {
        const goldBase = [ [80, 400], [2000, 6000], [15000, 40000], [30000, 80000] ][p.mapId];
        const g2 = rndi(goldBase[0], goldBase[1]); p.gold += g2;
        send(ws, { t: 'msg', msg: `寶箱獲得 ${g2.toLocaleString()} 金幣` });
      } else {
        const tierByMap = ['novice', 'steel', 'mithril', 'mithril'][p.mapId];
        const q = rollQuality(G.CHEST_QUALITY_ROLL);
        const slot = G.SLOTS[rndi(0, G.SLOTS.length - 1)];
        const it = makeEquip(tierByMap, slot, q, p.cls);
        if (invFull(p)) { p.gold += 500; send(ws, { t: 'msg', msg: '背包已滿，寶箱折抵 500 金幣' }); }
        else { p.inv.push(it); send(ws, { t: 'msg', msg: `寶箱獲得【${it.name}】` }); }
      }
      ev(p.mapId, 'chestOpen', { id: ch.id });
      break;
    }
    case 'equip': {
      const i = p.inv.findIndex((it) => it.uid === m.uid);
      if (i < 0) return;
      const it = p.inv[i];
      if (it.kind !== 'equip') return;
      if (it.slot === 'weapon' && it.cls !== p.cls) { send(ws, { t: 'msg', msg: '你的職業無法裝備這件武器！' }); return; }
      const old = p.equip[it.slot];
      p.equip[it.slot] = it;
      p.inv.splice(i, 1);
      if (old) p.inv.push(old);
      p.hp = Math.min(p.hp, calcStats(p).maxHp);
      break;
    }
    case 'unequip': {
      const it = p.equip[m.slot];
      if (!it || invFull(p)) return;
      p.equip[m.slot] = null; p.inv.push(it);
      p.hp = Math.min(p.hp, calcStats(p).maxHp);
      break;
    }
    case 'drop': {
      const i = p.inv.findIndex((it) => it.uid === m.uid);
      if (i < 0) return;
      const it = p.inv[i];
      if (it.untradeable) { send(ws, { t: 'msg', msg: '這個道具無法丟棄或交易。' }); return; }
      p.inv.splice(i, 1);
      dropToGround(p.mapId, p.x, p.y, it);
      break;
    }
    case 'buy': {
      if (m.what === 'inn') {
        if (!nearBuilding(p, 'inn')) return;
        const left = G.INN_PVP_LOCK - (now() - (p.pvpAt || 0));
        if (left > 0) { send(ws, { t: 'msg', msg: `⚔ 交戰中無法住宿！請等 ${Math.ceil(left / 1000)} 秒` }); return; }
        if (p.gold < G.INN_PRICE) { send(ws, { t: 'msg', msg: '金幣不足！' }); return; }
        p.gold -= G.INN_PRICE;
        p.hp = calcStats(p).maxHp;
        ev(p.mapId, 'heal', { id: p.id, x: p.x, y: p.y });
        send(ws, { t: 'msg', msg: '🛏 在旅店好好休息了一晚，體力全滿！' });
        return;
      }
      if (m.what === 'scroll' && nearBuilding(p, 'shop')) {
        const n = clamp(Math.floor(+m.n || 1), 1, 99);
        if (p.gold < n * G.SCROLL_PRICE) { send(ws, { t: 'msg', msg: '金幣不足！' }); return; }
        p.gold -= n * G.SCROLL_PRICE; p.scrolls += n;
        send(ws, { t: 'msg', msg: `購買強化卷軸 ×${n}` });
      } else if (m.what === 'potion' && nearBuilding(p, 'shop')) {
        const n = clamp(Math.floor(+m.n || 1), 1, 99);
        if (p.gold < n * G.POTION_PRICE) { send(ws, { t: 'msg', msg: '金幣不足！' }); return; }
        p.gold -= n * G.POTION_PRICE; p.potions += n;
        send(ws, { t: 'msg', msg: `購買回血瓶 ×${n}` });
      } else if (m.what === 'arrows' && nearBuilding(p, 'shop')) {
        const n = clamp(Math.floor(+m.n || 0), 1, 10000);
        if (p.gold < n * G.ARROW_PRICE) { send(ws, { t: 'msg', msg: '金幣不足！' }); return; }
        p.gold -= n * G.ARROW_PRICE; p.arrows += n;
        send(ws, { t: 'msg', msg: `購買箭矢 ×${n}` });
      } else if (m.what === 'bag' && nearBuilding(p, 'shop')) {
        if (invCap(p) >= G.BAG_MAX) { send(ws, { t: 'msg', msg: `背包已達上限 ${G.BAG_MAX} 格！` }); return; }
        const price = G.bagNextPrice(p.bagExtra || 0);
        if (p.gold < price) { send(ws, { t: 'msg', msg: `金幣不足！本次擴充需要 ${price.toLocaleString()} 金幣` }); return; }
        p.gold -= price;
        p.bagExtra = (p.bagExtra || 0) + G.BAG_STEP;
        send(ws, { t: 'msg', msg: `🎒 背包擴充成功！目前 ${invCap(p)} 格` });
        persist(ws);
      } else if (m.what === 'gear' && nearBuilding(p, 'gear')) {
        const tierByMap = ['novice', 'steel', 'mithril'][p.mapId];
        if (!tierByMap) return;
        const t = G.GEAR_TIERS[tierByMap];
        const slot = m.slot;
        if (!G.SLOTS.includes(slot)) return;
        const price = slot === 'weapon' ? t.price.weapon : t.price.armor;
        if (p.gold < price) { send(ws, { t: 'msg', msg: '金幣不足！' }); return; }
        if (invFull(p)) { send(ws, { t: 'msg', msg: '背包已滿！' }); return; }
        p.gold -= price;
        p.inv.push(makeEquip(tierByMap, slot, 0, p.cls));
        send(ws, { t: 'msg', msg: '購買成功！' });
      }
      break;
    }
    case 'enhance': {
      if (!nearBuilding(p, 'smith')) { send(ws, { t: 'msg', msg: '請靠近鐵匠鋪！' }); return; }
      if (p.scrolls <= 0) { send(ws, { t: 'msg', msg: '沒有強化卷軸！商店有售（30,000 金幣）' }); return; }
      let it = p.inv.find((x) => x.uid === m.uid);
      if (!it) { for (const s of G.SLOTS) if (p.equip[s] && p.equip[s].uid === m.uid) it = p.equip[s]; }
      if (!it || it.kind !== 'equip') return;
      if (it.plus >= 10) { send(ws, { t: 'msg', msg: '已達最高強化 +10！' }); return; }
      p.scrolls--;
      if (Math.random() < G.ENHANCE_RATES[it.plus]) {
        it.plus++;
        send(ws, { t: 'enhance', ok: true, name: it.name, plus: it.plus });
      } else {
        const safe = it.plus < G.ENHANCE_SAFE;        // +4 之前失敗不降級
        if (!safe) it.plus = Math.max(0, it.plus - 1);
        send(ws, { t: 'enhance', ok: false, safe, name: it.name, plus: it.plus });
      }
      p.hp = Math.min(p.hp, calcStats(p).maxHp);
      break;
    }
    /* ---- 鐵匠鋪回收：依稀有度換金幣 ---- */
    case 'sell': {
      if (!nearBuilding(p, 'smith')) { send(ws, { t: 'msg', msg: '請靠近鐵匠鋪！' }); return; }
      const i = p.inv.findIndex((it) => it.uid === m.uid);
      if (i < 0) return;
      const it = p.inv[i];
      if (it.kind !== 'equip') { send(ws, { t: 'msg', msg: '這個道具鐵匠鋪不收。' }); return; }
      if (it.untradeable) { send(ws, { t: 'msg', msg: '紀念道具無法賣出。' }); return; }
      const price = G.sellPrice(it);
      p.inv.splice(i, 1);
      p.gold += price;
      send(ws, { t: 'msg', msg: `🔨 賣出【${it.name}${it.plus ? ' +' + it.plus : ''}】，獲得 ${price.toLocaleString()} 金幣` });
      persist(ws);
      break;
    }

    /* ---- 二手商店（全服寄賣，只能用金幣買） ---- */
    case 'market': {
      if (m.act === 'list') { pushMarket(ws); break; }
      if (!nearBuilding(p, 'market')) { send(ws, { t: 'msg', msg: '請靠近二手商店！' }); return; }

      if (m.act === 'sell') {
        const i = p.inv.findIndex((it) => it.uid === m.uid);
        if (i < 0) return;
        const it = p.inv[i];
        if (it.kind !== 'equip') { send(ws, { t: 'msg', msg: '只能寄賣裝備。' }); return; }
        if (it.untradeable) { send(ws, { t: 'msg', msg: '這個道具無法交易。' }); return; }
        const mine = db.market.filter((l) => l.sellerCharId === p.id).length;
        if (mine >= G.MARKET_SLOTS) { send(ws, { t: 'msg', msg: `最多同時寄賣 ${G.MARKET_SLOTS} 件，請先下架。` }); return; }
        let price = Math.floor(+m.price || 0);
        if (!(price > 0) || price > G.MARKET_MAX_PRICE) { send(ws, { t: 'msg', msg: '售價不正確。' }); return; }
        if (it.boss && price < G.MARKET_MIN_BOSS) {
          send(ws, { t: 'msg', msg: `BOSS 掉落的裝備最低售價 ${G.MARKET_MIN_BOSS.toLocaleString()} 金幣！` });
          return;
        }
        p.inv.splice(i, 1);
        db.market.push({
          id: uid(), item: it, price, at: now(),
          sellerName: p.name, sellerCharId: p.id,
          sellerKey: ws.auth.key, sellerGuest: !!ws.auth.guest
        });
        dbDirty = true;
        send(ws, { t: 'msg', msg: `🏷 已上架【${it.name}】，售價 ${price.toLocaleString()} 金幣` });
        persist(ws); pushMarket();
        break;
      }

      if (m.act === 'cancel') {
        const i = db.market.findIndex((l) => l.id === m.id);
        if (i < 0) return;
        const l = db.market[i];
        if (l.sellerCharId !== p.id) { send(ws, { t: 'msg', msg: '這不是你的商品。' }); return; }
        if (invFull(p)) { send(ws, { t: 'msg', msg: '背包已滿，無法下架！' }); return; }
        db.market.splice(i, 1); dbDirty = true;
        p.inv.push(l.item);
        send(ws, { t: 'msg', msg: `已下架【${l.item.name}】` });
        persist(ws); pushMarket();
        break;
      }

      if (m.act === 'buy') {
        const i = db.market.findIndex((l) => l.id === m.id);
        if (i < 0) { send(ws, { t: 'msg', msg: '這件商品已經被買走了。' }); pushMarket(ws); return; }
        const l = db.market[i];
        if (l.sellerCharId === p.id) { send(ws, { t: 'msg', msg: '不能買自己的商品，可以直接下架。' }); return; }
        if (p.gold < l.price) { send(ws, { t: 'msg', msg: '金幣不足！' }); return; }
        if (invFull(p)) { send(ws, { t: 'msg', msg: '背包已滿！' }); return; }
        db.market.splice(i, 1); dbDirty = true;
        p.gold -= l.price;
        p.inv.push(l.item);
        payOut(l, l.price);
        send(ws, { t: 'msg', msg: `🛒 購買成功！獲得【${l.item.name}】` });
        persist(ws); pushMarket();
        break;
      }
      break;
    }

    /* ---- 交易所（玩家對玩家面交） ---- */
    case 'trade': {
      const act = m.act;
      if (act === 'who') {                       // 誰也在交易所附近
        const near = [];
        for (const ws2 of sockets) {
          const q = ws2.player;
          if (!q || q === p || q.mapId !== p.mapId || q.dead) continue;
          if (!nearBuilding(q, 'exchange')) continue;
          near.push({ id: q.id, name: q.name, cls: q.cls, lvl: q.lvl, busy: !!q.tradeId });
        }
        send(ws, { t: 'trade', act: 'who', list: near, me: nearBuilding(p, 'exchange') });
        break;
      }
      if (act === 'invite') {
        if (!nearBuilding(p, 'exchange')) { send(ws, { t: 'msg', msg: '請靠近交易所！' }); return; }
        if (p.tradeId) { send(ws, { t: 'msg', msg: '你已經在交易中。' }); return; }
        const q = players.get(String(m.to));
        if (!q || !q.ws || q.mapId !== p.mapId || q.dead) { send(ws, { t: 'msg', msg: '找不到這位玩家。' }); return; }
        if (q.tradeId) { send(ws, { t: 'msg', msg: '對方正在交易中。' }); return; }
        if (!nearBuilding(q, 'exchange')) { send(ws, { t: 'msg', msg: '對方不在交易所。' }); return; }
        p.inviteTo = q.id; p.inviteAt = now();
        send(q.ws, { t: 'trade', act: 'invited', from: { id: p.id, name: p.name, cls: p.cls, lvl: p.lvl } });
        send(ws, { t: 'msg', msg: `已送出交易邀請給 ${q.name}，等待對方接受…` });
        break;
      }
      if (act === 'accept') {
        const q = players.get(String(m.from));
        if (!q || !q.ws || q.inviteTo !== p.id || now() - (q.inviteAt || 0) > 60000) {
          send(ws, { t: 'msg', msg: '交易邀請已失效。' }); return;
        }
        if (p.tradeId || q.tradeId) { send(ws, { t: 'msg', msg: '有人已經在交易中。' }); return; }
        q.inviteTo = null;
        const tr = { id: 't' + (tradeSeq++), a: { p: q, items: [], gold: 0, ok: false }, b: { p, items: [], gold: 0, ok: false } };
        trades.set(tr.id, tr);
        q.tradeId = tr.id; p.tradeId = tr.id;
        pushTrade(tr);
        break;
      }
      if (act === 'decline') {
        const q = players.get(String(m.from));
        if (q && q.ws) { q.inviteTo = null; send(q.ws, { t: 'msg', msg: `${p.name} 拒絕了交易。` }); }
        break;
      }
      const tr = tradeOf(p);
      if (!tr) break;
      if (act === 'offer') {
        const side = tradeSideOf(tr, p);
        const wanted = Array.isArray(m.items) ? m.items.slice(0, G.TRADE_SLOTS) : [];
        side.items = wanted.filter((u) => {
          const it = p.inv.find((x) => x.uid === u);
          return it && it.kind === 'equip' && !it.untradeable;
        });
        side.gold = clamp(Math.floor(+m.gold || 0), 0, p.gold);
        tr.a.ok = false; tr.b.ok = false;      // 內容一變，雙方確認全部歸零
        pushTrade(tr);
        break;
      }
      if (act === 'ok') {
        tradeSideOf(tr, p).ok = !!m.ok;
        pushTrade(tr);
        if (tr.a.ok && tr.b.ok) settleTrade(tr);
        break;
      }
      if (act === 'cancel') { endTrade(tr, `${p.name} 取消了交易。`); break; }
      break;
    }

    case 'portal': {
      if (m.dir === 'next' && md.portalNext) {
        if (dist2(p.x, p.y, md.portalNext.x, md.portalNext.y) > 170 * 170) return;
        if (p.mapId === 0 && !p.flags.golem) { send(ws, { t: 'msg', msg: '必須先擊敗【岩石魔像】才能前往黑暗聖殿！' }); return; }
        if (p.mapId === 1 && !p.flags.cultist) { send(ws, { t: 'msg', msg: '必須先擊敗【黑暗信徒】才能前往火山王座！' }); return; }
        if (p.mapId === 1 && p.lvl < 150) { send(ws, { t: 'msg', msg: '需要等級 150 才能進入火山王座！' }); return; }
        movePlayerToMap(p, p.mapId + 1, 'fromPrev');
      } else if (m.dir === 'prev' && md.portalPrev) {
        if (dist2(p.x, p.y, md.portalPrev.x, md.portalPrev.y) > 170 * 170) return;
        movePlayerToMap(p, p.mapId - 1, 'fromNext');
      } else if (m.dir === 'center' && md.centerPortal) {
        if (dist2(p.x, p.y, md.centerPortal.x, md.centerPortal.y) > 200 * 200) return;
        if (!p.flags.portalOpen) {
          if (p.keys < G.KEYS_NEEDED) {
            send(ws, { t: 'msg', msg: `傳送門緊閉…需要 ${G.KEYS_NEEDED} 把${G.KEY_NAME}（目前 ${p.keys}/${G.KEYS_NEEDED}）。本圖寶箱有機率開出！` });
            return;
          }
          p.keys = 0;
          p.flags.portalOpen = true;
          broadcastAll({ t: 'announce', msg: `🌋 ${p.name} 集齊三把${G.KEY_NAME}，開啟了古代火山傳送門！` });
        }
        movePlayerToMap(p, 3, 'school');
      }
      break;
    }
    case 'respawn': {
      if (!p.dead) return;
      p.dead = false; p.poison = null;
      const rp = respawnPoint(p.mapId);
      if (rp.mapId !== p.mapId) { ws._mseen = null; ws._pseen = null; ws._chestSig = null; }
      p.mapId = rp.mapId;
      p.x = rp.x + rnd(-50, 50); p.y = rp.y + rnd(-40, 40);
      p.hp = calcStats(p).maxHp;
      send(ws, { t: 'map', mapId: p.mapId });
      break;
    }
    case 'gm': {
      if (!process.env.GM) return;
      if (m.lvl) { p.lvl = clamp(+m.lvl, 1, G.LEVEL_CAP); p.hp = calcStats(p).maxHp; }
      if (m.gold) p.gold += +m.gold;
      if (m.scrolls) p.scrolls += +m.scrolls;
      if (m.keys) p.keys += +m.keys;
      if (m.tp) { p.x = +m.tp.x; p.y = +m.tp.y; }
      break;
    }
    case 'rebirth': {
      if (p.reborn) { send(ws, { t: 'msg', msg: '你已經一轉過了。' }); return; }
      if (p.lvl < G.REBIRTH_LEVEL) { send(ws, { t: 'msg', msg: `需要等級 ${G.REBIRTH_LEVEL} 才能一轉！` }); return; }
      p.reborn = 1;
      p.lvl = 1; p.xp = 0;
      p.skillAt = [0, 0, 0];
      p.hp = calcStats(p).maxHp;
      // 裝備、金幣、道具全部保留
      const sk = G.REBIRTH_SKILLS[p.cls];
      send(ws, { t: 'rebirth', ok: true, skill: sk });
      broadcastAll({ t: 'announce', msg: `⭐ ${p.name} 完成了一轉！習得【${sk.name}】` });
      broadcastAll({ t: 'chat', sys: 1, msg: `⭐【${p.name}】完成一轉，習得【${sk.name}】` });
      ev(p.mapId, 'levelup', { id: p.id, lvl: 1, x: p.x, y: p.y });
      persist(ws); pushRoster();
      break;
    }
    case 'backToSelect': {
      leaveWorld(ws);
      return;
    }
    case 'chat': {
      const msg = String(m.msg || '').slice(0, 100).replace(/[\u0000-\u001f]/g, '');
      const t2 = now();
      if (!msg.trim()) break;
      if (t2 - (p.chatAt || 0) < 800) break;              // 簡單防洗版
      p.chatAt = t2;
      const line = { t: 'chat', name: p.name, cls: p.cls, lvl: p.lvl, msg, zone: G.MAPS[p.mapId].name.split('（')[0] };
      chatHistory.push(line);
      if (chatHistory.length > 60) chatHistory.shift();
      broadcastAll(line);                                  // 全服廣播
      break;
    }
  }
}

function movePlayerToMap(p, mapId, how) {
  const tr = tradeOf(p); if (tr) endTrade(tr, '有人離開了交易所，交易取消。');
  if (p.ws) { p.ws._mseen = null; p.ws._pseen = null; p.ws._chestSig = null; p.ws._lastMe = null; }   // 換圖要重送靜態資料
  p.mapId = mapId;
  const md = G.MAPS[mapId];
  let at;
  if (how === 'school') at = G.SCHOOL.spawn;
  else if (how === 'fromPrev') at = { x: md.portalPrev.x + 100, y: md.portalPrev.y };
  else if (md.portalNext) at = { x: md.portalNext.x - 100, y: md.portalNext.y };
  else at = { x: md.centerPortal.x, y: md.centerPortal.y + 150 }; // 從學園返回火山王座：落在中央傳送門旁
  p.x = at.x; p.y = at.y;
  p.input = { dx: 0, dy: 0 };
  send(p.ws, { t: 'map', mapId });
}

/* ---------------- WebSocket ---------------- */
wss.on('connection', (ws, req) => {
  sockets.add(ws);
  ws.auth = null; ws.player = null;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!ws.auth) {
      if (m.t === 'register') {
        const u = String(m.u || '').trim(), pw = String(m.p || '');
        if (!/^[\w一-龥]{2,16}$/.test(u)) return send(ws, { t: 'auth', ok: false, msg: '帳號需 2~16 字（中英數字）' });
        if (pw.length < 4) return send(ws, { t: 'auth', ok: false, msg: '密碼至少 4 個字元' });
        if (db.accounts[u]) return send(ws, { t: 'auth', ok: false, msg: '此帳號已被註冊' });
        const salt = crypto.randomBytes(8).toString('hex');
        db.accounts[u] = { salt, pass: hashPass(pw, salt), chars: [] };
        dbDirty = true;
        ws.auth = { key: u, guest: false };
        bindAccount(ws); kickOthers(ws);
        return send(ws, { t: 'auth', ok: true, chars: [] });
      }
      if (m.t === 'login') {
        const u = String(m.u || '').trim(), pw = String(m.p || '');
        const acc = db.accounts[u];
        if (!acc || acc.pass !== hashPass(pw, acc.salt)) return send(ws, { t: 'auth', ok: false, msg: '帳號或密碼錯誤' });
        ws.auth = { key: u, guest: false };
        bindAccount(ws); kickOthers(ws);
        return send(ws, { t: 'auth', ok: true, chars: acc.chars.map(charSummary) });
      }
      if (m.t === 'guest') {
        const key = 'ip_' + crypto.createHash('sha1').update(ip).digest('hex').slice(0, 16);
        if (!db.guests[key]) { db.guests[key] = { chars: [] }; dbDirty = true; }
        ws.auth = { key, guest: true };
        bindAccount(ws); kickOthers(ws);
        return send(ws, { t: 'auth', ok: true, guest: true, chars: db.guests[key].chars.map(charSummary) });
      }
      return;
    }
    if (!ws.player) {
      const acc = accountOf(ws);
      if (m.t === 'createChar') {
        const name = String(m.name || '').trim();
        const cls = m.cls;
        if (!G.CLASSES[cls]) return;
        if (!/^[\w一-龥]{1,10}$/.test(name)) return send(ws, { t: 'charErr', msg: '角色 ID 需 1~10 字' });
        if (acc.chars.length >= 3) return send(ws, { t: 'charErr', msg: '每個帳號最多只能建立 3 個角色' });
        if (acc.chars.some((c) => c.name === name)) return send(ws, { t: 'charErr', msg: '已有同名角色' });
        kickOthers(ws);
        const p = newChar(cls, name);
        acc.chars.push(serializeChar(p)); dbDirty = true;
        enterWorld(ws, p);
        return;
      }
      if (m.t === 'pickChar') {
        const c = acc.chars[m.i];
        if (!c) return;
        kickOthers(ws);                       // 同帳號其他角色一律下線
        const old = players.get(c.id);        // 該角色若還殘留在世界上，先移除
        if (old && old.ws && old.ws !== ws) {
          persist(old.ws);
          players.delete(c.id);
          broadcastMap(old.mapId, { t: 'bye', id: c.id });
          old.ws.player = null;
          send(old.ws, { t: 'kicked', msg: '此角色已在其他裝置登入。' });
          setTimeout(() => { try { old.ws.close(); } catch (e) {} }, 120);
        } else if (old) players.delete(c.id);
        enterWorld(ws, loadChar(c));
        return;
      }
      return;
    }
    handleAction(ws, m);
  });

  ws.on('close', () => {
    sockets.delete(ws);
    unbindAccount(ws);
    if (ws.player) {
      persist(ws);
      const p = ws.player;
      const tr0 = tradeOf(p); if (tr0) endTrade(tr0, '對方已離線，交易取消。');
      players.delete(p.id);
      broadcastMap(p.mapId, { t: 'bye', id: p.id });
      for (const w of world) w.guards = w.guards.filter((g) => g.targetId !== p.id);
      ws.player = null;
      setTimeout(pushRoster, 60);
    }
  });
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

function charSummary(c) { return { name: c.name, cls: c.cls, lvl: c.lvl, reborn: c.reborn || 0 }; }

/* 全服線上玩家名單 */
function rosterPayload() {
  const list = [];
  for (const p of allPlayers()) {
    list.push({ id: p.id, name: p.name, cls: p.cls, lvl: p.lvl, map: p.mapId, dead: !!p.dead, bot: p.bot ? 1 : 0, reborn: p.reborn || 0 });
  }
  list.sort((a, b) => b.lvl - a.lvl || a.name.localeCompare(b.name));
  return { t: 'roster', list };
}
function pushRoster() { broadcastAll(rosterPayload()); }
function enterWorld(ws, p) {
  p.ws = ws; ws.player = p;
  ws._mseen = null; ws._pseen = null; ws._chestSig = null; ws._invSig = null; ws._lastMe = null;
  players.set(p.id, p);
  send(ws, { t: 'enter', you: p.id, mapId: p.mapId, name: p.name, cls: p.cls });
  if (chatHistory.length) send(ws, { t: 'chatHistory', lines: chatHistory.slice(-25) });
  send(ws, { t: 'market', list: marketList() });
  broadcastAll({ t: 'chat', sys: 1, msg: `【${p.name}】上線了` });
  setTimeout(pushRoster, 50);
}

/* ================= 假人（每區一名 AI 陪玩） =================
   規則：等級固定＝該區建議等級中間值、不升級、沒有裝備、
   會打怪也會放技能、被玩家主動攻擊就反擊、死後 1 分鐘復活、
   會出現在「線上玩家」名單裡。                                   */
function botHome(mapId) {
  if (mapId === 3) return { x: G.SCHOOL.spawn.x, y: G.SCHOOL.spawn.y };
  // 城鎮東門外的獵場，離城鎮一段距離
  return { x: G.TOWN.x1 + 700, y: G.TOWN.cy };
}
function spawnBot(def) {
  const lvl = G.MAPS[def.map].dummyLvl || 25;
  const home = botHome(def.map);
  const spot = randomOpenSpot(def.map, (x, y) =>
    !inTown(def.map, x, y) && dist2(x, y, home.x, home.y) < 1400 * 1400);
  const b = {
    id: def.id, name: def.name, cls: def.cls, bot: true, lvl, xp: 0, gold: 0,
    mapId: def.map, x: spot.x, y: spot.y, dir: 1,
    inv: [], equip: { weapon: null, helmet: null, chest: null, legs: null, boots: null, cape: null },
    arrows: 999999, potions: 0, scrolls: 0, keys: 0, keyPity: 0, flags: {},
    hp: 0, atkAt: 0, potionAt: 0, skillAt: [0, 0], dead: false,
    input: { dx: 0, dy: 0 }, lastHurt: 0, guardUntil: 0, poison: null,
    hx: spot.x, hy: spot.y, wanderAt: 0, wx: spot.x, wy: spot.y,
    grudgeId: null, grudgeUntil: 0, respawnAt: 0
  };
  b.hp = calcStats(b).maxHp;
  return b;
}
G.DUMMIES.forEach((d) => bots.push(spawnBot(d)));

function botTick(b, t) {
  if (b.dead) {
    if (t >= b.respawnAt) {
      const fresh = spawnBot(G.DUMMIES.find((d) => d.id === b.id));
      Object.assign(b, fresh, { dead: false });
      ev(b.mapId, 'heal', { id: b.id, x: b.x, y: b.y });
      pushRoster();
    }
    return;
  }
  const c = G.CLASSES[b.cls];
  const st = calcStats(b);
  if (b.hp > st.maxHp) b.hp = st.maxHp;
  // 脫戰回血
  if (t - (b.lastHurt || 0) > 5000 && b.hp < st.maxHp) b.hp = Math.min(st.maxHp, b.hp + st.maxHp * 0.02);

  // 中毒
  if (b.poison && t >= b.poison.nextAt) {
    b.poison.nextAt += 1000; b.poison.left--;
    damagePlayer(b, b.poison.dmg, { type: 'poison' });
    if (b.poison && b.poison.left <= 0) b.poison = null;
    if (b.dead) return;
  }

  // ---- 選目標：先報仇（被主動攻擊的玩家），否則找最近的怪 ----
  let tx = null, ty = null, targetKind = null, targetRef = null, tdist = Infinity;
  if (b.grudgeId && t < b.grudgeUntil) {
    const foe = players.get(b.grudgeId);
    if (foe && !foe.dead && foe.mapId === b.mapId) {
      const d = Math.hypot(foe.x - b.x, foe.y - b.y);
      if (d < 900) { tx = foe.x; ty = foe.y; tdist = d; targetKind = 'player'; targetRef = foe; }
    } else { b.grudgeId = null; }
  }
  if (!targetKind) {
    for (const mob of world[b.mapId].mobs) {
      if (mob.dead || mob.boss) continue;               // 假人不打 BOSS
      if (b.ignore && b.ignore[mob.uid] > t) continue;   // 剛剛卡住過的目標，先跳過
      const d = Math.hypot(mob.x - b.x, mob.y - b.y);
      if (d >= tdist || d >= 900) continue;
      if (!G.hasLOS(b.mapId, b.x, b.y, mob.x, mob.y)) continue;   // 隔著地形就不追
      tdist = d; tx = mob.x; ty = mob.y; targetKind = 'mob'; targetRef = mob;
    }
  }

  if (targetKind) {
    const ang = Math.atan2(ty - b.y, tx - b.x);
    const aim = { x: Math.cos(ang), y: Math.sin(ang) };
    const reach = c.range * 0.8;
    if (tdist > reach) {
      const nx = b.x + Math.cos(ang) * c.speed * 0.85 * (TICK / 1000);
      const ny = b.y + Math.sin(ang) * c.speed * 0.85 * (TICK / 1000);
      const r = tryMove(b.mapId, b.x, b.y, nx, ny);
      if (Math.abs(r.x - b.x) < 0.5 && Math.abs(r.y - b.y) < 0.5) {
        // 卡在地形上：放棄這個目標幾秒，改去別的地方（避免站著挨打）
        b.stuck = (b.stuck || 0) + 1;
        if (b.stuck > 8) {
          b.stuck = 0; b.wanderAt = 0;
          if (targetRef && targetRef.uid) { b.ignore = b.ignore || {}; b.ignore[targetRef.uid] = t + 8000; }
          targetKind = null;
        }
      } else b.stuck = 0;
      b.x = r.x; b.y = r.y;
    } else b.stuck = 0;
  }
  if (targetKind) {
    const ang = Math.atan2(ty - b.y, tx - b.x);
    const aim = { x: Math.cos(ang), y: Math.sin(ang) };
    b.dir = tx > b.x ? 1 : -1;
    if (tdist < c.range * 1.15) {
      // 技能優先，冷卻中才普攻
      const skills = G.SKILLS[b.cls] || [];
      let cast = false;
      for (let i = 0; i < skills.length; i++) {
        if (t - b.skillAt[i] >= skills[i].cd) { castSkill(b, i, aim); cast = true; break; }
      }
      if (!cast) playerAttack(b, aim);
    }
  } else {
    // 沒目標 → 在自己的獵場閒晃
    if (t > b.wanderAt) {
      b.wanderAt = t + rnd(1500, 3500);
      const spot = randomOpenSpot(b.mapId, (x, y) =>
        !inTown(b.mapId, x, y) && dist2(x, y, b.hx, b.hy) < 900 * 900);
      b.wx = spot.x; b.wy = spot.y;
    }
    const d = Math.hypot(b.wx - b.x, b.wy - b.y);
    if (d > 12) {
      const nx = b.x + ((b.wx - b.x) / d) * c.speed * 0.6 * (TICK / 1000);
      const ny = b.y + ((b.wy - b.y) / d) * c.speed * 0.6 * (TICK / 1000);
      const r = tryMove(b.mapId, b.x, b.y, nx, ny);
      if (r.x === b.x && r.y === b.y) b.wanderAt = 0;
      b.x = r.x; b.y = r.y;
      b.dir = b.wx > b.x ? 1 : -1;
    }
  }
}

/* ---------------- 私有狀態 ---------------- */
/* 背包／裝備很肥（最多 120 格），只在真的有變動時才送，其餘 tick 省下來 */
function invSig(p) {
  let s = (p.bagExtra || 0) + ':';
  for (const k of G.SLOTS) { const it = p.equip[k]; s += it ? it.uid + it.plus + it.q : '-'; }
  s += '|' + p.inv.length;
  for (const it of p.inv) s += it.uid + (it.plus || 0);
  return s;
}
function privateState(p, ws) {
  const st = calcStats(p);
  const t = now();
  const skills = G.skillsOf(p.cls, p.reborn);
  const sig = invSig(p);
  const sendInv = !ws || ws._invSig !== sig;
  if (ws) ws._invSig = sig;
  return Object.assign(sendInv ? { inv: p.inv, equip: p.equip } : {}, {
    t: 'me', lvl: p.lvl, xp: p.xp, xpNeed: G.xpNeed(p.lvl), gold: p.gold,
    hp: Math.ceil(p.hp), maxHp: st.maxHp, atk: st.atk, def: st.def,
    arrows: p.arrows, potions: p.potions, scrolls: p.scrolls, keys: p.keys,
    potionCd: Math.max(0, G.POTION_CD - (t - p.potionAt)),
    skillCd: skills.map((sk, i) => Math.max(0, sk.cd - (t - (p.skillAt[i] || 0)))),
    flags: p.flags, dead: p.dead,
    reborn: p.reborn || 0, bagCap: invCap(p), bagPrice: G.bagNextPrice(p.bagExtra || 0),
    innLock: Math.max(0, G.INN_PVP_LOCK - (t - (p.pvpAt || 0))),
    stealth: Math.max(0, (p.stealthUntil || 0) - t), ambush: !!p.ambush
  });
}

/* 移動速度倍率：緩速箭會變慢、刺客隱身時變快 */
function moveMul(p, t) {
  let m = 1;
  if (p.slowUntil && t < p.slowUntil) m *= p.slowMul || 1;
  if (p.stealthUntil && t < p.stealthUntil) m *= (G.REBIRTH_SKILLS.assassin.speedMul || 1);
  return m;
}
function isHidden(p, t) { return !!(p.stealthUntil && t < p.stealthUntil); }

/* me 訊息每 0.1 秒一次，但裡面 20 幾個欄位大多不會變 → 只送有變動的部分 */
function meDelta(p, ws) {
  const full = privateState(p, ws);
  const prev = ws._lastMe || (ws._lastMe = {});
  const out = { t: 'me' };
  for (const k in full) {
    if (k === 't') continue;
    const v = JSON.stringify(full[k]);
    if (prev[k] !== v) { out[k] = full[k]; prev[k] = v; }
  }
  return out;
}

/* ---------------- 模擬迴圈 ---------------- */
const TICK = 100;
setInterval(() => {
  const t = now();
  // 玩家移動（碰撞）
  for (const ws of sockets) {
    const p = ws.player;
    if (!p || p.dead) continue;
    const c = G.CLASSES[p.cls];
    const { dx, dy } = p.input;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      const sp = c.speed * moveMul(p, t);
      const nx = clamp(p.x + (dx / len) * sp * (TICK / 1000), 40, G.MAPS[p.mapId].w - 40);
      const ny = clamp(p.y + (dy / len) * sp * (TICK / 1000), 40, G.MAPS[p.mapId].h - 40);
      const r = tryMove(p.mapId, p.x, p.y, nx, ny);
      p.x = r.x; p.y = r.y;
      if (dx) p.dir = dx > 0 ? 1 : -1;
    }
    // 脫戰回血
    if (t - (p.lastHurt || 0) > 6000) {
      const maxHp = calcStats(p).maxHp;
      if (p.hp < maxHp) p.hp = Math.min(maxHp, p.hp + maxHp * 0.0025);
    }
  }

  // ---- 假人 AI ----
  for (const b of bots) { try { botTick(b, t); } catch (e) { /* 單一假人出錯不影響世界 */ } }

  world.forEach((w, mapId) => {
    const md = G.MAPS[mapId];
    // ---- 怪物 AI ----
    for (const mob of w.mobs) {
      if (mob.dead) continue;
      const info = G.MOBS[mob.kind];
      // 中毒
      if (mob.poison && t >= mob.poison.nextAt) {
        mob.poison.nextAt += 1000; mob.poison.left--;
        const owner = players.get(mob.poison.owner);
        damageMob(mapId, mob, mob.poison.dmg, owner || null);
        if (mob.poison && mob.poison.left <= 0) mob.poison = null;
        if (mob.dead) continue;
      }
      let target = null, bd = Infinity;
      const aggro = mob.boss ? 360 : 220;
      for (const p of allPlayers()) {
        if (p.dead || p.mapId !== mapId) continue;
        if (isHidden(p, t)) continue;               // 隱身中：怪物看不到
        if (mob.boss) {
          // BOSS 只守衛自己的領地
          if (dist2(p.x, p.y, mob.hx, mob.hy) > 380 * 380) continue;
        } else if (inTown(mapId, p.x, p.y)) continue;
        const dd = dist2(mob.x, mob.y, p.x, p.y);
        if (dd < aggro * aggro && dd < bd) { bd = dd; target = p; }
      }
      const leash = mob.boss ? 400 : 480;
      if (target && dist2(mob.x, mob.y, mob.hx, mob.hy) > leash * leash) target = null;
      if (target) {
        const d = Math.sqrt(bd);
        const reach = info.size + 30;
        if (d > reach) {
          const msp = info.speed * ((mob.slowUntil && t < mob.slowUntil) ? (mob.slowMul || 1) : 1);
          const nx = mob.x + ((target.x - mob.x) / d) * msp * (TICK / 1000);
          const ny = mob.y + ((target.y - mob.y) / d) * msp * (TICK / 1000);
          const r = tryMove(mapId, mob.x, mob.y, nx, ny);
          mob.x = r.x; mob.y = r.y;
        } else if (t - mob.atkAt > (mob.boss ? 1300 : 1100)) {
          mob.atkAt = t;
          mob.lastFight = t;
          damagePlayer(target, mob.atk, { type: 'mob', ref: mob });
        }
        mob.dir = target.x > mob.x ? 1 : -1;
      } else {
        if (t > mob.wanderAt) {
          mob.wanderAt = t + rnd(2000, 5000);
          const wx = clamp(mob.hx + rnd(-160, 160), 60, md.w - 60);
          const wy = clamp(mob.hy + rnd(-160, 160), 60, md.h - 60);
          if (!inTown(mapId, wx, wy) || mob.boss) { mob.wx = wx; mob.wy = wy; }
        }
        const d = Math.hypot(mob.wx - mob.x, mob.wy - mob.y);
        if (d > 8) {
          const nx = mob.x + ((mob.wx - mob.x) / d) * info.speed * 0.4 * (TICK / 1000);
          const ny = mob.y + ((mob.wy - mob.y) / d) * info.speed * 0.4 * (TICK / 1000);
          const r = tryMove(mapId, mob.x, mob.y, nx, ny);
          mob.x = r.x; mob.y = r.y;
          mob.dir = mob.wx > mob.x ? 1 : -1;
        }
        if (mob.hp < mob.maxHp) mob.hp = Math.min(mob.maxHp, mob.hp + mob.maxHp * 0.003);
      }
      // BOSS 脫戰 5 秒後快速回血（每秒 12%）
      if (mob.boss && mob.hp < mob.maxHp && t - (mob.lastFight || 0) > 5000) {
        mob.hp = Math.min(mob.maxHp, mob.hp + mob.maxHp * 0.012);
        if (!mob.regenNotified) { mob.regenNotified = true; ev(mapId, 'regen', { uid: mob.uid }); }
      } else if (mob.regenNotified && t - (mob.lastFight || 0) <= 5000) {
        mob.regenNotified = false;
      }
    }
    // ---- 士兵 AI ----
    for (let i = w.guards.length - 1; i >= 0; i--) {
      const g = w.guards[i];
      const target = players.get(g.targetId);
      if (t > g.until || !target) { w.guards.splice(i, 1); continue; }
      if (target.dead) { w.guards.splice(i, 1); continue; }
      if (target.mapId !== mapId) continue; // 目標暫時換圖：原地等待
      const d = Math.hypot(target.x - g.x, target.y - g.y) || 1;
      if (d > 55) {
        const sp = G.CLASSES[target.cls].speed * 1.08;
        const nx = g.x + ((target.x - g.x) / d) * sp * (TICK / 1000);
        const ny = g.y + ((target.y - g.y) / d) * sp * (TICK / 1000);
        const r = tryMove(mapId, g.x, g.y, nx, ny);
        g.x = r.x; g.y = r.y;
        g.dir = target.x > g.x ? 1 : -1;
      } else if (t - g.atkAt > 900) {
        g.atkAt = t;
        damagePlayer(target, g.atk, { type: 'guard', ref: g });
      }
    }
    // ---- 投射物 ----
    for (let i = w.projectiles.length - 1; i >= 0; i--) {
      const pr = w.projectiles[i];
      const step = TICK / 1000;
      pr.x += pr.vx * step; pr.y += pr.vy * step;
      pr.left -= Math.hypot(pr.vx, pr.vy) * step;
      let gone = pr.left <= 0 || G.blockedAt(mapId, pr.x, pr.y);
      let exploded = gone && pr.bomb;
      if (!gone) {
        const owner = players.get(pr.owner);
        for (const mob of w.mobs) {
          if (mob.dead) continue;
          const r = G.MOBS[mob.kind].size * 0.7 + 10;
          if (dist2(pr.x, pr.y, mob.x, mob.y) < r * r) {
            if (pr.bomb) exploded = true;
            else if (owner) {
              damageMob(mapId, mob, pr.dmg, owner, { crit: pr.crit });
              if (pr.slow) { mob.slowUntil = t + pr.slow.ms; mob.slowMul = pr.slow.mul; ev(mapId, 'slow', { uid: mob.uid, x: mob.x, y: mob.y }); }
            }
            gone = true; break;
          }
        }
        if (!gone) for (const q of allPlayers()) {
          if (q.dead || q.mapId !== mapId || q.id === pr.owner) continue;
          if (dist2(pr.x, pr.y, q.x, q.y) < 30 * 30) {
            if (pr.bomb) exploded = true;
            else if (owner) {
              damagePlayer(q, pr.dmg, { type: 'player', ref: owner });
              if (pr.slow) { q.slowUntil = t + pr.slow.ms; q.slowMul = pr.slow.mul; ev(mapId, 'slow', { id: q.id, x: q.x, y: q.y }); }
            }
            gone = true; break;
          }
        }
        if (!gone) for (const g of [...w.guards]) {
          if (dist2(pr.x, pr.y, g.x, g.y) < 32 * 32) {
            if (pr.bomb) exploded = true;
            else {
              g.hp -= pr.dmg; ev(mapId, 'dmg', { x: g.x, y: g.y - 25, val: Math.floor(pr.dmg) });
              if (g.hp <= 0) w.guards.splice(w.guards.indexOf(g), 1);
            }
            gone = true; break;
          }
        }
      }
      if (exploded) {
        const owner = players.get(pr.owner);
        ev(mapId, 'boom', { x: pr.x, y: pr.y, r: pr.bomb });
        if (owner) hitArea(owner, pr.x, pr.y, pr.bomb, pr.dmg);
      }
      if (gone) w.projectiles.splice(i, 1);
    }
    // ---- 掉落物過期 / 寶箱重生換位置 ----
    for (let i = w.drops.length - 1; i >= 0; i--) {
      if (t - w.drops[i].bornAt > 180000) w.drops.splice(i, 1);
    }
    for (const ch of w.chests) {
      if (ch.openAt && t - ch.openAt > G.CHEST_RESPAWN) placeChest(mapId, ch);
    }
  });
}, TICK);

/* ---------------- 廣播迴圈 ----------------
   省流量三招（Render 免費方案的 5GB 很快就會被吃光）：
   1. 視野裁切：只送玩家螢幕看得到的怪物／掉落物／投射物，不送整張地圖
   2. 寶箱只在有變動時送（不是每 0.1 秒送一次）
   3. 背包與裝備只在有變動時送（原本每 0.1 秒把整個背包送一次）        */
const VIEW_MARGIN = 320;                 // 視野外多送一點，讓怪物是「走進畫面」而不是「跳出來」
const DEF_VW = 2600, DEF_VH = 1500;      // 舊版前端沒回報視野時的預設值
let bcTick = 0;
setInterval(() => {
  const t = now();
  const mmTick = (bcTick++ % 20) === 0;      // 每 20 次（2 秒）更新一次小地圖光點
  world.forEach((w, mapId) => {
    // 這張圖上沒有真人玩家就完全不用算（假人不需要收封包）
    const viewers = [];
    for (const ws of sockets) if (ws.player && ws.player.mapId === mapId && ws.readyState === 1) viewers.push(ws);
    if (!viewers.length) return;

    const ps = [];
    for (const p of allPlayers()) {
      if (p.mapId !== mapId) continue;
      const hid = isHidden(p, t);
      const vis = {};
      for (const s2 of G.SLOTS) {
        const it = p.equip[s2];
        if (it) vis[s2] = [G.GEAR_TIERS[it.tier].tier, it.q, it.plus];
      }
      const maxHp = calcStats(p).maxHp;
      let pf = 0;
      if (p.dead) pf |= 1;
      if (hid) pf |= 2;
      if (p.slowUntil && t < p.slowUntil) pf |= 4;
      if (p.guardUntil > t) pf |= 8;
      ps.push({
        id: p.id, hid,
        a: [p.id, Math.round(p.x), Math.round(p.y), p.dir, Math.ceil(p.hp), pf],
        // 靜態（名字、職業、等級、裝備外觀…只有變動時才送）
        _st: { name: p.name, cls: p.cls, lvl: p.lvl, maxHp, vis, bot: p.bot ? 1 : 0, reborn: p.reborn || 0 },
        _sig: p.name + p.cls + p.lvl + maxHp + (p.reborn || 0) + JSON.stringify(vis)
      });
    }
    const liveMobs = w.mobs.filter((m) => !m.dead);
    // 小地圖用的粗略光點：全圖怪物位置，但兩秒才送一次、座標除以 8（省流量又看得到怪在哪）
    const mmBlips = mmTick ? liveMobs.map((m) => [Math.round(m.x / 8), Math.round(m.y / 8), m.boss ? 1 : 0]) : null;
    const anyHidden = ps.some((x) => x.hid);
    const visiblePs = anyHidden ? ps.filter((x) => !x.hid) : ps;

    // 寶箱：位置與開關狀態沒變就不重送
    const chestSig = w.chests.map((c) => c.id + (c.openAt ? '1' : '0') + Math.round(c.x) + ',' + Math.round(c.y)).join('|');

    for (const ws of viewers) {
      const me = ws.player;
      // 以玩家為中心的可視矩形（前端會回報自己的視野大小）
      const hw = (me.vw || DEF_VW) / 2 + VIEW_MARGIN;
      const hh = (me.vh || DEF_VH) / 2 + VIEW_MARGIN;
      const near = (e) => Math.abs(e.x - me.x) < hw && Math.abs(e.y - me.y) < hh;

      // 怪物用「陣列」而不是物件傳送：欄位名稱本身就佔掉一半體積
      // 格式 [uid, x, y, hp, dir, 旗標] ；第一次看到時後面再接 [種類, 血量上限, BOSS 類型]
      const mseen = ws._mseen || (ws._mseen = new Set());
      const mobs = [];
      for (const m of liveMobs) {
        if (!near(m)) continue;
        let fl = 0;
        if (m.poison) fl |= 1;
        if (m.boss && m.hp < m.maxHp && t - (m.lastFight || 0) > 5000) fl |= 2;
        if (m.slowUntil && t < m.slowUntil) fl |= 4;
        const a = [m.uid, Math.round(m.x), Math.round(m.y), Math.ceil(m.hp), m.dir, fl];
        if (!mseen.has(m.uid)) {          // 種類與血量上限一輩子不會變，只送第一次
          mseen.add(m.uid);
          a.push(m.kind, m.maxHp, m.boss || 0);
        }
        mobs.push(a);
      }
      const drops = [];
      for (const d of w.drops) {
        if (!near(d)) continue;
        drops.push({
          uid: d.uid, x: Math.round(d.x), y: Math.round(d.y), q: d.item.q || 0, name: d.item.name,
          tier: d.item.tier, slot: d.item.slot, cls: d.item.cls, plus: d.item.plus || 0
        });
      }
      const guards = [];
      for (const g of w.guards) if (near(g)) guards.push({ uid: g.uid, x: Math.round(g.x), y: Math.round(g.y), dir: g.dir, hp: Math.ceil(g.hp), maxHp: g.maxHp });
      const projectiles = [];
      for (const pr of w.projectiles) if (near(pr)) projectiles.push({ uid: pr.uid, x: Math.round(pr.x), y: Math.round(pr.y), vx: pr.vx, vy: pr.vy, bomb: pr.bomb ? 1 : 0, ice: pr.ice ? 1 : 0 });

      // 隱身中的玩家：別人看不到他，但他自己看得到自己
      const src = (anyHidden && isHidden(me, t))
        ? visiblePs.concat(ps.filter((x) => x.id === me.id)) : visiblePs;
      const pseen = ws._pseen || (ws._pseen = {});
      const players = src.map((o) => {
        if (pseen[o.id] === o._sig) return o.a;
        pseen[o.id] = o._sig;
        return o.a.concat([o._st]);       // 靜態資料只在變動時附在最後
      });

      const msg = { t: 'state', mobs, players, drops, guards, projectiles };
      if (ws._chestSig !== chestSig) {          // 寶箱只在變動時附上
        ws._chestSig = chestSig;
        msg.chests = w.chests.map((c) => ({ id: c.id, x: Math.round(c.x), y: Math.round(c.y), open: !!c.openAt }));
      }
      if (mmTick) msg.mm = mmBlips;             // 小地圖光點：兩秒一次、座標壓縮成 1/8
      ws.send(JSON.stringify(msg));
      ws.send(JSON.stringify(meDelta(me, ws)));
    }
  });
}, 100);

setInterval(() => { for (const ws of sockets) if (ws.player) persist(ws); }, 30000);
setInterval(() => { if (players.size) pushRoster(); }, 3000);   // 線上名單即時更新

// 心跳偵測：20 秒沒回應就視為斷線，避免角色卡在原地
setInterval(() => {
  for (const ws of [...sockets]) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch (e) {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 20000);

initStore()
  .then(() => server.listen(PORT, () => console.log(`龍領主 Online 伺服器已啟動： http://localhost:${PORT}`)))
  .catch((e) => {
    console.error('資料庫連線失敗：', e.message);
    const m = e.message || '';
    if (/password authentication failed/i.test(m)) {
      console.error('→ 密碼錯誤。到 Supabase：Settings → Database → Reset database password 重設一組');
      console.error('   （只用英數字，避開 @ : / # ? 等符號），再把新密碼填回連線字串。');
    } else if (/Tenant or user not found/i.test(m)) {
      console.error('→ 使用者名稱有誤。Supabase Session pooler 的使用者應為 postgres.專案代號');
    } else if (/ENETUNREACH|ETIMEDOUT|EAI_AGAIN/i.test(m)) {
      console.error('→ 連不到主機。請改用 Supabase 的 Session pooler 連線字串（主機含 pooler.supabase.com）');
    }
    console.error('請檢查 DATABASE_URL 是否正確');
    process.exit(1);
  });
