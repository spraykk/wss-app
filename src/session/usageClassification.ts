// 보행중 스마트폰 사용 시간의 "증거 강도" 분류 (Option A - Step 1) - 순수/검증 가능 모듈
//
// 배경(정직성 원칙): 기존 파이프라인은 "보행한 시간 = 스마트폰 사용 시간"으로 근사해,
// 관측하지 못한 시간까지 사용으로 감점하거나 반대로 미관측을 0분 사용으로 취급해 만점을
// 줄 위험이 있었다. 이 모듈은 한 샘플 구간의 경과 시간을 "증거 강도"에 따라 네 밴드 중
// 정확히 하나로 배정한다:
//   - confirmedUse : 실제 인앱 터치/스크롤이 확인 창(confirmation window) 안에서 발생.
//                    이것이 유일하게 "확인된" 사용 증거다. 이 값만 점수에서 감점한다.
//   - estimatedUse : 자세(고개 숙임 등) 추정 기반. Step 1 에서는 항상 0 이며 감점하지 않는다.
//                    자세 추정은 별도의 향후 과제(Step 2)로, 여기서는 필드/파이프라인만 준비.
//   - unknownUse   : 관측 불가/신호 없음. 앱이 백그라운드라 화면·타앱 사용을 볼 수 없거나,
//                    센서가 오래되어(stale) 판단 불가하거나, 그냥 신호가 없는 경우.
//   - noUse        : 구조적으로만 지원. Step 1 에서는 unknownUse 로 접어 넣는다(보수적).
//                    주머니 패턴 등만으로 "사용 안 함"을 단정하지 않는다(정직성).
//
// 중요한 한계(정직한 설명): confirmedUse 는 본질적으로 "포그라운드에서의 인앱 상호작용"
// 시간이다. 앱이 백그라운드일 때는 화면/타앱 사용을 볼 수 없으므로 그 시간은 사용으로
// 단정하지 않고 unknownUse 로 둔다. 즉 이것은 완벽한 사용 감지가 아니라 휴리스틱이며,
// "확인된 것만 감점하고, 모르는 것은 모른다고 표시한다"는 보수적 설계다.
//
// 이 모듈은 React Native 를 import 하지 않으며 node:* 도 쓰지 않는다. erasable-only TS
// (enum/parameter property/namespace 미사용)라 `node --experimental-strip-types` 로 검증된다.

// 네 증거 밴드. Step 1 에서 실제로 채워지는 것은 confirmedUse / unknownUse 뿐이다.
export type UsageBand = 'confirmedUse' | 'estimatedUse' | 'unknownUse' | 'noUse';

// 한 구간(또는 집계)의 밴드별 분(minute) 합. 모두 분 단위이며 합은 관측된 경과 시간이다.
export interface UsageBands {
  confirmedUseMinutes: number;
  estimatedUseMinutes: number;
  unknownUseMinutes: number;
  noUseMinutes: number;
}

// classifyInterval 에 주입되는 증거. 순수성을 위해 판단에 필요한 값은 모두 주입받는다.
export interface IntervalEvidence {
  // 이 샘플 주변 확인 창 안에서 실제 인앱 터치/스크롤이 있었는가(유일한 확인된 사용 증거).
  hadRecentInteraction: boolean;
  // 앱이 포그라운드였는가(백그라운드면 화면/타앱 사용을 관측할 수 없어 unknownUse).
  appForeground: boolean;
  // 센서 데이터가 오래되어(stale) 판단 불가한가.
  sensorStale: boolean;
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

// 한 구간의 경과 분(elapsedMinutes)을 증거에 따라 정확히 하나의 밴드로 배정한다(순수).
// Step 1 분류 규칙(각 규칙에 정직한 근거 주석을 단다):
export function classifyInterval(evidence: IntervalEvidence, elapsedMinutes: number): UsageBands {
  const bands = zeroUsageBands();
  // 음수/비유한 경과값 방어: 사용으로 뻥튀기하지 않도록 0 으로 취급한다.
  const minutes = Number.isFinite(elapsedMinutes) && elapsedMinutes > 0 ? elapsedMinutes : 0;
  if (minutes === 0) return bands;

  if (evidence.hadRecentInteraction) {
    // 실제 터치/스크롤이 확인 창 안에서 발생 -> 유일하게 "확인된" 사용. 이 값만 감점된다.
    bands.confirmedUseMinutes = minutes;
    return bands;
  }

  // 상호작용 증거가 없다. Step 1 에서는 estimatedUse(자세 추정)를 아직 하지 않으므로
  // 항상 0 으로 둔다(자세 추정은 별도 향후 과제 - Step 2). 또한 noUse 를 단정하지 않는다.
  //
  // 관측 불가/신호 없음의 경우:
  //  - sensorStale: 센서가 오래되어 판단 불가.
  //  - !appForeground: 앱이 백그라운드라 화면/타앱 사용을 관측할 수 없음.
  //  - 그 외: 그냥 신호가 없음.
  // 이 셋 모두 "모른다" 이므로 unknownUse 로 둔다. (Step 1 에서 noUse 는 여기로 접어 넣는다:
  // 주머니 패턴 등만으로 사용 안 함을 단정하지 않는 보수적 태도.)
  bands.unknownUseMinutes = minutes;
  return bands;
}

// 세그먼트 배열의 밴드별 분을 합산한다(순수).
// 각 세그먼트의 선택적 밴드 필드를 읽고, 없는 필드는 0 으로 처리한다.
// 하위호환 폴백: 밴드 필드가 전혀 없지만 레거시 smartphoneUseMinutes>0 인 세그먼트는
// 그 레거시 시간을 unknownUse 로 취급한다. 이렇게 하면 옛 데이터가 조용히 감점되지도
// (confirmedUse 로 오인) 않고, 조용히 무사용으로 신뢰되지도(noUse 로 오인) 않는다.
export function aggregateUsageBands(
  segments: Array<{
    confirmedUseMinutes?: number;
    estimatedUseMinutes?: number;
    unknownUseMinutes?: number;
    noUseMinutes?: number;
    smartphoneUseMinutes?: number;
  }>
): UsageBands {
  const totals = zeroUsageBands();
  for (const s of segments) {
    const hasBandFields =
      s.confirmedUseMinutes !== undefined ||
      s.estimatedUseMinutes !== undefined ||
      s.unknownUseMinutes !== undefined ||
      s.noUseMinutes !== undefined;

    if (hasBandFields) {
      totals.confirmedUseMinutes += num(s.confirmedUseMinutes);
      totals.estimatedUseMinutes += num(s.estimatedUseMinutes);
      totals.unknownUseMinutes += num(s.unknownUseMinutes);
      totals.noUseMinutes += num(s.noUseMinutes);
    } else if (num(s.smartphoneUseMinutes) > 0) {
      // 레거시 세그먼트: 밴드 정보가 전혀 없다 -> 모르는 시간으로 취급(정직성).
      totals.unknownUseMinutes += num(s.smartphoneUseMinutes);
    }
  }
  return totals;
}

// 관측 충분성 판단(순수). unknownRatio = 미관측(unknown) 시간 / 총 보행 시간.
// measurementInsufficient = 보행이 없거나(<=0) unknownRatio 가 임계 이상이면 true.
export function measurementSufficiency(
  totals: UsageBands,
  totalWalkMinutes: number
): { unknownRatio: number; measurementInsufficient: boolean } {
  const walk = Number.isFinite(totalWalkMinutes) && totalWalkMinutes > 0 ? totalWalkMinutes : 0;
  const unknownRatio = walk > 0 ? totals.unknownUseMinutes / walk : 0;
  const measurementInsufficient = walk <= 0 || unknownRatio >= UNKNOWN_RATIO_INSUFFICIENT_THRESHOLD;
  return { unknownRatio, measurementInsufficient };
}

// [설계값] 관측 불충분 임계 비율. 보행의 이 비율 이상이 미관측(unknown)이면 "측정 불충분"
// 으로 판정해, 관측 못 한 시간에 대해 좋은 점수를 주지 않는다(정직성). 방어적으로 낮게
// 0.5 로 둔다. 이는 설계값이며 튜닝 가능하다 - 확정된(frozen) 채점 파라미터
// (k=4 / 0.3 / 40 / 60)가 아니다.
export const UNKNOWN_RATIO_INSUFFICIENT_THRESHOLD = 0.5;

// undefined/비유한 값을 0 으로 정규화하는 내부 헬퍼.
function num(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
