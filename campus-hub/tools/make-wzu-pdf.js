/* ==========================================================
   生成「教务系统模板课表」样例 PDF
   ----------------------------------------------------------
   复现温大新教务导出（iText 生成）的那种课表 PDF 的三大特征：
     1. 竖版 MediaBox + /Rotate 90 —— 内容是横着的，页内坐标和
        肉眼看到的左右上下是错开的；
     2. 字体 STSong-Light + /Encoding /UniGB-UCS2-H（预定义 CMap，
        没有 ToUnicode）—— pdf.js 拿不到 CMap 就一个碎片都不吐；
     3. 每格是一整条长串（课名/节次/周次/场地/教师/教学班/学分…），
        会折行、会跨页续写。

   为什么值得单独造一份：光用手写坐标碎片测不出「CMap 缺失 → 0 个碎片」
   和「跨页续写被截断」这类真实故障 —— 这两种都真的踩过。

   用法：node tools/make-wzu-pdf.js [输出路径]
   也是 tests/pdf.test.js ③ 层的测试固件（直接 require 这个文件）。
   ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

/* ---------- 版面常量（照着真实导出文件的量级来） ---------- */
const PAGE_W = 595, PAGE_H = 842;     /* MediaBox：竖版；配合 /Rotate 90 看到的是 842 x 595 */
const HEAD_Y = 520;                   /* 表头行（时间段 / 节次 / 星期几）的 Tm.y */
const SEC_X = 88;                     /* 节次列（1、2、3…）的 Tm.x */
const DAY_X0 = 150, DAY_PITCH = 100;  /* 星期列的 Tm.x：150、250、…、750 */
const LINE_STEP = 12;                 /* 同一格内行与行的间距 */
const TEXT_TOP = 495;                 /* 每页每列第一条文字的 Tm.y */
const LINES_PER_PAGE = 10;            /* 一页一列最多放多少行 —— 调小一点就能造出跨页续写 */
const WRAP = 14;                      /* 折行宽度（字符数），故意在词中间断，考验拼接 */

const DAYS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

/* ---------- 样例课表 ---------- */
const WZU_COURSES = [
  { name: '数据结构', day: 1, sec: '1-2', weeks: '1-16', teacher: '陈立', room: '南5-A101', credit: '3.0' },
  { name: '高等数学A(一)', day: 1, sec: '3-4', weeks: '1-16', teacher: '王志远', room: '南6-B403', credit: '4.0' },
  { name: '大学英语(三)', day: 2, sec: '3-4', weeks: '1-16', teacher: '李梅', room: '南外语楼305', credit: '2.0' },
  { name: '人工智能与艺术人文', day: 2, sec: '6-9', weeks: '6-9', teacher: '胡文超,叶茜', room: '南9-B203', credit: '2.0' },
  { name: '计算机组成原理', day: 3, sec: '1-2', weeks: '2-16', parity: '双', teacher: '张敏', room: '南5-A201', credit: '3.5' },
  { name: '体育(篮球)', day: 3, sec: '3-4', weeks: '2-16', teacher: '赵刚', room: '南水泥篮球场', credit: '0.75' },
  { name: '概率论与数理统计C', day: 4, sec: '6-7', weeks: '1-15', parity: '单', teacher: '王国忠', room: '南6-B403', credit: '3.0' },
  { name: '面向对象程序设计', day: 5, sec: '6-7', weeks: '1-16', teacher: '张楠', room: '南5-A101', credit: '3.0' }
];

/* 一格的完整长串 —— 字段顺序和分隔符都照真实导出文件来 */
function wzuCellText(c) {
  return c.name + '★(' + c.sec + '节)' + c.weeks + '周' + (c.parity ? '(' + c.parity + ')' : '') +
    '/校区:南校区/场地:' + c.room + '/教师:' + c.teacher +
    '/教学班:(2026-2027-1)-142006601L-20180171-1/教学班组成:25人工智能1;25人工智能2' +
    '/课程性质简称:必选/选课备注:/课程学时组成:讲课:32,实验:16/周学时:2/总学时:32/学分:' + c.credit;
}

function wrapText(s, n) {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

/* 把一个字符编码成 UTF-16BE 十六进制串 —— UniGB-UCS2-H 吃的就是这个 */
function hex(str) {
  let h = '';
  for (const ch of String(str)) h += ch.codePointAt(0).toString(16).padStart(4, '0').toUpperCase();
  return h;
}

/* ==========================================================
   排出一页页的文字块 —— 供 buildWzuPdf 使用，也方便单测检查版面
   返回 [[{x, y, size, text}, ...], ...]（每页一组）
   ========================================================== */
function wzuSamplePages(courses) {
  const list = courses || WZU_COURSES;

  /* 每列各自一条竖着的「长条」，先把全部文字行排出来 */
  const columnLines = DAYS.map(() => []);
  list.forEach(function (c) {
    const lines = wrapText(wzuCellText(c), WRAP);
    lines.forEach(function (t) { columnLines[c.day - 1].push(t); });
  });

  /* 按页切开：一页最多 LINES_PER_PAGE 行，剩下的接到下一页
     （真实模板就是这么干的：第 2 页没有表头，直接接着写） */
  let pages = 1;
  columnLines.forEach(function (lines) {
    pages = Math.max(pages, Math.ceil(lines.length / LINES_PER_PAGE));
  });

  const out = [];
  for (let p = 0; p < pages; p++) {
    const blocks = [];

    if (p === 0) {
      /* 页眉（在表头行上面，识别时应该被丢掉） */
      blocks.push({ x: 361, y: 560, size: 13, text: '温州大学  2026-2027 学年第一学期  学生课表' });
      blocks.push({ x: 30, y: 548, size: 10, text: '学号：25211980240  姓名：张同学' });
      blocks.push({ x: 700, y: 560, size: 10, text: '打印时间：2026-09-22' });

      /* 表头行 */
      blocks.push({ x: 30, y: HEAD_Y, size: 12, text: '时间段' });
      blocks.push({ x: SEC_X - 10, y: HEAD_Y, size: 12, text: '节次' });
      DAYS.forEach(function (d, i) {
        blocks.push({ x: DAY_X0 + i * DAY_PITCH, y: HEAD_Y, size: 12, text: d });
      });

      /* 上午 / 下午 / 晚上 行标（故意放在星期列附近，考验「结构文字要丢掉」） */
      blocks.push({ x: 155, y: 430, size: 9, text: '上午' });
      blocks.push({ x: 155, y: 250, size: 9, text: '下午' });
      blocks.push({ x: 155, y: 90, size: 9, text: '晚上' });

      /* 节次列的号码（也故意放在星期列够得着的地方） */
      for (let k = 0; k < 12; k++) {
        blocks.push({ x: SEC_X, y: 470 - k * 36, size: 12, text: String(k + 1) });
      }
    }

    columnLines.forEach(function (lines, di) {
      lines.slice(p * LINES_PER_PAGE, (p + 1) * LINES_PER_PAGE).forEach(function (t, li) {
        blocks.push({
          x: DAY_X0 + di * DAY_PITCH,
          y: TEXT_TOP - li * LINE_STEP,
          size: li === 0 ? 9 : 8,
          text: t
        });
      });
    });

    out.push(blocks);
  }
  return out;
}

/* ==========================================================
   把文字块写成一份真 PDF
   ----------------------------------------------------------
   字体不嵌字体文件（和真实导出一致）：/Type0 + STSong-Light +
   /Encoding /UniGB-UCS2-H + /DescendantFonts，文字用 UTF-16BE 十六进制串。
   pdf.js 要靠 cmaps/UniGB-UCS2-H.bcmap + Adobe-GB1-UCS2.bcmap 才解得出来 ——
   这正是我们要验的那条路。
   ========================================================== */
function buildWzuPdf(pages) {
  const objs = [];
  const streams = [];                 /* 每页一个内容流 */
  const pageObjNums = [];

  pages.forEach(function (blocks) {
    /* 注意 Tf 必须「资源名 + 字号」两个参数：写成 `8 Tf` pdf.js 会
       「Skipping command Tf: expected 2 args, but received 1 args」，
       然后整页文字全被丢掉 —— 这个坑踩过一次，别改回去。 */
    let content = '0 1 -1 0 ' + PAGE_W + ' 0 cm\n';
    blocks.forEach(function (b) {
      content += 'BT\n/F1 ' + b.size + ' Tf\n1 0 0 1 ' +
        b.x.toFixed(2) + ' ' + b.y.toFixed(2) + ' Tm\n<' + hex(b.text) + '> Tj\nET\n';
    });
    streams.push(Buffer.from(content, 'latin1'));
  });

  /* 对象号分配：1 目录，2 页面树，3 字体，4 字体描述符，
     5 CIDFont，然后每页占 2 个（页对象 + 内容流） */
  const FONT = 3, DESC = 4, CIDFONT = 5;
  const firstPage = 6;

  const pageObjs = [], contentObjs = [];
  pages.forEach(function (_, i) {
    pageObjs.push(firstPage + i * 2);
    contentObjs.push(firstPage + i * 2 + 1);
  });
  const total = firstPage + pages.length * 2 - 1;

  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Count ' + pages.length + ' /Kids [' +
    pageObjs.map(function (n) { return n + ' 0 R'; }).join(' ') + '] >>';
  objs[FONT] = '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light-UniGB-UCS2-H ' +
    '/Encoding /UniGB-UCS2-H /DescendantFonts [' + CIDFONT + ' 0 R] >>';
  objs[DESC] = '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 ' +
    '/FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 ' +
    '/CapHeight 880 /StemV 93 >>';
  objs[CIDFONT] = '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light ' +
    /* /Ordering 必须是 GB1，和真实导出文件一致：pdf.js 会照它去要
       Adobe-GB1-UCS2 这张 CID→Unicode 表。写成 Identity 它会去要
       Adobe-Identity-UCS2（不存在），整份字体加载失败 → 又是 0 个碎片。 */
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> ' +
    '/FontDescriptor ' + DESC + ' 0 R /DW 1000 >>';

  pages.forEach(function (_, i) {
    objs[pageObjs[i]] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] ' +
      '/Rotate 90 /Resources << /Font << /F1 ' + FONT + ' 0 R >> >> ' +
      '/Contents ' + contentObjs[i] + ' 0 R >>';
    objs[contentObjs[i]] = { stream: streams[i] };
  });

  const chunks = [];
  let pos = 0;
  function push(s) { const b = Buffer.from(s, 'latin1'); chunks.push(b); pos += b.length; }
  function pushRaw(b) { chunks.push(b); pos += b.length; }

  push('%PDF-1.4\n');
  const offsets = [];
  for (let i = 1; i <= total; i++) {
    offsets[i] = pos;
    const o = objs[i];
    if (o && o.stream) {
      push(i + ' 0 obj\n<< /Length ' + o.stream.length + ' >>\nstream\n');
      pushRaw(o.stream);
      push('\nendstream\nendobj\n');
    } else {
      push(i + ' 0 obj\n' + (o || '<< >>') + '\nendobj\n');
    }
  }
  const xrefPos = pos;
  let xref = 'xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= total; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push('trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

  return Buffer.concat(chunks);
}

module.exports = {
  buildWzuPdf: buildWzuPdf,
  wzuSamplePages: wzuSamplePages,
  wzuCellText: wzuCellText,
  WZU_COURSES: WZU_COURSES,
  DAYS: DAYS,
  PAGE_W: PAGE_W,
  PAGE_H: PAGE_H,
  LINES_PER_PAGE: LINES_PER_PAGE
};

/* ---------- 直接运行就写文件 ---------- */
if (require.main === module) {
  const out = process.argv[2] || path.resolve(__dirname, '..', 'sample', 'sample-wzu-timetable.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const pages = wzuSamplePages(WZU_COURSES);
  const buf = buildWzuPdf(pages);
  fs.writeFileSync(out, buf);
  console.log('已生成教务系统模板样例 PDF: ' + out + '  (' + pages.length + ' 页, ' +
    (buf.length / 1024).toFixed(1) + ' KB, ' + WZU_COURSES.length + ' 门课)');
  console.log('用法：打开校园百事通 → 课表页 → 导入真实课表 → 选择课表 PDF → 选这个文件');
}
