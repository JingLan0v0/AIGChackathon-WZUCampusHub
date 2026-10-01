/* ==========================================================
   校园百事通 · 课表 PDF 识别测试
   ----------------------------------------------------------
   分三层：

     ① 纯函数层 —— 拿「模拟的坐标碎片」喂 rebuild()，验证表格还原
     ② 端到端层 —— 现场造一份「标准网格」真 PDF，用 pdf.js 读出来，看能不能变成课程
     ③ 教务系统模板层 —— 现场造一份「温大新教务导出」样子的 PDF
        （/Rotate 90 + STSong-Light + 预定义 CMap + 每格一整条长串 +
         跨页续写），验证真实导出文件那条路走得通

   为什么非要第 ② 层：第 ① 层那些碎片格式（transform / width / height）
   是我自己手写的，万一和 pdf.js 的真实输出对不上，就会出现
   「测试全绿、实际跑不通」。第 ② 层把「假设本身」也验了。

   为什么非要第 ③ 层：真实教务导出文件踩过两个「静默失败」，
   手写碎片根本模拟不出来 ——
     · 不给 CMap 时 pdf.js 一个碎片都不吐，而且不报错（0 条课程，无提示）
     · 一格的文字会跨页续写，逐页处理会把那门课拦腰截断
   这两条都在这层里锁住。

   运行：node tests/pdf.test.js
   需要 NODE_PATH 指向装了 pdfjs-dist 的目录；没装则自动只跑第 ① 层。
   ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    console.log('  ✗ ' + name + (extra === undefined ? '' : '   → ' + extra));
  }
}
function section(t) { console.log('\n— ' + t + ' —'); }

/* ---------- 加载被测模块 ---------- */
const ctx = vm.createContext({
  console, Promise, Math, JSON, Object, Array, String, Number, Boolean,
  Error, parseFloat, parseInt, isNaN, Date, RegExp,
  /* 第 ③ 层要过 CMapFactory：内联字库解码在 Node 下走 Buffer，
     Uint8Array / ArrayBuffer / fetch 是那条路要用到的 */
  Uint8Array, ArrayBuffer, Buffer, fetch
});
function loadMod(file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', file), 'utf8'), ctx);
}
/* 顺序和浏览器一致：内联 CMap 先落到全局，pdfedu.js 里的
   CMapReaderFactory 才拿得到 UniGB-UCS2-H / Adobe-GB1-UCS2 */
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'assets/vendor/pdfjs/cmaps-inline.js'), 'utf8'), ctx);
loadMod('pdfedu.js');
loadMod('importedu.js');
const PdfEdu = ctx.PdfEdu;
const ImportEdu = ctx.ImportEdu;

/* 造 PDF 的活儿在 tools/make-sample-pdf.js 里，这里直接复用。
   不在测试里再抄一份 —— 两份实现迟早走样，而且那份工具
   顺手还能生成一份能直接拖进页面试的样例 PDF。 */
const makePdf = require('../tools/make-sample-pdf.js');
const buildPdf = makePdf.buildPdf;
const textWidth = makePdf.textWidth;
const charUnits = makePdf.charUnits;

/* ==========================================================
   ① 纯函数层：模拟坐标碎片 → 表格还原
   ========================================================== */

/* 模拟 pdf.js 的 textContent。列宽 100，列起点 40/150/250/350，
   文字居中 —— 居中比左对齐更难还原（起点会随文字长度变），
   故意用居中来压一压聚类算法。 */
const COLW = 100;
function mockItems(put) {
  const items = [];
  put(function (text, colLeft, y, size) {
    const sz = size || 11, w = textWidth(text, sz);
    items.push({
      str: text,
      transform: [1, 0, 0, 1, colLeft + (COLW - w) / 2, y],
      width: w, height: sz
    });
  });
  return { items: items };
}

function mockGrid() {
  return mockItems(function (put) {
    put('节次', 40, 760); put('星期一', 150, 760); put('星期二', 250, 760); put('星期三', 350, 760);
    put('第1-2节', 40, 688);
    put('数据结构', 150, 712); put('陈 立', 150, 700); put('计算机楼-408', 150, 688); put('1-16周', 150, 676);
    put('线性代数', 250, 712); put('王海峰', 250, 700); put('教A-105', 250, 688); put('1-8周', 250, 676);
    put('第3-4节', 40, 608);
    put('大学英语', 250, 632); put('李梅', 250, 620); put('外语楼305', 250, 608); put('1-16周', 250, 596);
    put('体育(篮球)', 350, 632); put('赵刚', 350, 620); put('北校区体育馆', 350, 608); put('2-16周', 350, 596);
  });
}

function mockCards() {
  return mockItems(function (put) {
    put('数据结构', 80, 700); put('陈立 · 计算机楼-408', 80, 688); put('周一 第1-2节 · 1-16周', 80, 676);
    put('大学英语', 80, 620); put('李梅 · 外语楼305', 80, 608); put('周三 第3-4节 · 1-16周', 80, 596);
  });
}

function mockBlank() {
  return mockItems(function (put) {
    put('温州大学学生课表', 80, 800); put('学号 20230427 姓名 张三', 80, 780);
  });
}

(function pureLayer() {
  console.log('========================================');
  console.log('① 纯函数层：坐标碎片 → 表格还原');
  console.log('========================================');

  section('碎片化');
  const its = PdfEdu.toItems(mockGrid());
  ok('toItems 收下所有非空碎片', its.length === 22, 'len=' + its.length);
  ok('坐标读对了（x/y 从 transform 里取）',
    its.some(i => Math.abs(i.x - 70.25) < 0.6 && Math.abs(i.y - 688) < 0.01));
  ok('字号读对了', its.every(i => i.h === 11));

  section('聚类：行 / 列');
  ok('行聚类按基线聚，一行是一条（不是糊成一片）', PdfEdu.linesOf(its).length === 9,
    'lines=' + PdfEdu.linesOf(its).length);
  ok('列聚类认出 4 列', PdfEdu.columnsOf(its).length === 4,
    'cols=' + PdfEdu.columnsOf(its).length);

  section('网格重建');
  const g = PdfEdu.gridRebuild(its);
  ok('认出是网格结构', !!g && g.mode === undefined && g.lines.length === 4,
    g ? 'lines=' + g.lines.length : 'null');
  ok('列数 / 行锚点数对得上', g && g.cols === 4 && g.rows === 2, g ? g.cols + '/' + g.rows : '');
  ok('表头「星期一」没被当成课程',
    !!g && !g.lines.some(l => l.indexOf('星期一') >= 0));
  ok('节次列自己的表头「节次」没混进来',
    !!g && g.lines.every(l => l.indexOf('节次') < 0));
  ok('周一的课带上「周一 第1-2节」前缀',
    !!g && g.lines[0] === '周一 第1-2节 数据结构 陈 立 计算机楼-408 1-16周', g ? g.lines[0] : '');
  ok('空格里的课也认出来了（周三 3-4 节）',
    !!g && g.lines.some(l => l.indexOf('体育(篮球)') >= 0 && l.indexOf('周三') === 0));
  ok('真正的节次都来自 PDF，没有靠猜', g && g.inferred === 0, g ? 'inferred=' + g.inferred : '');

  section('时间 → 节次（用项目的上课铃表）');
  ok('08:00-09:40 → 第 1-2 节（不是 1-3）', PdfEdu.secOfTime('08:00-09:40') === '1-2',
    PdfEdu.secOfTime('08:00-09:40'));
  ok('13:30-15:10 → 第 6-7 节（下午从第 6 节起算）', PdfEdu.secOfTime('13:30-15:10') === '6-7', PdfEdu.secOfTime('13:30-15:10'));
  ok('单个开始时间 18:30 → 第 11 节', PdfEdu.secOfTime('18:30') === '11', PdfEdu.secOfTime('18:30'));
  ok('晚间 19:15、20:00 分别为第 12、13 节', PdfEdu.secOfTime('19:15') === '12' && PdfEdu.secOfTime('20:00') === '13');
  ok('晚间连堂 18:30–20:40 → 第 11–13 节', PdfEdu.secOfTime('18:30-20:40') === '11-13', PdfEdu.secOfTime('18:30-20:40'));
  ok('没有时间时返回空', PdfEdu.secOfTime('第1-2节') === '', PdfEdu.secOfTime('第1-2节'));
  ok('节次推断兜底：两节连堂一行', PdfEdu.ordinalSec(0, 6) === '1-2' && PdfEdu.ordinalSec(2, 6) === '5-6');
  ok('节次推断兜底：一节课一行（行数多时）', PdfEdu.ordinalSec(0, 12) === '1' && PdfEdu.ordinalSec(4, 12) === '5');

  section('卡片式课表（没有网格）走逐行还原');
  const f = PdfEdu.flatRebuild(PdfEdu.toItems(mockCards()));
  ok('还原出 2 段（一门课一段）', f && f.length === 2, f ? 'len=' + f.length : 'null');
  ok('一门课的多行被并成一段', !!f && f[0].indexOf('数据结构') === 0 && f[0].indexOf('计算机楼-408') > 0,
    f ? f[0] : '');
  ok('rebuild 自动降级到 flat', PdfEdu.rebuild(PdfEdu.toItems(mockCards())).mode === 'flat');

  section('内容太少的 PDF 不该硬认');
  const blank = PdfEdu.rebuild(PdfEdu.toItems(mockBlank()));
  ok('认不出网格时不报错（走 flat）', blank.mode === 'flat');
  ok('认不出网格时给出提示', blank.warnings.join('').indexOf('没找到课表网格') >= 0);

  section('还原后的文本交给 ImportEdu 解析');
  const p = ImportEdu.parsePayloadText(g.lines.join('\n'));
  ok('解析出 4 条课程', p.courses.length === 4, 'n=' + p.courses.length);
  const ds = p.courses.filter(c => c.name === '数据结构')[0];
  ok('数据结构：老师 / 教室 / 节次 / 周次都对', !!ds &&
    ds.teacher === '陈立' && ds.room === '计算机楼-408' &&
    ds.day === 1 && ds.start === 1 && ds.span === 2 && ds.from === 1 && ds.to === 16,
    ds ? JSON.stringify(ds) : '');
  const en = p.courses.filter(c => c.name === '大学英语')[0];
  ok('「外语楼305」这种没横线的教室也能认出来（回归）', !!en && en.room === '外语楼-305',
    en ? en.room : '');
  ok('没横线的教室不会被当成课名', !!en && en.name === '大学英语' && en.teacher === '李梅',
    en ? en.name + '/' + en.teacher : '');
  const pe = p.courses.filter(c => c.name === '体育(篮球)')[0];
  ok('体育馆类教室正常', !!pe && pe.room === '北校区体育馆' && pe.day === 3);
})();

/* ==========================================================
   ② 端到端层：真 PDF → pdf.js → 课程
   ========================================================== */

function gridBlocks() {
  const b = [];
  function put(text, colLeft, y, size) {
    const sz = size || 11;
    b.push({ text: text, x: colLeft + (COLW - textWidth(text, sz)) / 2, y: y, size: sz });
  }
  put('节次', 40, 760); put('星期一', 150, 760); put('星期二', 250, 760); put('星期三', 350, 760);
  put('第1-2节', 40, 688);
  put('数据结构', 150, 712); put('陈立', 150, 700); put('计算机楼-408', 150, 688); put('1-16周', 150, 676);
  put('线性代数', 250, 712); put('王海峰', 250, 700); put('教A-105', 250, 688); put('1-8周', 250, 676);
  put('第3-4节', 40, 608);
  put('大学英语', 250, 632); put('李梅', 250, 620); put('外语楼305', 250, 608); put('1-16周', 250, 596);
  put('体育(篮球)', 350, 632); put('赵刚', 350, 620); put('北校区体育馆', 350, 608); put('2-16周', 350, 596);
  return b;
}

function loadPdfjs() {
  const tries = ['pdfjs-dist/legacy/build/pdf.js', 'pdfjs-dist/build/pdf.js', 'pdfjs-dist'];
  for (let i = 0; i < tries.length; i++) {
    try {
      const L = require(tries[i]);
      if (L && typeof L.getDocument === 'function') return L;
    } catch (e) { /* 试下一个路径 */ }
  }
  return null;
}

(async function run() {
  const before = { pass: pass, fail: fail };
  console.log('\n========================================');
  console.log('② 端到端层：真 PDF → pdf.js → 课程');
  console.log('========================================');

  const pdfjsLib = loadPdfjs();
  if (!pdfjsLib) {
    console.log('  ⏭ 没装 pdfjs-dist，跳过这一层（纯函数层结果仍然有效）');
    return;
  }
  PdfEdu.useLib(pdfjsLib);

  section('先确认这份 PDF 真能被解析');
  const buf = buildPdf(gridBlocks());
  ok('造出一份合法 PDF（%PDF- 开头 / %%EOF 结尾）',
    buf.slice(0, 5).toString() === '%PDF-' && buf.slice(-8).toString().indexOf('%%EOF') >= 0,
    buf.slice(0, 5).toString());

  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  ok('页数 1', doc.numPages === 1, 'pages=' + doc.numPages);

  section('假设验证：pdf.js 给的碎片格式和我们想的一样吗');
  const page = await doc.getPage(1);
  const items = PdfEdu.toItems(await page.getTextContent());
  ok('碎片数 = 文字块数', items.length === gridBlocks().length,
    items.length + ' vs ' + gridBlocks().length);

  const sample = items.filter(i => i.str === '数据结构')[0];
  const expX = 150 + (COLW - textWidth('数据结构', 11)) / 2;
  ok('transform[4] 就是 x', !!sample && Math.abs(sample.x - expX) < 1.5,
    sample ? 'x=' + sample.x + ' 期望≈' + expX.toFixed(1) : '缺');
  ok('height 就是字号', !!sample && Math.abs(sample.h - 11) < 1.6,
    sample ? 'h=' + sample.h : '');
  ok('width 和估算宽度同量级', !!sample &&
    Math.abs(sample.w - textWidth('数据结构', 11)) < 8,
    sample ? 'w=' + sample.w.toFixed(1) + ' 估算=' + textWidth('数据结构', 11).toFixed(1) : '');
  ok('中文经 ToUnicode 还原没乱码', items.some(i => i.str === '数据结构'));

  section('完整链路：传 PDF → 认出课程 → 解析入库');
  const r = await PdfEdu.extractBuffer(new Uint8Array(buf));
  ok('不是扫描件', r.scanned === false);
  ok('识别为网格课表', r.mode === 'grid', r.mode);
  ok('认出 4 条课程文字', r.lines.length === 4, 'lines=' + r.lines.length);

  const parsed = ImportEdu.parsePayloadText(r.text);
  const names = parsed.courses.map(c => c.name).sort().join(',');
  ok('解析出 4 条课程', parsed.courses.length === 4, 'n=' + parsed.courses.length);
  ok('四门课名全对', names === '体育(篮球),大学英语,数据结构,线性代数', names);
  ok('教室全都认出来了（没有「待定」）',
    parsed.courses.filter(c => c.room === '待定').length === 0,
    JSON.stringify(parsed.courses.map(c => c.room)));
  ok('老师全都认出来了',
    parsed.courses.filter(c => !c.teacher || c.teacher === '未填写').length === 0,
    JSON.stringify(parsed.courses.map(c => c.teacher)));
  ok('周次 / 星期 / 节次都对',
    parsed.courses.filter(c => c.from === 1 && c.to === 16).length >= 2 &&
    parsed.courses.some(c => c.day === 1 && c.start === 1) &&
    parsed.courses.some(c => c.day === 3 && c.start === 3),
    JSON.stringify(parsed.courses.map(c => '周' + c.day + '第' + c.start + '节 ' + c.from + '-' + c.to + '周')));

  section('异常 PDF 不该把页面搞崩');
  const bad = await PdfEdu.extractBuffer(new Uint8Array(Buffer.from('%PDF-1.4\ngarbage\n%%EOF')))
    .then(function () { return null; }, function (e) { return e; });
  ok('残缺 PDF 抛的是友好错误', !!bad && !!bad.message, bad ? bad.message : '没抛错');

  const blank = await PdfEdu.extractBuffer(new Uint8Array(buildPdf([
    { text: '这一页只有一句话', x: 80, y: 700, size: 11 }
  ])));
  ok('几乎没有文字的 PDF 标成 scanned（提示可能是扫描件）',
    blank.scanned === true, 'items=' + blank.items);

  /* ==========================================================
     ③ 教务系统模板层（温大新教务导出的那份长这样）
     ========================================================== */
  const beforeWzu = { pass: pass, fail: fail };
  console.log('\n========================================');
  console.log('③ 教务系统模板层：/Rotate 90 + 预定义 CMap + 跨页续写');
  console.log('========================================');

  const wzu = require('../tools/make-wzu-pdf.js');
  const wPages = wzu.wzuSamplePages(wzu.WZU_COURSES);
  const wbuf = wzu.buildWzuPdf(wPages);
  const wu8 = new Uint8Array(wbuf);

  section('固件本身是否真的再现了那三个特征');
  ok('造出多页（有跨页续写才测得出截断）', wPages.length >= 2, 'pages=' + wPages.length);
  ok('/Rotate 90 写进页面对象了', wbuf.toString('latin1').indexOf('/Rotate 90') >= 0);
  ok('字体走的是预定义 CMap（没有 ToUnicode 可兜底）',
    wbuf.toString('latin1').indexOf('/Encoding /UniGB-UCS2-H') >= 0 &&
    wbuf.toString('latin1').indexOf('/Ordering (GB1)') >= 0);
  ok('一格是一整条长串（课名/节次/场地/教师/学分都在里面）',
    wzu.wzuCellText(wzu.WZU_COURSES[0]).indexOf('/学分:') > 0 &&
    wzu.wzuCellText(wzu.WZU_COURSES[0]).indexOf('/场地:') > 0);

  section('回归：没有字库映射时 pdf.js 会静默返回空');
  /* 这就是当初「传了 PDF 但一条课都认不出来、也没报错」的真正原因。
     锁死它，免得以后有人觉得 cmaps 那堆文件是多余的给删了。 */
  const bare = await pdfjsLib.getDocument({ data: wu8 }).promise;
  let bareItems = 0;
  for (let p = 1; p <= bare.numPages; p++) {
    bareItems += (await (await bare.getPage(p)).getTextContent()).items.length;
  }
  ok('不给 CMap → 0 个碎片（且不抛错）', bareItems === 0, 'items=' + bareItems);

  section('完整链路：教务系统模板 PDF → 课程');
  const wr = await PdfEdu.extractBuffer(new Uint8Array(wbuf));
  ok('不是扫描件', wr.scanned === false, 'items=' + wr.items);
  ok('认成「教务系统模板」而不是通用表格', wr.mode === 'wzu', wr.mode);
  ok('三页都读了', wr.pages === wPages.length, 'pages=' + wr.pages);
  ok('认出 7 个星期列', wr.cols === 7, 'cols=' + wr.cols);
  ok('8 门课一门不少（跨页那几门没被截断）',
    wr.lines.length === wzu.WZU_COURSES.length,
    'lines=' + wr.lines.length + ' 期望=' + wzu.WZU_COURSES.length);
  ok('长串被切干净了：课名后面没有残留的 /校区:/学分: 字段',
    wr.lines.every(l => l.indexOf('/校区') < 0 && l.indexOf('/学分') < 0 &&
      l.indexOf('/教学班') < 0),
    JSON.stringify(wr.lines));
  ok('表头和结构文字没混进课程（时间段 / 节次 / 上午…）',
    wr.lines.every(l => !/(?:时间段|节次|上午|下午|晚上)/.test(l)));
  ok('单 / 双周给出提示（课表模型装不下这两周制）',
    wr.warnings.join('').indexOf('单周') >= 0, wr.warnings.join(' | '));

  section('模板长串 → ImportEdu 解析');
  const wp = ImportEdu.parsePayloadText(wr.text);
  ok('解析出 8 条课程', wp.courses.length === wzu.WZU_COURSES.length,
    'n=' + wp.courses.length + ' 警告=' + wp.warnings.join('|'));

  /* 逐门课对着固件核：星期 / 教室 / 老师 / 周次 —— 一项都不许飘 */
  const mism = [];
  wzu.WZU_COURSES.forEach(function (c) {
    const got = wp.courses.filter(function (x) { return x.name === c.name; })[0];
    const wk = c.weeks.split('-');
    const teachers = c.teacher.split(',').join('、');
    if (!got) { mism.push(c.name + ': 没认出来'); return; }
    if (got.day !== c.day) mism.push(c.name + ': 星期 ' + got.day + '≠' + c.day);
    if (got.room !== c.room) mism.push(c.name + ': 教室 ' + got.room + '≠' + c.room);
    if (got.teacher !== teachers) mism.push(c.name + ': 老师 ' + got.teacher + '≠' + teachers);
    if (got.from !== +wk[0] || got.to !== +wk[1]) {
      mism.push(c.name + ': 周次 ' + got.from + '-' + got.to + '≠' + c.weeks);
    }
    const sec = c.sec.split('-');
    if (got.start !== +sec[0]) mism.push(c.name + ': 起始节 ' + got.start + '≠' + sec[0]);
    if (sec[1] && got.span !== (+sec[1] - +sec[0] + 1)) {
      mism.push(c.name + ': 跨度 ' + got.span + '≠' + (+sec[1] - +sec[0] + 1));
    }
  });
  ok('8 门课的星期 / 教室 / 老师 / 周次 / 节次全部对得上', mism.length === 0,
    mism.join(' ; '));

  const two = wp.courses.filter(function (c) { return c.name === '人工智能与艺术人文'; })[0];
  ok('两位老师没被截成一位（胡文超,叶茜 → 胡文超、叶茜）',
    !!two && two.teacher === '胡文超、叶茜', two ? two.teacher : '缺');
  ok('「6-9节」这种长跨度没被砍成 6-7 节（回归）',
    !!two && two.start === 6 && two.span === 4, two ? two.start + '+' + two.span : '缺');
  const sports = wp.courses.filter(function (c) { return c.name === '体育(篮球)'; })[0];
  ok('「南水泥篮球场」这种没横线的场地也认出来了',
    !!sports && sports.room === '南水泥篮球场', sports ? sports.room : '缺');

  console.log('\n  （② 层新增 ' + (pass - before.pass - (pass - beforeWzu.pass)) +
    ' 项，③ 层新增 ' + (pass - beforeWzu.pass) + ' 项断言）');
})().then(function () {
  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exit(fail ? 1 : 0);
}, function (e) {
  console.log('\n!! 测试自身出错: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});


