/* ==========================================================
   失物招领
   ========================================================== */
(function () {
  if (!Store.requireAuth()) return;   // 未登录 → 回登录页
  var page = UI.mount({ page: 'lost' });
  var db = Store.load();
  var EMOJIS = ['🔍', '🪪', '☂️', '🎧', '🥤', '📱', '💻', '🔑', '👛', '📚', '🧢', '🧸'];
  var state = { type: 'all', q: '', hideResolved: false };

  function list() {
    var arr = db.lost.slice();
    if (state.type !== 'all') arr = arr.filter(function (x) { return x.type === state.type; });
    if (state.hideResolved) arr = arr.filter(function (x) { return !x.resolved; });
    if (state.q) {
      var q = state.q.toLowerCase();
      arr = arr.filter(function (x) { return (x.title + x.desc + x.place).toLowerCase().indexOf(q) >= 0; });
    }
    return arr.sort(function (a, b) { return (a.resolved ? 1 : 0) - (b.resolved ? 1 : 0) || b.createdAt - a.createdAt; });
  }

  function card(x) {
    var isLost = x.type === 'lost';
    return '<div class="card hover item-card' + (x.resolved ? ' sold' : '') + '" data-id="' + x.id + '">' +
      '<div class="thumb" style="--h:' + UI.hueOf(x.title) + ';height:110px;font-size:40px">' + x.emoji +
        '<span class="badge ' + (isLost ? 'badge-red' : 'badge-green') + '" style="position:absolute;left:10px;top:10px">' +
        (isLost ? '寻物启事' : '失物招领') + '</span>' +
        (x.resolved ? '<span class="badge badge-grey" style="position:absolute;right:10px;top:10px">已解决</span>' : '') +
      '</div>' +
      '<div class="t">' + UI.esc(x.title) + '</div>' +
      '<div class="d">' + UI.esc(x.desc) + '</div>' +
      '<div class="f"><span>📍 ' + UI.esc(x.place) + '</span><span class="spacer"></span><span>' + UI.timeAgo(x.createdAt) + '</span></div>' +
      '<div class="f" style="border-top:1px dashed var(--line);padding-top:8px">' +
        (x.mine
          ? '<button class="btn btn-sm" data-resolve="' + x.id + '">' + (x.resolved ? '恢复进行中' : '标记已找到') + '</button>' +
            '<button class="btn btn-sm btn-danger" data-del="' + x.id + '">删除</button>'
          : '<button class="btn btn-sm btn-ghost" data-contact="' + x.id + '">' + (isLost ? '我捡到了' : '这是我的') + '</button>') +
        '<span class="spacer"></span>' +
        (x.mine ? '<span class="badge badge-yellow">我发布的</span>' : '') +
      '</div>' +
    '</div>';
  }

  function render() {
    var arr = list();
    var html = UI.head({
      title: '失物招领',
      sub: '丢东西、捡到东西，都发一条 · 进行中 ' + db.lost.filter(function (x) { return !x.resolved; }).length + ' 条 · 已解决 ' +
        db.lost.filter(function (x) { return x.resolved; }).length + ' 条',
      actions: '<button class="btn btn-primary" id="publish">＋ 发布信息</button>'
    });

    html += '<div class="card pad-sm">' +
      '<div class="row">' +
        '<div class="chips">' +
          [['all', '全部'], ['lost', '寻物启事'], ['found', '失物招领']].map(function (t) {
            return '<span class="chip' + (state.type === t[0] ? ' on' : '') + '" data-type="' + t[0] + '">' + t[1] + '</span>'; }).join('') +
        '</div>' +
        '<span class="chip' + (state.hideResolved ? ' on' : '') + '" data-hide>只看进行中</span>' +
        '<div class="spacer"></div>' +
        '<div class="search-wrap" style="max-width:280px"><span class="ico">🔍</span><input class="input" id="q" placeholder="搜物品 / 地点" value="' + UI.esc(state.q) + '"></div>' +
      '</div>' +
    '</div>';

    html += '<div id="listWrap"></div>';

    page.innerHTML = html;
    bind();
    renderList();
  }

  /* 只重绘列表区域，避免搜索时输入框失焦 */
  function renderList() {
    var arr = list();
    var w = UI.qs('#listWrap');
    if (!w) return;
    w.innerHTML = '<div class="sec-title"><span class="bar"></span>共 ' + arr.length + ' 条信息</div>' +
      (arr.length ? '<div class="grid g-auto">' + arr.map(card).join('') + '</div>'
        : '<div class="card">' + UI.emptyState('🕵️', '暂时没有相关信息，希望能早点找到～') + '</div>');
  }

  function bind() {
    UI.qs('#publish').onclick = openPublish;
    UI.delegate(page, 'click', '[data-type]', function (e, t) { state.type = t.getAttribute('data-type'); render(); });
    UI.delegate(page, 'click', '[data-hide]', function () { state.hideResolved = !state.hideResolved; render(); });
    var q = UI.qs('#q');
    q.oninput = function () { state.q = q.value; renderList(); };
    UI.delegate(page, 'click', '[data-contact]', function (e, t) { e.stopPropagation(); openDetail(t.getAttribute('data-contact')); });
    UI.delegate(page, 'click', '[data-resolve]', function (e, t) {
      e.stopPropagation();
      var x = byId(t.getAttribute('data-resolve'));
      x.resolved = !x.resolved; Store.save();
      UI.toast(x.resolved ? '已标记为解决 🎉' : '已恢复为进行中', 'ok'); render();
    });
    UI.delegate(page, 'click', '[data-del]', function (e, t) {
      e.stopPropagation();
      var x = byId(t.getAttribute('data-del'));
      UI.confirm('确定删除这条信息吗？', '删除').then(function (ok) {
        if (!ok) return;
        db.lost = db.lost.filter(function (y) { return y.id !== x.id; });
        Store.save(); UI.toast('已删除', 'ok'); render();
      });
    });
    /* 本条必须最后注册：卡片兜底点击 */
    UI.delegate(page, 'click', '.item-card', function (e, t) { openDetail(t.getAttribute('data-id')); });
  }

  function byId(id) { return db.lost.filter(function (x) { return x.id === id; })[0]; }

  function openDetail(id) {
    var x = byId(id);
    if (!x) return;
    UI.modal({
      title: x.type === 'lost' ? '寻物启事' : '失物招领',
      body:
        '<div class="thumb" style="--h:' + UI.hueOf(x.title) + ';height:150px;font-size:58px">' + x.emoji + '</div>' +
        '<h3 style="font-size:17px;margin-top:14px">' + UI.esc(x.title) + '</h3>' +
        '<p style="margin-top:8px;color:var(--text-2);font-size:14px;white-space:pre-wrap">' + UI.esc(x.desc) + '</p>' +
        '<div style="margin-top:12px">' +
          '<div class="list-row"><div class="lead">📍</div><div class="main"><b>地点</b><small>' + UI.esc(x.place) + '</small></div></div>' +
          '<div class="list-row"><div class="lead">🕒</div><div class="main"><b>发布时间</b><small>' + UI.fmtDate(x.createdAt) + ' · ' + UI.timeAgo(x.createdAt) + '</small></div></div>' +
          '<div class="list-row"><div class="lead">📮</div><div class="main"><b>联系方式</b><small>' + UI.esc(x.contact) + '</small></div>' +
            '<button class="btn btn-sm" id="copyContact">复制</button></div>' +
        '</div>',
      footer: '<button class="btn btn-primary" data-close>关闭</button>',
      onMount: function (body) {
        UI.qs('#copyContact', body).onclick = function () {
          try { if (navigator.clipboard) navigator.clipboard.writeText(x.contact); } catch (e) {}
          UI.toast('联系方式已复制：' + x.contact, 'ok');
        };
      }
    });
  }

  function openPublish() {
    UI.modal({
      title: '发布失物信息',
      body:
        '<div class="field"><label>信息类型 *</label><div class="chips" id="lType">' +
          '<span class="chip on" data-t="lost">🔴 我丢了东西（寻物启事）</span>' +
          '<span class="chip" data-t="found">🟢 我捡到东西（失物招领）</span>' +
        '</div></div>' +
        '<div class="field"><label>物品名称 *</label><input class="input" id="lTitle" placeholder="例如：黑色折叠伞（伞柄有小熊挂件）"></div>' +
        '<div class="row" style="gap:12px">' +
          '<div class="field" style="flex:1;min-width:180px"><label>地点</label><input class="input" id="lPlace" placeholder="图书馆三楼自习区"></div>' +
          '<div class="field" style="width:150px"><label>时间</label><input class="input" id="lDate" type="date"></div>' +
        '</div>' +
        '<div class="field"><label>选择图标</label><div class="chips" id="lEmoji">' +
          EMOJIS.map(function (e, i) {
            return '<span class="chip' + (i === 0 ? ' on' : '') + '" data-e="' + e + '" style="font-size:17px;padding:4px 10px">' + e + '</span>'; }).join('') + '</div></div>' +
        '<div class="field"><label>详细描述</label><textarea class="textarea" id="lDesc" placeholder="物品特征、丢失/拾获经过、是否已上交等"></textarea></div>' +
        '<div class="field"><label>联系方式</label><input class="input" id="lContact" placeholder="QQ / 微信 / 手机号"></div>',
      footer: '<button class="btn" data-close>取消</button><button class="btn btn-primary" id="lSave">发布</button>',
      onMount: function (body, close) {
        var type = 'lost', emoji = EMOJIS[0];
        UI.qsa('#lType .chip', body).forEach(function (el) {
          el.onclick = function () {
            UI.qsa('#lType .chip', body).forEach(function (x) { x.classList.remove('on'); });
            el.classList.add('on'); type = el.getAttribute('data-t');
          };
        });
        UI.qsa('#lEmoji .chip', body).forEach(function (el) {
          el.onclick = function () {
            UI.qsa('#lEmoji .chip', body).forEach(function (x) { x.classList.remove('on'); });
            el.classList.add('on'); emoji = el.getAttribute('data-e');
          };
        });
        UI.qs('#lSave', body).onclick = function () {
          var title = UI.qs('#lTitle').value.trim();
          if (!title) { UI.toast('请填写物品名称', 'err'); return; }
          var d = UI.qs('#lDate').value;
          db.lost.unshift({
            id: Store.uid('l'), type: type, title: title,
            place: UI.qs('#lPlace').value.trim() || '未填写',
            emoji: emoji, desc: UI.qs('#lDesc').value.trim() || '（发布者没有填写描述）',
            contact: UI.qs('#lContact').value.trim() || '站内留言',
            author: db.user.nickname, mine: true, resolved: false,
            createdAt: d ? new Date(d + 'T12:00:00').getTime() : Date.now()
          });
          Store.save(); close(); state.type = 'all';
          UI.toast('发布成功，祝早日物归原主', 'ok'); render();
        };
      }
    });
  }

  render();
})();
