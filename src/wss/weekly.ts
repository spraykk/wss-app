// 주간 일별 대표 점수 집계 (순수 함수)
//
// 목적: 최근 7일(오늘 포함, 오늘 기준 이전 6일)의 "하루 대표 점수"를 막대그래프용으로 만든다.
// 하루의 대표값 = 그날 유한 점수 보행들의 "보행 시간 가중평균"이다:
//   rep = Σ(displayScore_i × w_i) / Σ(w_i),  w_i = 그 보행의 totalWalkMinutes(확정 보행 시간).
// 즉 오래 걸은 보행일수록 그날 대표 점수에 더 큰 영향을 준다(짧게 잠깐 걸은 보행이 하루 점수를
// 통째로 대표하던 예전 '마지막 보행' 방식의 왜곡을 바로잡는다). 보행이 없는 날은 null(빈 막대).
//
// 순수/제약: RN·AsyncStorage·node:* import 금지. 지역화(locale) 라이브러리 없이 문자열/Date
// 산술만 사용한다. 이 파일은 지울 수 있는(erasable-only) TS 여야 한다(enum/namespace/파라미터
// 프로퍼티 금지, 상대 import 확장자 금지). scripts/verify-weekly.ts 가 이 계약을 검증한다.
//
// 가중평균/하위호환 규칙(결정적):
//   (a) 유한한 displayScore 가 있는 항목만 집계에 포함한다(비유한/누락은 예전과 동일하게 제외).
//   (b) 가중치는 totalWalkMinutes 가 유한하고 > 0 일 때만 그 값을 쓴다. totalWalkMinutes 가 누락/
//       비유한/<=0 이면 그 보행의 가중치는 0(가중합에 기여하지 않음).
//   (c) 등가중 폴백: 어떤 날에 양의 유한 가중치를 가진 항목이 하나도 없으면(예: totalWalkMinutes
//       필드가 없던 레거시 이력 행들), 그 날은 유한 점수 항목들의 단순 평균으로 대표를 정한다(빈
//       막대로 가려지지 않도록). 이렇게 totalWalkMinutes 를 몰라도 정직하게 대표를 만든다.
//   가중평균은 순서 무관이므로 newest-first 여부는 대표 계산에 영향을 주지 않지만, 창(window)
//   필터와 유한 점수 필터는 그대로 유지된다.
//   dateISO 가 없는 항목은 특정 날짜에 배치할 수 없으므로 차트 집계에서 무시한다.

// 집계에 필요한 최소 형태만 받는다(WSSResult 를 그대로 넘겨도 호환).
export interface WeeklyEntry {
  dateISO?: string;
  displayScore: number;
  /** 그날 대표 가중평균의 가중치 = 확정 보행 시간(분). WSSResult 가 그대로 넘어올 때
   * WSSResult.totalWalkMinutes 가 바로 이 필드로 매핑되도록 이름을 일치시켰다(호출부 매핑 불필요).
   * 없으면 하위호환 규칙 적용(가중치 0, 그날에 양의 가중치가 없으면 단순 평균으로 폴백). */
  totalWalkMinutes?: number;
}

// 하루 슬롯: 날짜와 그날의 대표 점수(없으면 null).
export interface WeeklyDay {
  dateISO: string;
  score: number | null;
}

// 반환하는 창(window) 길이(일). 7일 고정.
const WINDOW_DAYS = 7;

// yyyy-mm-dd 문자열을 UTC 자정 타임스탬프로 파싱한다(로컬 타임존/DST 영향 배제).
// 잘못된 형식이면 null.
function parseISODateToUTC(iso: string): number | null {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ts = Date.UTC(year, month - 1, day);
  const back = utcToISO(ts);
  // 존재하지 않는 날짜(예: 2-30)는 롤오버되므로 원본과 다르면 무효 처리.
  if (back !== iso) return null;
  return ts;
}

// UTC 타임스탬프를 yyyy-mm-dd 로 되돌린다.
function utcToISO(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const mm = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getUTCDate()}`.padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 최근 7일 일별 대표 점수를 시간순(과거->오늘)으로 반환한다.
 * @param history 보행 이력. 최신순(newest-first)으로 간주한다(loadHistory 계약과 동일).
 * @param todayISO 기준 날짜(yyyy-mm-dd). 이 날짜와 이전 6일이 창(window)이 된다.
 * @returns 정확히 7개의 { dateISO, score } (과거->오늘 순). 보행 없는 날은 score=null.
 */
export function computeWeeklyDaily(
  history: readonly WeeklyEntry[],
  todayISO: string
): WeeklyDay[] {
  const todayTs = parseISODateToUTC(todayISO);
  // 기준 날짜가 유효하지 않으면 안전하게 빈 7칸(모두 null, 날짜만 빈 문자열)을 만들 수 없으므로
  // 예외를 던지지 않고 오늘 기준을 만들 수 없다는 계약 위반이다. 여기서는 방어적으로 빈 배열 대신
  // 유효하지 않은 입력을 그대로 반영하기 위해 빈 문자열 날짜의 7칸을 반환한다.
  if (todayTs === null) {
    const fallback: WeeklyDay[] = [];
    for (let i = 0; i < WINDOW_DAYS; i += 1) fallback.push({ dateISO: '', score: null });
    return fallback;
  }

  // 창의 각 날짜(과거->오늘)를 미리 만든다.
  const days: WeeklyDay[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) {
    days.push({ dateISO: utcToISO(todayTs - i * MS_PER_DAY), score: null });
  }

  // 날짜 -> days 배열 인덱스 매핑(빠른 조회).
  const indexByDate: Record<string, number> = {};
  for (let i = 0; i < days.length; i += 1) indexByDate[days[i].dateISO] = i;

  // 날짜별 누산기: 가중합(weightedSum)/가중치합(weightSum)은 보행시간 가중평균용,
  // simpleSum/simpleCount 는 양의 가중치가 하나도 없을 때의 등가중(단순 평균) 폴백용이다.
  interface DayAcc {
    weightedSum: number;
    weightSum: number;
    simpleSum: number;
    simpleCount: number;
  }
  const acc: Record<string, DayAcc> = {};

  // history 를 훑으며 창 안 날짜의 유한 점수 항목을 누적한다. 가중평균은 순서 무관이므로
  // newest-first 여부는 대표값에 영향을 주지 않는다(창/유한 점수 필터만 유지).
  for (const entry of history) {
    if (!entry || typeof entry.dateISO !== 'string') continue; // dateISO 없는 항목 무시.
    const iso = entry.dateISO;
    const idx = indexByDate[iso];
    if (idx === undefined) continue; // 창 밖의 날짜는 제외.
    // 유한한 displayScore 항목만 집계(비유한/누락은 제외).
    if (typeof entry.displayScore !== 'number' || !Number.isFinite(entry.displayScore)) {
      continue;
    }
    const score = entry.displayScore;
    let a = acc[iso];
    if (a === undefined) {
      a = { weightedSum: 0, weightSum: 0, simpleSum: 0, simpleCount: 0 };
      acc[iso] = a;
    }
    // 등가중 폴백용: 유한 점수 항목은 무조건 단순 평균 누산에 포함한다.
    a.simpleSum += score;
    a.simpleCount += 1;
    // 가중치는 totalWalkMinutes 가 유한하고 > 0 일 때만 사용(그 외는 가중치 0 -> 가중합에 미기여).
    const w = entry.totalWalkMinutes;
    if (typeof w === 'number' && Number.isFinite(w) && w > 0) {
      a.weightedSum += score * w;
      a.weightSum += w;
    }
  }

  // 각 날짜 대표값 확정: 양의 가중치가 있으면 보행시간 가중평균, 없으면 단순 평균 폴백.
  for (const iso of Object.keys(acc)) {
    const a = acc[iso];
    const idx = indexByDate[iso];
    if (idx === undefined) continue;
    if (a.weightSum > 0) {
      days[idx].score = a.weightedSum / a.weightSum;
    } else if (a.simpleCount > 0) {
      days[idx].score = a.simpleSum / a.simpleCount;
    }
  }

  return days;
}
