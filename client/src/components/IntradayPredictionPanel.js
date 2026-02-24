import React, { useMemo, useEffect, useState } from 'react';
import { Box, Text, Flex, SimpleGrid, Badge, useColorMode, Progress, VStack, HStack, Spinner, Alert, AlertIcon, useColorModeValue } from '@chakra-ui/react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend, Area, ReferenceArea, ReferenceLine, Dot } from 'recharts';
import { COLORS } from '../config/Config';
import { fetchMarketData } from '../services/apiService';

const MARKET_OPEN = 4 * 60;
const MARKET_CLOSE = 20 * 60;
const TRADING_OPEN = 9.5 * 60;
const TRADING_CLOSE = 16 * 60;
const TRADING_MINUTES = MARKET_CLOSE - MARKET_OPEN;
const HISTORICAL_DAYS_FOR_PATTERNS = 90;
const RECENT_DAYS_FOR_CURRENT = 1;

const formatPercent = (percent) => {
  if (percent === null || percent === undefined || isNaN(percent)) return 'N/A';
  return `${Number(percent).toFixed(1)}%`;
};

const formatVolume = (volume) => {
  if (volume === null || volume === undefined || isNaN(volume)) return 'N/A';
  if (volume >= 1e9) return `${(volume / 1e9).toFixed(1)}B`;
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(1)}M`;
  if (volume >= 1e3) return `${(volume / 1e3).toFixed(1)}K`;
  return volume.toString();
};

const extractPrice = (item) => {
  if (!item) return null;
  const priceFields = ['originalPrice', 'price', 'close', 'value'];
  for (const field of priceFields) {
    if (item[field] !== undefined && item[field] !== null && !isNaN(item[field])) {
      return parseFloat(item[field]);
    }
  }
  return null;
};

const extractVolume = (item) => {
  if (!item) return null;
  const volumeFields = ['volume', 'vol'];
  for (const field of volumeFields) {
    if (item[field] !== undefined && item[field] !== null && !isNaN(item[field])) {
      return parseInt(item[field]);
    }
  }
  return null;
};

const extractMinuteData = (item) => {
  const dateObj = item.timestamp ? new Date(item.timestamp) : (item.date ? new Date(item.date) : null);
  if (!dateObj || isNaN(dateObj.getTime())) return null;

  const options = { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(dateObj);
  const getPart = (partName) => parts.find(p => p.type === partName)?.value || '';
  const hourET = parseInt(getPart('hour'), 10);
  const minuteET = parseInt(getPart('minute'), 10);
  const price = extractPrice(item);
  const volume = extractVolume(item);
  const high = item.high || price;
  const low = item.low || price;
  const open = item.open || price;

  return {
    timestamp: dateObj.getTime(),
    date: dateObj,
    price: parseFloat(price),
    volume: parseInt(volume),
    high: parseFloat(high),
    low: parseFloat(low),
    open: parseFloat(open),
    hour: hourET,
    minute: minuteET,
    minuteOfDay: hourET * 60 + minuteET
  };
};

const groupDataByDay = (data) => {
  const days = new Map();
  data.forEach(item => {
    const point = extractMinuteData(item);
    if (!point || !point.price) return;

    const dateKey = point.date.toISOString().split('T')[0];

    if (!days.has(dateKey)) {
      days.set(dateKey, {
        date: dateKey,
        minutes: []
      });
    }

    days.get(dateKey).minutes.push(point);
  });

  days.forEach(day => {
    day.minutes.sort((a, b) => a.minuteOfDay - b.minuteOfDay);

    if (day.minutes.length === 0) return;

    const firstPrice = day.minutes[0].price;
    const lastPrice = day.minutes[day.minutes.length - 1].price;

    day.open = firstPrice;
    day.close = lastPrice;
    day.dayReturn = ((lastPrice - firstPrice) / firstPrice * 100);

    const marketOpen = day.minutes.find(m => m.minuteOfDay >= TRADING_OPEN);
    const marketClose = day.minutes.slice().reverse().find(m => m.minuteOfDay <= TRADING_CLOSE);

    if (marketOpen && marketClose) {
      day.marketReturn = ((marketClose.price - marketOpen.price) / marketOpen.price * 100);
    } else {
      day.marketReturn = day.dayReturn;
    }

    day.high = Math.max(...day.minutes.map(m => m.high));
    day.low = Math.min(...day.minutes.map(m => m.low));
    day.volume = day.minutes.reduce((sum, m) => sum + m.volume, 0);
  });

  return Array.from(days.values()).filter(day => day.minutes.length > 10);
};

const extractDayFeatures = (day, cutoffMinute) => {
  const relevantMinutes = day.minutes.filter(m => m.minuteOfDay <= cutoffMinute);
  if (relevantMinutes.length < 1) return null;

  const firstMinute = relevantMinutes[0];
  const lastMinute = relevantMinutes[relevantMinutes.length - 1];
  const dayOpen = firstMinute.price;
  const priceChanges = [];
  const volumes = [];
  const volatilities = [];

  for (let i = 0; i < relevantMinutes.length; i++) {
    const m = relevantMinutes[i];
    priceChanges.push((m.price - dayOpen) / dayOpen * 100);
    volumes.push(m.volume);
    if (i >= 5) {
      const window = relevantMinutes.slice(i - 5, i);
      const mean = window.reduce((sum, w) => sum + w.price, 0) / window.length;
      const variance = window.reduce((sum, w) => sum + Math.pow(w.price - mean, 2), 0) / window.length;
      volatilities.push(Math.sqrt(variance) / mean * 100);
    }
  }

  const totalVolume = volumes.reduce((sum, v) => sum + v, 0);
  const currentReturn = (lastMinute.price - dayOpen) / dayOpen * 100;
  const momentum15 = relevantMinutes.length >= 15 ? (lastMinute.price - relevantMinutes[relevantMinutes.length - 15].price) / relevantMinutes[relevantMinutes.length - 15].price * 100 : 0;

  const volumeProfile = [];
  const priceProfile = [];
  const startMinute = relevantMinutes[0].minuteOfDay;
  const endMinute = relevantMinutes[relevantMinutes.length - 1].minuteOfDay;
  const totalDuration = endMinute - startMinute;
  const numBuckets = 10;
  const bucketDuration = Math.max(1, totalDuration / numBuckets);

  for (let i = 0; i < numBuckets; i++) {
    const bucketStart = startMinute + i * bucketDuration;
    const bucketEnd = bucketStart + bucketDuration;
    const bucketMinutes = relevantMinutes.filter(m => m.minuteOfDay >= bucketStart && m.minuteOfDay < bucketEnd);
    if (bucketMinutes.length > 0) {
      const bucketVolume = bucketMinutes.reduce((sum, m) => sum + m.volume, 0);
      const normalizedVolume = totalVolume > 0 ? bucketVolume / totalVolume : 0;
      const bucketReturn = (bucketMinutes[bucketMinutes.length - 1].price - bucketMinutes[0].price) / bucketMinutes[0].price * 100;
      volumeProfile.push(normalizedVolume);
      priceProfile.push(bucketReturn);
    } else {
      volumeProfile.push(0);
      priceProfile.push(0);
    }
  }

  return {
    date: day.date,
    minuteCount: relevantMinutes.length,
    currentReturn,
    maxDrawdown: Math.min(...priceChanges),
    maxGain: Math.max(...priceChanges),
    totalVolume,
    momentum5: relevantMinutes.length >= 5 ? (lastMinute.price - relevantMinutes[relevantMinutes.length - 5].price) / relevantMinutes[relevantMinutes.length - 5].price * 100 : 0,
    momentum15,
    volumeProfile,
    priceProfile,
    volatility: volatilities.length > 0 ? volatilities.reduce((a, b) => a + b, 0) / volatilities.length : 0,
    marketReturn: day.marketReturn,
    minutes: relevantMinutes
  };
};

const calculateDTWDistance = (seq1, seq2) => {
  const n = seq1.length;
  const m = seq2.length;
  const dtw = Array(n + 1).fill(null).map(() => Array(m + 1).fill(Infinity));
  dtw[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = Math.abs(seq1[i - 1] - seq2[j - 1]);
      dtw[i][j] = cost + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
    }
  }
  return dtw[n][m] / Math.max(n, m);
};

const cosineSimilarity = (vec1, vec2) => {
  if (vec1.length !== vec2.length) return 0;
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
};

const calculateSimilarity = (current, historical) => {
  if (!current || !historical) return 0;
  const priceDTW = calculateDTWDistance(current.priceProfile, historical.priceProfile);
  const volumeDTW = calculateDTWDistance(current.volumeProfile, historical.volumeProfile);
  const featureVector1 = [current.currentReturn, current.maxDrawdown, current.maxGain, current.momentum5, current.momentum15, current.volatility];
  const featureVector2 = [historical.currentReturn, historical.maxDrawdown, historical.maxGain, historical.momentum5, historical.momentum15, historical.volatility];
  const featureSim = cosineSimilarity(featureVector1, featureVector2);
  const priceSim = 1 / (1 + priceDTW);
  const volumeSim = 1 / (1 + volumeDTW);
  const weights = { price: 0.4, volume: 0.2, features: 0.4 };
  return priceSim * weights.price + volumeSim * weights.volume + featureSim * weights.features;
};

const findSimilarDays = (currentFeatures, historicalDays, topN = 10) => {
  return historicalDays.map(day => ({...day, similarity: calculateSimilarity(currentFeatures, day)}))
    .filter(day => day.similarity > 0.3)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);
};

const predictOutcome = (similarDays) => {
  if (similarDays.length === 0) return { prediction: 0, confidence: 0, distribution: {} };

  let weightedSum = 0;
  let totalWeight = 0;
  const outcomes = { positive: 0, negative: 0, neutral: 0 };

  similarDays.forEach(day => {
    const weight = day.normalizedSimilarity / 100;
    const marketReturn = day.marketReturn;
    weightedSum += marketReturn * weight;
    totalWeight += weight;

    if (marketReturn > 0.5) outcomes.positive += weight;
    else if (marketReturn < -0.5) outcomes.negative += weight;
    else outcomes.neutral += weight;
  });

  const prediction = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const avgSimilarity = similarDays.reduce((sum, d) => sum + d.normalizedSimilarity, 0) / similarDays.length;
  const confidence = Math.min(avgSimilarity, 100);

  const total = outcomes.positive + outcomes.negative + outcomes.neutral;
  if (total > 0) {
    outcomes.positive = (outcomes.positive / total) * 100;
    outcomes.negative = (outcomes.negative / total) * 100;
    outcomes.neutral = (outcomes.neutral / total) * 100;
  }

  return { prediction, confidence, distribution: outcomes };
};

const prepareIntradayChartData = (currentFeatures, similarDaysWithFullData) => {
  if (!currentFeatures || !currentFeatures.minutes || currentFeatures.minutes.length === 0) return [];
  const cutoffMinute = currentFeatures.minutes[currentFeatures.minutes.length - 1].minuteOfDay;
  const currentDayOpen = currentFeatures.minutes[0].price;
  const currentMinutesMap = new Map(currentFeatures.minutes.map(m => [m.minuteOfDay, m]));

  const currentMarketOpen = currentFeatures.minutes.find(m => m.minuteOfDay >= TRADING_OPEN);
  const currentMarketOpenPrice = currentMarketOpen ? currentMarketOpen.price : currentDayOpen;

  const similarDaysData = similarDaysWithFullData.map(day => {
    const dayOpen = day.minutes.length > 0 ? day.minutes[0].price : 0;
    const marketOpenMinute = day.minutes.find(m => m.minuteOfDay >= TRADING_OPEN);
    const marketOpenPrice = marketOpenMinute ? marketOpenMinute.price : dayOpen;
    return {
      dayOpen: dayOpen,
      marketOpenPrice: marketOpenPrice,
      minutesMap: new Map(day.minutes.map(m => [m.minuteOfDay, m]))
    };
  });

  let allVolumes = [];

  for (let minute = MARKET_OPEN; minute <= cutoffMinute; minute++) {
    if (currentMinutesMap.has(minute)) {
      const vol = currentMinutesMap.get(minute).volume;
      if (vol > 0) allVolumes.push(vol);
    }
  }

  similarDaysData.forEach(dayData => {
    for (let minute = MARKET_OPEN; minute <= MARKET_CLOSE; minute++) {
      if (dayData.minutesMap.has(minute)) {
        const vol = dayData.minutesMap.get(minute).volume;
        if (vol > 0) allVolumes.push(vol);
      }
    }
  });

  const minVolume = allVolumes.length > 0 ? Math.min(...allVolumes) : 0;
  const maxVolume = allVolumes.length > 0 ? Math.max(...allVolumes) : 1;

  const transformVolume = (volume) => {
    if (!volume || volume <= 0) return 0;
    const normalized = (volume - minVolume) / (maxVolume - minVolume);
    const transformed = Math.sqrt(normalized);
    return transformed * 100;
  };

  const chartData = [];
  let lastCurrentValue = null;
  let lastCurrentMarketValue = null;
  let lastCurrentVolume = null;
  let lastCurrentPrice = null;
  const lastSimilarValues = new Array(similarDaysWithFullData.length).fill(null);
  const lastSimilarMarketValues = new Array(similarDaysWithFullData.length).fill(null);
  const lastSimilarVolumes = new Array(similarDaysWithFullData.length).fill(null);
  const lastSimilarPrices = new Array(similarDaysWithFullData.length).fill(null);

  let dataPointCounter = 0;
  for (let minute = MARKET_OPEN; minute <= MARKET_CLOSE; minute++) {
    const point = {
      time: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
      minuteOfDay: minute
    };

    const showDataPoint = minute % 60 === 0 && minute >= MARKET_OPEN && minute <= MARKET_CLOSE;

    if (minute <= cutoffMinute) {
      if (currentMinutesMap.has(minute)) {
        const currentMinuteData = currentMinutesMap.get(minute);
        const returnFromDayOpen = ((currentMinuteData.price - currentDayOpen) / currentDayOpen) * 100;
        const returnFromMarketOpen = minute >= TRADING_OPEN ? ((currentMinuteData.price - currentMarketOpenPrice) / currentMarketOpenPrice) * 100 : null;
        const transformedVolume = transformVolume(currentMinuteData.volume);
        point.current = returnFromDayOpen;
        point.currentMarket = returnFromMarketOpen;
        point.currentVolume = transformedVolume;
        point.currentPrice = currentMinuteData.price;
        point.currentVolumeRaw = currentMinuteData.volume;
        lastCurrentValue = returnFromDayOpen;
        lastCurrentMarketValue = returnFromMarketOpen;
        lastCurrentVolume = transformedVolume;
        lastCurrentPrice = currentMinuteData.price;
        if (showDataPoint) {
          point.currentLabel = `${currentMinuteData.price.toFixed(2)}`;
          point.currentVolumeLabel = formatVolume(currentMinuteData.volume);
        }
      } else {
        point.current = lastCurrentValue;
        point.currentMarket = lastCurrentMarketValue;
        point.currentVolume = lastCurrentVolume;
        point.currentPrice = lastCurrentPrice;
      }
    } else {
      point.current = null;
      point.currentMarket = null;
      point.currentVolume = null;
    }

    similarDaysWithFullData.forEach((day, idx) => {
      const dayData = similarDaysData[idx];
      if (dayData.minutesMap.has(minute)) {
        const minuteData = dayData.minutesMap.get(minute);
        const returnFromDayOpen = ((minuteData.price - dayData.dayOpen) / dayData.dayOpen) * 100;
        const returnFromMarketOpen = minute >= TRADING_OPEN ? ((minuteData.price - dayData.marketOpenPrice) / dayData.marketOpenPrice) * 100 : null;
        const transformedVolume = transformVolume(minuteData.volume);
        point[`similar${idx}`] = returnFromDayOpen;
        point[`similarMarket${idx}`] = returnFromMarketOpen;
        point[`similarVolume${idx}`] = transformedVolume;
        point[`similarPrice${idx}`] = minuteData.price;
        point[`similarVolumeRaw${idx}`] = minuteData.volume;
        lastSimilarValues[idx] = returnFromDayOpen;
        lastSimilarMarketValues[idx] = returnFromMarketOpen;
        lastSimilarVolumes[idx] = transformedVolume;
        lastSimilarPrices[idx] = minuteData.price;
      } else {
        point[`similar${idx}`] = lastSimilarValues[idx];
        point[`similarMarket${idx}`] = lastSimilarMarketValues[idx];
        point[`similarVolume${idx}`] = lastSimilarVolumes[idx];
        point[`similarPrice${idx}`] = lastSimilarPrices[idx];
      }
    });

    chartData.push(point);
    dataPointCounter++;
  }

  chartData.volumeStats = { minVolume, maxVolume };
  return chartData;
};

const CustomDot = ({ cx, cy, payload, dataKey, label, fill, showLabel }) => {
  if (!showLabel || !label) return null;
  return (
    <g>
      <rect x={cx - 25} y={cy - 10} width="50" height="15" fill="rgba(0,0,0,0.7)" rx="3" />
      <text x={cx} y={cy - 1} fill="white" fontSize="9" textAnchor="middle" fontWeight="bold">
        {label}
      </text>
      <circle cx={cx} cy={cy} r="3" fill={fill} />
    </g>
  );
};

const getSimilarityColor = (normalizedScore) => {
  const score = normalizedScore / 100;
  if (score > 0.85) return 'green.300';
  if (score > 0.65) return 'teal.300';
  if (score > 0.40) return 'yellow.400';
  return 'gray.400';
};

const getActionForReturn = (marketReturn) => {
  if (marketReturn > 0.5) return { action: 'BUY', color: 'green' };
  if (marketReturn < -0.5) return { action: 'SELL', color: 'red' };
  return { action: 'HOLD', color: 'gray' };
};

const SimilarDayCard = ({ day, rank }) => {
  const { colorMode } = useColorMode();
  const bgColor = colorMode === 'dark' ? 'gray.800' : 'gray.50';
  const progressColor = useColorModeValue('blue.100', 'blue.800');
  const action = getActionForReturn(day.marketReturn);
  const chartColor = rank < 5 ? `hsl(${rank * 60}, 70%, 50%)` : '#888';

  return (
    <Box p={2} borderRadius="md" border="2px solid" borderColor={chartColor} position="relative" bg={bgColor} overflow="hidden">
      <Box position="absolute" left="0" top="0" height="100%" width={`${day.normalizedSimilarity}%`} bg={progressColor} opacity={0.4} zIndex={0} transition="width 0.3s ease-in-out"/>
      <Flex justify="space-between" align="center" position="relative" zIndex={1}>
        <VStack align="start" spacing={0}>
          <Text fontSize="xs" fontWeight="bold" color={chartColor}>#{rank + 1} {day.date}</Text>
          <Text fontSize="xs" color={getSimilarityColor(day.normalizedSimilarity)} fontWeight="bold">Similarity: {formatPercent(day.normalizedSimilarity)}</Text>
        </VStack>
        <HStack>
          <Badge colorScheme={action.color} variant="solid" fontSize="0.6em">{action.action}</Badge>
          <VStack align="end" spacing={0}>
            <Text fontSize="xs" fontWeight="bold" color={day.marketReturn >= 0 ? 'green.400' : 'red.400'}>
              {day.marketReturn > 0 ? '+' : ''}{formatPercent(day.marketReturn)}
            </Text>
            <Text fontSize="xs" color="gray.500">9:30am-4pm</Text>
          </VStack>
        </HStack>
      </Flex>
    </Box>
  );
};

const getVolumePaceLabel = (percentile) => {
    if (percentile === null || isNaN(percentile)) return { label: 'N/A', color: 'gray.500' };
    if (percentile > 90) return { label: 'Very High', color: 'red.400' };
    if (percentile > 75) return { label: 'High', color: 'orange.400' };
    if (percentile > 25) return { label: 'Average', color: 'green.400' };
    if (percentile > 10) return { label: 'Low', color: 'cyan.400' };
    return { label: 'Very Low', color: 'purple.400' };
};

const IntradayPredictionPanel = React.memo(({ companyInfo, captureRef, onRenderComplete }) => {
  const { colorMode } = useColorMode();
  const [stockHistorical, setStockHistorical] = useState([]);
  const [stockRecent, setStockRecent] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!companyInfo?.symbol) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [historicalRes, recentRes] = await Promise.all([
          fetchMarketData(companyInfo.symbol, "stock", "recent", HISTORICAL_DAYS_FOR_PATTERNS),
          fetchMarketData(companyInfo.symbol, "stock", "recent", RECENT_DAYS_FOR_CURRENT)
        ]);

        setStockHistorical(historicalRes?.prices || []);
        setStockRecent(recentRes?.prices || []);
      } catch (err) {
        setError("Failed to fetch intraday prediction data. " + err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [companyInfo?.symbol]);

  const intradayAnalysis = useMemo(() => {
    if (!stockHistorical || stockHistorical.length === 0) return null;

    const historicalDayData = groupDataByDay(stockHistorical);
    const recentDayData = groupDataByDay(stockRecent);

    if (historicalDayData.length < 2) return null;

    const now = new Date();
    const options = { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(now);
    const getPart = (partName) => parts.find(p => p.type === partName)?.value || '';
    const hourET = parseInt(getPart('hour'), 10);
    const minuteET = parseInt(getPart('minute'), 10);
    const currentMinute = hourET * 60 + minuteET;
    const todayDateString = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;

    let analysisDay, marketMinute, progressTitle;

    const todayFromRecent = recentDayData.find(day => day.date === todayDateString);
    if (todayFromRecent && todayFromRecent.minutes.length > 0) {
      analysisDay = todayFromRecent;
      marketMinute = Math.min(currentMinute, MARKET_CLOSE);
      progressTitle = "Day In Progress";
    } else {
      const latestDay = recentDayData.length > 0 ? recentDayData[recentDayData.length - 1] : historicalDayData[historicalDayData.length - 1];
      if (!latestDay) return null;
      analysisDay = latestDay;
      marketMinute = MARKET_CLOSE;
      progressTitle = `Analyzed Day: ${analysisDay.date}`;
    }

    if (!analysisDay) return null;

    const analysisDayFeatures = extractDayFeatures(analysisDay, marketMinute);
    if (!analysisDayFeatures) return null;

    const historicalFeatures = historicalDayData
      .filter(day => day.date !== analysisDay.date)
      .map(day => extractDayFeatures(day, marketMinute))
      .filter(f => f !== null);

    const historicalVolumes = historicalFeatures.map(day => day.totalVolume).filter(v => v > 0);
    let volumePercentile = null;
    if (historicalVolumes.length > 0) {
        const currentVolume = analysisDayFeatures.totalVolume;
        const countBelow = historicalVolumes.filter(v => v < currentVolume).length;
        volumePercentile = (countBelow / historicalVolumes.length) * 100;
    }

    const rawSimilarDays = findSimilarDays(analysisDayFeatures, historicalFeatures, 10);
    if (rawSimilarDays.length === 0) return null;

    const maxSim = rawSimilarDays[0].similarity;
    const minSim = rawSimilarDays.length > 1 ? rawSimilarDays[rawSimilarDays.length - 1].similarity : maxSim;
    const range = maxSim - minSim;
    const similarDays = rawSimilarDays.map(day => {
      const normalizedSimilarity = range > 0.0001 ? ((day.similarity - minSim) / range) * 100 : 100;
      return { ...day, normalizedSimilarity };
    });

    const prediction = predictOutcome(similarDays);
    const similarDaysWithFullData = similarDays.map(simDay => {
      const fullDay = historicalDayData.find(d => d.date === simDay.date);
      return fullDay;
    }).filter(d => d !== undefined);
    const intradayChartData = prepareIntradayChartData(analysisDayFeatures, similarDaysWithFullData);

    const generateTicks = (data) => {
      if (!data || data.length === 0) return [];
      const ticks = new Set();
      data.forEach(item => {
        if (item.time && (item.time.endsWith(':00') || item.time.endsWith(':30'))) {
          ticks.add(item.time);
        }
      });
      return Array.from(ticks);
    };

    let minVolume = Infinity;
    let maxVolume = -Infinity;
    if (analysisDayFeatures && analysisDayFeatures.minutes) {
      analysisDayFeatures.minutes.forEach(m => {
        if (m.volume !== null && m.volume !== undefined) {
          minVolume = Math.min(minVolume, m.volume);
          maxVolume = Math.max(maxVolume, m.volume);
        }
      });
    }

    return {
      current: analysisDayFeatures,
      similar: similarDays,
      prediction,
      chartData: intradayChartData,
      volumeScale: { min: minVolume, max: maxVolume },
      timeProgress: ((marketMinute - MARKET_OPEN) / TRADING_MINUTES) * 100,
      progressTitle: progressTitle,
      chartTicks: generateTicks(intradayChartData),
      volumePace: getVolumePaceLabel(volumePercentile)
    };
  }, [stockHistorical, stockRecent]);

  useEffect(() => {
    if (onRenderComplete && !isLoading && !error) onRenderComplete();
  }, [onRenderComplete, isLoading, error]);

  const extendedHoursFill = useColorModeValue('gray.100', 'gray.900');
  const gridStrokeColor = useColorModeValue('#E2E8F0', '#2D3748');

  if (isLoading) return (<Flex justify="center" align="center" minH="400px" ref={captureRef}><Spinner size="xl" /></Flex>);
  if (error) return (<Box ref={captureRef}><Alert status="error"><AlertIcon />{error}</Alert></Box>);
  if (!intradayAnalysis) return (<Box p={4} textAlign="center" ref={captureRef}><Text color="gray.500">Insufficient data for intraday pattern analysis</Text></Box>);

  return (
    <Box p={3} ref={captureRef}>
      <Text fontSize="lg" fontWeight="bold" mb={3} textAlign="center">{companyInfo?.name || 'Stock'} ({companyInfo?.symbol || ''}) - Intraday Pattern Prediction</Text>
      <VStack spacing={3} align="stretch">
        <Box p={3} bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'} borderRadius="md" border="1px solid" borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'}>
          <Text fontSize="sm" fontWeight="bold" mb={2}>{intradayAnalysis.progressTitle}</Text>
          <Progress value={intradayAnalysis.timeProgress} colorScheme="blue" size="sm" mb={2} />
          <Flex justify="space-between">
            <Text fontSize="xs" color="gray.500">{intradayAnalysis.current.minuteCount} minutes analyzed</Text>
            <Text fontSize="xs" fontWeight="bold" color={intradayAnalysis.current.currentReturn >= 0 ? 'green.400' : 'red.400'}>Current Return (from 4am): {intradayAnalysis.current.currentReturn > 0 ? '+' : ''}{formatPercent(intradayAnalysis.current.currentReturn)}</Text>
          </Flex>
        </Box>
        <SimpleGrid columns={3} spacing={2}>
          <Box p={3} bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'} borderRadius="md" border="1px solid" borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'} textAlign="center">
            <Text fontSize="xs" color="gray.500" mb={1}>Predicted Move (9:30am-4pm)</Text>
            <Text fontSize="lg" fontWeight="bold" color={intradayAnalysis.prediction.prediction >= 0 ? 'green.400' : 'red.400'}>{intradayAnalysis.prediction.prediction > 0 ? '+' : ''}{formatPercent(intradayAnalysis.prediction.prediction)}</Text>
            <Text fontSize="xs" color="gray.500">Confidence: {formatPercent(intradayAnalysis.prediction.confidence)}</Text>
          </Box>
          <Box p={3} bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'} borderRadius="md" border="1px solid" borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'} textAlign="center">
            <Text fontSize="xs" color="gray.500" mb={1}>Outcome Distribution</Text>
            <HStack spacing={1} justify="center">
              <VStack spacing={0}><Text fontSize="xs" fontWeight="bold" color="green.400">{formatPercent(intradayAnalysis.prediction.distribution.positive)}</Text><Text fontSize="xs" color="gray.500">Up</Text></VStack>
              <VStack spacing={0}><Text fontSize="xs" fontWeight="bold" color="gray.400">{formatPercent(intradayAnalysis.prediction.distribution.neutral)}</Text><Text fontSize="xs" color="gray.500">Flat</Text></VStack>
              <VStack spacing={0}><Text fontSize="xs" fontWeight="bold" color="red.400">{formatPercent(intradayAnalysis.prediction.distribution.negative)}</Text><Text fontSize="xs" color="gray.500">Down</Text></VStack>
            </HStack>
          </Box>
          <Box p={3} bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'} borderRadius="md" border="1px solid" borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'} textAlign="center">
            <Text fontSize="xs" color="gray.500" mb={1}>Pattern Metrics</Text>
            <VStack spacing={0} align="stretch">
                <Flex justify="space-between"><Text fontSize="xs" color="gray.400">Vol:</Text><Text fontSize="xs">{formatVolume(intradayAnalysis.current.totalVolume)}</Text></Flex>
                <Flex justify="space-between"><Text fontSize="xs" color="gray.400">Mom. (15m):</Text><Text fontSize="xs">{formatPercent(intradayAnalysis.current.momentum15)}</Text></Flex>
                <Flex justify="space-between"><Text fontSize="xs" color="gray.400">Vlty (5m):</Text><Text fontSize="xs">{formatPercent(intradayAnalysis.current.volatility)}</Text></Flex>
                <Flex justify="space-between"><Text fontSize="xs" color="gray.400">Vol. Pace:</Text><Text fontSize="xs" fontWeight="bold" color={intradayAnalysis.volumePace.color}>{intradayAnalysis.volumePace.label}</Text></Flex>
            </VStack>
          </Box>
        </SimpleGrid>
        <Box p={1} bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'} borderRadius="md" border="1px solid" borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'}>
          <Text fontSize="sm" fontWeight="bold" mb={1} ml={2}>Pattern Comparison (showing returns from 4am baseline)</Text>
          <Box height="400px" bg={colorMode === 'dark' ? 'black' : 'white'} borderRadius="md">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={intradayAnalysis.chartData} margin={{ top: 20, right: 38, left: 38, bottom: 18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStrokeColor} opacity={0.3} />
                <XAxis dataKey="time" height={20} tick={{ fontSize: 8, fill: '#A0AEC0' }} ticks={intradayAnalysis.chartTicks} interval="preserveStartEnd" />
                <YAxis yAxisId="price" width={35} tick={{ fontSize: 8, fill: '#A0AEC0' }} domain={['auto', 'auto']} tickCount={9} interval={0} tickFormatter={(value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`} />
                <YAxis yAxisId="volume" width={35} orientation="right" domain={[0, 100]} tick={{ fontSize: 8, fill: '#A0AEC0' }} tickCount={11} interval={0} tickFormatter={(value) => {
                  if (!intradayAnalysis.chartData.volumeStats) return '0';
                  const { minVolume, maxVolume } = intradayAnalysis.chartData.volumeStats;
                  const normalizedFromChart = value / 100;
                  const linearValue = normalizedFromChart * normalizedFromChart;
                  const actualVolume = minVolume + (linearValue * (maxVolume - minVolume));
                  return formatVolume(Math.round(actualVolume));
                }} />
                <ReferenceArea x1="04:00" x2="09:30" strokeOpacity={0.3} fill={extendedHoursFill} ifOverflow="visible" />
                <ReferenceArea x1="16:00" x2="20:00" strokeOpacity={0.3} fill={extendedHoursFill} ifOverflow="visible" />

                <ReferenceLine x="09:30" stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="8 4" yAxisId="price" />
                <ReferenceLine x="16:00" stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="8 4" yAxisId="price" />

                {intradayAnalysis.similar.slice(0, 5).map((day, idx) => (
                  <Area
                    key={`vol${idx}`}
                    yAxisId="volume"
                    type="monotone"
                    dataKey={`similarVolume${idx}`}
                    fill={`hsl(${idx * 60}, 70%, 50%)`}
                    fillOpacity={0.1}
                    stroke="none"
                    isAnimationActive={false}
                    legendType="none"
                  />
                ))}

                {intradayAnalysis.similar.slice(0, 5).map((day, idx) => (
                  <Line
                    key={idx}
                    yAxisId="price"
                    type="monotone"
                    dataKey={`similar${idx}`}
                    stroke={`hsl(${idx * 60}, 70%, 50%)`}
                    strokeWidth={1}
                    strokeOpacity={0.4}
                    dot={false}
                    legendType="none"
                    isAnimationActive={false}
                  />
                ))}

                <Area
                  yAxisId="volume"
                  type="monotone"
                  dataKey="currentVolume"
                  fill="white"
                  fillOpacity={0.3}
                  stroke="white"
                  strokeWidth={1}
                  isAnimationActive={false}
                  name="Current Volume"
                />

                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="current"
                  stroke="white"
                  strokeWidth={4}
                  dot={({ key, ...props }) => <CustomDot key={key} {...props} label={props.payload.currentLabel} fill="white" showLabel={true} />}
                  name="Current Price"
                  connectNulls={false}
                  isAnimationActive={false}
                />

                {intradayAnalysis.current.minutes.length > 0 && (
                  <ReferenceLine
                    x={`${String(Math.floor(intradayAnalysis.current.minutes[intradayAnalysis.current.minutes.length - 1].minuteOfDay / 60)).padStart(2, '0')}:${String(intradayAnalysis.current.minutes[intradayAnalysis.current.minutes.length - 1].minuteOfDay % 60).padStart(2, '0')}`}
                    stroke="rgba(255,255,255,0.8)"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    yAxisId="price"
                    label={{ value: "NOW", position: 'top', fill: 'white', fontSize: 10 }}
                  />
                )}

                <Line
                  yAxisId="volume"
                  type="monotone"
                  dataKey="currentVolume"
                  stroke="none"
                  dot={(props) => {
                    const label = props.payload.currentVolumeLabel;
                    if (!label) return null;
                    const scaledY = props.cy + (300 * (100 - props.payload.currentVolume) / 100);
                    return (
                      <g>
                        <rect x={props.cx - 20} y={scaledY - 10} width="40" height="12" fill="rgba(0,0,0,0.7)" rx="2" />
                        <text x={props.cx} y={scaledY - 2} fill="white" fontSize="8" textAnchor="middle" fontWeight="bold">
                          {label}
                        </text>
                      </g>
                    );
                  }}
                  isAnimationActive={false}
                />

                <text x="50%" y="10" textAnchor="middle" fontSize="9" fill="#A0AEC0">
                  <tspan fill="white">● Current Price</tspan>
                  <tspan dx="15" fill="white">█ Volume</tspan>
                </text>
              </ComposedChart>
            </ResponsiveContainer>
          </Box>
        </Box>
        <Box>
          <Text fontSize="sm" fontWeight="bold" mb={2}>Top 10 Most Similar Days (BUY/SELL based on 9:30am-4pm performance)</Text>
          <SimpleGrid columns={2} spacing={2}>
            {intradayAnalysis.similar.map((day, idx) => (<SimilarDayCard key={idx} day={day} rank={idx} />))}
          </SimpleGrid>
        </Box>
        <Text fontSize="xs" color="gray.500" textAlign="center">Pattern Analysis: {intradayAnalysis.similar.length} similar days found • Chart shows returns from 4am baseline • BUY/SELL/HOLD decisions based on 9:30am-4pm performance only • Volume uses √ scaling for pre-market visibility</Text>
      </VStack>
    </Box>
  );
});

export default IntradayPredictionPanel;