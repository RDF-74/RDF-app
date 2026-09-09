-- RE:CORDARE Manager: 施工前確認後のお客様承認
alter table public.service_proposals
  add column if not exists customer_decision text not null default 'not_required',
  add column if not exists customer_confirmed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_proposals_customer_decision_check'
      and conrelid = 'public.service_proposals'::regclass
  ) then
    alter table public.service_proposals
      add constraint service_proposals_customer_decision_check
      check (customer_decision in ('not_required','pending','approved','declined'));
  end if;
end $$;
