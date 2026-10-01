/* ==========================================================
   把一份课表 PDF 走完整链路跑一遍，看看能认出什么
   ----------------------------------------------------------
   用途：排查「这份 PDF 为什么识别得不对」时最省事的入口。
     · 打印识别出的每一行（就是弹窗文本框里会显示的内容）
     · 再交给 ImportEdu 解析，打印最终入库的课程
     · 打印模式 / 页数 / 碎片数 / 警告

   用法：node tools/recognize-pdf.js <课表.pdf>
   需要 NODE_PATH 指向装了 pdfjs-dist 的目录。
   ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* 给了第二个参数就写文件（Windows 下 shell 重定向会把中文编码搞坏，
   宁可让 Node 自己写），没给就打屏。 */
const OUT = process.argv[3] ? [] : null;
function say(s) {
  if (OUT) OUT.push(s);
  else console.log(s);
}
function flush() {
  if (OUT) fs.writeFileSync(path.resolve(process.argv[3]), OUT.join('\n'), 'utf8');
}

function loadPdfjs() {
  const tries = ['pdfjs-dist/legacy/build/pdf.js', 'pdfjs-dist/build/pdf.js', 'pdfjs-dist'];
  for (let i = 0; i < tries.length; i++) {
    try { const L = require(tries[i]); if (L && L.getDocument) return L; } catch (e) { }
  }
  return null;
}

/* 浏览器里 pdfedu.js 靠 <script> 拿全局，这里用 vm 造一个同样的环境 */
const sandbox = {
  console: { log: function () { } },
  Promise: Promise, Math: Math, JSON: JSON, Object: Object, Array: Array,
  String: String, Number: Number, Boolean: Boolean, Error: Error,
  parseFloat: parseFloat, parseInt: parseInt, isNaN: isNaN, Date: Date, RegExp: RegExp,
  Uint8Array: Uint8Array, ArrayBuffer: ArrayBuffer, Buffer: Buffer, fetch: fetch
};
vm.createContext(sandbox);
/* 注意加载顺序要和浏览器一致：内联 CMap 先到位，pdfedu.js 里那个
   CMapReaderFactory 才拿得到 UniGB-UCS2-H 之类的中文字库映射。 */
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/vendor/pdfjs/cmaps-inline.js'), 'utf8'), sandbox);
['pdfedu.js', 'importedu.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), sandbox);
});
const PdfEdu = sandbox.PdfEdu;
const ImportEdu = sandbox.ImportEdu;

const file = process.argv[2];
if (!file) { console.log('用法：node tools/recognize-pdf.js <file.pdf> [out.txt]'); process.exit(1); }
const lib = loadPdfjs();
if (!lib) { console.log('没找到 pdfjs-dist'); process.exit(1); }
PdfEdu.useLib(lib);

const buf = fs.readFileSync(path.resolve(file));
PdfEdu.extractBuffer(new Uint8Array(buf), {
  onProgress: function (m) { say('… ' + m); }
}).then(function (r) {
  say('\n===== 识别结果 =====');
  say('模式: ' + r.mode + '   页数: ' + r.pages + '   碎片: ' + r.items +
    '   列: ' + r.cols + '   扫描件: ' + r.scanned);
  say('警告: ' + (r.warnings.length ? r.warnings.join(' | ') : '（无）'));
  say('\n--- 识别出的课程行（' + r.lines.length + ' 行）---');
  r.lines.forEach(function (l, i) { say(String(i + 1).padStart(3) + '. ' + l); });

  say('\n===== 交给 ImportEdu 解析 =====');
  const p = ImportEdu.parsePayloadText(r.text);
  say('课程 ' + p.courses.length + ' 条，警告: ' + (p.warnings.join(' | ') || '（无）'));
  say('\n周 节次   课程 / 老师 / 教室 / 周次');
  p.courses.forEach(function (c) {
    say('周' + c.day + ' 第' + c.start + '-' + (c.start + c.span - 1) + '节  ' +
      c.name + ' / ' + (c.teacher || '—') + ' / ' + c.room + ' / ' + c.from + '-' + c.to + '周');
  });
  const noRoom = p.courses.filter(function (c) { return c.room === '待定'; });
  const noTeacher = p.courses.filter(function (c) { return !c.teacher; });
  say('\n教室待定 ' + noRoom.length + ' 条，老师缺失 ' + noTeacher.length + ' 条');
  flush();
  process.exit(r.lines.length ? 0 : 1);
}, function (e) {
  say('!! 失败: ' + (e && e.stack ? e.stack : e));
  flush();
  process.exit(1);
});
