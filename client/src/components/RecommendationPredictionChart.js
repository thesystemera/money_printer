import React, { useMemo } from 'react';
import {
  Box, Text, Badge, SimpleGrid, Flex, Spinner
} from '@chakra-ui/react';
import {
  DollarSign
} from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Area, ComposedChart, Line
} from 'recharts';

import {
  processChartData, calculatePercentage,
  getTimeInMillis, getCurrentTimeInMillis,
  extractKeyPredictions, formatChartData, findClosestActualData,
  getChartConfig, getUnifiedSessionStyles, getAccuracyDetails,
  PredictionDataAdapter, normalizeVolatilityRange, getHourlyTicks
} from './RecommendationHelper';

import {
  ModelAccuracyScorecard, TradingReturnBox, DataRow
} from './RecommendationPredictionScorecard';

import { COLORS, CHART_STYLING } from '../config/Config';
import { formatValue } from '../services/socketService';

const ChartTooltip = ({ active, payload, label, colorMode, formatter }) => {
  if (!active || !payload || !payload.length) return null;
  const config = getChartConfig(colorMode);

  return (
    <Box
      bg={config.tooltip.bg}
      p={2}
      borderRadius="md"
      border="1px solid"
      borderColor={config.tooltip.borderColor}
      boxShadow={config.tooltip.boxShadow}
    >
      {formatter ? formatter({ active, payload, label }) : (
        <>
          <Text fontWeight="bold">{label}</Text>
          {payload.map((entry, idx) => (
            <Text key={`tooltip-${idx}`} fontSize="sm">
              <Text as="span" color={entry.color} fontWeight="bold">
                {entry.name}:
              </Text>
              {' '}{formatValue(entry.value, {decimals: 2})}
            </Text>
          ))}
        </>
      )}
    </Box>
  );
};

const PercentageDisplay = ({ value, fontSize = 'sm', fontWeight = 'bold' }) => {
    const getPercentageColor = (val) => {
        if (val === null || val === undefined) return 'gray.500';
        return val >= 0 ? 'green.500' : 'red.500';
    };

    const formatPercentage = (val, showSign = true) => {
        if (val === null || val === undefined) return '-';
        const sign = showSign && val >= 0 ? '+' : '';
        return `${sign}${val.toFixed(2)}%`;
    };

    return (
        <Text fontSize={fontSize} fontWeight={fontWeight} color={getPercentageColor(value)}>
            {formatPercentage(value)}
        </Text>
    );
};

export const PredictionChart = ({
  activeRecommendation,
  borderColor,
  textColor,
  colorMode,
  actualPriceData = [],
  isLoadingActualPrices = false
}) => {
  const allModelPredictions = useMemo(() => {
    const predictions = PredictionDataAdapter.getAllModelPredictions(activeRecommendation);

    if (!predictions.image && activeRecommendation.image_analysis) {
      const imagePredictions = PredictionDataAdapter.parseHourlyPredictionsFromText(activeRecommendation.image_analysis);
      if (imagePredictions && imagePredictions.length > 0) {
        const marketOpen = imagePredictions.find(p => p.hour === "09:30");
        const marketClose = imagePredictions.find(p => p.hour === "16:00");
        predictions.image = {
          hourlyPrices: imagePredictions,
          marketOpen: marketOpen?.price,
          marketClose: marketClose?.price,
          marketTiming: ''
        };
      }
    }

    if (!predictions.options && activeRecommendation.options_analysis) {
      const optionsPredictions = PredictionDataAdapter.parseHourlyPredictionsFromText(activeRecommendation.options_analysis);
      if (optionsPredictions && optionsPredictions.length > 0) {
        const marketOpen = optionsPredictions.find(p => p.hour === "09:30");
        const marketClose = optionsPredictions.find(p => p.hour === "16:00");
        predictions.options = {
          hourlyPrices: optionsPredictions,
          marketOpen: marketOpen?.price,
          marketClose: marketClose?.price,
          marketTiming: ''
        };
      }
    }

    if (!predictions.vibe && activeRecommendation.vibe_analysis) {
        const vibePredictions = PredictionDataAdapter.parseHourlyPredictionsFromText(activeRecommendation.vibe_analysis);
        if (vibePredictions && vibePredictions.length > 0) {
          const marketOpen = vibePredictions.find(p => p.hour === "09:30");
          const marketClose = vibePredictions.find(p => p.hour === "16:00");
          predictions.vibe = {
            hourlyPrices: vibePredictions,
            marketOpen: marketOpen?.price,
            marketClose: marketClose?.price,
            marketTiming: ''
          };
        }
    }

    return predictions;
  }, [activeRecommendation]);

  const hasRevisedPredictions = useMemo(() => {
    return allModelPredictions.revised?.hourlyPrices?.length > 0;
  }, [allModelPredictions]);

  const hasImagePredictions = useMemo(() => {
    return allModelPredictions.image?.hourlyPrices?.length > 0;
  }, [allModelPredictions]);

  const hasOptionsPredictions = useMemo(() => {
    return allModelPredictions.options?.hourlyPrices?.length > 0;
  }, [allModelPredictions]);

  const hasVibePredictions = useMemo(() => {
    return allModelPredictions.vibe?.hourlyPrices?.length > 0;
  }, [allModelPredictions]);

  const hourlyPredictions = useMemo(() => {
    return processChartData(activeRecommendation);
  }, [activeRecommendation]);

  const imageHourlyPredictions = useMemo(() => {
    return allModelPredictions.image?.hourlyPrices || [];
  }, [allModelPredictions]);

  const optionsHourlyPredictions = useMemo(() => {
    return allModelPredictions.options?.hourlyPrices || [];
  }, [allModelPredictions]);

  const vibeHourlyPredictions = useMemo(() => {
    return allModelPredictions.vibe?.hourlyPrices || [];
  }, [allModelPredictions]);

  const revisedPredictions = useMemo(() => {
    if (hasRevisedPredictions) {
      return allModelPredictions.revised.hourlyPrices.map(prediction => {
        const [hourStr, minuteStr] = prediction.hour.split(':').map(Number);
        const timestamp = hourStr * 3600000 + (minuteStr || 0) * 60000;

        return {
          ...prediction,
          timestamp,
          isRevised: true,
          isMarketOpen: prediction.hour === "09:30" || prediction.session.includes('market open'),
          isMarketClose: prediction.hour === "16:00" || prediction.session.includes('market close')
        };
      });
    }
    return [];
  }, [allModelPredictions, hasRevisedPredictions]);

  const hasActualData = actualPriceData && actualPriceData.length > 0;
  const predictions = extractKeyPredictions(hourlyPredictions);
  const unifiedStyles = useMemo(() => getUnifiedSessionStyles(colorMode), [colorMode]);

  const revisedKeyPredictions = useMemo(() => {
    if (!hasRevisedPredictions) return {};
    return extractKeyPredictions(revisedPredictions);
  }, [hasRevisedPredictions, revisedPredictions]);

  const actual = useMemo(() => {
    if (!hasActualData) return {};
    return {
      preMarket: findClosestActualData('07:00', actualPriceData, { start: 4, end: 9.5 }),
      marketOpen: findClosestActualData('09:30', actualPriceData, { start: 9, end: 10 }),
      marketClose: findClosestActualData('16:00', actualPriceData, { start: 15.5, end: 16.5 }),
      afterHours: findClosestActualData('20:00', actualPriceData, { start: 16, end: 20 })
    };
  }, [actualPriceData, hasActualData]);

  const percentageData = useMemo(() => {
    const predictedOpenToClose = calculatePercentage(predictions.marketClose?.price, predictions.marketOpen?.price);
    const predictedPreToAfter = calculatePercentage(predictions.afterHours?.price, predictions.preMarket?.price);
    const predictedOpenToAfter = calculatePercentage(predictions.afterHours?.price, predictions.marketOpen?.price);
    const predictedPreToOpen = calculatePercentage(predictions.marketOpen?.price, predictions.preMarket?.price);
    const predictedCloseToAfter = calculatePercentage(predictions.afterHours?.price, predictions.marketClose?.price);

    const revisedOpenToClose = hasRevisedPredictions ?
      calculatePercentage(revisedKeyPredictions.marketClose?.price, revisedKeyPredictions.marketOpen?.price) : null;
    const revisedPreToAfter = hasRevisedPredictions ?
      calculatePercentage(revisedKeyPredictions.afterHours?.price, revisedKeyPredictions.preMarket?.price) : null;
    const revisedOpenToAfter = hasRevisedPredictions ?
      calculatePercentage(revisedKeyPredictions.afterHours?.price, revisedKeyPredictions.marketOpen?.price) : null;

    const actualOpenToClose = hasActualData ? calculatePercentage(actual.marketClose?.price, actual.marketOpen?.price) : null;
    const actualPreToAfter = hasActualData && actual.preMarket && actual.afterHours ?
      calculatePercentage(actual.afterHours?.price, actual.preMarket?.price) : null;
    const actualOpenToAfter = hasActualData && actual.marketOpen && actual.afterHours ?
      calculatePercentage(actual.afterHours?.price, actual.marketOpen?.price) : null;

    return {
      predictedOpenToClose,
      predictedPreToAfter,
      predictedOpenToAfter,
      predictedPreToOpen,
      predictedCloseToAfter,
      revisedOpenToClose,
      revisedPreToAfter,
      revisedOpenToAfter,
      actualOpenToClose,
      actualPreToAfter,
      actualOpenToAfter
    };
  }, [predictions, revisedKeyPredictions, actual, hasRevisedPredictions, hasActualData]);

  const accuracyData = {
    marketOpen: hasActualData && predictions.marketOpen ? getAccuracyDetails(actual.marketOpen?.price, predictions.marketOpen?.price) : null,
    marketClose: hasActualData && predictions.marketClose ? getAccuracyDetails(actual.marketClose?.price, predictions.marketClose?.price) : null,
    afterHours: hasActualData && predictions.afterHours ? getAccuracyDetails(actual.afterHours?.price, predictions.afterHours?.price) : null
  };

  const predictionTimeInMillis = getTimeInMillis(activeRecommendation.timestamp);
  const currentTimeInMillis = getCurrentTimeInMillis();

  const chartData = useMemo(() => {
    const { predictionData, actualData } = formatChartData(hourlyPredictions, actualPriceData);

    const formatAdditionalData = (predictions, type) => {
      return predictions.map(prediction => {
        const [hourStr, minuteStr] = prediction.hour.split(':');
        const hour = parseInt(hourStr, 10);
        const minute = parseInt(minuteStr || '0', 10);
        const timestamp = hour * 3600000 + minute * 60000;

        return {
          ...prediction,
          timestamp,
          type
        };
      }).sort((a, b) => a.timestamp - b.timestamp);
    };

    const imageData = formatAdditionalData(imageHourlyPredictions, 'image');
    const optionsData = formatAdditionalData(optionsHourlyPredictions, 'options');
    const vibeData = formatAdditionalData(vibeHourlyPredictions, 'vibe');

    return {
      predictionData,
      actualData,
      revisedData: revisedPredictions,
      imageData,
      optionsData,
      vibeData
    };
  }, [hourlyPredictions, actualPriceData, revisedPredictions, imageHourlyPredictions, optionsHourlyPredictions, vibeHourlyPredictions]);

  const createVolatilityPolygon = (data) => {
    if (!data || data.length === 0) return [];

    const volatilityPoints = data
      .filter(point => point.volatility_range > 0 && point.price)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (volatilityPoints.length === 0) return [];

    const upperPath = volatilityPoints.map(point => ({
      timestamp: point.timestamp,
      value: point.price * (1 + (point.volatility_range / 2) / 100)
    }));

    const lowerPath = volatilityPoints
      .slice()
      .reverse()
      .map(point => ({
        timestamp: point.timestamp,
        value: point.price * (1 - (point.volatility_range / 2) / 100)
      }));

    return [...upperPath, ...lowerPath];
  };

  const volatilityPolygons = useMemo(() => ({
    predictions: createVolatilityPolygon(chartData.predictionData),
    revised: hasRevisedPredictions ? createVolatilityPolygon(chartData.revisedData) : [],
    image: createVolatilityPolygon(chartData.imageData),
    options: createVolatilityPolygon(chartData.optionsData),
    vibe: createVolatilityPolygon(chartData.vibeData)
  }), [chartData, hasRevisedPredictions]);

  const basePrice = useMemo(() =>
    predictions.marketOpen?.price ||
    (hasActualData && actual.marketOpen ? actual.marketOpen.price :
     chartData.predictionData[0]?.price),
  [predictions, hasActualData, actual, chartData]);

  const allPricePoints = useMemo(() => [
    ...(chartData.predictionData || []),
    ...(chartData.revisedData || []),
    ...(chartData.actualData || []),
    ...(chartData.imageData || []),
    ...(chartData.optionsData || []),
    ...(chartData.vibeData || [])
  ].filter(point => point && point.price), [chartData]);

  const smoothPercentageScale = useMemo(() => {
    if (!basePrice || allPricePoints.length === 0) return { min: -5, max: 5 };

    const percentages = allPricePoints
      .filter(point => point.price && point.price > 0)
      .map(point => ((point.price - basePrice) / basePrice) * 100);

    const minPct = Math.min(...percentages, 0);
    const maxPct = Math.max(...percentages, 0);

    const padding = Math.max(1, (maxPct - minPct) * 0.1);
    const smoothMin = Math.floor((minPct - padding) / 0.5) * 0.5;
    const smoothMax = Math.ceil((maxPct + padding) / 0.5) * 0.5;

    return { min: smoothMin, max: smoothMax };
  }, [allPricePoints, basePrice]);

  const priceRange = useMemo(() => {
    if (!basePrice) return { min: 'auto', max: 'auto' };

    const percentMin = smoothPercentageScale.min / 100;
    const percentMax = smoothPercentageScale.max / 100;

    return {
      min: basePrice * (1 + percentMin),
      max: basePrice * (1 + percentMax)
    };
  }, [basePrice, smoothPercentageScale]);

  const hourlyTicks = useMemo(() => getHourlyTicks(), []);

  const volatilityColors = useMemo(() => {
    const colors = [];

    if (chartData.predictionData.some(p => p.volatility_range > 0)) {
      colors.push(COLORS.master_prediction);
    }

    if (hasRevisedPredictions && chartData.revisedData.some(p => p.volatility_range > 0)) {
      colors.push(COLORS.revised_prediction);
    }

    if (chartData.imageData.some(p => p.volatility_range > 0)) {
      colors.push(COLORS.image_prediction);
    }

    if (chartData.optionsData.some(p => p.volatility_range > 0)) {
      colors.push(COLORS.options_prediction);
    }

    return colors;
  }, [chartData, hasRevisedPredictions]);

  const targetDateTime = activeRecommendation.target_trading_datetime
    ? new Date(activeRecommendation.target_trading_datetime)
    : null;

  const formattedTargetDate = targetDateTime
    ? new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'America/New_York'
      }).format(targetDateTime)
    : "Next Trading Day";

  const renderAccuracyIndicator = (accuracyInfo) => {
    if (!accuracyInfo) return null;

    const { icon: Icon, colorScheme, formattedPercent } = accuracyInfo;

    return (
      <Flex align="center">
        <Icon size={14} color={`var(--chakra-colors-${colorScheme}-500)`} />
        <Text fontSize="xs" ml={1} color={`${colorScheme}.500`}>{formattedPercent}</Text>
      </Flex>
    );
  };

  const priceBoxes = [
    {
      id: 'preMarket',
      title: 'Pre-Market',
      style: unifiedStyles.preMarket,
      prediction: predictions.preMarket,
      revised: hasRevisedPredictions ? revisedKeyPredictions.preMarket : null,
      actual: null
    },
    {
      id: 'marketOpen',
      title: 'Market Open (9:30 AM)',
      style: unifiedStyles.regular,
      prediction: predictions.marketOpen,
      revised: hasRevisedPredictions ? revisedKeyPredictions.marketOpen : null,
      actual: actual.marketOpen,
      accuracy: accuracyData.marketOpen
    },
    {
      id: 'marketClose',
      title: 'Market Close (4:00 PM)',
      style: unifiedStyles.marketClose,
      prediction: predictions.marketClose,
      revised: hasRevisedPredictions ? revisedKeyPredictions.marketClose : null,
      actual: actual.marketClose,
      accuracy: accuracyData.marketClose
    },
    {
      id: 'afterHours',
      title: 'After Hours',
      style: unifiedStyles.afterHours,
      prediction: predictions.afterHours,
      revised: hasRevisedPredictions ? revisedKeyPredictions.afterHours : null,
      actual: actual.afterHours,
      accuracy: accuracyData.afterHours
    }
  ];

  const calculateChanges = () => {
    return priceBoxes.map((box) => {
      let predictedChange = null;
      let revisedChange = null;
      let actualChange = null;

      if (box.id === 'preMarket') {
        predictedChange = null;
        revisedChange = null;
      } else if (box.id === 'marketOpen' && predictions.preMarket && box.prediction) {
        predictedChange = calculatePercentage(box.prediction.price, predictions.preMarket.price);
        if (hasRevisedPredictions && box.revised && revisedKeyPredictions.preMarket) {
          revisedChange = calculatePercentage(box.revised.price, revisedKeyPredictions.preMarket.price);
        }
      } else if (box.id === 'marketClose' && predictions.marketOpen && box.prediction) {
        predictedChange = calculatePercentage(box.prediction.price, predictions.marketOpen.price);
        if (hasRevisedPredictions && box.revised && revisedKeyPredictions.marketOpen) {
          revisedChange = calculatePercentage(box.revised.price, revisedKeyPredictions.marketOpen.price);
        }
      } else if (box.id === 'afterHours' && predictions.marketClose && box.prediction) {
        predictedChange = calculatePercentage(box.prediction.price, predictions.marketClose.price);
        if (hasRevisedPredictions && box.revised && revisedKeyPredictions.marketClose) {
          revisedChange = calculatePercentage(box.revised.price, revisedKeyPredictions.marketClose.price);
        }
      }

      if (box.id === 'preMarket') {
        actualChange = null;
      } else if (box.id === 'marketOpen' && box.actual) {
        if (actual.preMarket) {
          actualChange = calculatePercentage(box.actual.price, actual.preMarket.price);
        } else if (predictions.preMarket) {
          actualChange = calculatePercentage(box.actual.price, predictions.preMarket.price);
        }
      } else if (box.id === 'marketClose' && actual.marketOpen && box.actual) {
        actualChange = calculatePercentage(box.actual.price, actual.marketOpen.price);
      } else if (box.id === 'afterHours' && actual.marketClose && box.actual) {
        actualChange = calculatePercentage(box.actual.price, actual.marketClose.price);
      }

      return {
        ...box,
        predictedChange,
        revisedChange,
        actualChange
      };
    });
  };

  const boxesWithChanges = useMemo(() => calculateChanges(), [predictions, revisedKeyPredictions, actual, hasRevisedPredictions]);

  return (
    <Box borderWidth="1px" borderRadius="md" borderColor={borderColor} mb={4}>
      <Flex p={4} justifyContent="space-between" alignItems="center">
        <Flex align="center">
          <DollarSign size={16} style={{ marginRight: '8px', color: 'var(--chakra-colors-green-500)' }} />
          <Text fontSize="sm" fontWeight="bold">
            Price Prediction for {formattedTargetDate}
          </Text>
          {hasActualData && (
            <Badge ml={2} colorScheme="blue" fontSize="xs">
              {actualPriceData.length} actual data points
            </Badge>
          )}
          {hasRevisedPredictions && (
            <Badge ml={2} colorScheme="purple" fontSize="xs">
              Revised prediction
            </Badge>
          )}
          {hasImagePredictions && (
            <Badge ml={2} colorScheme="pink" fontSize="xs">
              Image Analysis
            </Badge>
          )}
          {hasOptionsPredictions && (
            <Badge ml={2} colorScheme="cyan" fontSize="xs">
              Options Analysis
            </Badge>
          )}
          {hasVibePredictions && (
            <Badge ml={2} colorScheme="orange" fontSize="xs">
                Vibe Analysis
            </Badge>
          )}
          {smoothPercentageScale.type && (
            <Badge ml={2} colorScheme="orange" fontSize="xs">
              Scale: {smoothPercentageScale.type}
            </Badge>
          )}
        </Flex>
        {isLoadingActualPrices && <Spinner size="sm" color="blue.500" mr={2} />}
      </Flex>

      <Box p={4} pt={0} borderTop="1px solid" borderColor={borderColor}>
        <Box mb={4}>
          <Flex gap={3} flexWrap="wrap">
            <Box
              p={4}
              borderRadius="md"
              borderWidth="2px"
              borderColor="gray.500"
              bg={colorMode === 'dark' ? 'gray.700' : 'white'}
              borderLeft="4px solid"
              borderLeftColor="gray.500"
              boxShadow="lg"
              flex="1"
            >
              <Text fontSize="sm" fontWeight="bold" mb={3} color={colorMode === 'dark' ? 'gray.200' : 'gray.700'} textAlign="center">
                Trading Returns
              </Text>
              <Box>
                <Flex justify="space-between" mb={2}>
                  <Text fontSize="xs" color={colorMode === 'dark' ? 'gray.300' : 'gray.600'}>Open→Close:</Text>
                  <PercentageDisplay value={percentageData.predictedOpenToClose} fontSize="sm" />
                </Flex>

                <Flex justify="space-between" mb={2}>
                  <Text fontSize="xs" color={colorMode === 'dark' ? 'gray.300' : 'gray.600'}>Pre→Open:</Text>
                  <PercentageDisplay value={percentageData.predictedPreToOpen} fontSize="sm" />
                </Flex>

                <Flex justify="space-between">
                  <Text fontSize="xs" color={colorMode === 'dark' ? 'gray.300' : 'gray.600'}>Pre→After:</Text>
                  <PercentageDisplay value={percentageData.predictedPreToAfter} fontSize="sm" />
                </Flex>
              </Box>
            </Box>

            <ModelAccuracyScorecard
              allPredictions={allModelPredictions}
              actualData={actualPriceData}
              colorMode={colorMode}
              activeRecommendation={activeRecommendation}
              splitBoxes={true}
            />
          </Flex>
        </Box>

        <SimpleGrid columns={4} spacing={3} mb={4}>
          {boxesWithChanges.map((box) => (
            <Box
              key={box.id}
              p={3}
              borderRadius="md"
              borderWidth="2px"
              borderColor={box.style.border}
              bg={box.style.bg}
            >
              <Text fontSize="sm" fontWeight="bold" color={box.style.color} mb={1} textAlign="center">
                {box.title}
              </Text>

              <Flex justify="space-between" align="flex-start">
                <Box>
                  <Flex>
                    <Box mr={box.revised ? 3 : 0}>
                      <Text fontSize="xs" color={textColor}>Master:</Text>
                      <Text fontSize="sm" fontWeight="bold">
                        {formatValue(box.prediction?.price || 0, {format: 'currency'})}
                      </Text>
                      {box.prediction?.volatility_range !== undefined && (
                        <Text fontSize="10px" color={textColor}>±{normalizeVolatilityRange(box.prediction.volatility_range)}%</Text>
                      )}
                      {box.predictedChange !== null && (
                        <PercentageDisplay value={box.predictedChange} fontSize="xs" fontWeight="medium" />
                      )}
                    </Box>

                    {box.revised && (
                      <Box>
                        <Text fontSize="xs" color={textColor}>Revised:</Text>
                        <Text fontSize="sm" fontWeight="bold">
                          {formatValue(box.revised.price, {format: 'currency'})}
                        </Text>
                        {box.revised?.volatility_range !== undefined && (
                          <Text fontSize="10px" color={textColor}>±{normalizeVolatilityRange(box.revised.volatility_range)}%</Text>
                        )}
                        {box.revisedChange !== null && (
                          <PercentageDisplay value={box.revisedChange} fontSize="xs" fontWeight="medium" />
                        )}
                      </Box>
                    )}
                  </Flex>
                </Box>

                {box.actual && (
                  <Box textAlign="right">
                    <Text fontSize="xs" color={textColor}>Actual:</Text>
                    <Text fontSize="sm" fontWeight="semibold">
                      {formatValue(box.actual.price, {format: 'currency'})}
                    </Text>
                    {box.actualChange !== null && (
                      <PercentageDisplay value={box.actualChange} fontSize="xs" fontWeight="medium" />
                    )}
                    {box.accuracy && (
                      <Flex justify="flex-end" mt={1}>
                        {renderAccuracyIndicator(box.accuracy)}
                      </Flex>
                    )}
                  </Box>
                )}
              </Flex>
            </Box>
          ))}
        </SimpleGrid>

        <Box height="250px" borderWidth="1px" borderRadius="md" borderColor={borderColor} overflow="hidden" position="relative">
          {basePrice && (
            <Box
              position="absolute"
              top="0"
              left="0"
              right="0"
              bottom="0"
              background={`linear-gradient(to bottom,
                var(--chakra-colors-green-500) 0%,
                var(--chakra-colors-green-500) 15%,
                transparent 40%,
                transparent 60%,
                var(--chakra-colors-red-500) 85%,
                var(--chakra-colors-red-500) 100%)`}
              opacity={Math.min(0.5, Math.max(0.08, (Math.abs(smoothPercentageScale.max) + Math.abs(smoothPercentageScale.min)) / 30))}
              pointerEvents="none"
              zIndex="1"
            />
          )}
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id="preMarketGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={unifiedStyles.preMarket.bg} stopOpacity="0.35"/>
                  <stop offset="50%" stopColor={unifiedStyles.preMarket.bg} stopOpacity="0.20"/>
                  <stop offset="100%" stopColor={unifiedStyles.preMarket.bg} stopOpacity="0.12"/>
                </linearGradient>
                <linearGradient id="regularGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={unifiedStyles.regular.bg} stopOpacity="0.35"/>
                  <stop offset="50%" stopColor={unifiedStyles.regular.bg} stopOpacity="0.20"/>
                  <stop offset="100%" stopColor={unifiedStyles.regular.bg} stopOpacity="0.12"/>
                </linearGradient>
                <linearGradient id="afterHoursGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={unifiedStyles.afterHours.bg} stopOpacity="0.35"/>
                  <stop offset="50%" stopColor={unifiedStyles.afterHours.bg} stopOpacity="0.20"/>
                  <stop offset="100%" stopColor={unifiedStyles.afterHours.bg} stopOpacity="0.12"/>
                </linearGradient>

                <linearGradient id="volatilityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.master_volatility_gradient} stopOpacity="0.12"/>
                  <stop offset="25%" stopColor={COLORS.master_volatility_gradient} stopOpacity="0.28"/>
                  <stop offset="50%" stopColor={COLORS.master_volatility_gradient} stopOpacity="0.45"/>
                  <stop offset="75%" stopColor={COLORS.master_volatility_gradient} stopOpacity="0.28"/>
                  <stop offset="100%" stopColor={COLORS.master_volatility_gradient} stopOpacity="0.12"/>
                </linearGradient>
                <linearGradient id="revisedVolatilityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.revised_volatility_gradient} stopOpacity="0.12"/>
                  <stop offset="25%" stopColor={COLORS.revised_volatility_gradient} stopOpacity="0.28"/>
                  <stop offset="50%" stopColor={COLORS.revised_volatility_gradient} stopOpacity="0.45"/>
                  <stop offset="75%" stopColor={COLORS.revised_volatility_gradient} stopOpacity="0.28"/>
                  <stop offset="100%" stopColor={COLORS.revised_volatility_gradient} stopOpacity="0.12"/>
                </linearGradient>
                <linearGradient id="imageVolatilityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.image_volatility_gradient} stopOpacity="0.10"/>
                  <stop offset="25%" stopColor={COLORS.image_volatility_gradient} stopOpacity="0.25"/>
                  <stop offset="50%" stopColor={COLORS.image_volatility_gradient} stopOpacity="0.40"/>
                  <stop offset="75%" stopColor={COLORS.image_volatility_gradient} stopOpacity="0.25"/>
                  <stop offset="100%" stopColor={COLORS.image_volatility_gradient} stopOpacity="0.10"/>
                </linearGradient>
                <linearGradient id="optionsVolatilityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.options_volatility_gradient} stopOpacity="0.10"/>
                  <stop offset="25%" stopColor={COLORS.options_volatility_gradient} stopOpacity="0.25"/>
                  <stop offset="50%" stopColor={COLORS.options_volatility_gradient} stopOpacity="0.40"/>
                  <stop offset="75%" stopColor={COLORS.options_volatility_gradient} stopOpacity="0.25"/>
                  <stop offset="100%" stopColor={COLORS.options_volatility_gradient} stopOpacity="0.10"/>
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />

              <ReferenceArea
                x1={4 * 3600000}
                x2={9.5 * 3600000}
                fill="url(#preMarketGradient)"
                strokeWidth={0}
              />
              <ReferenceArea
                x1={9.5 * 3600000}
                x2={16 * 3600000}
                fill="url(#regularGradient)"
                strokeWidth={0}
              />
              <ReferenceArea
                x1={16 * 3600000}
                x2={20 * 3600000}
                fill="url(#afterHoursGradient)"
                strokeWidth={0}
              />

              {volatilityPolygons.predictions.length > 0 && (
                <Area
                  data={volatilityPolygons.predictions}
                  type="monotone"
                  dataKey="value"
                  fill={COLORS.master_prediction}
                  fillOpacity={0.2}
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}

              {hasRevisedPredictions && volatilityPolygons.revised.length > 0 && (
                <Area
                  data={volatilityPolygons.revised}
                  type="monotone"
                  dataKey="value"
                  fill={COLORS.revised_prediction}
                  fillOpacity={0.18}
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}

              {hasImagePredictions && volatilityPolygons.image.length > 0 && (
                <Area
                  data={volatilityPolygons.image}
                  type="monotone"
                  dataKey="value"
                  fill={COLORS.image_prediction}
                  fillOpacity={0.15}
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}

              {hasOptionsPredictions && volatilityPolygons.options.length > 0 && (
                <Area
                  data={volatilityPolygons.options}
                  type="monotone"
                  dataKey="value"
                  fill={COLORS.options_prediction}
                  fillOpacity={0.15}
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}

              {hasVibePredictions && volatilityPolygons.vibe.length > 0 && (
                <Area
                  data={volatilityPolygons.vibe}
                  type="monotone"
                  dataKey="value"
                  fill={COLORS.vibe_prediction}
                  fillOpacity={0.15}
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}

              {basePrice && (
                <ReferenceLine
                  y={basePrice}
                  stroke="var(--chakra-colors-gray-500)"
                  strokeDasharray="3 3"
                  strokeOpacity={0.7}
                  label={{
                    value: "Base Price",
                    position: "insideLeft",
                    fill: "var(--chakra-colors-gray-500)",
                    fontSize: 10
                  }}
                />
              )}

              <ReferenceLine
                x={9.5 * 3600000}
                stroke={unifiedStyles.regular.border}
                strokeWidth={2}
                strokeDasharray="5 3"
                strokeOpacity={0.8}
                label={{
                  value: "Market Open",
                  position: "insideTopRight",
                  fill: unifiedStyles.regular.color,
                  fontSize: 11,
                  fontWeight: "bold"
                }}
              />
              <ReferenceLine
                x={16 * 3600000}
                stroke={unifiedStyles.marketClose.border}
                strokeWidth={2}
                strokeDasharray="5 3"
                strokeOpacity={0.8}
                label={{
                  value: "Market Close",
                  position: "insideTopLeft",
                  fill: unifiedStyles.marketClose.color,
                  fontSize: 11,
                  fontWeight: "bold"
                }}
              />

              <ReferenceLine
                x={predictionTimeInMillis}
                stroke={COLORS.prediction_time}
                strokeWidth={2.5}
                strokeOpacity={0.9}
                label={{
                  value: "Prediction Time",
                  position: "insideBottomRight",
                  fill: COLORS.prediction_time,
                  fontSize: 11,
                  fontWeight: "bold"
                }}
              />
              <ReferenceLine
                x={currentTimeInMillis}
                stroke={COLORS.current_time}
                strokeWidth={2.5}
                strokeOpacity={0.9}
                label={{
                  value: "Current ET",
                  position: "insideBottomLeft",
                  fill: COLORS.current_time,
                  fontSize: 11,
                  fontWeight: "bold"
                }}
              />

              <XAxis
                type="number"
                dataKey="timestamp"
                domain={[4 * 3600000, 20 * 3600000]}
                ticks={hourlyTicks.map(h => {
                  const [hour, minute] = h.time.split(':').map(Number);
                  return hour * 3600000 + (minute || 0) * 60000;
                })}
                tickFormatter={(timestamp) => {
                  const hours = Math.floor(timestamp / 3600000);
                  const minutes = Math.floor((timestamp % 3600000) / 60000);
                  if (minutes === 30) return `${hours}:30`;
                  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
                  const ampm = hours >= 12 ? "PM" : "AM";
                  return `${hour12}${ampm}`;
                }}
                tick={{ fontSize: 10 }}
                minTickGap={20}
              />

              <YAxis
                domain={[priceRange.min, priceRange.max]}
                scale="linear"
                tickCount={5}
                tickFormatter={(value) => formatValue(value, {format: 'currency', omitDecimal: true})}
                tick={{ fontSize: 10 }}
                width={50}
              />

              {basePrice && (
                <YAxis
                  yAxisId="percentage"
                  orientation="right"
                  domain={[smoothPercentageScale.min, smoothPercentageScale.max]}
                  scale="linear"
                  tickCount={5}
                  tickFormatter={(value) => `${value > 0 ? '+' : ''}${value}%`}
                  tick={{ fontSize: 10 }}
                  width={45}
                />
              )}

              <RechartsTooltip
                content={(props) => (
                  <ChartTooltip
                    {...props}
                    colorMode={colorMode}
                    formatter={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;

                      const timestamp = payload[0].payload.timestamp;
                      const hours = Math.floor(timestamp / 3600000);
                      const minutes = Math.floor((timestamp % 3600000) / 60000);
                      const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

                      let predictedPrice = null;
                      let revisedPrice = null;
                      let imagePrice = null;
                      let optionsPrice = null;
                      let vibePrice = null;
                      let actualPrice = null;
                      let volatilityRange = null;

                      payload.forEach(p => {
                        if (p.name === "Master Analysis") {
                          predictedPrice = p.value;
                          volatilityRange = p.payload.volatility_range;
                        }
                        else if (p.name === "Revised Analysis") revisedPrice = p.value;
                        else if (p.name === "Image Analysis") imagePrice = p.value;
                        else if (p.name === "Options Analysis") optionsPrice = p.value;
                        else if (p.name === "Vibe Analysis") vibePrice = p.value;
                        else if (p.name === "Actual Price") actualPrice = p.value;
                      });

                      if (!actualPrice && predictedPrice) {
                        const matchingActual = chartData.actualData.find(a => Math.abs(a.timestamp - timestamp) < 60000);
                        if (matchingActual) actualPrice = matchingActual.price;
                      }

                      let sessionType = 'regular';
                      if (hours < 9.5) sessionType = 'preMarket';
                      else if (hours >= 16) sessionType = 'afterHours';

                      const getPercentage = (price) => {
                        if (!price || !basePrice) return '';
                        const pct = ((price - basePrice) / basePrice * 100).toFixed(2);
                        return `(${pct > 0 ? '+' : ''}${pct}%)`;
                      };

                      return (
                        <>
                          <Text fontWeight="bold" color={unifiedStyles[sessionType].color}>{timeStr} ET</Text>

                          {predictedPrice !== null && (
                            <Text fontSize="sm">
                              <Text as="span" fontWeight="medium" color={COLORS.master_prediction}>Master: </Text>
                              {formatValue(predictedPrice, {format: 'currency'})}
                              {volatilityRange !== undefined && (
                                <Text as="span" ml={1}>±{normalizeVolatilityRange(volatilityRange)}%</Text>
                              )}
                              <Text as="span" ml={1} color={predictedPrice >= basePrice ? "green.500" : "red.500"}>
                                {getPercentage(predictedPrice)}
                              </Text>
                            </Text>
                          )}

                          {revisedPrice !== null && (
                            <Text fontSize="sm">
                              <Text as="span" fontWeight="medium" color="purple.500">Revised: </Text>
                              {formatValue(revisedPrice, {format: 'currency'})}
                              <Text as="span" ml={1} color={revisedPrice >= basePrice ? "green.500" : "red.500"}>
                                {getPercentage(revisedPrice)}
                              </Text>
                            </Text>
                          )}

                          {imagePrice !== null && (
                            <Text fontSize="sm">
                              <Text as="span" fontWeight="medium" color="pink.500">Image: </Text>
                              {formatValue(imagePrice, {format: 'currency'})}
                              <Text as="span" ml={1} color={imagePrice >= basePrice ? "green.500" : "red.500"}>
                                {getPercentage(imagePrice)}
                              </Text>
                            </Text>
                          )}

                          {optionsPrice !== null && (
                            <Text fontSize="sm">
                              <Text as="span" fontWeight="medium" color="cyan.500">Options: </Text>
                              {formatValue(optionsPrice, {format: 'currency'})}
                              <Text as="span" ml={1} color={optionsPrice >= basePrice ? "green.500" : "red.500"}>
                                {getPercentage(optionsPrice)}
                              </Text>
                            </Text>
                          )}

                          {vibePrice !== null && (
                            <Text fontSize="sm">
                              <Text as="span" fontWeight="medium" color="orange.500">Vibe: </Text>
                              {formatValue(vibePrice, {format: 'currency'})}
                              <Text as="span" ml={1} color={vibePrice >= basePrice ? "green.500" : "red.500"}>
                                {getPercentage(vibePrice)}
                              </Text>
                            </Text>
                          )}

                          {actualPrice !== null && (
                            <Text fontSize="sm">
                              <Text as="span" fontWeight="medium" color={COLORS.actual_prices}>Actual: </Text>
                              {formatValue(actualPrice, {format: 'currency'})}
                              <Text as="span" ml={1} color={actualPrice >= basePrice ? "green.500" : "red.500"}>
                                {getPercentage(actualPrice)}
                              </Text>
                            </Text>
                          )}

                          {actualPrice !== null && predictedPrice !== null && (
                            <Flex align="center" mt={1}>
                              {renderAccuracyIndicator(getAccuracyDetails(actualPrice, predictedPrice))}
                            </Flex>
                          )}
                        </>
                      );
                    }}
                  />
                )}
              />

              {chartData.predictionData.length > 0 && (
                <Line
                  data={chartData.predictionData}
                  type="monotone"
                  dataKey="price"
                  name="Master Analysis"
                  stroke={COLORS.master_prediction}
                  strokeWidth={2.5}
                  dot={(props) => {
                    const { cx, cy, payload, index } = props;
                    if (!cx || !cy) return null;

                    if (payload.isMarketOpen) {
                      return <circle key={`dot-open-${index}`} cx={cx} cy={cy} r={5} fill={COLORS.marketOpen} stroke="white" strokeWidth={1} />;
                    } else if (payload.isMarketClose) {
                      return <circle key={`dot-close-${index}`} cx={cx} cy={cy} r={5} fill={COLORS.marketClose} stroke="white" strokeWidth={1} />;
                    }

                    return <circle key={`dot-${index}`} cx={cx} cy={cy} r={3} fill={COLORS.master_prediction} />;
                  }}
                  activeDot={{ r: 4, fill: COLORS.master_prediction }}
                  isAnimationActive={CHART_STYLING.animation.enabled}
                  animationDuration={CHART_STYLING.animation.duration}
                  animationEasing={CHART_STYLING.animation.easing}
                  zIndex={10}
                />
              )}

              {hasRevisedPredictions && chartData.revisedData.length > 0 && (
                <Line
                  data={chartData.revisedData}
                  type="monotone"
                  dataKey="price"
                  name="Revised Analysis"
                  stroke={COLORS.revised_prediction}
                  strokeWidth={2.5}
                  connectNulls={true}
                  dot={(props) => {
                    const { cx, cy, index } = props;
                    if (!cx || !cy) return null;
                    return <circle key={`rev-dot-${index}`} cx={cx} cy={cy} r={3} fill={COLORS.revised_prediction} />;
                  }}
                  activeDot={{ r: 4, fill: COLORS.revised_prediction }}
                  isAnimationActive={CHART_STYLING.animation.enabled}
                  animationDuration={CHART_STYLING.animation.duration}
                  animationEasing={CHART_STYLING.animation.easing}
                  zIndex={10}
                />
              )}

              {hasImagePredictions && chartData.imageData.length > 0 && (
                <Line
                  data={chartData.imageData}
                  type="monotone"
                  dataKey="price"
                  name="Image Analysis"
                  stroke={COLORS.image_prediction}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  connectNulls={true}
                  activeDot={{ r: 4, fill: COLORS.image_prediction }}
                  isAnimationActive={CHART_STYLING.animation.enabled}
                  animationDuration={CHART_STYLING.animation.duration}
                  animationEasing={CHART_STYLING.animation.easing}
                  zIndex={10}
                />
              )}

              {hasOptionsPredictions && chartData.optionsData.length > 0 && (
                <Line
                  data={chartData.optionsData}
                  type="monotone"
                  dataKey="price"
                  name="Options Analysis"
                  stroke={COLORS.options_prediction}
                  strokeWidth={2}
                  strokeDasharray="3 2"
                  dot={false}
                  connectNulls={true}
                  activeDot={{ r: 4, fill: COLORS.options_prediction }}
                  isAnimationActive={CHART_STYLING.animation.enabled}
                  animationDuration={CHART_STYLING.animation.duration}
                  animationEasing={CHART_STYLING.animation.easing}
                  zIndex={10}
                />
              )}

              {hasVibePredictions && chartData.vibeData.length > 0 && (
                <Line
                  data={chartData.vibeData}
                  type="monotone"
                  dataKey="price"
                  name="Vibe Analysis"
                  stroke={COLORS.vibe_prediction}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  connectNulls={true}
                  activeDot={{ r: 4, fill: COLORS.vibe_prediction }}
                  isAnimationActive={CHART_STYLING.animation.enabled}
                  animationDuration={CHART_STYLING.animation.duration}
                  animationEasing={CHART_STYLING.animation.easing}
                  zIndex={10}
                />
              )}

              {hasActualData && (
                <Line
                  data={chartData.actualData}
                  type="monotone"
                  dataKey="price"
                  name="Actual Price"
                  stroke={COLORS.actual_prices}
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={true}
                  activeDot={{ r: 3, fill: COLORS.actual_prices, strokeWidth: 1, stroke: "#1a1a2e" }}
                  isAnimationActive={CHART_STYLING.animation.enabled}
                  animationDuration={CHART_STYLING.animation.duration}
                  animationEasing={CHART_STYLING.animation.easing}
                  zIndex={20}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </Box>

        <Flex justify="center" mt={3} flexWrap="wrap" gap={2}>
          <Flex alignItems="center" mx={1}>
            <Box w="15px" h="3px" borderRadius="full" bg={COLORS.master_prediction} mr={1} />
            <Text fontSize="xs">Master Analysis</Text>
          </Flex>
          {hasRevisedPredictions && (
            <Flex alignItems="center" mx={1}>
              <Box w="15px" h="3px" borderRadius="full" bg={COLORS.revised_prediction} mr={1} />
              <Text fontSize="xs">Revised Analysis</Text>
            </Flex>
          )}
          {hasImagePredictions && (
            <Flex alignItems="center" mx={1}>
              <Box w="15px" h="3px" borderRadius="full" bg={COLORS.image_prediction} mr={1} style={{ borderStyle: 'dashed' }} />
              <Text fontSize="xs">Image Analysis</Text>
            </Flex>
          )}
          {hasOptionsPredictions && (
            <Flex alignItems="center" mx={1}>
              <Box w="15px" h="3px" borderRadius="full" bg={COLORS.options_prediction} mr={1} style={{ borderStyle: 'dashed' }} />
              <Text fontSize="xs">Options Analysis</Text>
            </Flex>
          )}
           {hasVibePredictions && (
            <Flex alignItems="center" mx={1}>
              <Box w="15px" h="3px" borderRadius="full" bg={COLORS.vibe_prediction} mr={1} style={{ borderStyle: 'dotted' }} />
              <Text fontSize="xs">Vibe Analysis</Text>
            </Flex>
          )}
          {hasActualData && (
            <Flex alignItems="center" mx={1}>
              <Box w="15px" h="3px" borderRadius="full" bg={COLORS.actual_prices} opacity={0.85} mr={1} />
              <Text fontSize="xs">Actual Prices</Text>
            </Flex>
          )}
          <Flex alignItems="center" mx={1}><Box w="8px" h="8px" borderRadius="full" bg={COLORS.marketOpen} mr={1} /><Text fontSize="xs">Market Open</Text></Flex>
          <Flex alignItems="center" mx={1}><Box w="8px" h="8px" borderRadius="full" bg={COLORS.marketClose} mr={1} /><Text fontSize="xs">Market Close</Text></Flex>
          <Flex alignItems="center" mx={1}><Box w="15px" h="3px" borderRadius="full" bg={COLORS.prediction_time} mr={1} /><Text fontSize="xs">Prediction Time</Text></Flex>
          <Flex alignItems="center" mx={1}><Box w="15px" h="3px" borderRadius="full" bg={COLORS.current_time} mr={1} /><Text fontSize="xs">Current ET</Text></Flex>
          {volatilityColors.length > 0 && (
            <Flex alignItems="center" mx={1}>
              <Box
                w="15px"
                h="8px"
                borderRadius="md"
                mr={1}
                background={volatilityColors.length === 1
                  ? volatilityColors[0]
                  : `linear-gradient(90deg, ${volatilityColors.join(', ')})`}
                opacity={0.35}
              />
              <Text fontSize="xs">Volatility Range</Text>
            </Flex>
          )}
        </Flex>

        {hasRevisedPredictions && activeRecommendation.revisedPredictions?.nextTradingDay?.reasoning && (
          <Box mt={3} p={3} borderRadius="md" bg={colorMode === 'dark' ? 'purple.900' : 'purple.50'} borderLeft="3px solid" borderColor="purple.400">
            <Text fontSize="sm" fontWeight="bold" mb={1}>Prediction Revision Reasoning:</Text>
            <Text fontSize="sm">{activeRecommendation.revisedPredictions.nextTradingDay.reasoning}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};