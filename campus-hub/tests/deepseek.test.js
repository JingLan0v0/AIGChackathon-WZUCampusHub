'use strict';
const assert=require('node:assert/strict');
const {normalize,sanitizeContext,parseWithDeepSeek}=require('../tools/deepseek');
const {createServer}=require('../tools/serve');
// Tests below include the real network boundary with a fake upstream, never the paid API.
async function run(){
 const ctx=sanitizeContext({text:'语文课',now:'2026-09-27T17:00',courses:[]});
 const base={kind:'plan',title:'语文课',date:'2026-09-28',start:'07:00',end:'09:00',type:'学习',level:2};
 const normal=normalize({items:[base]},ctx)[0];
 assert.equal(normal.start,'07:00');assert.equal(normal.end,'09:00');assert.equal(normal.type,'学习');assert.deepEqual(normal.missing,[]);
 const invalid=normalize({items:[{...base,date:'2026-02-30',start:'25:00',end:'01:00'}]},ctx)[0];
 assert.equal(invalid.date,'');assert.equal(invalid.start,'');assert.ok(invalid.missing.includes('日期'));
 const course=normalize({items:[{...base,kind:'course'}]},ctx)[0];assert.equal(course.kind,'plan');assert.equal(course.start,'07:00');
 const unsafe=await parseWithDeepSeek({...ctx,auth:{sid:'do not send'},secret:'do not send'},{readKey:()=> 'test-secret',fetch:async(url,opts)=>{
   assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(opts.headers.Authorization,'Bearer test-secret');
   assert.ok(!opts.body.includes('do not send'));assert.ok(!opts.body.includes('test-secret'));
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({items:[base]})}}]})};
 }});assert.equal(unsafe.items[0].title,'语文课');assert.ok(!JSON.stringify(unsafe).includes('test-secret'));
 const server=createServer({parse:async()=>{throw new Error('raw-sensitive-message');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 try{
   let r=await fetch(origin+'/api/nl',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify(ctx)});assert.equal(r.status,403);
   r=await fetch(origin+'/api/nl',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(ctx)});assert.equal(r.status,503);assert.ok(!(await r.text()).includes('raw-sensitive-message'));
   for(const route of ['/tools/deepseek.js','/.git/config','/assets/../tools/serve.js','/sample/%2e%2e%5ctools/serve.js']){r=await fetch(origin+route);assert.equal(r.status,404);}
   r=await fetch(origin+'/api/nl',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({text:'x'.repeat(17000)})});assert.equal(r.status,413);
 }finally{await new Promise(r=>server.close(r));}
 console.log('DeepSeek normalization, minimal context, cross-site blocking, private-file blocking and error redaction: passed');
}
run().catch(()=>{console.error('DeepSeek checks failed');process.exitCode=1;});
