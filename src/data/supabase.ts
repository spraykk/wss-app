// Supabase 익명 통계 클라이언트 (선택적/안전한 no-op 설계)
//
// 이 모듈은 앱이 익명으로 점수를 서버에 올리고(upsert) 전체 통계를 읽어오는(RPC)
// 유일한 창구다. 핵심 원칙:
//   - env 로만 설정한다(EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY).
//     URL/키를 코드에 하드코딩하지 않는다. 공개(publishable/anon) 키만 사용한다.
//   - 미설정이거나 오류가 나도 앱이 깨지지 않도록 모든 기능이 안전하게 no-op 한다.
//     (로컬 전용으로도 정상 동작해야 하므로 서버는 "있으면 좋은" 부가기능이다.)
//   - 위치/경로/rawScore 등 민감·불필요 데이터는 절대 전송하지 않는다. 서버로 나가는
//     것은 익명 device_id, display_score(0~100), date_iso(yyyy-mm-dd) 뿐이다.
//
// @supabase/supabase-js 와 expo-constants 는 정적 import 하지 않고 지연 require 로
// 로드한다(apiKey.ts 와 동일한 이유). 이렇게 해야 이 모듈을 참조하는 순수 코드나
// 검증 스크립트가 node_modules 없는 샌드박스에서 모듈 해석 오류를 일으키지 않는다.

// 서버로 올리는 최소 페이로드. 이 외의 필드는 존재하지 않는다.
export interface WssScoreUpload {
  deviceId: string;
  /** 0~100 표시 점수 */
  displayScore: number;
  /** yyyy-mm-dd */
  dateISO: string;
}

// get_wss_stats RPC 결과. 표본이 없으면 mean/q3 는 null 이다.
export interface WssStats {
  sampleCount: number;
  meanScore: number | null;
  q3Score: number | null;
}

// env 또는 expo-constants.extra 에서 문자열 값을 읽는다(apiKey.ts 패턴 재사용).
function readEnv(name: string): string | null {
  const fromEnv = process.env[name];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  let extra: Record<string, unknown> = {};
  try {
    const Constants = require('expo-constants').default;
    extra = (Constants?.expoConfig?.extra ?? {}) as Record<string, unknown>;
  } catch {
    extra = {};
  }
  const fromExtra = extra[name];
  if (typeof fromExtra === 'string' && fromExtra.trim().length > 0) {
    return fromExtra.trim();
  }
  return null;
}

// Supabase URL/공개키를 env 에서 읽는다. 둘 중 하나라도 없으면 null(미설정).
export function getSupabaseConfig(): { url: string; key: string } | null {
  const url = readEnv('EXPO_PUBLIC_SUPABASE_URL');
  const key = readEnv('EXPO_PUBLIC_SUPABASE_KEY');
  if (!url || !key) return null;
  return { url, key };
}

// 설정 여부. UI 에서 "서버 통계 사용 가능?" 판단에 쓸 수 있다.
export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

// 클라이언트를 지연 생성해 재사용한다. 미설정이면 null(모든 호출이 no-op 이 된다).
let cachedClient: unknown | null = null;
let clientResolved = false;

function getClient(): unknown | null {
  if (clientResolved) return cachedClient;
  clientResolved = true;
  const config = getSupabaseConfig();
  if (!config) {
    cachedClient = null;
    return null;
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    // 익명/기기 로컬 앱이므로 세션 지속·자동 토큰갱신은 불필요(anon 키 고정 사용).
    cachedClient = createClient(config.url, config.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  } catch {
    // 패키지 미설치/초기화 실패 -> no-op.
    cachedClient = null;
  }
  return cachedClient;
}

// 익명 점수를 upsert 한다(같은 device_id+date_iso 는 덮어쓰기).
// 성공하면 true, 미설정/오류/실패면 false 를 반환하되 예외를 던지지 않는다.
// 호출부(세션 종료)는 이 결과에 의존하지 않아야 한다(로컬 저장이 항상 우선).
export async function uploadScore(payload: WssScoreUpload): Promise<boolean> {
  const client = getClient() as
    | {
        from: (t: string) => {
          upsert: (
            row: Record<string, unknown>,
            options: { onConflict: string }
          ) => Promise<{ error: unknown }>;
        };
      }
    | null;
  if (!client) return false;
  try {
    const { error } = await client.from('wss_scores').upsert(
      {
        device_id: payload.deviceId,
        display_score: payload.displayScore,
        date_iso: payload.dateISO,
      },
      { onConflict: 'device_id,date_iso' }
    );
    return !error;
  } catch {
    return false;
  }
}

// 전체 사용자 통계를 RPC 로 조회한다. 미설정/오류/표본없음이면 null 을 반환하고,
// 호출부(리포트 화면)는 null 을 "아직 데이터 부족"으로 정직하게 표시한다(가짜 숫자 금지).
export async function fetchStats(): Promise<WssStats | null> {
  const client = getClient() as
    | {
        rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
      }
    | null;
  if (!client) return null;
  try {
    const { data, error } = await client.rpc('get_wss_stats');
    if (error) return null;
    // RPC 는 단일 행 테이블을 반환한다. 배열/객체 양쪽 모양을 방어적으로 처리한다.
    const row = (Array.isArray(data) ? data[0] : data) as
      | { sample_count?: unknown; mean_score?: unknown; q3_score?: unknown }
      | null
      | undefined;
    if (!row) return null;
    const sampleCount = Number(row.sample_count ?? 0);
    if (!Number.isFinite(sampleCount)) return null;
    const meanScore =
      row.mean_score === null || row.mean_score === undefined
        ? null
        : Number(row.mean_score);
    const q3Score =
      row.q3_score === null || row.q3_score === undefined
        ? null
        : Number(row.q3_score);
    return {
      sampleCount,
      meanScore: meanScore !== null && Number.isFinite(meanScore) ? meanScore : null,
      q3Score: q3Score !== null && Number.isFinite(q3Score) ? q3Score : null,
    };
  } catch {
    return null;
  }
}
