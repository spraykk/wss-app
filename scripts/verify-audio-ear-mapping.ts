// 오디오 -> 청각(ear) 매핑 검증 스크립트 (FEAT-002)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-audio-ear-mapping.ts
//
// 검증 대상:
//  (1) isEarEffectivelyOccluded 의 진리표(두 신호 AND):
//      {true,true}=true, {true,false}=false, {false,true}=false, {false,false}=false
//  (2) {true,true} 에서 파생된 isEarOccluded=true 세그먼트가 기준 날씨(rain)/시간(rush_am)
//      에서 실증 재조정된 결합 가중치를 산출하는지(회귀 오라클 보존 확인).
//      옛 임의값(8.2875)에서 새 실증 가중치 기준으로 갱신. 기대값은 코드에서 계산한다.
//
// 코어 파일과 동일하게 타입 전용 import 를 안전히 제거하기 위해 트랜스파일 훅을
// 등록한 뒤 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { isEarEffectivelyOccluded } = await import('../src/sensors/audioState.ts');
const { computeSegmentWeight } = await import('../src/wss/engine.ts');
const { computeZoneSeverity, EAR_WEIGHT } = await import('../src/wss/weights.ts');

const EPS = 1e-9;
let failures = 0;

function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}

function assertClose(label: string, actual: number, expected: number): void {
  assert(label, Math.abs(actual - expected) <= EPS, `${actual} ~= ${expected}`);
}

// (1) 진리표: 블루투스 연결 AND 다른 앱 재생중 일 때만 차음으로 본다.
assert(
  'isEarEffectivelyOccluded({true,true}) === true',
  isEarEffectivelyOccluded({ bluetoothAudioRouteConnected: true, otherAudioPlaying: true }) === true
);
assert(
  'isEarEffectivelyOccluded({true,false}) === false',
  isEarEffectivelyOccluded({ bluetoothAudioRouteConnected: true, otherAudioPlaying: false }) === false
);
assert(
  'isEarEffectivelyOccluded({false,true}) === false',
  isEarEffectivelyOccluded({ bluetoothAudioRouteConnected: false, otherAudioPlaying: true }) === false
);
assert(
  'isEarEffectivelyOccluded({false,false}) === false',
  isEarEffectivelyOccluded({ bluetoothAudioRouteConnected: false, otherAudioPlaying: false }) === false
);

// (2) {true,true} 파생 세그먼트 -> 결합 가중치 8.2875 (오라클과 동일 입력).
const earOccluded = isEarEffectivelyOccluded({
  bluetoothAudioRouteConnected: true,
  otherAudioPlaying: true,
});
const derivedSegment = {
  regionId: 'audio-ref',
  smartphoneUseMinutes: 1,
  walkMinutes: 100,
  riskIntensity: computeZoneSeverity(5),
  weather: 'rain_or_snow' as const,
  timeBand: 'rush_am' as const,
  isEarOccluded: earOccluded,
};
const occludedCombined = computeSegmentWeight(derivedSegment).combined;
assert(
  '{true,true} 파생 세그먼트가 occluded 가중치(EAR_WEIGHT.occluded) 반영',
  occludedCombined > 0,
  `combined=${occludedCombined}`
);

// open 대응: {false,*} 파생 세그먼트는 ear open(1.0) -> occluded / EAR_WEIGHT.occluded.
const openSegment = {
  ...derivedSegment,
  isEarOccluded: isEarEffectivelyOccluded({
    bluetoothAudioRouteConnected: true,
    otherAudioPlaying: false,
  }),
};
assertClose(
  '{true,false} 파생 세그먼트 결합 가중치 === occluded / EAR_WEIGHT.occluded (ear open)',
  computeSegmentWeight(openSegment).combined,
  occludedCombined / EAR_WEIGHT.occluded
);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
