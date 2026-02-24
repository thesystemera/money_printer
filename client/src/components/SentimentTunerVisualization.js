import React, { memo, useMemo, useState } from 'react';
import {
  Box, Text, Flex, Modal, ModalOverlay, ModalContent,
  ModalHeader, ModalCloseButton, ModalBody, VStack, Badge, Grid, GridItem,
  Table, Thead, Tbody, Tr, Th, Td, Button, HStack
} from '@chakra-ui/react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

const normalizeLagDistributionForVisualization = (lagDistribution) => {
    const MIN_LAG = 0.5;
    const MAX_LAG = 18.0;
    const LAG_INCREMENT = 0.25;

    const normalizedDistribution = {};

    for (let lag = MIN_LAG; lag <= MAX_LAG; lag += LAG_INCREMENT) {
        const roundedLag = Math.round(lag * 4) / 4;
        const lagKey = roundedLag.toFixed(2);

        if (lagDistribution && lagDistribution[roundedLag]) {
            const correlations = lagDistribution[roundedLag];
            normalizedDistribution[lagKey] = Array.isArray(correlations) ? correlations : [correlations];
        } else {
            normalizedDistribution[lagKey] = [];
        }
    }

    return normalizedDistribution;
};

const LagDistributionChart = memo(({ lagDistribution, title }) => {
  const { chartData, maxCorrelation } = useMemo(() => {
    const normalized = normalizeLagDistributionForVisualization(lagDistribution);

    const data = Object.entries(normalized)
      .map(([lag, correlations]) => {
        const corrArray = Array.isArray(correlations) ? correlations : [correlations];
        const validCorrelations = corrArray.filter(c => c > 0);

        return {
          lag: parseFloat(lag),
          max: validCorrelations.length > 0 ? Math.max(...validCorrelations) : 0,
          mean: validCorrelations.length > 0
            ? validCorrelations.reduce((a, b) => a + b, 0) / validCorrelations.length
            : 0,
          min: validCorrelations.length > 0 ? Math.min(...validCorrelations) : 0,
          count: validCorrelations.length,
          lagLabel: `${parseFloat(lag).toFixed(1)}h`
        };
      })
      .sort((a, b) => a.lag - b.lag);

    const max = data.reduce((acc, curr) => Math.max(acc, curr.max), 0);

    return { chartData: data, maxCorrelation: max };
  }, [lagDistribution]);

  if (!chartData.length) return (
      <Box h="100%" display="flex" flexDirection="column">
        <Text fontSize="sm" fontWeight="bold" mb={2} color="white">{title}</Text>
        <Flex flex="1" align="center" justify="center" bg="gray.700" borderRadius="md">
            <Text fontSize="xs" color="gray.400">No data available</Text>
        </Flex>
    </Box>
  );

  const yAxisMax = maxCorrelation > 0 ? maxCorrelation * 1.1 : 0.1;

  return (
    <Box h="100%" display="flex" flexDirection="column" minH="0">
      <Text fontSize="sm" fontWeight="bold" mb={2} color="white">
        {title}
      </Text>
      <Box flex="1" minH="0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
            <XAxis
              dataKey="lagLabel"
              stroke="#A0AEC0"
              fontSize={10}
              interval={Math.ceil(chartData.length / 10)}
              angle={-45}
              textAnchor="end"
              height={40}
              domain={[0.5, 18]}
            />
            <YAxis
              stroke="#A0AEC0"
              fontSize={10}
              domain={[0, yAxisMax]}
              tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(26, 32, 44, 0.9)',
                border: '1px solid #4A5568',
                fontSize: '12px'
              }}
              labelFormatter={(value) => `Lag: ${value}`}
              formatter={(value, name) => {
                if (name === 'Range') return [`${(value * 100).toFixed(1)}%`, 'Max'];
                if (name === 'Average') return [`${(value * 100).toFixed(1)}%`, 'Mean'];
                return [`${(value * 100).toFixed(1)}%`, name];
              }}
            />
            <Bar dataKey="max" fill="#48BB78" opacity={0.3} name="Range"/>
            <Bar dataKey="mean" stackId="overlay" fill="#4299E1" opacity={0.9} name="Average"/>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
});

const addDataGaps = (data, gapThresholdMs = 5 * 60 * 1000) => {
  if (!data || data.length < 2) return data;

  const result = [];

  for (let i = 0; i < data.length; i++) {
    result.push(data[i]);

    if (i < data.length - 1) {
      const timeDiff = data[i + 1].timestamp - data[i].timestamp;
      if (timeDiff > gapThresholdMs) {
        result.push({
          timestamp: data[i].timestamp + 1000,
          price_signal: null,
          optimal_sentiment: null,
          current_sentiment: null,
          optimal_stock: null,
          optimal_market: null,
          optimal_industry: null,
        });
        result.push({
          timestamp: data[i + 1].timestamp - 1000,
          price_signal: null,
          optimal_sentiment: null,
          current_sentiment: null,
          optimal_stock: null,
          optimal_market: null,
          optimal_industry: null,
        });
      }
    }
  }

  return result;
};

export const TunerComparisonModal = memo(({ isOpen, onClose, data }) => {
  const [visibleLines, setVisibleLines] = useState({
    price_signal: true,
    current_sentiment: true,
    optimal_sentiment: true,
    optimal_stock: true,
    optimal_market: true,
    optimal_industry: true
  });

  const toggleLine = (key) => {
    setVisibleLines(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const { processedData, dailyTicks } = useMemo(() => {
    if (!data || !data.timeGrid || !data.targetPriceCurve || !data.optimalSentimentCurve || !data.currentSentimentCurve) {
        return { processedData: null, dailyTicks: [] };
    }

    const rawData = data.timeGrid.map((ts, i) => ({
        timestamp: ts,
        price_signal: data.targetPriceCurve[i],
        optimal_sentiment: data.optimalSentimentCurve[i],
        current_sentiment: data.currentSentimentCurve[i],
        optimal_stock: data.optimalStockCurve ? data.optimalStockCurve[i] : null,
        optimal_market: data.optimalMarketCurve ? data.optimalMarketCurve[i] : null,
        optimal_industry: data.optimalIndustryCurve ? data.optimalIndustryCurve[i] : null,
    }));

    const processed = addDataGaps(rawData);

    const ticks = [];
    if (processed?.length > 0) {
        const startTime = processed[0].timestamp;
        const endTime = processed[processed.length - 1].timestamp;
        let currentTick = new Date(startTime);
        currentTick.setHours(12, 0, 0, 0);

        while (currentTick.getTime() <= endTime) {
            ticks.push(currentTick.getTime());
            currentTick.setDate(currentTick.getDate() + 1);
        }
    }

    return { processedData: processed, dailyTicks: ticks };
  }, [data]);

  if (!data || !processedData) return null;

  const correlationData = data?.correlationComparison || {};
  const lagDistribution = data?.lagDistribution || {};
  const stockLagDistribution = data?.stockLagDistribution || {};
  const marketLagDistribution = data?.marketLagDistribution || {};
  const industryLagDistribution = data?.industryLagDistribution || {};
  const perBucketLagStats = data?.perBucketStats || {};
  const bestParams = data?.bestParams || {};

  const legendItems = [
    { key: 'price_signal', label: 'Price Signal (Normalized)', color: '#E53E3E' },
    { key: 'current_sentiment', label: 'Current Settings', color: '#F6E05E' },
    { key: 'optimal_sentiment', label: 'Optimized Blend', color: '#A78BFA' },
    { key: 'optimal_stock', label: 'Tuned Stock', color: '#3182CE', show: !!data.optimalStockCurve },
    { key: 'optimal_market', label: 'Tuned Market', color: '#D53F8C', show: !!data.optimalMarketCurve },
    { key: 'optimal_industry', label: 'Tuned Industry', color: '#38A169', show: !!data.optimalIndustryCurve }
  ].filter(item => item.show !== false);

return (
    <Modal isOpen={isOpen} onClose={onClose} size="full">
      <ModalOverlay />
      <ModalContent bg="gray.800" color="white" h="100vh" w="100vw" maxW="100vw" maxH="100vh" m={0} borderRadius={0}>
        <ModalHeader flexShrink={0} borderBottom="1px solid" borderColor="gray.600">
          <Flex align="center" justify="space-between">
            <Text>Sentiment Tuning Analysis</Text>
            <Flex align="center" gap={4}>
              {correlationData.original !== undefined && (
                <Badge colorScheme="gray" fontSize="sm">
                  Original: {(correlationData.original * 100).toFixed(1)}%
                </Badge>
              )}
              {correlationData.optimized !== undefined && (
                <Badge colorScheme="green" fontSize="sm">
                  Optimized: {(correlationData.optimized * 100).toFixed(1)}%
                </Badge>
              )}
              {correlationData.improvement !== undefined && (
                <Badge colorScheme="blue" fontSize="sm">
                  Improvement: +{(correlationData.improvement * 100).toFixed(1)}%
                </Badge>
              )}
            </Flex>
          </Flex>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody p={6} overflow="hidden" h="calc(100vh - 120px)" display="flex" flexDirection="column">
          <Grid templateColumns={{ base: "1fr", lg: "2fr 1fr" }} gap={6} h="100%" overflow="hidden">
            <GridItem display="flex" flexDirection="column" overflow="hidden">
              <Box flex="2" minH="0" pb={4} display="flex" flexDirection="column">
                <Flex justify="space-between" align="center" mb={4}>
                  <Text fontSize="lg" fontWeight="bold">Signal Comparison</Text>
                  <HStack spacing={2} flexWrap="wrap">
                    {legendItems.map(item => (
                      <Button
                        key={item.key}
                        size="xs"
                        onClick={() => toggleLine(item.key)}
                        bg={visibleLines[item.key] ? item.color : 'gray.600'}
                        color="white"
                        opacity={visibleLines[item.key] ? 1 : 0.5}
                        _hover={{ opacity: 0.8 }}
                        fontWeight={visibleLines[item.key] ? 'bold' : 'normal'}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </HStack>
                </Flex>
                <Box flex="1" minH="0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={processedData} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                      <XAxis
                        dataKey="timestamp"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        ticks={dailyTicks}
                        tickFormatter={(unixTime) => new Date(unixTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        stroke="#A0AEC0"
                      />
                      <YAxis domain={[-1, 1]} stroke="#A0AEC0" />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'rgba(26, 32, 44, 0.9)', border: '1px solid #4A5568' }}
                        labelFormatter={(unixTime) => new Date(unixTime).toLocaleString()}
                      />
                      {visibleLines.price_signal && (
                        <Line type="monotone" dataKey="price_signal" stroke="#E53E3E" name="Price Signal (Normalized)" dot={false} connectNulls={false} strokeWidth={2}/>
                      )}
                      {visibleLines.current_sentiment && (
                        <Line type="monotone" dataKey="current_sentiment" stroke="#F6E05E" name="Current Settings" dot={false} strokeWidth={2} connectNulls={false}/>
                      )}
                      {visibleLines.optimal_sentiment && (
                        <Line type="monotone" dataKey="optimal_sentiment" stroke="#A78BFA" name="Optimized Blend" dot={false} strokeWidth={3} connectNulls={false}/>
                      )}
                      {data.optimalStockCurve && visibleLines.optimal_stock && (
                        <Line type="monotone" dataKey="optimal_stock" stroke="#3182CE" name="Tuned Stock" dot={false} strokeWidth={1.5} connectNulls={false} strokeDasharray="3 3"/>
                      )}
                      {data.optimalMarketCurve && visibleLines.optimal_market && (
                        <Line type="monotone" dataKey="optimal_market" stroke="#D53F8C" name="Tuned Market" dot={false} strokeWidth={1.5} connectNulls={false} strokeDasharray="3 3"/>
                      )}
                      {data.optimalIndustryCurve && visibleLines.optimal_industry && (
                        <Line type="monotone" dataKey="optimal_industry" stroke="#38A169" name="Tuned Industry" dot={false} strokeWidth={1.5} connectNulls={false} strokeDasharray="3 3"/>
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              </Box>
              <Box flex="1" minH="0">
                  <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={4} h="100%">
                      <GridItem><LagDistributionChart lagDistribution={lagDistribution} title="Master Lag Distribution" /></GridItem>
                      <GridItem><LagDistributionChart lagDistribution={stockLagDistribution} title="Stock Lag Distribution" /></GridItem>
                      <GridItem><LagDistributionChart lagDistribution={marketLagDistribution} title="Market Lag Distribution" /></GridItem>
                      <GridItem><LagDistributionChart lagDistribution={industryLagDistribution} title="Industry Lag Distribution" /></GridItem>
                  </Grid>
                  <Text fontSize="xs" color="gray.400" mt={2} textAlign="center">
                      Lag Distribution (Sentiment leads price by X hours). Positive values mean sentiment precede price movement.
                  </Text>
              </Box>
            </GridItem>
            <GridItem overflow="auto">
                <VStack align="stretch" spacing={4}>
                    <Text fontSize="lg" fontWeight="bold">Performance Metrics</Text>
                    {correlationData.original !== undefined && correlationData.optimized !== undefined && (
                        <Box p={4} bg="gray.700" borderRadius="md" flexShrink={0}>
                            <Text fontSize="md" fontWeight="bold" mb={3}>Correlation Analysis</Text>
                            <VStack align="stretch" spacing={2}>
                                <Flex justify="space-between"><Text>Original Correlation:</Text><Badge colorScheme="gray">{(correlationData.original * 100).toFixed(2)}%</Badge></Flex>
                                <Flex justify="space-between"><Text>Optimized Correlation:</Text><Badge colorScheme="green">{(correlationData.optimized * 100).toFixed(2)}%</Badge></Flex>
                                <Flex justify="space-between"><Text>Improvement:</Text><Badge colorScheme="blue">+{ (correlationData.improvement * 100).toFixed(2)}%</Badge></Flex>
                            </VStack>
                        </Box>
                    )}
                    {data?.optimalLag !== undefined && (
                        <Box p={4} bg="gray.700" borderRadius="md" flexShrink={0}>
                            <Text fontSize="md" fontWeight="bold" mb={2}>Optimal Timing</Text>
                            <Text fontSize="sm" color="gray.300">
                                Sentiment leads price by <Text as="span" fontWeight="bold" color="blue.300">{Math.abs(data.optimalLag).toFixed(2)} hours</Text>
                            </Text>
                        </Box>
                    )}
                    {Object.keys(perBucketLagStats).length > 0 && (
                        <Box p={4} bg="gray.700" borderRadius="md" flexShrink={0}>
                            <Text fontSize="md" fontWeight="bold" mb={3}>Per-Channel Performance</Text>
                            <Box overflowX="auto">
                                <Table size="sm" variant="simple">
                                    <Thead>
                                        <Tr><Th>Channel</Th><Th isNumeric>Original</Th><Th isNumeric>Tuned</Th><Th isNumeric>Gain</Th><Th isNumeric>Lag (h)</Th></Tr>
                                    </Thead>
                                    <Tbody>
                                        {Object.entries(perBucketLagStats).map(([bucket, stats]) => {
                                            const improvement = stats.tunedCorrelation - stats.originalCorrelation;
                                            const improvementColor = improvement >= 0 ? "green.300" : "red.300";
                                            return (
                                                <Tr key={bucket}>
                                                    <Td textTransform="capitalize">{bucket}</Td>
                                                    <Td isNumeric>{(stats.originalCorrelation * 100).toFixed(1)}%</Td>
                                                    <Td isNumeric fontWeight="bold">{(stats.tunedCorrelation * 100).toFixed(1)}%</Td>
                                                    <Td isNumeric color={improvementColor}>{`${improvement >= 0 ? '+' : ''}${(improvement * 100).toFixed(1)}%`}</Td>
                                                    <Td isNumeric>{stats.tunedLag?.toFixed(2)}</Td>
                                                </Tr>
                                            );
                                        })}
                                    </Tbody>
                                </Table>
                            </Box>
                        </Box>
                    )}
                    {bestParams.stock_params && (
                        <Box p={4} bg="gray.700" borderRadius="md" flexShrink={0}>
                            <Text fontSize="md" fontWeight="bold" mb={3}>Optimal Core Parameters</Text>
                            <Box overflowX="auto">
                                <Table size="sm" variant="simple">
                                    <Thead>
                                        <Tr><Th>Parameter</Th><Th isNumeric>Stock</Th><Th isNumeric>Market</Th><Th isNumeric>Industry</Th></Tr>
                                    </Thead>
                                    <Tbody>
                                        <Tr>
                                            <Td>Sentiment Window (hr)</Td>
                                            <Td isNumeric>{(bestParams.stock_params.sentimentWindowMs / 3600000).toFixed(1)}</Td>
                                            <Td isNumeric>{(bestParams.market_params.sentimentWindowMs / 3600000).toFixed(1)}</Td>
                                            <Td isNumeric>{(bestParams.industry_params.sentimentWindowMs / 3600000).toFixed(1)}</Td>
                                        </Tr>
                                        <Tr>
                                            <Td>Price Window (min)</Td>
                                            <Td isNumeric>{(bestParams.stock_params.priceWindowMs / 60000).toFixed(0)}</Td>
                                            <Td isNumeric>{(bestParams.market_params.priceWindowMs / 60000).toFixed(0)}</Td>
                                            <Td isNumeric>{(bestParams.industry_params.priceWindowMs / 60000).toFixed(0)}</Td>
                                        </Tr>
                                        <Tr>
                                            <Td>Trend Factor</Td>
                                            <Td isNumeric>{bestParams.stock_params.trendFactor.toFixed(2)}</Td>
                                            <Td isNumeric>{bestParams.market_params.trendFactor.toFixed(2)}</Td>
                                            <Td isNumeric>{bestParams.industry_params.trendFactor.toFixed(2)}</Td>
                                        </Tr>
                                        <Tr>
                                            <Td>Energy Factor</Td>
                                            <Td isNumeric>{bestParams.stock_params.energyFactor.toFixed(2)}</Td>
                                            <Td isNumeric>{bestParams.market_params.energyFactor.toFixed(2)}</Td>
                                            <Td isNumeric>{bestParams.industry_params.energyFactor.toFixed(2)}</Td>
                                        </Tr>
                                    </Tbody>
                                </Table>
                            </Box>
                            {bestParams.blend_price_window_ms && (
                                <Flex justify="space-between" align="center" mt={3} p={2} bg="gray.600" borderRadius="md">
                                    <Text fontSize="sm" fontWeight="bold">Master Blend Price Window:</Text>
                                    <Badge colorScheme="cyan">{(bestParams.blend_price_window_ms / 60000).toFixed(0)} min</Badge>
                                </Flex>
                            )}
                        </Box>
                    )}
                </VStack>
            </GridItem>
          </Grid>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
});