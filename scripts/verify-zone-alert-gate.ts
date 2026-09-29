// 고위험 구간(빨간 원) 진입 알림 '처음 한 번만' 게이트 검증 스크립트 (FEAT-002)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-zone-alert-gate.ts
//
// 목적: src/session/zoneAlertGate.ts#decideZoneEntryAlert 의 진입 가드 규칙을 뮤테이션 민감하게
// 고정한다. 이 게이트는 밀집 클러스터 알림 게이트(decideDenseClusterAlert)와 동일한 패턴으로,
// 고위험 진입 알림을 구간 진입 시 '한 번만' 발송하고, 같은 구간에 머무는 동안 재발송하지 않으며,
// 구간을 벗어나면 마커를 '' 로 리셋해 재진입/다른 구간에서 다시 발송하게 한다.
//
// 검증 케이스(feature 스펙):
//  (1) 구간 'A' 첫 진입 + 조건 충족 => fire=true, nextZoneId='A'.
//  (2) 'A' 유지(prev 'A', current 'A', 조건 충족) => fire=false, nextZoneId='A'(재발송 없음).
//  (3) 구간 이탈(inZone=false, current '') => fire=false, nextZoneId=''(리셋).
//  (4) 리셋 후 'A' 재진입(prev '', current 'A', 조건 충족) => fire=true.
//  (5) 다른 구간 'B' 진입(prev 'A') => fire=true, nextZoneId='B'.
//  (6) 구간 안이지만 조건 미충족 => fire=false, nextZoneId=이전값 유지(전진 금지). 이어서 같은
//      구간에서 조건이 충족되면 fire=true(한 번 발송).
// verify-walk-gate.ts / verify-zone-cluster.ts 와 동일하게 트랜스파일 훅을 먼저 등록해 src/*.ts
// 를 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { decideZoneEntryAlert } = await import('../src/session/zoneAlertGate.ts');

let failures = 0;
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}

// (1) 구간 'A' 첫 진입(직전 '') + 조건 충족 => 발송 + 'A' 로 전진.
{
  const d = decideZoneEntryAlert('', 'A', true, true);
  assert('(1) 첫 진입(prev="") + 조건 충족 => fire=true', d.fire === true, `fire=${d.fire}`);
  assert('(1) 첫 진입 => nextZoneId="A"(전진)', d.nextZoneId === 'A', `nextZoneId=${d.nextZoneId}`);
}

// (2) 같은 구간 'A' 유지 + 조건 충족 => 재발송 없음, 'A' 유지.
{
  const d = decideZoneEntryAlert('A', 'A', true, true);
  assert('(2) 같은 구간 유지 => fire=false(재발송 없음)', d.fire === false, `fire=${d.fire}`);
  assert('(2) 같은 구간 유지 => nextZoneId="A"(유지)', d.nextZoneId === 'A', `nextZoneId=${d.nextZoneId}`);
}

// (3) 구간 이탈(inZone=false, current '') => 발송 안 함 + '' 로 리셋.
{
  const d = decideZoneEntryAlert('A', '', false, false);
  assert('(3) 구간 이탈 => fire=false', d.fire === false, `fire=${d.fire}`);
  assert('(3) 구간 이탈 => nextZoneId=""(리셋)', d.nextZoneId === '', `nextZoneId=${d.nextZoneId}`);
  // inZone=true 라도 currentZoneId='' 면 밖으로 간주해 리셋(가드 일관성).
  const d2 = decideZoneEntryAlert('A', '', true, true);
  assert('(3b) current="" 이면 inZone 값과 무관하게 fire=false, 리셋', d2.fire === false && d2.nextZoneId === '', `nextZoneId=${d2.nextZoneId}`);
}

// (4) 리셋 후 'A' 재진입(prev '', current 'A', 조건 충족) => 다시 발송.
{
  const d = decideZoneEntryAlert('', 'A', true, true);
  assert('(4) 이탈 후 재진입 => fire=true(재발송)', d.fire === true, `fire=${d.fire}`);
  assert('(4) 재진입 => nextZoneId="A"', d.nextZoneId === 'A', `nextZoneId=${d.nextZoneId}`);
}

// (5) 다른 구간 'B' 진입(prev 'A', 조건 충족) => 발송 + 'B' 로 전진.
{
  const d = decideZoneEntryAlert('A', 'B', true, true);
  assert('(5) 다른 구간 진입(prev="A", current="B") => fire=true', d.fire === true, `fire=${d.fire}`);
  assert('(5) 다른 구간 진입 => nextZoneId="B"(전진)', d.nextZoneId === 'B', `nextZoneId=${d.nextZoneId}`);
}

// (6) 구간 안이지만 조건 미충족 => 발송 안 함 + 마커 '전진 금지'(이전값 유지). 이어서 같은
//     구간에서 조건이 충족되면 여전히 한 번 발송된다(핵심: 조건이 나중에 참이 되는 케이스).
{
  // 아직 어떤 구간도 알리지 않은 상태('')에서 'A' 진입했지만 조건 미충족.
  const d = decideZoneEntryAlert('', 'A', true, false);
  assert('(6) 구간 안 + 조건 미충족 => fire=false', d.fire === false, `fire=${d.fire}`);
  assert('(6) 조건 미충족 => nextZoneId 이전값 유지(전진 금지, ="")', d.nextZoneId === '', `nextZoneId=${d.nextZoneId}`);
  // 후속: 같은 구간 'A' 에서 이제 조건이 충족됨 => 마커가 전진되지 않았으므로 여전히 발송.
  const dAfter = decideZoneEntryAlert(d.nextZoneId, 'A', true, true);
  assert('(6b) 이후 같은 구간에서 조건 충족 => fire=true(한 번 발송)', dAfter.fire === true, `fire=${dAfter.fire}`);
  assert('(6b) 이후 발송 시 nextZoneId="A"(전진)', dAfter.nextZoneId === 'A', `nextZoneId=${dAfter.nextZoneId}`);

  // 이미 'A' 를 알린 상태에서 잠시 조건 미충족(같은 구간 유지) => 재발송 없이 마커 유지.
  const dHold = decideZoneEntryAlert('A', 'A', true, false);
  assert('(6c) 이미 알린 구간 + 조건 미충족 => fire=false, 마커 유지("A")', dHold.fire === false && dHold.nextZoneId === 'A', `nextZoneId=${dHold.nextZoneId}`);
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll zone-alert-gate assertions PASSED');
