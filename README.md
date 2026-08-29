# 龍領主 Online 🐉

多人連線網頁 RPG — 三職業、三大地圖、裝備強化、PvP、BOSS 討伐。

## 快速開始（本機執行）

**Windows 最簡單：** 安裝 [Node.js](https://nodejs.org)（LTS）後，直接雙擊 `start-game.bat` 即可！

手動方式：

1. 安裝 [Node.js](https://nodejs.org)（LTS 版本即可）
2. 在專案資料夾打開終端機，執行：

```bash
npm install
npm start
```

3. 打開瀏覽器，前往 `http://localhost:3000` 就能玩了！
4. 同一個 Wi-Fi 下的朋友可以用「你的區域網 IP:3000」加入
   （查 IP：Windows 用 `ipconfig`，Mac 用 `ifconfig`）

> ⚠ **Windows PowerShell 出現「因為這個系統上已停用指令碼執行…SecurityError」？**
> 這是 PowerShell 的執行原則擋住 npm，改用 `npm.cmd install` 與 `npm.cmd start` 即可；
> 或執行一次 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`（按 Y）永久解決；
> 或干脆雙擊 `start-game.bat`，完全不用打指令。

## 部署到雲端（免費，朋友輸入網址就能玩）

推薦使用 Render.com，詳細步驟請見附帶的《部署教學》。
重點：Build Command 填 `npm install`，Start Command 填 `npm start`。

## 操作

| 按鍵 | 功能 |
|---|---|
| W A S D / 方向鍵 | 移動（手機用左下角浮水方向鍵） |
| 滑鼠左鍵 / 空白鍵 | 普通攻擊 |
| Q / E | 職業技能（右下也有技能圈可點） |
| R | 喝快速回血瓶 |
| B | 背包／裝備（紙娃娃） |
| F | 撿取／互動（商店・鐵匠鋪・旅店・寶箱・傳送門） |
| Enter | 聊天 |

右下角「自動」按鈕＝自動攻擊附近的怪（不放技能）。
手機支援：浮水式方向鍵、觸控技能圈、自動縮放視野、直式與橫式版面。

## 遊戲內容

- **三職業**：戰士（近戰橫掃）、射手（遠程・消耗箭矢）、刺客（高速高爆擊）
- **職業技能**（Q/E）：戰士＝旋風斬/衝鋒、射手＝三連矢/爆裂箭、刺客＝影襲/毒刃
- **四張地圖**：碎裂之峰(1-50) → 黑暗聖殿(50-150) → 火山王座(150-300) → 中崙學園（王的領域）
  - 主要地圖 1:4000 迷宮化地形；每張有 1:200 城牆城鎮（西/東雙門、鐵匠鋪、裝備店、雜貨商店、住宿旅店、莊嚴復活點、BOSS 出現大空間）
  - BOSS 位於離城鎮最遠的專屬領地（魔像深谷／黑暗聖所），脫戰 5 秒會快速回血
  - 進第二圖需擊敗小BOSS「岩石魔像」；進第三圖需擊敗「黑暗信徒」且達 150 級
  - 火山王座寶箱 5% 開出「火山鑰匙」（有保底），集齊 3 把可開啟中央古代火山傳送門
  - 第四圖以中崙高中平面圖為參考（1:500），龍領主 伊格尼斯坐鎮 707 班
  - 首殺 BOSS 獲得不可交易紀念道具（岩石核心／黑暗聖章）
- **裝備外觀**：六階級（新手／岩石／精鋼／黑暗／秘銀／龍神）各有專屬圖示，越高階越華麗
  （黑暗以上有雙角與寶石、秘銀會發光、龍神有龍鱗與火焰紋）；換裝後角色外觀即時改變
- **裝備品質**：灰 < 綠 < 藍 < 紫 < 金 < 紅 < 彩（金紅彩只有 BOSS 會掉）
- **職業限制**：滑鼠移到裝備會顯示可否裝備，無法使用的武器在背包中以斜線與 🚫 標示
- **強化**：鐵匠鋪 +1(100%) 到 +10(0.5%)，失敗降一級，每次消耗一張強化卷軸
- **PvP**：擊殺 ±10 級玩家有 10% 掉裝；城鎮殺人會被 10 名士兵追殺 10 分鐘
- **經濟**：強化卷軸 30,000、回血瓶 1,000（回 1/5 血、CD 30 秒）、箭矢 1 金幣

## 帳號資料與進度保存

預設進度存在 `data/db.json`（每 15 秒自動存檔）。
遊客模式依 IP 保存進度；註冊帳號可跨裝置遊玩。

### 讓雲端部署的進度永久保存（免費）

Render 免費方案每次重新部署會清空檔案，進度會消失。解法：接一個免費的雲端資料庫（Supabase）。

1. 到 [supabase.com](https://supabase.com) 註冊 → New project（Region 選 **Southeast Asia (Singapore)**），
   自己設一組 Database Password 並記下來
2. 專案建好後點上方「**Connect**」→ 選 **Session pooler** 那一段連線字串
   （⚠ 一定要用 Session pooler，Render 不支援 Direct connection 的 IPv6）
3. 把字串裡的 `[YOUR-PASSWORD]` 換成你剛設的密碼
4. 到 Render 你的服務 →「Environment」→「Add Environment Variable」：
   - Key 填 `DATABASE_URL`，Value 貼上完整字串 → Save（會自動重新部署）
5. Logs 出現「✔ 已連接雲端資料庫」就成功了——之後怎麼重新部署，進度都在！

> Supabase 免費方案：500 MB 資料庫（我們的存檔只有幾 MB）、閒置一週會自動暫停
> （**資料不會刪除**，到 Dashboard 按 Restore 約 30 秒即可復原；伺服器運作中會自動送 keep-alive）。
> 也可改用 Neon 等其他 Postgres，一樣只要換 `DATABASE_URL`，程式完全不用改。

## 專案結構

```
server.js          遊戲伺服器（帳號、世界模擬、戰鬥、掉落）
shared/gamedata.js 所有數值設定（想改平衡就改這裡！）
public/index.html  遊戲頁面與 UI
public/client.js   前端渲染與操作
public/sprites/    角色與怪物圖片
```
