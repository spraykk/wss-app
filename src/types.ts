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
  // --- Option A (Step 1) 증거 밴드별 분(minute). 모두 선택 필드(하위호환) ---
  // smartphoneUseMinutes 는 하위호환을 위해 유지되며, 새 채점은 confirmedUseMinutes 를 읽는다.
  // 밴드 필드가 없는 과거 세그먼트는 aggregateUsageBands 에서 레거시 폴백(unknownUse)으로 처리된다.
  // 밴드 분류 근거/규칙은 src/session/usageClassification.ts 참고.
  /** [확인] 실제 인앱 터치/스크롤로 확인된 사용 시간(분). 새 채점의 감점 소스. */
  confirmedUseMinutes?: number;
  /** [추정] 자세 추정 기반 사용 시간(분). Step 1 에서는 항상 0(감점 안 함, 향후 과제). */
  estimatedUseMinutes?: number;
  /** [미관측] 백그라운드/센서 stale/무신호로 관측 불가한 시간(분). 감점 아님, 충분성 판정에 사용. */
  unknownUseMinutes?: number;
  /** [무사용] 사용 안 함으로 볼 수 있는 시간(분). Step 1 에서는 보수적으로 0(unknownUse 로 접음). */
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
  // --- Option A (Step 1) 증거 밴드 집계 + 관측 충분성. 모두 선택 필드(하위호환) ---
  /** 네 증거 밴드(confirmed/estimated/unknown/noUse)의 분(minute) 합계.
   * aggregateUsageBands(segments) 로 채운다. 밴드 필드 없는 레거시 세그먼트는 unknownUse 로 폴백. */
  usageBands?: UsageBands;
  /** 미관측(unknown) 시간 / 총 보행 시간. 관측을 얼마나 못 했는지의 정직한 지표. */
  unknownRatio?: number;
  /** 관측 불충분 여부(보행 없음 또는 unknownRatio >= UNKNOWN_RATIO_INSUFFICIENT_THRESHOLD).
   * true 면 리포트에서 '측정 불충분'을 표시하고 관측 못 한 시간에 좋은 점수를 주지 않는다(정직성). */
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
