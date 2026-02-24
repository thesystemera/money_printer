import { COLORS, MARKET_INDICES, CHART_STYLING, DEFAULT_UI_STATES, DEFAULT_DATA_SETTINGS } from '../config/Config';
import { getTimestamp, getCurrentTime } from '../services/timeService';

if (typeof window !== 'undefined') {
  window.GLOBAL_PRICE_POINT_STATE = window.GLOBAL_PRICE_POINT_STATE || { occupiedRegions: [] };
}

export const clearOccupiedRegions = () => {
};

export const initialChartState = {
  height: 600,
  width: 800,
  timezoneDisplay: DEFAULT_UI_STATES.timezoneDisplay,
  timeWindow: DEFAULT_DATA_SETTINGS.timeWindow,
  viewDomain: null,
  brushIndices: { startIndex: 0, endIndex: 0 },
  crosshairPosition: { x: null, y: null },
  updateCounter: 0
};

export const chartStateReducer = (state, action) => {
  switch (action.type) {
    case 'SET_HEIGHT':
      return { ...state, height: action.payload };
    case 'SET_WIDTH':
      return { ...state, width: action.payload };
    case 'SET_TIMEZONE':
      return { ...state, timezoneDisplay: action.payload };
    case 'SET_TIME_WINDOW':
      return { ...state, timeWindow: action.payload };
    case 'SET_VIEW_DOMAIN':
      return { ...state, viewDomain: action.payload };
    case 'RESET_VIEW':
      return { ...state, viewDomain: null };
    case 'SET_BRUSH_INDICES':
      return { ...state, brushIndices: action.payload };
    case 'SET_CROSSHAIR':
      return { ...state, crosshairPosition: action.payload };
    case 'FORCE_UPDATE':
      return { ...state, updateCounter: state.updateCounter + 1 };
    default:
      return state;
  }
};

export const extractMarketSessionAreas = (stockData, tradingCalendar = null, startDate = null, endDate = null) => {
  if (!tradingCalendar || !Array.isArray(tradingCalendar) || tradingCalendar.length === 0) return [];

  const areas = [];
  const startTimestamp = startDate ? startDate.getTime() : null;
  const endTimestamp = endDate ? endDate.getTime() : null;
  const sessionTimesCache = new Map();

  tradingCalendar.forEach(day => {
    if (!day.date) return;

    let dateStr = day.date;
    if (typeof dateStr === 'object' && dateStr instanceof Date) {
      dateStr = dateStr.toISOString().split('T')[0];
    }

    if (sessionTimesCache.has(dateStr)) {
      const sessionTimes = sessionTimesCache.get(dateStr);
      if (startTimestamp && sessionTimes.afterHoursEnd < startTimestamp) return;
      if (endTimestamp && sessionTimes.preMarketStart > endTimestamp) return;

      areas.push(
        { session: 'pre-market', start: sessionTimes.preMarketStart, end: sessionTimes.marketOpen, day: dateStr },
        { session: 'regular', start: sessionTimes.marketOpen, end: sessionTimes.marketClose, day: dateStr },
        { session: 'after-hours', start: sessionTimes.marketClose, end: sessionTimes.afterHoursEnd, day: dateStr }
      );
      return;
    }

    const sessionTimes = {
      preMarketStart: Date.parse(`${dateStr}T04:00:00-04:00`),
      marketOpen: Date.parse(`${dateStr}T09:30:00-04:00`),
      marketClose: Date.parse(`${dateStr}T16:00:00-04:00`),
      afterHoursEnd: Date.parse(`${dateStr}T20:00:00-04:00`)
    };

    if (Object.values(sessionTimes).some(time => isNaN(time))) return;

    sessionTimesCache.set(dateStr, sessionTimes);

    if (startTimestamp && sessionTimes.afterHoursEnd < startTimestamp) return;
    if (endTimestamp && sessionTimes.preMarketStart > endTimestamp) return;

    areas.push(
      { session: 'pre-market', start: sessionTimes.preMarketStart, end: sessionTimes.marketOpen, day: dateStr },
      { session: 'regular', start: sessionTimes.marketOpen, end: sessionTimes.marketClose, day: dateStr },
      { session: 'after-hours', start: sessionTimes.marketClose, end: sessionTimes.afterHoursEnd, day: dateStr }
    );
  });

  return areas.sort((a, b) => a.start - b.start);
};

export const getTimezoneOffset = (timezoneDisplay) => {
  const timezone = timezoneDisplay || DEFAULT_UI_STATES.timezoneDisplay;

  if (timezone === 'local') return 0;

  const now = new Date();
  const localTime = now.getTime();
  let targetTime;

  if (timezone === 'et') {
    targetTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getTime();
  } else if (timezone === 'utc') {
    targetTime = Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()
    );
  } else {
    return 0;
  }

  return localTime - targetTime;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const getTimeAxisTicks = (timeRange, timezoneDisplay, chartWidth = 800) => {
  if (!timeRange || !timeRange.min || !timeRange.max) return [];

  const timezone = timezoneDisplay || DEFAULT_UI_STATES.timezoneDisplay;
  const tzOffset = getTimezoneOffset(timezone);
  const startTime = timeRange.min - tzOffset;
  const endTime = timeRange.max - tzOffset;
  const rangeDuration = endTime - startTime;

  const firstDay = new Date(startTime);
  firstDay.setHours(0, 0, 0, 0);
  if (firstDay.getTime() > startTime) {
    firstDay.setDate(firstDay.getDate() - 1);
  }

  const dayTicks = [];
  let currentDate = new Date(firstDay);

  while (currentDate.getTime() <= endTime) {
    const tickTime = currentDate.getTime();
    if (tickTime >= startTime - DAY_MS) {
      dayTicks.push({
        value: tickTime + tzOffset,
        type: 'day',
        priority: 10
      });
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  const daysInView = rangeDuration / DAY_MS;
  const pixelsPerDay = chartWidth / daysInView;

  let hourDivisions;

  if (pixelsPerDay >= 300) {
    hourDivisions = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
  } else if (pixelsPerDay >= 200) {
    hourDivisions = [0, 3, 6, 9, 12, 15, 18, 21];
  } else if (pixelsPerDay >= 120) {
    hourDivisions = [0, 4, 8, 12, 16, 20];
  } else if (pixelsPerDay >= 80) {
    hourDivisions = [0, 6, 12, 18];
  } else if (pixelsPerDay >= 50) {
    hourDivisions = [0, 12];
  } else {
    hourDivisions = [];
  }

  const hourTicks = [];

  if (hourDivisions.length > 0) {
    const hourStartDate = new Date(firstDay);

    while (hourStartDate.getTime() <= endTime) {
      for (const hour of hourDivisions) {
        if (hour === 0) continue;

        const hourDate = new Date(hourStartDate);
        hourDate.setHours(hour, 0, 0, 0);
        const hourTime = hourDate.getTime();

        if (hourTime >= startTime && hourTime <= endTime) {
          hourTicks.push({
            value: hourTime + tzOffset,
            type: 'hour',
            priority: 5,
            hour
          });
        }
      }
      hourStartDate.setDate(hourStartDate.getDate() + 1);
    }
  }

  let allTicks = [...dayTicks, ...hourTicks].sort((a, b) => a.value - b.value);

  return allTicks.map(tick => {
    const date = new Date(tick.value);
    let display;

    if (tick.type === 'day') {
      if (rangeDuration > 90 * DAY_MS) {
        display = date.toLocaleDateString('en-US', {
          month: 'short', day: 'numeric',
          timeZone: timezone === 'et' ? 'America/New_York' :
                  timezone === 'utc' ? 'UTC' : undefined
        });
      } else {
        display = date.toLocaleDateString('en-US', {
          weekday: 'short', day: 'numeric',
          timeZone: timezone === 'et' ? 'America/New_York' :
                  timezone === 'utc' ? 'UTC' : undefined
        });

        const parts = display.split(' ');
        if (parts.length === 2) {
          display = parts[1] + ' ' + parts[0];
        }
      }
    } else {
      display = date.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
        timeZone: timezone === 'et' ? 'America/New_York' :
                timezone === 'utc' ? 'UTC' : undefined
      });
    }

    return {
      value: tick.value,
      display,
      type: tick.type,
      priority: tick.priority
    };
  });
};

export const createXAxisConfig = (chartDomain, timezoneDisplay, chartWidth = 800) => {
  const timezone = timezoneDisplay || DEFAULT_UI_STATES.timezoneDisplay;

  const allTicks = getTimeAxisTicks(
    {min: chartDomain[0], max: chartDomain[1]},
    timezone,
    chartWidth
  );

  const domainWidthMs = chartDomain[1] - chartDomain[0];
  const msPerPixel = domainWidthMs / chartWidth;
  const minGapMs = msPerPixel * 60;

  const filteredTicks = [];

  const dayTicks = allTicks.filter(tick => tick.type === 'day');
  filteredTicks.push(...dayTicks);

  const hourTicks = allTicks.filter(tick => tick.type === 'hour');

  hourTicks.forEach(hourTick => {
    let hasEnoughSpace = true;

    for (const existingTick of filteredTicks) {
      const gap = Math.abs(existingTick.value - hourTick.value);
      if (gap < minGapMs) {
        hasEnoughSpace = false;
        break;
      }
    }

    if (hasEnoughSpace) {
      filteredTicks.push(hourTick);
    }
  });

  const finalTicks = filteredTicks.sort((a, b) => a.value - b.value);

  return {
    dataKey: "timestamp",
    type: "number",
    domain: chartDomain,
    scale: "time",
    tick: (props) => {
      const { x, y, payload } = props;
      const tickInfo = finalTicks.find(t => t.value === payload.value) || {};
      const isDay = tickInfo.type === 'day';

      const maxY = y + 30;
      const effectiveY = Math.min(y, maxY);

      const textWidth = (tickInfo.display || '').length * (isDay ? 7 : 5);
      const textStartX = x - (textWidth / 2);
      const textEndX = x + (textWidth / 2);

      const showText = textStartX >= 0 && textEndX <= chartWidth;

      return (
        <g transform={`translate(${x},${effectiveY})`}>
          {showText && (
            <text
              x={0}
              y={isDay ? 3 : 0}
              dy={16}
              textAnchor="middle"
              fill={isDay ? "#FFFFFF" : "#A0A0A0"}
              fontSize={isDay ? 12 : 9}
              fontWeight={isDay ? "bold" : "normal"}
            >
              {tickInfo.display || ''}
            </text>
          )}
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={isDay ? 8 : 4}
            stroke={isDay ? "#FFFFFF" : "#A0A0A0"}
            strokeWidth={isDay ? 2 : 1}
          />
        </g>
      );
    },
    ticks: finalTicks.map(t => t.value),
    interval: 0,
    padding: { left: 10, right: 10 },
    axisLine: { stroke: COLORS.axisLight },
    tickLine: { stroke: COLORS.axisLight },
    allowDataOverflow: true,
    height: 50,
    minTickGap: 0
  };
};

export const generateLineConfigs = (
  stockSentimentPoints, marketSentimentPoints, industrySentimentPoints,
  stockRollingAvg, marketRollingAvg, industryRollingAvg, combinedRollingAvg,
  formattedStockData, volumeData, processedIndexData, selectedMarketIndex,
  stockTemporalData, marketTemporalData, industryTemporalData, masterTemporalData
) => {
  const baseProps = {
    isAnimationActive: CHART_STYLING.animation.enabled,
    animationDuration: CHART_STYLING.animation.duration,
    animationEasing: CHART_STYLING.animation.easing,
    connectNulls: true,
    dot: false
  };

  const createDot = (r, color) => ({r, fill: color, stroke: COLORS.axisDark, strokeWidth: 2, opacity: 1});

  const baseScatter = {
    ...baseProps,
    type: "scatter",
    dataKey: "adjustedSentiment",
    yAxisId: "sentiment",
    stroke: "transparent",
    shape: null,
    connectNulls: false,
  };

  const baseRollingAvgLine = {
    ...baseProps,
    type: "stepAfter",
    dataKey: "sentimentRollingAvg",
    yAxisId: "sentiment",
    strokeWidth: 2,
    activeDot: {r: 6},
  };

  const basePriceLine = {
    ...baseProps,
    type: "monotone",
    dataKey: "price",
    connectNulls: false,
  };

  const baseDerivativeLine = {
    ...baseProps,
    type: "monotone",
    yAxisId: "sentiment",
    strokeWidth: 2.0,
  };

  const baseDerivativeArea = {
    ...baseProps,
    type: "monotone",
    yAxisId: "sentiment",
    strokeWidth: 0,
    fillOpacity: 0.3,
  };

  return {
    stockSentimentPoints: { ...baseScatter, name: "Stock Sentiment Points", activeDot: createDot(8, COLORS.stockSentiment), data: stockSentimentPoints },
    marketSentimentPoints: { ...baseScatter, name: "Market Sentiment Points", activeDot: createDot(8, COLORS.marketSentiment), data: marketSentimentPoints },
    industrySentimentPoints: { ...baseScatter, name: "Industry Sentiment Points", activeDot: createDot(8, COLORS.industrySentiment), data: industrySentimentPoints },
    stockRollingAvg: { ...baseRollingAvgLine, stroke: COLORS.stockSentimentRollingAvg, name: "Stock Rolling Avg", data: stockRollingAvg },
    marketRollingAvg: { ...baseRollingAvgLine, stroke: COLORS.marketSentimentRollingAvg, name: "Market Rolling Avg", data: marketRollingAvg },
    industryRollingAvg: { ...baseRollingAvgLine, stroke: COLORS.industrySentimentRollingAvg, name: "Industry Rolling Avg", data: industryRollingAvg },
    stockPrice: { ...basePriceLine, stroke: COLORS.stockPrice, strokeWidth: 3, yAxisId: "price", name: "Stock Price", activeDot: {r: 4}, data: formattedStockData },
    volume: { ...baseProps, type: "area", dataKey: "volume", fill: COLORS.volume, stroke: COLORS.volume, strokeWidth: 1, fillOpacity: 0.3, yAxisId: "volume", name: "Volume", data: volumeData },
    marketIndex: { ...basePriceLine, stroke: MARKET_INDICES.INFO[selectedMarketIndex]?.color || COLORS.info, strokeWidth: 2, yAxisId: "index", name: MARKET_INDICES.INFO[selectedMarketIndex]?.name || 'Market Index', data: processedIndexData },
    stockVelocity: { ...baseDerivativeLine, dataKey: "normalizedVelocity", stroke: COLORS.stockTemporalImpact, data: stockTemporalData, name: "Stock Velocity" },
    marketVelocity: { ...baseDerivativeLine, dataKey: "normalizedVelocity", stroke: COLORS.marketTemporalImpact, data: marketTemporalData, name: "Market Velocity" },
    industryVelocity: { ...baseDerivativeLine, dataKey: "normalizedVelocity", stroke: COLORS.industryTemporalImpact, data: industryTemporalData, name: "Industry Velocity" },
    masterVelocity: { ...baseDerivativeLine, dataKey: "normalizedVelocity", stroke: COLORS.masterTemporalImpact, data: masterTemporalData, name: "Master Velocity" },
    stockAcceleration: { ...baseDerivativeArea, dataKey: "normalizedAcceleration", fill: COLORS.stockTemporalImpact, data: stockTemporalData, name: "Stock Acceleration" },
    marketAcceleration: { ...baseDerivativeArea, dataKey: "normalizedAcceleration", fill: COLORS.marketTemporalImpact, data: marketTemporalData, name: "Market Acceleration" },
    industryAcceleration: { ...baseDerivativeArea, dataKey: "normalizedAcceleration", fill: COLORS.industryTemporalImpact, data: industryTemporalData, name: "Industry Acceleration" },
    masterAcceleration: { ...baseDerivativeArea, dataKey: "normalizedAcceleration", fill: COLORS.masterTemporalImpact, data: masterTemporalData, name: "Master Acceleration" },
  };
};

export const positionLabels = (points) => {
  if (!points || points.length <= 1) return points;

  const sortedPoints = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const positionMap = {
    'pre-market-open': 'top',
    'open': 'top',
    'close': 'right',
    'after-hours-close': 'top',
    'latest': 'right'
  };

  return sortedPoints.map(point => ({
    ...point,
    labelPosition: positionMap[point.pointType] || 'top'
  }));
};

export const extractKeyPricePoints = (stockData) => {
  if (!stockData || stockData.length === 0) return {pricePoints: [], currentTime: getTimestamp()};

  const dayGroups = new Map();

  stockData.forEach(item => {
    if (!item.timestamp || item.isBreak || item.price === null || item.price === undefined) return;
    const dayKey = new Date(item.timestamp).toISOString().slice(0, 10);
    if (!dayGroups.has(dayKey)) {
      dayGroups.set(dayKey, []);
    }
    dayGroups.get(dayKey).push(item);
  });

  const pricePoints = [];
  const dayKeys = Array.from(dayGroups.keys()).sort();

  dayKeys.forEach(day => {
    const points = dayGroups.get(day);
    if (!points.length) return;
    points.sort((a, b) => a.timestamp - b.timestamp);

    const sessionTypes = ['pre-market', 'regular', 'after-hours'];
    const sessionGroups = sessionTypes.reduce((acc, session) => {
      acc[session] = points.filter(p => p.marketSession === session);
      return acc;
    }, {});

    const sessionMappings = [
      { session: 'pre-market', points: sessionGroups['pre-market'], type: 'pre-market-open', index: 0 },
      { session: 'regular', points: sessionGroups.regular, type: 'open', index: 0 },
      { session: 'regular', points: sessionGroups.regular, type: 'close', index: -1 },
      { session: 'after-hours', points: sessionGroups['after-hours'], type: 'after-hours-close', index: -1 }
    ];

    sessionMappings.forEach(({ points: sessionPoints, type, index }) => {
      if (sessionPoints && sessionPoints.length > 0) {
        const point = index === -1 ? sessionPoints[sessionPoints.length - 1] : sessionPoints[0];
        const originalPrice = point.originalPrice !== undefined ? point.originalPrice : point.price;
        pricePoints.push({
          ...point,
          pointType: type,
          label: `$${originalPrice.toFixed(2)}`,
          originalPrice: originalPrice
        });
      }
    });
  });

  const latestPoint = stockData
    .filter(item => item.price !== undefined && item.price !== null && !item.isBreak)
    .reduce((latest, item) => !latest || item.timestamp > latest.timestamp ? item : latest, null);

  if (latestPoint) {
    const originalPrice = latestPoint.originalPrice !== undefined ? latestPoint.originalPrice : latestPoint.price;
    pricePoints.push({
      ...latestPoint,
      pointType: 'latest',
      label: `$${originalPrice.toFixed(2)}`,
      originalPrice: originalPrice
    });
  }

  return {pricePoints, currentTime: getCurrentTime().getTime()};
};

export const createYAxisConfigs = () => {
  const baseYAxis = {
    tickCount: 8, scale: "linear",
    tick: { fontSize: CHART_STYLING.axis.tickFontSize, fill: COLORS.axisDark }
  };

  return {
    sentiment: {
      ...baseYAxis, yAxisId: "sentiment", domain: [-1.1, 1.1], tickCount: 5,
      width: CHART_STYLING.axis.width.sentiment
    },
    price: {
      ...baseYAxis, yAxisId: "price", orientation: "right", domain: ['auto', 'auto'],
      width: CHART_STYLING.axis.width.price, stroke: COLORS.stockPrice
    },
    volume: {
      ...baseYAxis, yAxisId: "volume", orientation: "left", domain: [0, dataMax => dataMax * 4],
      axisLine: false, tickLine: false, tick: false, width: CHART_STYLING.axis.width.volume
    },
    articleCount: {
      ...baseYAxis, yAxisId: "articleCount", orientation: "left", domain: [0, dataMax => dataMax * 4],
      axisLine: false, tickLine: false, tick: false, width: CHART_STYLING.axis.width.volume
    }
  };
};

export const createIndexYAxisConfig = (baseConfig, selectedMarketIndex) => {
  const color = MARKET_INDICES.INFO[selectedMarketIndex]?.color || COLORS.info;
  return {
    ...baseConfig,
    yAxisId: "index",
    orientation: "right",
    stroke: color,
    tick: { ...baseConfig.tick, fill: color },
    offset: 60
  };
};

export const generateCommonLegendItems = (chartData, currentTimeWindow, selectedMarketIndex) => {
  const items = [
    { value: 'Stock Sentiment Points', color: COLORS.stockSentiment, dataKey: 'stockSentimentPoints' },
    { value: 'Industry Sentiment Points', color: COLORS.industrySentiment, dataKey: 'industrySentimentPoints' },
    { value: 'Market Sentiment Points', color: COLORS.marketSentiment, dataKey: 'marketSentimentPoints' },
    { value: 'Stock Rolling Avg', color: COLORS.stockSentimentRollingAvg, dataKey: 'stockRollingAvg' },
    { value: 'Industry Rolling Avg', color: COLORS.industrySentimentRollingAvg, dataKey: 'industryRollingAvg' },
    { value: 'Market Rolling Avg', color: COLORS.marketSentimentRollingAvg, dataKey: 'marketRollingAvg' },
    { value: 'Combined Rolling Average', dataKey: 'combinedRollingAvg', isColorWheel: true, wheelColors: { stock: COLORS.stockSentimentRollingAvg, market: COLORS.marketSentimentRollingAvg, industry: COLORS.industrySentimentRollingAvg } },
    { value: 'Combined Rolling Average (Present Focus)', dataKey: 'combinedRollingAvgPresentFocus', isColorWheel: true, wheelColors: { stock: COLORS.stockSentimentRollingAvg, market: COLORS.marketSentimentRollingAvg, industry: COLORS.industrySentimentRollingAvg } },
    { value: 'Stock Temporal Impact', color: COLORS.stockTemporalImpact, dataKey: 'stockTemporalImpact' },
    { value: 'Industry Temporal Impact', color: COLORS.industryTemporalImpact, dataKey: 'industryTemporalImpact' },
    { value: 'Market Temporal Impact', color: COLORS.marketTemporalImpact, dataKey: 'marketTemporalImpact' },
    { value: 'Master Temporal Impact', color: COLORS.masterTemporalImpact, dataKey: 'masterTemporalImpact' },
    { value: 'Stock Velocity', color: COLORS.stockTemporalImpact, dataKey: 'stockVelocity' },
    { value: 'Stock Acceleration', color: COLORS.stockTemporalImpact, dataKey: 'stockAcceleration' },
    { value: 'Industry Velocity', color: COLORS.industryTemporalImpact, dataKey: 'industryVelocity' },
    { value: 'Industry Acceleration', color: COLORS.industryTemporalImpact, dataKey: 'industryAcceleration' },
    { value: 'Market Velocity', color: COLORS.marketTemporalImpact, dataKey: 'marketVelocity' },
    { value: 'Market Acceleration', color: COLORS.marketTemporalImpact, dataKey: 'marketAcceleration' },
    { value: 'Master Velocity', color: COLORS.masterTemporalImpact, dataKey: 'masterVelocity' },
    { value: 'Master Acceleration', color: COLORS.masterTemporalImpact, dataKey: 'masterAcceleration' },
    { value: 'Stock Price', color: COLORS.stockPrice, dataKey: 'stockPrice' },
    { value: 'Price Point Labels', color: COLORS.latestPrice, dataKey: 'stockPriceBubbles' },
    { value: 'Volume', color: COLORS.volume, dataKey: 'volume' },
    { value: 'Stock Article Count', color: COLORS.stockArticleCount, dataKey: 'stockArticleCount' },
    { value: 'Industry Article Count', color: COLORS.industryArticleCount, dataKey: 'industryArticleCount' },
    { value: 'Market Article Count', color: COLORS.marketArticleCount, dataKey: 'marketArticleCount' }
  ];

  if (selectedMarketIndex && MARKET_INDICES.INFO[selectedMarketIndex]) {
    items.push({
      value: MARKET_INDICES.INFO[selectedMarketIndex].name,
      color: MARKET_INDICES.INFO[selectedMarketIndex].color,
      dataKey: 'marketIndex'
    });
  }

  items.push(
    { value: 'Market Sessions', color: COLORS.marketRegularBg, dataKey: 'marketSessions' },
    { value: 'Current Time', color: COLORS.currentTimeLine, dataKey: 'currentTimeLine' }
  );

  return items;
};

export const calculateTimeRangeFromData = (dataArrays) => {
  let min = Infinity, max = -Infinity;

  dataArrays.forEach(data => {
    if (Array.isArray(data) && data.length > 0) {
      data.forEach(item => {
        if (item && item.timestamp) {
          min = Math.min(min, item.timestamp);
          max = Math.max(max, item.timestamp);
        }
      });
    }
  });

  return min !== Infinity && max !== -Infinity ?
    { min, max } :
    { min: getCurrentTime().getTime() - 7 * 24 * 60 * 60 * 1000, max: getCurrentTime().getTime() };
};