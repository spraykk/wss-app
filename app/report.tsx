// WSS 리포트 화면 - 결과 분해(breakdown) + 이력 표시
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { loadHistory } from '../src/storage/history';
import type { WSSResult } from '../src/types';

export default function ReportScreen() {
  const [history, setHistory] = useState<WSSResult[]>([]);

  useEffect(() => {
    void loadHistory().then(setHistory);
  }, []);

  const latest = history[0];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {latest ? (
        <View style={styles.card}>
          <Text style={styles.title}>최근 보행 결과</Text>
          <Text style={styles.big}>{Math.round(latest.displayScore)}점</Text>
          <Text style={styles.row}>원점수(rawScore): {latest.rawScore.toFixed(2)}</Text>
          <Text style={styles.row}>사용 비율: {(latest.usageRatio * 100).toFixed(1)}%</Text>
          <Text style={styles.row}>
            고위험 zone 사용 중 진입: {latest.enteredHighRiskZoneWhileUsingPhone ? '예' : '아니오'}
          </Text>
          <Text style={styles.subtitle}>세그먼트 분해</Text>
          {latest.segmentBreakdown.map((s, i) => (
            <Text key={`${s.regionId}-${i}`} style={styles.row}>
              {s.regionId}: 가중치 {s.weight.combined.toFixed(3)} / 기여 {s.contribution.toFixed(2)}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>저장된 보행 이력이 없습니다.</Text>
      )}

      <Text style={styles.subtitle}>이력 ({history.length})</Text>
      {history.map((h, i) => (
        <View key={i} style={styles.historyRow}>
          <Text>{Math.round(h.displayScore)}점</Text>
          <Text style={styles.muted}>raw {h.rawScore.toFixed(1)}</Text>
        </View>
      ))}

      <View style={styles.disclaimerBox}>
        <Text style={styles.disclaimer}>
          WSS는 알려진 위험 요인(위치·날씨·시간대·청각·스마트폰 사용)을 종합한 참고
          지표입니다. 시간대·날씨 가중치는 전국 교통사고 통계에 근거하며, 그 외 요인은
          설계자가 설정한 값으로 실제 사고 발생을 예측하지 않습니다.
        </Text>
        <Text style={styles.disclaimer}>
          기준선(WSS 80.605)은 위험을 단정하는 임계가 아니라 참고 기준선입니다. 상위
          30% 등 상대 순위 지표는 서버 연동 후 제공될 예정입니다.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f4f6f8', gap: 6 },
  title: { fontSize: 16, fontWeight: '700' },
  big: { fontSize: 48, fontWeight: '800' },
  subtitle: { fontSize: 15, fontWeight: '700', marginTop: 16 },
  row: { fontSize: 14, color: '#333' },
  empty: { fontSize: 15, color: '#777', textAlign: 'center', marginTop: 40 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  muted: { color: '#888' },
  disclaimerBox: { marginTop: 24, padding: 12, borderRadius: 10, backgroundColor: '#eef1f4', gap: 8 },
  disclaimer: { fontSize: 12, color: '#666', lineHeight: 18 },
});
