import { WalkSegment, WeightBreakdown, WSSResult } from '../types';
import { computeLocationWeight, DEDUCTION_SCALE, EAR_WEIGHT, TIME_WEIGHT, WEATHER_WEIGHT, WSS_CRITICAL } from './weights';
import { usageBandsFromSegments } from '../session/usageClassification';

// 세그먼트의 "감지된 사용 시간"(분)을 구한다(FEAT-003: 자세 기반).
// 새 채점은 자세(보행 중 화면 보기)로 감지된 confirmedUseMinutes 만 감점한다. 이 필드가 없는
// 레거시 세그먼트(과거 데이터/구버전)는 하위호환을 위해 smartphoneUseMinutes 로 폴백해
// 예전 동작을 그대로 재현한다. (정직성: 관측 못 한 시간을 사용으로 감점하지 않는다.)
function confirmedUseMinutesOf(s: WalkSegment): number {
  return typeof s.confirmedUseMinutes === 'number' && Number.isFinite(s.confirmedUseMinutes)
    ? s.confirmedUseMinutes
    : s.smartphoneUseMinutes;
}
export function computeSegmentWeight(segment: WalkSegment): WeightBreakdown {
  const wLocation = computeLocationWeight(segment.riskIntensity);
  const wWeather = WEATHER_WEIGHT[segment.weather];
  const wTime = TIME_WEIGHT[segment.timeBand];
  const wEar = segment.isEarOccluded ? EAR_WEIGHT.occluded : EAR_WEIGHT.open;
  const combined = wLocation * wWeather * wTime * wEar;
  return { wLocation, wWeather, wTime, wEar, combined };
}
export function computeWSS(segments: WalkSegment[]): WSSResult {
  // 감점/사용비율은 "확인된 사용 시간"으로 구동한다(Option A - Step 1).
  // (레거시 세그먼트는 confirmedUseMinutesOf 가 smartphoneUseMinutes 로 폴백 -> 예전 동작 유지.)
  const segmentBreakdown = segments.map((s) => {
    const weight = computeSegmentWeight(s);
    return { regionId: s.regionId, weight, contribution: weight.combined * confirmedUseMinutesOf(s) };
  });
  const totalDeduction = segmentBreakdown.reduce((sum, s) => sum + s.contribution, 0);
  const totalWalkMinutes = segments.reduce((sum, s) => sum + s.walkMinutes, 0);
  // usageRatio 분자는 확인된 사용 시간(분), 분모는 관측된 보행 시간(분)으로 불변.
  const totalConfirmedMinutes = segments.reduce((sum, s) => sum + confirmedUseMinutesOf(s), 0);
  const usageRatio = totalWalkMinutes > 0 ? totalConfirmedMinutes / totalWalkMinutes : 0;
  // 감점 스케일 배율(DEDUCTION_SCALE=k): 가중치 비율은 유지하고 전체 감점만 ×k 로 증폭한다.
  const scaledDeduction = DEDUCTION_SCALE * totalDeduction;
  const rawScore = clampScore(100 - scaledDeduction);
  // [설계자 결정] usageRatio 누진 penalty 를 감점 곡선에서 제거했다.
  // 근거: 조금만 사용해도 usageRatio 가 30% 를 넘기 쉬워(애초에 30% 초과가 어렵지 않음)
  // 점수가 너무 빨리 감소하던 문제를 완화하기 위함이다. 감점은 이제 "사용 시간 × 가중치"
  // 기반(scaledDeduction)만 남긴다. 그 결과 displayScore 는 rawScore 와 동일하다.
  // usageRatio 자체는 리포트·홈의 '휴대폰 보며 걸은 비율 %' 표시용으로 계속 계산/반환한다.
  // rawScore(회귀·통계용)의 기존 의미는 그대로 유지한다(하위호환).
  const displayScore = rawScore;
  // 위험지역에서 "감지된" 사용이 있었는지(riskIntensity>0 && use>0)로 트리거한다.
  const enteredHighRiskZoneWhileUsingPhone = segments.some((s) => s.riskIntensity > 0 && confirmedUseMinutesOf(s) > 0);
  // 사용/미사용 집계(리포트 표시용). 자세 기반 이분화 이후 use(confirmedUse)/no-use 만 채운다.
  // estimatedUse/unknownUse 는 은퇴했고, 관측 충분성('측정 불충분')도 더 이상 기록하지 않는다
  // (FEAT-003). WSSResult.unknownRatio/measurementInsufficient 는 하위호환을 위해 타입에만
  // 남겨두되 여기서는 쓰지 않는다(옛 이력 행만 그 값을 가질 수 있고 리포트는 가드해 읽는다).
  const usageBands = usageBandsFromSegments(segments);
  return {
    rawScore,
    displayScore,
    usageRatio,
    enteredHighRiskZoneWhileUsingPhone,
    belowCriticalThreshold: rawScore < WSS_CRITICAL,
    segmentBreakdown,
    usageBands,
    // 확정 보행 시간(분)의 합. 이미 위에서 계산한 값 그대로 노출한다(채점 math 불변).
    // 하루 대표 점수 가중평균의 가중치이자 리포트 이력의 총 보행 시간 표기 소스가 된다.
    totalWalkMinutes,
  };
}
function clampScore(v: number): number { return Math.max(0, Math.min(100, v)); }
