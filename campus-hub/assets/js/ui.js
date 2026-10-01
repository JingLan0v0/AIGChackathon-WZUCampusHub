/* ==========================================================
   校园百事通 · 公共 UI 层
   顶栏导航 / 底部标签栏 / 模态框 / Toast / 通用小工具
   ========================================================== */
var UI = (function () {
  /* 模块导航只做顺序淡出、淡入，不对页面尺寸做补间。 */
  if (typeof window !== 'undefined' && window.addEventListener) {
    var navigating = false;
    var warmedPages = {};
    function warmPage(event) {
      var link = event.target.closest('.topnav a, .tabbar a, a.brand');
      if (!link || link.target) return;
      var next = new URL(link.href, location.href);
      if (next.origin !== location.origin || next.pathname === location.pathname || warmedPages[next.pathname]) return;
      warmedPages[next.pathname] = true;
      var preload = document.createElement('link');
      preload.rel = 'prefetch'; preload.as = 'document'; preload.href = next.href;
      document.head.appendChild(preload);
    }
    document.addEventListener('pointerover', warmPage);
    document.addEventListener('focusin', warmPage);
    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      var link = event.target.closest('.topnav a, .tabbar a, a.brand');
      if (!link || link.target || link.hasAttribute('download')) return;
      var next = new URL(link.href, location.href);
      if (next.origin !== location.origin || next.pathname === location.pathname) return;
      var content = document.getElementById('page');
      if (!content || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      event.preventDefault();
      if (navigating) return;
      navigating = true;
      var completed = false;
      function go() {
        if (completed) return;
        completed = true;
        location.href = next.href;
      }
      content.addEventListener('animationend', function (animation) {
        if (animation.target === content && animation.animationName === 'module-leave') go();
      });
      content.classList.add('module-leaving');
      setTimeout(go, 120);
    });
    window.addEventListener('pageshow', function (event) {
      navigating = false;
      var content = document.getElementById('page');
      if (content) content.classList.remove('module-leaving');
    });
  }
  /* 桌面顶栏导航 */
  var NAV = [
    { href: 'home.html', key: 'home', label: '首页', icon: '🏠' },
    { href: 'plan.html', key: 'plan', label: '今日规划', icon: '🧭' },
    { href: 'schedule.html', key: 'schedule', label: '课表', icon: '📅' },
    { href: 'homework.html', key: 'homework', label: '作业', icon: '📝' },
    { href: 'lost.html', key: 'lost', label: '失物', icon: '🔍' },
    { href: 'qa.html', key: 'qa', label: '问答', icon: '💬' }
  ];

  /* 移动端底部标签栏：只放最高频的 5 个 */
  var TABS = [
    { href: 'home.html', key: 'home', label: '首页', icon: '🏠' },
    { href: 'plan.html', key: 'plan', label: '规划', icon: '🧭' },
    { href: 'schedule.html', key: 'schedule', label: '课表', icon: '📅' },
    { href: 'homework.html', key: 'homework', label: '作业', icon: '📝' },
    { href: 'me.html', key: 'me', label: '我的', icon: '👤' }
  ];

  /* 重要度（作业 / 计划共用） */
  var LEVELS = {
    1: { t: '低', cls: 'badge-grey' },
    2: { t: '中', cls: 'badge-yellow' },
    3: { t: '高', cls: 'badge-red' }
  };

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------- 挂载页面骨架 ---------- */
  function mount(opt) {
    opt = opt || {};
    var page = opt.page || 'home';
    var db = Store.load();
    var sid = (db.auth && db.auth.sid) ? db.auth.sid : '';
    var navHtml = NAV.map(function (n) {
      return '<a href="' + n.href + '" class="' + (n.key === page ? 'on' : '') + '">' +
        '<span>' + n.icon + '</span>' + n.label + '</a>';
    }).join('');
    var tabHtml = TABS.map(function (n) {
      return '<a href="' + n.href + '" class="' + (n.key === page ? 'on' : '') + '"><i>' + n.icon + '</i>' + n.label + '</a>';
    }).join('');

    document.body.insertAdjacentHTML('afterbegin',
      '<header class="topbar"><div class="topbar-in">' +
        '<a class="brand" href="home.html">' +
          '<div class="brand-logo">通</div>' +
          '<div class="brand-txt"><strong>校园百事通</strong><span>温州大学 · 一站式校园助手</span></div>' +
        '</a>' +
        '<nav class="topnav">' + navHtml + '</nav>' +
        '<div class="topbar-right">' +
          '<a class="userchip only-desktop" href="me.html" title="已绑定学号 ' + esc(sid) + '">' +
            '<span class="av">' + esc(db.user.avatar) + '</span>' + esc(db.user.nickname) +
            (sid ? '<span class="sid">' + esc(sid) + '</span>' : '') +
          '</a>' +
          '<button class="icon-btn only-desktop" id="logoutBtn" title="退出登录">⏻</button>' +
        '</div>' +
      '</div></header>' +
      '<main class="container" id="page"></main>' +
      '<nav class="tabbar">' + tabHtml + '</nav>' +
      '<div class="modal-root" id="modalRoot"></div>' +
      '<div class="toast-root" id="toastRoot"></div>');

    /* 退出登录 */
    var lb = document.getElementById('logoutBtn');
    if (lb) lb.onclick = function () {
      confirm('退出后需要重新输入学号密码登录，本机数据不会丢失。确定退出吗？', '退出登录').then(function (ok) {
        if (!ok) return;
        Store.logout();
        location.href = 'index.html';
      });
    };

    return document.getElementById('page');
  }

  /* ---------- 页头 ---------- */
  function head(opt) {
    return '<div class="page-head">' +
      '<div><h2>' + opt.title + '</h2>' + (opt.sub ? '<div class="sub">' + opt.sub + '</div>' : '') + '</div>' +
      '<div class="grow"></div>' +
      (opt.actions || '') +
      '</div>';
  }

  function emptyState(emoji, text) {
    return '<div class="empty"><div class="e">' + emoji + '</div><p>' + text + '</p></div>';
  }

  /* ---------- Toast ---------- */
  function toast(msg, type) {
    var root = document.getElementById('toastRoot');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = (type === 'ok' ? '✅ ' : type === 'err' ? '⚠️ ' : '') + esc(msg);
    root.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(function () { el.remove(); }, 260);
    }, 2300);
  }

  /* ---------- 模态框 ----------
     支持多层叠加：在「新建作业」表单上再弹一个确认框，不会把下面的表单冲掉。
     onMount 拿到的 scope 是整个 .modal（含页脚按钮），
     所以 UI.qs('#saveBtn', scope) 这种写法对「页脚里的主按钮」同样有效。 */
  var layers = [];

  function modal(opt) {
    opt = opt || {};
    var root = document.getElementById('modalRoot');
    if (!root) return { close: function () {}, el: null };

    var layer = document.createElement('div');
    layer.className = 'modal-backdrop';
    layer.innerHTML =
      '<div class="modal' + (opt.size === 'lg' ? ' modal-lg' : '') + '">' +
        '<div class="modal-head"><h3>' + esc(opt.title || '') + '</h3><button class="icon-btn" data-close>✕</button></div>' +
        '<div class="modal-body">' + (opt.body || '') + '</div>' +
        (opt.footer ? '<div class="modal-foot">' + opt.footer + '</div>' : '') +
      '</div>';
    root.appendChild(layer);
    root.classList.add('open');
    document.body.style.overflow = 'hidden';

    var closed = false;
    var api = { el: layer, close: close };
    layer.style.zIndex = String(10 + layers.length * 2);   // 后开的叠在上面
    layers.push(api);

    function isTop() { return layers[layers.length - 1] === api; }

    function close() {
      if (closed) return;
      closed = true;
      var i = layers.indexOf(api);
      if (i >= 0) layers.splice(i, 1);
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      document.removeEventListener('keydown', onKey);
      if (!layers.length) {                 // 最后一层关掉才真正收起
        root.classList.remove('open');
        root.innerHTML = '';
        document.body.style.overflow = '';
      }
      if (opt.onClose) opt.onClose();
    }

    function onKey(e) {
      if (e.key === 'Escape' && isTop()) close();   // Esc 只关最上面那层
    }

    qsa('[data-close]', layer).forEach(function (b) { b.onclick = close; });
    layer.addEventListener('mousedown', function (e) {
      if (e.target === layer && isTop()) close();   // 点遮罩只关最上面那层
    });
    document.addEventListener('keydown', onKey);

    var scope = qs('.modal', layer);
    if (opt.onMount) opt.onMount(scope, close);
    return api;
  }

  /* 确认框：无论用「确定 / 取消 / ✕ / Esc / 点遮罩」哪种方式关掉，Promise 都会 resolve */
  function confirm(msg, okText) {
    return new Promise(function (resolve) {
      var decided = false;
      function done(v) { if (decided) return; decided = true; resolve(v); }
      modal({
        title: '请确认',
        body: '<p style="color:var(--text-2);font-size:14px">' + esc(msg) + '</p>',
        footer: '<button class="btn" data-no>取消</button><button class="btn btn-primary" data-yes>' + esc(okText || '确定') + '</button>',
        onClose: function () { done(false); },
        onMount: function (scope, close) {
          qs('[data-no]', scope).onclick = function () { done(false); close(); };
          qs('[data-yes]', scope).onclick = function () { done(true); close(); };
        }
      });
    });
  }

  /* ---------- 时间 ---------- */
  function timeAgo(ts) {
    var diff = Date.now() - ts;
    var m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    var d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    var dt = new Date(ts);
    return (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* ---------- 学期周次 ---------- */
  function weekInfo() {
    var db = Store.load();
    var start = new Date(db.user.termStart + 'T00:00:00');
    var now = new Date();
    var d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.floor((d0 - new Date(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000);
    var week = Math.max(1, Math.floor(days / 7) + 1);
    var weekday = now.getDay() === 0 ? 7 : now.getDay();
    return { week: week, weekday: weekday, total: 18, termStart: db.user.termStart };
  }

  function weekdayName(n) { return ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][n] || ''; }

  /* ---------- 课程节次时间表 ----------
     按学生提供的课表截图：上午 1~5 节、下午 6~10 节、晚上 11~13 节。
     每节 40 分钟；第 2/3、7/8、10/11 节之间有较长课间，不按固定间隔推算。 */
  var BELLS = [
    '08:20', '09:05', '10:10', '10:55', '11:40',
    '13:30', '14:15', '15:20', '16:05', '16:50',
    '18:30', '19:15', '20:00'
  ];
  /* 与 BELLS 一一对应的下课时间（两节课之间有大课间，间隔并不相等，不能算出来） */
  var BELL_ENDS = [
    '09:00', '09:45', '10:50', '11:35', '12:20',
    '14:10', '14:55', '16:00', '16:45', '17:30',
    '19:10', '19:55', '20:40'
  ];

  /* 第 n 节的下课时间；超出作息表时按最后一节算（旧数据兜底） */
  function bellEnd(n) {
    if (!(n >= 1)) return '';
    return BELL_ENDS[n - 1] || BELL_ENDS[BELL_ENDS.length - 1];
  }

  /* 第 start 节起、连上 span 节的起止时间：'08:20–09:45' */
  function bellRange(start, span) {
    var s = BELLS[start - 1];
    if (!s) return '';
    var e = bellEnd((start - 1) + Math.max(1, parseInt(span, 10) || 1));
    return e ? s + '–' + e : s;
  }

  /* 简易事件代理：同一容器上「先注册的精确选择器优先」，命中后阻断后续更宽泛的委托。
     注意：页面重绘时会重复调用 delegate()，这里按「选择器」去重，
     避免每渲染一次就往同一个容器上叠一层监听器。 */
  function delegate(root, evt, sel, fn) {
    var key = '__dg_' + evt;
    var reg = root[key] || (root[key] = {});
    if (reg[sel]) return;
    reg[sel] = fn;
    root.addEventListener(evt, function (e) {
      var t = e.target.closest(sel);
      if (t && root.contains(t)) {
        fn(e, t);
        e.stopImmediatePropagation();
      }
    });
  }

  /* 头像配色 */
  function hueOf(str) {
    var h = 0;
    for (var i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) % 360;
    return h;
  }

  /* ---------- 时间小工具（作业 / 计划 / 规划共用） ---------- */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /* 'YYYY-MM-DD' */
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* 'HH:mm' → 当天第几分钟 */
  function toMin(hm) {
    var p = String(hm || '').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }
  /* 分钟 → 'HH:mm' */
  function toHM(m) {
    m = Math.max(0, Math.min(24 * 60, Math.round(m)));
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  /* 'YYYY-MM-DDTHH:mm' / 'YYYY-MM-DD HH:mm' → 时间戳（取不到返回 0） */
  function parseDT(s) {
    if (!s) return 0;
    var d = new Date(String(s).replace(' ', 'T'));
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  /* 倒计时文案：{ late, text, days } */
  function countdown(ts) {
    var diff = ts - Date.now();
    var late = diff < 0;
    var abs = Math.abs(diff);
    var min = Math.floor(abs / 60000);
    var hh = Math.floor(min / 60);
    var dd = Math.floor(hh / 24);
    var txt;
    if (dd >= 1) txt = dd + ' 天' + ((hh % 24) ? ' ' + (hh % 24) + ' 小时' : '');
    else if (hh >= 1) txt = hh + ' 小时' + ((min % 60) ? ' ' + (min % 60) + ' 分' : '');
    else txt = min + ' 分钟';
    return { late: late, text: (late ? '已逾期 ' : '还剩 ') + txt, days: diff / 86400000, ms: diff };
  }

  /* 截止时间的友好写法：今天 23:59 / 明天 20:00 / 09-26 12:00 */
  function dueText(s) {
    var ts = parseDT(s);
    if (!ts) return '未设置截止时间';
    var d = new Date(ts);
    var today = dayKey();
    var tmr = dayKey(new Date(Date.now() + 86400000));
    var k = dayKey(d);
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (k === today) return '今天 ' + hm;
    if (k === tmr) return '明天 ' + hm;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  }

  /* 依据重要度 + 倒计时，给出一句话的紧迫感描述 */
  function urgency(level) {
    return (LEVELS[level] || LEVELS[2]).t;
  }

  return {
    NAV: NAV, TABS: TABS, BELLS: BELLS, BELL_ENDS: BELL_ENDS, LEVELS: LEVELS,
    bellEnd: bellEnd, bellRange: bellRange,
    esc: esc, qs: qs, qsa: qsa, mount: mount, head: head, emptyState: emptyState,
    toast: toast, modal: modal, confirm: confirm,
    timeAgo: timeAgo, fmtDate: fmtDate, weekInfo: weekInfo, weekdayName: weekdayName,
    delegate: delegate, hueOf: hueOf,
    pad2: pad2, dayKey: dayKey, toMin: toMin, toHM: toHM,
    parseDT: parseDT, countdown: countdown, dueText: dueText, urgency: urgency
  };
})();
