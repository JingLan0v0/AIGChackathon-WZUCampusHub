'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const {parseWithDeepSeek}=require('./deepseek');
const {parseAssistant}=require('./assistant');
const ROOT=path.resolve(__dirname,'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.bcmap':'application/octet-stream','.map':'application/json'};
const MESSAGES={KEY_MISSING:'本机尚未配置 DeepSeek 密钥，请先运行密钥配置工具。',AUTH:'DeepSeek 密钥验证失败，请检查本机密钥。',BALANCE:'DeepSeek 余额不足，请充值后重试。',RATE:'请求较多，请稍后再试。',INPUT:'输入内容或日期格式不正确。',MODEL_OUTPUT:'识别结果不完整，请换一种说法重试。',UPSTREAM:'DeepSeek 服务暂时不可用，请稍后重试。'};
function createServer(options={}) {
  let active=0, calls=[];
  const root=options.root||ROOT;
  function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
  return http.createServer(async(req,res)=>{
    const host=req.headers.host;
    if(!/^127\.0\.0\.1:\d+$/.test(host||'')){res.writeHead(403);res.end('forbidden');return;}
    let rel;
    try{rel=decodeURIComponent(new URL(req.url,'http://'+host).pathname);}catch(e){res.writeHead(400);res.end('bad request');return;}
    if(rel==='/api/nl'||rel==='/api/assistant'){
      if(req.method!=='POST'){json(res,405,{error:'请求方式不正确。'});return;}
      if(req.headers.origin!=='http://'+host || req.headers['sec-fetch-site']==='cross-site'){
        json(res,403,{error:'只允许从本机应用发起识别。'});return;
      }
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){json(res,415,{error:'需要 JSON 请求。'});return;}
      calls=calls.filter(t=>Date.now()-t<60000);
      if(active>=2||calls.length>=12){json(res,429,{error:MESSAGES.RATE});return;}
      const chunks=[];let length=0;
      try{
        for await(const chunk of req){length+=chunk.length;if(length>(rel==='/api/assistant'?2300000:16384)){json(res,413,{error:'输入或图片太大，请缩小后重试。'});return;}chunks.push(chunk);}
      }catch(e){json(res,400,{error:'请求未完成。'});return;}
      let body;
      try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch(e){json(res,400,{error:'请求内容不正确。'});return;}
      active++;calls.push(Date.now());
      try{json(res,200,await(rel==='/api/assistant'?(options.assistantParse||parseAssistant):(options.parse||parseWithDeepSeek))(body));}
      catch(e){const code=e&&e.message;json(res,code==='INPUT'?400:503,{error:MESSAGES[code]||'识别暂时失败，请稍后重试。'});}
      finally{active--;}
      return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    if(rel==='/')rel='/index.html';
    const parts=rel.split('/').filter(Boolean);
    // Serve public page/assets/sample files only. Tools and hidden files are private.
    if(parts.some(p=>p.startsWith('.')||p.includes('\\')) || (parts.length>1&&!['assets','sample'].includes(parts[0]))){res.writeHead(404);res.end('not found');return;}
    const file=path.resolve(root,'.'+rel);
    if(!file.startsWith(root+path.sep)||!MIME[path.extname(file).toLowerCase()]){res.writeHead(404);res.end('not found');return;}
    try{
      const real=await fs.promises.realpath(file);
      if(!real.startsWith(root+path.sep)){res.writeHead(404);res.end('not found');return;}
      const data=await fs.promises.readFile(real);
      res.writeHead(200,{'Content-Type':MIME[path.extname(real).toLowerCase()],'X-Content-Type-Options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch(e){res.writeHead(404);res.end('not found');}
  });
}
if(require.main===module){
  const port=parseInt(process.argv[2],10)||8080;
  createServer().listen(port,'127.0.0.1',()=>console.log('校园百事通 已启动：http://127.0.0.1:'+port+'/'));
}
module.exports={createServer};
