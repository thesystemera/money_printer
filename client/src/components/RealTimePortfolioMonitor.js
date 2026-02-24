import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Flex, Text, Button, Badge, useColorMode, Spinner,
  IconButton, useToast, Tooltip
} from '@chakra-ui/react';
import { RefreshCw, Clock, AlertTriangle, Eye } from 'lucide-react';
import { fetchMarketData } from '../services/apiService';
import { showToast, handleError, addLog } from '../services/socketService';
import { PredictionChart } from './RecommendationPredictionChart';
import { PredictionDataAdapter, getRecommendationColor } from './RecommendationHelper';
import { PORTFOLIO, REFRESH_INTERVALS } from '../config/Config';
import { TimeElapsedBadge } from './PortfolioPanel';

const RealTimePortfolioMonitor = ({ portfolioRecommendation, onCardClick }) => {
  const [portfolioMonitorStocksData, setPortfolioMonitorStocksData] = useState({});
  const [portfolioMonitorIsLoading, setPortfolioMonitorIsLoading] = useState(false);
  const [portfolioMonitorLastRefresh, setPortfolioMonitorLastRefresh] = useState(null);

  const portfolioMonitorActiveRequests = useRef(new Set());
  const portfolioMonitorActiveFetches = useRef(0);
  const { colorMode } = useColorMode();
  const toast = useToast();

  const getUniqueStocks = useCallback(() => {
    if (!portfolioRecommendation) return [];

    const stockMap = new Map();
    [
      ...(portfolioRecommendation.topOpportunities || []).map(stock => ({ ...stock, action: 'BUY' })),
      ...(portfolioRecommendation.watchlist || []).map(stock => ({ ...stock, action: 'HOLD' })),
      ...(portfolioRecommendation.avoidList || []).map(stock => ({ ...stock, action: 'SELL' }))
    ].forEach(stock => {
      if (stock.symbol && !stockMap.has(stock.symbol)) {
        stockMap.set(stock.symbol, stock);
      }
    });
    return Array.from(stockMap.values());
  }, [portfolioRecommendation]);

  const fetchPortfolioMonitorActualPriceData = useCallback(async (symbol, targetDate, timestamp) => {
    const requestKey = `${symbol}-${targetDate}`;
    if (portfolioMonitorActiveRequests.current.has(requestKey)) {
      return [];
    }

    portfolioMonitorActiveRequests.current.add(requestKey);

    try {
      const targetDateTime = targetDate || timestamp;
      if (!targetDateTime) {
        throw new Error(`No date available for ${symbol}`);
      }

      const formattedDate = targetDateTime.split('T')[0];
      const daysDiff = Math.max(1, Math.ceil((Date.now() - new Date(formattedDate).getTime()) / (1000 * 60 * 60 * 24)) + 1);

      const result = await fetchMarketData(symbol, 'stock', 'recent', daysDiff);
      const pricesArray = result.prices || [];

      const filteredPrices = pricesArray.filter(price =>
        price.timestamp && price.timestamp.split('T')[0] === formattedDate
      );

      if (filteredPrices.length === 0) {
        const warningMessage = `No price data found for ${symbol} on target date ${formattedDate}. API returned ${pricesArray.length} total points.`;
        addLog(warningMessage, 'warning');
        throw new Error(warningMessage);
      }

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
      addLog(`Realtime Portfolio Monitor: Error fetching price data for ${symbol}: ${error.message}`, 'error');
      throw error;
    } finally {
      portfolioMonitorActiveRequests.current.delete(requestKey);
    }
  }, []);

  const _executePriceDataFetching = useCallback(async (stocksToFetch, showToastNotification) => {
    if (stocksToFetch.length === 0) {
      return;
    }

    const processingPromises = stocksToFetch.map(async (stock) => {
      while (portfolioMonitorActiveFetches.current >= PORTFOLIO.MAX_CONCURRENT_FETCHES) {
        await new Promise(resolve => setTimeout(resolve, PORTFOLIO.SEMAPHORE_DELAY_MS));
      }

      portfolioMonitorActiveFetches.current++;

      try {
        const actualPriceData = await fetchPortfolioMonitorActualPriceData(stock.symbol, stock.target_trading_datetime, stock.timestamp);
        return { symbol: stock.symbol, data: { portfolioStock: stock, actualPriceData, lastFetched: new Date(), error: null } };
      } catch (error) {
        const errorMessage = error?.message || (typeof error === 'string' ? error : 'Failed to fetch price data');
        return { symbol: stock.symbol, data: { portfolioStock: stock, actualPriceData: [], error: errorMessage, lastFetched: new Date() } };
      } finally {
        portfolioMonitorActiveFetches.current--;
      }
    });

    const results = await Promise.all(processingPromises);

    setPortfolioMonitorStocksData(prev => {
      const updated = { ...prev };
      results.forEach(({ symbol, data }) => {
        if (data) {
          updated[symbol] = { ...prev[symbol], ...data };
        }
      });
      return updated;
    });

    setPortfolioMonitorLastRefresh(new Date());

    const successfulStocks = results.filter(r => !r.data.error);
    if (showToastNotification && successfulStocks.length > 0) {
      showToast(toast, {
        title: 'Portfolio Price Data Refreshed',
        description: `Updated price data for ${successfulStocks.length} stocks`,
        status: 'success'
      });
    }
  }, [fetchPortfolioMonitorActualPriceData, toast]);

  const refreshAllPortfolioPriceData = useCallback(async (showToastNotification = false) => {
    if (!portfolioRecommendation) return;
    setPortfolioMonitorIsLoading(true);
    try {
      const uniqueStocks = getUniqueStocks();
      const uniqueSymbols = new Set(uniqueStocks.map(s => s.symbol));
      const currentSymbols = Object.keys(portfolioMonitorStocksData);
      const symbolsToRemove = currentSymbols.filter(s => !uniqueSymbols.has(s));

      if (symbolsToRemove.length > 0) {
        setPortfolioMonitorStocksData(prev => {
          const newState = { ...prev };
          symbolsToRemove.forEach(symbol => delete newState[symbol]);
          return newState;
        });
      }

      if (uniqueStocks.length === 0) return;

      await _executePriceDataFetching(uniqueStocks, showToastNotification);
    } catch (error) {
      handleError(error, "Refreshing all stock price data", toast);
    } finally {
      setPortfolioMonitorIsLoading(false);
    }
  }, [portfolioRecommendation, getUniqueStocks, _executePriceDataFetching, toast, portfolioMonitorStocksData]);

  const handlePortfolioMonitorManualRefresh = useCallback(() => {
    portfolioMonitorActiveRequests.current.clear();
    refreshAllPortfolioPriceData(true);
  }, [refreshAllPortfolioPriceData]);

  useEffect(() => {
    if (!portfolioRecommendation) return;

    refreshAllPortfolioPriceData(false);

    const priceInterval = setInterval(() => {
      refreshAllPortfolioPriceData(false);
    }, REFRESH_INTERVALS.PORTFOLIO_MS);

    return () => clearInterval(priceInterval);
  }, [portfolioRecommendation]);

  const stocksToDisplay = React.useMemo(() => {
    if (!portfolioRecommendation) return [];

    const stockOrder = getUniqueStocks().map(s => s.symbol);

    return stockOrder
      .map(symbol => {
          const data = portfolioMonitorStocksData[symbol];
          return data ? [symbol, data] : null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        const actionOrder = { 'BUY': 0, 'HOLD': 1, 'SELL': 2 };
        const aAction = a[1].portfolioStock?.action || 'HOLD';
        const bAction = b[1].portfolioStock?.action || 'HOLD';
        if (actionOrder[aAction] !== actionOrder[bAction]) {
          return actionOrder[aAction] - actionOrder[bAction];
        }
        const aConf = a[1].portfolioStock?.confidence?.[aAction.toLowerCase()] || 0;
        const bConf = b[1].portfolioStock?.confidence?.[bAction.toLowerCase()] || 0;
        return bConf - aConf;
      });
  }, [portfolioMonitorStocksData, portfolioRecommendation, getUniqueStocks]);

  const uniqueStocks = getUniqueStocks();

  return (
    <Box width="100%" p={4} display="flex" flexDirection="column">
      <Flex justify="space-between" mb={4} align="center">
        <Box>
          <Flex align="center" fontSize="xs" color={colorMode === 'dark' ? 'gray.400' : 'gray.600'}>
            <Text mr={1}>Price data refreshed:</Text>
            {portfolioMonitorLastRefresh ? <TimeElapsedBadge timestamp={portfolioMonitorLastRefresh.getTime()} /> : <Text>never</Text>}
          </Flex>
        </Box>
        <Button
          leftIcon={<RefreshCw size={16} />}
          colorScheme="teal"
          size="sm"
          isLoading={portfolioMonitorIsLoading}
          onClick={handlePortfolioMonitorManualRefresh}
        >
          Refresh Prices
        </Button>
      </Flex>

      {portfolioMonitorIsLoading && stocksToDisplay.length === 0 && (
        <Flex justify="center" align="center" py={10}>
          <Spinner mr={3} />
          <Text>Loading price data...</Text>
        </Flex>
      )}

      {!portfolioMonitorIsLoading && uniqueStocks.length === 0 && (
        <Flex
          direction="column" justify="center" align="center" py={10} borderWidth="1px"
          borderRadius="md" borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'}
          bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'}
        >
          <AlertTriangle size={24} color="orange" style={{ marginBottom: '16px' }} />
          <Text>No recommendation data available in your portfolio.</Text>
        </Flex>
      )}

      <Flex direction="column" gap={4}>
        {stocksToDisplay.map(([symbol, data]) => {
          const stock = data.portfolioStock;
          const action = stock?.action || 'UNKNOWN';
          const colorScheme = getRecommendationColor(action);
          const confidenceValue = stock?.confidence?.[action.toLowerCase()] || 0;
          const confidence = Math.round(confidenceValue * 100);

          const allModelPredictions = PredictionDataAdapter.getAllModelPredictions(stock);
          const hasImageAnalysis = allModelPredictions.image?.hourlyPrices?.length > 0;
          const hasOptionsAnalysis = allModelPredictions.options?.hourlyPrices?.length > 0;
          const hasVibeAnalysis = allModelPredictions.vibe?.hourlyPrices?.length > 0;

          return (
            <Box
              key={symbol} borderWidth="1px" borderRadius="md"
              borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'}
              overflow="hidden" borderLeft="3px solid" borderLeftColor={`${colorScheme}.500`}
              bg={colorMode === 'dark' ? 'gray.800' : 'white'} display="flex" flexDirection="column"
            >
              <Flex
                p={3} bg={colorMode === 'dark' ? `${colorScheme}.900` : `${colorScheme}.50`}
                justify="space-between" align="center"
              >
                <Flex align="center">
                  <Text fontSize="lg" fontWeight="bold" mr={2}>${symbol}</Text>
                  <Badge colorScheme={colorScheme} mr={2}>{action}</Badge>
                  <Badge variant="outline" colorScheme={colorScheme}>{confidence}% CONFIDENCE</Badge>
                  {hasImageAnalysis && (<Badge ml={2} colorScheme="pink">Image Analysis</Badge>)}
                  {hasOptionsAnalysis && (<Badge ml={2} colorScheme="cyan">Options Analysis</Badge>)}
                  {hasVibeAnalysis && (<Badge ml={2} colorScheme="orange">Vibe Analysis</Badge>)}
                </Flex>

                <Flex align="center">
                  <TimeElapsedBadge timestamp={data.lastFetched?.getTime()} />
                  <Tooltip label="View cached analysis" hasArrow>
                    <IconButton
                      icon={<Eye size={16} color="white" />} size="sm" variant="solid"
                      bg="blackAlpha.200" _hover={{ bg: 'blackAlpha.400' }}
                      onClick={() => onCardClick(stock)}
                      aria-label="View analysis" ml={2}
                    />
                  </Tooltip>
                  <Tooltip label="Trigger new analysis & recommendation" hasArrow>
                    <IconButton
                      icon={<RefreshCw size={16} color="white" />} size="sm" variant="solid"
                      bg="blackAlpha.200" _hover={{ bg: 'blackAlpha.400' }}
                      onClick={() => onCardClick({ ...stock, forceRefresh: true })}
                      aria-label="Update analysis" ml={2}
                    />
                  </Tooltip>
                </Flex>
              </Flex>

              {(stock.reason || stock.description || stock.summary) && (
                <Box px={4} py={2}>
                  <Text fontSize="sm" color={colorMode === 'dark' ? 'gray.300' : 'gray.600'} noOfLines={1}>
                    {stock.reason || stock.description || stock.summary}
                  </Text>
                </Box>
              )}

              {data.error ? (
                <Box p={4} flex="1">
                  <Flex
                    direction="column" justify="center" align="center" py={4} borderWidth="1px"
                    borderRadius="md" borderColor="red.300" bg={colorMode === 'dark' ? 'red.900' : 'red.50'}
                  >
                    <AlertTriangle size={20} color="red" style={{ marginBottom: '8px' }} />
                    <Text fontSize="sm" color="red.500">{data.error}</Text>
                    <Button
                      mt={3} size="xs" colorScheme="red" leftIcon={<RefreshCw size={12} />}
                      onClick={() => onCardClick({ ...stock, forceRefresh: true })}
                    >
                      Retry Analysis
                    </Button>
                  </Flex>
                </Box>
              ) : (
                <Box p={3} flex="1" minHeight="450px">
                  <PredictionChart
                    activeRecommendation={stock}
                    borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'}
                    textColor={colorMode === 'dark' ? 'gray.400' : 'gray.600'}
                    colorMode={colorMode}
                    highlightBgColor={colorMode === 'dark' ? 'blue.900' : 'blue.50'}
                    actualPriceData={data.actualPriceData || []}
                    isLoadingActualPrices={false}
                  />
                </Box>
              )}
            </Box>
          );
        })}
      </Flex>
    </Box>
  );
};

export default RealTimePortfolioMonitor;