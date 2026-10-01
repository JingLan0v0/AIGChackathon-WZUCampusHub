'use strict';
const assert=require('node:assert/strict');
const A=require('../assets/js/assistant-actions');
const {sanitize,parseAssistant}=require('../tools/assistant');
const {createServer}=require('../tools/serve');
async function main(){
 assert.ok(Object.keys(A.schemas).length>=40);
 assert.throws(()=>A.validate({tool:'eval',args:{code:'alert(1)'}}));
 assert.throws(()=>A.validate({tool:'plan.create',args:{title:'x',date:'2026-02-30'}}));
 assert.equal(A.validate({tool:'course.create',args:{name:'晚课',day:1,start:11,span:3,from:1,to:16}}).args.span,3);
 assert.throws(()=>A.validate({tool:'course.create',args:{name:'x',day:7,start:12,span:3,from:1,to:16}}));
 assert.throws(()=>A.validate({tool:'course.create',args:{name:'x',day:7,start:13,span:2,from:1,to:16}}));
 assert.throws(()=>A.validate({tool:'homework.update',args:{id:'h1',password:'secret'}}));
 assert.throws(()=>A.validate({tool:'ui.open',args:{page:'https://evil.test'}}));
 assert.throws(()=>A.validate({tool:'profile.update',args:{auth:{logged:true}}}));
 assert.equal(A.validate({tool:'adjust.create',args:{type:'move',course:'数据结构',fromWeek:3,fromDay:2,fromStart:6,fromSpan:2,toWeek:3,toDay:4,toStart:3,toSpan:2,toRoom:'计算机楼-402'}}).tool,'adjust.create');
 assert.throws(()=>A.validate({tool:'adjust.create',args:{type:'move',course:'数据结构',fromWeek:3,fromDay:2,fromStart:6,fromSpan:2}}));
 assert.throws(()=>A.validate({tool:'adjust.create',args:{type:'make',course:'程序设计基础',toWeek:3,toDay:6,toStart:1,toSpan:2}}));
 assert.equal(A.validate({tool:'homework.update',args:{id:'h1',due:'2026-09-28T21:00'}}).args.due,'2026-09-28T21:00');
 const body={text:'修改作业',now:'2026-09-27T19:00',auth:{sid:'private-student'},context:{homework:[{id:'h1',title:'实验三',due:'2026-09-27T23:59',contact:'private-contact',key:'secret-key'}],auth:[{password:'secret-password'}]},history:[{role:'system',content:'ignored-system'}]};
 const safe=sanitize(body);assert.ok(!JSON.stringify(safe).includes('secret'));assert.ok(!JSON.stringify(safe).includes('private'));assert.deepEqual(safe.history,[]);
 assert.equal(A.validate({tool:'query',args:{module:'todo'}}).args.module,'todo');
 assert.equal(A.validate({tool:'plan.create',args:{title:'背单词',date:'2026-09-27',taskGroup:'academic'}}).args.taskGroup,'academic');
 assert.throws(()=>A.validate({tool:'plan.create',args:{title:'x',date:'2026-09-27',taskGroup:'random'}}));
 let called=0;
 const result=await parseAssistant(body,{readKey:()=> 'secret-api-key',fetch:async(url,opts)=>{
  called++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(opts.headers.Authorization,'Bearer secret-api-key');
  assert.ok(!opts.body.includes('secret-api-key'));assert.ok(!opts.body.includes('private-student'));assert.ok(!opts.body.includes('private-contact'));
  const sent=JSON.parse(opts.body);assert.equal(sent.model,'deepseek-flash');assert.equal(sent.thinking.type,'disabled');assert.ok(sent.max_tokens<=1400);assert.ok(sent.messages[0].content.includes('待办清单同时包含homework'));assert.ok(sent.messages[0].content.includes('taskGroup=academic'));
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({reply:'待确认',actions:[{tool:'homework.update',args:{id:'h1',due:'2026-09-28T21:00'}}]})}}]})};
 }});assert.equal(called,1);assert.equal(result.actions[0].tool,'homework.update');
 const proposedMove={tool:'adjust.create',args:{type:'move',course:'数据库原理与应用',fromWeek:5,fromDay:2,fromStart:8,fromSpan:3,toWeek:5,toDay:3,toStart:8,toSpan:3}};
 const mockMove=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({reply:'请核对',actions:[proposedMove]})}}]})});
 const todayMove=await parseAssistant({text:'把今天下午的数据库原理与应用调整到明天同一时间',now:'2026-09-29T10:04',context:{profile:[{termStart:'2026-09-07'}]}},{readKey:()=> 'test',fetch:mockMove});
 assert.deepEqual([todayMove.actions[0].args.fromWeek,todayMove.actions[0].args.fromDay,todayMove.actions[0].args.toWeek,todayMove.actions[0].args.toDay],[4,2,4,3]);
 const confirmedMove=await parseAssistant({text:'是的',now:'2026-09-29T10:05',context:{profile:[{termStart:'2026-09-07'}]},history:[{role:'user',content:'把今天下午的数据库原理与应用调整到明天同一时间'},{role:'assistant',content:'今天改到明天，对吗？'}]},{readKey:()=> 'test',fetch:mockMove});
 assert.deepEqual([confirmedMove.actions[0].args.fromWeek,confirmedMove.actions[0].args.toWeek],[4,4]);
 const sundayMove=await parseAssistant({text:'把今天的课调到明天同一时间',now:'2026-10-04T10:05',context:{profile:[{termStart:'2026-09-07'}]}},{readKey:()=> 'test',fetch:mockMove});
 assert.deepEqual([sundayMove.actions[0].args.fromWeek,sundayMove.actions[0].args.fromDay,sundayMove.actions[0].args.toWeek,sundayMove.actions[0].args.toDay],[4,7,5,1]);
 const nextWeekMove=await parseAssistant({text:'把下周二的数据库原理与应用调到下周三',now:'2026-09-29T10:05',context:{profile:[{termStart:'2026-09-07'}]}},{readKey:()=> 'test',fetch:mockMove});
 assert.deepEqual([nextWeekMove.actions[0].args.fromWeek,nextWeekMove.actions[0].args.toWeek],[5,5]);
 await assert.rejects(()=>parseAssistant(body,{readKey:()=> 'test',fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({reply:'',actions:[{tool:'eval',args:{}}]})}}]})})}),/MODEL_OUTPUT/);
 const image='data:image/jpeg;base64,'+Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(120)]).toString('base64');
 const vision=await parseAssistant({...body,text:'识别调课截图',image},{readKey:()=> 'test',fetch:async(url,opts)=>{
  const sent=JSON.parse(opts.body);assert.equal(sent.model,'deepseek-flash');assert.ok(Array.isArray(sent.messages.at(-1).content));
  assert.equal(sent.messages.at(-1).content[1].type,'image_url');assert.equal(sent.messages.at(-1).content[1].image_url.url,image);
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({reply:'请核对',actions:[{tool:'adjust.create',args:{type:'cancel',course:'数据结构',fromWeek:3,fromDay:2,fromStart:6,fromSpan:2}}]})}}]})};
 }});
 assert.equal(vision.actions[0].tool,'adjust.create');
 assert.throws(()=>sanitize({...body,image:'data:text/html;base64,PHNjcmlwdD4='}),/INPUT/);
 const server=createServer({assistantParse:async()=>{throw new Error('sensitive-upstream-error');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  let r=await fetch(origin+'/api/assistant',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,403);
  r=await fetch(origin+'/api/assistant',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,503);assert.ok(!(await r.text()).includes('sensitive-upstream-error'));
  r=await fetch(origin+'/api/assistant',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'x'.repeat(2300001)});assert.equal(r.status,413);
 }finally{await new Promise(r=>server.close(r));}
 console.log('Assistant tool validation, small context, key isolation, cross-site protection, body limit and error redaction passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
