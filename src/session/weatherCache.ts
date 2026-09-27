// 백그라운드 저비용 날씨 캐시 래퍼 (FEAT-004) - RN/Expo 런타임 전용
//
// RN/Expo runtime only; not executed in sandbox.
//
// 배경: 백그라운드 태스크는 위험구역 진입/정밀 위치 업데이트마다 실행될 수 있다.
// 그때마다 KMA 실황 API 를 새로 부르면 배터리/네트워크를 낭비한다(초단기실황은 매시
// 정시 자료라 분 단위로 바뀌지 않는다). 그래서 마지막 날씨+조회시각을 캐시하고,
// TTL(기본 10분)이 지나야만 fetchCurrentWeather 로 재조회한다.
//
// fetchCurrentWeather(src/data/weather.ts)는 순수 계약을 유지하고, 여기서 캐시만
// 감싼다(래퍼). 캐시는 프로세스 메모리에 둔다 - 백그라운드 태스크는 짧게 깨어났다
// 종료되므로, 프로세스가 살아있는 동안의 반복 호출을 줄이는 것이 목적이다.
import type { WeatherCondition } from '../types';
import { fetchCurrentWeather } from '../data/weather';
import type { WeatherLookupOptions } from '../data/weather';

// 날씨 캐시 TTL(ms). 초단기실황은 매시 정시 자료이므로 10분이면 충분히 저렴하다.
export const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;

interface WeatherCacheEntry {
  condition: WeatherCondition;
  fetchedAt: number; // epoch ms
}

// 캐시 키는 격자 좌표(nx, ny) 기준이다. 지역 이동 시 격자가 바뀌면 다른 캐시 항목이 되어,
// 이전 지역(예: 서울)의 캐시가 새 지역(예: 서산)에 잘못 재사용되지 않는다. 같은 격자에
// 머무는 동안에는 TTL(기본 10분) 내 반복 호출을 캐시로 흡수한다.
function cacheKey(nx: number, ny: number): string {
  return `${nx},${ny}`;
}

const cache = new Map<string, WeatherCacheEntry>();

// 캐시된 날씨를 반환하되, TTL 이 지났으면(또는 해당 격자가 처음이면) fetchCurrentWeather
// 로 갱신한다. 캐시는 격자별로 분리되어 지역 이동 시에도 정확하다.
// now 는 테스트/결정성을 위해 주입 가능(기본 Date.now()).
export async function getCachedWeather(
  options: WeatherLookupOptions,
  ttlMs: number = WEATHER_CACHE_TTL_MS,
  now: number = Date.now()
): Promise<WeatherCondition> {
  const key = cacheKey(options.nx, options.ny);
  const entry = cache.get(key);
  if (entry && now - entry.fetchedAt < ttlMs) {
    return entry.condition;
  }
  const condition = await fetchCurrentWeather(options);
  cache.set(key, { condition, fetchedAt: now });
  return condition;
}

// 캐시를 무효화한다(세션 종료/테스트 리셋용). 모든 격자 항목을 비운다.
export function invalidateWeatherCache(): void {
  cache.clear();
}
