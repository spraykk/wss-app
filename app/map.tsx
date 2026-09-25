import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { computeOverlapCounts, loadAccidentZones } from '../src/data/accidentZones';
import { palette, spacing, radius, font, shadow } from '../src/theme';

const zones = loadAccidentZones();
// 구역별로 "다른 위험구역과 원이 겹치는 개수"(마커 설명용) - zones와 같은 순서의 배열이라
// id 중복 문제(accidentZones.ts의 postProcessZones 설명 참고)에서 자유롭다.
// (computeOverlapCounts 는 내부에서 computeOverlapPairs 로 실제 겹치는 쌍을 센다.)
const overlapCounts = computeOverlapCounts(zones);

const initialRegion = {
  latitude: zones[0]?.latitude ?? 37.4812,
  longitude: zones[0]?.longitude ?? 126.9528,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
};

export default function MapScreen() {
  const mapRef = useRef<MapView | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!cancelled) setHasLocationPermission(status === 'granted');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goToMyLocation = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({});
      mapRef.current?.animateToRegion(
        {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500
      );
    } catch {
      // 위치를 가져오지 못하면(권한 거부 등) 조용히 무시
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.mapWrapper}>
        <MapView
          ref={mapRef}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          style={styles.map}
          initialRegion={initialRegion}
          showsUserLocation={hasLocationPermission}
          showsMyLocationButton={false}
        >
          {/* 위험구역을 반투명 빨간 원으로 그린다. 원이 겹치는 지점은 반투명 fill 의 alpha 가
              자연스럽게 누적되어 더 진한 빨강으로 보인다(별도 오버레이 없이 "겹칠수록 진한 빨강"). */}
          {zones.map((z, i) => (
            <View key={z.id}>
              <Circle
                center={{ latitude: z.latitude, longitude: z.longitude }}
                radius={z.radiusMeters}
                strokeColor="rgba(220,38,38,0.6)"
                strokeWidth={1}
                fillColor="rgba(220,38,38,0.18)"
              />
              <Marker
                coordinate={{ latitude: z.latitude, longitude: z.longitude }}
                title={z.name}
                description={
                  overlapCounts[i] > 0
                    ? `최근 3년 사고 ${z.accidentCount3y}건 · ⚠️ 인접 위험구역과 겹침(${overlapCounts[i]}곳) — 겹치는 지점은 위험도가 더 높게 반영됩니다`
                    : `최근 3년 사고 ${z.accidentCount3y}건`
                }
              />
            </View>
          ))}
        </MapView>

        {hasLocationPermission && (
          <TouchableOpacity style={styles.myLocationButton} onPress={goToMyLocation} activeOpacity={0.8}>
            <Text style={styles.myLocationButtonText}>내 위치</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.legend}>
        <Text style={styles.legendText}>
          🔴 빨간 원 = 사고다발지역 (3년간 500m 내 5회 이상). 이 구간을 지날 땐 스마트폰 사용을
          잠시 멈춰보세요.
        </Text>
        <Text style={styles.legendText}>
          🔴 겹쳐서 더 진한 빨강 = 위험구역이 중첩된 지점입니다. 점수 계산에도 더 큰 가중치가
          반영됩니다.
        </Text>
        <Text style={styles.legendText}>
          ℹ️ 사고건수가 많은 구역일수록(마커를 눌러 확인 가능) 실제 위험도 가중치도 더 높게
          반영됩니다 - 지도에는 동일한 빨간색으로 보이지만 점수 계산은 다릅니다.
        </Text>
        {!hasLocationPermission && (
          <Text style={styles.legendText}>
            📍 내 위치를 지도에 표시하려면 위치 권한을 허용해주세요.
          </Text>
        )}
        {zones[0]?.source === 'SAMPLE_PLACEHOLDER' && (
          <Text style={styles.sampleWarn}>
            ※ 현재 표시된 지점은 실제 사고 통계가 아닌 테스트용 샘플 좌표입니다.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  mapWrapper: { flex: 1 },
  map: { flex: 1 },
  myLocationButton: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    ...shadow.button,
  },
  myLocationButtonText: { fontWeight: '700', color: palette.skyDeep, fontSize: font.body },
  legend: {
    padding: spacing.lg,
    backgroundColor: palette.surface,
    gap: spacing.xs,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow.card,
  },
  legendText: { fontSize: font.caption, color: palette.textMuted, lineHeight: 18 },
  sampleWarn: { fontSize: font.caption, color: palette.dangerText, marginTop: spacing.sm, fontWeight: '700' },
});
