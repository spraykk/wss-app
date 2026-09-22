require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AudioEnvironment'
  s.version        = package['version']
  s.summary        = 'Reads AVAudioSession output route + isOtherAudioPlaying for WSS ear-occlusion detection'
  s.description    = 'Local Expo module exposing bluetoothAudioRouteConnected and otherAudioPlaying to JS. See AUDIO_DETECTION_FINDINGS.md.'
  s.author         = 'wss-app'
  s.homepage       = 'https://github.com/spraykk/wss-app'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
