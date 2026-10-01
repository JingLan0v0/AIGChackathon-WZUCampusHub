/* ==========================================================
   首页 · 仪表盘（今日规划主线）
   1) 实时天气 + 出行建议  2) 今日规划智能排序  3) 课表 / 日历 / 公告
   ========================================================== */
(function () {
  if (!Store.requireAuth()) return;   // 未登录 → 回登录页
  var page = UI.mount({ page: 'home' });
  page.classList.add('home-page');
  var db = Store.load();
  var wi = UI.weekInfo();
  var wx = null;                       // 天气数据，异步填充
  var plan = Planner.build(null);      // 今日规划（先不带天气）
  var loadingWx = true;

  /* ---------- Hero ---------- */
  function heroHtml() {
    var now = new Date();
    var h = now.getHours();
    var greet = h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    var wdCn = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
    return '<section class="hero"><div class="hero-in">' +
      '<h1>' + greet + '，' + UI.esc(db.user.nickname) + ' 👋</h1>' +
      '<div class="meta">' +
        '<span>📅 ' + (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 ' + wdCn + '</span>' +
        '<span>第 ' + wi.week + ' 教学周</span>' +
        '<span id="wxBrief">' + UI.esc(Weather.brief(wx)) + '</span>' +
        /* 学院没填就不占位（系统不再自动猜学院，空着是常态） */
        (db.user.college ? '<span>🎓 ' + UI.esc(db.user.college) + '</span>' : '') +
      '</div>' +
      /* 当前行动放在第一行；截止、补救和其他安排随后展示。 */
      '<div class="summary">' +
        '<div class="sum-head">' +
          '<span class="si">✦</span>' +
          '<b>今天先做什么</b>' +
          '<span class="sum-badges" id="sumBadges">' + Planner.summaryBadgesHtml(plan) + '</span>' +
          '<a class="link sum-more" href="plan.html">完整规划 →</a>' +
        '</div>' +
        '<div class="sum-lines" id="sumLines">' + Planner.summaryLinesHtml(plan) + '</div>' +
      '</div>' +
    '</div></section>';
  }

  /* ---------- 天气 + 出行建议 ---------- */
  function weatherSection() {
    return '<section class="home-weather-panel"><div class="sec-title"><span class="bar"></span>今日天气 · 出行建议' +
        '<span class="more" style="color:var(--muted);font-weight:400">数据来源 ' + Weather.sourceLabel() + ' · 温州茶山实测</span></div>' +
      '<div class="split weather-split">' +
        '<div id="wxBox">' + wxSkeleton() + '</div>' +
        '<div class="card"><div class="sec-title" style="margin-top:0"><span class="bar"></span>今天怎么出门' +
          '<span class="more" style="color:var(--muted);font-weight:400">自动生成</span></div>' +
          '<div id="wxTips">' + tipsSkeleton() + '</div>' +
        '</div>' +
      '</div></section>';
  }
  function wxSkeleton() {
    return '<div class="wx-card"><div class="wx-top"><div class="wx-now"><div class="wx-ico">📡</div>' +
      '<div><div class="wx-temp">—</div><div class="wx-desc">' +
      (loadingWx ? '正在获取温州茶山实时天气…' : '天气未取到') + '</div></div></div></div></div>';
  }
  function tipsSkeleton() {
    return loadingWx
      ? '<div class="tip tip"><div class="ti">⏳</div><div class="tb"><b>正在结合天气生成建议</b><small>带不带伞、穿什么、骑车还是坐校车，马上就好。</small></div></div>'
      : '<div class="tip err"><div class="ti">📡</div><div class="tb"><b>建议还没生成</b><small>点左侧「重新获取」试试网络。</small></div></div>';
  }

  /* ---------- 今日规划 ---------- */
  function miniStats() {
    var c = plan.counts;
    var items = [
      { n: c.courses, l: '📚 今日课程', cls: '' },
      { n: c.dueToday, l: '⏳ 今天截止', cls: c.dueToday ? 'warn' : '' },
      { n: c.overdue, l: '⚠️ 已逾期', cls: c.overdue ? 'warn' : 'good' },
      { n: c.plansLeft, l: '🧭 待办计划', cls: 'blue' }
    ];
    return '<div class="mini-stats home-mini-stats">' + items.map(function (x) {
      return '<div class="mini ' + x.cls + '"><div class="n">' + x.n + '</div><div class="l">' + x.l + '</div></div>';
    }).join('') + '</div>';
  }

  function planSection() {
    return '<div class="sec-title"><span class="bar"></span>今日规划 · 按紧急度自动排序' +
        '<a class="more" href="plan.html">完整规划 →</a></div>' +
      miniStats() +
      '<div class="split home-plan-split" style="margin-top:14px">' +
        '<div class="card"><div class="sec-title" style="margin-top:0"><span class="bar"></span>先做什么' +
          '<span class="more" style="color:var(--muted);font-weight:400">学业任务与作业</span></div>' +
          Planner.priorityHtml(plan) + '</div>' +
        '<div>' +
          '<div class="card"><div class="sec-title" style="margin-top:0"><span class="bar"></span>空档安排建议' +
            '<span class="more" style="color:var(--muted);font-weight:400">自动避开上课时间</span></div>' +
            Planner.focusHtml(plan) + '</div>' +
          '<div class="card" style="margin-top:14px"><div class="sec-title" style="margin-top:0"><span class="bar"></span>今日工作量' +
            '</div>' +
            '<div class="dcount"><div><div class="d">' + plan.workload.today + ' <span style="font-size:13px">h</span></div>' +
              '<div style="font-size:12px;color:var(--muted)">今天/逾期作业需投入</div></div>' +
              '<div style="flex:1"><div class="bar-track"><div class="bar-fill" style="width:' +
                Math.min(100, Math.round(plan.workload.today / 6 * 100)) + '%"></div></div>' +
                '<div style="font-size:11.5px;color:var(--muted);margin-top:6px">全部待完成作业合计约 ' + plan.workload.total + ' 小时</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="card home-timeline" style="margin-top:14px"><div class="sec-title" style="margin-top:0"><span class="bar"></span>今天的时间轴</div>' +
            '<div class="home-timeline-scroll" role="region" aria-label="今日时间轴，可滚动查看" tabindex="0">' +
              Planner.timelineHtml(plan) + '</div></div>' +
        '</div>' +
      '</div>';
  }

  /* ---------- 今日课程 / 日历 / 失物招领 ---------- */
  function courseSection() {
    var todayCourses = plan.courses;
    var courseRows = todayCourses.length ? todayCourses.map(function (c) {
      return '<div class="list-row">' +
        '<div class="lead" style="background:' + c.color + '1F;color:' + c.color + '">' + (c.start) + '</div>' +
        '<div class="main"><b>' + UI.esc(c.name) +
          (c.adjusted ? ' <span class="badge badge-yellow">' + (c.adjustType === 'make' ? '补课' : '已调课') + '</span>' : '') +
        '</b>' +
          '<small>' + UI.bellRange(c.start, c.span) + ' · ' + UI.esc(c.room) + ' · ' + UI.esc(c.teacher) + '</small></div>' +
        '<span class="badge badge-blue">第 ' + c.start + '-' + (c.start + c.span - 1) + ' 节</span>' +
      '</div>';
    }).join('') : UI.emptyState('🎈', '今天没有课程安排，出去走走吧～');

    var today0 = new Date(); today0.setHours(0, 0, 0, 0);
    var upcoming = db.calendar.map(function (c) {
      var start = new Date(c.date + 'T00:00:00');
      var end = new Date((c.endDate || c.date) + 'T00:00:00');
      return { name: c.name, emoji: c.emoji, date: c.date, endDate: c.endDate,
        days: Math.round((start - today0) / 86400000), remaining: Math.round((end - today0) / 86400000) };
    }).filter(function (c) { return c.remaining >= 0; }).sort(function (a, b) { return a.days - b.days; });

    function calendarDate(c) { return c.date + (c.endDate ? ' — ' + c.endDate : ''); }

    var cdHtml = upcoming.slice(0, 1).map(function (c) {
      return '<div class="dcount"><div><div class="d">' + (c.days <= 0 ? '进行中' : c.days + ' <span style="font-size:13px">天</span>') + '</div>' +
        '<div style="font-size:12px;color:var(--muted)">' + (c.days <= 0 ? '正在进行 ' : '距 ') + UI.esc(c.emoji || '📅') + ' ' + UI.esc(c.name) + '</div></div>' +
        '<div style="flex:1"><div class="bar-track"><div class="bar-fill" style="width:' + Math.max(6, 100 - Math.min(Math.max(c.days, 0), 60) / 60 * 100) + '%"></div></div>' +
        '<div style="font-size:11.5px;color:var(--muted);margin-top:6px">' + UI.esc(calendarDate(c)) + '</div></div></div>';
    }).join('') || UI.emptyState('🎉', '近期暂无重要节点');

    var cdList = upcoming.slice(1, 4).map(function (c) {
      return '<div class="list-row"><div class="lead">' + UI.esc(c.emoji || '📅') + '</div><div class="main"><b>' + UI.esc(c.name) + '</b><small>' + UI.esc(calendarDate(c)) + '</small></div>' +
        '<span class="badge badge-grey">' + (c.days <= 0 ? '进行中' : c.days + ' 天后') + '</span></div>';
    }).join('');

    var lostHtml = (db.lost || []).filter(function (x) { return !x.resolved; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 4).map(function (x) {
      return '<a class="list-row" href="lost.html"><div class="lead">' + UI.esc(x.emoji || '🔎') + '</div>' +
        '<div class="main"><b>' + UI.esc(x.title) + ' <span class="badge ' +
          (x.type === 'found' ? 'badge-green' : 'badge-blue') + '">' + (x.type === 'found' ? '招领' : '寻物') + '</span></b>' +
          '<small>📍 ' + UI.esc(x.place || '地点未填写') + ' · ' + UI.esc(UI.timeAgo(x.createdAt)) + '</small></div></a>';
    }).join('');

    return '<div class="home-campus-grid' + (db.courses.length ? '' : ' empty-courses') + '">' +
      (db.courses.length ? '<section class="card home-course-card"><div class="sec-title" style="margin-top:0"><span class="bar"></span>今日课程 · ' +
        UI.weekdayName(wi.weekday) + '<a class="more" href="schedule.html">完整课表 →</a></div>' +
        '<div class="home-course-list">' + courseRows + '</div></section>' : '') +
      '<section class="card home-calendar-card"><div class="sec-title" style="margin-top:0"><span class="bar"></span>校园日历</div>' +
        cdHtml + cdList + '</section>' +
      '<section class="card home-lost-card"><div class="sec-title" style="margin-top:0"><span class="bar"></span>失物招领<a class="more" href="lost.html">查看全部 →</a></div>' +
        '<div class="home-lost-list">' + (lostHtml || UI.emptyState('🔎', '暂无失物招领信息')) + '</div></section>' +
      '</div>';
  }

  function emptyCoursesHint() {
    if (db.courses.length) return '';
    return '<div class="card home-course-alert" role="status">' +
      '<span class="home-course-alert-icon" aria-hidden="true">📅</span>' +
      '<div><b>暂无课表</b><small>可在右侧校园 AI 助手输入课程信息，或点击「📄 PDF」上传课表，核对后即可添加。</small></div>' +
      '</div>';
  }

  /* ---------- 一句话记下来（自然语言快捷记录） ----------
     首页唯一的输入口：说一句人话，它自己判断是课外计划 / 作业 DDL / 课表补充。
     解析与写库都在 nl.js 里，这里只负责摆位置和「写完重画一遍」。 */
  function nlSection() {
    return (typeof NL === 'undefined') ? '' : NL.boxHtml();
  }

  /* ---------- 组装 ---------- */
  function build() {
    return '<div class="home-workspace"><div class="home-main">' +
      '<div class="home-first-screen">' + heroHtml() + weatherSection() + '</div>' +
      '<div class="home-more">' + emptyCoursesHint() + planSection() + courseSection() + '</div>' +
      '</div>' + CampusAssistant.html() + '</div>';
  }

  function paint() {
    page.innerHTML = build();
    bind();
  }

  /* NL 写完数据后要重算今日规划与迷你统计，整页重画一遍；
     对话框里的输入与结果由 NL 自己的状态恢复，不会被清空。 */
  function refreshAll() {
    db = Store.load();
    try { plan = Planner.build(wx); } catch (e) { /* 规划引擎出错也不该把首页拖白 */ }
    paint();
  }

  /* 天气数据到达后，只更新受影响的三处 */
  function paintWeather() {
    var box = UI.qs('#wxBox');
    if (box) box.innerHTML = Weather.card(wx);
    var tips = UI.qs('#wxTips');
    if (tips) tips.innerHTML = Weather.tips(wx);
    var brief = UI.qs('#wxBrief');
    if (brief) brief.textContent = Weather.brief(wx);
    /* 规划总结要跟着天气一起更新（天气也是其中一行），整块重画更省心 */
    var sum = UI.qs('#sumLines');
    if (sum) sum.innerHTML = Planner.summaryLinesHtml(plan);
    var badges = UI.qs('#sumBadges');
    if (badges) badges.innerHTML = Planner.summaryBadgesHtml(plan);
    var rb = UI.qs('#wxRefresh');
    if (rb) rb.onclick = refreshWeather;
  }

  function refreshWeather() {
    loadingWx = true;
    var box = UI.qs('#wxBox');
    if (box) box.innerHTML = renderSkeletonInline();
    var rb = UI.qs('#wxRefresh');
    if (rb) { rb.disabled = true; rb.textContent = '获取中…'; }
    Weather.load(true).then(function (w) {
      applyWeather(w);
      UI.toast(w.ok ? '天气已更新（' + w.current.hm + '）' : '天气获取失败，请检查网络', w.ok ? 'ok' : 'err');
    }, function (e) {
      applyWeather(Weather.failed('加载异常：' + ((e && e.message) || '未知')));
    });
  }

  function renderSkeletonInline() {
    return '<div class="wx-card"><div class="wx-top"><div class="wx-now"><div class="wx-ico">📡</div>' +
      '<div><div class="wx-temp">—</div><div class="wx-desc">正在获取温州茶山实时天气…</div></div></div></div></div>';
  }

  function bind() {
    var rb = UI.qs('#wxRefresh');
    if (rb) rb.onclick = refreshWeather;
    /* 重画后绑定右侧对话区，保留对话和输入草稿。 */
    CampusAssistant.setup(refreshAll, refreshWeather);
  }

  /* 天气到达（或彻底失败）后统一收口：绝不让页面停在「正在获取…」的骨架态 */
  function applyWeather(w) {
    loadingWx = false;
    wx = (w && typeof w.ok === 'boolean') ? w : Weather.failed('返回数据异常');
    try { plan = Planner.build(wx); } catch (e) { /* 规划引擎出错也不能拖住天气卡片 */ }
    paintWeather();
  }

  /* ---------- 启动 ---------- */
  paint();
  Weather.load(false).then(applyWeather, function (e) {
    applyWeather(Weather.failed('加载异常：' + ((e && e.message) || '未知')));
  });
})();
