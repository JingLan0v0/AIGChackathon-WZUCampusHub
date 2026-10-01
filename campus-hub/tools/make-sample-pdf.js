/* ==========================================================
   生成「课表样例 PDF」
   ----------------------------------------------------------
   用途有两个：
     1. 跑一下就能得到一份 sample/sample-timetable.pdf，
        可以直接拖进「导入真实课表 → 选择课表 PDF」试功能，
        也能当答辩演示素材（不用等真实教务系统导出）。
     2. tests/pdf.test.js 复用这里的 buildPdf()，不重复写两套。

   为什么手写 PDF 而不用第三方库：项目要保持零依赖。
   中文没法用 PDF 标准 14 字体，嵌入字体文件又太重，
   所以用 Identity-H + 内嵌 ToUnicode CMap —— 把每个字映射成一个 GID，
   再声明「这个 GID 是哪个字」。这是唯一既不需要外部 CMap 文件、
   也不需要字体文件的做法，pdf.js 认。

   用法：node tools/make-sample-pdf.js [输出路径]
   ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

/* 模拟字体的字宽：一个汉字 1000/1000 em，半个西文 520/1000 em */
function charUnits(ch) { return ch.codePointAt(0) > 255 ? 1000 : 520; }

function textWidth(str, size) {
  let u = 0;
  for (const ch of str) u += charUnits(ch);
  return u / 1000 * size;
}

/* blocks: [{ text, x, y, size }]，x/y 是 PDF 坐标（左下角原点，y 向上为正） */
function buildPdf(blocks) {
  const chars = [], gidOf = {};
  function gidOfChar(ch) {
    if (!gidOf[ch]) { chars.push(ch); gidOf[ch] = chars.length; }
    return gidOf[ch];
  }
  function hexText(str) {
    let h = '';
    for (const ch of str) h += gidOfChar(ch).toString(16).padStart(4, '0').toUpperCase();
    return h;
  }

  /* 内容流：每个文字块用 Tm 直接摆到绝对坐标 */
  let content = '';
  blocks.forEach(b => {
    content += 'BT\n/F1 ' + b.size + ' Tf\n1 0 0 1 ' +
      b.x.toFixed(2) + ' ' + b.y.toFixed(2) + ' Tm\n<' + hexText(b.text) + '> Tj\nET\n';
  });

  /* 用到的字都得在 ToUnicode 里有映射，所以先跑完内容流再生成 CMap */
  const widths = chars.map(ch => charUnits(ch));
  let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
  for (let i = 0; i < chars.length; i += 100) {
    const part = chars.slice(i, i + 100);
    cmap += part.length + ' beginbfchar\n';
    part.forEach((ch, k) => {
      const g = (i + k + 1).toString(16).padStart(4, '0').toUpperCase();
      const u = ch.codePointAt(0).toString(16).padStart(4, '0').toUpperCase();
      cmap += '<' + g + '> <' + u + '>\n';
    });
    cmap += 'endbfchar\n';
  }
  cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';

  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
    '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>';
  objs[4] = { stream: Buffer.from(content, 'latin1') };
  objs[5] = '<< /Type /Font /Subtype /Type0 /BaseFont /WZUHei /Encoding /Identity-H ' +
    '/DescendantFonts [6 0 R] /ToUnicode 7 0 R >>';
  objs[6] = '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /WZUHei ' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
    '/FontDescriptor 8 0 R /DW 1000 /W [1 [' + widths.join(' ') + ']] >>';
  objs[7] = { stream: Buffer.from(cmap, 'latin1') };
  objs[8] = '<< /Type /FontDescriptor /FontName /WZUHei /Flags 4 ' +
    '/FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 ' +
    '/CapHeight 700 /StemV 80 >>';

  const chunks = [];
  let pos = 0;
  function push(s) { const b = Buffer.from(s, 'latin1'); chunks.push(b); pos += b.length; }
  function pushRaw(b) { chunks.push(b); pos += b.length; }

  push('%PDF-1.4\n');
  const offsets = [];
  for (let i = 1; i <= 8; i++) {
    offsets[i] = pos;
    const o = objs[i];
    if (o && o.stream) {
      push(i + ' 0 obj\n<< /Length ' + o.stream.length + ' >>\nstream\n');
      pushRaw(o.stream);
      push('\nendstream\nendobj\n');
    } else {
      push(i + ' 0 obj\n' + o + '\nendobj\n');
    }
  }
  const xrefPos = pos;
  let xref = 'xref\n0 9\n0000000000 65535 f \n';
  for (let i = 1; i <= 8; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push('trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

  return Buffer.concat(chunks);
}

/* ==========================================================
   样例课表：温大计算机与人工智能学院，标准网格（一行一个时段，一列一天）
   ========================================================== */
const DAYS = ['星期一', '星期二', '星期三', '星期四', '星期五'];
const COLS = [140, 230, 320, 410, 500];      /* 每天的列起点，列宽 90 */
const ROWS = [660, 600, 540, 480, 420];      /* 每行的中心 y */
const SLOTS = ['第1-2节', '第3-4节', '第5-6节', '第7-8节', '第9-10节'];

/* 每格：课名 / 老师 / 教室 / 周次；null 表示没课 */
const TABLE = [
  /* 第1-2节 */ [
    ['数据结构', '陈立', '计算机楼-408', '1-16周'],
    ['线性代数', '王海峰', '教A-105', '1-8周'],
    null,
    ['程序设计基础', '周琳', '计算机楼-402', '1-16周'],
    null
  ],
  /* 第3-4节 */ [
    ['高等数学A(一)', '王志远', '教A-203', '1-16周'],
    null,
    ['计算机组成原理', '张敏', '计算机楼-315', '1-16周'],
    null,
    ['人工智能导论', '郑伟', '计算机楼-501', '1-14周']
  ],
  /* 第5-6节 */ [
    null,
    ['大学英语(三)', '李梅', '外语楼305', '1-16周'],
    null,
    ['大学物理', '孙浩', '物理楼-201', '1-16周'],
    null
  ],
  /* 第7-8节 */ [
    null, null,
    ['体育(篮球)', '赵刚', '北校区体育馆', '2-16周'],
    null,
    ['思想道德与法治', '吴静', '人文楼-103', '1-16周']
  ],
  /* 第9-10节 */ [null, null, null, null, null]
];

function sampleBlocks() {
  const b = [];
  function put(text, x, y, size) { b.push({ text: text, x: x, y: y, size: size || 11 }); }
  function center(text, colLeft, colW, y, size) {
    const sz = size || 11;
    put(text, colLeft + (colW - textWidth(text, sz)) / 2, y, sz);
  }

  /* 页眉（在表格上方，识别时会被自动排除） */
  center('温州大学  2026-2027 学年第一学期  学生课表', 60, 470, 790, 13);
  put('学号：20230427      姓名：张同学      学院：计算机与人工智能学院', 60, 768, 10);

  /* 表头 */
  center('节次', 50, 70, 720);
  DAYS.forEach((d, i) => center(d, COLS[i], 90, 720));

  /* 表格内容：一格 4 行（课名 / 老师 / 教室 / 周次） */
  ROWS.forEach((yc, r) => {
    center(SLOTS[r], 50, 70, yc);
    TABLE[r].forEach((cell, c) => {
      if (!cell) return;
      const ys = [yc + 18, yc + 6, yc - 6, yc - 18];
      cell.forEach((line, k) => center(line, COLS[c], 90, ys[k], k === 0 ? 11 : 9.5));
    });
  });

  return b;
}

module.exports = { buildPdf: buildPdf, textWidth: textWidth, charUnits: charUnits, sampleBlocks: sampleBlocks };

/* ---------- 直接运行就写文件 ---------- */
if (require.main === module) {
  const out = process.argv[2] || path.resolve(__dirname, '..', 'sample', 'sample-timetable.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const buf = buildPdf(sampleBlocks());
  fs.writeFileSync(out, buf);
  console.log('已生成课表样例 PDF: ' + out + '  (' + (buf.length / 1024).toFixed(1) + ' KB)');
  console.log('用法：打开校园百事通 → 课表页 → 导入真实课表 → 选择课表 PDF → 选这个文件');
}
