// 익명 기기 식별자(deviceId) 저장/로드 (AsyncStorage)
//
// 로그인/회원가입 없이 "이 기기에서 온 점수"를 서버에서 하루 1건으로 정규화(upsert)
// 하기 위한 랜덤 UUID 다. 개인정보가 아니며, 개인을 특정할 수 없는 무작위 값이다.
// 최초 1회 생성해 저장하고, 이후에는 저장된 값을 재사용한다. 앱 삭제 시 함께 지워진다.
//
// UUID 생성은 expo-crypto 의 randomUUID 가 있으면 사용하고, 없으면 Math.random 기반
// 폴백을 쓴다(식별 용도이므로 암호학적 강도가 필수는 아니다). expo-crypto 는 정적
// import 하지 않고 지연 require 로 로드해, 샌드박스/순수 코드가 모듈 해석 오류를
// 일으키지 않게 한다(apiKey.ts 패턴).
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = 'wss.deviceId.v1';

// 폴백 UUID v4 생성기(expo-crypto 미존재 시). 익명 식별 용도로 충분하다.
function fallbackUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateUuid(): string {
  try {
    const Crypto = require('expo-crypto');
    if (typeof Crypto?.randomUUID === 'function') {
      const id = Crypto.randomUUID();
      if (typeof id === 'string' && id.length > 0) return id;
    }
  } catch {
    // expo-crypto 미설치/미지원 -> 폴백.
  }
  return fallbackUuid();
}

// 저장된 익명 deviceId 를 반환한다. 없으면 새로 생성해 저장한 뒤 반환한다.
// AsyncStorage 오류가 나면(드묾) 생성한 값을 그대로 반환해 흐름이 깨지지 않게 한다.
export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.trim().length > 0) return existing;
  } catch {
    // 읽기 실패 -> 새 값 생성으로 진행.
  }
  const created = generateUuid();
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  } catch {
    // 저장 실패해도 이번 세션에서 쓸 값은 반환한다.
  }
  return created;
}
