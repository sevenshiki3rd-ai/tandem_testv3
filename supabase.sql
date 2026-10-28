-- ニンジンタスク v5 / Supabase SQL Editorで1回実行
create extension if not exists pgcrypto;
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, name text not null default 'ななし', avatar text, created_at timestamptz not null default now());
create table if not exists public.groups (id uuid primary key default gen_random_uuid(), name text not null check (char_length(name) between 1 and 60), mode text not null check (mode in ('pair','team')), code text not null unique, creator uuid not null references auth.users(id), prize_on boolean not null default false, prize text not null default '', threshold int not null default 10 check(threshold between 1 and 999), created_at timestamptz not null default now());
create table if not exists public.members (group_id uuid not null references public.groups(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, joined_at timestamptz not null default now(), primary key(group_id,user_id));
create table if not exists public.tasks (id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id) on delete cascade, title text not null check(char_length(title) between 1 and 160), kind text not null check(kind in ('once','daily','weekly')), target int not null default 1 check(target between 1 and 7), deadline date, working boolean not null default false, archived boolean not null default false, pending_schedule jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.completions (id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade, owner uuid not null references auth.users(id) on delete cascade, day date not null, note text not null default '', photo text, created_at timestamptz not null default now(), unique(task_id,day));
create table if not exists public.reactions (id uuid primary key default gen_random_uuid(), group_id uuid not null references public.groups(id) on delete cascade, task_id uuid not null references public.tasks(id) on delete cascade, completion_id uuid references public.completions(id) on delete cascade, sender uuid not null references auth.users(id), recipient uuid not null references auth.users(id), kind text not null check(kind in ('nudge','approval','praise')), message text not null check(char_length(message) between 1 and 120), created_at timestamptz not null default now(), check ((kind='approval' and completion_id is not null) or kind<>'approval'));
create unique index if not exists one_approval_per_completion on public.reactions(sender,completion_id) where kind='approval';
create table if not exists public.templates (id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id) on delete cascade, kind text not null check(kind in ('nudge','approval')), message text not null check(char_length(message) between 1 and 120), created_at timestamptz not null default now());
create table if not exists public.seen (user_id uuid not null references auth.users(id) on delete cascade, reaction_id uuid not null references public.reactions(id) on delete cascade, primary key(user_id,reaction_id));
create index if not exists tasks_owner_idx on public.tasks(owner);
create index if not exists members_user_idx on public.members(user_id);
create index if not exists completions_task_idx on public.completions(task_id);
create index if not exists reactions_recipient_idx on public.reactions(recipient,created_at desc);
-- Security definer: group membership check, no RLS recursion.
create or replace function public.share_group(a uuid,b uuid) returns boolean language sql stable security definer set search_path=public as $$
 select a=b or exists(select 1 from public.members x join public.members y on x.group_id=y.group_id where x.user_id=a and y.user_id=b)
$$;
create or replace function public.in_group(g uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.members where group_id=g and user_id=auth.uid())$$;
revoke all on function public.share_group(uuid,uuid) from public; grant execute on function public.share_group(uuid,uuid) to authenticated;
revoke all on function public.in_group(uuid) from public; grant execute on function public.in_group(uuid) to authenticated;
-- Atomic group creation and invite join, server-controlled capacity/code.
create or replace function public.create_tandem_group(p_name text,p_mode text) returns uuid language plpgsql security definer set search_path=public as $$
declare gid uuid; cd text; i int;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if length(trim(p_name)) not between 1 and 60 or p_mode not in ('pair','team') then raise exception 'Invalid group'; end if;
 for i in 1..10 loop
  cd:=upper(substr(encode(gen_random_bytes(6),'hex'),1,8));
  begin
   insert into public.groups(name,mode,code,creator) values(trim(p_name),p_mode,cd,auth.uid()) returning id into gid;
   insert into public.members(group_id,user_id) values(gid,auth.uid());
   return gid;
  exception when unique_violation then null;
  end;
 end loop;
 raise exception 'Could not generate code';
end $$;
create or replace function public.join_tandem_group(p_code text) returns uuid language plpgsql security definer set search_path=public as $$
declare g public.groups%rowtype; cnt int;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 select * into g from public.groups where code=upper(trim(p_code)) for update;
 if not found then raise exception '招待コードが見つかりません'; end if;
 if exists(select 1 from public.members where group_id=g.id and user_id=auth.uid()) then return g.id; end if;
 select count(*) into cnt from public.members where group_id=g.id;
 if cnt >= case when g.mode='pair' then 2 else 12 end then raise exception 'グループは満員です'; end if;
 insert into public.members(group_id,user_id) values(g.id,auth.uid());
 return g.id;
end $$;
revoke all on function public.create_tandem_group(text,text) from public;
revoke all on function public.join_tandem_group(text) from public;
grant execute on function public.create_tandem_group(text,text),public.join_tandem_group(text) to authenticated;
-- Prevent forged completions / reactions and membership-based unauthorized reads.
create or replace function public.validate_completion() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.owner<>auth.uid() or not exists(select 1 from public.tasks where id=new.task_id and owner=auth.uid()) then raise exception 'Not task owner'; end if;
 return new;
end $$;
drop trigger if exists check_completion on public.completions;
create trigger check_completion before insert or update on public.completions for each row execute function public.validate_completion();
create or replace function public.validate_reaction() returns trigger language plpgsql security definer set search_path=public as $$
declare actual_owner uuid; actual_task uuid;
begin
 if new.sender<>auth.uid() or new.recipient=auth.uid() or not public.in_group(new.group_id) then raise exception 'Invalid sender or group'; end if;
 select owner into actual_owner from public.tasks where id=new.task_id;
 if actual_owner is null or actual_owner<>new.recipient or not exists(select 1 from public.members where group_id=new.group_id and user_id=actual_owner) then raise exception 'Invalid target'; end if;
 if new.kind='approval' then
  select task_id into actual_task from public.completions where id=new.completion_id;
  if actual_task is distinct from new.task_id then raise exception 'Invalid completion'; end if;
 else
  if new.completion_id is not null then raise exception 'Unexpected completion'; end if;
 end if;
 return new;
end $$;
drop trigger if exists check_reaction on public.reactions;
create trigger check_reaction before insert on public.reactions for each row execute function public.validate_reaction();
-- RLS
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.tasks enable row level security;
alter table public.completions enable row level security;
alter table public.reactions enable row level security;
alter table public.templates enable row level security;
alter table public.seen enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using(public.share_group(id,auth.uid()));
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check(id=auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated using(public.in_group(id));
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update to authenticated using(creator=auth.uid()) with check(creator=auth.uid());
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using(public.in_group(group_id));
drop policy if exists members_leave on public.members;
create policy members_leave on public.members for delete to authenticated using(user_id=auth.uid());
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated using(public.share_group(owner,auth.uid()));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated with check(owner=auth.uid());
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated using(owner=auth.uid());
drop policy if exists completions_read on public.completions;
create policy completions_read on public.completions for select to authenticated using(public.share_group(owner,auth.uid()));
drop policy if exists completions_insert on public.completions;
create policy completions_insert on public.completions for insert to authenticated with check(owner=auth.uid());
drop policy if exists completions_update on public.completions;
create policy completions_update on public.completions for update to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
drop policy if exists completions_delete on public.completions;
create policy completions_delete on public.completions for delete to authenticated using(owner=auth.uid());
drop policy if exists reactions_read on public.reactions;
create policy reactions_read on public.reactions for select to authenticated using(public.in_group(group_id));
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions for insert to authenticated with check(sender=auth.uid() and public.in_group(group_id));
drop policy if exists templates_all on public.templates;
create policy templates_all on public.templates for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
drop policy if exists seen_all on public.seen;
create policy seen_all on public.seen for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
-- Private photos: read for owner or shared-group members, write own folder only.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('tandem-photos','tandem-photos',false,1048576,array['image/webp']) on conflict(id) do update set public=false;
drop policy if exists tandem_photo_read on storage.objects;
create policy tandem_photo_read on storage.objects for select to authenticated using(bucket_id='tandem-photos' and (storage.foldername(name))[1] in (select p.id::text from public.profiles p where public.share_group(p.id,auth.uid())));
drop policy if exists tandem_photo_write on storage.objects;
create policy tandem_photo_write on storage.objects for insert to authenticated with check(bucket_id='tandem-photos' and (storage.foldername(name))[1]=auth.uid()::text);

-- v5.1: push subscription and per-user opt-in. No public read access to push endpoints/keys.
create table if not exists public.push_preferences(user_id uuid primary key references auth.users(id) on delete cascade,nudge boolean not null default false,hourly boolean not null default false,updated_at timestamptz not null default now());
create table if not exists public.push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,endpoint text not null unique,p256dh text not null,auth text not null,created_at timestamptz not null default now());
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
drop policy if exists push_prefs_self on public.push_preferences;
create policy push_prefs_self on public.push_preferences for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists push_subs_self on public.push_subscriptions;
create policy push_subs_self on public.push_subscriptions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
-- Server-only deduplication for dispatch retries and hourly cron runs.
create table if not exists public.push_dispatches(key text primary key, created_at timestamptz not null default now());
alter table public.push_dispatches enable row level security;
