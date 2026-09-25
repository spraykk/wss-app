// 의견 보내기 화면 - 테스터 피드백 수집 창구
// 앱스토어 리뷰가 아니라 앱 안에서 직접 의견을 받는다.
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getOrCreateDeviceId } from '../src/storage/deviceId';
import { getAgeBand } from '../src/storage/ageBand';
import { submitFeedbackDetailed } from '../src/data/supabase';
import type { FeedbackCategory, SubmitResult } from '../src/data/supabase';
import { palette, spacing, radius, font, shadow } from '../src/theme';

// 카테고리 4종(스키마/ submitFeedback 과 동일). 라벨은 한글로 표시한다.
const CATEGORIES: { key: FeedbackCategory; label: string; emoji: string }[] = [
  { key: 'bug', label: '버그', emoji: '🐞' },
  { key: 'suggestion', label: '제안', emoji: '💡' },
  { key: 'praise', label: '칭찬', emoji: '💖' },
  { key: 'etc', label: '기타', emoji: '💬' },
];

const MAX_MESSAGE = 2000;

// 앱 버전을 expo-constants(있으면)에서 지연 require 로 읽는다. 실패 시 null.
// 정적 import 하지 않는 이유는 supabase.ts/apiKey.ts 와 동일(샌드박스 모듈 해석 보호).
function readAppVersion(): string | null {
  try {
    const Constants = require('expo-constants').default;
    const version =
      Constants?.expoConfig?.version ?? Constants?.manifest?.version ?? null;
    if (typeof version === 'string' && version.trim().length > 0) {
      return version.trim();
    }
  } catch {
    // expo-constants 미존재/오류 -> 버전 없이 진행.
  }
  return null;
}

type SubmitState = 'idle' | 'sending' | 'success' | 'error';

// 실패 사유(reason)를 사용자에게 보여줄 한글 문구로 변환한다.
// server/invalid/exception 은 진단용 detail 을 함께 노출한다(위치 등 민감정보 없음).
function describeFailure(result: Extract<SubmitResult, { ok: false }>): string {
  switch (result.reason) {
    case 'not_configured':
      return '서버가 설정되지 않았어요(관리자 문의).';
    case 'server':
      return `서버 오류: ${result.detail ?? '알 수 없는 오류'}`;
    case 'invalid':
      return `입력 확인: ${result.detail ?? '입력값을 확인해 주세요.'}`;
    case 'exception':
      return `예상치 못한 오류: ${result.detail ?? '알 수 없는 오류'}`;
    default:
      return '전송 실패. 잠시 후 다시 시도해 주세요.';
  }
}

export default function FeedbackScreen() {
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);

  const appVersion = useMemo(() => readAppVersion(), []);
  const trimmed = message.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_MESSAGE && state !== 'sending';

  const onSubmit = async () => {
    if (!canSubmit) return;
    setState('sending');
    setErrorText(null);
    try {
      const deviceId = await getOrCreateDeviceId();
      // 온보딩에서 1회 선택한 연령대 밴드를 자동으로 첨부한다(미선택이면 null).
      // 피드백 화면에는 별도의 연령대 UI 를 두지 않는다(밴드는 온보딩에서만 선택).
      const ageBand = await getAgeBand();
      const result = await submitFeedbackDetailed({
        category,
        rating,
        message: trimmed,
        appVersion,
        deviceId,
        ageBand,
      });
      if (result.ok) {
        // 성공: 폼 초기화 후 감사 메시지 표시.
        setState('success');
        setCategory('bug');
        setRating(null);
        setMessage('');
      } else {
        // 실패: 구체적인 사유/서버 응답을 화면에 노출(진단용).
        setErrorText(describeFailure(result));
        setState('error');
      }
    } catch (e) {
      setErrorText(`예상치 못한 오류: ${String(e)}`);
      setState('error');
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>의견을 들려주세요</Text>
        <Text style={styles.help}>
          버그, 개선 아이디어, 칭찬 무엇이든 좋아요. 익명으로 전달되며 위치·경로 등
          개인정보는 함께 보내지 않습니다.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>어떤 의견인가요?</Text>
        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => {
            const selected = category === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.categoryChip, selected && styles.categoryChipSelected]}
                onPress={() => setCategory(c.key)}
                activeOpacity={0.85}
              >
                <Text
                  style={[styles.categoryText, selected && styles.categoryTextSelected]}
                >
                  {c.emoji} {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>별점 (선택)</Text>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((n) => {
            const active = rating !== null && n <= rating;
            return (
              <TouchableOpacity
                key={n}
                // 이미 선택한 별을 다시 누르면 해제(선택 취소 = 미선택 허용).
                onPress={() => setRating(rating === n ? null : n)}
                activeOpacity={0.7}
              >
                <Text style={[styles.star, active ? styles.starActive : styles.starIdle]}>
                  {active ? '★' : '☆'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.help}>
          {rating === null ? '별점은 선택 사항이에요.' : `${rating}점을 주셨어요.`}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>내용 (필수)</Text>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="자유롭게 의견을 적어주세요."
          placeholderTextColor={palette.textFaint}
          multiline
          textAlignVertical="top"
          maxLength={MAX_MESSAGE}
        />
        <Text style={styles.counter}>
          {trimmed.length}/{MAX_MESSAGE}
        </Text>
      </View>

      {state === 'success' ? (
        <View style={[styles.statusCard, styles.statusSuccess]}>
          <Text style={styles.statusSuccessText}>
            감사합니다! 소중한 의견이 전달되었어요.
          </Text>
        </View>
      ) : null}
      {state === 'error' ? (
        <View style={[styles.statusCard, styles.statusError]}>
          <Text style={styles.statusErrorText} selectable>
            {errorText ?? '전송 실패. 잠시 후 다시 시도해 주세요.'}
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.button, canSubmit ? styles.buttonActive : styles.buttonDisabled]}
        onPress={() => void onSubmit()}
        disabled={!canSubmit}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>
          {state === 'sending' ? '전송 중…' : '의견 보내기'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: palette.bg },
  container: { padding: spacing.xl, gap: spacing.md },
  card: {
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    gap: spacing.sm,
    ...shadow.card,
  },
  title: { fontSize: font.subtitle, fontWeight: '800', color: palette.text },
  help: { fontSize: font.small, color: palette.textMuted, lineHeight: 20 },
  sectionLabel: { fontSize: font.label, fontWeight: '800', color: palette.text },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  categoryChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceAlt,
    borderWidth: 1,
    borderColor: palette.border,
  },
  categoryChipSelected: { backgroundColor: palette.skyDeep, borderColor: palette.skyDeep },
  categoryText: { fontSize: font.body, color: palette.textMuted, fontWeight: '700' },
  categoryTextSelected: { color: palette.onDark },
  starsRow: { flexDirection: 'row', gap: spacing.sm },
  star: { fontSize: 36, lineHeight: 42 },
  starActive: { color: palette.yellowDeep },
  starIdle: { color: palette.border },
  input: {
    minHeight: 140,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    padding: spacing.md,
    fontSize: font.body,
    color: palette.text,
  },
  counter: { fontSize: font.caption, color: palette.textFaint, textAlign: 'right' },
  statusCard: { padding: spacing.lg, borderRadius: radius.md },
  statusSuccess: { backgroundColor: palette.safeBg },
  statusSuccessText: { color: palette.safeText, fontSize: font.body, fontWeight: '700' },
  statusError: { backgroundColor: palette.dangerBg },
  statusErrorText: {
    color: palette.dangerText,
    fontSize: font.body,
    fontWeight: '700',
    lineHeight: 20,
  },
  button: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    ...shadow.button,
  },
  buttonActive: { backgroundColor: palette.skyDeep },
  buttonDisabled: { backgroundColor: palette.border },
  buttonText: { color: palette.onDark, fontSize: font.subtitle, fontWeight: '800' },
});
