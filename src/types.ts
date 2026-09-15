// 보행안전점수(WSS) 앱 - 공통 타입 정의
export type WeatherCondition = 'clear' | 'rain_or_snow' | 'other_not_clear';
export type TimeBand = 'rush_am' | 'rush_pm' | 'normal_day' | 'normal_night';
export interface WalkSegment {
  regionId: string;
  smartphoneUseMinutes: number;
  walkMinutes: number;
  riskIntensity: number;
  weather: WeatherCondition;
  timeBand: TimeBand;
  isEarOccluded: boolean;
}
export interface WeightBreakdown { wLocation: number; wWeather: number; wTime: number; wEar: number; combined: number; }
export interface WSSResult {
  rawScore: number;
  displayScore: number;
  usageRatio: number;
  enteredHighRiskZoneWhileUsingPhone: boolean;
  belowCriticalThreshold: boolean;
  segmentBreakdown: Array<{ regionId: string; weight: WeightBreakdown; contribution: number }>;
}
export interface AccidentZone {
  id: string; name: string; latitude: number; longitude: number;
  radiusMeters: number; accidentCount3y: number;
  source: 'TAAS_STANDARD' | 'SAMPLE_PLACEHOLDER';
}
