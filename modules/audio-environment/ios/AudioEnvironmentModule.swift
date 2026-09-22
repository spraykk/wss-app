// AudioEnvironment - iOS 네이티브 오디오 환경 감지 (FEAT-005; 설계 근거 FEAT-001)
//
// AUDIO_DETECTION_FINDINGS.md 의 스케치를 실제 로컬 Expo 모듈로 구현한다.
// 이 모듈은 EAS development build(또는 preview/production)에서만 동작하며 Expo Go 에서는
// 실행되지 않는다. 이 모듈이 프로젝트에 존재하는 순간부터 Expo Go 로 앱을 열 수 없다.
//
// JS 브리지 계약(src/sensors/audioState.ts 의 AudioEnvironment 와 정확히 매칭):
//   getEnvironment(): { bluetoothAudioRouteConnected: Bool, otherAudioPlaying: Bool }
//   event onAudioEnvironmentChange: 위와 동일한 payload (routeChangeNotification 기반)
//
// 감지 신호:
//   - otherAudioPlaying: AVAudioSession.sharedInstance().isOtherAudioPlaying
//   - bluetoothAudioRouteConnected: currentRoute.outputs 중 portType 이
//       .bluetoothA2DP 또는 .bluetoothHFP 인 출력이 있는지
//
// 감지 불가/미지원(예: 노이즈 캔슬링 활성 여부)은 계약에 포함하지 않는다(공개 API 없음).

import ExpoModulesCore
import AVFoundation

public class AudioEnvironmentModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioEnvironment")

    Events("onAudioEnvironmentChange")

    // 현재 오디오 환경 스냅샷을 동기로 반환한다.
    // JS 훅/백그라운드 스냅샷(readAudioEnvironmentSnapshot)이 소비한다.
    Function("getEnvironment") { () -> [String: Bool] in
      return AudioEnvironmentModule.readEnvironment()
    }

    // route 변경 시 JS 로 이벤트를 방출한다(폴링 대신 구독형으로 쓸 때).
    OnStartObserving {
      NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onAudioEnvironmentChange", AudioEnvironmentModule.readEnvironment())
      }
    }

    OnStopObserving {
      NotificationCenter.default.removeObserver(
        self,
        name: AVAudioSession.routeChangeNotification,
        object: nil
      )
    }
  }

  // 신호 계약을 계산하는 순수 헬퍼. 스냅샷과 이벤트가 공유한다.
  private static func readEnvironment() -> [String: Bool] {
    let session = AVAudioSession.sharedInstance()
    let otherPlaying = session.isOtherAudioPlaying
    let btConnected = session.currentRoute.outputs.contains { output in
      output.portType == .bluetoothA2DP || output.portType == .bluetoothHFP
    }
    return [
      "bluetoothAudioRouteConnected": btConnected,
      "otherAudioPlaying": otherPlaying,
    ]
  }
}
