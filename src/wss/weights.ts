import { TimeBand, WeatherCondition } from '../types';
export const LOCATION_WEIGHT = { highRisk: 2.5, normal: 1.0 } as const;
export const OVERLAP_WEIGHT_MULTIPLIER = 1.4;
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
export const WEATHER_WEIGHT: Record<WeatherCondition, number> = { rain_or_snow: 1.7, other_not_clear: 1.3, clear: 1.0 };
export const TIME_WEIGHT: Record<TimeBand, number> = { rush_am: 1.3, rush_pm: 1.5, normal_day: 1.0, normal_night: 1.2 };
export const EAR_WEIGHT = { occluded: 1.5, open: 1.0 } as const;
export const USAGE_RATIO_PENALTY_THRESHOLD = 0.3;
export const PENALTY_SEVERITY = 40;
export const WSS_CRITICAL = 80.605;
