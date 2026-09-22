// withAudioEnvironment - AudioEnvironment 로컬 Expo 모듈용 config plugin (FEAT-005)
//
// RN/Expo prebuild 전용. Node 로 실행되지만 src/·app/ 규칙과 무관한 빌드 설정 파일이다.
// (Expo config plugin 은 CommonJS 로 로드되므로 .js 로 둔다.)
//
// 역할:
//   1) modules/audio-environment 의 로컬 Expo 모듈은 Expo autolinking 이 자동으로 iOS
//      네이티브 타깃에 링크한다(expo-module.config.json 존재). 따라서 소스 주입은 불필요.
//   2) 이 plugin 은 앱이 커스텀 네이티브 오디오 모듈에 의존함을 app.json 에 명시적으로
//      선언하는 지점이다(문서/추적용). 필요 시 여기서 Info.plist 를 조정할 수 있다.
//
// UIBackgroundModes 'audio' 를 여기서 추가하지 "않는" 이유:
//   AUDIO_DETECTION_FINDINGS.md 결론상 딥 백그라운드 오디오 세션 유지는 best-effort 이며
//   isOtherAudioPlaying 을 위해 백그라운드 오디오 세션을 상시 활성화할 정당성이 약하다.
//   (백그라운드 오디오 모드는 실제 오디오 재생 앱이 아니면 App Store 심사에서 거부 위험이
//   있다.) 따라서 'audio' 백그라운드 모드는 넣지 않고, 스냅샷은 트리거 시점(지오펜스
//   ENTER/위치 업데이트)의 best-effort 값으로 처리한다. 자세한 근거는 DEV_BUILD.md 참고.
//
// 만약 향후 백그라운드 오디오 세션 유지가 반드시 필요해지면(정당화는 FEAT-006 스토어
// 카피에서), 아래 addAudioBackgroundMode 를 활성화하면 된다.

const { withInfoPlist } = require('@expo/config-plugins');

// 필요 시에만 사용: iOS UIBackgroundModes 에 'audio' 를 추가한다.
// 기본적으로는 호출하지 않는다(위 주석 참고).
function addAudioBackgroundMode(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = cfg.modResults.UIBackgroundModes || [];
    if (!modes.includes('audio')) modes.push('audio');
    cfg.modResults.UIBackgroundModes = modes;
    return cfg;
  });
}

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @returns {import('@expo/config-plugins').ExpoConfig}
 */
function withAudioEnvironment(config) {
  // 로컬 모듈은 autolinking 으로 링크되므로 별도 소스 주입은 하지 않는다.
  // 이 plugin 의 존재/등록 자체가 "커스텀 네이티브 오디오 모듈 의존"을 선언한다.
  // 'audio' 백그라운드 모드는 의도적으로 추가하지 않는다(DEV_BUILD.md 참고).
  return config;
}

module.exports = withAudioEnvironment;
module.exports.addAudioBackgroundMode = addAudioBackgroundMode;
