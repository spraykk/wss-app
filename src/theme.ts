// 앱 전역 디자인 토큰 (파스텔톤 팔레트 + 간격/라운드/그림자/타이포)
// 순수 상수만 정의한다. RN StyleSheet 에서 참조해 화면 전반의 톤을 통일한다.
// - node: import 금지, 상대 import 확장자 금지, 기능/로직 무관(스타일 토큰 전용).
// - 파스텔이라 대비가 약해지지 않도록 텍스트/상태색은 가독성 우선으로 충분히 진하게 잡는다.

// 파스텔 팔레트 (하늘색 위주 + 핑크/연노랑 포인트)
export const palette = {
  // 배경: 아주 옅은 하늘색 계열로 부드럽고 밝게
  bg: '#F4FAFE', // 화면 기본 배경 (거의 흰색에 가까운 하늘빛)
  surface: '#FFFFFF', // 카드 표면
  surfaceAlt: '#EAF6FD', // 옅은 하늘색 카드/보조 표면

  // 포인트 파스텔
  sky: '#BFE3F5', // 파스텔 스카이블루 (아이콘 배경과 동일 hex)
  skyDeep: '#7FC4E8', // 조금 더 진한 하늘색 (버튼/강조)
  pink: '#FBD5E3', // 파스텔 핑크
  pinkDeep: '#F19BB8', // 진한 핑크 포인트
  yellow: '#FCEFC2', // 연노랑
  yellowDeep: '#F2D479', // 진한 연노랑 포인트

  // 텍스트 (가독성 우선 — 충분히 진하게)
  text: '#1F2D3A', // 기본 텍스트 (진한 슬레이트 네이비)
  textMuted: '#5A6B7B', // 보조 텍스트
  textFaint: '#8A9AA8', // 흐린 텍스트/캡션

  // 상태색 (파스텔 배경 + 진한 전경 텍스트 페어)
  safeBg: '#DFF3E4', // 안전 - 파스텔 민트
  safeText: '#1F7A43', // 안전 - 진한 초록 (가독성)
  cautionBg: '#FCEFC2', // 주의 - 연노랑
  cautionText: '#8A6410', // 주의 - 진한 앰버
  dangerBg: '#FBD9DE', // 위험 - 파스텔 로즈
  dangerText: '#B32B3C', // 위험 - 진한 로즈레드

  // 라인/보더
  border: '#DCE9F2', // 옅은 하늘빛 보더

  onDark: '#FFFFFF', // 진한 포인트 배경 위 텍스트
} as const;

// 간격 스케일 (넉넉한 여백)
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// 라운드 코너 (일관된 라운드)
export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

// 폰트 스케일
export const font = {
  caption: 12,
  small: 13,
  body: 15,
  label: 16,
  subtitle: 18,
  title: 22,
  hero: 28,
  score: 88, // 홈 화면 대형 점수
} as const;

// 카드/버튼 공용 부드러운 그림자
export const shadow = {
  card: {
    shadowColor: '#1F2D3A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  button: {
    shadowColor: '#1F2D3A',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
} as const;

// 아이콘/스플래시 배경으로 쓰는 파스텔 스카이블루 (문서/adaptiveIcon 과 동일)
export const ICON_BG_HEX = '#BFE3F5';
