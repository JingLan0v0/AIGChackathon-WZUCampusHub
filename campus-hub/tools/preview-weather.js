/* ==========================================================
   天气卡片渲染预览 · 生成 sample/weather-preview.html
   ---------------------------------------------------------
   在 Node 里把 assets/js/weather.js 跑起来（走真实网络），
   把「首选源成功 / 换源降级 / 全部失败」三种状态的卡片
   渲染成一张独立 HTML，用项目自己的样式表显示出来。

   为什么要它：本机没装浏览器 CLI（agent-browser），做不了截图验收；
   这个脚本用真实接口数据 + 页面真实渲染函数出一张静态页，
   打开就能看到页面实际会长成什么样。

   用法：node tools/preview-weather.js
   输出：campus-hub/sample/weather-preview.html
   ========================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'sample', 'weather-preview.html');

/* ---------- 在沙箱里跑真实的 weather.js ----------
   沙箱里的 fetch 是「调用时再去取 globalThis.fetch」，所以外面把
   globalThis.fetch 换成桩函数，沙箱里发起请求时就会用到桩。 */
function sandboxWeather() {
  const mem = {};
  const box = {
    console, Promise, Math, JSON, Object, Array, String, Number, Boolean,
    Error, parseFloat, parseInt, isNaN, Date, RegExp, setTimeout, clearTimeout,
    fetch: (u, o) => globalThis.fetch(u, o),
    localStorage: {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; }
    },
    navigator: { onLine: true },
    location: { href: 'http://127.0.0.1/', protocol: 'http:' }
  };
  box.window = box;
  box.globalThis = box;
  const ctx = vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/weather.js'), 'utf8'), ctx, { filename: 'weather.js' });
  return ctx.Weather;
}

/* 在「fetch 被换成 stub」的环境里跑一段逻辑，跑完恢复 */
async function withFetch(stub, fn) {
  const saved = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = saved; }
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function block(title, desc, html) {
  return '<section class="blk">' +
    '<h2>' + esc(title) + '</h2>' +
    '<p class="blk-desc">' + esc(desc) + '</p>' +
    html +
    '</section>';
}

function pair(W, w) {
  return '<div class="split"><div>' + W.card(w) + '</div>' +
    '<div class="card"><div class="sec-title" style="margin-top:0"><span class="bar"></span>今天怎么出门</div>' +
    W.tips(w) + '</div></div>';
}

(async function () {
  const facts = [];
  const pieces = [];

  /* ① 首选源正常（国内源 UAPIS） */
  const W1 = sandboxWeather();
  let w = await W1.load(true);
  facts.push('① 首选  ok=' + w.ok + ' src=' + w.src + ' ' + (w.current && w.current.temp) + '°C ' +
    (w.current && w.current.text) + ' / 逐时 ' + w.next12.length + ' 档 / 预报 ' + w.days.length + ' 天');
  pieces.push(block(
    '① 正常 · 国内源 UAPIS 应答',
    'UAPIS 是国内服务，国内直连一两百毫秒就回来，数据也最全（实况 + 7 天 + 24 小时逐时）。',
    pair(W1, w)
  ));

  /* ② 国内源不通（例如 file:// 双击打开，CORS 把它拦了）→ 境外源顶上 */
  const stub = (u, o) => {
    if (String(u).indexOf('uapis.cn') >= 0) return Promise.reject(new Error('CORS 拦了（file:// 打开时 Origin 是 null）'));
    if (String(u).indexOf('open-meteo') >= 0) return Promise.reject(new Error('国内直连超时'));
    return globalThis.__realFetch(u, o);
  };
  globalThis.__realFetch = globalThis.fetch;
  const W2 = sandboxWeather();
  w = await withFetch(stub, () => W2.load(true));
  facts.push('② 降级  ok=' + w.ok + ' src=' + w.src + ' ' + (w.current && w.current.temp) + '°C ' +
    (w.current && w.current.text) + ' hm=' + (w.current && w.current.hm) + ' / 预报 ' + w.days.length + ' 天');
  pieces.push(block(
    '② 降级 · 国内源被拦 / 境外主源超时 → 换一个源顶上',
    '模拟 file:// 下 UAPIS 被 CORS 拦掉、api.open-meteo.com 国内直连超时。卡片右上角会标出真正生效的源。',
    pair(W2, w)
  ));

  /* ③ 三个源都失败 */
  const W3 = sandboxWeather();
  w = await withFetch(() => Promise.reject(new Error('Failed to fetch')), () => W3.load(true));
  facts.push('③ 全挂  ok=' + w.ok + ' note=' + w.note);
  pieces.push(block(
    '③ 兜底 · 三个源都失败',
    '页面照样能用：写清楚每个源各自失败的原因，作业与今日规划不受影响。',
    pair(W3, w)
  ));

  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>天气模块 · 三种状态渲染预览</title>',
    '<link rel="stylesheet" href="../assets/css/main.css">',
    '<style>',
    '  body { padding: 26px 20px 60px; }',
    '  .pv { max-width: 1000px; margin: 0 auto; }',
    '  .pv h1 { font-size: 22px; margin: 0 0 6px; }',
    '  .pv .lead { color: var(--muted); font-size: 13px; margin: 0 0 26px; }',
    '  .blk { margin: 0 0 34px; }',
    '  .blk h2 { font-size: 15px; margin: 0 0 4px; }',
    '  .blk-desc { color: var(--muted); font-size: 12.5px; margin: 0 0 12px; }',
    '  .pv .card { padding: 14px; }',
    '  .pv .sec-title { font-size: 13px; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="pv">',
    '  <h1>天气模块 · 三种状态渲染预览</h1>',
    '  <p class="lead">真实接口数据 + 页面真实渲染函数（Weather.card / Weather.tips）生成的静态快照。本页不跑 JS。</p>',
    pieces.join('\n'),
    '</div>',
    '</body>',
    '</html>'
  ].join('\n');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');
  console.log('已生成 ' + path.relative(process.cwd(), OUT) + '（' + Math.round(Buffer.byteLength(html) / 1024) + ' KB）');
  facts.forEach(f => console.log('  ' + f));
})().catch(e => { console.error('生成失败：' + (e && e.stack || e)); process.exit(1); });
