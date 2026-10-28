-- NinjinTask beta: run ONCE in Supabase SQL Editor BEFORE deploying this ZIP.
-- Existing rows are preserved. New tasks default to public.
alter table public.tasks add column if not exists is_secret boolean not null default false;
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
 using(owner=auth.uid() or (not is_secret and public.share_group(owner,auth.uid())));
drop policy if exists completions_read on public.completions;
create policy completions_read on public.completions for select to authenticated
 using(owner=auth.uid() or (public.share_group(owner,auth.uid()) and exists
 (select 1 from public.tasks t where t.id=task_id and not t.is_secret)));
drop policy if exists reactions_read on public.reactions;
create policy reactions_read on public.reactions for select to authenticated
 using(public.in_group(group_id) and exists
 (select 1 from public.tasks t where t.id=task_id and not t.is_secret));
-- Reject other members' reactions to secret tasks.
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions for insert to authenticated
 with check(sender=auth.uid() and public.in_group(group_id) and exists
 (select 1 from public.tasks t where t.id=task_id and not t.is_secret));
