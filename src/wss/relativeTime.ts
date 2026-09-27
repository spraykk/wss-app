// 상대 시간(relative time) 표시용 순수 유도 함수 (FEAT-003)
//
// 리포트(app/report.tsx) 이력 행에서 "몇 분/시간/일 전"을 사람이 읽기 쉽게 보여주기
// 위한 단일 진실(single source of truth). 저장 시점에 도장 찍은 recordedAt(ms epoch)와
// 현재 시각(nowMs)의 차이를 버킷팅해 문자열로 만든다.
//
// RN/Expo 런타임과 무관한 순수 계산이라 node --experimental-strip-types 로 그대로
// 검증 가능하다(erasable-only: enum/네임스페이스/파라미터 프로퍼티 금지, 상대 import
// 확장자 없음, node import 없음). 현재 시각은 주입값(nowMs)으로 받아 순수성을 지킨다.

// 버킷 경계(ms). 이름 있는 상수로 두어 의미를 드러내고 오변경에 민감하게 한다.
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * fromMs(과거 시각, ms epoch)와 nowMs(현재 시각, ms epoch)의 차이를 상대 시간 문자열로.
 *
 * 규칙(경계 포함):
 *  - fromMs 또는 nowMs 가 유한하지 않으면 '-'(신뢰할 수 없는 입력은 지어내지 않는다).
 *  - deltaMs = nowMs - fromMs.
 *  - deltaMs < 0 (미래 타임스탬프): 방어적으로 '방금'(음수 라벨을 내보내지 않는다).
 *  - deltaMs < 60_000 (1분 미만): '방금'.
 *  - deltaMs < 3_600_000 (60분 미만): `${분}분 전`, 분 = Math.floor(deltaMs/60000).
 *  - deltaMs < 86_400_000 (24시간 미만): `${시}시간 전`, 시 = Math.floor(deltaMs/3600000).
 *  - 그 외: `${일}일 전`, 일 = Math.floor(deltaMs/86400000).
 */
export function formatRelativeTime(fromMs: number, nowMs: number): string {
  if (!Number.isFinite(fromMs) || !Number.isFinite(nowMs)) return '-';
  const deltaMs = nowMs - fromMs;
  if (deltaMs < MINUTE_MS) return '방금'; // 음수(미래)/1분 미만 모두 여기로 접힌다.
  if (deltaMs < HOUR_MS) return `${Math.floor(deltaMs / MINUTE_MS)}분 전`;
  if (deltaMs < DAY_MS) return `${Math.floor(deltaMs / HOUR_MS)}시간 전`;
  return `${Math.floor(deltaMs / DAY_MS)}일 전`;
}

/**
 * recordedAt(정밀 타임스탬프)이 없던 과거 이력 행을 위한 날짜 전용 폴백.
 * yyyy-mm-dd 문자열을 "로컬 자정"의 ms epoch 으로 파싱하고, nowMs 도 그 날의 "로컬 자정"으로
 * 내려 맞춘 뒤 두 자정 사이의 일 수를 센다. 시각 성분이 없는 날짜 데이터이므로 하루 미만
 * 버킷(분/시간)은 쓰지 않고 일 단위로만 표기한다: 같은 날 -> '방금', 그 외 -> 'N일 전'.
 *
 * 방어적 처리: 형식이 맞지 않거나(정규식 불일치) 파싱 결과가 유한하지 않으면 '-'.
 * 미래 날짜(음수 델타)는 formatRelativeTime 과 동일하게 '방금' 으로 접힌다.
 * node:* 없이 순수 Date 산술만 사용한다(report.tsx toDateISO 와 동일한 순수 규칙).
 */
export function formatRelativeDateISO(dateISO: string, nowMs: number): string {
  if (typeof dateISO !== 'string') return '-';
  if (!Number.isFinite(nowMs)) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return '-';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // 날짜의 로컬 자정(월은 0-베이스). 잘못된 성분은 Date 가 NaN 을 돌려주므로 걸러진다.
  const fromMidnightMs = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  if (!Number.isFinite(fromMidnightMs)) return '-';
  // 현재 시각도 그 날의 로컬 자정으로 내려 맞춰 시각 성분을 제거한다.
  const nowDate = new Date(nowMs);
  const nowMidnightMs = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
    0,
    0,
    0,
    0
  ).getTime();
  const deltaDays = Math.floor((nowMidnightMs - fromMidnightMs) / DAY_MS);
  if (deltaDays <= 0) return '방금'; // 같은 날 또는 미래 날짜(방어적).
  return `${deltaDays}일 전`;
}
