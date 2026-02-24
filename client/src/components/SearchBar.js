import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Input, InputGroup, InputLeftElement, InputRightElement,
  Button, Flex, Text, useColorMode, Badge,
  Popover, PopoverTrigger, PopoverContent, PopoverBody,
  List, ListItem, Divider, Icon, Tooltip,
  HStack, VStack, Avatar, SimpleGrid, IconButton,
  useToast, Wrap, WrapItem
} from '@chakra-ui/react';
import { Search, AlertTriangle, TrendingUp, BarChart,
         RefreshCw, Calendar, X, Clock } from 'lucide-react';
import { searchStocks, getStockSuggestions, fetchStockInfo, refreshMarketData } from '../services/apiService';
import { debounce } from 'lodash';
import { SYSTEM, API, UI_ANIMATIONS } from '../config/Config';
import { showToast, handleError, addLog, sendCancelMessage } from '../services/socketService';
import { getCurrentTime } from '../services/timeService';
import { InlineLoading } from './SentimentChartComponents';

const getTimestampStyle = (dateString) => {
  if (!dateString) return { color: 'gray.500' };

  const searchDate = new Date(dateString);
  const now = new Date();
  const diffMs = now - searchDate;
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) {
    return { colorScheme: 'green', color: 'green.300' };
  }
  else if (diffHours < 4) {
    return { colorScheme: 'yellow', color: 'yellow.400' };
  }
  else if (diffHours > 24) {
    return { colorScheme: 'red', color: 'red.400' };
  }
  return { colorScheme: 'orange', color: 'orange.400' };
};

const getActionColor = (action) => {
  switch (action?.toUpperCase()) {
    case 'BUY': return 'green';
    case 'SELL': return 'red';
    case 'HOLD': return 'gray';
    default: return 'yellow';
  }
};

export const formatDuration = (ms) => {
  if (!ms || ms < 1000) {
    return "<1s";
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${seconds}s`;
};

const TimestampDisplay = ({ dateString, showLabel = true }) => {
  const { colorMode } = useColorMode();
  const style = getTimestampStyle(dateString);
  const date = new Date(dateString);

  const now = new Date();
  const diffMs = now - date;
  const diffHours = diffMs / (1000 * 60 * 60);

  let displayText;
  if (diffHours < 1) {
    const diffMinutes = Math.round(diffMs / (1000 * 60));
    displayText = `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    const hours = Math.floor(diffHours);
    displayText = `${hours}h ago`;
  } else {
    const days = Math.floor(diffHours / 24);
    displayText = `${days}d ago`;
  }

  return (
    <Tooltip label={`Analyzed at: ${date.toLocaleString()}`} placement="top">
        <Badge
            variant="outline"
            colorScheme={style.colorScheme}
            fontSize="0.7em"
            display="flex"
            alignItems="center"
        >
            <Icon as={Clock} size="12px" mr={1} />
            {displayText}
        </Badge>
    </Tooltip>
  );
};

const KeywordBadge = ({ keyword }) => {
    let term, weight, color;
    if (typeof keyword === 'object' && keyword.term) {
        term = keyword.term;
        weight = keyword.weight;
        color = keyword.color || 'gray';
    } else {
        term = String(keyword);
        color = 'gray';
    }

    return (
        <WrapItem>
            <Badge colorScheme={color} variant="subtle" fontSize="0.75em">
                {term}{weight !== undefined && ` (${weight})`}
            </Badge>
        </WrapItem>
    );
};

const SearchBar = ({
  onSearch, isLoading, settingsChanged, companyInfo = null,
  currentSymbol = '', marketKeywords = [], recentSearches = [], onRecentSearchesChange,
  onRecentSearchClick
}) => {
  const [symbol, setSymbol] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [suggestions, setSuggestions] = useState({});
  const [isSearching, setIsSearching] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isValidSymbol, setIsValidSymbol] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const { colorMode } = useColorMode();
  const searchInputRef = useRef(null);
  const popoverRef = useRef(null);
  const toast = useToast();

  const textColor = colorMode === 'dark' ? 'gray.500' : 'gray.600';
  const bgColor = colorMode === 'dark' ? 'gray.700' : 'white';
  const hoverBgColor = colorMode === 'dark' ? 'gray.600' : 'gray.100';

  useEffect(() => {
    const loadSuggestions = async () => {
      const data = await getStockSuggestions();
      setSuggestions(data);
      setLastRefresh(getCurrentTime());
    };
    loadSuggestions();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target) &&
          searchInputRef.current && !searchInputRef.current.contains(event.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const debouncedSearch = useRef(
    debounce(async (query) => {
      if (query.length >= 1) {
        setIsSearching(true);
        const results = await searchStocks(query);
        setSearchResults(results);
        setIsValidSymbol(results.length > 0);
        setIsSearching(false);
        setShowResults(true);
      } else {
        setSearchResults([]);
        setIsValidSymbol(true);
        setShowResults(false);
      }
    }, API.DEBOUNCE_TIME)
  ).current;

  const handleInputChange = (e) => {
    setSymbol(e.target.value);
    debouncedSearch(e.target.value);
  };

  const performSearch = (stockSymbol) => {
    onSearch(stockSymbol);
    setShowResults(false);
    setIsSearching(false);
  };

  const handleCancel = () => {
    if (!currentSymbol) {
      addLog('No active analysis to cancel', 'warning');
      return;
    }

    const success = sendCancelMessage(currentSymbol);
    if (success) {
      showToast(toast, {
        title: 'Cancellation Requested',
        description: `Requested cancellation of analysis for ${currentSymbol}`,
        status: 'warning'
      });
    } else {
      showToast(toast, {
        title: 'Cancel Failed',
        description: 'Unable to send cancellation request. Please check connection.',
        status: 'error'
      });
    }
  };

  const handleRemoveSearch = (symbolToRemove) => {
    const updatedSearches = recentSearches.filter(item => item.symbol !== symbolToRemove);
    onRecentSearchesChange(updatedSearches);
    try {
      localStorage.setItem('recentStockSearches', JSON.stringify(updatedSearches));
      addLog(`Removed ${symbolToRemove} from recent searches`, 'info');
    } catch (e) {
      addLog('Error saving recent searches', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!symbol.trim()) return;

    const symbolToSearch = symbol.trim().toUpperCase();
    setIsSearching(true);

    try {
      await fetchStockInfo(symbolToSearch);
      performSearch(symbolToSearch);
    } catch (error) {
      setIsSearching(false);

      if (error.message?.includes("404")) {
        showToast(toast, {
          title: "Invalid Stock Symbol",
          description: `The stock symbol "${symbolToSearch}" was not found in our database.`,
          status: "error"
        });
        setIsValidSymbol(false);
      } else {
        handleError(error, `Searching for stock ${symbolToSearch}`, toast);
      }
    }
  };

  const handleRefreshMarketData = async () => {
    try {
      setIsRefreshing(true);
      await refreshMarketData();
      const data = await getStockSuggestions(null, true);
      setSuggestions(data);
      setLastRefresh(getCurrentTime());

      showToast(toast, {
        title: "Market Data Refreshed",
        description: "The latest market data has been loaded.",
        status: "success"
      });
    } catch (error) {
      handleError(error, "Refreshing market data", toast);
    } finally {
      setIsRefreshing(false);
    }
  };

  const renderSuggestionCategory = (category, title, icon) => {
    const stocks = suggestions[category];
    if (!stocks || !stocks.length) {
      return (
        <Box mb={3}>
          <Flex align="center" mb={1}>
            <Icon as={icon} mr={1} color="blue.400" />
            <Text fontSize="xs" fontWeight="bold" color={textColor}>{title}</Text>
          </Flex>
          <Text fontSize="xs" color="gray.500" fontStyle="italic">No stocks available</Text>
        </Box>
      );
    }

    return (
      <Box mb={3}>
        <Flex align="center" mb={1}>
          <Icon as={icon} mr={1} color="blue.400" />
          <Text fontSize="xs" fontWeight="bold" color={textColor}>{title}</Text>
        </Flex>
        <SimpleGrid columns={[2, 3]} spacing={2}>
          {stocks.map(stock => (
            <Button
              key={stock.symbol} size="xs" variant="outline" width="100%"
              justifyContent="flex-start" overflow="hidden" title={stock.name}
              onClick={() => performSearch(stock.symbol)} disabled={isLoading}
              transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
            >
              <Text as="span" fontWeight="bold" mr={1}>{stock.symbol}</Text>
              <Text as="span" fontSize="xs" noOfLines={1}>{stock.name}</Text>
            </Button>
          ))}
        </SimpleGrid>
      </Box>
    );
  };

  return (
    <Box width="100%" height="100%" p={4} display="flex" flexDirection="column">
      {settingsChanged && (
        <Badge colorScheme="yellow" display="flex" alignItems="center" mb={3}>
          <AlertTriangle size={14} style={{ marginRight: '4px' }} />
          Settings changed
        </Badge>
      )}

      <form onSubmit={handleSubmit}>
        <Flex position="relative">
          <Popover
            isOpen={showResults && (searchResults.length > 0 || isSearching)}
            autoFocus={false} placement="bottom" gutter={4} matchWidth={true}
          >
            <PopoverTrigger>
              <InputGroup size="md" ref={searchInputRef}>
                <InputLeftElement pointerEvents="none">
                  <Search size={18} color={colorMode === 'dark' ? "#718096" : "#4A5568"} />
                </InputLeftElement>
                <Input
                  value={symbol} onChange={handleInputChange}
                  placeholder="Search by symbol or company name"
                  borderRadius="md" disabled={isLoading}
                  isInvalid={!isValidSymbol && symbol.trim() !== ''}
                  onFocus={() => {
                    if (symbol.length >= 1 && searchResults.length > 0) setShowResults(true);
                  }}
                  transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                />
                <InputRightElement width="4.5rem">
                  {isSearching && !isLoading ? (
                    <IconButton
                      icon={<RefreshCw size={14} />}
                      aria-label="Searching"
                      size="xs"
                      variant="ghost"
                      isLoading={true}
                      transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                    />
                  ) : (
                    !isValidSymbol && symbol.trim() !== '' && (
                      <Tooltip label="Symbol not found">
                        <AlertTriangle size={16} color="red" />
                      </Tooltip>
                    )
                  )}
                </InputRightElement>
              </InputGroup>
            </PopoverTrigger>

            <PopoverContent
              ref={popoverRef} bg={bgColor} _focus={{ outline: 'none' }}
              borderColor={colorMode === 'dark' ? 'gray.600' : 'gray.200'}
              boxShadow="lg"
              transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
            >
              <PopoverBody p={0}>
                {isSearching ? (
                  <Flex justify="center" align="center" py={4}>
                    <InlineLoading label="Searching..." />
                  </Flex>
                ) : searchResults.length > 0 ? (
                  <List spacing={0}>
                    {searchResults.map((stock, index) => (
                      <ListItem
                        key={index} py={2} px={3} cursor="pointer"
                        _hover={{ bg: hoverBgColor }}
                        onClick={() => { setSymbol(stock.symbol); performSearch(stock.symbol); }}
                        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                      >
                        <HStack>
                          <Avatar
                            name={stock.symbol} size="xs" fontSize="xs"
                            bg="blue.500" color="white" fontWeight="bold"
                          />
                          <VStack spacing={0} align="flex-start">
                            <Text fontWeight="bold">{stock.symbol}</Text>
                            <Text fontSize="xs" noOfLines={1}>{stock.name}</Text>
                          </VStack>
                          {stock.sector && (
                            <Badge size="sm" colorScheme="green" ml="auto">{stock.sector}</Badge>
                          )}
                        </HStack>
                      </ListItem>
                    ))}
                  </List>
                ) : (
                  <Box p={4} textAlign="center">
                    <Text color="gray.500">No matching stocks found</Text>
                  </Box>
                )}
              </PopoverBody>
            </PopoverContent>
          </Popover>

          <Button
            ml={2}
            isLoading={isLoading || isSearching}
            colorScheme={isLoading ? "red" : (settingsChanged ? "yellow" : "blue")}
            type={isLoading ? "button" : "submit"}
            onClick={isLoading ? handleCancel : undefined}
            disabled={(!symbol.trim() || (!isValidSymbol && symbol.trim() !== '')) && !isLoading}
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          >
            {isLoading ? "Cancel" : (settingsChanged ? "Apply & Analyze" : "Analyze")}
          </Button>
        </Flex>
      </form>

      <Flex justifyContent="space-between" alignItems="center" mt={3}>
        <Flex align="center">
          <Text fontSize="xs" color={textColor} mr={1}>
            Last refreshed:
          </Text>
          <Text
            fontSize="xs"
            {...getTimestampStyle(lastRefresh ? lastRefresh.toISOString() : null)}
          >
            {lastRefresh ? lastRefresh.toLocaleTimeString() : "Never refreshed"}
          </Text>
        </Flex>
        <Tooltip label="Refresh market data">
          <IconButton
            icon={<RefreshCw size={14} />} aria-label="Refresh market data"
            size="xs" variant="ghost" isLoading={isRefreshing}
            onClick={handleRefreshMarketData}
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          />
        </Tooltip>
      </Flex>

      <Box mt={2}>
        {recentSearches.length > 0 && (
          <Box mb={3}>
            <Text fontSize="xs" color={textColor} mb={1}>Recent searches:</Text>
            <Wrap spacing={2}>
              {recentSearches.map(item => (
                <WrapItem key={item.symbol}>
                  <Flex
                    p={1}
                    bg={hoverBgColor}
                    borderRadius="md"
                    align="center"
                    boxShadow="sm"
                  >
                    <Tooltip label="Remove from recent searches">
                      <IconButton
                        size="xs"
                        icon={<X size={14} />}
                        variant="ghost"
                        colorScheme="red"
                        aria-label="Remove from recent searches"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveSearch(item.symbol);
                        }}
                        mr={1}
                        borderRadius="full"
                        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                      />
                    </Tooltip>
                    <Tooltip label={item.cache_key_timestamp ? "Click to view cached recommendation" : "No cached recommendation available"}>
                      <Badge
                          colorScheme={getActionColor(item.action)}
                          variant='solid'
                          mr={2}
                          fontSize="0.7em"
                          onClick={() => item.cache_key_timestamp && onRecentSearchClick && onRecentSearchClick(item)}
                          cursor={item.cache_key_timestamp ? "pointer" : "default"}
                          _hover={item.cache_key_timestamp ? { transform: 'scale(1.1)', boxShadow: 'md' } : {}}
                          transition="all 0.2s ease-in-out"
                      >
                          {item.action || 'N/A'}
                      </Badge>
                    </Tooltip>
                    <Button
                      size="xs"
                      variant="link"
                      colorScheme="blue"
                      onClick={() => { setSymbol(item.symbol); performSearch(item.symbol); }}
                      disabled={isLoading}
                      fontWeight="bold"
                    >
                      {item.symbol}
                    </Button>
                    <HStack spacing={2} ml={3}>
                      {item.duration && (
                        <Tooltip label={`Analysis duration: ${formatDuration(item.duration)}`}>
                            <Badge variant="outline" colorScheme="gray" fontSize="0.7em">
                                {formatDuration(item.duration)}
                            </Badge>
                        </Tooltip>
                      )}
                      <TimestampDisplay dateString={item.date} />
                    </HStack>
                  </Flex>
                </WrapItem>
              ))}
            </Wrap>
          </Box>
        )}

        {companyInfo && currentSymbol && (
          <Box mb={3}>
            <Text fontSize="xs" color={textColor} mb={1}>Search keywords used:</Text>
            <VStack
                p={2}
                borderRadius="md"
                bg={colorMode === 'dark' ? 'gray.800' : 'gray.50'}
                borderWidth="1px"
                fontSize="xs"
                align="stretch"
                spacing={2}
                transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
            >
                <HStack>
                    <Text fontWeight="bold" minWidth="70px">Symbol:</Text>
                    <Text>{currentSymbol}</Text>
                </HStack>
                <HStack>
                    <Text fontWeight="bold" minWidth="70px">Company:</Text>
                    <Text>{companyInfo.name || 'N/A'}</Text>
                </HStack>
                <HStack>
                    <Text fontWeight="bold" minWidth="70px">CEO:</Text>
                    <Text>{companyInfo.ceo_name || companyInfo.ceo || 'N/A'}</Text>
                </HStack>

                {companyInfo.search_keywords?.length > 0 && (
                    <HStack align="flex-start">
                        <Text fontWeight="bold" minWidth="70px">Stock:</Text>
                        <Wrap>
                            {companyInfo.search_keywords.map((kw, i) => <KeywordBadge key={`stock-kw-${i}`} keyword={{...kw, color: 'blue'}} />)}
                        </Wrap>
                    </HStack>
                )}

                {companyInfo.industry_keywords?.length > 0 && (
                    <HStack align="flex-start">
                        <Text fontWeight="bold" minWidth="70px">Industry:</Text>
                        <Wrap>
                            {companyInfo.industry_keywords.map((kw, i) => <KeywordBadge key={`ind-kw-${i}`} keyword={{...kw, color: 'green'}} />)}
                        </Wrap>
                    </HStack>
                )}

                {marketKeywords?.length > 0 && (
                    <HStack align="flex-start">
                        <Text fontWeight="bold" minWidth="70px">Market:</Text>
                        <Wrap>
                            {marketKeywords.map((kw, i) => <KeywordBadge key={`mkt-kw-${i}`} keyword={{...kw, color: 'purple'}} />)}
                        </Wrap>
                    </HStack>
                )}
            </VStack>
          </Box>
        )}


        <Divider my={3} />

        {renderSuggestionCategory('trending', 'Trending Now', TrendingUp)}
        {renderSuggestionCategory('growing', 'Growth Stocks', BarChart)}
        {renderSuggestionCategory('newcomers', 'Recent IPOs', Calendar)}
      </Box>
    </Box>
  );
};

export default SearchBar;