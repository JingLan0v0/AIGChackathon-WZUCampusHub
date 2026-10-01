/* ==========================================================
   登录 / 教务账号绑定页
   —— 演示版：模拟“温大统一身份认证 → 拉取教务数据”的过程
   —— 真实对接时只需替换 Store.mockEdu() 与本文件的登录请求
   ========================================================== */
(function () {
  var sidEl = document.getElementById('sid');
  var pwdEl = document.getElementById('pwd');
  var eyeEl = document.getElementById('eye');
  var rememberEl = document.getElementById('remember');
  var errEl = document.getElementById('err');
  var stepsEl = document.getElementById('steps');
  var submitBtn = document.getElementById('submitBtn');
  var form = document.getElementById('loginForm');
  var busy = false;

  /* 已登录则直接进入首页 */
  if (Store.auth().logged) { location.replace('home.html'); return; }

  /* 退出登录后回到本页时，自动带出上次的学号（不记密码） */
  try {
    var last = localStorage.getItem('wzu-campus-last-sid');
    if (last) sidEl.value = last;
  } catch (e) {}

  function showErr(msg) {
    errEl.textContent = msg;
    errEl.classList.add('show');
    errEl.style.animation = 'none';
    void errEl.offsetWidth;
    errEl.style.animation = '';
  }
  function clearErr() { errEl.classList.remove('show'); }

  /* 只允许输入数字 */
  sidEl.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 20);
    clearErr();
  });
  pwdEl.addEventListener('input', clearErr);

  /* 显示 / 隐藏密码 */
  eyeEl.onclick = function () {
    var show = pwdEl.type === 'password';
    pwdEl.type = show ? 'text' : 'password';
    eyeEl.textContent = show ? '🙈' : '👁';
    pwdEl.focus();
  };

  /* 一键填入演示账号 */
  document.getElementById('demoFill').onclick = function () {
    sidEl.value = Store.DEMO.sid;
    pwdEl.value = Store.DEMO.pwd;
    clearErr();
    pwdEl.focus();
  };

  var STEPS = [
    '正在连接温州大学统一身份认证…',
    '校验学号与密码…',
    '读取该学号在本机的课表与作业…',
    '准备本机课表与 AI 课程调整…',
    '生成你的校园首页…'
  ];

  function playSteps() {
    stepsEl.innerHTML = '';
    stepsEl.classList.add('on');
    STEPS.forEach(function (t) {
      stepsEl.insertAdjacentHTML('beforeend',
        '<div class="step"><span class="dot"></span><span>' + t + '</span></div>');
    });
    var items = stepsEl.querySelectorAll('.step');
    return new Promise(function (resolve) {
      var i = 0;
      (function next() {
        if (i > 0) { items[i - 1].classList.add('done'); items[i - 1].querySelector('.dot').textContent = '✓'; }
        if (i >= items.length) { resolve(); return; }
        items[i].classList.add('active');
        i += 1;
        setTimeout(next, 380);
      })();
    });
  }

  /* ---------- 本机登录过的账号：一键切换（不用重输密码） ---------- */
  function renderAccounts() {
    var box = document.getElementById('acctSwitch');
    var list = document.getElementById('asList');
    if (!box || !list) return;
    var rows = (typeof Store.accounts === 'function' ? Store.accounts() : []) || [];
    var cur = (typeof Store.currentSid === 'function' ? Store.currentSid() : '');
    if (!rows.length) { box.hidden = true; return; }
    box.hidden = false;
    list.innerHTML = rows.map(function (a) {
      var sub = a.sid + (a.college ? ' · ' + a.college : '') +
        (a.courses ? ' · 课表 ' + a.courses + ' 门' : ' · 还没导入课表') +
        (a.sid === cur ? ' · 上次登录' : '');
      return '<div class="list-row">' +
        '<div class="lead">' + UIesc(a.avatar || '🐻') + '</div>' +
        '<div class="main"><b>' + UIesc(a.nickname || '温大同学') + '</b><small>' + UIesc(sub) + '</small></div>' +
        '<button class="btn btn-sm btn-primary" data-switch="' + UIesc(a.sid) + '">切换</button>' +
        '<button class="btn btn-sm btn-ghost" data-forget="' + UIesc(a.sid) + '" title="从本机移除这个账号">✕</button>' +
      '</div>';
    }).join('');
  }

  (function bindAccounts() {
    var list = document.getElementById('asList');
    if (!list) return;
    list.onclick = function (e) {
      var t = e.target;

      var sw = t.closest ? t.closest('[data-switch]') : null;
      if (sw) {
        var sid = sw.getAttribute('data-switch');
        if (typeof Store.switchTo !== 'function' || !Store.switchTo(sid)) {
          showErr('这个账号在本机的数据找不到了，请用学号密码重新登录');
          return;
        }
        sw.textContent = '切换中…';
        location.href = 'home.html';
        return;
      }

      var fg = t.closest ? t.closest('[data-forget]') : null;
      if (fg) {
        var sid2 = fg.getAttribute('data-forget');
        /* 两下确认，避免误删（登录页没加载 UI 层，不用弹窗） */
        if (fg.getAttribute('data-armed') !== '1') {
          fg.setAttribute('data-armed', '1');
          fg.textContent = '确认移除';
          setTimeout(function () {
            if (fg.parentNode) { fg.removeAttribute('data-armed'); fg.textContent = '✕'; }
          }, 3000);
          return;
        }
        Store.forgetAccount(sid2);
        renderAccounts();
      }
    };
  })();

  renderAccounts();

  form.onsubmit = function (e) {
    e.preventDefault();
    if (busy) return;

    var sid = sidEl.value.trim();
    var pwd = pwdEl.value;

    if (!/^\d{6,20}$/.test(sid)) { showErr('学号格式不正确：应为 6–20 位数字，例如 20230427'); sidEl.focus(); return; }
    if (pwd.length < 6) { showErr('密码至少 6 位，请检查后重试'); pwdEl.focus(); return; }
    if (pwd.length > 32) { showErr('密码长度异常，请检查后重试'); pwdEl.focus(); return; }

    busy = true;
    clearErr();
    submitBtn.disabled = true;
    submitBtn.textContent = '正在登录…';

    playSteps().then(function () {
      try {
        localStorage.setItem('wzu-campus-last-sid', sid);
      } catch (e) {}

      var profile = Store.login(sid, rememberEl.checked);

      stepsEl.classList.remove('on');
      submitBtn.textContent = '✓ 登录成功，正在进入…';

      /* 这个学号以前登录过 → 他自己的课表还在；第一次登录 → 课表是空的，提醒去导入 */
      var snap = Store.load();
      var n = (snap.courses || []).length;
      var tail = n
        ? '该学号的课表已就绪：' + n + ' 门课程 · 校园公告 ' + (snap.notices || []).length + ' 条'
        : '课表还是空的（新账号都这样，我们不替你编课表）—— 进去后到「智能课表 → 导入真实课表」，' +
          '或先在<a href="' + Store.EDU_LOGIN_URL + '" target="_blank" rel="noopener">温大统一身份认证</a>登录教务系统抓一份';
      var tip = document.createElement('div');
      tip.className = 'auth-success';
      /* 学院不再自动猜 → 可能是空，所以「有几句说几句」，别留下孤零零的分隔点 */
      tip.innerHTML = '已绑定学号 <b>' + UIesc(profile.sid) + '</b>' +
        (profile.grade ? ' · ' + UIesc(profile.grade) : '') +
        (profile.college ? ' · ' + UIesc(profile.college) : '') +
        '<br><span>' + tail + '</span>';
      stepsEl.parentNode.insertBefore(tip, stepsEl.nextSibling);

      setTimeout(function () { location.href = 'home.html'; }, 720);
    });
  };

  function UIesc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
