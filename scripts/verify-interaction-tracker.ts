// 인앱 상호작용 추적기 순수 헬퍼 검증 스크립트 (FEAT-003)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-interaction-tracker.ts
//
// src/session/interactionTracker.ts 의 순수 헬퍼 wasRecentInteraction(lastMs, nowMs, windowMs)
// 이 확인 창(confirmation window) 규칙을 정확히 따르는지 검증한다:
//   - lastMs=null(상호작용 없음) -> false
//   - now 기준 창 안(0<=delta<window) -> true, 창 밖 -> false
//   - 시계 되감김(delta<0) -> 보수적으로 false
//   - 비유한 입력 -> false
// 또한 record/hadRecent/reset 의 모듈 스코프 동작(주입 nowMs 로 결정적으로)도 검증한다.
//
// 코어 파일과 동일한 로더 패턴을 위해 트랜스파일 훅을 등록한 뒤 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const {
  wasRecentInteraction,
  recordInteraction,
  hadRecentInteraction,
  resetInteractions,
  CONFIRMED_USE_WINDOW_MS,
} = await import('../src/session/interactionTracker.ts');

let failures = 0;
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}

const W = CONFIRMED_USE_WINDOW_MS;
assert('CONFIRMED_USE_WINDOW_MS 은 60000(설계값)', W === 60_000, `${W}`);

// (1) 상호작용 없음(null) -> 최근 아님.
assert('lastMs=null -> false', wasRecentInteraction(null, 1_000_000) === false);

// (2) 창 안: delta=0(동시) -> true, delta=window-1 -> true.
assert('delta=0 -> true', wasRecentInteraction(1_000_000, 1_000_000, W) === true);
assert('delta=window-1 -> true', wasRecentInteraction(1_000_000, 1_000_000 + W - 1, W) === true);

// (3) 창 경계/밖: delta=window -> false(경계 배타), delta>window -> false.
assert('delta=window -> false(경계 배타)', wasRecentInteraction(1_000_000, 1_000_000 + W, W) === false);
assert('delta>window -> false', wasRecentInteraction(1_000_000, 1_000_000 + W + 5000, W) === false);

// (4) 시계 되감김(now<last, delta<0) -> 보수적 false.
assert('delta<0(되감김) -> false', wasRecentInteraction(1_000_000, 999_000, W) === false);

// (5) 비유한 입력 -> false.
assert('lastMs=NaN -> false', wasRecentInteraction(Number.NaN, 1_000_000, W) === false);
assert('nowMs=Infinity -> false', wasRecentInteraction(1_000_000, Number.POSITIVE_INFINITY, W) === false);

// (6) 커스텀 window 인자 존중(짧은 창).
assert('window=1000, delta=500 -> true', wasRecentInteraction(0, 500, 1000) === true);
assert('window=1000, delta=1500 -> false', wasRecentInteraction(0, 1500, 1000) === false);

// (7) 모듈 스코프 동작: record 후 창 안이면 true, 밖이면 false, reset 후 false.
{
  resetInteractions();
  assert('reset 직후 hadRecentInteraction -> false', hadRecentInteraction(5_000_000) === false);
  recordInteraction(5_000_000);
  assert('record 후 같은 시각 -> true', hadRecentInteraction(5_000_000) === true);
  assert('record 후 창 안 -> true', hadRecentInteraction(5_000_000 + W - 1) === true);
  assert('record 후 창 밖 -> false', hadRecentInteraction(5_000_000 + W + 1) === false);
  resetInteractions();
  assert('reset 후 창 안 시각이어도 -> false', hadRecentInteraction(5_000_000) === false);
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
