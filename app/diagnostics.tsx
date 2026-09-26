// 실시간 진단 패널 (FEAT-002 - 개발/디버그 도구)
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
//
// ★ 정직성/범위 한정 (매우 중요):
//  - 이 화면은 개발/진단용 "도구"다. 사용자가 실기기에서 "왜 점수가 안 떨어지는가"를
//    파이프라인 단계별 값(자이로 pitch / 신선도 / 3초 지속 / 보행 판정 / 마지막 위치
//    이벤트 경과 / 세션 누적)으로 직접 확인하기 위한 화면이다.
//  - 이 화면은 값을 "표시만" 한다. 어떤 세션/점수/세그먼트/업로드 상태도 바꾸지 않으며,
//    서버로 아무것도 전송하지 않는다. 점수 로직 자체도 이 화면과 무관하다.
//  - 값 소스: backgroundTask 의 readPostureDiagnostics(모듈 스코프 상태의 읽기 전용
//    스냅샷) + 세션 누적(loadActiveSession 세그먼트 -> computeWSS / useRatio).
//  - 1초마다(VIEW_REFRESH 와 동일 간격) 폴링해 갱신한다(측정 루프가 아니라 표시용 폴링).
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { readPostureDiagnostics } from '../src/session/backgroundTask';
import type { PostureDiagnostics } from '../src/session/backgroundTask';
import { loadActiveSession } from '../src/session/sessionStore';
import { computeWSS } from '../src/wss/engine';
import { formatUseRatioPercent } from '../src/wss/useRatio';
import { palette, spacing, radius, font, shadow } from '../src/theme';

// 진단 폴링 주기(ms). useWalkSession 의 VIEW_REFRESH(1000ms)와 동일하게 맞춘다.
const REFRESH_MS = 1000;

// 세션 누적(스토어 기반) 표시값. 진단 화면이 backgroundTask getter 와 함께 보여준다.
interface SessionCumulative {
  hasActiveSession: boolean;
  isTracking: boolean;
  useMinutes: number;
  walkMinutes: number;
  useRatioText: string;
  displayScore: number;
}

// 초기(세션 없음) 누적값.
function emptyCumulative(): SessionCumulative {
  return {
    hasActiveSession: false,
    isTracking: false,
    useMinutes: 0,
    walkMinutes: 0,
    useRatioText: '0%',
    displayScore: 100,
  };
}

// ms 를 "N초"로 짧게 표기(신선도/지속 표시용).
function formatSeconds(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '-';
  return `${(ms / 1000).toFixed(1)}초`;
}

export default function DiagnosticsScreen() {
  // backgroundTask 모듈 스코프 상태의 읽기 전용 스냅샷.
  const [diag, setDiag] = useState<PostureDiagnostics>(() => readPostureDiagnostics(Date.now()));
  // 세션 누적(스토어 기반).
  const [cum, setCum] = useState<SessionCumulative>(() => emptyCumulative());

  useEffect(() => {
    let mounted = true;

    // 1초마다 진단 스냅샷 + 세션 누적을 읽어 갱신한다(읽기 전용).
    const tick = (): void => {
      const now = Date.now();
      // backgroundTask getter (동기 읽기).
      const snapshot = readPostureDiagnostics(now);
      if (mounted) setDiag(snapshot);
      // 세션 누적 (비동기 스토어 읽기 -> computeWSS/useRatio 로 파생).
      void loadActiveSession()
        .then((session) => {
          if (!mounted) return;
          const hasActiveSession = session.startedAt !== null || session.segments.length > 0;
          const wss = computeWSS(session.segments);
          // 누적 분은 세그먼트에서 직접 합산한다(감점 소스와 동일한 confirmedUse/walk).
          const walkMinutes = session.segments.reduce((sum, s) => sum + (s.walkMinutes || 0), 0);
          const useMinutes = session.segments.reduce(
            (sum, s) => sum + (s.confirmedUseMinutes ?? s.smartphoneUseMinutes ?? 0),
            0
          );
          setCum({
            hasActiveSession,
            isTracking: session.isTracking,
            useMinutes,
            walkMinutes,
            useRatioText: formatUseRatioPercent(wss.usageRatio),
            displayScore: wss.displayScore,
          });
        })
        .catch(() => {
          // 스토어 읽기 실패는 조용히 무시(다음 tick 에서 재시도). 표시용일 뿐.
        });
    };

    tick();
    const timer = setInterval(tick, REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const noSession = !cum.hasActiveSession;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {/* 정직성 안내: 진단 도구이며 표시만 하고 서버 전송/점수 변경 없음 */}
      <View style={styles.noticeCard}>
        <Text style={styles.noticeTitle}>🔎 실시간 진단 패널 (개발/진단용)</Text>
        <Text style={styles.noticeBody}>
          이 화면은 "왜 점수가 안 떨어지는지"를 파이프라인 단계별 값으로 확인하기 위한
          개발/진단 도구예요. 값을 표시만 하고 서버로 전송하지 않으며, 점수 로직 자체는
          바꾸지 않아요.
        </Text>
        <Text style={styles.noticeBody}>
          보행을 시작하면 자이로(pitch)·보행 판정·위치 이벤트가 1초마다 갱신돼요. 자이로
          샘플이 오래됐거나(stale) 위치 이벤트가 오래 안 오면, 그 구간은 정직하게 "사용
          안 함"으로 처리돼요(모르면 감점하지 않음).
        </Text>
      </View>

      {noSession ? (
        <View style={styles.card}>
          <Text style={styles.title}>세션 없음</Text>
          <Text style={styles.muted}>보행을 시작하면 실시간 값이 표시돼요.</Text>
        </View>
      ) : null}

      {/* (1) 현재 pitch + 자이로 신선도 */}
      <View style={styles.card}>
        <Text style={styles.title}>1. 자이로(pitch) 신선도</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>현재 pitch(도)</Text>
          <Text style={styles.rowValue}>
            {diag.currentPitchDeg === null ? '-' : `${diag.currentPitchDeg.toFixed(1)}°`}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>마지막 자이로 샘플</Text>
          <Text style={styles.rowValue}>{formatSeconds(diag.pitchSampleAgeMs)} 전</Text>
        </View>
        {diag.pitchFresh ? (
          <Text style={styles.freshOk}>✅ 자이로 신선(연속 샘플 도착 중)</Text>
        ) : (
          <Text style={styles.freshStale}>
            ⚠️ 자이로 stale · 최근 {formatSeconds(diag.pitchSampleAgeMs)} 동안 샘플 없음. 이
            구간은 사용으로 감점되지 않아요.
          </Text>
        )}
        <Text style={styles.muted}>임계 pitch: {diag.thresholdDeg}° 이상이면 "보는 자세"</Text>
      </View>

      {/* (2) 사용 지속 상태 (pitch>=10 연속 유지 시간 + 3초 도달 여부) */}
      <View style={styles.card}>
        <Text style={styles.title}>2. 사용 지속(3초 규칙)</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>pitch≥{diag.thresholdDeg}° 연속 유지</Text>
          <Text style={styles.rowValue}>{diag.sustainedSeconds.toFixed(1)}초</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>지속 임계</Text>
          <Text style={styles.rowValue}>{(diag.sustainMsThreshold / 1000).toFixed(0)}초</Text>
        </View>
        {diag.isUse ? (
          <Text style={styles.useOn}>📱 사용 중 (3초 도달 + 보행/신선 조건 충족)</Text>
        ) : (
          <Text style={styles.useOff}>
            사용 아님 · 3초 지속 미도달이거나, 보행/신선도 조건 미충족.
          </Text>
        )}
        <Text style={styles.muted}>
          "사용 중"은 걷는 중 + 자이로 신선 + pitch≥{diag.thresholdDeg}°가{' '}
          {(diag.sustainMsThreshold / 1000).toFixed(0)}초 이상 연속일 때만 켜져요.
        </Text>
      </View>

      {/* (3) 보행 판정 + 근거 */}
      <View style={styles.card}>
        <Text style={styles.title}>3. 보행 판정</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>walking</Text>
          <Text style={styles.rowValue}>{diag.walking ? '보행 중' : '비보행'}</Text>
        </View>
        <Text style={styles.muted}>근거: {diag.walkingReason}</Text>
      </View>

      {/* (4) 마지막 위치 이벤트 경과 */}
      <View style={styles.card}>
        <Text style={styles.title}>4. 위치 이벤트 도착</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>마지막 위치 이벤트</Text>
          <Text style={styles.rowValue}>
            {diag.lastLocationEventAgeMs === null
              ? '아직 없음'
              : `${formatSeconds(diag.lastLocationEventAgeMs)} 전`}
          </Text>
        </View>
        <Text style={styles.muted}>
          연속 위치 업데이트가 계속 도착해야 프로세스가 살아 자이로 평가가 이어져요. 이 값이
          계속 커지면(예: 수십 초 전) 위치 업데이트가 끊긴 상태예요.
        </Text>
      </View>

      {/* (5) 세션 누적 */}
      <View style={styles.card}>
        <Text style={styles.title}>5. 세션 누적</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>감지된 사용 시간</Text>
          <Text style={styles.rowValue}>{cum.useMinutes.toFixed(2)}분</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>전체 보행 시간</Text>
          <Text style={styles.rowValue}>{cum.walkMinutes.toFixed(2)}분</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>사용 비율</Text>
          <Text style={styles.rowValue}>{cum.useRatioText}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>현재 displayScore</Text>
          <Text style={styles.rowValueStrong}>{Math.round(cum.displayScore)}</Text>
        </View>
        <Text style={styles.muted}>
          사용 비율 = 감지된 사용 시간 / 전체 보행 시간. displayScore 는 홈 화면과 동일한
          computeWSS 결과예요(이 화면은 계산만 읽고 바꾸지 않아요).
        </Text>
      </View>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: { fontSize: font.body, color: palette.textMuted, fontWeight: '600' },
  rowValue: { fontSize: font.body, color: palette.text, fontWeight: '700' },
  rowValueStrong: { fontSize: font.title, color: palette.skyDeep, fontWeight: '800' },
  muted: { color: palette.textFaint, fontSize: font.small, lineHeight: 18 },
  freshOk: { color: palette.skyDeep, fontSize: font.small, fontWeight: '700' },
  freshStale: { color: palette.pinkDeep, fontSize: font.small, fontWeight: '700', lineHeight: 18 },
  useOn: { color: palette.skyDeep, fontSize: font.subtitle, fontWeight: '800' },
  useOff: { color: palette.textMuted, fontSize: font.body, fontWeight: '600' },
});
