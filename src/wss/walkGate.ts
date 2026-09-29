// 보행 결과 "저장/표시 여부" 게이팅용 순수 술어.
//
// 배경(플랫폼 일관성 수정): 보행 세션을 시작→즉시 종료(실제 보행 0초)했을 때,
// iOS 는 세션 시작 시 현재 위치를 한 번 잡아 세그먼트가 1개 생겨(걷지 않아도)
// computeWSS 가 감점 0 => displayScore 100 을 돌려줘 "안 걷고 100점"이 떴고,
// 안드로이드는 그 시작 위치 샘플이 없어 세그먼트 0 => "측정된 보행이 없어요"가 떠
// 플랫폼 간 불일치가 생겼다. 그래서 "세그먼트 유무"가 아니라 "실제로 걸은 시간
// (확정 보행 시간 합)"으로 결과 인정 여부를 판정한다.
//
// 이 모듈은 RN 런타임에서 실행되므로 node:* 표준 라이브러리를 import 하지 않는다.
// 순수 함수라 scripts/verify-walk-gate.ts 로 뮤테이션 민감하게 검증한다.
import type { WSSResult } from '../types';

// "실제로 걸었는가?"를 확정 보행 시간(computeWSS 의 totalWalkMinutes, 확정 보행 시간
// 합)이 유한하고 0보다 큰지로 판정한다. totalWalkMinutes 는 정지/차량/센서공백을 이미
// 0으로 처리한 값이라, 0초 보행(시작→즉시 종료)은 세그먼트가 있어도 이 값이 0 => false.
// totalWalkMinutes 가 없던(과거/비정상) 결과나 비유한/음수도 방어적으로 false 로 본다.
export function hasWalked(result: WSSResult): boolean {
  const min = result.totalWalkMinutes;
  return typeof min === 'number' && Number.isFinite(min) && min > 0;
}
