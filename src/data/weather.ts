// 날씨 조회 + 기상청(KMA) 초단기실황 base 시각 계산 (버그 #3, LOW)
//
// 배경: nearestUltraSrtNcstBase 는 KMA 초단기실황(초단기실황, getUltraSrtNcst)
// 요청에 쓸 base_date / base_time 을 계산한다. 기존 구현은 공유(shared) Date
// 객체를 mutate 해서 자정(midnight) 롤오버를 처리했기 때문에, 호출 순서/재사용에
// 따라 결과가 달라지는 순서 의존(order-dependent) 버그가 있었다.
//
// FIX: 공유 Date 를 변형하지 않고, 새 값을 계산/복제(clone)하는 불변(immutable)
// 방식으로 재작성한다. nearestUltraSrtNcstBase 는 Date 를 받아
// { baseDate: 'YYYYMMDD', baseTime: 'HHmm' } 를 반환하는 순수 함수로 노출해
// `node --experimental-strip-types` 로 검증 가능하게 한다.
//
// KMA 초단기실황 규칙: base_time 은 매시각 정시(HH00) 단위이며, HH00 자료는
// 대략 HH10 에 공개된다. 따라서 매시 :10 이전에는 "직전 시각"을 사용해야 하고,
// 00:10 이전에는 "전날 23:00" 으로 롤백한다. 위를 불변으로 구현한다.
import type { WeatherCondition } from '../types';
import { getKmaApiKey } from './apiKey';

// 초단기실황 자료 공개 지연(분). base_time HH00 자료는 HH10 경 공개된다.
export const ULTRA_SRT_NCST_PUBLISH_DELAY_MIN = 10;

export interface NcstBase {
  baseDate: string; // YYYYMMDD
  baseTime: string; // HHmm (분은 항상 00)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDate(year: number, month1to12: number, day: number): string {
  return `${year}${pad2(month1to12)}${pad2(day)}`;
}

// 기준 시각(now)에 대한 초단기실황 base_date/base_time 을 불변으로 계산한다.
// - 공유 Date 를 변형하지 않는다. 필요한 롤백은 로컬 날짜 구성요소로 새 Date 를
//   (new Date(year, month, day - 1)) 만들어 처리하므로 순서 의존이 없다.
export function nearestUltraSrtNcstBase(now: Date = new Date()): NcstBase {
  // now 를 변형하지 않고 로컬 시각 구성요소만 읽는다.
  const minutes = now.getMinutes();
  const hour = now.getHours();

  // 아직 이번 시각 자료가 공개되지 않았으면(:10 이전) 직전 시각을 base 로 한다.
  let baseHour = minutes < ULTRA_SRT_NCST_PUBLISH_DELAY_MIN ? hour - 1 : hour;

  let year = now.getFullYear();
  let month = now.getMonth(); // 0-11
  let day = now.getDate();

  if (baseHour < 0) {
    // 전날 23:00 으로 롤백. Date 를 mutate 하지 않고 새 Date 를 만들어 계산한다.
    // 로컬 자정에서 하루 전으로 이동하기 위해 로컬 구성요소로 새 Date 를 생성.
    const prevDay = new Date(year, month, day - 1);
    year = prevDay.getFullYear();
    month = prevDay.getMonth();
    day = prevDay.getDate();
    baseHour = 23;
  }

  return {
    baseDate: formatDate(year, month + 1, day),
    baseTime: `${pad2(baseHour)}00`,
  };
}

// KMA 초단기실황 카테고리(PTY: 강수형태) -> 앱 WeatherCondition 매핑.
// PTY: 0 없음, 1 비, 2 비/눈, 3 눈, 4 소나기, 5 빗방울, 6 빗방울눈날림, 7 눈날림
//
// 안개('fog') 자동감지 한계: KMA 초단기실황(getUltraSrtNcst)은 PTY/SKY 만 제공하고
// 시정(visibility)/안개 전용 카테고리가 없어, 이 응답만으로 안개를 신뢰성 있게
// 판별할 수 없다. 따라서 여기서는 기존 강수/하늘 분류를 유지한다. 별도 시정 관측
// (예: getWthrDataList 의 VS)이나 사용자 입력으로 안개가 확인되면 mapKmaToWeatherCondition
// 대신 'fog' 를 직접 세그먼트 weather 로 지정하면 WEATHER_WEIGHT.fog(1.62)가 적용된다.
export function mapKmaToWeatherCondition(pty: number, sky?: number): WeatherCondition {
  if (pty === 1 || pty === 2 || pty === 3 || pty === 4 || pty === 5 || pty === 6 || pty === 7) {
    return 'rain_or_snow';
  }
  // 강수 없음. SKY: 1 맑음, 3 구름많음, 4 흐림
  if (sky !== undefined && sky >= 3) return 'other_not_clear';
  return 'clear';
}

// ─────────────────────────────────────────────────────────────────────────────
// 위경도 -> 기상청(KMA) 동네예보 격자(nx, ny) 변환.
//
// 기상청 동네예보는 Lambert Conformal Conic(LCC, DFS) 격자 좌표계를 쓴다. 초단기실황/
// 예보 API 는 위경도가 아니라 이 격자 좌표(nx, ny)를 입력으로 받는다. 기존에는 "변환은
// 호출부 책임"이라 없었고, 백그라운드가 서울 격자를 하드코딩했다. 전국 어디서나 실제 GPS
// 좌표의 날씨를 받으려면 여기서 위경도를 격자로 변환한다.
//
// 아래 상수/알고리즘은 기상청이 공개한 표준 격자 변환(DFS) 공식이며, 순수 함수로 구현해
// `node --experimental-strip-types` 로 검증 가능하다. 결과 nx, ny 는 정수로 반올림한다.
const KMA_GRID = {
  RE: 6371.00877, // 지구 반경(km)
  GRID: 5.0, // 격자 간격(km)
  SLAT1: 30.0, // 표준 위도 1(deg)
  SLAT2: 60.0, // 표준 위도 2(deg)
  OLON: 126.0, // 기준점 경도(deg)
  OLAT: 38.0, // 기준점 위도(deg)
  XO: 43, // 기준점 X 좌표(격자)
  YO: 136, // 기준점 Y 좌표(격자)
} as const;

// 위경도(도 단위)를 기상청 동네예보 격자 좌표 { nx, ny }(정수)로 변환한다.
// LCC(Lambert Conformal Conic) DFS 순공식. 순수 함수(입력 외 상태 없음).
export function latLonToGrid(lat: number, lon: number): { nx: number; ny: number } {
  const DEGRAD = Math.PI / 180.0;
  const re = KMA_GRID.RE / KMA_GRID.GRID;
  const slat1 = KMA_GRID.SLAT1 * DEGRAD;
  const slat2 = KMA_GRID.SLAT2 * DEGRAD;
  const olon = KMA_GRID.OLON * DEGRAD;
  const olat = KMA_GRID.OLAT * DEGRAD;

  let sn =
    Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const nx = Math.floor(ra * Math.sin(theta) + KMA_GRID.XO + 0.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + KMA_GRID.YO + 0.5);
  return { nx, ny };
}

const KMA_ULTRA_SRT_NCST_URL =
  'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst';

export interface WeatherLookupOptions {
  // KMA 격자 좌표(nx, ny). 위경도->격자 변환은 호출부 책임(간결성을 위해 생략).
  nx: number;
  ny: number;
  now?: Date;
}

// 현재 날씨를 조회한다. API 키가 없으면 항상 'clear' 로 폴백한다.
// 네트워크(fetch)는 실제 앱 런타임에서만 동작하며, 샌드박스에서는 실행되지 않는다.
export async function fetchCurrentWeather(
  options: WeatherLookupOptions
): Promise<WeatherCondition> {
  const apiKey = getKmaApiKey();
  if (!apiKey) {
    // 키가 없으면 앱은 계속 동작하되 날씨는 '맑음'으로 처리한다(.env.example 참조).
    return 'clear';
  }

  const { baseDate, baseTime } = nearestUltraSrtNcstBase(options.now ?? new Date());
  const params = new URLSearchParams({
    serviceKey: apiKey,
    dataType: 'JSON',
    numOfRows: '60',
    pageNo: '1',
    base_date: baseDate,
    base_time: baseTime,
    nx: String(options.nx),
    ny: String(options.ny),
  });

  try {
    const res = await fetch(`${KMA_ULTRA_SRT_NCST_URL}?${params.toString()}`);
    if (!res.ok) return 'clear';
    const json = (await res.json()) as KmaNcstResponse;
    const items = json?.response?.body?.items?.item ?? [];
    let pty: number | undefined;
    let sky: number | undefined;
    for (const it of items) {
      if (it.category === 'PTY') pty = Number(it.obsrValue);
      if (it.category === 'SKY') sky = Number(it.obsrValue);
    }
    if (pty === undefined) return 'clear';
    return mapKmaToWeatherCondition(pty, sky);
  } catch {
    // 네트워크/파싱 오류 시에도 안전하게 '맑음' 폴백.
    return 'clear';
  }
}

interface KmaNcstItem {
  category: string;
  obsrValue: string;
}
interface KmaNcstResponse {
  response?: { body?: { items?: { item?: KmaNcstItem[] } } };
}
