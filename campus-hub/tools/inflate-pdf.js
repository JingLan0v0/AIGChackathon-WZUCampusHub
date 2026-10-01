'use strict';
/* 把 PDF 的内容流解压出来，看真实的文字绘制指令 */
const fs = require('fs');
const zlib = require('zlib');
const buf = fs.readFileSync(process.argv[2]);
const s = buf.toString('latin1');
const out = [];

/* 找所有 stream ... endstream，FlateDecode 解压 */
const re = /stream\r?\n/g;
let m, n = 0;
while ((m = re.exec(s))) {
  const start = m.index + m[0].length;
  const end = s.indexOf('endstream', start);
  if (end < 0) continue;
  let raw = buf.slice(start, end);
  /* 去掉尾部换行 */
  while (raw.length && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d)) {
    raw = raw.slice(0, raw.length - 1);
  }
  n++;
  out.push('########## 流 #' + n + '  压缩后 ' + raw.length + ' 字节 ##########');
  try {
    const inf = zlib.inflateSync(raw);
    out.push('解压后 ' + inf.length + ' 字节：\n' + inf.toString('latin1'));
  } catch (e) {
    out.push('解压失败: ' + e.message);
  }
  out.push('');
}
fs.writeFileSync(process.argv[3], out.join('\n'), 'utf8');
