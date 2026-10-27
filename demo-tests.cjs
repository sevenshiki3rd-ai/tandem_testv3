const fs=require('fs'),vm=require('vm'),assert=require('assert');
let src=fs.readFileSync(require('path').resolve(__dirname,'../app.js'),'utf8');src=src.replace(/^import .*?;\s*/,'').replace(/\nboot\(\);\s*$/, '');src=src.replace('saveDemo();render();return result;','saveDemo();return result;');
const storage=new Map(),ctx={SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',console,Intl,Date,Math,crypto:require('crypto').webcrypto,navigator:{},location:{protocol:'http:'},document:{addEventListener(){}},sessionStorage:{getItem:()=>null,setItem(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout,clearTimeout};vm.createContext(ctx);vm.runInContext(src+'\n globalThis.api={initializeDemo,mutate,weekRate,lastWeekBadge,stamps,myGroups,myTasks,userTasks,reportToday,reviewers,task,report,otherIds,home,groupsScreen,inbox,settings,taskForm,reactionForm,reviewForm,localDay,lastMonday,getState:()=>d,setMe:(x)=>{me=x},getMe:()=>me};',ctx);
(async()=>{let a=ctx.api;a.initializeDemo();assert.equal(a.myGroups().length,2);assert(a.userTasks('a').some(t=>t.id==='gym'));assert(a.myGroups().every(g=>a.userTasks('a').some(t=>t.id==='gym')));assert(a.lastWeekBadge('a').rate<40);console.log('1. Multi-group shared tasks OK:', a.myGroups().map(g=>g.name));
 const bId='b';a.setMe('b');await a.mutate('react',{p_group:'pair-1',p_task:'read',p_report:null,p_kind:'nudge',p_message:'やれ！'});
 assert(a.getState().reactions.some(x=>x.sender_id==='b'&&x.recipient_id==='a'&&x.task_id==='read'));console.log('2. Task-specific nudge OK');
 a.setMe('a');await a.mutate('report',{p_task:'gym',p_image:null,p_note:'行った！',p_day:a.localDay()});let r=a.getState().reports.find(x=>x.task_id==='gym'&&x.local_date===a.localDay());assert(r&&r.status==='pending');
 a.setMe('b');let result=await a.mutate('review',{p_report:r.id,p_approve:true});assert(result==='approved');assert.equal(a.report(r.id).status,'approved');console.log('3. Approval changes global report + stamp',a.stamps('a'));
 await a.mutate('react',{p_group:'pair-1',p_task:'gym',p_report:r.id,p_kind:'praise',p_message:'よくやった！'});
 assert.equal(a.getState().reactions.filter(x=>x.recipient_id==='a'&&x.kind==='praise').length,1);console.log('4. Praise tied to approved report OK');
 a.setMe('a');await a.mutate('explain',{p_week:a.lastMonday(),p_reason:'本当にサボってました',p_detail:'',p_share:false});assert.equal(a.lastWeekBadge('a').reason.reason,'本当にサボってました');console.log('5. Badge opt-in rule OK');
 await a.mutate('addTask',{p_title:'プランク5分',p_kind:'daily',p_weekly:3,p_reviewers:['b'],p_required:1});let t=a.myTasks().find(x=>x.title==='プランク5分');assert(t);console.log('6. New global task OK:',t.id);
 a.setMe('b');assert(a.userTasks('a').find(t=>t.title==='プランク5分'));console.log('7. Cross-user task visibility OK');
 for(const [key,html] of Object.entries({home:a.home(),groups:a.groupsScreen(),inbox:a.inbox(),settings:a.settings(),taskForm:a.taskForm('daily'),react:a.reactionForm('nudge|pair-1||gym'),review:a.reviewForm(r.id)})){assert(html.length>100);if(html.includes('undefined'))console.log('WARNING undefined in',key);console.log('8. Render',key,html.length,'chars')}
 // 2-of-3 approval must not award stamp early
 a.setMe('a');await a.mutate('report',{p_task:'read',p_image:null,p_note:'読みました',p_day:a.localDay()});let two=a.getState().reports.find(x=>x.task_id==='read'&&x.local_date===a.localDay());
 let before=a.stamps('a');a.setMe('b');assert.equal(await a.mutate('review',{p_report:two.id,p_approve:true}),'partial');assert.equal(a.report(two.id).status,'pending');assert.equal(a.stamps('a'),before);
 a.setMe('c');assert.equal(await a.mutate('review',{p_report:two.id,p_approve:true}),'approved');assert.equal(a.stamps('a'),before+1);console.log('9. Quorum approval 2-of-3 OK');
 // Group pin is per-user; task is still globally visible
 a.setMe('a');await a.mutate('pin',{p_group:'pair-1',p_pinned:false});assert.equal(a.getState().members.find(x=>x.user_id==='a'&&x.group_id==='pair-1').pinned,false);console.log('10. Group pin control OK');
 console.log('ALL DEMO TESTS PASSED');
})().catch(e=>{console.error(e);process.exit(1)});
