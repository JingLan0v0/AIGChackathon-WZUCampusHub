/* ==========================================================
   校园百事通 · 本地数据层
   数据全部保存在浏览器 localStorage，刷新/关页不丢；
   首次打开自动注入一套温州大学示例数据，方便直接演示。
   ========================================================== */
var Store = (function () {
  var KEY = 'wzu-campus-hub';                   // 当前生效账号的数据（页面脚本统一读它）
  var ROSTER_KEY = 'wzu-campus-hub-accounts';   // 本机登录过的账号名册（多账号切换用）
  var VERSION = 1;
  var CALENDAR_VERSION = 1;
  var cache = null;

  /* 温州大学统一身份认证入口（WebVPN）—— 学生自己登录、自己抓课表，
     程序不接触账号密码。所有「去查课表」的跳转都用这一个地址。 */
  var EDU_LOGIN_URL = 'https://source-443.webvpn.wzu.edu.cn/login';
  var EDU_NEW_SYS = '新教务系统';

  /* 导入真实课表时给课程分配的颜色（同一门课共用一个颜色） */
  var COURSE_COLORS = ['#3A5BFF', '#7A5CFF', '#00A6B8', '#F79009', '#12B76A', '#E5484D', '#0E9F6E', '#8E4EC6', '#DC6803', '#2563EB'];

  /* 作息表一共多少节 —— 必须和 UI.BELLS 的长度一致。 */
  var TOTAL_PERIODS = 13;
  var BELL_SCHEDULE_VERSION = 2;

  /* 依据温州大学 2026—2027 学年校历第一学期（用户提供的校历图）。
     只给出月份或“中旬／下旬”而没有准确日期的考试不做精确倒计时。 */
  function firstTermCalendar() {
    return [
      { name: '开学与老生报到', date: '2026-09-06', emoji: '🏫' },
      { name: '老生上课', date: '2026-09-07', emoji: '📚' },
      { name: '新生报到', date: '2026-09-10', emoji: '🎒' },
      { name: '新生始业教育', date: '2026-09-11', endDate: '2026-09-13', emoji: '🎓' },
      { name: '中小学教师资格考试笔试', date: '2026-09-12', emoji: '📝' },
      { name: '新生正式上课', date: '2026-09-14', emoji: '📚' },
      { name: '国庆补课（补10月5日课程）', date: '2026-09-20', emoji: '📖' },
      { name: '中秋节假期', date: '2026-09-25', endDate: '2026-09-27', emoji: '🥮' },
      { name: '国庆节假期', date: '2026-10-01', endDate: '2026-10-07', emoji: '🎉' },
      { name: '新生军训（暂定）', date: '2026-10-08', endDate: '2026-10-21', emoji: '🎖️' },
      { name: '国庆补课（补10月6日课程）', date: '2026-10-10', emoji: '📖' },
      { name: '浙江省高校计算机等级考试', date: '2026-11-14', endDate: '2026-11-15', emoji: '💻' },
      { name: '校运动会', date: '2026-11-19', endDate: '2026-11-20', emoji: '🏅' },
      { name: '大学英语四六级口语考试', date: '2026-11-21', endDate: '2026-11-22', emoji: '🗣️' },
      { name: '教师资格证校考笔试', date: '2026-11-28', emoji: '📝' },
      { name: '全国大学外语四六级考试', date: '2026-12-12', emoji: '📝' },
      { name: '浙江省大学英语三级考试', date: '2026-12-13', emoji: '📝' },
      { name: '元旦', date: '2027-01-01', emoji: '🎉' },
      { name: '期末考试', date: '2027-01-11', endDate: '2027-01-18', emoji: '📝' },
      { name: '寒假', date: '2027-01-19', endDate: '2027-02-21', emoji: '❄️' }
    ];
  }

  function todayPlus(dayOffset, hour, min) {
    var d = new Date();
    d.setDate(d.getDate() - (dayOffset || 0));
    d.setHours(hour === undefined ? 10 : hour, min || 0, 0, 0);
    return d.getTime();
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /* 相对今天的日期字符串：dstr(0) = 今天 */
  function dstr(offset) {
    var d = new Date();
    d.setDate(d.getDate() + (offset || 0));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  /* 相对今天的 datetime-local 字符串：dt(1,'20:00') = 明天 20:00 */
  function dt(offsetDays, hm) {
    return dstr(offsetDays) + 'T' + (hm || '23:59');
  }

  /* 学业任务和个人计划共用原记录，保留日期、重复和完成情况。 */
  function classifyTask(task) {
    var title=String(task.title||'');
    if(/作业|课后题|实验|报告|论文|考试|备考|复习|预习|自习|背.*单词|四级|六级|错题|高数|数学|英语|语文|课程|上课|听课|学习|刷题|ACM|训练赛|专业竞赛|毕业设计/i.test(title))return 'academic';
    if(/跑步|夜跑|羽毛球|篮球|健身|聚餐|吃饭|买菜|购物|超市|电影|游戏|小说|散步|聚会|旅游|生日/.test(title))return 'personal';
    return task.type==='学习'?'academic':'personal';
  }
  function isAcademicTask(task) {
    return (task.taskGroup==='academic'||task.taskGroup==='personal'?task.taskGroup:classifyTask(task))==='academic';
  }
  function normalizeTasks(data) {
    (data.plans||[]).forEach(function(task){if(task.taskGroup!=='academic'&&task.taskGroup!=='personal')task.taskGroup=classifyTask(task);});
  }

  function seedData() {
    var colors = ['#3A5BFF', '#7A5CFF', '#00A6B8', '#F79009', '#12B76A', '#E5484D', '#0E9F6E', '#8E4EC6', '#DC6803', '#2563EB'];
    var raw = [
      // 课程：名称, 教师, 教室, 星期, 起始节, 节数, 起始周, 结束周, 色
      // 节次按截图：上午 1~5 · 下午 6~10 · 晚上 11~13
      ['高等数学 A(一)', '王海峰', '教A-203', 1, 1, 2, 1, 16, 0],
      ['大学英语(三)', '李思颖', '外语楼-305', 1, 3, 2, 1, 16, 1],
      ['程序设计基础', '陈 立', '计算机楼-412', 2, 3, 2, 1, 16, 2],
      ['数据结构', '陈 立', '计算机楼-408', 2, 6, 2, 1, 16, 3],
      ['线性代数', '张 敏', '教A-105', 3, 1, 2, 1, 16, 4],
      ['大学物理', '刘 伟', '物理楼-201', 3, 6, 2, 1, 16, 5],
      ['大学英语口语', '李思颖', '外语楼-212', 3, 9, 2, 2, 16, 6],
      ['计算机网络', '赵 倩', '计算机楼-315', 4, 3, 2, 1, 16, 7],
      ['体育(篮球)', '孙 强', '北校区体育馆', 4, 7, 2, 1, 16, 8],
      ['人工智能导论', '周子墨', '计算机楼-501', 5, 1, 2, 1, 12, 9],
      ['高等数学 A(一)', '王海峰', '教A-203', 5, 3, 2, 1, 16, 0],
      ['思想道德与法治', '吴 敏', '教B-101', 5, 6, 2, 1, 16, 5]
    ];
    var courses = raw.map(function (r, i) {
      return {
        id: 'c' + (i + 1), name: r[0], teacher: r[1], room: r[2], day: r[3],
        start: r[4], span: r[5], from: r[6], to: r[7], color: colors[r[8]]
      };
    });

    var lostRaw = [
      ['found', '校园卡一张（学号尾号 0427）', '生活区三食堂二楼', '🍚', '在餐盘回收处捡到的，已交到食堂阿姨那里，也可以联系我直接取。', 0.2],
      ['lost', '黑色折叠伞（伞柄有小熊挂件）', '图书馆三楼自习区', '☂️', '下午三点左右离开时忘记拿了，伞柄有小熊挂件，找到请告诉我，谢谢！', 0.6],
      ['found', 'AirPods 耳机盒（刻了字母 Z）', '教A-203', '🎧', '上完高数课在桌肚里发现的，盒子上刻了字母 Z，已放教室讲台。', 1.2],
      ['lost', '蓝色保温杯（杯身有贴纸）', '北校区体育馆', '🥤', '打完球落在场边了，杯身贴着两张动漫贴纸。', 1.8],
      ['found', '身份证 + 学生证套件', '校医院门口', '🪪', '捡到一个小证件套，里面是本地同学的身份证和学生证，已交到保卫处。', 2.4]
    ];
    var lost = lostRaw.map(function (r, i) {
      return {
        id: 'l' + (i + 1), type: r[0], title: r[1], place: r[2], emoji: r[3], desc: r[4],
        contact: i % 2 ? '微信 wzu_help' + i : 'QQ 88' + (123456 + i),
        author: '温大同学', mine: i === 1, resolved: false, createdAt: todayPlus(r[5], 12, 30)
      };
    });

    var qaRaw = [
      ['大一新生体育课怎么选？篮球和羽毛球哪个给分高？', '下学期要选体育了，想问问学长学姐，篮球和羽毛球哪个老师要求松一点、平时分好拿？', ['选课', '体育'], 24],
      ['计算机学院的宿舍有空调和独卫吗？', '刚被计算机与人工智能学院录取，想提前知道宿舍条件，好准备东西。', ['宿舍', '新生'], 41],
      ['大一什么时候可以申请转专业？需要准备什么？', '目前对自己的专业不太满意，想了解一下温大转专业的流程和时间节点。', ['学习', '转专业'], 33],
      ['学校附近有哪些好吃的夜宵摊？', '晚上自习完经常饿，求推荐生活区/南门附近性价比高的夜宵。', ['生活', '美食'], 18],
      ['大一加入社团会影响学习吗？哪些社团比较值得加？', '想加社团又怕耽误学习，想听听大家的经验。', ['社团', '经验'], 12]
    ];
    var ansRaw = [
      ['选课时段一开放就抢，篮球班的孙老师人很好，只要按时到、认真跑完体能，平时分基本满分。羽毛球场地少但老师也松，看你喜欢哪个。', '阿澈', 15],
      ['空调有的，四人间，独卫看楼栋，育英园都是独卫，其他楼栋部分公共卫浴。建议开学前在学校后勤公众号查一下分配。', '学长小周', 28],
      ['一般是第一学期结束前(12月左右)提交申请，要求第一学期无挂科、绩点达到对方学院要求，还要参加转入学院的考核，具体看每年教务处通知。', '辅导员助理', 22],
      ['南门的小马烧烤和螺蛳粉都挺不错，人均 15 左右；生活区里面三食堂二楼晚上有砂锅，开到十点半。', '吃货本货', 11],
      ['建议加 1-2 个就行，比如计算机协会、ACM 集训队这种和专业相关的，或者篮协、话剧社这种放松的。别贪多，部长会比上课还忙。', '大二老油条', 19]
    ];
    var qa = qaRaw.map(function (r, i) {
      return {
        id: 'q' + (i + 1), title: r[0], body: r[1], tags: r[2], likes: r[3],
        author: i === 1 ? '我' : '温大同学' + (i + 1), createdAt: todayPlus(i * 1.4 + 0.5, 15 + i, 20),
        answers: [{
          id: 'a' + (i + 1), author: ansRaw[i][1], body: ansRaw[i][0], likes: ansRaw[i][2],
          accepted: true, createdAt: todayPlus(i * 1.2, 19, 5)
        }]
      };
    });

    /* ===== 作业 DDL（学生自己录入，或后续从教务/班级群自动抓取） ===== */
    var hwRaw = [
      // 课程, 作业名, 截止偏移天, 截止时间, 重要度, 预计耗时(h), 备注, 状态
      ['数据结构', '实验三：二叉树遍历与线索化', 0, '23:59', 3, 2.5, '交 .cpp 源文件 + 实验报告 PDF，发助教邮箱。', 'doing'],
      ['高等数学 A(一)', '习题册 P45–P52（第 3 章）', 1, '20:00', 2, 1.5, '重点是洛必达法则和泰勒展开那几题。', 'todo'],
      ['大学英语(三)', 'Writing: My Campus Life（150 词）', 2, '12:00', 2, 1, '写完提交到批改网，注意字数下限。', 'todo'],
      ['计算机网络', '第四章课后题 1 / 3 / 5', -1, '23:59', 2, 1, '已经逾期，尽快补交。', 'todo'],
      ['程序设计基础', '第 4 次上机实验报告', 4, '18:00', 1, 1.5, '把课上没调完的循环题补上。', 'todo'],
      ['人工智能导论', '读书报告：《人工智能简史》', 7, '23:59', 1, 3, '不少于 2000 字，可结合课堂案例写。', 'todo'],
      ['大学物理', '实验预习报告（示波器）', 5, '22:00', 2, 1, '实验前要交预习报告，别忘了。', 'todo']
    ];
    var homeworks = hwRaw.map(function (r, i) {
      return {
        id: 'h' + (i + 1), course: r[0], title: r[1], due: dt(r[2], r[3]),
        level: r[4], hours: r[5], note: r[6], status: r[7],
        createdAt: todayPlus(3 + i, 20, 10)
      };
    });

    /* ===== 课外计划（学生自己安排的学习 / 运动 / 社团 / 生活事项） ===== */
    var planRaw = [
      // 标题, 类型, 日期偏移, 开始, 结束, 地点, 重要度, 重复, 备注
      ['图书馆自习：写完数据结构实验三', '学习', 0, '19:00', '20:30', '图书馆三楼 A 区', 3, 'none', '遍历和线索化两部分都要跑通'],
      ['北校区夜跑 3 公里', '运动', 0, '20:45', '21:30', '北校区田径场', 2, 'weekly', '跑完记得拉伸 5 分钟'],
      ['背 30 个四级单词', '学习', 0, '22:00', '22:30', '宿舍', 2, 'weekly', '顺便听一段每日英语'],
      ['计算机协会例会 + ACM 训练赛', '社团', 1, '15:00', '17:00', '计算机楼-412', 3, 'weekly', '记得带笔记本'],
      ['整理高数错题本', '学习', 2, '14:30', '15:30', '宿舍', 2, 'none', '按知识点分类抄写'],
      ['和室友打羽毛球', '运动', 4, '10:00', '11:30', '北校区体育馆', 1, 'none', '提前一天在群里约场地']
    ];
    var plans = planRaw.map(function (r, i) {
      return {
        id: 'p' + (i + 1), title: r[0], type: r[1], date: dstr(r[2]),
        start: r[3], end: r[4], place: r[5], level: r[6], repeat: r[7], note: r[8],
        status: 'todo', createdAt: todayPlus(1 + i * 0.4, 21, 0)
      };
    });

    return {
      version: VERSION,
      bellScheduleVersion: BELL_SCHEDULE_VERSION,
      user: { nickname: '温大同学', college: '计算机与人工智能学院', avatar: '🐻', termStart: '2026-09-07' },
      /* 登录态：绑定温大统一身份认证（演示版仅在本机校验） */
      auth: { logged: false, sid: '', method: 'wzu-cas', loginAt: 0, remember: true },
      edu: null,      // 教务系统返回的档案：学号 / 年级 / 学院 / 专业
      sync: null,     // 最近一次同步摘要
      courses: courses,
      homeworks: homeworks,
      plans: plans,
      lost: lost,
      qa: qa,
      /* 教务调停课通知：登录后由 Store.syncNotices() 抓取，再由 Adjust 解析入库 */
      courseNotices: [],
      manualAdjustmentsMigrated: true,
      notices: [
        { id: 'n1', tag: '教务', title: '关于 2026-2027 学年第一学期期中教学检查的通知', date: '09-21', hot: true },
        { id: 'n2', tag: '后勤', title: '生活区三食堂二楼窗口升级，本周新增 6 个风味档口', date: '09-20', hot: false },
        { id: 'n3', tag: '学工', title: '校级奖学金评定材料提交截止至 9 月 30 日', date: '09-19', hot: true },
        { id: 'n4', tag: '社团', title: '百团大战社团招新：本周六 9:00 北校区体育馆', date: '09-18', hot: false }
      ],
      calendarVersion: CALENDAR_VERSION,
      calendar: firstTermCalendar()
    };
  }

  /* ==========================================================
     多账号（本机登录过的学号）
     ----------------------------------------------------------
     每个账号的数据各存一份：wzu-campus-hub:u:<学号>；
     wzu-campus-hub 永远是「当前生效账号」那一份，页面脚本不用改。
     名册记在 ROSTER_KEY 里，登录页拿它渲染「切换账号」。
     ========================================================== */
  function acctKey(sid) { return KEY + ':u:' + sid; }
  function readJSON(k) {
    try { var raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('本地存储写入失败', e); }
  }

  function roster() {
    var r = readJSON(ROSTER_KEY);
    if (!r || typeof r !== 'object' || !Array.isArray(r.list)) r = { cur: '', list: [] };
    return r;
  }
  function saveRoster(r) { writeJSON(ROSTER_KEY, r); }

  /* 把某个账号写进名册（登录时 bump=true 会刷新「最近登录」时间） */
  function upsertAccount(d, bump) {
    if (!d || !d.auth || !d.auth.sid) return;
    var sid = d.auth.sid;
    var r = roster();
    var row = null;
    r.list.forEach(function (x) { if (x.sid === sid) row = x; });
    if (!row) { row = { sid: sid, at: 0 }; r.list.push(row); }
    row.nickname = (d.user && d.user.nickname) || '温大同学';
    row.avatar = (d.user && d.user.avatar) || '🐻';
    row.college = (d.user && d.user.college) || (d.edu && d.edu.college) || '';
    row.grade = (d.edu && d.edu.grade) || '';
    row.courses = (d.courses || []).length;
    row.imported = !!(d.imported && d.imported.courses);
    row.remember = !!(d.auth && d.auth.remember);
    if (bump || !row.at) row.at = Date.now();
    r.cur = sid;
    r.list.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    saveRoster(r);
  }

  function accounts() { return roster().list.slice(); }
  function currentSid() { return roster().cur || ''; }

  /* 本机名册里移除一个账号（连带它那份数据），不影响当前登录 */
  function forgetAccount(sid) {
    var r = roster();
    r.list = r.list.filter(function (x) { return x.sid !== sid; });
    if (r.cur === sid) r.cur = '';
    saveRoster(r);
    try { localStorage.removeItem(acctKey(sid)); } catch (e) {}
    return r.list;
  }

  /* ---------- 新旧数据比对：判断一份数据是不是「原封不动的示例数据」 ---------- */
  function courseSig(list) {
    return (list || []).map(function (c) { return c.name + '#' + c.day + '#' + c.start; }).sort().join('|');
  }
  function isSeedCourses(list) {
    var s = seedData().courses;
    return Array.isArray(list) && list.length === s.length && courseSig(list) === courseSig(s);
  }
  function sameTitles(list, seed) {
    if (!Array.isArray(list) || list.length !== seed.length) return false;
    var f = function (arr) { return arr.map(function (x) { return x.title; }).sort().join('|'); };
    return f(list) === f(seed);
  }

  /* ---------- 新账号的初始数据 ----------
     课表 / 作业 / 计划是「这个学生自己的」，第一次登录必须为空，
     由学生自己导入或手动添加 —— 不能拿别人的示例数据糊上去。
     失物 / 问答 / 公告 / 校历是全校公共内容，保留。 */
  function freshData(sid) {
    var s = seedData();
    if (sid === DEMO.sid) return s;          // 演示账号：自带一整套完整示例数据
    s.courses = [];
    s.homeworks = [];
    s.plans = [];
    s.courseNotices = [];
    s.eduRawImported = [];
    s.imported = null;
    s.sync = null;
    s.edu = null;
    /* 学院属于「本人」的资料，不能把示例数据里的学院安到新同学头上 → 留空，让他自己在「我的」里填。
       （同样的坑还有一处：老版本 mockEdu() 按学号猜学院，已一并删掉。） */
    s.user.college = '';
    s.auth = { logged: false, sid: '', method: 'wzu-cas', loginAt: 0, remember: true };
    return s;
  }

  /* ---------- 旧数据兼容 ---------- */
  function migrate(data) {
    if (!data || typeof data !== 'object') return data;
    if (data.calendarVersion !== CALENDAR_VERSION) {
      data.calendar = firstTermCalendar();
      data.calendarVersion = CALENDAR_VERSION;
    }
    /* 兼容早期版本（没有 auth 字段） */
    if (!data.auth) data.auth = { logged: false, sid: '', method: 'wzu-cas', loginAt: 0, remember: true };
    if (!data.user) data.user = seedData().user;
    if (!Array.isArray(data.courses)) data.courses = [];
    /* 旧版把 18:30 起的整段晚课压成「第 11 节、1 节连堂」。
       现在按实际第 11~13 节展示，保留原先的结束时段。 */
    if (data.bellScheduleVersion !== BELL_SCHEDULE_VERSION) {
      data.courses.forEach(function (c) {
        if (+c.start === 11 && +c.span === 1) c.span = 3;
      });
      (Array.isArray(data.courseNotices) ? data.courseNotices : []).forEach(function (a) {
        if (a.origin !== 'assistant') return;
        ['from', 'to'].forEach(function (side) {
          var slot = a[side];
          if (slot && +slot.start === 11 && +slot.span === 1) slot.span = 3;
        });
      });
      data.bellScheduleVersion = BELL_SCHEDULE_VERSION;
    }
    /* 兼容早期版本（没有作业 / 计划数据） */
    if (!Array.isArray(data.homeworks) || !Array.isArray(data.plans)) {
      var s = seedData();
      if (!Array.isArray(data.homeworks)) data.homeworks = s.homeworks;
      if (!Array.isArray(data.plans)) data.plans = s.plans;
    }
    /* 兼容早期版本（没有调课通知、没有调课同步时间） */
    if (!Array.isArray(data.courseNotices)) data.courseNotices = [];
    if (data.sync && data.sync.noticesAt === undefined) data.sync.noticesAt = 0;
    /* 兼容早期版本（没有「从教务系统导入的真实数据」相关字段） */
    if (!Array.isArray(data.eduRawImported)) data.eduRawImported = [];
    /* 旧版演示／抓取通知不再展示；后续仅保留用户通过 AI 确认的课程调整。 */
    if (!data.manualAdjustmentsMigrated) {
      data.manualAdjustmentsMigrated = true;
      data.courseNotices = [];
      data.eduRawImported = [];
      data.sync = data.sync || {};
      data.sync.noticesAt = Date.now();
      data.sync.noticeSample = false;
    }
    if (data.imported === undefined) data.imported = null;
    if (data.sync && data.sync.source === undefined) data.sync.source = 'demo';
    /* 未勾选“记住登录状态”的账号，关闭浏览器后需要重新登录 */
    if (data.auth.logged && !data.auth.remember && sessionStorage.getItem(SESSION) !== '1') {
      data.auth.logged = false;
    }

    /* 一次性清理：早期版本里，用任何学号登录看到的都是同一套示例课表。
       现在改成「新账号空课表 + 自己导入」，所以把这份别人的数据摘掉。
       只清「和示例数据一模一样、且从没导入过真实课表」的账号，不动手动添加的课程。 */
    if (!data.seedCleared && data.auth && data.auth.sid) {
      data.seedCleared = true;
      if (data.auth.sid !== DEMO.sid && !data.imported && isSeedCourses(data.courses)) {
        var sd = seedData();
        data.courses = [];
        data.courseNotices = [];
        if (sameTitles(data.homeworks, sd.homeworks)) data.homeworks = [];
        if (sameTitles(data.plans, sd.plans)) data.plans = [];
        data.sync = null;
      }
    }

    /* 一次性清理：老版本会按学号「猜」一个学院（各位数字求和取模 15 个学院之一），
       登录后就被安上「建筑学院」这种莫名信息。这里把已经落盘的假学院摘掉。
       判据：edu.college 与 user.college 相同 —— 那正是当年自动写入的特征（登录时两者一起写）；
       学生自己在「我的」改过的话两者不一致，就听学生的，不动。
       演示账号的学院来自种子数据（写实的），保留。 */
    if (!data.autoCollegeCleared) {
      data.autoCollegeCleared = true;
      var eduRec = data.edu;
      if (eduRec && eduRec.college) {
        var sameAsUser = !!(data.user && data.user.college === eduRec.college);
        eduRec.college = '';
        eduRec.major = '';
        if (sameAsUser && !(data.auth && data.auth.sid === DEMO.sid)) data.user.college = '';
      }
    }
    data.demoNoticeCleared = true;

    normalizeTasks(data);
    return data;
  }

  function load() {
    if (cache) return cache;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && data.version === VERSION) {
          cache = migrate(data);
          writeJSON(KEY, cache);
          /* 老用户直接就是「已登录」状态：把他补进名册，切换账号时才看得到 */
          if (cache.auth.logged && cache.auth.sid) {
            writeJSON(acctKey(cache.auth.sid), cache);
            upsertAccount(cache, false);
          }
          return cache;
        }
      }
    } catch (e) { /* 数据损坏则重建 */ }
    cache = seedData();
    save();
    return cache;
  }

  function save() {
    if(cache)normalizeTasks(cache);
    writeJSON(KEY, cache);
    /* 同步落到「当前账号自己的那一份」，换账号回来时数据还在 */
    var sid = cache && cache.auth && cache.auth.sid;
    if (sid) {
      writeJSON(acctKey(sid), cache);
      upsertAccount(cache, false);
    }
  }

  function reset() {
    var prev = load();
    var next = seedData();
    /* 恢复的是「内容数据」，登录态与个人资料要留着 */
    next.auth = prev.auth;
    next.edu = prev.edu;
    next.sync = prev.sync;
    next.user = prev.user;
    next.seedCleared = true;
    cache = next;
    save();
    return cache;
  }

  function clearAll() {
    cache = load();
    cache.courses = [];
    cache.lost = [];
    cache.qa = [];
    save();
    return cache;
  }

  function exportJSON() { return JSON.stringify(load(), null, 2); }

  function importJSON(text) {
    var data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !data.version) throw new Error('文件格式不正确');
    data.version = VERSION;
    cache = migrate(data);
    save();
    return cache;
  }

  var seq = 0;
  function uid(prefix) {
    seq += 1;
    return (prefix || 'x') + Date.now().toString(36) + seq.toString(36);
  }

  /* ==========================================================
     登录 / 教务账号绑定
     说明：演示版不请求校外接口，用本机模拟“统一身份认证 + 教务系统”的返回，
     真正的接入点只有两个：mockEdu() 与 syncCourses()，替换成真实接口即可。
     ========================================================== */

  /* 温州大学真实接入链路（答辩时可直接引用这张表）：
     1) 打开 https://source-443.webvpn.wzu.edu.cn/login （WebVPN 统一身份认证）
     2) 用学号 + 密码登录，拿到 CAS 的 ST 票据，跳回 WebVPN 门户
     3) 在门户里进入「新教务系统」(jwgl / jwxt)
     4) 在新教务系统里调用课表接口（学生个人课表 / 学期课表），拿到 JSON
     现实约束：教务系统不对外开放、且强制 CAS 单点登录 + 会话 Cookie，
     纯前端静态页无法直连（跨域 + 需要 Cookie + 需要服务端保存票据），
     因此正式版需要一个后端代理：前端 → 自建后端 → CAS 登录态 → 教务接口。 */
  var EDU_FLOW = [
    { step: 1, t: '统一身份认证', d: 'source-443.webvpn.wzu.edu.cn/login · 学号 + 密码 → CAS 票据' },
    { step: 2, t: '进入新教务系统', d: 'WebVPN 门户 →「新教务系统」→ 携带会话 Cookie' },
    { step: 3, t: '拉取本学期课表', d: '教务系统 学生个人课表 / 学期课表接口' },
    { step: 4, t: '同步通知与校历', d: '调课停课通知、校历事件、考试安排' },
    { step: 5, t: '生成校园首页', d: '课表 + 作业 + 计划 → 今日规划' }
  ];

  var SESSION = 'wzu-campus-session';
  var DEMO = { sid: '20230427', pwd: 'wzu@2026' };
  /* 模拟教务系统返回的学籍档案（把这里换成真实接口即可对接学校系统）。
     **这里不猜学院和专业** —— 学号里唯一能可靠推出来的只有入学年份（前 4 位）。
     老版本按「学号各位数字求和 % 学院数」随机派一个学院，登录后就被安上「建筑学院」，
     纯属编造（forey 直接质疑过），已删掉：拿不到就留空，宁可不显示也不瞎填。 */
  function mockEdu(sid) {
    return {
      sid: sid, name: '',
      college: '',
      grade: /^20\d{2}/.test(sid) ? sid.slice(0, 4) + ' 级' : '在读',
      major: ''
    };
  }

  /* 真实课表同步的接入点：正式版在这里请求自建后端（由后端持 CAS 会话去查教务系统）。
     演示版直接返回本机已有的课程，保证「登录 → 有数据」这条链路是通的。 */
  function syncCourses(sid) {
    var d = load();
    return {
      sid: sid || (d.auth && d.auth.sid) || '',
      courses: d.courses.slice(),
      notices: d.notices.slice(),
      calendar: d.calendar.slice(),
      at: Date.now()
    };
  }

  /* ==========================================================
     调停课通知抓取
     ----------------------------------------------------------
     流程：学生登录后，教务系统「教务通知 › 调停课通知」里会有这类消息：
         【调课通知】《数据结构》原定第3周周二第6-7节，教室为计算机楼-408。
         因任课教师陈立老师赴杭州参加学术会议，调整至第3周周四第3-4节，
         上课地点改为计算机楼-402，请同学们相互转告。
     抓取方式（正式版）：前端 → 自建后端（持 CAS 会话）→ 教务系统通知接口
     前端拿到的是「原文」，再由 Adjust 解析器抽成结构化数据。
     演示版：直接返回下面这份与教务系统结构一致的模拟原文。
     ========================================================== */
  var NOTICE_SOURCE = '新教务系统 › 教务通知 › 调停课通知';

  function syncNotices(sid) {
    var d = load();
    var sidNow = sid || (d.auth && d.auth.sid) || '';
    return {
      sid: sidNow,
      at: Date.now(),
      source: '首页 AI 课程调整',
      session: {live: false, sample: false},
      items: []
    };
  }

  /* 当前登录的是不是演示账号（决定要不要给他看内置样本） */
  function isDemo() {
    var d = load();
    return !!(d.auth && d.auth.sid === DEMO.sid);
  }

  /* ==========================================================
     真实数据导入（学生用抓取脚本从教务系统带回的 JSON）
     ----------------------------------------------------------
     思路：课表直接替换入库；调停课通知只存「原文」，
     再由 notices.js 的 Adjust 解析引擎统一解析 —— 复用同一条链路，
     导入的真实通知和演示样本走完全相同的解析逻辑。
     ========================================================== */
  function importCourses(list, meta) {
    var d = load();
    var colorOf = {}, out = [];
    (list || []).forEach(function (c) {
      var name = String((c && c.name) || '').trim();
      var day = parseInt(c && c.day, 10);
      var start = parseInt(c && c.start, 10);
      if (!name || !(day >= 1 && day <= 7) || !(start >= 1 && start <= TOTAL_PERIODS)) return;
      /* 连堂按「从 start 到最后一节还剩几节」卡。原来固定卡 6，
         会把「(2-9节)」这种整天连上的公选课截成「2-7 节」。 */
      var span = Math.max(1, Math.min(TOTAL_PERIODS - start + 1, parseInt(c.span, 10) || 2));
      var from = Math.max(1, parseInt(c.from, 10) || 1);
      var to = Math.max(from, parseInt(c.to, 10) || 16);
      if (!colorOf[name]) colorOf[name] = COURSE_COLORS[Object.keys(colorOf).length % COURSE_COLORS.length];
      out.push({
        id: 'i' + (out.length + 1), name: name, teacher: String((c && c.teacher) || '').trim() || '未填写',
        room: String((c && c.room) || '').trim() || '待定',
        day: day, start: start, span: span, from: from, to: to, color: colorOf[name]
      });
    });
    if (!out.length) return 0;

    d.courses = out;
    /* 课表被整体换掉了，之前基于旧课表的调课调整就作废了 → 清空并允许重新同步 */
    d.courseNotices = [];
    d.imported = { courses: out.length, at: Date.now(), meta: meta || null };
    d.sync = d.sync || {};
    d.sync.courses = out.length;
    d.sync.noticesAt = 0;
    d.sync.source = 'wzu-import';
    d.sync.at = Date.now();
    save();
    return out.length;
  }

  /* 只存原文，解析交给 Adjust */
  function importNoticeRaw(items) {
    var d = load();
    d.eduRawImported = [];
    save();
    return 0;
  }

  /* 一键恢复成示例数据（导入错了 / 答辩演示结束后用） */
  function clearImported() {
    var d = load();
    var s = seedData();
    d.courses = s.courses;
    d.courseNotices = [];
    d.eduRawImported = [];
    d.imported = null;
    d.sync = { courses: d.courses.length, notices: d.notices.length, qa: d.qa.length, at: Date.now(), noticesAt: 0, source: 'demo' };
    save();
    return d;
  }

  /* ==========================================================
     生效课表：原始课表 + 已应用的调课调整
     ----------------------------------------------------------
     不直接改动 courses，而是每次按「周次 + 星期」现算，
     这样「撤销调整」只要把 applied 置回 false，原课自动回来。
     ========================================================== */
  function matchCourse(c, a) {
    if (!a || !a.from) return false;
    if (a.courseId && c.id === a.courseId) return true;
    return c.name === a.course && c.day === a.from.day && c.start === a.from.start;
  }

  function coursesOn(day, week) {
    var d = load();
    var list = d.courses.filter(function (c) {
      return c.day === day && week >= c.from && week <= c.to;
    }).map(function (c) {
      return {
        id: c.id, name: c.name, teacher: c.teacher, room: c.room, day: c.day,
        start: c.start, span: c.span, from: c.from, to: c.to, color: c.color
      };
    });

    var applied = (d.courseNotices || []).filter(function (a) { return a.applied; });

    /* 1) 换教室：原课时间不变，只把教室换成新教室 */
    applied.forEach(function (a) {
      if (a.type !== 'room' || !a.to || !a.to.room) return;
      if (!a.from || a.from.week !== week) return;
      list.forEach(function (c) { if (matchCourse(c, a)) { c.room = a.to.room; c.adjusted = true; c.adjustType = 'room'; } });
    });

    /* 2) 调课 / 停课：把原时间格的课移走（停课则不补） */
    applied.forEach(function (a) {
      if (a.type !== 'move' && a.type !== 'cancel') return;
      if (!a.from || a.from.week !== week) return;
      list = list.filter(function (c) { return !matchCourse(c, a); });
    });

    /* 3) 新增：调课后落到新课时间的课 + 补课 */
    applied.forEach(function (a) {
      if (a.type !== 'move' && a.type !== 'make') return;
      if (!a.to || a.to.week !== week || a.to.day !== day) return;
      list.push({
        id: 'adj-' + a.no, name: a.course, teacher: a.teacher || '',
        room: a.to.room || '教室待定', day: a.to.day, start: a.to.start, span: a.to.span,
        from: week, to: week, color: a.color || '#F79009',
        adjusted: true, adjustType: a.type
      });
    });

    return list.sort(function (a, b) { return a.start - b.start; });
  }

  /* ==========================================================
     登录：按「学号」隔离数据
     ----------------------------------------------------------
     同一个浏览器里登录过的每个学号，各自有一份独立的课表 / 作业 / 计划：
       · 这个学号以前登录过 → 直接把他自己的那份调回来（什么都不用重录）
       · 第一次登录       → 干净的初始数据：课表为空，引导他去导入
     演示账号（DEMO.sid）例外，永远带一整套完整的示例数据，方便答辩演示。
     ========================================================== */
  function login(sid, remember) {
    sid = String(sid || '').trim();

    /* 先把「上一个账号」的数据落到它自己的槽里，避免被这次的登录冲掉 */
    var prev = cache || load();
    if (prev && prev.auth && prev.auth.sid && prev.auth.sid !== sid) {
      writeJSON(acctKey(prev.auth.sid), prev);
      upsertAccount(prev, false);
    }

    var saved = readJSON(acctKey(sid));
    var d, fresh = false;
    if (saved && saved.version === VERSION) {
      d = migrate(saved);
    } else {
      d = freshData(sid);
      fresh = true;
    }

    var profile = mockEdu(sid);
    d.auth = { logged: true, sid: sid, method: 'wzu-cas', loginAt: Date.now(), remember: !!remember };
    d.edu = profile;
    /* 学院：现在 mockEdu() 不再猜（所以恒为空，等于不填）；等接了真实教务接口，
       学籍档案里有学院时会自动带进来；学生自己在「我的」改过就听他的。 */
    if (profile.college && (fresh || !d.user.college)) d.user.college = profile.college;
    var importedCourses = (d.imported && d.imported.courses) || 0;
    d.sync = {
      courses: (d.courses || []).length,
      notices: (d.notices || []).length,
      qa: (d.qa || []).length,
      at: Date.now(),
      noticesAt: 0,
      source: importedCourses ? 'wzu-import' : 'demo'
    };

    cache = d;
    try {
      if (remember) localStorage.setItem(SESSION, '1');
      else { sessionStorage.setItem(SESSION, '1'); localStorage.removeItem(SESSION); }
    } catch (e) { /* 隐私模式下忽略 */ }

    save();
    upsertAccount(d, true);
    return profile;
  }

  /* 切换账号：本机已经登录过的学号，一键切过去，不用再输密码 */
  function switchTo(sid) {
    sid = String(sid || '').trim();
    if (!sid) return null;
    if (!readJSON(acctKey(sid))) return null;
    return login(sid, true);
  }

  function logout() {
    var d = load();
    d.auth.logged = false;
    d.auth.loginAt = 0;
    try { sessionStorage.removeItem(SESSION); } catch (e) {}
    save();
    return d;
  }

  /* 门禁：所有内页脚本开头调用；未登录直接回到登录页 */
  function requireAuth() {
    if (!load().auth.logged) {
      try { location.replace('index.html'); } catch (e) {}
      return false;
    }
    return true;
  }

  return {
    load: load, save: save, reset: reset, clearAll: clearAll,
    classifyTask: classifyTask, isAcademicTask: isAcademicTask,
    exportJSON: exportJSON, importJSON: importJSON, uid: uid, KEY: KEY,
    auth: function () { return load().auth; },
    login: login, logout: logout, requireAuth: requireAuth,
    /* 多账号：名册 / 一键切换 / 从本机移除 */
    accounts: accounts, currentSid: currentSid, switchTo: switchTo, forgetAccount: forgetAccount,
    mockEdu: mockEdu, syncCourses: syncCourses, EDU_FLOW: EDU_FLOW,
    syncNotices: syncNotices, coursesOn: coursesOn, NOTICE_SOURCE: NOTICE_SOURCE, isDemo: isDemo,
    importCourses: importCourses, importNoticeRaw: importNoticeRaw, clearImported: clearImported,
    COURSE_COLORS: COURSE_COLORS,
    EDU_LOGIN_URL: EDU_LOGIN_URL, EDU_NEW_SYS: EDU_NEW_SYS,
    DEMO: DEMO
  };
})();
