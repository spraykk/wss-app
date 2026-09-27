// 자세 측정/기록 화면 (방식1 - Step 2 준비 단계: "측정 도구")
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
//
// ★ 정직성/범위 한정 (매우 중요):
//  - 이 화면은 개발/측정용 "도구"이며, 여기서 보이는 pitch/roll 각도는 아직 WSS 점수에
//    전혀 반영되지 않는다(감점 없음).
//  - 목적: 사용자가 실기기에서 여러 자세(① 화면 보며 걷기 ② 주머니에 넣고 걷기
//    ③ 손에 들고 앞 보며 걷기 등)의 각도 데이터를 직접 수집하는 것.
//  - 이 데이터를 보고 "사용 중"으로 볼 각도 임계 범위를 사용자가 정한 뒤에야,
//    후속 단계에서 estimatedUse 추정/감점에 반영할 예정이다.
//  - WSS 엔진/세그먼트/업로드 로직은 이 화면과 무관하며 건드리지 않는다.
//  - 각도 계산·요약 통계는 순수 함수(src/sensors/postureMath.ts)에 있고,
//    이 화면은 그 함수를 호출만 한다(scripts/verify-posture-math.ts 로 검증).
//
// iOS 백그라운드 한계(정직성):
//  - 실제 "다른 앱 보며 걷기" 추정은 우리 앱이 백그라운드일 때도 모션을 읽어야 하지만,
//    iOS 는 백그라운드 모션 연속성을 보장하지 않는다. 그래서 이 측정 화면은 "포그라운드"
//    에서 사용자가 자세별 각도를 직접 수집하는 용도로만 쓴다. 이 한계는 후속 설계에서
//    반드시 고려해야 한다(이번 범위 아님).
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Accelerometer, DeviceMotion } from 'expo-sensors';
import {
  gravityToPitchRoll,
  summarizePosture,
} from '../src/sensors/postureMath';
import type { GravityVector, PitchRoll, PostureSummary } from '../src/sensors/postureMath';
import { palette, spacing, radius, font, shadow } from '../src/theme';

// 센서 업데이트/샘플 수집 간격(ms). 0.1~0.2초 사이 -> 0.2초(200ms) 로 잡는다.
const UPDATE_INTERVAL_MS = 200;

export default function PostureLabScreen() {
  // 실시간 표시용 현재 각도.
  const [current, setCurrent] = useState<PitchRoll>({ pitchDeg: 0, rollDeg: 0 });
  // 센서 소스 표시("DeviceMotion" 또는 "Accelerometer"). 사용자에게 어떤 신호인지 알린다.
  const [source, setSource] = useState<string>('센서 준비 중');
  // 기록(로그) 중 여부.
  const [recording, setRecording] = useState<boolean>(false);
  // 자세 라벨(예: "보며 걷기"). 어떤 자세를 측정 중인지 사용자가 구분/입력.
  const [label, setLabel] = useState<string>('');
  // 마지막으로 "기록 중지" 했을 때의 요약 통계(+ 그때의 라벨).
  const [summary, setSummary] = useState<{ label: string; data: PostureSummary } | null>(null);

  // 기록 중 수집한 샘플 버퍼. 렌더와 무관하게 ref 로 모은다(리렌더 폭주 방지).
  const pitchBufRef = useRef<number[]>([]);
  const rollBufRef = useRef<number[]>([]);
  // 최신 각도를 담는 ref. "기록 시작~중지" 사이 일정 간격 샘플링에 쓴다.
  const latestRef = useRef<PitchRoll>({ pitchDeg: 0, rollDeg: 0 });
  // 기록 여부를 ref 로도 들고 있어, 센서 콜백 클로저에서 최신 값을 읽는다.
  const recordingRef = useRef<boolean>(false);

  // 센서 구독: DeviceMotion 을 우선 시도하고(중력 성분 accelerationIncludingGravity),
  // 값이 없으면 Accelerometer 로 폴백한다. 두 경우 모두 순수 함수로 각도를 계산한다.
  useEffect(() => {
    let motionSub: { remove: () => void } | null = null;
    let accelSub: { remove: () => void } | null = null;
    let usingAccel = false;

    // 공통: 중력 벡터 -> pitch/roll 계산 후 실시간 상태/ref 갱신.
    const apply = (g: GravityVector, src: string): void => {
      const pr = gravityToPitchRoll(g);
      latestRef.current = pr;
      setCurrent(pr);
      setSource(src);
    };

    // Accelerometer 폴백 구독을 시작한다(DeviceMotion 중력이 없을 때).
    const startAccel = (): void => {
      if (usingAccel) return;
      usingAccel = true;
      Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS);
      accelSub = Accelerometer.addListener(({ x, y, z }) => {
        // Accelerometer 는 정지 시 중력을 g 단위로 x/y/z 에 담는다.
        apply({ x, y, z }, 'Accelerometer(중력 근사)');
      });
    };

    // DeviceMotion 우선 시도. accelerationIncludingGravity(중력 포함 가속도)를 중력 벡터로 사용.
    // 기기/권한 문제로 값이 안 오면 Accelerometer 로 폴백한다.
    DeviceMotion.setUpdateInterval(UPDATE_INTERVAL_MS);
    motionSub = DeviceMotion.addListener((data) => {
      const gravity = data?.accelerationIncludingGravity;
      if (gravity && typeof gravity.x === 'number' && typeof gravity.y === 'number' && typeof gravity.z === 'number') {
        apply({ x: gravity.x, y: gravity.y, z: gravity.z }, 'DeviceMotion(중력 포함 가속도)');
      } else if (!usingAccel) {
        // DeviceMotion 이 중력 성분을 주지 못하면 Accelerometer 로 폴백.
        startAccel();
      }
    });

    return () => {
      motionSub?.remove();
      accelSub?.remove();
    };
  }, []);

  // "기록 시작~중지" 사이, 일정 간격으로 최신 각도를 버퍼에 push 한다.
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      if (!recordingRef.current) return;
      pitchBufRef.current.push(latestRef.current.pitchDeg);
      rollBufRef.current.push(latestRef.current.rollDeg);
    }, UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [recording]);

  // 기록 시작: 버퍼 비우고 recording 켜기.
  const startRecording = (): void => {
    pitchBufRef.current = [];
    rollBufRef.current = [];
    recordingRef.current = true;
    setRecording(true);
    setSummary(null);
  };

  // 기록 중지: 순수 함수로 요약 통계 계산 후 표시.
  const stopRecording = (): void => {
    recordingRef.current = false;
    setRecording(false);
    const data = summarizePosture(pitchBufRef.current, rollBufRef.current);
    setSummary({ label: label.trim() || '(라벨 없음)', data });
  };

  // 요약을 사용자가 복사/캡처하기 쉽게 selectable 한 여러 줄 텍스트로 만든다.
  const summaryText = summary
    ? [
        `자세 라벨: ${summary.label}`,
        `샘플 개수: ${summary.data.count}`,
        `pitch(도) min ${summary.data.pitch.min.toFixed(1)} / max ${summary.data.pitch.max.toFixed(1)} / mean ${summary.data.pitch.mean.toFixed(1)} / median ${summary.data.pitch.median.toFixed(1)}`,
        `roll(도)  min ${summary.data.roll.min.toFixed(1)} / max ${summary.data.roll.max.toFixed(1)} / mean ${summary.data.roll.mean.toFixed(1)} / median ${summary.data.roll.median.toFixed(1)}`,
      ].join('\n')
    : '';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {/* 정직성 안내: 측정 도구이며 아직 점수에 반영 안 함 */}
      <View style={styles.noticeCard}>
        <Text style={styles.noticeTitle}>🧪 자세 측정 도구 (개발/측정용)</Text>
        <Text style={styles.noticeBody}>
          이 화면은 폰을 여러 자세로 두고 그때의 기울기(각도)를 보고 기록하기 위한 측정
          도구예요. 여기서 보이는 각도는 아직 WSS 점수에 전혀 반영되지 않아요(감점 없음).
          여러 자세의 각도 데이터를 모아, "사용 중"으로 볼 각도 범위를 정하는 다음 단계에서
          쓸 예정이에요.
        </Text>
        <Text style={styles.noticeBody}>
          측정은 이 화면(포그라운드)에 있을 때만 동작해요. iOS 는 앱이 백그라운드일 때 모션
          연속성을 보장하지 않으므로, 다른 앱을 보며 걷는 상황의 자동 추정은 이번 측정 범위가
          아니에요.
        </Text>
      </View>

      {/* 실시간 각도 표시 */}
      <View style={styles.card}>
        <Text style={styles.title}>실시간 기울기</Text>
        <View style={styles.liveRow}>
          <View style={styles.liveBlock}>
            <Text style={styles.liveLabel}>pitch(앞뒤)</Text>
            <Text style={styles.liveValue}>{current.pitchDeg.toFixed(1)}°</Text>
          </View>
          <View style={styles.liveBlock}>
            <Text style={styles.liveLabel}>roll(좌우)</Text>
            <Text style={styles.liveValue}>{current.rollDeg.toFixed(1)}°</Text>
          </View>
        </View>
        <Text style={styles.muted}>신호원: {source}</Text>
        <Text style={styles.muted}>
          참고: 화면을 위로 평평히 두면 pitch≈0°, 얼굴 앞으로 세울수록 pitch 가 커져요.
        </Text>
      </View>

      {/* 자세 라벨 입력 + 기록 시작/중지 */}
      <View style={styles.card}>
        <Text style={styles.title}>구간 기록</Text>
        <Text style={styles.muted}>자세 라벨(예: 보며 걷기 / 주머니 / 손에 들고 앞 보기)</Text>
        <TextInput
          style={styles.input}
          value={label}
          onChangeText={setLabel}
          placeholder="자세 라벨 입력"
          placeholderTextColor={palette.textFaint}
          editable={!recording}
        />
        <TouchableOpacity
          style={[styles.button, recording ? styles.stop : styles.start]}
          onPress={() => (recording ? stopRecording() : startRecording())}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonText}>{recording ? '기록 중지' : '기록 시작'}</Text>
        </TouchableOpacity>
        {recording ? (
          <Text style={styles.recordingHint}>
            기록 중… {UPDATE_INTERVAL_MS / 1000}초 간격으로 pitch/roll 을 수집하고 있어요.
            자세를 유지한 채 걸어보세요.
          </Text>
        ) : null}
      </View>

      {/* 요약 통계(중지 후) - selectable 텍스트로 복사/캡처 용이 */}
      {summary ? (
        <View style={styles.card}>
          <Text style={styles.title}>기록 요약</Text>
          <Text style={styles.summaryText} selectable>
            {summaryText}
          </Text>
          <Text style={styles.muted}>
            위 텍스트를 길게 눌러 복사하거나 화면을 캡처해 각도 데이터를 남겨 주세요.
            서버로 전송되지 않고 이 화면에만 표시돼요.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: palette.bg },
  container: { padding: spacing.xl, gap: spacing.md },
  noticeCard: {
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceAlt,
    gap: spacing.sm,
    ...shadow.card,
  },
  noticeTitle: { fontSize: font.label, fontWeight: '800', color: palette.text },
  noticeBody: { fontSize: font.small, color: palette.textMuted, lineHeight: 20 },
  card: {
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    gap: spacing.sm,
    ...shadow.card,
  },
  title: { fontSize: font.label, fontWeight: '800', color: palette.text },
  liveRow: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: spacing.sm },
  liveBlock: { alignItems: 'center', gap: spacing.xs },
  liveLabel: { fontSize: font.small, color: palette.textMuted, fontWeight: '600' },
  liveValue: { fontSize: font.hero, fontWeight: '800', color: palette.skyDeep },
  muted: { color: palette.textFaint, fontSize: font.small, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    fontSize: font.body,
    color: palette.text,
    backgroundColor: palette.surface,
  },
  button: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
    ...shadow.button,
  },
  start: { backgroundColor: palette.skyDeep },
  stop: { backgroundColor: palette.pinkDeep },
  buttonText: { color: palette.onDark, fontSize: font.subtitle, fontWeight: '800' },
  recordingHint: { fontSize: font.small, color: palette.textMuted, lineHeight: 18 },
  summaryText: {
    fontSize: font.body,
    color: palette.text,
    lineHeight: 24,
    fontWeight: '600',
  },
});
