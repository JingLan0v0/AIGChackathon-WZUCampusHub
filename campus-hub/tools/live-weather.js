/* ==========================================================
   天气取数 · 真实网络冒烟（手动跑，不进测试套件）
   ----------------------------------------------------------
   测试套件里的 fetch 是假的，只能证明「逻辑对」；
   这个工具直接打真接口，回答的是「现在到底能不能取到、走的哪个源」。
   排查「主页没天气」时先跑它。

   用法：
     NODE_PATH=<装了 jsdom 的 node_modules> node tools/live-weather.js [--card]
       --card  额外把渲染出的天气卡片 HTML 打出来
   ========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const wantCard = process.argv.indexOf('--card') >= 0;

const mem = {};
const store = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; }
};

const ctx = vm.createContext({
  console, Date, Math, JSON, Promise, setTimeout, clearTimeout,
  parseInt, parseFloat, isNaN, Infinity, Object, Array, String, Number, Boolean,
  Error, RegExp, encodeURIComponent, fetch: globalThis.fetch,
  localStorage: store, sessionStorage: store
});

vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/weather.js'), 'utf8'), ctx, { filename: 'weather.js' });
const Weather = ctx.Weather;

console.log('数据源：' + Weather.SOURCE_LIST.map(function (s) { return s.name; }).join(' / '));

/* 先看看每个源单独能不能通 —— 这样失败时能直接看出是哪个源的事 */
(async function () {
  for (const s of Weather.SOURCE_LIST) {
    let line = '  ' + s.name.padEnd(12) + ' ';
    const t0 = Date.now();
    try {
      const r = await fetch(s.url, { mode: 'cors' });
      const txt = await r.text();
      let ok = '解析失败';
      try { ok = '解析 OK'; } catch (e) { }
      line += 'HTTP ' + r.status + '  ' + (Date.now() - t0) + 'ms  ' + txt.length + 'B  ' + ok;
    } catch (e) {
      line += (Date.now() - t0) + 'ms  ERR ' + String(e.message || e).slice(0, 90);
    }
    console.log(line);
  }

  console.log('\n--- Weather.load() ---');
  const w = await Weather.load(true);
  console.log('ok=' + w.ok + '  src=' + (w.src || '—') + '  fromCache=' + w.fromCache);
  if (w.note) console.log('note=' + w.note);
  if (w.ok) {
    const c = w.current, t = w.today;
    console.log('地点 ' + w.spot.name);
    console.log('实况 ' + c.temp + '°C ' + c.text + ' · 体感 ' + c.feels + '°C · 湿度 ' + c.hum + '% · 风 ' + c.wind + ' km/h · ' + c.hm + ' 更新');
    console.log('今天 ' + t.tmin + '~' + t.tmax + '°C · 降水概率 ' + t.pop + '% · 雨量 ' + t.rain + 'mm · UV ' + t.uv);
    console.log('逐时 ' + w.next12.length + ' 条 · 预报 ' + w.days.length + ' 天 · 建议 ' + w.advice.items.length + ' 条');
    console.log('摘要 ' + Weather.brief(w));
    w.advice.items.forEach(function (x) { console.log('  ' + x.ico + ' ' + x.title + ' —— ' + x.text); });
  }
  if (wantCard) {
    console.log('\n--- card ---');
    console.log(Weather.card(w).replace(/></g, '>\n<'));
  }
})();
