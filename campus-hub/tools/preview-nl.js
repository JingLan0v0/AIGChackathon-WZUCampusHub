/* ==========================================================
   预览生成：把「首页一句话记下来」和「新学号的调课页空态」渲染出来存成静态快照
   ----------------------------------------------------------
   给 forey 看效果用（不用开浏览器）。产物：
     sample/nl-preview.html           首页 + 两句话解析出的「我理解为」卡片
     sample/notice-empty-preview.html 真实学号第一次进调课页的样子（没有任何编造的通知）
   用法：
     NODE_PATH=<装了 jsdom 的 node_modules> node tools/preview-nl.js [--live]
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
const ROOT = path.resolve(__dirname, '..');
const vc = new jsdom.VirtualConsole();
vc.on('jsdomError', function () {});

function boot(page, sid) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const dom = new jsdom.JSDOM(html, {
    url: 'http://localhost/campus-hub/' + page,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const win = dom.window;
  win.fetch = LIVE
    ? function (u, o) { return globalThis.fetch(u, o); }
    : function () { return new Promise(function () {}); };
  const srcs = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map(function (m) { return m[1]; });
  const errors = [];
  srcs.forEach(function (src) {
    try { win.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); }
    catch (e) { errors.push(src + ' :: ' + e.message); }
    if (/store\.js$/.test(src)) {
      try { win.Store.login(sid || win.Store.DEMO.sid, true); } catch (e) { errors.push('login :: ' + e.message); }
    }
  });
  return { win: win, doc: win.document, html: html, errors: errors };
}

function settleWeather(win, limitMs) {
  const t0 = Date.now();
  return new Promise(function (resolve) {
    (function tick() {
      const box = win.document.getElementById('wxBox');
      if (!box || box.innerHTML.indexOf('正在获取') < 0) return resolve(true);
      if (Date.now() - t0 > limitMs) return resolve(false);
      setTimeout(tick, 150);
    })();
  });
}

function snap(env, page, dest) {
  const body = env.doc.body.innerHTML.replace(/<script[\s\S]*?<\/script>/gi, '').trim();
  const css = (env.html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/) || [])[1] || 'assets/css/main.css';
  const out = [
    '<!DOCTYPE html>', '<html lang="zh-CN">', '<head>', '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + page + ' · 渲染快照（静态，仅供预览）</title>',
    '<link rel="stylesheet" href="' + path.relative(path.dirname(dest), path.resolve(ROOT, css)).split(path.sep).join('/') + '">',
    '</head>', '<body>', body, '</body>', '</html>'
  ].join('\n');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out, 'utf8');
  return dest;
}

(async function main() {
  /* ---------- ① 首页：把两句话敲进去，留下「我理解为」卡片 ---------- */
  const home = boot('home.html');
  if (home.errors.length) console.error('首页脚本报错：' + home.errors.join(' | '));
  if (LIVE) await settleWeather(home.win, 15000);

  const doc = home.doc;
  const input = doc.querySelector('#nlText');
  const go = doc.querySelector('#nlGo');
  if (input && go) {
    const text = '明晚 7 点 图书馆自习 2 小时；周六 第 3-4 节 加课 体育 体育馆';
    input.value = text;
    input.setAttribute('value', text);   /* 静态快照读的是属性，不是 DOM 的 value */
    go.click();
    console.log('解析出 ' + doc.querySelectorAll('#nlOut .nl-res').length + ' 张卡片');
  }
  const p1 = snap(home, 'home.html', path.join(ROOT, 'sample/nl-preview.html'));
  console.log('已写出：' + p1);

  /* ---------- ② 首页：请假条——从一句话到正式正文 ---------- */
  const leave = boot('home.html');
  if (leave.errors.length) console.error('请假条预览脚本报错：' + leave.errors.join(' | '));
  const dl = leave.doc;
  const il = dl.querySelector('#nlText');
  const gl = dl.querySelector('#nlGo');
  if (il && gl) {
    const t2 = '明天上午请病假，因为发烧要去校医院';
    il.value = t2;
    il.setAttribute('value', t2);
    gl.click();
    const gen = dl.querySelector('[data-nl-gen]');
    if (gen) gen.click();
    console.log('请假条正文：' + (dl.querySelector('.nl-leave-note') ? '已生成' : '没有生成'));
  }
  const p1b = snap(leave, 'home.html', path.join(ROOT, 'sample/leave-preview.html'));
  console.log('已写出：' + p1b);

  /* ---------- ③ 调课页：真实学号第一次进来的样子 ---------- */
  const notice = boot('schedule.html', '20257777');
  if (notice.errors.length) console.error('调课页脚本报错：' + notice.errors.join(' | '));
  const d2 = notice.doc;
  console.log('真实学号的通知条数：' + notice.win.Store.load().courseNotices.length +
    '，引导卡：' + (d2.querySelector('#page .edu-cta') ? '有' : '没有'));
  const p2 = snap(notice, 'schedule.html', path.join(ROOT, 'sample/notice-empty-preview.html'));
  console.log('已写出：' + p2);
})();
