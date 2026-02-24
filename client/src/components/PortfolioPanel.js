import React, { useState, useCallback, useMemo, memo, useEffect } from 'react';
import {
  Box, Text, Button, Flex, Badge, useToast, useColorMode, SimpleGrid, VStack, Progress,
  Table, Thead, Tbody, Tr, Th, Td, Tooltip, Tabs, TabList, TabPanels, Tab, TabPanel,
  HStack, Icon, Tag, TagLabel, Card, CardHeader, CardBody
} from '@chakra-ui/react';
import {
  RefreshCw, BarChart2, TrendingUp, TrendingDown, Clock, Briefcase, PieChart,
  Info, Shield, AlertTriangle, Brain, Filter, Activity, Calendar, Zap,
  ArrowUp, ArrowDown, BarChart, Eye, RefreshCcw
} from 'lucide-react';
import { PieChart as ReChartPie, Pie, Cell, ResponsiveContainer } from 'recharts';
import { showToast, formatValue } from '../services/socketService';
import { UI_ANIMATIONS, CHART_ANIMATIONS } from '../config/Config';
import { ConfidenceUtils, PredictionDataAdapter } from './RecommendationHelper';

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

export const TimeElapsedBadge = memo(({ timestamp }) => {
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

const formatPercent = value => {
  if (value === undefined || value === null) return '0%';

  const num = parseFloat(value);
  if (isNaN(num)) return '0%';

  const percentage = Math.abs(num) > 2 ? num : num * 100;

  return `${percentage.toFixed(1)}%`;
};

const COLOR_MAPPING = {
  cash: { baseColor: 'blue', varColor: 'var(--chakra-colors-blue-500)', darkBg: 'blue.900', lightBg: 'blue.50' },
  tech: { baseColor: 'teal', varColor: 'var(--chakra-colors-teal-500)', darkBg: 'teal.900', lightBg: 'teal.50' },
  buy: { baseColor: 'green', varColor: 'var(--chakra-colors-green-500)', darkBg: 'green.900', lightBg: 'green.50' },
  hold: { baseColor: 'yellow', varColor: 'var(--chakra-colors-yellow-500)', darkBg: 'yellow.900', lightBg: 'yellow.50' },
  sell: { baseColor: 'red', varColor: 'var(--chakra-colors-red-500)', darkBg: 'red.900', lightBg: 'red.50' },
  purple: { baseColor: 'purple', varColor: 'var(--chakra-colors-purple-500)', darkBg: 'purple.900', lightBg: 'purple.50' },
  default: { baseColor: 'gray', varColor: 'var(--chakra-colors-gray-500)', darkBg: 'gray.700', lightBg: 'gray.50' }
};

const getAssetColor = (symbol, percentage, maxPercentage) => {
  if (symbol && symbol.toLowerCase() === 'cash') {
    const intensity = 0.3 + (0.7 * (percentage / maxPercentage));
    return `hsla(210, 90%, 50%, ${intensity})`;
  }
  const intensity = 0.3 + (0.7 * (percentage / maxPercentage));
  return `hsla(170, 90%, 45%, ${intensity})`;
};

const getActionColor = (action) => {
  const actionLower = action?.toLowerCase() || 'default';
  const colorKey = actionLower === 'buy' ? 'buy' : actionLower === 'sell' ? 'sell' : actionLower === 'hold' ? 'hold' : 'default';
  return COLOR_MAPPING[colorKey];
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

const StockCard = memo(({ stock, colorMode, onCardClick }) => {
  const borderColor = colorMode === 'dark' ? 'gray.700' : 'gray.200';
  const textColor = colorMode === 'dark' ? 'gray.400' : 'gray.600';
  const action = stock.action?.toUpperCase() || 'UNKNOWN';
  const description = stock.reason || 'No description available';
  const projectedReturn = stock.projectedReturn !== undefined ? (stock.projectedReturn >= 0 ? '+' : '') + formatPercent(stock.projectedReturn) : null;

  const symbol = stock.symbol;
  const companyName = stock.companyName || '';
  const masterPredictions = PredictionDataAdapter.getMasterPredictions(stock);
  const marketOpen = masterPredictions?.marketOpen;
  const marketClose = masterPredictions?.marketClose;

  const targetDateTime = stock.target_trading_datetime ? new Date(stock.target_trading_datetime) : null;
  const formattedTargetDate = targetDateTime
    ? new Intl.DateTimeFormat('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York'
      }).format(targetDateTime)
    : null;

  const tooltipProps = {
    hasArrow: true,
    bg: colorMode === 'dark' ? 'gray.700' : 'gray.100',
    color: colorMode === 'dark' ? 'white' : 'gray.800',
    p: 2,
    borderRadius: "md"
  };

  const actionColor = getActionColor(action);
  const baseColor = actionColor.baseColor;
  const headerColor = `${baseColor}.500`;
  const metaColor = `${baseColor}.600`;

  const confidenceData = ConfidenceUtils.getConfidenceData(stock);

  const getBarColor = (type) => {
    const actionType = getActionColor(type);
    return actionType.varColor;
  };

  return (
    <Box
      borderWidth="1px"
      borderRadius="md"
      borderColor={borderColor}
      overflow="hidden"
      transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
      _hover={{ boxShadow: "md", borderColor: `${baseColor}.400` }}
      position="relative"
    >
      <Box
        onClick={() => onCardClick(stock)}
        cursor="pointer"
        _hover={{ bg: colorMode === 'dark' ? 'whiteAlpha.50' : 'blackAlpha.50' }}
        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
      >
        <Box position="relative">
          <Box bg={headerColor} px={3} py={2} position="relative">
            <Flex justify="space-between" align="center">
              <Flex align="center" gap={2}>
                <Text fontWeight="bold" color="white">${symbol}</Text>
                <Tooltip label={companyName} isDisabled={!companyName} {...tooltipProps}>
                  <Text fontSize="xs" color="whiteAlpha.800" noOfLines={1} maxW="120px">{companyName}</Text>
                </Tooltip>
              </Flex>

              <Box>
                <Badge
                  bg="white"
                  color={headerColor}
                  px={2}
                  py={1}
                  borderRadius="md"
                  fontWeight="bold"
                  fontSize="sm"
                  transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                >
                  <Flex align="center">
                    {action === 'BUY' ?
                      <TrendingUp size={14} style={{ marginRight: '4px', color: `var(--chakra-colors-${headerColor})` }} /> :
                      action === 'SELL' ?
                        <TrendingDown size={14} style={{ marginRight: '4px', color: `var(--chakra-colors-${headerColor})` }} /> :
                        <Info size={14} style={{ marginRight: '4px', color: `var(--chakra-colors-${headerColor})` }} />
                    }
                    {action}
                  </Flex>
                </Badge>
              </Box>
            </Flex>
          </Box>

          <Box bg={metaColor} px={3} py={1.5}>
            <Flex gap={1.5} flexWrap="wrap">
              <TimeElapsedBadge timestamp={stock.timestamp} />

              {formattedTargetDate && (
                <Badge bg="whiteAlpha.300" color="white" px={2} py={0.5} fontSize="xs" borderRadius="md" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
                  <Flex align="center">
                    <Calendar size={10} style={{ marginRight: '4px' }} />
                    For {formattedTargetDate}
                  </Flex>
                </Badge>
              )}

              {stock.freshness && (
                <Badge bg="whiteAlpha.300" color="white" px={2} py={0.5} fontSize="xs" borderRadius="md" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
                  <Flex align="center">
                    <Zap size={10} style={{ marginRight: '4px' }} />
                    {stock.freshness.charAt(0).toUpperCase() + stock.freshness.slice(1)}
                  </Flex>
                </Badge>
              )}

              {stock.sector && (
                <Badge
                  bg="whiteAlpha.300"
                  color="white"
                  px={2} py={0.5}
                  fontSize="xs"
                  borderRadius="md"
                  maxW="100px"
                  whiteSpace="nowrap"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                >
                  {stock.sector}
                </Badge>
              )}
            </Flex>
          </Box>
        </Box>

        <Box p={3}>
          <Tooltip label={description} {...tooltipProps}>
            <Text
              fontSize="sm"
              noOfLines={2}
              mb={3}
              cursor="help"
              textDecoration="underline dotted"
              textUnderlineOffset="2px"
            >{description}</Text>
          </Tooltip>

          <Flex justify="space-between" mb={3}>
            {(marketOpen && marketClose) && (
              <Flex align="center" flex="1">
                <Box borderRadius="full" bg={colorMode === 'dark' ? 'whiteAlpha.200' : 'gray.100'} p={1} mr={2} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
                  <Activity size={14} color="var(--chakra-colors-blue-500)" />
                </Box>
                <Box>
                  <Text fontSize="xs" color={textColor}>Price</Text>
                  <Text fontSize="sm" fontWeight="bold">
                    ${marketOpen.toFixed(2)} → ${marketClose.toFixed(2)}
                  </Text>
                </Box>
              </Flex>
            )}

            {projectedReturn && (
              <Flex align="center" flex="1" justifyContent="center">
                <Box borderRadius="full" bg={colorMode === 'dark' ? 'whiteAlpha.200' : 'gray.100'} p={1} mr={2} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
                  <BarChart2 size={14} color={`var(--chakra-colors-${stock.projectedReturn >= 0 ? 'green' : 'red'}-500)`} />
                </Box>
                <Box>
                  <Text fontSize="xs" color={textColor}>Return</Text>
                  <Text fontSize="sm" fontWeight="bold" color={stock.projectedReturn >= 0 ? 'green.500' : 'red.500'}>
                    {projectedReturn}
                  </Text>
                </Box>
              </Flex>
            )}

            {stock.volatility && (
              <Flex align="center" flex="1" justifyContent="flex-end">
                <Box borderRadius="full" bg={colorMode === 'dark' ? 'whiteAlpha.200' : 'gray.100'} p={1} mr={2} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
                  <TrendingUp size={14} color={`var(--chakra-colors-${stock.volatility === 'high' ? 'red' : stock.volatility === 'medium' ? 'yellow' : 'green'}-500)`} />
                </Box>
                <Box>
                  <Text fontSize="xs" color={textColor}>Vol</Text>
                  <Text fontSize="sm" fontWeight="bold" textTransform="capitalize">
                    {stock.volatility}
                  </Text>
                </Box>
              </Flex>
            )}
          </Flex>

          {stock.factors && stock.factors.length > 0 && (
            <Box mt={3} px={3} py={2} borderRadius="md" bg={colorMode === 'dark' ? 'whiteAlpha.100' : 'gray.50'} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
              <Flex align="center" mb={1}>
                <Filter size={12} style={{ marginRight: '6px', color: `var(--chakra-colors-blue-500)` }} />
                <Text fontSize="xs" fontWeight="medium" color={textColor}>Key Factors</Text>
              </Flex>
              <Tooltip label={stock.factors.join(", ")} {...tooltipProps} maxW="400px">
                <Flex flexWrap="wrap" gap={1} cursor="help">
                  {stock.factors.slice(0, 4).map((factor, idx) => (
                    <Tag size="sm" key={idx} colorScheme="blue" variant="subtle" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
                      <TagLabel fontSize="xs" noOfLines={1}>{factor}</TagLabel>
                    </Tag>
                  ))}
                  {stock.factors.length > 4 && (
                    <Tag size="sm" colorScheme="gray" variant="subtle" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
                      <TagLabel fontSize="xs">+{stock.factors.length - 4}</TagLabel>
                    </Tag>
                  )}
                </Flex>
              </Tooltip>
            </Box>
          )}

          <Box mt={3} px={3} py={2} borderRadius="md" bg={colorMode === 'dark' ? 'whiteAlpha.100' : 'gray.50'} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
            <Flex justify="space-between" align="center" mb={2}>
              <Flex align="center">
                <Brain size={12} style={{ marginRight: '6px', color: `var(--chakra-colors-purple-500)` }} />
                <Text fontSize="xs" fontWeight="medium" color={textColor}>Confidence</Text>
              </Flex>
              {confidenceData.hasRevision && (
                <Tooltip
                  label="Confidence levels revised based on portfolio analysis"
                  {...tooltipProps}
                >
                  <Badge
                    colorScheme="purple"
                    variant="subtle"
                    size="sm"
                    fontSize="xs"
                    px={1}
                    cursor="help"
                    textDecoration="underline dotted"
                    textUnderlineOffset="2px"
                    transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>Revised</Badge>
                </Tooltip>
              )}
            </Flex>

            {['BUY', 'HOLD', 'SELL'].map((type) => {
              const lowerType = type.toLowerCase();
              const originalValue = confidenceData.original[lowerType] || 0;
              const revisedValue = confidenceData.revised?.[lowerType];
              const hasRevision = revisedValue !== undefined && revisedValue !== originalValue;
              const barColor = getBarColor(type);

              return (
                <Flex key={type} align="center" justify="space-between" mb={1}>
                  <Text fontSize="xs" fontWeight={action === type ? "bold" : "normal"} width="40px" flexShrink={0}>
                    {type}
                  </Text>

                  <Box position="relative" flex={1} height="6px" mx={2} bg={colorMode === 'dark' ? 'whiteAlpha.200' : 'gray.100'} borderRadius="full" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
                    <Box
                      position="absolute"
                      top={0}
                      left={0}
                      height="6px"
                      width={`${originalValue * 100}%`}
                      bg={barColor}
                      borderRadius="full"
                      opacity={hasRevision ? 0.5 : 1}
                      transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                    />

                    {hasRevision && (
                      <Box
                        position="absolute"
                        top={0}
                        left={0}
                        height="6px"
                        width={`${revisedValue * 100}%`}
                        bg={barColor}
                        borderRadius="full"
                        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                      />
                    )}
                  </Box>

                  <Text fontSize="xs" fontWeight="medium" textAlign="right" width="40px" flexShrink={0}>
                    {hasRevision ? formatPercent(revisedValue) : formatPercent(originalValue)}
                  </Text>
                </Flex>
              );
            })}

            {stock.revisedConfidence?.reasoning && (
              <Box mt={2} fontSize="xs" fontStyle="italic" color={textColor}>
                <Tooltip
                  label={stock.revisedConfidence.reasoning}
                  placement="bottom"
                  {...tooltipProps}
                  maxW="300px"
                >
                  <Text
                    noOfLines={2}
                    cursor="help"
                    textDecoration="underline dotted"
                    textUnderlineOffset="2px"
                  >
                    {stock.revisedConfidence.reasoning}
                  </Text>
                </Tooltip>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      <Flex borderTop="1px solid" borderColor={borderColor}>
        <Box
          w="50%"
          py={2}
          textAlign="center"
          onClick={() => onCardClick(stock)}
          cursor="pointer"
          _hover={{ bg: colorMode === 'dark' ? 'blue.900' : 'blue.50' }}
          borderRight="1px solid"
          borderColor={borderColor}
          transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
        >
          <Flex justify="center" align="center">
            <Eye size={14} style={{ marginRight: '6px', color: 'var(--chakra-colors-blue-500)' }} />
            <Text fontSize="sm" fontWeight="medium" color="blue.500">View Analysis</Text>
          </Flex>
        </Box>

        <Box
          w="50%"
          py={2}
          textAlign="center"
          onClick={() => onCardClick({...stock, forceRefresh: true})}
          cursor="pointer"
          _hover={{ bg: colorMode === 'dark' ? 'teal.900' : 'teal.50' }}
          transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
        >
          <Flex justify="center" align="center">
            <RefreshCcw size={14} style={{ marginRight: '6px', color: 'var(--chakra-colors-teal-500)' }} />
            <Text fontSize="sm" fontWeight="medium" color="teal.500">Update Data</Text>
          </Flex>
        </Box>
      </Flex>
    </Box>
  );
});

const PanelContentBox = memo(({ children, colorMode, colorKey = 'default' }) => {
  const colors = COLOR_MAPPING[colorKey] || COLOR_MAPPING.default;
  return (
    <Box
      p={2}
      borderRadius="md"
      bg={colorMode === 'dark' ? colors.darkBg : colors.lightBg}
      borderLeft="3px solid"
      borderColor={`${colors.baseColor}.500`}
      transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
    >
      {children}
    </Box>
  );
});

const PanelWrapper = memo(({ title, icon: IconComponent, children, isExpanded, onToggle, colorMode, colorKey = 'default' }) => {
  const borderColor = colorMode === 'dark' ? 'gray.700' : 'gray.200';
  const colors = COLOR_MAPPING[colorKey] || COLOR_MAPPING.default;

  return (
    <Box borderWidth="1px" borderRadius="md" borderColor={borderColor} mb={3} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
      <Flex p={3} alignItems="center" borderBottom={isExpanded ? `1px solid ${borderColor}` : "none"} cursor="pointer" onClick={onToggle} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
        <IconComponent size={14} style={{ marginRight: '8px', color: colors.varColor }} />
        <Text fontSize="sm" fontWeight="bold">{title}</Text>
        <Icon as={isExpanded ? ArrowUp : ArrowDown} ml="auto" boxSize={3} color={colorMode === 'dark' ? 'gray.400' : 'gray.600'} />
      </Flex>
      {isExpanded && <Box p={3}>{children}</Box>}
    </Box>
  );
});

const AlternativeSuggestionBubble = memo(({ alternativeInvestments = [], onCardClick }) => {
  const { colorMode } = useColorMode();
  const bubbleBg = colorMode === 'dark' ? 'teal.900' : 'teal.50';
  const borderColor = colorMode === 'dark' ? 'teal.700' : 'teal.200';
  const textColor = colorMode === 'dark' ? 'white' : 'gray.800';
  const tileBg = colorMode === 'dark' ? 'whiteAlpha.100' : 'whiteAlpha.500';

  if (!alternativeInvestments || alternativeInvestments.length === 0) {
    return null;
  }

  return (
    <Box
      borderRadius="md"
      borderWidth="1px"
      borderColor={borderColor}
      bg={bubbleBg}
      p={3}
      mb={3}
      boxShadow="md"
      transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
    >
      <Flex justify="space-between" align="center" mb={2}>
        <HStack>
          <Shield size={16} color="var(--chakra-colors-teal-500)" />
          <Text fontWeight="bold" fontSize="sm">Alternative Safe Investments</Text>
        </HStack>
        <Badge colorScheme="teal" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>Market Protection</Badge>
      </Flex>

      <SimpleGrid
        columns={{ base: 1, sm: alternativeInvestments.length > 1 ? 2 : 1, lg: alternativeInvestments.length > 2 ? 3 : alternativeInvestments.length > 1 ? 2 : 1 }}
        spacing={3}
      >
        {alternativeInvestments.map((sector, idx) => (
          <Box
            key={`sector-${idx}`}
            bg={tileBg}
            borderRadius="md"
            p={2}
            borderLeft="3px solid"
            borderColor="teal.400"
            display="flex"
            flexDirection="column"
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          >
            <Text fontSize="sm" fontWeight="bold" mb={1}>{sector.sector}</Text>
            {sector.description && (
              <Text fontSize="xs" color={textColor} mb={2} noOfLines={2}>{sector.description}</Text>
            )}

            <SimpleGrid
              columns={{ base: 1, sm: 1, md: 2 }}
              spacing={2}
              flex="1"
            >
              {sector.stocks?.map((stock, stockIdx) => (
                <Box
                  key={`stock-${idx}-${stockIdx}`}
                  bg={colorMode === 'dark' ? 'whiteAlpha.200' : 'whiteAlpha.700'}
                  borderRadius="md"
                  p={2}
                  transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                >
                  <Flex direction="column" h="100%" justify="space-between">
                    <Box>
                      <Flex justify="space-between" align="center" mb={1}>
                        <Text fontSize="sm" fontWeight="bold" color={colorMode === 'dark' ? 'teal.200' : 'teal.700'}>
                          ${stock.symbol}
                        </Text>
                        {stock.projectedReturn && (
                          <Badge
                            colorScheme="green"
                            fontSize="xs"
                            p={1}
                            borderRadius="md"
                            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                          >
                            +{(stock.projectedReturn * 100).toFixed(1)}%
                          </Badge>
                        )}
                      </Flex>
                      <Text fontSize="xs" color={textColor} noOfLines={1} mb={2}>
                        {stock.company}
                      </Text>
                    </Box>

                    <Button
                      size="xs"
                      colorScheme="teal"
                      width="100%"
                      leftIcon={<RefreshCcw size={12} />}
                      onClick={() => onCardClick({
                        symbol: stock.symbol,
                        forceRefresh: true
                      })}
                      mt="auto"
                      transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                    >
                      Fetch Data
                    </Button>
                  </Flex>
                </Box>
              ))}
            </SimpleGrid>
          </Box>
        ))}
      </SimpleGrid>
    </Box>
  );
});

const SectorCorrelations = memo(({ correlations, colorMode }) => {
  if (!correlations || Object.keys(correlations).length === 0) return null;
  return (
    <VStack spacing={2} align="stretch">
      {Object.entries(correlations).map(([sector, value], index) => (
        <Box key={index}>
          <Flex justify="space-between" align="center">
            <Text fontSize="xs" fontWeight="medium" noOfLines={1}>{sector}:</Text>
            <Badge colorScheme={value >= 0.5 ? "red" : value >= 0.3 ? "yellow" : "green"} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>{Math.round(value * 100)}%</Badge>
          </Flex>
          <Progress value={value * 100} size="xs" mt={1} colorScheme={value >= 0.75 ? "red" : value >= 0.5 ? "orange" : value >= 0.3 ? "yellow" : "green"} borderRadius="full" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'} />
        </Box>
      ))}
    </VStack>
  );
});

const PortfolioImprovements = memo(({ portfolioAllocation = {}, correlations = {}, topOpportunities = [], watchlist = [], avoidList = [] }) => {
  const { colorMode } = useColorMode();
  const textColor = colorMode === 'dark' ? 'gray.300' : 'gray.700';

  const portfolioMetrics = useMemo(() => {
    const sectorCount = {};
    const symbolSectors = {};
    [...topOpportunities, ...watchlist].forEach(stock => {
      if (stock.sector) {
        if (!sectorCount[stock.sector]) sectorCount[stock.sector] = 0;
        sectorCount[stock.sector]++;
        symbolSectors[stock.symbol] = stock.sector;
      }
    });

    const sectorAllocation = {};
    Object.entries(portfolioAllocation).forEach(([symbol, percentage]) => {
      if (symbol.toLowerCase() === 'cash') return;
      const sector = symbolSectors[symbol] || 'Unknown';
      if (!sectorAllocation[sector]) sectorAllocation[sector] = 0;
      sectorAllocation[sector] += percentage;
    });

    const sortedSectors = Object.entries(sectorAllocation).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const cashPosition = portfolioAllocation['cash'] || portfolioAllocation['Cash'] || 0;
    const highCorrelations = Object.entries(correlations).filter(([sector, value]) => value > 0.7).sort((a, b) => b[1] - a[1]);
    const highVolatilityStocks = [...topOpportunities, ...watchlist].filter(stock => stock.volatility === 'high').map(stock => stock.symbol);

    return { topSectors: sortedSectors, cashPosition, highCorrelations, highVolatilityStocks, sectorAllocation };
  }, [portfolioAllocation, correlations, topOpportunities, watchlist]);

  const recommendations = useMemo(() => {
    const recs = [];

    if (portfolioMetrics.cashPosition < 15) {
      recs.push({
        type: 'risk', icon: Shield, title: 'Increase Cash Reserve',
        description: `Your current cash position (${portfolioMetrics.cashPosition.toFixed(1)}%) is low. Consider increasing to at least 15-20% to manage risk and capitalize on new opportunities.`
      });
    }

    if (portfolioMetrics.topSectors.length > 0 && portfolioMetrics.topSectors[0][1] > 30) {
      recs.push({
        type: 'diversification', icon: AlertTriangle, title: 'Reduce Sector Concentration',
        description: `${portfolioMetrics.topSectors[0][0]} sector represents ${portfolioMetrics.topSectors[0][1].toFixed(1)}% of your portfolio. Consider reducing exposure to improve diversification.`
      });
    }

    if (portfolioMetrics.highCorrelations.length > 0) {
      recs.push({
        type: 'correlation', icon: Info, title: 'Watch Correlation Risk',
        description: `High correlation (${(portfolioMetrics.highCorrelations[0][1]*100).toFixed(1)}%) in ${portfolioMetrics.highCorrelations[0][0]} sector may amplify market movements. Consider hedging strategies.`
      });
    }

    if (portfolioMetrics.highVolatilityStocks.length > 0) {
      recs.push({
        type: 'volatility', icon: TrendingUp, title: 'Manage Volatility Exposure',
        description: `${portfolioMetrics.highVolatilityStocks.length} high volatility positions detected. Consider reducing position sizes or adding stop-loss orders.`
      });
    }

    if (topOpportunities.length > 0) {
      const bestOpportunity = topOpportunities.sort((a, b) => {
        const aConfidenceData = ConfidenceUtils.getConfidenceData(a);
        const bConfidenceData = ConfidenceUtils.getConfidenceData(b);
        const aConfidence = aConfidenceData.active.buy || 0;
        const bConfidence = bConfidenceData.active.buy || 0;
        if (Math.abs(aConfidence - bConfidence) > 0.1) return bConfidence - aConfidence;
        return (b.projectedReturn || 0) - (a.projectedReturn || 0);
      })[0];

      if (bestOpportunity) {
        recs.push({
          type: 'opportunity', icon: TrendingUp, title: `Top Buying Opportunity: ${bestOpportunity.symbol}`,
          description: `${bestOpportunity.reason || 'Strong buy signal based on analysis'}. Projected return: ${(bestOpportunity.projectedReturn * 100).toFixed(1)}%.`
        });
      }
    }

    if (avoidList.length > 0) {
      const topSellRec = avoidList[0];
      recs.push({
        type: 'sell', icon: TrendingDown, title: `Consider Selling: ${topSellRec.symbol}`,
        description: topSellRec.reason || 'Risk factors suggest reducing or eliminating this position.'
      });
    }

    if (Object.keys(correlations).length > 0) {
        recs.push({
          type: 'correlation_details',
          icon: Activity,
          title: 'Sector Correlation Details',
          data: correlations
        });
    }

    return recs;
  }, [portfolioMetrics, topOpportunities, avoidList, correlations]);

  if (recommendations.length === 0) return null;

  const getRecommendationColor = (type) => {
    switch(type) {
      case 'risk': return 'red';
      case 'opportunity': return 'green';
      case 'sell': return 'red';
      case 'diversification': return 'yellow';
      case 'correlation': return 'blue';
      case 'volatility': return 'orange';
      default: return 'blue';
    }
  };

  const gap = 3;
  const columns = { base: 1, md: 2, lg: Math.min(recommendations.length, 3) };

  return (
    <Box sx={{ columnCount: columns, columnGap: `var(--chakra-space-${gap})` }}>
      {recommendations.map((rec, index) => {

        if (rec.type === 'correlation_details') {
            return (
                <Box key={`rec-${index}`} mb={gap} sx={{ breakInside: 'avoid' }}>
                    <Card variant="outline" size="sm">
                        <CardHeader pb={1} pt={2} px={3} display="flex" alignItems="center">
                        <rec.icon size={16} style={{ marginRight: '8px', color: 'var(--chakra-colors-blue-500)' }} />
                        <Text fontWeight="bold" fontSize="sm">{rec.title}</Text>
                        </CardHeader>
                        <CardBody pt={0} px={3} pb={2}>
                            <SectorCorrelations correlations={rec.data} colorMode={colorMode} />
                        </CardBody>
                    </Card>
                </Box>
            );
        }

        const colorScheme = getRecommendationColor(rec.type);
        return (
          <Box key={`rec-${index}`} mb={gap} sx={{ breakInside: 'avoid' }}>
            <Card
              variant="outline"
              size="sm"
              borderLeftWidth="3px"
              borderLeftColor={`${colorScheme}.500`}
            >
              <CardHeader pb={1} pt={2} px={3} display="flex" alignItems="center">
                <rec.icon size={16} style={{ marginRight: '8px', color: `var(--chakra-colors-${colorScheme}-500)` }} />
                <Text fontWeight="bold" fontSize="sm">{rec.title}</Text>
              </CardHeader>
              <CardBody pt={0} px={3} pb={2}>
                <Text fontSize="sm" color={textColor}>{rec.description}</Text>
                {rec.type === 'opportunity' && (
                  <Badge mt={2} colorScheme="green">Recommended Action</Badge>
                )}
              </CardBody>
            </Card>
          </Box>
        );
      })}
    </Box>
  );
});

const StocksTable = memo(({ stocks, colorMode, onRowClick }) => {
  return (
    <Box overflowX="auto">
      <Table variant="simple" size="sm">
        <Thead>
          <Tr>
            <Th width="80px">SYMBOL</Th>
            <Th width="100px">COMPANY</Th>
            <Th width="80px">ACTION</Th>
            <Th width="100px">TARGET DATE</Th>
            <Th width="80px">RETURN</Th>
            <Th width="120px">CONFIDENCE</Th>
            <Th width="100px">PRICE RANGE</Th>
            <Th width="80px">VOLATILITY</Th>
            <Th>NOTES</Th>
          </Tr>
        </Thead>
        <Tbody>
          {stocks.map((stock, index) => {
            const action = stock.action?.toUpperCase() || 'UNKNOWN';
            const confidenceData = ConfidenceUtils.getConfidenceData(stock);
            const activeConfidence = confidenceData.active;
            const confidenceValue = activeConfidence[action.toLowerCase()] || 0;

            const description = stock.reason || '-';
            const projectedReturn = stock.projectedReturn !== undefined ? (stock.projectedReturn >= 0 ? '+' : '') + formatPercent(stock.projectedReturn) : '-';
            const symbol = stock.symbol;
            const companyName = stock.companyName || '-';
            const masterPredictions = PredictionDataAdapter.getMasterPredictions(stock);
            const marketOpen = masterPredictions?.marketOpen;
            const marketClose = masterPredictions?.marketClose;
            const priceRange = (marketOpen && marketClose) ? `$${marketOpen.toFixed(2)} → $${marketClose.toFixed(2)}` : '-';
            const volatility = stock.volatility || '-';
            const targetDate = stock.target_trading_datetime
              ? new Date(stock.target_trading_datetime).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'America/New_York'
                })
              : '-';

            const colorKey = action === 'BUY' ? 'buy' : action === 'SELL' ? 'sell' : action === 'HOLD' ? 'hold' : 'default';
            const colors = COLOR_MAPPING[colorKey];
            const rowBgColor = colorMode === 'dark' ? colors.darkBg : colors.lightBg;

            return (
              <Tr
                key={`stock-${index}`}
                bg={rowBgColor}
                cursor={onRowClick ? "pointer" : "default"}
                _hover={onRowClick ? { opacity: 0.8 } : undefined}
                onClick={onRowClick ? () => onRowClick(stock) : undefined}
                transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
              >
                <Td fontWeight="bold" py={2}>{symbol}</Td>
                <Td fontSize="xs" py={2}>
                  <Tooltip label={companyName} isDisabled={companyName === '-'}>
                    <Text noOfLines={1}>{companyName}</Text>
                  </Tooltip>
                </Td>
                <Td py={2}><StatusBadge type="action" value={action} icon={action === 'BUY' ? TrendingUp : action === 'SELL' ? TrendingDown : Info} size="xs" /></Td>
                <Td fontSize="xs" py={2}>{targetDate}</Td>
                <Td color={stock.projectedReturn >= 0 ? 'green.500' : 'red.500'} fontWeight="medium" py={2}>{projectedReturn}</Td>
                <Td py={2}>
                  {confidenceValue ? (
                    <Box>
                      <Flex direction="column" spacing={0}>
                        <Flex align="center" mb={1}>
                          <Box width="70px" mr={2}>
                            <Progress
                              value={confidenceValue * 100}
                              size="xs"
                              colorScheme={action === 'BUY' ? 'green' : action === 'SELL' ? 'red' : 'yellow'}
                              borderRadius="full"
                              transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                            />
                          </Box>
                          <Text fontSize="xs" fontWeight="medium">{formatValue(confidenceValue * 100, {format: 'percent', decimals: 1})}</Text>
                          {confidenceData.hasRevision && (
                            <Badge
                              colorScheme="purple"
                              variant="outline"
                              size="sm"
                              fontSize="2xs"
                              ml={1}
                              px={1}
                              transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                            >
                              REV
                            </Badge>
                          )}
                        </Flex>

                        {confidenceData.hasRevision && (
                          <Flex align="center">
                            <Box width="70px" mr={2}>
                              <Progress
                                value={confidenceData.original[action.toLowerCase()] * 100}
                                size="xs"
                                colorScheme={action === 'BUY' ? 'green' : action === 'SELL' ? 'red' : 'yellow'}
                                opacity={0.5}
                                borderRadius="full"
                                transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                              />
                            </Box>
                            <Text fontSize="xs" color="gray.500">{formatValue(confidenceData.original[action.toLowerCase()] * 100, {format: 'percent', decimals: 1})}</Text>
                          </Flex>
                        )}
                      </Flex>
                    </Box>
                  ) : '-'}
                </Td>
                <Td fontSize="xs" py={2}>{priceRange}</Td>
                <Td fontSize="xs" py={2}>{volatility !== '-' && <StatusBadge type="status" value={volatility} />}</Td>
                <Td fontSize="xs" py={2}>
                  <Tooltip label={description} isDisabled={description === '-'}>
                    <Text noOfLines={1}>{description}</Text>
                  </Tooltip>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </Box>
  );
});

const DataFreshnessStats = memo(({ stats, colorMode }) => {
  const { fresh = 0, recent = 0, outdated = 0, total = 0 } = stats || {};
  if (!total) return null;
  const bgColor = colorMode === 'dark' ? 'whiteAlpha.200' : 'gray.100';
  const borderColor = colorMode === 'dark' ? 'gray.700' : 'gray.200';

  return (
    <HStack spacing={6} mb={3} p={3} borderWidth="1px" borderRadius="md" borderColor={borderColor} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
      {[
        { type: 'fresh', icon: Zap, color: 'green', count: fresh },
        { type: 'recent', icon: Calendar, color: 'blue', count: recent },
        { type: 'outdated', icon: Clock, color: 'yellow', count: outdated }
      ].map(({ type, icon: IconComponent, color, count }) => {
        const percentage = Math.round((count / total) * 100);
        return (
          <Box key={type} flex={1}>
            <Flex align="center" mb={1}>
              <Icon as={IconComponent} color={`${color}.500`} mr={2} boxSize={3} />
              <Text fontSize="xs" fontWeight="medium">{type.charAt(0).toUpperCase() + type.slice(1)}:</Text>
              <Text fontSize="xs" fontWeight="bold" ml="auto">{count} ({percentage}%)</Text>
            </Flex>
            <Progress value={percentage} size="xs" colorScheme={color} borderRadius="full" backgroundColor={bgColor} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'} />
          </Box>
        );
      })}
    </HStack>
  );
});

const PortfolioAllocationPanel = memo(({ portfolioAllocation, colorMode, topOpportunities = [], watchlist = [], avoidList = [] }) => {
  if (!portfolioAllocation || Object.keys(portfolioAllocation).length === 0) return null;
  const borderColor = colorMode === 'dark' ? 'gray.700' : 'gray.200';

  const maxPercentage = Math.max(...Object.values(portfolioAllocation).map(val => parseFloat(val)));

  const getCompanyNameForSymbol = (symbol) => {
    if (symbol.toLowerCase() === 'cash') return 'Cash Reserve';

    const allStocks = [...topOpportunities, ...watchlist, ...avoidList];
    const stockData = allStocks.find(stock => stock.symbol === symbol);
    return stockData?.companyName || '';
  };

  const sortedAllocations = Object.entries(portfolioAllocation)
    .map(([symbol, percentage]) => ({
      symbol,
      percentage: parseFloat(percentage),
      companyName: getCompanyNameForSymbol(symbol)
    }))
    .sort((a, b) => b.percentage - a.percentage);

  return (
    <Box borderWidth="1px" borderRadius="md" borderColor={borderColor} mb={3} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
      <Flex p={3} alignItems="center" borderBottom="1px solid" borderColor={borderColor} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
        <PieChart size={14} style={{ marginRight: '8px', color: 'var(--chakra-colors-purple-500)' }} />
        <Text fontSize="sm" fontWeight="bold">Recommended Portfolio Allocation</Text>
      </Flex>
      <Box p={3}>
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
          <VStack spacing={3} align="stretch">
            {sortedAllocations.map(({ symbol, percentage, companyName }, index) => {
              const relativePercentage = (percentage / maxPercentage) * 100;
              const barColor = getAssetColor(symbol, percentage, maxPercentage);

              return (
                <Box key={`allocation-${index}`}>
                  <Flex justify="space-between" mb={1}>
                    <Text fontSize="xs" fontWeight="medium" color="gray.500">
                      {companyName || (symbol.toLowerCase() === 'cash' ? 'Cash Reserve' : symbol)}
                    </Text>
                    <Text fontSize="xs" fontWeight="bold">{formatValue(percentage, {format: 'percent', decimals: 1})}</Text>
                  </Flex>

                  <Box position="relative" width="100%" height="24px" bg={colorMode === 'dark' ? 'whiteAlpha.200' : 'gray.100'} borderRadius="md" overflow="hidden">
                    <Box
                      position="absolute"
                      left={0}
                      top={0}
                      height="100%"
                      width={`${relativePercentage}%`}
                      bg={barColor}
                      transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                    />
                    <Flex
                      position="absolute"
                      left={0}
                      top={0}
                      width="100%"
                      height="100%"
                      alignItems="center"
                      px={3}
                    >
                      <Text
                        fontSize="sm"
                        fontWeight="bold"
                        color="black"
                        textShadow="0px 0px 3px rgba(255,255,255,0.5)"
                        noOfLines={1}
                      >
                        {symbol}
                      </Text>
                    </Flex>
                  </Box>
                </Box>
              );
            })}
          </VStack>
          <Box height="100%" width="100%" position="relative">
            <Box position="absolute" top="0" right="0" bottom="0" left="0">
              <ResponsiveContainer width="100%" height="100%">
                <ReChartPie>
                  <Pie
                    data={sortedAllocations.map(({ symbol, percentage, companyName }) => ({
                      name: symbol,
                      fullName: companyName || symbol,
                      value: percentage,
                      symbol: symbol
                    }))}
                    cx="50%"
                    cy="50%"
                    innerRadius="40%"
                    outerRadius="80%"
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                    isAnimationActive={CHART_ANIMATIONS.enabled}
                    animationDuration={CHART_ANIMATIONS.duration}
                    animationEasing={CHART_ANIMATIONS.easing}
                  >
                    {sortedAllocations.map(({ symbol, percentage }, index) => {
                      return (
                        <Cell
                          key={`cell-${index}`}
                          fill={getAssetColor(symbol, percentage, maxPercentage)}
                        />
                      );
                    })}
                  </Pie>
                </ReChartPie>
              </ResponsiveContainer>
            </Box>
          </Box>
        </SimpleGrid>
      </Box>
    </Box>
  );
});

const StocksTabPanel = memo(({ allStocks, buyStocks, holdStocks, sellStocks, viewMode, colorMode, onCardClick }) => {
  return (
    <Box borderWidth="1px" borderRadius="md" borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'} mb={3} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
      <Tabs colorScheme="blue" defaultIndex={0} variant="enclosed" size="sm">
        <TabList>
          <Tab fontWeight="medium" fontSize="sm" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>All ({allStocks.length})</Tab>
          <Tab fontWeight="medium" fontSize="sm" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>Buy ({buyStocks.length})</Tab>
          <Tab fontWeight="medium" fontSize="sm" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>Hold ({holdStocks.length})</Tab>
          <Tab fontWeight="medium" fontSize="sm" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>Sell ({sellStocks.length})</Tab>
        </TabList>
        <TabPanels>
          {[allStocks, buyStocks, holdStocks, sellStocks].map((stocks, idx) => (
            <TabPanel key={idx} p={3}>
              {viewMode === 'cards' ? (
                <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={3} alignItems="flex-start">
                  {stocks.map((stock, index) => (
                    <StockCard key={`stock-card-${idx}-${index}`} stock={stock} colorMode={colorMode} onCardClick={onCardClick} />
                  ))}
                </SimpleGrid>
              ) : (
                <StocksTable stocks={stocks} colorMode={colorMode} onRowClick={onCardClick} />
              )}
            </TabPanel>
          ))}
        </TabPanels>
      </Tabs>
    </Box>
  );
});

const PortfolioPanel = ({ portfolioRecommendation, isLoading, onRequestAnalysis, onCardClick }) => {
  const [viewMode, setViewMode] = useState('cards');
  const [expandedSections, setExpandedSections] = useState({
    marketOutlook: true, correlations: true, strategy: true, riskAssessment: true, improvements: true, options: true
  });
  const [lastRefresh, setLastRefresh] = useState(null);

  const toast = useToast();
  const { colorMode } = useColorMode();
  const textColor = colorMode === 'dark' ? 'gray.400' : 'gray.600';
  const borderColor = colorMode === 'dark' ? 'gray.700' : 'gray.200';

  useEffect(() => {
    // This effect now simply tracks when new data arrives to update the UI badge.
    // The periodic fetching is handled by the parent DashboardContent component.
    if (portfolioRecommendation) {
      setLastRefresh(new Date());
    }
  }, [portfolioRecommendation]);

  const toggleViewMode = useCallback(() => setViewMode(prev => prev === 'cards' ? 'table' : 'cards'), []);
  const toggleSection = useCallback((section) => setExpandedSections(prev => ({...prev, [section]: !prev[section]})), []);

  const handleRefresh = useCallback(() => {
    if (onRequestAnalysis) {
      onRequestAnalysis(true); // Request a forced refresh
      setLastRefresh(new Date()); // Optimistically update the refresh time
      showToast(toast, {
        title: 'Refreshing Portfolio Analysis',
        description: 'Requesting fresh market data and analysis',
        status: 'info'
      });
    }
  }, [onRequestAnalysis, toast]);

  const {
    topOpportunities = [], watchlist = [], avoidList = [], portfolioAllocation = {},
    recommendationStats = {}, stockCount = { buys: 0, holds: 0, sells: 0, total: 0 },
    timestamp: portfolioTimestamp, correlations = {}, marketOutlook = '',
    strategy = '', riskAssessment = '', optionsInsights = [],
    freshness: portfolioFreshness, alternativeInvestments = [],
    disclaimer = "This is for informational purposes only and not financial advice.",
    error = null
  } = portfolioRecommendation || {};

  const memoizedStockData = useMemo(() => {
    const buyStocks = topOpportunities.map(stock => ({ ...stock, action: 'BUY' }));
    const holdStocks = watchlist.map(stock => ({ ...stock, action: 'HOLD' }));
    const sellStocks = avoidList.map(stock => ({ ...stock, action: 'SELL' }));
    const allStocks = [...buyStocks, ...holdStocks, ...sellStocks];

    return { buyStocks, holdStocks, sellStocks, allStocks };
  }, [topOpportunities, watchlist, avoidList]);

  const { buyStocks, holdStocks, sellStocks, allStocks } = memoizedStockData;

  if (isLoading || !portfolioRecommendation || error) return null;

  return (
    <Box width="100%" p={3} display="flex" flexDirection="column">
      <Flex justify="space-between" mb={3} align="center">
        <Box>
          <Flex align="center" gap={2}>
            {lastRefresh && <TimeElapsedBadge timestamp={lastRefresh} />}
            {portfolioFreshness && <StatusBadge type="status" value={portfolioFreshness} icon={Zap} />}
          </Flex>
          <Text fontSize="xs" color={textColor}>Based on {stockCount.total} stock recommendations</Text>
        </Box>

        <HStack spacing={3}>
          {[
            { label: 'Buy', count: stockCount.buys, icon: TrendingUp, color: 'green.500' },
            { label: 'Hold', count: stockCount.holds, icon: Info, color: 'yellow.500' },
            { label: 'Sell', count: stockCount.sells, icon: TrendingDown, color: 'red.500' }
          ].map((item, idx) => (
            <Box key={idx} borderWidth="1px" borderRadius="md" borderColor={borderColor} p={2} display="flex" alignItems="center" justifyContent="center" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
              <item.icon size={16} style={{ marginRight: '8px', color: `var(--chakra-colors-${item.color})` }} />
              <Text fontSize="sm" fontWeight="medium" mr={1}>{item.label}:</Text>
              <Text fontSize="lg" fontWeight="bold" color={item.color}>{item.count}</Text>
            </Box>
          ))}
        </HStack>

        <Flex gap={2}>
          <Tooltip label={viewMode === 'cards' ? 'Switch to Table View' : 'Switch to Card View'}>
            <Button size="sm" colorScheme="gray" variant="outline" leftIcon={<Filter size={14} />} onClick={toggleViewMode} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
              {viewMode === 'cards' ? 'Table' : 'Cards'}
            </Button>
          </Tooltip>
          <Button size="sm" colorScheme="teal" leftIcon={<RefreshCw size={14} />} onClick={handleRefresh} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
            Refresh
          </Button>
        </Flex>
      </Flex>

      {recommendationStats && recommendationStats.total > 0 && <DataFreshnessStats stats={recommendationStats} colorMode={colorMode} />}

      <StocksTabPanel allStocks={allStocks} buyStocks={buyStocks} holdStocks={holdStocks} sellStocks={sellStocks} viewMode={viewMode} colorMode={colorMode} onCardClick={onCardClick} />

      <PortfolioAllocationPanel
        portfolioAllocation={portfolioAllocation}
        colorMode={colorMode}
        topOpportunities={topOpportunities}
        watchlist={watchlist}
        avoidList={avoidList}
      />

      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
        <PanelWrapper title="Day Trading Strategy" icon={Briefcase} isExpanded={expandedSections.strategy} onToggle={() => toggleSection('strategy')} colorMode={colorMode} colorKey="buy">
          <PanelContentBox colorMode={colorMode} colorKey="buy">
            <Text fontSize="sm" whiteSpace="pre-line">{strategy}</Text>
          </PanelContentBox>
        </PanelWrapper>
        <PanelWrapper title="Risk Assessment" icon={Shield} isExpanded={expandedSections.riskAssessment} onToggle={() => toggleSection('riskAssessment')} colorMode={colorMode} colorKey="sell">
          <PanelContentBox colorMode={colorMode} colorKey="sell">
            <Text fontSize="sm">{riskAssessment}</Text>
          </PanelContentBox>
        </PanelWrapper>
      </SimpleGrid>

      {optionsInsights && optionsInsights.length > 0 && (
        <PanelWrapper title="Options Market Insights" icon={BarChart} isExpanded={expandedSections.options} onToggle={() => toggleSection('options')} colorMode={colorMode} colorKey="hold">
          <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={3}>
            {optionsInsights.map((insight, idx) => (
              <Box key={`insight-${idx}`} p={2} borderWidth="1px" borderRadius="md" borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
                <Flex justify="space-between" align="center" mb={2}>
                  <Text fontWeight="bold" fontSize="sm">${insight.symbol}</Text>
                  <Badge colorScheme={insight.type === 'gamma_flip' ? 'purple' : 'teal'} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
                    {insight.type === 'gamma_flip' ? 'Gamma Flip' : 'Unusual Options'}
                  </Badge>
                </Flex>
                <Text fontSize="xs">{insight.description}</Text>
              </Box>
            ))}
          </SimpleGrid>
        </PanelWrapper>
      )}

      <PanelWrapper title="Market Outlook" icon={BarChart2} isExpanded={expandedSections.marketOutlook} onToggle={() => toggleSection('marketOutlook')} colorMode={colorMode} colorKey="tech">
        <Text fontSize="sm">{marketOutlook}</Text>
      </PanelWrapper>

      <PanelWrapper
        title="Portfolio Improvement Recommendations"
        icon={Shield}
        isExpanded={expandedSections.improvements}
        onToggle={() => toggleSection('improvements')}
        colorMode={colorMode}
        colorKey="purple"
      >
        <PortfolioImprovements
            portfolioAllocation={portfolioAllocation}
            correlations={correlations}
            topOpportunities={topOpportunities}
            watchlist={watchlist}
            avoidList={avoidList}
        />
      </PanelWrapper>

      {alternativeInvestments && alternativeInvestments.length > 0 && (
        <AlternativeSuggestionBubble
          alternativeInvestments={alternativeInvestments}
          onCardClick={onCardClick}
        />
      )}

      <Box borderWidth="1px" borderRadius="md" borderColor={colorMode === 'dark' ? 'gray.700' : 'gray.200'} p={2} mt={1} bg={colorMode === 'dark' ? 'gray.700' : 'gray.50'} transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
        <Flex align="center">
          <Info size={12} style={{ marginRight: '4px', color: 'var(--chakra-colors-yellow-500)' }} />
          <Text fontSize="xs" color={textColor}>{disclaimer}</Text>
        </Flex>
      </Box>
    </Box>
  );
};

export default React.memo(PortfolioPanel);