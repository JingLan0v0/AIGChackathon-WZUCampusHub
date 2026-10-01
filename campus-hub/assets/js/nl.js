/* ==========================================================
   自然语言快捷记录（NL）
   ----------------------------------------------------------
   首页那个对话框：学生拿一句人话把事记下来，系统自己判断这是
   「课外计划 / 作业 DDL / 课表补充」，顺手把时间、地点、重要度抽出来，
   先给一张「我理解为」的卡片让他核对，点了「确认添加」才写库。

   HTTP 预览通过本地服务调用 DeepSeek；密钥仅存在服务端、仓库外加密保存。
   本地规则保留为离线兼容路径，联网失败时明确提示重试。
   ========================================================== */
var NL = (function () {
  /* ---------- 基础工具（不依赖 UI，方便在 Node 沙箱里直接测） ---------- */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function toHM(min) {
    min = Math.max(0, Math.min(24 * 60, Math.round(min)));
    return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
  }
  function at0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = at0(d); x.setDate(x.getDate() + n); return x; }
  function weekdayOf(dateStr) {
    var d = new Date(String(dateStr) + 'T00:00:00');
    if (isNaN(d.getTime())) return 1;
    return d.getDay() === 0 ? 7 : d.getDay();
  }
  function fmtCn(dateStr) {
    var d = new Date(String(dateStr) + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  var WDAY = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 };
  var CN_NUM = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

  function numOf(s) {
    s = String(s || '').trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (/^\d+\.\d+$/.test(s)) return parseFloat(s);
    if (s === '半') return 0.5;
    if (s === '一个半' || s === '1个半') return 1.5;
    if (CN_NUM[s] !== undefined) return CN_NUM[s];
    if (/^十[一二三四五六七八九]$/.test(s)) return 10 + CN_NUM[s.charAt(1)];
    if (/^[一二三四五六七八九]十$/.test(s)) return CN_NUM[s.charAt(0)] * 10;
    return NaN;
  }

  /* ---------- 扫描器：把「已经认出来的字」划掉，剩下的才是标题 ----------
     每个 take() 命中的区间会被记下来，事后凡是落在这段里的字符一律清掉。
     匹配时用「掩码串」（已消费的字换成 \u0000）再匹配，避免同一段文字被两个规则重复吃。 */
  function Scanner(text) { this.text = String(text || ''); this.spans = []; }
  Scanner.prototype._masked = function () {
    var a = this.text.split('');
    this.spans.forEach(function (sp) { for (var i = sp[0]; i < sp[1]; i++) a[i] = '\u0000'; });
    return a.join('');
  };
  Scanner.prototype.take = function (re, map) {
    var m = re.exec(this._masked());
    if (!m) return null;
    this.spans.push([m.index, m.index + m[0].length]);
    return map ? map(m) : m;
  };
  Scanner.prototype.rest = function () {
    var a = this.text.split('');
    this.spans.forEach(function (sp) { for (var i = sp[0]; i < sp[1]; i++) a[i] = '\u0000'; });
    /* 认出来的部分直接挖掉、不留空格 —— 否则「去体育馆打羽毛球」会变成「去 打羽毛球」 */
    return a.join('')
      .replace(/[\u0000\u3000\s]+/g, ' ')
      .replace(/^[\s，,。.、；;：:!！?？~～\-–—]+|[\s，,。.、；;：:!！?？~～\-–—]+$/g, '')
      .trim();
  };

  /* ---------- 词法规则 ---------- */
  /* 今晚 / 明晚 这类词同时含「哪一天」和「上午还是下午」，先单独吃掉 */
  var RE_FUSED = /(今晚|今夜|明晚|昨夜|昨晚|今早|明早)/;
  var RE_DATE = /(大后天|后天|明天|今天|今日|明日|后日)/;
  var RE_MDAY = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/;
  var RE_WEEK = /((下下|下|这|本|每)?(?:周|星期|礼拜)([一二三四五六日天]|[1-7])|周末)/;
  var RE_AMPM = /(上午|早上|早晨|一早|凌晨|清晨|中午|下午|傍晚|晚上|晚间|夜里|夜间|晚)/;
  var RE_WEEKLY = /每(?:周|星期|礼拜|天)/;
  var RE_DAILY = /每天|每日/;
  /* 「重要」「不急」这类词是重要度的线索，认出来之后要从标题里摘掉，
     否则会变成「重要！！ 打印实验报告」这种标题 */
  var RE_LV_HI = /(非常重要|很重要|重要|紧急|务必|必须|一定要|马上)/;
  var RE_LV_LO = /(不急|随便|有空|随意|可选)/;

  /* 上午 / 下午 / 晚上 → 几点制。别用「以午结尾就是下午」这种猜法，
     上午也以午结尾，之前就是这么把「上午 8 点」读成晚上 8 点的。 */
  var AMPM_MAP = {
    '上午': 'am', '早上': 'am', '早晨': 'am', '一早': 'am', '凌晨': 'am', '清晨': 'am',
    '中午': 'noon',
    '下午': 'pm', '傍晚': 'pm', '晚上': 'pm', '晚间': 'pm', '夜里': 'pm', '夜间': 'pm', '晚': 'pm'
  };

  var P = '(\\d{1,2}|[一二三四五六七八九十]{1,3})';
  var RE_PERIOD = new RegExp('第\\s*' + P + '\\s*(?:[-–~—－至到]\\s*' + P + ')?\\s*节');
  var RE_PERIOD2 = new RegExp(P + '\\s*[-–~—－]\\s*' + P + '\\s*节');
  var RE_PERIOD3 = new RegExp(P + '\\s*节');

  var RE_RANGE = /(\d{1,2})\s*[:：点时]\s*(\d{1,2})?\s*分?\s*[-–~—－至到]\s*(\d{1,2})\s*[:：点时]\s*(\d{1,2})?\s*分?/;
  var RE_HALF = /(\d{1,2})\s*[:：点时]\s*半/;
  var RE_CLOCK = /(\d{1,2})\s*[:：点时]\s*(\d{1,2})?\s*分?/;
  /* 时长要排在时钟前面：「2 小时」里的「时」会被时钟规则误当成 2 点 */
  var RE_DUR = /(一个半|1个半|\d+(?:\.\d+)?|[一二两三四五六七八九十]+|半)\s*个?\s*(?:小时|钟头|h|H)/;
  var RE_MIN = /(\d{1,3})\s*分钟/;

  var RE_ROOMNUM = /([\u4e00-\u9fa5A-Za-z]{1,6}(?:楼|馆|场|室|厅))\s*[-－]?\s*([A-Za-z]?\d{1,4})/;
  var RE_KNOWN = /(图书馆|自习室|体育馆|田径场|操场|篮球场|羽毛球场|足球场|食堂|报告厅|大礼堂|音乐厅|会议室|游泳馆|宿舍|寝室|教学楼|实验楼|北校区|南校区|东校区)/;
  /* 「在计算机楼-402」里那个「在」是连接词，不是教室名的一部分 */
  var RE_PLACE_LEAD = /^[在到去于至从往的]+/;

  var RE_HW = /(作业|习题|练习册|课后题|思考题|练习题|编程题|上机题|实验报告|实验|报告|论文|作文|读书笔记|读书报告|小测|测验|PPT|ppt|源文件|代码|设计)/;
  var RE_COURSE_KW = /(加课|补课|上课|有课|排课|换课|调课|课程|课表)/;

  /* 请假条：「请病假 / 请事假 / 请公假 / 病假」都算。
     这类句子不归课外计划，走单独的「生成请假条」流程 */
  var RE_LEAVE_ANY = /请\s*(?:病|事|公)\s*假|病假|事假|公假/;
  var RE_LEAVE = /请\s*(病|事|公)?\s*假|病假|事假|公假/;
  var RE_REASON = /因为|由于|原因是?|因/;
  /* 天数：「两天 / 3 天 / 一个半天」。「明天 / 今天」已被日期规则先吃掉，不冲突 */
  var RE_DAYS_HALF = /半\s*个?\s*天/;
  var RE_DAYS = /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*个?\s*天/;

  var ALIAS = [
    ['高数', '高等数学'], ['线代', '线性代数'], ['大物', '大学物理'], ['大英', '大学英语'],
    ['计网', '计算机网络'], ['概统', '概率'], ['思修', '思想道德'], ['马原', '马克思主义'],
    ['程设', '程序设计'], ['数构', '数据结构'], ['网安', '网络安全'], ['操作系统', '操作系统']
  ];
  var TYPE_KW = [
    ['运动', /跑|篮球|足球|羽毛球|乒乓|网球|健身|游泳|瑜伽|拉伸|锻炼|球|骑车|爬山|远足/],
    ['学习', /自习|学习|复习|预习|背|单词|看书|读书|图书馆|写|刷题|做题|网课|考试|备考/],
    ['社团', /例会|社团|协会|部门|开会|会议|活动|志愿|竞选|招新|讲座|培训/],
    ['社交', /聚餐|聚会|约|朋友|同学|室友|生日|班聚|一起/],
    ['生活', /吃饭|午餐|晚餐|早餐|取快递|快递|剪发|理发|洗澡|洗衣|看病|买|逛|睡觉|打扫|整理/]
  ];

  /* ---------- 日期 ---------- */
  function takeDate(sc, now) {
    var out = { date: '', label: '', ampm: '', hit: false };
    var m = sc.take(RE_FUSED);
    if (m) {
      var w = m[1];
      var off = /^(今晚|今夜)$/.test(w) ? 0 : /^(昨晚|昨夜)$/.test(w) ? -1 : 1;
      out.date = dayKey(addDays(now, off));
      out.label = w;
      out.ampm = /早/.test(w) ? 'am' : 'pm';
      out.hit = true;
      return out;
    }
    m = sc.take(RE_DATE);
    if (m) {
      var map = { '大后天': 3, '后天': 2, '后日': 2, '明日': 1, '明天': 1, '今天': 0, '今日': 0 };
      out.date = dayKey(addDays(now, map[m[1]] || 0));
      out.label = m[1];
      out.hit = true;
      return out;
    }
    m = sc.take(RE_WEEK);
    if (m) {
      var tail = m[1] === '周末' ? '六' : m[3];
      var W = WDAY[tail];
      if (W) {
        var cur = now.getDay() === 0 ? 7 : now.getDay();
        var lead = m[2] || '';
        var diff = W - cur;
        if (lead === '下下') diff += 14;
        else if (lead === '下') diff += 7;
        else if (diff < 0) diff += 7;   /* 「周二」已经过了 → 说的一定是下周 */
        if (diff < 0) diff += 7;
        out.date = dayKey(addDays(now, diff));
        out.label = m[1];
        out.hit = true;
      }
      return out;
    }
    m = sc.take(RE_MDAY);
    if (m) {
      var y = now.getFullYear();
      var mo = Math.min(12, Math.max(1, parseInt(m[1], 10)));
      var dd = Math.min(31, Math.max(1, parseInt(m[2], 10)));
      var cand = new Date(y, mo - 1, dd);
      if (cand.getTime() < at0(now).getTime()) cand = new Date(y + 1, mo - 1, dd);
      out.date = dayKey(cand);
      out.label = m[1] + ' 月 ' + m[2] + ' 日';
      out.hit = true;
    }
    return out;
  }

  /* ---------- 节次 ---------- */
  function takePeriod(sc) {
    var m = sc.take(RE_PERIOD);
    if (m) {
      var a = numOf(m[1]);
      var b = m[2] ? numOf(m[2]) : a;
      if (isFinite(a)) return { start: a, end: isFinite(b) ? b : a, range: !!m[2] };
    }
    m = sc.take(RE_PERIOD2);
    if (m) {
      var a2 = numOf(m[1]), b2 = numOf(m[2]);
      if (isFinite(a2) && isFinite(b2)) return { start: a2, end: b2, range: true };
    }
    m = sc.take(RE_PERIOD3);
    if (m) {
      var a3 = numOf(m[1]);
      if (isFinite(a3)) return { start: a3, end: a3, range: false };
    }
    return null;
  }

  /* ---------- 时刻 ---------- */
  function normMin(h, m, ampm) {
    h = parseInt(h, 10);
    if (isNaN(h)) return NaN;
    m = parseInt(m, 10);
    if (isNaN(m)) m = 0;
    if (ampm === 'pm') { if (h < 12) h += 12; }
    else if (ampm === 'am') { if (h === 12) h = 0; }
    else if (ampm === 'noon') { if (h < 11) h += 12; }
    else if (h >= 1 && h <= 6) h += 12;    /* 没写上午下午时，「3 点」按下午读 */
    h = Math.max(0, Math.min(23, h));
    m = Math.max(0, Math.min(59, m));
    return h * 60 + m;
  }

  function takeDuration(sc) {
    var m = sc.take(RE_DUR);
    if (m) {
      var n = numOf(m[1]);
      if (isFinite(n)) return Math.round(n * 60);
    }
    m = sc.take(RE_MIN);
    if (m) return parseInt(m[1], 10) || 0;
    return 0;
  }

  function takeClock(sc, ampm) {
    var out = { start: NaN, end: NaN };
    var m = sc.take(RE_RANGE);
    if (m) {
      out.start = normMin(m[1], m[2], ampm);
      out.end = normMin(m[3], m[4], ampm);
      return out;
    }
    m = sc.take(RE_HALF);
    if (m) { out.start = normMin(m[1], 30, ampm); return out; }
    m = sc.take(RE_CLOCK);
    if (m) { out.start = normMin(m[1], m[2], ampm); return out; }
    return out;
  }

  /* ---------- 地点 ---------- */
  function takePlace(sc) {
    var m = sc.take(RE_ROOMNUM);
    if (m) return (m[1] + '-' + m[2]).replace(RE_PLACE_LEAD, '');
    m = sc.take(RE_KNOWN);
    if (m) return m[1];
    return '';
  }

  /* ---------- 请假条 ---------- */
  function takeDays(sc) {
    if (sc.take(RE_DAYS_HALF)) return 0.5;
    var m = sc.take(RE_DAYS);
    if (m) {
      var n = numOf(m[1]);
      if (isFinite(n) && n > 0) return n;
    }
    return 0;
  }

  function takeLeave(sc) {
    var m = sc.take(RE_LEAVE);
    if (!m) return { hit: false, type: '事假' };
    var w = m[0];
    var type = /病/.test(w) ? '病假' : (/公/.test(w) ? '公假' : '事假');
    return { hit: true, type: type };
  }

  /* 理由收尾清理：掐掉标点、句首的「我想/要去」、句尾没落下的「想去要去」，
     以及混在里面的「请病假」原词 */
  function cleanReason(s) {
    return String(s || '')
      .replace(/(?:我)?(?:想|要|得)?\s*请\s*(?:病|事|公)?\s*假/g, '')
      .replace(/[\s，,。.、；;：:!！?？~～\-–—]+$/, '')
      .replace(/^[\s，,。.、；;：]+/, '')
      .replace(/^(?:我想|我要|我想去|我要去|要去|想去|要|想|得|去)+/, '')
      .replace(/(?:我想|我要|要去|想去|想|要|得|去|了|请)+$/, '')
      .replace(/^[，,。\s]+|[，,。\s]+$/, '')
      .trim();
  }

  /* 把一张请假单渲染成正式的「请假条」文本。
     纯函数：NL.buildLeave(leave, user, now)，Node 沙箱里直接测。
     user = { name, sid, college, major }（都允许为空，空了就留占位提示） */
  function buildLeave(L, user, now) {
    L = L || {}; user = user || {}; now = now || new Date();
    var type = L.type || '事假';
    var teacher = String(L.teacher || '').replace(/老师$/, '').trim() || '任课';
    var who = [user.college, user.major, user.name].filter(Boolean).join('');
    if (!who) who = '（学院 / 专业 / 姓名）';
    var sid = user.sid ? '（学号 ' + user.sid + '）' : '（学号）';

    var days = Math.max(0.5, parseFloat(L.days) || 1);
    var d0 = new Date(String(L.start || '') + 'T00:00:00');
    if (isNaN(d0.getTime())) d0 = new Date();
    function lab(d) {
      var w = '一二三四五六日'.charAt((d.getDay() + 6) % 7);
      return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日（周' + w + '）';
    }
    var slot = String(L.slot || '全天');
    var timeStr;
    if (days <= 0.5) {
      timeStr = lab(d0) + slot;
    } else if (days === 1) {
      timeStr = lab(d0) + (slot === '全天' ? '全天' : slot);
    } else {
      var tail = days % 1 ? '（最后一天为' + (/上午|下午|晚/.test(slot) ? slot : '上午') + '）' : '';
      timeStr = '自 ' + lab(d0) + ' 至 ' + lab(addDays(d0, Math.ceil(days) - 1)) + '，共 ' + days + ' 天' + tail;
    }

    var courseLine = '';
    if (L.course && L.course !== '其他') {
      courseLine = '\n　　请假期间「' + L.course + '」落下的内容，我会对照课件和同学的笔记自学补上，作业按时提交。';
    }
    var reason = String(L.reason || '').trim() || '（请假理由）';
    var name = user.name || '（签名）';
    var dt = now.getFullYear() + ' 年 ' + (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日';
    return '请假条\n\n尊敬的 ' + teacher + ' 老师：\n\n' +
      '　　您好！我是' + who + sid + '。因' + reason + '，需请' + type + '，时间为' + timeStr + '。' + courseLine +
      '\n　　恳请老师批准。\n\n　　此致\n　　敬礼！\n\n　　　　　　　　请假人：' + name + '\n　　　　　　　　' + dt;
  }

  /* ---------- 课程名 / 类型 / 重要度 / 标题清洗 ---------- */
  function guessCourse(text, courses) {
    var names = (courses || []).filter(Boolean);
    var hit = '';
    names.forEach(function (n) { if (text.indexOf(n) >= 0 && String(n).length > hit.length) hit = n; });
    if (hit) return hit;
    for (var i = 0; i < ALIAS.length; i++) {
      if (text.indexOf(ALIAS[i][0]) < 0) continue;
      var t = ALIAS[i][1];
      var f = names.filter(function (n) { return String(n).indexOf(t) >= 0; })[0];
      if (f) return f;
    }
    return '';
  }

  function typeOf(text) {
    for (var i = 0; i < TYPE_KW.length; i++) if (TYPE_KW[i][1].test(text)) return TYPE_KW[i][0];
    return '其他';
  }

  function levelOf(text) {
    if (/重要|必须|紧急|务必|一定要|马上|！！|!!/.test(text)) return 3;
    if (/不急|随便|有空|随意|可选|看看|再说/.test(text)) return 1;
    return 2;
  }

  /* 「交 / 提交 / 截止」是作业的动词，不是作业名的一部分。
     只在开头或结尾摘，别动「交通」「交集」这种词中间的「交」。 */
  var RE_DUE_VERB = /^\s*(?:之?前)?\s*(?:交|提交|上交|截止)\s*|\s*(?:之?前)?\s*(?:交|提交|上交|截止)\s*$/g;

  function cleanTitle(s, kind) {
    s = String(s || '')
      .replace(/^[\s，,。.、；;：:!！?？~～\-–—]+/, '')
      .replace(/[\s，,。.、；;：:!！?？~～\-–—]+$/, '')
      .replace(/^(要|想|打算|准备|记得|帮我|麻烦|提醒我|安排|计划|需要|有个)+/, '')
      .trim();
    if (kind === 'homework') s = s.replace(RE_DUE_VERB, ' ');
    if (kind === 'course') s = s.replace(/^(加课|补课|上课|排课|换课|调课)\s*/, '');
    return s.replace(/^[\s，,。.、；;：:!！?？~～\-–—]+|[\s，,。.、；;：:!！?？~～\-–—]+$/g, '')
      .replace(/^[\s的]+|[\s的]+$/g, '').trim();
  }

  /* ---------- 解析单条 ---------- */
  function parseOne(seg, now, courses) {
    var text = String(seg || '').trim();
    var res = {
      ok: true, raw: text, kind: 'plan',
      title: '', date: '', dateLabel: '', start: '', end: '', place: '', level: 2, type: '其他', repeat: 'none',
      course: '', due: '', hours: 1,
      day: 0, period: 0, span: 0, room: '', teacher: '',
      notes: [], missing: []
    };
    if (text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').length < 2) {
      res.ok = false; res.reason = '没有可识别的内容'; return res;
    }

    var sc = new Scanner(text);
    var d = takeDate(sc, now);
    var ampm = d.ampm || '';
    /* 只有日期词本身带上了上下午（今晚 / 明早）才预填时段词，
       否则「周六」这种纯日期会被误当成晚上 —— 空就是空 */
    var ampmWord = d.ampm ? (d.ampm === 'am' ? '上午' : '晚上') : '';
    if (!ampm) {
      var am = sc.take(RE_AMPM);
      if (am) { ampmWord = am[1]; ampm = AMPM_MAP[am[1]] || ''; }
    }
    /* 「重要 / 不急」先摘掉：重要度已经记下了，别让它再进标题 */
    if (!sc.take(RE_LV_HI)) sc.take(RE_LV_LO);
    var per = takePeriod(sc);
    var dur = takeDuration(sc);
    var ck = takeClock(sc, ampm);
    var room = takePlace(sc);

    /* 请假条单独成类：先吃掉「请病假」原词、天数、理由，
       剩下的才轮到课程 / 作业 / 计划那套归类 */
    var isLeave = RE_LEAVE_ANY.test(text);
    var leaveType = '事假', leaveDays = 0, leaveReason = '';
    if (isLeave) {
      var lv = takeLeave(sc);
      leaveType = lv.type;
      leaveDays = takeDays(sc);
      if (sc.take(RE_REASON)) leaveReason = cleanReason(sc.rest());
      else leaveReason = cleanReason(sc.rest());
    }

    var startMin = isFinite(ck.start) ? ck.start : NaN;
    var endMin = isFinite(ck.end) ? ck.end : NaN;
    res.date = d.date || dayKey(now);
    res.dateLabel = d.label || '';
    res.place = room;
    res.room = room;
    res.level = levelOf(text);

    /* 归类：请假条 → 课表补充 → 作业 DDL → 其他都是课外计划 */
    var hasDate = !!d.date;
    var courseKw = RE_COURSE_KW.test(text);
    if (isLeave) res.kind = 'leave';
    else if ((per && hasDate) || (courseKw && (hasDate || per))) res.kind = 'course';
    else if (RE_HW.test(text)) res.kind = 'homework';

    /* 重复 */
    if (RE_WEEKLY.test(text)) res.repeat = 'weekly';
    if (RE_DAILY.test(text)) res.notes.push('「每天」重复暂时不支持，先按一次性记下来（可以改成每周重复）。');

    if (res.kind === 'leave') {
      var slotLabel;
      if (per) slotLabel = '第 ' + per.start + (per.range && per.end > per.start ? '–' + per.end : '') + ' 节';
      else if (ampmWord) slotLabel = /晚|夜/.test(ampmWord) ? '晚上' : (/中午|下午|傍晚/.test(ampmWord) ? '下午' : '上午');
      else slotLabel = '全天';
      res.leave = {
        type: leaveType,
        teacher: '',
        start: res.date,
        slot: slotLabel,
        days: leaveDays || (slotLabel === '全天' ? 1 : 0.5),
        course: guessCourse(text, courses) || '',
        reason: leaveReason
      };
      if (!leaveReason) res.missing.push('请假理由');
      if (!d.hit) res.notes.push('没说从哪天开始，先按今天算，记得改成真的那天。');
    } else if (res.kind === 'course') {
      res.title = cleanTitle(sc.rest(), 'course') || '新课程';
      res.name = res.title;
      res.day = weekdayOf(res.date);
      if (per) {
        var st = Math.max(1, Math.min(UI_PERIODS(), Math.round(per.start)));
        var en = Math.max(st, Math.min(UI_PERIODS(), Math.round(per.end)));
        res.period = st;
        res.span = per.range ? (en - st + 1) : 1;
        if (per.range && per.end > UI_PERIODS()) res.notes.push('一天只有 ' + UI_PERIODS() + ' 节，连堂已按到最后一节为止算。');
      } else {
        res.missing.push('第几节');
      }
      /* 说「明天加课」时，帮他把日期翻成星期几，免得对着课表发懵 */
      if (res.dateLabel && !/周|星期|礼拜/.test(res.dateLabel)) {
        res.notes.push('「' + res.dateLabel + '」对应的是周' + ['一', '二', '三', '四', '五', '六', '日'][res.day - 1] + '，课表就排在这天。');
      }
      if (!res.room) res.missing.push('教室');
    } else if (res.kind === 'homework') {
      res.title = cleanTitle(sc.rest(), 'homework') || '作业';
      res.course = guessCourse(text, courses) || '其他';
      var dueMin = isFinite(startMin) ? startMin : 23 * 60 + 59;
      res.due = res.date + 'T' + toHM(dueMin);
      res.hours = dur ? Math.max(0.5, Math.round(dur / 30) / 2) : 1;
      if (!hasDate && !isFinite(startMin)) res.notes.push('没写截止时间，先按今天 23:59 放着，记得改成真的。');
      else if (!isFinite(startMin)) res.notes.push('只说了哪天交，先按当天 23:59 算。');
      if (res.course === '其他' && (courses || []).length) res.notes.push('没认出是哪门课的作业，可以在下面选一门。');
    } else {
      res.title = cleanTitle(sc.rest(), 'plan');
      res.type = typeOf(text);
      if (!res.title) res.missing.push('做什么');
      if (!isFinite(startMin)) {
        res.missing.push('几点开始');
      } else {
        res.start = toHM(startMin);
        if (isFinite(endMin) && endMin > startMin) res.end = toHM(endMin);
        else if (isFinite(endMin) && endMin <= startMin) {
          res.end = toHM(startMin + 60);
          res.notes.push('结束时间比开始还早，先按 1 小时算，可以改。');
        } else if (dur) {
          res.end = toHM(startMin + dur);
        } else {
          res.end = toHM(startMin + 60);
          res.notes.push('没说做多久，先按 1 小时算，可以改。');
        }
      }
      if (!res.place) res.place = '';
    }
    return res;
  }

  /* 一节课最多到第几节（跟着 ui.js 的作息表走，避免这里写死） */
  function UI_PERIODS() {
    try { return UI.BELLS.length; } catch (e) { return 13; }
  }

  function parseAll(text, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var courses = opts.courses || [];
    return String(text || '')
      .split(/[；;\n]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .slice(0, 5)
      .map(function (s) { return parseOne(s, now, courses); });
  }
  function parse(text, opts) { var a = parseAll(text, opts); return a[0] || { ok: false, reason: '空' }; }

  /* ==========================================================
     UI：首页卡片
     ========================================================== */
  var SAMPLES = [
    '明晚 7 点 图书馆自习 2 小时',
    '高数作业 周五 23:59 交',
    '周六 第 3-4 节 加课 体育 体育馆',
    '明天上午请病假，因为发烧要去校医院',
    '后天下午 3 点 和室友打羽毛球 1.5 小时'
  ];
  var KIND = {
    plan: { t: '课外计划', ico: '🧭', where: 'plan.html', wt: '规划页' },
    homework: { t: '作业 DDL', ico: '📝', where: 'homework.html', wt: '作业页' },
    course: { t: '课表补充', ico: '📅', where: 'schedule.html', wt: '课表页' },
    leave: { t: '请假条', ico: '📋', where: '', wt: '' }
  };
  var state = { text: '', items: [], done: '', err: '' };

  function esc(s) { return UI.esc(s); }
  function courseNames() {
    try { return (Store.load().courses || []).map(function (c) { return c.name; }); } catch (e) { return []; }
  }

  function dayOpts(cur) {
    var names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    return names.map(function (n, i) {
      return '<option value="' + (i + 1) + '"' + ((i + 1) === cur ? ' selected' : '') + '>' + n + '</option>';
    }).join('');
  }
  function periodOpts(cur) {
    var out = '';
    for (var n = 1; n <= UI.BELLS.length; n++) {
      out += '<option value="' + n + '"' + (n === cur ? ' selected' : '') + '>第 ' + n + ' 节 · ' + UI.BELLS[n - 1] + '</option>';
    }
    return out;
  }
  function spanOpts(cur) {
    var out = '';
    /* 上界跟着作息表走：解析出来是「连上 13 节」时也必须能在下拉里选中，
       否则浏览器会自动退回第一项，等于偷偷改掉了用户的时间。 */
    for (var s = 1; s <= UI.BELLS.length; s++) {
      out += '<option value="' + s + '"' + (s === cur ? ' selected' : '') + '>连上 ' + s + ' 节</option>';
    }
    return out;
  }
  function courseOpts(cur) {
    var names = [];
    (Store.load().courses || []).forEach(function (c) { if (names.indexOf(c.name) < 0) names.push(c.name); });
    if (cur && names.indexOf(cur) < 0) names.unshift(cur);
    if (names.indexOf('其他') < 0) names.push('其他');
    return names.map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }
  /* 请假条：课程可以不指定；选了就把「补课承诺」写进正文。
     没认出课程时第一项「（不指定）」自然选中，认出了 courseOpts 会标选中 */
  function leaveCourseOpts(cur) {
    return '<option value="">（不指定课程）</option>' + courseOpts(cur || '');
  }
  function slotOpts(cur) {
    var fixed = ['全天', '上午', '下午', '晚上'];
    var opts = fixed.map(function (s) {
      return '<option value="' + s + '"' + (s === cur ? ' selected' : '') + '>' + s + '</option>';
    });
    /* 「第 3-4 节」这种是解析出来的原值，不在固定档里就补一个选项，别静默退回「全天」 */
    if (cur && fixed.indexOf(cur) < 0) {
      opts.unshift('<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>');
    }
    return opts.join('');
  }
  function typeChips(cur) {
    return ['学习', '运动', '社团', '生活', '社交', '其他'].map(function (t) {
      return '<span class="chip' + (t === cur ? ' on' : '') + '" data-nl-type="' + t + '">' + t + '</span>';
    }).join('');
  }
  function levelChips(cur, i) {
    return [1, 2, 3].map(function (l) {
      return '<span class="chip lv' + l + (l === cur ? ' on' : '') + '" data-nl-level="' + l + '" data-nl-of="' + i + '">' +
        UI.LEVELS[l].t + '</span>';
    }).join('');
  }

  function fieldsHtml(it, i) {
    if (it.kind === 'leave') {
      var L = it.leave || {};
      return '<div class="field"><label>假别</label><select class="select" id="nlV' + i + '">' +
          ['病假', '事假', '公假'].map(function (t) {
            return '<option value="' + t + '"' + (t === L.type ? ' selected' : '') + '>' + t + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field"><label>收信老师</label><input class="input" id="nlQ' + i + '" placeholder="如：高等数学 王老师" value="' + esc(L.teacher || '') + '"></div>' +
        '<div class="field"><label>开始日期</label><input class="input" type="date" id="nlD' + i + '" value="' + esc(L.start) + '"></div>' +
        '<div class="field"><label>时段</label><select class="select" id="nlK' + i + '">' + slotOpts(L.slot) + '</select></div>' +
        '<div class="field"><label>天数</label><input class="input" type="number" id="nlN' + i + '" min="0.5" max="30" step="0.5" value="' + esc(L.days) + '"></div>' +
        '<div class="field nl-wide"><label>相关课程（选了会把补课承诺写进正文）</label><select class="select" id="nlC' + i + '">' + leaveCourseOpts(L.course) + '</select></div>' +
        '<div class="field nl-wide"><label>请假理由</label><textarea class="input" id="nlR' + i + '" rows="3">' + esc(L.reason || '') + '</textarea></div>';
    }
    if (it.kind === 'homework') {
      return '<div class="field nl-wide"><label>作业名称</label><input class="input" id="nlT' + i + '" value="' + esc(it.title) + '"></div>' +
        '<div class="field"><label>所属课程</label><select class="select" id="nlC' + i + '">' + courseOpts(it.course) + '</select></div>' +
        '<div class="field"><label>截止时间</label><input class="input" type="datetime-local" id="nlU' + i + '" value="' + esc(it.due) + '"></div>' +
        '<div class="field"><label>预计耗时（小时）</label><input class="input" type="number" step="0.5" min="0.5" id="nlH' + i + '" value="' + esc(it.hours) + '"></div>' +
        '<div class="field"><label>重要度</label><div class="chips level-pick" id="nlL' + i + '">' + levelChips(it.level, i) + '</div></div>';
    }
    if (it.kind === 'course') {
      return '<div class="field nl-wide"><label>课程名</label><input class="input" id="nlT' + i + '" value="' + esc(it.name || it.title) + '"></div>' +
        '<div class="field"><label>星期</label><select class="select" id="nlW' + i + '">' + dayOpts(it.day) + '</select></div>' +
        '<div class="field"><label>开始节次</label><select class="select" id="nlR' + i + '">' + periodOpts(it.period) + '</select></div>' +
        '<div class="field"><label>连堂</label><select class="select" id="nlN' + i + '">' + spanOpts(it.span) + '</select></div>' +
        '<div class="field"><label>教室</label><input class="input" id="nlP' + i + '" value="' + esc(it.room) + '"></div>' +
        '<div class="field"><label>任课教师</label><input class="input" id="nlQ' + i + '" value="' + esc(it.teacher) + '"></div>';
    }
    return '<div class="field nl-wide"><label>做什么</label><input class="input" id="nlT' + i + '" value="' + esc(it.title) + '"></div>' +
      '<div class="field"><label>日期</label><input class="input" type="date" id="nlD' + i + '" value="' + esc(it.date) + '"></div>' +
      '<div class="field"><label>开始时间</label><input class="input" type="time" id="nlS' + i + '" value="' + esc(it.start) + '"></div>' +
      '<div class="field"><label>结束时间</label><input class="input" type="time" id="nlE' + i + '" value="' + esc(it.end) + '"></div>' +
      '<div class="field"><label>地点</label><input class="input" id="nlP' + i + '" value="' + esc(it.place) + '"></div>' +
      '<div class="field"><label>类型</label><div class="chips" id="nlY' + i + '">' + typeChips(it.type) + '</div></div>' +
      '<div class="field"><label>重要度</label><div class="chips level-pick" id="nlL' + i + '">' + levelChips(it.level, i) + '</div></div>';
  }

  function itemHtml(it, i) {
    var k = KIND[it.kind] || KIND.plan;
    /* 请假条不走「去 XX 页手填」，它是就地生成 + 复制 */
    var headLink = it.kind === 'leave' ? '' :
      '<a class="link" href="' + k.where + '">去' + k.wt + '手填 →</a>';
    var miss = it.missing.length
      ? '<div class="tip warn"><div class="ti">📎</div><div class="tb"><b>还需要确认：' + esc(it.missing.join('、')) + '</b>' +
        '<small>这些信息还无法确定，补充后即可添加。</small></div></div>'
      : '';
    var notes = (it.notes || []).map(function (n) { return '<div class="nl-note">· ' + esc(n) + '</div>'; }).join('');
    var actions = it.kind === 'leave'
      ? '<button class="btn btn-primary" data-nl-gen="' + i + '">📋 生成请假条</button>' +
        '<button class="btn" data-nl-drop="' + i + '">不要这条</button>'
      : '<button class="btn btn-primary" data-nl-add="' + i + '">✓ 确认添加</button>' +
        '<button class="btn" data-nl-drop="' + i + '">不要这条</button>';
    return '<div class="nl-res">' +
      '<div class="nl-res-head"><span class="badge badge-blue">' + k.ico + ' ' + k.t + '</span>' +
        '<span class="nl-t">我理解为</span>' + headLink + '</div>' +
      miss +
      '<div class="nl-grid">' + fieldsHtml(it, i) + '</div>' + notes +
      '<div id="nlNote' + i + '"></div>' +
      '<div class="row" style="margin-top:12px">' + actions + '</div>' +
    '</div>';
  }

  function outHtml() {
    var h = '';
    if (state.err) {
      h += '<div class="tip err"><div class="ti">🤔</div><div class="tb"><b>' + esc(state.err) + '</b>' +
        '<small>我只会看时间（明天 / 周五 / 7 点 / 2 小时）、地点（图书馆 / 计算机楼-412）、' +
        '还有「作业」「加课」这类词。写清楚点再试一次，或者上面点「去XX页手填」。</small></div></div>';
    }
    if (state.done) {
      h += '<div class="nl-done"><span class="ni">✅</span><div><b>' + esc(state.done) + '</b>' +
        '<small>已经写进本机数据了，去对应页面就能看到。</small></div></div>';
    }
    state.items.forEach(function (it, i) { h += itemHtml(it, i); });
    if (state.items.length > 1) {
      h += '<div class="row" style="margin-top:10px"><button class="btn btn-ghost" data-nl-addall>✓ 全部添加（' +
        state.items.length + ' 条）</button></div>';
    }
    if (state.items.length) {
      h = '<div class="nl-res-head"><span class="nl-t">' + state.items.length + ' 条，也扫一眼对不对：</span>' +
        '<div class="spacer"></div><button class="btn btn-sm" data-nl-clear>清空</button></div>' + h;
    }
    return h;
  }

  function boxHtml() {
    var eg = SAMPLES.map(function (s) {
      return '<span class="chip" data-nl-eg="' + esc(s) + '">' + esc(s) + '</span>';
    }).join('');
    return '<div class="card nl-card" id="nlCard">' +
      '<div class="sec-title" style="margin-top:0"><span class="bar"></span>一句话记下来' +
        '<span class="nl-model">' + (location.protocol === 'file:' ? '离线规则识别' : 'DeepSeek Flash') + '</span></div>' +
      '<div class="nl-input">' +
        '<span class="nl-ico">✨</span>' +
        '<input class="input" id="nlText" autocomplete="off" placeholder="课外计划 / 作业 DDL / 课表补充 / 请假条，一句话说清楚就行" value="' + esc(state.text) + '">' +
        '<button class="btn btn-primary" id="nlGo">记下来</button>' +
      '</div>' +
      '<div class="nl-eg"><span class="nl-eg-t">点一句试试：</span>' + eg + '</div>' +
      '<div id="nlOut">' + outHtml() + '</div>' +
    '</div>';
  }

  /* ---------- 写库 ---------- */
  function chipVal(root, id, attr) {
    var box = UI.qs('#' + id, root);
    var on = box ? UI.qs('.chip.on', box) : null;
    return on ? on.getAttribute(attr) : '';
  }

  function commit(i, root) {
    var it = state.items[i];
    if (!it) return '';
    var db = Store.load();
    var tEl = UI.qs('#nlT' + i, root);
    var title = tEl ? tEl.value.trim() : '';

    if (it.kind === 'homework') {
      if (!title) { UI.toast('作业名称不能空着', 'err'); return ''; }
      var dueEl = UI.qs('#nlU' + i, root);
      var due = dueEl ? dueEl.value : it.due;
      if (!due) { UI.toast('截止时间不能空着', 'err'); return ''; }
      var cEl = UI.qs('#nlC' + i, root);
      var hEl = UI.qs('#nlH' + i, root);
      if (!Array.isArray(db.homeworks)) db.homeworks = [];
      db.homeworks.push({
        id: Store.uid('h'), title: title, course: cEl ? cEl.value : '其他',
        due: due, level: parseInt(chipVal(root, 'nlL' + i, 'data-nl-level'), 10) || it.level,
        hours: Math.max(0.5, parseFloat(hEl && hEl.value) || it.hours || 1),
        note: '由首页一句话生成', status: 'todo', createdAt: Date.now()
      });
      Store.save();
      return '已加入作业清单：' + title;
    }

    if (it.kind === 'course') {
      if (!title) { UI.toast('课程名不能空着', 'err'); return ''; }
      var wEl = UI.qs('#nlW' + i, root), rEl = UI.qs('#nlR' + i, root), nEl = UI.qs('#nlN' + i, root);
      var pEl = UI.qs('#nlP' + i, root), qEl = UI.qs('#nlQ' + i, root);
      var start = parseInt(rEl && rEl.value, 10) || 1;
      var MAXP = UI_PERIODS();
      var span = Math.max(1, Math.min(MAXP - start + 1, parseInt(nEl && nEl.value, 10) || 1));
      if (!Array.isArray(db.courses)) db.courses = [];
      db.courses.push({
        id: Store.uid('c'), name: title,
        teacher: (qEl ? qEl.value.trim() : '') || '未填写',
        room: (pEl ? pEl.value.trim() : '') || '待定',
        day: parseInt(wEl && wEl.value, 10) || 1,
        start: start, span: span, from: 1, to: 16,
        color: Store.COURSE_COLORS[db.courses.length % Store.COURSE_COLORS.length]
      });
      Store.save();
      return '已补进课表：' + title + '（第 ' + start + ' 节起 ' + span + ' 节）';
    }

    if (!title) { UI.toast('「做什么」不能空着', 'err'); return ''; }
    var sEl = UI.qs('#nlS' + i, root), eEl = UI.qs('#nlE' + i, root), dEl = UI.qs('#nlD' + i, root);
    var s = sEl ? sEl.value : '', e = eEl ? eEl.value : '';
    if (s && e && UI.toMin(e) <= UI.toMin(s)) { UI.toast('结束时间要晚于开始时间', 'err'); return ''; }
    var plEl = UI.qs('#nlP' + i, root);
    if (!Array.isArray(db.plans)) db.plans = [];
    db.plans.push({
      id: Store.uid('p'), title: title,
      type: chipVal(root, 'nlY' + i, 'data-nl-type') || it.type,
      date: (dEl && dEl.value) || UI.dayKey(),
      start: s, end: e,
      place: plEl ? plEl.value.trim() : '',
      level: parseInt(chipVal(root, 'nlL' + i, 'data-nl-level'), 10) || it.level,
      repeat: s && e ? (it.repeat || 'none') : 'none',
      note: '由首页一句话生成', status: 'todo', createdAt: Date.now()
    });
    Store.save();
    return '已加入课外计划：' + title;
  }

  /* ---------- 请假条：就地生成 + 复制（不写库——请假条是发给人的，不是记进日程的） ---------- */
  function teacherOf(courseName) {
    if (!courseName) return '';
    try {
      var cs = Store.load().courses || [];
      for (var i = 0; i < cs.length; i++) if (cs[i].name === courseName) return cs[i].teacher || '';
    } catch (e) { /* 沙箱里 Store 可能没挂，留空即可 */ }
    return '';
  }

  function genLeave(i, root) {
    var it = state.items[i];
    if (!it || it.kind !== 'leave') return;
    function v(prefix) {
      var el = UI.qs('#' + prefix + i, root);
      return el ? el.value : '';
    }
    var reason = (v('nlR') || '').trim();
    var start = v('nlD');
    if (!reason) { UI.toast('请假理由不能空着', 'err'); return ''; }
    if (!start) { UI.toast('开始日期不能空着', 'err'); return ''; }
    var db = Store.load();
    var user = db.user || {};
    var L = {
      type: v('nlV') || '事假',
      teacher: v('nlQ') || teacherOf(v('nlC')),
      start: start,
      slot: v('nlK') || '全天',
      days: parseFloat(v('nlN')) || 1,
      course: v('nlC'),
      reason: reason
    };
    var note = buildLeave(L, {
      name: user.name, sid: (db.auth || {}).sid, college: user.college, major: user.major
    }, new Date());
    it.noteText = note;
    var box = UI.qs('#nlNote' + i, root);
    if (box) {
      box.innerHTML = '<pre class="nl-leave-note">' + esc(note) + '</pre>' +
        '<div class="row"><button class="btn btn-primary" data-nl-copy="' + i + '">📄 复制请假条</button>' +
        '<button class="btn" data-nl-gen="' + i + '">↻ 按上面的修改重新生成</button></div>' +
        '<div class="nl-note">复制后粘到微信 / QQ / 邮件发给老师；内容只在本机生成，不上传任何地方。</div>';
    }
    return note;
  }

  function legacyCopy(txt) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { /* 剪贴板不可用就算了，正文就在页面上，手动全选复制也行 */ }
  }

  function copyNote(i) {
    var it = state.items[i];
    var txt = it && it.noteText;
    if (!txt) return;
    function done() { UI.toast('已复制，去粘贴发给老师吧', 'ok'); }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () { legacyCopy(txt); done(); });
      } else { legacyCopy(txt); done(); }
    } catch (e) { legacyCopy(txt); done(); }
  }

  /* ---------- 事件绑定 ----------
     注意：页面每次重绘都会重建这些输入框，所以所有处理函数都现查 DOM，不缓存元素。 */
  function setup(root, refresh) {
    function paintOut() {
      var out = UI.qs('#nlOut', root);
      if (out) out.innerHTML = outHtml();
    }
    var requestVersion = 0;
    var busy = false;
    function run() {
      var box = UI.qs('#nlText', root);
      var text = (box && box.value || '').trim();
      state.done = ''; state.err = '';
      if (!text) {
        state.items = [];
        state.err = '先写一句人话，比如「明晚 7 点图书馆自习 2 小时」。';
        paintOut();
        return;
      }
      if (busy) return;
      var version = ++requestVersion;
      state.text = text;
      if (typeof fetch !== 'function' || location.protocol === 'file:') {
        state.items = parseAll(text, { courses: courseNames() }).filter(function (x) { return x.ok; });
        state.items.forEach(function (x) { x.notes.push('当前使用离线规则识别，请核对结果。'); });
        paintOut(); return;
      }
      busy = true;
      state.items = [];
      var button = UI.qs('#nlGo', root);
      if (button) { button.disabled = true; button.textContent = '正在识别…'; }
      paintOut();
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, 45000);
      var now = new Date();
      var courses = (Store.load().courses || []).slice(0, 40).map(function (c) {
        return { name:c.name, room:c.room, teacher:c.teacher, day:c.day, start:c.start, span:c.span };
      });
      fetch('/api/nl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({text:text, now:dayKey(now) + 'T' + toHM(now.getHours()*60+now.getMinutes()), courses:courses}),
        signal: controller.signal
      }).then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || '识别失败，请重试。');
          return data;
        });
      }).then(function (data) {
        if (version !== requestVersion) return;
        if (!Array.isArray(data.items) || !data.items.length) throw new Error('这句话没有识别出可添加的事项，请补充一点描述。');
        state.items = data.items;
        state.err = '';
        paintOut();
      }).catch(function (e) {
        if (version !== requestVersion) return;
        state.items = [];
        state.err = e.name === 'AbortError' ? '识别超时，请重试。' :
          (e.message === 'Failed to fetch' ? '无法连接本地识别服务，请确认预览服务已启动。' : e.message);
        paintOut();
      }).finally(function () {
        clearTimeout(timeout); busy = false;
        var button = UI.qs('#nlGo', root);
        if (button) { button.disabled = false; button.textContent = '记下来'; }
      });
    }

    function after(msg) {
      state.items = [];
      state.done = msg;
      state.text = '';
      if (typeof refresh === 'function') refresh(); else paintOut();
    }

    UI.delegate(root, 'click', '[data-nl-eg]', function (e, t) {
      var box = UI.qs('#nlText', root);
      if (box) box.value = t.getAttribute('data-nl-eg');
      run();
    });
    UI.delegate(root, 'click', '[data-nl-add]', function (e, t) {
      var msg = commit(parseInt(t.getAttribute('data-nl-add'), 10), root);
      if (msg) after(msg);
    });
    UI.delegate(root, 'click', '[data-nl-gen]', function (e, t) {
      genLeave(parseInt(t.getAttribute('data-nl-gen'), 10), root);
    });
    UI.delegate(root, 'click', '[data-nl-copy]', function (e, t) {
      copyNote(parseInt(t.getAttribute('data-nl-copy'), 10));
    });
    UI.delegate(root, 'click', '[data-nl-drop]', function (e, t) {
      state.items.splice(parseInt(t.getAttribute('data-nl-drop'), 10), 1);
      paintOut();
    });
    UI.delegate(root, 'click', '[data-nl-clear]', function () {
      requestVersion++;
      state.items = []; state.done = ''; state.err = ''; state.text = '';
      paintOut();
    });
    UI.delegate(root, 'click', '[data-nl-addall]', function () {
      var done = [], n = state.items.length;
      for (var i = n - 1; i >= 0; i--) {
        var msg = commit(i, root);
        if (!msg) return;               /* 有一条填得不完整就停下，别把剩下的漏掉 */
        state.items.splice(i, 1);
        done.unshift(msg);
      }
      after(done.length > 1 ? '已添加 ' + done.length + ' 条' : (done[0] || '已添加'));
    });
    UI.delegate(root, 'click', '[data-nl-type]', function (e, t) {
      UI.qsa('.chip', t.parentNode).forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on');
    });
    UI.delegate(root, 'click', '[data-nl-level]', function (e, t) {
      UI.qsa('.chip', t.parentNode).forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on');
    });

    var go = UI.qs('#nlGo', root);
    if (go) go.onclick = run;
    var input = UI.qs('#nlText', root);
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); run(); }
      });
    }
  }

  return {
    parse: parse, parseAll: parseAll, boxHtml: boxHtml, setup: setup, buildLeave: buildLeave,
    reset: function () { state.text = ''; state.items = []; state.done = ''; state.err = ''; },
    state: state, SAMPLES: SAMPLES
  };
})();
