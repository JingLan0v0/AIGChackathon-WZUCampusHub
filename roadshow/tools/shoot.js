/* ==========================================================
   路演素材截图：用 Edge（无头）+ CDP 把校园百事通的真实页面截下来
   ----------------------------------------------------------
   为什么不用 jsdom 快照：快照没有真实字体、阴影、圆角，路演投影上看着"假"。
   这里走真浏览器，截图能直接贴进 PPT。

   前提：本地已起静态服务器（campus-hub 目录，端口 8765）
   用法：node roadshow/tools/shoot.js
   ========================================================== */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const BASE = 'http://127.0.0.1:8765/';
const OUT = path.resolve(__dirname, '..', 'shots');
const PROFILE = path.join(require('os').tmpdir(), 'edge-shoot-profile');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let s = '';
      res.on('data', d => (s += d));
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 极简 CDP 客户端：Node 22 自带 WebSocket，不用装任何依赖 */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const waiting = new Map();
    const events = [];
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && waiting.has(msg.id)) {
        const { res, rej } = waiting.get(msg.id);
        waiting.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) events.push(msg);
    };
    ws.onerror = e => reject(new Error('ws error'));
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id;
          waiting.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
          setTimeout(() => { if (waiting.has(mid)) { waiting.delete(mid); rej(new Error(method + ' 超时')); } }, 30000);
        });
      },
      close() { ws.close(); }
    });
  });
}

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  /* 等调试端口起来 */
  let ver = null;
  for (let i = 0; i < 40 && !ver; i++) {
    try { ver = await getJSON('http://127.0.0.1:' + PORT + '/json/version'); } catch (e) { await sleep(500); }
  }
  if (!ver) { console.error('Edge 没起来（调试端口连不上）'); edge.kill(); process.exit(1); }
  console.log('浏览器：' + ver['Browser']);

  const list = await getJSON('http://127.0.0.1:' + PORT + '/json/list');
  const page = list.find(t => t.type === 'page');
  if (!page) { console.error('没有可用的标签页'); edge.kill(); process.exit(1); }
  const c = await connect(page.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Runtime.enable');

  async function goto(url, waitMs) {
    await c.send('Page.navigate', { url });
    await sleep(waitMs || 900);
  }
  async function viewport(w, h) {
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 2, mobile: w < 600
    });
  }
  async function evalJs(expr) {
    const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception;
      throw new Error((d && d.description) || r.exceptionDetails.text);
    }
    return r.result && r.result.value;
  }
  async function shoot(name) {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('  ✓ ' + name + '.png  ' + Math.round(fs.statSync(f).size / 1024) + ' KB');
  }

  const PHONE = [430, 932];
  const DESKTOP = [1440, 900];

  /* ① 登录页（痛点：课表要先过统一身份认证） */
  await viewport(1200, 860);
  await goto(BASE + 'index.html', 1200);
  await shoot('01-login');

  /* 登录演示账号，后面所有内页都靠它 */
  console.log('  诊断：' + await evalJs(
    "'Store='+typeof Store+' UI='+typeof UI+' scripts='+document.querySelectorAll('script[src]').length" +
    " + ' 已加载=' + Array.prototype.filter.call(document.querySelectorAll('script[src]'),function(s){return !!s.getAttribute('data-loaded')}).length" +
    " + ' readyState=' + document.readyState"));
  await evalJs("Store.login('20230427', true) ? 'ok' : 'fail'");

  /* ② 首页（手机尺寸：Hero + 一句话记下来 + 天气） */
  await viewport(PHONE[0], PHONE[1]);
  await goto(BASE + 'home.html', 3200);   /* 留时间给天气接口 */
  await shoot('02-home');

  /* ③ 首页：输入自然语言 → 解析卡片 */
  await evalJs("(function(){var i=document.getElementById('nlText');i.value='高数作业 周五 23:59 交；明晚 7 点 图书馆自习 2 小时';document.getElementById('nlGo').click();return 1})()");
  await sleep(500);
  /* 滚到卡片上：不然截图里只有 Hero，看不到「我理解为」的结果 */
  await evalJs("document.querySelector('#nlCard').scrollIntoView({block:'start'})");
  await sleep(400);
  await shoot('03-nl-parse');

  /* ④ 首页：请假条生成结果 */
  await goto(BASE + 'home.html', 1200);
  await evalJs("(function(){var i=document.getElementById('nlText');i.value='明天上午请病假，因为发烧要去校医院';document.getElementById('nlGo').click();return 1})()");
  await sleep(400);
  /* 把老师和课程填上（路演投影上「尊敬的 任课 老师」不好看） */
  await evalJs("(function(){document.getElementById('nlQ0').value='王海峰';var c=document.getElementById('nlC0');c.value='高等数学 A(一)';return c.value})()");
  await evalJs("document.querySelector('[data-nl-gen]').click()");
  await sleep(400);
  await evalJs("document.querySelector('#nlCard').scrollIntoView({block:'center'})");
  await sleep(300);
  await shoot('04-leave');

  /* ⑤ 课表 */
  await goto(BASE + 'schedule.html', 1000);
  await shoot('05-schedule');

  /* ⑥ 调课通知（演示账号有样本） */
  await goto(BASE + 'notice.html', 1000);
  await shoot('06-notice');

  /* ⑦ 作业 */
  await goto(BASE + 'homework.html', 1000);
  await shoot('07-homework');

  /* ⑧ 今日规划 */
  await goto(BASE + 'plan.html', 1200);
  await shoot('08-plan');

  /* ⑨ 天气 + 出行建议（首页再往下一点） */
  await goto(BASE + 'home.html', 3200);
  await evalJs("(function(){var t=Array.prototype.filter.call(document.querySelectorAll('.sec-title'),function(e){return e.textContent.indexOf('今日天气')>=0})[0]; if(t) t.scrollIntoView({block:'start'}); return t?'ok':'notfound'})()");
  await sleep(600);
  await shoot('10-weather');

  /* ⑩ 其余四个入口（功能总览页做缩略图用） */
  for (const [file, name] of [['market.html', '11-market'], ['lost.html', '12-lost'], ['qa.html', '13-qa'], ['me.html', '14-me']]) {
    await goto(BASE + file, 900);
    await shoot(name);
  }

  /* ⑪ 桌面宽度总览（给「九个入口」那页用） */
  await viewport(DESKTOP[0], DESKTOP[1]);
  await goto(BASE + 'home.html', 3200);
  await shoot('09-home-desktop');

  c.close();
  edge.kill();
  console.log('完成，输出目录：' + OUT);
  process.exit(0);
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
