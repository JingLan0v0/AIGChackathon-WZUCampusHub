/* AI only proposes allowlisted actions; the browser validates and confirms writes. */
var CampusAssistant = (function () {
  'use strict';
  var A = AssistantActions, messages = [], busy = false, afterChange = function(){}, onWeather = function(){};
  var currentDraft = '', attachedImage = null, controller = null, backup = null, refs = [], lastLeave = '';
  var names={todo:'待办清单',plan:'课外计划',homework:'作业',course:'课程',adjust:'课程调整',lost:'失物',qa:'问答',profile:'个人资料',today:'今日安排',accounts:'本机账号',weather:'天气',all:'全部内容'};
  var fieldNames={title:'事项',name:'课程',type:'类型',date:'日期',start:'开始',end:'结束',place:'地点',level:'重要度',repeat:'重复',note:'备注',course:'课程',due:'截止',hours:'预计小时',teacher:'教师',room:'教室',day:'星期',span:'连堂节数',from:'起始周',to:'结束周',body:'内容',reason:'理由',contact:'联系方式',desc:'描述',nickname:'昵称',college:'学院',termStart:'学期起始日',avatar:'头像',days:'天数',slot:'时段',page:'页面',action:'操作',query:'关键词',filter:'筛选',sid:'本机账号',week:'教学周',taskGroup:'归属',sort:'排序',onlyTodo:'只看未完成',tags:'话题',emoji:'图标',fromWeek:'原教学周',fromDay:'原星期',fromStart:'原开始节次',fromSpan:'原连续节数',fromRoom:'原教室',toWeek:'新教学周',toDay:'新星期',toStart:'新开始节次',toSpan:'新连续节数',toRoom:'新教室'};
  function esc(x){return UI.esc(String(x===undefined?'':x));}
  function db(){return Store.load();}
  function now(){var d=new Date();return UI.dayKey(d)+'T'+UI.toHM(d.getHours()*60+d.getMinutes());}
  function list(module){return module==='adjust'?Adjust.list().filter(function(a){return a.origin==='assistant';}):module==='plan'?db().plans||[]:module==='homework'?db().homeworks||[]:module==='course'?db().courses||[]:module==='lost'?db().lost||[]:module==='qa'?db().qa||[]:[];}
  function find(module,id){var item=list(module).filter(function(x){return (x.id||x.no)===id;})[0];if(!item)throw new Error('目标已不存在，请重新查询。');return item;}
  function ownQuestion(q){return q.author==='我'||q.author===db().user.nickname;}
  function pick(item,fields){var out={};fields.forEach(function(key){if(item[key]!==undefined)out[key]=item[key];});return out;}
  function context(text){
    var modules=[];
    if(/作业|截止|逾期|DDL/i.test(text))modules.push('homework');
    if(/待办|学业|学习|背.*单词|错题|自习|ACM|训练赛/i.test(text))modules.push('homework','plan');
    if(/计划|自习|运动|日程|任务|安排|明天|今天|后天/.test(text))modules.push('plan','course');
    if(/课表|课程|上课|加课|节|老师|教师|语文|高数/.test(text))modules.push('course');
    if(/调课|停课|补课|换教室|改教室|课程调整|改到|改为|换到|取消.*课/.test(text))modules.push('course','adjust','profile');
    if(/失物|丢|捡|找到|招领|物品/.test(text))modules.push('lost');
    if(/问答|问题|回答|提问|采纳|赞同|点赞/.test(text))modules.push('qa');
    if(/昵称|学院|资料|学期|头像/.test(text))modules.push('profile');
    if(!modules.length)modules=['plan','homework','course'];
    refs.forEach(function(r){if(modules.indexOf(r.module)<0)modules.push(r.module);});
    var out={};
    modules.filter(function(x,i,a){return a.indexOf(x)===i;}).forEach(function(module){
      if(module==='profile'){out.profile=[pick(db().user,['nickname','college','termStart'])];return;}
      var records=list(module), words=text.replace(/[，。！？\s]/g,'').toLowerCase();
      records=records.slice().sort(function(a,b){
        var at=String(a.title||a.name||a.course||''),bt=String(b.title||b.name||b.course||'');
        return Number(words.indexOf(bt)>=0)-Number(words.indexOf(at)>=0);
      });
      out[module]=records.slice(0,module==='qa'?8:24).map(function(x){
        var item=pick(x,['id','title','name','date','start','end','due','level','type','course','place','room','teacher','day','span','from','to','repeat','status','resolved','mine','taskGroup']);
        if(module==='plan'){item.taskGroup=Store.isAcademicTask(x)?'academic':'personal';if(x.repeat==='weekly')item.occurrence=Planner.nextPlanOccurrence(x,UI.dayKey());}
        if(module==='adjust'){item.id=x.no;item.title=Adjust.oneLine(x);item.status='applied';}
        if(module==='qa'){item.body=String(x.body||'').slice(0,160);item.mine=ownQuestion(x);}
        return item;
      });
      if(module==='qa')records.slice(0,8).forEach(function(q){(q.answers||[]).slice(0,4).forEach(function(a){out.qa.push({id:q.id,answerId:a.id,title:q.title,body:String(a.body||'').slice(0,120),accepted:!!a.accepted});});});
    });
    if(!out.profile)out.profile=[pick(db().user,['termStart'])];
    return out;
  }
  function query(args){
    var module=args.module, q=(args.query||'').toLowerCase(), filter=args.filter||'', records;
    if(module==='todo'){var hw=query(Object.assign({},args,{module:'homework'})), hwRefs=refs.slice();var task=query(Object.assign({},args,{module:'plan',taskGroup:'academic'}));refs=hwRefs.concat(refs);return '作业：\n'+hw+'\n\n学业任务：\n'+task;}
    if(module==='profile')return ['nickname','college','termStart','avatar'].map(function(k){return fieldNames[k]+'：'+(db().user[k]||'未填写');}).join('\n');
    if(module==='accounts')return Store.accounts().map(function(a){return a.sid;}).join('、')||'尚无本机账号';
    if(module==='today')return Planner.build(null).timeline.map(function(x){return (x.timeLabel||UI.toHM(x.from))+' '+x.title;}).join('\n');
    if(module==='course'&&filter==='today'){
      var wi=UI.weekInfo(),todayCourses=Store.coursesOn(wi.weekday,wi.week).slice().sort(function(a,b){return a.start-b.start;});
      refs=todayCourses.slice(0,24).map(function(x){return {module:'course',id:x.id};});
      if(!todayCourses.length)return '今天没有课程安排。';
      return '今天的课表：\n'+todayCourses.map(function(x,i){
        var first=UI.BELLS[x.start-1]||'时间待定';
        var last=UI.bellEnd(x.start-1+Math.max(1,x.span||1));
        return (i+1)+'. '+x.name+' · '+first+'–'+last+' · '+(x.room||'教室待定')+(x.teacher?' · '+x.teacher:'')+(x.adjusted?'（已调课）':'');
      }).join('\n');
    }

    if(module==='weather'){onWeather();return '已刷新首页天气，请查看左侧天气卡片。';}
    if(module==='all')return ['course','homework','plan','adjust','lost','qa'].map(function(k){return names[k]+' '+list(k).length+' 条';}).join('，');
    records=list(module).filter(function(x){
      if(module==='plan'&&(args.taskGroup==='academic'?!Store.isAcademicTask(x):Store.isAcademicTask(x)))return false;
      var match=!q||[x.title,x.name,x.course,x.body,x.place,x.room,x.desc].join(' ').toLowerCase().indexOf(q)>=0;
      if(!match)return false;
      if(filter==='done')return module==='plan'?Planner.isPlanDone(x,UI.dayKey()):x.status==='done'||x.resolved||x.applied;
      if(filter==='todo')return module==='plan'?!Planner.isPlanDone(x,UI.dayKey()):x.status!=='done'&&!x.resolved&&!x.applied;
      if(filter==='overdue')return module==='plan'?x.repeat!=='weekly'&&x.status!=='done'&&new Date(x.date+'T'+(x.end||x.start||'23:59'))<new Date():x.status!=='done'&&x.due&&new Date(x.due)<new Date();
      if(filter==='high')return x.level===3;
      if(filter==='today')return module==='course'?Store.coursesOn(UI.weekInfo().weekday,UI.weekInfo().week).some(function(c){return c.id===x.id;}):module==='plan'?Planner.planOnDay(x,UI.dayKey(),UI.weekInfo().weekday):module==='adjust'?[(x.from||{}),(x.to||{})].some(function(s){return s.week===UI.weekInfo().week&&s.day===UI.weekInfo().weekday;}):x.date===UI.dayKey()||String(x.due||'').slice(0,10)===UI.dayKey();
      return true;
    });
    refs=records.slice(0,24).map(function(x){return {module:module,id:x.id||x.no};});
    if(!records.length)return '没有符合条件的'+names[module]+'。';
    return records.slice(0,24).map(function(x,i){
      if(module==='adjust')return (i+1)+'. '+Adjust.oneLine(x)+'（已应用，编号 '+x.no+'）';
      return (i+1)+'. '+(x.title||x.name)+(x.due?' · '+x.due.replace('T',' '):x.date?' · '+x.date+' '+(x.start||'')+(x.end?'–'+x.end:''):'')+(x.room?' · '+x.room:'')+(x.place?' · '+x.place:'')+(x.status==='done'||x.resolved?' · 已完成':'')+(x.body?'\n'+String(x.body).slice(0,220):'');
    }).join('\n')+(records.length>24?'\n还有 '+(records.length-24)+' 条，可缩小查询范围。':'');
  }
  function uiOpen(args){
    var files={home:'home.html',plan:'plan.html',schedule:'schedule.html',homework:'homework.html',lost:'lost.html',qa:'qa.html',me:'me.html'};
    sessionStorage.setItem('campus-assistant-ui',JSON.stringify(args));location.href=files[args.page];return '正在打开页面。';
  }
  function execute(raw){
    var c=A.validate(raw),a=c.args,parts=c.tool.split('.'),module=parts[0],op=parts[1],record,result;
    if(c.tool==='query')return query(a);
    if(c.tool==='ui.open')return uiOpen(a);
    if(c.tool==='weather.refresh'){onWeather();return '正在刷新天气。';}
    if(c.tool==='course.import_pdf'){ImportEdu.open({onDone:afterChange});return '请选择课表 PDF，识别后核对导入。';}
    if(c.tool==='data.export'){
      var url=URL.createObjectURL(new Blob([Store.exportJSON()],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='校园百事通备份-'+UI.dayKey()+'.json';link.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);return '备份已导出。';
    }
    if(c.tool==='data.import')return uiOpen({page:'me',action:'backup_import'});
    if(c.tool==='data.reset'){Store.reset();return '已恢复示例数据。';}
    if(c.tool==='data.clear'){Store.clearAll();db().homeworks=[];db().plans=[];db().courseNotices=[];db().eduRawImported=[];db().imported=null;Store.save();return '已清空内容，个人资料保留。';}
    if(c.tool==='course.restore'){Store.clearImported();return '已恢复示例课表。';}
    if(c.tool==='account.switch'){if(!Store.switchTo(a.sid))throw new Error('这个账号尚未在本机登录，请先在登录页登录。');location.href='home.html';return '已切换账号。';}
    if(c.tool==='account.forget'){if(a.sid===Store.currentSid())throw new Error('请先切换或退出当前账号，再移除。');Store.forgetAccount(a.sid);return '已移除本机账号。';}
    if(c.tool==='account.logout'){Store.logout();location.href='index.html';return '已退出登录。';}
    if(c.tool==='profile.update'){Object.keys(a).forEach(function(k){db().user[k]=a[k];});Store.save();var chip=document.querySelector('.userchip');if(chip)chip.innerHTML='<span class="av">'+esc(db().user.avatar)+'</span>'+esc(db().user.nickname)+'<span class="sid">'+esc(Store.currentSid())+'</span>';return '资料已更新。';}
    if(c.tool==='leave.generate'){lastLeave=NL.buildLeave({type:a.type||'事假',teacher:a.teacher||'',start:a.start,slot:a.slot||'全天',days:a.days||1,course:a.course||'',reason:a.reason},Object.assign({},db().user,{name:db().user.nickname,sid:Store.currentSid()}));return lastLeave;}
    if(module==='adjust'){
      if(op==='create'){
        var change=Adjust.addManual(a);
        return '已应用课程调整：'+Adjust.oneLine(change);
      }
      Adjust.removeManual(a.id);
      return '已删除课程调整，课表已恢复。';
    }
    if(module==='lost'){
      if(op==='publish'){db().lost.unshift(Object.assign({id:Store.uid('l'),emoji:'🔍',desc:'',contact:'',place:'未填写',author:db().user.nickname,mine:true,resolved:false,createdAt:a.date?new Date(a.date+'T12:00:00').getTime():Date.now()},a));}
      else{record=find('lost',a.id);if(op==='contact')return record.title+'\n联系方式：'+record.contact+'\n'+(record.desc||'');if(!record.mine)throw new Error('只能修改自己发布的失物信息。');if(op==='delete')db().lost=db().lost.filter(function(x){return x.id!==a.id;});else record.resolved=op==='resolve';}
      Store.save();return A.labels[c.tool]+'完成。';
    }
    if(module==='question'||module==='answer'){
      if(op==='ask'){db().qa.unshift(Object.assign({id:Store.uid('q'),author:db().user.nickname,body:'',tags:['其他'],likes:0,answers:[],createdAt:Date.now()},a));}
      else{
        record=find('qa',a.id);
        if(module==='question'&&op==='delete'){if(!ownQuestion(record))throw new Error('只能删除自己的提问。');db().qa=db().qa.filter(function(x){return x.id!==a.id;});}
        else if(module==='answer'){var ans=(record.answers||[]).filter(function(x){return x.id===a.answerId;})[0];if(!ans)throw new Error('该回答不存在。');ans.likes=(ans.likes||0)+1;}
        else if(op==='reply')record.answers.push({id:Store.uid('a'),body:a.body,author:a.author||db().user.nickname,likes:0,accepted:false,createdAt:Date.now()});
        else if(op==='like')record.likes=(record.likes||0)+1;
        else if(op==='accept'){if(!ownQuestion(record))throw new Error('只有提问者可以采纳回答。');if(!record.answers.some(function(x){return x.id===a.answerId;}))throw new Error('回答不存在。');record.answers.forEach(function(x){x.accepted=x.id===a.answerId;});}
      }
      Store.save();return A.labels[c.tool]+'完成。';
    }
    if(['plan','homework','course'].indexOf(module)>=0){
      var key={plan:'plans',homework:'homeworks',course:'courses'}[module];
      if(op==='create'){
        result=Object.assign(module==='plan'?{type:'学习',start:'',end:'',place:'',level:2,repeat:'none',note:'',status:'todo'}:module==='homework'?{course:'其他',hours:1,level:2,note:'',status:'todo'}:{teacher:'未填写',room:'待定',color:'#3A5BFF'},a);
        A.validate({tool:c.tool,args:pick(result,A.schemas[c.tool].fields)});
        if(module==='plan'&&!a.taskGroup)result.taskGroup=Store.classifyTask(result);
        result.id=Store.uid(module.charAt(0));result.createdAt=Date.now();db()[key].push(result);
      }else{
        record=find(module,a.id);
        if(op==='delete')db()[key]=db()[key].filter(function(x){return x.id!==a.id;});
        else if(op==='update'){
          result=Object.assign({},record,a);A.validate({tool:module+'.create',args:pick(result,A.schemas[module+'.create'].fields)});
          Object.keys(a).forEach(function(k){if(k!=='id')record[k]=a[k];});
          if(module==='plan'&&!a.taskGroup&&(a.title!==undefined||a.type!==undefined))record.taskGroup=Store.classifyTask(record);
        }else if(module==='plan'&&record.repeat==='weekly'){
          var date=a.date||Planner.nextPlanOccurrence(record,UI.dayKey());if(!Planner.planOnDay(record,date,(new Date(date+'T00:00:00').getDay()||7)))throw new Error('这一天不是该重复计划的发生日。');
          record.doneOn=record.doneOn||{};if(op==='complete')record.doneOn[date]=Date.now();else delete record.doneOn[date];
        }else record.status=op==='complete'?'done':'todo';
      }
      Store.save();return A.labels[c.tool]+'完成。';
    }
    throw new Error('暂不支持这个操作。');
  }
  function target(command){var m=command.tool.split('.')[0];if(m==='question'||m==='answer')m='qa';if(command.args.id&&['plan','homework','course','adjust','lost','qa'].indexOf(m)>=0)return find(m,command.args.id);return null;}
  function summary(command){var t=target(command),a=command.args;if(command.tool==='adjust.create'){
      function slot(prefix){return a[prefix+'Week']?'第'+a[prefix+'Week']+'周 周'+('一二三四五六日'[a[prefix+'Day']-1]||'?')+' 第'+a[prefix+'Start']+'-'+(a[prefix+'Start']+a[prefix+'Span']-1)+'节 · '+(a[prefix+'Room']||(prefix==='to'&&a.fromRoom)||'沿用课表教室'):'';}
      return {move:'调课',make:'补课',cancel:'停课',room:'换教室'}[a.type]+'：《'+a.course+'》'+(slot('from')?'\n原安排：'+slot('from'):'')+(slot('to')?'\n新安排：'+slot('to'):a.type==='room'?'\n新教室：'+a.toRoom:'')+(a.reason?'\n原因：'+a.reason:'');
    }return A.labels[command.tool]+(t?'：'+(t.title||t.name||t.course||''):'')+'\n'+Object.keys(a).filter(function(k){return k!=='id'&&k!=='answerId'&&k!=='color';}).map(function(k){var v=a[k];if(k==='level')v={1:'低',2:'中',3:'高'}[v];if(k==='taskGroup')v=v==='academic'?'待办清单（学业）':'课外计划';if(k==='repeat')v=v==='weekly'?'每周':'不重复';return (fieldNames[k]||k)+'：'+(Array.isArray(v)?v.join('、'):v);}).join('\n');}
  function local(text){
    var pages={'打开首页':'home','打开课表':'schedule','打开今日规划':'plan','打开作业':'homework','打开失物':'lost','打开问答':'qa','打开我的':'me','打开个人中心':'me'};
    if(pages[text])return {reply:'为你打开。',actions:[{tool:'ui.open',args:{page:pages[text]}}]};
    var normalized=text.replace(/[\s\?？!！。，“”]/g,'');
    var isCourseQuery=/(?:今天|今日).*(?:课表|课程|(?:有|上|哪|几|查|看).{0,8}课)/.test(normalized)||/(?:课表|课程).*(?:今天|今日)/.test(normalized);
    var isEditing=/(?:新增|添加|创建|加一|删除|移除|取消|调整|修改|改成|替换|导入|同步|补课|调课)/.test(normalized);
    if(isCourseQuery&&!isEditing)return {reply:'',actions:[{tool:'query',args:{module:'course',filter:'today'}}]};

    var shortcuts={'刷新天气':{tool:'weather.refresh',args:{}},'导出数据':{tool:'data.export',args:{}},'导出备份':{tool:'data.export',args:{}},'导入课表':{tool:'course.import_pdf',args:{}},'导入课表PDF':{tool:'course.import_pdf',args:{}},'今天有哪些课':{tool:'query',args:{module:'course',filter:'today'}},'今天的安排':{tool:'query',args:{module:'today'}},'查看待办清单':{tool:'query',args:{module:'todo',filter:'todo'}},'查看逾期作业':{tool:'query',args:{module:'homework',filter:'overdue'}}};
    return shortcuts[text]?{reply:'',actions:[shortcuts[text]]}:null;
  }
  function add(role,text,extra){messages.push(Object.assign({role:role,text:text},extra||{}));if(messages.length>36)messages.shift();}
  function html(){
    return '<aside class="card home-assistant" aria-label="校园 AI 助手"><div class="assistant-head"><div><b>校园 AI 助手</b><small>查询、安排和操作，都可以直接说</small></div><span class="nl-model">DeepSeek Flash</span></div>'+
      '<div class="assistant-messages" id="assistantMessages" role="log" aria-live="polite">'+(messages.length?messages.map(messageHtml).join(''):'<div class="assistant-welcome"><span>✦</span><h3>今天想做些什么？</h3><p>查课表、改作业、安排计划，或者处理校园事务。</p><div class="assistant-examples"><button data-assistant-example="今天有哪些课">今天有哪些课</button><button data-assistant-example="查看逾期作业">查看逾期作业</button><button data-assistant-example="明晚七点图书馆自习两小时">安排明晚自习</button><button data-assistant-example="把我的昵称改成小温">修改我的昵称</button></div></div>')+(busy?'<div class="assistant-thinking">正在理解你的请求…</div>':'')+'</div>'+
      '<div class="assistant-etched-art" aria-hidden="true"><img src="assets/img/assistant-whale-etch.png" alt="" draggable="false"></div>'+
      '<form class="assistant-compose" id="assistantForm"><textarea id="assistantText" rows="3" maxlength="2000" placeholder="例如：数据结构第 3 周周二 6-7 节调到周四 3-4 节，计算机楼 402" aria-label="给 AI 的请求">'+esc(currentDraft)+'</textarea>'+
      (attachedImage?'<div class="assistant-image-preview"><img src="'+esc(attachedImage.data)+'" alt="待识别的调课截图"><span>'+esc(attachedImage.name)+'</span><button type="button" id="assistantRemoveImage" aria-label="移除截图">×</button></div>':'')+
      '<div class="assistant-compose-foot"><button type="button" class="assistant-clear" id="assistantClear">清空对话</button><div class="assistant-compose-actions"><button type="button" class="btn btn-sm" id="assistantPdfAttach" title="上传课表 PDF" aria-label="上传课表 PDF"'+(busy?' disabled':'')+'>📄 PDF</button><input id="assistantPdfFile" type="file" accept=".pdf,application/pdf" hidden><button type="button" class="btn btn-sm" id="assistantAttach"'+(busy?' disabled':'')+'>📎 截图</button><input id="assistantImageFile" type="file" accept="image/png,image/jpeg,image/webp" hidden><button class="btn btn-primary btn-sm" id="assistantSend"'+(busy?' disabled':'')+'>'+(busy?'识别中…':'发送 ↑')+'</button></div></div><small class="assistant-image-hint">课表 PDF 在本机识别，核对后才会替换当前课表；截图会发送至 DeepSeek 识别。</small></form></aside>';
  }
  function messageHtml(m,i){
    var actions=m.actions||[];
    return '<div class="assistant-message '+m.role+'"><div class="assistant-message-text">'+esc(m.text)+'</div>'+actions.map(function(c){try{return '<div class="assistant-proposal">'+esc(summary(c))+'</div>';}catch(e){return '<div class="assistant-proposal">'+esc(A.labels[c.tool])+'</div>';}}).join('')+
      (actions.length&&!m.done?'<div class="assistant-confirm"><button class="btn btn-sm btn-primary" data-assistant-confirm="'+i+'">确认执行</button><button class="btn btn-sm" data-assistant-edit="'+i+'">调整</button><button class="btn btn-sm" data-assistant-cancel="'+i+'">取消</button></div>':'')+(m.done?'<small class="assistant-status">'+esc(m.done)+'</small>':'')+'</div>';
  }
  function paint(){var container=document.querySelector('.home-assistant');if(container){container.outerHTML=html();bind();var log=document.querySelector('#assistantMessages');log.scrollTop=log.scrollHeight;}}
  function fingerprints(actions){return actions.map(function(c){var t=target(c);return t?JSON.stringify(t):null;});}
  async function run(text){
    if(busy||(!text.trim()&&!attachedImage))return;
    var image=attachedImage, requestText=text.trim()||(image?'识别截图中的课程调整，并根据本机课表补全已知信息。':'');
    currentDraft='';attachedImage=null;add('user',requestText+(image?'\n📎 '+image.name:''));busy=true;paint();
    try{
      var response=image?null:local(requestText);
      if(!response){
        controller=new AbortController();var timer=setTimeout(function(){controller.abort();},image?55000:35000);
        try{var payload={text:requestText,now:now(),context:context(image?requestText+' 调课 课表 学期':requestText),history:messages.slice(-5,-1).map(function(m){return {role:m.role==='user'?'user':'assistant',content:m.text+(m.actions?' '+m.actions.map(function(c){return c.tool+' '+JSON.stringify(c.args);}).join(';'):'')};})};if(image)payload.image=image.data;
          var r=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});response=await r.json();if(!r.ok)throw new Error(response.error||'识别失败，请重试。');}finally{clearTimeout(timer);}
      }
      var actions=(response.actions||[]).map(A.validate);
      if(actions.some(function(c){return !A.isReadOnly(c.tool);})){
        if(actions.length>1&&actions.some(function(c){return c.tool.indexOf('account.')===0;}))throw new Error('账号操作请单独发送。');add('assistant','已识别到以下操作，请核对后确认执行。',{actions:actions,original:fingerprints(actions)});}
      else{var results=actions.map(execute);add('assistant',results.join('\n\n')||response.reply||'请再说明一下你的需求。');}
    }catch(e){if(image)attachedImage=image;add('assistant',e.name==='AbortError'?'识别超时，请稍后重试。':e.message);}
    busy=false;controller=null;paint();
  }
  function confirm(index){
    var m=messages[index];if(!m||m.done)return;
    try{
      if(m.original.some(function(f,i){var t=target(m.actions[i]);return f!==null&&f!==JSON.stringify(t);}))throw new Error('这条内容已发生变化，请重新查询并确认。');
      if(m.actions.some(function(c){return A.isReadOnly(c.tool)&&c.tool!=='query';}))throw new Error('请把页面跳转或导入请求单独发送。');
      var saved=Store.exportJSON();backup=saved;
      try{var result=m.actions.map(execute);m.done='已执行';add('assistant',result.join('\n'));}catch(e){Store.importJSON(saved);throw e;}
      afterChange();paint();
    }catch(e){add('assistant',e.message);paint();}
  }
  function edit(index){
    var m=messages[index];if(!m||m.done)return;
    var body=m.actions.map(function(c,i){return '<div class="assistant-edit-group"><b>'+esc(A.labels[c.tool])+'</b>'+Object.keys(c.args).filter(function(k){return k!=='id'&&k!=='answerId'&&k!=='color';}).map(function(k){if(k==='taskGroup')return '<div class="field"><label>归属</label><select class="select" data-ai-field="'+i+':'+k+'"><option value="academic"'+(c.args[k]==='academic'?' selected':'')+'>待办清单（学业）</option><option value="personal"'+(c.args[k]==='personal'?' selected':'')+'>课外计划</option></select></div>';return '<div class="field"><label>'+esc(fieldNames[k]||k)+'</label><input class="input" data-ai-field="'+i+':'+k+'" value="'+esc(Array.isArray(c.args[k])?c.args[k].join('、'):c.args[k])+'"></div>';}).join('')+'</div>';}).join('');
    UI.modal({title:'调整操作',body:body||'<p>这项操作无需额外填写。</p>',footer:'<button class="btn" data-close>取消</button><button class="btn btn-primary" id="assistantEditSave">保存调整</button>',onMount:function(scope,close){document.querySelector('#assistantEditSave').onclick=function(){try{var actions=JSON.parse(JSON.stringify(m.actions));scope.querySelectorAll('[data-ai-field]').forEach(function(el){var path=el.dataset.aiField.split(':'),a=actions[Number(path[0])].args,k=path[1];a[k]=typeof a[k]==='boolean'?el.value==='true':typeof a[k]==='number'?Number(el.value):Array.isArray(a[k])?el.value.split(/[、,，]/).filter(Boolean):el.value;});m.actions=actions.map(A.validate);close();paint();}catch(e){UI.toast(e.message,'err');}};}});
  }
  function readImage(file){
    if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>10000000){UI.toast('请选择 10 MB 以内的 PNG、JPG 或 WebP 图片','err');return;}
    var url=URL.createObjectURL(file), img=new Image();
    img.onload=function(){
      URL.revokeObjectURL(url);
      try{var scale=Math.min(1,1400/Math.max(img.width,img.height));var canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        var data=canvas.toDataURL('image/jpeg',.78);
        if(data.length>2000000)throw new Error('截图过大，请裁剪后重试。');
        attachedImage={name:file.name||'课程调整截图',data:data};paint();
      }catch(e){UI.toast(e.message||'图片处理失败，请换一张截图','err');}
    };
    img.onerror=function(){URL.revokeObjectURL(url);UI.toast('图片无法读取，请换一张截图','err');};
    img.src=url;
  }
  function bind(){
    var input=document.querySelector('#assistantText'),form=document.querySelector('#assistantForm');if(!form)return;
    input.oninput=function(){currentDraft=input.value;};form.onsubmit=function(e){e.preventDefault();run(input.value);};
    input.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();run(input.value);}};
    document.querySelector('#assistantClear').onclick=function(){if(busy)return;messages=[];refs=[];currentDraft='';attachedImage=null;paint();};
    document.querySelector('#assistantPdfAttach').onclick=function(){document.querySelector('#assistantPdfFile').click();};
    document.querySelector('#assistantPdfFile').onchange=function(){
      var file=this.files&&this.files[0];this.value='';if(!file||busy)return;
      ImportEdu.open({file:file,onDone:function(result){
        add('user','📄 '+file.name);
        add('assistant','已从课表 PDF 更新课表，共导入 '+result.courses+' 条课程。');
        afterChange();paint();
      }});
    };
    document.querySelector('#assistantAttach').onclick=function(){document.querySelector('#assistantImageFile').click();};
    document.querySelector('#assistantImageFile').onchange=function(){readImage(this.files&&this.files[0]);};
    var remove=document.querySelector('#assistantRemoveImage');if(remove)remove.onclick=function(){attachedImage=null;paint();};
    input.onpaste=function(e){var items=e.clipboardData&&e.clipboardData.items;if(!items)return;for(var i=0;i<items.length;i++){if(items[i].type.indexOf('image/')===0){e.preventDefault();readImage(items[i].getAsFile());return;}}};
    document.querySelectorAll('[data-assistant-example]').forEach(function(b){b.onclick=function(){run(b.dataset.assistantExample);};});
    document.querySelectorAll('[data-assistant-confirm]').forEach(function(b){b.onclick=function(){confirm(Number(b.dataset.assistantConfirm));};});
    document.querySelectorAll('[data-assistant-edit]').forEach(function(b){b.onclick=function(){edit(Number(b.dataset.assistantEdit));};});
    document.querySelectorAll('[data-assistant-cancel]').forEach(function(b){b.onclick=function(){messages[Number(b.dataset.assistantCancel)].done='已取消';paint();};});
  }
  return {html:html,setup:function(change,weather){afterChange=change||function(){};onWeather=weather||function(){};bind();},execute:execute,context:context,run:run,messages:messages};
})();
