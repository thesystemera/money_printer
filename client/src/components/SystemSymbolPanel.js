import React, { useState, useCallback, useMemo, memo, useEffect } from 'react';
import {
  Box, Text, Button, Flex, Badge, useToast, useColorMode,
  Table, Thead, Tbody, Tr, Th, Td, Tooltip, HStack,
  Spinner, Center, IconButton
} from '@chakra-ui/react';
import {
  RefreshCw, TrendingUp, TrendingDown, Info, Clock, Eye, RefreshCcw,
  ShieldCheck, Shield, ShieldAlert, ShieldOff
} from 'lucide-react';
import { UI_ANIMATIONS } from '../config/Config';
import { ConfidenceUtils } from './RecommendationHelper';
import { formatValue } from '../services/socketService';

const calculateTimeDiff = (timestamp) => {
  if (!timestamp) return 'Unknown';
  try {
    const now = Date.now();
    const date = new Date(timestamp);
    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffMinutes < 60) return `${diffMinutes}m ${diffSeconds % 60}s ago`;
    if (diffHours < 24) return `${diffHours}h ${diffMinutes % 60}m ago`;
    return `${diffDays}d ${diffHours % 24}h ago`;
  } catch (e) { return 'Unknown'; }
};

const TimeElapsedBadge = memo(({ timestamp }) => {
    const [timeAgo, setTimeAgo] = useState(() => calculateTimeDiff(timestamp));

    useEffect(() => {
        setTimeAgo(calculateTimeDiff(timestamp));
        const interval = setInterval(() => {
            setTimeAgo(calculateTimeDiff(timestamp));
        }, 10000);
        return () => clearInterval(interval);
    }, [timestamp]);

    return (
        <Badge colorScheme="blue" variant="subtle" px={2} py={0.5} fontSize="xs" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
            <Flex align="center">
                <Clock size={10} style={{ marginRight: '4px' }} />
                {timeAgo}
            </Flex>
        </Badge>
    );
});

const COLOR_MAPPING = {
  buy: { baseColor: 'green', darkBg: 'green.900', lightBg: 'green.50' },
  hold: { baseColor: 'yellow', darkBg: 'yellow.900', lightBg: 'yellow.50' },
  sell: { baseColor: 'red', darkBg: 'red.900', lightBg: 'red.50' },
  default: { baseColor: 'gray', darkBg: 'gray.700', lightBg: 'gray.50' }
};

const StatusBadge = memo(({ type, value, icon: IconComponent, size = "xs" }) => {
  const colorMap = {
    fresh: "blue", recent: "blue", outdated: "blue", unknown: "gray", error: "red",
    buy: "green", hold: "yellow", sell: "red", high: "red", medium: "yellow", low: "green"
  };
  const color = type === 'action'
    ? (value?.toLowerCase() === 'buy' ? "green" : value?.toLowerCase() === 'sell' ? "red" : value?.toLowerCase() === 'hold' ? "yellow" : "gray")
    : (colorMap[value?.toLowerCase()] || "gray");

  const displayValue = typeof value === 'string' ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  return (
    <Badge colorScheme={color} variant={type === 'action' ? "solid" : "subtle"} px={2} py={0.5} fontSize={size} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
      <Flex align="center">
        {IconComponent && <IconComponent size={size === "xs" ? 10 : 14} style={{ marginRight: '4px' }} />}
        {displayValue}
      </Flex>
    </Badge>
  );
});

const HistoricalAccuracyIndicator = memo(({ accuracy }) => {
    if (accuracy === undefined || accuracy === null) return null;

    const getAccuracyProps = (acc) => {
        const value = parseFloat(acc);
        if (value >= 75) return { color: 'green.500', icon: ShieldCheck, label: 'Excellent' };
        if (value >= 65) return { color: 'teal.500', icon: Shield, label: 'Good' };
        if (value >= 55) return { color: 'yellow.500', icon: ShieldAlert, label: 'Fair' };
        return { color: 'red.500', icon: ShieldOff, label: 'Poor' };
    };

    const { color, icon: Icon, label } = getAccuracyProps(accuracy);
    const tooltipLabel = `${label} Historical Accuracy (${accuracy.toFixed(1)}%)`;

    return (
        <Tooltip label={tooltipLabel} fontSize="xs" hasArrow>
            <Box color={color}>
                <Icon size={14} />
            </Box>
        </Tooltip>
    );
});


const SystemSymbolsPanel = ({ recommendations = [], onRefresh, onCardClick, setIsLoading: setParentIsLoading }) => {
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const { colorMode } = useColorMode();
  const textColor = colorMode === 'dark' ? 'gray.400' : 'gray.600';

  useEffect(() => {
    if (recommendations && recommendations.length > 0) {
      setLastRefresh(new Date());
    }
  }, [recommendations]);

  const handleManualRefresh = useCallback(async () => {
    setIsManualLoading(true);
    if (onRefresh) {
        await onRefresh();
    }
    setIsManualLoading(false);
  }, [onRefresh]);

  const sortedRecommendations = useMemo(() => {
    return [...recommendations].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [recommendations]);

  const handleViewAnalysis = (rec) => {
    const symbol = rec.rawData?.company?.symbol || rec.symbol;
    const cache_key_timestamp = rec.cached_at || rec.timestamp;
    onCardClick({ ...rec, symbol, cache_key_timestamp });
  };

  const handleReanalyze = (rec) => {
    const symbol = rec.rawData?.company?.symbol || rec.symbol;
    const cache_key_timestamp = rec.cached_at || rec.timestamp;
    onCardClick({ ...rec, symbol, cache_key_timestamp, forceRefresh: true });
  };

  return (
    <Box width="100%" p={3} display="flex" flexDirection="column">
      <Flex justify="space-between" mb={3} align="center">
        <Box>
            <Flex align="center" gap={2}>
                {lastRefresh && <TimeElapsedBadge timestamp={lastRefresh} />}
                <Text fontSize="xs" color={textColor}>Displaying latest recommendation for {sortedRecommendations.length} symbols.</Text>
            </Flex>
        </Box>
        <Button
          size="sm"
          colorScheme="teal"
          leftIcon={<RefreshCw size={14} />}
          onClick={handleManualRefresh}
          isLoading={isManualLoading}
          transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
        >
            Refresh
        </Button>
      </Flex>
      <Box overflowX="auto">
        <Table variant="simple" size="sm">
          <Thead>
            <Tr>
              <Th>Symbol</Th>
              <Th>Action</Th>
              <Th>Confidence</Th>
              <Th>Projected Return</Th>
              <Th>Target Date</Th>
              <Th>Generated</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {sortedRecommendations.map((rec, index) => {
              const symbol = rec.rawData?.company?.symbol;
              const action = rec.action?.toUpperCase() || 'UNKNOWN';
              const confidenceData = ConfidenceUtils.getConfidenceData(rec);
              const activeConfidence = confidenceData.active;
              const confidenceValue = activeConfidence[action.toLowerCase()] || 0;

              const historicalAccuracy = rec.predictionAccuracy?.accuracy_metrics?.movement_weighted?.accuracy;

              const masterPredictions = rec.model_predictions?.master || rec.predictions?.nextTradingDay;
              let projectedReturn = '-';
              let projectedReturnColor = colorMode === 'dark' ? 'gray.400' : 'gray.600';
              let returnValueNum = 0;

              if (masterPredictions?.hourlyPrices?.length > 0) {
                const openPrediction = masterPredictions.hourlyPrices.find(p => p.hour === '09:30' || p.session?.includes('market open'));
                const closePrediction = masterPredictions.hourlyPrices.find(p => p.hour === '16:00' || p.session?.includes('market close'));

                if (openPrediction && closePrediction && typeof openPrediction.price === 'number' && typeof closePrediction.price === 'number') {
                    const open = openPrediction.price;
                    const close = closePrediction.price;
                    if (open > 0) {
                        returnValueNum = ((close - open) / open) * 100;
                        projectedReturn = (returnValueNum >= 0 ? '+' : '') + `${returnValueNum.toFixed(1)}%`;
                        if (returnValueNum > 0.5) {
                            projectedReturnColor = 'green.500';
                        } else if (returnValueNum < -0.5) {
                            projectedReturnColor = 'red.500';
                        } else {
                            projectedReturnColor = 'yellow.500';
                        }
                    }
                }
              }

              const targetDate = rec.target_trading_datetime
                ? new Date(rec.target_trading_datetime).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' })
                : '-';

              const colorKey = action === 'BUY' ? 'buy' : action === 'SELL' ? 'sell' : action === 'HOLD' ? 'hold' : 'default';
              const colors = COLOR_MAPPING[colorKey];
              const rowBgColor = colorMode === 'dark' ? colors.darkBg : colors.lightBg;

              return (
                <Tr key={`${symbol}-${index}`} bg={rowBgColor}>
                  <Td fontWeight="bold">{symbol}</Td>
                  <Td><StatusBadge type="action" value={action} icon={action === 'BUY' ? TrendingUp : action === 'SELL' ? TrendingDown : Info} size="xs" /></Td>
                  <Td>
                    <HStack spacing={2} align="center">
                        <Text fontWeight="medium" minW="45px">{formatValue(confidenceValue * 100, { format: 'percent', decimals: 1 })}</Text>
                        <HistoricalAccuracyIndicator accuracy={historicalAccuracy} />
                    </HStack>
                  </Td>
                  <Td color={projectedReturnColor} fontWeight="medium">{projectedReturn}</Td>
                  <Td fontSize="xs">{targetDate}</Td>
                  <Td fontSize="xs">{calculateTimeDiff(rec.timestamp)}</Td>
                  <Td>
                    <HStack spacing={2}>
                      <Tooltip label="View Full Analysis">
                        <IconButton size="xs" icon={<Eye size={14} />} onClick={() => handleViewAnalysis(rec)} variant="ghost" />
                      </Tooltip>
                      <Tooltip label="Re-analyze Symbol">
                        <IconButton size="xs" icon={<RefreshCcw size={14} />} onClick={() => handleReanalyze(rec)} variant="ghost" colorScheme="teal" />
                      </Tooltip>
                    </HStack>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </Box>
    </Box>
  );
};

export default React.memo(SystemSymbolsPanel);