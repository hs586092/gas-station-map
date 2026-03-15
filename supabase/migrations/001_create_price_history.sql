create table price_history (
  id uuid default gen_random_uuid() primary key,
  station_id text not null,
  station_name text not null,
  brand text not null,
  gasoline_price integer,
  diesel_price integer,
  premium_price integer,
  collected_at timestamptz default now() not null
);

-- 조회 성능을 위한 인덱스
create index idx_price_history_station_id on price_history (station_id);
create index idx_price_history_collected_at on price_history (collected_at);
create index idx_price_history_station_date on price_history (station_id, collected_at desc);

-- RLS 활성화
alter table price_history enable row level security;

-- 누구나 읽기 가능
create policy "price_history_select" on price_history
  for select using (true);

-- service role만 삽입 가능
create policy "price_history_insert" on price_history
  for insert with check (false);
