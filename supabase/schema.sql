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

-- 익명 연령대 밴드(선택). 정확한 나이가 아니라 5개 밴드 중 하나이며, 미선택은 null.
-- 온보딩에서 최초 1회만 선택하며 그룹 비교 통계 용도로만 쓴다(위치/경로는 여전히 저장 안 함).
-- 재실행 안전성을 위해 add column if not exists 로 추가한다(기존 행은 null 로 유효).
alter table public.wss_scores add column if not exists age_band text;

-- 밴드 값 check 제약을 idempotent 하게 추가한다. check 제약에는 add-if-not-exists 절이
-- 없으므로, 같은 이름의 제약이 이미 있으면 먼저 제거한 뒤 다시 추가한다(재실행 안전).
-- null 은 허용(미선택/기존 행)하고, 값이 있으면 5개 밴드 중 하나여야 한다.
alter table public.wss_scores drop constraint if exists wss_scores_age_band_check;
alter table public.wss_scores
  add constraint wss_scores_age_band_check
  check (age_band is null or age_band in ('10s', '20s', '30s', '40s', '50plus'));

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

-- 특정 연령대 밴드로 필터링한 그룹 통계. get_wss_stats() 와 동일한 모양을 반환하되
-- age_band = p_age_band 인 행만 집계한다. 전체 통계용 get_wss_stats() 는 그대로 둔다
-- (fetchStats() 가 그 zero-arg 시그니처에 의존한다).
-- 정직성 원칙 유지: 원시 표본수(sample_count)를 그대로 반환하고, <5 판단은 클라이언트가 한다
-- (서버에서 표본을 숨기지 않는다). 표본이 없으면 count=0, mean/q3=null.
create or replace function public.get_wss_stats_by_age(p_age_band text)
returns table (
  sample_count bigint,
  mean_score numeric,
  q3_score numeric
)
language sql
security definer
set search_path = public
as $$
  select
    count(*)::bigint as sample_count,
    avg(display_score) as mean_score,
    percentile_cont(0.75) within group (order by display_score) as q3_score
  from public.wss_scores
  where age_band = p_age_band;
$$;

-- 익명 역할이 밴드별 통계 RPC 를 실행할 수 있게 허용한다(집계만).
grant execute on function public.get_wss_stats_by_age(text) to anon;

-- ============================================================================
-- 4) 사용자 피드백 (테스터 의견 수집 창구)
-- ============================================================================
-- 목적: 테스터에게 직접 받은 의견(버그/제안/칭찬/기타 + 별점 + 자유 텍스트)을
--       익명으로 수집한다. 앱스토어 리뷰가 아니라 앱 내 "의견 보내기"로 직접 받는다.
-- 설계 원칙(위 점수 테이블과 동일):
--   - 익명: 로그인 없음. 기기별 랜덤 device_id 로만 식별(개인정보 아님).
--   - anon 키로 insert 만 허용한다. 원시 행 select/update/delete 는 막는다.
--   - 증빙(자소서용) 조회는 아래 RPC 로만 가능하며, device_id 원본은 절대 노출하지
--     않고 익명 참조코드(left(md5(device_id),6))로 대체해 내보낸다.
--   - 가짜/샘플 데이터는 넣지 않는다. 실제 수집분만 정직하게 표시한다.
-- (한 번만 실행하면 되고, 재실행해도 안전하도록 idempotent 하게 작성했습니다.)

-- 한 행 = "특정 익명 기기가 남긴 한 건의 피드백".
create table if not exists public.feedback (
  -- 서버가 생성하는 행 PK. 클라이언트는 지정하지 않는다.
  id uuid primary key default gen_random_uuid(),
  -- 익명 기기 식별자(AsyncStorage 랜덤 UUID). 개인정보 아님. 원본은 조회로 노출 안 함.
  device_id text not null,
  -- 카테고리: 버그/제안/칭찬/기타 4종만 허용.
  category text not null check (category in ('bug', 'suggestion', 'praise', 'etc')),
  -- 별점(1~5). 선택 항목이라 null 허용(미선택 시 null).
  rating int check (rating is null or (rating >= 1 and rating <= 5)),
  -- 자유 텍스트(필수). 과도한 길이를 막기 위해 2000자 이하로 제한한다.
  message text not null check (char_length(message) <= 2000),
  -- 앱 버전(예: "1.0.0"). 어느 버전에 대한 피드백인지 구분용(선택).
  app_version text,
  -- 행 생성 시각(서버 시계 기준). 증빙 신뢰성의 핵심 - 서버 원본 타임스탬프.
  created_at timestamptz not null default now()
);

-- 익명 연령대 밴드(선택). 점수 테이블과 동일하게 5개 밴드 중 하나이며 미선택은 null.
-- 온보딩에서 1회 선택한 값을 피드백에도 자동 첨부한다(피드백 화면엔 별도 UI 없음).
-- 재실행 안전성을 위해 add column if not exists + 이름 있는 제약 재생성으로 idempotent 하게.
alter table public.feedback add column if not exists age_band text;
alter table public.feedback drop constraint if exists feedback_age_band_check;
alter table public.feedback
  add constraint feedback_age_band_check
  check (age_band is null or age_band in ('10s', '20s', '30s', '40s', '50plus'));

-- RLS: 정책이 명시적으로 허용한 작업만 가능(기본 거부).
alter table public.feedback enable row level security;

-- 재실행 안전성: 기존 정책 먼저 제거.
drop policy if exists "anon can insert feedback" on public.feedback;

-- anon(익명) 역할이 새 피드백을 insert 할 수 있게만 허용한다.
-- select/update/delete 정책은 만들지 않으므로 원시 행 조회·수정·삭제는 차단된다
-- (다른 사용자 피드백/기기ID 원본을 클라이언트에서 절대 읽을 수 없다).
create policy "anon can insert feedback"
  on public.feedback
  for insert
  to anon
  with check (true);

-- ----------------------------------------------------------------------------
-- 4-1) 증빙 조회 RPC (원시 device_id 비노출, 익명 참조코드로 대체)
-- ----------------------------------------------------------------------------
-- 수집된 피드백 목록을 증빙 대시보드에 표시하기 위한 조회 함수.
-- security definer + search_path 고정: RLS 를 우회해 집계/가공만 안전하게 내보낸다.
-- device_id 원본 대신 left(md5(device_id),6) 익명 참조코드(anon_ref)만 반환한다
-- (같은 기기는 같은 코드로 보이되 원본 UUID 는 복원 불가). 최신순 정렬.
-- age_band 컬럼을 추가로 노출한다(원시 device_id 는 여전히 미노출, anon_ref 로 대체).
-- 대시보드가 연령대 열/필터를 표시할 수 있게 한다. 미선택 행은 age_band = null 로 온다.
-- 재실행(idempotent) 주의: list_feedback() 은 기존 6개 컬럼에서 age_band 를 추가해
-- RETURNS TABLE 모양이 바뀌었다. Postgres 는 create or replace 로 반환 컬럼 집합을
-- 바꾸는 것을 거부하므로("cannot change return type of existing function"), 기존 DB에
-- schema.sql 을 재실행할 때 먼저 함수를 drop 해야 한다(아래 grant 는 재정의 후 다시 부여).
drop function if exists public.list_feedback();
create or replace function public.list_feedback()
returns table (
  category text,
  rating int,
  message text,
  app_version text,
  created_at timestamptz,
  anon_ref text,
  age_band text
)
language sql
security definer
set search_path = public
as $$
  select
    category,
    rating,
    message,
    app_version,
    created_at,
    left(md5(device_id), 6) as anon_ref,
    age_band
  from public.feedback
  order by created_at desc;
$$;

-- 요약 통계: 총 건수, 카테고리별 카운트, 참여 기기수(중복 제거), 평균 별점.
-- 평균 별점은 별점을 남긴 행만 대상으로 하며 표본이 없으면 null 이다(가짜 숫자 금지).
create or replace function public.get_feedback_summary()
returns table (
  total_count bigint,
  bug_count bigint,
  suggestion_count bigint,
  praise_count bigint,
  etc_count bigint,
  device_count bigint,
  average_rating numeric
)
language sql
security definer
set search_path = public
as $$
  select
    count(*)::bigint as total_count,
    count(*) filter (where category = 'bug')::bigint as bug_count,
    count(*) filter (where category = 'suggestion')::bigint as suggestion_count,
    count(*) filter (where category = 'praise')::bigint as praise_count,
    count(*) filter (where category = 'etc')::bigint as etc_count,
    count(distinct device_id)::bigint as device_count,
    avg(rating) as average_rating
  from public.feedback;
$$;

-- 연령대 밴드별 피드백 요약: 밴드별 건수·평균 별점·참여 기기수.
-- 미선택(age_band is null)은 '미상' 그룹으로 집계해 정직하게 노출한다(합계 = 전체).
-- 원시 행/ device_id 는 노출하지 않는다(집계된 밴드 단위 값만). 표본 없으면 평균은 null.
-- 밴드 정렬은 10s→20s→30s→40s→50plus→미상(unknown) 순으로 안정적으로 반환한다.
create or replace function public.get_feedback_summary_by_age()
returns table (
  age_band text,
  total_count bigint,
  average_rating numeric,
  device_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(age_band, 'unknown') as age_band,
    count(*)::bigint as total_count,
    avg(rating) as average_rating,
    count(distinct device_id)::bigint as device_count
  from public.feedback
  group by coalesce(age_band, 'unknown')
  order by
    case coalesce(age_band, 'unknown')
      when '10s' then 1
      when '20s' then 2
      when '30s' then 3
      when '40s' then 4
      when '50plus' then 5
      else 6
    end;
$$;

-- 익명 역할이 조회 RPC 들을 실행할 수 있게 허용한다(원시 행 접근 없이 가공된 형태만).
grant execute on function public.list_feedback() to anon;
grant execute on function public.get_feedback_summary() to anon;
grant execute on function public.get_feedback_summary_by_age() to anon;
