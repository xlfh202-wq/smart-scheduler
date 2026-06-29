-- 방송제작부문 테마PGM 편성 스케줄러 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 RUN 하세요.

create table if not exists programs (
  id   text primary key,
  name text not null,
  color text,
  schema text default 'lifestyle',
  sort int default 0
);

create table if not exists teams (
  id text primary key,
  name text not null,
  color text
);

-- 프로그램별 입찰 가능 팀 (다대다)
create table if not exists program_teams (
  program_id text references programs(id) on delete cascade,
  team_id    text references teams(id)    on delete cascade,
  sort int default 0,
  primary key (program_id, team_id)
);

create table if not exists days (
  id text primary key,
  program_id text references programs(id) on delete cascade,
  date date not null,
  weekday int
);

create table if not exists slots (
  id text primary key,
  day_id text references days(id) on delete cascade,
  start_t text not null,
  end_t   text not null,
  std boolean default false,
  sort int default 0
);

create table if not exists bids (
  id text primary key,
  program_id text,
  team_id text,
  slot_id text references slots(id) on delete cascade,
  product jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists placements (
  id text primary key,
  program_id text,
  slot_id text references slots(id) on delete cascade,
  source_bid_id text,
  team_id text,
  product_name text,
  detail jsonb default '{}'::jsonb,
  memo text default '',
  duration_min int,
  pd text default '',
  host text default '',
  studio text default '',
  move_count int default 0,
  created_at timestamptz default now()
);

create table if not exists snapshots (
  id text primary key,
  ts timestamptz default now(),
  year int, month int,
  program_id text,
  label text,
  author text,
  placements jsonb,
  count int
);

create table if not exists change_log (
  id text primary key,
  ts timestamptz default now(),
  author text,
  action text,
  product_name text,
  team_name text,
  from_label text,
  to_label text,
  detail text
);

-- 내부 도구용: RLS 활성화 + 익명(publishable) 키 전체 허용 정책
-- (외부 공개 서비스로 전환 시 정책을 조직/역할 기반으로 강화하세요)
do $$
declare t text;
begin
  foreach t in array array['programs','teams','program_teams','days','slots','bids','placements','snapshots','change_log']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists anon_all on %I;', t);
    execute format('create policy anon_all on %I for all using (true) with check (true);', t);
  end loop;
end $$;

-- 실시간 동기화 (편성 변경이 다른 접속자에게 즉시 반영)
alter publication supabase_realtime add table placements, bids, days, slots, snapshots, change_log;
