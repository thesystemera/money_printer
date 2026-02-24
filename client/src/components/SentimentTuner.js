import FFT from 'fft.js';
import {processSentimentData} from './SentimentDataProcessor';

const PROGRESS_UPDATE_FREQUENCY = 100;
const RESOLUTION_MINUTES = 1;
const MAX_INTERPOLATION_GAP_HOURS = 72;
const DEFAULT_SENTIMENT_WINDOW_MS = 4 * 3600000;
const DEFAULT_PRICE_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_TREND_FACTOR = 0;
const TUKEY_TAPER_PERCENTAGE = 0.01;
const LAG_PREFERENCE_CONFIG = {
    MIN_LAG_HOURS: 0.5,
    MAX_LAG_HOURS: 18.0,
    RAMP_DURATION_HOURS: 0.5,
};

const getTemporalMultiplier = (temporalOrientation = 0, pastWeight, futureWeight) => {
  if (temporalOrientation < 0) {
    return 1 - Math.abs(temporalOrientation) + (Math.abs(temporalOrientation) * pastWeight);
  } else if (temporalOrientation > 0) {
    return 1 - temporalOrientation + (temporalOrientation * futureWeight);
  }
  return 1.0;
};

const projectSparseToDenseSmoothly = (sparseData, denseTimeline, rollingWindowMs, pastWeight = 1.0, futureWeight = 1.0, trendFactor = 0.0) => {
  if (!Array.isArray(sparseData) || !sparseData.length || !denseTimeline || !denseTimeline.length || rollingWindowMs <= 0) {
    return new Array(denseTimeline.length).fill(0).map((_, i) => ({
      timestamp: denseTimeline[i],
      sentimentRollingAvg: 0
    }));
  }

  const validData = sparseData
    .filter(item => item.timestamp && item.adjustedSentiment !== undefined)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!validData.length) {
    return new Array(denseTimeline.length).fill(0).map((_, i) => ({
      timestamp: denseTimeline[i],
      sentimentRollingAvg: 0
    }));
  }

  const result = new Array(denseTimeline.length);
  let dataIndex = 0;
  let lastValidValue = 0;

  for (let i = 0; i < denseTimeline.length; i++) {
    const currentTime = denseTimeline[i];

    while (dataIndex < validData.length && validData[dataIndex].timestamp < currentTime - rollingWindowMs) {
      dataIndex++;
    }

    let weightedSum = 0;
    let totalWeight = 0;

    for (let j = dataIndex; j < validData.length && validData[j].timestamp <= currentTime; j++) {
      const item = validData[j];
      const timeDiff = currentTime - item.timestamp;

      if (timeDiff > rollingWindowMs) continue;

      const decayWeight = Math.max(0, 1 - (timeDiff / rollingWindowMs));
      const temporalMultiplier = getTemporalMultiplier(item.originalTemporalOrientation, pastWeight, futureWeight);
      const finalWeight = decayWeight * temporalMultiplier;
      weightedSum += item.adjustedSentiment * finalWeight;
      totalWeight += finalWeight;
    }

    const momentaryAvg = totalWeight > 0 ? weightedSum / totalWeight : lastValidValue;
    if (totalWeight > 0) {
      lastValidValue = momentaryAvg;
    }
    result[i] = { timestamp: currentTime, momentaryAvg, sentimentRollingAvg: momentaryAvg };
  }

  if (trendFactor <= 0) {
    return result;
  }

  const ASSUMED_TIME_STEP = 5 * 60 * 1000;
  const period = Math.max(1, rollingWindowMs / ASSUMED_TIME_STEP);
  const alpha = 2 / (period + 1);
  let trendEma = result[0]?.momentaryAvg || 0;

  for(let i = 0; i < result.length; i++) {
    trendEma = (result[i].momentaryAvg * alpha) + (trendEma * (1 - alpha));
    result[i].sentimentRollingAvg = (1 - trendFactor) * result[i].momentaryAvg + trendFactor * trendEma;
  }

  return result;
};

const calculateDenseRollingAverage = (denseData, rollingWindowMs, trendFactor = 0.0) => {
  if (!Array.isArray(denseData) || !denseData.length || rollingWindowMs <= 0) {
    return denseData.map(item => ({...item, sentimentRollingAvg: item.adjustedSentiment || 0}));
  }

  const validData = denseData
    .filter(item => item.timestamp && item.adjustedSentiment !== undefined)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!validData.length) return denseData;

  const result = new Array(validData.length);

  for (let i = 0; i < validData.length; i++) {
    const currentTime = validData[i].timestamp;
    let windowStart = i;

    while (windowStart > 0 && currentTime - validData[windowStart - 1].timestamp <= rollingWindowMs) {
      windowStart--;
    }

    let weightedSum = 0, totalWeight = 0;

    for (let j = windowStart; j <= i; j++) {
      const item = validData[j];
      const timeDiff = currentTime - item.timestamp;
      const decayWeight = Math.max(0, 1 - (timeDiff / rollingWindowMs));
      weightedSum += item.adjustedSentiment * decayWeight;
      totalWeight += decayWeight;
    }

    const momentaryAvg = totalWeight > 0 ? weightedSum / totalWeight : 0;
    result[i] = { ...validData[i], momentaryAvg, sentimentRollingAvg: momentaryAvg };
  }

  if (trendFactor <= 0) {
    return result;
  }

  const ASSUMED_TIME_STEP = 5 * 60 * 1000;
  const period = Math.max(1, rollingWindowMs / ASSUMED_TIME_STEP);
  const alpha = 2 / (period + 1);
  let trendEma = result[0]?.momentaryAvg || 0;

  for(let i = 0; i < result.length; i++) {
    trendEma = (result[i].momentaryAvg * alpha) + (trendEma * (1 - alpha));
    result[i].sentimentRollingAvg = (1 - trendFactor) * result[i].momentaryAvg + trendFactor * trendEma;
  }

  return result;
};

const applyEnergyMultiplier = (sentimentValue, propagation, duration, averageLifespan, energyFactor) => {
  if (energyFactor === 0) return sentimentValue;
  const articleLifespan = propagation + duration;
  if (articleLifespan <= 0) return sentimentValue;
  const normalizationFactor = averageLifespan / articleLifespan;
  const multiplier = (1 - energyFactor) + (normalizationFactor * energyFactor);
  return sentimentValue * multiplier;
};

const computeAverageLifespan = (data) => {
  let totalLifespan = 0;
  let count = 0;
  data.forEach(item => {
    const propagation = item.propagationSpeed !== undefined ? item.propagationSpeed : 0;
    const duration = item.impactDuration !== undefined ? item.impactDuration : 0;
    const lifespan = propagation + duration;
    if (lifespan > 0) {
      totalLifespan += lifespan;
      count++;
    }
  });
  return count > 0 ? totalLifespan / count : 0;
};

function createFFTContext(N) {
  const fft = new FFT(N);
  return {
    fft,
    fftA: fft.createComplexArray(),
    fftB: fft.createComplexArray(),
    product: fft.createComplexArray(),
    correlation: fft.createComplexArray()
  };
}

const calculateLagWeight = (lagHours, config) => {
    const { MIN_LAG_HOURS, MAX_LAG_HOURS, RAMP_DURATION_HOURS } = config;

    const lowerRampEnd = MIN_LAG_HOURS + RAMP_DURATION_HOURS;
    const upperRampStart = MAX_LAG_HOURS - RAMP_DURATION_HOURS;

    if (lagHours < MIN_LAG_HOURS || lagHours > MAX_LAG_HOURS) {
        return 0.0;
    }
    if (lagHours >= lowerRampEnd && lagHours <= upperRampStart) {
        return 1.0;
    }
    if (lagHours >= MIN_LAG_HOURS && lagHours < lowerRampEnd) {
        return (lagHours - MIN_LAG_HOURS) / RAMP_DURATION_HOURS;
    }
    if (lagHours > upperRampStart && lagHours <= MAX_LAG_HOURS) {
        return (MAX_LAG_HOURS - lagHours) / RAMP_DURATION_HOURS;
    }
    return 0.0;
};

function crossCorrelateWithFFT(fftContext, paddedA, paddedB, N, resolutionMinutes, lagPreferenceConfig) {
  const { fft, fftA, fftB, product, correlation } = fftContext;

  fft.realTransform(fftA, paddedA);
  fft.realTransform(fftB, paddedB);

  for (let i = 0; i < N; i++) {
    const a_real = fftA[i * 2], a_imag = fftA[i * 2 + 1];
    const b_real = fftB[i * 2], b_imag = -fftB[i * 2 + 1];
    product[i * 2] = a_real * b_real - a_imag * b_imag;
    product[i * 2 + 1] = a_real * b_imag + a_imag * b_real;
  }

  fft.inverseTransform(correlation, product);
  const correlationReal = new Array(N).fill(0).map((_, i) => correlation[i * 2]);

  const maxLagInIndices = Math.floor((lagPreferenceConfig.MAX_LAG_HOURS * 60) / resolutionMinutes);
  const minLagInIndices = Math.ceil((lagPreferenceConfig.MIN_LAG_HOURS * 60) / resolutionMinutes);

  let totalWeightedCorrelation = 0;
  let totalWeight = 0;
  let maxCorrelation = -Infinity;
  let optimalLagHours = 0;

  for (let i = N - maxLagInIndices; i <= N - minLagInIndices; i++) {
    const lagIndex = N - i;
    const currentLagHours = (lagIndex * resolutionMinutes) / 60;
    const lagWeight = calculateLagWeight(currentLagHours, lagPreferenceConfig);

    if (lagWeight <= 0) continue;

    const currentCorr = correlationReal[i];
    totalWeightedCorrelation += currentCorr * lagWeight;
    totalWeight += lagWeight;

    if (currentCorr > maxCorrelation) {
      maxCorrelation = currentCorr;
      optimalLagHours = currentLagHours;
    }
  }

  const meanWeightedCorrelation = totalWeight > 0 ? totalWeightedCorrelation / totalWeight : 0;

  return {
    maxCorrelation: meanWeightedCorrelation,
    optimalLagHours,
    peakCorrelation: maxCorrelation
  };
}

const ensureNumericTimestamps = (dataArray) => {
  if (!dataArray || dataArray.length === 0) return [];
  return JSON.parse(JSON.stringify(dataArray)).map(item => {
    item.timestamp = new Date(item.timestamp || item.date).getTime();
    return item;
  });
};

const deterministicRandomGenerator = (() => {
    let seed = 12345;
    return () => {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
})();

let spareRandom = null;
function gaussianRandom() {
    if (spareRandom !== null) {
        const temp = spareRandom;
        spareRandom = null;
        return temp;
    }
    let u, v, s;
    do {
        u = deterministicRandomGenerator() * 2 - 1;
        v = deterministicRandomGenerator() * 2 - 1;
        s = u * u + v * v;
    } while (s >= 1 || s === 0);
    s = Math.sqrt(-2.0 * Math.log(s) / s);
    spareRandom = v * s;
    return u * s;
}

const interpolatePriceData = (data, maxGapToFillMs = 10 * 60 * 60 * 1000) => {
  if (!data || data.length < 2) {
    return data;
  }

  const sortedData = data.sort((a, b) => a.timestamp - b.timestamp);

  const timeDiffs = [];
  for (let i = 1; i < sortedData.length; i++) {
    const timeDiff = sortedData[i].timestamp - sortedData[i-1].timestamp;
    if (timeDiff > 0) {
      timeDiffs.push(timeDiff);
    }
  }

  if (timeDiffs.length === 0) {
    return sortedData;
  }
  timeDiffs.sort((a,b) => a - b);
  const medianIntervalMs = timeDiffs[Math.floor(timeDiffs.length / 2)];
  const expectedIntervalMs = medianIntervalMs > 0 ? medianIntervalMs : 60000;

  const priceChanges = [];
  for (let i = 1; i < sortedData.length; i++) {
    if (sortedData[i].price != null && sortedData[i-1].price != null) {
        const timeDiff = sortedData[i].timestamp - sortedData[i-1].timestamp;
        if (timeDiff > 0 && timeDiff <= expectedIntervalMs * 1.5) {
             priceChanges.push(sortedData[i].price - sortedData[i-1].price);
        }
    }
  }
  const meanChange = priceChanges.length > 0 ? priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length : 0;
  const variance = priceChanges.length > 1 ? priceChanges.reduce((sum, change) => sum + Math.pow(change - meanChange, 2), 0) / (priceChanges.length - 1) : 0;
  const volatility = Math.sqrt(variance) || 0;

  const result = [sortedData[0]];

  for (let i = 1; i < sortedData.length; i++) {
    const prevPoint = sortedData[i - 1];
    const currentPoint = sortedData[i];
    const timeDiff = currentPoint.timestamp - prevPoint.timestamp;

    if (timeDiff > expectedIntervalMs && timeDiff <= maxGapToFillMs) {
      const numPointsToInsert = Math.floor(timeDiff / expectedIntervalMs) - 1;
      if (numPointsToInsert > 0) {
        const priceStart = prevPoint.price;
        const priceEnd = currentPoint.price;

        let path = [priceStart];
        for (let j = 0; j < numPointsToInsert; j++) {
            const randomShock = gaussianRandom() * volatility;
            path.push(path[path.length - 1] + randomShock);
        }

        const finalError = path[path.length - 1] - priceEnd;

        for (let j = 1; j <= numPointsToInsert; j++) {
            const correction = finalError * (j / (numPointsToInsert));
            const simulatedPrice = path[j] - correction;

            result.push({
                ...prevPoint,
                timestamp: prevPoint.timestamp + j * expectedIntervalMs,
                price: simulatedPrice,
                isInterpolated: true,
            });
        }
      }
    }
    result.push(currentPoint);
  }

  return result;
};

function resampleCategorical(timeSeries, timeGrid, valueKey) {
  if (!timeSeries || timeSeries.length === 0) {
    return new Array(timeGrid.length).fill('AMBIGUOUS');
  }

  const resampledValues = [];
  let seriesIndex = 0;

  for (const gridTimestamp of timeGrid) {
    while (seriesIndex < timeSeries.length - 1 && timeSeries[seriesIndex + 1].timestamp <= gridTimestamp) {
      seriesIndex++;
    }
    resampledValues.push(timeSeries[seriesIndex]?.[valueKey] || 'AMBIGUOUS');
  }
  return resampledValues;
}

const applySourceWeightsFast = (adjustedSentiments, sourceCategories, weights) => {
  return adjustedSentiments.map((sentiment, i) => {
    const category = (sourceCategories[i] || 'AMBIGUOUS').toUpperCase();
    const weight = weights[category];
    return weight !== undefined ? sentiment * weight : sentiment;
  });
};

const normalizeToRange = (arr, minVal = -1, maxVal = 1) => {
  if (!arr || arr.length === 0) return [];
  const validValues = arr.filter(v => !isNaN(v) && isFinite(v));
  if (validValues.length === 0) return arr.map(() => 0);

  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const range = max - min;

  if (range === 0) return arr.map(() => (minVal + maxVal) / 2);

  return arr.map(val => {
    if (isNaN(val) || !isFinite(val)) return 0;
    return minVal + ((val - min) / range) * (maxVal - minVal);
  });
};

const createProgressTracker = (totalIterations, onProgress) => {
  let globalIterationCount = 0;

  return {
    increment: async (phaseName) => {
      globalIterationCount++;
      if (globalIterationCount % PROGRESS_UPDATE_FREQUENCY === 0) {
        if (onProgress) onProgress(globalIterationCount, totalIterations, phaseName);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return globalIterationCount;
    },
    finish: async (phaseName) => {
      if (onProgress) onProgress(totalIterations, totalIterations, phaseName);
    }
  };
};

const countProportionalCombinations = (grid, numVars, targetSum) => {
    let count = 0;
    const integerGrid = grid.map(v => Math.round(v * 10));
    const integerTarget = Math.round(targetSum * 10);

    if (numVars === 2) {
        for (const v1 of integerGrid) {
            const v2 = integerTarget - v1;
            if (integerGrid.includes(v2)) count++;
        }
        return count;
    }

    if (numVars === 3) {
        for (const v1 of integerGrid) {
            for (const v2 of integerGrid) {
                const v3 = integerTarget - v1 - v2;
                if (integerGrid.includes(v3)) count++;
            }
        }
        return count;
    }
    return 0;
};

const applyTukeyWindow = (signal, taperPercentage = TUKEY_TAPER_PERCENTAGE) => {
  const N = signal.length;
  if (N < 20) return signal;

  const taperPoints = Math.floor(N * taperPercentage);

  if (taperPoints <= 0) return signal;

  const M = Math.min(taperPoints, Math.floor(N / 2));
  if (M === 0) return signal;

  const windowedSignal = [...signal];

  for (let n = 0; n < M; n++) {
    const multiplier = 0.5 * (1 - Math.cos(Math.PI * n / M));
    windowedSignal[n] *= multiplier;
    windowedSignal[N - 1 - n] *= multiplier;
  }

  return windowedSignal;
};

const createOptimizedCorrelator = (fftContext, paddedTarget, targetNorm, N, resolutionMinutes, lagPreferenceConfig) => {
  return (sentimentSignal) => {
    if (sentimentSignal.length === 0) return { maxCorrelation: 0, optimalLagHours: 0 };

    const normalizedSentiment = normalizeToRange(sentimentSignal, -1, 1);
    const windowedSentiment = applyTukeyWindow(normalizedSentiment, TUKEY_TAPER_PERCENTAGE);
    const paddedSentiment = [...windowedSentiment, ...new Array(N - windowedSentiment.length).fill(0)];
    const sentimentNorm = Math.sqrt(normalizedSentiment.reduce((sum, val) => sum + val * val, 0));

    const { maxCorrelation, optimalLagHours } = crossCorrelateWithFFT(
        fftContext,
        paddedTarget,
        paddedSentiment,
        N,
        resolutionMinutes,
        lagPreferenceConfig
    );

    const normalizedCorr = (targetNorm > 0 && sentimentNorm > 0) ?
        maxCorrelation / (targetNorm * sentimentNorm) : 0;

    return { maxCorrelation: normalizedCorr, optimalLagHours };
  };
};

const createPriceCorrelatorCache = (priceData, timeGrid, fftContext, N, resolutionMinutes, lagPreferenceConfig) => {
    const cache = {};
    const priceWindowsMinutes = [15, 30, 60, 120, 240];

    for (const pWinMin of priceWindowsMinutes) {
        const pWinMs = pWinMin * 60 * 1000;
        const priceRollingAvg = calculateDenseRollingAverage(priceData, pWinMs);
        const resampledPrice = priceRollingAvg.map(item => item.sentimentRollingAvg);
        const targetPriceCurve = normalizeToRange(resampledPrice, -1, 1);
        const windowedTarget = applyTukeyWindow(targetPriceCurve, TUKEY_TAPER_PERCENTAGE);
        const currentPaddedTarget = [...windowedTarget, ...new Array(N - windowedTarget.length).fill(0)];
        const currentTargetNorm = Math.sqrt(targetPriceCurve.reduce((sum, val) => sum + val * val, 0));

        cache[pWinMs] = createOptimizedCorrelator(fftContext, currentPaddedTarget, currentTargetNorm, N, resolutionMinutes, lagPreferenceConfig);
    }

    return cache;
};

const evaluateLagDistribution = (distribution, lagPreferenceConfig) => {
    if (!distribution || Object.keys(distribution).length === 0) return -999;

    const allCorrelations = [];
    for (const correlations of Object.values(distribution)) {
        const corrArray = Array.isArray(correlations) ? correlations : [correlations];
        allCorrelations.push(...corrArray);
    }

    if (allCorrelations.length === 0) return -999;

    let totalWeightedSignal = 0;
    let totalWeight = 0;

    for (const [lagStr, correlations] of Object.entries(distribution)) {
        const lag = parseFloat(lagStr);
        const lagWeight = calculateLagWeight(lag, lagPreferenceConfig);
        const corrArray = Array.isArray(correlations) ? correlations : [correlations];

        for (const corr of corrArray) {
            totalWeightedSignal += corr * lagWeight;
            totalWeight += lagWeight;
        }
    }

    if (totalWeight === 0) return -999;
    return totalWeightedSignal / totalWeight;
};

const calculateDistributionMeanLag = (distribution) => {
    if (!distribution || Object.keys(distribution).length === 0) return 1.0;

    let weightedLagSum = 0;
    let totalWeight = 0;

    for (const [lagStr, correlations] of Object.entries(distribution)) {
        const lag = parseFloat(lagStr);
        const corrArray = Array.isArray(correlations) ? correlations : [correlations];

        for (const corr of corrArray) {
            const weight = Math.abs(corr);
            weightedLagSum += lag * weight;
            totalWeight += weight;
        }
    }

    return totalWeight > 0 ? weightedLagSum / totalWeight : 1.0;
};

async function optimizeSingleSignal({
    sourceData,
    sourceName,
    timeGrid,
    priceData,
    fftContext,
    N,
    resolutionMinutes,
    lagPreferenceConfig,
    avoidExtremes,
    progressTracker,
    lagDistribution,
    stageNumber
}) {
    if (!sourceData || sourceData.length === 0) {
        console.warn(`No data for ${sourceName}`);
        return {
            bestScore: -0.5,
            bestParams: {
                sentimentWindowMs: DEFAULT_SENTIMENT_WINDOW_MS,
                priceWindowMs: DEFAULT_PRICE_WINDOW_MS,
                trendFactor: DEFAULT_TREND_FACTOR,
                energyFactor: 0,
                sentimentWeight: 1.0,
                influenceWeight: 1.0,
                certaintyWeight: 1.0,
                temporalPastWeight: 1.0,
                temporalFutureWeight: 1.0,
                sourceWeights: { RETAIL: 1.0, INSTITUTIONAL: 1.0, AMBIGUOUS: 1.0 }
            },
            originalScore: -0.5,
            tunedLag: 1.0,
            finalSignal: new Array(timeGrid.length).fill(0)
        };
    }

    const priceCorrelatorCache = createPriceCorrelatorCache(priceData, timeGrid, fftContext, N, resolutionMinutes, lagPreferenceConfig);

    const energyFactorGrid = Array.from({ length: 11 }, (_, i) => parseFloat((i * 0.1).toFixed(1)));
    const trendFactorGrid = Array.from({ length: 11 }, (_, i) => parseFloat((i * 0.1).toFixed(1)));
    const sentimentWindowsHours = [1, 2, 4, 6, 8];
    const priceWindowsMinutes = [15, 30, 60, 120, 240];
    const temporalGrid = avoidExtremes
        ? Array.from({ length: 17 }, (_, i) => parseFloat((0.2 + i * 0.1).toFixed(1)))
        : Array.from({ length: 21 }, (_, i) => parseFloat((i * 0.1).toFixed(1)));
    const weightGrid = avoidExtremes
        ? Array.from({ length: 17 }, (_, i) => parseFloat((0.2 + i * 0.1).toFixed(1)))
        : Array.from({ length: 21 }, (_, i) => parseFloat((i * 0.1).toFixed(1)));

    let bestParams = {
        sentimentWindowMs: DEFAULT_SENTIMENT_WINDOW_MS,
        priceWindowMs: DEFAULT_PRICE_WINDOW_MS,
        trendFactor: DEFAULT_TREND_FACTOR,
        energyFactor: 0,
        sentimentWeight: 1.0,
        influenceWeight: 1.0,
        certaintyWeight: 1.0,
        temporalPastWeight: 1.0,
        temporalFutureWeight: 1.0,
        sourceWeights: { RETAIL: 1.0, INSTITUTIONAL: 1.0, AMBIGUOUS: 1.0 }
    };

    let processedData = processSentimentData(sourceData, {
        sentimentWeight: bestParams.sentimentWeight,
        influenceWeight: bestParams.influenceWeight,
        certaintyWeight: bestParams.certaintyWeight
    });
    const baselineRollingAvg = projectSparseToDenseSmoothly(processedData, timeGrid, bestParams.sentimentWindowMs);
    const baselineSignal = baselineRollingAvg.map(item => item.sentimentRollingAvg);

    let originalScore = 0;
    const baselineOptimizedCorrelate = priceCorrelatorCache[bestParams.priceWindowMs];
    const result = baselineOptimizedCorrelate(baselineSignal);
    originalScore = result.maxCorrelation || 0;

    let bestScore = -999;
    let bestActualCorrelation = originalScore;
    const accumulatedDistribution = {};

    const baseSentiments = processedData.map(item => item.adjustedSentiment);
    let averageLifespan = computeAverageLifespan(processedData);

    for (const eFactor of energyFactorGrid) {
        const energyAdjusted = processedData.map((item, i) => ({
            ...item,
            adjustedSentiment: applyEnergyMultiplier(
                baseSentiments[i],
                item.propagationSpeed || 0,
                item.impactDuration || 0,
                averageLifespan,
                eFactor
            )
        }));

        for (const sWinHr of sentimentWindowsHours) {
            for (const pWinMin of priceWindowsMinutes) {
                for (const trendFactor of trendFactorGrid) {
                    await progressTracker.increment(`Stage ${stageNumber}: ${sourceName.toUpperCase()} Phase 0`);
                    const sWinMs = sWinHr * 60 * 60 * 1000;
                    const pWinMs = pWinMin * 60 * 1000;

                    const sentimentRollingAvg = projectSparseToDenseSmoothly(energyAdjusted, timeGrid, sWinMs, 1.0, 1.0, trendFactor);
                    const signal = sentimentRollingAvg.map(item => item.sentimentRollingAvg);
                    const optimizedCorrelate = priceCorrelatorCache[pWinMs];
                    const { maxCorrelation, optimalLagHours } = optimizedCorrelate(signal);

                    if (optimalLagHours >= 0) {
                        const roundedLag = Math.round(optimalLagHours * 4) / 4;
                        if (!accumulatedDistribution[roundedLag]) accumulatedDistribution[roundedLag] = [];
                        accumulatedDistribution[roundedLag].push(maxCorrelation);
                        if (!lagDistribution[roundedLag]) lagDistribution[roundedLag] = [];
                        lagDistribution[roundedLag].push(maxCorrelation);

                        const currentParamDistribution = { [roundedLag]: [maxCorrelation] };
                        const distributionScore = evaluateLagDistribution(currentParamDistribution, lagPreferenceConfig);

                        if (distributionScore > bestScore) {
                            bestScore = distributionScore;
                            bestActualCorrelation = maxCorrelation;
                            bestParams.sentimentWindowMs = sWinMs;
                            bestParams.priceWindowMs = pWinMs;
                            bestParams.trendFactor = trendFactor;
                            bestParams.energyFactor = eFactor;
                        }
                    }
                }
            }
        }
    }

    processedData = processSentimentData(sourceData, bestParams);
    averageLifespan = computeAverageLifespan(processedData);
    const cachedDenseSignals = {};

    const getCachedDenseSignal = (params) => {
        const cacheKey = `${params.sentimentWindowMs}_${params.trendFactor.toFixed(2)}_${params.energyFactor.toFixed(2)}_${params.temporalPastWeight.toFixed(2)}_${params.temporalFutureWeight.toFixed(2)}`;
        if (cachedDenseSignals[cacheKey]) return cachedDenseSignals[cacheKey];

        const energyAdjusted = processedData.map(item => ({
            ...item,
            adjustedSentiment: applyEnergyMultiplier(
                item.adjustedSentiment,
                item.propagationSpeed || 0,
                item.impactDuration || 0,
                averageLifespan,
                params.energyFactor
            )
        }));

        const denseSignal = projectSparseToDenseSmoothly(energyAdjusted, timeGrid, params.sentimentWindowMs, params.temporalPastWeight, params.temporalFutureWeight, params.trendFactor);
        const signal = denseSignal.map(item => item.sentimentRollingAvg);
        cachedDenseSignals[cacheKey] = signal;
        return signal;
    };

    for (const pastW of temporalGrid) {
        for (const futureW of temporalGrid) {
            await progressTracker.increment(`Stage ${stageNumber}: ${sourceName.toUpperCase()} Phase 1`);
            const tempParams = { ...bestParams, temporalPastWeight: pastW, temporalFutureWeight: futureW };

            const signal = getCachedDenseSignal(tempParams);
            const optimizedCorrelate = priceCorrelatorCache[bestParams.priceWindowMs];
            const { maxCorrelation, optimalLagHours } = optimizedCorrelate(signal);

            if (optimalLagHours >= 0) {
                const roundedLag = Math.round(optimalLagHours * 4) / 4;
                if (!accumulatedDistribution[roundedLag]) accumulatedDistribution[roundedLag] = [];
                accumulatedDistribution[roundedLag].push(maxCorrelation);
                if (!lagDistribution[roundedLag]) lagDistribution[roundedLag] = [];
                lagDistribution[roundedLag].push(maxCorrelation);

                const currentParamDistribution = { [roundedLag]: [maxCorrelation] };
                const distributionScore = evaluateLagDistribution(currentParamDistribution, lagPreferenceConfig);

                if (distributionScore > bestScore) {
                    bestScore = distributionScore;
                    bestActualCorrelation = maxCorrelation;
                    bestParams.temporalPastWeight = pastW;
                    bestParams.temporalFutureWeight = futureW;
                }
            }
        }
    }

    Object.keys(cachedDenseSignals).forEach(key => delete cachedDenseSignals[key]);

    processedData = processSentimentData(sourceData, bestParams);
    averageLifespan = computeAverageLifespan(processedData);
    let sourceCategories = processedData.map(item => item.sourceCategory);

    for (const retailW of weightGrid) {
        for (const institutionalW of weightGrid) {
            for (const ambiguousW of weightGrid) {
                if (Math.abs(retailW + institutionalW + ambiguousW - 3.0) > 0.05) continue;
                await progressTracker.increment(`Stage ${stageNumber}: ${sourceName.toUpperCase()} Phase 2`);

                const signal = getCachedDenseSignal(bestParams);
                const resampledCategories = resampleCategorical(processedData.map((item, i) => ({ timestamp: item.timestamp, category: sourceCategories[i] })), timeGrid, 'category');
                const weighted = applySourceWeightsFast(signal, resampledCategories, { RETAIL: retailW, INSTITUTIONAL: institutionalW, AMBIGUOUS: ambiguousW });
                const optimizedCorrelate = priceCorrelatorCache[bestParams.priceWindowMs];
                const { maxCorrelation, optimalLagHours } = optimizedCorrelate(weighted);

                if (optimalLagHours >= 0) {
                    const roundedLag = Math.round(optimalLagHours * 4) / 4;
                    if (!accumulatedDistribution[roundedLag]) accumulatedDistribution[roundedLag] = [];
                    accumulatedDistribution[roundedLag].push(maxCorrelation);
                    if (!lagDistribution[roundedLag]) lagDistribution[roundedLag] = [];
                    lagDistribution[roundedLag].push(maxCorrelation);

                    const currentParamDistribution = { [roundedLag]: [maxCorrelation] };
                    const distributionScore = evaluateLagDistribution(currentParamDistribution, lagPreferenceConfig);

                    if (distributionScore > bestScore) {
                        bestScore = distributionScore;
                        bestActualCorrelation = maxCorrelation;
                        bestParams.sourceWeights = { RETAIL: retailW, INSTITUTIONAL: institutionalW, AMBIGUOUS: ambiguousW };
                    }
                }
            }
        }
    }

    Object.keys(cachedDenseSignals).forEach(key => delete cachedDenseSignals[key]);

    for (const influenceW of weightGrid) {
        for (const certaintyW of weightGrid) {
            if (Math.abs(influenceW + certaintyW - 2.0) > 0.05) continue;
            await progressTracker.increment(`Stage ${stageNumber}: ${sourceName.toUpperCase()} Phase 3`);

            const tempProcessedData = processSentimentData(sourceData, { sentimentWeight: 1.0, influenceWeight: influenceW, certaintyWeight: certaintyW });
            const tempAverageLifespan = computeAverageLifespan(tempProcessedData);
            const tempSourceCategories = tempProcessedData.map(item => item.sourceCategory);

            const tempEnergyAdjusted = tempProcessedData.map(item => ({
                ...item,
                adjustedSentiment: applyEnergyMultiplier(
                    item.adjustedSentiment,
                    item.propagationSpeed || 0,
                    item.impactDuration || 0,
                    tempAverageLifespan,
                    bestParams.energyFactor
                )
            }));

            const tempSignalDense = projectSparseToDenseSmoothly(tempEnergyAdjusted, timeGrid, bestParams.sentimentWindowMs, bestParams.temporalPastWeight, bestParams.temporalFutureWeight, bestParams.trendFactor);
            const tempSignal = tempSignalDense.map(item => item.sentimentRollingAvg);
            const resampledCategories = resampleCategorical(tempProcessedData.map((item, i) => ({ timestamp: item.timestamp, category: tempSourceCategories[i] })), timeGrid, 'category');
            const weighted = applySourceWeightsFast(tempSignal, resampledCategories, bestParams.sourceWeights);
            const optimizedCorrelate = priceCorrelatorCache[bestParams.priceWindowMs];
            const { maxCorrelation, optimalLagHours } = optimizedCorrelate(weighted);

            if (optimalLagHours >= 0) {
                const roundedLag = Math.round(optimalLagHours * 4) / 4;
                if (!accumulatedDistribution[roundedLag]) accumulatedDistribution[roundedLag] = [];
                accumulatedDistribution[roundedLag].push(maxCorrelation);
                if (!lagDistribution[roundedLag]) lagDistribution[roundedLag] = [];
                lagDistribution[roundedLag].push(maxCorrelation);

                const currentParamDistribution = { [roundedLag]: [maxCorrelation] };
                const distributionScore = evaluateLagDistribution(currentParamDistribution, lagPreferenceConfig);

                if (distributionScore > bestScore) {
                    bestScore = distributionScore;
                    bestActualCorrelation = maxCorrelation;
                    bestParams.sentimentWeight = 1.0;
                    bestParams.influenceWeight = influenceW;
                    bestParams.certaintyWeight = certaintyW;
                }
            }
        }
    }

    processedData = processSentimentData(sourceData, bestParams);
    averageLifespan = computeAverageLifespan(processedData);
    const finalEnergyAdjusted = processedData.map(item => ({
        ...item,
        adjustedSentiment: applyEnergyMultiplier(
            item.adjustedSentiment,
            item.propagationSpeed || 0,
            item.impactDuration || 0,
            averageLifespan,
            bestParams.energyFactor
        )
    }));
    const finalSignalDense = projectSparseToDenseSmoothly(finalEnergyAdjusted, timeGrid, bestParams.sentimentWindowMs, bestParams.temporalPastWeight, bestParams.temporalFutureWeight, bestParams.trendFactor);
    const finalSignalValues = finalSignalDense.map(item => item.sentimentRollingAvg);
    const finalResampledCategories = resampleCategorical(processedData.map((item, i) => ({ timestamp: item.timestamp, category: item.sourceCategory })), timeGrid, 'category');
    const finalSignal = applySourceWeightsFast(finalSignalValues, finalResampledCategories, bestParams.sourceWeights);
    const tunedLag = calculateDistributionMeanLag(accumulatedDistribution);

    return {
        bestScore: bestActualCorrelation,
        bestParams,
        originalScore,
        tunedLag: tunedLag || 1.0,
        finalSignal
    };
}

const calculateBaselineSignalCorrelation = (sourceData, timeGrid, priceData, fftContext, N, resolutionMinutes, lagPreferenceConfig) => {
    if (!sourceData || sourceData.length === 0) return 0;
    const processed = processSentimentData(sourceData, {
        sentimentWeight: 1,
        influenceWeight: 1,
        certaintyWeight: 1
    });
    const baselineRollingAvg = projectSparseToDenseSmoothly(processed, timeGrid, DEFAULT_SENTIMENT_WINDOW_MS);
    const baselineSignal = baselineRollingAvg.map(item => item.sentimentRollingAvg);
    const priceRollingAvg = calculateDenseRollingAverage(priceData, DEFAULT_PRICE_WINDOW_MS);
    const resampledPrice = priceRollingAvg.map(item => item.sentimentRollingAvg);
    const targetPriceCurve = normalizeToRange(resampledPrice, -1, 1);
    const windowedTarget = applyTukeyWindow(targetPriceCurve, TUKEY_TAPER_PERCENTAGE);
    const paddedTarget = [...windowedTarget, ...new Array(N - windowedTarget.length).fill(0)];
    const targetNorm = Math.sqrt(targetPriceCurve.reduce((sum, val) => sum + val * val, 0));
    const optimizedCorrelate = createOptimizedCorrelator(fftContext, paddedTarget, targetNorm, N, resolutionMinutes, lagPreferenceConfig);
    const { maxCorrelation } = optimizedCorrelate(baselineSignal);
    return maxCorrelation;
};

const processSignalTypes = async (signalConfigs, sharedParams, progressTracker) => {
    const results = {};
    const perBucketStats = {};

    for (const [signalType, config] of Object.entries(signalConfigs)) {
        if (!config.hasData) {
            results[signalType] = null;
            perBucketStats[signalType] = { originalCorrelation: 0, tunedCorrelation: 0, tunedLag: 0 };
            continue;
        }

        const originalCorrelation = calculateBaselineSignalCorrelation(
            config.sourceData,
            sharedParams.timeGrid,
            sharedParams.priceData,
            sharedParams.fftContext,
            sharedParams.N,
            sharedParams.resolutionMinutes,
            sharedParams.lagPreferenceConfig
        );

        perBucketStats[signalType] = { originalCorrelation };

        const result = await optimizeSingleSignal({
            ...config,
            ...sharedParams,
            progressTracker,
        });

        results[signalType] = result;
        perBucketStats[signalType].tunedCorrelation = result.bestScore;
        perBucketStats[signalType].tunedLag = result.tunedLag;
    }

    return { results, perBucketStats };
};

const constrainBlendWeights = (rawWeights) => {
    const MIN_WEIGHT = 0.2;
    const MAX_WEIGHT = 1.8;
    const TARGET_SUM = 3.0;

    const keys = Object.keys(rawWeights);
    let weights = { ...rawWeights };

    keys.forEach(key => {
        weights[key] = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, weights[key]));
    });

    let currentSum = Object.values(weights).reduce((a, b) => a + b, 0);

    if (Math.abs(currentSum - TARGET_SUM) > 0.01) {
        const scaleFactor = TARGET_SUM / currentSum;
        keys.forEach(key => {
            weights[key] = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, weights[key] * scaleFactor));
        });

        currentSum = Object.values(weights).reduce((a, b) => a + b, 0);

        if (Math.abs(currentSum - TARGET_SUM) > 0.01) {
            const diff = TARGET_SUM - currentSum;
            const roomToGrow = keys.map(k => weights[k] < MAX_WEIGHT ? MAX_WEIGHT - weights[k] : 0);
            const totalRoom = roomToGrow.reduce((a, b) => a + b, 0);

            if (totalRoom > 0) {
                keys.forEach((k, i) => {
                    if (roomToGrow[i] > 0) {
                        weights[k] = Math.min(MAX_WEIGHT, weights[k] + (roomToGrow[i] / totalRoom) * diff);
                    }
                });
            } else {
                const roomToShrink = keys.map(k => weights[k] > MIN_WEIGHT ? weights[k] - MIN_WEIGHT : 0);
                const totalShrinkRoom = roomToShrink.reduce((a, b) => a + b, 0);

                if (totalShrinkRoom > 0) {
                    keys.forEach((k, i) => {
                        if (roomToShrink[i] > 0) {
                            weights[k] = Math.max(MIN_WEIGHT, weights[k] - (roomToShrink[i] / totalShrinkRoom) * Math.abs(diff));
                        }
                    });
                }
            }
        }
    }

    return weights;
};

export async function findOptimalFingerprint({
    stockPriceData,
    stockSentimentData,
    marketSentimentData,
    industrySentimentData,
    onProgress,
    avoidExtremes = true,
}) {
    const originalStockSentiment = ensureNumericTimestamps(stockSentimentData);
    const originalMarketSentiment = ensureNumericTimestamps(marketSentimentData);
    const originalIndustrySentiment = ensureNumericTimestamps(industrySentimentData);
    const priceDataRaw = ensureNumericTimestamps(stockPriceData);

    const interpolatedPriceData = interpolatePriceData(priceDataRaw, MAX_INTERPOLATION_GAP_HOURS * 60 * 60 * 1000);

    const priceData = interpolatedPriceData
        .map(p => ({ ...p, adjustedSentiment: p.price }))
        .filter(p => p.price != null && !isNaN(p.price) && p.price > 0 && !p.isBreak);

    if (priceData.length < 2 || (originalStockSentiment.length === 0 && originalMarketSentiment.length === 0 && originalIndustrySentiment.length === 0)) {
        return { bestScore: 0, originalScore: 0, bestParams: null, error: "Not enough data.", perBucketStats: {} };
    }

    const timeGrid = priceData
        .filter(point => point.price != null && !isNaN(point.price) && point.price > 0 && !point.isBreak)
        .map(point => point.timestamp)
        .sort((a, b) => a - b);

    if (timeGrid.length < 2) {
         return { bestScore: 0, originalScore: 0, bestParams: null, error: "Not enough valid real price data to build a timeline.", perBucketStats: {} };
    }

    const N = Math.pow(2, Math.ceil(Math.log2(timeGrid.length * 2 - 1)));
    const fftContext = createFFTContext(N);

    const stockLagDistribution = {};
    const marketLagDistribution = {};
    const industryLagDistribution = {};

    const weightGrid = avoidExtremes
        ? Array.from({ length: 17 }, (_, i) => parseFloat((0.2 + i * 0.1).toFixed(1)))
        : Array.from({ length: 21 }, (_, i) => parseFloat((i * 0.1).toFixed(1)));
    const energyFactorGrid = Array.from({ length: 11 }, (_, i) => parseFloat((i * 0.1).toFixed(1)));
    const trendFactorGrid = Array.from({ length: 11 }, (_, i) => parseFloat((i * 0.1).toFixed(1)));
    const sentimentWindowsHours = [1, 2, 4, 6, 8];
    const priceWindowsMinutes = [15, 30, 60, 120, 240];
    const temporalGrid = Array.from({ length: 21 }, (_, i) => parseFloat((i * 0.1).toFixed(1)));
    const phase0Iterations = energyFactorGrid.length * sentimentWindowsHours.length * priceWindowsMinutes.length * trendFactorGrid.length;
    const phase1Iterations = Math.pow(temporalGrid.length, 2);
    const phase2Iterations = countProportionalCombinations(weightGrid, 3, 3.0);
    const phase3Iterations = countProportionalCombinations(weightGrid, 2, 2.0);
    const singleSignalIterations = phase0Iterations + phase1Iterations + phase2Iterations + phase3Iterations;
    const numSignals = [originalStockSentiment, originalMarketSentiment, originalIndustrySentiment].filter(s => s.length > 0).length;
    const totalIterations = singleSignalIterations * numSignals;
    const progressTracker = createProgressTracker(totalIterations, onProgress);

    const tempStock = originalStockSentiment.length > 0 ? processSentimentData(originalStockSentiment, { sentimentWeight: 1, influenceWeight: 1, certaintyWeight: 1 }) : [];
    const tempMarket = originalMarketSentiment.length > 0 ? processSentimentData(originalMarketSentiment, { sentimentWeight: 1, influenceWeight: 1, certaintyWeight: 1 }) : [];
    const tempIndustry = originalIndustrySentiment.length > 0 ? processSentimentData(originalIndustrySentiment, { sentimentWeight: 1, influenceWeight: 1, certaintyWeight: 1 }) : [];
    const tempSentimentData = [...tempStock, ...tempMarket, ...tempIndustry].sort((a,b) => a.timestamp - b.timestamp);
    const currentSentimentDense = projectSparseToDenseSmoothly(tempSentimentData, timeGrid, DEFAULT_SENTIMENT_WINDOW_MS, 1.0, 1.0, 0.0);
    const baselineSignal = currentSentimentDense.map(item => item.sentimentRollingAvg);
    const priceRollingAvg = calculateDenseRollingAverage(priceData, DEFAULT_PRICE_WINDOW_MS);
    const resampledPriceCurve = priceRollingAvg.map(item => item.sentimentRollingAvg);
    const targetPriceCurve = normalizeToRange(resampledPriceCurve, -1, 1);
    const windowedTarget = applyTukeyWindow(targetPriceCurve, TUKEY_TAPER_PERCENTAGE);
    const paddedTarget = [...windowedTarget, ...new Array(N - windowedTarget.length).fill(0)];
    const targetNorm = Math.sqrt(targetPriceCurve.reduce((sum, val) => sum + val * val, 0));
    const optimizedCorrelate = createOptimizedCorrelator(fftContext, paddedTarget, targetNorm, N, RESOLUTION_MINUTES, LAG_PREFERENCE_CONFIG);
    const originalScore = optimizedCorrelate(baselineSignal).maxCorrelation;

    const sharedParams = { timeGrid, priceData, fftContext, N, resolutionMinutes: RESOLUTION_MINUTES, lagPreferenceConfig: LAG_PREFERENCE_CONFIG, avoidExtremes };

    const signalConfigs = {
        stock: { hasData: originalStockSentiment.length > 0, sourceData: originalStockSentiment, lagDistribution: stockLagDistribution, stageNumber: 1, sourceName: 'stock' },
        market: { hasData: originalMarketSentiment.length > 0, sourceData: originalMarketSentiment, lagDistribution: marketLagDistribution, stageNumber: 2, sourceName: 'market' },
        industry: { hasData: originalIndustrySentiment.length > 0, sourceData: originalIndustrySentiment, lagDistribution: industryLagDistribution, stageNumber: 3, sourceName: 'industry' }
    };

    const { results, perBucketStats } = await processSignalTypes(signalConfigs, sharedParams, progressTracker);

    const stockScore = perBucketStats.stock.tunedCorrelation;
    const marketScore = perBucketStats.market.tunedCorrelation;
    const industryScore = perBucketStats.industry.tunedCorrelation;

    const stockScoreNorm = Math.max(0, stockScore);
    const marketScoreNorm = Math.max(0, marketScore);
    const industryScoreNorm = Math.max(0, industryScore);

    const totalScore = stockScoreNorm + marketScoreNorm + industryScoreNorm;

    let rawBlendWeights;
    if (totalScore > 0) {
        rawBlendWeights = {
            stock: (stockScoreNorm / totalScore) * 3,
            market: (marketScoreNorm / totalScore) * 3,
            industry: (industryScoreNorm / totalScore) * 3
        };
    } else {
        rawBlendWeights = { stock: 1, market: 1, industry: 1 };
    }

    const bestBlendWeights = constrainBlendWeights(rawBlendWeights);

    const optimizedSignals = {
        stock: results.stock ? results.stock.finalSignal : new Array(timeGrid.length).fill(0),
        market: results.market ? results.market.finalSignal : new Array(timeGrid.length).fill(0),
        industry: results.industry ? results.industry.finalSignal : new Array(timeGrid.length).fill(0)
    };

    const finalCombinedSignal = timeGrid.map((_, i) =>
        (optimizedSignals.stock[i] * bestBlendWeights.stock) +
        (optimizedSignals.market[i] * bestBlendWeights.market) +
        (optimizedSignals.industry[i] * bestBlendWeights.industry)
    );

    const masterBlendPriceCorrelatorCache = createPriceCorrelatorCache(priceData, timeGrid, fftContext, N, RESOLUTION_MINUTES, LAG_PREFERENCE_CONFIG);
    let bestFinalCorrelation = -Infinity;
    let bestFinalPriceWindow = DEFAULT_PRICE_WINDOW_MS;

    for (const pWinMin of priceWindowsMinutes) {
        const pWinMs = pWinMin * 60 * 1000;
        const correlator = masterBlendPriceCorrelatorCache[pWinMs];
        const { maxCorrelation } = correlator(finalCombinedSignal);
        if (maxCorrelation > bestFinalCorrelation) {
            bestFinalCorrelation = maxCorrelation;
            bestFinalPriceWindow = pWinMs;
        }
    }

    const totalWeight = bestBlendWeights.stock + bestBlendWeights.market + bestBlendWeights.industry;
    let finalOptimalLagHours = 0;
    if (totalWeight > 0) {
        const weightedLagSum = (perBucketStats.stock.tunedLag * bestBlendWeights.stock) +
                               (perBucketStats.market.tunedLag * bestBlendWeights.market) +
                               (perBucketStats.industry.tunedLag * bestBlendWeights.industry);
        finalOptimalLagHours = weightedLagSum / totalWeight;
    }

    const bestParams = {
        blend_weights: bestBlendWeights,
        blend_price_window_ms: bestFinalPriceWindow,
        stock_params: results.stock?.bestParams,
        market_params: results.market?.bestParams,
        industry_params: results.industry?.bestParams,
        stock_source_weights: results.stock?.bestParams.sourceWeights,
        market_source_weights: results.market?.bestParams.sourceWeights,
        industry_source_weights: results.industry?.bestParams.sourceWeights,
        optimal_lag_hours: finalOptimalLagHours,
    };

    await progressTracker.finish('Complete');

    return {
        bestScore: bestFinalCorrelation,
        originalScore: originalScore,
        bestParams,
        targetPriceCurve: targetPriceCurve,
        timeGrid,
        optimalSentimentCurve: normalizeToRange(finalCombinedSignal, -1, 1),
        currentSentimentCurve: normalizeToRange(baselineSignal, -1, 1),
        optimalStockCurve: normalizeToRange(optimizedSignals.stock, -1, 1),
        optimalMarketCurve: normalizeToRange(optimizedSignals.market, -1, 1),
        optimalIndustryCurve: normalizeToRange(optimizedSignals.industry, -1, 1),
        stockLagDistribution,
        marketLagDistribution,
        industryLagDistribution,
        perBucketStats,
        optimalLag: finalOptimalLagHours,
        correlationComparison: {
            original: originalScore,
            optimized: bestFinalCorrelation,
            improvement: bestFinalCorrelation - originalScore,
        },
        finalBlendedCorrelation: bestFinalCorrelation,
    };
}