import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './config.js';

const $=(s,root=document)=>root.querySelector(s);
const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const configured=!!(SUPABASE_URL&&SUPABASE_PUBLISHABLE_KEY);
const demoKey='tandem-v3-demo-1';
const blank=()=>({profiles:[],groups:[],members:[],tasks:[],reviewers:[],reports:[],approvals:[],reactions:[],reasons:[],rewards:[]});
let mode=configured?'live':'demo',db=null,me=null,d=blank(),screen='home',selectedGroup=null,modal=null,modalId=null,busy=false;
let demoUser=sessionStorage.getItem('tandem-v3-demo-user')||'a',photoCache=new Map(),photoPreviewUrl=null,previousPraiseIds=null;
const pid=()=>crypto.randomUUID?.()||`x-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const now=()=>new Date().toISOString();
const localDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function offsetDay(ymd,n){let x=new Date(`${ymd}T12:00:00Z`);x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)}
function monday(day=localDay()){const x=new Date(`${day}T12:00:00Z`);return offsetDay(day,-(x.getUTCDay()+6)%7)}
const lastMonday=()=>offsetDay(monday(),-7);
const dateISO=x=>String(x||'').slice(0,10);
const jstDate=x=>x?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x)):'';
const timeNum=x=>new Date(x||0).getTime()||0;
const vibrate=x=>{try{navigator.vibrate?.(x)}catch{}};
const who=u=>d.profiles.find(x=>x.id===u)?.display_name||(u===me?'あなた':'メンバー');
const initials=u=>esc(who(u).slice(0,1));
const memberIds=g=>d.members.filter(m=>m.group_id===g).map(m=>m.user_id);
const myGroups=()=>d.groups.filter(g=>memberIds(g.id).includes(me));
const myTasks=()=>d.tasks.filter(t=>t.owner_id===me&&t.active);
const userTasks=u=>d.tasks.filter(t=>t.owner_id===u&&t.active);
const otherIds=()=>[...new Set(d.members.filter(m=>m.user_id!==me&&myGroups().some(g=>g.id===m.group_id)).map(m=>m.user_id))];
const task=id=>d.tasks.find(t=>t.id===id);
const report=id=>d.reports.find(r=>r.id===id);
const reviewers=t=>d.reviewers.filter(r=>r.task_id===t.id).map(r=>r.user_id);
const taskReports=t=>d.reports.filter(r=>r.task_id===t.id&&r.status!=='rejected');
const reportToday=t=>taskReports(t).find(r=>r.local_date===localDay());
const thisWeekReports=t=>taskReports(t).filter(r=>r.local_date>=monday()&&r.local_date<offsetDay(monday(),7));
const finished=t=>t.kind==='extra'?taskReports(t).length>0:thisWeekReports(t).length>=t.weekly_target;
const locked=t=>finished(t)||!!reportToday(t);
const stamps=u=>d.reports.filter(r=>r.reporter_id===u&&r.status==='approved').length;
const messages=u=>d.reactions.filter(r=>r.recipient_id===u);
const myReviews=()=>d.reports.filter(r=>r.status==='pending'&&r.reporter_id!==me&&reviewers(task(r.task_id)||{}).includes(me)&&!d.approvals.some(a=>a.report_id===r.id&&a.reviewer_id===me));
const currentPhoto=p=>p?.startsWith('data:image/')?p:photoCache.get(p)||'';
const nameText=(x)=>esc(x);
const relativeDate=s=>{let today=localDay(),date=dateISO(s);return date===today?'今日':date===offsetDay(today,-1)?'昨日':date.slice(5).replace('-','/')};
function toast(text,err=false){const node=document.createElement('div');node.className='toast'+(err?' error':'');node.textContent=text;$('#toast-layer').append(node);setTimeout(()=>node.remove(),3500)}
function sounds(){try{let C=window.AudioContext||window.webkitAudioContext;if(!C)return;const c=new C();[523,659,784,1046].forEach((freq,i)=>{let o=c.createOscillator(),g=c.createGain(),t=c.currentTime+i*.082;o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.06,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+.2);o.connect(g).connect(c.destination);o.start(t);o.stop(t+.21)});setTimeout(()=>c.close().catch(()=>{}),1000)}catch{}}
function effect(label='GOOD JOB!'){vibrate([30,45,35,35,55]);sounds();if(matchMedia('(prefers-reduced-motion: reduce)').matches){toast(label);return}const layer=$('#fx'),t=document.createElement('div');t.className='fx-word';t.textContent=label;layer.append(t);for(let i=0;i<48;i++){let p=document.createElement('div');p.className='spark';let rad=Math.random()*Math.PI*2,dist=90+Math.random()*250;p.style.setProperty('--x',`${Math.cos(rad)*dist}px`);p.style.setProperty('--y',`${Math.sin(rad)*dist}px`);p.style.setProperty('--spin',`${Math.random()*760-380}deg`);p.style.background=['#c7fa63','#ffffff','#78b5ef','#ffc98c'][i%4];layer.append(p);setTimeout(()=>p.remove(),1400)}setTimeout(()=>t.remove(),1200)}
function weekRate(uid,week=monday()){
 const ts=d.tasks.filter(t=>t.owner_id===uid&&t.kind==='daily'&&t.active&&dateISO(t.created_at)<(week===monday()?offsetDay(localDay(),1):week));
 const den=ts.reduce((s,t)=>s+t.weekly_target,0);
 const num=ts.reduce((s,t)=>s+d.reports.filter(r=>r.task_id===t.id&&r.status==='approved'&&r.local_date>=week&&r.local_date<offsetDay(week,7)).length,0);
 return {done:num,den,rate:den?Math.round(Math.min(1,num/den)*100):null};
}
function fourWeeksRate(uid){let sum=0,den=0;for(let i=1;i<=4;i++){let w=weekRate(uid,offsetDay(monday(),-7*i));sum+=w.done;den+=w.den}return den?`${Math.min(100,Math.round(sum/den*100))}%`:'—'}
function dayStreak(uid){let dates=new Set(d.reports.filter(r=>r.reporter_id===uid&&r.status==='approved').map(r=>r.local_date));let x=dates.has(localDay())?localDay():offsetDay(localDay(),-1),n=0;while(dates.has(x)&&n<366){n++;x=offsetDay(x,-1)}return n}
function lifetimeDays(uid){let ts=d.tasks.filter(t=>t.owner_id===uid),first=ts.map(t=>dateISO(t.created_at)).sort()[0];return first?Math.max(1,Math.floor((new Date(`${localDay()}T12:00:00Z`)-new Date(`${first}T12:00:00Z`))/86400000)+1):0}
function lastWeekBadge(uid){let w=weekRate(uid,lastMonday());if(w.rate===null||w.rate>=40)return null;let reason=d.reasons.find(r=>r.user_id===uid&&r.week_start===lastMonday());return {rate:w.rate,reason}}
function badgeHtml(uid){let z=lastWeekBadge(uid);if(!z)return '';if(!z.reason)return `<span class="badge caution">先週 ${z.rate}% · 説明待ち</span>`;if(z.reason.reason==='本当にサボってました')return `<span class="badge worst">WORST · ${z.rate}%</span>`;return `<span class="badge info">${z.reason.share_reason?esc(z.reason.reason==='その他'?(z.reason.detail||'その他'):z.reason.reason):'事情あり（非公開）'} · ${z.rate}%</span>`}
function getActivity(g){let ids=memberIds(g.id);let taskids=d.tasks.filter(t=>ids.includes(t.owner_id)).map(t=>t.id);return Math.max(timeNum(g.created_at),...d.reports.filter(r=>taskids.includes(r.task_id)).map(r=>timeNum(r.created_at)),...d.reactions.filter(r=>r.group_id===g.id).map(r=>timeNum(r.created_at)))}
function sortedGroups(){return myGroups().sort((a,b)=>{const ap=!!d.members.find(x=>x.group_id===a.id&&x.user_id===me)?.pinned,bp=!!d.members.find(x=>x.group_id===b.id&&x.user_id===me)?.pinned;return +bp-+ap||getActivity(b)-getActivity(a)})}
function icon(name,n=18){const common=`width="${n}" height="${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;const shapes={home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',check:'<path d="m5 12 4 4L19 6"/>',bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l-2.6 2.6a2 2 0 0 0-2.2-.4l-1.4.5h-3.2l-1.4-.5a2 2 0 0 0-2.2.4l-2.6-2.6a2 2 0 0 0 .4-2.2L4 13.6v-3.2L4.5 9a2 2 0 0 0-.4-2.2l2.6-2.6a2 2 0 0 0 2.2.4l1.4-.5h3.2l1.4.5a2 2 0 0 0 2.2-.4l2.6 2.6a2 2 0 0 0-.4 2.2l.5 1.4v3.2z"/>',plus:'<path d="M12 5v14M5 12h14"/>',pin:'<path d="m9 3 6 6m2-6 4 4-4 1-3 3 1 4-3 3-4-4-4 7-1-1 7-4-4-4 3-3 1-4z"/>',chevron:'<path d="m9 18 6-6-6-6"/>',camera:'<path d="M14 4h-4l-2 3H3v13h18V7h-5z"/><circle cx="12" cy="13" r="4"/>',spark:'<path d="m12 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/>',edit:'<path d="m16 4 4 4-12 12H4v-4z"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',gift:'<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M12 9v12M3 13h18M12 9S3 8 5 4s7 5 7 5Zm0 0s9-1 7-5-7 5-7 5Z"/>',share:'<path d="M12 16V2m-4 4 4-4 4 4M4 12v8h16v-8"/>',back:'<path d="m15 18-6-6 6-6"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'};return `<svg ${common}>${shapes[name]||shapes.check}</svg>`}
function saveDemo(){if(mode==='demo')try{localStorage.setItem(demoKey,JSON.stringify(d))}catch{toast('写真の保存容量を超えました。写真を小さくして再度試してください',true)}}
function demoSeed(){const day=localDay(),week=monday(),last=lastMonday(),stamp=now();let g1='pair-1',g2='team-1',g3='pair-2';
 const tasks=[{id:'gym',owner_id:'a',title:'ジムに行く',kind:'daily',weekly_target:3,required_approvals:1,active:true,created_at:offsetDay(last,-10)+'T12:00:00Z'},{id:'read',owner_id:'a',title:'読書20分',kind:'daily',weekly_target:7,required_approvals:2,active:true,created_at:offsetDay(last,-10)+'T12:00:00Z'},{id:'port',owner_id:'a',title:'写真のセレクトを終える',kind:'extra',weekly_target:1,required_approvals:1,active:true,created_at:stamp},{id:'photo',owner_id:'b',title:'毎日1枚撮る',kind:'daily',weekly_target:7,required_approvals:1,active:true,created_at:offsetDay(last,-10)+'T12:00:00Z'},{id:'book',owner_id:'c',title:'英単語を覚える',kind:'daily',weekly_target:5,required_approvals:1,active:true,created_at:offsetDay(last,-10)+'T12:00:00Z'},{id:'walk',owner_id:'d',title:'30分歩く',kind:'daily',weekly_target:4,required_approvals:1,active:true,created_at:offsetDay(last,-10)+'T12:00:00Z'}];
 const reports=[{id:'old-gym',task_id:'gym',reporter_id:'a',image_path:null,note:'先週は1回だけ行けた',local_date:offsetDay(last,2),status:'approved',created_at:offsetDay(last,2)+'T13:00:00Z'},{id:'old-read',task_id:'read',reporter_id:'a',image_path:null,note:'少し読めた',local_date:offsetDay(last,1),status:'approved',created_at:offsetDay(last,1)+'T11:00:00Z'},{id:'photo-now',task_id:'photo',reporter_id:'b',image_path:null,note:'夕方の光がきれいだった。',local_date:day,status:'pending',created_at:stamp},{id:'book-now',task_id:'book',reporter_id:'c',image_path:null,note:'今日は40個クリアしました',local_date:day,status:'approved',created_at:stamp},{id:'walk-now',task_id:'walk',reporter_id:'d',image_path:null,note:'外を30分歩きました！',local_date:day,status:'approved',created_at:stamp}];
 return {profiles:[{id:'a',display_name:'あなた'},{id:'b',display_name:'ハル'},{id:'c',display_name:'ユウ'},{id:'d',display_name:'ミオ'}],groups:[{id:g1,owner_id:'a',name:'ハルとの約束',mode:'pair',invite_code:'PAIRDEMO01',created_at:offsetDay(last,-20)+'T10:00:00Z'},{id:g2,owner_id:'a',name:'制作と生活のグループ',mode:'team',invite_code:'TEAMDEMO01',created_at:offsetDay(last,-18)+'T11:00:00Z'},{id:g3,owner_id:'c',name:'ユウとミオ',mode:'pair',invite_code:'PAIRTWO01',created_at:offsetDay(last,-16)+'T10:00:00Z'}],members:[{group_id:g1,user_id:'a',pinned:true},{group_id:g1,user_id:'b',pinned:false},...['a','b','c','d'].map(x=>({group_id:g2,user_id:x,pinned:x==='a'})),{group_id:g3,user_id:'c',pinned:false},{group_id:g3,user_id:'d',pinned:false}],tasks,reviewers:[{task_id:'gym',user_id:'b'},{task_id:'read',user_id:'b'},{task_id:'read',user_id:'c'},{task_id:'read',user_id:'d'},{task_id:'port',user_id:'b'},{task_id:'photo',user_id:'a'},{task_id:'book',user_id:'a'},{task_id:'walk',user_id:'c'}],reports,approvals:[{report_id:'old-gym',reviewer_id:'b'},{report_id:'old-read',reviewer_id:'b'},{report_id:'old-read',reviewer_id:'c'},{report_id:'book-now',reviewer_id:'a'},{report_id:'walk-now',reviewer_id:'c'}],reactions:[{id:'n1',group_id:g1,task_id:'gym',report_id:null,sender_id:'b',recipient_id:'a',kind:'nudge',message:'今やれ！',created_at:stamp},{id:'n2',group_id:g2,task_id:'read',report_id:null,sender_id:'c',recipient_id:'a',kind:'nudge',message:'そういう日もある',created_at:stamp},{id:'p1',group_id:g2,task_id:'book',report_id:'book-now',sender_id:'a',recipient_id:'c',kind:'praise',message:'よくやった！',created_at:stamp}],reasons:[],rewards:[{id:'reward1',owner_id:'a',title:'好きなものを食べる',stamps_required:10,claimed_at:null,created_at:stamp}]}
}
function initializeDemo(){try{d=JSON.parse(localStorage.getItem(demoKey))||demoSeed()}catch{d=demoSeed()}me=demoUser;saveDemo()}
async function rpc(fn,args={}){const {data,error}=await db.rpc(fn,args);if(error)throw error;return data}
async function refresh(){
 if(mode==='demo'){render();return}
 if(!me){d=blank();previousPraiseIds=null;render();return}
 const prior=previousPraiseIds;
 d=await rpc('snapshot');if(!d.groups)d=blank();
 const praiseIds=new Set(d.reactions.filter(r=>r.recipient_id===me&&r.kind==='praise').map(r=>r.id));
 previousPraiseIds=praiseIds;
 render();
 if(prior&&[...praiseIds].some(id=>!prior.has(id))&&document.visibilityState==='visible'&&!modal){effect('褒められた！');toast('新しい称賛が届きました')}
}
async function boot(){if(!configured){initializeDemo();render();return}try{const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2');db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true}});const {data,error}=await db.auth.getSession();if(error)throw error;me=data.session?.user.id||null;db.auth.onAuthStateChange((_event,s)=>{if(me!==s?.user.id){me=s?.user.id||null;previousPraiseIds=null;setTimeout(()=>refresh().catch(errToast),0)}});await refresh();setInterval(()=>{if(!modal&&!busy&&document.visibilityState==='visible')refresh().catch(()=>{})},20000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!busy)refresh().catch(()=>{})})}catch(err){$('#app').innerHTML=`<section class="welcome"><h2>接続できませんでした</h2><p>${esc(err.message)}</p><button onclick="location.reload()" class="btn primary">再読み込み</button></section>`}}
function errToast(e){toast(e?.message||String(e),true)}
function getGroupsByUser(u){return d.groups.filter(g=>memberIds(g.id).includes(u))}
async function mutate(action,p={}){
 if(mode==='live'){
  const methods={rename:'set_name',createGroup:'create_group',joinGroup:'join_group',pin:'pin_group',addTask:'add_task',editTask:'update_task',report:'send_report',review:'review_report',react:'react',explain:'explain_week',addReward:'add_reward',claim:'claim_reward'};
  const result=await rpc(methods[action],p);await refresh();return result;
 }
 const t=now(),day=localDay();let result;
 switch(action){
  case 'rename':{let x=d.profiles.find(x=>x.id===me);if(x)x.display_name=p.p_name;break}
  case 'createGroup':{
   if(!p.p_name?.trim())throw Error('グループ名を入力してください');let x={id:pid(),owner_id:me,name:p.p_name.trim(),mode:p.p_mode,invite_code:Math.random().toString(36).slice(2,12).toUpperCase(),created_at:t};d.groups.push(x);d.members.push({group_id:x.id,user_id:me,pinned:false});result=x.id;break}
  case 'joinGroup':{let g=d.groups.find(g=>g.invite_code.toUpperCase()===p.p_code.toUpperCase());if(!g)throw Error('デモに存在しないコードです');if(memberIds(g.id).includes(me))break;if(memberIds(g.id).length>=(g.mode==='pair'?2:12))throw Error('人数上限に達しています');d.members.push({group_id:g.id,user_id:me,pinned:false});break}
  case 'pin':{let m=d.members.find(m=>m.group_id===p.p_group&&m.user_id===me);if(!m)throw Error('グループが見つかりません');if(p.p_pinned&&d.members.filter(m=>m.user_id===me&&m.pinned).length>=3)throw Error('固定は3つまでです');m.pinned=p.p_pinned;break}
  case 'addTask':{
   if(!otherIds().length)throw Error('先に2人以上のグループに参加してください');if(p.p_kind==='extra'&&myTasks().some(x=>x.kind==='extra'))throw Error('エクストラは同時に1件までです');
   let id=pid();d.tasks.unshift({id,owner_id:me,title:p.p_title,kind:p.p_kind,weekly_target:p.p_weekly,required_approvals:p.p_required,active:true,created_at:t});d.reviewers.push(...p.p_reviewers.map(user_id=>({task_id:id,user_id})));result=id;break}
  case 'editTask':{
   let x=task(p.p_task);if(!x||x.owner_id!==me)throw Error('編集できません');if(d.reports.some(r=>r.task_id===x.id&&r.status==='pending'))throw Error('承認待ちの報告があります');x.title=p.p_title;x.weekly_target=p.p_weekly;x.required_approvals=p.p_required;x.active=p.p_active;d.reviewers=d.reviewers.filter(r=>r.task_id!==x.id);d.reviewers.push(...p.p_reviewers.map(user_id=>({task_id:x.id,user_id})));break}
  case 'report':{
   let x=task(p.p_task);if(!x||x.owner_id!==me||locked(x))throw Error('すでに報告しています');const id=pid();d.reports.unshift({id,task_id:x.id,reporter_id:me,image_path:p.p_image,note:p.p_note,local_date:day,status:'pending',created_at:t});result=id;break}
  case 'review':{
   let x=report(p.p_report);if(!x||x.status!=='pending'||x.reporter_id===me||!reviewers(task(x.task_id)||{}).includes(me)||d.approvals.some(a=>a.report_id===x.id&&a.reviewer_id===me))throw Error('承認できません');
   if(!p.p_approve){x.status='rejected';result='rejected'}else{d.approvals.push({report_id:x.id,reviewer_id:me,created_at:t});if(d.approvals.filter(a=>a.report_id===x.id).length>=task(x.task_id).required_approvals){x.status='approved';result='approved'}else result='partial'}break}
  case 'react':{
   let x=task(p.p_task);if(!x||x.owner_id===me||!memberIds(p.p_group).includes(me)||!memberIds(p.p_group).includes(x.owner_id))throw Error('送信できません');
   if(p.p_kind==='nudge'){
    if(reportToday(x)||!x.active||finished(x))throw Error('このタスクは報告済みです');
    if(d.reactions.some(r=>r.group_id===p.p_group&&r.task_id===x.id&&r.sender_id===me&&r.kind==='nudge'&&jstDate(r.created_at)===day))throw Error('このタスクには今日は送信済みです');
   } else {let z=report(p.p_report);if(!z||z.task_id!==x.id||z.status!=='approved')throw Error('承認済みの報告を選んでください');if(d.reactions.some(r=>r.report_id===z.id&&r.sender_id===me&&r.kind==='praise'))throw Error('この報告は褒めました')}
   d.reactions.unshift({id:pid(),group_id:p.p_group,task_id:x.id,report_id:p.p_report,sender_id:me,recipient_id:x.owner_id,kind:p.p_kind,message:p.p_message,created_at:t});break}
  case 'explain':{
   let z=lastWeekBadge(me);if(!z)throw Error('対象ではありません');d.reasons=d.reasons.filter(r=>!(r.user_id===me&&r.week_start===p.p_week));d.reasons.push({user_id:me,week_start:p.p_week,reason:p.p_reason,detail:p.p_detail,share_reason:p.p_share,created_at:t});break}
  case 'addReward':{d.rewards.push({id:pid(),owner_id:me,title:p.p_title,stamps_required:p.p_stamps,claimed_at:null,created_at:t});break}
  case 'claim':{let x=d.rewards.find(r=>r.id===p.p_reward&&r.owner_id===me);if(!x||x.claimed_at||stamps(me)<x.stamps_required)throw Error('交換できません');x.claimed_at=t;break}
 }
 saveDemo();render();return result;
}
function bar(done,total){let pct=total?Math.min(100,done/total*100):0;return `<div class="progress"><span style="width:${pct}%"></span></div>`}
function personChip(uid){return `<span class="avatar">${initials(uid)}</span>`}
function statCard(label,value,detail=''){return `<div class="stat"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div>${detail?`<div class="stat-detail">${esc(detail)}</div>`:''}</div>`}
function actionButton(label,type,id='',other='',cls=''){return `<button type="button" class="${cls||'btn secondary'}" data-action="${esc(type)}" data-id="${esc(id)}" ${other?`data-val="${esc(other)}"`:''}>${label}</button>`}
function shell(content){const nav=[['home','ホーム','home'],['groups','グループ','users'],['inbox','通知・承認','bell'],['settings','設定','settings']];return `<div class="shell"><header class="top"><div class="wordmark">TANDEM<span>.</span><small>KEEP IT GOING</small></div><button class="profile-pill" data-action="nav" data-id="settings">${personChip(me)} <span>${esc(who(me))}</span></button></header>
<main class="main">${content}</main><nav class="bottom-nav" aria-label="メインメニュー">${nav.map(([id,label,ic])=>`<button data-action="nav" data-id="${id}" class="${screen===id?'active':''}">${icon(ic,20)}<span>${label}</span>${id==='inbox'&&myReviews().length?`<b class="nav-dot">${myReviews().length}</b>`:''}</button>`).join('')}</nav></div>`}
function welcome(){return `<section class="welcome"><div class="hero-orb">T.</div><h1>ともに、続ける。</h1><p>報告する。承認される。続けた分だけ、形になる。</p><form data-form="signup" class="stack"><label>表示名<input name="name" maxlength="30" placeholder="あなたの名前" required></label><button type="submit" class="btn primary large">はじめる ${icon('chevron')}</button></form><p class="tiny">メール不要のゲスト登録です。端末を変えると復元できない場合があります。</p></section>`}
function home(){const daily=myTasks().filter(t=>t.kind==='daily'),extras=myTasks().filter(t=>t.kind==='extra'),week=weekRate(me),msgs=messages(me),last=lastWeekBadge(me);return `<div class="eyebrow">TODAY · ${esc(localDay().replaceAll('-','.'))}</div><h1 class="page-title">今日も、やる。</h1><p class="subtitle">${esc(who(me))} のデイリータスク</p>
<div class="quick-stats">${statCard('累計達成',stamps(me)+'件')}${statCard('過去4週の成功率',fourWeeksRate(me))}${statCard('活動開始から',lifetimeDays(me)+'日')}</div>
${last&&!last.reason?`<button class="weekly-alert" data-action="reason">${icon('bell',18)}<span>先週の達成率 ${last.rate}% · 一言、理由を教えてください</span>${icon('chevron')}</button>`:''}
<div class="section-head"><h2>デイリータスク</h2><button class="add-text" data-action="new-task" data-id="daily">${icon('plus',16)} 追加</button></div>
<p class="section-desc">スクラッチして完了報告へ。承認されるとスタンプ獲得。</p>
${daily.length?daily.map(taskTile).join(''):`<div class="empty small">まだタスクがありません。<button class="text-button" data-action="new-task" data-id="daily">最初のタスクを作る</button></div>`}
<div class="section-head section-gap"><h2>エクストラ</h2>${!extras.length?`<button class="add-text" data-action="new-task" data-id="extra">${icon('plus',16)} 追加</button>`:''}</div>
${extras.length?extras.map(taskTile).join(''):`<button class="empty-action" data-action="new-task" data-id="extra">${icon('plus',18)} そのほかに今日やることを1つ追加</button>`}
<div class="section-head section-gap"><h2>あなたのグループ</h2><button class="add-text" data-action="nav" data-id="settings">${icon('plus',16)} 作成・参加</button></div>
<p class="section-desc">固定は3件まで。ほかは最近の活動順です。</p>
${sortedGroups().length?sortedGroups().map(groupTile).join(''):`<div class="empty small">グループを作るか招待コードで参加してください。</div>`}
<div class="section-head section-gap"><h2>反応が届いています</h2><button class="add-text" data-action="nav" data-id="inbox">全部見る ${icon('chevron',14)}</button></div>
${msgs.length?msgs.sort((a,b)=>timeNum(b.created_at)-timeNum(a.created_at)).slice(0,2).map(messageCard).join(''):`<p class="muted">まだメッセージはありません。</p>`}
${rewardSummary()}</div>`}
function taskTile(t){let weekly=thisWeekReports(t),approved=weekly.filter(r=>r.status==='approved').length,reported=weekly.filter(r=>r.status==='pending').length,lockedNow=locked(t),last=reportToday(t)||taskReports(t).sort((a,b)=>timeNum(b.created_at)-timeNum(a.created_at))[0];const label=lockedNow?finished(t)?'今週の目標まで報告済み':last?.status==='pending'?'承認を待っています':'今日は報告済み':'こすって完了を報告';return `<article class="task-tile" data-task="${esc(t.id)}"><div class="task-top"><div><div class="task-type">${t.kind==='extra'?'EXTRA':`WEEKLY ${t.weekly_target} TIMES`}</div><h3>${esc(t.title)}</h3></div><button class="icon-btn" aria-label="タスク設定" data-action="edit-task" data-id="${esc(t.id)}">${icon('more',20)}</button></div>
<div class="task-progress"><span>${t.kind==='extra'?'単発タスク':`今週 ${approved} / ${t.weekly_target} 回承認`}${reported?` · ${reported}件確認待ち`:''}</span><span>${t.kind==='extra'?`${taskReports(t).length?'報告済み':'未完了'}`:`${Math.round(approved/t.weekly_target*100)}%`}</span></div>
${bar(t.kind==='extra'?taskReports(t).length:approved,t.weekly_target)}
${lockedNow?`<div class="submitted-state">${icon(last?.status==='approved'?'check':'lock',17)} ${esc(label)} ${last?`<span>· ${esc(relativeDate(last.local_date))}</span>`:''}</div>`:`<div class="scratch" data-scratch="${esc(t.id)}"><div class="scratch-reveal"><span>${icon('check',20)} ${esc('報告する！')}</span></div><canvas class="scratch-canvas" aria-label="こすって報告" role="button" tabindex="0"></canvas></div><button class="text-button fallback" data-action="open-report" data-id="${esc(t.id)}">スクラッチできない場合はこちら</button>`}
</article>`}
function groupTile(g){let count=memberIds(g.id).length,m=d.members.find(x=>x.group_id===g.id&&x.user_id===me),pending=d.reports.filter(r=>memberIds(g.id).includes(r.reporter_id)&&r.status==='pending').length;return `<article class="group-row"><button class="group-open" data-action="open-group" data-id="${esc(g.id)}"><span class="group-emoji">${g.mode==='pair'?'Ⅱ':'◈'}</span><div class="group-info"><b>${esc(g.name)}</b><small>${g.mode==='pair'?'二者モード':'複数人モード'} · ${count}人${pending?` · 報告待ち ${pending}件`:''}</small></div>${icon('chevron',18)}</button><button class="pin-btn ${m?.pinned?'pinned':''}" aria-label="${m?.pinned?'固定を解除':'固定する'}" data-action="pin" data-id="${esc(g.id)}" data-val="${m?.pinned?'off':'on'}">${icon('pin',18)}</button></article>`}
function rewardSummary(){let rewards=d.rewards.filter(r=>r.owner_id===me&&!r.claimed_at);if(!rewards.length)return '';let r=rewards.sort((a,b)=>a.stamps_required-b.stamps_required)[0];return `<div class="reward-small"><span class="reward-glyph">${icon('gift',25)}</span><div><b>${esc(r.title)}</b><small>スタンプ ${stamps(me)} / ${r.stamps_required}</small>${bar(stamps(me),r.stamps_required)}</div>${stamps(me)>=r.stamps_required?actionButton('交換','claim',r.id,'','btn primary'):`<span class="reward-lock">あと${r.stamps_required-stamps(me)}</span>`}</div>`}
function groupsScreen(){let groups=sortedGroups();if(!groups.length)return `<div class="page-intro"><h1>グループ</h1><p>まずは二者モードか複数人モードのグループを作りましょう。</p></div><button class="btn primary block" data-action="new-group">グループを作る</button>`;
 let g=groups.find(x=>x.id===selectedGroup)||groups[0];selectedGroup=g.id;let ids=memberIds(g.id),allActive=d.reactions.filter(r=>r.group_id===g.id).sort((a,b)=>timeNum(b.created_at)-timeNum(a.created_at)).slice(0,5);
 return `<div class="page-intro"><div class="eyebrow">${g.mode==='pair'?'PAIR MODE':'TEAM MODE'}</div><h1>${esc(g.name)}</h1><p>${ids.length}人で見届けています。タスクはほかのグループと共通です。</p></div>
 <div class="invite-strip"><div><small>INVITATION CODE</small><strong>${esc(g.invite_code)}</strong></div><button data-action="copy" data-id="${esc(g.id)}">コピー ${icon('share',16)}</button></div>
 <div class="member-tabs">${ids.map(uid=>`<button class="member-tab ${uid===me?'self':''}" data-action="jump-member" data-id="${esc(uid)}">${personChip(uid)}<span>${esc(who(uid))}</span></button>`).join('')}</div>
 <div class="section-head"><h2>みんなの進捗</h2><span class="small-muted">今週</span></div>
 ${ids.map(uid=>memberPanel(g,uid)).join('')}
 <div class="section-head section-gap"><h2>グループの声</h2></div>
 ${allActive.length?allActive.map(messageCard).join(''):`<p class="muted">まだ声かけはありません。</p>`}
 </div>`}
function memberPanel(g,uid){let ts=userTasks(uid),w=weekRate(uid),z=lastWeekBadge(uid);return `<section class="member-panel" id="person-${esc(uid)}"><div class="member-head">${personChip(uid)}<div class="member-id"><h3>${esc(who(uid))} ${uid===me?'<span class="self-label">あなた</span>':''}</h3><span>${w.rate===null?'今週の目標なし':`今週 ${w.done}/${w.den} 件承認`} · 累計${stamps(uid)}件</span></div>${badgeHtml(uid)}</div>
 ${z?.reason&&z.reason.reason!=='本当にサボってました'?`<div class="reason-bubble">先週の理由：${z.reason.share_reason?esc(z.reason.reason==='その他'?(z.reason.detail||'その他'):z.reason.reason):'事情あり（非公開）'}</div>`:''}
 ${ts.length?ts.map(t=>groupTaskRow(g,t)).join(''):'<p class="muted indent">タスクなし</p>'}</section>`}
function groupTaskRow(g,t){let recent=taskReports(t).sort((a,b)=>timeNum(b.created_at)-timeNum(a.created_at))[0],today=reportToday(t),wr=thisWeekReports(t).filter(r=>r.status==='approved').length,isMine=t.owner_id===me;let photo=recent&&currentPhoto(recent.image_path),reportedToday=!!today,approvedReport=taskReports(t).filter(r=>r.status==='approved').sort((a,b)=>timeNum(b.created_at)-timeNum(a.created_at))[0];
 let sentNudge=d.reactions.some(r=>r.group_id===g.id&&r.task_id===t.id&&r.sender_id===me&&r.kind==='nudge'&&jstDate(r.created_at)===localDay());
 let sentPraise=approvedReport&&d.reactions.some(r=>r.report_id===approvedReport.id&&r.sender_id===me&&r.kind==='praise');
 let todayStatus=today?(today.status==='pending'?'報告済・承認待ち':'今日の報告を承認済み'):(finished(t)?'今週の目標分を報告済み':'今日まだ未報告');
 return `<div class="group-task"><div class="group-task-main"><span class="tiny-status ${reportedToday?'status-done':''}">${reportedToday?'●':'○'}</span><div class="group-task-body"><div class="group-task-title">${esc(t.title)}</div><small>${t.kind==='daily'?`今週 ${wr}/${t.weekly_target} 承認`:'エクストラ'} · ${todayStatus}</small></div></div>
 ${recent?`<button class="report-mini" data-action="view-report" data-id="${esc(recent.id)}">${photo?`<img src="${esc(photo)}" alt="報告写真">`:`<span class="mini-photo" data-mini-photo="${esc(recent.image_path||'')}">${icon('camera',15)}</span>`}<div><span>${esc(recent.note||'コメントなし')}</span><small>${relativeDate(recent.local_date)} · 報告を見る</small></div>${icon('chevron',14)}</button>`:''}
 ${!isMine?`<div class="actions-inline">${!reportedToday&&!sentNudge&&!finished(t)?actionButton('発破をかける','new-react',t.id,`nudge:${g.id}`,'chip-button nudge'):''}${approvedReport&&!sentPraise?actionButton('褒める！','new-react',t.id,`praise:${g.id}:${approvedReport.id}`,'chip-button praise'):''}${reportedToday&&today?.status==='pending'&&reviewers(t).includes(me)&&!d.approvals.some(a=>a.report_id===today.id&&a.reviewer_id===me)?actionButton('承認する','view-report',today.id,'','chip-button outline'):''}</div>`:''}
 </div>`}
function messageCard(r){let x=task(r.task_id),g=d.groups.find(g=>g.id===r.group_id);let self=r.recipient_id===me;return `<div class="message-card ${r.kind==='praise'?'praise-card':'nudge-card'}"><div class="message-sign">${r.kind==='praise'?icon('spark',20):icon('bell',19)}</div><div class="message-text"><small>${esc(who(r.sender_id))} → ${esc(who(r.recipient_id))} · ${esc(g?.name||'グループ')}</small><strong>${esc(r.message)}</strong><span>対象：${esc(x?.title||'タスク')} · ${relativeDate(r.created_at)}</span></div>${self&&r.kind==='praise'?`<button class="replay" data-action="replay" aria-label="称賛を受け取る">${icon('spark',18)}</button>`:''}</div>`}
function inbox(){let reviews=myReviews(),msgs=messages(me).sort((a,b)=>timeNum(b.created_at)-timeNum(a.created_at)),n=msgs.filter(x=>x.kind==='nudge').length,p=msgs.filter(x=>x.kind==='praise').length;
 return `<div class="page-intro"><div class="eyebrow">INBOX</div><h1>通知と承認</h1><p>相手の報告を承認して、継続を後押し。</p></div>
 <div class="quick-stats">${statCard('承認済みタスク',stamps(me)+'件')}${statCard('発破をもらった',n+'件')}${statCard('褒められた',p+'件')}</div>
 <div class="section-head section-gap"><h2>あなたの承認待ち</h2><span class="badge ${reviews.length?'caution':''}">${reviews.length}件</span></div>
 ${reviews.length?reviews.map(r=>{let t=task(r.task_id);return `<button class="inbox-review" data-action="view-report" data-id="${esc(r.id)}">${personChip(r.reporter_id)}<span><b>${esc(who(r.reporter_id))} · ${esc(t?.title)}</b><small>${esc(r.note||'コメントなし')} · ${relativeDate(r.created_at)}</small></span>${icon('chevron',18)}</button>`}).join(''):'<div class="empty small">承認待ちはありません。</div>'}
 <div class="section-head section-gap"><h2>届いた声</h2><span class="small-muted">累計 ${msgs.length}件</span></div>
 ${msgs.length?msgs.slice(0,70).map(messageCard).join(''):'<div class="empty small">発破・称賛はまだありません。</div>'}</div>`}
function settings(){let rewards=d.rewards.filter(r=>r.owner_id===me).sort((a,b)=>a.stamps_required-b.stamps_required);return `<div class="page-intro"><div class="eyebrow">YOUR SPACE</div><h1>設定とご褒美</h1><p>参加グループ、承認ルール、報酬を管理します。</p></div>
 <div class="settings-user">${personChip(me)}<div><b>${esc(who(me))}</b><small>${mode==='demo'?'デモ（この端末だけ保存）':'オンライン共有中'}</small></div>${actionButton(icon('edit'),'rename','','','icon-btn')}</div>
 <div class="section-head section-gap"><h2>グループ</h2><span class="small-muted">${myGroups().length}/20</span></div>
 <div class="dual-actions"><button class="btn primary" data-action="new-group">${icon('plus',18)} グループを作る</button><button class="btn secondary" data-action="join-group">招待コードで参加</button></div>
 ${sortedGroups().map(groupTile).join('')}
 <div class="section-head section-gap"><h2>プライズ</h2>${actionButton(icon('plus',16)+' 追加','new-reward','','','add-text')}</div>
 <div class="reward-big"><div class="reward-count">${icon('gift',27)} <b>${stamps(me)}</b><span>STAMP</span></div><p>承認されたタスク1件 = 1スタンプ。すべてのグループで共通です。</p></div>
 ${rewards.length?rewards.map(r=>`<div class="reward-line"><div><b>${esc(r.title)}</b><small>${stamps(me)}/${r.stamps_required} スタンプ ${r.claimed_at?'· 受取済み':''}</small></div>${r.claimed_at?icon('check',20):stamps(me)>=r.stamps_required?actionButton('受け取る','claim',r.id,'','btn primary'):icon('lock',18)}</div>`).join(''):'<p class="muted">目標スタンプを決めてご褒美を設定できます。</p>'}
 ${mode==='demo'?`<div class="section-head section-gap"><h2>デモでユーザー切替</h2></div><p class="section-desc">1台で相互承認を体験できます。別端末には同期されません。</p><div class="user-switch">${d.profiles.map(p=>`<button class="${me===p.id?'selected':''}" data-action="switch" data-id="${esc(p.id)}">${personChip(p.id)} ${esc(p.display_name)}</button>`).join('')}</div><button class="text-button muted-button" data-action="reset-demo">デモデータを初期化</button>`:''}
 <button class="install-row" data-action="install">${icon('share',20)} iPhone / Android にホーム画面追加 ${icon('chevron',18)}</button>
 <p class="tiny disclaimer">週次40%未満の理由は本人のみ選べます。体調・精神面などの理由は公開するか選択可能です。メッセージは1件ずつ対象タスクと送信グループが記録されます。</p></div>`}
function render(){if(!me){$('#app').innerHTML=welcome();return}const body=screen==='home'?home():screen==='groups'?groupsScreen():screen==='inbox'?inbox():settings();$('#app').innerHTML=shell(body);activateScratches();loadPhotos()}
function closeModal(){modal=null;modalId=null;$('#modal-layer').innerHTML='';document.body.classList.remove('modal-open');if(photoPreviewUrl){URL.revokeObjectURL(photoPreviewUrl);photoPreviewUrl=null}}
function modalWrap(title,body){return `<div class="modal-overlay" data-action="close-bg"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="modal-header"><h2>${esc(title)}</h2><button class="modal-close" data-action="close" aria-label="閉じる">×</button></header><div class="modal-body">${body}</div></section></div>`}
function openModal(type,id=null){modal=type;modalId=id;const views={task:()=>taskForm(id),edit:()=>taskEditForm(id),report:()=>reportForm(id),reaction:()=>reactionForm(id),review:()=>reviewForm(id),group:groupForm,join:joinForm,reward:rewardForm,rename:renameForm,reason:reasonForm,install:installForm};const titles={task:'タスクを追加',edit:'タスクの設定',report:'達成報告',reaction:'ひと声かける',review:'報告を確認',group:'グループを作る',join:'招待コードで参加',reward:'ご褒美を決める',rename:'表示名の変更',reason:'先週の振り返り',install:'アプリとして使う'};$('#modal-layer').innerHTML=modalWrap(titles[type],views[type]());document.body.classList.add('modal-open');loadPhotos()}
function reviewerOptions(selected=[],required=1){let people=otherIds();return `<label>承認してくれる人 <small>（複数選択できます）</small></label><div class="reviewer-list">${people.length?people.map(uid=>`<label class="reviewer-choice"><input type="checkbox" name="reviewer" value="${esc(uid)}" ${selected.includes(uid)?'checked':''}><span>${personChip(uid)} ${esc(who(uid))}</span></label>`).join(''):'<p class="muted">同じグループのほかのメンバーが必要です。</p>'}</div><label>何人の承認で完了？<select name="required">${Array.from({length:Math.max(1,people.length)},(_,i)=>i+1).map(n=>`<option value="${n}" ${n===required?'selected':''}>${n}人の承認</option>`).join('')}</select></label><p class="field-hint">1人なら二者で承認。候補3人・必要2人なら「3人のうち2人」で達成します。タスクは全グループ共通です。</p>`}
function taskForm(kind){let extra=kind==='extra';return `<form data-form="task" class="form-stack"><input type="hidden" name="kind" value="${extra?'extra':'daily'}"><label>${extra?'エクストラ':'いつものデイリータスク'}<input name="title" maxlength="70" required placeholder="${extra?'例：ポートフォリオを提出':'例：ジムに行く'}"></label>${extra?'':`<label>1週間の目標回数<select name="weekly">${Array.from({length:7},(_,i)=>i+1).map(n=>`<option value="${n}" ${n===7?'selected':''}>週${n}回${n===7?'（毎日）':''}</option>`).join('')}</select></label>`}${reviewerOptions(otherIds().slice(0,1),1)}<button type="submit" class="btn primary block large">${icon('plus',18)} タスクを追加</button></form>`}
function taskEditForm(id){let x=task(id);if(!x)return '<p>タスクが見つかりません。</p>';return `<form data-form="edit" class="form-stack"><label>タスク名<input name="title" required maxlength="70" value="${esc(x.title)}"></label>${x.kind==='daily'?`<label>週の目標回数<select name="weekly">${Array.from({length:7},(_,i)=>i+1).map(n=>`<option value="${n}" ${n===x.weekly_target?'selected':''}>週${n}回</option>`).join('')}</select></label>`:''}${reviewerOptions(reviewers(x),x.required_approvals)}<label class="check-line"><input type="checkbox" name="active" ${x.active?'checked':''}>有効なタスクとして表示する</label><p class="field-hint">承認待ち報告がある間は変更不可。過去の承認履歴は消えません。</p><button type="submit" class="btn primary block">設定を保存</button></form>`}
function reportForm(id){let x=task(id);return `<form class="form-stack" data-form="report"><div class="task-title-preview">${icon('check',22)} <span>${esc(x?.title||'タスク')}</span></div><label class="upload-box"><input type="file" name="photo" accept="image/*" capture="environment"><span class="upload-icon">${icon('camera',27)}</span><strong>写真を追加（任意）</strong><small>撮影する / ギャラリーから選ぶ</small><img id="photo-preview" alt="添付画像" hidden></label><label>ひとこと<input name="note" maxlength="300" placeholder="例：今日は30分できました"></label><div class="hint-box">報告後は承認待ちになります。設定した人数の承認が揃うと、すべての参加グループに達成が反映されます。</div><button type="submit" class="btn primary block large">${icon('spark',18)} 完了を報告する</button></form>`}
function groupForm(){return `<form class="form-stack" data-form="group"><label>グループ名<input name="name" placeholder="例：ハルとの約束" maxlength="40" required></label><label>モードを選ぶ</label><div class="mode-grid"><label><input type="radio" name="mode" value="pair" checked><span><b>Ⅱ　二者モード</b><small>最大2人・相互監視</small></span></label><label><input type="radio" name="mode" value="team"><span><b>◈　複数人モード</b><small>最大12人・複数承認</small></span></label></div><div class="hint-box">タスクはグループ別に作り直す必要がありません。どのグループにも同じ進捗が表示されます。</div><button type="submit" class="btn primary block large">グループを作成</button></form>`}
function joinForm(){return `<form data-form="join" class="form-stack"><label>招待コード<input name="code" maxlength="30" required autocapitalize="characters" placeholder="例：TEAMDEMO01"></label><button class="btn primary block large" type="submit">グループに参加</button></form>`}
function reactionForm(id){const [kind,gid,rid,tid]=id.split('|'),x=task(tid),g=d.groups.find(g=>g.id===gid);let options=kind==='nudge'?['やれ！','今やれ！','そういう日もある','サボるな！']:['よくやった！','えらい！','進め','最高！'];return `<form data-form="reaction" class="form-stack"><input type="hidden" name="kind" value="${esc(kind)}"><input type="hidden" name="gid" value="${esc(gid)}"><input type="hidden" name="tid" value="${esc(tid)}"><input type="hidden" name="rid" value="${esc(rid)}"><div class="hint-box"><b>${esc(who(x.owner_id))} へ</b><br>対象タスク：${esc(x.title)}<br>送信先：${esc(g?.name)}</div><label>${kind==='nudge'?'発破のことば':'称賛のことば'}</label><div class="phrase-grid">${options.map((str,i)=>`<label><input type="radio" name="phrase" value="${esc(str)}" ${i===0?'checked':''}><span>${esc(str)}</span></label>`).join('')}<label><input type="radio" name="phrase" value="custom"><span>その他 · 自由入力</span></label></div><label id="custom-label" hidden>自由なメッセージ<textarea name="custom" maxlength="140" rows="2" placeholder="140文字以内"></textarea></label><div class="field-hint">発破は送信者ごとに同じタスク・同じグループへ1日1回まで。褒めるのは報告1件につき1回まで。</div><button class="btn primary block large" type="submit">${kind==='nudge'?'発破を送る':'褒める！'}</button></form>`}
function reviewForm(id){let r=report(id),t=task(r?.task_id);if(!r||!t)return '<p>報告が見つかりません。</p>';let a=d.approvals.filter(a=>a.report_id===r.id).length,canReview=r.status==='pending'&&r.reporter_id!==me&&reviewers(t).includes(me)&&!d.approvals.some(a=>a.report_id===r.id&&a.reviewer_id===me);let photo=currentPhoto(r.image_path);return `<div class="form-stack"><div class="report-review-head">${personChip(r.reporter_id)} <div><b>${esc(who(r.reporter_id))} の報告</b><small>${esc(t.title)} · ${esc(relativeDate(r.local_date))}</small></div></div><div class="proof-large" data-photo-container="${esc(r.image_path||'')}">${photo?`<img src="${esc(photo)}" alt="報告の写真">`:r.image_path?'写真を読み込んでいます…':'写真の添付なし'}</div><div class="hint-box">${esc(r.note||'コメントなし')}</div><div class="report-approval-count"><span>承認進捗</span><b>${a} / ${t.required_approvals} 人</b></div>${bar(a,t.required_approvals)}<p class="field-hint">承認担当：${esc(reviewers(t).map(who).join('・'))}</p>${canReview?`<div class="dual-actions">${actionButton('差し戻す','review',r.id,'no','btn secondary')}${actionButton('承認する','review',r.id,'yes','btn primary')}</div>`:`<div class="submitted-state">${r.status==='approved'?'承認済み':r.status==='rejected'?'差し戻し':r.reporter_id===me?'他者の承認待ち':'ほかの承認を待っています'}</div>`}</div>`}
function rewardForm(){return `<form data-form="reward" class="form-stack"><label>プライズ名<input name="title" maxlength="80" placeholder="例：欲しかった本を買う" required></label><label>必要なスタンプ<input type="number" name="stamps" value="10" min="1" max="10000" required></label><div class="hint-box">承認済みの報告1件につき1スタンプ。累積スタンプは使っても減りません。</div><button type="submit" class="btn primary block">設定する</button></form>`}
function renameForm(){return `<form data-form="rename" class="form-stack"><label>表示名<input name="name" maxlength="30" value="${esc(who(me))}" required></label><button type="submit" class="btn primary block">変更する</button></form>`}
function reasonForm(){let z=lastWeekBadge(me);if(!z)return '<p>先週の評価対象ではありません。</p>';let reason=z.reason;return `<form class="form-stack" data-form="reason"><div class="large-percent">${z.rate}<span>%</span></div><p class="subtitle centered">先週の達成率は40%未満でした。事情を選べます。</p><label>今週に向けて、先週はどうだった？<select name="reason"><option value="">選んでください</option>${['体調不良','精神不調','アプリを開いてなかった','本当にサボってました','その他'].map(x=>`<option ${reason?.reason===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label><label>補足（任意）<textarea name="detail" maxlength="140" rows="3" placeholder="自由記入">${esc(reason?.detail||'')}</textarea></label><label class="check-line"><input type="checkbox" name="share" ${reason?.share_reason?'checked':''}><span>理由を参加中の全グループに公開する</span></label><div class="hint-box">非公開なら他の人には「事情あり」と表示されます。ただし「本当にサボってました」を選ぶと公開設定にかかわらず WORST バッジになります。健康や精神面の事情を共有したくない場合は公開しないでください。</div><button class="btn primary block" type="submit">回答する</button></form>`}
function installForm(){return `<div class="form-stack"><div><h3>iPhone · Safari</h3><p>公開URLをSafariで開き、共有 →「ホーム画面に追加」→「Webアプリとして開く」→「追加」。</p></div><div><h3>Android · Chrome</h3><p>公開URLをChromeで開き、メニュー →「アプリをインストール」または「ホーム画面に追加」。</p></div><div class="hint-box">GitHub Pagesの配信 + Supabaseの同期設定で二者・複数人の実使用ができます。ZIPだけでは別端末と同期されません。iPhoneのWeb版では振動は動作しません。</div></div>`}
async function uploadPhoto(file){if(!file)return null;const img=new Image(),blobUrl=URL.createObjectURL(file);try{await new Promise((done,fail)=>{img.onload=done;img.onerror=()=>fail(Error('画像形式を確認してください'));img.src=blobUrl});const width=Math.min(1400,img.naturalWidth),height=Math.round(img.naturalHeight*width/img.naturalWidth),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(img,0,0,width,height);const blob=await new Promise(res=>canvas.toBlob(res,'image/jpeg',.76));if(!blob||blob.size>5242880)throw Error('写真を圧縮できませんでした');if(mode==='demo'){if(blob.size>700000)toast('デモ写真の保存は端末容量により失敗する場合があります');return await new Promise((done,fail)=>{let reader=new FileReader();reader.onload=()=>done(reader.result);reader.onerror=fail;reader.readAsDataURL(blob)})}const path=`${me}/${pid()}.jpg`,{error}=await db.storage.from('tandem-evidence').upload(path,blob,{contentType:'image/jpeg',upsert:false});if(error)throw error;return path}finally{URL.revokeObjectURL(blobUrl)}}
async function loadPhotos(){if(mode!=='live')return;
 for(const area of $$('[data-photo-container],[data-mini-photo]')){
  let mini=area.hasAttribute('data-mini-photo'),path=mini?area.dataset.miniPhoto:area.dataset.photoContainer;
  if(!path)continue;
  try{
   let url=photoCache.get(path);
   if(!url){const {data:res,error}=await db.storage.from('tandem-evidence').createSignedUrl(path,300);if(error)throw error;url=res.signedUrl;photoCache.set(path,url);setTimeout(()=>photoCache.delete(path),285000)}
   if(area.isConnected){if(mini)area.outerHTML=`<img src="${esc(url)}" alt="報告写真">`;else area.innerHTML=`<img src="${esc(url)}" alt="報告写真">`}
  }catch{if(area.isConnected&&!mini)area.textContent='写真を表示できませんでした'}
 }
}
// The scratch surface is a real erase-to-reveal canvas, not just a swipe button.
function activateScratches(){for(const wrap of $$('[data-scratch]')){
 const canvas=$('canvas',wrap),rect=wrap.getBoundingClientRect(),width=Math.max(1,Math.round(rect.width)),height=Math.max(1,Math.round(rect.height));canvas.width=width*devicePixelRatio;canvas.height=height*devicePixelRatio;let ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.scale(devicePixelRatio,devicePixelRatio);const gradient=ctx.createLinearGradient(0,0,width,height);gradient.addColorStop(0,'#515955');gradient.addColorStop(.48,'#77827a');gradient.addColorStop(1,'#454d48');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
 ctx.fillStyle='#e6eae3';ctx.textAlign='center';ctx.font='600 13px system-ui';ctx.fillText('↔ ここを指でこすって報告',width/2,height/2+5);
 let drawing=false,last=null,length=0,lastHaptic=0,triggered=false;
 const pos=ev=>{let b=canvas.getBoundingClientRect();return {x:(ev.clientX-b.left)*width/b.width,y:(ev.clientY-b.top)*height/b.height}};
 const rub=ev=>{if(!drawing||triggered)return;let p=pos(ev);ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.arc(p.x,p.y,24,0,2*Math.PI);ctx.fill();if(last){ctx.lineWidth=48;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();length+=Math.hypot(p.x-last.x,p.y-last.y)}last=p;
 if(length-lastHaptic>width*.18){vibrate(12);lastHaptic=length}
 if(length>width*1.3){let pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,erased=0,total=0;for(let i=3;i<pixels.length;i+=84){total++;if(pixels[i]<120)erased++}if(erased/total>.42){triggered=true;vibrate([25,30,35]);wrap.classList.add('scratched');setTimeout(()=>{if(!modal)openModal('report',wrap.dataset.scratch)},180)}}};
 canvas.addEventListener('pointerdown',ev=>{drawing=true;last=null;canvas.setPointerCapture(ev.pointerId);rub(ev)});
 canvas.addEventListener('pointermove',rub);
 canvas.addEventListener('pointerup',()=>{drawing=false;last=null});canvas.addEventListener('pointercancel',()=>{drawing=false;last=null});canvas.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();openModal('report',wrap.dataset.scratch)}});
 }}
function setBusy(flag){busy=flag;$$('button[type=submit]').forEach(b=>b.disabled=flag)}
async function handleForm(form){if(busy)return;setBusy(true);try{const type=form.dataset.form;
 if(type==='signup'){if(mode==='live'){const {data,error}=await db.auth.signInAnonymously();if(error)throw error;me=data.user.id;await rpc('set_name',{p_name:form.elements.name.value.trim()});await refresh()}else{await mutate('rename',{p_name:form.elements.name.value.trim()})}closeModal();toast('開始しました');return}
 if(type==='group'){let id=await mutate('createGroup',{p_name:form.elements.name.value.trim(),p_mode:form.elements.mode.value});closeModal();selectedGroup=id;screen='groups';render();toast('グループを作成しました');return}
 if(type==='join'){await mutate('joinGroup',{p_code:form.elements.code.value.trim()});closeModal();screen='home';render();toast('参加しました');return}
 if(type==='task'||type==='edit'){
  let rids=$$('input[name=reviewer]:checked',form).map(x=>x.value),need=Number(form.elements.required.value);if(!rids.length||need>rids.length)throw Error('承認者と必要人数を確認してください');let common={p_title:form.elements.title.value.trim(),p_weekly:Number(form.elements.weekly?.value||1),p_reviewers:rids,p_required:need};
  if(type==='task'){await mutate('addTask',{...common,p_kind:form.elements.kind.value});toast('タスクを登録しました')}
  else{await mutate('editTask',{...common,p_task:modalId,p_active:form.elements.active.checked});toast('更新しました')}
  closeModal();render();vibrate(25);return}
 if(type==='report'){let image=await uploadPhoto(form.elements.photo.files?.[0]);await mutate('report',{p_task:modalId,p_image:image,p_note:form.elements.note.value.trim(),p_day:localDay()});closeModal();effect('REPORT SENT!');toast('報告しました。承認を待ちましょう');return}
 if(type==='reaction'){let phrase=form.elements.phrase.value,message=phrase==='custom'?form.elements.custom.value.trim():phrase;if(!message)throw Error('メッセージを入力してください');let kind=form.elements.kind.value;await mutate('react',{p_group:form.elements.gid.value,p_task:form.elements.tid.value,p_report:form.elements.rid.value||null,p_kind:kind,p_message:message});closeModal();if(kind==='praise')effect('NICE!');else vibrate(30);toast('メッセージを送りました');return}
 if(type==='reason'){let reason=form.elements.reason.value,detail=form.elements.detail.value.trim(),share=form.elements.share.checked;if(!reason)throw Error('理由を選んでください');await mutate('explain',{p_week:lastMonday(),p_reason:reason,p_detail:detail,p_share:share});closeModal();toast('回答しました');return}
 if(type==='reward'){await mutate('addReward',{p_title:form.elements.title.value.trim(),p_stamps:Number(form.elements.stamps.value)});closeModal();toast('プライズを追加しました');return}
 if(type==='rename'){await mutate('rename',{p_name:form.elements.name.value.trim()});closeModal();toast('表示名を変更しました');return}
 }catch(err){errToast(err)}finally{setBusy(false)}}
async function handleAction(btn){if(busy)return;let action=btn.dataset.action,id=btn.dataset.id,val=btn.dataset.val;
 if(action==='close'||action==='close-bg'){closeModal();return}
 if(action==='nav'){screen=id;render();window.scrollTo(0,0);vibrate(9);return}
 if(action==='open-group'){selectedGroup=id;screen='groups';render();window.scrollTo(0,0);return}
 if(action==='jump-member'){document.getElementById(`person-${id}`)?.scrollIntoView({behavior:'smooth',block:'start'});return}
 if(action==='new-task'){if(!otherIds().length)return toast('まず相手を招待し、同じグループに参加してもらってください',true);openModal('task',id);return}
 if(action==='edit-task')return openModal('edit',id);
 if(action==='open-report')return openModal('report',id);
 if(action==='new-group')return openModal('group');
 if(action==='join-group')return openModal('join');
 if(action==='new-reward')return openModal('reward');
 if(action==='rename')return openModal('rename');
 if(action==='reason')return openModal('reason');
 if(action==='install')return openModal('install');
 if(action==='view-report')return openModal('review',id);
 if(action==='new-react'){
  let [kind,gid,rid='']=val.split(':'),tid=id;return openModal('reaction',`${kind}|${gid}|${rid}|${tid}`)}
 if(action==='replay'){effect('GOOD JOB!');return}
 if(action==='reset-demo'){if(mode!=='demo')return;if(!confirm('デモのタスクと報告を初期化しますか？'))return;d=demoSeed();saveDemo();screen='home';render();return}
 if(action==='switch'){demoUser=id;sessionStorage.setItem('tandem-v3-demo-user',id);me=id;selectedGroup=null;screen='home';render();toast(`${who(me)} に切り替えました`);return}
 if(action==='copy'){try{await navigator.clipboard.writeText(d.groups.find(g=>g.id===id)?.invite_code||'');toast('招待コードをコピーしました')}catch{toast('コピーできませんでした',true)}return}
 if(['pin','claim','review'].includes(action)){busy=true;try{
  if(action==='pin'){await mutate('pin',{p_group:id,p_pinned:val==='on'});vibrate(18);toast(val==='on'?'固定しました':'固定を解除しました')}
  if(action==='claim'){await mutate('claim',{p_reward:id});effect('PRIZE UNLOCKED!')}
  if(action==='review'){let result=await mutate('review',{p_report:id,p_approve:val==='yes'});closeModal();if(result==='approved')effect('STAMP +1');else toast(result==='partial'?'承認しました。ほかの人の承認待ちです':'差し戻しました')}
 }catch(err){errToast(err)}finally{busy=false}return}
}
document.addEventListener('click',ev=>{let button=ev.target.closest('[data-action]');if(!button)return;if(button.dataset.action==='close-bg'&&ev.target!==button)return;ev.preventDefault();handleAction(button).catch(errToast)});
document.addEventListener('submit',ev=>{if(!ev.target.matches('form[data-form]'))return;ev.preventDefault();handleForm(ev.target)});
document.addEventListener('change',ev=>{if(ev.target.name==='phrase'){$('#custom-label')?.toggleAttribute('hidden',ev.target.value!=='custom')}if(ev.target.name==='photo'&&ev.target.files?.[0]){let img=$('#photo-preview');if(img){if(photoPreviewUrl)URL.revokeObjectURL(photoPreviewUrl);photoPreviewUrl=URL.createObjectURL(ev.target.files[0]);img.src=photoPreviewUrl;img.hidden=false}}});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&modal)closeModal()});
if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
boot();
