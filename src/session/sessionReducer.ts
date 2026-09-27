// 보행 세션 순수 리듀서 (FEAT-004) - 포그라운드/백그라운드 공용, 순수/검증 가능 모듈
//
// 배경: 기존에는 세그먼트 누적 로직이 useWalkSession.ingestSample 안에 인라인으로
// 들어 있어(포그라운드 훅 전용) 백그라운드 태스크에서 재사용할 수 없었다. FEAT-004는
// "보행 시작 후 앱을 꺼도 계속 측정"을 위해 이 파이프라인을 백그라운드 태스크로 옮긴다.
// 그러려면 세그먼트 누적을 순수 상태전이(state transition) 함수로 추출해, 포그라운드
// 훅과 백그라운드 태스크가 "동일한" 누적 규칙을 공유해야 한다.
//
// 누적 규칙(기존 ingestSample 과 동일해야 함, 회귀 불변):
//  - 새 샘플의 안정화 세그먼트 키(buildSegmentKey)가 현재 진행 중 키와 같고 세그먼트가
//    하나라도 있으면 -> 마지막 세그먼트에 smartphoneUseMinutes/walkMinutes 를 누적한다.
//  - 키가 바뀌면 -> 새 세그먼트를 시작한다(currentKey 교체).
//  - riskIntensity 는 buildSegmentKey 내부에서 0.25 버킷으로 양자화되므로 GPS 노이즈로
//    인한 과분할을 방지한다(버그 #1 FIX 를 그대로 계승).
//
// 이 모듈은 React Native 를 import 하지 않으며 node:* 도 쓰지 않는다. 따라서
// `node --experimental-strip-types` 로 검증 가능하다(erasable-only TS: enum/parameter
// property/namespace 미사용).
import type { WalkSegment, WeatherCondition, TimeBand } from '../types';
import { buildSegmentKey } from '../hooks/segmentKey';

// 세그먼트 파이프라인이 새 위치/맥락 샘플을 만들 때마다 리듀서에 넣는 입력.
// (기존 useWalkSession.WalkContextSample 과 동일 계약. 단일 소스로 여기 두고 재사용.)
export interface WalkContextSample {
  zoneId: string;
  riskIntensity: number;
  weather: WeatherCondition;
  // FEAT-002: 차음 여부의 소스는 자동 감지 오디오 상태다(수동 토글 없음). 샘플이 값을
  // 생략하면 호출부(훅/백그라운드 태스크)가 자동 감지값을 채워 넣어야 한다.
  isEarOccluded?: boolean;
  smartphoneUseMinutes: number;
  walkMinutes: number;
  timeBand?: TimeBand;
  // FEAT-002 (Option A - Step 1): 증거 밴드별 분(minute). 모두 선택 필드(하위호환).
  // 호출부(백그라운드 태스크/훅)는 classifyInterval 결과로 이 값들을 채우고,
  // smartphoneUseMinutes = confirmedUseMinutes 로 미러링해 기존 채점/검증과 호환을 유지한다.
  // 이 밴드 필드들은 buildSegmentKey 에 절대 들어가지 않는다(키는 맥락만: zone/risk/weather/time/ear).
  confirmedUseMinutes?: number;
  estimatedUseMinutes?: number;
  unknownUseMinutes?: number;
  noUseMinutes?: number;
}

// 진행 중 세션의 순수 상태. sessionStore 가 이 형태를 AsyncStorage 에 직렬화한다.
export interface SessionState {
  segments: WalkSegment[];
  // 현재 진행 중 세그먼트의 안정화 키(과분할 방지). 아직 없으면 null.
  currentKey: string | null;
}

// 새 세션의 빈 초기 상태.
export function initialSessionState(): SessionState {
  return { segments: [], currentKey: null };
}

// 이전 세션 상태 + 새 샘플 -> 다음 세션 상태(순수). 입력 state 는 변형하지 않는다.
// timeBand/isEarOccluded 의 기본값 해결은 호출부에서 미리 끝낸 뒤 넘기는 것을 권장하지만,
// 순수성을 위해 여기서는 timeBand 가 없으면 계산하지 않고 필수로 요구한다.
// (getCurrentTimeBand 는 Date 에 의존하므로 순수 리듀서 밖에서 해결한다.)
export function reduceSession(
  state: SessionState,
  sample: WalkContextSample,
  resolved: { timeBand: TimeBand; isEarOccluded: boolean }
): SessionState {
  const { timeBand, isEarOccluded } = resolved;
  const key = buildSegmentKey({
    zoneId: sample.zoneId,
    riskIntensity: sample.riskIntensity,
    weather: sample.weather,
    timeBand,
    isEarOccluded,
  });

  if (state.currentKey === key && state.segments.length > 0) {
    // 같은 안정화 키 -> 마지막 세그먼트에 누적(과분할 방지). 기존 ingestSample 과 동일.
    const last = state.segments[state.segments.length - 1];
    const updated: WalkSegment = {
      ...last,
      smartphoneUseMinutes: last.smartphoneUseMinutes + sample.smartphoneUseMinutes,
      walkMinutes: last.walkMinutes + sample.walkMinutes,
      // FEAT-002: 밴드별 분도 함께 누적(없는 값은 0). smartphoneUseMinutes/walkMinutes 누적
      // 규칙은 위와 동일하게 유지되어 verify-session-reducer.ts 는 불변으로 통과한다.
      confirmedUseMinutes: bandVal(last.confirmedUseMinutes) + bandVal(sample.confirmedUseMinutes),
      estimatedUseMinutes: bandVal(last.estimatedUseMinutes) + bandVal(sample.estimatedUseMinutes),
      unknownUseMinutes: bandVal(last.unknownUseMinutes) + bandVal(sample.unknownUseMinutes),
      noUseMinutes: bandVal(last.noUseMinutes) + bandVal(sample.noUseMinutes),
    };
    return {
      segments: [...state.segments.slice(0, -1), updated],
      currentKey: key,
    };
  }

  // 키가 바뀜(또는 첫 샘플) -> 새 세그먼트 시작.
  const segment: WalkSegment = {
    regionId: sample.zoneId,
    smartphoneUseMinutes: sample.smartphoneUseMinutes,
    walkMinutes: sample.walkMinutes,
    riskIntensity: sample.riskIntensity,
    weather: sample.weather,
    timeBand,
    isEarOccluded,
    // FEAT-002: 밴드별 분을 샘플에서 초기화(없는 값은 0).
    confirmedUseMinutes: bandVal(sample.confirmedUseMinutes),
    estimatedUseMinutes: bandVal(sample.estimatedUseMinutes),
    unknownUseMinutes: bandVal(sample.unknownUseMinutes),
    noUseMinutes: bandVal(sample.noUseMinutes),
  };
  return {
    segments: [...state.segments, segment],
    currentKey: key,
  };
}

// undefined/비유한 밴드 분 값을 0 으로 정규화(순수 헬퍼).
function bandVal(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
