-- =====================================================================
-- schema_auth.sql — 인증 사용자 전용 데이터 접근 (v204)
-- Supabase 대시보드 → SQL Editor 에 전체 붙여넣고 Run 하세요.
--  1) app_users: 허용 사용자 프로필(이메일→역할/팀/이름) — 소스코드에서 서버로 이전
--  2) 데이터 테이블 RLS: app_users 에 등록된 인증 사용자만 읽기/쓰기
-- =====================================================================

-- 1) 사용자 프로필 테이블
create table if not exists public.app_users (
  email text primary key,
  role  text not null check (role in ('md','pd','pgm','admin')),
  team  text not null default '',
  name  text not null
);
alter table public.app_users enable row level security;
drop policy if exists "own profile" on public.app_users;
create policy "own profile" on public.app_users for select to authenticated
  using (email = (auth.jwt() ->> 'email'));

insert into public.app_users (email, role, team, name) values
  ('sunghyun_kang@lotte.net', 'admin', '',        '강성현'),
  ('chung_sy@lotte.net',      'admin', '',        '정선영'),
  ('sungy0919@lotte.net',     'pgm',   '정보보안팀', '정보보안팀'),
  ('mkkim1234@lotte.net',     'pgm',   '정보보안팀', '정보보안팀')
on conflict (email) do update
  set role = excluded.role, team = excluded.team, name = excluded.name;

-- 2) 데이터 테이블 RLS 교체: 공개(anon) 접근 제거 → 등록된 인증 사용자만
drop policy if exists anon_all on public.app_state;
drop policy if exists anon_all on public.bids;
drop policy if exists anon_all on public.placements;
drop policy if exists "app all bids" on public.bids;
drop policy if exists "app all placements" on public.placements;
drop policy if exists member_all on public.app_state;
drop policy if exists member_all on public.bids;
drop policy if exists member_all on public.placements;

create policy member_all on public.app_state for all to authenticated
  using      (exists (select 1 from public.app_users u where u.email = auth.jwt() ->> 'email'))
  with check (exists (select 1 from public.app_users u where u.email = auth.jwt() ->> 'email'));

create policy member_all on public.bids for all to authenticated
  using      (exists (select 1 from public.app_users u where u.email = auth.jwt() ->> 'email'))
  with check (exists (select 1 from public.app_users u where u.email = auth.jwt() ->> 'email'));

create policy member_all on public.placements for all to authenticated
  using      (exists (select 1 from public.app_users u where u.email = auth.jwt() ->> 'email'))
  with check (exists (select 1 from public.app_users u where u.email = auth.jwt() ->> 'email'));
