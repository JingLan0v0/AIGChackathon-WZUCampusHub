/* ==========================================================
   全量语法检查（零依赖）
   ----------------------------------------------------------
   等价于对每个 js 文件跑 node --check，但一次跑完并把失败项列清楚。
   用法：node tools/check-syntax.js
   ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['assets/js', 'tools', 'tests'];

const files = [];
DIRS.forEach(function (d) {
  const full = path.join(ROOT, d);
  if (!fs.existsSync(full)) return;
  fs.readdirSync(full)
    .filter(function (f) { return f.endsWith('.js'); })
    .sort()
    .forEach(function (f) { files.push(path.join(d, f)); });
});

const bad = [];
files.forEach(function (f) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' });
  } catch (e) {
    bad.push(f + ' :: ' + String(e.stderr || e.message).split('\n').slice(0, 2).join(' '));
  }
});

console.log('语法检查：' + files.length + ' 个文件，失败 ' + bad.length + ' 个');
if (bad.length) {
  bad.forEach(function (b) { console.log('  ✗ ' + b); });
  process.exit(1);
}
console.log('✓ 全部通过');
