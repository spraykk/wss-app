// 사용 비율(usageRatio) 표시용 순수 유도 함수
//
// usageRatio 는 computeWSS 가 계산한 "감지된 사용 시간 / 총 보행 시간"(0~1) 값이다.
// 홈(app/index.tsx)의 실시간 표시와 리포트(app/report.tsx)의 대표 문구가 같은
// 백분율 규칙을 공유하도록 단일 진실(single source of truth)로 여기서 유도한다.
//
// RN/Expo 런타임과 무관한 순수 계산이라 node --experimental-strip-types 로 그대로
// 검증 가능하다(erasable-only: enum/네임스페이스/파라미터 프로퍼티 금지, 상대 import
// 확장자 없음, node import 없음).

/**
 * usageRatio(0~1)를 0~100 정수 백분율로 반올림한다.
 * - 방어적으로: 유한하지 않거나 음수면 0, 1 초과면 100 으로 클램프한다.
 * - 분모(총 보행 시간)가 0 이라 usageRatio 가 0 인 경우 자연스럽게 0% 가 된다.
 */
export function useRatioPercent(usageRatio: number): number {
  if (!Number.isFinite(usageRatio) || usageRatio <= 0) return 0;
  if (usageRatio >= 1) return 100;
  return Math.round(usageRatio * 100);
}

/**
 * 화면에 그대로 붙일 수 있는 백분율 문자열(예: "37%").
 */
export function formatUseRatioPercent(usageRatio: number): string {
  return `${useRatioPercent(usageRatio)}%`;
}
