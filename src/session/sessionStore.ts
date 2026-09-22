// 진행 중 보행 세션 지속(persistence) 계층 (FEAT-004) - RN/Expo 런타임 전용
//
// RN/Expo runtime only; not executed in sandbox.
//
// 배경: FEAT-004는 "보행 시작 후 앱을 꺼도(서스펜드/킬) 계속 측정"을 목표로 한다.
// 포그라운드 훅이 소유하던 in-memory 세션 상태로는 앱이 종료되면 사라진다. 그래서
// 진행 중 세션(segments, currentKey, startedAt, isTracking)을 AsyncStorage 에 지속해,
// 백그라운드 태스크가 갱신하고 재실행 시 복원할 수 있게 한다.
//
// AsyncStorage 사용 패턴은 src/storage/history.ts 를 그대로 따른다(JSON 직렬화,
// try/catch 안전 폴백). 저장 키는 '@wss/activeSession'.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SessionState } from './sessionReducer';
import { initialSessionState } from './sessionReducer';

const ACTIVE_SESSION_KEY = '@wss/activeSession';

// 디스크에 지속되는 진행 중 세션 스냅샷. SessionState(순수 누적 상태)에 세션 수명
// 메타데이터(시작 시각/추적 여부)를 더한다.
export interface ActiveSession extends SessionState {
  /** 세션 시작 시각(epoch ms). 없으면 미시작. */
  startedAt: number | null;
  /** 현재 추적(측정) 중인지 여부. stop() 시 false. */
  isTracking: boolean;
}

// 미시작 상태의 빈 세션 스냅샷.
export function emptyActiveSession(): ActiveSession {
  return { ...initialSessionState(), startedAt: null, isTracking: false };
}

// 진행 중 세션을 불러온다. 없거나 파싱 실패 시 빈(미추적) 세션으로 안전 폴백.
export async function loadActiveSession(): Promise<ActiveSession> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return emptyActiveSession();
    const parsed = JSON.parse(raw) as Partial<ActiveSession> | null;
    if (!parsed || !Array.isArray(parsed.segments)) return emptyActiveSession();
    return {
      segments: parsed.segments,
      currentKey: typeof parsed.currentKey === 'string' ? parsed.currentKey : null,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : null,
      isTracking: parsed.isTracking === true,
    };
  } catch {
    return emptyActiveSession();
  }
}

// 진행 중 세션을 저장(덮어쓰기)한다. 백그라운드 태스크/훅이 매 상태전이 후 호출한다.
export async function saveActiveSession(session: ActiveSession): Promise<void> {
  try {
    await AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
  } catch {
    // 저장 실패는 조용히 무시(다음 갱신에서 재시도). 측정 자체는 계속된다.
  }
}

// 진행 중 세션을 지운다(세션 종료/파기 시).
export async function clearActiveSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch {
    // 무시.
  }
}
