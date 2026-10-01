/* ==========================================================
   校园百事通 · 课表 PDF 识别
   ----------------------------------------------------------
   为什么要它：让学生不必去教务系统控制台跑脚本、也不必手抄课表，
   把教务系统「我的课表」导出的 PDF 直接传进来就能变成课程。

   难点在哪：PDF 抽出来的文字不是「行」，而是一堆带坐标的碎片，
   而且碎片顺序跟排版无关。直接拼会得到
       数据结构 计算机楼-408 陈立 1-16周 周一 第1-2节
   这种串行结果，课名、老师、教室全错位。

   所以这里做的是「把碎片按坐标还原回表格」：
     ① 按 x 聚类            → 表格有几列
     ② 找节次列当行锚点      → 有几行（找不到就用行距断崖切）
     ③ 逐格把碎片拼回文本
     ④ 给每格补上「周X 第N-M节」上下文
   还原出来的文本再交给 ImportEdu 已有的解析引擎 —— 不另写一套。

   下面这堆纯函数（toItems / columnsOf / linesOf / gridRebuild /
   flatRebuild / rebuild）完全不碰 pdf.js，可以单独跑单测。
   ========================================================== */
var PdfEdu = (function () {
  'use strict';

  /* pdf.js 放在项目里（不是 CDN），保证断网也能用 */
  var VENDOR = 'assets/vendor/pdfjs/';
  /* 中文 PDF 常把字体写成「预定义 CMap」——教务系统的 iText 导出就是
     STSong-Light + /Encoding /UniGB-UCS2-H。pdf.js 必须拿到对应的
     .bcmap 才能把字节翻成汉字；拿不到它不报错，只会静默返回 0 个碎片
     （实测：同一份 PDF 不给 CMap 是 0 个碎片，给了是 188 个）。
     所以两条腿走路：
       cmaps/          全量 169 个（http 下走这条，什么编码都有）
       cmaps-inline.js 常用中文那几个直接内联在内存里（file:// 双击也能用） */
  var CMAPS = VENDOR + 'cmaps/';
  var CMAPS_INLINE = VENDOR + 'cmaps-inline.js';

  var DAYNAME = ['', '一', '二', '三', '四', '五', '六', '日'];
  var DAYNUM = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
  };

  var RE_DAY = /(?:星期|周|礼拜)\s*([一二三四五六日天1-7])/;
  var RE_SEC = /(?:第\s*)?(\d{1,2})\s*[-\u2013~\u2014\u81f3]\s*(\d{1,2})\s*节/;
  var RE_SEC1 = /(?:第\s*)?(\d{1,2})\s*节/;
  var RE_TIME = /\d{1,2}\s*[:\uff1a]\s*\d{2}/;
  var RE_CJK = /[\u4e00-\u9fa5]/;

  var _lib = null, _loading = null, _err = '';
  /* pdf.js 要过、但我们没能提供的 CMap 名。留着给用户一句人话解释，
     比丢一个「0 条课程」友好得多。 */
  var _cmapMiss = [];

  /* ==========================================================
     0. 按需加载 pdf.js
     ----------------------------------------------------------
     pdf.min.js 有 312KB、worker 1MB，塞进每个页面都会拖慢首屏。
     所以做成「第一次真的上传 PDF 时才去拉」，其他页面零影响。
     ========================================================== */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (typeof document === 'undefined') {
        reject(new Error('这个环境不支持动态加载脚本'));
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(src); };
      s.onerror = function () { reject(new Error('加载 ' + src + ' 失败（文件缺失，或被浏览器拦了本地脚本）')); };
      document.head.appendChild(s);
    });
  }

  function loadLib() {
    if (_lib) return Promise.resolve(_lib);
    if (_loading) return _loading;

    _loading = loadScript(VENDOR + 'pdf.min.js').then(function () {
      var L = (typeof window !== 'undefined') ? window.pdfjsLib : null;
      if (!L) throw new Error('pdf.js 加载完了，但没找到全局对象 pdfjsLib');
      try { L.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.js'; } catch (e) { /* 老版本没这字段 */ }
      /* 内联 CMap 是可选的：拉不到就退回全量目录（http 下够用），
         不该因为一个可选文件把整个 PDF 功能拖死。 */
      return loadScript(CMAPS_INLINE).then(function () { return L; }, function () { return L; });
    }).then(function (L) {
      _lib = L;
      return L;
    }, function (e) {
      _err = (e && e.message) || ('加载 ' + VENDOR + 'pdf.min.js 失败');
      throw new Error(_err);
    });
    return _loading;
  }

  function libLoaded() { return !!_lib; }
  function lastError() { return _err; }

  /* 让测试能塞一份 pdfjsLib 进来（Node 里没有 document，
     加载不了浏览器版；单测用 npm 的 pdfjs-dist 注入）。 */
  function useLib(lib) { _lib = lib || null; return _lib; }

  /* ==========================================================
     0.5 CMap 工厂：pdf.js 来要字库映射时，我们从哪给
     ----------------------------------------------------------
     pdf.js 的 CMapReaderFactory 约定：构造时收 {baseUrl, isCompressed}，
     有个 fetch({name}) 返回 {cMapData, compressionType}。
     先查内存里的内联表（file:// 也能用），没有再按 URL 去取。
     两条都失败就记进 _cmapMiss，上层能据此给出「缺哪个字库」的提示。
     ========================================================== */
  /* pdf.js 除了字体的 /Encoding（UniGB-UCS2-H 这种），还会照
     /CIDSystemInfo 里的 /Ordering 去要一张「CID→Unicode」表。
     正常情况它要的是 Adobe-GB1-UCS2；但有的学校把 /Ordering 写成
     Identity，它就照着算出一个现实中不存在的 Adobe-Identity-UCS2，
     字体整个加载失败 —— 又是一次「静默 0 个碎片」。
     这种情况下真正对的那张表由「编码 CMap」决定（UniGB 系 → GB1），
     所以记住最近给过的编码 CMap，碰到 Identity 请求就按它换掉。 */
  var UCS2_BY_ENC = [
    [/^(?:UniGB|GBK|GB-?EUC|GBpc|GB-?EUC-H|GBpc-EUC)/i, 'Adobe-GB1-UCS2'],
    [/^(?:UniCNS|B5|ETen|Big5|CNS-?EUC)/i, 'Adobe-CNS1-UCS2'],
    [/^(?:UniJIS|90ms|90pv|EUC-JP|Shift_JIS|Hankaku)/i, 'Adobe-Japan1-UCS2'],
    [/^(?:UniKS|KSC|EUC-KR|KSCms)/i, 'Adobe-Korea1-UCS2']
  ];
  var _lastEncCMap = '';

  /* 由编码 CMap 名推断对应的 CID→Unicode 表名；认不出返回空串 */
  function ucs2For(enc) {
    if (!enc) return '';
    for (var i = 0; i < UCS2_BY_ENC.length; i++) {
      if (UCS2_BY_ENC[i][0].test(enc)) return UCS2_BY_ENC[i][1];
    }
    return '';
  }

  function CMapFactory(opt) {
    this.baseUrl = (opt && opt.baseUrl) || CMAPS;
    this.isCompressed = !(opt && opt.isCompressed === false);
  }
  CMapFactory.prototype.fetch = function (q) {
    var want = (q && q.name) || '';
    if (!want) return Promise.reject(new Error('CMap 名字为空'));
    var name = want;

    var type = 1;                       /* CMapCompressionType.BINARY */
    try { if (_lib && _lib.CMapCompressionType) type = _lib.CMapCompressionType.BINARY; } catch (e) { }

    if (/^Adobe-Identity-UCS2$/i.test(name)) {
      var guess = ucs2For(_lastEncCMap);
      if (guess) name = guess;
    }

    var inline = (typeof PdfCmaps !== 'undefined' && PdfCmaps && PdfCmaps.decode)
      ? PdfCmaps.decode(name) : null;
    if (inline) {
      if (!/UCS2$/i.test(name)) _lastEncCMap = name;
      return Promise.resolve({ cMapData: inline, compressionType: type });
    }

    var url = this.baseUrl + name + (this.isCompressed ? '.bcmap' : '');
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      if (!/UCS2$/i.test(name)) _lastEncCMap = name;
      return { cMapData: new Uint8Array(buf), compressionType: type };
    }, function () {
      /* 报缺的时候要说原本要的那个名字，用户才看得懂 */
      if (_cmapMiss.indexOf(want) < 0) _cmapMiss.push(want);
      throw new Error('拿不到字库映射 ' + want);
    });
  };

  function cmapMissed() { return _cmapMiss.slice(); }

  /* ==========================================================
     1. 碎片化：pdf.js 的 textContent → 带坐标的文字碎片
     ========================================================== */

  /* PDF 里没嵌字体时 pdf.js 给的 width 会偏，用「全角按 1 字宽、
     半角按 0.53 字宽」估一个，两者差太多就用估算值兜底 */
  function estWidth(str, size) {
    var w = 0;
    for (var i = 0; i < str.length; i++) w += str.charCodeAt(i) > 255 ? 1 : 0.53;
    return w * size;
  }

  /* 标准 PDF 矩阵乘法，和 pdf.js 内部 Util.transform 一致 */
  function mulMatrix(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  /* tc：pdf.js 的 textContent；vp：page.getViewport({scale:1})，可省。
     ----------------------------------------------------------
     vp 为什么要传：教务系统导出的课表 PDF 常常是「竖版页面 + /Rotate 90」，
     这时候 textContent 里的 transform 是页内未旋转坐标，和肉眼看到的
     左右 / 上下整个是错开的。传了 vp 就统一换算到视觉坐标系。
     最后再把 y 翻成「向上为正」—— 和不带 Rotate 的 PDF 完全一致，
     所以下面所有聚类逻辑（y 大 = 靠上）不用分情况。 */
  function toItems(tc, vp) {
    var out = [], list = (tc && tc.items) || [];
    var VT = vp && vp.transform, H = (vp && vp.height) || 0;

    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || typeof it.str !== 'string') continue;
      var s = String(it.str).replace(/[\u00a0\u3000]/g, ' ');
      if (!s.trim()) continue;

      var t = it.transform || [1, 0, 0, 1, 0, 0];
      var size = Math.abs(it.height) || Math.abs(t[3]) || 10;
      if (!(size > 0.5)) size = 10;

      var ew = estWidth(s, size);
      var w = Math.abs(it.width) || 0;
      if (!(w > ew * 0.5) || w > ew * 1.8) w = ew;   /* 明显不合理就用估算值 */

      var x = +t[4], y = +t[5];
      if (VT) {
        var m = mulMatrix(VT, t);
        x = m[4];
        y = H - m[5];
      }

      out.push({ str: s.trim(), x: x, y: y, w: w, h: size });
    }
    return out;
  }

  function medianSize(items) {
    if (!items || !items.length) return 10;
    var a = items.map(function (i) { return i.h; }).sort(function (x, y) { return x - y; });
    return a[Math.floor(a.length / 2)] || 10;
  }

  /* ==========================================================
     2. 一维聚类：沿某个轴把碎片归拢成「列」或「行」
     ----------------------------------------------------------
     lenKey 传 'w' / 'h' 表示「拿区间去比」（适合分列：文字横向占一片）
     lenKey 传 null 表示「拿点去比」（适合分行：基线对基线）
     为什么分行必须用点：行距（约 12pt）和字高（约 11pt）只差 1pt，
     用区间比的话上一行的底会和下一行的顶贴上，所有行糊成一片。
     注意 PDF 的 y 轴向上为正，所以 y 大的在上面。
     ========================================================== */
  function cluster(items, key, lenKey, tol) {
    var sorted = items.slice().sort(function (a, b) { return (a[key] - b[key]) || (a.x - b.x); });
    var groups = [], cur = null;

    for (var i = 0; i < sorted.length; i++) {
      var it = sorted[i];
      var len = lenKey ? Math.abs(it[lenKey] || 0) : 0;
      var lo = it[key], hi = it[key] + len;
      if (cur && lo <= cur.max + tol) {
        cur.items.push(it);
        if (hi > cur.max) cur.max = hi;
        if (lo < cur.min) cur.min = lo;
      } else {
        cur = { min: lo, max: hi, items: [it] };
        groups.push(cur);
      }
    }
    return groups;
  }

  /* ==========================================================
     3. 列 / 行还原
     ========================================================== */

  /* 表格有几列：按 x 聚类。
     这里是「整页所有碎片一起聚类」，不是逐行聚 —— 因为一整列里
     有很多行的文字，它们共同覆盖了该列的 x 范围，比只看一行稳得多。 */
  function columnsOf(items, tol) {
    var size = medianSize(items);
    var probe = items.map(function (i) {
      return { str: i.str, x: i.x, y: i.y, h: i.h, w: i.w * 0.9 };
    });
    var cols = cluster(probe, 'x', 'w', tol || Math.max(2, size * 0.5));
    cols.forEach(function (c, i) { c.idx = i; });
    return cols;
  }

  /* 同一「行」里的碎片按 x 排序拼起来；碎片之间有肉眼可见的空隙才插空格 */
  function joinItems(its) {
    var s = '';
    for (var i = 0; i < its.length; i++) {
      if (i > 0) {
        var gap = its[i].x - (its[i - 1].x + its[i - 1].w);
        if (gap > Math.max(1.2, its[i].h * 0.3)) s += ' ';
      }
      s += its[i].str;
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  /* 页面上有几「行」文字（返回从上到下）。按基线聚，不按区间聚。 */
  function linesOf(items, tol) {
    var size = medianSize(items);
    var groups = cluster(items, 'y', null,
      tol === undefined ? Math.max(1.5, size * 0.4) : tol);

    var lines = groups.map(function (g) {
      var its = g.items.slice().sort(function (a, b) { return a.x - b.x; });
      return {
        top: g.max, bottom: g.min,            /* 按基线聚，top == bottom */
        items: its,
        text: joinItems(its),
        minX: Math.min.apply(null, its.map(function (i) { return i.x; })),
        maxX: Math.max.apply(null, its.map(function (i) { return i.x + i.w; }))
      };
    });
    lines.sort(function (a, b) { return b.top - a.top; });
    return lines;
  }

  /* 一个单元格里的多行文字 → 一行文本（"数据结构 陈立 计算机楼-408 1-16周"） */
  function joinCell(items, size) {
    return linesOf(items, Math.max(1.2, size * 0.4))
      .map(function (l) { return l.text; })
      .join(' ').replace(/\s+/g, ' ').trim();
  }

  /* "第1-2节" → "1-2"；"第3节" → "3" */
  function secOf(text) {
    var s = String(text || '');
    var m = s.match(RE_SEC);
    if (m) return m[1] + '-' + m[2];
    m = s.match(RE_SEC1);
    if (m) return m[1];
    return '';
  }

  /* ---------- 时间 → 节次 ----------
     有些课表的节次列只写时间（"08:20-09:45"），没写"第几节"。
     项目里已经有上课铃表（UI.BELLS，按第 1~13 节的开始时间），
     把 PDF 里的时间端点对到最近的铃上，就能反推出节次。
     这里的 DEFAULT_BELLS 是 UI.BELLS 的离线副本：测试沙箱里没有 UI，得自己带一份。 */
  var DEFAULT_BELLS = ['08:20', '09:05', '10:10', '10:55', '11:40', '13:30',
    '14:15', '15:20', '16:05', '16:50', '18:30', '19:15', '20:00'];

  function bells() {
    if (typeof UI !== 'undefined' && UI && UI.BELLS && UI.BELLS.length) return UI.BELLS;
    return DEFAULT_BELLS;
  }

  function toMin(hm) {
    var m = String(hm).match(/(\d{1,2})\s*[:\uff1a]\s*(\d{2})/);
    return m ? (+m[1]) * 60 + (+m[2]) : -1;
  }

  /* 时间 → 节次。
     UI.BELLS 是每一节的「开始时间」，所以别去「找最近的铃」（
     那样 09:40 下课会被算成第 3 节，因为离 10:10 更近）。
     正确做法是数一数「有几个铃已经敲过了」：
       08:20 → 已敲 1 个 → 第 1 节
       09:40 → 已敲 2 个（08:20 / 09:05）→ 第 2 节
     下课时间再减 5 分钟，避免刚好卡在下一节开课的铃上。 */
  function secOfTime(text) {
    var found = String(text || '').match(/\d{1,2}\s*[:\uff1a]\s*\d{2}/g);
    if (!found || !found.length) return '';

    var B = bells().map(toMin).filter(function (v) { return v >= 0; });
    if (!B.length) return '';
    B.sort(function (a, b) { return a - b; });

    function at(v) {
      var n = 0;
      for (var i = 0; i < B.length; i++) if (B[i] <= v) n = i + 1;
      return Math.max(1, Math.min(B.length, n));
    }

    var from = at(toMin(found[0]));
    var to = at(toMin(found[found.length - 1]) - 5);
    if (to < from) to = from;
    return from === to ? String(from) : (from + '-' + to);
  }

  /* 实在认不出节次时，按顺序推断：
     行数 >= 8 → 一行一节课；否则按温大常见的「两节连堂一行」推 */
  function ordinalSec(i, n) {
    if (n >= 8) return String(i + 1);
    return (i * 2 + 1) + '-' + (i * 2 + 2);
  }

  /* 这一列像不像「节次 / 时间」列 */
  function looksLikeSectionCol(col) {
    var lines = linesOf(col.items);
    if (!lines.length) return 0;
    var hit = 0;
    lines.forEach(function (l) {
      var t = l.text;
      if (RE_SEC.test(t) || RE_TIME.test(t) || /^(?:第\s*)?\d{1,2}\s*(?:节)?$/.test(t)) hit++;
    });
    return hit / lines.length;
  }

  /* 这一列的抬头写着星期几？没有就返回 0 */
  function dayOfCol(col) {
    var lines = linesOf(col.items);
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].text.match(RE_DAY);
      if (m) return DAYNUM[m[1]] || 0;
    }
    return 0;
  }

  /* 相邻文字行的间距中位数 —— 用来判断「换行了」还是「换单元格了」 */
  function medianGap(lines) {
    var gaps = [];
    for (var i = 1; i < lines.length; i++) {
      gaps.push(Math.max(0.01, lines[i - 1].bottom - lines[i].top));
    }
    if (!gaps.length) return 0;
    gaps.sort(function (a, b) { return a - b; });
    return gaps[Math.floor(gaps.length / 2)];
  }

  /* 兜底的行带切分：靠行距断崖把文字行聚成「一条课程」 */
  function vBands(items, size) {
    var lines = linesOf(items, Math.max(1.5, size * 0.35));
    if (lines.length < 2) return [];
    var split = medianGap(lines) * 1.75;

    var bands = [], cur = null;
    lines.forEach(function (l, i) {
      var fresh = !cur || (i > 0 && Math.max(0.01, lines[i - 1].bottom - l.top) > split);
      if (fresh) {
        cur = { top: l.top, bottom: l.bottom, lines: [l] };
        bands.push(cur);
      } else {
        cur.lines.push(l);
        cur.bottom = Math.min(cur.bottom, l.bottom);
      }
    });
    return bands.map(function (b) {
      return { top: b.top, bottom: b.bottom, text: b.lines.map(function (l) { return l.text; }).join(' ') };
    });
  }

  /* ==========================================================
     3.5 教务系统导出的「竖排长串」课表（温大新教务 / iText）
     ----------------------------------------------------------
     这种 PDF 和标准课表长得完全不一样，先说清楚它长什么样：
       · 页面是竖版 MediaBox + /Rotate 90，所以内容是横着的；
       · 字体 STSong-Light + /Encoding /UniGB-UCS2-H（预定义 CMap）；
       · 换算到视觉坐标系后其实是一张普通表格：横轴 = 星期列；
       · 但每个格子里不是「课名 / 老师 / 教室」几行短文本，而是一整条长串：
           最优化方法★(1-2节)1-16周/校区:南校区/场地:南5-A201/教师:桂文永
           /教学班:(2026-2027-1)-142006601L-20180171-1/教学班组成:25人工
           智能1;25人工智能2/课程性质简称:必选/选课备注:/课程学时组成:讲课:32
           /周学时:2/总学时:32/学分:2.0
         而且这条串会「顺着列往下流」，一页写满接着写第二页。

     所以对付它不用还原表格：节次 / 周次 / 场地 / 教师 全在文本里，
     唯一必须靠位置判断的只有「星期」。做法四步：
       ① 找「星期一…星期日」表头 → 每条星期列的水平锚点
       ② 碎片按最近锚点分列，顺手丢掉表头、节次号、上下午这类结构文字
       ③ 每列按「页码 → 从上到下」拼成长串（跨页续写自然接上）
       ④ 用模板把长串切成逐门课，还原成通用课表文本
     最后仍然交给 ImportEdu 已有的解析引擎，不另写一套解析。
     ========================================================== */

  var RE_WZU_LABEL = /(?:场地|教师|学分|教学班|校区)\s*[:：]/;
  var RE_WZU_DAYHEAD = /^(?:星期|周|礼拜)([一二三四五六日天])$/;
  var RE_WZU_STRUCT = /^(?:时间段|节次|上午|下午|晚上|中午|早晨|备注)$/;
  /* 一门课的形状：「<课名>(<起>[-<止>]节)<正文>/学分:<数>」 */
  var RE_WZU_COURSE = /([^\/]*?)\((\d{1,2})(?:[-\u2013\u2014~\u81f3](\d{1,2}))?节\)([\s\S]*?)\/学分\s*[:：]\s*([\d.]*)/g;
  var RE_WZU_WEEK = /^\s*(\d{1,2})\s*[-\u2013\u2014~\u81f3]\s*(\d{1,2})\s*周(?:\s*[（(]\s*([单双])\s*[)）])?/;
  var RE_WZU_FIELD = {
    room: /(?:^|\/)场地\s*[:：]\s*([^\s\/\\|]+)/,
    teacher: /(?:^|\/)教师\s*[:：]\s*([^\/\\|]+)/
  };

  /* 老师可能不止一位，教务系统写成「胡文超,叶茜」。
     统一成顿号「胡文超、叶茜」：ImportEdu 那边是按顿号认多位老师的。 */
  function teacherOf(mid) {
    var m = mid.match(RE_WZU_FIELD.teacher);
    if (!m) return '';
    return m[1].split(/[,，;；、]+/).map(squash).filter(Boolean).join('、');
  }

  function squash(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  /* 这一页像不像教务系统导出的课表 */
  function wzuScore(items) {
    var hit = 0;
    for (var i = 0; i < items.length; i++) if (RE_WZU_LABEL.test(items[i].str)) hit++;
    return hit;
  }
  function looksLikeWzu(items) { return wzuScore(items) >= 3; }

  function medianOf(nums) {
    if (!nums || !nums.length) return 0;
    var a = nums.slice().sort(function (x, y) { return x - y; });
    return a[Math.floor(a.length / 2)];
  }

  /* 每条星期列的水平锚点 = 表头文字所在的 x。
     同一天在多页都出现表头时，只留最靠上的那一条（y 大 = 靠上）。 */
  function dayAnchors(items) {
    var byDay = {};
    items.forEach(function (it) {
      var m = it.str.replace(/\s/g, '').match(RE_WZU_DAYHEAD);
      if (!m) return;
      var d = DAYNUM[m[1]] || 0;
      if (!d) return;
      var page = it.page || 1;
      var k = d + '@' + page;
      if (!byDay[k] || it.y > byDay[k].y) byDay[k] = { day: d, x: it.x, y: it.y, page: page };
    });
    var out = [];
    for (var k in byDay) if (byDay.hasOwnProperty(k)) out.push(byDay[k]);
    out.sort(function (a, b) { return a.day - b.day || a.page - b.page; });
    return out;
  }

  /* 课名清洗：去掉折行留下的空白和 ★（★ 是「学位课」标记，显示时碍眼） */
  function cleanCourseName(s) {
    return squash(s).replace(/[\u2605\u2606\u25c6\u25c7]+\s*$/, '').trim();
  }

  /* 一列的长串 → 逐门课的通用课表文本 */
  function coursesFromWzuColumn(text, day) {
    var lines = [], parity = 0;
    RE_WZU_COURSE.lastIndex = 0;
    var m;
    while ((m = RE_WZU_COURSE.exec(text))) {
      var name = cleanCourseName(m[1]);
      if (!name || name.length < 2) continue;

      var sec = m[2] + (m[3] ? '-' + m[3] : '');
      var mid = m[4] || '';

      var wk = mid.match(RE_WZU_WEEK);
      var from = wk && wk[1] ? +wk[1] : 1;
      var to = wk && wk[2] ? +wk[2] : 16;
      if (wk && wk[3]) parity++;                    /* 单/双周：当前课表模型装不下，只统计出来提醒 */

      var rm = mid.match(RE_WZU_FIELD.room);
      var teacher = teacherOf(mid);

      var seg = ['周' + DAYNAME[day], '第' + sec + '节', name];
      if (teacher) seg.push('教师:' + teacher);
      if (rm) seg.push('场地:' + squash(rm[1]));
      seg.push(from + '-' + to + '周');
      lines.push(seg.join(' '));
    }
    return { lines: lines, parity: parity };
  }

  function wzuRebuild(items) {
    var raw = dayAnchors(items);
    if (raw.length < 3) return null;

    /* 分列只需要「每天一个」水平位置；同一天多页都印了表头的，取最靠前的那个 */
    var seen = {}, anchors = [];
    raw.forEach(function (a) {
      if (seen[a.day]) return;
      seen[a.day] = 1;
      anchors.push(a);
    });
    anchors.sort(function (a, b) { return a.day - b.day; });
    if (anchors.length < 3) return null;

    /* 列间距：判断「这个碎片离最近的星期列有多远算太远」 */
    var xs = anchors.map(function (a) { return a.x; }).sort(function (a, b) { return a - b; });
    var gaps = [];
    for (var i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1]);
    var pitch = medianOf(gaps);
    if (!(pitch > 20)) return null;

    /* 每一页各自的表头 y。
       页眉过滤必须按页来：续页（没印表头的那页）内容是从页顶接着往下写的，
       拿第 1 页的表头高度去卡，会把整段续写内容当页眉丢掉 ——
       实测就因此丢了一门跨两页的课（数据库原理与应用）。
       反过来，没表头的页就不设上界，反正那页的结构文字已经被下面的规则滤掉了。 */
    var headerY = {};
    raw.forEach(function (a) {
      if (headerY[a.page] === undefined || a.y > headerY[a.page]) headerY[a.page] = a.y;
    });

    /* --- ② 碎片分列 --- */
    var buckets = anchors.map(function () { return []; });
    var dropped = 0;
    items.forEach(function (it) {
      var t = it.str.replace(/\s/g, '');
      if (!t) return;
      if (RE_WZU_DAYHEAD.test(t) || RE_WZU_STRUCT.test(t)) { dropped++; return; }   /* 表头 / 上下午行标 */
      if (/^\d{1,2}$/.test(t)) { dropped++; return; }                              /* 节次列的号码 */

      var hy = headerY[it.page || 1];
      if (hy !== undefined && it.y > hy + 4) { dropped++; return; }                /* 页眉 */

      var bi = -1, bd = Infinity;
      for (var k = 0; k < anchors.length; k++) {
        var d = Math.abs(it.x - anchors[k].x);
        if (d < bd) { bd = d; bi = k; }
      }
      if (bi < 0 || bd > pitch * 0.62) { dropped++; return; }                      /* 离所有星期列都太远 */
      buckets[bi].push(it);
    });

    /* --- ③④ 每列拼长串再切课 --- */
    var out = [], parity = 0;
    buckets.forEach(function (arr, k) {
      if (!arr.length) return;
      /* 先按页码，再按 y 从大到小 —— 阅读顺序就是「上一页写完写下一页」 */
      arr.sort(function (a, b) {
        return (a.page || 1) - (b.page || 1) || b.y - a.y || a.x - b.x;
      });
      var text = arr.map(function (it) { return it.str; }).join('');
      var got = coursesFromWzuColumn(text, anchors[k].day);
      parity += got.parity;
      out = out.concat(got.lines);
    });

    if (out.length < 2) return null;
    return { lines: out, days: anchors.length, pitch: pitch, dropped: dropped, parity: parity };
  }

  /* ==========================================================
     4. 网格课表重建（标准课表：一行一个时段，一列一天）
     ========================================================== */
  function gridRebuild(items) {
    var size = medianSize(items);
    var cols = columnsOf(items);
    if (cols.length < 3) return null;                 /* 这么少列，肯定不是网格表 */

    /* --- 认出每一列是谁 --- */
    var dayCols = [], secCol = null, secScore = 0;
    cols.forEach(function (c) {
      var d = dayOfCol(c);
      if (d) { dayCols.push({ day: d, col: c }); return; }
      var s = looksLikeSectionCol(c);
      if (s > secScore) { secScore = s; secCol = c; }
    });
    if (dayCols.length < 2) return null;              /* 认不出星期列，交给 flatRebuild */
    dayCols.sort(function (a, b) { return a.col.min - b.col.min; });

    /* --- 行锚点：优先用节次列，它能直接告诉我们「第几节」 ---
       注意要把节次列自己的表头（"节次" / "上课时间"）滤掉，
       否则它会变成第一个锚点，把真正的表头行放进课程里。 */
    var anchors = [];
    if (secCol && secScore >= 0.5) {
      anchors = linesOf(secCol.items, Math.max(2, size * 1.2))
        .filter(function (l) { return !!secOf(l.text) || !!secOfTime(l.text); })
        .map(function (l) { return { top: l.top, bottom: l.bottom, text: l.text }; });
    }
    if (anchors.length < 2) {                         /* 没有可用节次 → 靠行距断崖 */
      anchors = vBands(items, size);
      /* 表头（星期几那一行）自己也会被切成一条带，丢掉 */
      if (anchors.length && RE_DAY.test(anchors[0].text)) anchors = anchors.slice(1);
    }
    if (anchors.length < 2) return null;

    /* --- 表头（星期那一行）比第一个锚点还高，要丢掉 --- */
    var centers = anchors.map(function (a) { return (a.top + a.bottom) / 2; });
    var step = anchors.length > 1 ? Math.abs(centers[0] - centers[1]) : size * 4;
    var skipAbove = centers[0] + step * 0.5;

    /* --- 每个碎片归到「最近的行锚点 × 最近的列」--- */
    var buckets = anchors.map(function () { return {}; });
    linesOf(items, Math.max(1.5, size * 0.35)).forEach(function (l) {
      l.items.forEach(function (it) {
        var cy = it.y + it.h / 2;
        if (cy > skipAbove) return;                   /* 表头 / 页眉 */

        var cx = it.x + it.w / 2, ci = -1, cd = Infinity;
        for (var i = 0; i < cols.length; i++) {
          var c = cols[i];
          if (cx < c.min - size || cx > c.max + size) continue;
          var d = Math.abs(cx - (c.min + c.max) / 2);
          if (d < cd) { cd = d; ci = i; }
        }
        if (ci < 0) return;

        var ai = 0, bd = Infinity;
        for (var k = 0; k < centers.length; k++) {
          var dy = Math.abs(cy - centers[k]);
          if (dy < bd) { bd = dy; ai = k; }
        }
        (buckets[ai][ci] = buckets[ai][ci] || []).push(it);
      });
    });

    /* --- 逐格拼文本 --- */
    var out = [], inferred = 0;
    anchors.forEach(function (a, ai) {
      var sec = secOf(a.text) || secOfTime(a.text);
      var guess = !sec;
      if (guess) sec = ordinalSec(ai, anchors.length);   /* 推断的，要提示用户核对 */

      dayCols.forEach(function (dc) {
        var cell = buckets[ai][dc.col.idx];
        if (!cell || !cell.length) return;
        var body = joinCell(cell, size);
        if (!body || !RE_CJK.test(body)) return;
        /* 纯「星期一」这种表头文字不要 */
        if (/^(?:星期|周|礼拜)[一二三四五六日天1-7]$/.test(body.replace(/\s/g, ''))) return;
        if (guess) inferred++;
        out.push('周' + DAYNAME[dc.day] + ' 第' + sec + '节 ' + body);
      });
    });

    return {
      lines: out, cols: cols.length, rows: anchors.length,
      days: dayCols.length, inferred: inferred
    };
  }

  /* ==========================================================
     5. 逐行重建（课程做成卡片 / 一条一行的那种课表）
     ========================================================== */
  function flatRebuild(items) {
    var size = medianSize(items);
    var lines = linesOf(items, Math.max(1.5, size * 0.35));
    if (!lines.length) return null;

    var split = medianGap(lines) * 1.75;
    var blocks = [], cur = null;

    lines.forEach(function (l, i) {
      var merge = !!cur;
      if (merge) {
        var gap = Math.max(0.01, lines[i - 1].bottom - l.top);
        var overlap = Math.min(cur.maxX, l.maxX) - Math.max(cur.minX, l.minX);
        if (gap > split || overlap <= 0) merge = false;   /* 行距太大 或 横向错开 → 另一门课 */
      }
      if (!merge) {
        cur = { lines: [l], minX: l.minX, maxX: l.maxX };
        blocks.push(cur);
      } else {
        cur.lines.push(l);
        cur.minX = Math.min(cur.minX, l.minX);
        cur.maxX = Math.max(cur.maxX, l.maxX);
      }
    });

    return blocks.map(function (b) {
      return b.lines.map(function (l) { return l.text; }).join(' ');
    }).map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  }

  /* ==========================================================
     6. 入口：碎片 → 文本行
     ========================================================== */
  function rebuild(items) {
    var warnings = [];

    /* 教务系统导出的模板课表先走这条：它和标准网格表完全不是一个形状，
       而且内容会跨页续写，所以要整份一起还原（见 wzuRebuild 注释）。 */
    if (looksLikeWzu(items)) {
      var w = wzuRebuild(items);
      if (w) {
        if (w.parity) {
          warnings.push('有 ' + w.parity + ' 门课是单周 / 双周上课，当前课表按每周显示，请自己留意');
        }
        return {
          mode: 'wzu', lines: w.lines, text: w.lines.join('\n'),
          cols: w.days, rows: 0, days: w.days, inferred: 0, parity: w.parity,
          warnings: warnings
        };
      }
      warnings.push('这份 PDF 像是教务系统导出的课表，但没认出课程内容，已改用通用识别');
    }

    var g = gridRebuild(items);
    if (g && g.lines.length >= 2) {
      if (g.inferred) {
        warnings.push('有 ' + g.inferred + " 条课程的节次是按顺序推断的（PDF 里没写第几节），导入后请核对");
      }
      return {
        mode: 'grid', lines: g.lines, text: g.lines.join('\n'),
        cols: g.cols, rows: g.rows, days: g.days,
        inferred: g.inferred, parity: 0, warnings: warnings
      };
    }
    if (!g) warnings.push('没找到课表网格（可能是卡片式课表），已改用逐行识别');

    var f = flatRebuild(items) || [];
    return {
      mode: 'flat', lines: f, text: f.join('\n'), cols: g ? g.cols : 0,
      rows: 0, days: 0, inferred: 0, parity: 0, warnings: warnings
    };
  }

  /* ==========================================================
     7. 真·读 PDF：按需加载 pdf.js → 逐页取文字 → 重建
     ========================================================== */
  function normalizeErr(e) {
    var m = (e && e.message) || String(e || '未知错误');
    if (/password/i.test(m)) return new Error('这个 PDF 有密码保护，先去密码再传');
    if (/Invalid PDF|not a PDF|structure/i.test(m)) return new Error('这不像是有效的 PDF 文件');
    return new Error(m);
  }

  function readPage(doc, n) {
    return doc.getPage(n).then(function (page) {
      /* viewport 用来把页内坐标换算到视觉坐标：教务系统的课表 PDF 是
         「竖版页面 + /Rotate 90」，不换算的话 x/y 是错开的，分列分行全乱。 */
      var vp = page.getViewport({ scale: 1 });
      return page.getTextContent().then(function (tc) {
        var items = toItems(tc, vp);
        items.forEach(function (it) { it.page = n; });
        return { items: items, page: n };
      });
    });
  }

  /* 多页 → 文本行。分两种走法：
       教务系统模板课表 —— 整份一起还原（课程说明会跨页续写，逐页来会断）
       普通课表       —— 逐页还原再拼（每页各是一张独立的表） */
  function rebuildPages(pages) {
    var all = [], itemCount = 0;
    pages.forEach(function (pg) {
      itemCount += pg.items.length;
      all = all.concat(pg.items);
    });

    var lines = [], warnings = [], mode = 'flat', cols = 0, rows = 0, parity = 0;

    if (looksLikeWzu(all)) {
      var w = rebuild(all);
      lines = w.lines; mode = w.mode; cols = w.cols; rows = w.rows;
      parity = w.parity || 0;
      warnings = w.warnings.slice();
    } else {
      pages.forEach(function (pg) {
        if (!pg.items.length) return;
        var r = rebuild(pg.items);
        if (r.mode === 'grid') mode = 'grid';
        if (r.cols > cols) cols = r.cols;
        if (r.rows > rows) rows = r.rows;
        r.warnings.forEach(function (msg) { if (warnings.indexOf(msg) < 0) warnings.push(msg); });
        lines = lines.concat(r.lines);
      });
    }

    return {
      lines: lines, mode: mode, cols: cols, rows: rows, parity: parity,
      itemCount: itemCount, warnings: warnings
    };
  }

  function extractBuffer(buf, opt) {
    opt = opt || {};
    var onProgress = opt.onProgress;
    var maxPages = opt.maxPages || 8;

    return loadLib().then(function (L) {
      if (onProgress) onProgress('正在解析 PDF…');
      _cmapMiss.length = 0;
      return L.getDocument({
        data: buf,
        /* 中文 PDF 的字体常写成「预定义 CMap」（教务系统 iText 导出就是
           STSong-Light + UniGB-UCS2-H），必须给到字库映射，否则文字
           一个都解不出来 —— 而且 pdf.js 不报错，只是静静给你空结果。 */
        cMapUrl: CMAPS,
        cMapPacked: true,
        CMapReaderFactory: CMapFactory
      }).promise;
    }).then(function (doc) {
      var n = Math.min(doc.numPages, maxPages);
      if (onProgress) {
        onProgress(n < doc.numPages
          ? ('共 ' + doc.numPages + ' 页，先识别前 ' + n + ' 页…')
          : ('共 ' + n + ' 页，识别中…'));
      }

      var jobs = [];
      for (var p = 1; p <= n; p++) jobs.push(readPage(doc, p));

      return Promise.all(jobs).then(function (pages) {
        var r = rebuildPages(pages);
        /* 抽取到的碎片太少 → 基本可以断定是扫描件（没有文字层） */
        var scanned = r.itemCount < 5;
        var warnings = r.warnings.slice();

        if (scanned) {
          warnings.push('这份 PDF 里几乎没有可提取的文字 —— 多半是扫描件，或者截图转出来的');
        } else if (!r.lines.length) {
          var miss = cmapMissed();
          if (miss.length) {
            warnings.push('这份 PDF 的字体用到了内置字库映射（' + miss.join('、') +
              '），本地没有对应文件，所以文字没能解出来；换成用本地服务（http）打开再试一次通常就好了');
          } else {
            warnings.push('读到了文字，但没能拼出课程 —— 可以把识别出的文字发我，我照着调');
          }
        }

        return {
          text: r.lines.join('\n'),
          lines: r.lines,
          mode: r.mode,
          cols: r.cols,
          rows: r.rows,
          pages: n,
          items: r.itemCount,
          scanned: scanned,
          parity: r.parity,
          warnings: warnings
        };
      });
    }).catch(function (e) { throw normalizeErr(e); });
  }

  function extractFile(file, opt) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('没有选择文件')); return; }
      if (/\.pdf$/i.test(file.name || '') === false && file.type !== 'application/pdf') {
        reject(new Error('请选择 .pdf 文件'));
        return;
      }
      var fr = new FileReader();
      fr.onload = function () {
        extractBuffer(fr.result, opt).then(resolve, reject);
      };
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.readAsArrayBuffer(file);
    });
  }

  return {
    /* 真·读 PDF */
    extractFile: extractFile,
    extractBuffer: extractBuffer,
    loadLib: loadLib,
    libLoaded: libLoaded,
    lastError: lastError,
    useLib: useLib,
    cmapMissed: cmapMissed,
    /* 纯函数（可单测） */
    toItems: toItems,
    mulMatrix: mulMatrix,
    columnsOf: columnsOf,
    linesOf: linesOf,
    gridRebuild: gridRebuild,
    wzuRebuild: wzuRebuild,
    looksLikeWzu: looksLikeWzu,
    dayAnchors: dayAnchors,
    coursesFromWzuColumn: coursesFromWzuColumn,
    flatRebuild: flatRebuild,
    rebuild: rebuild,
    rebuildPages: rebuildPages,
    joinCell: joinCell,
    secOf: secOf,
    secOfTime: secOfTime,
    ordinalSec: ordinalSec,
    medianSize: medianSize,
    VENDOR: VENDOR,
    CMAPS: CMAPS,
    CMAPS_INLINE: CMAPS_INLINE,
    CMapFactory: CMapFactory,
    ucs2For: ucs2For
  };
})();
