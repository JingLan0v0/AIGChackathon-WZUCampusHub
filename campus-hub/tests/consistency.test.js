/* 校园百事通 · 静态一致性校验
   用法：node tests/consistency.test.js
   检查：CSS 括号平衡、HTML/JS 引用的文件与页面是否都存在、
         JS 里拼出来的 class 是否都在 CSS 中定义过。*/

/* 静态一致性校验 v2 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const JSDIR = ROOT + '/assets/js';
const problems = [];

/* ---------- 1. CSS 括号平衡 ---------- */
const css = fs.readFileSync(ROOT + '/assets/css/main.css', 'utf8');
let depth = 0, line = 1; const bad = [];
for (const ch of css) {
  if (ch === '\n') line++;
  else if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth < 0) { bad.push('第 ' + line + ' 行多余 }'); depth = 0; } }
}
if (depth !== 0) bad.push('结尾还有 ' + depth + ' 个未闭合的 {');
console.log('[1] CSS 括号平衡: ' + (bad.length ? '✗ ' + bad.join(' / ') : '✓') + '（' + css.split('\n').length + ' 行）');
problems.push(...bad);

/* CSS 中定义过的 class */
const defined = new Set();
let m; const clsRe = /\.(-?[_a-zA-Z][\w-]*)/g;
while ((m = clsRe.exec(css))) defined.add(m[1]);
console.log('[2] CSS 定义 class 数: ' + defined.size);

/* ---------- 2. HTML / JS 里的资源引用是否存在 ---------- */
const htmls = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const jsFiles = fs.readdirSync(JSDIR).filter(f => f.endsWith('.js'));
let refCount = 0;
htmls.forEach(f => {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  [...src.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].forEach(x => {
    if (/^(data:|https?:|mailto:|#)/.test(x[1])) return;
    refCount++;
    if (!fs.existsSync(path.join(ROOT, x[1]))) problems.push(f + ' 引用不存在: ' + x[1]);
  });
});
jsFiles.forEach(f => {
  const src = fs.readFileSync(path.join(JSDIR, f), 'utf8');
  [...src.matchAll(/(?:href|location\.href\s*=|location\.replace\()\s*['"]([\w.-]+\.html)['"]/g)].forEach(x => {
    refCount++;
    if (!fs.existsSync(path.join(ROOT, x[1]))) problems.push(f + ' 跳转不存在页面: ' + x[1]);
  });
});
[...fs.readFileSync(JSDIR + '/ui.js', 'utf8').matchAll(/href:\s*'([\w.-]+\.html)'/g)].forEach(x => {
  refCount++;
  if (!fs.existsSync(path.join(ROOT, x[1]))) problems.push('ui.js 导航指向不存在: ' + x[1]);
});
console.log('[3] 检查 ' + htmls.length + ' 个 HTML / ' + jsFiles.length + ' 个 JS，共 ' + refCount + ' 条资源与跳转引用');

/* ---------- 3. JS 里用到的 class 是否都在 CSS 中 ---------- */
/* 动态拼接出来的类名（不写死在 class="..." 里），全部手工列出 */
const DYNAMIC = [
  'urgent', 'top', 'now', 'past', 'done', 'meal', 'focus', 'course', 'overdue',
  'on', 'lg', 'modal-lg', 'today', 'today-col', 'item-card', 'accepted',
  'badge-grey', 'badge-yellow', 'badge-red', 'badge-green', 'badge-blue',
  'warn', 'tip', 'ok', 'err', 'lv1', 'lv2', 'lv3', 'open'
];
const used = new Map();
function add(c, f) { if (!used.has(c)) used.set(c, new Set()); used.get(c).add(f); }
jsFiles.forEach(f => {
  const src = fs.readFileSync(JSDIR + '/' + f, 'utf8');
  /* class="..." 里开头连续的小写类名片段；若片段紧贴引号结束，说明最后一个是被拼接的类名前缀，丢弃 */
  [...src.matchAll(/class="([a-z][\w -]*)/g)].forEach(x => {
    let seg = x[1];
    // 片段后面紧跟的字符：如果是引号且片段不以空格结尾 → 末尾 token 是拼接前缀（如 'chip lv' + l）
    const after = src.charAt(x.index + x[0].length);
    if (after === "'" && !/\s$/.test(seg)) seg = seg.replace(/[a-z0-9-]+$/, '');
    seg.split(/\s+/).filter(Boolean).forEach(c => add(c, f));
  });
  [...src.matchAll(/classList\.(?:add|toggle|remove)\(\s*'([\w -]+)'/g)].forEach(x =>
    x[1].split(/\s+/).filter(Boolean).forEach(c => add(c, f)));
});
DYNAMIC.forEach(c => add(c, '(dynamic)'));
htmls.forEach(f => {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  [...src.matchAll(/class="([^"]*)"/g)].forEach(x =>
    x[1].split(/\s+/).filter(Boolean).forEach(c => add(c, f)));
});

const missing = [];
used.forEach((files, c) => {
  if (!defined.has(c)) missing.push(c + '  ← ' + [...files].slice(0, 3).join(','));
});
console.log('[4] JS/HTML 用到的 class 共 ' + used.size + ' 个，未在 CSS 中定义的: ' + missing.length);
missing.sort().forEach(c => console.log('    ✗ ' + c));
problems.push(...missing.map(c => 'CSS 缺少 class: ' + c.split(' ')[0]));

/* ---------- 4. CSS 定义了但没用到的（提示） ---------- */
const combined = htmls.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') +
  jsFiles.map(f => fs.readFileSync(JSDIR + '/' + f, 'utf8')).join('\n');
const unused = [...defined].filter(c => !combined.includes(c));
console.log('[5] CSS 定义但 JS/HTML 未出现（仅提示）: ' + (unused.join(', ') || '无'));

/* ---------- 6. 抓取脚本：tools/wzu-grabber.js 与页面内的内联副本必须逐字一致 ----------
   抓取脚本要能在「双击打开本地文件」时一键复制，只能在页面里内联一份；
   内联就会有两份内容 —— 用 node tools/sync-grabber.js 同步，这里守住不被改歪。 */
const grabberSrc = fs.readFileSync(ROOT + '/tools/wzu-grabber.js', 'utf8').replace(/\s+$/, '');
const G_START = '<script type="text/plain" id="grabberSrc">';
const G_END = '</script>';
const grabberTargets = ['me.html', 'schedule.html'];
let grabOk = 0;
grabberTargets.forEach(f => {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const i = src.indexOf(G_START);
  if (i < 0) { problems.push(f + ' 缺少抓取脚本内联容器 grabberSrc'); return; }
  const j = src.indexOf(G_END, i + G_START.length);
  if (j < 0) { problems.push(f + ' 的 grabberSrc 没有闭合'); return; }
  const inline = src.slice(i + G_START.length, j).trim();
  if (inline !== grabberSrc) {
    problems.push(f + ' 内联的抓取脚本与 tools/wzu-grabber.js 不一致（跑一下 node tools/sync-grabber.js）');
    return;
  }
  if (/<\/script|<!--/i.test(inline)) { problems.push(f + ' 内联脚本里含 </script 或 <!--，会撑破 HTML'); return; }
  grabOk++;
});
console.log('[6] 抓取脚本内联同步: ' + (grabOk === grabberTargets.length
  ? '✓ ' + grabOk + '/' + grabberTargets.length + ' 页面与 tools/wzu-grabber.js 逐字一致'
  : '✗ 只有 ' + grabOk + '/' + grabberTargets.length + ' 一致'));

/* ---------- 7. 课表 PDF 识别：本地依赖 + 页面加载 ----------
   pdfedu.js 是「用到时才去拉」assets/vendor/pdfjs/pdf.min.js，
   路径是写在 JS 里的字符串，不会出现在 HTML 的 <script src> 里，
   上面第 [4] 项覆盖不到，所以单独守两道：
     ① pdf.js 真的在本地（断了网、双击打开也能用）
     ② 但凡加载了导入弹窗的页面，也必须加载 pdfedu.js（否则传 PDF 会哑火）
   ------------------------------------------------------------ */
const vendorDir = ROOT + '/assets/vendor/pdfjs';
const vendored = ['pdf.min.js', 'pdf.worker.min.js'];
const pdfeduSrc = fs.readFileSync(JSDIR + '/pdfedu.js', 'utf8');
const mVendor = pdfeduSrc.match(/VENDOR\s*=\s*'([^']+)'/);
const vendorPath = mVendor ? mVendor[1] : '';
const vendorMiss = vendored.filter(f => !fs.existsSync(path.join(vendorDir, f)));

if (!vendorPath) problems.push('pdfedu.js 里找不到 VENDOR 常量');
else if (!fs.existsSync(path.join(ROOT, vendorPath, 'pdf.min.js'))) {
  problems.push('pdfedu.js 的 VENDOR("' + vendorPath + '") 和真实目录对不上');
}
vendorMiss.forEach(f => problems.push('pdf.js 缺文件: assets/vendor/pdfjs/' + f));

const importPages = htmls.filter(f => fs.readFileSync(path.join(ROOT, f), 'utf8').indexOf('assets/js/importedu.js') >= 0);
const pdfMissing = importPages.filter(f => fs.readFileSync(path.join(ROOT, f), 'utf8').indexOf('assets/js/pdfedu.js') < 0);
if (pdfMissing.length) {
  problems.push(pdfMissing.join(', ') + ' 打开了导入弹窗却没加载 pdfedu.js（「传 PDF」会哑火）');
}
console.log('[7] 课表 PDF 识别: ' + (vendorMiss.length || !vendorPath || pdfMissing.length
  ? '✗ 缺 ' + (vendorMiss.concat(pdfMissing)).join(', ')
  : '✓ 本地 pdf.js 齐备，' + importPages.length + ' 个导入页面都挂上了'));

console.log('\n================ 结论 ================');
if (problems.length) { console.log('✗ 发现 ' + problems.length + ' 个问题:'); problems.forEach(p => console.log('  - ' + p)); process.exit(1); }
console.log('✓ CSS / HTML / JS 三方引用一致');
