/* ==========================================================
   校园百事通 · 温大教务系统「课表 + 调停课通知」抓取脚本
   ----------------------------------------------------------
   怎么用：
     1. 浏览器里正常打开温大统一身份认证并登录（验证码/扫码都你来）；
     2. 进入【新教务系统】，打开【我的课表】页面，等课表完全显示出来；
     3. 按 F12 → 切到 Console（控制台）→ 把本文件全部内容粘进去 → 回车；
     4. 右上角会弹出一块面板，里面就是抓好的 JSON；
        能自动复制就已经在剪贴板里了，没成功就点面板里的【复制】；
     5. 回到「校园百事通」→ 我的 → 账号与教务绑定 → 导入真实课表 → 粘贴进去。

   为什么这样能拿到真数据（答辩可以讲）：
     · 这是「同源脚本」——它跑在教务系统自己的页面里，
       浏览器会自动把该页面的登录 Cookie 带上，因此能读到课表。
     · 脚本【不接触你的账号密码】，也不向任何第三方服务器发请求，
       只读当前页面已有的数据，导出的 JSON 交给你自己粘贴。
     · 没有后端、不需要破解登录、不需要过人机验证 —— 所以不会被风控。

   抓取顺序（自动降级）：
     ① 先试教务系统自带的课表接口（同一域名，自动带 Cookie）；
     ② 读不出来就直接解析页面上的课表表格（DOM）；
     ③ 顺手把页面里出现的调停课通知原文一起抓走。
     ④ 万一①②都失败，面板会提示你改用「文本导入」。
   ========================================================== */
(function () {
  var W = window, D = document;

  /* ---------- 小工具 ---------- */
  var DAYMAP = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
  };
  var CN2N = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

  function clean(s) {
    return String(s == null ? '' : s).replace(/[\u00a0\u3000]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function lines(s) {
    return String(s == null ? '' : s).split(/\r?\n/).map(clean).filter(Boolean);
  }
  function hasCJK(s) { return /[\u4e00-\u9fa5]/.test(s); }

  /* 周次：1-16周 / 第1-16周 / 1,3,5周 / 数值周 */
  function weeks(text) {
    var out = { from: 1, to: 16, raw: '' };
    var m = text.match(/(\d{1,2})\s*[-–~—至]\s*(\d{1,2})\s*周/);
    if (m) { out.from = +m[1]; out.to = +m[2]; out.raw = m[0]; return out; }
    m = text.match(/(?:第\s*)?(\d{1,2}(?:\s*[,，]\s*\d{1,2})*)\s*周/);
    if (m) {
      var a = m[1].split(/\s*[,，]\s*/).map(Number);
      out.from = Math.min.apply(null, a); out.to = Math.max.apply(null, a); out.raw = m[0];
      return out;
    }
    return out;
  }

  /* 节次：第1-2节 / 1-2节 / 第3节 */
  function sections(text) {
    var m = text.match(/(?:第\s*)?(\d{1,2})\s*[-–~—至]\s*(\d{1,2})\s*节/);
    if (m) return { start: +m[1], span: Math.max(1, +m[2] - +m[1] + 1) };
    m = text.match(/(?:第\s*)?(\d{1,2})\s*节/);
    if (m) return { start: +m[1], span: 1 };
    return null;
  }

  /* 第一大节 → 第1-2节 */
  function bigSection(text) {
    var m = text.match(/第\s*([一二三四五六七八九十]+)\s*大节/);
    if (!m) return null;
    var n = 0, s = m[1];
    for (var i = 0; i < s.length; i++) {
      if (CN2N[s.charAt(i)]) n = n * 10 + CN2N[s.charAt(i)];
    }
    if (!n) return null;
    return { start: (n - 1) * 2 + 1, span: 2 };
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

  /* 教室：计算机楼-408 / 教A-203 / 外语楼305 / 南5-A101 / 北校区体育馆 */
  function roomOf(text) {
    var t = stripTime(text);
    /* 房号允许带字母前缀（「南5-A101」是教务系统的写法）；
       末尾 (?!\d) 防止把「教学班:…-142006601L-20180171-1」里的编号当教室。 */
    var m = t.match(/([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9]{0,9})\s*[-－—]\s*([A-Za-z]?\d{1,4})(?!\d)/);
    if (m) return m[1] + '-' + m[2];
    /* 楼名和房号之间没横线也是常见写法（外语楼305 / 图书馆A203）。
       必须真的跟房号才算，否则「图书馆利用」这种课名会被当成教室。 */
    m = t.match(/([\u4e00-\u9fa5A-Za-z]{1,8}(?:楼|馆|院|区|中心|实验室|机房|室))\s*([A-Za-z]?\d{1,4})/);
    if (m) return m[1] + '-' + m[2];
    m = t.match(/([\u4e00-\u9fa5]{2,10}(?:体育馆|篮球场|足球场|网球场|排球场|羽毛球场|球场|田径场|体育场|游泳馆|操场|运动场|报告厅|活动中心|实验室|机房|阅览室))/);
    if (m) return m[1];
    return '';
  }

  /* 老师名：2–4 个汉字，允许像「陈 立」这样中间夹一个空格 */
  function isTeacherLine(s) {
    var parts = clean(s).split(/\s*[,，、]\s*/);
    if (!parts.length) return false;
    for (var i = 0; i < parts.length; i++) {
      if (!/^[\u4e00-\u9fa5]{2,4}$/.test(parts[i].replace(/\s+/g, ''))) return false;
    }
    return true;
  }

  /* ---------- 解析一个课表格子 ---------- */
  function parseCell(rawText, day, rowSection) {
    var L = lines(rawText);
    if (!L.length) return null;
    var all = L.join(' ');
    if (!hasCJK(all)) return null;
    if (/^(星期一|星期二|星期三|星期四|星期五|星期六|星期日|周日)$/.test(all)) return null;

    var sec = sections(all);
    var start = sec ? sec.start : (rowSection ? rowSection.start : 0);
    var span = sec ? sec.span : (rowSection ? rowSection.span : 2);
    if (!start) return null;

    var room = roomOf(all);
    var name = '', teacher = '';

    L.forEach(function (ln) {
      if (/\d\s*周/.test(ln)) return;                              /* 周次行 */
      if (/节/.test(ln)) return;                                    /* 节次行 */
      if (/^(周|星期)[一二三四五六日天]\s*$/.test(ln)) return;         /* 光秃秃的星期 */
      if (/^[第周节时分]$/.test(ln)) return;                          /* 剥时间剩下的残渣 */
      var isRoomLine = room && roomOf(ln) && ln.length <= room.length + 4;
      if (isRoomLine) return;
      if (!name) { name = ln; return; }
      if (!teacher && isTeacherLine(ln)) teacher = ln;
    });

    if (!name) name = L[0];
    /* 去掉课程代码前缀：[010203] 或 （2026） */
    name = name.replace(/^[\[（(【]\s*[^\]）)】]{0,20}\s*[\]）)】]\s*/, '').trim();
    if (!name || name.length < 2) return null;

    var wk = weeks(all);
    /* 连堂上限 = 作息表节数（一天 13 节）。原来卡 6，会把「(2-9节)」
       这种整天连上的公选课截成「2-7 节」。入库前 ImportEdu 还会再收口一次。 */
    return {
      name: name.slice(0, 40), teacher: teacher, room: room || '待定',
      day: day, start: start, span: Math.max(1, Math.min(13, span)),
      from: Math.max(1, wk.from), to: Math.max(1, wk.to)
    };
  }

  /* ---------- 找课表表格 ---------- */
  function tableScore(t) {
    var head = clean((t.innerText || '')).slice(0, 500);
    var s = 0;
    if (/(?:星期|周)[一二三四五六日天]/.test(head)) s += 3;
    if (/\d{1,2}\s*周/.test(head)) s += 2;
    if (/节/.test(head)) s += 2;
    if (t.rows && t.rows.length >= 5) s += 1;
    if (t.querySelectorAll('td,th').length >= 15) s += 1;
    return s;
  }

  function dayCols(t) {
    var map = {}, found = 0;
    var rows = t.rows;
    for (var r = 0; r < Math.min(3, rows.length); r++) {
      var cells = rows[r].cells;
      for (var c = 0; c < cells.length; c++) {
        var tx = clean(cells[c].innerText || cells[c].textContent || '');
        if (tx.length > 8) continue;
        var m = tx.match(/(?:星期|周)([一二三四五六日天])/);
        if (m) { map[cells[c].cellIndex] = DAYMAP[m[1]]; found++; }
      }
      if (found >= 4) break;
    }
    return found >= 4 ? map : null;
  }

  function rowSections(t) {
    var out = [], rows = t.rows;
    for (var r = 0; r < rows.length; r++) {
      var c0 = rows[r].cells[0];
      var tx = c0 ? clean(c0.innerText || c0.textContent || '') : '';
      out.push(sections(tx) || bigSection(tx));
    }
    return out;
  }

  function grabFromDom() {
    var tables = [].slice.call(D.querySelectorAll('table'));
    var scored = tables.map(function (t) { return { t: t, s: tableScore(t) }; })
      .filter(function (x) { return x.s >= 5; })
      .sort(function (a, b) { return b.s - a.s; });

    var courses = [], unknown = [];
    for (var i = 0; i < scored.length; i++) {
      var t = scored[i].t;
      var dm = dayCols(t);
      if (!dm) continue;
      var rs = rowSections(t);
      var rows = t.rows;
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].cells;
        for (var c = 0; c < cells.length; c++) {
          var idx = cells[c].cellIndex;
          var day = dm[idx];
          if (!day) continue;
          var raw = cells[c].innerText || cells[c].textContent || '';
          if (!clean(raw)) continue;
          var item = parseCell(raw, day, rs[r]);
          if (item) courses.push(item);
          else if (clean(raw).length > 3) unknown.push(clean(raw).slice(0, 120));
        }
      }
      if (courses.length) break;
    }
    return { courses: courses, unknown: unknown.slice(0, 20) };
  }

  /* ---------- 兜底：扫整页找「长得像课表」的文字块 ---------- */
  function grabFromText() {
    var courses = [], seen = {};
    var nodes = D.querySelectorAll('td,li,p,dd,div,span');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.querySelector('table,div,li,p,td,span')) continue;   /* 只要叶子 */
      var tx = clean(el.innerText || el.textContent || '');
      if (tx.length < 4 || tx.length > 200) continue;
      if (!/\d{1,2}\s*周/.test(tx)) continue;
      if (!hasCJK(tx)) continue;
      var dm = tx.match(/(?:星期|周)([一二三四五六日天])/);
      if (!dm) continue;
      var sec = sections(tx);
      if (!sec) continue;
      var item = parseCell(tx, DAYMAP[dm[1]], null);
      if (!item) continue;
      var k = [item.name, item.day, item.start].join('|');
      if (seen[k]) continue; seen[k] = 1;
      courses.push(item);
    }
    return courses;
  }

  /* ---------- 试教务系统自带的课表接口（同源，自动带 Cookie） ---------- */
  function withTimeout(p, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms);
      p.then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        function () { if (!done) { done = true; clearTimeout(t); resolve(null); } });
    });
  }

  var API_PATHS = [
    '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151',
    '/jwglxt/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151',
    '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151'
  ];

  function probeApis() {
    var origin = location.origin;
    return Promise.all(API_PATHS.map(function (p) {
      return withTimeout(
        fetch(origin + p, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: 'xnm=&xqm=&kzlx=ck'
        }).then(function (r) { return r.ok ? r.text() : ''; })
          .then(function (t) {
            if (!t || t.length < 20) return null;
            var j = null;
            try { j = JSON.parse(t); } catch (e) { return null; }
            var list = j && (j.kbList || j.kblist || (j.data && j.data.kbList));
            return (list && list.length) ? list : null;
          }), 4000);
    })).then(function (rs) {
      for (var i = 0; i < rs.length; i++) if (rs[i]) return rs[i];
      return null;
    });
  }

  /* 正方教务课表接口字段 → 校园百事通课程结构 */
  function fromApiList(list) {
    var out = [];
    list.forEach(function (k) {
      var day = +(k.xqj || 0);
      if (!day) {
        var m = clean(k.xqjmc || '').match(/(?:星期|周)([一二三四五六日天])/);
        day = m ? DAYMAP[m[1]] : 0;
      }
      var sec = sections(clean(k.jcs || k.jc || ''));
      if (!day || !sec) return;
      var wk = weeks(clean(k.zcd || k.zcmc || ''));
      out.push({
        name: clean(k.kcmc || k.courseName || '课程').replace(/^[\[（(【][^\]）)】]*[\]）)】]\s*/, ''),
        teacher: clean(k.xm || k.jsxm || ''),
        room: clean(k.cdmc || k.jxdd || '') || '待定',
        day: day, start: sec.start, span: sec.span, from: wk.from, to: wk.to
      });
    });
    return out;
  }

  /* ---------- 抓调停课通知原文 ---------- */
  function grabNotices() {
    var out = [], seen = {};
    var nodes = D.querySelectorAll('li,td,p,dd,article,div');
    if (nodes.length > 6000) nodes = D.querySelectorAll('li,td,p');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.querySelector('li,td,p,div,article,table,section')) continue;   /* 只要叶子块 */
      var tx = clean(el.innerText || el.textContent || '');
      if (tx.length < 16 || tx.length > 500) continue;
      if (!/(调课|停课|补课|换教室|教室调整|加课|补授)/.test(tx)) continue;
      if (seen[tx]) continue; seen[tx] = 1;
      out.push({
        no: 'GRAB-' + Date.now().toString(36) + '-' + out.length,
        category: '', title: tx.slice(0, 40), body: tx,
        publisher: '', publishedAt: '',
        path: '新教务系统 › 教务通知 › 调停课通知'
      });
    }
    return out.slice(0, 20);
  }

  /* ---------- 去重 ---------- */
  function dedupe(list) {
    var seen = {}, out = [];
    list.forEach(function (c) {
      var k = [c.name, c.teacher, c.room, c.day, c.start, c.from, c.to].join('|');
      if (seen[k]) return; seen[k] = 1; out.push(c);
    });
    return out;
  }

  /* ---------- 复制到剪贴板 ---------- */
  function copyText(text, ta) {
    try {
      if (ta) { ta.focus(); ta.select(); }
      if (D.execCommand && D.execCommand('copy')) return true;
    } catch (e) { /* ignore */ }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  /* ---------- 结果面板（全部用行内样式，不去污染学校页面的样式） ---------- */
  function panel(json, stats, warnings, courses, notices) {
    var old = D.getElementById('wzuHubGrabber');
    if (old) old.parentNode.removeChild(old);

    var box = D.createElement('div');
    box.id = 'wzuHubGrabber';
    box.style.cssText = 'position:fixed;z-index:2147483647;right:16px;top:16px;width:min(560px,92vw);' +
      'max-height:88vh;overflow:auto;background:#101828;color:#F2F4F7;border-radius:14px;padding:16px 18px;' +
      'box-shadow:0 18px 50px rgba(16,24,40,.45);font:13px/1.6 -apple-system,Segoe UI,Microsoft YaHei,sans-serif;';

    var h = D.createElement('div');
    h.style.cssText = 'font-size:15px;font-weight:700;margin-bottom:8px;';
    h.textContent = '校园百事通 · 抓取完成';
    box.appendChild(h);

    var st = D.createElement('div');
    st.style.cssText = 'color:#D0D5DD;margin-bottom:10px;';
    st.textContent = '识别到课程 ' + stats.courses + ' 条（原始 ' + stats.raw + ' 条）· 调停课通知 ' + stats.notices +
      ' 条 · 数据来源：' + stats.source;
    box.appendChild(st);

    if (warnings.length) {
      var wn = D.createElement('div');
      wn.style.cssText = 'background:#3B1D1D;border:1px solid #912018;border-radius:8px;padding:8px 10px;margin-bottom:10px;color:#FDA29B;';
      wn.textContent = warnings.join('  ');
      box.appendChild(wn);
    }

    var ta = D.createElement('textarea');
    ta.readOnly = true;
    ta.value = json;
    ta.style.cssText = 'width:100%;height:190px;box-sizing:border-box;background:#0B1220;color:#C7D2FE;' +
      'border:1px solid #344054;border-radius:8px;padding:8px;font:12px/1.5 Consolas,Menlo,monospace;resize:vertical;';
    box.appendChild(ta);

    var bar = D.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;';
    function mkBtn(text, primary, fn) {
      var b = D.createElement('button');
      b.textContent = text;
      b.style.cssText = 'cursor:pointer;border-radius:8px;padding:7px 13px;font-size:13px;border:1px solid ' +
        (primary ? '#3A5BFF' : '#475467') + ';background:' + (primary ? '#3A5BFF' : 'transparent') +
        ';color:' + (primary ? '#fff' : '#D0D5DD') + ';';
      b.onclick = fn;
      bar.appendChild(b);
      return b;
    }
    mkBtn('复制 JSON', true, function () {
      ta.focus(); ta.select();
      var done = copyText(json, ta);
      this.textContent = done ? '✓ 已复制到剪贴板' : '复制失败，请手动 Ctrl+C';
    });
    mkBtn('全选', false, function () { ta.focus(); ta.select(); });
    mkBtn('下载 .json', false, function () {
      var blob = new Blob([json], { type: 'application/json' });
      var a = D.createElement('a');
      a.download = 'wzu-edu-import.json';
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    });
    mkBtn('关闭', false, function () { box.parentNode.removeChild(box); });
    box.appendChild(bar);

    var tip = D.createElement('div');
    tip.style.cssText = 'color:#98A2B3;margin-top:10px;';
    tip.textContent = '下一步：回到「校园百事通」→ 我的 → 账号与教务绑定 → 导入真实课表 → 把上面这段粘进去。';
    box.appendChild(tip);
    if (courses.length) {
      var det = D.createElement('details');
      det.style.cssText = 'margin-top:10px;color:#D0D5DD;';
      var sm = D.createElement('summary');
      sm.textContent = '展开看看抓到了什么';
      sm.style.cursor = 'pointer';
      det.appendChild(sm);
      var pre = D.createElement('div');
      pre.style.cssText = 'margin-top:6px;font:12px/1.5 Consolas,Menlo,monospace;color:#98A2B3;white-space:pre-wrap;';
      pre.textContent = courses.slice(0, 60).map(function (c) {
        return '周' + '一二三四五六日'.charAt(c.day - 1) + ' 第' + c.start + '-' + (c.start + c.span - 1) + '节  ' +
          c.name + '  ' + (c.teacher || '—') + '  ' + c.room + '  ' + c.from + '-' + c.to + '周';
      }).join('\n') + (notices.length ? '\n\n· 另抓到调停课通知 ' + notices.length + ' 条' : '');
      det.appendChild(pre);
      box.appendChild(det);
    }

    D.body.appendChild(box);

    /* 面板真正挂到页面上之后，再尝试自动复制一次
       （textarea 还没进 DOM 时 select() 是无效的） */
    setTimeout(function () {
      if (copyText(json, ta) && bar.firstChild) bar.firstChild.textContent = '✓ 已复制到剪贴板';
    }, 60);
  }

  /* ---------- 主流程 ---------- */
  var warn = [];
  probeApis().then(function (apiList) {
    var dom = grabFromDom();
    var courses = [];
    var source = '';
    if (apiList && apiList.length) {
      courses = fromApiList(apiList);
      source = '教务系统课表接口（同源直取）';
      if (!courses.length) { warn.push('接口有返回但字段没认出来，已改用页面解析。'); apiList = null; }
    }
    if (!courses.length && dom.courses.length) {
      courses = dom.courses;
      source = '当前课表页面解析';
    }
    if (!courses.length && !dom.courses.length) {
      var t = grabFromText();
      if (t.length) { courses = t; source = '全页文字扫描（结果可能不全，请仔细核对）'; }
    }
    if (!courses.length) {
      warn.push('没能自动认出课表。请在课表页面按 Ctrl+A 全选、Ctrl+C 复制，回到校园百事通用「文本粘贴」方式导入。');
    }
    if (dom.unknown.length) warn.push('有 ' + dom.unknown.length + ' 段页面内容没解析出来，导入后可在预览里手工补。');

    courses = dedupe(courses);
    var notices = grabNotices();

    var payload = {
      kind: 'wzu-campus-hub/edu-import',
      version: 1,
      grabbedAt: new Date().toISOString(),
      source: { url: location.href, title: D.title, host: location.host, page: source },
      courses: courses,
      notices: notices,
      unknown: dom.unknown,
      warnings: warn.slice()
    };

    panel(JSON.stringify(payload, null, 2),
      { courses: courses.length, raw: dom.courses.length || courses.length, notices: notices.length, source: source || '无' },
      warn, courses, notices);
  })['catch'](function (e) {
    panel(JSON.stringify({ kind: 'wzu-campus-hub/edu-import', version: 1, courses: [], notices: [] }, null, 2),
      { courses: 0, raw: 0, notices: 0, source: '失败' },
      ['脚本执行出错：' + (e && e.message ? e.message : e)], [], []);
  });
})();
