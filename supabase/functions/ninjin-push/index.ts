// Deploy with --no-verify-jwt: this function verifies user JWT for nudge requests itself.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
const URL = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const CRON_SECRET = Deno.env.get('NINJIN_CRON_SECRET')!;
const db = createClient(URL, KEY, {auth:{persistSession:false}});
webpush.setVapidDetails('mailto:'+ (Deno.env.get('VAPID_CONTACT_EMAIL')||'admin@example.com'),VAPID_PUBLIC,VAPID_PRIVATE);
const json=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type'}});
async function sendTo(userId:string,payload:{title:string;body:string;tag:string}){
 const {data:subs,error}=await db.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id',userId);
 if(error)throw error;
 let count=0;
 for(const sub of subs||[]){try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify(payload),{TTL:3600});count++}catch(e){const status=(e as {statusCode?:number}).statusCode;if(status===404||status===410)await db.from('push_subscriptions').delete().eq('id',sub.id);else console.error('push send failed',status)}}
 return count;
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return json(200,{});
 if(req.method!=='POST')return json(405,{error:'method not allowed'});
 try{
 const body=await req.json();
 if(body.action==='nudge'){
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer /i,'');
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user)return json(401,{error:'unauthorized'});
  const {data:r}=await db.from('reactions').select('id,sender,recipient,kind,task_id,message,created_at').eq('id',body.reaction_id).maybeSingle();
  if(!r||r.sender!==user.id||r.kind!=='nudge')return json(403,{error:'invalid reaction'});
  // Client may retry: only dispatch reactions from the last 2 minutes.
  if(Date.now()-Date.parse(r.created_at)>120000)return json(200,{sent:0,reason:'old'});
  const {data:pref}=await db.from('push_preferences').select('nudge').eq('user_id',r.recipient).maybeSingle();
  if(!pref?.nudge)return json(200,{sent:0});
  const {data:task}=await db.from('tasks').select('title,kind').eq('id',r.task_id).maybeSingle();
  if(!task)return json(200,{sent:0});
  const {data:done}=await db.from('completions').select('created_at').eq('task_id',r.task_id).gte('created_at',r.created_at).limit(1);
  if(done?.length)return json(200,{sent:0});
  const {error:duplicate}=await db.from('push_dispatches').insert({key:'nudge:'+r.id});
  if(duplicate)return json(200,{sent:0,reason:'already dispatched'});
  const sent=await sendTo(r.recipient,{title:'誰かがあなたの成長に期待してる！',body:`「${task.title}」の達成を応援しています！`,tag:'nudge-'+r.id});
  return json(200,{sent});
 }
 if(body.action==='hourly'){
  if(req.headers.get('X-Ninjin-Cron-Secret')!==CRON_SECRET)return json(401,{error:'unauthorized'});
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
  if(hour<8||hour>22)return json(200,{sent:0,reason:'quiet hours'});
  const {data:prefs,error}=await db.from('push_preferences').select('user_id').eq('hourly',true);
  if(error)throw error;
  let sent=0;
  const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-4*3600000));
  for(const p of prefs||[]){
   const {data:ts}=await db.from('tasks').select('id,kind,deadline').eq('owner',p.user_id).eq('archived',false).limit(200);
   if(!ts?.length)continue;
   const {data:done}=await db.from('completions').select('task_id,day').eq('owner',p.user_id).in('task_id',ts.map(t=>t.id));
   const pending=ts.some(t=>{const ds=(done||[]).filter(d=>d.task_id===t.id);return t.kind==='once'?!ds.length:!ds.some(d=>d.day===day)});
   if(!pending)continue;
   const bucket=new Date().toISOString().slice(0,13);
   const {error:duplicate}=await db.from('push_dispatches').insert({key:'hourly:'+p.user_id+':'+bucket});
   if(duplicate)continue;
   sent+=await sendTo(p.user_id,{title:'🥕 進んでる？',body:'まだやることがあるみたい。ちょっとだけ進めよう！',tag:'ninjin-hourly-'+hour});
  }
  return json(200,{sent});
 }
 return json(400,{error:'unknown action'});
 }catch(e){console.error(e);return json(500,{error:'server error'})}
});
