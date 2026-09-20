-- RE:CORDARE Manager: 前日確認LINEの送信状態
alter table public.reservations
  add column if not exists day_before_line_sent_at timestamptz,
  add column if not exists day_before_line_message text;
