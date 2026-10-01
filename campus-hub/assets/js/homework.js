/* ==========================================================
   作业 DDL 管理
   录入每门课的作业截止时间、重要度、预计耗时；
   自动按紧急度排序，逾期高亮，完成后归档。
   （后续可从教务 / 班级群自动抓取，本页的 addHomework 就是接入点）
   ========================================================== */
(function () {
  if (!Store.requireAuth()) return;   // 未登录 → 回登录页
  var page = UI.mount({ page: 'homework' });
  var db = Store.load();
  var filter = 'all';
  var sort = 'urgent';

  var FILTERS = [
    ['all', '全部待完成'], ['today', '今天截止'], ['soon', '3 天内'],
    ['overdue', '已逾期'], ['done', '已完成']
  ];

  function courseColor(name) { return 'hsl(' + UI.hueOf(name || '其他') + ' 76% 55%)'; }

  function list() {
    var all = db.homeworks || [];
    var pending = all.filter(function (x) { return x.status !== 'done'; });
    var todayK = UI.dayKey();
    var arr;
    if (filter === 'done') arr = all.filter(function (x) { return x.status === 'done'; });
    else if (filter === 'overdue') arr = pending.filter(function (x) {
      var ts = UI.parseDT(x.due); return ts && UI.countdown(ts).late;
    });
    else if (filter === 'today') arr = pending.filter(function (x) {
      var ts = UI.parseDT(x.due); return ts && UI.dayKey(new Date(ts)) === todayK;
    });
    else if (filter === 'soon') arr = pending.filter(function (x) {
      var ts = UI.parseDT(x.due); return ts && !UI.countdown(ts).late && UI.countdown(ts).days <= 3;
    });
    else arr = pending;

    if (sort === 'due') {
      arr.sort(function (a, b) { return (UI.parseDT(a.due) || Infinity) - (UI.parseDT(b.due) || Infinity); });
    } else if (sort === 'level') {
      arr.sort(function (a, b) { return (b.level || 2) - (a.level || 2) || (UI.parseDT(a.due) || Infinity) - (UI.parseDT(b.due) || Infinity); });
    } else {
      arr.sort(function (a, b) { return Planner.scoreHw(b) - Planner.scoreHw(a); });
    }
    return arr;
  }

  function stats() {
    var all = db.homeworks || [];
    var pending = all.filter(function (x) { return x.status !== 'done'; });
    var todayK = UI.dayKey();
    var today = 0, soon = 0, late = 0;
    pending.forEach(function (x) {
      var ts = UI.parseDT(x.due);
      if (!ts) { soon++; return; }
      var cd = UI.countdown(ts);
      if (cd.late) late++;
      else if (UI.dayKey(new Date(ts)) === todayK) today++;
      else if (cd.days <= 3) soon++;
    });
    var done = all.filter(function (x) { return x.status === 'done'; }).length;
    var hours = pending.reduce(function (n, x) { return n + (x.hours || 0); }, 0);
    return { pending: pending.length, today: today, soon: soon, late: late, done: done, hours: Math.round(hours * 10) / 10 };
  }

  function card(x) {
    var ts = UI.parseDT(x.due);
    var cd = ts ? UI.countdown(ts) : null;
    var lv = UI.LEVELS[x.level || 2];
    var color = courseColor(x.course);
    var isDone = x.status === 'done';
    return '<div class="hw-item' + (cd && cd.late && !isDone ? ' overdue' : '') + (isDone ? ' done' : '') + '">' +
      '<div class="hw-bar" style="background:' + color + '"></div>' +
      '<div class="hw-main">' +
        '<div class="hw-title">' + UI.esc(x.title) +
          '<span class="badge ' + lv.cls + '">' + lv.t + '</span>' +
          (cd && cd.late && !isDone ? '<span class="badge badge-red">已逾期</span>' : '') +
          (!ts ? '<span class="badge badge-grey">未设 DDL</span>' : '') +
          (isDone ? '<span class="badge badge-green">已完成</span>' : '') +
        '</div>' +
        '<div class="hw-sub">' + UI.esc(x.course || '未分类') +
          (x.hours ? ' · 预计 ' + x.hours + ' 小时' : '') + '</div>' +
        (x.note ? '<div class="hw-note">📌 ' + UI.esc(x.note) + '</div>' : '') +
      '</div>' +
      '<div class="hw-side">' +
        '<div class="hw-cd">' + (cd ? UI.esc(cd.text) : '—') + '<small>' + UI.esc(UI.dueText(x.due)) + '</small></div>' +
        '<div class="hw-acts">' +
          (isDone
            ? '<button class="btn btn-sm" data-undo="' + x.id + '">恢复</button>'
            : '<button class="btn btn-sm btn-ghost" data-finish="' + x.id + '">✓ 完成</button>') +
          '<button class="btn btn-sm" data-edit="' + x.id + '">编辑</button>' +
          '<button class="btn btn-sm btn-danger" data-del="' + x.id + '">删除</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function render() {
    var s = stats();
    var arr = list();

    var html = UI.head({
      title: '作业 DDL',
      sub: '截止时间 · 重要度 · 预计耗时，自动算出今天该先做哪一份',
      actions: '<button class="btn" id="toPlan">🧭 去今日规划</button><button class="btn btn-primary" id="addHw">＋ 添加作业</button>'
    });

    var mins = [
      { n: s.pending, l: '⏳ 待完成', cls: 'blue' },
      { n: s.today, l: '📅 今天截止', cls: s.today ? 'warn' : '' },
      { n: s.soon, l: '📌 3 天内截止', cls: '' },
      { n: s.late, l: '⚠️ 已逾期', cls: s.late ? 'warn' : 'good' },
      { n: s.hours, l: '🕐 总工作量(小时)', cls: '' },
      { n: s.done, l: '✅ 已完成', cls: 'good' }
    ];
    html += '<div class="mini-stats">' + mins.map(function (x) {
      return '<div class="mini ' + x.cls + '"><div class="n">' + x.n + '</div><div class="l">' + x.l + '</div></div>';
    }).join('') + '</div>';

    html += '<div class="chips-bar" style="margin-top:16px">' +
      FILTERS.map(function (f) {
        return '<span class="chip' + (f[0] === filter ? ' on' : '') + '" data-filter="' + f[0] + '">' + f[1] + '</span>';
      }).join('') +
      '<div class="spacer"></div>' +
      '<select class="select" id="sortSel" style="width:auto;min-width:150px">' +
        '<option value="urgent"' + (sort === 'urgent' ? ' selected' : '') + '>按紧急度排序</option>' +
        '<option value="due"' + (sort === 'due' ? ' selected' : '') + '>按截止时间</option>' +
        '<option value="level"' + (sort === 'level' ? ' selected' : '') + '>按重要度</option>' +
      '</select>' +
    '</div>';

    var isEmpty = !arr.length;
    var emptyIco = filter === 'done' ? '✅' : filter === 'all' ? '🎉' : '🫧';
    var emptyTxt = filter === 'done' ? '还没有已完成的作业，加油！'
      : filter === 'all' ? '还没有待完成的作业，今天可以喘口气了～'
      : '这个筛选下没有作业，换个条件看看？';
    html += '<div class="card">' +
      (isEmpty
        ? '<div class="empty"><div class="e">' + emptyIco + '</div><p>' + emptyTxt + '</p>' +
            '<button class="btn btn-primary" id="addHwEmpty" style="margin-top:16px">＋ 添加作业</button></div>'
        : arr.map(card).join('') +
          '<button class="btn btn-dashed" id="addHwFoot">＋ 继续添加作业</button>') +
    '</div>';

    page.innerHTML = html;
    bind();
  }

  /* ---------- 添加 / 编辑 ---------- */
  function defaultDue() {
    var d = new Date();
    var off = d.getHours() >= 23 ? 1 : 0;
    return UI.dayKey(new Date(Date.now() + off * 86400000)) + 'T23:59';
  }

  function courseOptions(current) {
    var set = {};
    (db.courses || []).forEach(function (c) { set[c.name] = 1; });
    (db.homeworks || []).forEach(function (h) { if (h.course) set[h.course] = 1; });
    var names = Object.keys(set);
    if (current && names.indexOf(current) < 0) names.unshift(current);
    if (!names.length) names = ['其他'];
    var html = names.map(function (n) {
      return '<option value="' + UI.esc(n) + '"' + (n === current ? ' selected' : '') + '>' + UI.esc(n) + '</option>';
    }).join('');
    if (names.indexOf('其他') < 0) {
      html += '<option value="其他"' + (current === '其他' ? ' selected' : '') + '>其他 / 未分类</option>';
    }
    return html;
  }

  function quickPicks() {
    return [
      ['今天 23:59', UI.dayKey() + 'T23:59'],
      ['明天 12:00', UI.dayKey(new Date(Date.now() + 86400000)) + 'T12:00'],
      ['明天 20:00', UI.dayKey(new Date(Date.now() + 86400000)) + 'T20:00'],
      ['3 天后 23:59', UI.dayKey(new Date(Date.now() + 3 * 86400000)) + 'T23:59'],
      ['一周后 23:59', UI.dayKey(new Date(Date.now() + 7 * 86400000)) + 'T23:59']
    ];
  }

  function openForm(id) {
    var x = id ? (db.homeworks || []).filter(function (y) { return y.id === id; })[0] : null;
    var m = x ? JSON.parse(JSON.stringify(x)) : {
      title: '', course: ((db.courses || [])[0] || {}).name || '其他',
      due: defaultDue(), level: 2, hours: 1.5, note: '', status: 'todo'
    };
    if (x && x.status === 'done') m.status = 'done';

    var lvChips = [1, 2, 3].map(function (l) {
      return '<span class="chip lv' + l + (l === (m.level || 2) ? ' on' : '') + '" data-level="' + l + '">' + UI.LEVELS[l].t + '</span>';
    }).join('');

    UI.modal({
      title: x ? '编辑作业' : '添加作业',
      body:
        '<div class="field" id="fTitle"><label>作业名称 *</label><input class="input" id="hTitle" placeholder="例如：实验三 二叉树遍历" value="' + UI.esc(m.title) + '"><div class="f-err" id="eTitle"></div></div>' +
        '<div class="field"><label>所属课程</label><select class="select" id="hCourse">' + courseOptions(m.course) + '</select></div>' +
        '<div class="field" id="fDue"><label>截止时间 *</label><input class="input" id="hDue" type="datetime-local" value="' + UI.esc(m.due || '') + '">' +
          '<div class="chips" style="margin-top:8px" id="hQuick">' +
            quickPicks().map(function (q) {
              return '<span class="chip" data-quick="' + q[1] + '" style="font-size:12px">' + q[0] + '</span>';
            }).join('') +
          '</div>' +
          '<div class="f-err" id="eDue"></div>' +
        '</div>' +
        '<div class="row" style="gap:12px">' +
          '<div class="field" style="flex:1"><label>重要度</label><div class="chips level-pick" id="hLevels">' + lvChips + '</div></div>' +
          '<div class="field" id="fHours" style="flex:none;width:150px"><label>预计耗时（小时）</label><input class="input" id="hHours" type="number" min="0.5" max="40" step="0.5" value="' + (m.hours || 1.5) + '"><div class="f-err" id="eHours"></div></div>' +
        '</div>' +
        '<div class="field" style="margin-bottom:0"><label>备注</label><textarea class="textarea" id="hNote" placeholder="提交方式、注意点…">' + UI.esc(m.note) + '</textarea></div>' +
        '<div class="form-hint">按 <b>Ctrl + Enter</b> 可直接保存</div>',
      footer: '<button class="btn" data-close>取消</button>' +
        (x ? '<button class="btn btn-danger" id="hDel">删除</button>' : '') +
        '<button class="btn btn-primary" id="hSave">' + (x ? '保存修改' : '添加') + '</button>',
      onMount: function (scope, close) {
        var level = m.level || 2;

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
        /* 有错就清错：用户一动输入框，红色提示立刻收掉 */
        ['#hTitle', '#hDue', '#hHours'].forEach(function (sel) {
          var el = UI.qs(sel, scope);
          if (el) el.addEventListener('input', clearBad);
        });

        scope.addEventListener('click', function (e) {
          var q = e.target.closest('[data-quick]');
          if (q) {
            UI.qs('#hDue', scope).value = q.getAttribute('data-quick');
            UI.qsa('[data-quick]', scope).forEach(function (n) { n.classList.remove('on'); });
            q.classList.add('on');
            clearBad();
            return;
          }
          var l = e.target.closest('[data-level]');
          if (l) {
            level = parseInt(l.getAttribute('data-level'), 10);
            UI.qsa('[data-level]', scope).forEach(function (n) { n.classList.remove('on'); });
            l.classList.add('on');
          }
        });

        if (x) {
          UI.qs('#hDel', scope).onclick = function () {
            /* 确认框会叠在表单上层，取消后表单还在，不会丢已填内容 */
            UI.confirm('确定删除「' + x.title + '」吗？', '删除').then(function (ok) {
              if (!ok) return;
              db.homeworks = db.homeworks.filter(function (y) { return y.id !== x.id; });
              Store.save(); close(); UI.toast('已删除', 'ok'); render();
            });
          };
        }

        function commit() {
          var payload = {
            title: UI.qs('#hTitle', scope).value.trim(),
            course: UI.qs('#hCourse', scope).value,
            due: UI.qs('#hDue', scope).value,
            level: level,
            hours: Math.max(0.5, parseFloat(UI.qs('#hHours', scope).value) || 1),
            note: UI.qs('#hNote', scope).value.trim()
          };
          if (x) {
            Object.keys(payload).forEach(function (k) { x[k] = payload[k]; });
            UI.toast('作业已更新', 'ok');
          } else {
            payload.id = Store.uid('h');
            payload.status = 'todo';
            payload.createdAt = Date.now();
            addHomework(payload);
            UI.toast('已加入作业清单', 'ok');
          }
          Store.save();
          close();
          render();
        }

        function save() {
          clearBad();
          var titleEl = UI.qs('#hTitle', scope);
          var dueEl = UI.qs('#hDue', scope);
          var title = titleEl.value.trim();
          if (!title) { bad('fTitle', 'eTitle', '请填写作业名称，例如「实验三 二叉树遍历」'); titleEl.focus(); return; }
          if (!dueEl.value) { bad('fDue', 'eDue', '请选择截止时间，可点下面的快捷选项'); return; }
          var hours = parseFloat(UI.qs('#hHours', scope).value);
          if (isNaN(hours) || hours <= 0) { bad('fHours', 'eHours', '预计耗时请填大于 0 的小时数'); return; }

          /* 同名同课程、且还没完成 → 先问一句，避免重复录入 */
          if (!x) {
            var course = UI.qs('#hCourse', scope).value;
            var dup = (db.homeworks || []).filter(function (y) {
              return y.status !== 'done' && y.title === title && (y.course || '') === course;
            })[0];
            if (dup) {
              UI.confirm('已有一条待完成的「' + title + '」（' + course + '），确定再添加一条吗？', '继续添加')
                .then(function (ok) { if (ok) commit(); });
              return;
            }
          }
          commit();
        }

        UI.qs('#hSave', scope).onclick = save;
        UI.qs('#hTitle', scope).addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
        });
        scope.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
        });
      }
    });
  }

  /* 外部数据（教务 / 班级群抓取）落地的统一入口 */
  function addHomework(item) {
    if (!item || !item.id) return;
    if (!Array.isArray(db.homeworks)) db.homeworks = [];
    db.homeworks.push(item);
  }

  function bind() {
    UI.qs('#addHw').onclick = function () { openForm(); };
    UI.qs('#toPlan').onclick = function () { location.href = 'plan.html'; };
    var addEmpty = UI.qs('#addHwEmpty'), addFoot = UI.qs('#addHwFoot');
    if (addEmpty) addEmpty.onclick = function () { openForm(); };
    if (addFoot) addFoot.onclick = function () { openForm(); };
    UI.qs('#sortSel').onchange = function () { sort = this.value; render(); };
    UI.delegate(page, 'click', '[data-filter]', function (e, t) { filter = t.getAttribute('data-filter'); render(); });
    UI.delegate(page, 'click', '[data-finish]', function (e, t) {
      var x = (db.homeworks || []).filter(function (y) { return y.id === t.getAttribute('data-finish'); })[0];
      if (!x) return;
      x.status = 'done'; x.doneAt = Date.now();
      Store.save(); UI.toast('完成啦，辛苦了 🎉', 'ok'); render();
    });
    UI.delegate(page, 'click', '[data-undo]', function (e, t) {
      var x = (db.homeworks || []).filter(function (y) { return y.id === t.getAttribute('data-undo'); })[0];
      if (!x) return;
      x.status = 'todo';
      Store.save(); UI.toast('已恢复为待完成', 'ok'); render();
    });
    UI.delegate(page, 'click', '[data-edit]', function (e, t) { openForm(t.getAttribute('data-edit')); });
    UI.delegate(page, 'click', '[data-del]', function (e, t) {
      var id = t.getAttribute('data-del');
      var x = (db.homeworks || []).filter(function (y) { return y.id === id; })[0];
      if (!x) return;
      UI.confirm('确定删除「' + x.title + '」吗？', '删除').then(function (ok) {
        if (!ok) return;
        db.homeworks = db.homeworks.filter(function (y) { return y.id !== id; });
        Store.save(); UI.toast('已删除', 'ok'); render();
      });
    });
  }

  render();
})();
