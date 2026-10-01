/* ==========================================================
   页面交互测试（真实 DOM）
   ---------------------------------------------------------
   为什么需要它：
   本项目的页面是「字符串拼 HTML + 给按钮赋 onclick」的写法。
   纯逻辑测试（logic.test.js）发现不了「按钮根本没绑上事件」这一类问题——
   语法没错、函数没错，但用户点了没反应。

   这个文件用 jsdom 把页面真正跑起来：点开弹窗 → 填表 → 点保存 → 查数据是否落库。

   运行：node tests/ui.test.js
   依赖：jsdom（可选，仅测试用）。未安装时自动跳过并给出安装提示，退出码 0。
         已装在托管工作区时：
           NODE_PATH=C:\Users\forey\.workbuddy\binaries\node\workspace\node_modules node tests/ui.test.js
   ========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let JSDOM, VirtualConsole;
try {
  const jsdom = require('jsdom');
  JSDOM = jsdom.JSDOM;
  VirtualConsole = jsdom.VirtualConsole;
} catch (e) {
  console.log('⚠️  未找到 jsdom，跳过页面交互测试（不影响项目运行）。');
  console.log('   需要跑的话：npm i -D jsdom，或用 NODE_PATH 指向已装 jsdom 的 node_modules。');
  process.exit(0);
}
/* jsdom 不支持页面跳转，会打印 “Not implemented: navigation”，这里静音，避免噪音 */
const vc = new VirtualConsole();
vc.on('jsdomError', function () {});

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
function text(doc, sel) {
  const el = doc.querySelector(sel);
  return el ? el.textContent.trim() : '';
}

/* 让某个页面真正跑起来：
   1) 用文件里的原始 HTML 建 DOM（url 用 http，jsdom 才会给 localStorage）
   2) 按 <script src> 顺序 eval，保证依赖顺序和浏览器一致
   3) store.js 之后立刻模拟「已登录」状态，跨过登录门禁
   4) fetch 给一个永不 resolve 的 Promise —— 天气接口不参与测试，也不该联网 */
/* 页面里的「现在」也必须可控：今日规划、课表「今天有课吗」、调课通知
   「影响今天吗」都看 now。跟 logic.test.js 一样钉在 2026-09-22（第 3 周周二），
   否则周末跑和周三跑会得到不同结果，测试就成了「看运气」。 */
const PIN_Y = 2026, PIN_M = 8, PIN_D = 22, PIN_H = 9, PIN_MIN = 30;
const RealDate = Date;
function pinnedDate(...a) {
  if (!a.length) return new RealDate(PIN_Y, PIN_M, PIN_D, PIN_H, PIN_MIN, 0, 0);
  return new RealDate(...a);
}
class ClockDate extends RealDate {
  constructor(...a) { super(pinnedDate(...a).getTime()); }
  static now() { return pinnedDate().getTime(); }
}

function boot(pageFile, sid) {
  const html = fs.readFileSync(path.join(ROOT, pageFile), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/campus-hub/' + pageFile,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const win = dom.window;
  win.fetch = function () { return new Promise(function () {}); };
  win.Date = ClockDate;      /* 页面脚本里的 Date 也换成固定时钟 */

  const srcs = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map(m => m[1]);
  const errors = [];
  srcs.forEach(function (src) {
    const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
    try { win.eval(code); } catch (e) { errors.push(src + ' :: ' + e.message); }
    if (/store\.js$/.test(src)) {
      /* 不传 sid → 用演示账号登录；传 null → 保持未登录（测登录页用） */
      const useSid = sid === undefined ? win.Store.DEMO.sid : sid;
      if (useSid) {
        try { win.Store.login(useSid, true); } catch (e) { errors.push('login :: ' + e.message); }
      }
    }
  });
  return { win: win, doc: win.document, errors: errors, srcs: srcs };
}

function setVal(win, sel, v) {
  const el = win.document.querySelector(sel);
  if (!el) return null;
  el.value = v;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
  return el;
}
function layers(doc) { return Array.from(doc.querySelectorAll('#modalRoot .modal-backdrop')); }
function footBtns(doc) { return Array.from(doc.querySelectorAll('#modalRoot .modal-foot button')); }

console.log('校园百事通 · 页面交互测试（jsdom 真实 DOM）');
console.log('========================================');

/* ==========================================================
   0. 每个页面都要能无错加载，并且真的渲染出内容
   —— 这类「某一行在编辑时代码丢了」的问题，语法检查发现不了，
      但一打开页面就是 ReferenceError + 白屏。
   ========================================================== */
section('0. 全站页面：脚本无异常、内容渲染成功');
['index.html', 'home.html', 'plan.html', 'schedule.html',
 'homework.html', 'lost.html', 'qa.html', 'me.html'].forEach(function (f) {
  const env = boot(f);
  ok(f + ' · 脚本无报错', env.errors.length === 0, env.errors.join(' | '));
  const page = env.doc.querySelector('#page');
  if (f === 'index.html') {
    ok('index.html · 登录页渲染出内容', env.doc.body.innerHTML.length > 2000,
      env.doc.body.innerHTML.length + ' 字符');
  } else {
    ok(f + ' · #page 渲染出内容', !!page && page.innerHTML.trim().length > 200,
      page ? String(page.innerHTML.length) + ' 字符' : 'no #page');
    ok(f + ' · 没有把 undefined / NaN 渲染到界面',
      !!page && !/undefined|\[object Object\]|NaN/.test(page.textContent));
  }
});

/* ==========================================================
   1. 全站回归：每个「新建 / 发布」弹窗的页脚按钮都必须绑上事件
   —— 之前 UI.modal 只把 .modal-body 传给 onMount，
      页脚里的主按钮（保存/发布/收藏）全都拿不到，onclick 抛错 → 点了没反应。
   ========================================================== */
section('1. 全站弹窗：页脚按钮必须绑定事件');
const ADD_PAGES = [
  { file: 'homework.html', trigger: '#addHw', what: '添加作业' },
  { file: 'plan.html', trigger: '#addPlanLink', what: '新建计划' },
  { file: 'lost.html', trigger: '#publish', what: '发布信息' },
  { file: 'qa.html', trigger: '#ask', what: '我要提问' },
  { file: 'schedule.html', trigger: '#addCourse', what: '添加课程' }
];
ADD_PAGES.forEach(function (cfg) {
  const env = boot(cfg.file);
  const t = env.doc.querySelector(cfg.trigger);
  ok(cfg.file + ' · 脚本无报错', env.errors.length === 0, env.errors.join(' | '));
  ok(cfg.file + ' · ' + cfg.what + ' 按钮存在', !!t);
  if (!t) return;
  t.click();
  ok(cfg.file + ' · 点击后弹出表单', !!env.doc.querySelector('#modalRoot .modal'));
  const btns = footBtns(env.doc);
  const dead = btns.filter(function (b) { return typeof b.onclick !== 'function'; });
  ok(cfg.file + ' · 页脚 ' + btns.length + ' 个按钮全部绑定了事件',
    btns.length > 0 && dead.length === 0,
    dead.map(function (b) { return b.id || b.textContent.trim(); }).join(','));
});

section('2. 全站详情弹窗：页脚 / 正文按钮都要能用');
[
  { file: 'lost.html', open: '.item-card', must: ['#copyContact'] },
  { file: 'schedule.html', open: '.tt-course', must: ['[data-del]'] },
  { file: 'schedule.html', open: '[data-schedule-origin]', must: ['#scheduleModalApply'] }
].forEach(function (cfg) {
  const env = boot(cfg.file);
  const card = env.doc.querySelector('#page ' + cfg.open);
  ok(cfg.file + ' · 详情入口 ' + cfg.open + ' 存在', !!card);
  if (!card) return;
  card.click();
  ok(cfg.file + ' · 弹出详情', !!env.doc.querySelector('#modalRoot .modal'));
  cfg.must.forEach(function (sel) {
    const el = env.doc.querySelector('#modalRoot ' + sel);
    ok(cfg.file + ' · ' + sel + ' 存在且已绑定事件', !!el && (typeof el.onclick === 'function' || el.tagName === 'BUTTON'),
      el ? (typeof el.onclick) : 'not found');
  });
});

/* ==========================================================
   3. 作业 DDL：添加 → 校验 → 保存 → 完成
   ========================================================== */
section('3. 作业 DDL：添加 / 校验 / 保存 / 完成');
(function () {
  const env = boot('homework.html');
  const doc = env.doc, win = env.win;
  const before = win.Store.load().homeworks.length;

  const foot = doc.querySelector('#addHwFoot');
  ok('列表底部有「继续添加作业」入口', !!foot);
  if (foot) {
    foot.click();
    ok('底部入口也能打开添加表单', !!doc.querySelector('#modalRoot .modal'));
    doc.querySelector('.modal-backdrop [data-close]').click();
    ok('关闭后弹窗清空', !doc.querySelector('#modalRoot .modal'));
  }

  doc.querySelector('#addHw').click();
  ok('弹出「添加作业」', !!doc.querySelector('#modalRoot .modal'));
  const save = doc.querySelector('.modal-foot #hSave');
  ok('页脚「添加」按钮已绑定事件', typeof (save && save.onclick) === 'function');
  save.click();
  ok('空标题被拦下并给出内联提示',
    /作业名称/.test(text(doc, '#eTitle')) && win.Store.load().homeworks.length === before,
    text(doc, '#eTitle'));
  ok('出错的字段被标红', !!doc.querySelector('#fTitle.bad'));

  setVal(win, '#hTitle', '交互测试作业');
  ok('用户一动输入框，错误提示自动收掉', text(doc, '#eTitle') === '' && !doc.querySelector('#fTitle.bad'));

  setVal(win, '#hDue', win.UI.dayKey() + 'T23:59');
  setVal(win, '#hHours', '2');
  doc.querySelector('.modal-foot #hSave').click();

  const list = win.Store.load().homeworks;
  const created = list.filter(function (h) { return h.title === '交互测试作业'; })[0];
  ok('保存成功写入了数据', list.length === before + 1 && !!created, 'len=' + list.length);
  ok('弹窗已关闭', !doc.querySelector('#modalRoot .modal'));
  ok('新作业出现在列表里', doc.querySelector('#page').textContent.includes('交互测试作业'));
  ok('备注按填写入库（预计 2 小时）', created && created.hours === 2, created && created.hours);

  /* 重复录入保护：同名同课程会先问一句，而且确认框叠在表单上层 */
  doc.querySelector('#addHw').click();
  setVal(win, '#hTitle', '交互测试作业');
  setVal(win, '#hDue', win.UI.dayKey() + 'T23:59');
  doc.querySelector('.modal-foot #hSave').click();
  ok('重复作业会先弹确认框（两层弹窗叠加）', layers(doc).length === 2, 'layers=' + layers(doc).length);

  const cancel = layers(doc)[1].querySelector('[data-no]');
  ok('确认框「取消」按钮存在', !!cancel);
  cancel.click();
  ok('取消确认后表单还在（叠加弹窗没把表单冲掉）', layers(doc).length === 1 && !!doc.querySelector('#hTitle'));
  ok('取消后没有重复写入', win.Store.load().homeworks.filter(function (h) {
    return h.title === '交互测试作业';
  }).length === 1);

  doc.querySelector('.modal-backdrop [data-close]').click();
  ok('关闭表单后弹窗清空', layers(doc).length === 0);

  /* 列表里的操作按钮 */
  const fin = doc.querySelector('[data-finish="' + created.id + '"]');
  ok('列表里有「完成」按钮', !!fin);
  if (fin) {
    fin.click();
    const after = win.Store.load().homeworks.filter(function (h) { return h.id === created.id; })[0];
    ok('点「完成」后状态变为 done', after.status === 'done');
    ok('完成后从「全部待完成」里消失（符合预期）',
      !doc.querySelector('[data-finish="' + created.id + '"]'));
  }

  /* 筛选 / 排序 */
  const chip = doc.querySelector('[data-filter="done"]');
  ok('筛选条有「已完成」', !!chip);
  if (chip) {
    chip.click();
    ok('切到「已完成」能看到刚完成的作业',
      doc.querySelector('#page').textContent.includes('交互测试作业'));
    ok('已完成列表里出现「恢复」按钮', !!doc.querySelector('[data-undo="' + created.id + '"]'));
    doc.querySelector('[data-undo="' + created.id + '"]').click();
    ok('点「恢复」后回到待完成',
      win.Store.load().homeworks.filter(function (h) { return h.id === created.id; })[0].status === 'todo');
  }
  doc.querySelector('[data-filter="all"]').click();
  const sel = doc.querySelector('#sortSel');
  ok('排序下拉可用', !!sel);
  if (sel) {
    sel.value = 'due';
    sel.dispatchEvent(new win.Event('change', { bubbles: true }));
    ok('切换排序不报错且列表仍在', doc.querySelector('#page').textContent.includes('交互测试作业'));
  }
})();

/* ==========================================================
   4. 课外计划：新建 → 校验 → 每周重复 → 冲突预警 → 筛选
   ========================================================== */
section('4. 课外计划：新建 / 每周重复 / 冲突 / 筛选');
(function () {
  const env = boot('plan.html');
  const doc = env.doc, win = env.win;
  const before = win.Store.load().plans.length;

  const footPlan = doc.querySelector('#addPlanFoot');
  ok('列表底部有「继续添加计划」入口', !!footPlan);
  if (footPlan) {
    footPlan.click();
    ok('底部入口也能打开新建表单', !!doc.querySelector('#modalRoot .modal'));
    doc.querySelector('.modal-backdrop [data-close]').click();
  }

  doc.querySelector('#addPlanLink').click();
  ok('弹出「新建课外计划」', !!doc.querySelector('#modalRoot .modal'));
  const save = doc.querySelector('.modal-foot #pSave');
  ok('页脚「创建计划」按钮已绑定事件', typeof (save && save.onclick) === 'function');

  save.click();
  ok('空内容被拦下', /计划内容/.test(text(doc, '#ePTitle')) && win.Store.load().plans.length === before);

  setVal(win, '#pTitle', '交互测试计划');
  setVal(win, '#pStart', '20:00');
  setVal(win, '#pEnd', '19:00');
  doc.querySelector('.modal-foot #pSave').click();
  ok('结束早于开始被拦下', /晚于开始时间/.test(text(doc, '#ePTime')), text(doc, '#ePTime'));

  /* 模板一键填表 */
  const tpl = doc.querySelector('[data-tpl="1"]');
  ok('表单里有常用模板', !!tpl);
  tpl.click();
  ok('点模板自动填了内容与时间',
    doc.querySelector('#pTitle').value === '操场夜跑 3 公里' && doc.querySelector('#pStart').value === '20:45',
    doc.querySelector('#pTitle').value + ' / ' + doc.querySelector('#pStart').value);

  /* 每周重复 */
  const wk = doc.querySelector('#pWeekly');
  wk.checked = true;
  wk.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok('勾「每周重复」后给出重复说明', /重复/.test(text(doc, '#pWeeklyHint')), text(doc, '#pWeeklyHint'));

  doc.querySelector('.modal-foot #pSave').click();
  const plans = win.Store.load().plans;
  const created = plans.filter(function (p) { return p.title === '操场夜跑 3 公里'; }).slice(-1)[0];
  ok('创建成功', plans.length === before + 1 && !!created, 'len=' + plans.length);
  ok('「每周重复」被保存下来', !!created && created.repeat === 'weekly');
  ok('新计划出现在页面上', doc.querySelector('#page').textContent.includes('操场夜跑 3 公里'));

  /* 每周重复要真的每周都出现，而不是只在首次日期出现。
     注意从「固定时钟」往后推 7 天 —— 用真实 Date.now() 会跟页面里钉死的日期错开 */
  const nextWeek = pinnedDate();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextKey = win.UI.dayKey(nextWeek);
  const nextWd = nextWeek.getDay() === 0 ? 7 : nextWeek.getDay();
  ok('下周同一天仍会出现这条计划', win.Planner.planOnDay(created, nextKey, nextWd) === true);

  /* 完成状态按「哪一天」记录 */
  const ck = doc.querySelector('[data-toggle="' + created.id + '"]');
  ok('计划行有打勾按钮', !!ck);
  if (ck) {
    ck.click();
    const after = win.Store.load().plans.filter(function (p) { return p.id === created.id; })[0];
    ok('打勾记在当天（doneOn），没有污染全局 status',
      !!(after.doneOn && after.doneOn[win.UI.dayKey()]) && after.status !== 'done',
      JSON.stringify(after.doneOn) + ' / status=' + after.status);
    ok('当天算已完成', win.Planner.isPlanDone(after, win.UI.dayKey()) === true);
    ok('下一周同一时刻仍是未完成', win.Planner.isPlanDone(after, nextKey) === false);
  }

  /* 冲突预警 */
  doc.querySelector('#addPlanLink').click();
  setVal(win, '#pTitle', '冲突测试计划');
  setVal(win, '#pDate', win.UI.dayKey());
  setVal(win, '#pStart', '20:45');
  setVal(win, '#pEnd', '21:30');
  ok('与已有计划重叠时会预警', /已经有安排/.test(text(doc, '#pConflict')), text(doc, '#pConflict'));
  setVal(win, '#pStart', '06:00');
  setVal(win, '#pEnd', '06:30');
  ok('换成空时段后提示不冲突', /不冲突/.test(text(doc, '#pConflict')), text(doc, '#pConflict'));
  doc.querySelector('.modal-backdrop [data-close]').click();

  /* 类型筛选 */
  const chips = Array.from(doc.querySelectorAll('[data-pfilter]'));
  ok('有类型筛选按钮（' + chips.length + ' 个）', chips.length >= 6);
  const sportChip = doc.querySelector('[data-pfilter="运动"]');
  sportChip.click();
  let titles = Array.from(doc.querySelectorAll('#page .plan-title')).map(function (n) { return n.textContent; });
  ok('筛选「运动」后只剩运动类', titles.length > 0 && titles.every(function (t) { return t.indexOf('🏃') >= 0; }),
    titles.slice(0, 3).join(' | '));

  const studyChip = doc.querySelector('[data-pfilter="学习"]');
  studyChip.click();
  titles = Array.from(doc.querySelectorAll('#page .plan-title')).map(function (n) { return n.textContent; });
  ok('筛选「学习」后只剩学习类', titles.length > 0 && titles.every(function (t) { return t.indexOf('📖') >= 0; }),
    titles.slice(0, 3).join(' | '));

  doc.querySelector('[data-pfilter="all"]').click();
  ok('切回「全部」后运动类又回来了',
    doc.querySelector('#page').textContent.includes('操场夜跑 3 公里'));

  const todoChip = doc.querySelector('[data-todo]');
  ok('有「只看未完成」开关', !!todoChip);
  todoChip.click();
  ok('只看未完成时，已打勾的那条被过滤掉',
    !doc.querySelector('#page').textContent.includes('操场夜跑 3 公里') ||
    !!doc.querySelector('.plan-item:not(.done)'));
})();

/* ==========================================================
   5. 今日规划页：作业/计划要能被规划引擎读到
   ========================================================== */
section('5. 今日规划：与作业 / 计划的联动');
(function () {
  const env = boot('plan.html');
  const doc = env.doc, win = env.win;
  const p = win.Planner.build(null);
  ok('规划引擎能构建当天计划', !!p && Array.isArray(p.timeline));
  ok('页面渲染出了优先级清单或空状态',
    !!doc.querySelector('.prio') || !!doc.querySelector('.empty'));
  ok('今日完成进度条存在', !!doc.querySelector('.plan-prog'));
  ok('页面没有把 undefined 渲染出来',
    !/undefined|\[object Object\]|NaN/.test(doc.body.textContent));
})();

/* ==========================================================
   6. 个人中心：数据概览 / 分区列表 / 资料保存
   ========================================================== */
section('6. 个人中心：概览与列表');
(function () {
  const env = boot('me.html');
  const doc = env.doc, win = env.win;
  ok('个人中心渲染成功', doc.querySelector('#page').innerHTML.length > 500,
    String(doc.querySelector('#page').innerHTML.length) + ' 字符');
  ok('数据概览是 5 张卡', doc.querySelectorAll('#page .card.stat').length === 5,
    String(doc.querySelectorAll('#page .card.stat').length));
  ok('概览里没有 undefined / NaN', !/undefined|NaN/.test(doc.querySelector('#page').textContent));

  const keys = ['hw', 'plan', 'lost', 'qa'];
  ok('分区标签齐全（作业/计划/失物/提问）',
    keys.every(function (k) { return !!doc.querySelector('[data-tab="' + k + '"]'); }));
  let badTab = '';
  keys.forEach(function (k) {
    const el = doc.querySelector('[data-tab="' + k + '"]');
    if (!el) { badTab = k + '(缺失)'; return; }
    el.click();
    if (/undefined|NaN|\[object/.test(doc.querySelector('#page').textContent)) badTab = k;
  });
  ok('逐个切换分区都不会渲染出 undefined', badTab === '', badTab);

  setVal(win, '#nick', '测试昵称');
  doc.querySelector('#saveProfile').click();
  ok('保存资料写入了昵称', win.Store.load().user.nickname === '测试昵称', win.Store.load().user.nickname);
  ok('保存后页面重新渲染且没崩', doc.querySelector('#page').innerHTML.length > 500);
})();

/* ==========================================================
   7. 真实课表导入：按钮 → 弹窗 → 粘贴解析 → 确认落库
   —— 这条链路跨了 4 个模块（importedu / store / notices / schedule），
      只有把页面真的跑起来才验得出来。
   ========================================================== */
section('7. 真实课表导入：从按钮到落库');
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

(async function () {
  const env = boot('schedule.html');
  env.doc.querySelector('#impCourse').click();
  ok('导入弹窗只保留两步', env.doc.querySelectorAll('.ie-step').length === 2);
  ok('导入弹窗只有 PDF 文件入口', !!env.doc.querySelector('#iePdfInput') && !env.doc.querySelector('#ieFileInput'));
  ok('移除文字粘贴与抓取脚本入口', !env.doc.querySelector('#iePaste') && !env.doc.querySelector('#ieCopy'));
  ok('未选 PDF 时确认导入禁用', env.doc.querySelector('#ieSave').disabled);
  env.doc.querySelector('#ieClose').click();
  const env2 = boot('me.html');
  env2.doc.querySelector('#impCourseMe').click();
  ok('个人中心也只提供 PDF 导入', !!env2.doc.querySelector('#iePdfInput') && !env2.doc.querySelector('#iePaste'));
  env2.doc.querySelector('#ieClose').click();

  /* ==========================================================
     9. 多账号 & 空课表引导
     —— 以前用任何学号登录看到的都是同一套示例课表；现在新学号必须是空课表，
        并且页面上要给出「去哪儿拿课表」的入口（含温大统一身份认证网址）。
     ========================================================== */
  section('9. 新学号首次登录：空课表 + 引导导入 + 统一身份认证入口');

  const NEW_SID = '20250999';
  const n3 = boot('schedule.html', NEW_SID);
  const doc3 = n3.doc, win3 = n3.win;
  const EDU_URL = win3.Store.EDU_LOGIN_URL;
  ok('课表页在新学号下也能无错渲染', n3.errors.length === 0, n3.errors.join(' | '));
  ok('新学号登录后课表是空的', win3.Store.load().courses.length === 0,
    String(win3.Store.load().courses.length));
  ok('统一身份认证网址已导出', /^https:\/\/source-443\.webvpn\.wzu\.edu\.cn\/login$/.test(EDU_URL), EDU_URL);

  const welcome = doc3.querySelector('#page .home-course-alert');
  ok('课表页使用与首页相同的空课表提示样式', !!welcome);
  ok('课表页提示通过首页 AI 添加课程或上传 PDF',
    !!welcome && /暂无课表/.test(welcome.textContent) &&
    /首页右侧校园 AI 助手/.test(welcome.textContent) && /PDF/.test(welcome.textContent));
  ok('课表页提示不再列出导入步骤或重复按钮',
    !!welcome && !welcome.querySelector('a, button, .ie-steps') && !doc3.querySelector('#welcomeImport, #welcomeAdd'));
  ok('空课表页没有把 undefined 渲染出来',
    !/undefined|\[object Object\]|NaN/.test(doc3.querySelector('#page').textContent));

  doc3.querySelector('#impCourse').click();
  ok('课表页原有导入入口仍能打开弹窗', layers(doc3).length === 1 && !!doc3.querySelector('#iePdfInput'));
  ok('导入弹窗第 1 步提供 PDF 入口', !!doc3.querySelector('#iePdfInput'));
  doc3.querySelector('#modalRoot .modal-foot #ieClose').click();
  ok('关掉导入弹窗', layers(doc3).length === 0);

  /* 「添加课程」里带上统一身份认证网址 */
  doc3.querySelector('#addCourse').click();
  ok('添加课程弹窗打开', layers(doc3).length === 1);
  const cta = doc3.querySelector('#modalRoot .edu-cta');
  ok('添加课程弹窗里带统一身份认证链接',
    !!cta && !!cta.querySelector('a[href="' + EDU_URL + '"]'));
  ok('添加课程弹窗里印出了完整网址', !!cta && cta.textContent.indexOf('source-443.webvpn.wzu.edu.cn') >= 0);
  const goImp = doc3.querySelector('#cGoImport');
  ok('弹窗里有「我这就去导入课表」', !!goImp && typeof goImp.onclick === 'function');
  goImp.click();
  ok('点了直接切到「导入真实课表」弹窗（添加弹窗自动关掉）',
    layers(doc3).length === 1 && !!doc3.querySelector('#iePdfInput'));
  doc3.querySelector('#modalRoot .modal-foot #ieClose').click();

  /* 首页在出行建议下方突出提示，课程区不再重复显示空课表 */
  const n4 = boot('home.html', NEW_SID);
  const doc4 = n4.doc;
  const courseHint = doc4.querySelector('.home-course-alert');
  ok('首页在新学号下也能无错渲染', n4.errors.length === 0, n4.errors.join(' | '));
  ok('首页出行建议下方显示醒目的空课表提示',
    !!courseHint &&
    !!doc4.querySelector('.weather-split') &&
    !!(doc4.querySelector('.weather-split').compareDocumentPosition(courseHint) & 4));
  ok('空课表提示引导使用右侧 AI，且不再列出冗长导入方法',
    !!courseHint && /暂无课表/.test(courseHint.textContent) &&
    /右侧校园 AI 助手/.test(courseHint.textContent) &&
    !doc4.querySelector('.home-course-alert a, .home-course-alert button, #page .edu-cta'));
  ok('首页课程区不重复显示空课表', !doc4.querySelector('.home-course-card'));
  ok('首页没有把 undefined 渲染出来',
    !/undefined|\[object Object\]|NaN/.test(doc4.querySelector('#page').textContent));

  /* 演示账号仍然带着完整示例数据（答辩演示用） */
  const n5 = boot('schedule.html');
  ok('演示账号（20230427）依旧有完整示例课表', n5.win.Store.load().courses.length === 12,
    String(n5.win.Store.load().courses.length));
  ok('演示账号看不到「暂无课表」提示', !n5.doc.querySelector('#page .home-course-alert'));

  /* ---------- 登录页：本机登录过的账号，一键切换 ---------- */
  section('10. 登录页：切换账号 + 数据各存一份');
  const envL = boot('index.html', null);
  const wl = envL.win, dl = envL.doc;
  ok('登录页不再自动登录（测试前置条件）', wl.Store.load().auth.logged === false);
  ok('本机没有账号时，切换区是隐藏的', dl.querySelector('#acctSwitch').hidden === true);

  wl.Store.login('20230427', true);
  wl.Store.login(NEW_SID, true);
  wl.Store.logout();
  wl.eval(fs.readFileSync(path.join(ROOT, 'assets/js/login.js'), 'utf8'));   // 重新渲染名册

  ok('登录页列出本机登录过的两个账号', dl.querySelectorAll('#asList .list-row').length === 2,
    String(dl.querySelectorAll('#asList .list-row').length));
  ok('名册里标出了「上次登录」', dl.querySelector('#asList').textContent.indexOf('上次登录') >= 0);
  ok('名册里区分了「有没有课表」',
    /还没导入课表/.test(dl.querySelector('#asList').textContent) &&
    /课表 12 门/.test(dl.querySelector('#asList').textContent),
    dl.querySelector('#asList').textContent.replace(/\s+/g, ' ').slice(0, 120));
  ok('退出登录后仍在名册里（数据没丢）', wl.Store.accounts().length === 2);

  const swBtn = dl.querySelector('#asList [data-switch="20230427"]');
  ok('每个账号都有「切换」按钮，且事件委托已绑上',
    !!swBtn && typeof dl.querySelector('#asList').onclick === 'function');
  swBtn.click();
  ok('点一下直接切过去，不用重输密码',
    wl.Store.load().auth.logged === true && wl.Store.load().auth.sid === '20230427',
    wl.Store.load().auth.sid);
  ok('切过去看到的是那个账号自己的课表（12 门）', wl.Store.load().courses.length === 12,
    String(wl.Store.load().courses.length));

  dl.querySelector('#asList [data-forget="' + NEW_SID + '"]').click();
  ok('「移除账号」第一下只是二次确认', dl.querySelectorAll('#asList .list-row').length === 2 &&
    dl.querySelector('#asList [data-forget="' + NEW_SID + '"]').getAttribute('data-armed') === '1');
  dl.querySelector('#asList [data-forget="' + NEW_SID + '"]').click();
  ok('第二下真的将其从本机移除',
    dl.querySelectorAll('#asList .list-row').length === 1 &&
    !dl.querySelector('#asList [data-forget="' + NEW_SID + '"]'));
  ok('移除后名册只剩演示账号', wl.Store.accounts().length === 1 && wl.Store.accounts()[0].sid === '20230427');

  /* ---------- 传课表 PDF ---------- */
  section('11. 传课表 PDF：识别 → 预览 → 落库');
  const envP = boot('schedule.html');
  const docP = envP.doc, winP = envP.win;
  ok('页面加载了 PDF 识别模块', typeof winP.PdfEdu === 'object' && !!winP.PdfEdu);

  docP.querySelector('#impCourse').click();
  ok('导入弹窗里有「选择课表 PDF」按钮', !!docP.querySelector('#iePdf'));
  ok('导入弹窗里有拖放区', !!docP.querySelector('#ieDrop'));
  ok('文件选择框只收 PDF',
    /pdf/i.test(docP.querySelector('#iePdfInput').getAttribute('accept') || ''),
    docP.querySelector('#iePdfInput').getAttribute('accept'));
  ok('有识别状态的展示位', !!docP.querySelector('#iePdfState'));

  /* jsdom 里没法真的选文件，但 onchange 是真实触发的 */
  function pickPdf(win, doc, result) {
    win.PdfEdu.extractFile = function () { return Promise.resolve(result); };
    const input = doc.querySelector('#iePdfInput');
    Object.defineProperty(input, 'files', {
      value: [{ name: '我的课表.pdf', type: 'application/pdf' }], configurable: true
    });
    input.onchange.call(input);
  }

  const PDF_LINES = [
    '周一 第1-2节 数据结构 陈立 计算机楼-408 1-16周',
    '周二 第6-7节 计算机网络 赵倩 计算机楼-315 1-16周'
  ];

  pickPdf(winP, docP, {
    text: PDF_LINES.join('\n'), lines: PDF_LINES, mode: 'grid',
    cols: 4, pages: 1, items: 20, scanned: false, warnings: []
  });
  await tick(); await tick();

  ok('识别结果显示在预览里', docP.querySelector('#iePreview').textContent.includes('数据结构'));
  ok('给了识别概览（页数 / 列数 / 表格结构）',
    /表格结构/.test(docP.querySelector('#iePdfState').textContent) &&
    /1 页/.test(docP.querySelector('#iePdfState').textContent),
    docP.querySelector('#iePdfState').textContent.replace(/\s+/g, ' ').slice(0, 90));
  ok('识别后自动解析出 2 条课程', docP.querySelectorAll('#iePreview .ie-row').length === 2,
    String(docP.querySelectorAll('#iePreview .ie-row').length));
  ok('「确认导入」变为可点', docP.querySelector('#ieSave').disabled === false);
  ok('预览里标了来源是 PDF',
    docP.querySelector('#iePreview').textContent.indexOf('课表 PDF 自动识别') >= 0,
    docP.querySelector('#iePreview').textContent.replace(/\s+/g, ' ').slice(0, 90));

  docP.querySelector('#ieSave').click();
  await tick(); await tick();
  docP.querySelector('#modalRoot [data-yes]').click();
  await tick(); await tick();
  ok('PDF 识别出来的课真的落库了',
    winP.Store.load().courses.length === 2 &&
    winP.Store.load().courses.some(function (c) { return c.name === '计算机网络'; }),
    JSON.stringify(winP.Store.load().courses.map(function (c) { return c.name; })));
  ok('导入后弹窗关闭、页面重渲染没崩',
    layers(docP).length === 0 && docP.querySelector('#page').innerHTML.length > 500);

  /* 扫描件要提前拦住，不能装作成功 */
  docP.querySelector('#impCourse').click();
  pickPdf(winP, docP, {
    text: '', lines: [], mode: 'flat', cols: 0, pages: 1, items: 0, scanned: true, warnings: []
  });
  await tick(); await tick();
  ok('扫描件 PDF 给出明确提示',
    docP.querySelector('#iePdfState').textContent.indexOf('扫描件') >= 0,
    docP.querySelector('#iePdfState').textContent.replace(/\s+/g, ' ').slice(0, 90));
  ok('扫描件不会产生课程预览', docP.querySelectorAll('#iePreview .ie-row').length === 0);
  ok('扫描件时「确认导入」保持禁用', docP.querySelector('#ieSave').disabled === true);

  /* 节次是推断出来的，必须提醒核对 */
  pickPdf(winP, docP, {
    text: PDF_LINES[0], lines: [PDF_LINES[0]], mode: 'grid', cols: 4, pages: 1, items: 10, scanned: false,
    warnings: ['有 1 条课程的节次是按顺序推断的（PDF 里没写第几节），导入后请核对']
  });
  await tick(); await tick();
  ok('节次靠推断时会提醒核对',
    docP.querySelector('#iePdfState').textContent.indexOf('核对') >= 0,
    docP.querySelector('#iePdfState').textContent.replace(/\s+/g, ' ').slice(0, 110));

  /* 拖放：确认事件真的接上了 */
  const dz = docP.querySelector('#ieDrop');
  dz.dispatchEvent(new winP.Event('dragover', { bubbles: true, cancelable: true }));
  ok('PDF 拖上去会高亮', dz.classList.contains('on'), 'class=' + dz.className);
  dz.dispatchEvent(new winP.Event('dragleave', { bubbles: true, cancelable: true }));
  ok('拖走之后高亮取消', !dz.classList.contains('on'));
  dz.dispatchEvent(new winP.Event('drop', { bubbles: true, cancelable: true }));
  ok('空拖放不会报错（没文件就什么都不做）', !!docP.querySelector('#ieDrop'));

  /* ==========================================================
     12. 首页「一句话记下来」：从输入到落库
     ========================================================== */
  section('12. 首页两栏与校园 AI 助手');
  const eN = boot('home.html'), dN=eN.doc, wN=eN.win;
  ok('首页脚本无异常',eN.errors.length===0,eN.errors.join(' | '));
  ok('左侧信息与右侧助手分栏',!!dN.querySelector('.home-main')&&!!dN.querySelector('.home-assistant'));
  ok('助手输入与发送入口存在',!!dN.querySelector('#assistantText')&&!!dN.querySelector('#assistantSend'));
  ok('模型已标注',dN.querySelector('.home-assistant').textContent.includes('DeepSeek Flash'));
  ok('保留首页规划总结',dN.querySelectorAll('#sumLines .sum-line').length>=4);
  wN.CampusAssistant.run('查看逾期作业');
  ok('本地查询立即返回结果',wN.CampusAssistant.messages.some(x=>x.role==='assistant'&&x.text.includes('第四章')));
  const prior=wN.Store.load().plans.length;
  wN.CampusAssistant.execute({tool:'plan.create',args:{title:'测试计划',date:'2026-09-23',start:'07:00',end:'09:00'}});
  ok('结构化操作写入当前账号',wN.Store.load().plans.length===prior+1);
  let rejected=false;try{wN.CampusAssistant.execute({tool:'eval',args:{}});}catch(e){rejected=true;}
  ok('不执行任意脚本',rejected);
  dN.querySelector('#assistantClear').click();
  ok('清空对话回到示例入口',dN.querySelectorAll('[data-assistant-example]').length>=3);
  const eHP=boot('home.html'),dHP=eHP.doc,wHP=eHP.win;
  ok('首页 AI 可直接选择课表 PDF',
    !!dHP.querySelector('#assistantPdfAttach') && /pdf/i.test(dHP.querySelector('#assistantPdfFile').accept));
  let homePdfCalls=0;
  wHP.PdfEdu.extractFile=function(){homePdfCalls++;return Promise.resolve({
    text:'周一 第1-2节 计算机网络 赵倩 计算机楼-315 1-16周',
    lines:['周一 第1-2节 计算机网络 赵倩 计算机楼-315 1-16周'],
    mode:'grid',cols:4,pages:1,items:10,scanned:false,warnings:[]
  });};
  const beforeHomePdf=wHP.Store.load().courses.length;
  const homePdfInput=dHP.querySelector('#assistantPdfFile');
  Object.defineProperty(homePdfInput,'files',{value:[{name:'首页课表.pdf',type:'application/pdf'}],configurable:true});
  homePdfInput.onchange.call(homePdfInput);
  await tick();await tick();
  ok('首页选完 PDF 立即本地识别并展示预览',
    homePdfCalls===1 && dHP.querySelector('#iePreview').textContent.includes('计算机网络'));
  ok('核对前不修改现有课表',wHP.Store.load().courses.length===beforeHomePdf);
  dHP.querySelector('#ieSave').click();await tick();
  dHP.querySelector('#modalRoot [data-yes]').click();await tick();await tick();
  ok('首页确认后更新课表并在对话区反馈',
    wHP.Store.load().courses.length===1 && wHP.Store.load().courses[0].name==='计算机网络' &&
    dHP.querySelector('#assistantMessages').textContent.includes('已从课表 PDF 更新课表'));

  section('13. 通知卡片移除，改由 AI 添加课程调整');
  const eR = boot('schedule.html', '20257777');
  ok('真实学号课表页无错', eR.errors.length === 0);
  ok('真实学号没有虚构调课通知', eR.win.Store.load().courseNotices.length === 0);
  ok('真实学号不渲染通知卡', !eR.doc.querySelector('.schedule-notices'));
  const eD = boot('schedule.html');
  ok('演示账号也没有调课样本', eD.win.Store.load().courseNotices.length === 0 && !eD.doc.querySelector('.schedule-notices'));
  ok('课表使用独立居中布局且不再显示课程清单',
    eD.doc.querySelector('#page').classList.contains('schedule-page') &&
    !!eD.doc.querySelector('.tt-scroll .tt') &&
    !eD.doc.textContent.includes('课程清单'));
  ok('课程详情仍可从课表卡片打开', !!eD.doc.querySelector('.tt-course[data-id]'));
  ok('顶栏没有独立调课入口', !eD.doc.querySelector('.topnav a[href="notice.html"]'));
  ok('首页 AI 有截图上传入口', !!dN.querySelector('#assistantAttach') && !!dN.querySelector('#assistantImageFile'));
  const manual=wN.CampusAssistant.execute({tool:'adjust.create',args:{type:'move',course:'数据结构',fromWeek:3,fromDay:2,fromStart:6,fromSpan:2,toWeek:3,toDay:4,toStart:3,toSpan:2,toRoom:'计算机楼-402'}});
  ok('AI 调课写入并应用', /已应用/.test(manual) && !wN.Store.coursesOn(2,3).some(c=>c.name==='数据结构'));

  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})();
