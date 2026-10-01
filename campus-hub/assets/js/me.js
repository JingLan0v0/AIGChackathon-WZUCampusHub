/* ==========================================================
   个人中心 · 资料 / 我的发布 / 数据管理
   ========================================================== */
(function () {
  if (!Store.requireAuth()) return;   // 未登录 → 回登录页
  var page = UI.mount({ page: 'me' });
  var db = Store.load();
  var AVATARS = ['🐻', '🐼', '🦊', '🐧', '🐳', '🦉', '🐨', '🦄', '🍀', '⚡', '🎓', '🌊'];
  var tab = 'hw';

  function stats() {
    var myLost = db.lost.filter(function (x) { return x.mine; });
    var myQa = db.qa.filter(function (q) { return q.author === '我' || q.author === db.user.nickname; });
    var myAns = db.qa.reduce(function (n, q) {
      return n + (q.answers || []).filter(function (a) { return a.author === db.user.nickname; }).length; }, 0);

    var hwAll = db.homeworks || [];
    var plansAll = db.plans || [];
    var todayK = UI.dayKey();
    return {
      myLost: myLost, myQa: myQa, myAns: myAns,
      hwTodo: hwAll.filter(function (h) { return h.status !== 'done'; }),
      hwDone: hwAll.filter(function (h) { return h.status === 'done'; }),
      plans: plansAll,
      /* 每周重复的计划按「今天有没有打勾」算，和今日规划页口径一致 */
      planTodo: plansAll.filter(function (p) { return !Planner.isPlanDone(p, todayK); })
    };
  }

  function render() {
    var s = stats();
    var html = UI.head({ title: '个人中心', sub: '资料与我的校园足迹都在这里' });

    /* 资料卡 */
    html += '<div class="card">' +
      '<div class="row" style="gap:18px;align-items:flex-start">' +
        '<div style="text-align:center">' +
          '<div class="profile-avatar">' + UI.esc(db.user.avatar) + '</div>' +
          '<div class="chips" style="margin-top:10px;max-width:220px">' +
            AVATARS.map(function (a) {
              return '<span class="chip' + (a === db.user.avatar ? ' on' : '') + '" data-av="' + a + '" style="font-size:16px;padding:3px 8px">' + a + '</span>'; }).join('') +
          '</div>' +
        '</div>' +
        '<div style="flex:1;min-width:240px">' +
          '<div class="row" style="gap:12px">' +
            '<div class="field" style="flex:1;min-width:150px"><label>昵称</label><input class="input" id="nick" value="' + UI.esc(db.user.nickname) + '"></div>' +
            '<div class="field" style="flex:1;min-width:180px"><label>学院（选填）</label><input class="input" id="college" placeholder="如：计算机与人工智能学院" value="' + UI.esc(db.user.college) + '"></div>' +
          '</div>' +
          '<div class="row" style="gap:12px">' +
            '<div class="field" style="flex:1;min-width:150px"><label>学期起始日（用于计算教学周）</label><input class="input" id="term" type="date" value="' + UI.esc(db.user.termStart) + '"></div>' +
            '<div class="field" style="flex:none;padding-top:24px"><button class="btn btn-primary" id="saveProfile">保存资料</button></div>' +
          '</div>' +
          '<div style="font-size:12.5px;color:var(--muted)">当前为第 <b style="color:var(--primary)">' + UI.weekInfo().week + '</b> 教学周 · 共 ' + db.courses.length + ' 门课程</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    /* 账号与教务绑定 */
    var auth = db.auth || {};
    var edu = db.edu || {};
    html += '<div class="card" style="margin-top:14px">' +
      '<div class="sec-title" style="margin-top:0"><span class="bar"></span>账号与教务绑定' +
        '<span class="more" style="color:var(--muted);font-weight:400">温州大学统一身份认证</span></div>' +
      '<div class="list-row"><div class="lead">🆔</div><div class="main"><b>学号</b><small>' + UI.esc(auth.sid || '未绑定') + '</small></div>' +
        (auth.logged ? '<span class="badge badge-green">已登录</span>' : '<span class="badge badge-grey">未登录</span>') + '</div>' +
      '<div class="list-row"><div class="lead">🎓</div><div class="main"><b>学籍档案</b><small>' +
        /* 学院/专业现在拿到就是空（系统不再按学号猜），所以按「有几句说几句」拼，别露出多余的分隔点 */
        (auth.logged
          ? UI.esc([edu.grade, edu.college, edu.major].filter(Boolean).join(' · ') || '已绑定学号')
          : '登录后自动同步') + '</small></div></div>' +
      '<div class="list-row"><div class="lead">🔗</div><div class="main"><b>统一身份认证入口</b><small>' +
        UI.esc(Store.EDU_LOGIN_URL) + ' · 登录后进「' + UI.esc(Store.EDU_NEW_SYS) + '」→ 我的课表</small></div>' +
        '<a class="btn btn-sm" href="' + Store.EDU_LOGIN_URL + '" target="_blank" rel="noopener">↗ 打开</a></div>' +
      '<div class="list-row"><div class="lead">⇩</div><div class="main"><b>导入真实课表</b><small>' +
        (db.imported
          ? '已导入 ' + db.imported.courses + ' 条课程 · ' + UI.fmtDate(db.imported.at)
          : '上传教务系统导出的课表 PDF，核对识别结果后导入') +
        '</small></div></div>' +
      '<div class="row" style="margin-top:10px">' +
        '<button class="btn btn-sm btn-primary" id="impCourseMe">导入真实课表</button>' +
        (db.imported ? '<button class="btn btn-sm" id="resetEdu">恢复示例数据</button>' : '') +
      '</div>' +
      '<div class="row" style="margin-top:12px">' +
        '<button class="btn" id="switchAcc">切换账号</button>' +
        '<button class="btn btn-danger" id="logout">退出登录</button>' +
      '</div>' +
    '</div>';

    /* 数据概览 */
    var cards = [
      ['📚', db.courses.length, '我的课程', '#E8EDFF'],
      ['📝', s.hwTodo.length, '待完成作业', '#FEF4E6'],
      ['🧭', s.planTodo.length, '待办课外计划', '#E0F5F8'],
      ['🔍', s.myLost.length, '我发布的失物信息', '#E6F8EF'],
      ['💬', s.myQa.length, '我的提问', '#EDE9FE']
    ];
    html += '<div class="grid g-3" style="margin-top:14px">' + cards.map(function (c) {
      return '<div class="card stat pad-sm" style="padding:14px"><div class="ico" style="background:' + c[3] + '">' + c[0] +
        '</div><div><div class="num">' + c[1] + '</div><div class="lbl">' + c[2] + '</div></div></div>';
    }).join('') + '</div>';

    /* 我的发布 */
    var tabs = [['hw', '我的作业'], ['plan', '我的计划'], ['lost', '我的失物'], ['qa', '我的提问']];
    var rows = '';
    if (tab === 'hw') {
      var hwAll = s.hwTodo.concat(s.hwDone);
      hwAll.sort(function (a, b) { return (UI.parseDT(a.due) || Infinity) - (UI.parseDT(b.due) || Infinity); });
      rows = hwAll.length ? hwAll.map(function (h) {
        var ts = UI.parseDT(h.due);
        var cd = ts ? UI.countdown(ts) : null;
        var st = h.status === 'done' ? '已完成' : (cd && cd.late ? '⚠️ 已逾期' : '待完成');
        return row('📝', h.title, (h.course || '未分类') + ' · ' + UI.dueText(h.due) + ' · ' + st,
          '<a class="btn btn-sm" href="homework.html">管理</a>');
      }).join('') : UI.emptyState('📝', '还没有作业，去「作业」页添加一条');
    } else if (tab === 'plan') {
      var pl = s.plans.slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
      rows = pl.length ? pl.map(function (p) {
        return row(Planner.typeIco(p.type), p.title,
          (p.date || '') + (p.start ? ' ' + p.start + (p.end ? '–' + p.end : '') : ' 全天') +
            ' · ' + (p.place || p.type || '') + (Planner.isPlanDone(p, UI.dayKey()) ? ' · 已完成' : '') +
            (p.repeat === 'weekly' ? ' · 每周重复' : ''),
          '<button class="btn btn-sm btn-danger" data-del-plan="' + p.id + '">删除</button>');
      }).join('') : UI.emptyState('🧭', '还没有课外计划，去「今日规划」新建一条');
    } else if (tab === 'lost') {
      rows = s.myLost.length ? s.myLost.map(function (x) {
        return row(x.emoji, x.title, (x.type === 'lost' ? '寻物' : '招领') + ' · ' + x.place + ' · ' + UI.timeAgo(x.createdAt),
          '<button class="btn btn-sm btn-danger" data-del-lost="' + x.id + '">删除</button>');
      }).join('') : UI.emptyState('🔍', '还没有发布失物信息');
    } else if (tab === 'qa') {
      rows = s.myQa.length ? s.myQa.map(function (q) {
        return row('💬', q.title, (q.answers || []).length + ' 条回答 · ' + UI.timeAgo(q.createdAt),
          '<button class="btn btn-sm btn-danger" data-del-qa="' + q.id + '">删除</button>');
      }).join('') : UI.emptyState('💬', '还没有提问过');
    }

    html += '<div class="card" style="margin-top:14px">' +
      '<div class="row" style="margin-bottom:6px"><div class="chips">' +
        tabs.map(function (t) {
          return '<span class="chip' + (t[0] === tab ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</span>'; }).join('') +
      '</div></div>' + rows + '</div>';

    /* 数据管理 */
    html += '<div class="card" style="margin-top:14px">' +
      '<div class="sec-title" style="margin-top:0"><span class="bar"></span>数据管理</div>' +
      '<p style="color:var(--muted);font-size:13px;margin-bottom:12px">所有数据仅保存在你本机浏览器（localStorage），不会上传到任何服务器。可以导出备份，换设备时再导入。</p>' +
      '<div class="row">' +
        '<button class="btn" id="export">⬇️ 导出数据备份</button>' +
        '<button class="btn" id="import">⬆️ 导入数据备份</button>' +
        '<button class="btn btn-ghost" id="reset">🔄 恢复示例数据</button>' +
        '<button class="btn btn-danger" id="clear">🗑️ 清空我的内容</button>' +
        '<input type="file" id="fileInput" accept=".json,application/json" style="display:none">' +
      '</div>' +
    '</div>';

    page.innerHTML = html;
    bind();
  }

  function row(emoji, title, sub, action) {
    return '<div class="list-row"><div class="lead">' + emoji + '</div>' +
      '<div class="main"><b class="truncate">' + UI.esc(title) + '</b><small>' + UI.esc(sub) + '</small></div>' + action + '</div>';
  }

  function bind() {
    /* 头像 / 资料 */
    UI.delegate(page, 'click', '[data-av]', function (e, t) {
      db.user.avatar = t.getAttribute('data-av'); Store.save(); render();
    });
    UI.qs('#saveProfile').onclick = function () {
      db.user.nickname = UI.qs('#nick').value.trim() || '温大同学';
      db.user.college = UI.qs('#college').value.trim() || '温州大学';
      db.user.termStart = UI.qs('#term').value || db.user.termStart;
      Store.save(); UI.toast('资料已保存', 'ok'); render();
    };

    /* 账号操作 */
    var logoutBtn = UI.qs('#logout');
    if (logoutBtn) logoutBtn.onclick = function () {
      UI.confirm('退出后需要重新输入学号密码登录，本机数据不会丢失。确定退出吗？', '退出登录').then(function (ok) {
        if (!ok) return;
        Store.logout();
        location.href = 'index.html';
      });
    };
    var swBtn = UI.qs('#switchAcc');
    if (swBtn) swBtn.onclick = function () {
      UI.confirm('将退出当前账号并返回登录页。本机登录过的账号都会留在登录页的「切换账号」里，'
        + '每个人的课表、作业、计划各存一份，回来时一键切换、不用重输密码。确定吗？', '去切换').then(function (ok) {
        if (!ok) return;
        Store.logout();
        location.href = 'index.html';
      });
    };
    /* 导入真实课表 / 恢复示例数据 */
    var impBtn = UI.qs('#impCourseMe');
    if (impBtn) impBtn.onclick = function () {
      if (typeof ImportEdu === 'undefined') { UI.toast('导入模块未加载', 'err'); return; }
      ImportEdu.open({
        onDone: function (r) {
          db = Store.load();
          UI.toast('已导入 ' + r.courses + ' 条真实课程', 'ok');
          render();
        }
      });
    };
    var rsEdu = UI.qs('#resetEdu');
    if (rsEdu) rsEdu.onclick = function () {
      UI.confirm('将清空导入的真实课表和已添加的课程调整，恢复成示例数据。确定吗？', '恢复示例数据').then(function (ok) {
        if (!ok) return;
        Store.clearImported();
        db = Store.load();
        UI.toast('已恢复示例数据', 'ok');
        render();
      });
    };

    /* 列表切换 */
    UI.delegate(page, 'click', '[data-tab]', function (e, t) { tab = t.getAttribute('data-tab'); render(); });

    /* 删除类操作 */
    UI.delegate(page, 'click', '[data-del-lost]', function (e, t) {
      var id = t.getAttribute('data-del-lost');
      UI.confirm('确定删除这条失物信息吗？', '删除').then(function (ok) {
        if (!ok) return;
        db.lost = db.lost.filter(function (x) { return x.id !== id; });
        Store.save(); UI.toast('已删除', 'ok'); render();
      });
    });
    UI.delegate(page, 'click', '[data-del-qa]', function (e, t) {
      var id = t.getAttribute('data-del-qa');
      UI.confirm('确定删除这个提问及其回答吗？', '删除').then(function (ok) {
        if (!ok) return;
        db.qa = db.qa.filter(function (q) { return q.id !== id; });
        Store.save(); UI.toast('已删除', 'ok'); render();
      });
    });
    UI.delegate(page, 'click', '[data-del-plan]', function (e, t) {
      var id = t.getAttribute('data-del-plan');
      UI.confirm('确定删除这条计划吗？', '删除').then(function (ok) {
        if (!ok) return;
        db.plans = db.plans.filter(function (p) { return p.id !== id; });
        Store.save(); UI.toast('已删除', 'ok'); render();
      });
    });
    /* 数据管理 */
    UI.qs('#export').onclick = function () {
      try {
        var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '校园百事通-数据备份-' + UI.fmtDate(Date.now()) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        UI.toast('已导出数据备份', 'ok');
      } catch (e) { UI.toast('导出失败：' + e.message, 'err'); }
    };
    UI.qs('#import').onclick = function () { UI.qs('#fileInput').click(); };
    UI.qs('#fileInput').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          db = Store.importJSON(fr.result);
          UI.toast('导入成功，数据已恢复', 'ok');
          render();
        } catch (err) { UI.toast('导入失败：' + err.message, 'err'); }
      };
      fr.readAsText(f);
    };
    UI.qs('#reset').onclick = function () {
      UI.confirm('将用一套完整的示例数据覆盖当前内容（个人资料保留），确定继续吗？', '恢复示例').then(function (ok) {
        if (!ok) return;
        db = Store.reset(); UI.toast('已恢复示例数据', 'ok'); render();
      });
    };
    UI.qs('#clear').onclick = function () {
      UI.confirm('将清空课程、作业、计划、失物与问答（个人资料保留），此操作不可撤销，确定吗？', '清空').then(function (ok) {
        if (!ok) return;
        db = Store.clearAll(); UI.toast('已清空我的内容', 'ok'); render();
      });
    };
  }

  render();
})();
