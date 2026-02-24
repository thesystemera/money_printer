import React, { useState, useMemo, memo } from 'react';
import {
  Box, VStack, Text, Badge, Link, Divider,
  Flex, Progress, Icon, HStack, Tooltip,
  Menu, MenuButton, MenuList, MenuItem, IconButton,
  Collapse, useDisclosure, ButtonGroup, Button
} from '@chakra-ui/react';
import {
  Globe, TrendingUp, Clock, ArrowDown, ArrowUp,
  ExternalLink, ChevronRight, ChevronUp,
  SlidersHorizontal, Tag, Layers, Briefcase
} from 'lucide-react';
import { COLORS, UI_ANIMATIONS } from '../config/Config';
import { formatValue } from '../services/socketService';
import { getCurrentTime } from '../services/timeService';

const SENTIMENT_COLORS = {
  VERY_POSITIVE: 'green',
  POSITIVE: 'teal',
  NEUTRAL: 'gray',
  NEGATIVE: 'orange',
  VERY_NEGATIVE: 'red'
};

const getSentimentColor = score => {
  if (score >= 0.5) return SENTIMENT_COLORS.VERY_POSITIVE;
  if (score > 0) return SENTIMENT_COLORS.POSITIVE;
  if (score < -0.5) return SENTIMENT_COLORS.VERY_NEGATIVE;
  if (score < 0) return SENTIMENT_COLORS.NEGATIVE;
  return SENTIMENT_COLORS.NEUTRAL;
};

const formatTimeAgo = dateString => {
  try {
    const publishedDate = new Date(dateString);
    const now = getCurrentTime();
    const diffMs = now - publishedDate;

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;

    return publishedDate.toLocaleDateString();
  } catch {
    return 'Unknown';
  }
};

const ArticleItem = memo(({ article }) => {
  const { isOpen, onToggle } = useDisclosure();

  const handleTitleClick = () => {
    onToggle();
  };

  const handleLinkClick = (e) => {
    e.stopPropagation();
  };

  const getArticleTypeIcon = () => {
    if (article.isIndustryArticle) return Briefcase;
    if (article.isMarketArticle) return Globe;
    return TrendingUp;
  };

  const getArticleTypeColor = () => {
    if (article.isIndustryArticle) return "orange";
    if (article.isMarketArticle) return "purple";
    return "blue";
  };

  return (
    <Box width="100%" py={2}>
      <Flex justifyContent="space-between" alignItems="flex-start" onClick={handleTitleClick} cursor="pointer">
        <HStack spacing={1} flex="1" align="flex-start">
          <Icon
            as={isOpen ? ChevronUp : ChevronRight}
            size={14}
            mt={1}
            color="gray.500"
          />
          <Text fontSize="sm" fontWeight="bold" noOfLines={isOpen ? 0 : 2}>{article.title}</Text>
        </HStack>
        <HStack spacing={1} ml={1} flexShrink={0}>
          <Badge colorScheme={getSentimentColor(article.sentimentScore)} fontSize="xs">
            {formatValue(article.sentimentScore)}
          </Badge>
          <Badge
            size="xs"
            colorScheme={getArticleTypeColor()}
            variant="subtle"
          >
            <Icon as={getArticleTypeIcon()} boxSize="10px" />
          </Badge>
        </HStack>
      </Flex>

      <Flex ml={6} mt={1} fontSize="xs" color="gray.500" align="center" justify="space-between">
        <Flex align="center">
          <Text noOfLines={1} mr={2}>{article.publisher || 'Unknown'}</Text>
          <Tooltip label={new Date(article.publishedDate).toLocaleString()}>
            <Flex align="center">
              <Icon as={Clock} size={10} mr={1} />
              <Text>{formatTimeAgo(article.publishedDate)}</Text>
            </Flex>
          </Tooltip>
        </Flex>
      </Flex>

      <Flex ml={6} mt={1} flexWrap="wrap" gap={1}>
        {article.influenceScore !== undefined && (
          <Badge variant="outline" colorScheme="blue" fontSize="xs">
            INFLUENCE: {formatValue(article.influenceScore)}
          </Badge>
        )}
        {article.certaintyScore !== undefined && (
          <Badge variant="outline" colorScheme="cyan" fontSize="xs">
            CERTAINTY: {formatValue(article.certaintyScore)}
          </Badge>
        )}
        {article.sourceCategory && (
          <Badge variant="outline" colorScheme="yellow" fontSize="xs">
            SOURCE: {article.sourceCategory}
          </Badge>
        )}
        {article.propagationSpeed && (
          <Badge variant="outline" colorScheme="purple" fontSize="xs">
            PROPAGATION: {article.propagationSpeed}h
          </Badge>
        )}
        {article.impactDuration && (
          <Badge variant="outline" colorScheme="teal" fontSize="xs">
            IMPACT: {article.impactDuration}h
          </Badge>
        )}
        {article.temporalOrientation !== undefined && (
          <Badge variant="outline" colorScheme="pink" fontSize="xs">
            TEMPORAL: {formatValue(article.temporalOrientation)}
          </Badge>
        )}
        {article.matchedKeyword && (
          <Badge variant="outline" colorScheme="orange" fontSize="xs">
            MATCH: {article.matchedKeyword}
          </Badge>
        )}
      </Flex>

      <Collapse in={isOpen} animateOpacity={UI_ANIMATIONS.enabled}>
        <Box ml={6} mt={2}>
          <Text fontSize="sm" mb={2}>{article.summary || 'No summary available'}</Text>

          <Link
            href={article.url}
            isExternal
            color="blue.500"
            fontSize="xs"
            onClick={handleLinkClick}
            display="flex"
            alignItems="center"
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          >
            Open article <Icon as={ExternalLink} ml={1} size={12} />
          </Link>
        </Box>
      </Collapse>
    </Box>
  );
});

const ArticleList = ({
  articles = [],
  isLoading,
  stockProcessingState = {},
  marketProcessingState = {},
  industryProcessingState = {},
  analysisStatus = {}
}) => {
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [articleTypeFilter, setArticleTypeFilter] = useState('all');

  const hasMarketArticles = useMemo(() => articles.some(a => a.isMarketArticle), [articles]);
  const hasIndustryArticles = useMemo(() => articles.some(a => a.isIndustryArticle), [articles]);

  const sortedArticles = useMemo(() => {
    let filteredArticles = [...articles];
    if (articleTypeFilter === 'stock') {
      filteredArticles = filteredArticles.filter(a => !a.isMarketArticle && !a.isIndustryArticle);
    } else if (articleTypeFilter === 'market') {
      filteredArticles = filteredArticles.filter(a => a.isMarketArticle);
    } else if (articleTypeFilter === 'industry') {
      filteredArticles = filteredArticles.filter(a => a.isIndustryArticle);
    }

    return filteredArticles.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return sortOrder === 'desc'
            ? new Date(b.publishedDate) - new Date(a.publishedDate)
            : new Date(a.publishedDate) - new Date(b.publishedDate);
        case 'sentiment':
          return sortOrder === 'desc'
            ? b.sentimentScore - a.sentimentScore
            : a.sentimentScore - b.sentimentScore;
        case 'influence':
          return sortOrder === 'desc'
            ? b.influenceScore - a.influenceScore
            : a.influenceScore - b.influenceScore;
        case 'source':
          const getSourcePriority = (article) => {
            if (article.isMarketArticle) return 2;
            if (article.isIndustryArticle) return 1;
            return 0;
          };
          return sortOrder === 'desc'
            ? getSourcePriority(b) - getSourcePriority(a)
            : getSourcePriority(a) - getSourcePriority(b);
        case 'keyword':
          const keywordA = a.matchedKeyword || '';
          const keywordB = b.matchedKeyword || '';
          return sortOrder === 'desc'
            ? keywordB.localeCompare(keywordA)
            : keywordA.localeCompare(keywordB);
        default:
          return 0;
      }
    });
  }, [articles, sortBy, sortOrder, articleTypeFilter]);


  const stockStats = {
    displayed: sortedArticles.filter(a => !a.isMarketArticle && !a.isIndustryArticle).length,
    analyzed: stockProcessingState.articlesAnalyzed || 0,
    zeroFiltered: stockProcessingState.rejectedArticles || 0,
    irrelevant: stockProcessingState.irrelevantArticles || 0,
    total: stockProcessingState.totalArticles || 0
  };

  const marketStats = {
    displayed: sortedArticles.filter(a => a.isMarketArticle).length,
    analyzed: marketProcessingState.articlesAnalyzed || 0,
    zeroFiltered: marketProcessingState.rejectedArticles || 0,
    irrelevant: marketProcessingState.irrelevantArticles || 0,
    total: marketProcessingState.totalArticles || 0
  };

  const industryStats = {
    displayed: sortedArticles.filter(a => a.isIndustryArticle).length,
    analyzed: industryProcessingState.articlesAnalyzed || 0,
    zeroFiltered: industryProcessingState.rejectedArticles || 0,
    irrelevant: industryProcessingState.irrelevantArticles || 0,
    total: industryProcessingState.totalArticles || 0
  };

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
  };

  if (isLoading) return null;

  return (
    <Box height="100%" width="100%" p={2} display="flex" flexDirection="column">
      <Flex justify="space-between" align="center" mb={2}>
        <HStack spacing={4}>
          <Flex align="center">
            <Icon as={TrendingUp} color={COLORS.stockPrice} mr={1} size={14} />
            <Text fontSize="sm" color={COLORS.stockPrice} fontWeight="medium">
              {stockStats.displayed}/{stockStats.analyzed}
              <Text as="span" fontSize="xs" color="gray.500" ml={1}>
                ({stockStats.irrelevant} irrelevant, {stockStats.zeroFiltered} zero)
              </Text>
            </Text>
          </Flex>

          {hasMarketArticles && (
            <Flex align="center">
              <Icon as={Globe} color={COLORS.marketSentiment} mr={1} size={14} />
              <Text fontSize="sm" color={COLORS.marketSentiment} fontWeight="medium">
                {marketStats.displayed}/{marketStats.analyzed}
                <Text as="span" fontSize="xs" color="gray.500" ml={1}>
                  ({marketStats.irrelevant} irrelevant, {marketStats.zeroFiltered} zero)
                </Text>
              </Text>
            </Flex>
          )}

          {hasIndustryArticles && (
            <Flex align="center">
              <Icon as={Briefcase} color="orange.400" mr={1} size={14} />
              <Text fontSize="sm" color="orange.400" fontWeight="medium">
                {industryStats.displayed}/{industryStats.analyzed}
                <Text as="span" fontSize="xs" color="gray.500" ml={1}>
                  ({industryStats.irrelevant} irrelevant, {industryStats.zeroFiltered} zero)
                </Text>
              </Text>
            </Flex>
          )}
        </HStack>

        <HStack spacing={1}>
          <Tooltip label={`Sort by: ${sortBy}`}>
            <Flex align="center">
              <Text fontSize="xs" color="gray.500" mr={1}>Sort by:</Text>
              <Menu closeOnSelect={true} placement="bottom-end">
                <MenuButton
                  as={IconButton}
                  icon={<SlidersHorizontal size={12} />}
                  aria-label="Sort options"
                  size="xs"
                  variant="ghost"
                  transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                />
                <MenuList minWidth="120px">
                  <MenuItem fontSize="xs" onClick={() => setSortBy('date')}>Date</MenuItem>
                  <MenuItem fontSize="xs" onClick={() => setSortBy('sentiment')}>Sentiment</MenuItem>
                  <MenuItem fontSize="xs" onClick={() => setSortBy('influence')}>Influence</MenuItem>
                  <MenuItem fontSize="xs" onClick={() => setSortBy('source')}>Source</MenuItem>
                  <MenuItem fontSize="xs" onClick={() => setSortBy('keyword')}>Keyword</MenuItem>
                </MenuList>
              </Menu>
            </Flex>
          </Tooltip>

          <Tooltip label={sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}>
            <IconButton
              icon={sortOrder === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
              onClick={toggleSortOrder}
              size="xs"
              variant="ghost"
              aria-label="Toggle sort direction"
              transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
            />
          </Tooltip>
        </HStack>
      </Flex>

      <Flex justify="space-between" align="center" mb={2}>
        <ButtonGroup size="xs" isAttached variant="outline">
          <Tooltip label="Show all articles">
            <Button
              leftIcon={<Layers size={12} />}
              isActive={articleTypeFilter === 'all'}
              onClick={() => setArticleTypeFilter('all')}
              colorScheme={articleTypeFilter === 'all' ? 'blue' : 'gray'}
            >
              All
            </Button>
          </Tooltip>
          <Tooltip label="Show stock articles only">
            <Button
              leftIcon={<TrendingUp size={12} />}
              isActive={articleTypeFilter === 'stock'}
              onClick={() => setArticleTypeFilter('stock')}
              colorScheme={articleTypeFilter === 'stock' ? 'blue' : 'gray'}
            >
              Stock
            </Button>
          </Tooltip>
          {hasIndustryArticles && (
            <Tooltip label="Show industry articles only">
              <Button
                leftIcon={<Briefcase size={12} />}
                isActive={articleTypeFilter === 'industry'}
                onClick={() => setArticleTypeFilter('industry')}
                colorScheme={articleTypeFilter === 'industry' ? 'orange' : 'gray'}
              >
                Industry
              </Button>
            </Tooltip>
          )}
          {hasMarketArticles && (
            <Tooltip label="Show market articles only">
                <Button
                    leftIcon={<Globe size={12} />}
                    isActive={articleTypeFilter === 'market'}
                    onClick={() => setArticleTypeFilter('market')}
                    colorScheme={articleTypeFilter === 'market' ? 'purple' : 'gray'}
                >
                    Market
                </Button>
            </Tooltip>
          )}
        </ButtonGroup>

        {sortBy === 'keyword' && (
          <Tooltip label="Keyword sorting enabled">
            <Flex align="center">
              <Icon as={Tag} color="orange.400" mr={1} size={14} />
              <Text fontSize="xs" color="orange.400" fontWeight="medium">
                Sorting by keyword
              </Text>
            </Flex>
          </Tooltip>
        )}
      </Flex>

      <Divider mb={1} />

      <Box
        flexGrow={1}
        overflowY="auto"
        pr={1}
        mb={2}
        maxHeight="calc(100% - 90px)"
        css={{
          '&::-webkit-scrollbar': { width: '4px' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: 'rgba(255, 255, 255, 0.1)', borderRadius: '4px' },
          '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255, 255, 255, 0.2)' }
        }}
      >
        {!sortedArticles.length ? (
          <Box p={4} textAlign="center">
            <Text color="gray.500">No articles match the current filter</Text>
          </Box>
        ) : (
          <VStack spacing={0} align="stretch" divider={<Divider />}>
            {sortedArticles.map((article, index) => (
              <ArticleItem key={`${article.url}-${index}`} article={article} />
            ))}
          </VStack>
        )}
      </Box>

      <Box mt="auto">
        {hasIndustryArticles && industryProcessingState?.totalArticles > 0 && (
          <Box mb={1}>
            <Progress
              value={(industryProcessingState.articlesAnalyzed / industryProcessingState.totalArticles) * 100}
              size="xs"
              colorScheme="orange"
              borderRadius="full"
              transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
            />
          </Box>
        )}

        {hasMarketArticles && marketProcessingState?.totalArticles > 0 && (
          <Box mb={1}>
            <Progress
              value={(marketProcessingState.articlesAnalyzed / marketProcessingState.totalArticles) * 100}
              size="xs"
              colorScheme="purple"
              borderRadius="full"
              transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
            />
          </Box>
        )}

        {stockProcessingState?.totalArticles > 0 && (
          <Box>
            <Progress
              value={(stockProcessingState.articlesAnalyzed / stockProcessingState.totalArticles) * 100}
              size="xs"
              colorScheme="blue"
              borderRadius="full"
              transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ArticleList;