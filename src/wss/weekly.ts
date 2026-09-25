// 주간 일별 대표 점수 집계 (순수 함수)
//
// 목적: 최근 7일(오늘 포함, 오늘 기준 이전 6일)의 "하루 대표 점수"를 막대그래프용으로 만든다.
// 하루의 대표값 = 그날의 "마지막(가장 최근)" 보행의 displayScore. 보행이 없는 날은 null(빈 막대).
//
// 순수/제약: RN·AsyncStorage·node:* import 금지. 지역화(locale) 라이브러리 없이 문자열/Date
// 산술만 사용한다. 이 파일은 지울 수 있는(erasable-only) TS 여야 한다(enum/namespace/파라미터
// 프로퍼티 금지, 상대 import 확장자 금지). scripts/verify-weekly.ts 가 이 계약을 검증한다.
//
// "마지막(가장 최근)"의 정의(결정적):
//   이력(history)은 저장 시 최신순(newest-first)으로 쌓인다(saveResult 가 맨 앞에 prepend,
//   loadHistory 도 그대로 최신순 반환). 따라서 특정 날짜의 대표 항목은 "최신순으로 훑을 때
//   그 날짜와 처음 일치하는 항목"이다. 즉 입력을 newest-first 로 간주하는 것이 계약이며,
//   같은 날짜에 여러 보행이 있으면 배열에서 더 앞(=더 최근)에 있는 항목이 대표가 된다.
//   dateISO 가 없는 항목은 특정 날짜에 배치할 수 없으므로 차트 집계에서 무시한다.

// 집계에 필요한 최소 형태만 받는다(WSSResult 를 그대로 넘겨도 호환).
export interface WeeklyEntry {
  dateISO?: string;
  displayScore: number;
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

  // history 를 최신순으로 훑으며 각 날짜의 "처음 만나는(=가장 최근)" 항목을 대표로 채운다.
  // 이미 채워진 날짜는 건너뛴다(그 뒤에 오는 항목은 더 오래된 것이므로 대표가 아니다).
  const filled: Record<string, boolean> = {};
  for (const entry of history) {
    if (!entry || typeof entry.dateISO !== 'string') continue; // dateISO 없는 항목 무시.
    const iso = entry.dateISO;
    const idx = indexByDate[iso];
    if (idx === undefined) continue; // 창 밖의 날짜는 제외.
    if (filled[iso]) continue; // 이미 더 최근 항목으로 채워짐.
    const score = typeof entry.displayScore === 'number' && Number.isFinite(entry.displayScore)
      ? entry.displayScore
      : null;
    days[idx].score = score;
    filled[iso] = true;
  }

  return days;
}
