// WSS 가중치 정의
//
// 출처/근거 구분:
// - TIME_WEIGHT, WEATHER_WEIGHT 는 **실증값**이다. 사용자가 제공한 전국 교통사고
//   통계(시간대 × 기상상태 교차표, 전체 교통사고)를 EPDO(사망 12 / 중상 3 /
//   경상 1 / 부상신고 0.5) 치명도가중으로 환산해, "사고 1건당 EPDO 심각도"의
//   상대배수를 구한 값이다(각각 주간=1.0, 맑음=1.0 을 기준으로 정규화).
//   이는 "노출량(사고 빈도)"이 아니라 "사고 발생 시 치명도"를 나타내므로 시간대
//   간 차이가 작다. 전체 교통사고 기반이며 보행자 전용 통계가 아니다.
// - LOCATION_WEIGHT, OVERLAP_WEIGHT_MULTIPLIER, EAR_WEIGHT 는 **설계값**이다.
//   해당 요인에 대한 건당 심각도 실증 통계가 없어 설계자가 위험도를 반영해
//   설정하되, 위 실증 요인들의 스케일(약 1~1.6)에 맞춰 재조정했다. 참고 지표이며
//   검증된 예측이 아니다.
import { TimeBand, WeatherCondition } from '../types';

// [설계값] 위치(사고다발구역) 가중치. 실증 스케일(1~1.6)에 맞춰 highRisk 를
// 2.5 -> 1.5 로 재조정. normal(구역 밖)=1.0 유지.
export const LOCATION_WEIGHT = { highRisk: 1.5, normal: 1.0 } as const;

// [설계값] 사고다발구역이 여러 개 겹칠 때의 가중 배수. 실증 스케일에 맞춰
// 1.4 -> 1.15 로 재조정.
export const OVERLAP_WEIGHT_MULTIPLIER = 1.15;

export const REFERENCE_ACCIDENT_COUNT = 5;
export const SEVERITY_FLOOR = 0.5;
export function computeZoneSeverity(accidentCount3y: number): number {
  const count = Math.max(1, accidentCount3y);
  const raw = Math.log(count + 1) / Math.log(REFERENCE_ACCIDENT_COUNT + 1);
  return Math.max(SEVERITY_FLOOR, raw);
}
export function computeRiskIntensity(accidentCounts: number[]): number {
  return accidentCounts.reduce((sum, c) => sum + computeZoneSeverity(c), 0);
}
export function computeLocationWeight(riskIntensity: number): number {
  if (riskIntensity <= 0) return LOCATION_WEIGHT.normal;
  return LOCATION_WEIGHT.highRisk * Math.pow(OVERLAP_WEIGHT_MULTIPLIER, riskIntensity - 1);
}

// [실증값] 기상상태별 건당 EPDO 심각도 상대배수(맑음=1.0). 전국 교통사고 통계
// (기상상태 교차표)에 EPDO 치명도가중을 적용해 산출. 안개(fog)는 사망률 약 92‰
// 로 전 기상상태 중 최고라 1.62 로 가장 높다. 전체 교통사고 기반, 보행자 전용 아님.
export const WEATHER_WEIGHT: Record<WeatherCondition, number> = {
  clear: 1.0,
  rain_or_snow: 1.06,
  other_not_clear: 1.14,
  fog: 1.62,
};

// [실증값] 시간대별 건당 EPDO 심각도 상대배수(주간=1.0). "사고 발생 시 치명도"
// 기준(노출량 아님)이라 시간대 차이가 작다. 야간이 다소 높다. 전국 교통사고 기반.
export const TIME_WEIGHT: Record<TimeBand, number> = {
  normal_day: 1.0,
  rush_am: 0.97,
  rush_pm: 0.94,
  normal_night: 1.09,
};

// [설계값] 이어폰/차음 환경 가중치. 실증 스케일에 맞춰 occluded 1.5 -> 1.3 재조정.
// open(개방)=1.0 유지.
export const EAR_WEIGHT = { occluded: 1.3, open: 1.0 } as const;

// 스마트폰 사용 감점 파라미터(변경 금지).
export const USAGE_RATIO_PENALTY_THRESHOLD = 0.3;
export const PENALTY_SEVERITY = 40;

// WSS 참고 기준선(보고서 상수). 참조처가 많아 값/타입 유지.
export const WSS_CRITICAL = 80.605;
