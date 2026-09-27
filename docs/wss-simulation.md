# WSS 감점 스케일(k=4)·임계점(60) 시뮬레이션 근거

이 문서는 WSS(보행 안전 점수)의 **감점 배율 `DEDUCTION_SCALE = 4`** 채택과
**임계점 `WSS_CRITICAL = 60`** 확정의 근거를 기록한다.

> **중요(정직성 고지):** 아래 시뮬레이션은 **인위적**이다. 실제 사고 라벨 데이터가
> 없어, 목표변수 Y 를 WSS 점수 자체에서 생성한 뒤 다시 적합(re-fit)하는 방식으로
> 분포/변곡점을 관찰했다. 따라서 여기서 나온 임계점·등급은 **참고 지표**이며 **실제
> 사고 발생을 예측하지 않는다.** 앱의 disclaimer·미검증 표기는 그대로 유지한다.

## 문제

현재 실증 가중치(전국 교통사고 EPDO 기반 시간대·날씨 + 설계값 위치·이어폰)로
계산하면 WSS 가 **90~98 구간에 몰려** 사용자 간 변별력이 거의 없었다. 대부분
사용자가 "안전"으로 보여 피드백이 무의미해진다.

## 방법 1: 가중치 비율 유지 + 전체 감점만 ×k

가중치의 **비율**(EAR/WEATHER/TIME/LOCATION/OVERLAP)은 실증/설계 근거가 있으므로
건드리지 않는다. 대신 `computeWSS` 의 **전체 감점(totalDeduction)** 에만 배율 `k` 를
곱해 점수 분포를 넓힌다. 스마트폰 사용 패널티(`penalty`)도 스케일 일관성을 위해
동일 배율을 곱한다(파라미터 `USAGE_RATIO_PENALTY_THRESHOLD=0.3`,
`PENALTY_SEVERITY=40` 값 자체는 불변, 결과에만 ×k).

```
rawScore = clamp(100 - k × totalDeduction)          // k = DEDUCTION_SCALE = 4
displayScore = clamp(100 - k × totalDeduction - k × penalty(...))   // usageRatio ≥ 0.3 일 때
```

## k=4 시뮬레이션 결과(오케스트레이터 파이썬 재현)

배율 `k=4` 로 감점을 증폭했을 때 관찰된 분포:

| 지표 | 값(근사) |
| --- | --- |
| 평균(mean) | ~71.2 |
| 중앙값(median) | ~74.2 |
| 하위 10% | ~52 |
| 로지스틱 변곡점(임계 후보) | ~58.4 |

로지스틱 변곡점이 ~58 로 나왔고, 사용자가 이를 **60 으로 반올림·확정**했다.

## 확정값

- `DEDUCTION_SCALE = 4` (src/wss/weights.ts)
- `WSS_CRITICAL = 60` (기존 80.605 에서 변경)
- 60점 미만(`belowCriticalThreshold`)이면: 백그라운드에서 추가 위험 알림
  (`presentCriticalScoreAlert`, 세션 내 쿨다운) + 리포트에서 'danger' 등급 표시.

## 등급(4단계 + 표본부족 폴백)

`src/wss/grade.ts` `classifyGrade(score, {count, mean, q3}, criticalThreshold, minSample)`:

1. `score < 60` → **danger** (통계와 무관한 절대기준 최우선)
2. 표본 `count < 5` 또는 mean/q3 미집계(null) → **insufficient**(측정 중)
3. `score < mean` → **caution**(또래 평균 미만)
4. `score < q3` → **good**(평균 이상, 상위 25% 미만)
5. 그 외 → **excellent**(Q3 이상, 상위 25%)

## 재현 로직 요약

1. 실증/설계 가중치로 각 세그먼트 결합 가중치·감점을 계산.
2. 전체 감점에 `k=4` 를 곱해 `rawScore = 100 - 4 × combined` 로 점수화.
3. 분포에서 평균/중앙/하위10% 및 로지스틱 변곡점을 관찰 → 임계점 후보 산출.
4. 회귀 오라클(`scripts/verify-wss-example.ts`)이 `100 - 4 × combined` 와
   `WSS_CRITICAL === 60` 을 하드코딩 없이 코드에서 재계산해 검증한다.
