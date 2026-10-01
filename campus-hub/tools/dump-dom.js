/* ==========================================================
   页面片段速查 / 静态快照（调试用）
   ----------------------------------------------------------
   把某个页面用 jsdom 真正跑起来，然后：
     · 查某个选择器渲染成了什么（默认）
     · 或者把整页渲染结果存成一份脱离 JS 的静态 HTML（--snap）
   --live 时让页面走真实网络（默认是「永远不返回」的假 fetch，
   适合看骨架态；想看真实天气就加 --live，会等到天气填进去再快照）。

   排查「渲染出来的到底是啥」时比看源码快得多，也不用开浏览器。

   用法：
     NODE_PATH=<装了 jsdom 的 node_modules> node tools/dump-dom.js <页面> <选择器> [学号] [--live]
     NODE_PATH=<...> node tools/dump-dom.js <页面> --snap <输出.html> [学号] [--live]

   例：
     node tools/dump-dom.js schedule.html ".tt-times"
     node tools/dump-dom.js home.html --snap ../sample/home-preview.html '' --live
     node tools/dump-dom.js index.html "#page" null            ← 不登录（看登录页）

   第 4 个参数：不传 = 用演示账号登录；传 null = 保持未登录；传学号 = 用该学号。
   ========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

let jsdom;
try { jsdom = require('jsdom'); }
catch (e) {
  console.error('需要 jsdom：用 NODE_PATH 指向装了 jsdom 的 node_modules。');
  process.exit(1);
}

const LIVE = process.argv.indexOf('--live') >= 0;
const argv = process.argv.filter(function (a) { return a !== '--live'; });

const ROOT = path.resolve(__dirname, '..');
const page = argv[2] || 'schedule.html';
const snapMode = argv[3] === '--snap';
const sel = snapMode ? '' : (argv[3] || '#page');
const outArg = snapMode ? argv[4] : null;
const sidArg = argv[snapMode ? 5 : 4];

const noLogin = sidArg === 'null';
const sid = noLogin ? '' : (sidArg || null);

const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
const vc = new jsdom.VirtualConsole();
vc.on('jsdomError', function () {});
const dom = new jsdom.JSDOM(html, {
  url: 'http://localhost/campus-hub/' + page,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc
});
const win = dom.window;
/* 默认给一个「永远 pending」的假 fetch：页面停在骨架态，方便看初始渲染。
   --live 时接真实网络 —— 天气这种异步填充的内容才会出现。 */
win.fetch = LIVE
  ? function (u, o) { return globalThis.fetch(u, o); }
  : function () { return new Promise(function () {}); };

const srcs = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map(function (m) { return m[1]; });
const errors = [];
srcs.forEach(function (src) {
  try { win.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); }
  catch (e) { errors.push(src + ' :: ' + e.message); }
  if (/store\.js$/.test(src) && !noLogin) {
    const useSid = sid || win.Store.DEMO.sid;
    try { win.Store.login(useSid, true); } catch (e) { errors.push('login :: ' + e.message); }
  }
});

/* 等异步填充的内容（天气卡片）落定：不再有「正在获取…」就认为好了 */
function settle(limitMs) {
  const t0 = Date.now();
  return new Promise(function (resolve) {
    (function tick() {
      const box = win.document.getElementById('wxBox');
      if (box && box.innerHTML.indexOf('正在获取') < 0) return resolve(true);
      if (Date.now() - t0 > limitMs) return resolve(false);
      setTimeout(tick, 150);
    })();
  });
}

(async function main() {
  if (LIVE) await settle(15000);
  if (errors.length) console.error('!! 脚本报错：' + errors.join(' | '));

  if (snapMode) {
    /* 渲染后的 body 去掉所有 <script>（含页面里内联的抓取脚本），
       再挂回项目自己的 CSS —— 得到一份不依赖 JS、双击就能看的静态快照。 */
    let body = win.document.body.innerHTML
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .trim();
    const css = (html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/) || [])[1] || 'assets/css/main.css';
    const dest = path.resolve(ROOT, outArg || '../snapshot.html');
    /* 快照可能被放到子目录，CSS 得用相对路径才连得上 */
    const cssHref = path.relative(path.dirname(dest), path.resolve(ROOT, css)).split(path.sep).join('/');
    const out = [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + page + ' · 渲染快照（静态，仅供预览）</title>',
      '<link rel="stylesheet" href="' + cssHref + '">',
      '</head>',
      '<body>',
      body,
      '</body>',
      '</html>'
    ].join('\n');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out, 'utf8');
    console.log('已写出静态快照：' + dest + '（' + Math.round(out.length / 1024) + ' KB）' + (LIVE ? '（含真实网络数据）' : ''));
    return;
  }

  const res = [];
  res.push('页面 ' + page + '  选择器 ' + sel);
  const hits = win.document.querySelectorAll(sel);
  res.push('命中 ' + hits.length + ' 个节点');
  Array.prototype.forEach.call(hits, function (el, i) {
    res.push('--- [' + (i + 1) + '] ---');
    res.push(el.outerHTML.replace(/></g, '>\n<'));
  });
  fs.writeFileSync(path.join(ROOT, '..', '.dom.txt'), res.join('\n'), 'utf8');
})();
