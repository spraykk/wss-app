import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Circle, Marker, Polygon, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { computeOverlapCounts, computeOverlapPairs, loadAccidentZones } from '../src/data/accidentZones';
import { computeOverlapRegion, OverlapRegion } from '../src/data/overlapGeometry';
import { planLensRendering } from '../src/data/overlapRender';

const zones = loadAccidentZones();
// 구역별로 "다른 위험구역과 원이 겹치는 개수"(마커 설명용) - zones와 같은 순서의 배열이라
// id 중복 문제(accidentZones.ts의 postProcessZones 설명 참고)에서 자유롭다.
const overlapCounts = computeOverlapCounts(zones);
// 실제로 겹치는 구역 쌍들에 대해서만 "겹치는 부분(렌즈 모양)"을 미리 계산해둔다.
// 전체 137개 x 137개를 다 계산하지 않고, 이미 겹친다고 확인된 쌍만 계산하므로 가볍다.
// null(안 겹침)이 아닌 쌍만 남기되, 렌즈 region 과 그 쌍(pair)의 인덱스를 함께 보관해
// 아래 planLensRendering 으로 "겹침 group 당 한 번만 채우기"를 적용한다.
const overlapPairs = computeOverlapPairs(zones);
const overlapItems = overlapPairs
  .map((pair) => ({
    pair,
    region: computeOverlapRegion(
      { latitude: zones[pair.i].latitude, longitude: zones[pair.i].longitude },
      zones[pair.i].radiusMeters,
      { latitude: zones[pair.j].latitude, longitude: zones[pair.j].longitude },
      zones[pair.j].radiusMeters
    ),
  }))
  .filter((item): item is { pair: { i: number; j: number }; region: OverlapRegion } => item.region !== null);
// 버그 #4 수정: 3개 이상의 원이 한 지점에서 겹치면 여러 렌즈가 포개져 반투명 fill alpha 가
// 누적되어 그 지점만 과도하게 진해진다. 렌즈들을 "공통 zone 을 공유하는" 연결 요소(group)로
// 묶고, group 당 하나의 렌즈에만 fill 을 적용(나머지는 외곽선만)하여 균일한 alpha 를 유지한다.
const lensPlans = planLensRendering(overlapItems.map((it) => it.pair));
const OVERLAP_FILL = 'rgba(147,51,234,0.55)';
const OVERLAP_STROKE = 'rgba(147,51,234,0.9)';
const hasOverlap = overlapItems.length > 0;

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
          {/* 1) 모든 위험구역을 항상 같은 빨간색으로 그린다 - 겹치는지 여부와 무관하게 원 전체 색은 고정.
              (겹치는 "부분"만 아래에서 보라색으로 덧그린다) */}
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

          {/* 2) 실제로 겹치는 "부분"만 보라색으로 덧그린다 (원 전체가 아니라 교집합 영역만).
              버그 #4: group 당 하나의 렌즈에만 fill 을 적용해 3개 이상 겹침 지점에서도
              반투명 alpha 가 누적되지 않도록 한다. fill=false 인 렌즈는 외곽선만 그린다. */}
          {overlapItems.map(({ region }, idx) => {
            const fillColor = lensPlans[idx].fill ? OVERLAP_FILL : 'rgba(0,0,0,0)';
            return region.kind === 'lens' ? (
              <Polygon
                key={`overlap-${idx}`}
                coordinates={region.polygon}
                strokeColor={OVERLAP_STROKE}
                strokeWidth={1}
                fillColor={fillColor}
              />
            ) : (
              <Circle
                key={`overlap-${idx}`}
                center={region.center}
                radius={region.radius}
                strokeColor={OVERLAP_STROKE}
                strokeWidth={1}
                fillColor={fillColor}
              />
            );
          })}
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
        {hasOverlap && (
          <Text style={styles.legendText}>
            🟣 보라색 = 위험구역 원끼리 실제로 겹치는 부분만 표시됩니다(원 전체가 아님). 겹치는
            지점은 점수 계산에도 더 큰 가중치가 반영됩니다.
          </Text>
        )}
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
  container: { flex: 1 },
  mapWrapper: { flex: 1 },
  map: { flex: 1 },
  myLocationButton: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    backgroundColor: 'white',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  myLocationButtonText: { fontWeight: '600', color: '#2563eb' },
  legend: { padding: 14, backgroundColor: '#f8fafc', gap: 4 },
  legendText: { fontSize: 12, color: '#334155', lineHeight: 18 },
  sampleWarn: { fontSize: 12, color: '#dc2626', marginTop: 6, fontWeight: '600' },
});
