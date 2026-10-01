/* ==========================================================
   当日天气 · 实时获取（多数据源 + 断网降级）
   ---------------------------------------------------------
   为什么要挂三个源 —— 因为「取不到天气」在校园里是**常态**：

     ① UAPIS（uapis.cn）· 国内服务 · 免费无需 Key · 数据最全
        实况 + 7 天预报 + 24 小时逐时 + 体感/UV/AQI，全是中文，
        正好就是我们要的东西。国内直连很快。
        代价：它只在 http(s) 页面上回 CORS 头（按 Origin 回显），
        `file://` 双击打开时浏览器发的是 `Origin: null`，它不回，
        请求会被浏览器拦掉 —— 所以这一路在 file:// 下必然失败，
        必须下面两个境外源兜着（实测：同一台机器，
        `Origin: http://localhost` 有回显，`Origin: null` 没有）。

     ② Open-Meteo（open-meteo.com）· 免费无需 Key · CORS 恒为 `*`
        也就是说 file:// 下也能用；但服务器在境外，国内直连经常超时。

     ③ wttr.in · 同上境外、CORS 也是 `*`，做最后一层兜底。

   取数策略：**①②同时发，谁先成功用谁**；只要有一个失败就立刻补上下一个
   源，不等定时器；三个全挂才回退缓存 / 显示失败卡片，并写清每个源各自
   失败的原因。卡片右上角标出真正生效的源，不假装是首选源。

   定位：温州大学茶山高教园区（27.9105N, 120.6940E）
   结果按 30 分钟缓存到 localStorage；断网时回退上一次成功的数据。

   三个坑（都踩过，测试里钉住了）：
     1) normalize 解析异常会让 Promise 直接 reject。调用方（home.js /
        plan.js）只写了 .then 没写 .catch，于是页面永远停在
        「正在获取…」的骨架态 —— 看起来就是「天气没取到」而且不报错。
        所以本模块对外承诺：load() 永不 reject，只会 resolve 一个结果。
     2) 缓存里的数据是旧格式 / 缺字段时，解析同样会抛。现在读取缓存
        会先校验，坏了就当没有，回落到走网络。
     3) 三个源的天气码表不是一套：Open-Meteo 是 WMO 码，wttr 是 WW 码
        （4677 表），UAPIS 干脆给中文文本。本项目内部统一用 WMO 码，
        另外两套都翻过来；翻译不出来返回 -1（渲染成「未知」，不瞎猜）。
   ========================================================== */
var Weather = (function () {
  var SPOT = { name: '温州 · 茶山高教园区', short: '温州', lat: 27.9105, lon: 120.6940 };
  var CACHE = 'wzu-weather-cache-v1';   /* 键名不变：老用户已缓存的天气还能接着用 */
  var TTL = 30 * 60 * 1000;

  /* 每个源各给一个超时，别让慢的那个把整张卡片拖死 */
  var T_CN = 5000;          /* UAPIS（国内，正常 200ms 内回来） */
  var T_OM = 6000;          /* Open-Meteo（境外） */
  var T_WT = 9000;          /* wttr.in（境外，本身就慢） */

  var UAPIS_API = 'https://uapis.cn/api/v1/misc/weather' +
    '?city=' + encodeURIComponent('温州') + '&extended=true&forecast=true&hourly=true';

  var OM_API = 'https://api.open-meteo.com/v1/forecast' +
    '?latitude=' + SPOT.lat + '&longitude=' + SPOT.lon +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,is_day,weather_code,wind_speed_10m' +
    '&hourly=temperature_2m,precipitation_probability,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max' +
    '&timezone=Asia%2FShanghai&forecast_days=4';

  var WT_API = 'https://wttr.in/' + SPOT.lat + ',' + SPOT.lon + '?format=j1';

  /* 顺序 = 优先级。前两个同时发，谁先成功用谁（见 load()）。 */
  var SOURCES = [
    { id: 'uapis', name: 'UAPIS', url: UAPIS_API, timeout: T_CN, shape: shapeUapis },
    { id: 'open-meteo', name: 'Open-Meteo', url: OM_API, timeout: T_OM, shape: shapeOpenMeteo },
    { id: 'wttr', name: 'wttr.in', url: WT_API, timeout: T_WT, shape: shapeWttr }
  ];
  var PRIMARY = 'uapis';
  var SRC_NAME = { 'uapis': 'UAPIS', 'open-meteo': 'Open-Meteo', 'wttr': 'wttr.in' };
  var SOURCE_URL = { 'uapis': UAPIS_API, 'open-meteo': OM_API, 'wttr': WT_API };

  /* WMO 天气代码 → [图标, 中文]（Open-Meteo 原生就是这个码表） */
  var WMO = {
    0: ['☀️', '晴'], 1: ['🌤️', '晴间少云'], 2: ['⛅', '多云'], 3: ['☁️', '阴'],
    45: ['🌫️', '有雾'], 48: ['🌫️', '雾凇'],
    51: ['🌦️', '小毛毛雨'], 53: ['🌦️', '毛毛雨'], 55: ['🌦️', '浓毛毛雨'],
    56: ['🌧️', '冻毛毛雨'], 57: ['🌧️', '强冻毛毛雨'],
    61: ['🌦️', '小雨'], 63: ['🌧️', '中雨'], 65: ['🌧️', '大雨'],
    66: ['🌧️', '冻雨'], 67: ['🌧️', '强冻雨'],
    71: ['🌨️', '小雪'], 73: ['🌨️', '中雪'], 75: ['❄️', '大雪'], 77: ['🌨️', '米雪'],
    80: ['🌦️', '阵雨'], 81: ['🌧️', '强阵雨'], 82: ['⛈️', '暴雨'],
    85: ['🌨️', '阵雪'], 86: ['❄️', '强阵雪'],
    95: ['⛈️', '雷阵雨'], 96: ['⛈️', '雷阵雨伴冰雹'], 99: ['⛈️', '强雷暴伴冰雹']
  };

  /* wttr.in 用的是世界气象组织 WW 码（4677 码表），跟 WMO 码不是一套，
     得先翻译过去，才能复用上面这张图标表。 */
  var WW = {
    113: 0, 116: 2, 119: 3, 122: 3,
    143: 45, 248: 45, 260: 48,
    176: 80, 263: 51, 266: 53, 281: 56, 284: 57,
    293: 61, 296: 61, 299: 63, 302: 63, 305: 65, 308: 65,
    311: 66, 314: 67, 317: 71, 320: 73,
    323: 71, 326: 71, 329: 73, 332: 73, 335: 75, 338: 75, 350: 77,
    353: 80, 356: 81, 359: 82,
    362: 85, 365: 86, 368: 85, 371: 86, 374: 77, 377: 77,
    386: 95, 389: 95, 392: 95, 395: 95
  };

  function codeInfo(code) { return WMO[code] || ['🌡️', '未知']; }
  function isRainy(code) {
    return [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].indexOf(code) >= 0;
  }
  function isSnowy(code) { return [71, 73, 75, 77, 85, 86].indexOf(code) >= 0; }
  function isThunder(code) { return code >= 95; }

  /* wttr 的 WW 码 → WMO 码；认不出来返回 -1（渲染成「未知」，不假装知道） */
  function wwToWmo(c) {
    var n = parseInt(c, 10);
    return WW[n] === undefined ? -1 : WW[n];
  }

  /* 中文天气文本 → WMO 码。
     UAPIS 返回的是「天气现象文本」（晴 / 多云 / 雷阵雨…）而不是码表，
     但「带不带伞、要不要防雷、能不能骑车」全靠 WMO 码判断，所以翻一道。
     顺序有讲究：雷 → 雨夹雪 → 暴雨/大雨/中雨 → 阵雨 → 小雨 → 雪 → 雾霾。
     （「雨夹雪」里既有雨也有雪，必须先判；「雷阵雨」必须先命中 /雷/。） */
  function textToWmo(s) {
    var t = String(s || '');
    if (!t) return -1;
    if (/雷/.test(t)) return /冰雹/.test(t) ? 96 : 95;
    if (/雨夹雪|雨雪/.test(t)) return 77;
    if (/冻雨/.test(t)) return 66;
    if (/暴雨/.test(t)) return 82;
    if (/大雨/.test(t)) return 65;
    if (/中雨/.test(t)) return 63;
    if (/阵雨/.test(t)) return /强/.test(t) ? 81 : 80;
    if (/小雨|毛毛雨|细雨|降雨/.test(t)) return 61;
    if (/大雪|暴雪/.test(t)) return 75;
    if (/中雪/.test(t)) return 73;
    if (/阵雪/.test(t)) return 85;
    if (/雪/.test(t)) return 71;
    if (/雾|霾|浮尘|扬沙|沙尘/.test(t)) return 45;
    if (/阴/.test(t)) return 3;
    if (/多云|少云/.test(t)) return 2;
    if (/晴/.test(t)) return 0;
    return -1;
  }

  /* 「3级」/「微风」这种风力描述 → 大致风速 km/h。
     UAPIS 的实况里只有风力等级（`wind_power`），卡片却要显示 km/h，
     所以给一张对照表；逐时数据里带 wind_speed 时优先用它。 */
  var WIND_KMH = [0, 4, 9, 15, 24, 34, 44, 55, 66, 78];
  function windKmph(power) {
    var s = String(power || '');
    if (/微风/.test(s)) return 8;
    if (/无风/.test(s)) return 0;
    var m = /(\d{1,2})/.exec(s);
    if (!m) return 0;
    var n = parseInt(m[1], 10);
    return WIND_KMH[n] === undefined ? n * 6 : WIND_KMH[n];
  }

  /* ---------- 小工具 ---------- */
  function num(x) { var n = parseFloat(x); return isNaN(n) ? 0 : n; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function toMin(hm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1;
  }
  function pop100(x) {
    var n = parseFloat(x);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  /* "12:45 PM" / "2026-09-22 12:45 PM" → "12:45" */
  function parseObsHm(s) {
    var t = String(s || '');
    var m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(t);
    if (m) {
      var h = parseInt(m[1], 10) % 12;
      if (/PM/i.test(m[3])) h += 12;
      return pad2(h) + ':' + m[2];
    }
    var m2 = /(\d{1,2}):(\d{2})/.exec(t);
    return m2 ? pad2(parseInt(m2[1], 10)) + ':' + m[2] : '';
  }

  /* wttr.in 的 j1 里只有 observation_time，而且给的是 UTC（实测：本地 12:51
     它返回 "04:51 AM"）。本应用只服务温大，固定 UTC+8，直接换算成北京时间。 */
  function utcToCstHm(hm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
    if (!m) return '';
    return pad2((parseInt(m[1], 10) + 8) % 24) + ':' + m[2];
  }

  /* ---------- 缓存 ---------- */
  function readCache() {
    try {
      var o = JSON.parse(localStorage.getItem(CACHE));
      /* 老格式没有 src 字段，按 Open-Meteo 处理（那时候只有这一个源） */
      if (!o || !o.raw) return null;
      return { src: o.src || 'open-meteo', raw: o.raw, at: o.at || 0 };
    } catch (e) { return null; }
  }
  function writeCache(src, raw) {
    try { localStorage.setItem(CACHE, JSON.stringify({ src: src, raw: raw, at: Date.now() })); } catch (e) {}
  }

  /* ---------- 源 ⓪：UAPIS（国内，首选） ----------
     返回长这样（实测）：
       { province, city, adcode, weather:"晴", weather_icon:"100", temperature:30,
         wind_direction:"东北风", wind_power:"3级", humidity:56, report_time:"7 分钟前发布",
         temp_max:31, temp_min:23, feels_like:33, uv:4, aqi:53, precipitation:0,
         forecast:[{date,week,temp_max,temp_min,weather_day,weather_night,wind_speed_day,
                    humidity,precip,pop,cloud,uv_index,sunrise,sunset}],
         hourly_forecast:[{time:"2026-09-22 12:55:08",temperature,weather,wind_speed,
                           humidity,feels_like,pop,...}] }
     注意两点：
       · `weather` 是中文文本，不是码表 → 用 textToWmo 翻；
       · forecast / hourly 是可选模块（文档标 Pro），万一没返回也得能画卡片，
         所以缺了就退化成「只有今天」的单日数据。 */
  function shapeUapis(raw) {
    /* 严格校验：靠这三个字段把其它源的返回挡在门外
       （比如把 Open-Meteo 的 body 喂进来，weather 是 undefined；
        把 wttr 的喂进来，weather 是个数组 —— 都会在这里抛） */
    if (!raw || typeof raw.weather !== 'string' || raw.temperature == null || !raw.city) {
      throw new Error('返回数据不完整');
    }

    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    function hmOf(t) {
      var m = /(\d{1,2}):(\d{2})/.exec(String(t || ''));
      return m ? pad2(parseInt(m[1], 10)) + ':' + m[2] : '';
    }

    /* 逐时（含第一条「实况」时间点，它的 time 就是观测时刻） */
    var all = (isArray(raw.hourly_forecast) ? raw.hourly_forecast : []).map(function (x) {
      return {
        full: String(x.time || ''),
        date: String(x.time || '').slice(0, 10),
        hm: hmOf(x.time),
        temp: Math.round(num(x.temperature)),
        pop: x.pop == null ? 0 : pop100(x.pop),
        code: textToWmo(x.weather)
      };
    }).filter(function (x) { return x.hm && x.date; });

    var fc = isArray(raw.forecast) ? raw.forecast : [];
    var todayKey = all.length ? all[0].date
      : (fc.length && fc[0].date ? String(fc[0].date) : dayKeyOf(now));
    var todayHours = all.filter(function (x) { return x.date === todayKey; });

    /* 从「现在」往后取 12 条（+90 分钟宽容：刚过整点也算现在这一档）；
       今天的时段都过完了就退到最后一条，别给出空数组 */
    var start = all.length
      ? all.indexOf(todayHours.length ? todayHours[todayHours.length - 1] : all[0])
      : 0;
    for (var k = 0; k < todayHours.length; k++) {
      if (toMin(todayHours[k].hm) + 90 > nowMin) { start = all.indexOf(todayHours[k]); break; }
    }

    var curCode = textToWmo(raw.weather);
    var curInf = codeInfo(curCode);
    var h0 = all.length ? all[0] : null;
    var hm = h0 ? h0.hm : '';
    var curWind = (raw.hourly_forecast && raw.hourly_forecast[0] &&
      raw.hourly_forecast[0].wind_speed != null)
      ? num(raw.hourly_forecast[0].wind_speed) : windKmph(raw.wind_power);
    var hourNow = hm ? parseInt(hm.slice(0, 2), 10) : now.getHours();

    var days = fc.map(function (d) {
      var code = textToWmo(d.weather_day);
      var inf = codeInfo(code);
      return {
        date: String(d.date || ''),
        ico: inf[0], text: String(d.weather_day || raw.weather), code: code,
        tmax: Math.round(num(d.temp_max)), tmin: Math.round(num(d.temp_min)),
        pop: d.pop == null ? 0 : pop100(d.pop),
        rain: Math.round(num(d.precip) * 10) / 10,
        wind: Math.round(num(d.wind_speed_day)),
        uv: d.uv_index == null ? null : Math.round(num(d.uv_index) * 10) / 10
      };
    });
    if (!days.length) {
      var one = Math.round(num(raw.temperature));
      days = [{
        date: todayKey, ico: curInf[0], text: raw.weather, code: curCode,
        tmax: raw.temp_max == null ? one : Math.round(num(raw.temp_max)),
        tmin: raw.temp_min == null ? one : Math.round(num(raw.temp_min)),
        pop: 0, rain: Math.round(num(raw.precipitation) * 10) / 10,
        wind: Math.round(curWind), uv: raw.uv == null ? null : Math.round(num(raw.uv) * 10) / 10
      }];
    }
    days = days.slice(0, 4);

    return {
      /* 用接口自己报的城市名，别硬写「茶山」——接口只到市级就显示市级 */
      spot: {
        name: String(raw.city) + (raw.district && raw.district !== raw.city ? ' · ' + raw.district : ''),
        short: SPOT.short, lat: SPOT.lat, lon: SPOT.lon
      },
      current: {
        temp: Math.round(num(raw.temperature)),
        feels: raw.feels_like == null ? Math.round(num(raw.temperature)) : Math.round(num(raw.feels_like)),
        hum: Math.round(num(raw.humidity)),
        wind: Math.round(curWind),
        precip: num(raw.precipitation),
        isDay: hourNow >= 6 && hourNow < 19,
        hm: hm,
        code: curCode, ico: curInf[0], text: raw.weather
      },
      hours: todayHours,
      next12: all.slice(start, start + 12),
      days: days,
      today: days[0]
    };
  }

  function dayKeyOf(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ---------- 源 ①：Open-Meteo（境外，CORS `*`，file:// 也能用） ---------- */
  function shapeOpenMeteo(raw) {
    var c = raw && raw.current, d = raw && raw.daily, h = raw && raw.hourly;
    if (!c || !d || !h || !isArray(d.time) || !isArray(h.time) || !d.time.length || !h.time.length) {
      throw new Error('返回数据不完整');
    }
    var todayKey = d.time[0];

    var all = [];
    for (var i = 0; i < h.time.length; i++) {
      all.push({
        full: h.time[i],
        date: h.time[i].slice(0, 10),
        hm: h.time[i].slice(11, 16),
        temp: Math.round(h.temperature_2m[i]),
        pop: h.precipitation_probability[i] == null ? 0 : h.precipitation_probability[i],
        code: h.weather_code[i]
      });
    }
    var todayHours = all.filter(function (x) { return x.date === todayKey; });

    var anchor = (c.time || '').slice(0, 13) + ':00';
    var start = 0;
    for (var j = 0; j < all.length; j++) { if (all[j].full === anchor) { start = j; break; } }
    var next12 = all.slice(start, start + 12);

    var days = d.time.map(function (t, k) {
      var inf = codeInfo(d.weather_code[k]);
      return {
        date: t,
        ico: inf[0], text: inf[1], code: d.weather_code[k],
        tmax: Math.round(d.temperature_2m_max[k]),
        tmin: Math.round(d.temperature_2m_min[k]),
        pop: d.precipitation_probability_max[k] == null ? 0 : d.precipitation_probability_max[k],
        rain: d.precipitation_sum[k] == null ? 0 : Math.round(d.precipitation_sum[k] * 10) / 10,
        wind: Math.round(d.wind_speed_10m_max[k] || 0),
        uv: d.uv_index_max ? Math.round(d.uv_index_max[k] * 10) / 10 : null
      };
    });

    var cur = codeInfo(c.weather_code);
    return {
      spot: SPOT,
      current: {
        temp: Math.round(num(c.temperature_2m)),
        feels: Math.round(num(c.apparent_temperature)),
        hum: c.relative_humidity_2m,
        wind: c.wind_speed_10m,
        precip: c.precipitation,
        isDay: c.is_day === 1,
        hm: (c.time || '').slice(11, 16),
        code: c.weather_code,
        ico: cur[0], text: cur[1]
      },
      hours: todayHours,
      next12: next12,
      days: days,
      today: days[0]
    };
  }

  /* ---------- 源 ②：wttr.in ---------- */
  function shapeWttr(raw) {
    var cc = raw && raw.current_condition && raw.current_condition[0];
    var wdays = raw && raw.weather;
    if (!cc || !isArray(wdays) || !wdays.length) throw new Error('返回数据不完整');

    /* 有 localObsDateTime 就用它（本身就是当地时间）；没有就把 UTC 换算到北京时间 */
    var localHm = parseObsHm(cc.localObsDateTime);
    var hm = localHm || utcToCstHm(parseObsHm(cc.observation_time));
    var hour = hm ? parseInt(hm.slice(0, 2), 10) : new Date().getHours();
    var todayKey = wdays[0].date;

    /* wttr 只给 3 小时一档，所以「逐小时」是 3 小时粒度 —— 卡片照样能画，
       只是时间轴间距不一样，别假装是每小时。 */
    var all = [];
    wdays.forEach(function (day) {
      (day.hourly || []).forEach(function (x) {
        var t = String(x.time);
        while (t.length < 4) t = '0' + t;
        var hh = t.slice(0, 2) + ':' + t.slice(2, 4);
        all.push({
          full: day.date + 'T' + hh, date: day.date, hm: hh,
          temp: Math.round(num(x.tempC)),
          pop: pop100(x.chanceofrain),
          code: wwToWmo(x.weatherCode)
        });
      });
    });
    if (!all.length) throw new Error('逐时数据为空');

    var todayHours = all.filter(function (x) { return x.date === todayKey; });

    /* 找「现在所在的这一档」：往后推 90 分钟以内算现在 */
    var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    var start = -1, k;
    for (k = 0; k < all.length; k++) {
      if (all[k].date !== todayKey) continue;
      if (toMin(all[k].hm) + 90 > nowMin) { start = k; break; }
    }
    if (start < 0) for (k = 0; k < all.length; k++) { if (all[k].date > todayKey) { start = k; break; } }
    if (start < 0) start = Math.max(0, all.length - 1);

    var days = wdays.slice(0, 4).map(function (day) {
      var hs = day.hourly || [];
      var noon = null;
      hs.forEach(function (x) {
        var t = String(x.time); while (t.length < 4) t = '0' + t;
        if (t.slice(0, 2) === '12') noon = x;
      });
      var rep = noon || hs[0] || {};
      var code = wwToWmo(rep.weatherCode);
      if (code < 0) code = modeCode(hs.map(function (x) { return wwToWmo(x.weatherCode); }));

      var pop = 0, rain = 0, wind = 0;
      hs.forEach(function (x) {
        pop = Math.max(pop, pop100(x.chanceofrain));
        rain += num(x.precipMM);
        wind = Math.max(wind, num(x.windspeedKmph));
      });
      var inf = codeInfo(code);
      return {
        date: day.date, ico: inf[0], text: inf[1], code: code,
        tmax: Math.round(num(day.maxtempC)), tmin: Math.round(num(day.mintempC)),
        pop: pop, rain: Math.round(rain * 10) / 10, wind: Math.round(wind),
        uv: day.uvIndex == null ? null : Math.round(num(day.uvIndex) * 10) / 10
      };
    });

    var cCode = wwToWmo(cc.weatherCode);
    var cur = codeInfo(cCode);
    return {
      spot: SPOT,
      current: {
        temp: Math.round(num(cc.temp_C)),
        feels: Math.round(num(cc.FeelsLikeC != null ? cc.FeelsLikeC : cc.temp_C)),
        hum: Math.round(num(cc.humidity)),
        wind: num(cc.windspeedKmph),
        precip: num(cc.precipMM),
        isDay: hour >= 6 && hour < 19,
        hm: hm,
        code: cCode,
        ico: cur[0], text: cur[1]
      },
      hours: todayHours,
      next12: all.slice(start, start + 12),
      days: days,
      today: days[0]
    };
  }

  /* 一天里出现最多的天气码；同样多时取「更坏」的那个（宁可多提醒带伞） */
  function modeCode(list) {
    var cnt = {}, best = -1, bestN = 0;
    list.forEach(function (c) {
      if (c < 0) return;
      cnt[c] = (cnt[c] || 0) + 1;
      if (cnt[c] > bestN || (cnt[c] === bestN && c > best)) { best = c; bestN = cnt[c]; }
    });
    return best;
  }

  function isArray(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  /* ---------- 统一组装 ---------- */
  function defOf(src) {
    for (var i = 0; i < SOURCES.length; i++) { if (SOURCES[i].id === src) return SOURCES[i]; }
    return null;
  }
  function build(src, raw) {
    var def = defOf(src);
    if (!def) throw new Error('未知数据源 ' + src);
    var w = def.shape(raw);
    w.src = src;
    w.srcName = def.name;
    w.spot = w.spot || SPOT;
    w.advice = advise(w);
    return w;
  }
  /* 解析失败返回 null，绝不让异常冒出去 */
  function tryBuild(src, raw) {
    try {
      var w = build(src, raw);
      return (w && w.current && w.today) ? w : null;
    } catch (e) { return null; }
  }
  function finish(w, fromCache, note) {
    w.ok = true; w.fromCache = !!fromCache; w.note = note || ''; w.at = Date.now();
    return w;
  }

  /* 获取失败时的兜底：页面能正常渲染，但明确标注「未取到实时数据」 */
  function failed(note) {
    return {
      ok: false, fromCache: false, note: note || '未知错误', at: Date.now(), spot: SPOT,
      src: '', srcName: '',
      current: { temp: null, feels: null, hum: null, wind: null, precip: 0, isDay: true, hm: '', code: -1, ico: '📡', text: '未取到' },
      hours: [], next12: [], days: [],
      today: { date: '', ico: '📡', text: '未取到', code: -1, tmax: null, tmin: null, pop: 0, rain: 0, wind: 0, uv: null },
      advice: { items: [{ ico: '📡', tone: 'err', title: '天气没取到', text: '请检查网络后点「重新获取」；不影响作业与计划的规划结果。' }], umbrella: false, outdoor: true, commute: '' }
    };
  }

  /* ---------- 出行与生活建议 ---------- */
  function advise(w) {
    var t = w.today, c = w.current, out = [];
    var rainy = isRainy(t.code) || t.pop >= 55 || t.rain >= 1;
    var thunder = isThunder(t.code) || isThunder(c.code);
    var diff = t.tmax - t.tmin;

    /* 1) 要不要带伞 */
    if (rainy) {
      out.push({
        ico: '☔', tone: 'warn', title: '今天要带伞',
        text: '降水概率 ' + t.pop + '%，' + t.text + (thunder ? '，可能打雷' : '') + '，书包里塞把折叠伞。'
      });
    } else if (t.pop >= 30) {
      out.push({ ico: '🌂', tone: 'tip', title: '带把轻便伞更稳', text: '降水概率 ' + t.pop + '%，大概率不下，但有备无患。' });
    } else {
      out.push({ ico: '🕶️', tone: 'ok', title: '不用带伞', text: '降水概率 ' + t.pop + '%，今天可以轻装出门。' });
    }

    /* 2) 穿衣 */
    if (t.tmax >= 33) {
      out.push({ ico: '🥵', tone: 'warn', title: '注意防暑降温', text: '最高 ' + t.tmax + '°C，体感 ' + c.feels + '°C，中午别在户外久待，随身带水。' });
    } else if (t.tmin <= 12) {
      out.push({ ico: '🧥', tone: 'warn', title: '要加件外套', text: '最低只有 ' + t.tmin + '°C，早晚凉，出门多穿一件。' });
    } else if (diff >= 9) {
      out.push({ ico: '🧥', tone: 'tip', title: '早晚温差 ' + diff + '°C', text: t.tmin + '°C ~ ' + t.tmax + '°C，建议「薄外套 + 短袖」，中午好脱。' });
    } else {
      out.push({ ico: '👕', tone: 'ok', title: '穿衣很省心', text: t.tmin + '°C ~ ' + t.tmax + '°C，温差不大，正常穿就好。' });
    }

    /* 3) 通勤方式 */
    var commute;
    if (thunder || t.wind >= 38) {
      commute = { ico: '🚌', tone: 'warn', title: thunder ? '雷雨天别骑车' : '风力偏大', text: '建议坐校车或公交，路面情况不好时也别走远路。' };
    } else if (rainy) {
      commute = { ico: '🚶', tone: 'tip', title: '减少骑行', text: '路面湿滑，短距离走路，远一点就坐校车，记得早出门 10 分钟。' };
    } else if (t.tmax >= 33) {
      commute = { ico: '🚲', tone: 'tip', title: '避开正午出门', text: '骑车注意防晒，尽量挑有树荫的路线。' };
    } else {
      commute = { ico: '🚲', tone: 'ok', title: '骑车刚刚好', text: '湿度 ' + c.hum + '%、风 ' + c.wind + ' km/h，骑车上课很舒服。' };
    }
    out.push(commute);

    /* 4) 运动建议 */
    if (thunder || rainy || t.wind >= 38) {
      out.push({ ico: '🏸', tone: 'tip', title: '运动改到室内', text: '今天户外条件一般，去体育馆打球、健身房或者宿舍拉伸都行。' });
    } else if (t.tmax >= 33) {
      out.push({ ico: '🏊', tone: 'tip', title: '运动挑时段', text: '建议早上 7 点前或晚上 7 点后，别在正午太阳下跑步。' });
    } else {
      out.push({ ico: '🏃', tone: 'ok', title: '适合户外运动', text: '体感 ' + c.feels + '°C，傍晚去操场跑几圈正合适。' });
    }

    return {
      items: out,
      umbrella: rainy,
      outdoor: !(thunder || rainy || t.wind >= 38),
      commute: commute.title,
      brief: t.ico + ' ' + t.text + ' ' + c.temp + '°C'
    };
  }

  /* ---------- 对外：拉取天气 ----------
     承诺：永远 resolve，永远不 reject。 */
  function load(force) {
    return new Promise(function (resolve) {
      var cached = readCache();

      /* 缓存还新鲜：直接用，不发请求 */
      if (!force && cached && Date.now() - cached.at < TTL) {
        var w0 = tryBuild(cached.src, cached.raw);
        if (w0) { resolve(finish(w0, true, '')); return; }
      }

      var settled = false;
      var timers = [];
      var errs = [];
      var pending = 0;      /* 在飞的请求数 */
      var nextIdx = 0;      /* 下一个还没发出的源 */

      function clearAll() {
        timers.forEach(function (t) { clearTimeout(t); });
        timers = [];
      }
      function settle(w) {
        if (settled) return;
        settled = true;
        clearAll();
        resolve(w);
      }

      /* 所有源都失败：有缓存就回退缓存（不管多旧，总比没有强） */
      function bail() {
        if (cached) {
          var w1 = tryBuild(cached.src, cached.raw);
          if (w1) { settle(finish(w1, true, '取不到最新天气，显示上次结果')); return; }
        }
        settle(failed(errs.join('；') || '网络异常'));
      }
      function maybeBail() {
        if (!settled && nextIdx >= SOURCES.length && pending === 0) bail();
      }
      function startNext() {
        if (settled || nextIdx >= SOURCES.length) return;
        attempt(SOURCES[nextIdx++]);
      }

      function attempt(def) {
        var done = false;
        pending++;
        var timer = setTimeout(function () { fail('请求超时'); }, def.timeout);
        timers.push(timer);

        function fail(msg) {
          if (done || settled) return;
          done = true;
          clearTimeout(timer);
          pending--;
          errs.push(def.name + ' ' + msg);
          /* 别干等超时：一个源一失败，立刻把下一个源也发出去 */
          startNext();
          maybeBail();
        }

        function pass(raw) {
          if (done || settled) return;
          var w = tryBuild(def.id, raw);
          if (!w) { fail('返回数据无法解析'); return; }
          done = true;
          clearTimeout(timer);
          pending--;
          writeCache(def.id, raw);
          settle(finish(w, false, ''));
        }

        var p;
        try {
          p = fetch(def.url, { cache: 'no-store', mode: 'cors' });
        } catch (e) {
          fail((e && e.message) ? e.message : '无法发起请求');
          return;
        }
        if (!p || typeof p.then !== 'function') { fail('当前环境不支持网络请求'); return; }

        p.then(function (r) {
          if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
          return r.json();
        }).then(pass, function (err) {
          fail((err && err.message) ? err.message : '请求失败');
        });
      }

      /* 前两个源同时发（国内源图快、境外源保 file:// 也能用），谁先成功用谁；
         第三个留给失败时补位。 */
      startNext();
      startNext();
    });
  }

  /* ---------- 视图片段：天气卡片 + 出行建议 ---------- */
  function dayLabel(dateStr, i) {
    if (i === 0) return '今天';
    if (i === 1) return '明天';
    if (i === 2) return '后天';
    var d = new Date(dateStr + 'T00:00:00');
    return '周' + '日一二三四五六'.charAt(d.getDay());
  }

  function card(w) {
    if (!w.ok) {
      return '<div class="wx-card err">' +
        '<div class="wx-top"><div class="wx-now"><div class="wx-ico">📡</div>' +
          '<div><div class="wx-temp">—</div><div class="wx-desc">天气数据未取到</div></div></div>' +
          '<button class="btn btn-sm wx-refresh" id="wxRefresh">🔄 重新获取</button></div>' +
        '<div class="wx-note">原因：' + esc(w.note) + '。作业与今日规划不受影响，仍可正常使用。</div>' +
        '</div>';
    }
    var c = w.current, t = w.today;
    var hrs = w.next12 || [], dayList = w.days || [];

    /* 逐时（源不给逐时数据时整段不画，不留一条空条） */
    var strip = hrs.map(function (h, i) {
      var inf = codeInfo(h.code);
      return '<div class="wx-h' + (i === 0 ? ' now' : '') + '">' +
        '<div class="h">' + (i === 0 ? '现在' : String(h.hm).slice(0, 2) + '时') + '</div>' +
        '<div class="i">' + inf[0] + '</div>' +
        '<div class="t">' + h.temp + '°</div>' +
        '<div class="p"><span style="height:' + Math.max(6, h.pop) + '%"></span></div>' +
        '<div class="pp">' + h.pop + '%</div>' +
      '</div>';
    }).join('');

    /* 未来几天 */
    var days = dayList.map(function (d, i) {
      return '<div class="wx-d">' +
        '<div class="dl">' + dayLabel(d.date, i) + '</div>' +
        '<div class="di">' + d.ico + '</div>' +
        '<div class="dt">' + d.tmax + '°<small>/' + d.tmin + '°</small></div>' +
        '<div class="dp">💧' + d.pop + '%</div>' +
      '</div>';
    }).join('');

    return '<div class="wx-card">' +
      '<div class="wx-top">' +
        '<div class="wx-now">' +
          '<div class="wx-ico">' + c.ico + '</div>' +
          '<div>' +
            '<div class="wx-temp">' + c.temp + '<span>°C</span></div>' +
            '<div class="wx-desc">' + c.text + ' · 体感 ' + c.feels + '°C</div>' +
          '</div>' +
        '</div>' +
        '<div class="wx-meta">' +
          '<span>💧 湿度 ' + c.hum + '%</span>' +
          '<span>🌬 ' + c.wind + ' km/h</span>' +
          '<span>🌡 ' + t.tmin + '~' + t.tmax + '°C</span>' +
          (t.uv != null ? '<span>☀️ UV ' + t.uv + '</span>' : '') +
        '</div>' +
        '<div class="wx-right">' +
          '<div class="wx-spot">📍 ' + esc(w.spot.name) + '</div>' +
          '<div class="wx-upd">' + (w.fromCache ? '⏱ 缓存数据' : '✅ 实时') +
            (w.srcName ? ' · ' + esc(w.srcName) + (w.src === PRIMARY ? '' : '（备用源）') : '') +
            (c.hm ? ' · ' + c.hm + ' 更新' : '') + '</div>' +
          '<button class="btn btn-sm wx-refresh" id="wxRefresh">🔄 刷新</button>' +
        '</div>' +
      '</div>' +
      (w.note ? '<div class="wx-note">' + esc(w.note) + (w.fromCache ? '（⏱ 缓存）' : '') + '</div>' : '') +
      (strip ? '<div class="wx-strip">' + strip + '</div>' : '') +
      (days ? '<div class="wx-days">' + days + '</div>' : '') +
    '</div>';
  }

  function tips(w) {
    var list = (w.advice && w.advice.items) || [];
    return list.map(function (x) {
      return '<div class="tip ' + x.tone + '">' +
        '<div class="ti">' + x.ico + '</div>' +
        '<div class="tb"><b>' + esc(x.title) + '</b><small>' + esc(x.text) + '</small></div>' +
      '</div>';
    }).join('');
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* 一句话摘要，用于首页 Hero */
  function brief(w) {
    if (!w || !w.ok) return '🌡 天气待获取';
    return w.current.ico + ' ' + w.spot.short + ' ' + w.current.temp + '°C ' + w.current.text;
  }

  /* 数据源说明，给页面小字用 */
  function sourceLabel() { return 'UAPIS · Open-Meteo / wttr.in'; }

  return {
    SPOT: SPOT, API: OM_API, WT_API: WT_API, UAPIS_API: UAPIS_API,
    SOURCES: SOURCE_URL, SOURCE_LIST: SOURCES, SRC_NAME: SRC_NAME, PRIMARY: PRIMARY,
    load: load, card: card, tips: tips, brief: brief, sourceLabel: sourceLabel, failed: failed,
    codeInfo: codeInfo, isRainy: isRainy, isSnowy: isSnowy, isThunder: isThunder,
    wwToWmo: wwToWmo, textToWmo: textToWmo, windKmph: windKmph,
    shapeUapis: shapeUapis, WMO: WMO, WW: WW
  };
})();
