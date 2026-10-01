(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AssistantActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var schemas = {}, labels = {};
  var MAX_PERIODS = 13;
  function tool(name, label, fields, required) { schemas[name] = {fields:fields.split(' ').filter(Boolean), required:(required || '').split(' ').filter(Boolean)}; labels[name]=label; }
  var plan='title type date start end place level repeat note taskGroup', hw='title course due level hours note', course='name teacher room day start span from to color';
  ['plan','homework','course'].forEach(function (kind) {
    var fields=kind==='plan'?plan:kind==='homework'?hw:course, name={plan:'计划',homework:'作业',course:'课程'}[kind];
    tool(kind+'.create','添加'+name,fields,kind==='course'?'name day start span from to':kind==='homework'?'title due':'title date');
    tool(kind+'.update','修改'+name,'id '+fields,'id'); tool(kind+'.delete','删除'+name,'id','id');
    if(kind!=='course'){tool(kind+'.complete','完成'+name,'id date','id');tool(kind+'.reopen','恢复'+name+'待办','id date','id');}
  });
  var adjustment='type course fromWeek fromDay fromStart fromSpan fromRoom toWeek toDay toStart toSpan toRoom reason';
  tool('adjust.create','添加课程调整',adjustment,'type course');
  tool('adjust.delete','删除课程调整','id','id');
  tool('lost.publish','发布失物信息','title type place desc contact emoji date','title type');
  ['resolve','reopen','delete','contact'].forEach(function(op){tool('lost.'+op,{resolve:'标记已找到',reopen:'恢复寻找',delete:'删除失物信息',contact:'查看联系方式'}[op],'id','id');});
  tool('question.ask','发布问题','title body tags author','title');
  tool('question.reply','回答问题','id body author','id body');
  tool('question.delete','删除我的提问','id','id');
  tool('question.like','赞同问题','id','id');
  tool('question.accept','采纳回答','id answerId','id answerId');
  tool('answer.like','点赞回答','id answerId','id answerId');
  tool('profile.update','修改个人资料','nickname college termStart avatar');
  ['export','import','reset','clear'].forEach(function(op){tool('data.'+op,{export:'导出备份',import:'选择备份文件',reset:'恢复示例数据',clear:'清空内容'}[op],'');});
  tool('course.import_pdf','选择课表 PDF',''); tool('course.restore','恢复示例课表','');
  tool('account.switch','切换本机账号','sid','sid'); tool('account.forget','移除本机账号','sid','sid'); tool('account.logout','退出登录','');
  tool('weather.refresh','刷新天气','');
  tool('leave.generate','生成请假条','type teacher start slot days course reason','start reason');
  tool('ui.open','打开页面或操作入口','page action query filter id week sort onlyTodo','page');
  tool('query','查询校园数据','module query filter','module');
  var numeric=['level','hours','day','span','from','to','week','days','fromWeek','fromDay','fromStart','fromSpan','toWeek','toDay','toStart','toSpan'];
  function fail(message){throw new Error(message);}
  function validDate(x){if(!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;var d=new Date(x+'T00:00:00Z');return isFinite(+d)&&d.toISOString().slice(0,10)===x;}
  function validate(command) {
    if(!command||!schemas[command.tool])fail('操作不受支持');
    var spec=schemas[command.tool], input=command.args||{}, out={};
    if(!input||typeof input!=='object'||Array.isArray(input))fail('操作参数格式错误');
    Object.keys(input).forEach(function(key){
      if(spec.fields.indexOf(key)<0)fail('包含不支持的字段');
      var value=input[key];
      if(numeric.indexOf(key)>=0||(key==='start'&&command.tool.indexOf('course.')===0&&/create|update/.test(command.tool))){
        if(typeof value!=='number'||!isFinite(value))fail('数字格式错误');out[key]=value;
      }else if(key==='onlyTodo'){if(typeof value!=='boolean')fail('筛选格式错误');out[key]=value;
      }else if(key==='tags'){
        if(!Array.isArray(value)||value.length>3||value.some(function(x){return typeof x!=='string'||x.length>20;}))fail('话题格式错误');out[key]=value;
      }else{if(typeof value!=='string'||value.length>(['body','reason','desc','note'].indexOf(key)>=0?1200:160))fail('文字格式错误');out[key]=value.trim();}
    });
    spec.required.forEach(function(key){if(out[key]===undefined||out[key]==='')fail('请补充'+key);});
    ['date','termStart'].forEach(function(key){if(out[key]&&!validDate(out[key]))fail('日期格式错误');});
    if(command.tool==='leave.generate'&&out.start&&!validDate(out.start))fail('请假日期错误');
    if(out.due&&(!validDate(out.due.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(out.due)))fail('截止时间错误');
    if(command.tool.indexOf('plan.')===0){
      if(out.taskGroup&&['academic','personal'].indexOf(out.taskGroup)<0)fail('任务归类错误');
      ['start','end'].forEach(function(key){if(out[key]&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(out[key]))fail('时刻格式错误');});
      if(out.start&&out.end&&out.end<=out.start)fail('结束时间应晚于开始时间');
      if(out.type&&['学习','运动','社团','生活','社交','其他'].indexOf(out.type)<0)fail('计划类型错误');
      if(out.repeat&&['none','weekly'].indexOf(out.repeat)<0)fail('重复方式错误');
    }
    if(out.level!==undefined&&[1,2,3].indexOf(out.level)<0)fail('重要度错误');
    if(out.hours!==undefined&&(out.hours<.5||out.hours>24))fail('预计时长错误');
    if(out.days!==undefined&&(out.days<.5||out.days>30))fail('请假天数错误');
    if(command.tool.indexOf('course.')===0&&/create|update/.test(command.tool)){
      ['day','start','span','from','to'].forEach(function(key){if(out[key]!==undefined&&(!Number.isInteger(out[key])||out[key]<1||out[key]>(key==='day'?7:key==='from'||key==='to'?20:MAX_PERIODS)))fail('课程节次或周次错误');});
      if(out.start&&out.span&&out.start+out.span-1>MAX_PERIODS)fail('课程超出作息表');
      if(out.from&&out.to&&out.from>out.to)fail('课程起止周错误');
      if(out.color&&!/^#[0-9a-f]{6}$/i.test(out.color))fail('课程颜色错误');
    }
    if(command.tool==='adjust.create'){
      if(['move','make','cancel','room'].indexOf(out.type)<0)fail('调整类型错误');
      var from=out.type!=='make',to=out.type==='move'||out.type==='make';
      ['from','to'].forEach(function(prefix){
        ['Week','Day','Start','Span'].forEach(function(suffix){var key=prefix+suffix;
          if(out[key]!==undefined&&(!Number.isInteger(out[key])||out[key]<1||out[key]>(suffix==='Week'?20:suffix==='Day'?7:MAX_PERIODS)))fail('课程调整的周次或节次错误');
        });
        if(out[prefix+'Start']&&out[prefix+'Span']&&out[prefix+'Start']+out[prefix+'Span']-1>MAX_PERIODS)fail('课程调整超出作息表');
      });
      if(from&&(!out.fromWeek||!out.fromDay||!out.fromStart||!out.fromSpan))fail('请补充原课程周次、星期和节次');
      if(to&&(!out.toWeek||!out.toDay||!out.toStart||!out.toSpan))fail('请补充新课程周次、星期和节次');
      if(out.type==='room'&&!out.toRoom)fail('请补充新教室');
      if(out.type==='make'&&!out.toRoom)fail('请补充补课地点');
      if(out.type==='room'&&out.toWeek!==undefined&&out.toWeek!==out.fromWeek)fail('换教室不应改变上课周次');
    }
    if(command.tool==='lost.publish'&&['lost','found'].indexOf(out.type)<0)fail('失物类型错误');
    if(command.tool==='ui.open'){
      if(['home','plan','schedule','homework','lost','qa','me'].indexOf(out.page)<0)fail('页面不受支持');
      if(out.action&&['add','import','detail','filter','week','accounts','export','backup_import'].indexOf(out.action)<0)fail('页面操作不受支持');
      if(out.week!==undefined&&(!Number.isInteger(out.week)||out.week<1||out.week>20))fail('周次错误');
    }
    if(command.tool==='query'&&['todo','plan','homework','course','adjust','lost','qa','profile','today','accounts','weather','all'].indexOf(out.module)<0)fail('查询模块错误');
    if(out.sid&&!/^\d{6,20}$/.test(out.sid))fail('账号格式错误');
    return {tool:command.tool,args:out};
  }
  var readOnly=['query','ui.open','weather.refresh','leave.generate','lost.contact','data.export','data.import','course.import_pdf'];
  return {schemas:schemas,labels:labels,validate:validate,validDate:validDate,isReadOnly:function(name){return readOnly.indexOf(name)>=0;},catalog:function(){return Object.keys(schemas).map(function(name){return name+'('+schemas[name].fields.join(',')+')';}).join(';');}};
});
