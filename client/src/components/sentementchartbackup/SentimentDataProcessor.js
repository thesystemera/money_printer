import { getTimestamp, getCurrentTime } from '../services/timeService';
import { extractMarketSessionAreas, extractKeyPricePoints, calculateTimeRangeFromData } from './SentimentChartUtils';
import { DEFAULT_DATA_SETTINGS, DEFAULT_TEMPORAL_PARAMETERS, DEFAULT_SENTIMENT_WEIGHTS } from '../config/Config';

const parseDate = item => {
  try {
    if (item.date instanceof Date) return item.date;
    if (item.date) { const d = new Date(item.date); if (!isNaN(d.getTime())) return d; }
    if (item.publishedDate) { const d = new Date(item.publishedDate); if (!isNaN(d.getTime())) return d; }
    throw new Error('Missing or invalid date');
  } catch (e) { return null; }
};

const calculateDerivatives = (timeSeriesData) => {
  if (!timeSeriesData || timeSeriesData.length < 2) {
    return timeSeriesData.map(p => ({ ...p, velocity: 0, acceleration: 0 }));
  }

  const dataWithVelocity = timeSeriesData.map((point, i, arr) => {
    if (i === 0) return { ...point, velocity: 0 };
    const prevPoint = arr[i-1];
    const deltaValue = point.sentimentRollingAvg - prevPoint.sentimentRollingAvg;
    const deltaTime = point.timestamp - prevPoint.timestamp;
    const velocity = deltaTime > 0 ? (deltaValue / deltaTime) * (24 * 60 * 60 * 1000) : 0;
    return { ...point, velocity };
  });

  return dataWithVelocity.map((point, i, arr) => {
    if (i === 0) return { ...point, acceleration: 0 };
    const prevPoint = arr[i-1];
    const deltaVelocity = point.velocity - prevPoint.velocity;
    const deltaTime = point.timestamp - prevPoint.timestamp;
    const acceleration = deltaTime > 0 ? (deltaVelocity / deltaTime) * (24 * 60 * 60 * 1000) : 0;
    return { ...point, acceleration };
  });
};

const normalizeAndSmoothDerivatives = (timeSeriesData, smoothingWindow) => {
    const MAX_EXPECTED_VELOCITY = 2.0;
    const MAX_EXPECTED_ACCELERATION = 4.0;

    const normalized = timeSeriesData.map(point => {
        const normV = point.velocity / MAX_EXPECTED_VELOCITY;
        const normA = point.acceleration / MAX_EXPECTED_ACCELERATION;
        return {
            ...point,
            normalizedVelocity: Math.max(-1, Math.min(1, normV)),
            normalizedAcceleration: Math.max(-1, Math.min(1, normA))
        };
    });

    if (smoothingWindow <= 1) {
        return normalized;
    }

    const smooth = (data, key) => {
        const smoothedValues = [];
        for (let i = 0; i < data.length; i++) {
            if (i < smoothingWindow - 1) {
                smoothedValues.push(data[i][key]);
            } else {
                const window = data.slice(i - smoothingWindow + 1, i + 1);
                const sum = window.reduce((acc, curr) => acc + curr[key], 0);
                smoothedValues.push(sum / smoothingWindow);
            }
        }
        return data.map((point, i) => ({...point, [key]: smoothedValues[i]}));
    };

    let result = smooth(normalized, 'normalizedVelocity');
    result = smooth(result, 'normalizedAcceleration');

    return result;
};

const insertMarketBreaks = (sortedData, tradingCalendar = null, dataType = "stock") => {
  if (!sortedData || sortedData.length === 0) return sortedData;
  if (!tradingCalendar || !Array.isArray(tradingCalendar) || tradingCalendar.length === 0) {
    return insertSimpleBreaks(sortedData, dataType);
  }

  const startDate = new Date(sortedData[0].timestamp);
  const endDate = new Date(sortedData[sortedData.length - 1].timestamp);
  const sessionAreas = extractMarketSessionAreas(sortedData, tradingCalendar, startDate, endDate);

  const isInAnySession = (timestamp) => {
    return sessionAreas.some(area => timestamp >= area.start && timestamp <= area.end);
  };

  const result = [];
  let lastSessionEnd = null;

  for (let i = 0; i < sortedData.length; i++) {
    const point = sortedData[i];

    if (isInAnySession(point.timestamp)) {
      const currentSession = sessionAreas.find(area =>
        point.timestamp >= area.start && point.timestamp <= area.end
      );

      if (lastSessionEnd && currentSession && point.timestamp > lastSessionEnd + 60000) {
        result.push({
          timestamp: lastSessionEnd + 1000,
          date: new Date(lastSessionEnd + 1000),
          price: null,
          originalPrice: null,
          volume: null,
          isBreak: true,
          dataType
        });

        result.push({
          timestamp: currentSession.start - 1000,
          date: new Date(currentSession.start - 1000),
          price: null,
          originalPrice: null,
          volume: null,
          isBreak: true,
          dataType
        });
      }

      result.push(point);

      if (currentSession) {
        lastSessionEnd = currentSession.end;
      }
    }
  }

  return result;
};

const insertSimpleBreaks = (sortedData, dataType = "stock") => {
  const result = [];
  const GAP_THRESHOLD = 12 * 60 * 60 * 1000;

  for (let i = 0; i < sortedData.length; i++) {
    const point = sortedData[i];
    result.push(point);

    if (i < sortedData.length - 1) {
      const nextPoint = sortedData[i + 1];
      const timeDiff = nextPoint.timestamp - point.timestamp;

      if (timeDiff > GAP_THRESHOLD) {
        result.push({
          ...point,
          timestamp: point.timestamp + 60000,
          price: null,
          originalPrice: null,
          volume: null,
          isBreak: true,
          dataType
        });
        result.push({
          ...nextPoint,
          timestamp: nextPoint.timestamp - 60000,
          price: null,
          originalPrice: null,
          volume: null,
          isBreak: true,
          dataType
        });
      }
    }
  }

  return result;
};

export const processSentimentData = (sentimentData, weights) => {
  if (!Array.isArray(sentimentData) || !sentimentData.length) return [];
  const { sentimentWeight, influenceWeight, certaintyWeight } = weights;
  try {
    return sentimentData
      .map(item => {
        if (item.sentiment === undefined || item.sentiment === null) return null;
        const dateObj = parseDate(item);
        if (!dateObj) return null;

        const sentiment = item.sentiment;
        const influence = item.influence !== undefined ? item.influence : 1;
        const certaintyScore = item.certaintyScore !== undefined ? item.certaintyScore : 1;

        const influenceFactor = 1 + (influence - 1) * influenceWeight;
        const certaintyFactor = 1 + (certaintyScore - 1) * certaintyWeight;

        const adjustedSentiment = (sentiment * sentimentWeight) * influenceFactor * certaintyFactor;

        return {
          date: dateObj, timestamp: dateObj.getTime(), sentiment: item.sentiment,
          influence: item.influence, propagationSpeed: item.propagationSpeed,
          impactDuration: item.impactDuration, temporalOrientation: item.temporalOrientation,
          title: item.title, matchedKeyword: item.matchedKeyword,
          isMarketSentiment: !!item.isMarketSentiment,
          isIndustrySentiment: !!item.isIndustrySentiment,
          adjustedSentiment: adjustedSentiment,
          originalSentiment: item.sentiment, originalInfluence: item.influence,
          originalTemporalOrientation: item.temporalOrientation,
          certaintyScore: item.certaintyScore,
          sourceCategory: item.sourceCategory
        };
      })
      .filter(item => item !== null)
      .sort((a, b) => a.timestamp - b.timestamp);
  } catch (error) { console.error('Failed to process sentiment data:', error); return []; }
};

const getTemporalMultiplier = (temporalOrientation = 0, pastWeight, futureWeight) => {
  if (temporalOrientation < 0) {
    return 1 - Math.abs(temporalOrientation) + (Math.abs(temporalOrientation) * pastWeight);
  } else if (temporalOrientation > 0) {
    return 1 - temporalOrientation + (temporalOrientation * futureWeight);
  }
  return 1.0;
};

export const calculateRollingAverage = (data, rollingAverageWindow, pastWeight = 1.0, futureWeight = 1.0) => {
  if (!Array.isArray(data) || !data.length || rollingAverageWindow <= 0) return [];

  try {
    const validData = data
      .filter(item => item.timestamp && item.adjustedSentiment !== undefined)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (!validData.length) return [];

    const result = new Array(validData.length);

    for (let i = 0; i < validData.length; i++) {
      const currentTime = validData[i].timestamp;
      let windowStart = i;

      while (windowStart > 0 && currentTime - validData[windowStart - 1].timestamp <= rollingAverageWindow) {
        windowStart--;
      }

      let weightedSum = 0, totalWeight = 0;

      for (let j = windowStart; j <= i; j++) {
        const item = validData[j];
        const timeDiff = currentTime - item.timestamp;
        const decayWeight = Math.max(0, 1 - (timeDiff / rollingAverageWindow));

        const temporalMultiplier = getTemporalMultiplier(item.originalTemporalOrientation, pastWeight, futureWeight);
        const finalWeight = decayWeight * temporalMultiplier;

        weightedSum += item.adjustedSentiment * finalWeight;
        totalWeight += finalWeight;
      }

      result[i] = {
        ...validData[i],
        sentimentRollingAvg: totalWeight > 0 ? weightedSum / totalWeight : null
      };
    }

    return result;
  } catch (error) {
    console.error('Error calculating rolling average:', error);
    return [];
  }
};


const createTimeIndex = (sortedData) => {
  const index = new Map();

  sortedData.forEach((item, idx) => {
    const timeKey = Math.floor(item.timestamp / (15 * 60 * 1000));
    if (!index.has(timeKey)) {
      index.set(timeKey, []);
    }
    index.get(timeKey).push({ ...item, originalIndex: idx });
  });

  return {
    getInRange: (startTime, endTime) => {
      const startKey = Math.floor(startTime / (15 * 60 * 1000));
      const endKey = Math.floor(endTime / (15 * 60 * 1000));
      const result = [];

      for (let key = startKey; key <= endKey; key++) {
        if (index.has(key)) {
          const items = index.get(key);
          for (const item of items) {
            if (item.timestamp >= startTime && item.timestamp <= endTime) {
              result.push(item);
            }
          }
        }
      }

      return result.sort((a, b) => a.timestamp - b.timestamp);
    }
  };
};

const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

const mergeSortedArrays = (arrays) => {
    const result = [];
    const pointers = new Array(arrays.length).fill(0);

    while (true) {
        let minTimestamp = Infinity;
        let minIndex = -1;

        for (let i = 0; i < arrays.length; i++) {
            if (pointers[i] < arrays[i].length) {
                if (arrays[i][pointers[i]].timestamp < minTimestamp) {
                    minTimestamp = arrays[i][pointers[i]].timestamp;
                    minIndex = i;
                }
            }
        }

        if (minIndex === -1) {
            break;
        }

        result.push(arrays[minIndex][pointers[minIndex]]);
        pointers[minIndex]++;
    }

    return result;
};

export const calculateCombinedRollingAverage = (stockData, marketData, industryData, rollingAverageWindow, pastWeight = 1.0, futureWeight = 1.0) => {
  if (rollingAverageWindow <= 0) return [];

  try {
    const { COLORS } = require('../config/Config');

    const allDataSources = [
        stockData.map(item => ({ ...item, sourceType: 'stock' })),
        marketData.map(item => ({ ...item, sourceType: 'market' })),
        industryData.map(item => ({ ...item, sourceType: 'industry' }))
    ].filter(arr => arr.length > 0);

    const allData = mergeSortedArrays(allDataSources);

    if (!allData.length) return [];

    const timePointsSet = new Set();
    allData.forEach(item => timePointsSet.add(item.timestamp));

    const sortedTimes = Array.from(timePointsSet).sort((a, b) => a - b);
    const timeStep = 5 * 60 * 1000;

    for (let i = 0; i < sortedTimes.length - 1; i++) {
      const start = sortedTimes[i];
      const end = sortedTimes[i + 1];
      const gap = end - start;

      if (gap > timeStep * 2) {
        for (let t = start + timeStep; t < end; t += timeStep) {
          timePointsSet.add(t);
        }
      }
    }

    const finalTimePoints = Array.from(timePointsSet).sort((a, b) => a - b);
    const timeIndex = createTimeIndex(allData);
    const result = [];
    let previousColorMixRatios = { stock: 0.33, market: 0.33, industry: 0.34 };

    const stockColor = hexToRgb(COLORS.stockSentimentRollingAvg);
    const marketColor = hexToRgb(COLORS.marketSentimentRollingAvg);
    const industryColor = hexToRgb(COLORS.industrySentimentRollingAvg);

    for (const currentTime of finalTimePoints) {
      const windowData = timeIndex.getInRange(currentTime - rollingAverageWindow, currentTime);

      if (windowData.length === 0) continue;

      const contributions = new Map([
        ['stock', []],
        ['market', []],
        ['industry', []]
      ]);
      const articleCounts = new Map([
        ['stock', 0],
        ['market', 0],
        ['industry', 0]
      ]);

      windowData.forEach(item => {
        const timeDiff = currentTime - item.timestamp;
        const decayWeight = Math.max(0, 1 - (timeDiff / rollingAverageWindow));
        const influence = item.influence || 1;

        const temporalMultiplier = getTemporalMultiplier(item.originalTemporalOrientation, pastWeight, futureWeight);
        const weightedSentiment = item.adjustedSentiment * decayWeight * temporalMultiplier;

        contributions.get(item.sourceType).push({
          value: weightedSentiment,
          weight: decayWeight,
          influence: influence
        });
        articleCounts.set(item.sourceType, articleCounts.get(item.sourceType) + 1);
      });

      let totalWeightedSentiment = 0;
      let totalWeight = 0;
      const sourceContributions = {};

      for (const [sourceType, sourceData] of contributions.entries()) {
        if (sourceData.length === 0) continue;

        let sourceWeightedSum = 0;
        let sourceWeight = 0;

        sourceData.forEach(item => {
          sourceWeightedSum += item.value * item.influence;
          sourceWeight += item.weight * item.influence;
        });

        if (sourceWeight > 0) {
          sourceContributions[sourceType] = {
            sentiment: sourceWeightedSum / sourceWeight,
            weight: sourceWeight,
            articleCount: articleCounts.get(sourceType),
            contribution: Math.abs(sourceWeightedSum)
          };

          totalWeightedSentiment += sourceWeightedSum;
          totalWeight += sourceWeight;
        }
      }

      if (totalWeight === 0) continue;

      const finalSentiment = totalWeightedSentiment / totalWeight;
      let dominantSource = 'stock';
      let maxContribution = 0;

      const rawColorMixRatios = { stock: 0, market: 0, industry: 0 };
      const totalContribution = Object.values(sourceContributions)
        .reduce((sum, contrib) => sum + contrib.contribution, 0);

      if (totalContribution > 0) {
        Object.keys(sourceContributions).forEach(sourceType => {
          const contrib = sourceContributions[sourceType];
          rawColorMixRatios[sourceType] = contrib.contribution / totalContribution;

          if (contrib.contribution > maxContribution) {
            maxContribution = contrib.contribution;
            dominantSource = sourceType;
          }
        });
      }

      const blendFactor = 0.3;
      const colorMixRatios = {
        stock: (rawColorMixRatios.stock * (1 - blendFactor)) + (previousColorMixRatios.stock * blendFactor),
        market: (rawColorMixRatios.market * (1 - blendFactor)) + (previousColorMixRatios.market * blendFactor),
        industry: (rawColorMixRatios.industry * (1 - blendFactor)) + (previousColorMixRatios.industry * blendFactor)
      };

      previousColorMixRatios = { ...colorMixRatios };

      const r = Math.round(
        stockColor.r * colorMixRatios.stock +
        marketColor.r * colorMixRatios.market +
        industryColor.r * colorMixRatios.industry
      );
      const g = Math.round(
        stockColor.g * colorMixRatios.stock +
        marketColor.g * colorMixRatios.market +
        industryColor.g * colorMixRatios.industry
      );
      const b = Math.round(
        stockColor.b * colorMixRatios.stock +
        marketColor.b * colorMixRatios.market +
        industryColor.b * colorMixRatios.industry
      );

      const precomputedColor = `rgb(${Math.max(0, Math.min(255, r))}, ${Math.max(0, Math.min(255, g))}, ${Math.max(0, Math.min(255, b))}`;

      const totalArticleCount = Array.from(articleCounts.values())
        .reduce((sum, count) => sum + count, 0);

      result.push({
        timestamp: currentTime,
        date: new Date(currentTime),
        sentimentRollingAvg: finalSentiment,
        dominantSource,
        colorMixRatios,
        precomputedColor,
        sourceContributions,
        totalArticleCount,
        dataPointCount: windowData.length,
        contributingArticlesCount: totalArticleCount,
        originalSentiment: finalSentiment,
        adjustedSentiment: finalSentiment
      });
    }

    return result;
  } catch (error) {
    console.error('Error calculating combined rolling average:', error);
    return [];
  }
};

export const calculateTemporalSentiment = (
  formattedData,
  rollingAverageWindow = DEFAULT_TEMPORAL_PARAMETERS.rollingAverageWindowMs,
  pastWeight = DEFAULT_TEMPORAL_PARAMETERS.pastWeight,
  futureWeight = DEFAULT_TEMPORAL_PARAMETERS.futureWeight,
  pastShiftHours = DEFAULT_TEMPORAL_PARAMETERS.pastShift,
  futureShiftHours = DEFAULT_TEMPORAL_PARAMETERS.futureShift,
  momentumBlend = DEFAULT_TEMPORAL_PARAMETERS.momentumBlend,
  externalNormalizationFactor = null,
  enableImpactNormalization = false
) => {
  if (!Array.isArray(formattedData) || !formattedData.length || rollingAverageWindow <= 0) return [];

  try {
    const sortedData = [...formattedData].sort((a, b) => a.timestamp - b.timestamp);
    const timeStep = 5 * 60 * 1000;
    if (!sortedData[0]?.timestamp || !sortedData[sortedData.length - 1]?.timestamp) return [];

    let averageLifespan = 24;
    if (enableImpactNormalization && sortedData.length > 0) {
        const totalLifespan = sortedData.reduce((sum, article) => {
            const propagation = article.propagationSpeed !== undefined ? article.propagationSpeed : 0;
            const duration = article.impactDuration !== undefined ? article.impactDuration : 0;
            return sum + propagation + duration;
        }, 0);
        if (totalLifespan > 0) {
            averageLifespan = totalLifespan / sortedData.length;
        }
    }

    const firstTime = sortedData[0].timestamp;
    const lastArticleTime = sortedData[sortedData.length - 1].timestamp;
    const maxImpactWindow = sortedData.reduce((max, article) => {
      const propagationHours = article.propagationSpeed !== undefined ? article.propagationSpeed : 0;
      const impactHours = article.impactDuration !== undefined ? article.impactDuration : 0;
      return Math.max(max, (propagationHours + impactHours) * 60 * 60 * 1000);
    }, 0);
    const lastTime = maxImpactWindow > 0 ? lastArticleTime + maxImpactWindow : lastArticleTime;

    const timePointsSet = new Set();
    const articleTimeMap = new Map();
    sortedData.forEach((article, index) => {
      if (article.timestamp) {
        timePointsSet.add(article.timestamp);
        articleTimeMap.set(article.timestamp, index);
      }
    });

    for (let t = firstTime; t <= lastTime; t += timeStep) {
      timePointsSet.add(t);
    }
    const finalTimeStamps = Array.from(timePointsSet).sort((a, b) => a - b);
    const timePoints = finalTimeStamps.map(t => ({
      timestamp: t,
      date: new Date(t),
      isArticleTime: articleTimeMap.has(t),
      articleIndex: articleTimeMap.get(t)
    }));

    const cumulativeImpacts = new Array(timePoints.length).fill(0);
    const contributingArticlesMap = new Array(timePoints.length).fill(0).map(() => new Set());

    sortedData.forEach((article, j) => {
      if (article.adjustedSentiment === undefined) return;

      const temporalMultiplier = getTemporalMultiplier(article.temporalOrientation, pastWeight, futureWeight);

      let timeShiftHours = 0;
      const temporalOrientation = article.temporalOrientation !== undefined ? article.temporalOrientation : 0;
      if (temporalOrientation < 0) {
        timeShiftHours = temporalOrientation * pastShiftHours;
      } else if (temporalOrientation > 0) {
        timeShiftHours = temporalOrientation * futureShiftHours;
      }

      if (temporalMultiplier <= 0) return;

      const timeShiftMs = timeShiftHours * 60 * 60 * 1000;
      const adjustedArticleTime = article.timestamp + timeShiftMs;
      const propagationSpeed = article.propagationSpeed !== undefined ? article.propagationSpeed : 0;
      const impactDuration = article.impactDuration !== undefined ? article.impactDuration : 0;

      if (propagationSpeed <= 0 && impactDuration <= 0) return;

      let adjustedSentimentValue = article.adjustedSentiment || 0;
      if (enableImpactNormalization) {
        const totalLifespan = propagationSpeed + impactDuration;
        if (totalLifespan > 0) {
            const normalizationFactor = averageLifespan / totalLifespan;
            adjustedSentimentValue *= normalizationFactor;
        }
      }

      const finalSentimentValue = adjustedSentimentValue * temporalMultiplier;
      if (Math.abs(finalSentimentValue) < 0.001) return;

      const impactEndTime = adjustedArticleTime + ((propagationSpeed + impactDuration) * 3600000);
      const startIndex = findClosestIndex(timePoints, adjustedArticleTime);
      const endIndex = findClosestIndex(timePoints, impactEndTime);

      for (let i = startIndex; i <= endIndex; i++) {
        const timePoint = timePoints[i];
        if (!timePoint) continue;
        const deltaT = (timePoint.timestamp - adjustedArticleTime) / (3600000);
        if (deltaT < 0) continue;

        const propagationFactor = propagationSpeed > 0 ? (1 / (1 + Math.exp(-8 * (deltaT / propagationSpeed - 0.5)))) : 1;

        let decayFactor = 1.0;
        if (deltaT > propagationSpeed) {
          if (impactDuration > 0) {
            const timeIntoDecay = deltaT - propagationSpeed;
            decayFactor = Math.max(0, 1 - (timeIntoDecay / impactDuration));
          } else {
            decayFactor = 0;
          }
        }

        const impact = finalSentimentValue * propagationFactor * decayFactor;

        if (Math.abs(impact) > 0.001) {
          cumulativeImpacts[i] += impact;
          contributingArticlesMap[i].add(article.id || j);
        }
      }
    });

    const result = [];
    let trendEma = 0;
    const period = (rollingAverageWindow / timeStep) || 1;
    const alpha = 2 / (period + 1);

    for (let i = 0; i < timePoints.length; i++) {
      const point = timePoints[i];
      const momentaryImpact = cumulativeImpacts[i];

      trendEma = (momentaryImpact * alpha) + (trendEma * (1 - alpha));
      const responsiveTrend = trendEma;

      const finalSentiment = (1 - momentumBlend) * momentaryImpact + momentumBlend * responsiveTrend;

      const impactPointData = point.isArticleTime && point.articleIndex !== undefined ? sortedData[point.articleIndex] : {};

      const resultPoint = {
        ...impactPointData,
        timestamp: point.timestamp,
        date: new Date(point.timestamp),
        sentimentRollingAvg: finalSentiment,
        impactMagnitude: Math.abs(momentaryImpact),
        contributingArticlesCount: contributingArticlesMap[i].size,
        isArticlePoint: point.isArticleTime,
        isMarketSentiment: formattedData.length > 0 && formattedData[0].isMarketSentiment,
        isIndustrySentiment: formattedData.length > 0 && formattedData[0].isIndustrySentiment,
      };
      result.push(resultPoint);
    }

    if (externalNormalizationFactor) {
      return result.map(p => ({
        ...p,
        sentimentRollingAvg: p.sentimentRollingAvg * externalNormalizationFactor,
        impactMagnitude: p.impactMagnitude * externalNormalizationFactor,
      }));
    }

    return result;
  } catch (error) {
    console.error('Error calculating temporal sentiment:', error);
    return [];
  }
};


const findClosestIndex = (sortedArray, targetTimestamp) => {
    let low = 0;
    let high = sortedArray.length - 1;
    let bestIndex = 0;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const midTime = sortedArray[mid]?.timestamp;

        if (midTime === undefined) {
          high = mid -1;
          continue;
        }

        if (midTime < targetTimestamp) {
            bestIndex = mid;
            low = mid + 1;
        } else if (midTime > targetTimestamp) {
            high = mid - 1;
        } else {
            return mid;
        }
    }
    return bestIndex;
};

export const processMarketData = (data, dataType = "stock", dataResolutionMinutes = DEFAULT_DATA_SETTINGS.dataResolutionMinutes, tradingCalendar = null) => {
  if (!Array.isArray(data) || !data.length) return [];
  try {
    const processedData = data.map(item => {
      if (!item.date && !item.timestamp) return null;
      let dateObj;
      if (item.date instanceof Date) dateObj = item.date;
      else if (item.timestamp) dateObj = new Date(item.timestamp);
      else if (item.date) dateObj = new Date(item.date);
      else return null;
      if (isNaN(dateObj.getTime())) return null;
      const price = item.price !== undefined ? item.price : item.close;
      if (price === undefined) return null;
      const dataPoint = {date: dateObj, timestamp: dateObj.getTime(), price, dataType, originalPrice: price};
      if (item.open !== undefined) dataPoint.open = item.open;
      if (item.high !== undefined) dataPoint.high = item.high;
      if (item.low !== undefined) dataPoint.low = item.low;
      if (item.volume !== undefined) dataPoint.volume = parseInt(item.volume);
      if (item.marketSession) dataPoint.marketSession = item.marketSession;

      if (item.basePrice !== undefined) dataPoint.basePrice = item.basePrice;
      if (item.stdDev !== undefined) dataPoint.stdDev = item.stdDev;

      return dataPoint;
    }).filter(dp => dp !== null);

    const sortedData = processedData.sort((a, b) => a.timestamp - b.timestamp);
    const dataWithBreaks = insertMarketBreaks(sortedData, tradingCalendar, dataType);

    if (dataResolutionMinutes > 1 && dataWithBreaks.length > 0) {
      const dataToResample = dataWithBreaks.filter(item => !item.isBreak);
      const breakPoints = dataWithBreaks.filter(item => item.isBreak);

      if (dataToResample.length === 0) return breakPoints;

      const resolutionMs = dataResolutionMinutes * 60 * 1000;
      const result = [];

      const sessionGroups = [];
      let currentSession = [];

      for (let i = 0; i < dataToResample.length; i++) {
        const point = dataToResample[i];
        if (currentSession.length === 0) {
          currentSession.push(point);
        } else {
          const timeDiff = point.timestamp - currentSession[currentSession.length - 1].timestamp;
          if (timeDiff > 4 * 60 * 60 * 1000) {
            sessionGroups.push(currentSession);
            currentSession = [point];
          } else {
            currentSession.push(point);
          }
        }
      }
      if (currentSession.length > 0) {
        sessionGroups.push(currentSession);
      }

      for (const session of sessionGroups) {
        if (session.length === 0) continue;

        const sessionStart = session[0].timestamp;
        const sessionEnd = session[session.length - 1].timestamp;
        const startBucket = Math.floor(sessionStart / resolutionMs) * resolutionMs;
        const endBucket = Math.floor(sessionEnd / resolutionMs) * resolutionMs;

        const buckets = new Map();
        session.forEach(item => {
          const bucketTime = Math.floor(item.timestamp / resolutionMs) * resolutionMs;
          if (!buckets.has(bucketTime)) {
            buckets.set(bucketTime, []);
          }
          buckets.get(bucketTime).push(item);
        });

        let lastValidPoint = null;

        for (let bucketTime = startBucket; bucketTime <= endBucket; bucketTime += resolutionMs) {
          const bucketData = buckets.get(bucketTime) || [];

          if (bucketData.length > 0) {
            const validPrices = bucketData.map(i => i.price).filter(p => p !== null && p !== undefined);
            const avgPrice = validPrices.length ? validPrices.reduce((sum, p) => sum + p, 0) / validPrices.length : null;

            const totalVolume = bucketData.reduce((sum, item) => sum + (item.volume || 0), 0);

            const sessions = new Map();
            bucketData.filter(item => item.marketSession).forEach(item => {
              sessions.set(item.marketSession, (sessions.get(item.marketSession) || 0) + 1);
            });

            let dominantSession = null, maxCount = 0;
            sessions.forEach((count, session) => {
              if (count > maxCount) { maxCount = count; dominantSession = session; }
            });

            let high = -Infinity, low = Infinity, hasHighLow = false;
            bucketData.forEach(item => {
              if (item.high !== undefined && item.high > high) { high = item.high; hasHighLow = true; }
              if (item.low !== undefined && item.low < low) { low = item.low; hasHighLow = true; }
            });

            const originalPrices = bucketData.map(i => i.originalPrice).filter(p => p !== null && p !== undefined);
            const avgOriginalPrice = originalPrices.length ?
                                   originalPrices.reduce((sum, p) => sum + p, 0) / originalPrices.length : null;

            const point = {
              timestamp: bucketTime + (resolutionMs / 2),
              date: new Date(bucketTime + (resolutionMs / 2)),
              price: avgPrice,
              dataType
            };

            if (avgOriginalPrice !== null) point.originalPrice = avgOriginalPrice;
            if (totalVolume > 0) point.volume = totalVolume;
            if (dominantSession) point.marketSession = dominantSession;
            if (hasHighLow) {
              if (high !== -Infinity) point.high = high;
              if (low !== Infinity) point.low = low;
            }

            const baselinePoint = bucketData.find(item => item.basePrice !== undefined);
            if (baselinePoint) {
              point.basePrice = baselinePoint.basePrice;
              point.stdDev = baselinePoint.stdDev;
            }

            result.push(point);
            lastValidPoint = point;
          } else if (lastValidPoint && bucketTime < sessionEnd) {
            const interpolatedPoint = {
              timestamp: bucketTime + (resolutionMs / 2),
              date: new Date(bucketTime + (resolutionMs / 2)),
              price: lastValidPoint.price,
              originalPrice: lastValidPoint.originalPrice,
              volume: 0,
              dataType,
              marketSession: lastValidPoint.marketSession
            };

            if (lastValidPoint.basePrice !== undefined) {
              interpolatedPoint.basePrice = lastValidPoint.basePrice;
              interpolatedPoint.stdDev = lastValidPoint.stdDev;
            }

            result.push(interpolatedPoint);
          }
        }

        const lastPoint = session[session.length - 1];
        const lastBucketEnd = endBucket + resolutionMs;
        if (lastPoint.timestamp > lastBucketEnd - resolutionMs && lastPoint.timestamp < lastBucketEnd) {
          const existingLastBucket = result.find(p => p.timestamp === endBucket + (resolutionMs / 2));
          if (!existingLastBucket) {
            result.push({
              timestamp: lastPoint.timestamp,
              date: new Date(lastPoint.timestamp),
              price: lastPoint.price,
              originalPrice: lastPoint.originalPrice,
              volume: lastPoint.volume || 0,
              dataType,
              marketSession: lastPoint.marketSession,
              ...(lastPoint.basePrice !== undefined && { basePrice: lastPoint.basePrice, stdDev: lastPoint.stdDev })
            });
          }
        }
      }

      return [...breakPoints, ...result].sort((a, b) => a.timestamp - b.timestamp);
    }

    return dataWithBreaks.sort((a, b) => a.timestamp - b.timestamp);
  } catch (error) {
    console.error('Error processing market data:', error);
    return [];
  }
};


export const processArticleCountData = (sentimentData, dataResolutionMinutes = DEFAULT_DATA_SETTINGS.dataResolutionMinutes, articleCountResolutionMinutes = DEFAULT_DATA_SETTINGS.articleCountResolutionMinutes) => {
  if (!Array.isArray(sentimentData) || sentimentData.length === 0) return [];

  try {
    const articlesWithDates = sentimentData
      .map(item => {
        const date = parseDate(item);
        return date ? { date, timestamp: date.getTime() } : null;
      })
      .filter(item => item !== null)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (articlesWithDates.length === 0) return [];

    const startTimestamp = articlesWithDates[0].timestamp;
    const endTimestamp = articlesWithDates[articlesWithDates.length - 1].timestamp;

    const result = [];
    const timeStep = dataResolutionMinutes * 60 * 1000;
    const windowSize = articleCountResolutionMinutes * 60 * 1000;

    for (let currentTime = startTimestamp; currentTime <= endTimestamp; currentTime += timeStep) {
      const windowStart = currentTime - windowSize;
      const windowEnd = currentTime;

      const articlesInWindow = articlesWithDates.filter(article =>
        article.timestamp >= windowStart && article.timestamp <= windowEnd
      );

      const articleCount = articlesInWindow.length;

      result.push({
        timestamp: currentTime,
        date: new Date(currentTime),
        articleCount: articleCount
      });
    }

    return result;
  } catch (error) {
    console.error('Error processing article count data:', error);
    return [];
  }
}

const calculateAverages = (stockSentimentData, marketSentimentData, industrySentimentData) => {
  const calculateWeightedAverage = (data) => {
    if (!data || !data.length) return null;
    const stats = data.reduce((acc, item) => {
      const weight = item.influence || 1;
      acc.sum += item.sentiment * weight;
      acc.weight += weight;
      return acc;
    }, {sum: 0, weight: 0});
    return stats.weight > 0 ? (stats.sum / stats.weight).toFixed(2) : null;
  };

  try {
    return {
      avgSentiment: calculateWeightedAverage(stockSentimentData) || 'N/A',
      avgMarketSentiment: calculateWeightedAverage(marketSentimentData),
      avgIndustrySentiment: calculateWeightedAverage(industrySentimentData)
    };
  } catch (error) {
    console.error('Error calculating averages:', error);
    return {avgSentiment: 'N/A', avgMarketSentiment: null, avgIndustrySentiment: null};
  }
};

const normalizeToZeroMean = (sentimentData) => {
  if (!Array.isArray(sentimentData) || sentimentData.length === 0) {
    return sentimentData;
  }

  const validAdjustedSentiments = sentimentData
    .filter(item => item.adjustedSentiment !== undefined && item.adjustedSentiment !== null)
    .map(item => item.adjustedSentiment);

  if (validAdjustedSentiments.length === 0) {
    return sentimentData;
  }

  const meanAdjustedSentiment = validAdjustedSentiments.reduce((sum, adjustedSentiment) => sum + adjustedSentiment, 0) / validAdjustedSentiments.length;

  return sentimentData.map(item => ({
    ...item,
    adjustedSentiment: item.adjustedSentiment !== undefined && item.adjustedSentiment !== null
      ? item.adjustedSentiment - meanAdjustedSentiment
      : item.adjustedSentiment
  }));
};

export const prepareChartData = ({stockSentimentData, marketSentimentData, industrySentimentData = [], stockPriceData, marketIndicesData, tradingCalendar = null, companyInfo = null, options = {}}) => {
  const {
    temporalPastWeight = DEFAULT_TEMPORAL_PARAMETERS.pastWeight,
    temporalFutureWeight = DEFAULT_TEMPORAL_PARAMETERS.futureWeight,
    temporalPastShift = DEFAULT_TEMPORAL_PARAMETERS.pastShift,
    temporalFutureShift = DEFAULT_TEMPORAL_PARAMETERS.futureShift,
    momentumBlend = DEFAULT_TEMPORAL_PARAMETERS.momentumBlend,
    rollingAverageWindow = DEFAULT_TEMPORAL_PARAMETERS.rollingAverageWindowMs,
    derivativeSmoothingWindow = DEFAULT_TEMPORAL_PARAMETERS.derivativeSmoothingWindow,
    dataResolutionMinutes = DEFAULT_DATA_SETTINGS.dataResolutionMinutes,
    articleCountResolution = DEFAULT_DATA_SETTINGS.articleCountResolutionMinutes,
    selectedMarketIndex = null,
    currentTimeWindow = null,
    futureWindowHours = DEFAULT_TEMPORAL_PARAMETERS.futureWindowHours,
    enableBiasNormalization = true,
    enableImpactNormalization = false,
    masterWeights = { stock: 1.0, market: 1.0, industry: 1.0 },
    sourceCategoryWeights = DEFAULT_SENTIMENT_WEIGHTS.sourceWeights,
    sentimentComponentWeights = DEFAULT_SENTIMENT_WEIGHTS.componentWeights
  } = options;

  try {
    const componentWeights = sentimentComponentWeights || DEFAULT_SENTIMENT_WEIGHTS.componentWeights;

    const rawStockSentimentUnweighted = processSentimentData(stockSentimentData, componentWeights).map(item => ({
      ...item, isMarketSentiment: false, isIndustrySentiment: false
    }));

    const rawMarketSentimentUnweighted = processSentimentData(marketSentimentData, componentWeights).map(item => ({
      ...item, isMarketSentiment: true, isIndustrySentiment: false
    }));

    const rawIndustrySentimentUnweighted = processSentimentData(industrySentimentData, componentWeights).map(item => ({
      ...item, isMarketSentiment: false, isIndustrySentiment: true
    }));

    const applySourceWeights = (data) => {
      if (!sourceCategoryWeights) return data;
      return data.map(item => {
        const category = (item.sourceCategory || 'AMBIGUOUS').toUpperCase();
        const weight = sourceCategoryWeights[category];
        if (weight !== undefined) {
          return { ...item, adjustedSentiment: item.adjustedSentiment * weight };
        }
        return item;
      });
    };

    const rawStockSentiment = applySourceWeights(rawStockSentimentUnweighted);
    const rawMarketSentiment = applySourceWeights(rawMarketSentimentUnweighted);
    const rawIndustrySentiment = applySourceWeights(rawIndustrySentimentUnweighted);

    let normalizedStockSentiment, normalizedMarketSentiment, normalizedIndustrySentiment;

    if (enableBiasNormalization) {
      normalizedStockSentiment = normalizeToZeroMean(rawStockSentiment);
      normalizedMarketSentiment = normalizeToZeroMean(rawMarketSentiment);
      normalizedIndustrySentiment = normalizeToZeroMean(rawIndustrySentiment);
    } else {
      normalizedStockSentiment = rawStockSentiment.map(item => ({ ...item }));
      normalizedMarketSentiment = rawMarketSentiment.map(item => ({ ...item }));
      normalizedIndustrySentiment = rawIndustrySentiment.map(item => ({ ...item }));
    }

    const formattedStockSentiment = normalizedStockSentiment;
    const formattedMarketSentiment = normalizedMarketSentiment;
    const formattedIndustrySentiment = normalizedIndustrySentiment;

    const allRawSentiment = [...rawStockSentiment, ...rawMarketSentiment, ...rawIndustrySentiment];
    const sourceCategoryCounts = allRawSentiment.reduce((acc, item) => {
        const category = (item.sourceCategory || 'AMBIGUOUS').toUpperCase();
        acc[category] = (acc[category] || 0) + 1;
        return acc;
    }, { RETAIL: 0, INSTITUTIONAL: 0, AMBIGUOUS: 0 });

    const stockData = processMarketData(stockPriceData, "stock", dataResolutionMinutes, tradingCalendar);

    const timeRange = calculateTimeRangeFromData([
      formattedStockSentiment, formattedMarketSentiment, formattedIndustrySentiment, stockData
    ]);

    const startDate = new Date(timeRange.min);
    const currentTime = getCurrentTime().getTime();
    const endDate = new Date(Math.max(timeRange.max, currentTime + (futureWindowHours * 60 * 60 * 1000)));

    const marketSessions = extractMarketSessionAreas(stockData, tradingCalendar, startDate, endDate);
    const volumeData = stockData.map(item => ({
      timestamp: item.timestamp, volume: parseInt(item.volume || 0),
      date: item.date, marketSession: item.marketSession
    }));

    const stockArticleCountData = processArticleCountData(formattedStockSentiment, dataResolutionMinutes, articleCountResolution);
    const marketArticleCountData = processArticleCountData(formattedMarketSentiment, dataResolutionMinutes, articleCountResolution);
    const industryArticleCountData = processArticleCountData(formattedIndustrySentiment, dataResolutionMinutes, articleCountResolution);

    const getEffectiveTimeWindow = () => {
      if (currentTimeWindow === 'temporal') return rollingAverageWindow;
      if (typeof currentTimeWindow === 'number') return currentTimeWindow;
      return rollingAverageWindow;
    };

    const effectiveTimeWindow = getEffectiveTimeWindow();

    const stockRollingAvg = calculateRollingAverage(formattedStockSentiment, effectiveTimeWindow, temporalPastWeight, temporalFutureWeight);
    const marketRollingAvg = calculateRollingAverage(formattedMarketSentiment, effectiveTimeWindow, temporalPastWeight, temporalFutureWeight);
    const industryRollingAvg = calculateRollingAverage(formattedIndustrySentiment, effectiveTimeWindow, temporalPastWeight, temporalFutureWeight);

    const combinedRollingAvg = calculateCombinedRollingAverage(
      formattedStockSentiment, formattedMarketSentiment, formattedIndustrySentiment, effectiveTimeWindow, temporalPastWeight, temporalFutureWeight
    );

    const combinedRollingAvgPresentFocus = calculateCombinedRollingAverage(
      formattedStockSentiment, formattedMarketSentiment, formattedIndustrySentiment, effectiveTimeWindow, 0, 0
    );

    const isTemporal = currentTimeWindow === 'temporal';
    let stockTemporalData = [];
    let marketTemporalData = [];
    let industryTemporalData = [];
    let scaledStockTemporalData = [];
    let masterTemporalData = [];

    if (isTemporal) {
      const temporalOptions = {
          rollingAverageWindow,
          pastWeight: temporalPastWeight,
          futureWeight: temporalFutureWeight,
          pastShiftHours: temporalPastShift,
          futureShiftHours: temporalFutureShift,
          momentumBlend,
          externalNormalizationFactor: null,
          enableImpactNormalization
      };

      const stockFingerprint = companyInfo?.sentiment_fingerprint_STOCK || null;
      const industryFingerprint = companyInfo?.sentiment_fingerprint_INDUSTRY || null;
      const marketFingerprint = companyInfo?.sentiment_fingerprint_MARKET || null;

      const hasFingerprints = stockFingerprint && industryFingerprint && marketFingerprint;

      if (hasFingerprints) {
        let rawStockTemporal = calculateTemporalSentiment(formattedStockSentiment, ...Object.values(temporalOptions));
        let rawMarketTemporal = formattedMarketSentiment.length ? calculateTemporalSentiment(formattedMarketSentiment, ...Object.values(temporalOptions)) : [];
        let rawIndustryTemporal = formattedIndustrySentiment.length ? calculateTemporalSentiment(formattedIndustrySentiment, ...Object.values(temporalOptions)) : [];

        stockTemporalData = applyFingerprintNormalization(rawStockTemporal, stockFingerprint);
        marketTemporalData = applyFingerprintNormalization(rawMarketTemporal, marketFingerprint);
        industryTemporalData = applyFingerprintNormalization(rawIndustryTemporal, industryFingerprint);

        const scaledStockArticles = formattedStockSentiment.map(a => ({ ...a, adjustedSentiment: a.adjustedSentiment * masterWeights.stock }));
        const scaledMarketArticles = formattedMarketSentiment.map(a => ({ ...a, adjustedSentiment: a.adjustedSentiment * masterWeights.market }));
        const scaledIndustryArticles = formattedIndustrySentiment.map(a => ({ ...a, adjustedSentiment: a.adjustedSentiment * masterWeights.industry }));

        const combinedForMaster = [...scaledStockArticles, ...scaledMarketArticles, ...scaledIndustryArticles];

        let rawMasterTemporal = combinedForMaster.length ? calculateTemporalSentiment(combinedForMaster, ...Object.values(temporalOptions)) : [];

        const masterFingerprint = computeMasterFingerprint(stockFingerprint, industryFingerprint, marketFingerprint, masterWeights);
        masterTemporalData = applyFingerprintNormalization(rawMasterTemporal, masterFingerprint);

      } else {
        const stockTemporalRaw = calculateTemporalSentiment(formattedStockSentiment, ...Object.values(temporalOptions));
        const marketTemporalRaw = formattedMarketSentiment.length ? calculateTemporalSentiment(formattedMarketSentiment, ...Object.values(temporalOptions)) : [];
        const industryTemporalRaw = formattedIndustrySentiment.length ? calculateTemporalSentiment(formattedIndustrySentiment, ...Object.values(temporalOptions)) : [];

        const allFinalValues = [
          ...stockTemporalRaw.map(p => Math.abs(p.sentimentRollingAvg || 0)),
          ...marketTemporalRaw.map(p => Math.abs(p.sentimentRollingAvg || 0)),
          ...industryTemporalRaw.map(p => Math.abs(p.sentimentRollingAvg || 0)),
        ];

        const globalMaxFinal = Math.max(0.001, ...allFinalValues);
        const targetMax = 1.0;

        temporalOptions.externalNormalizationFactor = globalMaxFinal > targetMax ? targetMax / globalMaxFinal : 1.0;

        stockTemporalData = calculateTemporalSentiment(formattedStockSentiment, ...Object.values(temporalOptions));
        marketTemporalData = formattedMarketSentiment.length ? calculateTemporalSentiment(formattedMarketSentiment, ...Object.values(temporalOptions)) : [];
        industryTemporalData = formattedIndustrySentiment.length ? calculateTemporalSentiment(formattedIndustrySentiment, ...Object.values(temporalOptions)) : [];

        const combinedForMaster = [
            ...formattedStockSentiment.map(a => ({ ...a, adjustedSentiment: a.adjustedSentiment * masterWeights.stock })),
            ...formattedMarketSentiment.map(a => ({ ...a, adjustedSentiment: a.adjustedSentiment * masterWeights.market })),
            ...formattedIndustrySentiment.map(a => ({ ...a, adjustedSentiment: a.adjustedSentiment * masterWeights.industry }))
        ];
        masterTemporalData = combinedForMaster.length ? calculateTemporalSentiment(combinedForMaster, ...Object.values(temporalOptions)) : [];
      }

      stockTemporalData = normalizeAndSmoothDerivatives(calculateDerivatives(stockTemporalData), derivativeSmoothingWindow);
      marketTemporalData = normalizeAndSmoothDerivatives(calculateDerivatives(marketTemporalData), derivativeSmoothingWindow);
      industryTemporalData = normalizeAndSmoothDerivatives(calculateDerivatives(industryTemporalData), derivativeSmoothingWindow);
      masterTemporalData = normalizeAndSmoothDerivatives(calculateDerivatives(masterTemporalData), derivativeSmoothingWindow);

      scaledStockTemporalData = stockTemporalData;
    }

    const indexData = selectedMarketIndex && marketIndicesData?.[selectedMarketIndex]?.recent_data ?
      processMarketData(marketIndicesData[selectedMarketIndex].recent_data, "index", dataResolutionMinutes, tradingCalendar) : [];

    const keyPricePoints = extractKeyPricePoints(stockData);
    const averages = calculateAverages(formattedStockSentiment, formattedMarketSentiment, formattedIndustrySentiment);

    const stockSentimentPoints = isTemporal ? scaledStockTemporalData : formattedStockSentiment;
    const marketSentimentPoints = isTemporal ? marketTemporalData : formattedMarketSentiment;
    const industrySentimentPoints = isTemporal ? industryTemporalData : formattedIndustrySentiment;

    return {
      formattedSentiment: [...formattedStockSentiment, ...formattedMarketSentiment, ...formattedIndustrySentiment],
      stockSentimentData: formattedStockSentiment,
      marketSentimentData: formattedMarketSentiment,
      industrySentimentData: formattedIndustrySentiment,
      stockRollingAvg, marketRollingAvg, industryRollingAvg, combinedRollingAvg, combinedRollingAvgPresentFocus,
      stockTemporalData, marketTemporalData, industryTemporalData, scaledStockTemporalData, masterTemporalData,
      stockData, volumeData, marketSessions, indexData, timeRange, keyPricePoints,
      avgSentiment: averages.avgSentiment,
      avgMarketSentiment: averages.avgMarketSentiment,
      avgIndustrySentiment: averages.avgIndustrySentiment,
      stockArticleCountData, marketArticleCountData, industryArticleCountData,
      stockSentimentPoints, marketSentimentPoints, industrySentimentPoints,
      sourceCategoryCounts
    };
  } catch (error) {
    console.error('Error preparing chart data:', error);
    return {
      formattedSentiment: [], stockSentimentData: [], marketSentimentData: [], industrySentimentData: [],
      stockRollingAvg: [], marketRollingAvg: [], industryRollingAvg: [], combinedRollingAvg: [], combinedRollingAvgPresentFocus: [],
      stockTemporalData: [], marketTemporalData: [], industryTemporalData: [], scaledStockTemporalData: [], masterTemporalData: [],
      stockData: [], volumeData: [], marketSessions: [], indexData: [],
      timeRange: {min: Infinity, max: -Infinity}, keyPricePoints: {pricePoints: [], currentTime: getTimestamp()},
      avgSentiment: 'N/A', avgMarketSentiment: null, avgIndustrySentiment: null,
      stockArticleCountData: [], marketArticleCountData: [], industryArticleCountData: [],
      stockSentimentPoints: [], marketSentimentPoints: [], industrySentimentPoints: [],
      sourceCategoryCounts: { RETAIL: 0, INSTITUTIONAL: 0, AMBIGUOUS: 0 }
    };
  }
};

const applyFingerprintNormalization = (temporalData, fingerprint) => {
  if (!temporalData || temporalData.length === 0 || fingerprint?.min === undefined || fingerprint?.max === undefined) {
    return temporalData;
  }

  const BUFFER_PERCENTAGE = 0.25;

  const minHist = fingerprint.min;
  const maxHist = fingerprint.max;
  const range = maxHist - minHist;

  const bufferAmount = range * BUFFER_PERCENTAGE;
  const bufferedMin = minHist - bufferAmount;
  const bufferedMax = maxHist + bufferAmount;
  const bufferedRange = bufferedMax - bufferedMin;

  if (bufferedRange === 0) {
    return temporalData.map(point => ({ ...point, sentimentRollingAvg: 0 }));
  }

  return temporalData.map(point => {
    if (point.sentimentRollingAvg === null || point.sentimentRollingAvg === undefined) {
      return point;
    }

    const currentValue = point.sentimentRollingAvg;
    const normalizedValue = 2 * ((currentValue - bufferedMin) / bufferedRange) - 1;
    const scaledValue = Math.max(-1, Math.min(1, normalizedValue));

    return {
      ...point,
      sentimentRollingAvg: scaledValue
    };
  });
};

const computeMasterFingerprint = (stockFingerprint, industryFingerprint, marketFingerprint, weights) => {
    const fingerprints = [
        { fp: stockFingerprint, weight: weights.stock },
        { fp: industryFingerprint, weight: weights.industry },
        { fp: marketFingerprint, weight: weights.market }
    ];

    const validFingerprints = fingerprints.filter(item =>
        item.fp && item.fp.min !== undefined && item.fp.max !== undefined && item.fp.stdDev !== undefined
    );

    if (validFingerprints.length === 0) {
        return { min: -1, max: 1, stdDev: 1 };
    }

    const totalWeight = validFingerprints.reduce((sum, item) => sum + item.weight, 0);

    if (totalWeight === 0) {
        return { min: -1, max: 1, stdDev: 1 };
    }

    const weightedMin = validFingerprints.reduce((sum, item) => sum + item.fp.min * item.weight, 0) / totalWeight;
    const weightedMax = validFingerprints.reduce((sum, item) => sum + item.fp.max * item.weight, 0) / totalWeight;
    const weightedStdDev = validFingerprints.reduce((sum, item) => sum + item.fp.stdDev * item.weight, 0) / totalWeight;

    return {
        min: weightedMin,
        max: weightedMax,
        stdDev: weightedStdDev
    };
};