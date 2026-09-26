// 백그라운드 세션 파이프라인 (FEAT-004) - RN/Expo 런타임 전용
//
// RN/Expo runtime only; not executed in sandbox.
//
// 이 모듈이 FEAT-004의 핵심이다: "보행 시작 후 앱을 꺼도 계속 측정"을 이벤트 기반으로
// 구현한다. iOS 는 임의 타이머(setInterval)로 백그라운드 실행을 보장하지 않으므로,
// 신뢰할 수 있는 백그라운드 깨움은 지오펜스 region 이벤트(ENTER)와 유의미한 위치변화
// (구역 내부 정밀 위치 업데이트)에서 온다. 따라서 이 파이프라인은 절대 setInterval 을
// 쓰지 않고, FEAT-003 지오펜스 컨트롤러의 콜백(onEnterZone/onPreciseSample)에만 반응한다.
//
// 각 트리거마다:
//   1) 현재 위치를 감싸는 위험구역 계산(loadAccidentZones + findEnclosingZones)
//      -> riskIntensity(겹친 구역 severity 합), 대표 zoneId
//   2) 날씨 조회(getCachedWeather: TTL 캐시로 배터리/네트워크 절약)
//   3) 오디오 환경 읽기(FEAT-002). 딥 백그라운드에서는 stale/미지원일 수 있어 best-effort.
//   4) 순수 리듀서(reduceSession)로 세그먼트 누적 -> 지속(persist)
//   5) WSS 재계산(computeWSS) 후 고위험+휴대폰사용/임계미만이면 로컬 알림(presentHighRiskAlert)
//
// TaskManager.defineTask 는 Expo 요구상 모듈 전역 스코프에서 등록되어야 하며, 앱이
// 이 모듈을 import 하는 것(app/_layout.tsx)만으로 등록된다.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Accelerometer, DeviceMotion } from 'expo-sensors';
import type { AccidentZone } from '../types';
import { loadAccidentZones, findEnclosingZones } from '../data/accidentZones';
import { computeDenseClusterAt, decideDenseClusterAlert } from '../data/zoneCluster';
import { computeRiskIntensity } from '../wss/weights';
import { getCurrentTimeBand } from '../wss/context';
import { computeWSS } from '../wss/engine';
import {
  presentHighRiskAlert,
  presentCriticalScoreAlert,
  presentDenseZoneEntryAlert,
} from '../notifications/alerts';
import { getCachedWeather } from './weatherCache';
import { latLonToGrid } from '../data/weather';
import { reduceSession } from './sessionReducer';
import type { WalkContextSample } from './sessionReducer';
import { loadActiveSession, saveActiveSession } from './sessionStore';
import type { ActiveSession } from './sessionStore';
import { readAudioEnvironmentSnapshot } from '../sensors/useAudioEnvironment';
import { isEarEffectivelyOccluded } from '../sensors/audioState';
import { decideLocationWalking, createInitialMotionState } from '../sensors/motionClassifier';
import type { MotionState } from '../sensors/motionClassifier';
import { gravityToPitchRoll } from '../sensors/postureMath';
import {
  createInitialPostureContinuityState,
  stepPostureContinuity,
  PITCH_USE_THRESHOLD_DEG,
  USE_SUSTAIN_MS,
} from '../sensors/postureUsageDetector';
import type { PostureContinuityState } from '../sensors/postureUsageDetector';
import { hadRecentInteraction } from './interactionTracker';

// 세션 파이프라인 백그라운드 태스크 이름. TaskManager.defineTask 는 모듈 로드 시 1회만
// 정의되어야 하므로 모듈 스코프 상수로 둔다. 지오펜스 태스크(GEOFENCE_TASK_NAME)와는
// 별개다: 이 태스크는 백그라운드 위치 업데이트(startLocationUpdatesAsync)를 소비한다.
export const SESSION_LOCATION_TASK_NAME = 'wss-session-location-task';

// 폴백 격자: 위경도가 없거나(유효하지 않거나) 격자 변환이 실패할 때만 쓰는 안전 기본값.
// 정상 경로에서는 실제 GPS 좌표를 latLonToGrid 로 변환해 전국 어디서나 정확한 날씨를 받는다.
// (weather.ts 의 fetch 는 키가 없으면 'clear' 로 폴백하므로 기본값이어도 안전하다.)
const FALLBACK_KMA_GRID = { nx: 59, ny: 125 };

// 위경도를 KMA 격자로 변환한다. 좌표가 유효하지 않거나 변환 결과가 유한수가 아니면
// 안전 폴백 격자를 반환한다(위경도 정보가 없는 극단적 경우에만 발생).
function gridForLocation(latitude: number, longitude: number): { nx: number; ny: number } {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    (latitude === 0 && longitude === 0)
  ) {
    return FALLBACK_KMA_GRID;
  }
  const grid = latLonToGrid(latitude, longitude);
  if (!Number.isFinite(grid.nx) || !Number.isFinite(grid.ny)) {
    return FALLBACK_KMA_GRID;
  }
  return grid;
}

// ─────────────────────────────────────────────────────────────────────────────
// 자세(스마트폰 사용) 감지용 모듈 스코프 상태 (FEAT-003) - RN 런타임 전용.
//
// 배경: 사용(보행 중 화면 보기) 판정은 자세(pitch)를 근거로 한다. 파이프라인은 이벤트 기반
// (setInterval 금지)이므로, 위치 이벤트가 오는 "그 순간"의 최신 자세를 알아야 한다. 그래서
// 세션 동안 DeviceMotion(중력 포함 가속도) 또는 Accelerometer 를 구독해 최신 pitch 를 모듈
// 스코프에 계속 갱신해 두고, processLocationSample 이 그 값을 읽어 classifyPostureInterval 로
// 이 구간을 use/no-use 로 이분한다.
//
// [iOS 백그라운드 연속성 한계 · 온디바이스 검증 항목] UIBackgroundModes:location 으로 프로세스가
// 살아있는 동안 모션 센서를 읽을 수 있지만, iOS 는 백그라운드에서 프로세스를 언제든 종료할 수
// 있고 백그라운드 모션 연속성을 코드로 보장하지 못한다. 프로세스가 잠들거나 종료되면 자세
// 샘플이 오지 않고, 그 공백은 아래 staleness 판정으로 no-use 로 귀속된다(감점 뻥튀기 없음).
// 이 동작은 실기기에서 검증해야 하는 항목이다(샌드박스 실행 불가).

// 자세 샘플 신선도 임계(ms). 마지막 자세 샘플이 이보다 오래되면 "센서 공백"으로 보아 no-use.
// posture-lab 의 UPDATE_INTERVAL_MS(200ms)보다 넉넉히 크게 잡아, 정상 스트리밍은 신선으로,
// 프로세스 잠듦/종료로 인한 실제 공백만 stale 로 판정한다. 설계값(튜닝 가능).
const POSTURE_SAMPLE_STALE_MS = 5000;

// 자세 센서 업데이트 간격(ms). posture-lab 화면과 동일한 200ms.
const POSTURE_UPDATE_INTERVAL_MS = 200;

// 최신 자세 샘플(pitch 도 + 관측 시각 ms). 아직 없으면 null(=> no-use).
let latestPitchSample: { pitchDeg: number; atMs: number } | null = null;

// [하위호환] pitch>=10 3초 지속의 순수 상태머신은 postureUsageDetector.ts 에 남아 있고
// (classifyPostureInterval/isSustainedUse/PostureUsageState), verify-posture-usage 가 계속
// 검증한다. 다만 backgroundTask 의 사용 귀속 주 경로는 아래 postureContinuityState(200ms 자이로
// 스트림 추적)로 이동했다. 5초 위치 이벤트 순간의 pitch 한 점으로 지속을 갱신하던 방식이 결함의
// 원인이었기 때문이다(스냅샷 하나가 pitch<10 로 튀면 지속이 끊겨 '사용'이 거의 안 잡힘).

// ── FEAT-001: 고빈도(약 200ms) 자이로 스트림 기반 지속 추적 상태 ──────────────
// 핵심 결함 수정. 기존에는 5초 위치 이벤트가 오는 순간의 pitch 한 점으로만 지속을 갱신해,
// 5초 스냅샷 중 하나라도 pitch<10 이면 지속이 끊겨 '사용'이 거의 안 잡혔다. 이제 자이로 콜백
// (약 200ms)마다 stepPostureContinuity 로 "pitch>=10 연속 유지 시간"을 자체 추적하고,
// processLocationSample 은 그 결과(현재 isUse)를 읽어 elapsedMinutes 를 use/no-use 로 귀속한다.
let postureContinuityState: PostureContinuityState = createInitialPostureContinuityState();

// 자이로 콜백이 참조할 최신 보행 판정 신호. 위치 이벤트(processLocationSample, 호출부가
// decideSampleWalking 으로 계산해 넘긴 walking 값)에서 갱신한다. atMs 로 신선도를 판단해,
// 위치 신호가 아직 없거나 오래되면
// 보수적으로 walking=false 로 간주(=> 지속 시작 못 함 => no-use)해 감점 뻥튀기를 막는다.
//
// [의도된 트레이드오프 · 부트스트랩 사각지대 · 정직성 규칙] latestWalking 은 오직 위치 이벤트에서만
// 세팅되므로, 세션 시작 직후 첫 위치 이벤트가 도착하기 전(자이로만 흐르는 몇 초)과 위치 이벤트가
// WALKING_SIGNAL_STALE_MS(8초)를 넘겨 멈춘 구간에서는 walking=false 로 보여, 그 동안은 지속(sustain)
// 런을 시작할 수 없다. 이는 '의도된 fail-closed 설계'다: 신선한 보행 신호 없이는 절대 '사용'으로
// 감점하지 않는다(프로젝트 정직성 규칙 = 관측/확정되지 않은 시간은 감점하지 않는다, 센서/신호 공백
// => no-use). 결코 사용을 부풀리지 않고 오직 과소 계상 방향으로만 치우친다. 그래서 여기서 보행
// 신호를 startPostureSensors 시점에 미리 seed 하는 등으로 느슨하게 만들지 않는다(신선한 보행 신호
// 없이 사용을 셀 수 있게 되면 정직성 규칙 위반). 이 한계는 docs/PROJECT_HANDOFF.md 정직성 한계에도
// 명시되어 있으며, 실기기 온디바이스 검증 항목이다.
let latestWalking: { walking: boolean; atMs: number } | null = null;

// 진단용: 마지막 위치 샘플의 이동 모드(walking/idle/vehicle)와 관측 시각. 아직 없으면 null.
// decideSampleWalking 이 갱신하고, readPostureDiagnostics 가 walkingReason 문구에
// idle(정지)/vehicle(차량)/walking 을 구분해 표시하는 데만 쓰인다(감점 로직에는 관여 안 함).
let latestMotionMode: { mode: 'walking' | 'vehicle' | 'idle'; atMs: number } | null = null;

// 최신 자이로 지속 추적 결과(진단/귀속용). isUse 는 "지금 pitch>=10 이 3초 이상 연속 유지 중"인가.
let latestPostureContinuity: { isUse: boolean; sustainedMs: number; atMs: number } | null = null;

// latestWalking 신선도 임계(ms). 위치 이벤트 간격(timeInterval:5000)과 stale 판정
// (POSTURE_SAMPLE_STALE_MS)에 맞춰, 최근 위치 이벤트가 이 시간 내일 때만 그 walking 값을 신뢰한다.
// 그보다 오래되면 보수적으로 walking=false 로 간주한다(위치 신호 공백 = 사용 인정 안 함).
const WALKING_SIGNAL_STALE_MS = 8000;

// 자세 센서 구독 핸들(세션 동안 유지, 종료 시 해제).
let postureMotionSub: { remove: () => void } | null = null;
let postureAccelSub: { remove: () => void } | null = null;
let postureUsingAccel = false;

// 세션 시작 시 호출: DeviceMotion(중력 포함 가속도)을 우선 구독하고, 중력 성분이 없으면
// Accelerometer 로 폴백한다(posture-lab.tsx 와 동일한 패턴). 최신 pitch 를 모듈 스코프에 갱신한다.
// 이미 구독 중이면 중복 구독하지 않는다. RN 런타임 전용(샌드박스 실행 불가).
export function startPostureSensors(): void {
  if (postureMotionSub !== null || postureAccelSub !== null) return;

  const applyGravity = (x: number, y: number, z: number): void => {
    const pr = gravityToPitchRoll({ x, y, z });
    const nowMs = Date.now();
    latestPitchSample = { pitchDeg: pr.pitchDeg, atMs: nowMs };

    // FEAT-001: 이 고빈도 자이로 샘플(약 200ms)로 pitch>=10 연속 유지 시간을 자체 추적한다.
    // 보행 신호는 위치 이벤트에서 갱신되는 latestWalking 을 참조하되, 신선(WALKING_SIGNAL_STALE_MS
    // 이내)할 때만 그 walking 값을 신뢰한다. 위치 신호가 아직 없거나 오래되면 보수적으로
    // walking=false 로 간주해 지속을 시작하지 않는다(=> no-use, 감점 뻥튀기 방지).
    const walkingFresh =
      latestWalking !== null &&
      Number.isFinite(latestWalking.atMs) &&
      nowMs - latestWalking.atMs <= WALKING_SIGNAL_STALE_MS;
    const walking = walkingFresh ? latestWalking.walking : false;

    const step = stepPostureContinuity(postureContinuityState, {
      pitchDeg: pr.pitchDeg,
      walking,
      nowMs,
    });
    postureContinuityState = step.next;
    latestPostureContinuity = { isUse: step.isUse, sustainedMs: step.sustainedMs, atMs: nowMs };
  };

  const startAccel = (): void => {
    if (postureUsingAccel) return;
    postureUsingAccel = true;
    Accelerometer.setUpdateInterval(POSTURE_UPDATE_INTERVAL_MS);
    postureAccelSub = Accelerometer.addListener(({ x, y, z }) => {
      // Accelerometer 는 정지 시 중력을 g 단위로 x/y/z 에 담는다.
      applyGravity(x, y, z);
    });
  };

  try {
    DeviceMotion.setUpdateInterval(POSTURE_UPDATE_INTERVAL_MS);
    postureMotionSub = DeviceMotion.addListener((data) => {
      const gravity = data?.accelerationIncludingGravity;
      if (
        gravity &&
        typeof gravity.x === 'number' &&
        typeof gravity.y === 'number' &&
        typeof gravity.z === 'number'
      ) {
        applyGravity(gravity.x, gravity.y, gravity.z);
      } else if (!postureUsingAccel) {
        // DeviceMotion 이 중력 성분을 주지 못하면 Accelerometer 로 폴백.
        startAccel();
      }
    });
  } catch {
    // DeviceMotion 미지원/실패 -> Accelerometer 폴백 시도(그것도 실패하면 자세 샘플 없음 => no-use).
    try {
      startAccel();
    } catch {
      // 센서 전혀 불가: latestPitchSample 은 null 로 남아 모든 구간이 no-use(정직/보수적).
    }
  }
}

// 세션 종료 시 호출: 자세 센서 구독을 해제하고 상태를 리셋한다.
export function stopPostureSensors(): void {
  try {
    postureMotionSub?.remove();
  } catch {
    // 무시(해제 실패가 종료 흐름을 깨지 않도록).
  }
  try {
    postureAccelSub?.remove();
  } catch {
    // 무시.
  }
  postureMotionSub = null;
  postureAccelSub = null;
  postureUsingAccel = false;
  latestPitchSample = null;
  postureContinuityState = createInitialPostureContinuityState();
  latestPostureContinuity = null;
  latestWalking = null;
  latestMotionMode = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 한 개의 위치 샘플을 세션 파이프라인에 통과시키는 공용 처리기.
// 지오펜스 ENTER 콜백과 백그라운드 위치 업데이트 태스크가 공유한다(이벤트 기반).
// ─────────────────────────────────────────────────────────────────────────────
export async function processLocationSample(
  latitude: number,
  longitude: number,
  elapsedMinutes: number,
  now: Date = new Date(),
  // 이 구간이 "확정된 보행" 구간인지. 차량 구간은 상위(decideLocationWalking)에서 이미 스킵되고,
  // 정지(idle)/속도결측 구간은 walking=false 로 넘어온다. 자세 기반 '사용' 감점은 walking=true
  // 일 때만 인정한다(정지/차량 중 화면 보기는 사용으로 감점하지 않는다). 호출부가 보행 신호를
  // 명시적으로 계산해서 넘긴다. 안전 기본값은 false(정직성: 확정되지 않은 보행은 감점하지 않음).
  walking: boolean = false
): Promise<void> {
  const session = await loadActiveSession();
  // 추적 중이 아니면(사용자가 stop 했거나 미시작) 아무 것도 하지 않는다.
  if (!session.isTracking) return;

  // 1) 현재 위치를 감싸는 위험구역 -> riskIntensity + 대표 zoneId.
  const zones: AccidentZone[] = loadAccidentZones();
  const enclosing = findEnclosingZones(zones, latitude, longitude);
  const riskIntensity =
    enclosing.length > 0
      ? computeRiskIntensity(enclosing.map((z) => z.accidentCount3y))
      : 0;
  // 대표 zoneId: 가장 사고건수가 많은 구역(없으면 빈 문자열 -> 세그먼트 키 안정).
  let zoneId = '';
  let zoneName = '';
  if (enclosing.length > 0) {
    let rep = enclosing[0];
    for (const z of enclosing) if (z.accidentCount3y > rep.accidentCount3y) rep = z;
    zoneId = rep.id;
    zoneName = rep.name;
  }

  // 1-b) 밀집 구간 진입 알림(FEAT-003) - 위 고위험/60점미만 알림과는 '별개의 트리거/문구'다.
  // presentHighRiskAlert(고위험 zone + 휴대폰 사용)/presentCriticalScoreAlert(점수 60점 미만)의
  // 조건/문구는 아래에서 그대로 유지하며, 여기서는 점수/사용과 무관하게 "위험구역이 꽤 밀집된
  // 구간에 처음 진입"했을 때만 한 번 간단히 안내한다(사용자 아이디어: '사고 다발 구간이에요!').
  // 순수 판정(computeDenseClusterAt/decideDenseClusterAlert)으로 클러스터를 식별하고, 같은
  // 클러스터에 머무는 동안 재발송하지 않는다. 클러스터를 벗어나면 lastDenseClusterId 를 리셋해
  // 재진입/다른 클러스터 진입 시 다시 알린다. 과다발송 방지 쿨다운 가드를 추가로 둔다.
  // 발송 판정은 순수 함수(decideDenseClusterAlert)로 위임한다. 이 함수는 '처음 한 번만' 규칙과
  // 쿨다운 준비 여부를 합쳐 (a) 지금 발송할지(fire)와 (b) 저장할 다음 lastDenseClusterId 를
  // 결정한다. 핵심: 쿨다운이 막을 때는 lastDenseClusterId 를 '전진시키지 않아야' 쿨다운이 끝난
  // 뒤의 샘플이 여전히 새 클러스터로 인식되어 알림이 나간다(예전 인라인 로직의 결함 수정).
  // 여기서는 isDenseAlertCooldownReady(발송 시각을 바꾸지 않는 순수 조회)로 준비 여부만 읽고,
  // 실제로 발송할 때(fire=true)만 markDenseZoneAlertSent 로 발송 시각을 커밋한다.
  const denseResult = computeDenseClusterAt(zones, latitude, longitude);
  const denseDecision = decideDenseClusterAlert(
    lastDenseClusterId,
    denseResult.clusterId,
    denseResult.isDense,
    isDenseAlertCooldownReady(now.getTime())
  );
  lastDenseClusterId = denseDecision.nextLastClusterId;
  if (denseDecision.fire) {
    markDenseZoneAlertSent(now.getTime());
    await presentDenseZoneEntryAlert();
  }

  // 2) 날씨(TTL 캐시). 실제 GPS 위경도를 KMA 격자로 변환해 조회하므로 전국 어디서나 정확하다.
  //    (변환 불가 시에만 안전 폴백 격자 사용.) 3) 오디오 환경(best-effort, 딥 백그라운드에서 stale 가능).
  const grid = gridForLocation(latitude, longitude);
  const weather = await getCachedWeather({ nx: grid.nx, ny: grid.ny, now });
  const audioEnv = readAudioEnvironmentSnapshot();
  const isEarOccluded = isEarEffectivelyOccluded(audioEnv);
  const timeBand = getCurrentTimeBand(now);

  // 스마트폰 사용 시간(자세 기반 판정). 예전에는 경과 보행시간 전체를 곧바로
  // smartphoneUseMinutes 로 취급했고(주머니에 넣고 걸어도 전 구간 감점되던 근본 오류), 그 뒤
  // Option A 에서는 인앱 터치만 confirmedUse 로 인정하고 나머지를 unknownUse 로 두었다.
  // 그 다음 사용 판정의 소스를 "자세(보행 중 화면 보기)"로 옮겼는데, 지속 추적을 5초 위치
  // 이벤트 순간의 pitch 한 점으로만 갱신해 5초 스냅샷 중 하나라도 pitch<10 로 튀면 지속이 끊겨
  // '사용'이 거의 안 잡히는 결함이 있었다(사용자 증상: 점수 안 떨어짐).
  //
  // [FEAT-001] 이제 지속 추적을 200ms 자이로 콜백(startPostureSensors 의 applyGravity)에서 매
  // 샘플마다 stepPostureContinuity 로 수행하고, 여기서는 그 결과(현재 isUse)를 읽어 이 구간의
  // 경과분을 use/no-use 로 귀속한다. 임계는 그대로다: walking=true 이며 pitch>=10deg 를 3초 이상
  // 연속 유지(postureUsageDetector 의 실측 기반 설계값)일 때만 사용.
  //
  // [센서 공백 => no-use] 최신 자이로 샘플/지속 추적 결과가 없거나(구독 직후) 신선하지 않으면
  // 보수적으로 no-use 로 귀속한다("모르면 사용으로 감점하지 않는다", 사용자 결정 '가').
  //
  // [정직성 · 확정 인앱 터치 OR-in] 자세 신호와 별개로, 확인 창 안의 실제 인앱 터치가 있었던
  // 구간은 (걷는 중이라면) "확실한 사용"이므로 use 로 함께 인정한다(설계 선택). 이는 자세를
  // 놓치더라도 명백한 사용을 반영하기 위한 보수적 OR 이며, 포그라운드 인앱 상호작용만 관측
  // 가능하다는 한계는 그대로다(interactionTracker 주석 참고).
  //
  // [iOS 백그라운드 연속성 한계 · 온디바이스 검증 항목] UIBackgroundModes:location 로 프로세스가
  // 살아있는 동안 DeviceMotion/Accelerometer 를 읽지만, iOS 는 백그라운드에서 프로세스를 언제든
  // 종료할 수 있고 백그라운드 모션 연속성을 코드로 보장할 수 없다. 종료/중단된 구간은 샘플이
  // 오지 않아 자연히 no-use 로 귀속된다(감점 뻥튀기 없음). 이 한계는 실기기에서 검증할 항목이다.
  const nowMs = now.getTime();

  // FEAT-001: 자이로 콜백(약 200ms)이 참조할 보행 신호를 갱신한다. 여기 도달한 위치 샘플은
  // 상위에서 이미 vehicle 이 걸러졌으므로 호출부가 walking 을 넘긴다(정상 보행 경로는 true).
  latestWalking = { walking, atMs: nowMs };

  // 사용 귀속의 주 경로(핵심 결함 수정): 위치 이벤트 순간의 pitch 한 점(5초 스냅샷)으로
  // classifyPostureInterval 을 돌리던 방식 대신, 자이로가 200ms 스트림에서 계속 추적해 온
  // "현재 사용 지속 상태(isUse: pitch>=10 이 3초 이상 연속 유지 중)"를 읽어 이 구간의
  // elapsedMinutes 를 use/no-use 로 귀속한다. 그래야 5초 스냅샷 중 하나가 pitch<10 로 튀어도
  // 자이로 스트림이 본 실제 지속이 반영된다.
  //
  // [센서 공백 => no-use / 정직성] 최신 자이로 샘플(latestPitchSample.atMs)이 신선
  // (POSTURE_SAMPLE_STALE_MS 이내)할 때만 자이로 기반 사용을 인정한다. 자이로 공백(구독 직후/
  // 프로세스 잠듦으로 stale/None)은 no-use 로 귀속한다("모르면 사용으로 감점하지 않는다").
  const posture = latestPitchSample;
  const postureFresh =
    posture !== null && Number.isFinite(posture.atMs) && nowMs - posture.atMs <= POSTURE_SAMPLE_STALE_MS;
  const continuity = latestPostureContinuity;
  const continuityFresh =
    continuity !== null &&
    Number.isFinite(continuity.atMs) &&
    nowMs - continuity.atMs <= POSTURE_SAMPLE_STALE_MS;
  // 걷는 중이고 자이로 샘플/지속 추적이 모두 신선하며 현재 isUse 이면 이 구간을 사용으로 귀속.
  const postureIsUse = walking && postureFresh && continuityFresh && continuity.isUse;

  const minutes = Number.isFinite(elapsedMinutes) && elapsedMinutes > 0 ? elapsedMinutes : 0;
  // 확정 인앱 터치 OR-in: 걷는 중 최근 인앱 상호작용이 있었으면 그 구간도 use 로 인정한다.
  const touchUse = walking && hadRecentInteraction(nowMs);
  const useMinutes = touchUse || postureIsUse ? minutes : 0;
  const noUseMinutes = minutes - useMinutes;
  // walkMinutes 는 이제 "확정 보행 시간"만 담는다: walking=true 인 구간의 경과분만 계상하고,
  // 정지(idle)/차량/센서공백 구간은 0 으로 둔다(정직성: 관측/확정되지 않은 보행은 분모에 넣지
  // 않는다). 이 값이 usageRatio 의 분모이자 하루 대표 점수 가중평균의 가중치가 된다. 세그먼트
  // 자체는 idle 구간에서도 계속 생성해(zone/위험/밀집알림 로직 유지) walkMinutes 만 0 으로 기여한다.
  const walkMinutesForSample = walking ? minutes : 0;

  const sample: WalkContextSample = {
    zoneId,
    riskIntensity,
    weather,
    isEarOccluded,
    // 레거시 소비자/reduce 누적 호환을 위해 smartphoneUseMinutes 는 감지된 사용분을 미러링한다.
    smartphoneUseMinutes: useMinutes,
    // walkMinutes = 확정 보행 시간(분)만. idle/차량/센서공백은 usageRatio 분모에서 제외된다.
    walkMinutes: walkMinutesForSample,
    timeBand,
    // 자세 기반 이분화: confirmedUse=감지된 사용, noUse=그 외. estimated/unknown 은 은퇴(0).
    confirmedUseMinutes: useMinutes,
    estimatedUseMinutes: 0,
    unknownUseMinutes: 0,
    noUseMinutes,
  };

  // 4) 순수 리듀서로 누적 -> 지속.
  const nextState = reduceSession(session, sample, { timeBand, isEarOccluded });
  const nextSession: ActiveSession = {
    segments: nextState.segments,
    currentKey: nextState.currentKey,
    startedAt: session.startedAt,
    isTracking: session.isTracking,
  };
  await saveActiveSession(nextSession);

  // 5) WSS 재계산 후 알림 조건 평가.
  const wss = computeWSS(nextSession.segments);
  if (wss.enteredHighRiskZoneWhileUsingPhone || wss.belowCriticalThreshold) {
    await presentHighRiskAlert(zoneName || '위험 구간');
  }
  // 점수 자체가 위험 구간(60점 미만)으로 떨어지면 추가 위험 알림을 보낸다.
  // 세션당 과다발송을 막기 위해 쿨다운 가드를 둔다(구역 진입 경고와 별개 채널의 문구).
  if (wss.belowCriticalThreshold && shouldSendCriticalScoreAlert(now.getTime())) {
    await presentCriticalScoreAlert();
  }
}

// ── FEAT-003: 밀집 구간 진입 알림 상태(모듈 스코프) ──────────────────────────
// 마지막으로 밀집 진입 알림을 보낸 클러스터의 결정적 id. '처음 한 번만' 규칙의 근거다:
// 현재 클러스터가 이 값과 다를 때만(그리고 밀집일 때만) 발송한다. 같은 클러스터에 머무는
// 동안은 재발송하지 않고, 클러스터 밖으로 나가면 null 로 리셋해 재진입/다른 클러스터에서
// 다시 알린다(processLocationSample 의 밀집 분기 참고). 세션 종료 시 resetSessionTaskState 에서
// 리셋되어, 다음 세션에서 첫 진입을 다시 알릴 수 있다.
let lastDenseClusterId: string | null = null;

// 밀집 진입 알림의 세션 내 쿨다운(밀리초). '처음 한 번만'은 클러스터 id 비교로 이미 보장되지만,
// 클러스터를 짧게 들락날락하는 등의 경계에서 알림이 도배되지 않도록 시간 가드를 추가로 둔다
// (shouldSendCriticalScoreAlert 와 동일 패턴). 설계값(튜닝 가능).
const DENSE_ZONE_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
let lastDenseZoneAlertAt: number | null = null;

// 쿨다운이 지나 지금 발송해도 되는지 '조회만' 한다(발송 시각을 바꾸지 않는 순수 조회). 실제
// 발송 여부는 decideDenseClusterAlert 가 클러스터 규칙과 이 값을 합쳐 결정하며, 발송이 확정된
// 경우에만 markDenseZoneAlertSent 로 발송 시각을 커밋한다. 조회와 커밋을 분리한 이유: 새
// 클러스터라도 쿨다운이 막으면 발송하지 않고 lastDenseClusterId 도 전진시키지 않아야 하는데,
// 예전처럼 조회하면서 발송 시각을 갱신해 버리면 쿨다운 창이 계속 밀려 재발송이 지연된다.
function isDenseAlertCooldownReady(nowMs: number): boolean {
  if (lastDenseZoneAlertAt !== null && nowMs - lastDenseZoneAlertAt < DENSE_ZONE_ALERT_COOLDOWN_MS) {
    return false;
  }
  return true;
}

// 밀집 진입 알림을 실제로 발송했음을 기록한다(발송 시각 커밋). 이후 쿨다운 창이 여기서부터 흐른다.
function markDenseZoneAlertSent(nowMs: number): void {
  lastDenseZoneAlertAt = nowMs;
}

// 60점 미만 추가 위험 알림의 세션 내 쿨다운(밀리초). 이벤트 트리거가 잦은 구역에서
// 알림이 도배되지 않도록, 마지막 발송 이후 이 시간이 지나야 다시 보낸다.
const CRITICAL_SCORE_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
let lastCriticalScoreAlertAt: number | null = null;

// 마지막 발송 이후 쿨다운이 지났으면 true 를 반환하고 발송 시각을 갱신한다.
function shouldSendCriticalScoreAlert(nowMs: number): boolean {
  if (lastCriticalScoreAlertAt !== null && nowMs - lastCriticalScoreAlertAt < CRITICAL_SCORE_ALERT_COOLDOWN_MS) {
    return false;
  }
  lastCriticalScoreAlertAt = nowMs;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 백그라운드 연속 위치 업데이트 태스크.
// 세션 시작 시 startSessionLocationUpdates() 가 실제로
// Location.startLocationUpdatesAsync(SESSION_LOCATION_TASK_NAME, ...) 를 호출해 시작하고,
// 종료 시 stopSessionLocationUpdates() 가 중지한다(위 헬퍼 참고). 이 연속 업데이트가
// 세션 동안 프로세스를 살려둬 자이로 리스너(자세 평가)가 위험구역 안팎 무관하게 지속된다.
// 마지막 처리 시각을 프로세스 메모리(lastProcessedAt)에 두고, 그 사이 경과분을 elapsedMinutes
// 로 넘긴다. 지오펜스 콜백도 같은 lastProcessedAt 을 공유해 이중계산을 방어한다.
// ─────────────────────────────────────────────────────────────────────────────
let lastProcessedAt: number | null = null;

// 차량 탑승 오인 방지 + 정지(idle) 무감점: 백그라운드 위치 샘플의 속도(coords.speed)를 순수
// 분류기(decideLocationWalking)로 walking/idle/vehicle 로 분류한다. Pedometer 걸음은 백그라운드
// 위치 태스크에 없으므로 속도만으로 분류한다(도보 속도 + 고속 쿨다운 + 속도결측 히스테리시스).
let motionState: MotionState = createInitialMotionState();

// 위치 샘플의 보행 결정(스킵 여부 + walking 신호)을 계산하고 분류기 상태를 갱신한다.
// - vehicle => skipAsVehicle=true (세그먼트 미누적, 기존 동작 유지)
// - idle(정지/신호대기) => skipAsVehicle=false, walking=false (감점 안 함, 경과분은 no-use)
// - walking(확정 보행) => skipAsVehicle=false, walking=true (자세 기반 사용 감점 후보)
// 속도 결측 시의 정직성 규칙/히스테리시스는 decideLocationWalking 주석 참고.
function decideSampleWalking(
  sample: Location.LocationObject,
  nowMs: number
): { skipAsVehicle: boolean; walking: boolean } {
  const decision = decideLocationWalking(motionState, sample.coords.speed, nowMs);
  motionState = decision.next;
  // 진단 패널이 walking/idle/vehicle 구분을 사람이 읽을 수 있게 표시하도록 최신 모드를 기록한다.
  // 속도 결측 시 decideLocationWalking 은 mode 를 직전 값으로 유지하므로 그대로 반영된다.
  latestMotionMode = { mode: decision.mode, atMs: nowMs };
  return { skipAsVehicle: decision.skipAsVehicle, walking: decision.walking };
}

// ─────────────────────────────────────────────────────────────────────────────
// 세션 동안 "연속 백그라운드 위치 업데이트" 시작/중지 (핵심 결함 수정)
//
// 왜 필요한가: 자세 기반 사용 감지(processLocationSample -> classifyPostureInterval ->
// confirmedUseMinutes -> computeWSS 감점)는 "위치 이벤트가 올 때"의 최신 자이로 자세를 읽어
// 구동된다. 그런데 지오펜스(region ENTER)/정밀추적은 "위험구역 안"에서만 위치 이벤트를
// 만든다. 위험구역 밖에서 폰을 보며 걸으면 위치 이벤트가 드물어 iOS 가 프로세스를 재우고,
// DeviceMotion/Accelerometer 콜백까지 멈춰 자세 평가·감점이 중단될 수 있다(사용자 지적 결함).
//
// 해결: 세션 내내 Location.startLocationUpdatesAsync 로 "연속 위치 업데이트"를 실제로 시작해
// 프로세스를 세션 동안 살려둔다. 그러면 자이로 리스너가 계속 콜백을 받아 자세 평가·감점이
// 위험구역 안팎 무관하게 지속된다. 이 태스크가 오는 위치 샘플도 지오펜스 콜백과 같은
// lastProcessedAt 을 공유하므로 elapsedMinutes 이중계산이 방어된다(둘 다 있어도 무해).
//
// [권한] 연속 백그라운드 업데이트는 iOS Always 권한이 이상적이다. Always 가 없으면(WhenInUse
// 뿐이면) 포그라운드에 한정되어 동작한다(화면 켜짐/앱 전면일 때만 연속). start()는 이미
// requestBackgroundPermissionsAsync 를 best-effort 로 호출한다. 여기서는 시작 실패(Expo Go/
// 미지원/권한없음)를 조용히 삼켜 세션 시작을 깨지 않는다.
//
// [정직한 한계] iOS 는 배터리/메모리 압박 등 극단 상황에서 프로세스를 언제든 종료할 수 있고,
// 사용자가 앱을 스와이프로 강제 종료하면 업데이트가 멈춘다(정상). 연속 위치 업데이트는
// 프로세스 생존 가능성을 크게 높이는 수단이지 OS 수준의 절대 보장이 아니다. 이 메커니즘/한계와
// 온디바이스 검증 항목은 docs/PROJECT_HANDOFF.md 에 정직하게 남긴다.

// 세션 동안 프로세스를 살려두기 위한 연속 위치 업데이트를 시작한다. RN 런타임 전용.
// 실패(Expo Go/미지원/권한없음)는 조용히 no-op 한다(세션 시작을 깨지 않음). 이미 실행 중이면
// 중복 시작하지 않는다. 지오펜스 경로는 보조로 그대로 유지한다(둘 다 있어도 무해).
export async function startSessionLocationUpdates(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(SESSION_LOCATION_TASK_NAME);
    if (running) return;
    await Location.startLocationUpdatesAsync(SESSION_LOCATION_TASK_NAME, {
      // 자이로가 주기적으로 평가되도록 위치 이벤트가 충분히 오게 하되, 상시 최고정밀은
      // 피해 배터리 소모를 억제한다(구역 안 정밀추적은 지오펜스가 별도 상향).
      accuracy: Location.Accuracy.Balanced,
      // distanceInterval=0 + timeInterval 로 정지 중에도 시간 기반으로 이벤트가 오게 한다
      // (걷다 멈춰 폰을 봐도 자세가 계속 평가되도록). 값은 배터리/연속성 균형의 설계값.
      distanceInterval: 0,
      timeInterval: 5000,
      // iOS: 백그라운드에서 프로세스를 재우지 않도록 자동 일시정지를 끈다(연속성 핵심).
      pausesUpdatesAutomatically: false,
      // iOS: 백그라운드 위치 사용 중임을 파란 인디케이터로 정직하게 노출한다.
      showsBackgroundLocationIndicator: true,
      // iOS: 활동 유형을 보행(fitness)으로 명시해 OS 최적화 힌트를 준다.
      activityType: Location.ActivityType.Fitness,
      // Android: 포그라운드 서비스 안내 문구(백그라운드 위치 필수 요건).
      foregroundService: {
        notificationTitle: '보행 측정 중',
        notificationBody: '안전 점수를 위해 위치와 자세를 측정하고 있어요.',
      },
    });
  } catch {
    // Expo Go/미지원/권한없음 -> 안전 no-op. 지오펜스+포그라운드 센서로 부분 동작.
  }
}

// 세션 종료 시 연속 위치 업데이트를 반드시 중지한다(배터리/프라이버시). RN 런타임 전용.
// 실행 중일 때만 중지하며, 실패는 조용히 삼켜 종료 흐름을 깨지 않는다.
export async function stopSessionLocationUpdates(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(SESSION_LOCATION_TASK_NAME);
    if (running) {
      await Location.stopLocationUpdatesAsync(SESSION_LOCATION_TASK_NAME);
    }
  } catch {
    // 미지원/미실행 -> 무시.
  }
}

TaskManager.defineTask(SESSION_LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const payload = data as { locations?: Location.LocationObject[] } | undefined;
  const locations = payload?.locations ?? [];
  if (locations.length === 0) return;

  const latest = locations[locations.length - 1];
  const nowMs = latest.timestamp ?? Date.now();

  // 보행 결정: 차량 구간이면 세그먼트를 쌓지 않고 스킵(경과분 기준점은 유지해 다음 보행 구간
  // 왜곡 방지). 정지(idle)/속도결측은 스킵하지 않고 walking=false 로 넘겨(감점 안 함), 위치/
  // 위험구역/밀집알림 로직은 계속 동작하되 그 구간은 no-use 로 귀속된다.
  const decision = decideSampleWalking(latest, nowMs);
  if (decision.skipAsVehicle) {
    lastProcessedAt = nowMs;
    return;
  }

  const elapsedMinutes = lastProcessedAt ? Math.max(0, (nowMs - lastProcessedAt) / 60000) : 0;
  lastProcessedAt = nowMs;

  // 확정 보행일 때만 walking=true. 정지(idle)/속도결측은 walking=false 로 넘어가 자세 기반
  // '사용' 감점 후보에서 제외된다(정지/신호대기 중 화면 보기는 감점하지 않는다).
  await processLocationSample(
    latest.coords.latitude,
    latest.coords.longitude,
    elapsedMinutes,
    new Date(nowMs),
    decision.walking
  );
});

// 지오펜스 컨트롤러(FEAT-003)의 콜백에 연결하는 어댑터.
// registerNearbyGeofences(zones, center, makeGeofenceSessionCallbacks()) 형태로 넘긴다.
// onEnterZone/onPreciseSample 모두 이벤트 기반이며 setInterval 을 쓰지 않는다.
export function makeGeofenceSessionCallbacks(): {
  onEnterZone: (zone: AccidentZone, sample: Location.LocationObject) => void;
  onPreciseSample: (sample: Location.LocationObject) => void;
  onExitAllZones: () => void;
} {
  const handle = (sample: Location.LocationObject): void => {
    const nowMs = sample.timestamp ?? Date.now();
    // 보행 결정: 차량이면 스킵(기준점만 갱신). 정지(idle)/속도결측은 스킵하지 않고 walking=false.
    const decision = decideSampleWalking(sample, nowMs);
    if (decision.skipAsVehicle) {
      lastProcessedAt = nowMs;
      return;
    }
    const elapsedMinutes = lastProcessedAt ? Math.max(0, (nowMs - lastProcessedAt) / 60000) : 0;
    lastProcessedAt = nowMs;
    // 확정 보행일 때만 walking=true(자세 '사용'은 확정 보행 중에만 인정). idle/속도결측은 false.
    void processLocationSample(
      sample.coords.latitude,
      sample.coords.longitude,
      elapsedMinutes,
      new Date(nowMs),
      decision.walking
    );
  };
  return {
    onEnterZone: (_zone, sample) => handle(sample),
    onPreciseSample: (sample) => handle(sample),
    onExitAllZones: () => {
      // 모든 구역 이탈 -> 다음 처리 경과분 기준점을 리셋(구역 밖은 riskIntensity 0).
      lastProcessedAt = null;
    },
  };
}

// 백그라운드 처리기 상태를 리셋한다(세션 종료 시 호출).
// 자세 지속 상태/최신 샘플도 함께 리셋한다(세션 간 자세 증거가 새지 않도록). 센서 구독 자체의
// 해제는 stopPostureSensors 가 담당한다(useWalkSession.stop 에서 호출).
export function resetSessionTaskState(): void {
  lastProcessedAt = null;
  motionState = createInitialMotionState();
  lastCriticalScoreAlertAt = null;
  // FEAT-003: 밀집 진입 알림 상태도 리셋(다음 세션에서 첫 진입을 다시 알릴 수 있게).
  lastDenseClusterId = null;
  lastDenseZoneAlertAt = null;
  latestPitchSample = null;
  postureContinuityState = createInitialPostureContinuityState();
  latestPostureContinuity = null;
  latestWalking = null;
  latestMotionMode = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FEAT-002: 실시간 진단(읽기 전용) 스냅샷.
//
// 목적: 사용자가 실기기에서 "왜 점수가 안 떨어지는가"의 원인을 파이프라인 단계별로 눈으로
// 확인할 수 있게, 이 모듈이 세션 동안 갱신하는 모듈 스코프 상태(latestPitchSample,
// postureContinuityState/latestPostureContinuity, latestWalking, lastProcessedAt)를
// 파생/신선도와 함께 한 번에 읽어 주는 getter 다.
//
// [캡슐화] 내부 mutable 상태(let 변수)는 절대 export 하지 않는다. 이 getter 만 얕은 스냅샷을
// 계산해 반환하며, 반환값을 바꿔도 내부 상태에 영향이 없다(순수 읽기). 진단 화면은 이 값을
// 표시만 하고 어떤 상태/점수/세그먼트/업로드도 변경하지 않는다(서버 전송 없음).
//
// [신선도 규칙] 사용(isUse) 귀속과 동일한 게이팅을 그대로 재현한다: walking 신선
// (WALKING_SIGNAL_STALE_MS 이내) AND 자이로 샘플 신선(POSTURE_SAMPLE_STALE_MS 이내) AND
// 지속 추적 결과 신선(POSTURE_SAMPLE_STALE_MS 이내) AND continuity.isUse. 이렇게 해야
// 진단 패널의 "사용 중" 표시가 processLocationSample 의 실제 감점 귀속과 일치한다.
export interface PostureDiagnostics {
  /** 현재 pitch(도). 자이로 샘플이 아직 없으면 null. */
  currentPitchDeg: number | null;
  /** 마지막 자이로 샘플 경과(ms). 없으면 null(자이로 신선도). */
  pitchSampleAgeMs: number | null;
  /** 자이로 샘플이 신선한지(age <= POSTURE_SAMPLE_STALE_MS). */
  pitchFresh: boolean;
  /** 현재 pitch>=임계가 연속 유지된 시간(ms). 지속 중이 아니면 0. */
  sustainedMs: number;
  /** sustainedMs 를 초로 환산한 값. */
  sustainedSeconds: number;
  /** 이 순간 이 구간이 '사용'으로 귀속되는지(walking+신선+continuity.isUse 모두 충족). */
  isUse: boolean;
  /** pitch 사용 임계(도) = PITCH_USE_THRESHOLD_DEG(불변). */
  thresholdDeg: number;
  /** 지속 임계(ms) = USE_SUSTAIN_MS(불변). */
  sustainMsThreshold: number;
  /** 최신 보행 판정(신선할 때 그 값, 아니면 false). */
  walking: boolean;
  /** walking 판정 근거를 사람이 읽을 수 있는 문구로. */
  walkingReason: string;
  /** 마지막 위치 이벤트 경과(ms). 없으면 null(연속 위치 업데이트 도착 확인). */
  lastLocationEventAgeMs: number | null;
}

// 모듈 스코프 상태를 읽어 진단 스냅샷을 만든다(순수하지 않은 RN 런타임 읽기: Date.now 기본값).
// 내부 상태를 변경하지 않는다. nowMs 를 주입하면 결정적으로 테스트/재현할 수 있다.
export function readPostureDiagnostics(nowMs: number = Date.now()): PostureDiagnostics {
  // 자이로(pitch) 신선도.
  const pitch = latestPitchSample;
  const currentPitchDeg = pitch !== null ? pitch.pitchDeg : null;
  const pitchSampleAgeMs =
    pitch !== null && Number.isFinite(pitch.atMs) ? nowMs - pitch.atMs : null;
  const pitchFresh = pitchSampleAgeMs !== null && pitchSampleAgeMs <= POSTURE_SAMPLE_STALE_MS;

  // 지속 추적 결과(자이로 스트림 기반).
  const continuity = latestPostureContinuity;
  const sustainedMs = continuity !== null ? continuity.sustainedMs : 0;
  const sustainedSeconds = sustainedMs / 1000;
  const continuityFresh =
    continuity !== null &&
    Number.isFinite(continuity.atMs) &&
    nowMs - continuity.atMs <= POSTURE_SAMPLE_STALE_MS;

  // 보행 신호 신선도(processLocationSample 의 게이팅과 동일 규칙).
  const walkingFresh =
    latestWalking !== null &&
    Number.isFinite(latestWalking.atMs) &&
    nowMs - latestWalking.atMs <= WALKING_SIGNAL_STALE_MS;
  const walking = walkingFresh ? latestWalking.walking : false;
  // 최신 이동 모드(walking/idle/vehicle)가 신선하면 그 값으로 비보행 사유를 더 구체적으로 표시.
  const motionModeFresh =
    latestMotionMode !== null &&
    Number.isFinite(latestMotionMode.atMs) &&
    nowMs - latestMotionMode.atMs <= WALKING_SIGNAL_STALE_MS;
  const mode = motionModeFresh ? latestMotionMode.mode : null;
  let walkingReason: string;
  if (latestWalking === null) {
    walkingReason = '위치 신호 없음(보행 미확정)';
  } else if (!walkingFresh) {
    walkingReason = '위치 신호 오래됨(보수적으로 미보행 처리)';
  } else if (latestWalking.walking) {
    walkingReason = 'walking(보행): 위치 속도 기반 보행 감지';
  } else if (mode === 'vehicle') {
    walkingReason = 'vehicle(차량): 차량 탑승 감지 - 감점 안 함';
  } else if (mode === 'idle') {
    walkingReason = 'idle(정지): 정지/신호대기 - 감점 안 함';
  } else {
    // 모드 정보가 아직 없거나(오래됨) 속도 결측 등: 보수적으로 비보행.
    walkingReason = '비보행(정지/차량/속도결측 등) - 감점 안 함';
  }

  // 사용 귀속과 동일 게이팅: 신선한 보행 + 신선한 자이로/지속 + 현재 isUse.
  const isUse =
    walking && pitchFresh && continuityFresh && continuity !== null && continuity.isUse;

  // 마지막 위치 이벤트 경과(연속 위치 업데이트가 실제로 도착하는지).
  const lastLocationEventAgeMs =
    lastProcessedAt !== null && Number.isFinite(lastProcessedAt)
      ? nowMs - lastProcessedAt
      : null;

  return {
    currentPitchDeg,
    pitchSampleAgeMs,
    pitchFresh,
    sustainedMs,
    sustainedSeconds,
    isUse,
    thresholdDeg: PITCH_USE_THRESHOLD_DEG,
    sustainMsThreshold: USE_SUSTAIN_MS,
    walking,
    walkingReason,
    lastLocationEventAgeMs,
  };
}
