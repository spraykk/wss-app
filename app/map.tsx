import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import * as Location from 'expo-location';
import type { AccidentZone } from '../src/types';
import { computeOverlapCounts, loadRawAccidentZones, ZONE_RADIUS_SCALE } from '../src/data/accidentZones';
import { palette, spacing, radius, font, shadow } from '../src/theme';

// ─────────────────────────────────────────────────────────────────────────────
// 성능 주의(전국 12,780건): 이 화면은 "표시 전용"이다. 전국 데이터를 전부
// <Circle>+<Marker> 로 그리면 약 2.5만 개의 지도 오브젝트가 생겨 실기기에서
// 프리즈한다. 따라서 아래 두 가지로 렌더 부하를 상수 수준으로 억제한다.
//   (1) 뷰포트 필터: 현재 화면 region(경계 박스) 안에 드는 zone 만 그린다.
//   (2) 하드 상한(MAX_RENDERED_ZONES): 아주 축소된 줌 레벨에서 경계 박스가
//       넓어져도 오브젝트 수가 폭발하지 않도록 사고건수 많은 순 상위 N개만.
//
// 또한 dedup(mergeNearbyZones)/전역 겹침계산(computeOverlapCounts)은 전국
// 규모에서 O(n^2)(약 1.6억 쌍)라 모듈 로드 시 블로킹된다. 이 화면은 표시 전용
// 이므로 무거운 dedup 을 생략한 loadRawAccidentZones() 를 useEffect 로 1회
// 로드하고(로딩 상태 표시), 겹침 개수는 "화면에 그리는 subset(수백 개)" 에
// 대해서만 계산한다. 점수 계산 경로(loadAccidentZones/dedup)는 그대로 둔다.
// ─────────────────────────────────────────────────────────────────────────────

// 한 번에 지도에 그릴 수 있는 최대 위험구역 수(원+마커 오브젝트 폭발 방지 하드 상한).
const MAX_RENDERED_ZONES = 300;

// 위치 권한이 없거나 초기 위치를 못 구했을 때의 기본 region(서울대입구 부근).
const DEFAULT_REGION: Region = {
  latitude: 37.4812,
  longitude: 126.9528,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
};

// 현재 region(경계 박스) 안에 드는 zone 만 남기고, 상한을 초과하면 사고건수 많은
// 순 상위 N개만 반환하는 순수 헬퍼. region 이 아직 없으면 빈 배열(로드 직후 프레임).
function selectVisibleZones(zones: AccidentZone[], region: Region | null): AccidentZone[] {
  if (!region) return [];
  const halfLat = region.latitudeDelta / 2;
  const halfLon = region.longitudeDelta / 2;
  const minLat = region.latitude - halfLat;
  const maxLat = region.latitude + halfLat;
  const minLon = region.longitude - halfLon;
  const maxLon = region.longitude + halfLon;

  const inView = zones.filter(
    (z) =>
      z.latitude >= minLat &&
      z.latitude <= maxLat &&
      z.longitude >= minLon &&
      z.longitude <= maxLon
  );

  if (inView.length <= MAX_RENDERED_ZONES) return inView;

  // 상한 초과(아주 축소된 줌): 사고건수 많은 순 상위 N개만.
  return [...inView]
    .sort((a, b) => b.accidentCount3y - a.accidentCount3y)
    .slice(0, MAX_RENDERED_ZONES);
}

export default function MapScreen() {
  const mapRef = useRef<MapView | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [zones, setZones] = useState<AccidentZone[] | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);

  // 데이터 로드 + 초기 region 결정(권한 있으면 현재 위치 중심). 표시 전용이라
  // 무거운 dedup 없이 raw 를 1회 로드한다(전국 12,780건도 즉시 로드 가능).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = loadRawAccidentZones();
      if (!cancelled) setZones(loaded);

      const { status } = await Location.requestForegroundPermissionsAsync();
      const granted = status === 'granted';
      if (!cancelled) setHasLocationPermission(granted);

      let start: Region = { ...DEFAULT_REGION };
      if (granted) {
        try {
          const loc = await Location.getCurrentPositionAsync({});
          start = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          };
        } catch {
          // 현재 위치를 못 구하면 기본 region 사용
        }
      }
      if (!cancelled) {
        setInitialRegion(start);
        setRegion(start);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 화면에 실제로 그릴 subset(뷰포트 필터 + 하드 상한). region/zones 변경 시에만 재계산.
  // 지도는 성능상 dedup 을 생략한 raw 경로(loadRawAccidentZones)를 쓰므로 postProcessZones
  // 의 반경 축소(ZONE_RADIUS_SCALE)가 적용되지 않은 원본 radiusMeters 를 가진다. 표시 반경이
  // 점수 경로(postProcessZones)와 동일하게 축소되도록, 여기서 radiusMeters 에 스케일을 곱한
  // subset 을 만들어 원 렌더와 겹침 계산 모두 이 축소 반경을 기준으로 삼는다(시각/설명 일치).
  const visibleZones = useMemo(
    () =>
      zones
        ? selectVisibleZones(zones, region).map((z) => ({
            ...z,
            radiusMeters: z.radiusMeters * ZONE_RADIUS_SCALE,
          }))
        : [],
    [zones, region]
  );

  // 겹침 개수는 "그리는 subset(수백 개)" 에 대해서만 계산한다(전역 O(n^2) 제거).
  // visibleZones 는 이미 축소 반경(ZONE_RADIUS_SCALE 적용)이므로, 겹침 판정도 표시 원과
  // 동일한 반경 기준으로 이뤄져 "겹쳐 보이는데 카운트는 미축소" 불일치가 생기지 않는다.
  const overlapCounts = useMemo(() => computeOverlapCounts(visibleZones), [visibleZones]);

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

  // 초기 region 이 정해지기 전(데이터/권한 확인 중)에는 로딩 화면을 보여준다.
  if (!initialRegion || !zones) {
    return (
      <View style={[styles.container, styles.loading]}>
        <ActivityIndicator size="large" color={palette.skyDeep} />
        <Text style={styles.loadingText}>위험 지도를 불러오는 중…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.mapWrapper}>
        <MapView
          ref={mapRef}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          style={styles.map}
          initialRegion={initialRegion}
          onRegionChangeComplete={setRegion}
          showsUserLocation={hasLocationPermission}
          showsMyLocationButton={false}
        >
          {/* 위험구역을 반투명 빨간 원으로 그린다. 원이 겹치는 지점은 반투명 fill 의 alpha 가
              자연스럽게 누적되어 더 진한 빨강으로 보인다(별도 오버레이 없이 "겹칠수록 진한 빨강").
              화면에 보이는 subset(visibleZones)만 그려 오브젝트 수를 상수 수준으로 억제한다. */}
          {visibleZones.map((z, i) => (
            <View key={`${z.id}#${i}`}>
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
          🗺️ 지도를 이동/확대하면 그 근처의 위험구역을 표시합니다. (전국 데이터가 많아 화면에
          보이는 구역만 그립니다.)
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
  loading: { alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loadingText: { fontSize: font.body, color: palette.textMuted },
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
