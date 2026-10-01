/* ==========================================================
   把 tools/wzu-grabber.js 的内容同步内联进页面的
   <script type="text/plain" id="grabberSrc">…</script> 块里。

   为什么要有这个脚本：
     抓取脚本必须能在「双击打开本地文件」的前提下被一键复制，
     而 file:// 下 fetch 读不到本地文件、iframe 读不到内容，
     所以只能在页面里内联一份。内联就存在「两份内容不同步」的风险 ——
     于是用这个脚本同步，并在 tests/consistency.test.js 里加断言守住。

   用法：node tools/sync-grabber.js
   ========================================================== */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(__dirname, 'wzu-grabber.js'), 'utf8').replace(/\s+$/, '');
const START = '<script type="text/plain" id="grabberSrc">';
const END = '</script>';
const TARGETS = ['me.html', 'schedule.html'];

if (/<\/script|<!--/i.test(SRC)) {
  console.log('✗ 抓取脚本里出现了 </script 或 <!--，无法安全内联到 HTML 中，请先改掉');
  process.exit(1);
}

let bad = 0;
TARGETS.forEach(function (f) {
  const p = path.join(ROOT, f);
  let html = fs.readFileSync(p, 'utf8');
  const i = html.indexOf(START);
  if (i < 0) { console.log('✗ ' + f + '：找不到 grabberSrc 容器'); bad++; return; }
  const j = html.indexOf(END, i + START.length);
  if (j < 0) { console.log('✗ ' + f + '：容器没有闭合'); bad++; return; }
  html = html.slice(0, i + START.length) + '\n' + SRC + '\n' + html.slice(j);
  fs.writeFileSync(p, html);
  console.log('✓ ' + f + '：已内联抓取脚本（' + SRC.split('\n').length + ' 行）');
});

process.exit(bad ? 1 : 0);
