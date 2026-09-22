// WSS 결과 이력 저장/조회 (@react-native-async-storage/async-storage)
//
// WSSResult[] 를 로컬에 JSON 으로 저장하고 불러온다. RN 런타임에서만 동작한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WSSResult } from '../types';

const HISTORY_KEY = '@wss/history';
const MAX_HISTORY = 200;

// 저장된 WSS 결과 이력을 최신순으로 반환한다. 없거나 파싱 실패 시 빈 배열.
export async function loadHistory(): Promise<WSSResult[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as WSSResult[];
  } catch {
    return [];
  }
}

// 새 WSS 결과를 이력 맨 앞에 추가해 저장한다(최대 MAX_HISTORY 개 유지).
// 저장된 전체 이력을 반환한다.
export async function saveResult(result: WSSResult): Promise<WSSResult[]> {
  const current = await loadHistory();
  const next = [result, ...current].slice(0, MAX_HISTORY);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

// 이력을 모두 지운다.
export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(HISTORY_KEY);
}
