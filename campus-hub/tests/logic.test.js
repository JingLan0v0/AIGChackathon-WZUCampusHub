/* 校园百事通 · 逻辑冒烟测试
   用法：node tests/logic.test.js
   在 Node 的 vm 沙箱里伪造 localStorage / fetch，直接加载 assets/js 下的真实模块，
   覆盖：数据层与旧数据迁移、时间工具、今日规划引擎（空档不冲突 / 排序正确）、
         天气（国内源 UAPIS / 境外 Open-Meteo、wttr.in 三源降级、文本→WMO 码翻译、
         断网降级、缓存回退、load() 永不 reject）、登录门禁、
         教务调课通知（抓取去重 / 原文解析 / 应用到课表 / 撤销 / 时间轴联动）、
         真实课表导入（JSON / 纯文本解析、字段识别、入库、导入通知联动、恢复示例数据）、
         旧数据清理（示例课表从真实学号里摘掉）、多账号隔离（换学号不再共用一套课表）。*/

/* 校园百事通 · 今日规划 / 天气 逻辑冒烟测试（Node 环境，无需浏览器） */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DIR = ROOT + '/assets/js';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}

/* ---------- 构造浏览器环境 ---------- */
const mem = {};
const storage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
/* 沙箱里的「当前时刻」必须完全可控：今日规划的空档、课表「今天有没有课」、
   调课通知「是否影响今天」，全都依赖 now。
   只固定钟点不够 —— 示例课表周二才有课、样本调课通知也都落在第 3 周周二，
   所以连日期一起钉在 2026-09-22（第 3 周周二）09:30，任何时候跑结果都一样。 */
const PIN_Y = 2026, PIN_M = 8, PIN_D = 22;    // 注意：月份从 0 起，8 = 九月
let clockHM = [9, 30];
const RealDate = Date;
class ClockDate extends RealDate {
  constructor(...a) {
    if (!a.length) { super(PIN_Y, PIN_M, PIN_D, clockHM[0], clockHM[1], 0, 0); }
    else { super(...a); }
  }
  static now() { return new RealDate(PIN_Y, PIN_M, PIN_D, clockHM[0], clockHM[1], 0, 0).getTime(); }
}
function setClock(h, m) { clockHM = [h, m]; }

const ctx = vm.createContext({
  console, Date: ClockDate, Math, JSON, Promise, setTimeout, clearTimeout, parseInt, parseFloat, isNaN, Infinity, Object, Array, String, Number, Boolean, Error,
  localStorage: storage, sessionStorage: storage
});

function load(f) { vm.runInContext(fs.readFileSync(DIR + '/' + f, 'utf8'), ctx, { filename: f }); }

/* ---------- 伪造 Open-Meteo 返回 ---------- */
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function fakeWeather(opts) {
  opts = opts || {};
  const code = opts.code === undefined ? 3 : opts.code;
  const pop = opts.pop === undefined ? 20 : opts.pop;
  const tmax = opts.tmax === undefined ? 30 : opts.tmax;
  const tmin = opts.tmin === undefined ? 24 : opts.tmin;
  const now = new ClockDate();
  const day0 = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  const hours = [], temp = [], pops = [], codes = [];
  for (let d = 0; d < 4; d++) {
    const dd = new Date(now.getTime() + d * 86400000);
    const key = dd.getFullYear() + '-' + pad2(dd.getMonth() + 1) + '-' + pad2(dd.getDate());
    for (let h = 0; h < 24; h++) {
      hours.push(key + 'T' + pad2(h) + ':00');
      temp.push(tmin + (tmax - tmin) * Math.sin(Math.PI * h / 24));
      pops.push(pop);
      codes.push(code);
    }
  }
  const curHour = pad2(now.getHours());
  return {
    latitude: 27.87, longitude: 120.71, timezone: 'Asia/Shanghai',
    current: {
      time: day0 + 'T' + curHour + ':' + pad2(now.getMinutes()), interval: 900,
      temperature_2m: 28.6, relative_humidity_2m: 59, apparent_temperature: 31.8,
      precipitation: code >= 51 ? 0.4 : 0, is_day: 1, weather_code: code, wind_speed_10m: 2.8
    },
    hourly: { time: hours, temperature_2m: temp, precipitation_probability: pops, weather_code: codes },
    daily: {
      time: [0, 1, 2, 3].map(d => {
        const dd = new Date(now.getTime() + d * 86400000);
        return dd.getFullYear() + '-' + pad2(dd.getMonth() + 1) + '-' + pad2(dd.getDate());
      }),
      weather_code: [code, code, 2, 0],
      temperature_2m_max: [tmax, tmax + 1, tmax + 2, tmax + 3],
      temperature_2m_min: [tmin, tmin, tmin - 1, tmin - 2],
      precipitation_probability_max: [pop, pop, 10, 5],
      precipitation_sum: [code >= 51 ? 3.2 : 0, 0, 0, 0],
      wind_speed_10m_max: [12, 14, 10, 8],
      uv_index_max: [6.2, 6.5, 7, 7.2]
    }
  };
}

/* ---------- 伪造 wttr.in 返回（备用源） ---------- */
function fakeWttr(opts) {
  opts = opts || {};
  const code = opts.code === undefined ? 116 : opts.code;       // 注意：这是 WW 码
  const chance = opts.pop === undefined ? 20 : opts.pop;
  const tmax = opts.tmax === undefined ? 30 : opts.tmax;
  const tmin = opts.tmin === undefined ? 24 : opts.tmin;
  const now = new ClockDate();
  /* wttr 的 observation_time 是 UTC，这里照着真实返回伪造 */
  const uh = (now.getHours() + 24 - 8) % 24;
  const obs = pad2(uh % 12 === 0 ? 12 : uh % 12) + ':' + pad2(now.getMinutes()) + ' ' + (uh < 12 ? 'AM' : 'PM');

  const days = [];
  for (let d = 0; d < 3; d++) {
    const dd = new Date(now.getTime() + d * 86400000);
    const date = dd.getFullYear() + '-' + pad2(dd.getMonth() + 1) + '-' + pad2(dd.getDate());
    const hourly = [];
    for (let h = 0; h < 24; h += 3) {
      hourly.push({
        time: pad2(h) + '00',
        tempC: String(Math.round(tmin + (tmax - tmin) * Math.sin(Math.PI * h / 24))),
        weatherCode: String(code),
        chanceofrain: String(chance),
        precipMM: '0.0', humidity: '60', windspeedKmph: '12',
        weatherDesc: [{ value: 'x' }]
      });
    }
    days.push({ date: date, maxtempC: String(tmax), mintempC: String(tmin), uvIndex: '6', hourly: hourly });
  }
  return {
    current_condition: [{
      temp_C: String(tmax - 1), FeelsLikeC: String(tmax + 1), humidity: '60',
      windspeedKmph: '9', precipMM: '0.0', weatherCode: String(code),
      observation_time: obs, weatherDesc: [{ value: 'x' }]
    }],
    nearest_area: [{ areaName: [{ value: 'Wenzhou' }] }],
    weather: days
  };
}

/* ---------- 伪造 UAPIS 返回（国内主源） ---------- */
function fakeUapis(opts) {
  opts = opts || {};
  const text = opts.text === undefined ? '晴' : opts.text;        // 中文文本，不是码表
  const tmax = opts.tmax === undefined ? 31 : opts.tmax;
  const tmin = opts.tmin === undefined ? 23 : opts.tmin;
  const pop = opts.pop === undefined ? 0 : opts.pop;
  const now = new ClockDate();
  const key = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

  /* 真实返回里第一条逐时就是「实况观测时刻」（带秒），后面才是整点 */
  const hourly = [{
    time: key(now) + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':08',
    temperature: tmax - 1, weather: text, wind_speed: 12, humidity: 56, feels_like: tmax + 2, pop: pop
  }];
  for (let h = 1; h <= 30; h++) {
    const dd = new Date(now.getTime() + h * 3600000);
    hourly.push({
      time: key(dd) + ' ' + pad2(dd.getHours()) + ':00:00',
      temperature: Math.round((tmax + tmin) / 2), weather: text,
      wind_speed: 10, humidity: 60, feels_like: tmax, pop: pop
    });
  }

  const forecast = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const dd = new Date(now.getTime() + d * 86400000);
    return {
      date: key(dd), week: '星期' + '日一二三四五六'.charAt(dd.getDay()),
      temp_max: tmax + d, temp_min: tmin + d,
      weather_day: text, weather_night: text,
      wind_speed_day: 17, humidity: 71, precip: d === 5 ? 3 : 0,
      pop: d === 5 ? 60 : pop, uv_index: 4, sunrise: '05:46', sunset: '17:55'
    };
  });

  return {
    province: '浙江省', city: '温州市', adcode: '330300',
    weather: text, weather_icon: '100', temperature: tmax - 1,
    wind_direction: '东北风', wind_power: '3级', humidity: 56,
    report_time: '7 分钟前发布', temp_max: tmax, temp_min: tmin,
    feels_like: tmax + 2, uv: 4, aqi: 53, precipitation: 0,
    forecast: forecast, hourly_forecast: hourly
  };
}

(async function run() {
  console.log('— 加载模块 —');
  load('store.js'); load('ui.js'); load('weather.js'); load('planner.js'); load('notices.js'); load('importedu.js'); load('nl.js'); load('assistant-actions.js'); load('assistant.js');
  const { Store, UI, Weather, Planner, Adjust, ImportEdu, NL } = ctx;
  ok('首页 AI 提供照片／截图入口', ctx.CampusAssistant.html().includes('assistantImageFile'));

  console.log('\n— 1. 数据层 —');
  const db = Store.load();
  ok('localStorage 中存在种子数据', !!db && db.version === 1);
  ok('homeworks 已注入（7 条）', Array.isArray(db.homeworks) && db.homeworks.length === 7, 'len=' + (db.homeworks || []).length);
  ok('plans 已注入（6 条）', Array.isArray(db.plans) && db.plans.length === 6, 'len=' + (db.plans || []).length);
  ok('作业字段完整', db.homeworks.every(h => h.id && h.title && h.course && h.due && h.level && h.hours !== undefined));
  ok('计划字段完整', db.plans.every(p => p.id && p.title && p.type && p.date && p.level && p.repeat));
  ok('至少一条作业今天截止', db.homeworks.some(h => UI.dayKey(new Date(UI.parseDT(h.due))) === UI.dayKey()));
  ok('至少一条作业已逾期', db.homeworks.some(h => UI.countdown(UI.parseDT(h.due)).late));
  ok('edu 接入点存在', typeof Store.syncCourses === 'function' && Store.EDU_FLOW.length === 5);
  const sportsDay = db.calendar.find(c => c.name === '校运动会');
  const finalExams = db.calendar.find(c => c.name === '期末考试');
  ok('校历使用真实第一学期日期与多日区间',
    sportsDay && sportsDay.date === '2026-11-19' && sportsDay.endDate === '2026-11-20' &&
    finalExams && finalExams.date === '2027-01-11' && finalExams.endDate === '2027-01-18' &&
    !db.calendar.some(c => c.date === '2026-11-06'));
  ok('校历只包含第一学期，日期依次排列',
    db.calendar.length >= 15 && db.calendar[0].date === '2026-09-06' &&
    db.calendar[db.calendar.length - 1].endDate === '2027-02-21' &&
    db.calendar.every((c, i) => !i || c.date >= db.calendar[i - 1].date));

  /* 旧数据（无 homeworks）自动补齐 */
  const legacy = JSON.parse(JSON.stringify(db));
  delete legacy.homeworks; delete legacy.plans;
  delete legacy.calendarVersion;
  delete legacy.bellScheduleVersion;
  legacy.courses.push({ id: 'old-evening', name: '旧版晚课', day: 1, start: 11, span: 1, from: 1, to: 16 });
  legacy.calendar = [{ name: '旧校运动会样本', date: '2026-11-06', emoji: '🏅' }];
  mem['wzu-campus-hub'] = JSON.stringify(legacy);
  // 强制重新读取
  const ctx2 = vm.createContext({ console, Date, Math, JSON, Promise, setTimeout, clearTimeout, parseInt, parseFloat, isNaN, Infinity, Object, Array, String, Number, Boolean, Error, localStorage: storage, sessionStorage: storage });
  vm.runInContext(fs.readFileSync(DIR + '/store.js', 'utf8'), ctx2);
  const db2 = ctx2.Store.load();
  ok('旧版数据自动补齐 homeworks / plans', Array.isArray(db2.homeworks) && db2.homeworks.length === 7 && Array.isArray(db2.plans) && db2.plans.length === 6);
  ok('已保存账号的旧校历会换成第一学期真实校历',
    db2.calendar.some(c => c.name === '校运动会' && c.date === '2026-11-19') &&
    !db2.calendar.some(c => c.date === '2026-11-06'));
  ok('旧版整段晚课迁移为第 11–13 节',
    db2.courses.some(c => c.id === 'old-evening' && c.start === 11 && c.span === 3) && db2.bellScheduleVersion === 2);

  console.log('\n— 2. 时间工具 —');
  ok('dayKey 格式', /^\d{4}-\d{2}-\d{2}$/.test(UI.dayKey()));
  ok('toMin/toHM 往返一致', UI.toHM(UI.toMin('14:20')) === '14:20', UI.toHM(UI.toMin('14:20')));
  ok('countdown 未来为「还剩」', UI.countdown(ClockDate.now() + 3600000).text.indexOf('还剩') === 0, UI.countdown(ClockDate.now() + 3600000).text);
  ok('countdown 过去为「已逾期」', UI.countdown(ClockDate.now() - 3600000).text.indexOf('已逾期') === 0);
  ok('dueText 今天', UI.dueText(UI.dayKey() + 'T23:59') === '今天 23:59', UI.dueText(UI.dayKey() + 'T23:59'));
  ok('dueText 明天', UI.dueText(UI.dayKey(new Date(ClockDate.now() + 86400000)) + 'T20:00') === '明天 20:00');
  ok('导航 6 项 / 标签栏 5 项', UI.NAV.length === 6 && UI.TABS.length === 5);
  ok('NAV 含今日规划 / 作业 / 课表', UI.NAV.some(n => n.key === 'plan') && UI.NAV.some(n => n.key === 'homework') && UI.NAV.some(n => n.key === 'schedule'));

  /* 作息表是全校课表 / 规划 / 通知共用的单一数据源，改动会波及一片，
     所以把它钉死：节数、首末时间、起讫配对、递增性、班次序号。 */
  const expectedBells = [
    ['08:20', '09:00'], ['09:05', '09:45'], ['10:10', '10:50'],
    ['10:55', '11:35'], ['11:40', '12:20'], ['13:30', '14:10'],
    ['14:15', '14:55'], ['15:20', '16:00'], ['16:05', '16:45'],
    ['16:50', '17:30'], ['18:30', '19:10'], ['19:15', '19:55'],
    ['20:00', '20:40']
  ];
  ok('作息表 13 节与图片逐节一致', UI.BELLS.length === 13 && UI.BELL_ENDS.length === 13 &&
    expectedBells.every(([start, end], i) => UI.BELLS[i] === start && UI.BELL_ENDS[i] === end),
    UI.BELLS.map((t, i) => t + '-' + UI.BELL_ENDS[i]).join(' '));
  ok('每次下课都晚于上课（两节之间有大课间，间隔不相等，不能算出来）',
    UI.BELLS.every((t, i) => UI.toMin(UI.BELL_ENDS[i]) > UI.toMin(t)),
    UI.BELLS.map((t, i) => t + '-' + UI.BELL_ENDS[i]).join(' '));
  ok('节次时间递增', UI.BELLS.every((t, i) => i === 0 || UI.toMin(t) > UI.toMin(UI.BELLS[i - 1])));
  ok('bellRange：第 3-4 节 → 10:10–11:35', UI.bellRange(3, 2) === '10:10–11:35', UI.bellRange(3, 2));
  ok('bellRange：第 11 节（单节）→ 18:30–19:10', UI.bellRange(11, 1) === '18:30–19:10', UI.bellRange(11, 1));
  ok('bellRange：第 11–13 节 → 18:30–20:40', UI.bellRange(11, 3) === '18:30–20:40', UI.bellRange(11, 3));
  ok('bellRange 越界时按最后一节收口', UI.bellRange(13, 3) === '20:00–20:40', UI.bellRange(13, 3));
  ok('bellEnd 按「第几节下课」取', UI.bellEnd(4) === '11:35' && UI.bellEnd(1) === '09:00');

  console.log('\n— 3. 今日规划引擎 —');
  const plan = Planner.build(null);
  ok('summary 非空且提到今天', !!plan.summary && plan.summary.indexOf('今天') === 0, plan.summary);
  ok('priority 非空', plan.priority.length > 0, 'len=' + plan.priority.length);
  ok('priority 按逾期、高、中、低排序', plan.priority.every((x, i, a) => i === 0 || (a[i - 1].urgent ? 4 : a[i - 1].level) >= (x.urgent ? 4 : x.level)),
    JSON.stringify(plan.priority.map(x => [x.urgent, x.level])));
  ok('priority 首位是逾期作业', plan.priority[0].kind === 'homework' && plan.priority[0].urgent === true,
    plan.priority[0].kind + '/' + plan.priority[0].urgent + '/' + plan.priority[0].short);
  ok('counts.overdue ≥ 1', plan.counts.overdue >= 1, 'overdue=' + plan.counts.overdue);
  ok('timeline 非空且按时间升序', plan.timeline.length > 0 && plan.timeline.every((x, i, a) => i === 0 || a[i - 1].from <= x.from));
  ok('timeline 含课程', plan.timeline.some(x => x.kind === 'course'));

  /* 「一条一行」的规划总结 —— 学生加完作业/计划后必须能立刻看出变化，
     这是 forey 明确提的诉求（原来一句话版压根不提课外计划，加完等于没加） */
  const lineOf = (p, ico) => ((p.summaryLines || []).filter(x => x.ico === ico)[0] || {}).text || '';
  ok('summaryLines 是一行一条，课程 / 作业 / 课外计划各有其行', (function () {
    const ls = plan.summaryLines || [];
    return ls.length >= 4 && lineOf(plan, '📅') && lineOf(plan, '📝') && lineOf(plan, '🧭') && lineOf(plan, '🎯');
  })(), JSON.stringify((plan.summaryLines || []).map(x => x.ico)));
  ok('每行都有图标与文字，tone 规范', (plan.summaryLines || []).every(x =>
    x.ico && x.text && ['plain', 'urgent', 'warn', 'ok'].indexOf(x.tone) >= 0));
  ok('summary 保留一句话版且仍以「今天」开头（旧逻辑/别处还在用）',
    typeof plan.summary === 'string' && plan.summary.indexOf('今天') === 0);
  ok('临近上课时首行给出课程时间和课表入口',
    plan.summaryLines[0].featured && plan.summaryLines[0].href === 'schedule.html' &&
    plan.summaryLines[0].text.indexOf('10:10') >= 0, plan.summaryLines[0].text);

  /* 首页首行应优先处理今天的真实截止项；昨天错过的计划只能进入补救提醒。 */
  setClock(12, 0);
  const dbAction = Store.load();
  dbAction.plans.push({
    id: 'pYesterdayAction', title: '测试：昨日自习', type: '学习', taskGroup: 'academic',
    date: '2026-09-21', start: '19:00', end: '20:00', place: '图书馆', level: 3,
    repeat: 'none', status: 'todo', createdAt: ClockDate.now()
  });
  Store.save();
  const actionPlan = Planner.build(null);
  const firstAction = actionPlan.summaryLines[0];
  ok('首页首行突出今天截止的具体作业并通向作业页',
    firstAction.featured && firstAction.href === 'homework.html' &&
    actionPlan.dueToday.some(x => firstAction.text.indexOf(x.title) >= 0), firstAction.text);
  ok('昨日未完成的学习计划只作为补救，不冒充下一步',
    firstAction.text.indexOf('昨日自习') < 0 &&
    actionPlan.summaryLines.some(x => x.ico === '⚠️' && x.text.indexOf('学习任务') >= 0));
  dbAction.plans = dbAction.plans.filter(x => x.id !== 'pYesterdayAction');
  Store.save();
  setClock(9, 30);

  const planLineBefore = lineOf(plan, '🧭');
  const hwLineBefore = lineOf(plan, '📝');
  const dbAdd = Store.load();
  dbAdd.plans.push({
    id: 'pTestSummary', title: '测试：傍晚散步', type: '生活', date: UI.dayKey(new ClockDate()),
    start: '21:10', end: '21:40', place: '操场', level: 1, repeat: 'none',
    note: '', status: 'todo', createdAt: ClockDate.now()
  });
  dbAdd.homeworks.push({
    id: 'hTestSummary', title: '测试：预习下一章', course: '数据结构',
    due: UI.dayKey(new Date(ClockDate.now() + 5 * 86400000)) + 'T23:59',
    level: 1, hours: 1, note: '', status: 'todo', createdAt: ClockDate.now()
  });
  Store.save();
  const plan2 = Planner.build(null);
  ok('加一条今天的课外计划 → 「课外计划」那行立刻变了（今天项数 +1）',
    lineOf(plan2, '🧭') !== planLineBefore && Number(/今天 (\d+) 项/.exec(lineOf(plan2,'🧭'))[1])===Number(/今天 (\d+) 项/.exec(planLineBefore)[1])+1,
    planLineBefore + '  →  ' + lineOf(plan2, '🧭'));
  ok('加一条 5 天后到期的作业 → 「作业」那行也会变（带上了待完成总数与最近 DDL）',
    lineOf(plan2, '📝') !== hwLineBefore && lineOf(plan2, '📝').indexOf('待完成共 8 项') >= 0,
    hwLineBefore + '  →  ' + lineOf(plan2, '📝'));

  /* 还原，别污染后面的断言 */
  const dbBack = Store.load();
  dbBack.plans = dbBack.plans.filter(x => x.id !== 'pTestSummary');
  dbBack.homeworks = dbBack.homeworks.filter(x => x.id !== 'hTestSummary');
  Store.save();
  ok('清理测试数据后回到原状', Store.load().plans.length === 6 && Store.load().homeworks.length === 7,
    Store.load().plans.length + '/' + Store.load().homeworks.length);
  ok('timeline 含建议专注时段', plan.timeline.some(x => x.kind === 'focus'), 'focus=' + plan.focus.length);
  ok('timeline 含饭点', plan.timeline.filter(x => x.kind === 'meal').length === 2);

  /* 空档必须落在 08:00–22:00，且不与任何课程重叠 */
  const courseRanges = plan.courses.map(c => ({
    from: UI.toMin(UI.BELLS[c.start - 1]),
    to: UI.toMin(UI.bellEnd((c.start - 1) + c.span)),
    name: c.name
  }));
  ok('空档时段在 08:00–22:00 内', plan.focus.every(f => f.from >= 480 && f.to <= 1320));
  const clash = plan.focus.filter(f => courseRanges.some(c => f.from < c.to && f.to > c.from));
  ok('空档不与上课时间冲突', clash.length === 0, JSON.stringify(clash.slice(0, 2)));

  /* 空档总和不应超过当天剩余可用时间 */
  const focusTotal = plan.focus.reduce((n, f) => n + f.minutes, 0);
  ok('专注时长为正', focusTotal > 0, focusTotal + ' 分钟');
  ok('专注时长不超过待办总工作量', focusTotal <= plan.workload.total * 60 + 60, focusTotal + ' vs ' + plan.workload.total * 60);

  /* 空档不重叠 */
  const sortedF = plan.focus.slice().sort((a, b) => a.from - b.from);
  ok('空档之间互不重叠', sortedF.every((f, i, a) => i === 0 || a[i - 1].to <= f.from));

  console.log('\n— 4. 渲染片段 —');
  const ph = Planner.priorityHtml(plan), th = Planner.timelineHtml(plan), fh = Planner.focusHtml(plan);
  ok('priorityHtml 无 undefined/NaN', ph.indexOf('undefined') < 0 && ph.indexOf('NaN') < 0 && ph.length > 100);
  ok('timelineHtml 无 undefined/NaN', th.indexOf('undefined') < 0 && th.indexOf('NaN') < 0 && th.length > 100);
  ok('focusHtml 无 undefined/NaN', fh.indexOf('undefined') < 0 && fh.indexOf('NaN') < 0 && fh.length > 50);

  /* 空数据边界 */
  const backup = { c: db.courses, h: db.homeworks, p: db.plans };
  db.homeworks = []; db.plans = [];
  const emptyPlan = Planner.build(null);
  ok('无作业无计划时 priority 为空不报错', emptyPlan.priority.length === 0);
  ok('无作业无计划时 focus 有兜底文案', Planner.focusHtml(emptyPlan).indexOf('<div class="focus-empty">') === 0, Planner.focusHtml(emptyPlan).slice(0, 40));
  ok('无作业无计划时 timeline 仍有课程/饭点', emptyPlan.timeline.length > 0);
  db.courses = []; db.homeworks = []; db.plans = [];
  const blank = Planner.build(null);
  ok('全空时时间轴给出空状态', Planner.timelineHtml(blank).indexOf('empty') >= 0);
  db.courses = backup.c; db.homeworks = backup.h; db.plans = backup.p;

  /* 深夜边界：距 22:00 不足一场专注时，空档必然为空 —— 文案要说清是「时间不够」而不是「排满了」 */
  setClock(23, 0);
  const latePlan = Planner.build(null);
  ok('深夜（23:00）排不出空档（剩余不足 MIN_GAP）', latePlan.focus.length === 0, 'focus=' + latePlan.focus.length);
  ok('深夜仍未到截止时刻的作业继续标为今天截止',
    latePlan.dueToday.some(x => latePlan.summaryLines[0].text.indexOf(x.title) >= 0) &&
    latePlan.summaryLines[0].text.indexOf('今天') >= 0, latePlan.summaryLines[0].text);
  ok('深夜 focusHtml 说清原因，不装作「排满了」',
    /不够安排一场专注|已经过了 22:00/.test(Planner.focusHtml(latePlan)), Planner.focusHtml(latePlan).slice(0, 70));
  setClock(9, 30);
  const dayPlan = Planner.build(null);
  ok('基准时刻（09:30）能排出空档（测试不再受跑测试的钟点影响）', dayPlan.focus.length > 0, 'focus=' + dayPlan.focus.length);

  console.log('\n— 5. 天气模块 —');

  /* 5a 请求成功（阴天） */
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(fakeWeather({ code: 3, pop: 20 })) });
  let w = await Weather.load(true);
  ok('晴/阴天请求成功', w.ok === true, w.note);
  ok('实况温度已归一化', w.current.temp === 29 && w.current.text === '阴', w.current.temp + '/' + w.current.text);
  ok('4 天预报', w.days.length === 4);
  ok('未来 12 小时逐时', w.next12.length === 12, 'len=' + w.next12.length);
  ok('建议 4 条', w.advice.items.length === 4, 'items=' + w.advice.items.length);
  ok('干燥天气不带伞', w.advice.umbrella === false && w.advice.items[0].title === '不用带伞', w.advice.items[0].title);
  ok('温差小且气温适中 → 穿衣省心', w.advice.items[1].title.indexOf('穿衣') >= 0, w.advice.items[1].title);
  ok('今日逐时 24 条', w.hours.length === 24, 'len=' + w.hours.length);
  ok('卡片 HTML 无 undefined', Weather.card(w).indexOf('undefined') < 0 && Weather.card(w).indexOf('NaN') < 0);
  ok('建议 HTML 无 undefined', Weather.tips(w).indexOf('undefined') < 0);
  ok('brief 摘要', /温州/.test(Weather.brief(w)), Weather.brief(w));

  /* 5b 下雨天 */
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(fakeWeather({ code: 61, pop: 85, tmax: 26, tmin: 17 })) });
  w = await Weather.load(true);
  ok('雨天提示带伞', w.advice.umbrella === true && w.advice.items[0].title.indexOf('带伞') >= 0, w.advice.items[0].title);
  ok('雨天通勤改走路/校车', w.advice.outdoor === false, w.advice.commute);
  ok('雨天运动转室内', w.advice.items[3].title.indexOf('室内') >= 0, w.advice.items[3].title);
  ok('温差 ≥9 给外套建议', w.advice.items[1].title.indexOf('温差') >= 0 || w.advice.items[1].title.indexOf('外套') >= 0, w.advice.items[1].title);

  /* 5c2 高温 */
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(fakeWeather({ code: 0, pop: 5, tmax: 36, tmin: 28 })) });
  w = await Weather.load(true);
  ok('高温给防暑提示', w.advice.items[1].title.indexOf('防暑') >= 0, w.advice.items[1].title);
  ok('高温骑行提醒避开正午', w.advice.items[2].title.indexOf('正午') >= 0, w.advice.items[2].title);
  ok('高温运动建议挑时段', w.advice.items[3].title.indexOf('时段') >= 0, w.advice.items[3].title);

  /* 5c 雷暴 + 大风 */
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(fakeWeather({ code: 95, pop: 90 })) });
  w = await Weather.load(true);
  ok('雷暴天不建议骑车', w.advice.outdoor === false && /雷雨|风/.test(w.advice.items[2].title), w.advice.items[2].title);

  /* 5d 请求失败但无缓存 */
  mem['wzu-weather-cache-v1'] = JSON.stringify({ raw: null });   // 清空有效缓存
  delete mem['wzu-weather-cache-v1'];
  ctx.fetch = () => Promise.reject(new Error('模拟断网'));
  w = await Weather.load(true);
  ok('断网且无缓存时优雅降级', w.ok === false && /断网|模拟/.test(w.note), w.note);
  ok('失败卡片仍可渲染', Weather.card(w).indexOf('重新获取') > 0);
  ok('失败时给出 4 条兜底建议占位', w.advice.items.length >= 1);
  ok('失败时 Planner 仍能出结果', Planner.build(w).priority.length > 0);
  ok('失败不影响 summary', Planner.build(w).summary.indexOf('今天') === 0);

  /* 5e 断网但有缓存 */
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(fakeWeather({ code: 3, pop: 20 })) });
  await Weather.load(true);                       // 写入缓存
  ctx.fetch = () => Promise.reject(new Error('模拟断网'));
  w = await Weather.load(true);
  ok('断网时回退上次成功数据', w.ok === true && w.fromCache === true, w.note);
  ok('回退时提示文案', /上次/.test(w.note), w.note);

  /* 5f 三个源里只剩最后一个能通 → 它顶上
     （真实场景：国内源在 file:// 下被 CORS 拦、open-meteo 服务器在境外直连超时） */
  const localHour = pad2(new ClockDate().getHours());
  ctx.fetch = (u) => {
    if (String(u).indexOf('open-meteo') >= 0) return Promise.reject(new Error('国内直连超时'));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(fakeWttr({ code: 176, pop: 70, tmax: 27, tmin: 18 })) });
  };
  w = await Weather.load(true);
  ok('主源失败时自动切到备用源 wttr.in', w.ok === true && w.src === 'wttr', 'src=' + w.src + ' note=' + w.note);
  ok('备用源数据也归一化成同一套结构', w.current.temp === 26 && w.current.text === '阵雨' && w.today.tmax === 27,
    w.current.temp + '/' + w.current.text + '/' + w.today.tmax);
  ok('备用源的观测时间从 UTC 换算到北京时间', w.current.hm.slice(0, 2) === localHour, w.current.hm + ' vs 本地 ' + localHour);
  ok('备用源卡片无 undefined/NaN', /undefined|NaN/.test(Weather.card(w)) === false);
  ok('卡片上标出用的是备用源', /wttr\.in/.test(Weather.card(w)));
  ok('备用源也能给出带伞建议', w.advice.umbrella === true && w.advice.items[0].title.indexOf('带伞') >= 0, w.advice.items[0].title);

  /* 5g WW 码（wttr）→ WMO 码（本项目图标表）的翻译 */
  ok('WW 码翻译：113→0 晴 / 176→80 阵雨 / 389→95 雷阵雨',
    Weather.wwToWmo(113) === 0 && Weather.wwToWmo(176) === 80 && Weather.wwToWmo(389) === 95,
    [Weather.wwToWmo(113), Weather.wwToWmo(176), Weather.wwToWmo(389)].join(','));
  ok('认不出的 WW 码返回 -1（不假装知道）', Weather.wwToWmo(9999) === -1);
  ok('备用源也用同一套 WMO 图标表', Weather.codeInfo(Weather.wwToWmo(176))[1] === '阵雨');

  /* 5g2 国内主源 UAPIS 单独应答 —— 这就是「主页显示没天气」的正解：
     境外源全挂没关系，只要国内源能通，天气就必须出来，
     而且归一化后的结构和别的源完全一致（卡片、建议、规划都不用改）。 */
  delete mem['wzu-weather-cache-v1'];
  ctx.fetch = (u) => String(u).indexOf('uapis.cn') >= 0
    ? Promise.resolve({ ok: true, json: () => Promise.resolve(fakeUapis({ text: '多云', tmax: 31, tmin: 23 })) })
    : Promise.reject(new Error('境外源连不上'));
  w = await Weather.load(true);
  ok('国内源能应答时就用它（不再干等境外源）', w.ok === true && w.src === 'uapis', 'src=' + w.src + ' note=' + w.note);
  ok('中文天气文本翻成 WMO 码（多云→2）', w.current.code === 2, 'code=' + w.current.code);
  ok('国内源归一化成同一套结构', w.current.temp === 30 && w.current.hum === 56 && w.current.wind === 12,
    w.current.temp + '/' + w.current.hum + '/' + w.current.wind);
  ok('国内源同样给 4 天预报 + 12 条逐时', w.days.length === 4 && w.next12.length === 12,
    w.days.length + '/' + w.next12.length);
  ok('国内源卡片无 undefined/NaN', /undefined|NaN/.test(Weather.card(w)) === false);
  ok('首选源不打「备用源」标', /备用源/.test(Weather.card(w)) === false);
  ok('卡片标出真正生效的源', /UAPIS/.test(Weather.card(w)));

  /* 5g3 中文文本 → WMO 码的翻译（UAPIS 给的是中文，不是码表） */
  ok('文本翻译：晴→0 / 多云→2 / 阴→3 / 雷阵雨→95',
    Weather.textToWmo('晴') === 0 && Weather.textToWmo('多云') === 2 &&
    Weather.textToWmo('阴') === 3 && Weather.textToWmo('雷阵雨') === 95,
    ['晴', '多云', '阴', '雷阵雨'].map(Weather.textToWmo).join(','));
  ok('文本翻译：小雨→61 / 中雨→63 / 大雨→65 / 雨夹雪→77（雨夹雪不能被当成雨）',
    Weather.textToWmo('小雨') === 61 && Weather.textToWmo('中雨') === 63 &&
    Weather.textToWmo('大雨') === 65 && Weather.textToWmo('雨夹雪') === 77,
    ['小雨', '中雨', '大雨', '雨夹雪'].map(Weather.textToWmo).join(','));
  ok('文本翻译：认不出的返回 -1（不瞎猜）', Weather.textToWmo('外星天气') === -1);
  ok('风力「3级」/「微风」换算成风速', Weather.windKmph('3级') === 15 && Weather.windKmph('微风') === 8);

  /* 5g4 三个源全挂才失败，而且要写清每个源各自的原因 */
  delete mem['wzu-weather-cache-v1'];
  ctx.fetch = () => Promise.reject(new Error('模拟断网'));
  w = await Weather.load(true);
  ok('三个源全部失败才出失败卡片', w.ok === false, w.note);
  ok('失败原因里三个源各自点名',
    /UAPIS/.test(w.note) && /Open-Meteo/.test(w.note) && /wttr/.test(w.note), w.note);

  /* 5h 缓存坏了不能把 Promise 打挂
     （老版本留下的缓存缺 daily/hourly，解析会抛 —— 一抛就卡在骨架态） */
  ctx.fetch = () => Promise.reject(new Error('模拟断网'));
  mem['wzu-weather-cache-v1'] = JSON.stringify({ raw: { current: { time: 'x', temperature_2m: 30 } }, at: ClockDate.now() });
  w = await Weather.load(false);
  ok('旧格式缓存（缺 daily/hourly）被丢弃，不会卡住', w.ok === false && /open-meteo|Open-Meteo/.test(w.note), w.note);

  mem['wzu-weather-cache-v1'] = '{ 这不是 JSON';
  w = await Weather.load(false);
  ok('非法 JSON 缓存也被丢弃', w.ok === false, w.note);

  /* 5i fetch 直接抛异常（老浏览器 / 环境不支持网络） */
  delete mem['wzu-weather-cache-v1'];
  ctx.fetch = () => { throw new Error('NetworkError'); };
  w = await Weather.load(true);
  ok('fetch 同步抛异常时 load() 仍 resolve 且写清原因', w.ok === false && /NetworkError/.test(w.note), w.note);

  /* 5j 响应体不是 JSON */
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('JSON 解析失败')) });
  w = await Weather.load(true);
  ok('响应体解析失败也能降级成失败卡片', w.ok === false && /JSON 解析失败/.test(w.note), w.note);

  /* 5k load() 对外的承诺：永不 reject（曾经因为没 catch 导致页面卡在「正在获取…」） */
  ctx.fetch = () => Promise.reject(new Error('彻底断网'));
  const rejected = await Weather.load(true).then(() => false, () => true);
  ok('load() 永不 reject', rejected === false);

  console.log('\n— 6. 登录门禁 —');
  ok('requireAuth 未登录返回 false', Store.requireAuth() === false);
  Store.login('20230427', true);
  const p = Store.load();
  ok('登录后 auth.logged = true', p.auth.logged === true && p.auth.sid === '20230427');
  ok('登录后拿到学籍档案（年级从学号推得出，学院留空——不瞎猜）',
    !!p.edu && p.edu.grade === '2023 级' && p.edu.college === '' && p.edu.major === '', JSON.stringify(p.edu));
  ok('演示账号资料里的学院是种子数据（写实的，不该被清理误删）',
    p.user.college === '计算机与人工智能学院', p.user.college);
  ok('登录后 requireAuth 通过', Store.requireAuth() === true);
  ok('syncCourses 可返回课表', Store.syncCourses().courses.length === 12 && Store.syncCourses().sid === '20230427', 'len=' + Store.syncCourses().courses.length);
  Store.logout();
  ok('登出后 requireAuth 拦截', Store.load().auth.logged === false);

  /* ==========================================================
     7. AI 确认后的课程调整：直接作用于生效课表
     ========================================================== */
  console.log('\n— 7. 课程调整（核对后应用）—');
  Store.login('20230427', true);
  Adjust.ensure();
  ok('演示通知已移除', Adjust.list().length === 0 && Store.syncNotices().items.length === 0);
  const answer=ctx.CampusAssistant.execute({tool:'adjust.create',args:{type:'move',course:'数据结构',fromWeek:3,fromDay:2,fromStart:6,fromSpan:2,
    fromRoom:'计算机楼-408',toWeek:3,toDay:4,toStart:3,toSpan:2,toRoom:'计算机楼-402',reason:'学术会议'}});
  const ds=Adjust.list()[0];
  ok('首页 AI 操作完成后再写入', /已应用/.test(answer) && ds.course==='数据结构');
  ok('调课直接应用到课表', ds.applied && ds.origin === 'assistant' && !Store.coursesOn(2,3).some(c=>c.name==='数据结构'));
  const moved = Store.coursesOn(4,3).find(c=>c.name==='数据结构');
  ok('新时间和教室准确', !!moved && moved.start===3 && moved.room==='计算机楼-402' && moved.adjusted);
  ok('其他教学周保留原课', Store.coursesOn(2,4).some(c=>c.name==='数据结构'));
  ok('原节次与真实课表不符时拒绝应用', (function(){try{Adjust.addManual({type:'cancel',course:'数据结构',fromWeek:3,fromDay:2,fromStart:1,fromSpan:2});return false;}catch(e){return /不一致/.test(e.message);}})());
  const make=Adjust.addManual({type:'make',course:'程序设计基础',toWeek:3,toDay:6,toStart:1,toSpan:2,toRoom:'计算机楼-412'});
  ok('补课进入课表', Store.coursesOn(6,3).some(c=>c.name==='程序设计基础'&&c.adjustType==='make'));
  const room=Adjust.addManual({type:'room',course:'大学英语(三)',fromWeek:2,fromDay:1,fromStart:3,fromSpan:2,toRoom:'外语楼-401'});
  ok('换教室只改变房间', Store.coursesOn(1,2).some(c=>c.name==='大学英语(三)'&&c.room==='外语楼-401'&&c.start===3));
  const cancel=Adjust.addManual({type:'cancel',course:'大学物理',fromWeek:3,fromDay:3,fromStart:6,fromSpan:2});
  ok('停课从生效课表移除', !Store.coursesOn(3,3).some(c=>c.name==='大学物理'));
  const todayChange=Adjust.addManual({type:'move',course:'线性代数',fromWeek:3,fromDay:3,fromStart:1,fromSpan:2,toWeek:3,toDay:2,toStart:9,toSpan:2});
  ok('今日时间轴显示调课课程', Planner.build(null).timeline.some(x=>x.kind==='course'&&x.tag==='已调课'));
  [ds,make,room,cancel,todayChange].forEach(x=>Adjust.removeManual(x.no));
  ok('删除调整后课表恢复', Store.coursesOn(2,3).some(c=>c.name==='数据结构') && Adjust.list().length===0);

  console.log('\n— 8. 真实课表导入（同源抓取 → 粘贴 → 入库）—');
  ok('ImportEdu 已加载', typeof ImportEdu === 'object' && typeof ImportEdu.parsePayloadText === 'function');

  /* 8.1 抓取脚本产出的 JSON */
  const grabPayload = {
    kind: 'wzu-campus-hub/edu-import', version: 1,
    grabbedAt: '2026-09-22T02:40:00.000Z',
    source: {
      url: 'https://source-443.webvpn.wzu.edu.cn/jwglxt/kbcx/xskbcx_cxXsgrkb.html',
      title: '我的课表', host: 'source-443.webvpn.wzu.edu.cn', page: '教务系统课表接口（同源直取）'
    },
    courses: [
      { name: '数据结构', teacher: '陈 立', room: '计算机楼-408', day: 2, start: 6, span: 2, from: 1, to: 16 },
      { name: '计算机网络', teacher: '赵 倩', room: '计算机楼-315', day: 4, start: 3, span: 2, from: 1, to: 16 },
      { name: '人工智能导论', teacher: '周子墨', room: '计算机楼-501', day: 5, start: 1, span: 2, from: 1, to: 12 }
    ],
    notices: [{
      no: 'GRAB-1', title: '关于《数据结构》课程调课的通知',
      body: '【调课通知】《数据结构》原定第3周周二第6-7节，教室为计算机楼-408。因任课教师陈立老师赴杭州参加学术会议，调整至第3周周四第3-4节，上课地点改为计算机楼-402，请同学们相互转告。',
      path: '新教务系统 › 教务通知 › 调停课通知'
    }],
    warnings: []
  };
  const p1 = ImportEdu.parsePayloadText(JSON.stringify(grabPayload));
  ok('JSON 导入：解析出 3 条课程', p1.courses.length === 3, 'len=' + p1.courses.length);
  ok('JSON 导入：解析出 1 条调课通知', p1.notices.length === 1);
  ok('JSON 导入：记住了数据来源 host', !!p1.meta && p1.meta.host === 'source-443.webvpn.wzu.edu.cn',
    JSON.stringify(p1.meta));
  ok('JSON 导入：坏数据被跳过并给出提示', (function () {
    const bad = ImportEdu.parsePayloadText(JSON.stringify({
      courses: [
        { name: '', day: 0, start: 0 },
        { name: '线性代数', teacher: '张 敏', room: '教A-105', day: 3, start: 1, span: 2, from: 1, to: 16 }
      ]
    }));
    return bad.courses.length === 1 && bad.rejected === 1 && bad.warnings.length > 0;
  })());
  ok('JSON 导入：数组形式（只有课程）也能吃', (function () {
    const arr = ImportEdu.parsePayloadText(JSON.stringify(grabPayload.courses));
    return arr.courses.length === 3 && arr.notices.length === 0 && arr.kind === 'json-array';
  })());
  /* 导入的晚课保留第 11–13 节；超出第 13 节的连堂才收口。 */
  ok('晚课导入：第 11–13 节保留三节', (function () {
    const x = ImportEdu.parsePayloadText(JSON.stringify({
      courses: [{ name: '健康教育学', day: 3, start: 11, span: 3, from: 3, to: 13 }]
    }));
    const c = x.courses[0] || {};
    return c.start === 11 && c.span === 3;
  })());
  ok('连堂收口：第 13–14 节收口为第 13 节', (function () {
    const x = ImportEdu.parsePayloadText(JSON.stringify({
      courses: [{ name: '晚课', day: 3, start: 13, span: 2, from: 3, to: 13 }]
    }));
    const c = x.courses[0] || {};
    return c.start === 13 && c.span === 1;
  })());
  ok('连堂收口：第2-9节 不被误伤（仍 8 节连堂）', (function () {
    const x = ImportEdu.parsePayloadText(JSON.stringify({
      courses: [{ name: '人工智能与艺术人文', day: 6, start: 2, span: 8, from: 6, to: 9 }]
    }));
    const c = x.courses[0] || {};
    return c.start === 2 && c.span === 8;
  })());

  /* 8.2 纯课表文本（学生直接复制教务页面文字的场景） */
  const courseText = [
    '高等数学 A(一)  王海峰  教A-203  周一第1-2节  1-16周',
    '大学英语(三)  李思颖  外语楼-305  周一第3-4节  1-16周',
    '数据结构  陈 立  计算机楼-408  周二第6-7节  1-16周',
    '体育(篮球)  孙 强  北校区体育馆  周四第7-8节  1-16周'
  ].join('\n');
  const p2 = ImportEdu.parsePayloadText(courseText);
  const ds2 = p2.courses.filter(c => c.name === '数据结构')[0] || {};
  ok('文本导入：4 行 → 4 条课程', p2.courses.length === 4, 'len=' + p2.courses.length);
  ok('文本导入：星期识别正确（数据结构 → 周二）', ds2.day === 2, 'day=' + ds2.day);
  ok('文本导入：节次识别正确（→ 第6-7节）', ds2.start === 6 && ds2.span === 2, ds2.start + '/' + ds2.span);
  ok('文本导入：周次识别正确（→ 1-16周）', ds2.from === 1 && ds2.to === 16, ds2.from + '-' + ds2.to);
  ok('文本导入：教室识别正确', ds2.room === '计算机楼-408', ds2.room);
  ok('文本导入：两字姓名带空格「陈 立」也能认出来（归一化成「陈立」）', ds2.teacher === '陈立', ds2.teacher);
  ok('回归：教室号后面的「周二」不会被误吞（曾把 408 吃成 4）',
    ds2.room === '计算机楼-408' && ds2.day === 2, ds2.room + '/' + ds2.day);
  ok('文本导入：带括号的课名不被拆散', p2.courses.some(c => c.name === '体育(篮球)'),
    JSON.stringify(p2.courses.map(c => c.name)));
  ok('文本导入：纯运动场馆（没有门牌号）也能认', (p2.courses.filter(c => c.name === '体育(篮球)')[0] || {}).room === '北校区体育馆');
  ok('空内容给出可读错误', (function () {
    try { ImportEdu.parsePayloadText('   '); return false; } catch (e) { return /空/.test(e.message); }
  })());
  ok('坏 JSON 会抛错（交给界面提示）', (function () {
    try { ImportEdu.parsePayloadText('{ 这不是 json }'); return false; } catch (e) { return true; }
  })());

  /* 8.3 入库：课表整体替换 */
  const beforeCount = Store.load().courses.length;
  const n1 = Store.importCourses(p1.courses, p1.meta);
  const d1 = Store.load();
  ok('导入课表：写入 3 条', n1 === 3 && d1.courses.length === 3, 'n=' + n1);
  ok('导入课表：自动生成 id 与颜色', d1.courses.every(c => /^i\d+$/.test(c.id) && /^#/.test(c.color)));
  ok('导入课表：缺老师缺教室时有兜底文案',
    d1.courses.every(c => c.teacher && c.room), JSON.stringify(d1.courses.map(c => c.teacher + '/' + c.room)));
  ok('导入课表：旧课表被整体替换', d1.courses.length !== beforeCount, beforeCount + ' → ' + d1.courses.length);
  ok('导入课表：sync.source 标记为 wzu-import', d1.sync.source === 'wzu-import', d1.sync.source);
  ok('导入课表：imported 摘要写入', !!d1.imported && d1.imported.courses === 3);
  ok('导入课表：清空旧的调课调整、允许重新同步', d1.courseNotices.length === 0 && d1.sync.noticesAt === 0);
  ok('导入课表：全部非法数据时拒绝写入（返回 0）', Store.importCourses([{ name: '', day: 9, start: 0 }]) === 0);
  ok('同一门课（不同时段）共用一个颜色', (function () {
    const s = ImportEdu.parsePayloadText(JSON.stringify({
      courses: [
        { name: '高等数学', teacher: '王海峰', room: '教A-203', day: 1, start: 1, span: 2, from: 1, to: 16 },
        { name: '高等数学', teacher: '王海峰', room: '教A-203', day: 5, start: 3, span: 2, from: 1, to: 16 }
      ]
    }));
    Store.importCourses(s.courses);
    const cs = Store.load().courses;
    return cs.length === 2 && cs[0].color === cs[1].color;
  })());
  Store.importCourses(p1.courses, p1.meta);   /* 复原成 3 条，供下面联动测试用 */

  /* 8.4 PDF 课表导入后，旧通知原文不再进入课程调整。 */
  ok('旧通知原文导入已停用', Store.importNoticeRaw(p1.notices) === 0);
  ok('同步不会恢复旧演示通知', Store.syncNotices().items.length === 0 && Adjust.sync().total === 0);

  /* 8.5 恢复示例数据 */
  Store.clearImported();
  const d2 = Store.load();
  ok('恢复示例数据：课表回到 12 条', d2.courses.length === 12, 'len=' + d2.courses.length);
  ok('恢复示例数据：通知原文清空', d2.eduRawImported.length === 0);
  ok('恢复示例数据：imported 摘要归零', d2.imported === null);
  ok('恢复示例数据：调课通知与来源都回到 demo', d2.courseNotices.length === 0 && d2.sync.source === 'demo');
  ok('恢复后 syncNotices 回到离线样本（live=false）', Store.syncNotices().session.live === false);

  /* ==========================================================
     9. 旧数据清理：把「别人的示例课表」从真实学号里摘掉
     —— 早期版本里，用任何学号登录看到的都是同一套示例课表。
     ========================================================== */
  console.log('\n— 9. 旧数据清理（示例课表不再糊到真实学号上） —');
  /* 这一节用一套独立的存储，别把名册 / 账号槽污染到后面的用例 */
  const mem9 = {};
  const storage9 = {
    getItem: k => (Object.prototype.hasOwnProperty.call(mem9, k) ? mem9[k] : null),
    setItem: (k, v) => { mem9[k] = String(v); },
    removeItem: k => { delete mem9[k]; }
  };
  const newCtx = () => vm.createContext({
    console, Date, Math, JSON, Promise, setTimeout, clearTimeout, parseInt, parseFloat, isNaN, Infinity,
    Object, Array, String, Number, Boolean, Error, localStorage: storage9, sessionStorage: storage9
  });
  function loadStoreIn(c) { vm.runInContext(fs.readFileSync(DIR + '/store.js', 'utf8'), c); return c.Store; }
  function boot9(data) {
    mem9['wzu-campus-hub'] = JSON.stringify(data);
    return loadStoreIn(newCtx()).load();
  }

  /* 9.1 残留的示例课表要被清掉
     （旧版本写出来的数据里没有 seedCleared 这个字段，这里照样去掉，模拟真实的老数据） */
  const stale = JSON.parse(Store.exportJSON());
  delete stale.seedCleared;
  stale.auth = { logged: true, sid: '20212345', method: 'wzu-cas', loginAt: ClockDate.now(), remember: true };
  const d5 = boot9(stale);
  ok('旧数据清理：真实学号里残留的示例课表被清空', d5.courses.length === 0,
    'len=' + d5.courses.length + ' | imported=' + JSON.stringify(stale.imported) + ' | sid=' + stale.auth.sid);
  ok('旧数据清理：残留的示例作业 / 计划也被清空', d5.homeworks.length === 0 && d5.plans.length === 0,
    d5.homeworks.length + '/' + d5.plans.length);
  ok('旧数据清理：失物 / 问答等公共内容保留', d5.lost.length > 0 && d5.qa.length > 0);
  ok('旧数据清理：登录态与学籍档案不动', d5.auth.logged === true && d5.auth.sid === '20212345' && !!d5.edu);

  /* 9.2 学生自己手动加的课不能被误删 */
  const stale2 = JSON.parse(Store.exportJSON());
  delete stale2.seedCleared;
  stale2.auth = { logged: true, sid: '20212345', method: 'wzu-cas', loginAt: ClockDate.now(), remember: true };
  stale2.courses = [{ id: 'x1', name: '我手动加的课', teacher: '某老师', room: '某楼-101', day: 1, start: 1, span: 2, from: 1, to: 16, color: '#3A5BFF' }];
  const d6 = boot9(stale2);
  ok('旧数据清理：手动添加的课程不会被误删', d6.courses.length === 1 && d6.courses[0].name === '我手动加的课',
    JSON.stringify(d6.courses.map(c => c.name)));

  /* 9.3 演示账号永远保留完整示例数据 */
  const stale3 = JSON.parse(Store.exportJSON());
  delete stale3.seedCleared;
  stale3.auth = { logged: true, sid: Store.DEMO.sid, method: 'wzu-cas', loginAt: ClockDate.now(), remember: true };
  const d7 = boot9(stale3);
  ok('旧数据清理：演示账号的示例课表保留', d7.courses.length === 12, 'len=' + d7.courses.length);

  /* 9.4 老版本按学号「猜」出来的学院要被摘掉
     （当年登录时会把同一个假学院同时写进 edu.college 和 user.college） */
  const stale4 = JSON.parse(Store.exportJSON());
  delete stale4.seedCleared;
  delete stale4.autoCollegeCleared;
  stale4.auth = { logged: true, sid: '20212345', method: 'wzu-cas', loginAt: ClockDate.now(), remember: true };
  stale4.edu = { sid: '20212345', name: '', college: '建筑工程学院', grade: '2021 级', major: '' };
  stale4.user.college = '建筑工程学院';
  const d8 = boot9(stale4);
  ok('假学院清理：学籍档案里的猜测学院被清空', d8.edu.college === '' && d8.edu.major === '', JSON.stringify(d8.edu));
  ok('假学院清理：被系统污染的「我的」资料也一起清空', d8.user.college === '', d8.user.college);
  ok('假学院清理：年级这种真信息不动', d8.edu.grade === '2021 级', d8.edu.grade);

  /* 9.5 但学生自己填过的学院要保留（判据：和 edu 里的不一致 → 那是他自己改的） */
  const stale5 = JSON.parse(Store.exportJSON());
  delete stale5.seedCleared;
  delete stale5.autoCollegeCleared;
  stale5.auth = { logged: true, sid: '20212345', method: 'wzu-cas', loginAt: ClockDate.now(), remember: true };
  stale5.edu = { sid: '20212345', name: '', college: '数理学院', grade: '2021 级', major: '' };
  stale5.user.college = '我自己填的学院';
  const d9 = boot9(stale5);
  ok('假学院清理：学生自己填的学院不能被误删', d9.user.college === '我自己填的学院', d9.user.college);
  ok('假学院清理：学籍档案里的猜测值仍然清掉', d9.edu.college === '', d9.edu.college);

  /* 9.6 旧通知一次性清理，之后 AI 添加的调整不会再被迁移删除。 */
  const sn1 = JSON.parse(Store.exportJSON());
  delete sn1.manualAdjustmentsMigrated;
  sn1.courseNotices = [{no:'OLD-1',course:'数据结构',type:'move',applied:true}];
  sn1.eduRawImported = [{no:'OLD-1',body:'旧通知'}];
  const dn1 = boot9(sn1);
  ok('旧调课通知和原文均清除', dn1.courseNotices.length===0 && dn1.eduRawImported.length===0);
  dn1.courseNotices.push({no:'adj-new',origin:'assistant',course:'测试',applied:true});
  ok('后续登录保留 AI 调整', boot9(dn1).courseNotices.length===1);

  /* ==========================================================
     10. 多账号隔离：换学号登录不再共用同一份课表
     ========================================================== */
  console.log('\n— 10. 多账号隔离（每个学号各存一份） —');
  const demoCourses = Store.load().courses.length;
  const demoHw = Store.load().homeworks.length;
  const demoPlans = Store.load().plans.length;

  const NEW_SID = '20250999';
  const np = Store.login(NEW_SID, true);
  const nd = Store.load();
  ok('新学号首次登录：课表为空（不再塞别人的示例课表）', nd.courses.length === 0, 'len=' + nd.courses.length);
  ok('新学号首次登录：作业 / 计划同样为空', nd.homeworks.length === 0 && nd.plans.length === 0,
    nd.homeworks.length + '/' + nd.plans.length);
  ok('新学号首次登录：公共内容（失物 / 问答）保留',
    nd.lost.length > 0 && nd.qa.length > 0);
  ok('新学号首次登录：给的是他自己的档案（年级按学号推得出，学院留空不猜）',
    np.sid === NEW_SID && !!nd.edu && nd.edu.college === '' && nd.edu.major === '' &&
      nd.edu.grade === NEW_SID.slice(0, 4) + ' 级', JSON.stringify(nd.edu));
  ok('新学号首次登录：资料里的学院不会被自动安上任何值',
    !nd.user.college, nd.user.college);

  /* 新账号自己导入课表 → 只影响他自己 */
  const n2 = Store.importCourses([{ name: '建筑工程制图', teacher: '钱 勇', room: '建工楼-101', day: 1, start: 1, span: 2, from: 1, to: 16 }]);
  ok('新学号导入自己的课表', n2 === 1 && Store.load().courses.length === 1, 'n=' + n2);

  ok('名册里记下了两个学号', Store.accounts().length === 2 &&
    Store.accounts().some(a => a.sid === Store.DEMO.sid) && Store.accounts().some(a => a.sid === NEW_SID),
    JSON.stringify(Store.accounts().map(a => a.sid)));
  ok('当前账号指向新学号', Store.currentSid() === NEW_SID, Store.currentSid());
  ok('名册里带上了「课表几门」用于切换时预览',
    (Store.accounts().filter(a => a.sid === NEW_SID)[0] || {}).courses === 1);

  /* 一键切回演示账号：演示账号的数据没被污染 */
  const back = Store.switchTo(Store.DEMO.sid);
  const bd = Store.load();
  ok('一键切回演示账号（不用重输密码）', !!back && bd.auth.sid === Store.DEMO.sid && bd.auth.logged === true);
  ok('演示账号课表没被新账号覆盖', bd.courses.length === demoCourses, bd.courses.length + ' vs ' + demoCourses);
  ok('演示账号作业 / 计划也还在', bd.homeworks.length === demoHw && bd.plans.length === demoPlans,
    bd.homeworks.length + '/' + bd.plans.length);

  /* 再切回新账号：他自己的课表也还在 */
  Store.switchTo(NEW_SID);
  const ad = Store.load();
  ok('切回新账号：他自己导入的课表还在', ad.courses.length === 1 && ad.courses[0].name === '建筑工程制图',
    JSON.stringify(ad.courses.map(c => c.name)));
  ok('两个账号的课表互不影响', ad.courses.length !== demoCourses);

  /* 登出后再登录同一学号，数据仍在 */
  Store.logout();
  ok('登出后 auth.logged = false，但学号与名册保留', Store.load().auth.logged === false && Store.accounts().length === 2);
  Store.login(NEW_SID, true);
  ok('重新登录同一学号：数据原样回来', Store.load().courses.length === 1 && Store.load().courses[0].name === '建筑工程制图');

  /* 从本机移除某个账号 */
  Store.forgetAccount(NEW_SID);
  ok('移除账号后名册只剩一个', Store.accounts().length === 1 && Store.accounts()[0].sid === Store.DEMO.sid);
  ok('移除账号后，再用该学号登录就是全新的空课表', (function () {
    Store.login(NEW_SID, true);
    return Store.load().courses.length === 0;
  })());
  Store.login(Store.DEMO.sid, true);   /* 收尾：回到演示账号 */

  /* ==========================================================
     11. 自然语言快捷记录（首页那个对话框）
     ----------------------------------------------------------
     只测「理解得对不对」——写库与画界面在 ui.test.js 里点着测。
     ========================================================== */
  console.log('\n— 11. 自然语言快捷记录 —');
  const NL_COURSES = Store.load().courses.map(c => c.name);
  const nl = t => NL.parse(t, { courses: NL_COURSES });
  const D = n => { const d = new ClockDate(); d.setDate(d.getDate() + n); return UI.dayKey(d); };

  const w1 = nl('明晚 7 点 图书馆自习 2 小时');
  ok('NL：认得出是「课外计划」', w1.ok && w1.kind === 'plan', w1.kind);
  ok('NL：「明晚」= 明天，且按晚上读成 19 点',
    w1.date === D(1) && w1.start === '19:00', w1.date + ' ' + w1.start);
  ok('NL：「2 小时」当时长，算出 21:00 结束（不会被当成 2 点）',
    w1.end === '21:00', w1.end);
  ok('NL：地点、类型都抽出来了', w1.place === '图书馆' && w1.type === '学习',
    w1.place + '/' + w1.type);
  ok('NL：标题里不再残留时间和地点', w1.title === '自习', w1.title);

  const w2 = nl('高数作业 周五 23:59 交');
  ok('NL：有「作业」两个字就归到作业 DDL', w2.kind === 'homework', w2.kind);
  ok('NL：作业名去掉了「交」这类动词', w2.title === '高数作业', w2.title);
  ok('NL：「高数」这种简称能对上真实课表里的「高等数学 A(一)」',
    w2.course === '高等数学 A(一)', w2.course);
  ok('NL：截止时间 = 下个周五 23:59', w2.due === D((5 - (new ClockDate().getDay() === 0 ? 7 : new ClockDate().getDay()) + 7) % 7) + 'T23:59', w2.due);

  const w3 = nl('周六 第 3-4 节 加课 体育 体育馆');
  ok('NL：有「周X + 第Y-Z节」就归到课表补充', w3.kind === 'course', w3.kind);
  ok('NL：课表补充给出星期 / 起始节 / 连堂', w3.day === 6 && w3.period === 3 && w3.span === 2,
    w3.day + '/' + w3.period + '/' + w3.span);
  ok('NL：教室抽出来了，课程名里不带「加课」', w3.room === '体育馆' && w3.title === '体育',
    w3.room + '/' + w3.title);

  const w4 = nl('明天上午 8 点到 10 点 体育馆体测');
  ok('NL：「上午 8 点」不会被读成晚上 8 点（上午也以「午」结尾，不能靠猜）',
    w4.start === '08:00' && w4.end === '10:00', w4.start + '–' + w4.end);

  const w5 = nl('今天 22 点 背 30 个单词 半小时');
  ok('NL：「半小时」= 30 分钟', w5.start === '22:00' && w5.end === '22:30', w5.start + '–' + w5.end);
  ok('NL：标题里的数字（30 个单词）不会被当成时间', w5.title === '背 30 个单词', w5.title);

  const w6 = nl('重要！！明天下午 2 点 打印实验报告 在计算机楼-402');
  ok('NL：「重要」提到高优先级', w6.level === 3, String(w6.level));
  ok('NL：「在计算机楼-402」里的「在」不算教室名的一部分', w6.place === '计算机楼-402', w6.place);
  ok('NL：「重要！！」不会跑进标题', w6.title.indexOf('重要') < 0, w6.title);

  const many = NL.parseAll('每周三 19:00 复习线性代数 1 小时；周日 10 点 羽毛球', { courses: NL_COURSES });
  ok('NL：分号能拆成多件事', many.length === 2, 'len=' + many.length);
  ok('NL：「每周三」标成每周重复', many[0].repeat === 'weekly', many[0].repeat);

  ok('NL：认不出来的句子会留空字段并列出缺什么，而不是编一个',
    (function () { const r = nl('买牙膏'); return r.ok && r.missing.indexOf('几点开始') >= 0; })());
  ok('NL：纯符号不硬猜', NL.parse('？？？', { courses: NL_COURSES }).ok === false);
  ok('NL：空输入返回空数组', NL.parseAll('   ', { courses: NL_COURSES }).length === 0);
  ok('NL：连堂不会越过一天最后一节', (function () {
    const r = nl('周一 第 1-99 节 加课 高数');
    return r.period === 1 && r.span === UI.BELLS.length;
  })());

  /* ---- 请假条：说「请病假 / 请事假」就走生成请假条流程 ---- */
  const l1 = nl('明天上午请病假，因为发烧要去校医院');
  ok('NL：「请病假」单独成类，不是课外计划', l1.kind === 'leave', l1.kind);
  ok('NL：病假 / 明天 / 上午 / 半天 都抽出来了',
    l1.leave.type === '病假' && l1.leave.start === D(1) && l1.leave.slot === '上午' && l1.leave.days === 0.5,
    JSON.stringify(l1.leave));
  ok('NL：理由是「因为」后面的内容，掐掉了句尾冗余',
    l1.leave.reason.indexOf('发烧') === 0 && l1.leave.reason.indexOf('请病假') < 0, l1.leave.reason);

  const l2 = nl('请事假两天，因为家里有急事');
  ok('NL：「两天」= 请 2 天，没写日期就按今天起算并给出提示',
    l2.leave.days === 2 && l2.leave.start === D(0) && l2.notes.join('').indexOf('今天') >= 0,
    l2.leave.days + '/' + l2.leave.start);

  const l3 = nl('周五 第 3-4 节 请公假，因为参加志愿服务');
  ok('NL：「第 3-4 节」能作为请假时段', l3.leave.slot === '第 3–4 节' && l3.leave.type === '公假',
    l3.leave.slot + '/' + l3.leave.type);
  ok('NL：「周六请病假」不会被误读成晚上（纯日期≠时段）',
    nl('周六请病假因为感冒了').leave.slot === '全天');
  ok('NL：「下周三…请一天」天数与理由都干净',
    (function () {
      const r = nl('下周三请事假，因为要回老家一趟，请一天');
      return r.leave.days === 1 && r.leave.reason === '回老家一趟';
    })());

  const lb = NL.buildLeave(
    { type: '病假', teacher: '王老师', start: D(1), slot: '上午', days: 0.5, course: NL_COURSES[0], reason: '发烧要去校医院' },
    { name: '张三', sid: '20230427', college: '计算机与人工智能学院', major: '计算机科学与技术' },
    new ClockDate());
  ok('NL：请假条正文有抬头 / 理由 / 时间 / 学号 / 落款',
    /请假条/.test(lb) && /尊敬的 王 老师/.test(lb) && /发烧要去校医院/.test(lb) &&
    /需请病假/.test(lb) && /学号 20230427/.test(lb) && /请假人：张三/.test(lb), lb.split('\n')[0]);
  ok('NL：选了课程会把「补课承诺」写进正文', lb.indexOf(NL_COURSES[0]) >= 0);
  ok('NL：请 2 天会写出「自 X 至 X，共 2 天」',
    /共 2 天/.test(NL.buildLeave({ type: '事假', start: D(2), slot: '全天', days: 2, reason: '家中有急事' }, { name: '李四' }, new ClockDate())));
  ok('NL：信息缺了留占位，不编（没有姓名就写（签名））',
    /（签名）/.test(NL.buildLeave({ type: '事假', start: D(1), reason: '事' }, {}, new ClockDate())));

  /* ==========================================================
     12. 教务通知抓取入口关闭，不再产生演示样本
     ========================================================== */
  console.log('\n— 12. 调课通知不再自动生成 —');
  const sd = Store.syncNotices(Store.DEMO.sid);
  ok('演示账号也没有内置调课通知', sd.items.length===0 && sd.session.sample===false);
  ok('演示账号：Store.isDemo() 为真', Store.isDemo()===true);
  const realSid='20248888';
  const sr=Store.syncNotices(realSid);
  ok('真实学号同样没有通知样本', sr.items.length===0 && sr.session.sample===false);
  Store.login(realSid,true);
  ok('真实学号：Store.isDemo() 为假', Store.isDemo()===false);
  ok('旧通知原文不能通过同步进入课表', Store.importNoticeRaw([{body:'旧通知'}])===0 && Store.syncNotices().items.length===0);
  Store.login(Store.DEMO.sid,true);

  /* Verify mixed homework/plan ordering even when deadlines favor a lower level. */
  const orderingDb = Store.load();
  const savedHomework = orderingDb.homeworks, savedPlans = orderingDb.plans;
  orderingDb.homeworks = [
    {id:'sort-overdue', title:'逾期低重要作业', course:'测试', due:'2026-09-21T23:59', level:1, status:'todo'},
    {id:'sort-high', title:'高重要未来作业', course:'测试', due:'2026-09-27T23:59', level:3, status:'todo'},
    {id:'sort-medium', title:'中重要今日作业', course:'测试', due:'2026-09-22T12:00', level:2, status:'todo'},
    {id:'sort-low', title:'低重要今日作业', course:'测试', due:'2026-09-22T13:00', level:1, status:'todo'}
  ];
  orderingDb.plans = [{id:'sort-plan', title:'高重要计划', date:'2026-09-22', start:'19:00', end:'20:00', level:3, status:'todo', type:'学习'}];
  const orderedIds = Planner.build(null).priority.map(x => x.id);
  ok('逾期低重要作业仍排最前', orderedIds[0] === 'sort-overdue');
  ok('高重要计划排在中重要作业前', orderedIds.indexOf('sort-plan') < orderedIds.indexOf('sort-medium'));
  ok('高重要未来作业排在中重要今日作业前', orderedIds.indexOf('sort-high') < orderedIds.indexOf('sort-medium'));
  ok('同重要度按时间排序', orderedIds.indexOf('sort-plan') < orderedIds.indexOf('sort-high'));
  ok('低重要非逾期作业排最后', orderedIds[orderedIds.length - 1] === 'sort-low');
  orderingDb.homeworks = savedHomework; orderingDb.plans = savedPlans;
  /* Reminders must use pending homework and leave the real schedule untouched. */
  const enriched = Planner.build(null);
  const pendingHomework = Store.load().homeworks.filter(h => h.status !== 'done');
  const reminders = enriched.timeline.filter(x => x.kind === 'reminder');
  ok('时间轴包含作业提醒', reminders.length > 0);
  ok('每条作业提醒来自当前未完成作业', reminders.every(x => pendingHomework.some(h => x.title.endsWith(h.title))));
  ok('作业提醒不占用学习时段', reminders.every(x => x.from === x.to));
  ok('今日截止提醒保留真实截止时刻', reminders.filter(x => x.tag === '截止').every(x => pendingHomework.some(h => {
    const due = new ClockDate(h.due);
    return x.title.endsWith(h.title) && x.from === due.getHours() * 60 + due.getMinutes();
  })));
  ok('新增课前课后建议不与课程或计划重叠', enriched.timeline.filter(x => x.kind === 'review').every(x =>
    enriched.timeline.filter(y => y !== x && y.kind !== 'reminder').every(y => x.to <= y.from || x.from >= y.to)));
  /* 学业任务归入待办，非学业计划独立展示；旧记录保留全部调度字段。 */
  ok('背单词归入学业',Store.classifyTask({title:'背30个四级单词',type:'学习'})==='academic');
  ok('ACM专业训练归入学业，即使类型是社团',Store.classifyTask({title:'计算机协会例会 + ACM训练赛',type:'社团'})==='academic');
  ok('夜跑和羽毛球归入课外',Store.classifyTask({title:'北校区夜跑',type:'运动'})==='personal'&&Store.classifyTask({title:'打羽毛球',type:'运动'})==='personal');
  const groupedDb=Store.load(), oldPlans=groupedDb.plans;
  groupedDb.plans=[
    {id:'study-future',title:'整理高数错题',type:'学习',date:'2026-09-24',start:'14:00',end:'15:00',status:'todo',level:2},
    {id:'personal-today',title:'夜跑',type:'运动',date:'2026-09-22',start:'21:00',end:'22:00',status:'todo',level:3},
    {id:'study-repeat',title:'背30个单词',type:'学习',date:'2026-09-22',start:'22:00',end:'22:30',repeat:'weekly',doneOn:{},status:'todo',level:2}
  ];Store.save();
  const grouped=Planner.build(null);
  ok('未来学业任务进入待办，不局限今天',grouped.priority.some(x=>x.id==='study-future'));
  ok('非学业任务不再混入待办',!grouped.priority.some(x=>x.id==='personal-today'));
  ok('今天的学业与非学业任务都进入自动时间轴',grouped.timeline.some(x=>x.title==='背30个单词')&&grouped.timeline.some(x=>x.title==='夜跑'));
  ok('旧计划自动归类且时间和重复规则保留',groupedDb.plans[2].taskGroup==='academic'&&groupedDb.plans[2].start==='22:00'&&groupedDb.plans[2].repeat==='weekly');
  groupedDb.plans=oldPlans;Store.save();
  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
