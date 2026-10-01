/* Open existing UI controls after a request from the home assistant. */
(function(){
  document.addEventListener('DOMContentLoaded',function(){
    var raw=sessionStorage.getItem('campus-assistant-ui');if(!raw)return;
    sessionStorage.removeItem('campus-assistant-ui');
    var a;try{a=JSON.parse(raw);}catch(e){return;}
    if(!a||location.pathname.split('/').pop()!==a.page+'.html')return;
    function click(selector){var el=document.querySelector(selector);if(el)el.click();else UI.toast('当前页面没有这个操作入口','err');}
    var add={plan:'#addPlanLink',schedule:'#addCourse',homework:'#addHw',lost:'#publish',qa:'#ask'};
    if(a.action==='add'){if(add[a.page])click(add[a.page]);return;}
    if(a.action==='import'){click(a.page==='me'?'#impCourseMe':'#impCourse');return;}
    if(a.action==='export'){click('#export');return;}
    if(a.action==='backup_import'){click('#import');return;}
    if(a.action==='accounts'){click('#switchAcc');return;}
    if(a.action==='week'&&a.page==='schedule'){
      var cur=UI.weekInfo().week, count=Math.min(20,Math.max(1,Number(a.week)||cur))-cur;
      for(var i=0;i<Math.abs(count);i++)click(count>0?'#nextW':'#prevW');return;
    }
    if(a.query){var q=document.querySelector('#q');if(q){q.value=a.query;q.dispatchEvent(new Event('input',{bubbles:true}));}}
    if(a.filter){
      var attr={homework:'data-filter',lost:'data-type',qa:'data-tag',plan:'data-pfilter'}[a.page];
      if(attr){var chip=Array.from(document.querySelectorAll('['+attr+']')).find(function(x){return x.getAttribute(attr)===a.filter;});if(chip)chip.click();}
    }
    if(a.sort){var sort=document.querySelector(a.page==='homework'?'#sortSel':'#sort');if(sort&&Array.from(sort.options).some(function(o){return o.value===a.sort;})){sort.value=a.sort;sort.dispatchEvent(new Event('change',{bubbles:true}));}}
    if(typeof a.onlyTodo==='boolean'){var toggle=document.querySelector(a.page==='plan'?'[data-todo]':'[data-hide]');if(toggle&&toggle.classList.contains('on')!==a.onlyTodo)toggle.click();}
    if(a.action==='detail'&&a.id){
      var attr=a.page==='schedule'?'data-detail':a.page==='homework'||a.page==='plan'?'data-edit':'data-id';
      var candidates=document.querySelectorAll('['+attr+']');
      var item=Array.from(candidates).find(function(x){return x.getAttribute(attr)===a.id;});
      if(item)item.click();else UI.toast('未找到对应内容，请在列表中查看','err');
    }
  });
})();
