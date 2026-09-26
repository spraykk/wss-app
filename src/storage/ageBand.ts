// 연령대(밴드) 저장 (AsyncStorage)
//
// 온보딩에서 최초 1회만 선택하는 "연령대"를 로컬에 저장한다. 정확한 나이가 아니라
// 10대/20대/30대/40대/50대+ 의 밴드만 저장하며, 익명 그룹 비교(통계) 용도로만 쓴다.
// 선택은 선택 사항이며, 미선택은 null 로 저장한다(통계에서 '미상'으로 집계).
// 위치·경로 등 다른 개인정보는 여기에 저장하지 않는다(개인정보 처리방침 참조).
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import AsyncStorage from '@react-native-async-storage/async-storage';

// 사용자에게 노출/저장하는 연령대 밴드. 정확한 나이는 절대 다루지 않는다.
// [단일 출처] 이 밴드 문자열 집합은 여기가 사실상 기준이다. RN/SQL 경계를 넘는 공유
// 소스는 두지 않되(과설계 회피), 값을 바꾸거나 추가할 때는 아래 세 곳을 함께 고쳐야 한다:
//   1) 이 파일(AgeBand / VALID_BANDS / AGE_BAND_OPTIONS)
//   2) src/data/supabase.ts 의 AgeBandValue(서버 페이로드용 재선언)
//   3) supabase/schema.sql 의 age_band check 제약(wss_scores/feedback) 및 by-age RPC 정렬
export type AgeBand = '10s' | '20s' | '30s' | '40s' | '50plus';

const AGE_BAND_KEY = 'wss.ageBand.v1';

// 유효한 밴드 집합(읽을 때 검증에 사용). 예상치 못한 값은 null 로 취급한다.
const VALID_BANDS: readonly AgeBand[] = ['10s', '20s', '30s', '40s', '50plus'];

// 온보딩 UI 와 통계 화면에서 재사용하는 표시 순서 + 한글 라벨.
export const AGE_BAND_OPTIONS: readonly { key: AgeBand; label: string }[] = [
  { key: '10s', label: '10대' },
  { key: '20s', label: '20대' },
  { key: '30s', label: '30대' },
  { key: '40s', label: '40대' },
  { key: '50plus', label: '50대+' },
];

// 임의의 값이 유효한 AgeBand 인지 검사한다.
function isAgeBand(value: unknown): value is AgeBand {
  return typeof value === 'string' && (VALID_BANDS as readonly string[]).includes(value);
}

/** 저장된 연령대를 조회한다. 미설정이거나 값이 유효하지 않으면 null. */
export async function getAgeBand(): Promise<AgeBand | null> {
  try {
    const raw = await AsyncStorage.getItem(AGE_BAND_KEY);
    if (raw === null) return null;
    return isAgeBand(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** 연령대를 저장한다. null 을 넘기면 저장값을 지운다(미선택). */
export async function setAgeBand(band: AgeBand | null): Promise<void> {
  try {
    if (band === null) {
      await AsyncStorage.removeItem(AGE_BAND_KEY);
      return;
    }
    if (!isAgeBand(band)) return;
    await AsyncStorage.setItem(AGE_BAND_KEY, band);
  } catch {
    // 저장 실패는 조용히 무시(연령대는 선택 사항이며 실패해도 앱은 정상 동작).
  }
}
