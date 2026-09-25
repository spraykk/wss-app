// 보행안전점수(WSS) 앱 - 공통 타입 정의
// 원 보고서: "보행중 스마트폰 사용 억제를 통한 보행 안전 확보:
//            로지스틱 회귀모형을 통한 보행안전점수(WSS) 설계 및 이를 활용한 넛지"

import { UsageBands } from './session/usageClassification';

// 'fog'(안개)는 건당 EPDO 심각도가 가장 높은 기상상태(사망률 약 92‰)라 별도 분류.
export type WeatherCondition = 'clear' | 'rain_or_snow' | 'other_not_clear' | 'fog';

export type TimeBand = 'rush_am' | 'rush_pm' | 'normal_day' | 'normal_night';

export interface WalkSegment {
  /** 지역 구간 id (지도상 grid/구간 식별자) */
  regionId: string;
  /** 이 구간에서 실제로 보행중 스마트폰을 사용한 시간(분) */
  smartphoneUseMinutes: number;
  /** 이 구간의 총 보행 시간(분) */
  walkMinutes: number;
  /** 이 구간의 "위치 위험강도". 걸쳐 있는 사고다발구역이 없으면 0.
   * 구역이 하나면 그 구역의 실제 사고건수 기반 심각도(severity, 대략 0.5~2 사이),
   * 여러 구역이 겹치면 각 구역의 severity를 합산 - 즉 "사고건수가 많을수록", "겹치는 구역이
   * 많을수록" 둘 다 이 값을 높인다 (src/wss/weights.ts의 computeRiskIntensity/computeLocationWeight 참고). */
  riskIntensity: number;
  weather: WeatherCondition;
  timeBand: TimeBand;
  /** 이어폰/귀마개 등 차음 환경 여부.
   * FEAT-002: 필드명은 유지하되 소스가 수동 입력 -> 자동 감지 오디오 상태로 바뀌었다.
   * 값은 isEarEffectivelyOccluded({bluetoothAudioRouteConnected, otherAudioPlaying})
   * = (둘 다 true) 에서 채워진다. EAR_WEIGHT(occluded=1.3/open=1.0) 매핑에 연결된다. */
  isEarOccluded: boolean;
  // --- 사용 밴드별 분(minute). 모두 선택 필드(하위호환) ---
  // smartphoneUseMinutes 는 하위호환을 위해 유지되며, 새 채점은 confirmedUseMinutes 를 읽는다.
  // FEAT-003: 사용 판정 소스가 인앱 터치 -> 자세(보행 중 화면 보기: pitch>=10deg 3초 지속)로
  // 바뀌면서 모든 구간이 use/no-use 로 이분된다. estimatedUse/unknownUse 는 은퇴했다(항상 0으로
  // 기록되거나 미기록). 밴드 필드가 없는 과거 세그먼트는 confirmedUseMinutesOf 폴백으로
  // smartphoneUseMinutes 를 사용한다. 판정/집계 규칙은 src/session/usageClassification.ts 및
  // src/sensors/postureUsageDetector.ts 참고.
  /** [사용] 자세(보행 중 화면 보기)로 감지된 사용 시간(분). 새 채점의 감점 소스. */
  confirmedUseMinutes?: number;
  /** [은퇴] 예전 자세-추정 밴드. FEAT-003 이후 기록하지 않으며 항상 0(옛 이력 호환용 필드). */
  estimatedUseMinutes?: number;
  /** [은퇴] 예전 미관측 밴드. FEAT-003 이후 기록하지 않으며 항상 0(옛 이력 호환용 필드). */
  unknownUseMinutes?: number;
  /** [미사용] 사용(자세)으로 확정되지 않은 시간(분). 감점 대상 아님. */
  noUseMinutes?: number;
}

export interface WeightBreakdown {
  wLocation: number;
  wWeather: number;
  wTime: number;
  wEar: number;
  /** w_location * w_weather * w_time * w_ear */
  combined: number;
}

export interface WSSResult {
  /** 감점항(P(x)) 미포함 원점수 - 회귀/통계 분석용 (보고서 IV.B.다 참고) */
  rawScore: number;
  /** 감점항 포함 - 사용자에게 보여주는 점수 */
  displayScore: number;
  /** 총 보행 시간 대비 스마트폰 사용 비율 (x) */
  usageRatio: number;
  /** 위험지역 진입 감지 여부 (실시간 알림 트리거용) */
  enteredHighRiskZoneWhileUsingPhone: boolean;
  /** WSS_critical 미만 여부 (보고서 임계점 60 기준, 알림/위험표시 등 트리거) */
  belowCriticalThreshold: boolean;
  segmentBreakdown: Array<{ regionId: string; weight: WeightBreakdown; contribution: number }>;
  // --- 사용 밴드 집계. 모두 선택 필드(하위호환) ---
  /** 사용 밴드의 분(minute) 합계. FEAT-003 이후 usageBandsFromSegments(segments) 로 채우며
   * confirmedUseMinutes(사용)/noUseMinutes(미사용)만 채워지고 estimated/unknown 은 항상 0 이다.
   * 밴드 필드 없는 레거시 세그먼트는 smartphoneUseMinutes 를 no-use 로 접어 집계한다. */
  usageBands?: UsageBands;
  /** [은퇴] 예전 '측정 불충분' 지표(미관측 시간/총 보행). FEAT-003 이후 더 이상 기록하지 않는다.
   * 옛 이력 행과의 하위호환을 위해 선택 필드로만 남겨둔다(리포트는 가드해 읽는다). */
  unknownRatio?: number;
  /** [은퇴] 예전 '측정 불충분' 여부. FEAT-003 이후 더 이상 기록하지 않는다(자세 기반 이분화로
   * 모든 구간이 use/no-use 로 분류되어 '측정 불충분' 개념이 사라짐). 옛 이력 행 호환용 선택 필드. */
  measurementInsufficient?: boolean;
  /** 보행이 끝난 로컬 날짜(yyyy-mm-dd). 저장 시점(stop)에 toDateISO(new Date())로 채운다
   * (업로드에 쓰는 date_iso 와 동일 값). 주간 일별 막대그래프 집계용.
   * 선택 필드(옵셔널)로 두어 이 필드가 없던 과거 이력 행과 하위호환된다(없으면 집계에서 제외).
   * 기존 필드는 무엇도 제거/개명하지 않는다(engine.ts/report.tsx/검증스크립트 의존). */
  dateISO?: string;
}

export interface AccidentZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** 폴리곤 근사 반경(m) - 표준데이터의 폴리곤을 원으로 단순화 */
  radiusMeters: number;
  accidentCount3y: number;
  source: 'TAAS_STANDARD' | 'SAMPLE_PLACEHOLDER';
}
