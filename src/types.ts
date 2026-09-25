// 보행안전점수(WSS) 앱 - 공통 타입 정의
// 원 보고서: "보행중 스마트폰 사용 억제를 통한 보행 안전 확보:
//            로지스틱 회귀모형을 통한 보행안전점수(WSS) 설계 및 이를 활용한 넛지"

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
  /** WSS_critical 미만 여부 (보고서 임계점 80.605 기준, 잠금해제 강화 등 트리거) */
  belowCriticalThreshold: boolean;
  segmentBreakdown: Array<{ regionId: string; weight: WeightBreakdown; contribution: number }>;
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
