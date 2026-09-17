// 세그먼트 키 생성 (버그 #1, HIGH) - 순수/검증 가능 모듈
//
// 배경: useWalkSession 훅은 GPS 샘플을 WalkSegment 로 묶기 위해 "세그먼트 키"를
// 만들어, 키가 바뀔 때마다 새 세그먼트를 시작한다. 기존 키는 riskIntensity 를
// toFixed(4) 로 그대로 문자열화했다. riskIntensity 는 연속(continuous) 값이라
// GPS 노이즈로 인한 미세한 변동에도 매번 다른 키가 만들어져 세그먼트가
// 과도하게 분할(over-split)되었다.
//
// FIX: riskIntensity 를 0.25 간격 버킷으로 양자화(bucketize)해 키를 안정화한다.
// (대표 zone id 가 있으면 그것도 키에 포함해 물리적으로 다른 지역은 확실히 분리.)
// 이 순수 함수는 React Native 없이 `node --experimental-strip-types` 로 검증 가능하다.
import type { WeatherCondition, TimeBand } from '../types';

// riskIntensity 버킷 크기(위험강도 0.25 단위). GPS 노이즈 수준의 미세 변동을
// 같은 버킷으로 흡수하면서, 유의미한 위험도 변화는 다른 버킷으로 분리한다.
export const RISK_INTENSITY_BUCKET = 0.25;

// riskIntensity 를 버킷 경계로 양자화한다. 순수 함수.
export function bucketizeRiskIntensity(
  riskIntensity: number,
  bucket: number = RISK_INTENSITY_BUCKET
): number {
  if (bucket <= 0) return riskIntensity;
  // 부동소수 잔차를 없애기 위해 소수 4자리로 반올림한 값을 반환한다.
  const snapped = Math.round(riskIntensity / bucket) * bucket;
  return Math.round(snapped * 1e4) / 1e4;
}

export interface SegmentKeyInput {
  // 대표 사고다발지역 id (없으면 빈 문자열 등으로 안전 처리)
  zoneId: string;
  riskIntensity: number;
  weather: WeatherCondition;
  timeBand: TimeBand;
  isEarOccluded: boolean;
}

// 세그먼트 키를 만드는 순수 함수. riskIntensity 는 버킷화하여 안정화한다.
// 동일 버킷/동일 맥락이면 같은 키 -> 세그먼트 유지, 버킷이 넘어가면 새 세그먼트.
export function buildSegmentKey(
  input: SegmentKeyInput,
  bucket: number = RISK_INTENSITY_BUCKET
): string {
  const riskBucket = bucketizeRiskIntensity(input.riskIntensity, bucket).toFixed(4);
  const ear = input.isEarOccluded ? '1' : '0';
  return [input.zoneId, riskBucket, input.weather, input.timeBand, ear].join('|');
}
