/* 把版本代碼寫進 index.html，讓靜態主機（Cloudflare）也能破快取。
   每次要發佈新版就執行： node stamp-build.js            */
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const files = ['public/client.js', 'public/shared/gamedata.js'];
const h = crypto.createHash('md5');
for (const f of files) h.update(fs.readFileSync(path.join(__dirname, f)));
const tag = h.digest('hex').slice(0, 8);
const p = path.join(__dirname, 'public/index.html');
let html = fs.readFileSync(p, 'utf8');
html = html.replace(/(\?v=)[0-9a-f]{8}|(\?v=)__V__/g, (m, a, b) => (a || b) + tag);
html = html.replace(/build (?:[0-9a-f]{8}|__V__)/g, 'build ' + tag);
fs.writeFileSync(p, html);
console.log('版本代碼已寫入 index.html：', tag);
