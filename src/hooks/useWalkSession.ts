// 보행 세션 훅 (버그 #1, HIGH) - GPS 샘플을 WalkSegment 로 그룹화
//
// GPS 위치 샘플이 들어올 때마다 현재 맥락(대표 zone, riskIntensity, 날씨, 시간대,
// 이어폰 착용)으로 "세그먼트 키"를 만들고, 키가 바뀌면 새 세그먼트를 시작한다.
//
// 버그 #1: 기존 키는 riskIntensity.toFixed(4) 를 그대로 썼다. riskIntensity 는
// 연속 값이라 GPS 노이즈로 인한 미세 변동에도 매번 새 키 -> 세그먼트 과분할.
// FIX: 순수 함수 buildSegmentKey 로 riskIntensity 를 0.25 버킷으로 양자화하여
// 키를 안정화한다. 키 생성 로직은 src/hooks/segmentKey.ts 로 분리해 검증한다.
//
// expo-location 을 사용하므로 샌드박스에서는 실행되지 않는다(타입 정합만 보장).
import { useCallback, useRef, useState } from 'react';
import * as Location from 'expo-location';
import type { WalkSegment, WeatherCondition, TimeBand } from '../types.ts';
import { buildSegmentKey } from './segmentKey.ts';
import { getCurrentTimeBand } from '../wss/context.ts';

export interface WalkContextSample {
  zoneId: string;
  riskIntensity: number;
  weather: WeatherCondition;
  isEarOccluded: boolean;
  smartphoneUseMinutes: number;
  walkMinutes: number;
  timeBand?: TimeBand;
}

export interface UseWalkSession {
  segments: WalkSegment[];
  isTracking: boolean;
  start: () => Promise<void>;
  stop: () => void;
  // GPS/센서 파이프라인이 새 샘플을 만들 때마다 호출한다.
  ingestSample: (sample: WalkContextSample) => void;
}

export function useWalkSession(): UseWalkSession {
  const [segments, setSegments] = useState<WalkSegment[]>([]);
  const [isTracking, setIsTracking] = useState(false);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  // 현재 진행 중인 세그먼트의 키(과분할 방지를 위한 안정화된 키).
  const currentKeyRef = useRef<string | null>(null);

  const ingestSample = useCallback((sample: WalkContextSample): void => {
    const timeBand = sample.timeBand ?? getCurrentTimeBand();
    const key = buildSegmentKey({
      zoneId: sample.zoneId,
      riskIntensity: sample.riskIntensity,
      weather: sample.weather,
      timeBand,
      isEarOccluded: sample.isEarOccluded,
    });

    setSegments((prev) => {
      if (currentKeyRef.current === key && prev.length > 0) {
        // 같은 안정화 키 -> 기존 세그먼트에 누적(과분할 방지).
        const last = prev[prev.length - 1];
        const updated: WalkSegment = {
          ...last,
          smartphoneUseMinutes: last.smartphoneUseMinutes + sample.smartphoneUseMinutes,
          walkMinutes: last.walkMinutes + sample.walkMinutes,
        };
        return [...prev.slice(0, -1), updated];
      }
      // 키가 바뀜 -> 새 세그먼트 시작.
      currentKeyRef.current = key;
      const segment: WalkSegment = {
        regionId: sample.zoneId,
        smartphoneUseMinutes: sample.smartphoneUseMinutes,
        walkMinutes: sample.walkMinutes,
        riskIntensity: sample.riskIntensity,
        weather: sample.weather,
        timeBand,
        isEarOccluded: sample.isEarOccluded,
      };
      return [...prev, segment];
    });
  }, []);

  const start = useCallback(async (): Promise<void> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    setIsTracking(true);
    subscriptionRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
      () => {
        // 실제 앱에서는 여기서 위치->대표 zone/riskIntensity 를 계산한 뒤
        // ingestSample 을 호출한다. (zone 매칭 로직은 화면/상위 계층에서 주입)
      }
    );
  }, []);

  const stop = useCallback((): void => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    currentKeyRef.current = null;
    setIsTracking(false);
  }, []);

  return { segments, isTracking, start, stop, ingestSample };
}
