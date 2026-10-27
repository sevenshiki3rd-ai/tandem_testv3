-- TANDEM v3 — NEW Supabase project only; incompatible with v1/v2 schemas.
-- Enable Authentication > Anonymous Sign-Ins before using this schema.
-- Run entire script once with SQL editor in a new project.
create extension if not exists pgcrypto;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(length(trim(display_name)) between 1 and 30),
 created_at timestamptz not null default now()
);
create table public.groups (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 name text not null check(length(trim(name)) between 1 and 40),
 mode text not null check(mode in ('pair','team')),
 invite_code text not null unique,
 created_at timestamptz not null default now()
);
create table public.group_members (
 group_id uuid not null references public.groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 pinned boolean not null default false,
 joined_at timestamptz not null default now(),
 primary key(group_id,user_id)
);
create index gm_user_idx on public.group_members(user_id);
create table public.tasks (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 70),
 kind text not null check(kind in ('daily','extra')),
 weekly_target integer not null check(weekly_target between 1 and 7),
 required_approvals integer not null check(required_approvals between 1 and 20),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 check(kind<>'extra' or weekly_target=1)
);
create table public.task_reviewers (
 task_id uuid not null references public.tasks(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 primary key(task_id,user_id)
);
create table public.reports (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.tasks(id) on delete cascade,
 reporter_id uuid not null references auth.users(id),
 image_path text unique,
 note text not null default '' check(length(note)<=300),
 local_date date not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz
);
create unique index report_once on public.reports(task_id,reporter_id,local_date) where status in ('pending','approved');
create index reports_owner_date on public.reports(reporter_id,local_date desc);
create table public.approvals (
 report_id uuid not null references public.reports(id) on delete cascade,
 reviewer_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 primary key(report_id,reviewer_id)
);
create table public.reactions (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.groups(id) on delete cascade,
 task_id uuid not null references public.tasks(id) on delete cascade,
 report_id uuid references public.reports(id) on delete cascade,
 sender_id uuid not null references auth.users(id),
 recipient_id uuid not null references auth.users(id),
 kind text not null check(kind in ('nudge','praise')),
 message text not null check(length(trim(message)) between 1 and 140),
 created_at timestamptz not null default now()
);
create index reaction_recipient_idx on public.reactions(recipient_id,created_at desc);
-- One nudge per sender, task, group and Japan-local date.
create unique index nudge_daily_idx on public.reactions(group_id,task_id,sender_id,((created_at at time zone 'Asia/Tokyo')::date)) where kind='nudge';
-- One praise per sender per approved report (across groups).
create unique index praise_report_idx on public.reactions(report_id,sender_id) where kind='praise';
create table public.weekly_reasons (
 user_id uuid not null references auth.users(id) on delete cascade,
 week_start date not null,
 reason text not null check(reason in ('体調不良','精神不調','アプリを開いてなかった','本当にサボってました','その他')),
 detail text not null default '' check(length(detail)<=140),
 share_reason boolean not null default false,
 created_at timestamptz not null default now(),
 primary key(user_id,week_start)
);
create table public.rewards (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 80),
 stamps_required integer not null check(stamps_required between 1 and 10000),
 claimed_at timestamptz,
 created_at timestamptz not null default now()
);

-- Tables cannot be read or mutated directly by browsers; access is only through vetted RPCs.
do $$ declare x text; begin
 foreach x in array array['profiles','groups','group_members','tasks','task_reviewers','reports','approvals','reactions','weekly_reasons','rewards'] loop
  execute format('alter table public.%I enable row level security',x);
  execute format('revoke all on public.%I from public,anon,authenticated',x);
 end loop;
end $$;

create or replace function public.shared_member(p_a uuid,p_b uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_a=p_b or exists (select 1 from public.group_members m join public.group_members n on m.group_id=n.group_id
  where m.user_id=p_a and n.user_id=p_b);
$$;
create or replace function public.in_group(p_group uuid,p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.group_members where group_id=p_group and user_id=p_user);
$$;
create or replace function public.evidence_visible(p_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.reports r where r.image_path=p_name and public.shared_member(r.reporter_id,auth.uid()));
$$;

create or replace function public.snapshot()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_result jsonb;
begin
 if v_uid is null then raise exception 'Not signed in'; end if;
 with my_groups as (
   select group_id from public.group_members where user_id=v_uid
 ), visible_users as (
   select distinct m.user_id from public.group_members m where m.group_id in (select group_id from my_groups)
   union select v_uid
 ), visible_tasks as (
   select t.id from public.tasks t where t.owner_id in (select user_id from visible_users)
 ), visible_reports as (
   select r.id from public.reports r where r.task_id in (select id from visible_tasks)
 )
 select jsonb_build_object(
  'profiles',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.profiles p where p.id in (select user_id from visible_users)),
  'groups',(select coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) from public.groups g where g.id in (select group_id from my_groups)),
  'members',(select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) from public.group_members m where m.group_id in (select group_id from my_groups)),
  'tasks',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.tasks t where t.id in (select id from visible_tasks)),
  'reviewers',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.task_reviewers r where r.task_id in (select id from visible_tasks)),
  'reports',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.reports r where r.id in (select id from visible_reports)),
  'approvals',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from public.approvals a where a.report_id in (select id from visible_reports)),
  'reactions',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.reactions r where r.group_id in (select group_id from my_groups)),
  'reasons',(select coalesce(jsonb_agg(jsonb_build_object('user_id',w.user_id,'week_start',w.week_start,'share_reason',w.share_reason,
    'reason',case when w.user_id=v_uid or w.share_reason or w.reason='本当にサボってました' then w.reason else '非公開' end,
    'detail',case when w.user_id=v_uid or w.share_reason then w.detail else '' end)),'[]'::jsonb)
    from public.weekly_reasons w where w.user_id in (select user_id from visible_users) and w.week_start >= (now() at time zone 'Asia/Tokyo')::date-60),
  'rewards',(select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) from public.rewards w where w.owner_id=v_uid)
 ) into v_result;
 return v_result;
end;$$;

create or replace function public.set_name(p_name text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'ログインしてください'; end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 30 then raise exception '名前は1〜30文字です'; end if;
 insert into public.profiles(id,display_name) values(auth.uid(),trim(p_name))
 on conflict(id) do update set display_name=excluded.display_name;
end;$$;

create or replace function public.create_group(p_name text,p_mode text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_i integer;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception '名前を登録してください'; end if;
 if p_mode not in ('pair','team') or length(trim(coalesce(p_name,''))) not between 1 and 40 then raise exception 'グループ設定が正しくありません'; end if;
 if (select count(*) from public.group_members where user_id=auth.uid())>=20 then raise exception 'グループは20個までです'; end if;
 for v_i in 1..8 loop
  begin
   insert into public.groups(name,mode,owner_id,invite_code)
   values(trim(p_name),p_mode,auth.uid(),upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))) returning id into v_id;
   insert into public.group_members(group_id,user_id) values(v_id,auth.uid());
   return v_id;
  exception when unique_violation then null;
  end;
 end loop;
 raise exception '招待コード作成に失敗しました';
end;$$;

create or replace function public.join_group(p_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_g public.groups%rowtype; v_count integer;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception '名前を登録してください'; end if;
 if (select count(*) from public.group_members where user_id=auth.uid())>=20 then raise exception 'グループは20個までです'; end if;
 select * into v_g from public.groups where invite_code=upper(trim(coalesce(p_code,''))) for update;
 if not found then raise exception '招待コードが違います'; end if;
 if public.in_group(v_g.id) then return v_g.id; end if;
 select count(*) into v_count from public.group_members where group_id=v_g.id;
 if v_count>=case when v_g.mode='pair' then 2 else 12 end then raise exception '参加人数が上限です'; end if;
 insert into public.group_members(group_id,user_id) values(v_g.id,auth.uid());
 return v_g.id;
end;$$;

create or replace function public.pin_group(p_group uuid,p_pinned boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.in_group(p_group) then raise exception '参加していません'; end if;
 if p_pinned and not (select pinned from public.group_members where group_id=p_group and user_id=auth.uid())
  and (select count(*) from public.group_members where user_id=auth.uid() and pinned)>=3 then raise exception '固定は3つまでです'; end if;
 update public.group_members set pinned=p_pinned where group_id=p_group and user_id=auth.uid();
end;$$;

create or replace function public.add_task(p_title text,p_kind text,p_weekly integer,p_reviewers uuid[],p_required integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_count integer;
begin
 if auth.uid() is null then raise exception 'ログインしてください'; end if;
 if not exists(select 1 from public.group_members where user_id=auth.uid()) then raise exception 'まずグループに参加してください'; end if;
 if length(trim(coalesce(p_title,''))) not between 1 and 70 or p_kind not in ('daily','extra') then raise exception 'タスクが正しくありません'; end if;
 if p_weekly not between 1 and 7 or (p_kind='extra' and p_weekly<>1) then raise exception '目標回数が正しくありません'; end if;
 if p_kind='extra' and exists(select 1 from public.tasks where owner_id=auth.uid() and kind='extra' and active) then raise exception 'エクストラは同時に1件までです'; end if;
 select count(distinct u) into v_count from unnest(p_reviewers) u;
 if v_count<1 or v_count<>coalesce(array_length(p_reviewers,1),0) or p_required not between 1 and v_count then raise exception '承認者と必要人数を確認してください'; end if;
 if exists(select 1 from unnest(p_reviewers) u where u=auth.uid() or not public.shared_member(auth.uid(),u)) then raise exception '承認者は共通グループの別の人を指定してください'; end if;
 insert into public.tasks(owner_id,title,kind,weekly_target,required_approvals)
 values(auth.uid(),trim(p_title),p_kind,p_weekly,p_required) returning id into v_id;
 insert into public.task_reviewers(task_id,user_id) select v_id,u from unnest(p_reviewers) u;
 return v_id;
end;$$;

create or replace function public.update_task(p_task uuid,p_title text,p_weekly integer,p_reviewers uuid[],p_required integer,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_task public.tasks%rowtype;v_count integer;
begin
 select * into v_task from public.tasks where id=p_task for update;
 if not found or v_task.owner_id<>auth.uid() then raise exception '自分のタスクだけ変更できます'; end if;
 if length(trim(coalesce(p_title,''))) not between 1 and 70 or p_weekly not between 1 and 7 or (v_task.kind='extra' and p_weekly<>1) then raise exception '不正なタスク設定です'; end if;
 select count(distinct u) into v_count from unnest(p_reviewers) u;
 if v_count<1 or v_count<>coalesce(array_length(p_reviewers,1),0) or p_required not between 1 and v_count then raise exception '承認人数が不正です'; end if;
 if exists(select 1 from unnest(p_reviewers) u where u=auth.uid() or not public.shared_member(auth.uid(),u)) then raise exception '承認者を確認してください'; end if;
 if exists(select 1 from public.reports where task_id=p_task and status='pending') then raise exception '承認待ちの報告がある間は変更できません'; end if;
 if p_active and not v_task.active and v_task.kind='extra' and exists(select 1 from public.tasks where owner_id=auth.uid() and id<>p_task and kind='extra' and active) then raise exception 'エクストラは1件までです'; end if;
 update public.tasks set title=trim(p_title),weekly_target=p_weekly,required_approvals=p_required,active=p_active where id=p_task;
 delete from public.task_reviewers where task_id=p_task;
 insert into public.task_reviewers(task_id,user_id) select p_task,u from unnest(p_reviewers) u;
end;$$;

create or replace function public.send_report(p_task uuid,p_image text,p_note text,p_day date)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_task public.tasks%rowtype;v_num integer;v_id uuid;
begin
 select * into v_task from public.tasks where id=p_task for update;
 if not found or v_task.owner_id<>auth.uid() or not v_task.active then raise exception '自分の有効なタスクを選んでください'; end if;
 if p_day<>(now() at time zone 'Asia/Tokyo')::date then raise exception '当日の報告だけ送信できます'; end if;
 if length(coalesce(p_note,''))>300 then raise exception 'コメントが長すぎます'; end if;
 if p_image is not null and (
   left(p_image,length(auth.uid()::text)+1)<>auth.uid()::text||'/' or
   not exists(select 1 from storage.objects where bucket_id='tandem-evidence' and name=p_image)
 ) then raise exception '写真のアップロードに失敗しました'; end if;
 if exists(select 1 from public.reports where task_id=p_task and reporter_id=auth.uid() and status in ('pending','approved') and (local_date=p_day or v_task.kind='extra')) then raise exception '報告済みです'; end if;
 if v_task.kind='daily' then
  select count(*) into v_num from public.reports where task_id=p_task and reporter_id=auth.uid()
    and status in ('pending','approved') and local_date>=date_trunc('week',p_day::timestamp)::date and local_date<date_trunc('week',p_day::timestamp)::date+7;
  if v_num>=v_task.weekly_target then raise exception '今週の目標を達成しています'; end if;
 end if;
 insert into public.reports(task_id,reporter_id,image_path,note,local_date)
 values(p_task,auth.uid(),p_image,coalesce(p_note,''),p_day) returning id into v_id;
 return v_id;
end;$$;

create or replace function public.review_report(p_report uuid,p_approve boolean)
returns text language plpgsql security definer set search_path='' as $$
declare v_r public.reports%rowtype;v_t public.tasks%rowtype;v_num integer;
begin
 select * into v_r from public.reports where id=p_report for update;
 if not found or v_r.status<>'pending' then raise exception '承認待ちの報告ではありません'; end if;
 select * into v_t from public.tasks where id=v_r.task_id;
 if v_r.reporter_id=auth.uid() or not exists(select 1 from public.task_reviewers where task_id=v_t.id and user_id=auth.uid()) or not public.shared_member(v_r.reporter_id,auth.uid()) then raise exception '承認権限がありません'; end if;
 if exists(select 1 from public.approvals where report_id=p_report and reviewer_id=auth.uid()) then raise exception '承認済みです'; end if;
 if not p_approve then
  update public.reports set status='rejected',reviewed_at=now() where id=p_report;
  return 'rejected';
 end if;
 insert into public.approvals(report_id,reviewer_id) values(p_report,auth.uid());
 select count(*) into v_num from public.approvals where report_id=p_report;
 if v_num>=v_t.required_approvals then
  update public.reports set status='approved',reviewed_at=now() where id=p_report;
  return 'approved';
 end if;
 return 'partial';
end;$$;

create or replace function public.react(p_group uuid,p_task uuid,p_report uuid,p_kind text,p_message text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_t public.tasks%rowtype;v_r public.reports%rowtype;v_id uuid;
begin
 select * into v_t from public.tasks where id=p_task;
 if not found or v_t.owner_id=auth.uid() or not public.in_group(p_group) or not public.in_group(p_group,v_t.owner_id) then raise exception 'このタスクには送信できません'; end if;
 if length(trim(coalesce(p_message,''))) not between 1 and 140 then raise exception 'メッセージは1〜140文字です'; end if;
 if p_kind='nudge' then
  if p_report is not null then raise exception '不正な操作です'; end if;
  if not v_t.active or exists(select 1 from public.reports where task_id=p_task and local_date=(now() at time zone 'Asia/Tokyo')::date and status in ('pending','approved')) then raise exception '本日未報告のタスクにだけ送れます'; end if;
  if v_t.kind='extra' and exists(select 1 from public.reports where task_id=p_task and status in ('pending','approved')) then raise exception '報告済みです'; end if;
  if v_t.kind='daily' and (select count(*) from public.reports where task_id=p_task and status in ('pending','approved')
   and local_date>=date_trunc('week',(now() at time zone 'Asia/Tokyo')::date::timestamp)::date
   and local_date<date_trunc('week',(now() at time zone 'Asia/Tokyo')::date::timestamp)::date+7)>=v_t.weekly_target then raise exception '今週の目標は完了しています'; end if;
 elsif p_kind='praise' then
  select * into v_r from public.reports where id=p_report;
  if not found or v_r.task_id<>p_task or v_r.status<>'approved' then raise exception '承認済みの報告だけ褒められます'; end if;
 else raise exception '種類が正しくありません'; end if;
 insert into public.reactions(group_id,task_id,report_id,sender_id,recipient_id,kind,message)
 values(p_group,p_task,p_report,auth.uid(),v_t.owner_id,p_kind,trim(p_message)) returning id into v_id;
 return v_id;
end;$$;

create or replace function public.explain_week(p_week date,p_reason text,p_detail text,p_share boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_den integer;v_num integer;
begin
 if p_week<>(date_trunc('week',(now() at time zone 'Asia/Tokyo')::date::timestamp)::date-7) then raise exception '先週についてのみ回答できます'; end if;
 if p_reason not in ('体調不良','精神不調','アプリを開いてなかった','本当にサボってました','その他') or length(coalesce(p_detail,''))>140 then raise exception '回答が正しくありません'; end if;
 select coalesce(sum(weekly_target),0) into v_den from public.tasks
   where owner_id=auth.uid() and active and kind='daily' and created_at < p_week::timestamp;
 select count(*) into v_num from public.reports r join public.tasks t on t.id=r.task_id
   where r.reporter_id=auth.uid() and t.kind='daily' and t.created_at<p_week::timestamp
   and r.status='approved' and r.local_date>=p_week and r.local_date<p_week+7;
 if v_den=0 or v_num*100 >= v_den*40 then raise exception '40%未満の対象ではありません'; end if;
 insert into public.weekly_reasons(user_id,week_start,reason,detail,share_reason)
 values(auth.uid(),p_week,p_reason,coalesce(p_detail,''),coalesce(p_share,false))
 on conflict(user_id,week_start) do update set reason=excluded.reason,detail=excluded.detail,share_reason=excluded.share_reason,created_at=now();
end;$$;

create or replace function public.add_reward(p_title text,p_stamps integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if length(trim(coalesce(p_title,''))) not between 1 and 80 or p_stamps not between 1 and 10000 then raise exception 'ご褒美設定を確認してください'; end if;
 insert into public.rewards(owner_id,title,stamps_required) values(auth.uid(),trim(p_title),p_stamps) returning id into v_id;
 return v_id;
end;$$;
create or replace function public.claim_reward(p_reward uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_r public.rewards%rowtype;v_count integer;
begin
 select * into v_r from public.rewards where id=p_reward for update;
 if not found or v_r.owner_id<>auth.uid() or v_r.claimed_at is not null then raise exception '交換できません'; end if;
 select count(*) into v_count from public.reports where reporter_id=auth.uid() and status='approved';
 if v_count<v_r.stamps_required then raise exception 'スタンプが足りません'; end if;
 update public.rewards set claimed_at=now() where id=p_reward;
end;$$;

-- Only allow callable RPCs to an authenticated user (anonymous sign-in is authenticated).
do $$ declare x text; begin
 foreach x in array array['shared_member','in_group','evidence_visible','snapshot','set_name','create_group','join_group','pin_group','add_task','update_task','send_report','review_report','react','explain_week','add_reward','claim_reward'] loop
   execute format('revoke all on function public.%I from public,anon',x);
   execute format('grant execute on function public.%I to authenticated',x);
 end loop;
end $$;

-- Private evidence bucket. Uploads must live in the caller's UUID directory.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tandem-evidence','tandem-evidence',false,5242880,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg'];
create policy "tandem_v3_upload" on storage.objects for insert to authenticated
 with check(bucket_id='tandem-evidence' and (storage.foldername(name))[1]=auth.uid()::text and lower(storage.extension(name))='jpg');
create policy "tandem_v3_read" on storage.objects for select to authenticated
 using(bucket_id='tandem-evidence' and (
  (storage.foldername(name))[1]=auth.uid()::text or
  public.evidence_visible(name)
 ));
