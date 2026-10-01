'use strict';
const fs = require('fs');
const path = require('path');
const out = [];
const W = 'C:\\Users\\forey\\.workbuddy\\binaries\\node\\workspace\\node_modules\\pdfjs-dist';
const V = 'C:\\Users\\forey\\WorkBuddy\\2026-09-22-09-42-38\\campus-hub\\assets\\vendor\\pdfjs';

/* 1. cmaps 目录总大小 */
function dirSize(d) {
  let n = 0, s = 0;
  fs.readdirSync(d).forEach(f => {
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isFile()) { n++; s += st.size; }
  });
  return { n: n, s: s };
}
const c = dirSize(path.join(W, 'cmaps'));
out.push('cmaps: ' + c.n + ' 个文件, 合计 ' + (c.s / 1024).toFixed(0) + ' KB');

/* 2. 挑一批中文相关 CMap 看看体积 */
const want = ['UniGB-UCS2-H', 'UniGB-UCS2-V', 'UniGB-UTF16-H', 'UniGB-UTF16-V',
  'GBK-EUC-H', 'GBK-EUC-V', 'GBK2K-H', 'GBpc-EUC-H', 'GBT-EUC-H',
  'UniCNS-UCS2-H', 'UniCNS-UCS2-V', 'B5pc-H', 'ETen-B5-H',
  'UniJIS-UCS2-H', 'UniJIS-UCS2-V', 'UniKS-UCS2-H', 'UniKS-UCS2-V',
  'Adobe-GB1-UCS2', 'Add-H', 'Add-V'];
let sum = 0;
want.forEach(function (n) {
  const p = path.join(W, 'cmaps', n + '.bcmap');
  if (fs.existsSync(p)) { const s = fs.statSync(p).size; sum += s; out.push('  ' + n + '.bcmap = ' + (s / 1024).toFixed(1) + ' KB'); }
  else out.push('  ' + n + ' 缺失');
});
out.push('选中合计 ' + (sum / 1024).toFixed(0) + ' KB');

/* 3. 项目里已有的 vendor 文件 */
out.push('\n--- 项目 vendor ---');
fs.readdirSync(V).forEach(f => {
  const st = fs.statSync(path.join(V, f));
  out.push('  ' + f + ' = ' + (st.size / 1024).toFixed(0) + ' KB');
});

/* 4. pdf.min.js 里的 API 关键字 */
const src = fs.readFileSync(path.join(V, 'pdf.min.js'), 'latin1');
out.push('\n--- pdf.min.js 关键字 ---');
['CMapReaderFactory', 'cMapUrl', 'cMapPacked', 'standardFontDataUrl', 'useWorkerFetch',
  'DOMCMapReaderFactory', 'BaseCMapReaderFactory'].forEach(function (k) {
  let n = 0, i = 0;
  while ((i = src.indexOf(k, i)) >= 0) { n++; i += k.length; }
  out.push('  ' + k.padEnd(24) + ' 出现 ' + n + ' 次');
});

fs.writeFileSync('C:\\Users\\forey\\WorkBuddy\\2026-09-22-09-42-38\\.probe.txt', out.join('\n'), 'utf8');
