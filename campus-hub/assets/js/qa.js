/* ==========================================================
   校园问答
   ========================================================== */
(function () {
  if (!Store.requireAuth()) return;   // 未登录 → 回登录页
  var page = UI.mount({ page: 'qa' });
  var db = Store.load();
  var TAGS = ['选课', '宿舍', '学习', '生活', '社团', '美食', '新生', '经验', '转专业', '体育'];
  var state = { tag: '全部', q: '', sort: '最新' };

  function list() {
    var arr = db.qa.slice();
    if (state.tag !== '全部') arr = arr.filter(function (q) { return q.tags.indexOf(state.tag) >= 0; });
    if (state.q) {
      var k = state.q.toLowerCase();
      arr = arr.filter(function (q) { return (q.title + q.body + q.tags.join('')).toLowerCase().indexOf(k) >= 0; });
    }
    if (state.sort === '最新') arr.sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (state.sort === '最热') arr.sort(function (a, b) { return (b.likes + b.answers.length * 5) - (a.likes + a.answers.length * 5); });
    if (state.sort === '回答最多') arr.sort(function (a, b) { return b.answers.length - a.answers.length; });
    if (state.sort === '待解答') arr.sort(function (a, b) { return a.answers.length - b.answers.length; });
    return arr;
  }

  function item(q) {
    var accepted = q.answers.some(function (a) { return a.accepted; });
    return '<div class="qa-item" data-id="' + q.id + '">' +
      '<div class="qa-vote"><div class="n">' + q.answers.length + '</div><div class="l">回答</div></div>' +
      '<div class="qa-vote"><div class="n" style="color:var(--accent)">' + q.likes + '</div><div class="l">赞同</div></div>' +
      '<div class="qa-main">' +
        '<h4>' + UI.esc(q.title) + (accepted ? ' <span class="badge badge-green">已解决 ✓</span>' : '') + '</h4>' +
        '<div class="body">' + UI.esc(q.body) + '</div>' +
        '<div class="tags">' + q.tags.map(function (t) { return '<span class="badge badge-blue">#' + UI.esc(t) + '</span>'; }).join('') +
          '<span class="badge badge-grey">' + UI.esc(q.author) + ' · ' + UI.timeAgo(q.createdAt) + '</span></div>' +
      '</div>' +
    '</div>';
  }

  function render() {
    var arr = list();
    var totalAnswers = db.qa.reduce(function (n, q) { return n + q.answers.length; }, 0);
    var solved = db.qa.filter(function (q) { return q.answers.some(function (a) { return a.accepted; }); }).length;

    var html = UI.head({
      title: '校园问答',
      sub: db.qa.length + ' 个问题 · ' + totalAnswers + ' 条回答 · ' + solved + ' 个已解决 · 答案来自温大同学的真实经验',
      actions: '<button class="btn btn-primary" id="ask">＋ 我要提问</button>'
    });

    html += '<div class="grid g-3" style="margin-bottom:14px">' +
      [['🔥', '共 ' + db.qa.length + ' 个问题', '来自全校同学的疑问', '#FFEAE3'],
       ['💡', '共 ' + totalAnswers + ' 条回答', '学长学姐即时互助', '#E8EDFF'],
       ['✅', solved + ' 个已解决', '采纳了最佳答案', '#E6F8EF']].map(function (s) {
        return '<div class="card stat pad-sm" style="padding:14px"><div class="ico" style="background:' + s[3] + '">' + s[0] +
          '</div><div><div class="num" style="font-size:17px">' + s[1] + '</div><div class="lbl">' + s[2] + '</div></div></div>';
      }).join('') + '</div>';

    html += '<div class="card pad-sm">' +
      '<div class="row">' +
        '<div class="search-wrap"><span class="ico">🔍</span><input class="input" id="q" placeholder="搜索问题关键词，例如：宿舍、转专业" value="' + UI.esc(state.q) + '"></div>' +
        '<select class="select" id="sort" style="width:140px">' +
          ['最新', '最热', '回答最多', '待解答'].map(function (s) {
            return '<option' + (s === state.sort ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      '</div>' +
      '<div class="chips" style="margin-top:12px">' +
        ['全部'].concat(TAGS).map(function (t) {
          return '<span class="chip' + (t === state.tag ? ' on' : '') + '" data-tag="' + t + '">' + (t === '全部' ? '全部' : '#' + t) + '</span>'; }).join('') +
      '</div>' +
    '</div>';

    html += '<div class="card" style="margin-top:14px">' +
      (arr.length ? arr.map(item).join('') : UI.emptyState('🤔', '还没有相关提问，来提第一个吧～')) + '</div>';

    page.innerHTML = html;
    bind();
  }

  function bind() {
    UI.qs('#ask').onclick = openAsk;
    var q = UI.qs('#q');
    q.oninput = function () { state.q = q.value; render(); UI.qs('#q').focus(); };
    UI.qs('#sort').onchange = function () { state.sort = this.value; render(); };
    UI.delegate(page, 'click', '[data-tag]', function (e, t) { state.tag = t.getAttribute('data-tag'); render(); });
    UI.delegate(page, 'click', '.qa-item', function (e, t) { openDetail(t.getAttribute('data-id')); });
  }

  function byId(id) { return db.qa.filter(function (q) { return q.id === id; })[0]; }

  function openDetail(id) {
    var q = byId(id);
    if (!q) return;
    var mine = q.author === '我' || q.author === db.user.nickname;

    var answers = q.answers.length ? q.answers.slice().sort(function (a, b) {
      return (b.accepted ? 1 : 0) - (a.accepted ? 1 : 0) || b.likes - a.likes;
    }).map(function (a) {
      return '<div class="answer' + (a.accepted ? ' accepted' : '') + '">' +
        '<div class="av">' + UI.esc(a.author.slice(0, 1)) + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="row" style="gap:6px">' +
            '<b style="font-size:13px">' + UI.esc(a.author) + '</b>' +
            (a.accepted ? '<span class="badge badge-green">最佳答案 ✓</span>' : '') +
            '<span style="color:var(--muted);font-size:12px">' + UI.timeAgo(a.createdAt) + '</span></div>' +
          '<div class="body">' + UI.esc(a.body) + '</div>' +
          '<div class="row" style="margin-top:6px;gap:8px">' +
            '<button class="btn btn-sm" data-like="' + a.id + '">👍 有帮助 (' + a.likes + ')</button>' +
            (mine && !a.accepted ? '<button class="btn btn-sm btn-ghost" data-accept="' + a.id + '">采纳为最佳答案</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') : UI.emptyState('💭', '还没有人回答，快来做第一个吧');

    UI.modal({
      title: '问题详情',
      size: 'lg',
      body:
        '<h3 style="font-size:17px">' + UI.esc(q.title) + '</h3>' +
        '<div class="row" style="gap:6px;margin-top:8px">' +
          q.tags.map(function (t) { return '<span class="badge badge-blue">#' + UI.esc(t) + '</span>'; }).join('') +
          '<span class="badge badge-grey">' + UI.esc(q.author) + ' · ' + UI.timeAgo(q.createdAt) + '</span>' +
        '</div>' +
        '<p style="margin-top:10px;color:var(--text-2);font-size:14px;white-space:pre-wrap">' + UI.esc(q.body) + '</p>' +
        '<div class="row" style="margin-top:12px">' +
          '<button class="btn btn-sm" id="qLike">👍 我也想知道 (' + q.likes + ')</button>' +
        '</div>' +
        '<div class="sec-title"><span class="bar"></span>' + q.answers.length + ' 条回答</div>' + answers +
        '<div class="sec-title"><span class="bar"></span>写下我的回答</div>' +
        '<div class="field"><input class="input" id="aName" value="' + UI.esc(db.user.nickname) + '"></div>' +
        '<div class="field"><textarea class="textarea" id="aBody" placeholder="分享你的经验或建议，尽量具体一点～"></textarea></div>' +
        '<button class="btn btn-primary btn-block" id="aSave">提交回答</button>',
      footer: '<button class="btn" data-close>关闭</button>',
      onMount: function (body, close) {
        UI.qs('#qLike', body).onclick = function () { q.likes += 1; Store.save(); UI.toast('已赞同', 'ok'); close(); openDetail(id); };
        UI.qs('#aSave', body).onclick = function () {
          var txt = UI.qs('#aBody').value.trim();
          if (!txt) { UI.toast('回答内容不能为空', 'err'); return; }
          q.answers.push({
            id: Store.uid('a'), author: UI.qs('#aName').value.trim() || '匿名同学',
            body: txt, likes: 0, accepted: false, createdAt: Date.now()
          });
          Store.save(); UI.toast('回答已发布，感谢分享 🙌', 'ok'); close(); openDetail(id);
        };
        UI.qsa('[data-like]', body).forEach(function (b) {
          b.onclick = function () {
            var a = q.answers.filter(function (x) { return x.id === b.getAttribute('data-like'); })[0];
            a.likes += 1; Store.save(); UI.toast('感谢反馈', 'ok'); close(); openDetail(id);
          };
        });
        UI.qsa('[data-accept]', body).forEach(function (b) {
          b.onclick = function () {
            q.answers.forEach(function (x) { x.accepted = false; });
            q.answers.filter(function (x) { return x.id === b.getAttribute('data-accept'); })[0].accepted = true;
            Store.save(); UI.toast('已采纳最佳答案 ✅', 'ok'); close(); openDetail(id);
          };
        });
      }
    });
  }

  function openAsk() {
    UI.modal({
      title: '我要提问',
      body:
        '<div class="field"><label>问题标题 *</label><input class="input" id="nTitle" placeholder="一句话说清你的问题"></div>' +
        '<div class="field"><label>问题描述</label><textarea class="textarea" id="nBody" placeholder="补充背景信息，方便同学给出准确回答"></textarea></div>' +
        '<div class="field"><label>选择话题（最多 3 个）</label><div class="chips" id="nTags">' +
          TAGS.map(function (t) { return '<span class="chip" data-t="' + t + '">#' + t + '</span>'; }).join('') + '</div></div>' +
        '<div class="field"><label>昵称</label><input class="input" id="nName" value="' + UI.esc(db.user.nickname) + '"></div>',
      footer: '<button class="btn" data-close>取消</button><button class="btn btn-primary" id="nSave">发布提问</button>',
      onMount: function (body, close) {
        var picked = [];
        UI.qsa('#nTags .chip', body).forEach(function (el) {
          el.onclick = function () {
            var t = el.getAttribute('data-t');
            var i = picked.indexOf(t);
            if (i >= 0) { picked.splice(i, 1); el.classList.remove('on'); }
            else if (picked.length < 3) { picked.push(t); el.classList.add('on'); }
            else UI.toast('最多选择 3 个话题', 'err');
          };
        });
        UI.qs('#nSave', body).onclick = function () {
          var title = UI.qs('#nTitle').value.trim();
          if (!title) { UI.toast('请填写问题标题', 'err'); return; }
          db.qa.unshift({
            id: Store.uid('q'), title: title,
            body: UI.qs('#nBody').value.trim() || '（提问者没有补充描述）',
            tags: picked.length ? picked : ['其他'],
            likes: 0, author: UI.qs('#nName').value.trim() || '匿名同学',
            createdAt: Date.now(), answers: []
          });
          Store.save(); close(); UI.toast('提问已发布，等待回答 🎈', 'ok'); render();
        };
      }
    });
  }

  render();
})();
