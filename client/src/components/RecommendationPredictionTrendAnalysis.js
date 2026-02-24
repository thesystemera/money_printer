import React, { useState, useMemo } from 'react';
import {
  Box, Text, VStack, HStack, Flex, Badge, SimpleGrid,
  Tabs, TabList, Tab
} from '@chakra-ui/react';
import {
  TrendingUp, ArrowUpDown, Target, Zap
} from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Area, ComposedChart, Line } from 'recharts';

const formatValue = (value, decimals = 2) => {
  if (value === null || value === undefined) return 'N/A';
  return typeof value === 'number' ? value.toFixed(decimals) : value;
};

const formatDate = (dateString) => {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateString;
  }
};

const getAccuracyColor = (accuracy) => {
  if (accuracy >= 70) return 'green';
  if (accuracy >= 60) return 'yellow';
  if (accuracy >= 50) return 'orange';
  return 'red';
};

const getTrendColor = (trend) => {
  switch (trend?.toLowerCase()) {
    case 'improving': return 'green';
    case 'declining': return 'red';
    case 'stable': return 'blue';
    default: return 'gray';
  }
};

const TrendsSection = ({ trends, colorMode, borderColor, preselectedModel, visibleLines = {} }) => {
    const isNewFormat = useMemo(() => trends && trends.master && typeof trends.master === 'object', [trends]);

    const [selectedTrendModel, setSelectedTrendModel] = useState(preselectedModel || 'master');

    const textColor = colorMode === 'dark' ? 'gray.300' : 'gray.700';
    const accentBg = colorMode === 'dark' ? 'whiteAlpha.100' : 'blackAlpha.50';

    const defaultVisibility = {
        movementWeighted: true,
        directional: true,
        buyMovWtd: true,
        buyDirectional: true,
        holdMovWtd: true,
        holdDirectional: true,
        sellMovWtd: true,
        sellDirectional: true,
        poolSize: true
    };

    const finalVisibleLines = { ...defaultVisibility, ...visibleLines };

    const currentTrendData = useMemo(() => {
        if (!trends) return null;
        if (isNewFormat) {
            return trends[selectedTrendModel];
        }
        return trends;
    }, [trends, isNewFormat, selectedTrendModel]);

    const trendModels = useMemo(() => {
        if (!trends || !isNewFormat) return [];
        return Object.keys(trends).filter(k => trends[k] && trends[k].daily_metrics && trends[k].daily_metrics.length > 0);
    }, [trends, isNewFormat]);

    const hasMultipleModels = trendModels.length > 1;

    const CustomizedLabel = ({ x, y, value, index, dataKey }) => {
      if (!currentTrendData?.rolling_windows || currentTrendData.rolling_windows.length === 0) return null;
      const totalPoints = currentTrendData.rolling_windows.length;
      if (index === 0 || index === totalPoints - 1 || (index > 0 && index < totalPoints - 1 && index % 2 === 0)) {
          const pointData = currentTrendData.rolling_windows[index];
          if (!pointData) return null;
          const dy = dataKey === 'movement_weighted_accuracy' ? -15 : 20;
          return (
              <g transform={`translate(${x},${y})`}>
                  <text x={0} y={0} dy={dy} fill={colorMode === 'dark' ? "#FFFFFF" : "#000000"} fontSize={10} textAnchor="middle" fontWeight="bold">
                      {`${formatValue(value, 0)}%`}
                  </text>
                  <text x={0} y={0} dy={dy + 10} fill={colorMode === 'dark' ? "#FFFFFF" : "#000000"} opacity={0.85} fontSize={9} textAnchor="middle">
                      {formatDate(pointData.end_date)}
                  </text>
              </g>
          );
      }
      return null;
    };

    const ActiveDot = ({ cx, cy, stroke, index }) => {
        if (!currentTrendData?.rolling_windows) return null;
        const totalPoints = currentTrendData.rolling_windows.length ?? 0;
        if (index === 0 || index === totalPoints - 1 || (index > 0 && index < totalPoints - 1 && index % 2 === 0)) {
            return <circle cx={cx} cy={cy} r={3} fill={stroke} />;
        }
        return null;
    };

    const colors = {
      movementWeighted: '#a855f7',
      directional: '#06b6d4',
      buy: '#22c55e',
      sell: '#ef4444',
      hold: '#f59e0b',
      poolSize: colorMode === 'dark' ? '#4A5568' : '#E2E8F0'
    };

    if (!currentTrendData) {
        return null;
    }

    return (
        <VStack spacing={4} align="stretch">
          <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
            <Flex justify="space-between" align="center" mb={4}>
              <Text fontSize="md" fontWeight="bold">Daily Accuracy Trend Analysis</Text>
              {currentTrendData && (
                <HStack spacing={2}>
                    <Badge colorScheme={getTrendColor(currentTrendData.trend)} variant="solid">
                    {currentTrendData.trend} Trend
                    </Badge>
                    {currentTrendData.bias_analysis?.trend && (
                    <Badge
                        colorScheme={currentTrendData.bias_analysis.trend === 'IMPROVING' ? 'green' :
                                    currentTrendData.bias_analysis.trend === 'WORSENING' ? 'red' : 'gray'}
                        variant="outline"
                    >
                        Bias {currentTrendData.bias_analysis.trend}
                    </Badge>
                    )}
                </HStack>
              )}
            </Flex>

            {currentTrendData && (
                <SimpleGrid columns={{ base: 1, md: 5 }} spacing={4} mb={6}>
                <Box p={3} bg={accentBg} borderRadius="md">
                    <Flex align="center" gap={2} mb={2}>
                    <ArrowUpDown size={16} color="var(--chakra-colors-blue-500)" />
                    <Text fontSize="xs" fontWeight="medium">Current Trend</Text>
                    </Flex>
                    <Text fontSize="lg" fontWeight="bold" color={`${getTrendColor(currentTrendData.trend)}.500`}>
                    {currentTrendData.trend}
                    </Text>
                    <Text fontSize="xs" color={textColor}>
                    Overall direction
                    </Text>
                </Box>

                <Box p={3} bg={accentBg} borderRadius="md">
                    <Flex align="center" gap={2} mb={2}>
                    <Target size={16} color="var(--chakra-colors-green-500)" />
                    <Text fontSize="xs" fontWeight="medium">Recent Directional</Text>
                    </Flex>
                    <Text fontSize="lg" fontWeight="bold" color={`${getAccuracyColor(currentTrendData.recent_accuracy)}.500`}>
                    {formatValue(currentTrendData.recent_accuracy, 1)}%
                    </Text>
                    <Text fontSize="xs" color={textColor}>
                    Latest window
                    </Text>
                </Box>

                <Box p={3} bg={accentBg} borderRadius="md">
                    <Flex align="center" gap={2} mb={2}>
                    <Zap size={16} color="var(--chakra-colors-purple-500)" />
                    <Text fontSize="xs" fontWeight="medium">Recent Movement-Weighted</Text>
                    </Flex>
                    <Text fontSize="lg" fontWeight="bold" color={`purple.500`}>
                    {formatValue(currentTrendData.recent_movement_weighted_accuracy, 1)}%
                    </Text>
                    <Text fontSize="xs" color={textColor}>
                    Latest window
                    </Text>
                </Box>

                {currentTrendData.bias_analysis?.recent_bias !== null && currentTrendData.bias_analysis?.recent_bias !== undefined && (
                    <Box p={3} bg={accentBg} borderRadius="md">
                    <Flex align="center" gap={2} mb={2}>
                        <TrendingUp size={16} color="var(--chakra-colors-orange-500)" />
                        <Text fontSize="xs" fontWeight="medium">Buy/Sell Bias</Text>
                    </Flex>
                    <Text fontSize="lg" fontWeight="bold" color={
                        Math.abs(currentTrendData.bias_analysis.recent_bias) < 5 ? 'green.500' :
                        Math.abs(currentTrendData.bias_analysis.recent_bias) < 15 ? 'yellow.500' : 'red.500'
                    }>
                        {currentTrendData.bias_analysis.recent_bias > 0 ? '+' : ''}{formatValue(currentTrendData.bias_analysis.recent_bias, 1)}%
                    </Text>
                    <Text fontSize="xs" color={textColor}>
                        {currentTrendData.bias_analysis.recent_bias > 5 ? 'Buy biased' :
                        currentTrendData.bias_analysis.recent_bias < -5 ? 'Sell biased' : 'Well balanced'}
                    </Text>
                    </Box>
                )}

                {currentTrendData.comparison && (
                    <Box p={3} bg={accentBg} borderRadius="md">
                    <Flex align="center" gap={2} mb={2}>
                        <TrendingUp size={16} color="var(--chakra-colors-orange-500)" />
                        <Text fontSize="xs" fontWeight="medium">Movement-Weighted Change</Text>
                    </Flex>
                    <Text fontSize="lg" fontWeight="bold" color={currentTrendData.comparison.improvement ? 'green.500' : 'red.500'}>
                        {currentTrendData.comparison.movement_weighted_difference > 0 ? '+' : ''}{formatValue(currentTrendData.comparison.movement_weighted_difference, 1)}%
                    </Text>
                    <Text fontSize="xs" color={textColor}>
                        vs first half
                    </Text>
                    </Box>
                )}
                </SimpleGrid>
            )}

            {hasMultipleModels && (
              <Tabs
                isFitted
                variant="soft-rounded"
                colorScheme="blue"
                defaultIndex={trendModels.indexOf(selectedTrendModel)}
                onChange={(index) => setSelectedTrendModel(trendModels[index])}
                mb={4}
              >
                <TabList>
                  {trendModels.map(modelName => (
                    <Tab key={modelName} textTransform="capitalize" fontSize="sm">{modelName}</Tab>
                  ))}
                </TabList>
              </Tabs>
            )}

            {currentTrendData?.rolling_windows && currentTrendData.rolling_windows.length > 0 && (
              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={3}>Daily Rolling Accuracy and Volume</Text>
                <Box h="400px" minH="400px" bg={accentBg} borderRadius="md" p={1}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={currentTrendData.rolling_windows}
                      margin={{ top: 25, right: 10, left: 10, bottom: 25 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={colorMode === 'dark' ? '#374151' : '#E5E7EB'} />
                      <XAxis
                        dataKey="window_index"
                        stroke={colorMode === 'dark' ? '#9CA3AF' : '#6B7280'}
                        fontSize={12}
                        tick={{ dy: 5 }}
                      />
                      <YAxis
                        yAxisId="left"
                        stroke={colorMode === 'dark' ? '#9CA3AF' : '#6B7280'}
                        fontSize={12}
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke={colorMode === 'dark' ? '#9CA3AF' : '#6B7280'}
                        fontSize={12}
                        domain={[0, dataMax => {
                          const max = dataMax || 0;
                          const roundedMax = Math.ceil(max / 10) * 10;
                          return roundedMax > 0 ? roundedMax : 80;
                        }]}
                        tickCount={6}
                        tickFormatter={(value) => `${value}`}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: colorMode === 'dark' ? '#1F2937' : '#FFFFFF',
                          border: '1px solid',
                          borderColor: colorMode === 'dark' ? '#374151' : '#E5E7EB',
                          borderRadius: '6px'
                        }}
                        formatter={(value, name) => {
                           if (name === 'Pool Size') return [value, name];
                           return [`${formatValue(value, 1)}%`, name];
                        }}
                        labelFormatter={(label) => {
                          const window = currentTrendData.rolling_windows.find(w => w.window_index === label);
                          if (!window) return `Window ${label}`;
                          return `Window ${window.window_index}: ${formatDate(window.start_date)} to ${formatDate(window.end_date)}`;
                        }}
                      />

                      {finalVisibleLines.poolSize && <Area
                        yAxisId="right"
                        type="monotone"
                        dataKey="total_predictions"
                        name="Pool Size"
                        stroke="none"
                        fill={colors.poolSize}
                        fillOpacity={0.4}
                      />}
                      {finalVisibleLines.directional && <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="directional_accuracy"
                        name="Directional Accuracy"
                        stroke={colors.directional}
                        fill={colors.directional}
                        fillOpacity={0.15}
                        strokeWidth={3}
                        dot={<ActiveDot />}
                        label={<CustomizedLabel dataKey="directional_accuracy" />}
                      />}
                      {finalVisibleLines.movementWeighted && <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="movement_weighted_accuracy"
                        name="Movement-Weighted Accuracy"
                        stroke={colors.movementWeighted}
                        fill={colors.movementWeighted}
                        fillOpacity={0.1}
                        strokeWidth={3}
                        dot={<ActiveDot />}
                        label={<CustomizedLabel dataKey="movement_weighted_accuracy" />}
                      />}
                      {finalVisibleLines.buyMovWtd && <Line yAxisId="left" type="monotone" dataKey="buy_movement_weighted_accuracy" name="Buy Mov-Wtd" stroke={colors.buy} strokeWidth={2} strokeDasharray="3 3" dot={false} />}
                      {finalVisibleLines.buyDirectional && <Line yAxisId="left" type="monotone" dataKey="buy_accuracy" name="Buy Directional" stroke={colors.buy} strokeWidth={1} strokeDasharray="5 5" dot={false} />}
                      {finalVisibleLines.holdMovWtd && <Line yAxisId="left" type="monotone" dataKey="hold_movement_weighted_accuracy" name="Hold Mov-Wtd" stroke={colors.hold} strokeWidth={2} strokeDasharray="3 3" dot={false} />}
                      {finalVisibleLines.holdDirectional && <Line yAxisId="left" type="monotone" dataKey="hold_accuracy" name="Hold Directional" stroke={colors.hold} strokeWidth={1} strokeDasharray="5 5" dot={false} />}
                      {finalVisibleLines.sellMovWtd && <Line yAxisId="left" type="monotone" dataKey="sell_movement_weighted_accuracy" name="Sell Mov-Wtd" stroke={colors.sell} strokeWidth={2} strokeDasharray="3 3" dot={false} />}
                      {finalVisibleLines.sellDirectional && <Line yAxisId="left" type="monotone" dataKey="sell_accuracy" name="Sell Directional" stroke={colors.sell} strokeWidth={1} strokeDasharray="5 5" dot={false} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
                <VStack align="center" spacing={2} mt={3}>
                    <HStack spacing={4} justify="center" flexWrap="wrap">
                        {finalVisibleLines.movementWeighted && <HStack><Box w={4} h={3} bg={colors.movementWeighted} opacity={0.4} borderRadius="sm" /><Text fontSize="xs" color={textColor}>Mov-Wtd Accuracy</Text></HStack>}
                        {finalVisibleLines.directional && <HStack><Box w={4} h={3} bg={colors.directional} opacity={0.4} borderRadius="sm" /><Text fontSize="xs" color={textColor}>Directional Accuracy</Text></HStack>}
                        {finalVisibleLines.buyMovWtd && <HStack><Box w={4} h={0.5} bg={colors.buy} opacity={0.7} /><Text fontSize="xs" color={textColor}>Buy Mov-Wtd</Text></HStack>}
                        {finalVisibleLines.buyDirectional && <HStack><Box w={4} h={0.5} bg={colors.buy} /><Text fontSize="xs" color={textColor}>Buy Directional</Text></HStack>}
                        {finalVisibleLines.holdMovWtd && <HStack><Box w={4} h={0.5} bg={colors.hold} opacity={0.7} /><Text fontSize="xs" color={textColor}>Hold Mov-Wtd</Text></HStack>}
                        {finalVisibleLines.holdDirectional && <HStack><Box w={4} h={0.5} bg={colors.hold} /><Text fontSize="xs" color={textColor}>Hold Directional</Text></HStack>}
                        {finalVisibleLines.sellMovWtd && <HStack><Box w={4} h={0.5} bg={colors.sell} opacity={0.7} /><Text fontSize="xs" color={textColor}>Sell Mov-Wtd</Text></HStack>}
                        {finalVisibleLines.sellDirectional && <HStack><Box w={4} h={0.5} bg={colors.sell} /><Text fontSize="xs" color={textColor}>Sell Directional</Text></HStack>}
                        {finalVisibleLines.poolSize && <HStack><Box w={3} h={3} bg={colors.poolSize} borderRadius="sm" /><Text fontSize="xs" color={textColor}>Pool Size</Text></HStack>}
                    </HStack>
                    {currentTrendData?.rolling_windows?.length > 0 && (
                        <Text fontSize="xs" color={textColor} textAlign="center">
                        Analysis Period: {formatDate(currentTrendData.rolling_windows[0].start_date)} to {formatDate(currentTrendData.rolling_windows[currentTrendData.rolling_windows.length - 1].end_date)}
                        </Text>
                    )}
                </VStack>
              </Box>
            )}

            {currentTrendData?.bias_analysis && (
              <Box mt={6} p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
                <Text fontSize="sm" fontWeight="medium" mb={3}>Buy/Sell Bias Analysis</Text>

                <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={4}>
                  {currentTrendData.bias_analysis.recent_buy_accuracy !== null && (
                    <Box>
                      <Text fontSize="xs" color={textColor} mb={1}>Recent Buy Accuracy</Text>
                      <Text fontSize="lg" fontWeight="bold" color="green.500">
                        {formatValue(currentTrendData.bias_analysis.recent_buy_accuracy, 1)}%
                      </Text>
                      <Text fontSize="xs" color={textColor}>Movement-weighted</Text>
                    </Box>
                  )}

                  {currentTrendData.bias_analysis.recent_sell_accuracy !== null && (
                    <Box>
                      <Text fontSize="xs" color={textColor} mb={1}>Recent Sell Accuracy</Text>
                      <Text fontSize="lg" fontWeight="bold" color="red.500">
                        {formatValue(currentTrendData.bias_analysis.recent_sell_accuracy, 1)}%
                      </Text>
                      <Text fontSize="xs" color={textColor}>Movement-weighted</Text>
                    </Box>
                  )}

                  {currentTrendData.bias_analysis.avg_bias !== null && (
                    <Box>
                      <Text fontSize="xs" color={textColor} mb={1}>Average Bias</Text>
                      <Text fontSize="lg" fontWeight="bold" color={
                        Math.abs(currentTrendData.bias_analysis.avg_bias) < 5 ? 'green.500' :
                        Math.abs(currentTrendData.bias_analysis.avg_bias) < 15 ? 'yellow.500' : 'red.500'
                      }>
                        {currentTrendData.bias_analysis.avg_bias > 0 ? '+' : ''}{formatValue(currentTrendData.bias_analysis.avg_bias, 1)}%
                      </Text>
                      <Text fontSize="xs" color={textColor}>
                        {Math.abs(currentTrendData.bias_analysis.avg_bias) < 5 ? 'Well balanced' :
                         currentTrendData.bias_analysis.avg_bias > 0 ? 'Buy biased' : 'Sell biased'}
                      </Text>
                    </Box>
                  )}

                  {currentTrendData.bias_analysis.bias_volatility !== null && (
                    <Box>
                      <Text fontSize="xs" color={textColor} mb={1}>Bias Stability</Text>
                      <Text fontSize="lg" fontWeight="bold" color={
                        currentTrendData.bias_analysis.bias_volatility < 10 ? 'green.500' :
                        currentTrendData.bias_analysis.bias_volatility < 20 ? 'yellow.500' : 'red.500'
                      }>
                        ±{formatValue(currentTrendData.bias_analysis.bias_volatility, 1)}%
                      </Text>
                      <Text fontSize="xs" color={textColor}>
                        {currentTrendData.bias_analysis.bias_volatility < 10 ? 'Stable' :
                         currentTrendData.bias_analysis.bias_volatility < 20 ? 'Moderate' : 'Volatile'}
                      </Text>
                    </Box>
                  )}
                </SimpleGrid>

                <Box p={3} bg={accentBg} borderRadius="md">
                  <Text fontSize="xs" fontWeight="medium" mb={2}>Bias Interpretation</Text>
                  <VStack spacing={1} align="stretch">
                    <Text fontSize="xs" color={textColor}>
                      <strong>Bias Value:</strong> Positive values indicate BUY predictions are more accurate than SELL predictions
                    </Text>
                    <Text fontSize="xs" color={textColor}>
                      <strong>Ideal Range:</strong> ±5% indicates well-balanced model performance between BUY and SELL actions
                    </Text>
                    <Text fontSize="xs" color={textColor}>
                      <strong>Bias Trend:</strong> {currentTrendData.bias_analysis.trend || 'N/A'} -
                      {currentTrendData.bias_analysis.improvement === true ? ' Model bias is improving' :
                       currentTrendData.bias_analysis.improvement === false ? ' Model bias is worsening' :
                       ' Bias trend unclear'}
                    </Text>
                    {currentTrendData.bias_analysis.recent_bias !== null && Math.abs(currentTrendData.bias_analysis.recent_bias) > 15 && (
                      <Text fontSize="xs" color="orange.500">
                        ⚠️ High bias detected - consider reviewing model training for {currentTrendData.bias_analysis.recent_bias > 0 ? 'SELL' : 'BUY'} predictions
                      </Text>
                    )}
                  </VStack>
                </Box>
              </Box>
            )}

            {currentTrendData?.comparison && (
              <Box mt={4}>
                <Text fontSize="sm" fontWeight="medium" mb={3}>Period Comparison</Text>
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  <Box p={3} borderWidth="1px" borderColor={borderColor} borderRadius="md">
                    <Text fontSize="xs" color={textColor} mb={2}>Directional Accuracy Comparison</Text>
                    <SimpleGrid columns={2} spacing={4}>
                      <Box>
                        <Text fontSize="xs" color={textColor}>First Half</Text>
                        <Text fontSize="lg" fontWeight="bold" color={`${getAccuracyColor(currentTrendData.comparison.first_half)}.500`}>
                          {formatValue(currentTrendData.comparison.first_half, 1)}%
                        </Text>
                      </Box>
                      <Box>
                        <Text fontSize="xs" color={textColor}>Second Half</Text>
                        <Text fontSize="lg" fontWeight="bold" color={`${getAccuracyColor(currentTrendData.comparison.second_half)}.500`}>
                          {formatValue(currentTrendData.comparison.second_half, 1)}%
                        </Text>
                      </Box>
                    </SimpleGrid>
                    <Text fontSize="sm" fontWeight="medium" color={currentTrendData.comparison.improvement ? 'green.500' : 'red.500'} mt={2}>
                      {currentTrendData.comparison.improvement ? '+' : ''}{formatValue(currentTrendData.comparison.difference, 1)}% change
                    </Text>
                  </Box>

                  <Box p={3} borderWidth="1px" borderColor={borderColor} borderRadius="md">
                    <Text fontSize="xs" color={textColor} mb={2}>Movement-Weighted Comparison</Text>
                    <SimpleGrid columns={2} spacing={4}>
                      <Box>
                        <Text fontSize="xs" color={textColor}>First Half</Text>
                        <Text fontSize="lg" fontWeight="bold" color="purple.500">
                          {formatValue(currentTrendData.comparison.first_half_movement_weighted, 1)}%
                        </Text>
                      </Box>
                      <Box>
                        <Text fontSize="xs" color={textColor}>Second Half</Text>
                        <Text fontSize="lg" fontWeight="bold" color="purple.500">
                          {formatValue(currentTrendData.comparison.second_half_movement_weighted, 1)}%
                        </Text>
                      </Box>
                    </SimpleGrid>
                    <Text fontSize="sm" fontWeight="medium" color={currentTrendData.comparison.movement_weighted_difference > 0 ? 'green.500' : 'red.500'} mt={2}>
                      {currentTrendData.comparison.movement_weighted_difference > 0 ? '+' : ''}{formatValue(currentTrendData.comparison.movement_weighted_difference, 1)}% change
                    </Text>
                  </Box>
                </SimpleGrid>
              </Box>
            )}
          </Box>
        </VStack>
    )
};

export default TrendsSection;