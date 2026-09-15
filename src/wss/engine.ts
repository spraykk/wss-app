import { WalkSegment, WeightBreakdown, WSSResult } from '../types';
import { computeLocationWeight, EAR_WEIGHT, PENALTY_SEVERITY, TIME_WEIGHT, USAGE_RATIO_PENALTY_THRESHOLD, WEATHER_WEIGHT, WSS_CRITICAL } from './weights';
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
  const rawScore = clampScore(100 - totalDeduction);
  const displayScore = usageRatio >= USAGE_RATIO_PENALTY_THRESHOLD ? clampScore(100 - totalDeduction - penalty(usageRatio, totalWalkMinutes)) : rawScore;
  const enteredHighRiskZoneWhileUsingPhone = segments.some((s) => s.riskIntensity > 0 && s.smartphoneUseMinutes > 0);
  return { rawScore, displayScore, usageRatio, enteredHighRiskZoneWhileUsingPhone, belowCriticalThreshold: rawScore < WSS_CRITICAL, segmentBreakdown };
}
function clampScore(v: number): number { return Math.max(0, Math.min(100, v)); }
