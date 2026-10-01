'use strict';
/* 快速体检：这份 PDF 里到底是文字还是图片 */
const fs = require('fs');
const buf = fs.readFileSync(process.argv[2]);
const s = buf.toString('latin1');
const keys = ['/Font', '/Image', '/XObject', '/DCTDecode', '/FlateDecode', '/CCITTFaxDecode',
  '/JBIG2Decode', '/JPXDecode', '/ToUnicode', '/Type0', '/TrueType', '/Subtype', ' Tj', ' TJ', '/Contents'];
const out = [];
out.push('文件大小: ' + buf.length);
keys.forEach(function (k) {
  let n = 0, i = 0;
  while ((i = s.indexOf(k, i)) >= 0) { n++; i += k.length; }
  out.push(k.padEnd(18) + ' 出现 ' + n + ' 次');
});
/* 把 obj 头都列出来 */
const objs = [];
const re = /(\d+)\s+0\s+obj([\s\S]{0,200}?)(stream|endobj)/g;
let m;
while ((m = re.exec(s)) && objs.length < 60) {
  objs.push('  obj ' + m[1] + ' : ' + m[2].replace(/\s+/g, ' ').trim().slice(0, 120));
}
out.push('\n--- 对象表 ---');
out.push(objs.join('\n'));
fs.writeFileSync(process.argv[3], out.join('\n'), 'utf8');
