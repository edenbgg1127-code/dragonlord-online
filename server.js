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
const G = require('./shared/gamedata.js');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ---------------- 資料庫 ----------------
   預設存在本機 data/db.json。
   若設定環境變數 DATABASE_URL（免費的 Neon / Supabase 等 Postgres），
   進度改存雲端資料庫 → Render 免費方案重新部署也不會遺失！ */
const DATABASE_URL = process.env.DATABASE_URL;
let pgClient = null;
let db = { accounts: {}, guests: {} };

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
function bossDropItems(gearTier, mainClass) {
  const n = rndi(1, 3);
  const items = [];
  const classes = ['warrior', 'archer', 'assassin'];
  for (let i = 0; i < n; i++) {
    const q = rollQuality(G.BOSS_QUALITY_ROLL);
    const slot = G.SLOTS[rndi(0, G.SLOTS.length - 1)];
    // 武器 80% 掉擊殺者可用的職業，避免撿到一堆不能裝的武器
    const forClass = (mainClass && Math.random() < 0.8) ? mainClass : classes[rndi(0, 2)];
    items.push(makeEquip(gearTier, slot, q, forClass));
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
  for (const f of ['public/client.js', 'public/index.html', 'shared/gamedata.js']) {
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
app.use('/shared', express.static(path.join(__dirname, 'shared'), staticOpts));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

const sockets = new Set();
const players = new Map();

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcastMap(mapId, obj) {
  const s = JSON.stringify(obj);
  for (const ws of sockets) if (ws.player && ws.player.mapId === mapId && ws.readyState === 1) ws.send(s);
}
function broadcastAll(obj) {
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
    flags: {}, hp: 0, atkAt: 0, potionAt: 0, skillAt: [0, 0], dead: false,
    input: { dx: 0, dy: 0 }, lastHurt: 0, guardUntil: 0, poison: null
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
    flags: p.flags
  };
}
function loadChar(saved) {
  const p = newChar(saved.cls, saved.name);
  Object.assign(p, {
    id: saved.id, lvl: saved.lvl, xp: saved.xp, gold: saved.gold, mapId: saved.mapId || 0,
    inv: saved.inv || [], equip: Object.assign(p.equip, saved.equip || {}),
    arrows: saved.arrows || 0, potions: saved.potions || 0, scrolls: saved.scrolls || 0,
    keys: saved.keys || 0, keyPity: saved.keyPity || 0, flags: saved.flags || {}
  });
  if (p.mapId === 3 && !p.flags.portalOpen) p.mapId = 2;
  const rp = respawnPoint(p.mapId === 3 ? 2 : p.mapId);
  if (p.mapId === 3) { p.x = G.SCHOOL.spawn.x; p.y = G.SCHOOL.spawn.y; }
  else { p.mapId = rp.mapId; p.x = rp.x + rnd(-50, 50); p.y = rp.y + rnd(-40, 40); }
  p.hp = calcStats(p).maxHp;
  return p;
}
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
  if (mob.boss && killer) {
    for (const item of bossDropItems(md.gearTier, killer.cls)) dropToGround(mapId, mob.x, mob.y, item);
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
          send(victim.ws, { t: 'msg', msg: `你掉落了【${item.name}】！` });
        }
      }
      if (inTown(victim.mapId, victim.x, victim.y)) spawnGuards(killer);
    }
    send(victim.ws, { t: 'dead' });
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
    hit++;
  }
  for (const g of [...w.guards]) {
    if (dist2(cx, cy, g.x, g.y) > (radius + 30) ** 2) continue;
    if (!G.hasLOS(p.mapId, cx, cy, g.x, g.y)) continue;
    g.hp -= dmg; ev(p.mapId, 'dmg', { x: g.x, y: g.y - 25, val: Math.floor(dmg) });
    if (g.hp <= 0) w.guards.splice(w.guards.indexOf(g), 1);
    hit++;
  }
  for (const ws2 of sockets) {
    const q = ws2.player;
    if (!q || q === p || q.mapId !== p.mapId || q.dead) continue;
    if (dist2(cx, cy, q.x, q.y) > (radius + 26) ** 2) continue;
    if (!G.hasLOS(p.mapId, cx, cy, q.x, q.y)) continue;
    damagePlayer(q, dmg, { type: 'player', ref: p });
    hit++;
  }
  return hit;
}

/* ---------------- 普通攻擊 ---------------- */
function playerAttack(p, aim) {
  const c = G.CLASSES[p.cls];
  const t = now();
  if (p.dead || t - p.atkAt < c.atkCd) return;
  p.atkAt = t;
  if (c.usesArrows) {
    if (p.arrows <= 0) { send(p.ws, { t: 'msg', msg: '箭矢用完了！回城鎮商店購買（1 金幣/支）' }); return; }
    p.arrows--;
  }
  const st = calcStats(p);
  const ang = Math.atan2(aim.y, aim.x);
  p.dir = aim.x >= 0 ? 1 : -1;
  ev(p.mapId, 'atk', { id: p.id, cls: p.cls, ang });

  const crit = Math.random() < c.crit;
  const dmg = st.atk * c.dmgMul * (crit ? (c.critMul || 2.0) : 1) * rnd(0.9, 1.1);

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
  for (const ws2 of sockets) {
    const q = ws2.player;
    if (!q || q === p || q.mapId !== p.mapId || q.dead) continue;
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
  const sk = (G.SKILLS[p.cls] || [])[idx];
  if (!sk || p.dead) return;
  const t = now();
  if (t - p.skillAt[idx] < sk.cd) return;
  if (sk.arrows) {
    if (p.arrows < sk.arrows) { send(p.ws, { t: 'msg', msg: `箭矢不足（需要 ${sk.arrows} 支）` }); return; }
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
      for (const ws2 of sockets) {
        const q = ws2.player;
        if (!q || q === p || q.mapId !== p.mapId || q.dead) continue;
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
  return b && dist2(p.x, p.y, b.x, b.y) < 170 * 170;
}

function handleAction(ws, m) {
  const p = ws.player;
  if (!p) return;
  if (p.dead && m.t !== 'respawn' && m.t !== 'chat' && m.t !== 'move') return; // 死亡時只能復活/聊天
  const w = world[p.mapId];
  const md = G.MAPS[p.mapId];
  switch (m.t) {
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
      castSkill(p, m.i === 1 ? 1 : 0, { x: ax || p.dir, y: ay });
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
        if (p.inv.length >= 40) { send(ws, { t: 'msg', msg: '背包已滿！' }); return; }
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
        if (p.inv.length >= 40) { p.gold += 500; send(ws, { t: 'msg', msg: '背包已滿，寶箱折抵 500 金幣' }); }
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
      if (!it || p.inv.length >= 40) return;
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
        if (p.gold < G.INN_PRICE) { send(ws, { t: 'msg', msg: '金幣不足！' }); return; }
        p.gold -= G.INN_PRICE;
        p.hp = calcStats(p).maxHp;
        ev(p.mapId, 'heal', { id: p.id, x: p.x, y: p.y });
        send(ws, { t: 'msg', msg: '🛏 在旅店好好休息了一晚，體力全滿！' });
        return;
      }
      if (m.what === 'scroll' && nearBuilding(p, 'shop')) {
        if (p.gold < G.SCROLL_PRICE) { send(ws, { t: 'msg', msg: '金幣不足！' }); return; }
        p.gold -= G.SCROLL_PRICE; p.scrolls++;
      } else if (m.what === 'potion' && nearBuilding(p, 'shop')) {
        if (p.gold < G.POTION_PRICE) { send(ws, { t: 'msg', msg: '金幣不足！' }); return; }
        p.gold -= G.POTION_PRICE; p.potions++;
      } else if (m.what === 'arrows' && nearBuilding(p, 'shop')) {
        const n = clamp(Math.floor(+m.n || 0), 1, 10000);
        if (p.gold < n * G.ARROW_PRICE) { send(ws, { t: 'msg', msg: '金幣不足！' }); return; }
        p.gold -= n * G.ARROW_PRICE; p.arrows += n;
      } else if (m.what === 'gear' && nearBuilding(p, 'gear')) {
        const tierByMap = ['novice', 'steel', 'mithril'][p.mapId];
        if (!tierByMap) return;
        const t = G.GEAR_TIERS[tierByMap];
        const slot = m.slot;
        if (!G.SLOTS.includes(slot)) return;
        const price = slot === 'weapon' ? t.price.weapon : t.price.armor;
        if (p.gold < price) { send(ws, { t: 'msg', msg: '金幣不足！' }); return; }
        if (p.inv.length >= 40) { send(ws, { t: 'msg', msg: '背包已滿！' }); return; }
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
        it.plus = Math.max(0, it.plus - 1);
        send(ws, { t: 'enhance', ok: false, name: it.name, plus: it.plus });
      }
      p.hp = Math.min(p.hp, calcStats(p).maxHp);
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
    case 'chat': {
      const msg = String(m.msg || '').slice(0, 80);
      if (msg.trim()) broadcastMap(p.mapId, { t: 'chat', name: p.name, msg });
      break;
    }
  }
}

function movePlayerToMap(p, mapId, how) {
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
        return send(ws, { t: 'auth', ok: true, chars: [] });
      }
      if (m.t === 'login') {
        const u = String(m.u || '').trim(), pw = String(m.p || '');
        const acc = db.accounts[u];
        if (!acc || acc.pass !== hashPass(pw, acc.salt)) return send(ws, { t: 'auth', ok: false, msg: '帳號或密碼錯誤' });
        ws.auth = { key: u, guest: false };
        return send(ws, { t: 'auth', ok: true, chars: acc.chars.map(charSummary) });
      }
      if (m.t === 'guest') {
        const key = 'ip_' + crypto.createHash('sha1').update(ip).digest('hex').slice(0, 16);
        if (!db.guests[key]) { db.guests[key] = { chars: [] }; dbDirty = true; }
        ws.auth = { key, guest: true };
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
        if (acc.chars.length >= 3) return send(ws, { t: 'charErr', msg: '每個帳號最多 3 個角色' });
        if (acc.chars.some((c) => c.name === name)) return send(ws, { t: 'charErr', msg: '已有同名角色' });
        const p = newChar(cls, name);
        acc.chars.push(serializeChar(p)); dbDirty = true;
        enterWorld(ws, p);
        return;
      }
      if (m.t === 'pickChar') {
        const c = acc.chars[m.i];
        if (!c) return;
        if (players.has(c.id)) return send(ws, { t: 'charErr', msg: '此角色已在線上' });
        enterWorld(ws, loadChar(c));
        return;
      }
      return;
    }
    handleAction(ws, m);
  });

  ws.on('close', () => {
    sockets.delete(ws);
    if (ws.player) {
      persist(ws);
      players.delete(ws.player.id);
      broadcastMap(ws.player.mapId, { t: 'bye', id: ws.player.id });
    }
  });
});

function charSummary(c) { return { name: c.name, cls: c.cls, lvl: c.lvl }; }
function enterWorld(ws, p) {
  p.ws = ws; ws.player = p;
  players.set(p.id, p);
  send(ws, { t: 'enter', you: p.id, mapId: p.mapId, name: p.name, cls: p.cls });
}

/* ---------------- 私有狀態 ---------------- */
function privateState(p) {
  const st = calcStats(p);
  const t = now();
  const skills = G.SKILLS[p.cls] || [];
  return {
    t: 'me', lvl: p.lvl, xp: p.xp, xpNeed: G.xpNeed(p.lvl), gold: p.gold,
    hp: Math.ceil(p.hp), maxHp: st.maxHp, atk: st.atk, def: st.def,
    arrows: p.arrows, potions: p.potions, scrolls: p.scrolls, keys: p.keys,
    potionCd: Math.max(0, G.POTION_CD - (t - p.potionAt)),
    skillCd: skills.map((sk, i) => Math.max(0, sk.cd - (t - p.skillAt[i]))),
    inv: p.inv, equip: p.equip, flags: p.flags, dead: p.dead
  };
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
      const nx = clamp(p.x + (dx / len) * c.speed * (TICK / 1000), 40, G.MAPS[p.mapId].w - 40);
      const ny = clamp(p.y + (dy / len) * c.speed * (TICK / 1000), 40, G.MAPS[p.mapId].h - 40);
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
      for (const ws of sockets) {
        const p = ws.player;
        if (!p || p.dead || p.mapId !== mapId) continue;
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
          const nx = mob.x + ((target.x - mob.x) / d) * info.speed * (TICK / 1000);
          const ny = mob.y + ((target.y - mob.y) / d) * info.speed * (TICK / 1000);
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
            else if (owner) damageMob(mapId, mob, pr.dmg, owner, { crit: pr.crit });
            gone = true; break;
          }
        }
        if (!gone) for (const ws of sockets) {
          const q = ws.player;
          if (!q || q.dead || q.mapId !== mapId || q.id === pr.owner) continue;
          if (dist2(pr.x, pr.y, q.x, q.y) < 30 * 30) {
            if (pr.bomb) exploded = true;
            else if (owner) damagePlayer(q, pr.dmg, { type: 'player', ref: owner });
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

/* ---------------- 廣播迴圈 ---------------- */
setInterval(() => {
  const t = now();
  world.forEach((w, mapId) => {
    const ps = [];
    for (const ws of sockets) {
      const p = ws.player;
      if (!p || p.mapId !== mapId) continue;
      const vis = {};
      for (const s of G.SLOTS) {
        const it = p.equip[s];
        if (it) vis[s] = [G.GEAR_TIERS[it.tier].tier, it.q, it.plus];
      }
      ps.push({
        id: p.id, name: p.name, cls: p.cls, lvl: p.lvl,
        x: Math.round(p.x), y: Math.round(p.y), dir: p.dir,
        hp: Math.ceil(p.hp), maxHp: calcStats(p).maxHp,
        dead: p.dead, vis, wanted: p.guardUntil > t
      });
    }
    const mobs = w.mobs.filter((m) => !m.dead).map((m) => ({
      uid: m.uid, kind: m.kind, x: Math.round(m.x), y: Math.round(m.y),
      hp: Math.ceil(m.hp), maxHp: m.maxHp, dir: m.dir, boss: m.boss, po: m.poison ? 1 : 0,
      rg: (m.boss && m.hp < m.maxHp && t - (m.lastFight || 0) > 5000) ? 1 : 0
    }));
    const drops = w.drops.map((d) => ({
      uid: d.uid, x: Math.round(d.x), y: Math.round(d.y), q: d.item.q || 0, name: d.item.name,
      tier: d.item.tier, slot: d.item.slot, cls: d.item.cls, plus: d.item.plus || 0
    }));
    const guards = w.guards.map((g) => ({ uid: g.uid, x: Math.round(g.x), y: Math.round(g.y), dir: g.dir, hp: Math.ceil(g.hp), maxHp: g.maxHp }));
    const projectiles = w.projectiles.map((pr) => ({ uid: pr.uid, x: Math.round(pr.x), y: Math.round(pr.y), vx: pr.vx, vy: pr.vy, bomb: pr.bomb ? 1 : 0 }));
    const chests = w.chests.map((c) => ({ id: c.id, x: Math.round(c.x), y: Math.round(c.y), open: !!c.openAt }));
    const s = JSON.stringify({ t: 'state', mobs, players: ps, drops, guards, projectiles, chests });
    for (const ws of sockets) {
      if (ws.player && ws.player.mapId === mapId && ws.readyState === 1) {
        ws.send(s);
        ws.send(JSON.stringify(privateState(ws.player)));
      }
    }
  });
}, 100);

setInterval(() => { for (const ws of sockets) if (ws.player) persist(ws); }, 30000);

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
