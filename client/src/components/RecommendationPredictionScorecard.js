import React, { useMemo } from 'react';
import {
  Box, Text, Badge, Flex, VStack, HStack, SimpleGrid
} from '@chakra-ui/react';
import {
  CheckCircle, X, Target, TrendingUp, TrendingDown, Minus
} from 'lucide-react';

import {
  calculatePercentage, findClosestActualData
} from './RecommendationHelper';

import { COLORS } from '../config/Config';
import { formatValue } from '../services/socketService';

const calculateGlowIntensity = (accuracyDiff, isCorrect) => {
  if (isCorrect) {
    return Math.max(0.2, Math.min(1, 1 - (accuracyDiff / 5)));
  } else {
    return Math.max(0.2, Math.min(1, accuracyDiff / 8));
  }
};

const getGlowStyles = (outcome, intensity, colorMode) => {
  const baseColor = outcome === 'correct' ? '#10b981'
                  : outcome === 'incorrect' ? '#ef4444'
                  : '#f59e0b';
  const isDark = colorMode === 'dark';

  const baseIntensity = isDark ? intensity * 1.4 : intensity;
  const blur1 = Math.round(8 + (baseIntensity * 12));
  const blur2 = Math.round(16 + (baseIntensity * 24));
  const blur3 = isDark ? Math.round(32 + (baseIntensity * 28)) : 0;
  const dropBlur = Math.round(3 + (baseIntensity * 5));

  const opacity1 = 0.3 + (baseIntensity * 0.4);
  const opacity2 = 0.2 + (baseIntensity * 0.3);
  const opacity3 = isDark ? 0.1 + (baseIntensity * 0.2) : 0;

  return {
    boxShadow: isDark
      ? `0 0 ${blur1}px rgba(${baseColor.slice(1).match(/.{2}/g).map(x => parseInt(x, 16)).join(', ')}, ${opacity1}), 0 0 ${blur2}px rgba(${baseColor.slice(1).match(/.{2}/g).map(x => parseInt(x, 16)).join(', ')}, ${opacity2}), 0 0 ${blur3}px rgba(${baseColor.slice(1).match(/.{2}/g).map(x => parseInt(x, 16)).join(', ')}, ${opacity3})`
      : `0 0 ${blur1}px rgba(${baseColor.slice(1).match(/.{2}/g).map(x => parseInt(x, 16)).join(', ')}, ${opacity1}), 0 0 ${blur2}px rgba(${baseColor.slice(1).match(/.{2}/g).map(x => parseInt(x, 16)).join(', ')}, ${opacity2})`,
    filter: `drop-shadow(0 0 ${dropBlur}px rgba(${baseColor.slice(1).match(/.{2}/g).map(x => parseInt(x, 16)).join(', ')}, ${baseIntensity * 0.6}))`
  };
};

const getPerformanceTier = (accuracy) => {
  if (accuracy >= 70) return { tier: 'excellent', color: 'green', intensity: 'high' };
  if (accuracy >= 60) return { tier: 'good', color: 'green', intensity: 'medium' };
  if (accuracy >= 50) return { tier: 'average', color: 'yellow', intensity: 'low' };
  if (accuracy >= 40) return { tier: 'poor', color: 'orange', intensity: 'medium' };
  return { tier: 'critical', color: 'red', intensity: 'high' };
};

const getPerformanceGlowStyles = (color, intensity, colorMode) => {
  const intensityMap = {
    high: { blur: 12, opacity: 0.6, spread: 4 },
    medium: { blur: 8, opacity: 0.4, spread: 2 },
    low: { blur: 6, opacity: 0.3, spread: 1 }
  };

  const { blur, opacity, spread } = intensityMap[intensity];
  const isDark = colorMode === 'dark';

  const colorMap = {
    green: isDark ? '34, 197, 94' : '22, 163, 74',
    yellow: isDark ? '234, 179, 8' : '202, 138, 4',
    orange: isDark ? '249, 115, 22' : '234, 88, 12',
    red: isDark ? '239, 68, 68' : '220, 38, 38'
  };

  const rgbColor = colorMap[color];

  return {
    boxShadow: `0 0 ${blur}px ${spread}px rgba(${rgbColor}, ${opacity}), 0 0 ${blur * 2}px rgba(${rgbColor}, ${opacity * 0.5})`,
    borderColor: `rgba(${rgbColor}, ${opacity + 0.2})`,
    backgroundColor: isDark ? `rgba(${rgbColor}, 0.1)` : `rgba(${rgbColor}, 0.05)`
  };
};

const formatPercentage = (value, showSign = true) => {
  if (value === null || value === undefined) return '-';
  const sign = showSign && value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const getPercentageColor = (value) => {
  if (value === null || value === undefined) return 'gray.500';
  return value >= 0 ? 'green.500' : 'red.500';
};

const PercentageDisplay = ({ value, fontSize = 'sm', fontWeight = 'bold' }) => (
  <Text fontSize={fontSize} fontWeight={fontWeight} color={getPercentageColor(value)}>
    {formatPercentage(value)}
  </Text>
);

export const TradingReturnBox = ({ title, color, colorMode, children }) => (
  <Box
    p={3}
    borderRadius="md"
    borderWidth="2px"
    borderColor={`${color}.500`}
    bg={colorMode === 'dark' ? `${color}.900` : `${color}.50`}
    borderLeft="4px solid"
    borderLeftColor={`${color}.500`}
    flex="1"
    minW="140px"
  >
    <Text fontSize="xs" fontWeight="bold" mb={2} color={`${color}.500`} textAlign="center">
      {title}
    </Text>
    <VStack spacing={1}>
      {children}
    </VStack>
  </Box>
);

export const DataRow = ({ label, value, type = 'prediction' }) => {
  const colors = {
    prediction: 'gray.500',
    revised: 'gray.500',
    actual: 'gray.500'
  };

  return (
    <>
      <Text fontSize="xs" color={colors[type]}>{label}:</Text>
      <PercentageDisplay value={value} fontSize={type === 'prediction' ? 'lg' : 'sm'} />
    </>
  );
};

export const ModelAccuracyScorecard = ({
  allPredictions,
  actualData,
  colorMode,
  activeRecommendation,
  splitBoxes = false
}) => {
  const modelAccuracies = useMemo(() => {
    if (!actualData?.length) return [];

    const results = [];

    const calculateAccuracy = (predictions, modelName, color, fullName) => {
      if (!predictions?.length) return null;

      const baselinePrediction = predictions.find(p => p.hour === "09:30") || predictions[0];
      const baselineActual = findClosestActualData(baselinePrediction?.hour || "09:30", actualData);

      if (!baselinePrediction || !baselineActual) return null;

      const endPrediction = predictions.find(p => p.hour === "16:00") || predictions[predictions.length - 1];
      const endActual = findClosestActualData(endPrediction?.hour || "16:00", actualData);

      if (!endPrediction || !endActual) return null;

      const HOLD_THRESHOLD = 0.5;

      const predictedChange = calculatePercentage(endPrediction.price, baselinePrediction.price);
      const actualChange = calculatePercentage(endActual.price, baselineActual.price);
      const accuracyDiff = Math.abs(predictedChange - actualChange);

      const isPredictedHold = Math.abs(predictedChange) <= HOLD_THRESHOLD;
      const isActualHold = Math.abs(actualChange) <= HOLD_THRESHOLD;
      const predictedDirection = predictedChange >= 0 ? 'up' : 'down';
      const actualDirection = actualChange >= 0 ? 'up' : 'down';

      let outcome = 'incorrect';
      if (isPredictedHold && isActualHold) {
        outcome = 'hold';
      } else if (predictedDirection === actualDirection) {
        outcome = 'correct';
      }

      return {
        modelName,
        fullName,
        color,
        outcome,
        accuracyDiff
      };
    };

    const models = [
      { key: 'master', name: 'M', color: COLORS.master_prediction, fullName: 'Master' },
      { key: 'revised', name: 'R', color: COLORS.revised_prediction, fullName: 'Revised' },
      { key: 'image', name: 'I', color: COLORS.image_prediction, fullName: 'Image' },
      { key: 'options', name: 'O', color: COLORS.options_prediction, fullName: 'Options' },
      { key: 'vibe', name: 'V', color: COLORS.vibe_prediction, fullName: 'Vibe' }
    ];

    models.forEach(model => {
      if (allPredictions[model.key]?.hourlyPrices?.length) {
        const result = calculateAccuracy(allPredictions[model.key].hourlyPrices, model.name, model.color, model.fullName);
        if (result) results.push(result);
      }
    });

    return results;
  }, [allPredictions, actualData]);

  const historicalAccuracy = useMemo(() => {
    const predictionAccuracy = activeRecommendation?.predictionAccuracy;
    if (!predictionAccuracy) return null;

    const accuracyMetrics = predictionAccuracy.accuracy_metrics;
    const modelComparison = predictionAccuracy.model_comparison;

    if (!accuracyMetrics) return null;

    const directionalAccuracy = accuracyMetrics.directional?.accuracy || 0;
    const movementWeightedAccuracy = accuracyMetrics.movement_weighted?.accuracy || 0;
    const totalPredictions = accuracyMetrics.directional?.total || 0;

    return {
      directionalAccuracy,
      movementWeightedAccuracy: movementWeightedAccuracy || directionalAccuracy,
      totalPredictions,
      models: {
        master: modelComparison?.master ? {
          movement_weighted_accuracy: modelComparison.master.movement_weighted_accuracy || 0,
          direction_accuracy: modelComparison.master.direction_accuracy || 0,
          predictions: modelComparison.master.predictions || 0,
          color: COLORS.master_prediction
        } : null,
        image: modelComparison?.image ? {
          movement_weighted_accuracy: modelComparison.image.movement_weighted_accuracy || 0,
          direction_accuracy: modelComparison.image.direction_accuracy || 0,
          predictions: modelComparison.image.predictions || 0,
          color: COLORS.image_prediction
        } : null,
        options: modelComparison?.options ? {
          movement_weighted_accuracy: modelComparison.options.movement_weighted_accuracy || 0,
          direction_accuracy: modelComparison.options.direction_accuracy || 0,
          predictions: modelComparison.options.predictions || 0,
          color: COLORS.options_prediction
        } : null,
        vibe: modelComparison?.vibe ? {
          movement_weighted_accuracy: modelComparison.vibe.movement_weighted_accuracy || 0,
          direction_accuracy: modelComparison.vibe.direction_accuracy || 0,
          predictions: modelComparison.vibe.predictions || 0,
          color: COLORS.vibe_prediction
        } : null
      }
    };
  }, [activeRecommendation]);

  const currentSessionRating = useMemo(() => {
    if (modelAccuracies.length === 0) return null;

    const masterModel = modelAccuracies.find(m => m.fullName === 'Master');

    if (masterModel) {
      if (masterModel.outcome === 'correct') {
        return { tier: 'excellent', color: 'green' };
      } else if (masterModel.outcome === 'hold') {
        return { tier: 'average', color: 'yellow' };
      } else {
        return { tier: 'critical', color: 'red' };
      }
    }

    const correctCount = modelAccuracies.filter(m => m.outcome === 'correct').length;
    const totalCount = modelAccuracies.length;
    const correctPercentage = (correctCount / totalCount) * 100;
    const avgAccuracyDiff = modelAccuracies.reduce((sum, m) => sum + m.accuracyDiff, 0) / totalCount;

    if (correctPercentage >= 80 && avgAccuracyDiff <= 2) return { tier: 'excellent', color: 'green' };
    if (correctPercentage >= 60 && avgAccuracyDiff <= 3) return { tier: 'good', color: 'green' };
    if (correctPercentage >= 40 && avgAccuracyDiff <= 5) return { tier: 'average', color: 'yellow' };
    if (correctPercentage >= 20) return { tier: 'poor', color: 'orange' };
    return { tier: 'critical', color: 'red' };
  }, [modelAccuracies]);

  if (modelAccuracies.length === 0 && !historicalAccuracy) return null;

  const primaryAccuracy = historicalAccuracy?.movementWeightedAccuracy || 0;
  const performance = getPerformanceTier(primaryAccuracy);
  const performanceGlowStyles = getPerformanceGlowStyles(performance.color, performance.intensity, colorMode);

  const availableModels = historicalAccuracy?.models ?
    Object.entries(historicalAccuracy.models)
      .filter(([_, model]) => model && model.predictions > 0)
      .sort((a, b) => b[1].movement_weighted_accuracy - a[1].movement_weighted_accuracy) : [];

  const HistoricalPerformanceBox = () => (
    historicalAccuracy && historicalAccuracy.totalPredictions > 0 && (
      <Box
        p={4}
        borderRadius="md"
        borderWidth="2px"
        bg={colorMode === 'dark' ? 'gray.700' : 'white'}
        borderLeft="4px solid"
        borderLeftColor={`${performance.color}.500`}
        boxShadow="lg"
        sx={performanceGlowStyles}
        flex="2.5"
      >
        <Flex justify="space-between" align="center" mb={3}>
          <Text fontSize="sm" fontWeight="bold" color={colorMode === 'dark' ? 'gray.200' : 'gray.700'}>
            Historical Performance
          </Text>
          <Badge colorScheme={performance.color} variant="solid" fontSize="xs">
            {performance.tier.toUpperCase()}
          </Badge>
        </Flex>

        {availableModels.length > 0 && (
          <SimpleGrid columns={2} spacing={2} mb={3}>
            {availableModels.map(([modelName, model]) => {
              const modelPerformance = getPerformanceTier(model.movement_weighted_accuracy);
              const fillPercentage = Math.min(100, Math.max(0, model.movement_weighted_accuracy));
              const correctPredictions = Math.round(model.direction_accuracy * model.predictions / 100);

              const individualModels = availableModels.filter(([name]) => name.toLowerCase() !== 'master');
              const reliableModels = individualModels.filter(([name, modelData]) => modelData.predictions >= 10);
              const sortedReliable = reliableModels.sort((a, b) => b[1].movement_weighted_accuracy - a[1].movement_weighted_accuracy);

              const topReliableAccuracy = sortedReliable[0]?.[1].movement_weighted_accuracy || 0;
              const secondReliableAccuracy = sortedReliable[1]?.[1].movement_weighted_accuracy || 0;
              const thirdReliableAccuracy = sortedReliable[2]?.[1].movement_weighted_accuracy || 0;

              const topTierGap = Math.abs(topReliableAccuracy - secondReliableAccuracy);
              const tierDropoff = secondReliableAccuracy - thirdReliableAccuracy;

              const isSingleStandout = modelName.toLowerCase() !== 'master' &&
                                     model.predictions >= 10 &&
                                     Math.abs(model.movement_weighted_accuracy - topReliableAccuracy) <= 1.0 &&
                                     topTierGap >= 5.0;

              const isTopTierTie = modelName.toLowerCase() !== 'master' &&
                                  model.predictions >= 10 &&
                                  (Math.abs(model.movement_weighted_accuracy - topReliableAccuracy) <= 1.0 ||
                                   Math.abs(model.movement_weighted_accuracy - secondReliableAccuracy) <= 1.0) &&
                                  topTierGap <= 5.0 &&
                                  tierDropoff >= 10.0;

              const isStandout = isSingleStandout || isTopTierTie;

              const getGradientColors = (accuracy) => {
                if (accuracy >= 70) return { start: 'rgba(34, 197, 94, 0.4)', end: 'rgba(34, 197, 94, 0.1)' };
                if (accuracy >= 60) return { start: 'rgba(34, 197, 94, 0.3)', end: 'rgba(34, 197, 94, 0.08)' };
                if (accuracy >= 50) return { start: 'rgba(234, 179, 8, 0.3)', end: 'rgba(234, 179, 8, 0.08)' };
                if (accuracy >= 40) return { start: 'rgba(249, 115, 22, 0.3)', end: 'rgba(249, 115, 22, 0.08)' };
                return { start: 'rgba(239, 68, 68, 0.3)', end: 'rgba(239, 68, 68, 0.08)' };
              };

              const { start, end } = getGradientColors(model.movement_weighted_accuracy);
              const gradientBg = `linear-gradient(90deg, ${start} 0%, ${start} ${fillPercentage}%, transparent ${fillPercentage}%, transparent 100%), linear-gradient(90deg, ${end} 0%, transparent 100%)`;

              return (
                <Box
                  key={modelName}
                  position="relative"
                  p={2}
                  borderRadius="md"
                  background={gradientBg}
                  border="1px solid"
                  borderColor={`${modelPerformance.color}.200`}
                  outline={isStandout ? "3px solid" : "none"}
                  outlineColor={isStandout ? `${modelPerformance.color}.400` : "transparent"}
                  overflow="hidden"
                >
                  <Flex justify="space-between" align="center">
                    <HStack spacing={2}>
                      <Box w="10px" h="10px" borderRadius="full" bg={model.color} />
                      <Text fontSize="sm" fontWeight="medium" textTransform="capitalize">{modelName}</Text>
                    </HStack>
                    <Box
                      bg="rgba(0, 0, 0, 0.4)"
                      borderRadius="sm"
                      px={1}
                      py={0.5}
                    >
                      <HStack spacing={1}>
                        <HStack spacing={0}>
                          <Text fontSize="7px" color={`${modelPerformance.color}.500`} mr="1px">⬢</Text>
                          <Text fontSize="sm" fontWeight="bold" color={`${modelPerformance.color}.500`}>
                            {model.movement_weighted_accuracy.toFixed(1)}%
                          </Text>
                        </HStack>
                        <HStack spacing={0}>
                          <Text fontSize="7px" color="gray.400" mr="1px">↗</Text>
                          <Text fontSize="10px" color="gray.400">
                            ({model.direction_accuracy.toFixed(1)}%)
                          </Text>
                        </HStack>
                        <HStack spacing={0}>
                          <Text fontSize="7px" color="gray.500" mr="1px">#</Text>
                          <Text fontSize="10px" color="gray.500">
                            ({correctPredictions}/{model.predictions})
                          </Text>
                        </HStack>
                      </HStack>
                    </Box>
                  </Flex>
                </Box>
              );
            })}
          </SimpleGrid>
        )}
      </Box>
    )
  );

  const CurrentSessionBox = () => (
    modelAccuracies.length > 0 && (
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
        <Flex justify="space-between" align="center" mb={3}>
          <Text fontSize="sm" fontWeight="bold" color={colorMode === 'dark' ? 'gray.200' : 'gray.700'}>
            Current Session
          </Text>
          {currentSessionRating && (
            <Badge colorScheme={currentSessionRating.color} variant="solid" fontSize="xs">
              {currentSessionRating.tier.toUpperCase()}
            </Badge>
          )}
        </Flex>
        <VStack spacing={1} align="stretch">
          {modelAccuracies.map((model, index) => {
            const glowIntensity = calculateGlowIntensity(model.accuracyDiff, model.outcome === 'correct');
            const glowStyles = getGlowStyles(model.outcome, glowIntensity, colorMode);

            const outcomeConfig = {
              correct: { icon: <CheckCircle size={12} />, color: "green.500" },
              incorrect: { icon: <X size={12} />, color: "red.500" },
              hold: { icon: <Minus size={12} />, color: "yellow.500" },
            };

            const { icon, color } = outcomeConfig[model.outcome];
            const diffColor = model.outcome === 'hold'
                ? (colorMode === 'dark' ? 'yellow.400' : 'yellow.600')
                : color;

            return (
              <HStack key={index} justify="space-between" align="center">
                <HStack spacing={2}>
                  <Box w="8px" h="8px" borderRadius="full" bg={model.color} />
                  <Text fontSize="xs" fontWeight="medium" color={colorMode === 'dark' ? 'gray.100' : 'gray.800'}>
                    {model.fullName}
                  </Text>
                </HStack>
                <HStack spacing={1}>
                  <Box
                    color="white"
                    bg={color}
                    borderRadius="full"
                    p={0.5}
                    border="2px solid white"
                    sx={glowStyles}
                  >
                    {icon}
                  </Box>
                  <Text fontSize="xs" color={diffColor} fontWeight="bold">
                    {formatValue(model.accuracyDiff, 1)}%
                  </Text>
                </HStack>
              </HStack>
            );
          })}
        </VStack>
      </Box>
    )
  );

  if (splitBoxes) {
    return (
      <>
        <HistoricalPerformanceBox />
        <CurrentSessionBox />
      </>
    );
  }

  return (
    <VStack spacing={3} align="stretch">
      <HistoricalPerformanceBox />
      <CurrentSessionBox />
    </VStack>
  );
};