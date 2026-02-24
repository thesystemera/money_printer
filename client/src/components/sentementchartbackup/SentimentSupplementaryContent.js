import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Box, Text, useColorMode, Flex, useToast, SimpleGrid, Spinner } from '@chakra-ui/react';
import { toPng } from 'html-to-image';
import SentimentChart from './SentimentChart';
import ComprehensiveOptionsVisualization from './ComprehensiveOptionsVisualization';
import HistoricalAnalysisPanel from './HistoricalAnalysisPanel';
import IntradayPredictionPanel from './IntradayPredictionPanel';
import TrendsSection from './RecommendationPredictionTrendAnalysis';
import {
  UI_ANIMATIONS,
  COLORS,
  DEFAULT_DATA_SETTINGS,
  DEFAULT_TEMPORAL_PARAMETERS
} from '../config/Config';
import { handleError, addLog } from '../services/socketService';
import { getCurrentTime } from '../services/timeService';
import { generateCommonLegendItems } from './SentimentChartUtils';
import { PredictionChart } from './RecommendationPredictionChart';
import { fetchMarketData, getHistoricalRecommendation } from '../services/apiService';

const BASE_CHART_LINES = {
  stockSentimentPoints: false, marketSentimentPoints: false, industrySentimentPoints: false,
  stockRollingAvg: false, marketRollingAvg: false, industryRollingAvg: false, combinedRollingAvg: false,
  combinedRollingAvgPresentFocus: false, masterTemporalImpact: false,
  stockTemporalImpact: false, marketTemporalImpact: false, industryTemporalImpact: false,
  stockVelocity: false, stockAcceleration: false, marketVelocity: false, marketAcceleration: false,
  industryVelocity: false, industryAcceleration: false, stockPrice: false, stockPriceBubbles: false,
  marketIndex: false, volume: false, stockArticleCount: false, marketArticleCount: false,
  industryArticleCount: false, marketSessions: false, currentTimeLine: false
};

const isChartReady = (ref) => {
  if (!ref?.current) return false;
  const element = ref.current;
  if (!element.offsetWidth || !element.offsetHeight) return false;
  return element.children.length !== 0;
};

const waitForChartReady = (ref, timeout = 7000) => {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (isChartReady(ref)) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Chart readiness check timed out for ref.`));
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });
};

const formatTimeRange = (hours) => {
  if (hours <= 24) {
    return `${hours} hours`;
  } else {
    const days = Math.round(hours / 24 * 10) / 10;
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
};

const HistoricalPredictionComparison = ({
  historicalRecommendations,
  colorMode,
  bgColor,
  labelColor,
  companyInfo
}) => {
  const [previousPredictionsActualPriceData, setPreviousPredictionsActualPriceData] = useState({});
  const [previousPredictionsIsLoading, setPreviousPredictionsIsLoading] = useState(false);
  const [previousPredictionsDataLoadedForSymbol, setPreviousPredictionsDataLoadedForSymbol] = useState(null);
  const toast = useToast();

  const fetchPreviousPredictionsActualPriceData = useCallback(async (symbol, activeRecommendation) => {
    if (!symbol || !activeRecommendation) return null;

    const targetDateTime = activeRecommendation.target_trading_datetime || activeRecommendation.timestamp;
    if (!targetDateTime) {
      addLog("Historical Prediction Comparison: No target date available for fetching actual price data", 'error');
      return null;
    }

    try {
      const targetDate = new Date(targetDateTime);
      const formattedDate = targetDate.toISOString().split('T')[0];

      const today = getCurrentTime();
      today.setHours(0, 0, 0, 0);

      const recDateParts = formattedDate.split('-').map(Number);
      const recDateOnly = new Date(recDateParts[0], recDateParts[1] - 1, recDateParts[2]);
      recDateOnly.setHours(0, 0, 0, 0);

      const daysDiff = Math.max(1, Math.ceil((today - recDateOnly) / (1000 * 60 * 60 * 24)) + 1);

      const result = await fetchMarketData(symbol, 'stock', 'recent', daysDiff);

      const pricesArray = Array.isArray(result) ? result :
                          (result && Array.isArray(result.prices) ? result.prices : []);

      const targetDateStr = formattedDate;
      const filteredPrices = pricesArray.filter(price => price.timestamp.split('T')[0] === targetDateStr);

      return filteredPrices.map(price => {
        const timeParts = price.timestamp.split('T')[1].split(':');
        return {
          hour: `${timeParts[0]}:${timeParts[1]}`,
          price: price.price,
          session: price.marketSession || 'regular',
          timestamp: new Date(price.timestamp).getTime(),
          isActual: true
        };
      });
    } catch (error) {
      addLog(`Historical Prediction Comparison: Error fetching actual price data for ${symbol}: ${error.message}`, 'error');
      console.error("Error details:", error);
      return null;
    }
  }, []);

  useEffect(() => {
    const loadPreviousPredictionsActualPriceData = async () => {
      if (!historicalRecommendations?.length || !companyInfo?.symbol) {
        return;
      }

      if (previousPredictionsDataLoadedForSymbol === companyInfo.symbol) {
        return;
      }

      setPreviousPredictionsIsLoading(true);

      try {
        const priceDataPromises = historicalRecommendations.map(rec =>
          fetchPreviousPredictionsActualPriceData(companyInfo.symbol, rec)
        );

        const results = await Promise.all(priceDataPromises);

        const newPriceDataMap = {};
        let dataWasFetched = false;

        historicalRecommendations.forEach((rec, index) => {
          const recId = rec.timestamp || rec.id;
          const priceData = results[index];
          if (priceData) {
            newPriceDataMap[recId] = priceData;
            dataWasFetched = true;
          }
        });

        if (dataWasFetched) {
          setPreviousPredictionsActualPriceData(newPriceDataMap);
          setPreviousPredictionsDataLoadedForSymbol(companyInfo.symbol);
        }
      } catch (error) {
        handleError(error, "Fetching historical actual price data", toast);
      } finally {
        setPreviousPredictionsIsLoading(false);
      }
    };

    loadPreviousPredictionsActualPriceData().catch(error => {
      console.error('Error in loadPreviousPredictionsActualPriceData:', error);
    });
  }, [historicalRecommendations, companyInfo?.symbol, fetchPreviousPredictionsActualPriceData, previousPredictionsDataLoadedForSymbol, toast]);

  const validRecommendations = historicalRecommendations || [];

  if (validRecommendations.length === 0) {
    return null;
  }

  return (
    <Box
      bg={bgColor}
      p={4}
      borderRadius="md"
      border="1px solid"
      borderColor={colorMode === 'dark' ? 'gray.600' : 'gray.200'}
      display="flex"
      flexDirection="column"
      width="100%"
      transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
    >
      <Text fontSize="md" mb={4} fontWeight="bold" textAlign="center" color={labelColor}>
        {companyInfo?.name || 'Stock'} ({companyInfo?.symbol || ''}) - Historical Prediction Performance
      </Text>

      <Flex direction="column" gap={4}>
        {validRecommendations.map((recommendation, index) => {
          const recId = recommendation.timestamp || recommendation.id;

          return (
            <Box key={`historical-prediction-${index}`} mb={2} width="100%">
              <Text fontSize="sm" fontWeight="bold" mb={1} textAlign="center" color={labelColor}>
                {recommendation.action} Recommendation
              </Text>
              <Box width="100%">
                <PredictionChart
                  activeRecommendation={recommendation}
                  borderColor={colorMode === 'dark' ? 'gray.600' : 'gray.200'}
                  textColor={labelColor}
                  colorMode={colorMode}
                  highlightBgColor={colorMode === 'dark' ? 'blue.900' : 'blue.50'}
                  actualPriceData={previousPredictionsActualPriceData[recId] || []}
                  isLoadingActualPrices={previousPredictionsIsLoading}
                />
              </Box>
            </Box>
          );
        })}
      </Flex>

      <Text fontSize="xs" textAlign="center" mt={6} color={labelColor}>
        Displays previous {validRecommendations.length} predictions compared to actual market performance.
        These charts help evaluate prediction accuracy and identify potential patterns or biases.
      </Text>
    </Box>
  );
};

const TrendAnalysisVisualization = ({ companyInfo, colorMode, bgColor, labelColor, captureRef }) => {
  const [trendData, setTrendData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const models = ['master', 'image', 'options', 'vibe'];

  const streamlinedVisibleLines = {
    buyMovWtd: false,
    buyDirectional: false,
    holdMovWtd: false,
    holdDirectional: false,
    sellMovWtd: false,
    sellDirectional: false,
  };

  useEffect(() => {
    const fetchTrendData = async () => {
      if (!companyInfo?.symbol) {
        setTrendData(null);
        return;
      }
      setIsLoading(true);
      try {
        const recommendations = await getHistoricalRecommendation(companyInfo.symbol, 1, false, "most_recent");
        const latestRecWithTrends = (Array.isArray(recommendations) && recommendations.length > 0)
          ? recommendations[0]
          : null;

        if (latestRecWithTrends && latestRecWithTrends.predictionAccuracy?.trends) {
          setTrendData(latestRecWithTrends.predictionAccuracy.trends);
        } else {
          setTrendData(null);
        }
      } catch (error) {
        handleError(error, `Fetching trend analysis data for ${companyInfo.symbol}`, null);
        setTrendData(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrendData();
  }, [companyInfo?.symbol]);

  const renderPlaceholder = (modelName) => (
    <Box
      p={4}
      borderWidth="1px"
      borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'}
      borderRadius="md"
      bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'}
      height="100%"
      display="flex"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <Text fontSize="md" fontWeight="bold" mb={2}>{`${modelName.charAt(0).toUpperCase() + modelName.slice(1)} Model Trend`}</Text>
      <Text fontSize="sm" color="gray.500">Data Not Available</Text>
    </Box>
  );

  if (isLoading) {
    return (
      <Flex justify="center" align="center" h="400px">
        <Spinner />
        <Text ml={4}>Loading All Trend Analyses...</Text>
      </Flex>
    );
  }

  if (!trendData) {
    return null;
  }

  return (
    <Box
      ref={captureRef}
      bg={bgColor}
      p={4}
      borderRadius="md"
      border="1px solid"
      borderColor={colorMode === 'dark' ? 'gray.600' : 'gray.200'}
    >
      <Text fontSize="md" mb={4} fontWeight="bold" textAlign="center" color={labelColor}>
        {companyInfo?.name || 'Stock'} ({companyInfo?.symbol || ''}) - Multi-Model Prediction Accuracy Trends
      </Text>
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
        {models.map(model => (
          <Box key={model}>
            {trendData[model] ? (
              <TrendsSection
                trends={trendData}
                preselectedModel={model}
                colorMode={colorMode}
                borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'}
                visibleLines={streamlinedVisibleLines}
              />
            ) : (
              renderPlaceholder(model)
            )}
          </Box>
        ))}
      </SimpleGrid>
      <Text fontSize="xs" textAlign="center" mt={6} color={labelColor}>
        A tiled view comparing the rolling accuracy trends for each predictive model.
      </Text>
    </Box>
  );
};

const ChartRenderer = ({ config, data, colorMode, bgColor, labelColor, selectedMarketIndex }) => {
  const legendItems = useMemo(() => {
      return generateCommonLegendItems({}, config.timeWindowOverride || 'temporal', selectedMarketIndex)
          .filter(item => config.visibleLines[item.dataKey]);
  }, [config.visibleLines, config.timeWindowOverride, selectedMarketIndex]);

  return (
    <Box
      ref={config.ref}
      bg={bgColor}
      py={2}
      borderRadius="md"
      border="1px solid"
      borderColor={colorMode === 'dark' ? 'gray.600' : 'gray.200'}
      display="flex"
      flexDirection="column"
      transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
      overflow="hidden"
    >
      <Text fontSize="md" px={2} mb={2} fontWeight="bold" textAlign="center" color={labelColor}>
        {config.title}
      </Text>

      <Flex justify="center" wrap="wrap" mb={2} px={2}>
        {legendItems.map((item, idx) => (
          <Flex key={`legend-${idx}`} align="center" mx={2} mb={1}>
            {item.isColorWheel ? (
              <Box position="relative" width="16px" height="16px" mr={1}>
                <Box
                  position="absolute"
                  top="0px"
                  left="4px"
                  width="6px"
                  height="6px"
                  borderRadius="50%"
                  bg={COLORS.stockSentiment}
                  opacity={0.9}
                />
                <Box
                  position="absolute"
                  top="6px"
                  left="0px"
                  width="6px"
                  height="6px"
                  borderRadius="50%"
                  bg={COLORS.marketSentiment}
                  opacity={0.9}
                />
                <Box
                  position="absolute"
                  top="6px"
                  right="0px"
                  width="6px"
                  height="6px"
                  borderRadius="50%"
                  bg={COLORS.industrySentiment}
                  opacity={0.9}
                />
              </Box>
            ) : (
              <Box w="8px" h="8px" bg={item.color} mr={1} borderRadius="full" />
            )}
            <Text fontSize="xs" color={labelColor}>{item.value}</Text>
          </Flex>
        ))}
      </Flex>

      <SentimentChart
        {...data}
        showControls={false}
        visibleLines={config.visibleLines}
        timeWindowOverride={config.timeWindowOverride}
        timeRangeOverride={config.timeRangeOverride}
        isInteractiveMode={false}
        futureWindowHours={config.futureWindowHours}
        temporalParams={config.temporalParams}
      />

      <Text fontSize="xs" textAlign="center" mt={0} px={2} color={labelColor}>
        {config.description}
      </Text>
    </Box>
  );
};

const SentimentSupplementaryContent = ({
  stockSentimentData,
  marketSentimentData,
  industrySentimentData = [],
  stockPriceData,
  marketIndicesData,
  selectedMarketIndex,
  onImageGenerated,
  onImageGenerationFailed,
  companyInfo,
  analysisStatus,
  dataResolutionMinutes = DEFAULT_DATA_SETTINGS.dataResolutionMinutes,
  optionsData = null,
  tradingCalendar = null,
  recentChartHours = DEFAULT_DATA_SETTINGS.recentChartHours,
  setIsGeneratingViz
}) => {
  const chartRefs = {
    temporalImpact: useRef(null),
    temporalImpactPresent: useRef(null),
    velocityAcceleration: useRef(null),
    recentVelocityAcceleration: useRef(null),
    masterTemporalImpactFocus: useRef(null),
    recentMasterTemporalImpactFocus: useRef(null),
    combinedSentiment: useRef(null),
    recentCombinedSentiment: useRef(null),
    recentTemporalImpact: useRef(null),
    recentTemporalImpactPresent: useRef(null),
    historical: useRef(null),
    intradayPrediction: useRef(null),
    predictionHistory: useRef(null),
    trendAnalysis: useRef(null),
  };

  const optionsCaptureRefs = useRef({
      top: null,
      tier1: null,
      tier2: null
  });

  const { colorMode } = useColorMode();
  const bgColor = colorMode === 'dark' ? '#1A202C' : 'white';
  const labelColor = colorMode === 'dark' ? 'white' : 'black';

  const [imagesGenerated, setImagesGenerated] = useState(false);
  const [optionsChartReady, setOptionsChartReady] = useState(false);
  const [previousPredictionsHistoricalRecommendations, setPreviousPredictionsHistoricalRecommendations] = useState([]);

  const currentTime = getCurrentTime().getTime();
  const recentTimeRangeStart = currentTime - (recentChartHours * 60 * 60 * 1000);
  const recentFutureHours = 6;

  const rollingAverageWindow = DEFAULT_TEMPORAL_PARAMETERS.rollingAverageWindowMs;

  const recentTimeRangeFormatted = useMemo(() => formatTimeRange(recentChartHours), [recentChartHours]);
  const rollingAvgWindowFormatted = useMemo(() => formatTimeRange(rollingAverageWindow / (60 * 60 * 1000)), [rollingAverageWindow]);

  const chartData = useMemo(() => ({
    stockSentimentData: stockSentimentData || [],
    marketSentimentData: marketSentimentData || [],
    industrySentimentData: industrySentimentData || [],
    stockPriceData: stockPriceData || [],
    marketIndicesData: marketIndicesData,
    selectedMarketIndex: selectedMarketIndex,
    companyInfo: companyInfo,
    isLoadingMarketIndices: false,
    dataResolutionMinutes: dataResolutionMinutes,
    tradingCalendar: tradingCalendar
  }), [stockSentimentData, marketSentimentData, industrySentimentData, stockPriceData,
      marketIndicesData, selectedMarketIndex, companyInfo,
      dataResolutionMinutes, tradingCalendar]);

  const chartConfigs = useMemo(() => {
    const companyDisplayName = companyInfo?.name || 'Stock';
    const companySymbol = companyInfo?.symbol || '';
    const recentTimeRange = [recentTimeRangeStart, currentTime + (recentFutureHours * 60 * 60 * 1000)];

    const baseConfigs = [
      {
        id: 'masterTemporalImpactFocus',
        ref: chartRefs.masterTemporalImpactFocus,
        title: `${companyDisplayName} (${companySymbol}) - Master Temporal Impact (Future Focus)`,
        description: `A unified view of temporal sentiment combining stock, industry, and market data. This chart is future-focused with a Momentum Blend of 1.0 and a Future Weight of 0.5.`,
        timeWindowOverride: "temporal",
        visibleLines: {
            ...BASE_CHART_LINES,
            stockTemporalImpact: true,
            industryTemporalImpact: true,
            marketTemporalImpact: true,
            masterTemporalImpact: true,
            stockPrice: true,
            stockPriceBubbles: false,
            marketIndex: false,
            volume: true,
            marketSessions: true,
        },
        temporalParams: {
            pastWeight: 0.25,
            futureWeight: 0.25,
            pastShift: DEFAULT_TEMPORAL_PARAMETERS.pastShift,
            futureShift: DEFAULT_TEMPORAL_PARAMETERS.futureShift,
            momentumBlend: 1.0,
            rollingAverageWindowMs: DEFAULT_TEMPORAL_PARAMETERS.rollingAverageWindowMs,
            futureWindowHours: DEFAULT_TEMPORAL_PARAMETERS.futureWindowHours,
            derivativeSmoothingWindow: DEFAULT_TEMPORAL_PARAMETERS.derivativeSmoothingWindow,
            stockWeight: 1.0,
            industryWeight: 1.0,
            marketWeight: 1.0,
        }
      },
      {
        id: 'temporalImpact',
        ref: chartRefs.temporalImpact,
        title: `${companyDisplayName} (${companySymbol}) - Temporal Sentiment Impact`,
        description: `Shows projected sentiment impact using dynamic temporal modeling. This is an impact-focused view with a Momentum Blend of 0.5.`,
        timeWindowOverride: "temporal",
        visibleLines: {
            ...BASE_CHART_LINES,
            stockTemporalImpact: true,
            industryTemporalImpact: true,
            marketTemporalImpact: true,
            masterTemporalImpact: false,
            stockPrice: true,
            stockPriceBubbles: true,
            marketIndex: false,
            volume: true,
            marketSessions: true,
        },
        temporalParams: {
            pastWeight: DEFAULT_TEMPORAL_PARAMETERS.pastWeight,
            futureWeight: DEFAULT_TEMPORAL_PARAMETERS.futureWeight,
            pastShift: DEFAULT_TEMPORAL_PARAMETERS.pastShift,
            futureShift: DEFAULT_TEMPORAL_PARAMETERS.futureShift,
            momentumBlend: 0.5,
            rollingAverageWindowMs: DEFAULT_TEMPORAL_PARAMETERS.rollingAverageWindowMs,
            futureWindowHours: DEFAULT_TEMPORAL_PARAMETERS.futureWindowHours,
            derivativeSmoothingWindow: DEFAULT_TEMPORAL_PARAMETERS.derivativeSmoothingWindow,
        }
      },
      {
        id: 'temporalImpactPresent',
        ref: chartRefs.temporalImpactPresent,
        title: `${companyDisplayName} (${companySymbol}) - Temporal Sentiment Impact (Present Focus)`,
        description: `Isolates "present-focused" articles by setting past and future temporal weights to zero, showing immediate sentiment without temporal projection.`,
        timeWindowOverride: "temporal",
        visibleLines: {
            ...BASE_CHART_LINES,
            stockTemporalImpact: true,
            industryTemporalImpact: true,
            marketTemporalImpact: true,
            masterTemporalImpact: false,
            stockPrice: true,
            stockPriceBubbles: true,
            marketIndex: false,
            volume: true,
            marketSessions: true,
        },
        temporalParams: {
            pastWeight: 0.25,
            futureWeight: 0.25,
            pastShift: DEFAULT_TEMPORAL_PARAMETERS.pastShift,
            futureShift: DEFAULT_TEMPORAL_PARAMETERS.futureShift,
            momentumBlend: 0.5,
            rollingAverageWindowMs: DEFAULT_TEMPORAL_PARAMETERS.rollingAverageWindowMs,
            futureWindowHours: DEFAULT_TEMPORAL_PARAMETERS.futureWindowHours,
            derivativeSmoothingWindow: DEFAULT_TEMPORAL_PARAMETERS.derivativeSmoothingWindow,
        }
      },
      {
        id: 'combinedSentiment',
        ref: chartRefs.combinedSentiment,
        title: `${companyDisplayName} (${companySymbol}) - Combined Rolling Average Sentiment`,
        description: `Displays a combined rolling average of stock, market, and industry sentiment. Dot size indicates article volume.`,
        timeWindowOverride: rollingAverageWindow,
        visibleLines: {
            ...BASE_CHART_LINES,
            combinedRollingAvg: true,
            stockPrice: true,
            stockPriceBubbles: true,
            marketIndex: true,
            stockArticleCount: true,
            marketArticleCount: true,
            industryArticleCount: true,
            marketSessions: true,
        },
        temporalParams: {
            ...DEFAULT_TEMPORAL_PARAMETERS,
        }
      },
      {
        id: 'velocityAcceleration',
        ref: chartRefs.velocityAcceleration,
        title: `${companyDisplayName} (${companySymbol}) - Sentiment Velocity & Acceleration`,
        description: `Visualizes the rate of change (Velocity) and rate of acceleration of the temporal sentiment model, using trend-focused (1.0 blend) and max-smoothed (20 window) settings.`,
        timeWindowOverride: "temporal",
        visibleLines: {
            ...BASE_CHART_LINES,
            stockVelocity: true, stockAcceleration: true,
            industryVelocity: true, industryAcceleration: true,
            marketVelocity: true, marketAcceleration: true,
            stockPrice: true,
            stockPriceBubbles: true,
            marketIndex: true,
            volume: true,
            marketSessions: true,
        },
        temporalParams: {
            pastWeight: 0,
            futureWeight: 0,
            pastShift: DEFAULT_TEMPORAL_PARAMETERS.pastShift,
            futureShift: DEFAULT_TEMPORAL_PARAMETERS.futureShift,
            momentumBlend: 1.0,
            rollingAverageWindowMs: DEFAULT_TEMPORAL_PARAMETERS.rollingAverageWindowMs,
            futureWindowHours: DEFAULT_TEMPORAL_PARAMETERS.futureWindowHours,
            derivativeSmoothingWindow: 20,
        }
      }
    ];

    const masterTemporalImpactFocusConfig = baseConfigs.find(c => c.id === 'masterTemporalImpactFocus');
    const temporalImpactConfig = baseConfigs.find(c => c.id === 'temporalImpact');
    const temporalImpactPresentConfig = baseConfigs.find(c => c.id === 'temporalImpactPresent');
    const combinedSentimentConfig = baseConfigs.find(c => c.id === 'combinedSentiment');
    const velocityAccelerationConfig = baseConfigs.find(c => c.id === 'velocityAcceleration');

    const recentConfigs = [
      {
        ...masterTemporalImpactFocusConfig,
        id: 'recentMasterTemporalImpactFocus',
        ref: chartRefs.recentMasterTemporalImpactFocus,
        title: `${companyDisplayName} (${companySymbol}) - Recent ${recentTimeRangeFormatted} Master Temporal Impact`,
        description: `A focused, recent view of the unified temporal sentiment, future-focused with a Momentum Blend of 1.0. The "NOW" line indicates the current time.`,
        timeRangeOverride: recentTimeRange,
        futureWindowHours: recentFutureHours,
        visibleLines: {
            ...masterTemporalImpactFocusConfig.visibleLines,
            currentTimeLine: true,
            stockArticleCount: true,
            marketArticleCount: true,
            industryArticleCount: true,
        },
      },
      {
        ...temporalImpactConfig,
        id: 'recentTemporalImpact',
        ref: chartRefs.recentTemporalImpact,
        title: `${companyDisplayName} (${companySymbol}) - Recent ${recentTimeRangeFormatted} Analysis`,
        description: `Focuses on the most recent period with a future projection. The "NOW" line indicates the current time.`,
        timeRangeOverride: recentTimeRange,
        futureWindowHours: recentFutureHours,
        visibleLines: {
            ...temporalImpactConfig.visibleLines,
            currentTimeLine: true,
            stockArticleCount: true,
            marketArticleCount: true,
            industryArticleCount: true,
        },
      },
      {
        ...temporalImpactPresentConfig,
        id: 'recentTemporalImpactPresent',
        ref: chartRefs.recentTemporalImpactPresent,
        title: `${companyDisplayName} (${companySymbol}) - Recent ${recentTimeRangeFormatted} Analysis (Present Focus)`,
        description: `Shows the recent view but isolates "present-focused" articles by setting past and future temporal weights to zero.`,
        timeRangeOverride: recentTimeRange,
        futureWindowHours: recentFutureHours,
        visibleLines: {
            ...temporalImpactPresentConfig.visibleLines,
            currentTimeLine: true,
            stockArticleCount: true,
            marketArticleCount: true,
            industryArticleCount: true,
        },
      },
      {
        ...combinedSentimentConfig,
        id: 'recentCombinedSentiment',
        ref: chartRefs.recentCombinedSentiment,
        title: `${companyDisplayName} (${companySymbol}) - Recent ${recentTimeRangeFormatted} Rolling Average`,
        description: `A focused view of the most recent combined rolling average sentiment. The "NOW" line indicates the current time.`,
        timeRangeOverride: recentTimeRange,
        futureWindowHours: recentFutureHours,
        visibleLines: {
            ...combinedSentimentConfig.visibleLines,
            currentTimeLine: true,
        },
      },
      {
        ...velocityAccelerationConfig,
        id: 'recentVelocityAcceleration',
        ref: chartRefs.recentVelocityAcceleration,
        title: `${companyDisplayName} (${companySymbol}) - Recent ${recentTimeRangeFormatted} Sentiment Velocity & Acceleration`,
        description: `A focused view of the most recent sentiment V/A, using trend-focused and max-smoothed settings.`,
        timeRangeOverride: recentTimeRange,
        futureWindowHours: recentFutureHours,
        visibleLines: {
            ...velocityAccelerationConfig.visibleLines,
            currentTimeLine: true,
        },
      }
    ];

    return [...baseConfigs, ...recentConfigs];

  }, [companyInfo, rollingAvgWindowFormatted, recentTimeRangeFormatted, rollingAverageWindow, recentTimeRangeStart, currentTime]);

  useEffect(() => {
    const fetchPreviousPredictionsHistoricalData = async () => {
      if (!companyInfo?.symbol) {
        setPreviousPredictionsHistoricalRecommendations([]);
        return;
      }
      try {
        const recommendations = await getHistoricalRecommendation(companyInfo.symbol, 5, false, "intelligent");
        setPreviousPredictionsHistoricalRecommendations(Array.isArray(recommendations) ? recommendations : []);
      } catch (error) {
        handleError(error, `Fetching historical recommendations for ${companyInfo.symbol}`, null);
        setPreviousPredictionsHistoricalRecommendations([]);
      }
    };
    fetchPreviousPredictionsHistoricalData();
  }, [companyInfo?.symbol]);

  const captureImage = useCallback(async (ref, name) => {
    try {
      await waitForChartReady(ref);
      addLog(`Capturing image for: ${name}`, 'info');
      return await toPng(ref.current, { backgroundColor: 'black', pixelRatio: 1.5, quality: 0.85 });
    } catch (error) {
      addLog(`Image capture failed for ${name}: ${error.message}`, 'error');
      return null;
    }
  }, []);

const captureAllImages = useCallback(async () => {
    setIsGeneratingViz(true);
    try {
      const definitions = [
        { ref: chartRefs.temporalImpact, name: "Temporal Impact", category: "SENTIMENT_TEMPORAL" },
        { ref: chartRefs.temporalImpactPresent, name: "Temporal Impact (Present Focus)", category: "SENTIMENT_TEMPORAL" },
        { ref: chartRefs.velocityAcceleration, name: "Velocity and Acceleration", category: "SENTIMENT_TEMPORAL" },
        { ref: chartRefs.recentVelocityAcceleration, name: "Recent Velocity and Acceleration", category: "SENTIMENT_TEMPORAL" },
        { ref: chartRefs.masterTemporalImpactFocus, name: "Master Temporal Impact (Trend Focus)", category: "SENTIMENT_TEMPORAL" },
        { ref: chartRefs.combinedSentiment, name: "Combined Rolling Average", category: "SENTIMENT_COMBINED" },
        { ref: chartRefs.recentTemporalImpact, name: "Recent Temporal Impact", category: "SENTIMENT_RECENT" },
        { ref: chartRefs.recentTemporalImpactPresent, name: "Recent Temporal Impact (Present Focus)", category: "SENTIMENT_RECENT" },
        { ref: optionsCaptureRefs.current.top, name: "Options Top", category: "OPTIONS_ANALYSIS" },
        { ref: optionsCaptureRefs.current.tier1, name: "Options Tier 1", category: "OPTIONS_ANALYSIS" },
        { ref: optionsCaptureRefs.current.tier2, name: "Options Tier 2", category: "OPTIONS_ANALYSIS" },
        { ref: chartRefs.predictionHistory, name: "Prediction History", category: "PREDICTION_HISTORY" },
        { ref: chartRefs.trendAnalysis, name: "Trend Analysis", category: "PREDICTION_HISTORY" },
        { ref: chartRefs.historical, name: "Historical Analysis", category: "HISTORICAL_ANALYSIS" },
        { ref: chartRefs.intradayPrediction, name: "Intraday Prediction", category: "HISTORICAL_ANALYSIS" },
      ];

      const capturePromises = definitions
        .filter(def => isChartReady(def.ref))
        .map(def => captureImage(def.ref, def.name).then(imageData => ({...def, imageData})));

      if (capturePromises.length === 0) {
        addLog("No components are ready for image capture.", 'warning');
        if (onImageGenerationFailed) onImageGenerationFailed("No components ready for capture.");
        return;
      }

      const results = await Promise.all(capturePromises);
      const images = results
        .filter(r => r.imageData)
        .map(r => ({ data: r.imageData, category: r.category, name: r.name }));

      if (images.length > 0) {
        addLog(`Successfully captured ${images.length} images.`, 'success');
        if (onImageGenerated) onImageGenerated(images);
        setImagesGenerated(true);
      } else {
        if (onImageGenerationFailed) onImageGenerationFailed("Failed to capture any chart images.");
      }
    } catch (error) {
      if (onImageGenerationFailed) onImageGenerationFailed(error.message);
    } finally {
      setIsGeneratingViz(false);
    }
  }, [setIsGeneratingViz, onImageGenerationFailed, onImageGenerated, captureImage, chartRefs]);

  useEffect(() => {
    const analysisIsComplete =
      analysisStatus?.stockCompleted &&
      analysisStatus?.marketCompleted &&
      analysisStatus?.industryCompleted &&
      analysisStatus?.optionsReady &&
      optionsChartReady;

    const dataIsPresent = (stockSentimentData?.length > 0 || marketSentimentData?.length > 0) && stockPriceData?.length > 0;

    if (analysisIsComplete && dataIsPresent && !imagesGenerated) {
      const timer = setTimeout(() => {
        captureAllImages().catch(error => {
          console.error('Error during captureAllImages execution:', error);
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [analysisStatus, stockSentimentData, marketSentimentData, stockPriceData, imagesGenerated, optionsChartReady, captureAllImages]);

  useEffect(() => {
    setImagesGenerated(false);
    setOptionsChartReady(false);
  }, [companyInfo?.symbol]);

  return (
    <Box height="auto" width="100%" p={4} display="flex" flexDirection="column">
      <Flex justify="space-between" align="center" mb={2}>
        <Text fontSize="sm" fontWeight="bold">Enhanced Visualization for Claude Analysis</Text>
      </Flex>

      <Flex direction="column" gap={6}>
        {chartConfigs.map((config) => (
            <ChartRenderer
              key={config.id}
              config={config}
              data={chartData}
              colorMode={colorMode}
              bgColor={bgColor}
              labelColor={labelColor}
              selectedMarketIndex={selectedMarketIndex}
            />
          )
        )}

        <Box
          bg={bgColor}
          p={4}
          borderRadius="md"
          border="1px solid"
          borderColor={colorMode === 'dark' ? 'gray.600' : 'gray.200'}
          display="flex"
          flexDirection="column"
          height="auto"
          minHeight="450px"
          transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          overflow="hidden"
        >
          <Text fontSize="md" mb={2} fontWeight="bold" textAlign="center" color={labelColor}>
            {companyInfo?.name || 'Stock'} ({companyInfo?.symbol || ''}) - Options Analysis
          </Text>

          <Box minHeight="400px" height="auto" width="100%">
            <ComprehensiveOptionsVisualization
              optionsData={optionsData}
              symbol={companyInfo?.symbol || ''}
              currentPrice={optionsData?.current_price || 0}
              captureRefs={optionsCaptureRefs.current}
              onRenderComplete={() => setOptionsChartReady(true)}
            />
          </Box>
        </Box>

        <TrendAnalysisVisualization
          companyInfo={companyInfo}
          colorMode={colorMode}
          bgColor={bgColor}
          labelColor={labelColor}
          captureRef={chartRefs.trendAnalysis}
        />

        <Box ref={chartRefs.predictionHistory}>
          <HistoricalPredictionComparison
            historicalRecommendations={previousPredictionsHistoricalRecommendations}
            colorMode={colorMode}
            bgColor={bgColor}
            labelColor={labelColor}
            companyInfo={companyInfo}
          />
        </Box>

        <HistoricalAnalysisPanel
          selectedMarketIndex={selectedMarketIndex}
          companyInfo={companyInfo}
          captureRef={chartRefs.historical}
        />

        <IntradayPredictionPanel
          companyInfo={companyInfo}
          captureRef={chartRefs.intradayPrediction}
        />
      </Flex>
    </Box>
  );
};

export default SentimentSupplementaryContent;