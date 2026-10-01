/* ==========================================================
   路演稿构建：把模板里的 {{SHOT:名字}} 换成真实截图（base64 内嵌）
   ----------------------------------------------------------
   产物：roadshow/校园百事通-路演.html —— 单个文件，随便拷到哪都能放
   用法：node roadshow/tools/build-deck.js
   ========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const tpl = fs.readFileSync(path.join(ROOT, 'deck.template.html'), 'utf8');
const out = path.join(ROOT, '校园百事通-路演.html');

let used = [], missing = [];
const html = tpl.replace(/\{\{SHOT:([\w-]+)\}\}/g, function (_, name) {
  const p = path.join(ROOT, 'shots', name + '.png');
  if (!fs.existsSync(p)) { missing.push(name); return ''; }
  used.push(name);
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
});

if (missing.length) {
  console.error('缺图：' + missing.join('、'));
  process.exit(1);
}
fs.writeFileSync(out, html, 'utf8');
console.log('已生成：' + out);
console.log('内嵌截图 ' + used.length + ' 张：' + used.join('、'));
console.log('文件大小 ' + (fs.statSync(out).size / 1024 / 1024).toFixed(1) + ' MB');
