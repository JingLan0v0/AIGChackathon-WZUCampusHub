/* ==========================================================
   教务调停课通知 · 解析引擎
   ----------------------------------------------------------
   从「新教务系统 › 教务通知 › 调停课通知」里能抓到的只有一段原文，例如：

     【调课通知】《数据结构》原定第3周周二第6-7节，教室为计算机楼-408。
     因任课教师陈立老师赴杭州参加学术会议，调整至第3周周四第5-6节，
     上课地点改为计算机楼-402，请同学们相互转告。

   本模块负责：
     1) 把原文解析成结构化数据（课程 / 原时间 / 新时间 / 教室 / 原因 / 类型）
     2) 学生确认后，把调整作用到课表与今日规划上（由 Store.coursesOn 计算生效课表）
   ========================================================== */
var Adjust = (function () {
  /* 星期中文字 → 数字 */
  var DAY = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

  /* 五种通知类型 */
  var TYPE = {
    move: { t: '调课', ico: '🔁', cls: 'badge-blue' },
    make: { t: '补课', ico: '➕', cls: 'badge-green' },
    cancel: { t: '停课', ico: '⛔', cls: 'badge-red' },
    room: { t: '换教室', ico: '📍', cls: 'badge-yellow' },
    other: { t: '教务通知', ico: '📢', cls: 'badge-grey' }
  };

  /* 时间槽：必须同时含「第X周」「周X」「第Y节」，避免把「顺延至第17周同一时间」误认成一次课 */
  var RE_TIME = /第\s*(\d+)\s*周[^，。；、（）()]{0,10}?周\s*([一二三四五六日天])(?:[^，。；、（）()]{0,6}?)第\s*(\d+)\s*(?:[-–~－—]\s*(\d+))?\s*节/g;
  /* 教室槽：计算机楼-408 / 教A-105 / 物理楼-201（后半必须是数字或字母，避免匹配「学院」）
     注意：前缀是变长汉字，正则从最早的位置开始匹配，于是「上课地点改为计算机楼-402」
     会把「点改为」一起吃掉。所以匹配完再剥掉开头的连接词 / 动词，只留建筑名。 */
  var RE_ROOM = /[\u4e00-\u9fa5]{1,6}(?:楼|馆|场)\s*[-－]?\s*[0-9A-Za-z]{1,6}|教[0-9A-Z]\s*[-－]?\s*\d{2,4}/g;
  var RE_LEAD = /^(?:上|课|地|点|的|室|楼|为|改|到|至|在|由|于|是|将|调|整|换|变|次|间|时|不|仍)+/;

  function cleanRoom(s) {
    return String(s || '').replace(/[－]/g, '-').replace(/\s+/g, '').replace(RE_LEAD, '');
  }
  var RE_COURSE = /《([^》]+)》/;
  var RE_REASON = /(?:因|由于)([^，。；]+)/;

  function typeMeta(t) { return TYPE[t] || TYPE.other; }
  function dayName(d) { return ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][d] || ''; }

  /* 节次 → 上下课时间（'13:30–14:55'） */
  function bell(start, span) {
    return UI.bellRange(start, span);
  }

  function clone(o) {
    var r = {};
    Object.keys(o || {}).forEach(function (k) { r[k] = o[k]; });
    return r;
  }
  function parseTime(s) {
    if (!s) return Date.now();
    var t = new Date(String(s).replace(' ', 'T')).getTime();
    return isNaN(t) ? Date.now() : t;
  }
  function findCourse(db, name) {
    if (!name) return null;
    var hit = (db.courses || []).filter(function (c) { return c.name === name; });
    return hit[0] || null;
  }

  /* ---------- 1. 槽位扫描：把原文里的「时间」「教室」按出现位置抓出来 ---------- */
  function scan(text) {
    var slots = [], m;
    RE_TIME.lastIndex = 0;
    while ((m = RE_TIME.exec(text))) {
      slots.push({
        kind: 'time', pos: m.index,
        week: parseInt(m[1], 10),
        day: DAY[m[2]] || 0,
        start: parseInt(m[3], 10),
        span: m[4] ? Math.max(1, parseInt(m[4], 10) - parseInt(m[3], 10) + 1) : 1
      });
    }
    RE_ROOM.lastIndex = 0;
    while ((m = RE_ROOM.exec(text))) {
      slots.push({ kind: 'room', pos: m.index, room: cleanRoom(m[0]) });
    }
    return slots.sort(function (a, b) { return a.pos - b.pos; });
  }

  /* 每个时间槽吸收它后面最近的、还没被用掉的教室槽（这就是「这门课在哪个教室」） */
  function toTimes(slots) {
    var out = [];
    slots.forEach(function (s, i) {
      if (s.kind !== 'time') return;
      var room = null;
      for (var j = i + 1; j < slots.length; j++) {
        if (slots[j].kind === 'time') break;
        if (slots[j].kind === 'room' && !slots[j].used) { room = slots[j].room; slots[j].used = true; break; }
      }
      out.push({ week: s.week, day: s.day, start: s.start, span: s.span, room: room });
    });
    return out;
  }

  /* ---------- 2. 解析单条教务通知 ---------- */
  function parseOne(raw, db) {
    db = db || Store.load();
    var body = String(raw.body || raw.title || '');
    var title = String(raw.title || '');
    var slots = scan(body);
    var times = toTimes(slots);
    var rooms = slots.filter(function (s) { return s.kind === 'room'; });

    var cm = body.match(RE_COURSE) || title.match(RE_COURSE);
    var course = cm ? cm[1] : '';
    var rm = body.match(RE_REASON);
    var reason = rm ? rm[1] : '';

    /* 类型判定：先看关键字，再看结构（两个时间槽 = 调课，两个教室槽 = 换教室） */
    var type;
    if (/停课/.test(body)) type = 'cancel';
    else if (/增加一次课|加课|补课|补授/.test(body)) type = 'make';
    else if (/换教室|教室调整|教室变更|上课地点由/.test(body)) type = 'room';
    else if (times.length >= 2) type = 'move';
    else if (rooms.length >= 2) type = 'room';
    else if (/调课|调整/.test(body)) type = 'move';
    else type = 'other';

    var from = null, to = null, needReview = false;
    if (type === 'move') {
      from = times[0] || null;
      to = times.length >= 2 ? clone(times[times.length - 1]) : null;
      if (!from || !to) needReview = true;
    } else if (type === 'cancel') {
      from = times[0] || null;
      if (!from) needReview = true;
    } else if (type === 'make') {
      to = times[0] || null;
      if (!to) needReview = true;
    } else if (type === 'room') {
      from = times[0] ? clone(times[0]) : null;
      if (from) {
        to = clone(from);
        /* 原文里出现两个教室 → 后一个是新教室；只出现一个（「教室不变」）则沿用原教室 */
        var last = rooms[rooms.length - 1];
        to.room = (rooms.length >= 2 && last) ? last.room : from.room;
      }
      if (!from || !to || !to.room) needReview = true;
    }

    /* 兜底：原文没写教室时，用本地课表里这门课原本的教室补上 */
    var c0 = findCourse(db, course);
    if (c0) {
      if (from && !from.room) from.room = c0.room;
      if (to && !to.room && type === 'move') to.room = c0.room;
    }

    return {
      no: raw.no,
      id: raw.no,
      category: raw.category || '教务通知',
      title: title,
      body: body,
      publisher: raw.publisher || '',
      path: raw.path || Store.NOTICE_SOURCE,
      publishedAt: parseTime(raw.publishedAt),
      course: course,
      courseId: c0 ? c0.id : '',
      teacher: c0 ? c0.teacher : '',
      color: c0 ? c0.color : '#F79009',
      type: type,
      from: from,
      to: to,
      week: from ? from.week : (to ? to.week : 0),
      reason: reason,
      needReview: needReview,
      /* 历史通知（已过期的）默认算作已读已处理，避免演示时堆一堆没用提醒 */
      read: !!raw.legacy,
      applied: !!raw.legacy && type !== 'other'
    };
  }

  /* ---------- 3. 抓取 + 解析 + 入库（去重） ---------- */
  function sync() {
    var res = Store.syncNotices();
    var items = (res && res.items) || (Array.isArray(res) ? res : []);
    var db = Store.load();
    if (!Array.isArray(db.courseNotices)) db.courseNotices = [];

    var added = 0, updated = 0;
    items.forEach(function (raw) {
      var p = parseOne(raw, db);
      var old = db.courseNotices.filter(function (a) { return a.no === p.no; })[0];
      if (old) {
        /* 已读 / 已应用是学生自己点出来的状态，重新同步时不能丢 */
        var keepRead = old.read || p.read, keepApplied = !!old.applied;
        Object.keys(p).forEach(function (k) { old[k] = p[k]; });
        old.read = keepRead;
        old.applied = keepApplied;
        updated++;
      } else {
        db.courseNotices.push(p);
        added++;
      }
    });
    db.courseNotices.sort(function (a, b) { return (b.publishedAt || 0) - (a.publishedAt || 0); });

    db.sync = db.sync || {};
    db.sync.noticesAt = Date.now();
    db.sync.noticeSource = (res && res.source) || Store.NOTICE_SOURCE;
    db.sync.noticeLive = !!(res && res.session && res.session.live);
    /* 内置演示样本（只有演示账号会拿到）；真实学号拿不到就是空，没有任何编造 */
    db.sync.noticeSample = !!(res && res.session && res.session.sample);
    Store.save();
    return {
      added: added, updated: updated, total: db.courseNotices.length,
      at: db.sync.noticesAt, source: db.sync.noticeSource,
      live: db.sync.noticeLive, sample: db.sync.noticeSample
    };
  }

  /* 首页 AI 核对后直接写入本机课表调整，不伪装成教务系统通知。 */
  function addManual(args) {
    var db = Store.load();
    var matching = (db.courses || []).filter(function (c) { return c.name === args.course; });
    var course = matching.filter(function (c) {
      return c.day === args.fromDay && c.start === args.fromStart && c.span === args.fromSpan &&
        args.fromWeek >= c.from && args.fromWeek <= c.to;
    })[0] || matching[0] || null;
    if (args.type !== 'make' && (!course || course.day !== args.fromDay || course.start !== args.fromStart ||
        course.span !== args.fromSpan || args.fromWeek < course.from || args.fromWeek > course.to)) {
      throw new Error('原课程时间与当前课表不一致，请核对课程名、周次和节次。');
    }
    function slot(prefix) {
      if (!args[prefix + 'Week']) return null;
      return {week: args[prefix + 'Week'], day: args[prefix + 'Day'], start: args[prefix + 'Start'],
        span: args[prefix + 'Span'], room: args[prefix + 'Room'] || (course && course.room) || ''};
    }
    var from = slot('from'), to = slot('to');
    if (args.type === 'room') {
      to = clone(from);
      to.room = args.toRoom;
    }
    if (args.type === 'move' && !args.toRoom && course && course.room) to.room = course.room;
    var item = {no: Store.uid('adj-'), id: '', origin: 'assistant', category: '手动课程调整',
      title: args.course + '课程调整', body: '', publisher: '本人确认', path: '',
      publishedAt: Date.now(), course: args.course, courseId: course ? course.id : '',
      teacher: course ? course.teacher : '', color: course ? course.color : '#F79009',
      type: args.type, from: from, to: to, week: from ? from.week : to.week,
      reason: args.reason || '', needReview: false, read: true, applied: true};
    item.id = item.no;
    db.courseNotices = db.courseNotices || [];
    if (db.courseNotices.some(function (old) {
      return old.origin === 'assistant' && old.type === item.type && old.course === item.course &&
        JSON.stringify(old.from) === JSON.stringify(item.from) && JSON.stringify(old.to) === JSON.stringify(item.to);
    })) throw new Error('相同的课程调整已经添加过了。');
    db.courseNotices.unshift(item);
    Store.save();
    return item;
  }
  function removeManual(no) {
    var db = Store.load(), item = (db.courseNotices || []).filter(function (a) { return a.no === no; })[0];
    if (!item || item.origin !== 'assistant') throw new Error('只能删除通过 AI 添加的课程调整。');
    db.courseNotices = db.courseNotices.filter(function (a) { return a.no !== no; });
    Store.save();
    return item;
  }

  /* 登录后自动抓一次（对应需求「自动看老师调课消息」）。
     首次进入任意页面时触发；真实版这里换成带网络请求的异步版本即可。 */
  function ensure() {
    var db = Store.load();
    if (!db.auth || !db.auth.logged) return null;
    if (db.sync && db.sync.noticesAt) return null;
    return sync();
  }

  /* ---------- 4. 查询 ---------- */
  function list() { return (Store.load().courseNotices || []).slice(); }
  function byId(no) {
    var hit = list().filter(function (a) { return a.no === no; });
    return hit[0] || null;
  }
  function unread() { return list().filter(function (a) { return !a.read; }); }
  function pending() {
    return list().filter(function (a) { return !a.applied && a.type !== 'other'; });
  }
  /* 未处理、且会动到今天课表的 */
  function todayPending() {
    var wi = UI.weekInfo();
    return pending().filter(function (a) {
      if (a.from && a.from.week === wi.week && a.from.day === wi.weekday) return true;
      if (a.to && a.to.week === wi.week && a.to.day === wi.weekday) return true;
      return false;
    });
  }

  /* ---------- 5. 状态操作 ---------- */
  function markRead(no, v) {
    var a = byId(no);
    if (!a) return false;
    a.read = v === undefined ? true : !!v;
    Store.save();
    return true;
  }
  function markAllRead() {
    list().forEach(function (a) { a.read = true; });
    Store.save();
  }
  function apply(no) {
    var a = byId(no);
    if (!a || a.type === 'other') return false;
    a.applied = true;
    a.read = true;
    Store.save();
    return true;
  }
  function unapply(no) {
    var a = byId(no);
    if (!a) return false;
    a.applied = false;
    Store.save();
    return true;
  }

  /* ---------- 6. 文案 ---------- */
  function slotText(sl) {
    if (!sl) return '—';
    var t = '第 ' + sl.week + ' 周 ' + dayName(sl.day) +
      ' 第 ' + sl.start + (sl.span > 1 ? '-' + (sl.start + sl.span - 1) : '') + ' 节';
    var hm = bell(sl.start, sl.span);
    if (hm) t += '（' + hm + '）';
    if (sl.room) t += ' · ' + sl.room;
    return t;
  }
  function slotShort(sl) {
    if (!sl) return '—';
    return '第' + sl.week + '周' + dayName(sl.day) + '第' + sl.start +
      (sl.span > 1 ? '-' + (sl.start + sl.span - 1) : '') + '节' + (sl.room ? ' · ' + sl.room : '');
  }

  function oneLine(a) {
    if (a.type === 'move') return a.course + '：' + slotShort(a.from) + ' → ' + slotShort(a.to);
    if (a.type === 'cancel') return a.course + '：' + slotShort(a.from) + ' 本次停课';
    if (a.type === 'make') return a.course + '：' + slotShort(a.to) + ' 增加一次课';
    if (a.type === 'room') return a.course + '：' + slotShort(a.from).split(' · ')[0] + ' 教室改为 ' + ((a.to && a.to.room) || '—');
    return a.title;
  }

  function preview(a) {
    if (a.type === 'move') return '应用后：这门课从原时间移走，落到 ' + slotShort(a.to) + '，空出来的时段会被今日规划自动安排作业。';
    if (a.type === 'cancel') return '应用后：课表与今日规划都不再计入这一节。';
    if (a.type === 'make') return '应用后：课表会新增「' + slotShort(a.to) + '」，并计入当日课量。';
    if (a.type === 'room') return '应用后：上课时间不变，教室改为 ' + ((a.to && a.to.room) || '—') + '。';
    return '这条是普通教务通知，不会改动课表。';
  }

  /* ---------- 7. 渲染 ---------- */
  function line(tag, sl, cls) {
    return '<div class="adj-line ' + cls + '">' +
      '<span class="adj-tag">' + tag + '</span>' +
      '<span>' + UI.esc(slotText(sl)) + '</span></div>';
  }
  function linesHtml(a) {
    if (a.type === 'move' || a.type === 'room') {
      return line('原', a.from, 'old') + '<div class="adj-arrow">↓</div>' + line('新', a.to, 'new');
    }
    if (a.type === 'cancel') return line('停', a.from, 'old');
    if (a.type === 'make') return line('加', a.to, 'new');
    return '<div class="adj-line"><span class="adj-tag">·</span><span>' + UI.esc(a.title) + '</span></div>';
  }

  function cardHtml(a) {
    var meta = typeMeta(a.type);
    return '<div class="adj-card' + (a.read ? '' : ' unread') + '">' +
      '<div class="adj-head">' +
        '<span class="badge ' + meta.cls + '">' + meta.ico + ' ' + meta.t + '</span>' +
        '<b class="adj-course">' + UI.esc(a.course || a.title) + '</b>' +
        (a.applied
          ? '<span class="badge badge-green">已应用到课表</span>'
          : (a.read ? '' : '<span class="badge badge-red">未处理</span>')) +
        (a.needReview ? '<span class="badge badge-grey">待人工确认</span>' : '') +
        '<span class="adj-when">' + UI.esc(UI.timeAgo(a.publishedAt)) + '</span>' +
      '</div>' +
      '<div class="adj-lines">' + linesHtml(a) + '</div>' +
      (a.reason ? '<div class="adj-why">📌 ' + UI.esc(a.reason) + '</div>' : '') +
      '<div class="adj-meta">' + UI.esc(a.publisher) + ' · ' + UI.esc(a.category) +
        ' · 通知编号 ' + UI.esc(a.no) + '</div>' +
      '<div class="adj-acts">' +
        (a.applied
          ? '<button class="btn btn-sm" data-unapply="' + UI.esc(a.no) + '">撤销调整</button>'
          : (a.type === 'other' ? '' : '<button class="btn btn-sm btn-primary" data-apply="' + UI.esc(a.no) + '">✓ 应用到我的课表</button>')) +
        (a.read ? '' : '<button class="btn btn-sm" data-read="' + UI.esc(a.no) + '">标记已读</button>') +
        '<button class="btn btn-sm" data-origin="' + UI.esc(a.no) + '">查看教务原文</button>' +
      '</div>' +
    '</div>';
  }

  /* 首页 / 规划页顶部的提醒条 */
  function bannerHtml() {
    var p = pending();
    if (!p.length) return '';
    var lead = p[0];
    var sub = oneLine(lead) + (p.length > 1 ? '　等 ' + p.length + ' 条' : '');
    return '<div class="adj-banner">' +
      '<div class="ab-ico">🔔</div>' +
      '<div class="ab-body">' +
        '<b>教务系统有 ' + p.length + ' 条调课通知待处理</b>' +
        '<small>' + UI.esc(sub) + '</small>' +
      '</div>' +
      '<a class="btn btn-sm btn-primary" href="schedule.html#scheduleNotices">查看并处理</a>' +
    '</div>';
  }

  return {
    TYPE: TYPE, typeMeta: typeMeta, dayName: dayName, bell: bell,
    slotText: slotText, slotShort: slotShort,
    scan: scan, toTimes: toTimes, parseOne: parseOne,
    sync: sync, ensure: ensure, addManual: addManual, removeManual: removeManual,
    list: list, byId: byId, unread: unread, pending: pending, todayPending: todayPending,
    markRead: markRead, markAllRead: markAllRead, apply: apply, unapply: unapply,
    oneLine: oneLine, preview: preview, cardHtml: cardHtml, bannerHtml: bannerHtml
  };
})();
