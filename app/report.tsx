// WSS 리포트 화면 - 결과 분해(breakdown) + 이력 표시
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { loadHistory } from '../src/storage/history';
import { fetchStats, fetchStatsByAge } from '../src/data/supabase';
import type { WssStats } from '../src/data/supabase';
import { getAgeBand, AGE_BAND_OPTIONS } from '../src/storage/ageBand';
import type { AgeBand } from '../src/storage/ageBand';
import type { WSSResult } from '../src/types';
import { computeWeeklyDaily } from '../src/wss/weekly';
import type { WeeklyDay } from '../src/wss/weekly';
import { palette, spacing, radius, font, shadow } from '../src/theme';
import { classifyGrade } from '../src/wss/grade';
import type { WssGrade } from '../src/wss/grade';
import { WSS_CRITICAL } from '../src/wss/weights';

// 로컬 오늘 날짜를 yyyy-mm-dd 로 만든다(useWalkSession.toDateISO 와 동일 규칙).
// node:* 없이 순수 Date 산술만 사용한다.
function toDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// yyyy-mm-dd 에서 "일(day-of-month)"만 뽑아 짧은 막대 라벨로 쓴다(locale 라이브러리 불필요).
function dayLabelFromISO(iso: string): string {
  if (typeof iso !== 'string') return '';
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(iso);
  if (!m) return '';
  return String(Number(m[1])); // 앞자리 0 제거(예: '09' -> '9')
}

// 통계 표시에 필요한 최소 표본 수. 이보다 적으면(또는 미설정/오류면) 가짜 숫자를
// 보여주지 않고 "아직 데이터가 부족합니다"로 정직하게 표시한다.
const MIN_STATS_SAMPLE = 5;

// 등급별 파스텔 피드백 프리셋(색·문구·아이콘 다르게). theme.ts 파스텔 토큰 사용.
const GRADE_FEEDBACK: Record<WssGrade, { title: string; message: string; bg: string; text: string }> = {
  danger: {
    title: '위험',
    message: '위험 구간입니다. 스마트폰 사용을 줄이고 주변을 살펴 주세요.',
    bg: palette.dangerBg, // 파스텔 로즈
    text: palette.dangerText,
  },
  caution: {
    title: '주의',
    message: '또래 평균보다 낮아요. 조금만 더 주의해요.',
    bg: palette.yellow, // 연노랑
    text: palette.cautionText,
  },
  good: {
    title: '양호',
    message: '평균 이상이에요. 좋은 습관이에요!',
    bg: palette.safeBg, // 민트/연두
    text: palette.safeText,
  },
  excellent: {
    title: '우수',
    message: '상위 25%예요! 훌륭한 보행 습관입니다 🎉',
    bg: palette.sky, // 스카이/블루
    text: palette.skyDeep,
  },
  insufficient: {
    title: '측정 중',
    message: '측정 중이에요. 사용자가 늘어나면 또래 비교와 자세한 피드백을 알려드릴게요.',
    bg: palette.surfaceAlt, // 중립
    text: palette.textMuted,
  },
};

const GRADE_ICON: Record<WssGrade, string> = {
  danger: '⚠️',
  caution: '🟡',
  good: '🌿',
  excellent: '🎉',
  insufficient: '⏳',
};

// 통계 충분 여부 게이팅(전체/그룹에 동일하게, 그러나 각각 독립적으로 적용).
// scripts/verify-agegroup-stats.ts 가 이 술어를 재현해 독립 게이팅을 검증한다.
function hasEnoughStats(stats: WssStats | null): boolean {
  return (
    stats !== null &&
    stats.sampleCount >= MIN_STATS_SAMPLE &&
    stats.meanScore !== null &&
    stats.q3Score !== null
  );
}

export default function ReportScreen() {
  const [history, setHistory] = useState<WSSResult[]>([]);
  const [stats, setStats] = useState<WssStats | null>(null);
  const [ageBand, setAgeBandState] = useState<AgeBand | null>(null);
  const [groupStats, setGroupStats] = useState<WssStats | null>(null);

  useEffect(() => {
    void loadHistory().then(setHistory);
    // 전체 사용자 통계 조회. 미설정/오류/표본부족이면 null 이 오며 아래에서 정직하게 처리한다.
    void fetchStats().then(setStats);
    // 온보딩에서 1회 선택한 연령대 밴드를 읽고, 있으면 그룹 통계도 조회한다.
    // 밴드 미선택이면 그룹 통계는 조회하지 않고 '측정 중'/안내로 정직하게 표시한다.
    void getAgeBand().then((band) => {
      setAgeBandState(band);
      if (band !== null) {
        void fetchStatsByAge(band).then(setGroupStats);
      }
    });
  }, []);

  const latest = history[0];
  // 전체와 그룹을 각각 독립적으로 게이팅한다(한쪽이 충분해도 다른 쪽은 부족할 수 있다).
  const overallEnough = hasEnoughStats(stats);
  const groupEnough = hasEnoughStats(groupStats);
  // 선택한 밴드의 한글 라벨(예: '10대'). 미선택이면 null.
  const bandLabel =
    ageBand !== null
      ? (AGE_BAND_OPTIONS.find((o) => o.key === ageBand)?.label ?? null)
      : null;

  // 최근 7일 일별 대표 점수(순수 함수). 로컬 오늘 기준으로 집계한다.
  const weekly: WeeklyDay[] = computeWeeklyDaily(history, toDateISO(new Date()));
  const weeklyHasAny = weekly.some((d) => d.score !== null);

  // 등급 분류(순수 함수). displayScore 기준으로 절대기준(60 미만=위험) 우선 판정하고,
  // 표본이 5명 미만/미집계면 'insufficient'(측정 중)로 정직하게 폴백한다.
  const grade: WssGrade | null = latest
    ? classifyGrade(
        latest.displayScore,
        {
          count: stats ? stats.sampleCount : 0,
          mean: stats ? stats.meanScore : null,
          q3: stats ? stats.q3Score : null,
        },
        WSS_CRITICAL,
        MIN_STATS_SAMPLE
      )
    : null;
  const feedback = grade ? GRADE_FEEDBACK[grade] : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {latest && feedback && grade ? (
        <View style={[styles.feedbackCard, { backgroundColor: feedback.bg }]}>
          <Text style={[styles.feedbackTitle, { color: feedback.text }]}>
            {GRADE_ICON[grade]} {feedback.title}
          </Text>
          <Text style={[styles.feedbackMessage, { color: feedback.text }]}>{feedback.message}</Text>
        </View>
      ) : null}

      {latest ? (
        <View style={styles.card}>
          <Text style={styles.title}>최근 보행 결과</Text>
          <Text style={styles.big}>{Math.round(latest.displayScore)}점</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>원점수(rawScore)</Text>
            <Text style={styles.metricValue}>{latest.rawScore.toFixed(2)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>사용 비율</Text>
            <Text style={styles.metricValue}>{(latest.usageRatio * 100).toFixed(1)}%</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>고위험 zone 사용 중 진입</Text>
            <Text style={styles.metricValue}>
              {latest.enteredHighRiskZoneWhileUsingPhone ? '예' : '아니오'}
            </Text>
          </View>
          <Text style={styles.subtitle}>세그먼트 분해</Text>
          {latest.segmentBreakdown.map((s, i) => (
            <View key={`${s.regionId}-${i}`} style={styles.segmentRow}>
              <Text style={styles.segmentId}>{s.regionId}</Text>
              <Text style={styles.segmentMeta}>
                가중치 {s.weight.combined.toFixed(3)} · 기여 {s.contribution.toFixed(2)}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.empty}>저장된 보행 이력이 없습니다.</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.title}>주간 일별 점수</Text>
        <Text style={styles.muted}>최근 7일, 하루의 마지막 보행 점수 기준</Text>
        <WeeklyChart days={weekly} />
        {!weeklyHasAny ? (
          <Text style={styles.muted}>
            아직 이번 주 보행 기록이 없어요. 보행을 완료하면 그날의 마지막 점수가 막대로
            쌓여요.
          </Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>다른 사용자와 비교</Text>

        {/* (1) 전체 사용자 통계 — MIN_STATS_SAMPLE=5 로 독립 게이팅 */}
        <Text style={styles.groupHeading}>전체 사용자</Text>
        {overallEnough && stats ? (
          <>
            <ComparisonBar
              label="전체 사용자 평균"
              value={Math.round(stats.meanScore as number)}
              tone="sky"
            />
            <ComparisonBar
              label="상위 25% 기준(Q3)"
              value={Math.round(stats.q3Score as number)}
              tone="yellow"
            />
            {latest ? (
              <>
                <ComparisonBar
                  label="내 최근 점수"
                  value={Math.round(latest.displayScore)}
                  tone="pink"
                />
                <Text style={styles.compareNote}>
                  내 최근 점수 {Math.round(latest.displayScore)}점 —{' '}
                  {latest.displayScore >= (stats.q3Score as number)
                    ? '상위 25% 안에 들어요.'
                    : latest.displayScore >= (stats.meanScore as number)
                      ? '평균보다 높아요.'
                      : '평균보다 낮아요. 조금 더 안전하게 걸어봐요.'}
                </Text>
              </>
            ) : (
              <Text style={styles.muted}>보행을 완료하면 내 점수와 비교해 드려요.</Text>
            )}
            <Text style={styles.muted}>표본 {stats.sampleCount}명 기준</Text>
          </>
        ) : (
          <Text style={styles.muted}>
            측정 중이에요. 다른 사용자 데이터가 아직 부족합니다
            {stats ? ` (${stats.sampleCount}명)` : ''}. 참여자가 늘어나면 평균과 상위
            25% 기준을 보여드릴게요.
          </Text>
        )}

        {/* (2) 내 연령대 그룹 통계 — 전체와 독립적으로 게이팅 */}
        <Text style={[styles.groupHeading, styles.groupHeadingSpaced]}>
          {bandLabel ? `${bandLabel} 그룹` : '내 연령대 그룹'}
        </Text>
        {ageBand === null ? (
          <Text style={styles.muted}>
            온보딩에서 연령대를 선택하면 같은 또래(연령대) 그룹과도 비교해 드려요. 지금은
            연령대 미선택('미상')이라 그룹 비교를 표시하지 않아요.
          </Text>
        ) : groupEnough && groupStats ? (
          <>
            <ComparisonBar
              label={`${bandLabel ?? '내 연령대'} 평균`}
              value={Math.round(groupStats.meanScore as number)}
              tone="sky"
            />
            <ComparisonBar
              label={`${bandLabel ?? '내 연령대'} 상위 25%(Q3)`}
              value={Math.round(groupStats.q3Score as number)}
              tone="yellow"
            />
            {latest ? (
              <ComparisonBar
                label="내 최근 점수"
                value={Math.round(latest.displayScore)}
                tone="pink"
              />
            ) : null}
            <Text style={styles.muted}>{bandLabel} 그룹 표본 {groupStats.sampleCount}명 기준</Text>
          </>
        ) : (
          <Text style={styles.muted}>
            측정 중이에요. {bandLabel ? `${bandLabel} ` : ''}그룹 데이터가 아직 부족합니다
            {groupStats ? ` (${groupStats.sampleCount}명)` : ''}. 같은 또래가 늘어나면
            그룹 평균과 상위 25% 기준을 보여드릴게요.
          </Text>
        )}
      </View>

      <Text style={styles.subtitle}>이력 ({history.length})</Text>
      <View style={styles.card}>
        {history.length === 0 ? (
          <Text style={styles.muted}>완료한 보행이 여기에 쌓여요.</Text>
        ) : (
          history.map((h, i) => (
            <View key={i} style={styles.historyRow}>
              <Text style={styles.historyScore}>{Math.round(h.displayScore)}점</Text>
              <Text style={styles.muted}>raw {h.rawScore.toFixed(1)}</Text>
            </View>
          ))
        )}
      </View>

      <Link href="/feedback" asChild>
        <Text style={styles.feedbackLink}>💬 의견 보내기</Text>
      </Link>

      <View style={styles.disclaimerBox}>
        <Text style={styles.disclaimer}>
          WSS는 알려진 위험 요인(위치·날씨·시간대·청각·스마트폰 사용)을 종합한 참고
          지표입니다. 시간대·날씨 가중치는 전국 교통사고 통계에 근거하며, 그 외 요인은
          설계자가 설정한 값으로 실제 사고 발생을 예측하지 않습니다.
        </Text>
        <Text style={styles.disclaimer}>
          기준선(WSS 60)은 위험을 단정하는 임계가 아니라 시뮬레이션으로 정한 참고
          기준선입니다(실제 사고 발생을 예측하지 않습니다). 등급(위험/주의/양호/우수)도
          이 기준선과 다른 사용자 분포(평균·Q3)를 참고한 상대 지표입니다.
          '다른 사용자와 비교'의 평균·상위 25%(Q3)는 익명으로 모인 다른 사용자들의
          점수·날짜만으로 서버에서 계산한 값이며, 위치·경로는 전송·사용하지 않습니다.
        </Text>
      </View>
    </ScrollView>
  );
}

// 점수(0~100)를 간단한 파스텔 바로 시각화한다. 순수 표시용이며 계산 로직과 무관.
function ComparisonBar(props: { label: string; value: number; tone: 'sky' | 'pink' | 'yellow' }) {
  const clamped = Math.max(0, Math.min(100, props.value));
  const fillColor =
    props.tone === 'pink' ? palette.pinkDeep : props.tone === 'yellow' ? palette.yellowDeep : palette.skyDeep;
  return (
    <View style={styles.barBlock}>
      <View style={styles.barHeader}>
        <Text style={styles.barLabel}>{props.label}</Text>
        <Text style={styles.barValue}>{props.value}점</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${clamped}%`, backgroundColor: fillColor }]} />
      </View>
    </View>
  );
}

// 주간 일별 대표 점수를 세로 막대 7개로 시각화한다. 순수 표시용(계산은 computeWeeklyDaily).
// 새 패키지 없이 RN View 만으로 그린다: 각 칸은 고정 높이 트랙 안에서 score/100 비율만큼
// 막대를 채운다. score=null(보행 없는 날)은 빈/플레이스홀더 막대 + 흐린 라벨로 표시한다.
function WeeklyChart(props: { days: WeeklyDay[] }) {
  return (
    <View style={styles.weekRow}>
      {props.days.map((d, i) => {
        const hasScore = d.score !== null;
        const clamped = hasScore ? Math.max(0, Math.min(100, d.score as number)) : 0;
        return (
          <View key={`${d.dateISO}-${i}`} style={styles.weekCol}>
            <Text style={styles.weekScore}>{hasScore ? Math.round(d.score as number) : '-'}</Text>
            <View style={styles.weekTrack}>
              {hasScore ? (
                <View style={[styles.weekFill, { height: `${clamped}%` }]} />
              ) : (
                <View style={styles.weekEmpty} />
              )}
            </View>
            <Text style={[styles.weekDay, hasScore ? null : styles.weekDayMuted]}>
              {dayLabelFromISO(d.dateISO)}
            </Text>
          </View>
        );
      })}
    </View>
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
  title: { fontSize: font.label, fontWeight: '800', color: palette.text },
  big: { fontSize: 52, fontWeight: '800', color: palette.skyDeep },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricLabel: { fontSize: font.body, color: palette.textMuted },
  metricValue: { fontSize: font.body, color: palette.text, fontWeight: '700' },
  subtitle: { fontSize: font.label, fontWeight: '800', color: palette.text, marginTop: spacing.sm },
  segmentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  segmentId: { fontSize: font.body, color: palette.text, fontWeight: '600' },
  segmentMeta: { fontSize: font.small, color: palette.textMuted },
  empty: { fontSize: font.label, color: palette.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  historyScore: { fontSize: font.body, color: palette.text, fontWeight: '700' },
  muted: { color: palette.textFaint, fontSize: font.small },
  compareNote: { fontSize: font.body, color: palette.text, marginTop: spacing.xs, lineHeight: 22 },
  barBlock: { gap: spacing.xs, marginTop: spacing.xs },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barLabel: { fontSize: font.small, color: palette.textMuted },
  barValue: { fontSize: font.small, color: palette.text, fontWeight: '700' },
  barTrack: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceAlt,
    overflow: 'hidden',
  },
  barFill: { height: 12, borderRadius: radius.pill },
  groupHeading: { fontSize: font.body, fontWeight: '800', color: palette.text, marginTop: spacing.xs },
  groupHeadingSpaced: { marginTop: spacing.lg },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  weekCol: { flex: 1, alignItems: 'center', gap: spacing.xs },
  weekScore: { fontSize: font.caption, color: palette.textMuted, fontWeight: '700' },
  weekTrack: {
    width: '100%',
    height: 96,
    borderRadius: radius.sm,
    backgroundColor: palette.surfaceAlt,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  weekFill: { width: '100%', borderRadius: radius.sm, backgroundColor: palette.skyDeep },
  weekEmpty: { width: '100%', height: 4, backgroundColor: palette.border },
  weekDay: { fontSize: font.caption, color: palette.textMuted, fontWeight: '700' },
  weekDayMuted: { color: palette.textFaint, fontWeight: '400' },
  feedbackLink: {
    marginTop: spacing.md,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: palette.sky,
    color: palette.skyDeep,
    fontSize: font.label,
    fontWeight: '800',
    textAlign: 'center',
    overflow: 'hidden',
    ...shadow.button,
  },
  disclaimerBox: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceAlt,
    gap: spacing.sm,
  },
  disclaimer: { fontSize: font.caption, color: palette.textMuted, lineHeight: 18 },
  feedbackCard: {
    padding: spacing.lg,
    borderRadius: radius.md,
    gap: spacing.xs,
    ...shadow.card,
  },
  feedbackTitle: { fontSize: font.subtitle, fontWeight: '800' },
  feedbackMessage: { fontSize: font.body, lineHeight: 22, fontWeight: '600' },
});
