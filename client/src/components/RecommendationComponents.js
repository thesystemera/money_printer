import React, { useMemo, useState, useEffect } from 'react';
import {
  Box, Text, Button, VStack, HStack, Divider, Tooltip, Flex, Spinner, List,
  ListItem, ListIcon, Badge, SimpleGrid, Progress, Menu, MenuButton, MenuList,
  MenuItem, useColorMode, Link, Image, Collapse, useColorModeValue,
  Table, Thead, Tbody, Tr, Th, Td, TableContainer
} from '@chakra-ui/react';
import {
  ChevronDown, AlertTriangle, CheckCircle, Info, Clock,
  BarChart2, TrendingUp, History, RefreshCcw,
  ArrowLeft, Lightbulb, AlertCircle, Users, Signal
} from 'lucide-react';
import {
  getRecommendationColor, getRecommendationIcon, getVolatilityColor,
  groupPredictionsBySession, getUnifiedSessionStyles, processAnalysisText
} from './RecommendationHelper';
import { formatValue } from '../services/socketService';
import { fetchLogoUrl } from '../services/logoService';

export const PanelContainer = ({
  title,
  icon: Icon,
  iconColor,
  isExpanded,
  onToggleExpand,
  borderColor,
  children
}) => {
  const hoverBg = useColorModeValue('gray.50', 'gray.700');

  return (
    <Box borderWidth="1px" borderRadius="md" borderColor={borderColor} mb={4} overflow="hidden">
      <Flex
        p={4}
        justifyContent="space-between"
        alignItems="center"
        cursor="pointer"
        onClick={onToggleExpand}
        _hover={{ bg: hoverBg }}
        transition="background-color 0.2s ease-in-out"
      >
        <Flex align="center">
          {Icon && <Icon size={16} style={{ marginRight: '8px', color: `var(--chakra-colors-${iconColor})` }} />}
          <Text fontSize="sm" fontWeight="bold">{title}</Text>
        </Flex>
      </Flex>

      <Collapse in={isExpanded} animateOpacity transition={{ exit: { delay: 0.1 }, enter: { duration: 0.3 } }}>
        <Box p={4} pt={0} borderTop="1px solid" borderColor={borderColor}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
};

const MarkdownLinkParser = ({ text }) => {
  if (!text) return null;
  const parts = text.split(/(\[.*?\]\(.*?\))/g);
  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/\[(.*?)\]\((.*?)\)/);
        if (match) {
          const [, linkText, url] = match;
          return (
            <Link key={index} href={url} isExternal color="blue.400" _hover={{ textDecoration: 'underline' }} mx="1px">
              {`[${linkText}]`}
            </Link>
          );
        }
        return part;
      })}
    </>
  );
};

const TextWithMarkdownLinks = ({ text, textColor }) => {
  if (!text) return null;
  return (
    <Text as="span" fontSize="sm" whiteSpace="pre-line" color={textColor}>
      <MarkdownLinkParser text={text} />
    </Text>
  );
};

const MarkdownTable = ({ headers, rows }) => {
  const borderColor = useColorModeValue('gray.200', 'gray.600');
  const headerBg = useColorModeValue('gray.50', 'gray.700');

  return (
    <TableContainer borderWidth="1px" borderColor={borderColor} borderRadius="md" my={4}>
      <Table variant="simple" size="sm">
        <Thead bg={headerBg}>
          <Tr>
            {headers.map((header, index) => (
              <Th key={index} borderColor={borderColor}>{header}</Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((row, rowIndex) => (
            <Tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <Td key={cellIndex} borderColor={borderColor} whiteSpace="pre-wrap">
                  <MarkdownLinkParser text={cell} />
                </Td>
              ))}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </TableContainer>
  );
};

const AnalysisPanel = ({
  analysisText, isAnalysisOpen, toggleAnalysis, borderColor, textColor, title, icon: Icon, iconColor
}) => {
  const { sections, paragraphs } = useMemo(() => processAnalysisText(analysisText), [analysisText]);
  const bg = useColorModeValue("blackAlpha.50", "whiteAlpha.50");

  if (!analysisText) return null;

  const hasSections = sections.length > 0;

  return (
    <PanelContainer
      title={title}
      icon={Icon}
      iconColor={iconColor}
      isExpanded={isAnalysisOpen}
      onToggleExpand={toggleAnalysis}
      borderColor={borderColor}
    >
      <Box>
        {hasSections ? (
          <>
            {sections.map((section, idx) => (
              <Box
                key={`section-${idx}`}
                mb={3}
                p={3}
                borderRadius="md"
                borderLeft="3px solid"
                borderColor={iconColor}
                bg={idx % 2 === 0 ? "transparent" : bg}
              >
                <Text fontSize="sm" fontWeight="bold" mb={1} color={iconColor}>
                  {section.title.replace(/_/g, ' ')}
                </Text>
                {section.content.map((block, blockIdx) => {
                  if (block.type === 'table') {
                    return <MarkdownTable key={blockIdx} headers={block.data.headers} rows={block.data.rows} />;
                  }
                  if (block.type === 'paragraph') {
                    return <TextWithMarkdownLinks key={blockIdx} text={block.content} textColor={textColor} />;
                  }
                  return null;
                })}
              </Box>
            ))}
          </>
        ) : (
          <Box>
            {(() => {
              const paraBlocks = paragraphs.filter(p => p.type === 'paragraph');
              let paraIndex = -1;

              return paragraphs.map((block, idx) => {
                if (block.type === 'table') {
                  return <MarkdownTable key={`block-${idx}`} headers={block.data.headers} rows={block.data.rows} />;
                }

                paraIndex++;
                if (paraBlocks.length === 1) {
                  return (
                    <Box key={`block-${idx}`} p={3} borderRadius="md" borderLeft="3px solid" borderColor={iconColor}>
                      <TextWithMarkdownLinks text={block.content.trim()} textColor={textColor} />
                    </Box>
                  );
                } else {
                  return (
                    <Box
                      key={`block-${idx}`}
                      mb={3}
                      p={3}
                      borderRadius="md"
                      borderLeft="3px solid"
                      borderColor={iconColor}
                      bg={paraIndex % 2 !== 0 ? bg : "transparent"}
                    >
                      <TextWithMarkdownLinks text={block.content.trim()} textColor={textColor} />
                    </Box>
                  );
                }
              });
            })()}
          </Box>
        )}
      </Box>
    </PanelContainer>
  );
};

export const HistoricalSelector = ({
  selectedHistoricalRec, clearHistoricalSelection, historicalRecommendations,
  recommendation, isLoadingHistorical, fetchHistoricalRecommendation,
  companyInfo, setSelectedHistoricalRec, loadingSpecificRec
}) => {
  if (selectedHistoricalRec) {
    const targetDateStr = selectedHistoricalRec.target_trading_datetime
      ? new Date(selectedHistoricalRec.target_trading_datetime).toLocaleDateString()
      : new Date(selectedHistoricalRec.timestamp).toLocaleDateString();

    return (
      <Button
        size="xs"
        variant="outline"
        colorScheme="orange"
        leftIcon={<ArrowLeft size={14} />}
        onClick={clearHistoricalSelection}
        title="Return to current recommendation"
        isDisabled={loadingSpecificRec}
      >
        Back to Current ({targetDateStr})
      </Button>
    );
  }

  const filteredHistoricalRecs = historicalRecommendations.filter(rec => {
    if (!recommendation) return true;
    return rec.timestamp?.toString() !== recommendation.timestamp?.toString();
  });

  return (
    <Menu>
      <MenuButton
        as={Button}
        size="xs"
        variant="outline"
        colorScheme="purple"
        leftIcon={<History size={14} />}
        rightIcon={isLoadingHistorical || loadingSpecificRec ? null : <ChevronDown size={14} />}
        isDisabled={isLoadingHistorical || loadingSpecificRec}
        title="View previous recommendations"
      >
        {isLoadingHistorical ? (
          <Flex align="center"><Spinner size="xs" mr={2} />Loading...</Flex>
        ) : loadingSpecificRec ? (
          <Flex align="center"><Spinner size="xs" mr={2} />Loading Images...</Flex>
        ) : (
          `History (${filteredHistoricalRecs.length})`
        )}
      </MenuButton>
      <MenuList>
        {filteredHistoricalRecs.length === 0 ? (
          <MenuItem>No historical recommendations available</MenuItem>
        ) : (
          filteredHistoricalRecs
            .sort((a, b) => {
              const aTarget = a.target_trading_datetime ? new Date(a.target_trading_datetime) : new Date(a.timestamp);
              const bTarget = b.target_trading_datetime ? new Date(b.target_trading_datetime) : new Date(b.timestamp);
              return bTarget - aTarget;
            })
            .map((rec, index) => {
              const targetDateStr = rec.data?.target_trading_datetime
                ? new Date(rec.data.target_trading_datetime).toLocaleDateString()
                : new Date(rec.timestamp).toLocaleDateString();

              return (
                <MenuItem
                  key={`historical-${index}-${rec.timestamp}`}
                  onClick={() => setSelectedHistoricalRec(rec.data || rec)}
                  isDisabled={loadingSpecificRec}
                >
                  <Flex align="center">
                    <Box w="10px" h="10px" borderRadius="full" bg={`${getRecommendationColor(rec.action)}.500`} mr={2} />
                    <Text fontSize="sm">
                      {targetDateStr} - {rec.action} (
                      {Math.round((rec.confidence[rec.action.toLowerCase()] || 0) * 100)}%)
                    </Text>
                  </Flex>
                </MenuItem>
              );
            })
        )}
        <Divider my={2} />
        <MenuItem
          onClick={() => fetchHistoricalRecommendation(companyInfo.symbol)}
          isDisabled={loadingSpecificRec}
        >
          <Flex align="center">
            <RefreshCcw size={14} style={{ marginRight: '8px' }} />
            <Text>Fetch More Historical Data</Text>
          </Flex>
        </MenuItem>
      </MenuList>
    </Menu>
  );
};

export const MarketTimingSection = ({ marketTiming, borderColor, highlightBgColor }) => (
  <Box borderWidth="1px" borderRadius="md" borderColor={borderColor} mb={4}>
    <Flex p={4} justifyContent="space-between" alignItems="center">
      <Flex align="center">
        <Clock size={16} style={{ marginRight: '8px', color: 'var(--chakra-colors-purple-500)' }} />
        <Text fontSize="sm" fontWeight="bold">Market Timing</Text>
      </Flex>
    </Flex>
    <Box p={4} pt={0} borderTop="1px solid" borderColor={borderColor} bg={highlightBgColor}>
      <Text fontSize="sm" fontWeight="medium">{marketTiming}</Text>
    </Box>
  </Box>
);

export const SuggestionsSection = ({ suggestions, isSuggestionsOpen, toggleSuggestions, borderColor, textColor }) => (
  <PanelContainer
    title="Data Improvement Suggestions"
    icon={Lightbulb}
    iconColor="yellow.500"
    isExpanded={isSuggestionsOpen}
    onToggleExpand={toggleSuggestions}
    borderColor={borderColor}
  >
    <Box
      p={3}
      borderRadius="md"
      bg={useColorMode().colorMode === 'dark' ? 'blue.900' : 'blue.50'}
      borderLeft="3px solid"
      borderColor="yellow.400"
    >
      <Text fontSize="sm" whiteSpace="pre-line" color={textColor}>{suggestions}</Text>
    </Box>
  </PanelContainer>
);

const getEarningsUrgency = (earningsData) => {
  if (!earningsData?.hasEarningsData || earningsData.daysUntil === null) return null;
  const days = earningsData.daysUntil;
  if (days === 0) return { level: "🚨 EARNINGS TODAY", color: "red", pulse: true };
  if (days <= 1) return { level: "⚠️ EARNINGS TOMORROW", color: "orange", pulse: true };
  if (days <= 3) return { level: "📅 EARNINGS THIS WEEK", color: "yellow", pulse: false };
  if (days <= 7) return { level: "📅 EARNINGS NEXT WEEK", color: "blue", pulse: false };
  return null;
};

const ConfidenceBarGrid = ({ confidence, activeAction, colorMode, textColor }) => {
  const confidenceData = [
    { action: 'BUY', value: Math.round((confidence.buy || 0) * 100), colorScheme: 'green' },
    { action: 'HOLD', value: Math.round((confidence.hold || 0) * 100), colorScheme: 'yellow' },
    { action: 'SELL', value: Math.round((confidence.sell || 0) * 100), colorScheme: 'red' },
  ];

  return (
    <VStack align="stretch" spacing={2} mt={4}>
      <Text fontSize="sm" fontWeight="bold" color={textColor} mb={1}>Confidence Levels</Text>
      {confidenceData.map(({ action, value, colorScheme }) => (
        <Flex key={action} align="center">
          <Text fontSize="xs" fontWeight="bold" width="50px">{action}</Text>
          <Progress
            value={value}
            size="md"
            width="100%"
            colorScheme={colorScheme}
            borderRadius="md"
            backgroundColor={colorMode === 'dark' ? 'whiteAlpha.200' : 'gray.100'}
            hasStripe={activeAction === action}
            isAnimated={activeAction === action}
            mx={3}
          />
          <Text fontSize="sm" fontWeight="bold" width="50px" textAlign="right" color={`${colorScheme}.400`}>
            {value}%
          </Text>
        </Flex>
      ))}
    </VStack>
  );
};

const EarningsSummary = ({ earningsData }) => {
  const earningsUrgency = getEarningsUrgency(earningsData);
  if (!earningsUrgency) return null;

  const upcomingEarnings = earningsData?.upcomingEarnings;

  return (
    <Box
      bg={`${earningsUrgency.color}.500`}
      color="white"
      borderRadius="md"
      p={2}
      cursor="help"
      animation={earningsUrgency.pulse ? "pulse 2s infinite" : "none"}
      boxShadow="md"
      sx={{
        "@keyframes pulse": {
          "0%": { opacity: 1 },
          "50%": { opacity: 0.7 },
          "100%": { opacity: 1 }
        }
      }}
    >
      <Tooltip
        label={
          <VStack align="stretch" spacing={1}>
            <Text fontSize="sm" fontWeight="bold">
              📊 {upcomingEarnings?.quarter || 'Next Earnings'}
            </Text>
            <Text fontSize="xs">📅 Date: {upcomingEarnings?.date ? new Date(upcomingEarnings.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : 'TBD'}</Text>
            <Text fontSize="xs">⏰ Time: {upcomingEarnings?.reportTime || 'Unknown'}</Text>
            {upcomingEarnings?.epsEstimate && (
              <Text fontSize="xs">💰 EPS Est: ${upcomingEarnings.epsEstimate}</Text>
            )}
            {earningsData?.pattern && (
              <Text fontSize="xs">📈 Pattern: {earningsData.pattern.replace('_', ' ')}</Text>
            )}
            <Text fontSize="xs">⚠️ Risk: {earningsData?.earningsRisk}</Text>
            <Text fontSize="xs">📊 Volatility: {earningsData?.expectedVolatility}</Text>
          </VStack>
        }
        hasArrow
        placement="top"
      >
        <Text fontSize="sm" fontWeight="bold" textAlign="center">
          {earningsUrgency.level}
        </Text>
      </Tooltip>
    </Box>
  );
};

const getKeywordColor = (source, keywordCounts) => {
    const keywords = {
        'Market': { h: 210, s: 60 }, // Blue
        'Sentiment': { h: 160, s: 60 }, // Teal
        'Prediction': { h: 260, s: 60 }, // Purple
        'History': { h: 30, s: 60 }, // Orange
        'Options': { h: 185, s: 60 }, // Cyan
        'Vibe': { h: 350, s: 65 }, // Pink
        'Earnings': { h: 50, s: 65 }, // Yellow/Gold
        'Stock': { h: 120, s: 40 }, // Green
        'Default': { h: 220, s: 10 } // Grey
    };

    const lowerSource = source.toLowerCase();
    let keyword = 'Default';

    // Find the keyword that matches the source string
    for (const key in keywords) {
        if (lowerSource.includes(key.toLowerCase())) {
            keyword = key;
            break;
        }
    }

    // Increment the count for the found keyword to vary the shade
    const count = keywordCounts[keyword] || 0;
    keywordCounts[keyword] = count + 1;

    // Vary the lightness based on the count. Start at a mid-lightness and decrease.
    const baseLightness = 45;
    const lightness = Math.max(20, baseLightness - (count * 7)); // Ensure lightness doesn't go too dark
    const { h, s } = keywords[keyword];

    return `hsl(${h}, ${s}%, ${lightness}%)`;
};

const DataWeighting = ({ dataWeighting, borderColor }) => {
  // Corrected text color for better readability in both light and dark modes
  const overlayTextColor = useColorModeValue('gray.700', 'gray.50');
  const trackColor = useColorModeValue('gray.100', 'gray.600');
  const noteColor = useColorModeValue('gray.600', 'gray.400');

  const weightingFactors = useMemo(() => {
    if (!dataWeighting) return [];
    return Object.entries(dataWeighting)
      .filter(([key]) => key !== "note")
      .map(([source, data]) => ({
        source,
        value: typeof data === 'object' && data !== null ? data.value : data,
        explanation: typeof data === 'object' && data !== null ? data.explanation : '',
      }))
      .sort((a, b) => b.value - a.value);
  }, [dataWeighting]);

  // For normalization: get the highest value to set the scale
  const maxValue = weightingFactors.length > 0 ? weightingFactors[0].value : 0;
  const keywordCounts = {}; // Reset for each render to ensure consistent coloring

  if (weightingFactors.length === 0) return null;

  return (
    <Box mt={4} p={3} borderRadius="md" borderWidth="1px" borderColor={borderColor}>
      <Text fontSize="sm" fontWeight="bold" mb={3}>Data Weighting Analysis</Text>
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
        {weightingFactors.map(({ source, value, explanation }) => {
          const barColor = getKeywordColor(source, keywordCounts);
          const percentage = value * 100;
          const normalizedWidth = maxValue > 0 ? (value / maxValue) * 100 : 0;

          return (
            <Tooltip
              key={source}
              label={explanation || "No additional details available"}
              placement="top"
              hasArrow
            >
              <Box
                position="relative"
                w="100%"
                h="28px"
                bg={trackColor}
                borderRadius="md"
                overflow="hidden"
              >
                <Box
                  h="100%"
                  width={`${normalizedWidth}%`}
                  bg={barColor}
                  transition="width 0.3s ease-in-out"
                />
                <Flex
                  position="absolute"
                  top={0}
                  left={0}
                  right={0}
                  bottom={0}
                  align="center"
                  justify="space-between"
                  px={2}
                >
                  <Text fontSize="xs" fontWeight="medium" color={overlayTextColor} noOfLines={1}>
                    {source}
                  </Text>
                  <Text fontSize="xs" fontWeight="bold" color={overlayTextColor}>
                    {formatValue(percentage, { format: 'percent', decimals: 0 })}
                  </Text>
                </Flex>
              </Box>
            </Tooltip>
          );
        })}
      </SimpleGrid>
      {dataWeighting?.note && (
        <Text fontSize="xs" mt={3} fontStyle="italic" color={noteColor}>
          {dataWeighting.note}
        </Text>
      )}
    </Box>
  );
};


export const RecommendationHeader = ({ activeRecommendation, borderColor, textColor, colorMode }) => {
  const RecommendationIcon = getRecommendationIcon(activeRecommendation.action);
  const recommendationColor = getRecommendationColor(activeRecommendation.action);

  const [logoUrl, setLogoUrl] = useState(null);
  const [isLogoLoaded, setIsLogoLoaded] = useState(false);

  useEffect(() => {
    const getLogo = async () => {
      const companyName = activeRecommendation.rawData?.company?.name;
      const symbol = activeRecommendation.rawData?.company?.symbol;
      const url = await fetchLogoUrl(companyName, symbol);
      setLogoUrl(url);
    };

    setLogoUrl(null);
    setIsLogoLoaded(false);
    if (activeRecommendation.rawData?.company) {
      getLogo();
    }
  }, [activeRecommendation.rawData?.company?.name, activeRecommendation.rawData?.company?.symbol]);

  const actionExplanations = {
    BUY: {
      withStock: "Keep your existing position and consider adding more shares.",
      withoutStock: "Purchase shares at or near market open."
    },
    HOLD: {
      withStock: "Maintain your existing position; avoid adding more shares today.",
      withoutStock: "Stay on the sidelines; do not enter a new position today."
    },
    SELL: {
      withStock: "Liquidate your existing position at or near the market open.",
      withoutStock: "Consider a short position or avoid this stock entirely."
    },
    default: {
      withStock: "Insufficient data for a clear recommendation.",
      withoutStock: "Insufficient data for a clear recommendation."
    }
  };
  const explanation = actionExplanations[activeRecommendation.action] || actionExplanations.default;

  const targetDateTime = activeRecommendation.target_trading_datetime ? new Date(activeRecommendation.target_trading_datetime) : null;
  const formattedTargetDate = targetDateTime ? new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York'
  }).format(targetDateTime) : null;

  const companyInfo = activeRecommendation.rawData?.company;
  const earningsData = activeRecommendation.rawData?.earningsAnalysis;
  const dataWeighting = activeRecommendation.dataWeighting;

  return (
    <Box
      borderWidth="1px"
      borderRadius="md"
      borderColor={borderColor}
      mb={4}
      position="relative"
      overflow="hidden"
      _after={{
        content: '""',
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 1,
        bg: `linear-gradient(160deg, ${colorMode === 'dark' ? 'rgba(45, 55, 72, 0.6)' : 'rgba(255, 255, 255, 0.6)'} 30%, ${colorMode === 'dark' ? 'rgba(45, 55, 72, 0.98)' : 'rgba(255, 255, 255, 0.98)'} 100%)`
      }}
    >
      {logoUrl && (
        <Image
          src={logoUrl}
          alt={`${companyInfo?.name || ''} logo`}
          onLoad={() => setIsLogoLoaded(true)}
          position="absolute"
          top="8%"
          right="4%"
          maxW="35%"
          maxH="35%"
          objectFit="contain"
          transform="rotateZ(10deg)"
          opacity={isLogoLoaded ? 0.6 : 0}
          transition="opacity 0.5s ease-in-out"
          zIndex={0}
          pointerEvents="none"
        />
      )}

      <Box position="relative" zIndex={2}>
        <Flex p={4} mb={0} justifyContent="space-between" alignItems="flex-start" borderBottom="1px solid" borderColor={borderColor}>
          <Flex align="center" flex="1">
            <Box borderRadius="full" bg={`${recommendationColor}.900`} p={2} mr={3}>
              <RecommendationIcon color={`var(--chakra-colors-${recommendationColor}-500)`} size={24} />
            </Box>
            <VStack align="flex-start" spacing={1}>
              <Text fontSize="sm" color={textColor}>Recommendation for {companyInfo?.name || companyInfo?.symbol}</Text>
              <HStack spacing={2}>
                <Text fontSize="xl" fontWeight="bold" color={`${recommendationColor}.400`}>
                  {activeRecommendation.action}
                </Text>
                {targetDateTime && <Badge colorScheme="blue" fontSize="xs">For {formattedTargetDate}</Badge>}
              </HStack>
              <Box mt={2} p={2} borderRadius="md" bg={colorMode === 'dark' ? `${recommendationColor}.900` : `${recommendationColor}.50`} borderLeft="3px solid" borderColor={`${recommendationColor}.500`} maxW="400px">
                <Text fontSize="xs" fontWeight="bold" mb={1}>If you already own shares:</Text>
                <Text fontSize="xs">{explanation.withStock}</Text>
                <Text fontSize="xs" fontWeight="bold" mt={2} mb={1}>If you don't own shares:</Text>
                <Text fontSize="xs">{explanation.withoutStock}</Text>
              </Box>
            </VStack>
          </Flex>
          <VStack align="flex-end" spacing={3}>
            <EarningsSummary earningsData={earningsData} />
          </VStack>
        </Flex>

        <Box p={4}>
          <Text fontSize="md" fontWeight="bold" mb={3}>{activeRecommendation.summary}</Text>
          <Text fontSize="sm" color={textColor} whiteSpace="pre-line">{activeRecommendation.reasoning}</Text>

          <ConfidenceBarGrid
            confidence={activeRecommendation.confidence}
            activeAction={activeRecommendation.action}
            colorMode={colorMode}
            textColor={textColor}
          />

          <DataWeighting dataWeighting={dataWeighting} borderColor={borderColor} colorMode={colorMode} textColor={textColor} />
        </Box>
      </Box>
    </Box>
  );
};

export const MarketContextSection = ({ marketContext, isMarketContextOpen, toggleMarketContext, borderColor }) => (
  <PanelContainer
    title="Market Context"
    icon={BarChart2}
    iconColor="blue.500"
    isExpanded={isMarketContextOpen}
    onToggleExpand={toggleMarketContext}
    borderColor={borderColor}
  >
    <Text fontSize="sm">{marketContext}</Text>
  </PanelContainer>
);

export const VolatilitySection = ({ volatility, isVolatilityOpen, toggleVolatility, borderColor }) => {
  const level = volatility?.match(/INTRADAY VOLATILITY\s*(\w+)/i)?.[1]?.toUpperCase() || "MEDIUM";
  const description = volatility?.match(/INTRADAY VOLATILITY\s*\w+\s+(.*)/i)?.[1] || volatility;
  const volatilityColor = getVolatilityColor(level);

  return (
    <PanelContainer
      title="Intraday Volatility"
      icon={AlertTriangle}
      iconColor={`${volatilityColor}.500`}
      isExpanded={isVolatilityOpen}
      onToggleExpand={toggleVolatility}
      borderColor={borderColor}
    >
      <Flex align="center">
        <Badge colorScheme={volatilityColor} px={2} py={1} mr={2} fontSize="xs" fontWeight="bold">{level}</Badge>
        <Text fontSize="sm">{description}</Text>
      </Flex>
    </PanelContainer>
  );
};

export const StrategySection = ({ dayTradingStrategy, isStrategyOpen, toggleStrategy, borderColor }) => (
  <PanelContainer
    title="Day Trading Strategy"
    icon={TrendingUp}
    iconColor="blue.500"
    isExpanded={isStrategyOpen}
    onToggleExpand={toggleStrategy}
    borderColor={borderColor}
  >
    <Text fontSize="sm" whiteSpace="pre-line">{dayTradingStrategy}</Text>
  </PanelContainer>
);

export const PredictionSynthesisSection = ({ predictionSynthesis, isPredictionSynthesisOpen, togglePredictionSynthesis, borderColor, textColor }) => (
  <PanelContainer
    title="Prediction Synthesis"
    icon={BarChart2}
    iconColor="teal.500"
    isExpanded={isPredictionSynthesisOpen}
    onToggleExpand={togglePredictionSynthesis}
    borderColor={borderColor}
  >
    <Box p={3} borderRadius="md" bg={useColorMode().colorMode === 'dark' ? 'teal.900' : 'teal.50'} borderLeft="3px solid" borderColor="teal.400">
      <Text fontSize="sm" whiteSpace="pre-line" color={textColor}>{predictionSynthesis}</Text>
    </Box>
  </PanelContainer>
);

export const ImageAnalysisSection = ({
  imageAnalysis, isImageAnalysisOpen, toggleImageAnalysis, borderColor, textColor,
}) => (
  <AnalysisPanel
    analysisText={imageAnalysis}
    isAnalysisOpen={isImageAnalysisOpen}
    toggleAnalysis={toggleImageAnalysis}
    borderColor={borderColor}
    textColor={textColor}
    title="Chart Visualization Analysis"
    icon={BarChart2}
    iconColor="purple.500"
  />
);

export const OptionsAnalyticsSection = ({
  optionsAnalysis, isOptionsAnalysisOpen, toggleOptionsAnalysis, borderColor, textColor,
}) => (
  <AnalysisPanel
    analysisText={optionsAnalysis}
    isAnalysisOpen={isOptionsAnalysisOpen}
    toggleAnalysis={toggleOptionsAnalysis}
    borderColor={borderColor}
    textColor={textColor}
    title="Options Market Expert Analysis"
    icon={AlertCircle}
    iconColor="blue.500"
  />
);

export const VibeAnalysisSection = ({
    vibeAnalysis, isVibeAnalysisOpen, toggleVibeAnalysis, borderColor, textColor,
  }) => (
    <AnalysisPanel
      analysisText={vibeAnalysis}
      isAnalysisOpen={isVibeAnalysisOpen}
      toggleAnalysis={toggleVibeAnalysis}
      borderColor={borderColor}
      textColor={textColor}
      title="Vibe & Narrative Analysis"
      icon={Users}
      iconColor="orange.500"
    />
);

export const SignalReliabilityLogSection = ({
  signalReliabilityLog, isSignalLogOpen, toggleSignalLog, borderColor, textColor
}) => (
  <AnalysisPanel
    analysisText={signalReliabilityLog}
    isAnalysisOpen={isSignalLogOpen}
    toggleAnalysis={toggleSignalLog}
    borderColor={borderColor}
    textColor={textColor}
    title="Signal Reliability Log"
    icon={Signal}
    iconColor="cyan.500"
  />
);

export const HourlyPriceTable = ({ predictions, borderColor, colorMode }) => {
  const groupedPredictions = useMemo(() => groupPredictionsBySession(predictions), [predictions]);
  const unifiedStyles = useMemo(() => getUnifiedSessionStyles(colorMode), [colorMode]);

  const renderTimeSlot = (item, idx, sessionType) => {
    const isSpecialHour = item.hour === "09:30" || item.hour === "16:00";
    let style = sessionType === 'regular' ?
      (item.hour === "09:30" ? unifiedStyles.regular :
       item.hour === "16:00" ? unifiedStyles.marketClose : unifiedStyles.regular) :
      unifiedStyles[sessionType];

    return (
      <Box key={`${sessionType}-${idx}`} p={1} borderRadius="md" bg={style.bg}>
        <Flex justify="space-between">
          <Text fontSize="xs" fontWeight="medium">{item.hour}</Text>
          <Text
            fontSize="xs"
            fontWeight={isSpecialHour ? "bold" : "medium"}
            color={style.color}
          >
            {formatValue(item.price, {format: 'currency'})}
          </Text>
        </Flex>
        {item.volatility_range !== undefined && (
          <Text fontSize="10px" color="gray.500" textAlign="center">
            ±{item.volatility_range.toFixed(1)}%
          </Text>
        )}
      </Box>
    );
  };

  const sessionConfig = [
    { type: 'preMarket', title: 'Pre-Market', data: groupedPredictions.preMarket },
    { type: 'regular', title: 'Regular Market Hours', data: groupedPredictions.regular },
    { type: 'afterHours', title: 'After Hours', data: groupedPredictions.afterHours }
  ];

  return (
    <Box borderWidth="1px" borderRadius="md" borderColor={borderColor} mb={4}>
      <Flex p={4} justifyContent="space-between" alignItems="center">
        <Flex align="center">
          <Clock size={16} style={{ marginRight: '8px', color: 'var(--chakra-colors-purple-500)' }} />
          <Text fontSize="sm" fontWeight="bold">Hourly Price Predictions</Text>
        </Flex>
      </Flex>
      <Box p={4} pt={0} borderTop="1px solid" borderColor={borderColor}>
        <SimpleGrid columns={3} spacing={4} mb={2}>
          {sessionConfig.map(session => (
            <Box key={session.type}>
              <Text fontSize="xs" fontWeight="bold" color={unifiedStyles[session.type].color} mb={2}>{session.title}</Text>
              <VStack align="stretch" spacing={1}>
                {session.data.map((item, idx) => renderTimeSlot(item, idx, session.type))}
              </VStack>
            </Box>
          ))}
        </SimpleGrid>
      </Box>
    </Box>
  );
};

export const FactorsSection = ({ factors, isFactorsOpen, toggleFactors, borderColor }) => {
  const filteredFactors = useMemo(() => {
    return factors.filter(factor => {
      const lowerFactor = factor.toLowerCase();
      return !(
        lowerFactor.includes('day trading strategy') ||
        lowerFactor.includes('look for entry opportunities') ||
        lowerFactor.includes('intraday volatility') ||
        lowerFactor.startsWith('daytime strategy') ||
        (lowerFactor.includes(':') && lowerFactor.match(/^\d{2}:\d{2}/)) ||
        lowerFactor.includes('price predictions')
      );
    });
  }, [factors]);

  return (
    <PanelContainer
      title="Key Factors"
      icon={CheckCircle}
      iconColor="green.500"
      isExpanded={isFactorsOpen}
      onToggleExpand={toggleFactors}
      borderColor={borderColor}
    >
      <List spacing={2}>
        {filteredFactors.map((factor, index) => (
          <ListItem key={`factor-${index}`} fontSize="sm">
            <ListIcon as={Info} color="blue.500" />
            {factor}
          </ListItem>
        ))}
      </List>
    </PanelContainer>
  );
};

export const DetailsSection = ({
  activeRecommendation, rawData, isDetailsOpen, toggleDetails, borderColor, textColor
}) => (
  <PanelContainer
    title="Analysis Details"
    icon={Info}
    iconColor="blue.500"
    isExpanded={isDetailsOpen}
    onToggleExpand={toggleDetails}
    borderColor={borderColor}
  >
    <VStack align="stretch" spacing={3}>
      <Box>
        <Text fontSize="xs" color={textColor}>Analysis Generated</Text>
        <Text fontSize="sm">
          {new Date(activeRecommendation.timestamp).toLocaleString()}
          <Text as="span" fontSize="xs" color={textColor} ml={1}>(Local Time)</Text>
        </Text>
      </Box>

      {activeRecommendation.target_trading_datetime && (
        <>
          <Divider />
          <Box>
            <Text fontSize="xs" color={textColor}>Target Trading Date</Text>
            <Text fontSize="sm">{new Date(activeRecommendation.target_trading_datetime).toLocaleString(undefined, {timeZone: 'America/New_York'})} ET</Text>
          </Box>
        </>
      )}

      <Divider />
      <Box>
        <Text fontSize="xs" color={textColor}>Analysis Source</Text>
        <Flex>
          <Text fontSize="sm">{rawData.sentimentAnalysis.stockArticles.count} stock articles</Text>
          <Text fontSize="sm" ml={2}>
            + {rawData.sentimentAnalysis.industryArticles.count} industry articles
          </Text>
          <Text fontSize="sm" ml={2}>
            + {rawData.sentimentAnalysis.marketArticles.count} market articles
          </Text>
        </Flex>
      </Box>
      <Divider />
      <Text fontSize="xs" color="orange.500">{activeRecommendation.disclaimer}</Text>
    </VStack>
  </PanelContainer>
);

export const PredictionHistorySection = ({
  predictionHistoryInsights,
  isPredictionHistoryOpen,
  togglePredictionHistory,
  borderColor,
  textColor
}) => (
  <PanelContainer
    title="Prediction History Insights"
    icon={History}
    iconColor="blue.500"
    isExpanded={isPredictionHistoryOpen}
    onToggleExpand={togglePredictionHistory}
    borderColor={borderColor}
  >
    <Box p={3} borderRadius="md" bg={useColorMode().colorMode === 'dark' ? 'blue.900' : 'blue.50'} borderLeft="3px solid" borderColor="blue.400">
      <Text fontSize="sm" whiteSpace="pre-line" color={textColor}>{predictionHistoryInsights}</Text>
    </Box>
  </PanelContainer>
);