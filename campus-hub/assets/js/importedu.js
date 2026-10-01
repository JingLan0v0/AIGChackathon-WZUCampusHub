/* ==========================================================
   校园百事通 · 真实教务数据导入
   ----------------------------------------------------------
   数据从哪来：学生在【已登录】的温大新教务系统页面里跑一段抓取脚本
   （tools/wzu-grabber.js，页面用 <script type="text/plain" id="grabberSrc"> 内联了一份），
   脚本把课表 + 调停课通知打包成 JSON。学生把 JSON 贴回这里即可。

   这里负责三件事：
     1. 解析  —— JSON / 纯文本课表 都能吃
     2. 预览  —— 先看清楚识别到了什么，再决定要不要落库
     3. 入库  —— 课表整体替换；调停课通知只存原文，交给 Adjust 解析（复用同一条链路）
   ========================================================== */
var ImportEdu = (function () {
  var DAYMAP = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
  };
  var DAYNAME = ['', '一', '二', '三', '四', '五', '六', '日'];
  /* 作息表一共 13 节（上午 1~5 / 下午 6~10 / 晚上 11~13），连堂不能长出最后一节。
     注意：不能简单地把 span 卡成某个固定上限，否则「(2-9节)」这种整天连上的
     公选课会被截断。正确做法是按「从 start 到第 13 节还剩几节」来卡。 */
  var MAX_PERIODS = 13;
  function clampSpan(start, span) {
    var s = Math.max(1, parseInt(span, 10) || 1);
    var room = Math.max(1, MAX_PERIODS - (parseInt(start, 10) || 1) + 1);
    return Math.min(s, room);
  }

  /* ---------- 文本小工具（与 tools/wzu-grabber.js 保持同一套规则） ---------- */
  function clean(s) {
    return String(s == null ? '' : s).replace(/[\u00a0\u3000]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function hasCJK(s) { return /[\u4e00-\u9fa5]/.test(s); }

  function weeksOf(text) {
    var out = { from: 1, to: 16 };
    var m = text.match(/(\d{1,2})\s*[-–~—至]\s*(\d{1,2})\s*周/);
    if (m) { out.from = +m[1]; out.to = +m[2]; return out; }
    m = text.match(/(?:第\s*)?(\d{1,2}(?:\s*[,，]\s*\d{1,2})*)\s*周/);
    if (m) {
      var a = m[1].split(/\s*[,，]\s*/).map(Number);
      out.from = Math.min.apply(null, a); out.to = Math.max.apply(null, a);
    }
    return out;
  }

  function sectionsOf(text) {
    var m = text.match(/(?:第\s*)?(\d{1,2})\s*[-–~—至]\s*(\d{1,2})\s*节/);
    if (m) return { start: +m[1], span: Math.max(1, +m[2] - +m[1] + 1) };
    m = text.match(/(?:第\s*)?(\d{1,2})\s*节/);
    if (m) return { start: +m[1], span: 1 };
    return null;
  }

  /* 把「时间类文字」抹掉，剩下的才用来找教室/老师。
     坑：数字与「周」之间不能允许空格 —— 否则「计算机楼-408 周二」
     会被吃成「计算机楼-4」+「二」，教室和老师全错。 */
  function stripTime(s) {
    return String(s || '')
      .replace(/(?:第\s*)?\d{1,2}\s*[-–~—至]\s*\d{1,2}\s*节/g, ' ')
      .replace(/(?:第\s*)?\d{1,2}\s*节/g, ' ')
      .replace(/(?:第\s*)?\d{1,2}\s*[-–~—至]\s*\d{1,2}周/g, ' ')
      .replace(/(?:第\s*)?\d{1,2}周/g, ' ')
      .replace(/(?:星期|周)[一二三四五六日天1-7]/g, ' ');
  }

  /* 教室匹配。返回两个东西：
       room —— 归一化后的写法（统一成「楼-房号」）
       raw  —— 原文里实际匹配到的那一段
     为什么要 raw：归一化会把「外语楼305」改写成「外语楼-305」，
     拿改写后的字串回原文里做替换是对不上的，残渣会留在课名里。 */
  function roomMatch(text) {
    var t = stripTime(text);
    /* 横线写法。房号允许带字母前缀 —— 教务系统就是「南5-A101」「北2-406」
       这种（校区方位 + 楼号 - 房号）。末尾的 (?!\d) 是防误伤：
       没有它，「教学班:(2026-2027-1)-142006601L-20180171-1」里的
       「L-20180171」会被当成教室「L-2018」。 */
    var m = t.match(/([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9]{0,9})\s*[-－—]\s*([A-Za-z]?\d{1,4})(?!\d)/);
    if (m) return { room: m[1] + '-' + m[2], raw: m[0] };
    /* 楼名和房号之间没横线也是常见写法（外语楼305 / 图书馆A203）。
       必须真的跟房号才算，否则「图书馆利用」这种课名会被当成教室。 */
    m = t.match(/([\u4e00-\u9fa5A-Za-z]{1,8}(?:楼|馆|院|区|中心|实验室|机房|室))\s*([A-Za-z]?\d{1,4})/);
    if (m) return { room: m[1] + '-' + m[2], raw: m[0] };
    /* 场馆类：没有房号，整个名字就是场地（教务系统写「南水泥篮球场」） */
    m = t.match(/([\u4e00-\u9fa5]{2,10}(?:体育馆|篮球场|足球场|网球场|排球场|羽毛球场|球场|田径场|体育场|游泳馆|操场|运动场|报告厅|活动中心|实验室|机房|阅览室))/);
    if (m) return { room: m[1], raw: m[0] };
    return { room: '', raw: '' };
  }

  /* 带标签的字段（「场地:南5-A101」「教师:刘鹏程」）。
     教务系统的原始文字、以及课表 PDF 识别出来的文本都是这个写法，
     比靠「哪个词最长像课名」猜准得多，所以优先用它们。
     值只取到下一个空格 / 斜杠 / 逗号为止，这样
     「场地:南5-A101/教师:刘鹏程」和「场地:南5-A101 教师:…」都能断对。 */
  function labeledField(text, keys) {
    for (var i = 0; i < keys.length; i++) {
      var re = new RegExp(keys[i] + '\\s*[:：]\\s*([^\\s\\/\\\\|,，;；]+)');
      var m = text.match(re);
      if (m && m[1]) return { value: clean(m[1]), raw: m[0] };
    }
    return null;
  }

  var ROOM_KEYS = ['上课地点', '上课教室', '场地', '教室'];
  var TEACHER_KEYS = ['授课教师', '任课教师', '教师', '老师'];
  /* 老师名：2~4 个汉字，可以是「胡文超、叶茜」这种多位老师合写 */
  var RE_TEACHER = /^[\u4e00-\u9fa5]{2,4}(?:[、·][\u4e00-\u9fa5]{2,4})*$/;

  /* 把一条记录拆成「课程名 / 老师 / 教室 / 星期 / 节次 / 周次」 */
  function parseRecord(text) {
    var flat = clean(text);
    if (!flat || !hasCJK(flat)) return [];
    var wk = weeksOf(flat);

    /* 带标签的字段最准，先摘走；剩下的文字再交给启发式，两边互不干扰。
       （顺序很重要：不先摘「教师:…」，后面的「场地」俩字会被当成老师名。） */
    var labRoom = labeledField(flat, ROOM_KEYS);
    var labTeacher = labeledField(flat, TEACHER_KEYS);
    var body = flat;
    if (labRoom) body = body.replace(labRoom.raw, ' ');
    if (labTeacher) body = body.replace(labTeacher.raw, ' ');

    var rm = roomMatch(body);
    var room = labRoom ? labRoom.value : rm.room;

    /* 去掉时间与教室后剩下的 token，用来挑课程名和老师。
       注意保留括号：「体育(篮球)」这种课名不能把括号拆掉。
       教务系统里两字姓名常写成「陈 立」，所以还要能把相邻的单字拼回老师名。
       抹教室要用 raw（原文那一段），不能用归一化后的写法。 */
    var rest = stripTime(body).replace(rm.raw || '\u0000', ' ').replace(/[\[\]【】,，;；:：|/\\]+/g, ' ');
    var tokens = rest.split(/\s+/).map(clean).filter(function (t) {
      /* 丢掉「第 / 周 / 节 / 时 / 分」这类剥时间时剩下的残渣 */
      return t && hasCJK(t) && !/^[第周节时分]$/.test(t);
    });
    var name = '', teacher = labTeacher ? labTeacher.value : '';
    tokens.forEach(function (t) {
      if (t.length > name.length) name = t;
    });
    for (var i = 0; !teacher && i < tokens.length; i++) {
      var t = tokens[i];
      if (t === name) continue;
      if (RE_TEACHER.test(t)) { teacher = t; break; }
    }
    if (!teacher) {
      /* 「王海峰」之外的形态：陈 立 / 张 敏 —— 把紧跟课名的单字拼起来 */
      var idx = tokens.indexOf(name), buf = [];
      for (var k = idx + 1; k < tokens.length; k++) {
        if (/^[\u4e00-\u9fa5]$/.test(tokens[k])) buf.push(tokens[k]);
        else break;
      }
      if (buf.length >= 2 && buf.length <= 4) teacher = buf.join('');
    }
    if (!name) name = flat.slice(0, 30);
    name = name.replace(/^[\[（(【]\s*[^\]）)】]{0,20}\s*[\]）)】]\s*/, '');
    if (name.length < 2) return [];

    /* 一条记录里可能写了多个「周X + 节次」，逐个生成 */
    var combos = [], re = /(?:星期|周)([一二三四五六日天1-7])/g, m;
    while ((m = re.exec(flat))) {
      var sec = sectionsOf(flat.slice(m.index));
      if (sec) combos.push({ day: DAYMAP[m[1]], start: sec.start, span: sec.span });
    }
    var out = [];
    combos.forEach(function (cb) {
      out.push({
        name: name.slice(0, 40), teacher: teacher, room: room || '待定',
        day: cb.day, start: cb.start, span: clampSpan(cb.start, cb.span),
        from: Math.max(1, wk.from), to: Math.max(1, wk.to)
      });
    });
    return out;
  }

  /* 纯文本课表 → 课程数组（支持一条一行，也支持一门课一段） */
  function parseCourseText(text) {
    var raw = String(text || '').replace(/\r/g, '');
    if (!raw.trim()) return { courses: [], warnings: ['粘贴区是空的'] };
    var blocks = raw.split(/\n\s*\n+/).map(clean).filter(Boolean);
    if (blocks.length < 2) blocks = raw.split(/\n/).map(clean).filter(Boolean);

    var courses = [], bad = [];
    blocks.forEach(function (b) {
      var items = parseRecord(b);
      if (items.length) courses = courses.concat(items);
      else if (b.length > 3) bad.push(b.slice(0, 60));
    });
    return { courses: courses, warnings: bad.length ? ['有 ' + bad.length + ' 行没认出是课程，已忽略'] : [] };
  }

  /* ---------- 统一校验 + 归一化 ---------- */
  function normalize(courses, notices, info) {
    var ok = [], bad = 0;
    (courses || []).forEach(function (c) {
      var name = clean((c && c.name) || '');
      var day = parseInt(c && c.day, 10);
      var start = parseInt(c && c.start, 10);
      if (!name || !(day >= 1 && day <= 7) || !(start >= 1 && start <= MAX_PERIODS)) { bad += 1; return; }
      var from = Math.max(1, parseInt(c.from, 10) || 1);
      ok.push({
        name: name.slice(0, 40),
        teacher: clean((c && c.teacher) || ''),
        room: clean((c && c.room) || '') || '待定',
        day: day, start: start,
        span: clampSpan(start, parseInt(c.span, 10) || 2),
        from: from, to: Math.max(from, parseInt(c.to, 10) || 16)
      });
    });
    /* 同一门课同一时间只留一条 */
    var seen = {}, uniq = [];
    ok.forEach(function (c) {
      var k = [c.name, c.day, c.start, c.from, c.to].join('|');
      if (seen[k]) return; seen[k] = 1; uniq.push(c);
    });
    uniq.sort(function (a, b) { return a.day - b.day || a.start - b.start; });

    var nts = (notices || []).filter(function (n) { return n && (n.body || n.title); });
    var warnings = (info && info.warnings ? info.warnings.slice() : []);
    if (bad) warnings.push('有 ' + bad + ' 条课程字段不完整，已跳过');
    if (!uniq.length) warnings.push('没有识别到任何课程');

    return {
      kind: (info && info.kind) || 'unknown',
      meta: (info && info.meta) || null,
      courses: uniq,
      notices: nts,
      rejected: bad,
      warnings: warnings
    };
  }

  /* ---------- 入口：一段文本 → 解析结果 ---------- */
  function parsePayloadText(text) {
    var t = String(text || '').trim();
    if (!t) throw new Error('粘贴区是空的');
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      var j = JSON.parse(t);                       /* 解析失败直接抛给调用方 */
      var isArr = Object.prototype.toString.call(j) === '[object Array]';
      var courses = isArr ? j : (j.courses || []);
      var notices = isArr ? [] : (j.notices || []);
      return normalize(courses, notices, {
        kind: isArr ? 'json-array' : (j.kind || 'json'),
        meta: (!isArr && j.source) ? { host: j.source.host, url: j.source.url, grabbedAt: j.grabbedAt, page: j.source.page } : null,
        warnings: (!isArr && j.warnings) ? j.warnings : []
      });
    }
    var r = parseCourseText(t);
    return normalize(r.courses, [], { kind: 'text', meta: null, warnings: r.warnings });
  }

  /* ---------- 抓取脚本源码（内联在页面的 #grabberSrc 里） ---------- */
  function grabberSource() {
    var el = document.getElementById('grabberSrc');
    if (!el) return '';
    return (el.textContent || el.innerHTML || '').trim();
  }

  function copyText(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch (e) { /* 继续试下面那种 */ }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  /* ---------- 预览渲染 ---------- */
  function srcLine(p) {
    if (p.kind === 'pdf') {
      /* 教务系统导出的课表是「模板化」的（场地 / 教师 / 学分都写在文字里），
         和普通 PDF 表格认法不一样，说清楚用户才知道该不该信。 */
      var how = (p.meta && p.meta.mode === 'wzu') ? '教务系统课表模板' : 'PDF 文字识别';
      return '来源：课表 PDF 自动识别 · ' + how +
        (p.meta && p.meta.name ? ' · ' + UI.esc(p.meta.name) : '');
    }
    if (p.meta && p.meta.host) {
      return '来源：' + UI.esc(p.meta.host) + (p.meta.grabbedAt ? ' · 抓取于 ' + UI.esc(String(p.meta.grabbedAt).slice(0, 16).replace('T', ' ')) : '');
    }
    if (p.kind === 'text') return '来源：粘贴的课表文字';
    return '来源：粘贴的数据';
  }

  function previewHtml(p) {
    if (!p) return '<div class="ie-empty">请选择课表 PDF，识别结果会显示在这里</div>';
    var h = '';
    h += '<div class="ie-sum">' +
      '<span class="badge badge-green">识别到 ' + p.courses.length + ' 条课程</span>' +
      (p.notices.length ? '<span class="badge badge-blue">调停课通知 ' + p.notices.length + ' 条</span>' : '') +
      (p.rejected ? '<span class="badge badge-grey">跳过 ' + p.rejected + ' 条</span>' : '') +
      '</div>' +
      '<div class="ie-src">' + srcLine(p) + '</div>';
    if (p.warnings.length) {
      h += '<div class="ie-warn">' + p.warnings.map(UI.esc).join('　·　') + '</div>';
    }
    if (p.courses.length) {
      h += '<div class="ie-list">';
      p.courses.forEach(function (c) {
        h += '<div class="ie-row">' +
          '<span class="ie-tag">周' + DAYNAME[c.day] + '</span>' +
          '<span class="ie-time">第' + c.start + '-' + (c.start + c.span - 1) + '节</span>' +
          '<b>' + UI.esc(c.name) + '</b>' +
          '<small>' + UI.esc(c.teacher || '老师待填') + ' · ' + UI.esc(c.room) + ' · ' + c.from + '-' + c.to + '周</small>' +
          '</div>';
      });
      h += '</div>';
    }
    return h;
  }

  /* ---------- 打开导入弹窗 ---------- */
  function open(opt) {
    opt = opt || {};
    var parsed = null;
    UI.modal({
      title: '导入课表 PDF', size: 'lg',
      body: '<div class="ie-steps">' +
        '<div class="ie-step"><span class="ie-num">1</span><div class="ie-txt">' +
          '<b>上传课表 PDF</b><small>选择教务系统导出的课表 PDF，自动识别课程、时间、教师与教室。</small>' +
          '<div class="ie-drop" id="ieDrop"><button class="btn btn-sm btn-primary" id="iePdf">📄 选择课表 PDF</button>' +
          '<input type="file" id="iePdfInput" accept=".pdf,application/pdf" hidden>' +
          '<span class="ie-hint">也可以把 PDF 直接拖到这里</span></div><div id="iePdfState"></div>' +
          '<div class="ie-tools"><button class="btn btn-sm" id="ieReset">清空</button></div></div></div>' +
        '<div class="ie-step"><span class="ie-num">2</span><div class="ie-txt">' +
          '<b>核对后导入</b><small>导入会整体替换当前课表，并清空已应用的调课调整。</small>' +
          '<div class="ie-preview" id="iePreview">' + previewHtml(null) + '</div></div></div></div>',
      footer: '<button class="btn" id="ieClose">取消</button><button class="btn btn-primary" id="ieSave" disabled>确认导入</button>',
      onMount: function (scope, close) {
        var prev = UI.qs('#iePreview', scope), save = UI.qs('#ieSave', scope);
        var state = UI.qs('#iePdfState', scope), input = UI.qs('#iePdfInput', scope), drop = UI.qs('#ieDrop', scope);
        var version = 0;
        UI.qs('#ieClose', scope).onclick = close;
        function show() { prev.innerHTML = previewHtml(parsed); save.disabled = !(parsed && parsed.courses.length); }
        function note(text, cls) { state.innerHTML = '<div class="' + cls + '">' + text + '</div>'; }
        function takePdf(file) {
          if (!file) return;
          var request = ++version;
          parsed = null; show();
          if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') {
            note('仅支持课表 PDF，请选择 .pdf 文件。', 'ie-warn'); return;
          }
          if (typeof PdfEdu === 'undefined') { note('PDF 识别模块未加载，请刷新后重试。', 'ie-warn'); return; }
          var name = file.name || '课表.pdf';
          note('正在识别 <b>' + UI.esc(name) + '</b>…', 'ie-busy');
          PdfEdu.extractFile(file, {
            onProgress: function (msg) {
              if (request === version && scope.isConnected) note('正在识别 <b>' + UI.esc(name) + '</b>…<br>' + UI.esc(msg), 'ie-busy');
            }
          }).then(function (r) {
            if (request !== version || !scope.isConnected) return;
            if (r.scanned || !r.lines.length) {
              note('这个 PDF 没有可提取的文字，可能是扫描件或截图转出的 PDF。请上传教务系统直接导出的文字版 PDF。', 'ie-warn'); return;
            }
            var result = parsePayloadText(r.text);
            result.kind = 'pdf'; result.meta = { name: name, mode: r.mode || '' }; result.notices = [];
            result.warnings = result.warnings.concat(r.warnings || []);
            parsed = result; show();
            var how = r.mode === 'wzu' ? '教务系统课表模板' : r.mode === 'grid' ? '表格结构' : '逐行识别';
            note('已识别 <b>' + UI.esc(name) + '</b>（' + r.pages + ' 页 · ' + how + '）。请核对下面的课程。' +
              ((r.warnings || []).length ? '<br>' + r.warnings.map(UI.esc).join(' · ') : ''), 'ie-ok');
          }).catch(function (error) {
            if (request !== version || !scope.isConnected) return;
            parsed = null; show(); note('识别失败：' + UI.esc(error && error.message || '请重新选择 PDF'), 'ie-warn');
          });
        }
        UI.qs('#iePdf', scope).onclick = function () { input.click(); };
        input.onchange = function () { takePdf(this.files && this.files[0]); };
        UI.qs('#ieReset', scope).onclick = function () { version++; parsed = null; input.value = ''; state.innerHTML = ''; show(); };
        ['dragenter', 'dragover'].forEach(function (ev) {
          drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('on'); });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
          drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('on'); });
        });
        drop.addEventListener('drop', function (e) { takePdf(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
        save.onclick = function () {
          if (!parsed || !parsed.courses.length) return;
          var result = parsed;
          UI.confirm('将把当前课表整体替换为 PDF 中的 ' + result.courses.length + ' 条课程。继续吗？', '确认导入').then(function (yes) {
            if (!yes) return;
            var n = Store.importCourses(result.courses, result.meta);
            Store.save(); close();
            if (typeof opt.onDone === 'function') opt.onDone({ courses: n, notices: 0 });
            else UI.toast('导入成功，刷新后生效', 'ok');
          });
        };
        if (opt.file) takePdf(opt.file);
      }
    });
  }

  return {
    open: open,
    parsePayloadText: parsePayloadText,
    parseCourseText: parseCourseText,
    parseRecord: parseRecord,
    grabberSource: grabberSource
  };
})();
