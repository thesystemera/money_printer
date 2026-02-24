import { TrendingUp, TrendingDown, Info, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { showToast, handleError } from '../services/socketService';
import { RECOMMENDATION_STYLES, CHART_STYLING } from '../config/Config';
import { getCurrentTime } from '../services/timeService';

const styleCache = {};

const normalizeVolatilityRange = (volatilityInput) => {
  if (volatilityInput === null || volatilityInput === undefined) return null;
  if (typeof volatilityInput === 'number') return Math.abs(volatilityInput);
  if (typeof volatilityInput === 'string') {
    const clean = volatilityInput.replace(/[±+\-\s%]/g, '');
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? null : Math.abs(parsed);
  }
  return null;
};

const parseContent = (text) => {
    if (!text) return [];

    const tableBlockRegex = /((?:^\s*\|.*\|\s*$\n?)+)/gm;
    const parts = text.split(tableBlockRegex).filter(p => p && p.trim() !== '');

    const blocks = [];

    for (const part of parts) {
        const lines = part.trim().split('\n');
        const isPotentialTable = lines.length > 1 &&
            lines.every(line => line.trim().startsWith('|') && line.trim().endsWith('|'));

        if (!isPotentialTable) {
            if (part.trim()) {
              blocks.push({ type: 'paragraph', content: part.trim() });
            }
            continue;
        }

        const separatorIndex = lines.findIndex(line => /^\s*\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|/.test(line.trim()));

        if (separatorIndex === 1) {
            try {
                const headers = lines[0].split('|').slice(1, -1).map(h => h.trim());
                const rows = lines.slice(2).map(rowLine =>
                    rowLine.split('|').slice(1, -1).map(c => c.trim())
                );

                if (headers.length > 0 && rows.every(r => r.length === headers.length)) {
                    blocks.push({ type: 'table', data: { headers, rows } });
                } else {
                    blocks.push({ type: 'paragraph', content: part.trim() });
                }
            } catch (e) {
                blocks.push({ type: 'paragraph', content: part.trim() });
            }
        } else {
            blocks.push({ type: 'paragraph', content: part.trim() });
        }
    }
    return blocks;
};

class PredictionDataAdapter {
  static normalizeHourlyPredictions(hourlyPrices) {
    if (!hourlyPrices || !Array.isArray(hourlyPrices)) return [];
    return hourlyPrices.map(prediction => {
      if (typeof prediction !== 'object') return null;
      const normalized = {
        hour: prediction.hour || '',
        price: parseFloat(prediction.price || 0),
        session: (prediction.session || '').toLowerCase()
      };
      const volRange = normalizeVolatilityRange(prediction.volatility_range);
      if (volRange !== null) {
        normalized.volatility_range = volRange;
      }
      return normalized;
    }).filter(Boolean);
  }

  static getMasterPredictions(recommendation) {
    if (!recommendation) return null;

    const modelPredictions = recommendation.model_predictions || {};
    if (modelPredictions.master) {
      const master = modelPredictions.master;
      return {
        hourlyPrices: this.normalizeHourlyPredictions(master.hourlyPrices || []),
        marketOpen: master.marketOpen,
        marketClose: master.marketClose,
        marketTiming: master.marketTiming || ''
      };
    }

    const predictions = recommendation.predictions || {};
    if (predictions.nextTradingDay) {
      const nextTradingDay = predictions.nextTradingDay;
      return {
        hourlyPrices: this.normalizeHourlyPredictions(nextTradingDay.hourlyPrices || []),
        marketOpen: nextTradingDay.marketOpen,
        marketClose: nextTradingDay.marketClose,
        marketTiming: nextTradingDay.marketTiming || ''
      };
    }
    return null;
  }

  static getAllModelPredictions(recommendation) {
    if (!recommendation) return {};

    const result = {};
    const modelPredictions = recommendation.model_predictions || {};

    const master = this.getMasterPredictions(recommendation);
    if (master) result.master = master;

    ['image', 'options', 'vibe', 'revised'].forEach(modelType => {
      if (modelPredictions[modelType]) {
        const modelData = modelPredictions[modelType];
        result[modelType] = {
          hourlyPrices: this.normalizeHourlyPredictions(modelData.hourlyPrices || []),
          marketOpen: modelData.marketOpen,
          marketClose: modelData.marketClose,
          marketTiming: modelData.marketTiming || ''
        };
      }
    });

    const revisedPredictions = recommendation.revised_predictions;
    if (revisedPredictions?.nextTradingDay) {
      const nextTradingDay = revisedPredictions.nextTradingDay;
      result.revised = {
        hourlyPrices: this.normalizeHourlyPredictions(nextTradingDay.hourlyPrices || []),
        marketOpen: nextTradingDay.marketOpen,
        marketClose: nextTradingDay.marketClose,
        marketTiming: nextTradingDay.marketTiming || ''
      };
    }

    return result;
  }

  static parseHourlyPredictionsFromText(analysisText) {
    if (!analysisText) return [];

    const hourlySection = analysisText.match(/HOURLY PRICE PREDICTIONS[^\]]*\]([\s\S]*?)(?=\n\s*\[|$)/i);
    if (!hourlySection || !hourlySection[1]) return [];

    const hourlyContent = hourlySection[1].trim();
    const hourlyPredictions = [];

    const patterns = [
      /[-•]\s*(\d{1,2}:\d{2}):\s*\$(\d+\.\d+)\s*\([±+\-]?(\d+\.\d+)%\)\s*\(([^)]+)\)/g,
      /[-•]\s*(\d{1,2}:\d{2}):\s*\$(\d+\.\d+)\s*\(([^)]+)\)/g,
      /[-•]\s*(\d{1,2}:\d{2}):\s*\$(\d+\.\d+)/g
    ];

    for (let i = 0; i < patterns.length; i++) {
      const matches = [...hourlyContent.matchAll(patterns[i])];
      if (matches.length > 0) {
        matches.forEach(match => {
          try {
            if (i === 0) {
              const [, hour, price, volatility, session] = match;
              hourlyPredictions.push({
                hour,
                price: parseFloat(price),
                volatility_range: normalizeVolatilityRange(volatility),
                session: session.trim().toLowerCase()
              });
            } else if (i === 1) {
              const [, hour, price, session] = match;
              hourlyPredictions.push({
                hour,
                price: parseFloat(price),
                session: session.trim().toLowerCase()
              });
            } else {
              const [, hour, price] = match;
              hourlyPredictions.push({
                hour,
                price: parseFloat(price)
              });
            }
          } catch (e) {
            console.warn('Error parsing hourly prediction:', e);
          }
        });
        break;
      }
    }

    return hourlyPredictions;
  }
}

class ConfidenceUtils {
  static getConfidenceData(stock) {
    if (!stock) return { buy: 0, hold: 0, sell: 0 };

    const original = this.normalizeConfidence(stock.confidence, stock.action);
    const revisedConfidence = stock.revisedConfidence;
    const revised = revisedConfidence ? this.normalizeConfidence(revisedConfidence) : null;

    return {
      original,
      revised,
      active: revised || original,
      hasRevision: !!revised
    };
  }

  static normalizeConfidence(confidence, fallbackAction = null) {
    if (typeof confidence === 'object' && confidence !== null) {
      return {
        buy: confidence.buy || 0,
        hold: confidence.hold || 0,
        sell: confidence.sell || 0
      };
    }

    if (typeof confidence === 'number' && fallbackAction) {
      const action = fallbackAction.toLowerCase();
      return {
        buy: action === 'buy' ? confidence : 0,
        hold: action === 'hold' ? confidence : 0,
        sell: action === 'sell' ? confidence : 0
      };
    }

    return { buy: 0, hold: 0, sell: 0 };
  }
}

class StyleSystem {
  static getRecommendationData(rec) {
    const cacheKey = `rec-${rec}`;
    if (styleCache[cacheKey]) return styleCache[cacheKey];

    const styles = {
      BUY: { color: 'green', icon: TrendingUp },
      SELL: { color: 'red', icon: TrendingDown },
      HOLD: { color: 'yellow', icon: Info },
      ERROR: { color: 'gray', icon: AlertTriangle }
    };

    const result = styles[rec] || styles.ERROR;
    styleCache[cacheKey] = result;
    return result;
  }

  static getRecommendationColor(rec) {
    return this.getRecommendationData(rec).color;
  }

  static getRecommendationIcon(rec) {
    return this.getRecommendationData(rec).icon;
  }

  static getVolatilityColor(vol) {
    const cacheKey = `vol-${vol}`;
    if (styleCache[cacheKey]) return styleCache[cacheKey];
    const volatilityColors = { HIGH: 'red', MEDIUM: 'yellow', LOW: 'green' };
    const result = volatilityColors[vol?.toUpperCase()] || 'gray';
    styleCache[cacheKey] = result;
    return result;
  }

  static getSectionColors(colorMode) {
    const cacheKey = `sectionColors-${colorMode}`;
    if (styleCache[cacheKey]) return styleCache[cacheKey];

    const result = {
      panelBg: colorMode === 'dark' ? 'gray.800' : 'white',
      borderColor: colorMode === 'dark' ? 'gray.700' : 'gray.200',
      textColor: colorMode === 'dark' ? 'gray.400' : 'gray.600',
      highlightBg: colorMode === 'dark' ? 'blue.900' : 'blue.50'
    };

    styleCache[cacheKey] = result;
    return result;
  }

  static getSessionColors(colorMode) {
    const cacheKey = `sessionColors-${colorMode}`;
    if (styleCache[cacheKey]) return styleCache[cacheKey];

    const { sessionColors } = RECOMMENDATION_STYLES;
    const result = {
      preMarket: {
        bg: colorMode === 'dark' ? sessionColors.preMarket.darkBg : sessionColors.preMarket.lightBg,
        border: colorMode === 'dark' ? sessionColors.preMarket.border.dark : sessionColors.preMarket.border.light,
        text: colorMode === 'dark' ? sessionColors.preMarket.text.dark : sessionColors.preMarket.text.light
      },
      marketOpen: {
        bg: colorMode === 'dark' ? sessionColors.marketOpen.darkBg : sessionColors.marketOpen.lightBg,
        border: colorMode === 'dark' ? sessionColors.marketOpen.border.dark : sessionColors.marketOpen.border.light,
        text: colorMode === 'dark' ? sessionColors.marketOpen.text.dark : sessionColors.marketOpen.text.light
      },
      marketClose: {
        bg: colorMode === 'dark' ? sessionColors.marketClose.darkBg : sessionColors.marketClose.lightBg,
        border: colorMode === 'dark' ? sessionColors.marketClose.border.dark : sessionColors.marketClose.border.light,
        text: colorMode === 'dark' ? sessionColors.marketClose.text.dark : sessionColors.marketClose.text.light
      },
      afterHours: {
        bg: colorMode === 'dark' ? sessionColors.afterHours.darkBg : sessionColors.afterHours.lightBg,
        border: colorMode === 'dark' ? sessionColors.afterHours.border.dark : sessionColors.afterHours.border.light,
        text: colorMode === 'dark' ? sessionColors.afterHours.text.dark : sessionColors.afterHours.text.light
      },
      returnBox: {
        bg: colorMode === 'dark' ? sessionColors.returnBox.darkBg : sessionColors.returnBox.lightBg,
        border: colorMode === 'dark' ? sessionColors.returnBox.border.dark : sessionColors.returnBox.border.light,
        text: colorMode === 'dark' ? sessionColors.returnBox.text.dark : sessionColors.returnBox.text.light
      }
    };

    styleCache[cacheKey] = result;
    return result;
  }

  static getUnifiedSessionStyles(colorMode) {
    const cacheKey = `unifiedStyles-${colorMode}`;
    if (styleCache[cacheKey]) return styleCache[cacheKey];

    const sessionColors = this.getSessionColors(colorMode);
    const result = {
      preMarket: {
        bg: sessionColors.preMarket.bg,
        border: sessionColors.preMarket.border,
        color: sessionColors.preMarket.text,
        watermarkOpacity: 0.2
      },
      regular: {
        bg: sessionColors.marketOpen.bg,
        border: sessionColors.marketOpen.border,
        color: sessionColors.marketOpen.text,
        watermarkOpacity: 0.2
      },
      marketClose: {
        bg: sessionColors.marketClose.bg,
        border: sessionColors.marketClose.border,
        color: sessionColors.marketClose.text,
        watermarkOpacity: 0.2
      },
      afterHours: {
        bg: sessionColors.afterHours.bg,
        border: sessionColors.afterHours.border,
        color: sessionColors.afterHours.text,
        watermarkOpacity: 0.2
      }
    };

    styleCache[cacheKey] = result;
    return result;
  }
}

export const getRecommendationColor = StyleSystem.getRecommendationColor.bind(StyleSystem);
export const getRecommendationIcon = StyleSystem.getRecommendationIcon.bind(StyleSystem);
export const getVolatilityColor = StyleSystem.getVolatilityColor.bind(StyleSystem);
export const getSectionColors = StyleSystem.getSectionColors.bind(StyleSystem);
export const getUnifiedSessionStyles = StyleSystem.getUnifiedSessionStyles.bind(StyleSystem);

export const getChartConfig = (colorMode) => ({
  cartesianGrid: { strokeDasharray: "3 3", opacity: 0.3 },
  tooltip: {
    bg: colorMode === 'dark' ? 'gray.800' : 'white',
    borderColor: colorMode === 'dark' ? 'gray.700' : 'gray.200',
    boxShadow: "md",
    transition: CHART_STYLING.animation.enabled ? 'all 0.2s' : 'none'
  },
  animation: {
    isActive: CHART_STYLING.animation.enabled,
    duration: CHART_STYLING.animation.duration,
    easing: CHART_STYLING.animation.easing
  },
  line: {
    regular: {
      strokeWidth: CHART_STYLING.lines.regular.strokeWidth,
      dot: { r: CHART_STYLING.points.regular.r },
      activeDot: { r: CHART_STYLING.points.highlight.r }
    },
    highlight: {
      strokeWidth: CHART_STYLING.lines.highlight.strokeWidth,
      dot: { r: CHART_STYLING.points.highlight.r },
      activeDot: { r: CHART_STYLING.points.highlight.r + 1 }
    },
    dashed: { strokeDasharray: CHART_STYLING.lines.dashed.strokeDasharray }
  }
});

export const getAccuracyDetails = (actual, predicted) => {
  if (!actual || !predicted) return null;

  const diff = actual - predicted;
  const percentDiff = (diff / predicted) * 100;
  const absPercentDiff = Math.abs(percentDiff);

  let icon, colorScheme, isGood;
  if (absPercentDiff < 2) {
    icon = CheckCircle;
    colorScheme = 'green';
    isGood = true;
  } else if (absPercentDiff < 5) {
    icon = AlertTriangle;
    colorScheme = 'yellow';
    isGood = false;
  } else {
    icon = X;
    colorScheme = 'red';
    isGood = false;
  }

  return {
    diff,
    percentDiff,
    formattedPercent: `${percentDiff > 0 ? '+' : ''}${percentDiff.toFixed(2)}%`,
    icon,
    colorScheme,
    isGood
  };
};

export const processChartData = (recommendation) => {
  const masterPredictions = PredictionDataAdapter.getMasterPredictions(recommendation);
  if (!masterPredictions?.hourlyPrices?.length) return [];

  try {
    return masterPredictions.hourlyPrices
      .map((item, idx) => ({
        hour: item.hour,
        price: item.price,
        volatility_range: item.volatility_range,
        session: item.session,
        id: `price-prediction-${idx}`
      }))
      .sort((a, b) => {
        const hourA = parseInt(a.hour.split(':')[0]);
        const hourB = parseInt(b.hour.split(':')[0]);
        return hourA - hourB;
      });
  } catch (error) {
    console.error("Error processing chart data:", error);
    return [];
  }
};

export const calculatePercentage = (current, reference) => {
  if (!current || !reference) return null;
  return ((current - reference) / reference) * 100;
};

export const groupPredictionsBySession = (predictions) => {
  if (!predictions || !Array.isArray(predictions))
    return { preMarket: [], regular: [], afterHours: [] };

  const sorted = [...predictions].sort((a, b) => {
    const [hourA, minuteA] = a.hour.split(':').map(Number);
    const [hourB, minuteB] = b.hour.split(':').map(Number);
    return hourA === hourB ? minuteA - minuteB : hourA - hourB;
  });

  return {
    preMarket: sorted.filter(p => p.session.toLowerCase().includes('pre-market')),
    regular: sorted.filter(p =>
      p.session.toLowerCase().includes('regular') ||
      p.session.toLowerCase().includes('market open') ||
      p.session.toLowerCase().includes('market close')),
    afterHours: sorted.filter(p => p.session.toLowerCase().includes('after-hours'))
  };
};

export const getHourlyTicks = () => {
  const ticks = [];
  for (let hour = 4; hour <= 20; hour++) {
    ticks.push({ time: `${hour}:00`, label: hour });
  }
  ticks.push({ time: "09:30", label: "9:30" });
  return ticks.sort((a, b) => {
    const [hourA, minuteA = 0] = a.time.split(':').map(Number);
    const [hourB, minuteB = 0] = b.time.split(':').map(Number);
    return (hourA * 60 + minuteA) - (hourB * 60 + minuteB);
  });
};

export const getTimeInMillis = (timeString) => {
  const timeMatch = timeString.match(/T(\d{2}):(\d{2}):/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    return (hours * 3600000) + (minutes * 60000);
  }
  const predTime = new Date(timeString);
  return (predTime.getHours() * 3600000) + (predTime.getMinutes() * 60000);
};

export const getCurrentTimeInMillis = () => {
  const now = getCurrentTime();
  const etOffsetHours = now.getTimezoneOffset() / 60 - (getCurrentTime().getTimezoneOffset() > 4*60 ? 5 : 4);
  let etHours = now.getHours() + etOffsetHours;
  if (etHours < 0) etHours += 24;
  if (etHours >= 24) etHours -= 24;
  return (etHours * 3600000) + (now.getMinutes() * 60000);
};

export const extractKeyPredictions = (hourlyPredictions) => {
  return {
    preMarket: hourlyPredictions
      .filter(p => p.session.includes('pre-market'))
      .sort((a, b) => parseInt(a.hour) - parseInt(b.hour))[0],
    marketOpen: hourlyPredictions.find(p => p.hour === "09:30" || p.session.includes('market open')),
    marketClose: hourlyPredictions.find(p => p.hour === "16:00" || p.session.includes('market close')),
    afterHours: hourlyPredictions
      .filter(p => p.session.includes('after-hours'))
      .sort((a, b) => parseInt(b.hour) - parseInt(a.hour))[0]
  };
};

export const formatChartData = (predictionData, actualData) => {
  const formattedPredictions = predictionData.map(prediction => {
    const [hourStr, minuteStr] = prediction.hour.split(':');
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr || '0', 10);
    const timestamp = hour * 3600000 + minute * 60000;

    return {
      ...prediction,
      timestamp,
      isMarketOpen: prediction.hour === "09:30" || prediction.session.includes('market open'),
      isMarketClose: prediction.hour === "16:00" || prediction.session.includes('market close'),
      isPrediction: true
    };
  }).sort((a, b) => a.timestamp - b.timestamp);

  const formattedActual = actualData && actualData.length > 0
    ? actualData.map(dataPoint => {
        const date = new Date(dataPoint.timestamp);
        const hour = date.getUTCHours() - 4;
        const minute = date.getUTCMinutes();
        const timestamp = hour * 3600000 + minute * 60000;

        return {
          ...dataPoint,
          timestamp,
          isActual: true
        };
      }).sort((a, b) => a.timestamp - b.timestamp)
    : [];

  return { predictionData: formattedPredictions, actualData: formattedActual };
};

export const findClosestActualData = (targetHour, actualPriceData, timeWindow = {}) => {
  if (!actualPriceData || actualPriceData.length === 0) return null;

  const [hour, minute] = targetHour.split(':').map(Number);
  const targetTimeMs = (hour * 60 + minute) * 60 * 1000;

  let filteredData = [...actualPriceData];

  if (timeWindow.start !== undefined && timeWindow.end !== undefined) {
    filteredData = filteredData.filter(d => {
      const date = new Date(d.timestamp);
      const h = (date.getUTCHours() - 4);
      return h >= timeWindow.start && h <= timeWindow.end;
    });
  }

  return filteredData
    .sort((a, b) => {
      const aTime = new Date(a.timestamp);
      const bTime = new Date(b.timestamp);
      const aMin = (aTime.getUTCHours() - 4) * 60 + aTime.getUTCMinutes();
      const bMin = (bTime.getUTCHours() - 4) * 60 + bTime.getUTCMinutes();
      return Math.abs((aMin * 60 * 1000) - targetTimeMs) - Math.abs((bMin * 60 * 1000) - targetTimeMs);
    })
    .find(Boolean);
};

export const processAnalysisText = (analysisText) => {
  if (!analysisText) return { sections: [], paragraphs: [] };

  const sections = [];
  const sectionRegex = /\[([A-Z\s_&\d:()-]+)\]([\s\S]*?)(?=\n\s*\[[A-Z\s_&\d:()-]+\]|$)/g;
  let match;
  let lastIndex = 0;

  while ((match = sectionRegex.exec(analysisText)) !== null) {
    sections.push({
      title: match[1].trim(),
      content: parseContent(match[2].trim())
    });
    lastIndex = match.index + match[0].length;
  }

  let remainingText = analysisText.substring(lastIndex);
  if (sections.length === 0) {
    remainingText = analysisText;
  }

  const paragraphs = sections.length === 0 && remainingText.trim()
    ? parseContent(remainingText.trim())
    : [];

  return { sections, paragraphs };
};

export const downloadRawData = (rawData, companyInfo, toast) => {
  if (!rawData) {
    showToast(toast, {
      title: 'No data available',
      description: 'There is no data available to download',
      status: 'warning'
    });
    return;
  }

  try {
    const filename = `${companyInfo?.symbol || 'stock'}-analysis-data.json`;
    const dataStr = JSON.stringify(rawData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 100);

    showToast(toast, {
      title: 'Data downloaded',
      description: `File saved as ${filename}`,
      status: 'success'
    });
  } catch (error) {
    handleError(error, 'Downloading raw data', toast);
  }
};

export { PredictionDataAdapter, ConfidenceUtils, StyleSystem, normalizeVolatilityRange };