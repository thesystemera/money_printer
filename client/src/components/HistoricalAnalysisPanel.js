import React, { useMemo, useEffect, useState } from 'react';
import { Box, Text, Flex, SimpleGrid, useColorMode, Spinner, Alert, AlertIcon } from '@chakra-ui/react';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend, LabelList } from 'recharts';
import { COLORS, MARKET_INDICES } from '../config/Config';
import { fetchMarketData } from '../services/apiService';

const HISTORICAL_BASELINE = { HISTORICAL_YEARS_BACK: 2 };

const formatPrice = (price) => {
  if (price === null || price === undefined || isNaN(price)) return 'N/A';
  return `$${Number(price).toFixed(2)}`;
};

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

const extractTimestamp = (item) => {
  if (!item) return null;
  if (item.timestamp) {
    const ts = new Date(item.timestamp);
    if (!isNaN(ts.getTime())) return ts.getTime();
  }
  if (item.date) {
    const ts = new Date(item.date);
    if (!isNaN(ts.getTime())) return ts.getTime();
  }
  return null;
};

const MetricCard = ({ title, value, change, color = "gray" }) => {
  const { colorMode } = useColorMode();

  return (
    <Box
      p={2}
      bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'}
      borderRadius="md"
      border="1px solid"
      borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'}
      textAlign="center"
      minH="60px"
    >
      <Text fontSize="xs" color="gray.500" mb={1}>{title}</Text>
      <Text fontSize="sm" fontWeight="bold" color={`${color}.400`}>
        {value}
      </Text>
      {change !== undefined && (
        <Text fontSize="xs" color={change >= 0 ? 'green.400' : 'red.400'} fontWeight="bold">
          {change > 0 ? '+' : ''}{formatPercent(change)}
        </Text>
      )}
    </Box>
  );
};

const calculateMetrics = (stockData, indexData) => {
  if (!stockData || stockData.length === 0) return {};

  const stockPoints = stockData.map(item => ({
    timestamp: extractTimestamp(item),
    price: extractPrice(item),
    volume: extractVolume(item)
  })).filter(point => point.timestamp && point.price !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  const indexPoints = indexData ? indexData.map(item => ({
    timestamp: extractTimestamp(item),
    price: extractPrice(item)
  })).filter(point => point.timestamp && point.price !== null)
    .sort((a, b) => a.timestamp - b.timestamp) : [];

  if (stockPoints.length === 0) return {};

  const stockPrices = stockPoints.map(p => p.price);
  const stockVolumes = stockPoints.map(p => p.volume).filter(v => v !== null);

  const firstPrice = stockPrices[0];
  const lastPrice = stockPrices[stockPrices.length - 1];
  const highPrice = Math.max(...stockPrices);
  const lowPrice = Math.min(...stockPrices);
  const totalReturn = firstPrice ? ((lastPrice - firstPrice) / firstPrice * 100) : 0;
  const avgVolume = stockVolumes.length > 0 ? stockVolumes.reduce((sum, v) => sum + v, 0) / stockVolumes.length : 0;

  const stockReturns = [];
  for (let i = 1; i < stockPoints.length; i++) {
    const prevPrice = stockPoints[i - 1].price;
    const currPrice = stockPoints[i].price;
    if (prevPrice > 0) {
      stockReturns.push((currPrice - prevPrice) / prevPrice * 100);
    }
  }

  let stockVolatility = 0;
  if (stockReturns.length > 1) {
    const meanReturn = stockReturns.reduce((sum, r) => sum + r, 0) / stockReturns.length;
    const variance = stockReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / stockReturns.length;
    stockVolatility = Math.sqrt(variance);
  }

  let indexTotalReturn = 0;
  let indexVolatility = 0;
  let correlation = 0;

  if (indexPoints.length > 0) {
    const indexPrices = indexPoints.map(p => p.price);
    const firstIndexPrice = indexPrices[0];
    const lastIndexPrice = indexPrices[indexPrices.length - 1];
    indexTotalReturn = firstIndexPrice ? ((lastIndexPrice - firstIndexPrice) / firstIndexPrice * 100) : 0;

    const indexReturns = [];
    for (let i = 1; i < indexPoints.length; i++) {
      const prevPrice = indexPoints[i - 1].price;
      const currPrice = indexPoints[i].price;
      if (prevPrice > 0) {
        indexReturns.push((currPrice - prevPrice) / currPrice * 100);
      }
    }

    if (indexReturns.length > 1) {
      const meanReturn = indexReturns.reduce((sum, r) => sum + r, 0) / indexReturns.length;
      const variance = indexReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / indexReturns.length;
      indexVolatility = Math.sqrt(variance);
    }

    if (stockReturns.length > 1 && indexReturns.length > 1) {
      const minLength = Math.min(stockReturns.length, indexReturns.length);
      const stockMean = stockReturns.slice(0, minLength).reduce((sum, r) => sum + r, 0) / minLength;
      const indexMean = indexReturns.slice(0, minLength).reduce((sum, r) => sum + r, 0) / minLength;

      let numerator = 0;
      let stockVariance = 0;
      let indexVariance = 0;

      for (let i = 0; i < minLength; i++) {
        const stockDiff = stockReturns[i] - stockMean;
        const indexDiff = indexReturns[i] - indexMean;
        numerator += stockDiff * indexDiff;
        stockVariance += stockDiff * stockDiff;
        indexVariance += indexDiff * indexDiff;
      }

      const denominator = Math.sqrt(stockVariance * indexVariance);
      correlation = denominator > 0 ? numerator / denominator : 0;
    }
  }

  return {
    stock: {
      totalReturn,
      currentPrice: lastPrice,
      highPrice,
      lowPrice,
      avgVolume,
      volatility: stockVolatility,
      periods: stockPoints.length
    },
    index: {
      totalReturn: indexTotalReturn,
      volatility: indexVolatility
    },
    correlation,
    outperformance: totalReturn - indexTotalReturn
  };
};

const processChartData = (stockHistoricalData, indexHistoricalData) => {
  if (!stockHistoricalData || stockHistoricalData.length === 0) return [];

  const stockPoints = stockHistoricalData.map(item => ({
    timestamp: extractTimestamp(item),
    price: extractPrice(item),
    volume: extractVolume(item)
  })).filter(point => point.timestamp && point.price !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-504);

  const indexMap = new Map();
  if (indexHistoricalData && indexHistoricalData.length > 0) {
    indexHistoricalData.forEach(item => {
      const timestamp = extractTimestamp(item);
      const price = extractPrice(item);
      if (timestamp && price !== null) {
        const dateKey = new Date(timestamp).toISOString().split('T')[0];
        indexMap.set(dateKey, price);
      }
    });
  }

  if (stockPoints.length === 0) return [];

  const baseStockPrice = stockPoints[0].price;
  const firstIndexPrice = indexMap.size > 0 ? Array.from(indexMap.values())[0] : null;

  const volumes = stockPoints.map(p => p.volume).filter(v => v !== null && v > 0);
  const maxVolume = volumes.length > 0 ? Math.max(...volumes) : 0;

  return stockPoints.map((point, index) => {
    const date = new Date(point.timestamp);
    const dateKey = date.toISOString().split('T')[0];
    const indexPrice = indexMap.get(dateKey);

    const stockReturn = ((point.price - baseStockPrice) / baseStockPrice * 100);
    const indexReturn = (indexPrice && firstIndexPrice) ? ((indexPrice - firstIndexPrice) / firstIndexPrice * 100) : null;

    const isQuarterEnd = index % 63 === 0 && index > 0;

    return {
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      timestamp: point.timestamp,
      stockPrice: point.price,
      stockReturn: stockReturn,
      indexPrice: indexPrice || null,
      indexReturn: indexReturn,
      volume: point.volume || 0,
      volumeNormalized: point.volume ? (point.volume / maxVolume) * 100 : 0,
      showLabel: isQuarterEnd,
      stockPriceLabel: isQuarterEnd ? `$${point.price.toFixed(0)}` : null,
      indexPriceLabel: isQuarterEnd && indexPrice ? `$${indexPrice.toFixed(0)}` : null,
      stockReturnLabel: isQuarterEnd ? `${stockReturn.toFixed(1)}%` : null,
      indexReturnLabel: isQuarterEnd && indexReturn ? `${indexReturn.toFixed(1)}%` : null
    };
  });
};

const getCorrelationLabel = (corr) => {
  const absCorr = Math.abs(corr);
  if (absCorr < 0.3) return 'Weak';
  if (absCorr < 0.7) return 'Moderate';
  return 'Strong';
};

const getVolatilityLabel = (vol) => {
  if (vol < 2) return 'Low';
  if (vol < 5) return 'Moderate';
  if (vol < 8) return 'High';
  return 'Very High';
};

const HistoricalAnalysisPanel = React.memo(({
  selectedMarketIndex,
  companyInfo,
  captureRef,
  onRenderComplete
}) => {
  const { colorMode } = useColorMode();
  const [panelData, setPanelData] = useState({
      stockHistorical: [],
      indexHistorical: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!companyInfo?.symbol || !selectedMarketIndex) {
      return;
    }

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const promises = [
          fetchMarketData(companyInfo.symbol, "stock", "historical", HISTORICAL_BASELINE.HISTORICAL_YEARS_BACK),
          fetchMarketData(selectedMarketIndex, "index", "historical", HISTORICAL_BASELINE.HISTORICAL_YEARS_BACK)
        ];

        const [stockHistoricalRes, indexHistoricalRes] = await Promise.all(promises);

        setPanelData({
          stockHistorical: stockHistoricalRes?.prices || [],
          indexHistorical: indexHistoricalRes?.prices || []
        });

      } catch (err) {
        setError("Failed to fetch historical analysis data. " + err.message);
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [companyInfo?.symbol, selectedMarketIndex]);

  const chartData = useMemo(() => {
    return processChartData(panelData.stockHistorical, panelData.indexHistorical);
  }, [panelData.stockHistorical, panelData.indexHistorical]);

  const metrics = useMemo(() => {
    return calculateMetrics(panelData.stockHistorical, panelData.indexHistorical);
  }, [panelData.stockHistorical, panelData.indexHistorical]);

  useEffect(() => {
    if (onRenderComplete && !isLoading && !error) {
      onRenderComplete();
    }
  }, [onRenderComplete, isLoading, error]);

  if (isLoading) {
    return (
      <Flex justify="center" align="center" minH="400px" ref={captureRef}>
        <Spinner size="xl" />
      </Flex>
    );
  }

  if (error) {
    return (
      <Box ref={captureRef}>
        <Alert status="error">
            <AlertIcon />
            {error}
        </Alert>
      </Box>
    );
  }

  if (chartData.length === 0) {
    return (
      <Box p={4} textAlign="center" ref={captureRef}>
        <Text color="gray.500">No historical data available</Text>
      </Box>
    );
  }

  const indexName = MARKET_INDICES.INFO[selectedMarketIndex]?.name || 'NASDAQ-100';
  const indexColor = MARKET_INDICES.INFO[selectedMarketIndex]?.color || COLORS.info;

  return (
    <Box p={3} ref={captureRef}>
      <Text fontSize="lg" fontWeight="bold" mb={3} textAlign="center">
        {companyInfo?.name || 'Stock'} ({companyInfo?.symbol || ''}) - Historical Performance Analysis
      </Text>

      <SimpleGrid columns={{ base: 3, md: 9 }} spacing={2} mb={4}>
        <MetricCard
          title="Total Return"
          value={formatPercent(metrics.stock?.totalReturn || 0)}
          color={metrics.stock?.totalReturn >= 0 ? "green" : "red"}
        />
        <MetricCard
          title="vs Market"
          value={formatPercent(metrics.outperformance || 0)}
          color={metrics.outperformance >= 0 ? "green" : "red"}
        />
        <MetricCard
          title={metrics.outperformance >= 0 ? 'Outperforming' : 'Underperforming'}
          value={`by ${formatPercent(Math.abs(metrics.outperformance || 0))}`}
          color={metrics.outperformance >= 0 ? "green" : "red"}
        />
        <MetricCard
          title="Current"
          value={formatPrice(metrics.stock?.currentPrice || 0)}
          color="blue"
        />
        <MetricCard
          title="High"
          value={formatPrice(metrics.stock?.highPrice || 0)}
          color="green"
        />
        <MetricCard
          title="Low"
          value={formatPrice(metrics.stock?.lowPrice || 0)}
          color="red"
        />
        <MetricCard
          title="Volatility"
          value={`${formatPercent(metrics.stock?.volatility || 0)} (${getVolatilityLabel(metrics.stock?.volatility || 0)})`}
          color="orange"
        />
        <MetricCard
          title="Avg Volume"
          value={formatVolume(metrics.stock?.avgVolume || 0)}
          color="purple"
        />
        <MetricCard
          title="Correlation"
          value={`${formatPercent((metrics.correlation || 0) * 100)} (${getCorrelationLabel(metrics.correlation || 0)})`}
          color="cyan"
        />
      </SimpleGrid>

      <Box
        p={1}
        bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'}
        borderRadius="md"
        border="1px solid"
        borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'}
        mb={4}
      >
        <Box height="450px" bg="black" borderRadius="md">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 15, right: 40, left: 15, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colorMode === 'dark' ? '#4A5568' : '#E2E8F0'} />

              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: colorMode === 'dark' ? '#A0AEC0' : '#4A5568' }}
                interval={Math.max(1, Math.floor(chartData.length / 20))}
              />

              <YAxis
                yAxisId="stockPrice"
                orientation="left"
                tick={{ fontSize: 9, fill: COLORS.stockPrice }}
                tickFormatter={(value) => `${value.toFixed(0)}`}
                tickCount={10}
              />

              <YAxis
                yAxisId="indexPrice"
                orientation="right"
                tick={{ fontSize: 9, fill: indexColor }}
                tickFormatter={(value) => `${value.toFixed(0)}`}
                tickCount={10}
              />

              <YAxis
                yAxisId="volume"
                orientation="right"
                domain={[0, 100]}
                tick={{ fontSize: 8, fill: COLORS.volume }}
                tickFormatter={(value) => `${value}%`}
                axisLine={{ stroke: COLORS.volume }}
                tickLine={{ stroke: COLORS.volume }}
                ticks={[0, 20, 40, 60, 80, 100]}
              />

              <YAxis
                yAxisId="return"
                hide
                domain={['dataMin - 5', 'dataMax + 5']}
              />

              <Legend
                wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                iconType="line"
              />

              <Bar
                yAxisId="volume"
                dataKey="volumeNormalized"
                fill={COLORS.volume}
                opacity={0.3}
                name="Volume"
              />

              <Line
                yAxisId="stockPrice"
                type="monotone"
                dataKey="stockPrice"
                stroke={COLORS.stockPrice}
                strokeWidth={2}
                dot={false}
                name={`${companyInfo?.symbol || 'Stock'} Price`}
              >
                <LabelList
                  dataKey="stockPriceLabel"
                  position="top"
                  fontSize={10}
                  fill="white"
                  fontWeight="bold"
                />
              </Line>

              {chartData.some(d => d.indexPrice) && (
                <Line
                  yAxisId="indexPrice"
                  type="monotone"
                  dataKey="indexPrice"
                  stroke={indexColor}
                  strokeWidth={2}
                  dot={false}
                  name={`${indexName} Price`}
                >
                  <LabelList
                    dataKey="indexPriceLabel"
                    position="bottom"
                    fontSize={10}
                    fill="white"
                    fontWeight="bold"
                  />
                </Line>
              )}

              <Line
                yAxisId="return"
                type="monotone"
                dataKey="stockReturn"
                stroke={COLORS.positive}
                strokeWidth={2}
                strokeDasharray="2 2"
                dot={false}
                name={`${companyInfo?.symbol || 'Stock'} Return %`}
              >
                <LabelList
                  dataKey="stockReturnLabel"
                  position="top"
                  fontSize={9}
                  fill="white"
                  fontWeight="bold"
                />
              </Line>

              {chartData.some(d => d.indexReturn !== null) && (
                <Line
                  yAxisId="return"
                  type="monotone"
                  dataKey="indexReturn"
                  stroke={COLORS.warning}
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  dot={false}
                  name={`${indexName} Return %`}
                >
                  <LabelList
                    dataKey="indexReturnLabel"
                    position="bottom"
                    fontSize={9}
                    fill="white"
                    fontWeight="bold"
                  />
                </Line>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      </Box>

      <Text fontSize="xs" textAlign="center" color="gray.500" mb={4}>
        Analysis: {metrics.stock?.periods || 0} trading days •
        Stock: {formatPercent(metrics.stock?.totalReturn || 0)} total return •
        {indexName}: {formatPercent(metrics.index?.totalReturn || 0)} total return •
        Outperformance: {formatPercent(metrics.outperformance || 0)} •
        Volatility: {formatPercent(metrics.stock?.volatility || 0)} daily •
        Correlation: {formatPercent((metrics.correlation || 0) * 100)}
      </Text>
    </Box>
  );
});

export default HistoricalAnalysisPanel;