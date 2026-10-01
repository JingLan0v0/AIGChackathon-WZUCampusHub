/* ==========================================================
   生成 assets/vendor/pdfjs/cmaps-inline.js
   ----------------------------------------------------------
   为什么需要这个文件：
     pdf.js 遇到用「预定义 CMap」的 PDF（例如温大教务的 iText 导出，
     字体 STSong-Light + /Encoding /UniGB-UCS2-H）时，必须拿到对应的
     .bcmap 才能解出文字，否则一个碎片都吐不出来（实测 0 → 188）。
     cMapUrl 走的是 fetch/XHR —— 而双击打开（file://）时浏览器
     禁止读取本地文件，这条路就断了。

     所以：把几个最常用的中文 CMap 直接 base64 塞进 JS，
     再实现一个自定义 CMapReaderFactory 从内存里给 pdf.js。
     这样无论 http 还是 file:// 都能识别。

   哪些 CMap：简体中文（UniGB）+ GBK 三件套，覆盖国内教务系统。
   更冷门的编码由 assets/vendor/pdfjs/cmaps/（全量 169 个）兜底。

   用法：node tools/make-cmaps-inline.js
   ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, 'assets/vendor/pdfjs/cmaps');
const DEST = path.resolve(ROOT, 'assets/vendor/pdfjs/cmaps-inline.js');

/* 只内联这几个。挑的理由：UCS2 / UTF16 是 iText 和大多数 Java 报表
   工具的默认选择，GBK-EUC / GBK2K 是国产老系统的常见写法。
   Adobe-GB1-UCS2 必须带上 —— 实测温大教务那份 PDF，pdf.js 除了要
   UniGB-UCS2-H，还会再要一张 Adobe-GB1-UCS2 做 CID→Unicode 反查，
   少一张就静默返回 0 个碎片（不报错，最难查的那种）。 */
const PICK = [
  'UniGB-UCS2-H', 'UniGB-UCS2-V',
  'UniGB-UTF16-H', 'UniGB-UTF16-V',
  'GBK-EUC-H', 'GBK-EUC-V',
  'GBK2K-H', 'GBK2K-V',
  'Adobe-GB1-UCS2'
];

const parts = [];
let total = 0;

PICK.forEach(function (name) {
  const p = path.join(SRC, name + '.bcmap');
  if (!fs.existsSync(p)) { console.log('  ! 缺 ' + name + '.bcmap，跳过'); return; }
  const b = fs.readFileSync(p);
  total += b.length;
  parts.push("    '" + name + "':\n      '" + b.toString('base64') + "'");
  console.log('  ' + name.padEnd(16) + (b.length / 1024).toFixed(1) + ' KB');
});

const js = [
  '/* ==========================================================',
  '   自动生成，请勿手改 —— 由 tools/make-cmaps-inline.js 生成',
  '   ----------------------------------------------------------',
  '   pdf.js 解析「预定义 CMap」PDF（如温大教务 iText 导出）时必须',
  '   有对应 .bcmap；而 file:// 下 fetch 读不了本地文件。',
  '   这里把常用中文 CMap 直接 base64 内联，配合 pdfedu.js 里的',
  '   自定义 CMapReaderFactory，双击打开也能识别课表 PDF。',
  '',
  '   原始来源：pdfjs-dist@3.11.174 的 cmaps/ 目录',
  '   全量版本在 assets/vendor/pdfjs/cmaps/（169 个，http 下走这条）',
  '   ========================================================== */',
  "(function (root, factory) {",
  "  if (typeof module === 'object' && module.exports) module.exports = factory();",
  "  else root.PdfCmaps = factory();",
  "})(typeof self !== 'undefined' ? self : this, function () {",
  "  'use strict';",
  "  var B64 = {",
  parts.join(',\n'),
  '  };',
  '',
  '  /* base64 → Uint8Array。浏览器用 atob，Node 用 Buffer。 */',
  '  function decode(name) {',
  '    var s = B64[name];',
  '    if (!s) return null;',
  '    if (typeof atob === \'function\') {',
  '      var bin = atob(s), out = new Uint8Array(bin.length);',
  '      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);',
  '      return out;',
  '    }',
  '    if (typeof Buffer !== \'undefined\') return new Uint8Array(Buffer.from(s, \'base64\'));',
  '    return null;',
  '  }',
  '',
  '  return {',
  '    names: Object.keys(B64),',
  '    has: function (n) { return !!B64[n]; },',
  '    decode: decode',
  '  };',
  '});',
  ''
].join('\n');

fs.writeFileSync(DEST, js, 'utf8');
console.log('\n已生成 ' + path.relative(ROOT, DEST));
console.log('内联原始 ' + (total / 1024).toFixed(1) + ' KB → 文件 ' +
  (fs.statSync(DEST).size / 1024).toFixed(1) + ' KB');
