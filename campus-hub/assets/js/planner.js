/* ==========================================================
   今日规划引擎
   ---------------------------------------------------------
   把「今天的课 + 作业 DDL + 课外计划 + 天气」合成一份当天安排：
     · priority  按紧急度打分排序的待办清单（作业 & 学业任务）
     · timeline  一天的时间轴（课 / 计划 / 建议专注时段 / 饭点）
     · focus     自动找出没课的空档，把最紧的作业塞进去
     · summary   一句话说清「今天最要紧的是什么」
   打分只依赖本地数据，天气只影响出行类建议，两者互不阻塞。
   ========================================================== */
var Planner = (function () {
  var DAY_START = 8 * 60;          // 08:00
  var DAY_END = 22 * 60;           // 22:00
  var MEALS = [
    { from: 11 * 60 + 40, to: 13 * 60 + 30, title: '午餐 · 午休', ico: '🍚' },
    { from: 17 * 60 + 30, to: 18 * 60 + 30, title: '晚餐', ico: '🍜' }
  ];
  var TYPES = ['学习', '运动', '社团', '生活', '社交', '其他'];
  var TYPE_ICO = { '学习': '📖', '运动': '🏃', '社团': '🎪', '生活': '🛒', '社交': '👥', '其他': '✨' };
  var MIN_GAP = 50;                // 空档至少 50 分钟才排得下一件事

  /* ---------- 小工具 ---------- */
  function bellEndOf(start, span) {
    return UI.bellEnd((start - 1) + Math.max(1, parseInt(span, 10) || 1));
  }
  /* 某条计划是否落在指定日期（含每周重复） */
  function planOnDay(p, dayK, weekday) {
    if (!p || !p.date) return false;
    if (p.date === dayK) return true;
    if (p.repeat === 'weekly') {
      var d = new Date(p.date + 'T00:00:00');
      if (isNaN(d.getTime())) return false;
      var wd = d.getDay() === 0 ? 7 : d.getDay();
      return wd === weekday && p.date <= dayK;
    }
    return false;
  }
  /* 某条计划在指定日期算不算「已完成」。
     一次性计划看 status；每周重复的计划按发生日期记录，避免打一次勾就永远不再出现。 */
  function isPlanDone(p, dayK) {
    if (!p) return false;
    if (p.repeat === 'weekly') return !!(p.doneOn && p.doneOn[dayK]);
    return p.status === 'done';
  }
  function nextPlanOccurrence(p, dayK) {
    var date=p.date||dayK;
    if(p.repeat==='weekly'&&date<dayK){
      var target=new Date(date+'T00:00:00').getDay(), next=new Date(dayK+'T00:00:00');
      next.setDate(next.getDate()+(target-next.getDay()+7)%7);date=UI.dayKey(next);
    }
    return date;
  }
  function typeIco(t) { return TYPE_ICO[t] || '✨'; }

  /* ---------- 紧迫度打分 ---------- */
  function scoreHw(x) {
    var ts = UI.parseDT(x.due);
    if (!ts) return 40;
    var cd = UI.countdown(ts);
    var base;
    if (cd.late) base = 150;                                   // 已逾期：最高优先级
    else if (cd.days <= 1) base = 132;                         // 24 小时内
    else if (cd.days <= 3) base = 112 - cd.days * 10;          // 3 天内
    else base = 68 - Math.min(cd.days, 20) * 2;
    return Math.round(base + (x.level || 2) * 9);
  }
  function scorePlan(p, nowMin) {
    var lv = p.level || 2;
    var base = p.start ? 64 : 48;
    if (p.start) {
      var m = UI.toMin(p.start);
      if (m < nowMin) base += 6;              // 时间已过还没打勾
      else if (m - nowMin <= 120) base += 12; // 两小时内开始
    }
    return Math.round(base + lv * 7);
  }

  /* ---------- 空档计算 ---------- */
  function mergeRanges(list) {
    var s = list.slice().sort(function (a, b) { return a.from - b.from; });
    var out = [];
    s.forEach(function (r) {
      var last = out[out.length - 1];
      if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
      else out.push({ from: r.from, to: r.to });
    });
    return out;
  }
  function freeGaps(busy, nowMin) {
    var merged = mergeRanges(busy);
    var out = [];
    var cursor = Math.max(DAY_START, nowMin);
    merged.forEach(function (b) {
      if (b.from - cursor >= MIN_GAP) out.push({ from: cursor, to: b.from });
      cursor = Math.max(cursor, b.to);
    });
    if (DAY_END - cursor >= MIN_GAP) out.push({ from: cursor, to: DAY_END });
    return out;
  }

  /* ==========================================================
     主入口
     ========================================================== */
  function build(weather) {
    var db = Store.load();
    var wi = UI.weekInfo();
    var now = new Date();
    var todayK = UI.dayKey(now);
    var nowMin = now.getHours() * 60 + now.getMinutes();

    /* ---------- 1. 今天的课（取「生效课表」：原始课表 + 已确认的调课调整） ---------- */
    var courses = Store.coursesOn(wi.weekday, wi.week);

    /* 本人经 AI 核对并应用的课程调整。 */
    var hasAdjust = (typeof Adjust !== 'undefined' && Adjust.pending);
    var adjustAppliedToday = hasAdjust
      ? Adjust.list().filter(function (a) {
          return a.applied && ((a.from && a.from.week === wi.week && a.from.day === wi.weekday) ||
                               (a.to && a.to.week === wi.week && a.to.day === wi.weekday));
        })
      : [];

    /* ---------- 2. 作业 ---------- */
    var allHw = (db.homeworks || []).slice();
    var pending = allHw.filter(function (x) { return x.status !== 'done'; });
    var overdue = [], dueToday = [], dueSoon = [];
    pending.forEach(function (x) {
      var ts = UI.parseDT(x.due);
      if (!ts) { dueSoon.push(x); return; }
      var cd = UI.countdown(ts);
      if (cd.late) overdue.push(x);
      else if (UI.dayKey(new Date(ts)) === todayK) dueToday.push(x);
      else if (cd.days <= 3.5) dueSoon.push(x);
    });
    var hwDone = allHw.filter(function (x) { return x.status === 'done'; }).length;

    /* ---------- 3. 今天的计划 ---------- */
    var plansAll = (db.plans || []);
    var plansToday = plansAll.filter(function (p) {
      return planOnDay(p, todayK, wi.weekday);
    }).sort(function (a, b) {
      var am = a.start ? UI.toMin(a.start) : 24 * 60, bm = b.start ? UI.toMin(b.start) : 24 * 60;
      return am - bm;
    });
    var plansTodo = plansToday.filter(function (p) { return !isPlanDone(p, todayK); });

    /* ---------- 4. 优先级清单 ---------- */
    var prio = [];
    pending.forEach(function (x) {
      var ts = UI.parseDT(x.due);
      var cd = ts ? UI.countdown(ts) : null;
      var isToday = ts && UI.dayKey(new Date(ts)) === todayK;
      prio.push({
        kind: 'homework', id: x.id, ico: '📝', title: x.title, sub: x.course,
        score: scoreHw(x), level: x.level || 2, sortAt: ts || Infinity,
        short: cd ? (cd.late ? UI.dueText(x.due) + ' 已逾期' : UI.dueText(x.due) + ' 截止') : '未设截止时间',
        why: (cd ? (cd.late ? '⚠️ 已逾期 ' + cd.text.replace('已逾期 ', '') : cd.text + '截止') : '未设置截止时间')
          + ' · ' + (x.level === 3 ? '高' : x.level === 1 ? '低' : '中') + '重要度'
          + (x.hours ? ' · 预计 ' + x.hours + ' 小时' : '')
          + (isToday ? '' : ''),
        tag: UI.LEVELS[x.level || 2],
        urgent: !!(cd && cd.late),
        isToday: !!isToday,
        hours: x.hours || 0,
        href: 'homework.html'
      });
    });
    var academicTodo = plansAll.filter(function(p){
      return Store.isAcademicTask(p) && (p.repeat==='weekly' || p.status!=='done');
    }).map(function(p){
      var date=nextPlanOccurrence(p,todayK);
      if(isPlanDone(p,date))return null;
      return {task:p,date:date};
    }).filter(Boolean);
    academicTodo.forEach(function (entry) {
      var p=entry.task, occurrence=entry.date;
      var at=UI.parseDT(occurrence+'T'+(p.end||p.start||'23:59'));
      var late=p.repeat!=='weekly'&&at<Date.now();
      prio.push({
        kind: 'plan', id: p.id, ico: typeIco(p.type), title: p.title, sub: (p.type || '计划') + (p.place ? ' · ' + p.place : ''),
        score: scorePlan(p, nowMin), level: p.level || 2,
        sortAt: at || Infinity, occurrence: occurrence,
        short: (occurrence===todayK?'今天':occurrence)+' '+(p.start ? p.start+(p.end?'–'+p.end:''):'任意时间')+(p.place?' · '+p.place:''),
        why: (late?'⚠️ 已逾期 · ':'')+(p.start ? p.start + (p.end ? '–' + p.end : '') + ' · ' : '未定具体时间 · ')
          + (p.type || '计划') + ' · ' + (p.level === 3 ? '高' : p.level === 1 ? '低' : '中') + '重要度'
          + (p.repeat === 'weekly' ? ' · 每周重复' : ''),
        tag: UI.LEVELS[p.level || 2],
        urgent: late,
        hours: p.start && p.end ? Math.max(0, (UI.toMin(p.end) - UI.toMin(p.start)) / 60) : 0,
        href: 'plan.html'
      });
    });
    /* Overdue always comes first, then high/medium/low across both homework and plans. */
    prio.sort(function (a, b) {
      return Number(b.urgent) - Number(a.urgent) || b.level - a.level ||
        a.sortAt - b.sortAt || b.score - a.score;
    });
    /* 完整学业清单保留所有待办，首页可通过 limit 截取。 */

    /* ---------- 5. 时间轴 ---------- */
    var tl = [];
    courses.forEach(function (c) {
      tl.push({
        from: UI.toMin(UI.BELLS[c.start - 1]), to: UI.toMin(bellEndOf(c.start, c.span)),
        kind: 'course', ico: '📚', title: c.name,
        sub: '@' + c.room + ' · ' + c.teacher, color: c.color,
        /* 这节课经过课程调整 → 时间轴上标出来 */
        tag: c.adjusted ? (c.adjustType === 'make' ? '补课' : c.adjustType === 'room' ? '换教室' : '已调课') : ''
      });
    });
    plansToday.filter(function (p) { return p.start; }).forEach(function (p) {
      var done = isPlanDone(p, todayK);
      tl.push({
        from: UI.toMin(p.start), to: UI.toMin(p.end || p.start),
        kind: 'plan', ico: typeIco(p.type), title: p.title,
        sub: (p.place || p.type || '') + (done ? ' · 已完成 ✅' : ''),
        done: done
      });
    });
    /* 只有当天本来就有安排时才插入饭点，避免出现「只有午饭晚饭」的空时间轴 */
    if (tl.length) {
      MEALS.forEach(function (m) {
        tl.push({ from: m.from, to: m.to, kind: 'meal', ico: m.ico, title: m.title, sub: '' });
      });
    }

    /* ---------- 6. 空档 + 自动排作业 ---------- */
    var busy = tl.filter(function (x) { return x.kind !== 'focus'; })
      .map(function (x) { return { from: x.from, to: x.to }; });
    var gaps = freeGaps(busy, nowMin);

    /* 按「紧急度」排队，再把每项作业塞进合适的空档；一项作业可以拆到两个空档做 */
    var queue = pending.slice().sort(function (a, b) { return scoreHw(b) - scoreHw(a); });
    var remain = queue.map(function (x) { return Math.max(MIN_GAP, Math.round((x.hours || 1.5) * 60)); });
    var focus = [];
    var qi = 0;
    gaps.forEach(function (g) {
      var cursor = g.from;
      while (qi < queue.length && g.to - cursor >= MIN_GAP) {
        var use = Math.min(remain[qi], g.to - cursor);
        if (use < MIN_GAP) break;
        focus.push({
          from: cursor, to: cursor + use, hwId: queue[qi].id,
          title: queue[qi].title, course: queue[qi].course,
          level: queue[qi].level || 2, minutes: use
        });
        cursor += use;
        remain[qi] -= use;
        if (remain[qi] < MIN_GAP) qi++;
      }
    });

    focus.forEach(function (f) {
      tl.push({
        from: f.from, to: f.to, kind: 'focus', ico: '🎯',
        title: '建议：' + f.course + ' 作业', sub: f.title + ' · 约 ' + Math.round(f.minutes / 6) / 10 + ' 小时',
        color: '#F79009'
      });
    });
    /* Reminders are milestones, not booked study sessions. They do not occupy gaps. */
    pending.forEach(function (h) {
      var due = UI.parseDT(h.due);
      if (!due) return;
      var dueDate = new Date(due);
      var todayDue = UI.dayKey(dueDate) === todayK;
      var late = due < now.getTime();
      if (!late && !todayDue && due - now.getTime() > 3.5 * 86400000) return;
      var at = todayDue && !late ? dueDate.getHours() * 60 + dueDate.getMinutes() : nowMin;
      tl.push({
        from: at, to: at, kind: 'reminder', ico: late ? '⚠️' : todayDue ? '⏳' : '📝',
        title: (late ? '补交：' : todayDue ? '截止：' : '准备：') + h.title,
        sub: (h.course || '作业') + ' · ' + UI.dueText(h.due) + (late ? ' 已逾期' : ' 截止') +
          (h.hours ? ' · 预计 ' + h.hours + ' 小时' : ''),
        timeLabel: todayDue && !late ? '' : '待办',
        tag: late ? '补交' : todayDue ? '截止' : '提醒'
      });
    });
    /* Course preparation/review is suggested only in an unoccupied 15-minute slot. */
    courses.forEach(function (c) {
      var start = UI.toMin(UI.BELLS[c.start - 1]);
      var end = UI.toMin(bellEndOf(c.start, c.span));
      [{from: start - 15, to: start, title: '课前准备：', note: '检查教材与课堂资料'},
       {from: end, to: end + 15, title: '课后回顾：', note: '整理课堂重点与疑问'}].forEach(function (slot) {
        if (slot.from < Math.max(DAY_START, nowMin) || slot.to > DAY_END) return;
        if (tl.some(function (x) { return x.kind !== 'reminder' && x.from < slot.to && x.to > slot.from; })) return;
        var related = pending.filter(function (h) { return h.course === c.name; });
        tl.push({from: slot.from, to: slot.to, kind: 'review', ico: '📖',
          title: slot.title + c.name,
          sub: slot.note + (related.length ? ' · 关联 ' + related.length + ' 项待完成作业' : ''), tag: '建议'});
      });
    });
    tl.sort(function (a, b) { return a.from - b.from; });

    /* ---------- 7. 现在 / 接下来 ---------- */
    var nowItems = tl.filter(function (x) { return x.kind !== 'meal' && nowMin >= x.from && nowMin < x.to; });
    var nextCourse = null;
    for (var i = 0; i < courses.length; i++) {
      var cs = UI.toMin(UI.BELLS[courses[i].start - 1]);
      if (cs > nowMin) { nextCourse = { course: courses[i], inMin: cs - nowMin, at: UI.BELLS[courses[i].start - 1] }; break; }
    }
    var nextTl = tl.filter(function (x) { return x.from > nowMin; })[0] || null;

    /* ---------- 8. 今日行动提醒 ----------
       首页先说眼下能做什么，再列课程、截止、补救和出门提醒。
       完整的 priority 仍留给规划页，不能把昨天已错过的安排写成今天即将发生。 */
    var seg = [];
    var lines = [];
    function ln(ico, text, tone, href, featured) {
      lines.push({ ico: ico, text: text, tone: tone || 'plain', href: href || '', featured: !!featured });
    }
    var dueFirst = dueToday.slice().sort(function (a, b) {
      return (UI.parseDT(a.due) || 0) - (UI.parseDT(b.due) || 0);
    })[0];
    var overdueFirst = overdue.slice().sort(function (a, b) {
      return (b.level || 2) - (a.level || 2) || (UI.parseDT(b.due) || 0) - (UI.parseDT(a.due) || 0);
    })[0];
    var lateAcademic = prio.filter(function (x) { return x.kind === 'plan' && x.urgent; });
    var currentCourse = courses.filter(function (c) {
      var from = UI.toMin(UI.BELLS[c.start - 1]);
      return from <= nowMin && nowMin < UI.toMin(bellEndOf(c.start, c.span));
    })[0];
    var currentPlan = plansTodo.filter(function (p) {
      return p.start && UI.toMin(p.start) <= nowMin && nowMin < UI.toMin(p.end || p.start);
    })[0];
    var nextPlan = plansTodo.filter(function (p) { return p.start && UI.toMin(p.start) > nowMin; })[0];
    var unfinishedPlan = plansTodo.filter(function (p) { return !p.start || UI.toMin(p.start) <= nowMin; })[0];
    var firstAction, firstHref = 'plan.html';
    if (currentCourse) {
      firstAction = '正在上《' + currentCourse.name + '》，' + bellEndOf(currentCourse.start, currentCourse.span) + ' 下课';
      firstHref = 'schedule.html';
    } else if (currentPlan) {
      firstAction = '正在进行《' + currentPlan.title + '》' + (currentPlan.end ? '，' + currentPlan.end + ' 结束' : '');
    } else if (nextCourse && nextCourse.inMin <= 45) {
      firstAction = '接下来 ' + nextCourse.at + ' 上《' + nextCourse.course.name + '》 · ' + (nextCourse.course.room || '教室待定');
      firstHref = 'schedule.html';
    } else if (dueFirst) {
      firstAction = '现在先做《' + dueFirst.title + '》，今天 ' + dueFirst.due.slice(11, 16) + ' 截止';
      firstHref = 'homework.html';
    } else if (overdueFirst) {
      firstAction = '先补交《' + overdueFirst.title + '》，已逾期';
      firstHref = 'homework.html';
    } else if (lateAcademic.length) {
      firstAction = '先处理未完成的《' + lateAcademic[0].title + '》，原计划已过期';
    } else if (nextPlan) {
      firstAction = '接下来 ' + nextPlan.start + ' 做《' + nextPlan.title + '》' + (nextPlan.place ? ' · ' + nextPlan.place : '');
    } else if (unfinishedPlan) {
      firstAction = '今天还要完成《' + unfinishedPlan.title + '》';
    } else if (nextCourse) {
      firstAction = '下一节 ' + nextCourse.at + ' 上《' + nextCourse.course.name + '》 · ' + (nextCourse.course.room || '教室待定');
      firstHref = 'schedule.html';
    } else {
      firstAction = '今天暂无紧急安排，可以按自己的节奏来';
    }
    ln('🎯', firstAction, 'plain', firstHref, true);
    seg.push(firstAction);

    /* 课程只提示当前或下一节，完整课表保留在课程页。 */
    if (firstHref === 'schedule.html' && courses.length) {
      var lastCourseEnd = Math.max.apply(null, courses.map(function (c) {
        return UI.toMin(bellEndOf(c.start, c.span));
      }));
      ln('📅', '今日课程：共 ' + courses.length + ' 节，最晚 ' + UI.toHM(lastCourseEnd) + ' 下课', 'plain', 'schedule.html');
    } else if (nextCourse) {
      ln('📅', '下一节：' + nextCourse.at + '《' + nextCourse.course.name + '》 · ' + (nextCourse.course.room || '教室待定'), 'plain', 'schedule.html');
    } else {
      ln('📅', courses.length ? '今天的课已上完（共 ' + courses.length + ' 节）' : '今天没有课程安排', 'ok', 'schedule.html');
    }

    /* 作业先写今天截止的具体名称，逾期另列“待补救”，避免日期混淆。 */
    var futureHw = pending.filter(function (x) {
      var ts = UI.parseDT(x.due);
      return ts && ts >= now.getTime();
    }).sort(function (a, b) { return UI.parseDT(a.due) - UI.parseDT(b.due); })[0];
    if (dueFirst) {
      ln('📝', '今天截止：' + dueFirst.title + ' · ' + dueFirst.due.slice(11, 16) +
        (dueToday.length > 1 ? '（共 ' + dueToday.length + ' 项）' : '') + ' · 待完成共 ' + pending.length + ' 项', 'warn', 'homework.html');
    } else {
      ln('📝', pending.length ? '今天没有作业截止 · 待完成共 ' + pending.length + ' 项' +
        (futureHw ? '（最近 ' + UI.dueText(futureHw.due) + '）' : '') : '今天没有待完成作业',
        pending.length ? 'plain' : 'ok', 'homework.html');
    }
    if (overdue.length || lateAcademic.length) {
      var lateParts = [];
      if (overdue.length) lateParts.push(overdue.length + ' 项作业');
      if (lateAcademic.length) lateParts.push(lateAcademic.length + ' 项学习任务');
      ln('⚠️', '待补救：' + lateParts.join('、') + '已逾期' +
        (overdueFirst ? '，先看《' + overdueFirst.title + '》' : '，请重新安排'), 'urgent', overdueFirst ? 'homework.html' : 'plan.html');
    }

    /* 出门提醒跟在今日行动之后；天气未返回时不占一行。 */
    if (weather && weather.ok && weather.today) {
      var wt = weather.today.ico + ' ' + weather.today.text + ' ' + weather.today.tmin + '~' + weather.today.tmax + '°C';
      ln(weather.advice && weather.advice.umbrella ? '☔' : '🌤',
        '出门提醒：' + (weather.advice && weather.advice.umbrella ? '有雨，记得带伞 · ' : '') + wt,
        weather.advice && weather.advice.umbrella ? 'warn' : 'plain');
    }

    /* 课外计划保留今天项数和未来项数，让新增计划仍能在首页看到变化。 */
    var personalAll=plansAll.filter(function(p){return !Store.isAcademicTask(p);});
    var personalToday=plansToday.filter(function(p){return !Store.isAcademicTask(p);});
    var personalTodo=plansTodo.filter(function(p){return !Store.isAcademicTask(p);});
    var plansUpcoming = personalAll.filter(function (p) {
      return String(p.date || '') >= todayK && !isPlanDone(p, p.date || todayK);
    }).sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
    if (personalToday.length) {
      var nxPlan = personalTodo[0];
      var plTxt = '课外计划：今天 ' + personalToday.length + ' 项' +
        (personalTodo.length ? '，还有 ' + personalTodo.length + ' 项没完成' : '，都完成了 👍');
      if (nxPlan && nxPlan.start) plTxt += '（下一项 ' + nxPlan.start + ' ' + nxPlan.title + '）';
      /* 今天之外的待办也要说一句：不然新加一条「明天」的计划，这行看不出变化 */
      var laterPlans = plansUpcoming.filter(function (p) { return String(p.date || '') > todayK; }).length;
      if (laterPlans) plTxt += '；另有 ' + laterPlans + ' 项在之后';
      ln('🧭', plTxt, personalTodo.length ? 'plain' : 'ok');
    } else if (plansUpcoming.length) {
      ln('🧭', '课外计划：今天 0 项，之后还有 ' + plansUpcoming.length + ' 项（最近 ' +
        fmtMD(plansUpcoming[0].date) + '）', 'plain');
    } else {
      ln('🧭', '课外计划：今天 0 项', 'plain');
    }

    /* 已应用的课程调整 */
    if (adjustAppliedToday.length) {
      ln('🔔', '课表已按课程调整更新（今天 ' + adjustAppliedToday.length + ' 门课有调整）', 'ok');
    }
    var summary = '今天的建议：' + seg.join('，') + '。';

    var workHours = pending.reduce(function (n, x) { return n + (x.hours || 0); }, 0);
    var todayHours = dueToday.concat(overdue).reduce(function (n, x) { return n + (x.hours || 0); }, 0);

    return {
      date: todayK, weekday: wi.weekday, week: wi.week, nowMin: nowMin,
      weather: weather || null,
      courses: courses, plans: plansToday, plansTodo: plansTodo,
      timeline: tl, focus: focus, priority: prio,
      nowItems: nowItems, nextCourse: nextCourse, nextTl: nextTl,
      overdue: overdue, dueToday: dueToday, dueSoon: dueSoon,
      summary: summary,
      summaryLines: lines,
      counts: {
        courses: courses.length,
        dueToday: dueToday.length,
        dueSoon: dueSoon.length,
        overdue: overdue.length,
        plansLeft: personalTodo.length,
        plansDone: personalToday.length - personalTodo.length,
        hwDone: hwDone,
        focusMin: focus.reduce(function (n, f) { return n + f.minutes; }, 0)
      },
      workload: { total: Math.round(workHours * 10) / 10, today: Math.round(todayHours * 10) / 10 }
    };
  }

  /* ==========================================================
     渲染片段（首页 / 规划页共用）
     ========================================================== */

  /* 「9 月 30 日」这类展示用的短日期（不用 UI.fmtDate，那是 YYYY-MM-DD） */
  function fmtMD(k) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(k || ''));
    return m ? (parseInt(m[2], 10) + ' 月 ' + parseInt(m[3], 10) + ' 日') : String(k || '');
  }

  /* 规划总结：一条一行。首页 Hero 与规划页共用同一份渲染，别各写一份。
     每行还能点：点「作业」去作业页、点「课外计划」去规划页……省得学生自己找入口。 */
  var LINE_HREF = {
    '📅': 'schedule.html',
    '📝': 'homework.html',
    '🧭': 'plan.html',
    '🔔': 'schedule.html',
    '🎯': 'plan.html'
  };
  function summaryLinesHtml(p) {
    if (!p || !p.summaryLines || !p.summaryLines.length) return '';
    return p.summaryLines.map(function (x) {
      var tone = x.tone || 'plain';
      var inner = '<span class="sl-i">' + x.ico + '</span><span class="sl-t">' + UI.esc(x.text) + '</span>';
      var href = x.href || LINE_HREF[x.ico];
      var cls = 'sum-line t-' + tone + (x.featured ? ' is-primary' : '');
      if (!href) return '<div class="' + cls + '">' + inner + '</div>';
      return '<a class="' + cls + '" href="' + href + '" title="去处理">' + inner +
        '<span class="sl-go">›</span></a>';
    }).join('');
  }

  /* 总结区顶部的小徽标：逾期 / 今天截止 / 今天待办 / 今天几节课 */
  function summaryBadgesHtml(p) {
    var c = (p && p.counts) || {};
    var out = [];
    if (c.overdue) out.push('<span class="sum-badge urgent">逾期 ' + c.overdue + '</span>');
    if (c.dueToday) out.push('<span class="sum-badge warn">今天截止 ' + c.dueToday + '</span>');
    if (c.plansLeft) out.push('<span class="sum-badge">今天待办 ' + c.plansLeft + '</span>');
    if (c.courses) out.push('<span class="sum-badge plain">' + c.courses + ' 节课</span>');
    if (!out.length) out.push('<span class="sum-badge ok">今天没有紧急事项</span>');
    return out.join('');
  }

  /* 优先级清单 */
  function priorityHtml(p, limit, editable) {
    var list = p.priority.slice(0, limit || p.priority.length);
    if (!list.length) {
      return UI.emptyState('🎉', '没有待办事项，今天可以放松一下～');
    }
    return list.map(function (x, i) {
      return '<div class="prio' + (x.urgent ? ' urgent' : '') + '" data-prio="' + x.kind + ':' + x.id + '">' +
        '<div class="prio-rank' + (i === 0 ? ' top' : '') + '">' + (i + 1) + '</div>' +
        '<div class="prio-body">' +
          '<div class="prio-title"><span class="pi">' + x.ico + '</span>' + UI.esc(x.title) +
            '<span class="badge ' + x.tag.cls + '">' + x.tag.t + '</span>' +
            (x.urgent ? '<span class="badge badge-red">逾期</span>' : '') +
          '</div>' +
          '<div class="prio-sub">' + UI.esc(x.sub) + ' · ' + UI.esc(x.why) + '</div>' +
        '</div>' +
        '<div class="prio-short">' + UI.esc(x.short) + '</div>' +
        (editable&&x.kind==='plan'?'<button class="btn btn-sm" data-edit="'+UI.esc(x.id)+'">编辑</button>':'<a class="btn btn-sm" href="'+x.href+'">处理</a>') +
      '</div>';
    }).join('');
  }

  /* 时间轴 */
  function timelineHtml(p) {
    if (!p.timeline.length) return UI.emptyState('🌤️', '今天没有固定安排，时间全是你的');
    var nowDrawn = false;
    var rows = '';
    p.timeline.forEach(function (x) {
      if (!nowDrawn && x.from > p.nowMin) {
        rows += '<div class="tl-now"><span>现在 ' + UI.toHM(p.nowMin) + '</span></div>';
        nowDrawn = true;
      }
      var now = p.nowMin >= x.from && p.nowMin < x.to;
      var past = x.kind !== 'reminder' && p.nowMin >= x.to;
      var style = x.kind === 'course' ? ' style="--c:' + x.color + '"' : '';
      rows += '<div class="tl-item ' + x.kind + (past ? ' past' : '') + (now ? ' now' : '') + (x.done ? ' done' : '') + '"' + style + '>' +
        '<div class="tl-time">' + UI.esc(x.timeLabel || UI.toHM(x.from)) +
          (x.to > x.from ? '<small>' + UI.toHM(x.to) + '</small>' : '') + '</div>' +
        '<div class="tl-dot">' + x.ico + '</div>' +
        '<div class="tl-body"><b>' + UI.esc(x.title) + '</b>' +
          (x.sub ? '<small>' + UI.esc(x.sub) + '</small>' : '') + '</div>' +
        (x.tag ? '<span class="badge badge-yellow">' + UI.esc(x.tag) + '</span>' : '') +
        (now ? '<span class="badge badge-blue">进行中</span>' : '') +
      '</div>';
    });
    if (!nowDrawn) rows += '<div class="tl-now"><span>现在 ' + UI.toHM(p.nowMin) + '</span></div>';
    return '<div class="tl">' + rows + '</div>';
  }

  /* 空档建议 */
  function focusHtml(p) {
    if (!p.focus.length) {
      /* 空档为空的三种原因要分清，否则晚上打开会像“坏了”：①本来没待办 ②今天已收尾（距 22:00 不足一场专注）③真排满了 */
      var left = DAY_END - p.nowMin;
      if (!p.workload.total) {
        return '<div class="focus-empty">今天没有待完成的作业，空档自由安排 🎈</div>';
      }
      if (left < MIN_GAP) {
        return '<div class="focus-empty">' +
          (left > 0 ? '距离 22:00 只剩 ' + left + ' 分钟' : '现在已经过了 22:00') +
          '，不够安排一场专注（至少 ' + MIN_GAP + ' 分钟）。今天的作业先记着，明早 08:00 起会重新排。' +
          (p.counts.hwDone ? '（已完成 ' + p.counts.hwDone + ' 项 👍）' : '') + '</div>';
      }
      return '<div class="focus-empty">今天的空档都排满了，或者没有待完成的作业。' +
        (p.counts.hwDone ? '（已完成 ' + p.counts.hwDone + ' 项作业 👍）' : '') + '</div>';
    }
    return '<div class="focus-list">' + p.focus.map(function (f) {
      return '<div class="focus-item">' +
        '<div class="fi-time">' + UI.toHM(f.from) + '<small>' + UI.toHM(f.to) + '</small></div>' +
        '<div class="fi-body"><b>' + UI.esc(f.course) + '</b><small>' + UI.esc(f.title) + '</small></div>' +
        '<span class="badge ' + UI.LEVELS[f.level].cls + '">' + UI.LEVELS[f.level].t + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  return {
    TYPES: TYPES, TYPE_ICO: TYPE_ICO, MEALS: MEALS,
    build: build, planOnDay: planOnDay, isPlanDone: isPlanDone, nextPlanOccurrence: nextPlanOccurrence, typeIco: typeIco,
    scoreHw: scoreHw, scorePlan: scorePlan,
    priorityHtml: priorityHtml, timelineHtml: timelineHtml, focusHtml: focusHtml,
    summaryLinesHtml: summaryLinesHtml, summaryBadgesHtml: summaryBadgesHtml
  };
})();
