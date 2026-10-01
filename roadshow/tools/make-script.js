/* ==========================================================
   口播稿导出：把模板里每页的标题与 data-note 抽成 markdown，彩排时对着念
   ----------------------------------------------------------
   顺带统计每页要点数（点击次数 = 要点数 + 1），方便控制节奏。
   用法：node roadshow/tools/make-script.js
   ========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'deck.template.html'), 'utf8');
const slides = html.split('<section class="slide').slice(1);

const out = ['# 校园百事通 · 路演口播稿（3-5 分钟）', '',
  '> 演示方式：点一下出一块内容，本页内容点完才翻页。',
  '> 键盘：→ / 空格 = 继续，← = 回退，F 全屏，N 开关备注，数字键跳页。',
  '> 打开文件后按 F 全屏，建议提前在投影仪上试一次缩放（舞台会自动等比适配）。', ''];

slides.forEach((s, i) => {
  const title = (s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || s.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [, ''])[1]
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const note = (s.match(/data-note="([^"]*)"/) || [, '（这页没写备注）'])[1];
  const frags = (s.match(/class="frag"/g) || []).length;
  out.push('## 第 ' + (i + 1) + ' 页 · ' + title);
  out.push('');
  out.push('- **要点**：' + frags + ' 个（点 ' + (frags + 1) + ' 下翻页）');
  out.push('- **口播**：' + note);
  out.push('');
});

out.push('---', '', '## 时间分配建议（总 4 分钟）', '',
  '| 段落 | 页 | 时长 |', '|---|---|---|', '',
  '| 开场 | 1 | 15 秒 |',
  '| 问题 | 2-3 | 60 秒 |',
  '| 答案 | 4-5 | 40 秒 |',
  '| 功能演示 | 6-9 | 90 秒 |',
  '| AI 与实现 | 10-12 | 50 秒 |',
  '| 演示路线 + 收尾 | 13-14 | 25 秒 |', '');

const dest = path.join(ROOT, '演讲稿.md');
fs.writeFileSync(dest, out.join('\n'), 'utf8');
console.log('已生成：' + dest + '（' + slides.length + ' 页）');
