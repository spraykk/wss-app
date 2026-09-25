-- 보행안전 WSS — Supabase 익명 통계 스키마
-- ============================================================================
-- 사용법: Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 "Run".
--         (한 번만 실행하면 됩니다. 재실행해도 안전하도록 idempotent 하게 작성.)
--
-- 설계 원칙(개인정보 최소화):
--   - 익명: 로그인/회원가입 없음. 기기별 랜덤 UUID(device_id)로만 식별.
--   - 최소 수집: display_score(0~100), date_iso(날짜), 익명 device_id 만 저장.
--     위치/경로/rawScore 등 민감·불필요 데이터는 스키마에 아예 존재하지 않음.
--   - anon 키(publishable)로 접근하며, RLS 로 "익명 insert/upsert" 와 "통계 RPC"
--     만 허용한다. 개별 원시 행 select 는 막는다(다른 사용자 점수 열람 불가).
-- ============================================================================

-- gen_random_uuid() 를 위해 pgcrypto 확장을 보장한다(Supabase 는 기본 활성이지만
-- 명시적으로 보장해 두면 다른 환경에서도 안전하다).
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1) 점수 테이블
-- ----------------------------------------------------------------------------
-- 한 행 = "특정 익명 기기가 특정 날짜에 남긴 보행안전점수".
create table if not exists public.wss_scores (
  -- 서버가 생성하는 행 PK. 클라이언트는 지정하지 않는다.
  id uuid primary key default gen_random_uuid(),
  -- 익명 기기 식별자(AsyncStorage 에 저장된 랜덤 UUID). 개인정보 아님.
  device_id text not null,
  -- 사용자에게 보여주는 점수(0~100). 서버 통계의 유일한 수치 입력.
  display_score numeric not null check (display_score >= 0 and display_score <= 100),
  -- 기록 날짜(yyyy-mm-dd). 시각/타임존은 저장하지 않는다(최소 수집).
  date_iso date not null,
  -- 행 생성 시각(감사/정렬용, 서버 시계 기준).
  created_at timestamptz not null default now()
);

-- 같은 기기가 같은 날 여러 번 걸으면 마지막 점수로 덮어쓰도록(upsert) 유니크 제약.
-- 이렇게 하면 표본이 "하루에 한 기기당 한 점"으로 정규화되어 통계가 특정 기기에
-- 치우치지 않는다. 클라이언트 upsert 의 on_conflict 대상이 된다.
create unique index if not exists wss_scores_device_date_uniq
  on public.wss_scores (device_id, date_iso);

-- ----------------------------------------------------------------------------
-- 2) Row Level Security (RLS)
-- ----------------------------------------------------------------------------
-- RLS 를 켜면 정책이 명시적으로 허용한 작업만 가능하다(기본 거부).
alter table public.wss_scores enable row level security;

-- 재실행 안전성을 위해 기존 정책을 먼저 제거한다.
drop policy if exists "anon can insert own score" on public.wss_scores;
drop policy if exists "anon can update own score" on public.wss_scores;

-- anon(익명) 역할이 새 점수를 insert 할 수 있게 허용한다.
-- with check (true): 삽입되는 행에 특별한 제약을 두지 않는다(값 검증은 위 check 제약이 담당).
create policy "anon can insert own score"
  on public.wss_scores
  for insert
  to anon
  with check (true);

-- upsert(중복 시 update) 를 위해 update 도 허용한다. 익명 모델에서는 device_id 소유권을
-- 서버가 강제할 수 없으므로(로그인 없음) 정책 자체는 넓게 두되, 노출 위험이 있는 것은
-- "원시 select" 뿐인데 아래에서 select 정책을 만들지 않아 원시 행 조회는 차단된다.
create policy "anon can update own score"
  on public.wss_scores
  for update
  to anon
  using (true)
  with check (true);

-- 주의: select/delete 정책을 만들지 않으므로 anon 은 개별 행을 읽거나 지울 수 없다.
--       다른 사용자의 점수/기기ID 는 클라이언트에서 절대 조회되지 않는다.
--       통계 값은 아래 get_wss_stats() RPC 를 통해서만(집계된 형태로) 나간다.

-- ----------------------------------------------------------------------------
-- 3) 통계 RPC
-- ----------------------------------------------------------------------------
-- 전체 사용자 점수의 표본수/평균/Q3(75 백분위)를 집계해 반환한다.
-- security definer: 함수 소유자 권한으로 실행되어 RLS 를 우회해 집계할 수 있다.
--   (원시 행은 못 읽어도 집계된 통계는 얻게 하는 표준 패턴.) 개별 행은 반환하지 않는다.
-- 반환:
--   sample_count : 집계에 사용된 행 수(표본 부족 판단용; 앱에서 <5 면 정직하게 표시).
--   mean_score   : 평균(표본 없으면 null).
--   q3_score     : 75 백분위(percentile_cont; 표본 없으면 null).
create or replace function public.get_wss_stats()
returns table (
  sample_count bigint,
  mean_score numeric,
  q3_score numeric
)
language sql
security definer
-- search_path 고정: security definer 함수의 스키마 하이재킹을 방지하는 안전 관행.
set search_path = public
as $$
  select
    count(*)::bigint as sample_count,
    avg(display_score) as mean_score,
    percentile_cont(0.75) within group (order by display_score) as q3_score
  from public.wss_scores;
$$;

-- 익명 역할이 통계 RPC 를 실행할 수 있게 허용한다(원시 테이블 접근 없이 집계만).
grant execute on function public.get_wss_stats() to anon;
