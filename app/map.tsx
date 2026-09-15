// 위험 지도 화면 (react-native-maps) - 버그 #4 겹침 렌더링 수정 적용
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
//
// 버그 #4: 3개 이상의 위험 원이 겹칠 때, 쌍(pair)마다 렌즈 폴리곤을 그리면
// 겹침 영역의 알파가 누적되어 과도하게 어두워졌다.
// FIX: overlapGeometry.groupOverlappingCircles 로 겹치는 원들을 하나의 그룹으로
// 묶고, 그룹 단위로 "한 번만" 렌더링한다. 개별 원은 고정 알파(clampAlpha)로 그려
// 픽셀 단위 알파가 겹침 개수에 비례해 누적되지 않도록 한다.
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle } from 'react-native-maps';
import { loadAccidentZones } from '../src/data/accidentZones.ts';
import {
  clampAlpha,
  groupOverlappingCircles,
  type OverlapCircle,
} from '../src/data/overlapGeometry.ts';
import type { AccidentZone } from '../src/types.ts';

// 위경도를 기준점 기준 평면(미터) 좌표로 근사 변환한다(등거리 근사).
const METERS_PER_DEG_LAT = 111_320;
function toPlanar(zone: AccidentZone, originLat: number): OverlapCircle {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  return {
    id: zone.id,
    x: zone.longitude * metersPerDegLon,
    y: zone.latitude * METERS_PER_DEG_LAT,
    radiusMeters: zone.radiusMeters,
  };
}

export default function MapScreen() {
  const [zones, setZones] = useState<AccidentZone[]>([]);

  useEffect(() => {
    // 중복 병합(#5)된 zone 목록을 로드한다.
    setZones(loadAccidentZones());
  }, []);

  // 겹치는 원들을 그룹으로 묶어, 그룹당 대표 알파로 한 번만 렌더링한다(#4).
  const { groupOfZone } = useMemo(() => {
    if (zones.length === 0) return { groupOfZone: new Map<string, number>() };
    const originLat = zones[0].latitude;
    const circles = zones.map((z) => toPlanar(z, originLat));
    const groups = groupOverlappingCircles(circles);
    const map = new Map<string, number>();
    groups.forEach((group, idx) => group.forEach((id) => map.set(id, idx)));
    return { groupOfZone: map };
  }, [zones]);

  // 그룹당 한 번만 채움을 그린다: 그룹의 첫 zone 만 채우고 나머지는 테두리만.
  // 이렇게 하면 3개 이상 겹쳐도 채움 알파가 누적되지 않는다.
  const firstOfGroup = useMemo(() => {
    const seen = new Set<number>();
    const first = new Set<string>();
    for (const z of zones) {
      const g = groupOfZone.get(z.id);
      if (g === undefined) {
        first.add(z.id);
        continue;
      }
      if (!seen.has(g)) {
        seen.add(g);
        first.add(z.id);
      }
    }
    return first;
  }, [zones, groupOfZone]);

  const fillAlpha = clampAlpha(0.35);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={
          zones.length > 0
            ? {
                latitude: zones[0].latitude,
                longitude: zones[0].longitude,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }
            : undefined
        }
      >
        {zones.map((z) => {
          const isFill = firstOfGroup.has(z.id);
          return (
            <Circle
              key={z.id}
              center={{ latitude: z.latitude, longitude: z.longitude }}
              radius={z.radiusMeters}
              strokeColor={`rgba(180,35,24,0.8)`}
              // 그룹 대표 원만 채우고 나머지는 투명 채움 -> 알파 누적 방지.
              fillColor={isFill ? `rgba(180,35,24,${fillAlpha})` : 'rgba(0,0,0,0)'}
            />
          );
        })}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});
