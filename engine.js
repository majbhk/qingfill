'use strict';
/* Shared DOM form adapter. No network requests; no repeated submission. */
function quickfillEngine(task) {
  if ((location.origin === 'https://docs.qq.com' && location.pathname.startsWith('/form/')) || task.adapter === 'tencent-fixture') return quickfillTencent(task);
  if (task.mode === 'inspect') return {status:'needs_action',message:'结构检查目前适用于腾讯收集表；普通网页请使用一键预填。',filled:0};
  const normalize = value => String(value || '').toLowerCase().replace(/[\s*：:（）()_\-\/]/g, '').trim();
  const aliases = {
    name:['姓名','真实姓名','学生姓名','名字','name','fullname','yourname'],
    studentId:['学号','学生学号','studentid','studentnumber'],
    phone:['手机号','手机号码','联系电话','联系方式','电话','phone','mobile','tel'],
    school:['学校','学校名称','所在学校','school','university'],
    college:['学院','二级学院','所在学院','所属学院','college','department'],
    major:['专业','专业全称','专业名称','major'],
    grade:['年级','所在年级','grade'],
    className:['班级','所在班级','专业班级','classname','class']
  };
  if (task.profile.extraLabel && task.profile.extraValue) aliases.extraValue = [task.profile.extraLabel];
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const inputs = Array.from(document.querySelectorAll('input,textarea,select')).filter(el => visible(el) && !['hidden','password','submit','button','reset','file','checkbox','radio'].includes(el.type) && !el.disabled && !el.readOnly);
  const labelsFor = el => {
    const labels = [...(el.labels || [])].map(l => l.innerText);
    const aria = el.getAttribute('aria-labelledby');
    if(aria) labels.push(...aria.split(/\s+/).map(id => document.getElementById(id)?.innerText || ''));
    labels.push(el.getAttribute('aria-label'), el.name, el.id, el.placeholder);
    if(!labels.filter(Boolean).some(t => Object.values(aliases).some(list => list.some(a => normalize(a) === normalize(t))))) {
      const prev=el.previousElementSibling;
      if(prev&&prev.textContent.length<45)labels.push(prev.textContent);
      const p=el.parentElement;
      if(p&&p.querySelectorAll('input,textarea,select').length===1){
        for(const child of p.children)if(child!==el&&child.textContent.length<45)labels.push(child.textContent);
      }
    }
    return labels.filter(Boolean).map(normalize);
  };
  const descriptors=inputs.map(el=>({el,labels:labelsFor(el)}));
  const fields=[],ambiguous=[];
  for(const [key,list] of Object.entries(aliases)) {
    if(!String(task.profile[key]||'').trim())continue;
    const matches=descriptors.filter(({labels})=>labels.some(label=>list.some(alias=>label===normalize(alias))));
    if(matches.length===1)fields.push({key,el:matches[0].el});
    else if(matches.length>1)ambiguous.push(key);
  }
  const duplicate=fields.some((f,i)=>fields.findIndex(g=>g.el===f.el)!==i);
  if(ambiguous.length||duplicate)return {status:'needs_action',message:'发现含义重复的字段，未自动填写。请在原页面确认。',filled:0};
  if(!fields.length)return {status:'needs_action',message:'没有识别到可填写的标准输入框。腾讯收集表、自定义组件或在线表格需要单独适配。',filled:0};
  const requiredControls=[...document.querySelectorAll('input[required],textarea[required],select[required],[aria-required="true"]')].filter(visible);
  const signature=JSON.stringify({url:location.origin+location.pathname+location.search,fields:fields.map(({key,el})=>({key,tag:el.tagName,type:el.type,id:el.id,name:el.name,labels:labelsFor(el),options:el.tagName==='SELECT'?[...el.options].map(o=>[o.value,o.text]):undefined})),required:requiredControls.map(el=>({tag:el.tagName,type:el.type,name:el.name,id:el.id,label:el.getAttribute('aria-label')}))});
  if(task.mode==='submit'&&task.signature!==signature)return {status:'needs_action',message:'表单与上次试填不一致，已停止自动提交。请重新试填并检查。',filled:0};
  const failed=[];
  for(const {key,el} of fields) {
    const value=String(task.profile[key]);
    if(el.tagName==='SELECT'){
      const options=[...el.options].filter(o=>o.value===value||o.text.trim()===value);
      if(options.length!==1){failed.push(key);continue;}
      el.value=options[0].value;
    }else{
      const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if(setter)setter.call(el,value);else el.value=value;
    }
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    if(el.value!==value&&el.tagName!=='SELECT')failed.push(key);
  }
  if(failed.length)return {status:'needs_action',message:'部分字段没有接受填写内容，请在原页面检查。',filled:fields.length-failed.length};
  if(task.mode!=='submit')return {status:'prefilled',message:`已预填 ${fields.length} 个字段，请到原表单核对并提交。`,filled:fields.length,signature};
  const warningText=(document.body.innerText||'').slice(0,80000);
  if(/验证码|滑动验证|人机验证|完成验证|安全验证|verify you are human|captcha/i.test(warningText))return {status:'needs_action',message:'页面含有验证步骤，已预填，等待人工完成。',filled:fields.length};
  if(document.querySelector('iframe'))return {status:'needs_action',message:'页面包含嵌入式内容，无法确认全部必填项，已停止自动提交。',filled:fields.length};
  const missing=requiredControls.filter(el=>{if(el.checkValidity&&!el.checkValidity())return true;if(el.type==='checkbox')return !el.checked;if(el.type==='radio')return ![...document.getElementsByName(el.name)].some(r=>r.checked);if('value'in el)return !String(el.value||'').trim();return el.getAttribute('aria-checked')!=='true';});
  if(missing.length)return {status:'needs_action',message:`还有 ${missing.length} 项必填内容或选项未完成，未提交。`,filled:fields.length};
  const buttons=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&['提交','提交报名','确认提交','立即报名','submit'].includes(normalize(el.innerText||el.value||el.getAttribute('aria-label'))));
  if(buttons.length!==1)return {status:'needs_action',message:'无法唯一确定提交按钮，已预填，请手动提交。',filled:fields.length};
  const form=buttons[0].form||buttons[0].closest('form');
  if(form&&!form.checkValidity())return {status:'needs_action',message:'表单校验未通过，已停止自动提交。',filled:fields.length};
  buttons[0].click();
  return {status:'submitted_unverified',message:'已点击提交一次，尚未确认报名成功。请查看原平台回执。',filled:fields.length};
}

// Based on DOM observed on the supplied Tencent collection form on 2026-10-23.
// The locked sample was inspected read-only; authenticated submission is not verified.
async function quickfillTencent(task) {
  const norm=s=>String(s||'').trim().replace(/[\s*：:（）()]/g,'').toLowerCase();
  const aliases={name:['姓名','真实姓名'],studentId:['学号','学号不加0'],college:['学院','二级学院','所在学院'],major:['专业','专业全称','专业名称'],grade:['年级','所在年级'],phone:['手机号','手机号码','联系电话','联系方式'],school:['学校','学校名称'],className:['班级','所在班级']};
  if(task.profile.extraLabel&&task.profile.extraValue)aliases.extraValue=[task.profile.extraLabel];
  const visible=el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
  const stop=message=>({status:'needs_action',message,filled:0});
  const pageState=()=>{
    const text=document.body.innerText||'';
    if(/已达收集上限|已达到收集上限|已暂停收集|已结束收集|停止收集|报名已满/.test(text))return '表单已满或暂停收集，未填写、未提交。';
    if(/未开始收集|收集未开始|尚未开始收集|暂未开放/.test(text))return '表单尚未开放，未填写、未提交。';
    if(/收集表登录后才能填写|请先登录后再填写/.test(text))return '请在电脑腾讯文档页面用微信扫码登录，然后再执行。';
    return '';
  };
  const cards=[...document.querySelectorAll('.question-main-content')].filter(visible);
  if(!cards.length)return stop(pageState()||'没有读取到腾讯收集表的题目，请在原页面完成登录或检查链接。');
  const plan=[],issues=[];
  for(const card of cards){
    const title=(card.querySelector('.question-title .form-auto-ellipsis')||card.querySelector('.question-title'))?.textContent?.trim()||'';
    const keys=Object.entries(aliases).filter(([,list])=>list.some(a=>norm(a)===norm(title))).map(([key])=>key);
    const boxes=[...card.querySelectorAll('textarea,input:not([type="hidden"]),select')].filter(visible);
    const radios=[...card.querySelectorAll('[role="radio"]')].filter(visible);
    if(keys.length!==1){issues.push('无法对应题目：'+title);continue;}
    const key=keys[0],value=String(task.profile[key]||'').trim();
    if(!value){issues.push('缺少资料：'+title);continue;}
    if(radios.length&&boxes.length===0){
      const options=radios.map(el=>({el,label:(el.querySelector('.form-choice-option-text-content')?.textContent||el.innerText||'').trim()}));
      const matches=options.filter(o=>norm(o.label)===norm(value));
      if(matches.length!==1){issues.push(title+' 没有唯一匹配选项，请按原选项完整填写（含专升本等说明）');continue;}
      plan.push({card,title,key,value,kind:'radio',el:matches[0].el,options:options.map(o=>o.label)});
    }else if(boxes.length===1&&radios.length===0&&['TEXTAREA','SELECT','INPUT'].includes(boxes[0].tagName)&&!['checkbox','radio','file','password'].includes(boxes[0].type)){
      const el=boxes[0],options=el.tagName==='SELECT'?[...el.options].map(o=>({value:o.value,label:o.text.trim()})):[];
      if(el.tagName==='SELECT'&&options.filter(o=>o.label===value||o.value===value).length!==1){issues.push(title+' 的选项不匹配');continue;}
      plan.push({card,title,key,value,kind:el.tagName.toLowerCase(),el,options});
    }else issues.push('此题型需要手动处理：'+title);
  }
  if(new Set(plan.map(p=>p.key)).size!==plan.length)issues.push('多个题目对应同一资料，请人工确认');
  if(issues.length)return stop(issues.join('；'));
  const signature=JSON.stringify({adapter:'tencent-v1',url:location.origin+location.pathname+location.search,questions:plan.map(p=>({title:p.title,key:p.key,kind:p.kind,options:p.options}))});
  const mapping=plan.map(p=>p.title).join('、');
  if(task.mode==='inspect')return {status:'inspected',signature,filled:0,message:`已检查 ${plan.length} 项：${mapping}。没有填写或提交。${pageState()||'执行前请核对保存的资料。'}`};
  const closed=pageState();if(closed)return stop(closed);
  if(plan.some(p=>p.el.disabled||p.el.readOnly||p.el.getAttribute('aria-disabled')==='true'||p.el.closest('.readonly')))return stop('输入区域当前不可填写，请先登录，或等待组织者开放收集。');
  if(task.mode==='submit'&&task.signature!==signature)return stop('题目或选项与上次检查不一致，未提交。请重新检查表单。');
  for(const p of plan){
    if(p.kind==='radio'){if(p.el.getAttribute('aria-checked')!=='true')p.el.click();}
    else if(p.kind==='select')p.el.value=p.options.find(o=>o.label===p.value||o.value===p.value).value;
    else{const proto=p.kind==='textarea'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(p.el,p.value);}
    if(p.kind!=='radio'){p.el.dispatchEvent(new Event('input',{bubbles:true}));p.el.dispatchEvent(new Event('change',{bubbles:true}));p.el.dispatchEvent(new Event('blur',{bubbles:true}));}
  }
  await new Promise(resolve=>setTimeout(resolve,80));
  const rejected=plan.filter(p=>!p.el.isConnected||(p.kind==='radio'?p.el.getAttribute('aria-checked')!=='true':p.kind==='select'?p.el.value!==p.options.find(o=>o.label===p.value||o.value===p.value).value:p.el.value!==p.value));
  if(rejected.length)return stop('页面未保留部分填写结果：'+rejected.map(p=>p.title).join('、')+'，请人工检查。');
  if(task.mode!=='submit')return {status:'prefilled',signature,filled:plan.length,message:`已预填 ${plan.length} 项（含精确匹配的单选项），请在腾讯文档核对。`};
  const blocked=pageState();if(blocked)return stop(blocked);
  if(/验证码|滑动验证|人机验证|安全验证/.test(document.body.innerText||''))return stop('页面需要人工验证，已停止自动提交。');
  const submit=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&['提交','提交报名','确认提交','立即提交','submit'].includes(norm(el.innerText||el.value||el.getAttribute('aria-label'))));
  if(submit.length!==1)return stop('已预填，但无法唯一确认可用的提交按钮，请在腾讯文档手动提交。');
  submit[0].click();
  return {status:'submitted_unverified',filled:plan.length,message:'已点击提交一次，尚未确认报名成功。请核对腾讯文档回执。'};
}
