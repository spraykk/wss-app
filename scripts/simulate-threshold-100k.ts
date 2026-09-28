// WSS 임계점 도출 시뮬레이션 재실행 (표본 N=100,000, 결정적 시드)
//
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/simulate-threshold-100k.ts
//
// 이 스크립트는 검증 오라클(scripts/verify-*.ts, 25종)이 아니라 분석/시뮬레이션
// 스크립트다. 25종 스위트에 포함되지 않으며 필요할 때 수동으로 실행한다.
//
// 정직성 고지(중요): 아래 시뮬레이션은 인위적이다. 실제 사고 라벨 데이터가 없어,
// 목표변수 Y 를 WSS 점수 자체에서 생성한 뒤 다시 적합(re-fit)하는 방식으로 분포와
// 로지스틱 변곡점을 관찰한다. 표본을 10만으로 늘리는 것은 정밀도/견고성 재확인일 뿐,
// 실제 사고 예측력을 높이지 않는다. "10만이므로 정확하다"로 읽어서는 안 된다.
//
// 실제 코드 값(k=4, 실증/설계 가중치)을 그대로 쓰기 위해 verify-wss-example.ts 와 동일한
// ts-transpile-hook.mjs 로더 훅을 등록한 뒤 src/wss/weights.ts 를 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const {
  DEDUCTION_SCALE,
  WSS_CRITICAL,
  WEATHER_WEIGHT,
  TIME_WEIGHT,
  EAR_WEIGHT,
  computeLocationWeight,
  computeZoneSeverity,
} = await import('../src/wss/weights.ts');

// ---- 결정적 PRNG (mulberry32) : 고정 시드 -> 재실행 시 동일 출력 ----
const SEED = 0x9e3779b9; // 고정 시드(변경 금지: 재현성)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

// 이산 분포에서 항목 하나를 뽑는다(가중치는 노출 빈도 가정치, 결정적 rng 사용).
function pick<T>(entries: Array<[T, number]>): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of entries) {
    if ((r -= w) <= 0) return item;
  }
  return entries[entries.length - 1][0];
}

// ---- 합성 사용자 표본 생성 (재현 로직 요약 1~2단계) ----
// 실증(WEATHER/TIME) + 설계(LOCATION/OVERLAP/EAR) 가중치로 세그먼트별 결합 가중치를
// 만들고, 전체 감점에 k=4 를 곱해 rawScore = clamp(100 - 4 × combined) 로 점수화한다.
type Weather = keyof typeof WEATHER_WEIGHT;
type Time = keyof typeof TIME_WEIGHT;

const WEATHER_DIST: Array<[Weather, number]> = [
  ['clear', 0.68],
  ['rain_or_snow', 0.14],
  ['other_not_clear', 0.15],
  ['fog', 0.03],
];
const TIME_DIST: Array<[Time, number]> = [
  ['normal_day', 0.42],
  ['rush_am', 0.2],
  ['rush_pm', 0.22],
  ['normal_night', 0.16],
];
// 위험지역 진입 사고건수(3년): 대부분 구역 밖(0건), 일부만 다발지역.
const ACCIDENT_DIST: Array<[number, number]> = [
  [0, 0.62],
  [1, 0.14],
  [3, 0.12],
  [5, 0.08],
  [9, 0.03],
  [15, 0.01],
];

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, v));
}

// 한 명의 합성 사용자의 rawScore 를 만든다(1~3개 세그먼트의 감점 누적).
function sampleUserScore(): number {
  const segCount = 2 + Math.floor(rng() * 2); // 2..3 세그먼트
  let totalDeduction = 0;
  for (let i = 0; i < segCount; i++) {
    const accidents3y = pick(ACCIDENT_DIST);
    const riskIntensity = accidents3y > 0 ? computeZoneSeverity(accidents3y) : 0;
    const wLocation = computeLocationWeight(riskIntensity);
    const wWeather = WEATHER_WEIGHT[pick(WEATHER_DIST)];
    const wTime = TIME_WEIGHT[pick(TIME_DIST)];
    const wEar = rng() < 0.42 ? EAR_WEIGHT.occluded : EAR_WEIGHT.open;
    const combined = wLocation * wWeather * wTime * wEar;
    // 확인된 사용 시간(분): 지수분포 근사(대부분 짧고 일부 김).
    const useMinutes = -Math.log(1 - rng()) * 2.05;
    totalDeduction += combined * useMinutes;
  }
  return clampScore(100 - DEDUCTION_SCALE * totalDeduction);
}

// ---- 분포 통계 (재현 로직 요약 3단계) ----
const N = 100_000;
const scores = new Float64Array(N);
let sum = 0;
for (let i = 0; i < N; i++) {
  const s = sampleUserScore();
  scores[i] = s;
  sum += s;
}
const mean = sum / N;

const sorted = Float64Array.from(scores).sort();
function percentile(p: number): number {
  const idx = Math.min(N - 1, Math.max(0, Math.floor((p / 100) * (N - 1))));
  return sorted[idx];
}
const median = percentile(50);
const bottom10 = percentile(10);

// ---- 로지스틱 변곡점 (인위적 재적합) ----
// 정직성: 실제 사고 라벨이 없으므로 목표변수 Y 를 "WSS 점수 자체"에서 생성한다.
// 점수가 낮을수록 위험(Y=1) 확률이 커지도록 원 점수를 로지스틱 링크로 매핑해 이진
// 라벨을 만든 뒤, 그 라벨을 점수에 대해 다시 로지스틱 회귀로 적합해 변곡점(P=0.5,
// 즉 -b0/b1)을 관찰한다. 이는 순환적/인위적 재적합이며 실제 예측이 아니다.
const GEN_CENTER = 58; // 라벨 생성용 중심(원 시뮬레이션과 동일한 인위적 방식)
const GEN_SLOPE = 0.15; // 점수 상승 -> 위험확률 하강
const labels = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const pRisk = 1 / (1 + Math.exp(GEN_SLOPE * (scores[i] - GEN_CENTER)));
  labels[i] = rng() < pRisk ? 1 : 0;
}

// 점수를 표준화해 경사하강으로 로지스틱 회귀(b0 + b1*z) 적합 -> 변곡점 복원.
let zMean = mean;
let zStd = 0;
for (let i = 0; i < N; i++) zStd += (scores[i] - zMean) * (scores[i] - zMean);
zStd = Math.sqrt(zStd / N) || 1;

let b0 = 0;
let b1 = 0;
const LR = 0.3;
const EPOCHS = 400;
for (let e = 0; e < EPOCHS; e++) {
  let g0 = 0;
  let g1 = 0;
  for (let i = 0; i < N; i++) {
    const z = (scores[i] - zMean) / zStd;
    const pred = 1 / (1 + Math.exp(-(b0 + b1 * z)));
    const err = pred - labels[i];
    g0 += err;
    g1 += err * z;
  }
  b0 -= LR * (g0 / N);
  b1 -= LR * (g1 / N);
}
// P=0.5 -> b0 + b1*z = 0 -> z* = -b0/b1 -> 원 점수로 역변환.
const zStar = -b0 / b1;
const inflection = zMean + zStar * zStd;

// ---- 요약 출력 ----
console.log('WSS 임계점 시뮬레이션 재실행 (표본 10만)');
console.log(`script: scripts/simulate-threshold-100k.ts`);
console.log(`seed: 0x${SEED.toString(16)} (mulberry32, 고정)`);
console.log(`N: ${N}`);
console.log(`DEDUCTION_SCALE(k): ${DEDUCTION_SCALE}`);
console.log(`WSS_CRITICAL: ${WSS_CRITICAL}`);
console.log('---');
console.log(`mean(평균):        ${mean.toFixed(2)}`);
console.log(`median(중앙값):    ${median.toFixed(2)}`);
console.log(`bottom10(하위10%): ${bottom10.toFixed(2)}`);
console.log(`inflection(변곡점): ${inflection.toFixed(2)}`);
console.log('---');
const inRange = inflection >= 56 && inflection <= 62;
console.log(
  inRange
    ? `변곡점 ${inflection.toFixed(2)} in [56,62] -> WSS_CRITICAL=60 유지(값 변경 없음).`
    : `변곡점 ${inflection.toFixed(2)} 가 [56,62] 밖 -> 파라미터 변경 없이 편차를 기록해야 함.`,
);
console.log(
  '정직성: Y 는 WSS 점수 자체에서 생성한 인위적 라벨이다. 10만 표본은 정밀도/견고성 재확인일 뿐 실제 사고 예측력을 높이지 않는다.',
);
