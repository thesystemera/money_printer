import React, { useMemo } from 'react';
import {
  Box, Text, VStack, Flex, Badge, SimpleGrid,
  Stat, StatLabel, StatNumber, StatHelpText,
  Tabs, TabList, Tab, TabPanels, TabPanel, useColorModeValue
} from '@chakra-ui/react';
import {
  Activity, Award
} from 'lucide-react';

const COLOR_MAPPINGS = {
  accuracy: {
    thresholds: [{ min: 70, color: 'green' }, { min: 60, color: 'yellow' }, { min: 50, color: 'orange' }],
    default: 'red'
  },
  performance: {
    values: { excellent: 'green', good: 'blue', average: 'yellow', 'below average': 'orange', poor: 'red' },
    default: 'gray'
  }
};

const getColor = (type, value) => {
  if (value === null || value === undefined) return COLOR_MAPPINGS[type]?.default || 'gray';
  const mapping = COLOR_MAPPINGS[type];
  if (!mapping) return 'gray';
  if (mapping.values) {
    return mapping.values[value?.toString().toLowerCase()] || mapping.default;
  }
  if (mapping.thresholds) {
    for (const threshold of mapping.thresholds) {
      if (value >= threshold.min) return threshold.color;
    }
    return mapping.default;
  }
  return mapping.default;
};

const formatValue = (value, decimals = 2) => {
  if (value === null || value === undefined) return 'N/A';
  return typeof value === 'number' ? value.toFixed(decimals) : value;
};

const MetricStat = ({ label, value, suffix = '', helpText, color, size = 'sm' }) => (
  <Stat size={size}>
    <StatLabel fontSize="xs" color="gray.600" _dark={{ color: 'gray.400' }}>{label}</StatLabel>
    <StatNumber fontSize="lg" color={color ? `${color}.500` : undefined}>
      {value}{suffix}
    </StatNumber>
    {helpText && <StatHelpText fontSize="xs">{helpText}</StatHelpText>}
  </Stat>
);

const CategoryRankingList = ({ categories, borderColor, textColor }) => {
  if (!categories || categories.length === 0) {
    return <Text fontSize="sm" color={textColor} mt={4}>No signal categories found for this model.</Text>;
  }
  return (
    <VStack spacing={3} align="stretch" mt={6}>
      <Text fontSize="sm" fontWeight="medium" mb={0}>Signal Category Rankings</Text>
      {categories.map((category, index) => (
        <Box key={category.category} p={3} borderWidth="1px" borderColor={borderColor} borderRadius="md">
          <Flex justify="space-between" align="center" mb={2}>
            <Flex align="center" gap={2}>
              <Text fontSize="sm" fontWeight="bold">{category.category}</Text>
              {index === 0 && <Award size={14} color="var(--chakra-colors-yellow-500)" />}
            </Flex>
            <Badge colorScheme={getColor('performance', category.rating)} variant="solid">
              {category.rating}
            </Badge>
          </Flex>
          <SimpleGrid columns={{ base: 2, md: 5 }} spacing={3}>
            <Box>
              <Text fontSize="xs" color={textColor}>Movement-Wtd</Text>
              <Text fontSize="sm" fontWeight="bold" color="purple.500">
                {formatValue(category.movement_weighted_accuracy, 1)}%
              </Text>
            </Box>
            <Box>
              <Text fontSize="xs" color={textColor}>Directional</Text>
              <Text fontSize="sm" fontWeight="bold" color={`${getColor('accuracy', category.accuracy)}.500`}>
                {formatValue(category.accuracy, 1)}%
              </Text>
            </Box>
            <Box>
              <Text fontSize="xs" color={textColor}>Confidence-Wtd</Text>
              <Text fontSize="sm" fontWeight="bold" color="teal.500">
                {formatValue(category.confidence_weighted_accuracy, 1)}%
              </Text>
            </Box>
            <Box>
              <Text fontSize="xs" color={textColor}>Signals</Text>
              <Text fontSize="sm" fontWeight="bold">
                {category.correct}/{category.total}
              </Text>
            </Box>
            <Box>
              <Text fontSize="xs" color={textColor}>Rank</Text>
              <Text fontSize="sm" fontWeight="bold">
                #{index + 1}
              </Text>
            </Box>
          </SimpleGrid>
        </Box>
      ))}
    </VStack>
  );
};

const SignalPerformanceSection = ({
  signal_performance,
  borderColor,
}) => {
  const textColor = useColorModeValue('gray.700', 'gray.300');
  const accentBg = useColorModeValue('blackAlpha.50', 'whiteAlpha.100');
  const mutedTextColor = useColorModeValue('gray.600', 'gray.400');

  const categoryRankingsByModel = useMemo(() => {
    if (!signal_performance?.by_category) return {};
    const models = Object.keys(signal_performance.by_model || {});
    const rankings = {};
    models.forEach(modelName => {
      const modelCategories = Object.entries(signal_performance.by_category)
        .filter(([, catData]) => catData.model_breakdown?.[modelName])
        .map(([catName, catData]) => ({
          category: catName,
          ...catData.model_breakdown[modelName],
        }))
        .sort((a, b) => {
          const aMovement = a.movement_weighted_accuracy ?? -1;
          const bMovement = b.movement_weighted_accuracy ?? -1;
          if (bMovement !== aMovement) {
            return bMovement - aMovement;
          }
          return b.accuracy - a.accuracy;
        });
      rankings[modelName] = modelCategories;
    });
    return rankings;
  }, [signal_performance]);

  if (!signal_performance) {
    return (
      <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
        <Flex align="center" gap={2} mb={3}>
          <Activity size={20} color="var(--chakra-colors-teal-500)" />
          <Text fontSize="md" fontWeight="bold">Signal-Level Accuracy Analysis</Text>
        </Flex>
        <Text fontSize="sm" color={textColor}>No signal data available yet</Text>
      </Box>
    );
  }

  const availableModels = Object.keys(signal_performance.by_model || {}).sort();

  return (
    <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
      <Flex justify="space-between" align="center" mb={4}>
        <Flex align="center" gap={2}>
          <Activity size={20} color="var(--chakra-colors-teal-500)" />
          <Text fontSize="md" fontWeight="bold">Signal-Level Accuracy Analysis</Text>
        </Flex>
        <Badge colorScheme="teal" variant="solid">Signal Tracking</Badge>
      </Flex>

      <Tabs size="sm" variant="soft-rounded" colorScheme="teal">
        <TabList flexWrap="wrap">
          <Tab>All Signals</Tab>
          {availableModels.map(model => (
            <Tab key={model} textTransform="capitalize">{model}</Tab>
          ))}
        </TabList>

        <TabPanels mt={4}>
          <TabPanel p={0}>
            <Box p={3} bg={accentBg} borderRadius="md">
              <Text fontSize="sm" fontWeight="medium" mb={3}>Overall Signal Performance</Text>
              <SimpleGrid columns={{ base: 2, md: 5 }} spacing={4}>
                <MetricStat
                  label="Total Signals"
                  value={signal_performance.total_signals || 0}
                  helpText={`From ${signal_performance.recommendations_with_signals || 0} recommendations`}
                />
                {signal_performance.overall_movement_weighted_accuracy !== null &&
                 signal_performance.overall_movement_weighted_accuracy !== undefined && (
                  <MetricStat
                    label="Movement-Weighted"
                    value={formatValue(signal_performance.overall_movement_weighted_accuracy, 1)}
                    suffix="%"
                    color="purple"
                  />
                )}
                <MetricStat
                  label="Directional Accuracy"
                  value={formatValue(signal_performance.overall_accuracy, 1)}
                  suffix="%"
                  color={getColor('accuracy', signal_performance.overall_accuracy)}
                />
                {signal_performance.best_performing_category && (
                  <MetricStat
                    label="Best Category"
                    value={signal_performance.best_performing_category}
                    helpText="Top performing signal type"
                    color="green"
                  />
                )}
                {signal_performance.worst_performing_category && (
                  <MetricStat
                    label="Needs Focus"
                    value={signal_performance.worst_performing_category}
                    helpText="Lowest performing signal type"
                    color="orange"
                  />
                )}
              </SimpleGrid>
            </Box>
            <CategoryRankingList categories={signal_performance.top_categories} borderColor={borderColor} textColor={mutedTextColor} />
          </TabPanel>

          {availableModels.map(modelName => {
            const modelData = signal_performance.by_model[modelName];
            const rankedCategories = categoryRankingsByModel[modelName] || [];
            const bestCategory = rankedCategories.length > 0 ? rankedCategories[0].category : null;
            const worstCategory = rankedCategories.length > 1 ? rankedCategories[rankedCategories.length - 1].category : null;

            return (
              <TabPanel key={modelName} p={0}>
                <Box p={3} bg={accentBg} borderRadius="md">
                  <Text fontSize="sm" fontWeight="medium" mb={3} textTransform="capitalize">{modelName} Model Performance</Text>
                  <SimpleGrid columns={{ base: 2, md: 5 }} spacing={4}>
                    <MetricStat
                      label="Total Signals"
                      value={modelData.total || 0}
                    />
                    {modelData.movement_weighted_accuracy !== null &&
                     modelData.movement_weighted_accuracy !== undefined && (
                      <MetricStat
                        label="Movement-Weighted"
                        value={formatValue(modelData.movement_weighted_accuracy, 1)}
                        suffix="%"
                        color="purple"
                      />
                    )}
                    <MetricStat
                      label="Directional"
                      value={formatValue(modelData.accuracy, 1)}
                      suffix="%"
                      color={getColor('accuracy', modelData.accuracy)}
                    />
                    {bestCategory && (
                      <MetricStat
                        label="Best Category"
                        value={bestCategory}
                        helpText="Top performing signal type"
                        color="green"
                      />
                    )}
                    {worstCategory && (
                       <MetricStat
                        label="Needs Focus"
                        value={worstCategory}
                        helpText="Lowest performing signal type"
                        color="orange"
                      />
                    )}
                  </SimpleGrid>
                </Box>
                <CategoryRankingList categories={rankedCategories} borderColor={borderColor} textColor={mutedTextColor} />
              </TabPanel>
            )
          })}
        </TabPanels>
      </Tabs>

      <Box mt={6} p={3} bg={accentBg} borderRadius="md">
        <Text fontSize="xs" fontWeight="medium" mb={2}>Signal Analysis Metrics</Text>
        <VStack spacing={1} align="stretch">
          <Text fontSize="xs" color={textColor}>
            <strong>Movement-Weighted:</strong> Accuracy weighted by the significance of price movements. Getting big moves right counts more than small moves.
          </Text>
          <Text fontSize="xs" color={textColor}>
            <strong>Directional:</strong> Simple percentage of correct direction predictions regardless of movement size.
          </Text>
          <Text fontSize="xs" color={textColor}>
            <strong>Confidence-Weighted:</strong> Accuracy weighted by each signal's confidence level. Higher confidence correct predictions boost the score more.
          </Text>
          <Text fontSize="xs" color={textColor}>
            <strong>Categories:</strong> Signals are grouped by type and ranked by movement-weighted performance first, then directional accuracy.
          </Text>
        </VStack>
      </Box>
    </Box>
  );
};

export { SignalPerformanceSection };