// 온보딩 1단계 - 환영 & 안전 가치 설명 (FEAT-006)
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
//
// 이 앱이 실제로 하는 일만 정직하게 설명한다:
//   1) 사고다발구역에 들어가면 경고
//   2) 블루투스 이어폰으로 소리를 듣는 중이면(주변음 인지가 어려운 상태) 위험 가중치를 높여 더 민감하게 경고
// 노이즈 캔슬링 감지나 "화면 보며 걷기" 감지 같은 (불가능한) 기능은 주장하지 않는다.
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';

export default function OnboardingWelcome() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>보행 안전 점수(WSS)</Text>
      <Text style={styles.lead}>걸으면서 위험한 순간을 놓치지 않도록 돕는 앱이에요.</Text>

      <View style={styles.card}>
        <Text style={styles.bullet}>• 사고다발구역에 들어가면 실시간으로 경고합니다.</Text>
        <Text style={styles.bullet}>
          • 블루투스 이어폰으로 소리를 듣는 중이면 주변음 인지가 어려운 상태로 보고, 경고를 더 민감하게 조정합니다.
        </Text>
        <Text style={styles.bullet}>
          • 위치·경로는 기기 안에만 저장되고 서버로 전송하지 않아요. 다른 사용자와
          비교할 수 있도록 익명 점수와 날짜만 통계 서버로 보냅니다.
        </Text>
      </View>

      <Text style={styles.note}>
        다음 화면에서 위치 권한을 단계적으로 요청합니다. 필요한 이유를 먼저 설명한 뒤 요청해요.
      </Text>

      <TouchableOpacity style={styles.button} onPress={() => router.push('/onboarding/permissions')}>
        <Text style={styles.buttonText}>시작하기</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 28, gap: 16, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '800' },
  lead: { fontSize: 16, color: '#555' },
  card: { backgroundColor: '#f4f6f8', borderRadius: 16, padding: 18, gap: 10 },
  bullet: { fontSize: 15, lineHeight: 22, color: '#333' },
  note: { fontSize: 13, color: '#777', lineHeight: 20 },
  button: { backgroundColor: '#1a7f37', paddingVertical: 16, borderRadius: 999, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
