// 오디오 환경 감지 (FEAT-002) - 자동 감지 오디오 상태 -> WSS 청각 가중치(w_ear)
//
// 배경/설계 근거: .agents/tasks/task-bg-audio-wss/AUDIO_DETECTION_FINDINGS.md
//
// 이 앱은 "블루투스 이어폰 연결 + 다른 앱이 오디오 재생중"을 감지해 차음(ear-occluded)
// 환경으로 간주하고, 그 경우에만 청각 가중치를 상향(occluded=1.5)한다. 감점 형태가
// 아니라 위험 가중치 상향 요소로만 쓴다. 내비/통화 오탐을 막기 위해 "재생중" 단독이나
// "블루투스 연결" 단독으로는 차음으로 보지 않고, 두 신호의 AND 만 사용한다.
//
// 신호 계약(FEAT-001에서 확정): { bluetoothAudioRouteConnected, otherAudioPlaying }
// 실제 감지는 iOS 네이티브(AVAudioSession.isOtherAudioPlaying / currentRoute.outputs[].portType)
// 를 읽는 커스텀 Expo 모듈이 필요하며 EAS dev build 에서만 동작한다(Expo Go 불가).
// 노이즈 캔슬링(ANC) 활성 여부는 iOS 공개 API 로 감지 불가하므로 계약에 포함하지 않는다.
//
// 아래 순수 함수(isEarEffectivelyOccluded)는 React Native 없이
// `node --experimental-strip-types` 로 검증 가능하다(erasable-only TS).

/** 자동 감지된 오디오 환경. FEAT-001에서 확정한 최소 신호 집합. */
export type AudioEnvironment = {
  /** 현재 출력 경로가 블루투스(A2DP/HFP)로 연결되어 있는가 */
  bluetoothAudioRouteConnected: boolean;
  /** 다른 앱(음악/팟캐스트/영상 등)이 지금 오디오를 재생중인가 */
  otherAudioPlaying: boolean;
};

/**
 * "귀가 실질적으로 막혔는가"를 판정하는 순수 함수.
 * 블루투스 이어폰이 연결되어 있고(bluetoothAudioRouteConnected) 동시에 무언가
 * 재생중(otherAudioPlaying)일 때만 true. 두 신호의 AND 로, 재생 단독/연결 단독의
 * 오탐(내비 스피커, 이어폰만 목에 걸친 경우 등)을 배제한다.
 * 이 boolean 이 WalkSegment.isEarOccluded 의 소스가 되어 EAR_WEIGHT(occluded=1.5,
 * open=1.0)로 매핑된다. 숫자 매핑은 회귀 오라클 보존을 위해 변경하지 않는다.
 */
export function isEarEffectivelyOccluded(env: AudioEnvironment): boolean {
  return env.bluetoothAudioRouteConnected && env.otherAudioPlaying;
}

/** 안전 축소 기본값: 감지 불가/미지원 시 open ear(오탐 없음)로 취급한다. */
export const OPEN_EAR_ENVIRONMENT: AudioEnvironment = {
  bluetoothAudioRouteConnected: false,
  otherAudioPlaying: false,
};
