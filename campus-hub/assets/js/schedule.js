/* ==========================================================
   智能课表
   ========================================================== */
(function () {
  if (!Store.requireAuth()) return;   // 未登录 → 回登录页
  var page = UI.mount({ page: 'schedule' });
  page.classList.add('schedule-page');
  var db = Store.load();
  var wi = UI.weekInfo();
  var cur = wi.week;          // 当前查看的周次
  var MAXW = 20;
  var COLORS = ['#3A5BFF', '#7A5CFF', '#00A6B8', '#F79009', '#12B76A', '#E5484D', '#8E4EC6', '#2563EB'];
  var SLOT_H = 58;
  /* 已确认的课程调整在课表上保留标记。 */
  var ADJ_TAG = { move: '调', make: '补', cancel: '停', room: '换' };

  /* 生效课表：原始课表叠加「学生已确认的调课调整」（由 Store.coursesOn 计算，不改原数据） */
  function coursesOf(day) {
    return Store.coursesOn(day, cur);
  }

  /* ---------- 空课表提示：与首页保持同一视觉样式 ---------- */
  function welcomeCard() {
    if (db.courses.length) return '';
    return '<div class="card home-course-alert" role="status">' +
      '<span class="home-course-alert-icon" aria-hidden="true">📅</span>' +
      '<div><b>暂无课表</b><small>可在首页右侧校园 AI 助手输入课程信息，或点击「📄 PDF」上传课表，核对后即可添加。</small></div>' +
    '</div>';
  }

  function render() {
    var isThisWeek = cur === wi.week;
    var today = isThisWeek ? wi.weekday : 0;

    var head = UI.head({
      title: '智能课表',
      sub: '2026-2027 学年第一学期 · 共 ' + db.courses.length + ' 门课 · 学期起始日 ' + db.user.termStart +
        (db.imported ? ' · 已导入真实课表 ' + db.imported.courses + ' 条' : ''),
      actions: '<button class="btn" id="impCourse">⇩ 导入真实课表</button>' +
        '<button class="btn btn-primary" id="addCourse">＋ 添加课程</button>'
    });

    var weekBar =
      '<div class="card pad-sm week-bar">' +
        '<button class="icon-btn" id="prevW">←</button>' +
        '<b style="font-size:15px">第 ' + cur + ' 教学周</b>' +
        (isThisWeek ? '<span class="badge badge-green">本周</span>' : '<button class="btn btn-sm" id="backW">回到本周</button>') +
        '<button class="icon-btn" id="nextW">→</button>' +
        '<div class="spacer"></div>' +
        '<span style="font-size:12.5px;color:var(--muted)">' +
          (cur * 1 > 16 ? '已进入复习周 ⏰' : '距离期末还有 ' + Math.max(0, 18 - cur) + ' 周') +
        '</span>' +
      '</div>';

    /* 表头 */
    var ttHead = '<div class="tt-head"><div>节次</div>' +
      [1, 2, 3, 4, 5, 6, 7].map(function (d) {
        return '<div class="' + (d === today ? 'today' : '') + '">' + UI.weekdayName(d) + (d === today ? ' ·今日' : '') + '</div>';
      }).join('') + '</div>';

    /* 网格行数跟随作息表，包含晚间第 11~13 节。 */
    var ROWS = UI.BELLS.length;
    db.courses.forEach(function (c) {
      ROWS = Math.max(ROWS, (parseInt(c.start, 10) || 1) + (parseInt(c.span, 10) || 1) - 1);
    });

    /* 时间列：上行开始、下行下课（对齐学校作息表） */
    var times = '<div class="tt-times">';
    for (var r = 1; r <= ROWS; r++) {
      var st = UI.BELLS[r - 1], en = UI.BELL_ENDS[r - 1];
      times += '<div><b>' + r + '</b>' +
        (st ? '<span>' + st + '</span><span class="end">' + (en || '') + '</span>' : '') + '</div>';
    }
    times += '</div>';

    /* 每天一列 */
    var cols = [1, 2, 3, 4, 5, 6, 7].map(function (d) {
      var slots = '';
      for (var i = 0; i < ROWS; i++) slots += '<div class="slot"></div>';
      var blocks = coursesOf(d).map(function (c) {
        return '<div class="tt-course" data-id="' + c.id + '" style="top:' + ((c.start - 1) * SLOT_H + 3) + 'px;height:' + (c.span * SLOT_H - 6) +
          'px;background:linear-gradient(150deg,rgba(255,255,255,.22),rgba(0,0,0,.16)),' + c.color + '">' +
          '<b>' + UI.esc(c.name) + '</b>' +
          '<small>@' + UI.esc(c.room) + '</small>' +
          (c.span >= 2 ? '<small>' + UI.esc(c.teacher) + '</small>' : '') +
          (c.adjusted ? '<span class="tt-adj">调</span>' : '') +
        '</div>';
      }).join('');
      return '<div class="tt-day ' + (d === today ? 'today-col' : '') + '">' + slots + blocks + '</div>';
    }).join('');

    page.innerHTML = head +
      weekBar +
      welcomeCard() +
      '<div class="tt-scroll"><div class="tt">' + ttHead + '<div class="tt-body">' + times + cols + '</div></div></div>';

    bind();
  }

  /* ---------- 事件 ---------- */
  function bind() {
    UI.qs('#prevW').onclick = function () { cur = Math.max(1, cur - 1); render(); };
    UI.qs('#nextW').onclick = function () { cur = Math.min(MAXW, cur + 1); render(); };
    var back = UI.qs('#backW');
    if (back) back.onclick = function () { cur = wi.week; render(); };
    UI.qs('#addCourse').onclick = openAdd;

    /* 用户选择课表 PDF 后，本地识别并确认导入。 */
    var imp = UI.qs('#impCourse');
    if (imp) imp.onclick = openImport;

    UI.delegate(page, 'click', '.tt-course', function (e, t) { openDetail(t.getAttribute('data-id')); });
  }

  function openImport() {
    if (typeof ImportEdu === 'undefined') { UI.toast('导入模块未加载', 'err'); return; }
    ImportEdu.open({
      onDone: function (r) {
        db = Store.load();
        UI.toast('已导入 ' + r.courses + ' 条真实课程', 'ok');
        render();
      }
    });
  }

  function openDetail(id) {
    var c = db.courses.filter(function (x) { return x.id === id; })[0];
    if (!c) {
      /* AI 调整生成的新课，不是课表里的原始课程。 */
      var a = (typeof Adjust !== 'undefined')
        ? Adjust.list().filter(function (x) { return 'adj-' + x.no === id; })[0] : null;
      if (a) UI.toast('这是已确认的课程调整：' + Adjust.oneLine(a), 'ok');
      return;
    }
    UI.modal({
      title: '课程详情',
      body: '<div style="border-radius:14px;padding:16px;color:#fff;background:linear-gradient(150deg,rgba(255,255,255,.2),rgba(0,0,0,.18)),' + c.color + '">' +
          '<h3 style="font-size:18px">' + UI.esc(c.name) + '</h3>' +
          '<div style="opacity:.92;font-size:13px;margin-top:6px">' + UI.esc(c.teacher) + ' · ' + UI.esc(c.room) + '</div></div>' +
        '<div style="margin-top:14px">' +
          detail('上课时间', UI.weekdayName(c.day) + ' 第 ' + c.start + '-' + (c.start + c.span - 1) + ' 节（' + UI.bellRange(c.start, c.span) + '）') +
          detail('起止周次', '第 ' + c.from + ' – ' + c.to + ' 周') +
          detail('每节时长', c.span + ' 节连堂') +
        '</div>',
      footer: '<button class="btn" data-close>关闭</button><button class="btn btn-danger" data-del>删除课程</button>',
      onMount: function (body, close) {
        UI.qs('[data-del]', document.getElementById('modalRoot')).onclick = function () {
          UI.confirm('确定删除《' + c.name + '》吗？删除后不可恢复。', '删除').then(function (ok) {
            if (!ok) return;
            db.courses = db.courses.filter(function (x) { return x.id !== id; });
            Store.save();
            close();
            UI.toast('已删除该课程', 'ok');
            render();
          });
        };
      }
    });
  }

  function detail(label, val) {
    return '<div class="list-row"><div class="main"><b style="color:var(--muted);font-weight:600;font-size:12.5px">' + label + '</b>' +
      '<div style="font-size:14px">' + UI.esc(val) + '</div></div></div>';
  }

  function openAdd() {
    var dayOpts = [1, 2, 3, 4, 5, 6, 7].map(function (d) {
      return '<option value="' + d + '"' + (d === wi.weekday ? ' selected' : '') + '>' + UI.weekdayName(d) + '</option>'; }).join('');
    var startOpts = UI.BELLS.map(function (t, i) {
      return '<option value="' + (i + 1) + '">第 ' + (i + 1) + ' 节 · ' + UI.bellRange(i + 1, 1) + '</option>'; }).join('');
    var spanOpts = [1, 2, 3, 4].map(function (s) {
      return '<option value="' + s + '"' + (s === 2 ? ' selected' : '') + '>' + s + ' 节连堂</option>'; }).join('');

    UI.modal({
      title: '添加课程',
      body:
        '<div class="edu-cta" style="margin-bottom:14px">' +
          '<div class="edu-cta-head"><span class="edu-cta-ico">🔗</span><div>' +
            '<b>课表在「温州大学统一身份认证 → ' + Store.EDU_NEW_SYS + '」里</b>' +
            '<small>不用一格格手敲：先到统一身份认证登录（学号密码 / 验证码由你本人完成），进新教务系统打开「我的课表」，' +
            '再用「导入真实课表」把整学期一次拉回来。下面这门课也可以手动补录。</small>' +
          '</div></div>' +
          '<div class="ie-tools">' +
            '<a class="btn btn-sm btn-primary" href="' + Store.EDU_LOGIN_URL + '" target="_blank" rel="noopener">↗ 打开统一身份认证</a>' +
            '<button class="btn btn-sm" id="cGoImport">⇩ 我这就去导入课表</button>' +
            '<span class="ie-hint">' + Store.EDU_LOGIN_URL + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="field"><label>课程名称 *</label><input class="input" id="cName" placeholder="例如：数据结构"></div>' +
        '<div class="row" style="gap:12px">' +
          '<div class="field" style="flex:1;min-width:150px"><label>任课教师</label><input class="input" id="cTeacher" placeholder="陈 立"></div>' +
          '<div class="field" style="flex:1;min-width:150px"><label>上课教室</label><input class="input" id="cRoom" placeholder="计算机楼-408"></div>' +
        '</div>' +
        '<div class="row" style="gap:12px">' +
          '<div class="field" style="flex:1;min-width:110px"><label>星期</label><select class="select" id="cDay">' + dayOpts + '</select></div>' +
          '<div class="field" style="flex:1;min-width:150px"><label>开始节次</label><select class="select" id="cStart">' + startOpts + '</select></div>' +
          '<div class="field" style="flex:1;min-width:120px"><label>连堂节数</label><select class="select" id="cSpan">' + spanOpts + '</select></div>' +
        '</div>' +
        '<div class="row" style="gap:12px">' +
          '<div class="field" style="flex:1"><label>起始周</label><input class="input" id="cFrom" type="number" min="1" max="20" value="1"></div>' +
          '<div class="field" style="flex:1"><label>结束周</label><input class="input" id="cTo" type="number" min="1" max="20" value="16"></div>' +
        '</div>' +
        '<div class="field"><label>课程颜色</label><div class="chips" id="cColors">' +
          COLORS.map(function (c, i) {
            return '<span class="chip" data-color="' + c + '" style="background:' + c + ';border-color:transparent;width:34px;height:34px;padding:0' +
              (i === 0 ? ';outline:3px solid #C9D6EE;outline-offset:2px' : '') + '"></span>';
          }).join('') + '</div></div>',
      footer: '<button class="btn" data-close>取消</button><button class="btn btn-primary" id="cSave">保存课程</button>',
      onMount: function (body, close) {
        var color = COLORS[0];
        var startSelect = UI.qs('#cStart', body), spanSelect = UI.qs('#cSpan', body);
        function updateSpanOptions() {
          var max = Math.min(4, UI.BELLS.length - Number(startSelect.value) + 1);
          var selected = Math.min(Number(spanSelect.value) || 2, max);
          spanSelect.innerHTML = Array.from({ length: max }, function (_, i) {
            return '<option value="' + (i + 1) + '">' + (i + 1) + ' 节连堂</option>';
          }).join('');
          spanSelect.value = String(selected);
        }
        startSelect.onchange = updateSpanOptions;
        updateSpanOptions();
        var goImp = UI.qs('#cGoImport', body);
        if (goImp) goImp.onclick = function () { close(); openImport(); };
        UI.qsa('.chip', body).forEach(function (el) {
          el.onclick = function () {
            UI.qsa('.chip', body).forEach(function (x) { x.style.outline = 'none'; });
            el.style.outline = '3px solid #C9D6EE';
            el.style.outlineOffset = '2px';
            color = el.getAttribute('data-color');
          };
        });
        UI.qs('#cSave', body).onclick = function () {
          var name = UI.qs('#cName').value.trim();
          if (!name) { UI.toast('请填写课程名称', 'err'); return; }
          var from = parseInt(UI.qs('#cFrom').value, 10) || 1;
          var to = parseInt(UI.qs('#cTo').value, 10) || 16;
          var start = Number(startSelect.value), span = Number(spanSelect.value);
          if (start + span - 1 > UI.BELLS.length) { UI.toast('课程超出当天节次，请调整连堂节数', 'err'); return; }
          if (to < from) { var t = from; from = to; to = t; }
          db.courses.push({
            id: Store.uid('c'), name: name,
            teacher: UI.qs('#cTeacher').value.trim() || '未填写',
            room: UI.qs('#cRoom').value.trim() || '待定',
            day: parseInt(UI.qs('#cDay').value, 10),
            start: start,
            span: span,
            from: Math.max(1, from), to: Math.min(20, to), color: color
          });
          Store.save();
          close();
          UI.toast('已添加到课表', 'ok');
          render();
        };
      }
    });
  }

  render();
})();
