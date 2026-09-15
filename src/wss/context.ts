import { TimeBand } from '../types';
export function getCurrentTimeBand(date: Date = new Date()): TimeBand {
  const h = date.getHours();
  if (h >= 7 && h < 9) return 'rush_am';
  if (h >= 18 && h < 20) return 'rush_pm';
  if (h >= 6 && h < 22) return 'normal_day';
  return 'normal_night';
}
