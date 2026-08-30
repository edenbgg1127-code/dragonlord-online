/* ============================================================
   共用遊戲數值資料（伺服器與瀏覽器共用）
   平衡目標：約 6 小時打到 300 級擊敗龍領主
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GAME = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // ---------- 等級經驗 ----------
  function xpNeed(lvl) { return Math.floor(30 * Math.pow(lvl, 1.5)); }
  function mobXP(lvl)  { return Math.floor(12 * Math.pow(lvl, 1.6)); }
  const LEVEL_CAP = 300;

  // ---------- 職業 ----------
  const CLASSES = {
    warrior:  { name: '戰士', sprite: 'warrior',  hpBase: 130, hpPer: 24, atkBase: 10, atkPer: 1.7,
                dmgMul: 1.0, atkCd: 550, range: 95, arc: 2.0, speed: 235, defMul: 1.35, crit: 0.08 },
    archer:   { name: '射手', sprite: 'archer',   hpBase: 95,  hpPer: 17, atkBase: 9,  atkPer: 1.5,
                dmgMul: 0.9, atkCd: 450, range: 460, arc: 0,  speed: 250, defMul: 1.0,  crit: 0.12, usesArrows: true },
    assassin: { name: '刺客', sprite: 'assassin', hpBase: 105, hpPer: 19, atkBase: 9,  atkPer: 1.6,
                dmgMul: 0.72, atkCd: 300, range: 80, arc: 1.5, speed: 285, defMul: 1.05, crit: 0.28, critMul: 2.2 }
  };

  // ---------- 技能（每職業 2 個，快捷鍵 Q / E） ----------
  const SKILLS = {
    warrior: [
      { id: 'whirl',  key: 'Q', name: '旋風斬', icon: '🌀', cd: 6000,  mul: 2.2, type: 'aoe',   radius: 160,
        desc: '以自身為中心旋轉揮砍，對周圍所有敵人造成 220% 傷害' },
      { id: 'charge', key: 'E', name: '衝鋒',   icon: '💨', cd: 9000,  mul: 1.7, type: 'dash',  dist: 320, radius: 110,
        desc: '向前衝鋒 320 距離，對路徑終點附近敵人造成 170% 傷害' }
    ],
    archer: [
      { id: 'triple', key: 'Q', name: '三連矢', icon: '🏹', cd: 5000,  mul: 1.0, type: 'multi', count: 3, spread: 0.24, arrows: 3,
        desc: '扇形射出 3 支箭（消耗 3 箭矢），每支 100% 傷害' },
      { id: 'boom',   key: 'E', name: '爆裂箭', icon: '💥', cd: 10000, mul: 2.5, type: 'bomb',  radius: 140, arrows: 1,
        desc: '射出爆裂箭，命中後爆炸對範圍敵人造成 250% 傷害（消耗 1 箭矢）' }
    ],
    assassin: [
      { id: 'shadow', key: 'Q', name: '影襲',   icon: '🌫', cd: 8000,  mul: 3.0, type: 'blink', dist: 280, radius: 100,
        desc: '瞬身突進 280 距離，對落點敵人造成必定爆擊的 300% 傷害' },
      { id: 'poison', key: 'E', name: '毒刃',   icon: '☠', cd: 9000,  mul: 1.5, type: 'cone',  radius: 180, arc: 1.7,
        poison: { ticks: 3, mul: 0.5 },
        desc: '扇形撒出毒刃造成 150% 傷害，並附加 3 秒中毒（每秒 50% 傷害）' }
    ]
  };

  // ---------- 品質 ----------
  const QUALITIES = [
    { key: 'gray',    name: '普通', mul: 1.00, color: '#b8bdc4' },
    { key: 'green',   name: '精良', mul: 1.15, color: '#8fd98f' },
    { key: 'blue',    name: '稀有', mul: 1.35, color: '#8db8f0' },
    { key: 'purple',  name: '史詩', mul: 1.60, color: '#c39bec' },
    { key: 'gold',    name: '傳說', mul: 1.90, color: '#efd382' },
    { key: 'red',     name: '神話', mul: 2.25, color: '#ef9a8f' },
    { key: 'rainbow', name: '幻彩', mul: 2.70, color: 'rainbow' }
  ];
  const BOSS_QUALITY_ROLL = [ [1,.34], [2,.30], [3,.20], [4,.09], [5,.05], [6,.02] ];
  const CHEST_QUALITY_ROLL = [ [0,.50], [1,.35], [2,.15] ];

  // ---------- 裝備 ----------
  const SLOTS = ['weapon','helmet','chest','legs','boots','cape'];
  const SLOT_NAMES = { weapon:'武器', helmet:'頭盔', chest:'胸甲', legs:'褲腿', boots:'鞋子', cape:'披風' };
  const GEAR_TIERS = {
    novice:  { name: '新手',  tier: 0, wAtk: 12,  aDef: 3,  aHp: 22,  price: { weapon: 500,   armor: 300 } },
    rock:    { name: '岩石',  tier: 1, wAtk: 30,  aDef: 8,  aHp: 65 },
    steel:   { name: '精鋼',  tier: 2, wAtk: 44,  aDef: 12, aHp: 95,  price: { weapon: 25000, armor: 14000 } },
    dark:    { name: '黑暗',  tier: 3, wAtk: 78,  aDef: 21, aHp: 185 },
    mithril: { name: '秘銀',  tier: 4, wAtk: 105, aDef: 27, aHp: 250, price: { weapon: 150000, armor: 80000 } },
    dragon:  { name: '龍神',  tier: 5, wAtk: 175, aDef: 46, aHp: 430 }
  };
  const WEAPON_SUFFIX = {
    novice:  { warrior: '短劍', archer: '木弓', assassin: '小刀' },
    rock:    { warrior: '岩石刃', archer: '岩石弓', assassin: '岩石匕首' },
    steel:   { warrior: '精鋼劍', archer: '精鋼弓', assassin: '精鋼匕首' },
    dark:    { warrior: '黑暗刃', archer: '黑暗弓', assassin: '黑暗匕首' },
    mithril: { warrior: '秘銀劍', archer: '秘銀弓', assassin: '秘銀匕首' },
    dragon:  { warrior: '龍神劍', archer: '龍神弓', assassin: '龍神匕首' }
  };

  // ---------- 強化 / 商店 ----------
  const ENHANCE_RATES = [1.0, .8, .6, .4, .2, .1, .05, .03, .01, .005];
  const ENHANCE_SAFE = 4;          // 到 +4 之前失敗不會降級
  const ENHANCE_BONUS = 0.08;
  const SCROLL_PRICE = 30000;
  const POTION_PRICE = 1000;
  const ARROW_PRICE = 1;
  const INN_PRICE = 500;           // 旅店休息：全滿血
  const POTION_CD = 30000;
  const POTION_HEAL = 0.2;

  // ---------- 怪物 ----------
  function mobHP(lvl)  { return Math.floor(40 + lvl * 22); }
  function mobATK(lvl) { return Math.floor(3 + lvl * 0.55); }
  const MOBS = {
    slime:    { name: '小史萊姆', lvl: 5,   sprite: 'slime',    gold: [10, 50],        speed: 70,  size: 34 },
    goblin:   { name: '小哥布林', lvl: 25,  sprite: 'goblin',   gold: [100, 200],      speed: 110, size: 40 },
    bat:      { name: '蝙蝠',     lvl: 50,  sprite: 'bat',      gold: [1000, 1500],    speed: 150, size: 42 },
    spider:   { name: '蜘蛛',     lvl: 100, sprite: 'spider',   gold: [3000, 4000],    speed: 120, size: 42 },
    imp:      { name: '小惡魔',   lvl: 200, sprite: 'imp',      gold: [7000, 10000],   speed: 140, size: 44 },
    skeleton: { name: '小骷髏',   lvl: 250, sprite: 'skeleton', gold: [10000, 20000],  speed: 115, size: 46 },
    golem:    { name: '岩石魔像', lvl: 50,  sprite: 'golem',  boss: 'mini',  mul: 3, gold: [10000, 50000],
                gearTier: 'rock', speed: 90,  size: 96,  respawn: 300000, memento: { id:'m_golem', name:'岩石核心', desc:'首次擊敗岩石魔像的證明（不可交易）' } },
    cultist:  { name: '黑暗信徒', lvl: 150, sprite: 'cultist', boss: 'mini', mul: 3, gold: [100000, 150000],
                gearTier: 'dark', speed: 120, size: 86,  respawn: 300000, memento: { id:'m_cultist', name:'黑暗聖章', desc:'首次擊敗黑暗信徒的證明（不可交易）' } },
    dragon:   { name: '龍領主 伊格尼斯', lvl: 300, sprite: 'dragon', boss: 'grand', mul: 5, gold: [500000, 1000000],
                gearTier: 'dragon', speed: 105, size: 150, respawn: 600000 }
  };
  const MOB_RESPAWN = 5000;
  const XP_MUL_MINI = 5, XP_MUL_GRAND = 8;
  const MOB_COUNT_EACH = 15;

  /* ============================================================
     地圖（主要地圖比例 1:4000，城鎮 1:200，學園 1:500）
     ============================================================ */
  const TILE = 40;
  const MAPS = [
    { id: 0, name: '碎裂之峰（建議 1-50 級）',   theme: 'peak',    w: 3400, h: 2400,
      mobs: ['slime', 'goblin'], boss: 'golem',
      townName: '白霜城', chestN: 6,
      landmark: { x: 2160, y: 560, r: 190, name: '符文祭壇' },
      bossArena: { x: 2960, y: 2010, r: 260, name: '魔像深谷' },
      portalPrev: null, portalNext: { x: 3180, y: 1180 } },
    { id: 1, name: '黑暗聖殿（建議 50-150 級）', theme: 'sanctum', w: 3400, h: 2400,
      mobs: ['bat', 'spider'], boss: 'cultist',
      townName: '暗影堡', chestN: 6,
      landmark: { x: 2160, y: 560, r: 190, name: '魔法祭壇' },
      bossArena: { x: 2960, y: 2010, r: 260, name: '黑暗聖所' },
      portalPrev: { x: 180, y: 1180 }, portalNext: { x: 3180, y: 1180 } },
    { id: 2, name: '火山王座（建議 150-300 級）', theme: 'volcano', w: 3400, h: 2400,
      mobs: ['imp', 'skeleton'], boss: null,
      townName: '燼火鎮', chestN: 8,
      landmark: { x: 2160, y: 560, r: 190, name: '岩石王座' },
      portalPrev: { x: 180, y: 1180 }, portalNext: null,
      centerPortal: { x: 1780, y: 1180, name: '古代火山傳送門' } },
    { id: 3, name: '中崙學園・王的領域', theme: 'school', w: 2240, h: 1600,
      mobs: [], boss: 'dragon',
      townName: null, chestN: 3,
      portalPrev: { x: 1120, y: 1460 }, portalNext: null }
  ];

  // 城鎮版型（地圖 0-2 共用座標；城牆、兩個城門、五棟建築、復活點、BOSS 大空間）
  const TOWN = {
    cx: 780, cy: 1180, w: 920, h: 680,           // 城牆外框（px，含牆）
    x0: 320, y0: 840, x1: 1240, y1: 1520,
    gateY0: 1120, gateY1: 1240,                   // 西門與東門的開口（兩個出口）
    buildings: [
      { key: 'gear',  label: '裝備店',   icon: '⚔', x: 500, y: 980,  w: 150, h: 110 },
      { key: 'shop',  label: '雜貨商店', icon: '🏪', x: 740, y: 980,  w: 150, h: 110 },
      { key: 'smith', label: '鐵匠鋪',   icon: '🔨', x: 500, y: 1380, w: 150, h: 110 },
      { key: 'inn',   label: '住宿旅店', icon: '🛏', x: 740, y: 1380, w: 150, h: 110 }
    ],
    statue: { x: 620, y: 1170 },                  // 莊嚴的復活點
    plaza:  { x: 1050, y: 1170, r: 150 }          // BOSS 出現大空間
  };

  // 中崙學園版型（1:500，參考中崙高中平面圖；王的位置＝707 班）
  const SCHOOL = {
    // 主大樓（右側，內含 707 班大廳）
    main: { x0: 1480, y0: 280, x1: 2110, y1: 1270, doorY0: 720, doorY1: 840 }, // 門在西面
    room707: { x: 1795, y: 775, label: '707 班・王的位置' },
    track: { cx: 640, cy: 1000, rx: 430, ry: 290 },   // 操場跑道
    northA: { x0: 280, y0: 160, x1: 800, y1: 360, label: '學園城' },
    northB: { x0: 900, y0: 160, x1: 1320, y1: 360, label: '教學大樓' },
    courts: [ { x0: 1480, y0: 60, x1: 1780, y1: 230 }, { x0: 1810, y0: 60, x1: 2110, y1: 230 } ],
    spawn: { x: 1120, y: 1460 }
  };

  // ---------- 鑰匙與傳送門 ----------
  const KEYS_NEEDED = 3;
  const KEY_CHANCE = 0.05;       // 火山王座寶箱 5% 開出鑰匙
  const KEY_PITY = 0.03;         // 保底：每次沒開到，下次機率 +3%
  const KEY_NAME = '火山鑰匙';

  /* ============================================================
     確定性地形網格（迷宮）—— 伺服器與客戶端各自產生、結果相同
     ============================================================ */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const _grids = {};
  function getGrid(mi) {
    if (_grids[mi]) return _grids[mi];
    const md = MAPS[mi];
    const tw = md.w / TILE, th = md.h / TILE;
    const g = new Uint8Array(tw * th);   // 1 = 障礙
    const at = (x, y) => y * tw + x;
    const R = mulberry32(9000 + mi * 77);

    if (mi < 3) {
      g.fill(1);
      // --- 迷宮：5x5 tile 一格（走道寬 160px），DFS 生成後打通 30% 牆製造環路 ---
      const CS = 5, ox = 2, oy = 2;
      const cols = Math.floor((tw - 4) / CS), rows = Math.floor((th - 4) / CS);
      const seen = new Uint8Array(cols * rows);
      const openE = new Uint8Array(cols * rows);  // 與右格相通
      const openS = new Uint8Array(cols * rows);  // 與下格相通
      const stack = [[0, Math.floor(rows / 2)]];
      seen[Math.floor(rows / 2) * cols] = 1;
      while (stack.length) {
        const [ci, cj] = stack[stack.length - 1];
        const nbs = [];
        if (ci > 0 && !seen[cj * cols + ci - 1]) nbs.push([-1, 0]);
        if (ci < cols - 1 && !seen[cj * cols + ci + 1]) nbs.push([1, 0]);
        if (cj > 0 && !seen[(cj - 1) * cols + ci]) nbs.push([0, -1]);
        if (cj < rows - 1 && !seen[(cj + 1) * cols + ci]) nbs.push([0, 1]);
        if (!nbs.length) { stack.pop(); continue; }
        const [dx, dy] = nbs[Math.floor(R() * nbs.length)];
        if (dx === 1) openE[cj * cols + ci] = 1;
        if (dx === -1) openE[cj * cols + ci - 1] = 1;
        if (dy === 1) openS[cj * cols + ci] = 1;
        if (dy === -1) openS[(cj - 1) * cols + ci] = 1;
        seen[(cj + dy) * cols + ci + dx] = 1;
        stack.push([ci + dx, cj + dy]);
      }
      for (let cj = 0; cj < rows; cj++) for (let ci = 0; ci < cols; ci++) { // 環路
        if (ci < cols - 1 && !openE[cj * cols + ci] && R() < 0.30) openE[cj * cols + ci] = 1;
        if (cj < rows - 1 && !openS[cj * cols + ci] && R() < 0.30) openS[cj * cols + ci] = 1;
      }
      // 蓋章到 tile 網格（走道 3 格寬＝120px，山壁 2 格厚＝80px，較有地形份量）
      for (let cj = 0; cj < rows; cj++) for (let ci = 0; ci < cols; ci++) {
        const bx = ox + ci * CS, by = oy + cj * CS;
        for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g[at(bx + x, by + y)] = 0;
        if (openE[cj * cols + ci]) for (let y = 0; y < 3; y++) { g[at(bx + 3, by + y)] = 0; g[at(bx + 4, by + y)] = 0; }
        if (openS[cj * cols + ci]) for (let x = 0; x < 3; x++) { g[at(bx + x, by + 3)] = 0; g[at(bx + x, by + 4)] = 0; }
      }
      // --- 地形有機化：削掉突刺、讓山壁輪廓圓潤（只「開」不「關」，保證連通） ---
      for (let pass = 0; pass < 2; pass++) {
        const snap = g.slice();
        for (let y = 3; y < th - 3; y++) for (let x = 3; x < tw - 3; x++) {
          if (!snap[at(x, y)]) continue;
          let openN = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if ((dx || dy) && !snap[at(x + dx, y + dy)]) openN++;
          }
          if (openN >= 6 || (openN >= 4 && R() < 0.30)) g[at(x, y)] = 0;
        }
      }
      // --- 城鎮：清空內部 → 城牆 → 兩個城門 → 建築物 ---
      const T = TOWN;
      const tx0 = T.x0 / TILE, ty0 = T.y0 / TILE, tx1 = T.x1 / TILE - 1, ty1 = T.y1 / TILE - 1;
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) g[at(x, y)] = 0;
      const gy0 = T.gateY0 / TILE, gy1 = T.gateY1 / TILE - 1;
      for (let x = tx0; x <= tx1; x++) { g[at(x, ty0)] = 1; g[at(x, ty1)] = 1; }
      for (let y = ty0; y <= ty1; y++) {
        const gate = y >= gy0 && y <= gy1;
        g[at(tx0, y)] = gate ? 0 : 1;
        g[at(tx1, y)] = gate ? 0 : 1;
      }
      for (const b of T.buildings) {
        const bx0 = Math.floor((b.x - b.w / 2) / TILE), bx1 = Math.ceil((b.x + b.w / 2) / TILE) - 1;
        const by0 = Math.floor((b.y - b.h / 2) / TILE), by1 = Math.ceil((b.y + b.h / 2) / TILE) - 1;
        for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) g[at(x, y)] = 0 | 1;
      }
      // --- 城門外走廊 + 傳送點淨空 ---
      const clear = (px, py, r) => {
        const cx = Math.round(px / TILE), cy = Math.round(py / TILE);
        for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++)
          if (x > 1 && y > 1 && x < tw - 2 && y < th - 2 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) g[at(x, y)] = 0;
      };
      for (let y = gy0; y <= gy1; y++) {
        for (let x = 3; x < tx0; x++) g[at(x, y)] = 0;           // 西門通道（往入口傳送點）
        for (let x = tx1 + 1; x <= tx1 + 6; x++) g[at(x, y)] = 0; // 東門通道
      }
      if (md.portalPrev) clear(md.portalPrev.x, md.portalPrev.y, 4);
      if (md.portalNext) clear(md.portalNext.x, md.portalNext.y, 4);
      if (md.centerPortal) clear(md.centerPortal.x, md.centerPortal.y, 5);
      if (md.landmark) clear(md.landmark.x, md.landmark.y, Math.ceil(md.landmark.r / TILE) + 1);
      if (md.bossArena) clear(md.bossArena.x, md.bossArena.y, Math.ceil(md.bossArena.r / TILE) + 1);
      // 外框
      for (let x = 0; x < tw; x++) { g[at(x, 0)] = 1; g[at(x, 1)] = 1; g[at(x, th - 1)] = 1; g[at(x, th - 2)] = 1; }
      for (let y = 0; y < th; y++) { g[at(0, y)] = 1; g[at(1, y)] = 1; g[at(tw - 1, y)] = 1; g[at(tw - 2, y)] = 1; }
    } else {
      // --- 中崙學園：開放校園 + 建築障礙 ---
      g.fill(0);
      for (let x = 0; x < tw; x++) { g[at(x, 0)] = 1; g[at(x, th - 1)] = 1; }
      for (let y = 0; y < th; y++) { g[at(0, y)] = 1; g[at(tw - 1, y)] = 1; }
      const S = SCHOOL;
      const wallRect = (x0, y0, x1, y1, doorY0, doorY1) => {
        const a = Math.floor(x0 / TILE), b = Math.floor(y0 / TILE), c = Math.ceil(x1 / TILE) - 1, d = Math.ceil(y1 / TILE) - 1;
        for (let x = a; x <= c; x++) { g[at(x, b)] = 1; g[at(x, d)] = 1; }
        for (let y = b; y <= d; y++) {
          const door = doorY0 !== undefined && y >= Math.floor(doorY0 / TILE) && y <= Math.ceil(doorY1 / TILE) - 1;
          g[at(a, y)] = door ? 0 : 1;
          g[at(c, y)] = 1;
        }
      };
      wallRect(S.main.x0, S.main.y0, S.main.x1, S.main.y1, S.main.doorY0, S.main.doorY1);
      const solidRect = (r) => {
        for (let y = Math.floor(r.y0 / TILE); y < Math.ceil(r.y1 / TILE); y++)
          for (let x = Math.floor(r.x0 / TILE); x < Math.ceil(r.x1 / TILE); x++) g[at(x, y)] = 1;
      };
      solidRect(S.northA); solidRect(S.northB);
    }
    _grids[mi] = { g, tw, th };
    return _grids[mi];
  }

  function blockedAt(mi, px, py) {
    const md = MAPS[mi];
    if (px < 0 || py < 0 || px >= md.w || py >= md.h) return true;
    const { g, tw } = getGrid(mi);
    return g[Math.floor(py / TILE) * tw + Math.floor(px / TILE)] === 1;
  }
  // 視線判定：兩點之間有牆就擋住（攻擊不能穿牆）
  function hasLOS(mi, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return true;
    const steps = Math.ceil(dist / (TILE * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (blockedAt(mi, x0 + dx * t, y0 + dy * t)) return false;
    }
    return true;
  }
  function inTownRect(mi, x, y) {
    if (mi >= 3 || !MAPS[mi]) return false;
    const T = TOWN;
    return x > T.x0 && x < T.x1 && y > T.y0 && y < T.y1;
  }

  // ---------- PvP / 其他 ----------
  const PVP_DROP_CHANCE = 0.10;
  const PVP_LEVEL_RANGE = 10;
  const GUARD_COUNT = 10;
  const GUARD_DURATION = 600000;
  const CHEST_RESPAWN = 180000;

  return {
    xpNeed, mobXP, LEVEL_CAP, CLASSES, SKILLS, QUALITIES, BOSS_QUALITY_ROLL, CHEST_QUALITY_ROLL,
    SLOTS, SLOT_NAMES, GEAR_TIERS, WEAPON_SUFFIX,
    ENHANCE_RATES, ENHANCE_SAFE, ENHANCE_BONUS, SCROLL_PRICE, POTION_PRICE, ARROW_PRICE, INN_PRICE, POTION_CD, POTION_HEAL,
    mobHP, mobATK, MOBS, MOB_RESPAWN, XP_MUL_MINI, XP_MUL_GRAND, MOB_COUNT_EACH,
    TILE, MAPS, TOWN, SCHOOL, KEYS_NEEDED, KEY_CHANCE, KEY_PITY, KEY_NAME,
    mulberry32, getGrid, blockedAt, hasLOS, inTownRect,
    PVP_DROP_CHANCE, PVP_LEVEL_RANGE, GUARD_COUNT, GUARD_DURATION, CHEST_RESPAWN
  };
});
