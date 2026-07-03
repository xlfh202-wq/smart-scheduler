-- =====================================================================
-- 개별 행 동기화 활성화 (bids / placements)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run.
-- 실행 후 앱을 새로고침하면 "서버 연결됨 · 행동기화" 로 바뀌며,
-- 기존 bids/placements 데이터가 자동으로 이 테이블로 1회 이관됩니다.
--
-- 롤백: 아래 두 테이블을 drop 하면 앱이 자동으로 기존 단일문서 방식으로 복귀합니다.
--   drop table if exists public.bids cascade;
--   drop table if exists public.placements cascade;
-- =====================================================================

-- 기존 구스키마(미사용·빈 테이블) 제거 후 올바른 스키마로 재생성
drop table if exists public.bids cascade;
drop table if exists public.placements cascade;

create table public.bids (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table public.placements (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

-- 접근 권한(publishable/anon 키로 읽기·쓰기)
grant all on public.bids to anon, authenticated;
grant all on public.placements to anon, authenticated;

alter table public.bids enable row level security;
alter table public.placements enable row level security;

create policy "app all bids" on public.bids
  for all using (true) with check (true);
create policy "app all placements" on public.placements
  for all using (true) with check (true);

-- 실시간(Realtime) 발행에 추가 → 다른 접속자에게 행 단위로 즉시 반영
alter publication supabase_realtime add table public.bids;
alter publication supabase_realtime add table public.placements;
