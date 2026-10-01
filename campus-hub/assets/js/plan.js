/* ==========================================================
   今日规划页
   把课程 / 作业 DDL / 课外计划合成一份当天的安排
   ========================================================== */
(function () {
  if (!Store.requireAuth()) return;   // 未登录 → 回登录页
  var page = UI.mount({ page: 'plan' });
  page.classList.add('plan-page');
  var db = Store.load();
  var plan = Planner.build(null);

  var TEMPLATES = [
    { t: '背 30 个单词', type: '学习', start: '22:00', end: '22:30', place: '宿舍', level: 2, weekly: true },
    { t: '操场夜跑 3 公里', type: '运动', start: '20:45', end: '21:30', place: '北校区田径场', level: 2, weekly: true },
    { t: '图书馆自习', type: '学习', start: '19:00', end: '21:00', place: '图书馆三楼', level: 3, weekly: false },
    { t: '社团例会', type: '社团', start: '15:00', end: '17:00', place: '计算机楼-412', level: 3, weekly: true },
    { t: '整理错题本', type: '学习', start: '14:30', end: '15:30', place: '宿舍', level: 2, weekly: false },
    { t: '约球 / 打羽毛球', type: '运动', start: '10:00', end: '11:30', place: '北校区体育馆', level: 1, weekly: false }
  ];

  /* ---------- 统计 ---------- */
  function miniStats() {
    var c = plan.counts;
    var items = [
      { n: c.courses, l: '📚 今日课程', cls: '' },
      { n: c.dueToday, l: '⏳ 今天截止', cls: c.dueToday ? 'warn' : '' },
      { n: c.overdue, l: '⚠️ 已逾期', cls: c.overdue ? 'warn' : 'good' },
      { n: c.dueSoon, l: '📌 3 天内截止', cls: 'blue' },
      { n: c.plansLeft, l: '🧭 待办计划', cls: 'blue' },
      { n: c.hwDone, l: '✅ 已完成作业', cls: 'good' }
    ];
    return '<div class="mini-stats">' + items.map(function (x) {
      return '<div class="mini ' + x.cls + '"><div class="n">' + x.n + '</div><div class="l">' + x.l + '</div></div>';
    }).join('') + '</div>';
  }

  /* 三栏独立展示，共用任务数据与添加表单。 */
  function todoSection() {
    return '<div class="sec-title"><span class="bar"></span>待办清单' +
      '<button class="btn btn-sm btn-primary more" data-add-task="todo">＋ 添加任务</button></div>' +
      '<p class="plan-task-hint">学业任务与作业 · 逾期、高、中、低</p>' +
      '<div class="plan-overview">' + miniStats() + '</div>' + Planner.priorityHtml(plan, null, true);
  }
  function timelineSection() {
    return '<div class="sec-title"><span class="bar"></span>今日时间轴' +
      '<span class="more plan-auto-label">自动生成</span></div>' +
      '<p class="plan-task-hint timeline-scroll-hint">根据当天课程、待办和课外计划自动生成 · 支持滚轮滚动</p>' + Planner.timelineHtml(plan);
  }

  /* ---------- 我的课外计划 ---------- */
  var pFilter = 'all';        // 类型筛选
  var onlyTodo = false;       // 只看未完成
  var DAY_WINDOW = 7;         // 页面按未来 7 天为轴排布（每周重复的计划会逐天出现）

  var TYPE_FILTERS = [
    ['all', '全部'], ['运动', '🏃 运动'],
    ['社团', '🎪 社团'], ['生活', '🛒 生活'], ['社交', '👥 社交'], ['其他', '✨ 其他']
  ];

  function weekdayOf(key) {
    var d = new Date(key + 'T00:00:00');
    return d.getDay() === 0 ? 7 : d.getDay();
  }

  function byStart(a, b) {
    var am = a.start ? UI.toMin(a.start) : 24 * 60, bm = b.start ? UI.toMin(b.start) : 24 * 60;
    return am - bm;
  }

  /* 某条计划在某个「发生日」是否通过当前筛选（每周重复的计划要按发生日判断完成状态） */
  function matchFilter(p, occKey) {
    if(Store.isAcademicTask(p))return false;
    if (pFilter !== 'all' && (p.type || '其他') !== pFilter) return false;
    if (onlyTodo && Planner.isPlanDone(p, occKey)) return false;
    return true;
  }

  /* 未来 7 天 + 窗口外的「更远 / 已过去 / 无固定日期」 */
  function groupPlans() {
    var out = [];
    var seen = {};
    var i, off, key, wd, items;

    for (off = 0; off < DAY_WINDOW; off++) {
      key = UI.dayKey(new Date(Date.now() + off * 86400000));
      wd = weekdayOf(key);
      items = (db.plans || []).filter(function (p) {
        return Planner.planOnDay(p, key, wd) && matchFilter(p, key);
      });
      if (!items.length) continue;
      items.forEach(function (p) { seen[p.id + '@' + key] = 1; });
      items.sort(byStart);
      out.push({
        occKey: key,
        label: off === 0 ? '今天' : off === 1 ? '明天' : off === 2 ? '后天' : UI.weekdayName(wd),
        date: key,
        items: items
      });
    }

    var todayK = UI.dayKey();
    var rest = (db.plans || []).filter(function (p) { return !seen[p.id + '@' + todayK]; });
    /* 已被窗口收进去的不再重复出现在「更远 / 已过去」里 */
    var covered = {};
    out.forEach(function (g) {
      g.items.forEach(function (p) {
        if (p.repeat !== 'weekly' && p.date === g.occKey) covered[p.id] = 1;
      });
    });
    rest = rest.filter(function (p) { return !covered[p.id] && matchFilter(p, p.date || todayK); });

    [['更远', function (p) { return p.date && p.date > todayK; }],
     ['无固定日期', function (p) { return !p.date; }],
     ['已过去', function (p) { return p.date && p.date < todayK; }]].forEach(function (pair) {
      var arr = rest.filter(pair[1]);
      if (!arr.length) return;
      arr.sort(byStart);
      out.push({ occKey: '', label: pair[0], date: '', items: arr });
    });
    return out;
  }

  /* 今天的计划完成进度 */
  function todayProgress() {
    var key = UI.dayKey();
    var wd = weekdayOf(key);
    var items = (db.plans || []).filter(function (p) { return !Store.isAcademicTask(p)&&Planner.planOnDay(p, key, wd); });
    var done = items.filter(function (p) { return Planner.isPlanDone(p, key); });
    return { total: items.length, done: done.length };
  }

  function planRow(p, occKey) {
    var isWeekly = p.repeat === 'weekly';
    var done = Planner.isPlanDone(p, occKey || p.date);
    var t = p.start
      ? '<div class="plan-time">' + UI.esc(p.start) + '<small>' + UI.esc(p.end || '') + '</small></div>'
      : '<div class="plan-time any">全天</div>';
    var lv = UI.LEVELS[p.level || 2];
    return '<div class="plan-item' + (done ? ' done' : '') + '">' + t +
      '<div class="plan-main">' +
        '<div class="plan-title">' + Planner.typeIco(p.type) + ' ' + UI.esc(p.title) +
          ' <span class="badge ' + lv.cls + '">' + lv.t + '</span>' +
          (isWeekly ? ' <span class="badge badge-blue">每周' + UI.weekdayName(weekdayOf(p.date)) + '</span>' : '') +
          (done ? ' <span class="badge badge-green">已完成</span>' : '') +
        '</div>' +
        '<div class="plan-sub">' + UI.esc(p.type || '计划') +
          (p.place ? ' · ' + UI.esc(p.place) : '') +
          (p.note ? ' · ' + UI.esc(p.note) : '') +
        '</div>' +
      '</div>' +
      '<span class="ck' + (done ? ' on' : '') + '" data-toggle="' + p.id + '" data-day="' + UI.esc(occKey || p.date || '') + '" title="标记完成 / 取消">✓</span>' +
      '<div class="hw-acts"><button class="btn btn-sm" data-edit="' + p.id + '">编辑</button>' +
      '<button class="btn btn-sm btn-danger" data-del="' + p.id + '">删除</button></div>' +
    '</div>';
  }

  function myPlansSection() {
    var groups = groupPlans();
    var prog = todayProgress();
    var total = (db.plans || []).filter(function(p){return !Store.isAcademicTask(p);}).length;
    var shown = groups.reduce(function (n, g) { return n + g.items.length; }, 0);

    var body = '';
    groups.forEach(function (g) {
      body += '<div class="day-group">' +
        '<div class="day-head"><span class="bar"></span>' +
          g.label +
          '<span class="badge badge-grey">' + g.items.length + ' 项</span>' +
          (g.date ? '<span class="dh-date">' + UI.esc(g.date) + '</span>' : '') +
        '</div>' + g.items.map(function (p) { return planRow(p, g.occKey); }).join('') + '</div>';
    });
    if (!shown) {
      body = '<div class="empty"><div class="e">🧭</div>' +
        '<p>' + (total ? '这个筛选下没有计划，换个条件看看？' : '还没有课外计划，先建一条试试～') + '</p>' +
        '<button class="btn btn-primary" id="addPlanEmpty" style="margin-top:16px">＋ 新建课外计划</button></div>';
    } else {
      body += '<button class="btn btn-dashed" id="addPlanFoot">＋ 继续添加计划</button>';
    }

    var bar = '<div class="plan-prog">' +
      '<div class="pp-head"><b>今天完成进度</b>' +
        '<span>' + prog.done + ' / ' + prog.total + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' +
        (prog.total ? Math.round(prog.done / prog.total * 100) : 0) + '%"></div></div>' +
      '<div class="pp-tip">' + (prog.total
        ? (prog.done === prog.total ? '今天的计划全部完成，厉害 🎉' : '还剩 ' + (prog.total - prog.done) + ' 项，加油！')
        : '今天还没有安排计划') + '</div>' +
    '</div>';

    return '<div class="sec-title"><span class="bar"></span>我的课外计划' +
        '<button type="button" class="btn btn-sm btn-primary more" id="addPlanLink">＋ 新建计划</button></div>' +
      bar +
      '<div class="chips-bar">' +
        TYPE_FILTERS.map(function (f) {
          return '<span class="chip' + (f[0] === pFilter ? ' on' : '') + '" data-pfilter="' + f[0] + '">' + f[1] + '</span>';
        }).join('') +
        '<span class="chip' + (onlyTodo ? ' on' : '') + '" data-todo="1">' + (onlyTodo ? '☑' : '☐') + ' 只看未完成</span>' +
      '</div>' +
      '<div class="card">' + body + '</div>';
  }

  /* ---------- 组装 / 绘制 ---------- */
  function build() {
    return UI.head({
      title: '今日规划',
      sub: '课程 · 作业 DDL · 课外计划，合成一张今日作战图'
    }) + '<div class="plan-workspace">' +
      '<section class="card plan-pane plan-pane-timeline" tabindex="0" aria-label="今日时间轴">' + timelineSection() + '</section>' +
      '<section class="card plan-pane plan-pane-todo" tabindex="0" aria-label="待办清单">' + todoSection() + '</section>' +
      '<section class="card plan-pane plan-pane-right" tabindex="0" aria-label="课外计划">' + myPlansSection() + '</section></div>';
  }

  function render() {
    var positions = UI.qsa('.plan-pane').map(function (pane) { return pane.scrollTop; });
    db = Store.load();
    plan = Planner.build(null);
    page.innerHTML = build();
    bind();
    UI.qsa('.plan-pane').forEach(function (pane, i) { pane.scrollTop = positions[i] || 0; });
  }

  /* ---------- 新建 / 编辑计划 ---------- */
  function bellEnd(start, span) {
    return UI.bellEnd((start - 1) + Math.max(1, parseInt(span, 10) || 1));
  }

  /* 目标日期落在第几教学周（用于取「当周生效课表」） */
  function weekOf(dateKey) {
    var wi = UI.weekInfo();
    var days = Math.round((new Date(dateKey + 'T00:00:00') - new Date(UI.dayKey() + 'T00:00:00')) / 86400000);
    return wi.week + Math.floor((wi.weekday - 1 + days) / 7);
  }

  /* 和当周课程、已有计划的时间冲突 */
  function conflictsFor(dateKey, start, end, excludeId) {
    var out = [];
    if (!dateKey || !start || !end) return out;
    var s = UI.toMin(start), e = UI.toMin(end);
    if (e <= s) return out;
    var wd = weekdayOf(dateKey);

    (Store.coursesOn(wd, weekOf(dateKey)) || []).forEach(function (c) {
      var cs = UI.toMin(UI.BELLS[c.start - 1]), ce = UI.toMin(bellEnd(c.start, c.span));
      if (s < ce && cs < e) {
        out.push('📚 ' + c.name + ' ' + UI.BELLS[c.start - 1] + '–' + bellEnd(c.start, c.span) + '（' + c.room + '）');
      }
    });
    (db.plans || []).forEach(function (x) {
      if (x.id === excludeId || !x.start || !x.end) return;
      if (!Planner.planOnDay(x, dateKey, wd)) return;
      var xs = UI.toMin(x.start), xe = UI.toMin(x.end);
      if (s < xe && xs < e) out.push(Planner.typeIco(x.type) + ' ' + x.title + ' ' + x.start + '–' + x.end);
    });
    return out;
  }

  function openForm(id, asTask) {
    var p = id ? (db.plans || []).filter(function (x) { return x.id === id; })[0] : null;
    var model = p ? JSON.parse(JSON.stringify(p)) : {
      title: '', type: asTask?'学习':'生活', date: UI.dayKey(), start: '', end: '', place: '', level: 2, repeat: 'none', note: ''
    };

    var typeChips = Planner.TYPES.map(function (t) {
      return '<span class="chip' + (t === model.type ? ' on' : '') + '" data-type="' + t + '">' + Planner.typeIco(t) + ' ' + t + '</span>';
    }).join('');
    var lvChips = [1, 2, 3].map(function (l) {
      return '<span class="chip lv' + l + (l === model.level ? ' on' : '') + '" data-level="' + l + '">' +
        UI.LEVELS[l].t + '优先级</span>';
    }).join('');
    var tplChips = TEMPLATES.map(function (t, i) {
      return '<span class="chip" data-tpl="' + i + '">' + t.t + '</span>';
    }).join('');

    UI.modal({
      title: p ? (Store.isAcademicTask(p)?'编辑学业任务':'编辑课外计划') : (asTask ? '添加学业任务' : '新建课外计划'),
      body:
        '<div class="field" id="fPTitle"><label>计划内容 *</label><input class="input" id="pTitle" placeholder="例如：图书馆自习 2 小时" value="' + UI.esc(model.title) + '"><div class="f-err" id="ePTitle"></div></div>' +
        '<div class="field"><label>类型</label><div class="chips" id="pTypes">' + typeChips + '</div></div>' +
        '<div class="row" style="gap:12px">' +
          '<div class="field" style="flex:1;min-width:140px"><label id="pDateLabel">日期</label><input class="input" id="pDate" type="date" value="' + UI.esc(model.date) + '"></div>' +
          '<div class="field" style="flex:1;min-width:110px"><label>开始时间</label><input class="input" id="pStart" type="time" value="' + UI.esc(model.start) + '"></div>' +
          '<div class="field" style="flex:1;min-width:110px"><label>结束时间</label><input class="input" id="pEnd" type="time" value="' + UI.esc(model.end) + '"></div>' +
        '</div>' +
        '<div class="f-err" id="ePTime" style="margin:-6px 0 12px"></div>' +
        '<div id="pConflict"></div>' +
        '<div class="field"><label>地点</label><input class="input" id="pPlace" placeholder="图书馆三楼 / 北校区体育馆" value="' + UI.esc(model.place) + '"></div>' +
        '<div class="field"><label>重要度</label><div class="chips level-pick" id="pLevels">' + lvChips + '</div></div>' +
        '<label class="check" style="margin-bottom:12px"><input type="checkbox" id="pWeekly"' + (model.repeat === 'weekly' ? ' checked' : '') + '><span>每周同一时间重复</span></label>' +
        '<div class="field"><label>备注</label><textarea class="textarea" id="pNote" placeholder="想提醒自己的话">' + UI.esc(model.note) + '</textarea></div>' +
        '<div class="field" style="margin-bottom:0"><label>常用模板（点一下自动填）</label><div class="chips">' + tplChips + '</div></div>' +
        '<div class="form-hint" id="pWeeklyHint">按 <b>Ctrl + Enter</b> 可直接保存</div>',
      footer: '<button class="btn" data-close>取消</button>' +
        (p ? '<button class="btn btn-danger" id="pDel">删除</button>' : '') +
        '<button class="btn btn-primary" id="pSave">' + (p ? '保存修改' : '创建计划') + '</button>',
      onMount: function (scope, close) {
        var cur = { type: model.type, level: model.level };

        function bad(fid, eid, msg) {
          var f = UI.qs('#' + fid, scope);
          if (f) f.classList.add('bad');
          var e = UI.qs('#' + eid, scope);
          if (e) e.textContent = msg;
        }
        function clearBad() {
          UI.qsa('.field.bad', scope).forEach(function (f) { f.classList.remove('bad'); });
          UI.qsa('.f-err', scope).forEach(function (e) { e.textContent = ''; });
        }
        ['#pTitle', '#pStart', '#pEnd'].forEach(function (sel) {
          var el = UI.qs(sel, scope);
          if (el) el.addEventListener('input', clearBad);
        });

        function curDate() { return UI.qs('#pDate', scope).value || UI.dayKey(); }

        /* 实时冲突检查：填完时间就能看到会不会撞课 / 撞别的计划 */
        function checkConflict() {
          var box = UI.qs('#pConflict', scope);
          if (!box) return;
          var start = UI.qs('#pStart', scope).value;
          var end = UI.qs('#pEnd', scope).value;
          if (!start || !end || UI.toMin(end) <= UI.toMin(start)) { box.innerHTML = ''; return; }
          var list = conflictsFor(curDate(), start, end, p ? p.id : null);
          box.innerHTML = list.length
            ? '<div class="tip warn"><div class="ti">⚠️</div><div class="tb"><b>这个时段已经有安排了</b><small>' +
              list.map(UI.esc).join('<br>') + '</small></div></div>'
            : '<div class="tip ok"><div class="ti">✅</div><div class="tb"><b>这段时间是空的</b><small>和当周课表、已有计划都不冲突。</small></div></div>';
        }

        function paintWeekly() {
          var on = UI.qs('#pWeekly', scope).checked;
          var lab = UI.qs('#pDateLabel', scope);
          if (lab) lab.textContent = on ? '首次日期' : '日期';
          var h = UI.qs('#pWeeklyHint', scope);
          if (!h) return;
          h.innerHTML = on
            ? '每周 <b>' + UI.weekdayName(weekdayOf(curDate())) + '</b> 重复，从 ' + UI.esc(curDate()) +
              ' 开始；每次的完成情况单独记录，打勾不会影响下一周。'
            : '按 <b>Ctrl + Enter</b> 可直接保存';
        }

        UI.qs('#pWeekly', scope).addEventListener('change', paintWeekly);
        ['#pDate', '#pStart', '#pEnd'].forEach(function (sel) {
          var el = UI.qs(sel, scope);
          if (el) { el.addEventListener('change', checkConflict); el.addEventListener('change', paintWeekly); }
        });
        paintWeekly();
        checkConflict();

        scope.addEventListener('click', function (e) {
          var t = e.target.closest('[data-type]');
          if (t) {
            cur.type = t.getAttribute('data-type');
            UI.qsa('[data-type]', scope).forEach(function (x) { x.classList.remove('on'); });
            t.classList.add('on');
            return;
          }
          var l = e.target.closest('[data-level]');
          if (l) {
            cur.level = parseInt(l.getAttribute('data-level'), 10);
            UI.qsa('[data-level]', scope).forEach(function (x) { x.classList.remove('on'); });
            l.classList.add('on');
            return;
          }
          var tp = e.target.closest('[data-tpl]');
          if (tp) {
            var tpl = TEMPLATES[parseInt(tp.getAttribute('data-tpl'), 10)];
            if (!tpl) return;
            UI.qs('#pTitle', scope).value = tpl.t;
            UI.qs('#pPlace', scope).value = tpl.place || '';
            UI.qs('#pStart', scope).value = tpl.start || '';
            UI.qs('#pEnd', scope).value = tpl.end || '';
            UI.qs('#pWeekly', scope).checked = !!tpl.weekly;
            cur.type = tpl.type; cur.level = tpl.level;
            UI.qsa('[data-type]', scope).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-type') === tpl.type); });
            UI.qsa('[data-level]', scope).forEach(function (x) { x.classList.toggle('on', parseInt(x.getAttribute('data-level'), 10) === tpl.level); });
            clearBad();
            paintWeekly();
            checkConflict();
          }
        });

        if (p) {
          UI.qs('#pDel', scope).onclick = function () {
            UI.confirm('确定删除「' + p.title + '」吗？', '删除').then(function (ok) {
              if (!ok) return;
              db.plans = db.plans.filter(function (x) { return x.id !== p.id; });
              Store.save(); close(); UI.toast('已删除该计划', 'ok'); render();
            });
          };
        }

        function commit() {
          var payload = {
            title: UI.qs('#pTitle', scope).value.trim(),
            type: cur.type,
            date: curDate(),
            start: UI.qs('#pStart', scope).value,
            end: UI.qs('#pEnd', scope).value,
            place: UI.qs('#pPlace', scope).value.trim(),
            level: cur.level,
            repeat: UI.qs('#pWeekly', scope).checked ? 'weekly' : 'none',
            note: UI.qs('#pNote', scope).value.trim()
          };
          payload.taskGroup=Store.classifyTask(payload);
          if (p) {
            Object.keys(payload).forEach(function (k) { p[k] = payload[k]; });
            UI.toast('计划已更新', 'ok');
          } else {
            payload.id = Store.uid('p');
            payload.status = 'todo';
            payload.createdAt = Date.now();
            db.plans.push(payload);
            UI.toast(payload.repeat === 'weekly'
              ? '已创建，每周' + UI.weekdayName(weekdayOf(payload.date)) + '都会提醒你'
              : (payload.taskGroup==='academic'?'已加入待办清单':'已加入课外计划'), 'ok');
          }
          Store.save();
          close();
          render();
        }

        function save() {
          clearBad();
          var titleEl = UI.qs('#pTitle', scope);
          if (!titleEl.value.trim()) {
            bad('fPTitle', 'ePTitle', '请填写计划内容，例如「图书馆自习 2 小时」');
            titleEl.focus();
            return;
          }
          var start = UI.qs('#pStart', scope).value;
          var end = UI.qs('#pEnd', scope).value;
          if ((start && !end) || (!start && end)) {
            bad('fPTime', 'ePTime', '开始和结束时间请成对填写，或者都留空表示全天');
            return;
          }
          if (start && end && UI.toMin(end) <= UI.toMin(start)) {
            bad('fPTime', 'ePTime', '结束时间要晚于开始时间');
            return;
          }
          commit();
        }

        UI.qs('#pSave', scope).onclick = save;
        UI.qs('#pTitle', scope).addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
        });
        scope.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
        });
      }
    });
  }

  /* ---------- 事件 ---------- */
  function bind() {
    UI.delegate(page, 'click', '[data-add-task]', function () { openForm(null, true); });
    ['#addPlanLink', '#addPlanEmpty', '#addPlanFoot'].forEach(function (sel) {
      var b = UI.qs(sel);
      if (b) b.onclick = function (e) { e.preventDefault(); openForm(); };
    });

    /* 每周重复的计划：完成状态按「哪一天」记，所以要带上发生日 */
    UI.delegate(page, 'click', '[data-toggle]', function (e, t) {
      var id = t.getAttribute('data-toggle');
      var day = t.getAttribute('data-day') || UI.dayKey();
      var p = (db.plans || []).filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      var wasDone = Planner.isPlanDone(p, day);
      if (p.repeat === 'weekly') {
        if (!p.doneOn) p.doneOn = {};
        if (wasDone) delete p.doneOn[day];
        else p.doneOn[day] = Date.now();
      } else {
        p.status = wasDone ? 'todo' : 'done';
      }
      Store.save();
      UI.toast(wasDone ? '已恢复为待办' : '完成啦 🎉', 'ok');
      render();
    });
    UI.delegate(page, 'click', '[data-edit]', function (e, t) { openForm(t.getAttribute('data-edit')); });
    UI.delegate(page, 'click', '[data-del]', function (e, t) {
      var id = t.getAttribute('data-del');
      var p = (db.plans || []).filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      UI.confirm('确定删除「' + p.title + '」吗？' + (p.repeat === 'weekly' ? '这是一条每周重复的计划。' : ''), '删除')
        .then(function (ok) {
          if (!ok) return;
          db.plans = db.plans.filter(function (x) { return x.id !== id; });
          Store.save(); UI.toast('已删除', 'ok'); render();
        });
    });
    UI.delegate(page, 'click', '[data-pfilter]', function (e, t) {
      pFilter = t.getAttribute('data-pfilter');
      render();
    });
    UI.delegate(page, 'click', '[data-todo]', function (e, t) {
      onlyTodo = !onlyTodo;
      render();
    });
    /* 优先级清单整行可点，跳到对应页面 */
    UI.delegate(page, 'click', '[data-prio]', function (e, t) {
      if (e.target.closest('a,button')) return;
      var parts = t.getAttribute('data-prio').split(':');
      location.href = parts[0] === 'homework' ? 'homework.html' : 'plan.html';
    });
  }

  render();

})();
