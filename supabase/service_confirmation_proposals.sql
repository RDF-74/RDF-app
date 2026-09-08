alter table public.service_proposals
  add column if not exists source_tag_key text,
  add column if not exists step_keys jsonb not null default '[]'::jsonb,
  add column if not exists source_service_record_id uuid references public.service_records(id) on delete set null,
  add column if not exists snapshot jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_proposals_record_source_tag_key'
      and conrelid = 'public.service_proposals'::regclass
  ) then
    alter table public.service_proposals
      add constraint service_proposals_record_source_tag_key
      unique (service_record_id, source_tag_key);
  end if;
end $$;

create or replace function public.add_service_confirmation_steps(
  p_service_record_id uuid,
  p_steps jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_item jsonb;
  v_sequence integer;
begin
  if not exists (
    select 1
    from public.manager_profiles
    where id = auth.uid()
      and is_active
      and role in ('admin','staff')
  ) then
    raise exception 'manager access required';
  end if;

  if jsonb_typeof(coalesce(p_steps, '[]'::jsonb)) <> 'array' then
    raise exception 'p_steps must be an array';
  end if;

  perform 1
  from public.service_records
  where id = p_service_record_id
    and status = 'in_progress'
  for update;

  if not found then
    raise exception 'service record is not in progress';
  end if;

  update public.service_steps
  set sequence_no = sequence_no + 10000
  where service_record_id = p_service_record_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
  loop
    if nullif(v_item->>'step_key','') is null then
      continue;
    end if;

    if not exists (
      select 1 from public.service_steps
      where service_record_id = p_service_record_id
        and step_key = v_item->>'step_key'
    ) then
      select coalesce(max(sequence_no), 10000) + 1
      into v_sequence
      from public.service_steps
      where service_record_id = p_service_record_id;

      insert into public.service_steps (
        service_record_id,
        step_key,
        step_name,
        order_group,
        sequence_no,
        timed,
        skippable,
        snapshot
      )
      values (
        p_service_record_id,
        v_item->>'step_key',
        coalesce(nullif(v_item->>'step_name',''), v_item->>'step_key'),
        coalesce((v_item->>'order_group')::integer, 9999),
        v_sequence,
        coalesce((v_item->>'timed')::boolean, true),
        coalesce((v_item->>'skippable')::boolean, true),
        coalesce(v_item->'snapshot', '{}'::jsonb)
      );
    end if;
  end loop;

  with ranked as (
    select
      id,
      row_number() over (
        order by order_group, sequence_no, created_at, id
      )::integer as new_sequence
    from public.service_steps
    where service_record_id = p_service_record_id
  )
  update public.service_steps s
  set sequence_no = ranked.new_sequence
  from ranked
  where s.id = ranked.id;
end;
$$;

revoke all on function public.add_service_confirmation_steps(uuid, jsonb) from public;
grant execute on function public.add_service_confirmation_steps(uuid, jsonb) to authenticated;
