import React, { useMemo, useState } from 'react';
import {
  Box, FormControl, FormLabel, Select, Switch, VStack,
  Tooltip, Text, useColorMode, Divider, Alert, AlertIcon, Input,
  Badge, Collapse, IconButton, Flex
} from '@chakra-ui/react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  TIME_PERIODS,
  MARKET_SENTIMENT,
  DEFAULT_SETTINGS,
  UI_ANIMATIONS
} from '../config/Config';
import { getCurrentTime } from '../services/timeService';

const calculateWeightedAllocation = (keywords, totalArticles) => {
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return { allocation: {}, totalWeight: 0, keywordCount: 0 };
  }

  if (typeof keywords[0] === 'object' && keywords[0].term && keywords[0].weight !== undefined) {
    const totalWeight = keywords.reduce((sum, kw) => sum + (kw.weight || 0), 0);
    const allocation = {};

    keywords.forEach(kw => {
      const articles = totalWeight > 0 ? Math.max(1, Math.round((kw.weight / totalWeight) * totalArticles)) : 0;
      allocation[kw.term] = articles;
    });

    return { allocation, totalWeight, keywordCount: keywords.length };
  } else {
    const articlesPerKeyword = Math.floor(totalArticles / Math.max(1, keywords.length));
    const allocation = {};
    keywords.forEach(kw => {
      allocation[kw] = articlesPerKeyword;
    });

    return { allocation, totalWeight: keywords.length, keywordCount: keywords.length };
  }
};

const Settings = ({ settings = DEFAULT_SETTINGS, onSettingsChange, companyInfo }) => {
  const { colorMode } = useColorMode();
  const textColor = colorMode === 'dark' ? 'gray.500' : 'gray.600';
  const [showStockKeywords, setShowStockKeywords] = useState(false);
  const [showIndustryKeywords, setShowIndustryKeywords] = useState(false);
  const [showMarketKeywords, setShowMarketKeywords] = useState(false);

  const articleDistribution = useMemo(() => {
    const marketData = calculateWeightedAllocation(MARKET_SENTIMENT.KEYWORDS, settings.totalArticlesPerDay);

    if (!companyInfo) {
      return {
        stockKeywords: 3,
        stockAllocation: { "Company Name": 13, "Symbol": 8, "CEO": 5 },
        stockPerDay: settings.totalArticlesPerDay,
        stockTotal: settings.totalArticlesPerDay * settings.daysBack,

        industryKeywords: 5,
        industryAllocation: { "Primary Industry": 8, "Secondary Industry": 6, "Related Sectors": 4 },
        industryPerDay: settings.totalArticlesPerDay,
        industryTotal: settings.totalArticlesPerDay * settings.daysBack,

        marketKeywords: marketData.keywordCount,
        marketAllocation: marketData.allocation,
        marketPerDay: settings.totalArticlesPerDay,
        marketTotal: settings.totalArticlesPerDay * settings.daysBack
      };
    }

    const stockData = calculateWeightedAllocation(companyInfo.search_keywords, settings.totalArticlesPerDay);
    const industryData = calculateWeightedAllocation(companyInfo.industry_keywords, settings.totalArticlesPerDay);

    return {
      stockKeywords: stockData.keywordCount,
      stockAllocation: stockData.allocation,
      stockPerDay: settings.totalArticlesPerDay,
      stockTotal: settings.totalArticlesPerDay * settings.daysBack,

      industryKeywords: industryData.keywordCount,
      industryAllocation: industryData.allocation,
      industryPerDay: settings.totalArticlesPerDay,
      industryTotal: settings.totalArticlesPerDay * settings.daysBack,

      marketKeywords: marketData.keywordCount,
      marketAllocation: marketData.allocation,
      marketPerDay: settings.totalArticlesPerDay,
      marketTotal: settings.totalArticlesPerDay * settings.daysBack
    };
  }, [settings.totalArticlesPerDay, settings.daysBack, companyInfo]);

  const getSelectedTimePeriod = () => {
    const days = settings.daysBack;
    if (days <= 7) return "1week";
    if (days <= 14) return "2weeks";
    if (days <= 30) return "1month";
    return "3months";
  };

  return (
    <Box height="100%" width="100%" p={4} display="flex" flexDirection="column">
      <VStack spacing={4} align="stretch" flex="1">
        <FormControl>
          <Tooltip label="Time period for historical data analysis">
            <FormLabel fontSize="sm">Time Period</FormLabel>
          </Tooltip>
          <Select
            value={getSelectedTimePeriod()}
            onChange={(e) => onSettingsChange({
              ...settings,
              daysBack: TIME_PERIODS[e.target.value] || DEFAULT_SETTINGS.daysBack
            })}
            size="sm"
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          >
            <option value="1week">1 Week</option>
            <option value="2weeks">2 Weeks</option>
            <option value="1month">1 Month</option>
            <option value="3months">3 Months</option>
          </Select>
          <Text fontSize="xs" color={textColor} mt={1}>{settings.daysBack} days of historical data</Text>
        </FormControl>

        <FormControl>
          <Tooltip label="Articles per day for each category (stock, industry, market)">
            <FormLabel fontSize="sm">Articles Per Category Per Day</FormLabel>
          </Tooltip>
          <Select
            value={settings.totalArticlesPerDay}
            onChange={(e) => onSettingsChange({...settings, totalArticlesPerDay: Number(e.target.value)})}
            size="sm"
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          >
            <option value={5}>5 articles</option>
            <option value={10}>10 articles</option>
            <option value={15}>15 articles</option>
            <option value={20}>20 articles</option>
            <option value={30}>30 articles</option>
            <option value={40}>40 articles</option>
            <option value={50}>50 articles</option>
          </Select>

          <Alert status="info" size="sm" variant="subtle" mt={2} py={1} fontSize="xs">
            <AlertIcon />
            Each category (stock, industry, market) gets {settings.totalArticlesPerDay} articles per day.
          </Alert>

          {!companyInfo && (
            <Badge colorScheme="yellow" mt={2} mb={1}>
              Select a stock to see actual weighted keyword distribution
            </Badge>
          )}

          {companyInfo && Object.keys(articleDistribution.stockAllocation).length > 0 && (
            <Box mt={2} p={2} bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'} borderRadius="md">
              <Flex
                align="center"
                justify="space-between"
                cursor="pointer"
                onClick={() => setShowStockKeywords(!showStockKeywords)}
                _hover={{ bg: colorMode === 'dark' ? 'gray.700' : 'gray.100' }}
                p={1}
                borderRadius="sm"
                transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
              >
                <Text fontSize="xs" fontWeight="bold" color={textColor}>
                  Stock Keywords (weighted) - {articleDistribution.stockKeywords} keywords
                </Text>
                <IconButton
                  icon={showStockKeywords ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  size="xs"
                  variant="ghost"
                  aria-label={showStockKeywords ? "Hide stock keywords" : "Show stock keywords"}
                />
              </Flex>

              <Collapse in={showStockKeywords} animateOpacity>
                <Box mt={2}>
                  {Object.entries(articleDistribution.stockAllocation).map(([keyword, articles]) => (
                    <Text key={keyword} fontSize="xs" color={textColor}>
                      • {keyword}: {articles} articles/day
                    </Text>
                  ))}
                </Box>
              </Collapse>
            </Box>
          )}

          {companyInfo && Object.keys(articleDistribution.industryAllocation).length > 0 && (
            <Box mt={2} p={2} bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'} borderRadius="md">
              <Flex
                align="center"
                justify="space-between"
                cursor="pointer"
                onClick={() => setShowIndustryKeywords(!showIndustryKeywords)}
                _hover={{ bg: colorMode === 'dark' ? 'gray.700' : 'gray.100' }}
                p={1}
                borderRadius="sm"
                transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
              >
                <Text fontSize="xs" fontWeight="bold" color={textColor}>
                  Industry Keywords (weighted) - {articleDistribution.industryKeywords} keywords
                </Text>
                <IconButton
                  icon={showIndustryKeywords ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  size="xs"
                  variant="ghost"
                  aria-label={showIndustryKeywords ? "Hide industry keywords" : "Show industry keywords"}
                />
              </Flex>

              <Collapse in={showIndustryKeywords} animateOpacity>
                <Box mt={2}>
                  {Object.entries(articleDistribution.industryAllocation).map(([keyword, articles]) => (
                    <Text key={keyword} fontSize="xs" color={textColor}>
                      • {keyword}: {articles} articles/day
                    </Text>
                  ))}
                </Box>
              </Collapse>
            </Box>
          )}

          {Object.keys(articleDistribution.marketAllocation).length > 0 && (
            <Box mt={2} p={2} bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'} borderRadius="md">
              <Flex
                align="center"
                justify="space-between"
                cursor="pointer"
                onClick={() => setShowMarketKeywords(!showMarketKeywords)}
                _hover={{ bg: colorMode === 'dark' ? 'gray.700' : 'gray.100' }}
                p={1}
                borderRadius="sm"
                transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
              >
                <Text fontSize="xs" fontWeight="bold" color={textColor}>
                  Market Keywords (weighted) - {articleDistribution.marketKeywords} keywords
                </Text>
                <IconButton
                  icon={showMarketKeywords ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  size="xs"
                  variant="ghost"
                  aria-label={showMarketKeywords ? "Hide market keywords" : "Show market keywords"}
                />
              </Flex>

              <Collapse in={showMarketKeywords} animateOpacity>
                <Box mt={2}>
                  {Object.entries(articleDistribution.marketAllocation).map(([keyword, articles]) => (
                    <Text key={keyword} fontSize="xs" color={textColor}>
                      • {keyword}: {articles} articles/day
                    </Text>
                  ))}
                </Box>
              </Collapse>
            </Box>
          )}

          {!companyInfo && (
            <>
              <Text fontSize="xs" color={textColor} mt={1}>
                Stock: ~{Math.floor(settings.totalArticlesPerDay / 3)} articles per keyword (estimated)
              </Text>
              <Text fontSize="xs" color={textColor}>
                Industry: ~{Math.floor(settings.totalArticlesPerDay / 5)} articles per keyword (estimated)
              </Text>
            </>
          )}

          <Text fontSize="xs" color={textColor} mt={1}>
            Total: ~{articleDistribution.stockTotal + articleDistribution.industryTotal + articleDistribution.marketTotal} articles over {settings.daysBack} days
          </Text>
        </FormControl>

        <Divider my={1} />

        <FormControl display="flex" alignItems="center">
          <Tooltip label="Use faster but less accurate GPT model">
            <FormLabel htmlFor="turbo-mode" mb="0" fontSize="sm">Use Turbo Model</FormLabel>
          </Tooltip>
          <Switch
            id="turbo-mode"
            isChecked={settings.useTurboModel}
            onChange={(e) => onSettingsChange({...settings, useTurboModel: e.target.checked})}
            size="sm"
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          />
        </FormControl>

        <FormControl display="flex" alignItems="center">
          <Tooltip label="Enable automatic 7:30am and 8:30am (ET) analysis runs">
            <FormLabel htmlFor="scheduled-analysis" mb="0" fontSize="sm">
              Enable Scheduled Analysis
            </FormLabel>
          </Tooltip>
          <Switch
            id="scheduled-analysis"
            isChecked={settings.enableScheduledAnalysis}
            onChange={(e) => onSettingsChange({...settings, enableScheduledAnalysis: e.target.checked})}
            size="sm"
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          />
        </FormControl>

        <FormControl display="flex" alignItems="center">
          <Tooltip label="Disable automatic recommendation generation after analysis completes">
            <FormLabel htmlFor="disable-auto-recommendation" mb="0" fontSize="sm">
              Disable Auto-Recommendation
            </FormLabel>
          </Tooltip>
          <Switch
            id="disable-auto-recommendation"
            isChecked={settings.disableAutoRecommendation}
            onChange={(e) => onSettingsChange({...settings, disableAutoRecommendation: e.target.checked})}
            size="sm"
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          />
        </FormControl>

        <Divider my={1} />

        <FormControl display="flex" alignItems="center">
          <FormLabel htmlFor="time-override" mb="0" fontSize="sm">
            Time Override (Testing)
          </FormLabel>
          <Switch
            id="time-override"
            isChecked={settings.enableTimeOverride}
            onChange={(e) => {
              const checked = e.target.checked;
              let newSettings = {
                ...settings,
                enableTimeOverride: checked
              };

              if (checked && !settings.overrideDateTime) {
                const now = getCurrentTime();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');

                const today = `${year}-${month}-${day}T01:30`;
                newSettings.overrideDateTime = today;
              }

              onSettingsChange(newSettings);
            }}
            colorScheme="orange"
            size="sm"
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          />
        </FormControl>

        {settings.enableTimeOverride && (
          <FormControl mt={2}>
            <FormLabel fontSize="xs">Override Date/Time</FormLabel>
            <Input
              type="datetime-local"
              value={settings.overrideDateTime || getCurrentTime().toISOString().slice(0, 16)}
              onChange={(e) => onSettingsChange({
                ...settings,
                overrideDateTime: e.target.value
              })}
              size="sm"
              transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
            />
            <Text fontSize="xs" color="orange.500" mt={1}>
              System will run as if it were this time
            </Text>
            {settings.overrideDateTime && (
              <Text fontSize="xs" mt={1} fontWeight="medium">
                Local: {new Date(settings.overrideDateTime).toLocaleDateString(undefined, {weekday: 'long'})}, {new Date(settings.overrideDateTime).toLocaleString()}
                <br/>
                ET: {new Date(settings.overrideDateTime).toLocaleDateString('en-US', {weekday: 'long', timeZone: 'America/New_York'})}, {new Date(settings.overrideDateTime).toLocaleString('en-US', {timeZone: 'America/New_York'})} ET
              </Text>
            )}
          </FormControl>
        )}
      </VStack>
    </Box>
  );
};

export default Settings;