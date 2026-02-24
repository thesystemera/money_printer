export const MARKET_SENTIMENT = {
  SYMBOL: "GLOBAL_MARKET",
  NAME: "Global Market",
  KEYWORDS: [
    { term: "stock market", weight: 1.2 },
    { term: "global markets", weight: 1.1 },
    { term: "market sentiment", weight: 1.0 },
    { term: "interest rates", weight: 1.3 },
    { term: "economic outlook", weight: 1.0 },
    { term: "bull market", weight: 0.9 },
    { term: "market rally", weight: 0.8 },
    { term: "economic growth", weight: 1.1 },
    { term: "strong earnings", weight: 0.9 },
    { term: "investor confidence", weight: 0.8 },
    { term: "bear market", weight: 0.9 },
    { term: "market crash", weight: 0.8 },
    { term: "inflation", weight: 1.1 },
    { term: "recession", weight: 0.9 },
    { term: "economic slowdown", weight: 0.8 }
  ]
};

export const SPACING = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
  xxl: 8
};

export const LAYOUT = {
  borderRadius: "md",
  borderColor: "gray.700",
  containerBg: "gray.800",
  panelBg: "gray.800"
};

export const CHART_DIMENSIONS = {
  plotHeight: "500px",
  standard: { width: "100%", height: "400px" },
  compact: { width: "100%", height: "350px" },
  large: { width: "100%", height: "500px" },
  small: { width: "100%", height: "250px" }
};

export const SENTIMENT_RANGES = {
  bullish: { min: 0.1, color: 'bullish' },
  bearish: { max: -0.1, color: 'bearish' },
  neutral: { min: -0.1, max: 0.1, color: 'neutral' }
};

export const DATA_QUALITY_LEVELS = {
  high: { color: 'green', label: 'High Quality' },
  medium: { color: 'yellow', label: 'Medium Quality' },
  low: { color: 'red', label: 'Low Quality' },
  unknown: { color: 'gray', label: 'Unknown' }
};

export const COMPONENT_STYLES = {
  infoCard: {
    base: {
      p: SPACING.md,
      bg: LAYOUT.containerBg,
      borderRadius: LAYOUT.borderRadius,
      border: "1px solid",
      borderColor: LAYOUT.borderColor
    },
    compact: {
      p: SPACING.sm,
      bg: LAYOUT.containerBg,
      borderRadius: LAYOUT.borderRadius
    }
  },
  chartContainer: {
    base: {
      ...CHART_DIMENSIONS.standard,
      p: SPACING.sm,
      bg: LAYOUT.containerBg,
      borderRadius: LAYOUT.borderRadius,
      border: "1px solid",
      borderColor: LAYOUT.borderColor
    }
  },
  metricGrid: {
    base: {
      p: SPACING.md,
      bg: LAYOUT.panelBg,
      borderRadius: LAYOUT.borderRadius
    }
  },
  sectionHeader: {
    fontSize: "sm",
    fontWeight: "bold",
    mb: SPACING.sm
  },
  summaryGrid: {
    templateColumns: { base: "repeat(2, 1fr)", md: "repeat(6, 1fr)" },
    gap: SPACING.lg,
    mb: SPACING.lg,
    p: SPACING.md,
    bg: LAYOUT.panelBg,
    borderRadius: LAYOUT.borderRadius
  }
};

export const HISTORICAL_BASELINE = {
  ROLLING_AVERAGE_DAYS: 30,
  STANDARD_DEVIATION_MULTIPLIER: 3,
  MINIMUM_DATA_POINTS: 30,
  HISTORICAL_YEARS_BACK: 2
};

export const MARKET_INDICES = {
  DEFAULT_INDEX: 'nasdaq',
  INFO: {
    'sp500': { name: 'S&P 500', color: '#6B7280' },
    'nasdaq': { name: 'NASDAQ-100', color: '#6B7280' },
    'dow': { name: 'Dow Jones', color: '#6B7280' },
    'russell2000': { name: 'Russell 2000', color: '#6B7280' }
  }
};

export const TIME_PERIODS = {
  "1week": 7,
  "2weeks": 14,
  "1month": 30,
  "3months": 90
};

export const PORTFOLIO = {
  REFRESH_INTERVAL_MS: 5 * 60 * 1000,
  MAX_CONCURRENT_FETCHES: 10,
  SEMAPHORE_DELAY_MS: 100,
  RENDER_DELAY_MS: 500
};

export const UI_ANIMATIONS = {
  enabled: false,
  transition: 'all 0.3s ease-in-out'
};

export const CHART_ANIMATIONS = {
  enabled: false,
  duration: 300,
  easing: "ease-in-out",
  delay: 150
};

export const DEFAULT_DATA_SETTINGS = {
  dataResolutionMinutes: 15,
  articleCountResolutionMinutes: 240,
  recentChartHours: 72,
  timeWindow: 12 * 60 * 60 * 1000
};

export const DEFAULT_TEMPORAL_PARAMETERS = {
  pastWeight: 1.0,
  futureWeight: 1.0,
  pastShift: 0,
  futureShift: 0,
  momentumBlend: 0.5,
  rollingAverageWindowMs: 12 * 60 * 60 * 1000,
  futureWindowHours: 0,
  derivativeSmoothingWindow: 20
};

export const DEFAULT_MASTER_WEIGHTS = {
  stock: 1.0,
  market: 1.0,
  industry: 1.0,
};

export const DEFAULT_SENTIMENT_WEIGHTS = {
  sourceWeights: {
    RETAIL: 1.0,
    INSTITUTIONAL: 1.0,
    AMBIGUOUS: 1.0,
  },
  componentWeights: {
    sentimentWeight: 1.0,
    influenceWeight: 1.0,
    certaintyWeight: 1.0,
  },
};

export const STOCK_BUCKET_PARAMS = {
  temporal: {
    pastWeight: 1.0,
    futureWeight: 1.0,
    pastShift: 0,
    futureShift: 0,
    rollingAverageWindowMs: 12 * 60 * 60 * 1000
  },
  source: {
    RETAIL: 1.0,
    INSTITUTIONAL: 1.0,
    AMBIGUOUS: 1.0
  },
  component: {
    sentimentWeight: 1.0,
    influenceWeight: 1.0,
    certaintyWeight: 1.0
  }
};

export const MARKET_BUCKET_PARAMS = {
  temporal: {
    pastWeight: 1.0,
    futureWeight: 1.0,
    pastShift: 0,
    futureShift: 0,
    rollingAverageWindowMs: 12 * 60 * 60 * 1000
  },
  source: {
    RETAIL: 1.0,
    INSTITUTIONAL: 1.0,
    AMBIGUOUS: 1.0
  },
  component: {
    sentimentWeight: 1.0,
    influenceWeight: 1.0,
    certaintyWeight: 1.0
  }
};

export const INDUSTRY_BUCKET_PARAMS = {
  temporal: {
    pastWeight: 1.0,
    futureWeight: 1.0,
    pastShift: 0,
    futureShift: 0,
    rollingAverageWindowMs: 12 * 60 * 60 * 1000
  },
  source: {
    RETAIL: 1.0,
    INSTITUTIONAL: 1.0,
    AMBIGUOUS: 1.0
  },
  component: {
    sentimentWeight: 1.0,
    influenceWeight: 1.0,
    certaintyWeight: 1.0
  }
};

export const GLOBAL_TEMPORAL_PARAMS = {
  momentumBlend: 0.5,
  derivativeSmoothingWindow: 20,
  futureWindowHours: 0
};

export const COLORS = {
  stockSentiment: '#1565C0',
  stockSentimentRollingAvg: '#2196F3',
  stockTemporalImpact: '#1565C0',
  stockArticleCount: '#64B5F6',
  stockTemporalFlow: '#90CAF9',
  marketSentiment: '#C2185B',
  marketSentimentRollingAvg: '#E91E63',
  marketTemporalImpact: '#C2185B',
  marketArticleCount: '#F8BBD9',
  marketTemporalFlow: '#FCE4EC',
  industrySentiment: '#388E3C',
  industrySentimentRollingAvg: '#8BC34A',
  industryTemporalImpact: '#689F38',
  industryArticleCount: '#C8E6C9',
  industryTemporalFlow: '#E8F5E8',
  masterTemporalImpact: '#FFD700',
  stockPrice: '#FFFFFF',
  volume: '#FDE68A',
  marketRegularBg: 'rgba(0, 255, 0, 0.5)',
  marketOffHoursBg: 'rgba(255, 0, 0, 0.5)',
  referenceLine: 'rgba(255, 255, 255, 0.5)',
  currentTimeLine: '#ff5252',
  articleCountBase: '#7986CB',
  positive: '#4cd137',
  negative: '#e84393',
  warning: '#ff9f43',
  info: '#00b0ff',
  marketOpen: '#00b894',
  marketClose: '#e84393',
  latestPrice: '#22C55E',
  axisLight: '#FFFFFF',
  axisDark: '#FFFFFF',
  gridLight: '#FFFFFF',
  gridDark: '#FFFFFF',
  master_prediction: '#22c55e',
  revised_prediction: '#a855f7',
  image_prediction: '#ec4899',
  options_prediction: '#06b6d4',
  vibe_prediction: '#f97316',
  actual_prices: '#ffffff',
  prediction_time: '#8b5cf6',
  current_time: '#06b6d4',
  master_volatility_gradient: '#22c55e',
  revised_volatility_gradient: '#a855f7',
  image_volatility_gradient: '#ec4899',
  options_volatility_gradient: '#06b6d4',
  vibe_volatility_gradient: '#f97316',
  call: '#4CAF50',
  put: '#F44336',
  netGamma: '#9C27B0',
  support: '#4CAF50',
  resistance: '#F44336',
  maxPain: '#FF9800',
  bullish: '#4CAF50',
  bearish: '#F44336',
  neutral: '#2196F3',
  volumeBullish: '#8BC34A',
  volumeBearish: '#E91E63',
  premium: '#9C27B0',
  sentiment: '#3F51B5',
  volumeSentiment: '#00FFFF',
  premiumSentiment: '#00FF41',
  putCallRatio: '#ff7300',
  institutional: '#FFD700',
  masterSignalBullish: '#00BFFF',
  masterSignalBearish: '#FF4500',
  masterSignalNeutral: '#FFFFFF',
};

export const OPTIONS_CHART_STYLING = {
  grid: {
    stroke: "rgba(255,255,255,0.25)",
    strokeDasharray: "3 3",
    vertical: true,
    horizontal: true
  },
  background: {
    chart: "#000000",
    container: "rgba(45, 55, 72, 0.8)"
  },
  text: {
    fill: "white",
    fontSize: {
      axis: 11,
      axisLabel: 14,
      small: 9,
      legend: 10
    }
  },
  effects: {
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)",
    backdropFilter: "blur(10px)",
    glowGreen: "0 0 10px 2px rgba(72, 187, 120, 0.3)",
    glowRed: "0 0 10px 2px rgba(245, 101, 101, 0.3)",
    glowBlue: "0 0 10px 2px rgba(66, 153, 225, 0.3)",
    glowWhite: "0 0 15px rgba(255,255,255,0.5), 0 4px 6px rgba(0,0,0,0.3)"
  },
  strokeDashArrays: {
    reference: "5 3",
    support: "8 4",
    resistance: "8 4",
    maxPain: "4 4",
    neutral: "3 3",
    implied: "5 3"
  },
  strokeWidths: {
    reference: 3,
    support: 2,
    resistance: 2,
    maxPain: 2,
    neutral: 1,
    line: 2,
    lineThick: 3,
    lineHeavy: 4,
    area: 2
  },
  opacities: {
    reference: 0.8,
    support: 0.7,
    resistance: 0.7,
    maxPain: 0.8,
    areaHigh: 0.9,
    areaMedium: 0.75,
    areaLow: 0.5,
    gradient: {
      start: 0.8,
      end: 0.2
    }
  },
  dimensions: {
    maxBarSize: 120,
    axisWidth: {
      left: 60,
      right: 60,
      narrow: 45
    },
    xAxisHeight: 45,
    dotRadius: 3,
    dotRadiusLarge: 4
  }
};

export const CHART_STYLING = {
  axis: {
    tickFontSize: 10,
    width: {
      sentiment: 25,
      price: 30,
      volume: 0
    },
    domains: {
      sentiment: [-1, 1],
      price: ['auto', 'auto'],
      volume: [0, 'dataMax * 4']
    }
  },
  points: {
    regular: { r: 3, strokeWidth: 1 },
    highlight: { r: 4, strokeWidth: 2 },
    sentiment: { r: 3, min: 3, max: 12 }
  },
  lines: {
    regular: { strokeWidth: 2 },
    highlight: { strokeWidth: 3 },
    dashed: { strokeDasharray: "3 3" },
    indexDashed: { strokeDasharray: "5 5" },
    temporal: {
      strokeWidth: 3,
      opacity: 0.9,
      strokeDasharray: null
    },
    temporalDashed: {
      strokeWidth: 3,
      opacity: 0.9,
      strokeDasharray: "5 2"
    },
    industryDashed: {
      strokeWidth: 2,
      opacity: 0.8,
      strokeDasharray: "4 2"
    }
  },
  animation: CHART_ANIMATIONS
};

export const FORMATTERS = {
  number: (num, isPercentage = false) => {
    if (num === undefined || num === null || isNaN(num)) return 'N/A';

    if (isPercentage) {
      return `${(num * 100).toFixed(1)}%`;
    }

    if (Math.abs(num) >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (Math.abs(num) >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }

    return num.toFixed(2);
  },

  sentiment: (score) => {
    if (score >= SENTIMENT_RANGES.bullish.min) return 'bullish';
    if (score <= SENTIMENT_RANGES.bearish.max) return 'bearish';
    return 'neutral';
  },

  dataQuality: (reliability) => {
    return DATA_QUALITY_LEVELS[reliability] || DATA_QUALITY_LEVELS.unknown;
  },
};

export const LOG_COLORS = {
  'info': 'blue',
  'error': 'red',
  'warning': 'yellow',
  'success': 'green',
  'debug': 'gray',
  'cache': 'lavender',
  'fetch': 'cyan',
  'ai': 'magenta',
  'analysis': 'indigo',
  'market': 'gold',
  'api': 'teal',
  'system': 'white',
  'ws': 'orange',
  'portfolio': 'purple',
  'workflow': 'lime',
  'enrichment': 'coral',
  'options': 'pink'
};

export const TIME_WINDOW_OPTIONS = [
  { label: '1 Hour', value: 60 * 60 * 1000 },
  { label: '4 Hours', value: 4 * 60 * 60 * 1000 },
  { label: '12 Hours', value: 12 * 60 * 60 * 1000 },
  { label: '1 Day', value: 24 * 60 * 60 * 1000 },
  { label: '3 Days', value: 3 * 24 * 60 * 60 * 1000 },
  { label: 'Auto-Tuned', value: 'optimized' }
];

export const RESOLUTION_OPTIONS = [
  { label: '1 min', value: 1 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '60 min', value: 60 },
];

export const RECOMMENDATION_STYLES = {
  sessionColors: {
    preMarket: {
      darkBg: 'rgba(66, 153, 225, 0.15)',
      lightBg: 'rgba(191, 219, 254, 0.3)',
      border: {
        dark: '#4299e1',
        light: '#3182ce'
      },
      text: {
        dark: '#90cdf4',
        light: '#2b6cb0'
      }
    },
    marketOpen: {
      darkBg: 'rgba(72, 187, 120, 0.15)',
      lightBg: 'rgba(154, 230, 180, 0.3)',
      border: {
        dark: '#48bb78',
        light: '#38a169'
      },
      text: {
        dark: '#9ae6b4',
        light: '#276749'
      }
    },
    marketClose: {
      darkBg: 'rgba(236, 89, 89, 0.15)',
      lightBg: 'rgba(252, 165, 165, 0.3)',
      border: {
        dark: '#ec5959',
        light: '#e53e3e'
      },
      text: {
        dark: '#feb2b2',
        light: '#c53030'
      }
    },
    afterHours: {
      darkBg: 'rgba(159, 122, 234, 0.15)',
      lightBg: 'rgba(196, 181, 253, 0.3)',
      border: {
        dark: '#9f7aea',
        light: '#805ad5'
      },
      text: {
        dark: '#d6bcfa',
        light: '#553c9a'
      }
    },
    returnBox: {
      darkBg: 'rgba(251, 189, 35, 0.2)',
      lightBg: 'rgba(252, 211, 77, 0.4)',
      border: {
        dark: '#fbd123',
        light: '#ecc94b'
      },
      text: {
        dark: '#faf089',
        light: '#975a16'
      }
    }
  }
};

export const DEFAULT_UI_STATES = {
  showChartControls: true,
  timezoneDisplay: 'et',
  dataResolutionMinutes: DEFAULT_DATA_SETTINGS.dataResolutionMinutes,
  visibleLines: {
    stockSentimentPoints: false,
    marketSentimentPoints: false,
    industrySentimentPoints: false,
    stockRollingAvg: false,
    marketRollingAvg: false,
    industryRollingAvg: false,
    combinedRollingAvg: true,
    stockTemporalImpact: false,
    marketTemporalImpact: false,
    industryTemporalImpact: false,
    masterTemporalImpact: false,
    stockPrice: true,
    stockPriceBubbles: true,
    volume: true,
    marketIndex: true,
    stockArticleCount: true,
    marketArticleCount: true,
    industryArticleCount: true,
    marketSessions: true,
    currentTimeLine: true
  },
  expandedSections: {
    imageAnalysis: false,
    optionsAnalysis: false,
    vibeAnalysis: false,
    marketOutlook: true,
    strategy: true,
    volatility: true,
    factors: true,
    details: true,
    predictionAccuracy: true,
    predictionHistory: true,
    predictionSynthesis: true,
    suggestions: true,
    watchlist: true,
    avoidList: true,
    riskAssessment: true
  }
};

export const DEFAULT_PANEL_STATES = {
  search: false,
  settings: false,
  chart: true,
  visualization: true,
  recommendation: true,
  portfolio: true,
  portfolioMonitor: true,
  portfolioPredictionAccuracy: true,
  articles: true,
  logs: true
};

export const PANEL_NAMES = {
  search: "Search Stock",
  settings: "Analysis Settings",
  chart: "Sentiment Analysis",
  visualization: "Enhanced Visualization",
  recommendation: "AI Trading Recommendation",
  portfolio: "Portfolio Power Moves",
  portfolioMonitor: "Real-time Portfolio Monitor",
  portfolioPredictionAccuracy: "Prediction Accuracy Analysis",
  articles: "Articles",
  logs: "Debug Log"
};

export const THEME = {
  config: {
    initialColorMode: 'dark',
    useSystemColorMode: true,
  },
  colors: {
    brand: {
      900: '#1a365d',
      800: '#153e75',
      700: '#2a69ac',
    }
  },
  scrollbar: {
    width: '6px',
    height: '6px',
    trackBg: {
      light: 'gray.100',
      dark: 'gray.800'
    },
    thumbBg: {
      light: 'gray.400',
      dark: 'gray.600'
    },
    thumbHoverBg: {
      light: 'gray.500',
      dark: 'gray.500'
    }
  },
  transition: {
    standard: UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'
  },
  borders: {
    radius: {
      sm: '3px',
      md: '6px',
      lg: '12px'
    }
  },
  components: {
    panel: {
      minHeight: {
        standard: '200px',
        compact: '120px',
        chart: '400px',
        article: '300px'
      },
      collapsedHeight: '60px'
    }
  }
};

export const REFRESH_INTERVALS = {
  PORTFOLIO_MS: 5 * 60 * 1000,
  SYSTEM_SYMBOLS_MS: 1 * 60 * 1000,
  PREDICTION_ACCURACY_MS: 4 * 60 * 60 * 1000,
};

export const SCHEDULED_ANALYSIS = {
  ENABLED: true,
  PRE_COMPUTATION_RUN: {
    NAME: "Pre-computation",
    HOUR_ET: 7,
    MINUTE_ET: 30,
    SETTINGS: {
      disableAutoRecommendation: true
    }
  },
  RECOMMENDATION_RUN: {
    NAME: "Recommendation",
    HOUR_ET: 8,
    MINUTE_ET: 0,
    SETTINGS: {
      disableAutoRecommendation: false
    }
  }
};

export const DEFAULT_SETTINGS = {
  daysBack: 14,
  totalArticlesPerDay: 50,
  timePeriod: '2weeks',
  useTurboModel: false,
  enableScheduledAnalysis: true,
  disableAutoRecommendation: false,
  enableTimeOverride: false,
  overrideDateTime: null
};

export const SYSTEM = {
  SAFETY_TIMEOUT: 120000,
  MAX_CHART_POINTS: 5000,
  THINKING_STREAM_TIMEOUT: 120000,
  CHART_ANIMATION_DELAY: 150,
  MAX_RECENT_SEARCHES: 10,
  RECONNECT_ATTEMPTS: 5,
  INITIAL_RECONNECT_DELAY: 1000,
  DISABLE_TUNER_CACHE: false,
  ARTICLE_PROCESSING_BATCH_SIZE: 500,
};

export const API = {
  BASE_URL: '/api',
  WS_URL: 'wss://moneyprinter.live/ws',
  DEBOUNCE_TIME: 300,
  DEFAULT_ERROR_MESSAGE: 'An unexpected error occurred. Please try again.',
  TIMEOUTS: {
    DEFAULT: 300000,
    LONG: 1800000,
    RECOMMENDATION: 900000
  }
};

export const PANEL_MODES = {
  fixed: {
    panel: {
      flex: "1",
      minHeight: THEME.components.panel.minHeight.standard,
      maxHeight: "100%",
      overflow: "hidden"
    },
    content: {
      flex: "1",
      overflow: "auto",
      height: "auto"
    }
  },
  adaptive: {
    panel: {
      flex: "none",
      minHeight: THEME.components.panel.minHeight.standard,
      maxHeight: "none",
      overflow: "visible"
    },
    content: {
      flex: "none",
      overflow: "visible",
      height: "auto"
    }
  }
};

export const UI_EFFECTS = {
  blur: {
    active: {
      opacity: 1,
      filter: 'none',
      transform: 'scale(1)',
      WebkitFilter: 'none',
      transition: UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'
    },
    minimized: {
      opacity: 0.25,
      filter: 'blur(3px)',
      transform: 'scale(0.92)',
      WebkitFilter: 'blur(3px)',
      transition: UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'
    }
  },
  processing: {
    pulse: {
      animation: 'pulse 2s infinite',
      '@keyframes pulse': {
        '0%': { boxShadow: '0 0 5px 0px rgba(72, 187, 120, 0.8)' },
        '70%': { boxShadow: '0 0 15px 8px rgba(72, 187, 120, 0.5)' },
        '100%': { boxShadow: '0 0 5px 0px rgba(72, 187, 120, 0.8)' }
      }
    },
    glow: {
      borderColor: 'green.400',
      boxShadow: '0 0 10px 2px rgba(72, 187, 120, 0.4)'
    }
  },
  hardware: {
    acceleration: {
      transform: 'translateZ(0)',
      backfaceVisibility: 'hidden',
      WebkitBackfaceVisibility: 'hidden',
      WebkitTransform: 'translateZ(0)',
      WebkitPerspective: '1000',
      WebkitPerspectiveOrigin: '50% 50%',
      willChange: 'transform',
      WebkitOverflowScrolling: 'touch',
      contain: 'content'
    }
  }
};

export const UI_THEME = {
  config: THEME.config,
  colors: THEME.colors,
  styles: {
    global: (props) => ({
      html: {
        height: '100%',
        width: '100%',
        scrollBehavior: 'smooth',
        overflow: 'hidden'
      },
      body: {
        bg: props.colorMode === 'dark' ? 'gray.900' : 'gray.50',
        color: props.colorMode === 'dark' ? 'white' : 'gray.800',
        margin: 0,
        padding: 0,
        height: '100%',
        width: '100%',
        fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
                    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
                    sans-serif`,
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        overflow: 'hidden'
      },
      '#root': {
        height: '100%',
        width: '100%',
        overflow: 'hidden'
      },
      code: {
        fontFamily: `source-code-pro, Menlo, Monaco, Consolas, 'Courier New', monospace`,
      },
      '::-webkit-scrollbar': {
        width: THEME.scrollbar.width,
        height: THEME.scrollbar.height
      },
      '::-webkit-scrollbar-track': {
        backgroundColor: props.colorMode === 'dark' ?
          THEME.scrollbar.trackBg.dark :
          THEME.scrollbar.trackBg.light
      },
      '::-webkit-scrollbar-thumb': {
        backgroundColor: props.colorMode === 'dark' ?
          THEME.scrollbar.thumbBg.dark :
          THEME.scrollbar.thumbBg.light,
        borderRadius: '4px'
      },
      '::-webkit-scrollbar-thumb:hover': {
        backgroundColor: props.colorMode === 'dark' ?
          THEME.scrollbar.thumbHoverBg.dark :
          THEME.scrollbar.thumbHoverBg.light
      }
    }),
  },
  components: {
    Container: {
      baseStyle: {
        maxWidth: '1440px'
      }
    },
    Box: {
      baseStyle: (props) => ({
        bg: props.colorMode === 'dark' ? 'transparent' : 'transparent',
        transition: UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'
      })
    },
    Button: {
      baseStyle: {
        fontWeight: 'normal'
      }
    },
    Tooltip: {
      baseStyle: {
        zIndex: 10000
      }
    }
  }
};

export const getStockArticleFetchParams = (settings, companyInfo) => {
  const stockKeywords = companyInfo?.search_keywords || [];
  return {
    totalArticles: settings.totalArticlesPerDay,
    daysBack: settings.daysBack,
    keywordCount: stockKeywords.length || 3
  };
};

export const getMarketArticleFetchParams = (settings) => {
  return {
    totalArticles: settings.totalArticlesPerDay,
    daysBack: settings.daysBack,
    keywordCount: MARKET_SENTIMENT.KEYWORDS.length
  };
};