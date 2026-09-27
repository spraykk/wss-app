// WSS 4단계 등급 분류 (순수 함수)
//
// 리포트 화면(app/report.tsx)이 점수 + 서버 통계(평균/Q3)로 등급을 매기고 등급별
// 피드백을 보여줄 때 쓰는 유일한 판정 로직이다. RN/Expo 런타임과 무관한 순수 계산이라
// node --experimental-strip-types 로 그대로 검증 가능(erasable-only: enum/네임스페이스/
// 파라미터 프로퍼티 금지, 상대 import 확장자 없음).
//
// 판정 규칙(우선순위 순):
//   1) score < criticalThreshold(60)  -> 'danger'  (통계와 무관한 절대기준을 최우선한다)
//   2) 표본부족(count < minSample) 또는 mean/q3 가 null -> 'insufficient'
//      (가짜 안심/비교를 만들지 않고 "측정 중"으로 정직하게 표시하기 위함)
//   3) score < mean -> 'caution'   (또래 평균 미만)
//   4) score < q3   -> 'good'      (평균 이상, 상위 25% 미만)
//   5) 그 외        -> 'excellent' (상위 25% = Q3 이상)
//
// 등급/임계/통계는 참고 지표이며 실제 사고 발생을 예측하지 않는다.

export type WssGrade = 'danger' | 'caution' | 'good' | 'excellent' | 'insufficient';

export interface GradeStats {
  count: number;
  mean: number | null;
  q3: number | null;
}

export function classifyGrade(
  score: number,
  stats: GradeStats,
  criticalThreshold: number,
  minSample: number
): WssGrade {
  // 1) 절대기준: 임계점 미만이면 통계 유무와 무관하게 위험.
  if (score < criticalThreshold) return 'danger';

  // 2) 표본부족/미집계: 또래 비교 불가 -> "측정 중".
  if (stats.count < minSample || stats.mean === null || stats.q3 === null) {
    return 'insufficient';
  }

  // 3~5) 또래 분포 대비 상대 등급.
  if (score < stats.mean) return 'caution';
  if (score < stats.q3) return 'good';
  return 'excellent';
}
