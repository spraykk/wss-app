import { WalkSegment, WeightBreakdown, WSSResult } from '../types';
import { computeLocationWeight, DEDUCTION_SCALE, EAR_WEIGHT, PENALTY_SEVERITY, TIME_WEIGHT, USAGE_RATIO_PENALTY_THRESHOLD, WEATHER_WEIGHT, WSS_CRITICAL } from './weights';
export function computeSegmentWeight(segment: WalkSegment): WeightBreakdown {
  const wLocation = computeLocationWeight(segment.riskIntensity);
  const wWeather = WEATHER_WEIGHT[segment.weather];
  const wTime = TIME_WEIGHT[segment.timeBand];
  const wEar = segment.isEarOccluded ? EAR_WEIGHT.occluded : EAR_WEIGHT.open;
  const combined = wLocation * wWeather * wTime * wEar;
  return { wLocation, wWeather, wTime, wEar, combined };
}
function penalty(usageRatio: number, totalWalkMinutes: number): number {
  if (usageRatio < USAGE_RATIO_PENALTY_THRESHOLD) return 0;
  const shortWalkDamping = totalWalkMinutes < 3 ? 0.5 : 1;
  return PENALTY_SEVERITY * (usageRatio - USAGE_RATIO_PENALTY_THRESHOLD) * shortWalkDamping;
}
export function computeWSS(segments: WalkSegment[]): WSSResult {
  const segmentBreakdown = segments.map((s) => {
    const weight = computeSegmentWeight(s);
    return { regionId: s.regionId, weight, contribution: weight.combined * s.smartphoneUseMinutes };
  });
  const totalDeduction = segmentBreakdown.reduce((sum, s) => sum + s.contribution, 0);
  const totalWalkMinutes = segments.reduce((sum, s) => sum + s.walkMinutes, 0);
  const totalUseMinutes = segments.reduce((sum, s) => sum + s.smartphoneUseMinutes, 0);
  const usageRatio = totalWalkMinutes > 0 ? totalUseMinutes / totalWalkMinutes : 0;
  // 감점 스케일 배율(DEDUCTION_SCALE=k): 가중치 비율은 유지하고 전체 감점만 ×k 로 증폭한다.
  // penalty(P(x)) 도 스케일 일관성을 위해 ×k 를 적용한다(파라미터 0.3/40 은 불변, 결과에만).
  const scaledDeduction = DEDUCTION_SCALE * totalDeduction;
  const rawScore = clampScore(100 - scaledDeduction);
  const displayScore = usageRatio >= USAGE_RATIO_PENALTY_THRESHOLD ? clampScore(100 - scaledDeduction - DEDUCTION_SCALE * penalty(usageRatio, totalWalkMinutes)) : rawScore;
  const enteredHighRiskZoneWhileUsingPhone = segments.some((s) => s.riskIntensity > 0 && s.smartphoneUseMinutes > 0);
  return { rawScore, displayScore, usageRatio, enteredHighRiskZoneWhileUsingPhone, belowCriticalThreshold: rawScore < WSS_CRITICAL, segmentBreakdown };
}
function clampScore(v: number): number { return Math.max(0, Math.min(100, v)); }
