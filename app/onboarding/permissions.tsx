// 온보딩 2단계 - 단계적 권한 요청 (FEAT-006)
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
//
// Apple 가이드에 맞춰 권한을 맥락에서 단계적으로 상향 요청한다:
//   1) 먼저 When-In-Use(사용 중 위치)만 요청 — 왜 필요한지 설명 후 버튼으로 요청
//   2) 그다음 Always(항상 위치)로 상향 요청 — 백그라운드 경고가 필요한 맥락에서만
//   3) 마지막으로 알림 권한 요청 — 경고를 실제로 전달하기 위해
// 각 단계는 앞 단계 승인 여부와 무관하게 앱이 부분 동작하도록 best-effort 로 진행한다.
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  requestWhenInUseLocation,
  requestAlwaysLocation,
  requestAlerts,
} from '../../src/permissions/locationPermissions';
import { markOnboardingComplete } from '../../src/storage/onboarding';
import { palette, spacing, radius, font, shadow } from '../../src/theme';

type Step = 'whenInUse' | 'always' | 'notifications' | 'done';

export default function OnboardingPermissions() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('whenInUse');
  const [busy, setBusy] = useState(false);

  const onWhenInUse = async (): Promise<void> => {
    setBusy(true);
    await requestWhenInUseLocation();
    setBusy(false);
    // 승인/거부와 무관하게 다음 맥락(Always)으로 진행한다. 거부해도 앱은 부분 동작한다.
    setStep('always');
  };

  const onAlways = async (): Promise<void> => {
    setBusy(true);
    await requestAlwaysLocation();
    setBusy(false);
    setStep('notifications');
  };

  const onNotifications = async (): Promise<void> => {
    setBusy(true);
    await requestAlerts();
    setBusy(false);
    setStep('done');
  };

  const onFinish = async (): Promise<void> => {
    await markOnboardingComplete();
    // 온보딩 스택을 홈으로 교체(뒤로가기로 온보딩에 되돌아오지 않도록).
    router.replace('/');
  };

  if (step === 'whenInUse') {
    return (
      <StepView
        title="위치 권한 (사용 중)"
        body="지금 어디를 걷고 있는지 알아야 사고다발구역 진입을 감지할 수 있어요. 먼저 '앱 사용 중' 위치 접근을 요청합니다."
        cta="사용 중 위치 허용 요청"
        busy={busy}
        onPress={onWhenInUse}
      />
    );
  }

  if (step === 'always') {
    return (
      <StepView
        title="위치 권한 (항상)"
        body="화면이 꺼져 있거나 다른 앱을 쓰는 중에도 위험구역 진입을 놓치지 않으려면 '항상' 위치 접근이 필요합니다. 백그라운드 위치는 오직 구역 진입 감지·경고에만 사용하며 외부로 전송하지 않습니다."
        cta="항상 위치 허용 요청"
        busy={busy}
        onPress={onAlways}
      />
    );
  }

  if (step === 'notifications') {
    return (
      <StepView
        title="알림 권한"
        body="위험구역에 들어갔을 때 즉시 알려드리려면 알림 권한이 필요합니다."
        cta="알림 허용 요청"
        busy={busy}
        onPress={onNotifications}
      />
    );
  }

  return (
    <StepView
      title="준비 완료"
      body="이제 보행을 시작하면 사고다발구역 진입 시 경고를 받을 수 있어요. 권한을 일부 거부했다면 iOS 설정에서 언제든 바꿀 수 있습니다."
      cta="시작하기"
      busy={false}
      onPress={onFinish}
    />
  );
}

function StepView(props: {
  title: string;
  body: string;
  cta: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{props.title}</Text>
        <Text style={styles.body}>{props.body}</Text>
      </View>
      <TouchableOpacity
        style={[styles.button, props.busy ? styles.buttonDisabled : null]}
        disabled={props.busy}
        onPress={() => props.onPress()}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>{props.cta}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.xl,
    backgroundColor: palette.bg,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.lg,
    ...shadow.card,
  },
  title: { fontSize: font.title, fontWeight: '800', color: palette.text },
  body: { fontSize: font.body, lineHeight: 24, color: palette.textMuted },
  button: {
    backgroundColor: palette.skyDeep,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    marginTop: spacing.sm,
    ...shadow.button,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: palette.onDark, fontSize: font.subtitle, fontWeight: '800' },
});
