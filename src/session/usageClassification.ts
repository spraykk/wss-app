// 보행중 스마트폰 사용 시간 집계 (자세 기반, FEAT-003) - 순수/검증 가능 모듈
//
// 배경(정직성 원칙): 기존 파이프라인은 "보행한 시간 = 스마트폰 사용 시간"으로 근사해,
// 관측하지 못한 시간까지 사용으로 감점할 위험이 있었다. 그 뒤 Option A(Step 1)에서는 실제
// 인앱 터치만 confirmedUse 로 인정하고 나머지를 unknownUse 로 두어 "측정 불충분"을 정직하게
// 표시했다. FEAT-003 에서 사용 판정의 소스를 자세(보행 중 화면 보기: pitch>=10deg 를 3초 이상
// 지속)로 바꾸면서, 이제 모든 구간이 자세 기준으로 "사용(use) / 미사용(no-use)"으로 이분된다.
// 따라서 예전의 estimatedUse / unknownUse / "측정 불충분" 개념은 은퇴한다(더 이상 기록하지
// 않는다). 판정은 src/sensors/postureUsageDetector.ts 의 순수 상태기계가 담당하고, 이 모듈은
// 세그먼트 배열에서 use/no-use 분을 합산하는 집계 헬퍼만 제공한다.
//
// [센서 공백 정책(사용자 결정 '가')] 자세 샘플이 없는 공백 구간은 "모르면 사용으로 감점하지
// 않는다"는 보수적 태도로 no-use 로 귀속한다(postureUsageDetector 규칙과 동일). 여기서
// no-use 는 "확정 사용이 아님(사용으로 감점하지 않음)"을 의미하며, 안전을 단정하지 않는다.
//
// 이 모듈은 React Native 를 import 하지 않으며 node:* 도 쓰지 않는다. erasable-only TS
// (enum/parameter property/namespace 미사용)라 `node --experimental-strip-types` 로 검증된다.

// 사용 밴드(하위호환 목적으로 타입은 유지). 자세 기반 이분화 이후 실제로 채워지는 것은
// confirmedUse(=사용) 와 noUse(=미사용) 뿐이다. estimatedUse/unknownUse 는 은퇴했으며
// UsageBands 에서는 항상 0 으로 채워진다(옛 리포트/이력과의 타입 호환을 위해 필드는 유지).
export type UsageBand = 'confirmedUse' | 'estimatedUse' | 'unknownUse' | 'noUse';

// 한 구간(또는 집계)의 밴드별 분(minute) 합. 자세 기반 이분화 이후 confirmedUseMinutes(사용)
// 와 noUseMinutes(미사용)만 채워지고, estimatedUseMinutes/unknownUseMinutes 는 항상 0 이다
// (은퇴한 개념 · 타입/필드는 하위호환을 위해 유지).
export interface UsageBands {
  confirmedUseMinutes: number;
  estimatedUseMinutes: number;
  unknownUseMinutes: number;
  noUseMinutes: number;
}

// 빈 밴드 합 팩토리(모두 0). 집계 초기값/기본값에 사용.
export function zeroUsageBands(): UsageBands {
  return {
    confirmedUseMinutes: 0,
    estimatedUseMinutes: 0,
    unknownUseMinutes: 0,
    noUseMinutes: 0,
  };
}

// ── 자세 기반 사용 시간 집계(FEAT-002/FEAT-003) ────────────────────────────
//
// 배경: FEAT-002 에서 자세(보행 중 화면 보기)로 "확정된 사용 시간"을 산출한다
// (src/sensors/postureUsageDetector.ts). FEAT-003 에서 파이프라인이 세그먼트의
// confirmedUseMinutes 를 이 자세 기반 값으로 채운다. 여기서는 세그먼트 배열에서
// "감지된 사용 분(detected use minutes)"과 "미사용 분"을 합산하는 순수 헬퍼를 제공한다.
//
// [정직성] 여기서 말하는 "사용"은 자세 기반 추정이며 "사용자 1인 실측 기반 설계값"에
// 근거한다(실제 사고 예측 아님). confirmedUseMinutes 는 자세로 확정된 사용 시간을,
// noUseMinutes 는 그 외(비사용/미관측을 보수적으로 no-use 로 접은) 시간을 의미한다.

// 자세 기반 사용/미사용 집계 결과(분 단위 합).
export interface DetectedUsage {
  // 자세로 확정된 사용(보행 중 화면 보기) 분의 합.
  confirmedUseMinutes: number;
  // 그 외(미사용/미관측) 분의 합.
  noUseMinutes: number;
}

// 세그먼트 배열에서 자세 기반 사용/미사용 분을 합산한다(순수).
// 각 세그먼트의 confirmedUseMinutes(자세로 확정된 사용)와 noUseMinutes 를 읽어 합산하며,
// 없는 필드는 0 으로 처리한다. 하위호환 폴백: 밴드/no-use 필드가 전혀 없지만 레거시
// smartphoneUseMinutes>0 인 세그먼트는 감점 뻥튀기를 피하기 위해 사용으로 단정하지 않고
// noUse 로 접는다(정직성 - 옛 근사 시간을 확정 사용으로 오인하지 않음).
export function computeUsageFromSegments(
  segments: Array<{
    confirmedUseMinutes?: number;
    noUseMinutes?: number;
    smartphoneUseMinutes?: number;
  }>
): DetectedUsage {
  const totals: DetectedUsage = { confirmedUseMinutes: 0, noUseMinutes: 0 };
  for (const s of segments) {
    const hasDetectedFields =
      s.confirmedUseMinutes !== undefined || s.noUseMinutes !== undefined;
    if (hasDetectedFields) {
      totals.confirmedUseMinutes += num(s.confirmedUseMinutes);
      totals.noUseMinutes += num(s.noUseMinutes);
    } else if (num(s.smartphoneUseMinutes) > 0) {
      // 레거시: 근사 시간은 확정 사용으로 오인하지 않고 no-use 로 접는다(보수적/정직).
      totals.noUseMinutes += num(s.smartphoneUseMinutes);
    }
  }
  return totals;
}

// 세그먼트 배열을 리포트 표시용 UsageBands(4필드) 형태로 집계한다(순수).
// 자세 기반 이분화 이후 채워지는 것은 confirmedUseMinutes(사용)/noUseMinutes(미사용) 뿐이며,
// estimatedUseMinutes/unknownUseMinutes 는 은퇴 개념이라 항상 0 이다(타입 호환용). 내부적으로
// computeUsageFromSegments(use/no-use)에 위임하므로 레거시 폴백 규칙(밴드 없는 옛 세그먼트의
// smartphoneUseMinutes 는 no-use 로 접음)도 동일하게 적용된다.
export function usageBandsFromSegments(
  segments: Array<{
    confirmedUseMinutes?: number;
    noUseMinutes?: number;
    smartphoneUseMinutes?: number;
  }>
): UsageBands {
  const detected = computeUsageFromSegments(segments);
  return {
    confirmedUseMinutes: detected.confirmedUseMinutes,
    estimatedUseMinutes: 0,
    unknownUseMinutes: 0,
    noUseMinutes: detected.noUseMinutes,
  };
}

// undefined/비유한 값을 0 으로 정규화하는 내부 헬퍼.
function num(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
