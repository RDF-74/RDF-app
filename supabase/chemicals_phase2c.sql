alter table public.recordare_chemicals
  add column if not exists reorder_threshold numeric
    check (reorder_threshold is null or reorder_threshold >= 0),
  add column if not exists target_stock numeric
    check (target_stock is null or target_stock >= 0);

comment on column public.recordare_chemicals.reorder_threshold is
  '在庫アラートを出す残量。未設定はnull。';
comment on column public.recordare_chemicals.target_stock is
  '補充後に確保したい目標在庫。未設定はnull。';
