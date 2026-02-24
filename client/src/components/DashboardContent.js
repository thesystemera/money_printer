import React, { useState, useEffect, useRef, useMemo, useCallback, useReducer } from 'react';
import {
  Box, useToast, Flex, Button, Tooltip, useColorMode, Spacer,
  CSSReset, Heading, Text, IconButton,
  Menu, MenuButton, MenuList, MenuItem, MenuDivider, Avatar, HStack, Collapse, Divider, Badge
} from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import {
  Sun, Moon, BarChart, LogOut, Settings as SettingsIcon, CheckCircle, RefreshCw, Clock,
  Sunrise, Sunset, Calendar as CalendarIcon, TrendingUp, Activity, PieChart, BarChart3, History, Image as ImageIcon, Zap
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SearchBar from './SearchBar';
import SentimentChart from './SentimentChart';
import ArticleList from './ArticleList';
import DebugLog from './DebugLog';
import Settings from './Settings';
import RecommendationPanel from './Recommendation';
import PortfolioPanel from './PortfolioPanel';
import SystemSymbolsPanel from './SystemSymbolPanel';
import PanelContainer from './PanelContainer';
import FloatingThinkingPanel from './FloatingThinkingPanel';
import FloatingBulkProgressPanel from './FloatingBulkProgressPanel';
import SentimentSupplementaryContent from './SentimentSupplementaryContent';
import RealTimePortfolioMonitor from './RealTimePortfolioMonitor';
import PortfolioPredictionAccuracyPanel from './PortfolioPredictionAccuracyPanel';
import DashboardDataService from './DashboardDataService';
import * as TimeService from '../services/timeService';
import {
  MARKET_SENTIMENT,
  MARKET_INDICES,
  DEFAULT_SETTINGS,
  DEFAULT_PANEL_STATES,
  PANEL_NAMES,
  THEME,
  SCHEDULED_ANALYSIS,
  REFRESH_INTERVALS,
  UI_EFFECTS,
} from '../config/Config';
import { addLog, showToast, clearAllSubscriptions, on } from '../services/socketService';
import { getHistoricalRecommendation } from '../services/apiService';
import { handleError } from '../services/socketService';
import ReprocessConfirmationDialog, { checkReprocessConfirmation } from './ReprocessConfirmation';
import { useAuth } from '../contexts/AuthContext';
import { analysisReducer, initialAnalysisState } from '../state/analysisState';
import { useProgressTracker } from '../hooks/useProgressTracker';

const glowingAnimation = keyframes`
  0% {
    background-color: var(--chakra-colors-green-500);
    transform: scale(1);
    box-shadow: 0 0 8px rgba(49, 130, 206, 0);
  }
  50% {
    background-color: var(--chakra-colors-green-400);
    transform: scale(1.05);
    box-shadow: 0 0 12px var(--chakra-colors-green-500);
  }
  100% {
    background-color: var(--chakra-colors-green-500);
    transform: scale(1);
    box-shadow: 0 0 8px rgba(49, 130, 206, 0);
  }
`;

const formatTimeDiff = (diff) => {
    diff = Math.abs(diff);
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const MarketClock = React.memo(({ tradingCalendar }) => {
    const [currentTimeET, setCurrentTimeET] = useState('');
    const [marketStatus, setMarketStatus] = useState({ status: 'Loading...', color: 'gray', countdown: '' });

    useEffect(() => {
        const timerId = setInterval(() => {
            const now = TimeService.getCurrentTime();
            const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
            setCurrentTimeET(nowET.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }));

            if (!tradingCalendar || tradingCalendar.length === 0) {
                 setMarketStatus({ status: 'Market Status Unknown', color: 'gray', countdown: '' });
                 return;
            }

            const todaySession = tradingCalendar.find(d => new Date(d.date).toDateString() === nowET.toDateString());

            if (!todaySession || todaySession.session === 'CLOSED') {
                const nextOpenDate = tradingCalendar.find(d => new Date(d.date) > nowET && d.session !== 'CLOSED');
                if (nextOpenDate) {
                    const openTime = new Date(nextOpenDate.market_open).getTime();
                    const diff = openTime - nowET.getTime();
                    setMarketStatus({ status: 'Market Closed', color: 'red', countdown: `Opens in ${formatTimeDiff(diff)}`, icon: Sunrise });
                } else {
                    setMarketStatus({ status: 'Market Closed', color: 'red', countdown: '', icon: CalendarIcon });
                }
                return;
            }

            const openTime = new Date(todaySession.market_open).getTime();
            const closeTime = new Date(todaySession.market_close).getTime();
            const preMarketOpenTime = new Date(openTime).setHours(4, 0, 0, 0);
            const afterHoursCloseTime = new Date(closeTime).setHours(20, 0, 0, 0);
            const nowTime = nowET.getTime();

            if (nowTime >= openTime && nowTime < closeTime) {
                const diff = closeTime - nowTime;
                setMarketStatus({ status: 'Market Open', color: 'green', countdown: `Closes in ${formatTimeDiff(diff)}`, icon: Sunset });
            } else if (nowTime >= preMarketOpenTime && nowTime < openTime) {
                const diff = openTime - nowTime;
                setMarketStatus({ status: 'Pre-Market', color: 'yellow', countdown: `Opens in ${formatTimeDiff(diff)}`, icon: Sunrise });
            } else if (nowTime >= closeTime && nowTime < afterHoursCloseTime) {
                const diff = afterHoursCloseTime - nowTime;
                setMarketStatus({ status: 'After Hours', color: 'purple', countdown: `Ends in ${formatTimeDiff(diff)}`, icon: Moon });
            } else {
                const nextOpenDate = tradingCalendar.find(d => new Date(d.date) > nowET && d.session !== 'CLOSED');
                if (nextOpenDate) {
                    const nextOpenTime = new Date(nextOpenDate.market_open).getTime();
                    const diff = nextOpenTime - nowTime;
                    setMarketStatus({ status: 'Market Closed', color: 'red', countdown: `Opens in ${formatTimeDiff(diff)}`, icon: Sunrise });
                } else {
                    setMarketStatus({ status: 'Market Closed', color: 'red', countdown: '', icon: CalendarIcon });
                }
            }
        }, 1000);

        return () => clearInterval(timerId);
    }, [tradingCalendar]);

    const StatusIcon = marketStatus.icon || Clock;

    return (
        <HStack>
            <Text fontSize="xs" fontWeight="bold">{currentTimeET}</Text>
            <Tooltip label={marketStatus.countdown}>
                <Badge colorScheme={marketStatus.color} variant="solid" fontSize="0.7em" display="flex" alignItems="center">
                    <StatusIcon size="12px" mr={1} />
                    {marketStatus.status}
                </Badge>
            </Tooltip>
        </HStack>
    );
});

const NextRunClock = React.memo(({ nextRun }) => {
    const [countdown, setCountdown] = useState('');

    useEffect(() => {
        if (!nextRun?.date) {
            setCountdown('');
            return;
        }

        const timerId = setInterval(() => {
            const diff = new Date(nextRun.date).getTime() - TimeService.getCurrentTime().getTime();
            if (diff > 0) {
                setCountdown(formatTimeDiff(diff));
            } else {
                setCountdown('');
            }
        }, 1000);

        return () => clearInterval(timerId);
    }, [nextRun]);

    if (!nextRun || !countdown) return null;

    return (
        <Tooltip label={`Next scheduled run: ${nextRun.name} at ${new Date(nextRun.date).toLocaleTimeString()}`}>
             <Badge colorScheme="purple" variant="outline" fontSize="0.7em" display="flex" alignItems="center">
                <Clock size="12px" mr={1} />
                Next Run: {countdown}
            </Badge>
        </Tooltip>
    );
});

const getImageIcon = (category) => {
    const iconMap = {
      'SENTIMENT_TEMPORAL': TrendingUp, 'SENTIMENT_COMBINED': Activity, 'SENTIMENT_RECENT': BarChart,
      'OPTIONS_ANALYSIS': PieChart, 'PREDICTION_HISTORY': BarChart3, 'HISTORICAL_ANALYSIS': History,
    };
    return iconMap[category] || ImageIcon;
};

const ProgressStage = React.memo(({ label, status, progress = -1, colorMode, isTuningActive = false }) => {
    const isActive = status === 'active';
    const isComplete = status === 'complete';
    const hasProgress = progress > -1 && progress < 100;

    let baseColor = 'blue';
    if (label === 'Auto-Tuning' && isActive) {
        baseColor = 'yellow';
    }

    const bgFillColor = colorMode === 'dark' ? `rgba(var(--chakra-colors-${baseColor}-300-rgb), 0.3)` : `rgba(var(--chakra-colors-${baseColor}-200-rgb), 1)`;

    let icon;
    if (isComplete) {
        icon = <CheckCircle size={14} color="var(--chakra-colors-green-500)" />;
    } else if (isActive) {
        if (label === 'Auto-Tuning') {
            icon = <Zap size={14} style={{ animation: 'spin 2s linear infinite', color: `var(--chakra-colors-${baseColor}-500)` }} />;
        } else {
            icon = <RefreshCw size={14} style={{ animation: 'spin 2s linear infinite', color: `var(--chakra-colors-${baseColor}-500)` }} />;
        }
    } else {
        icon = <Clock size={14} color="var(--chakra-colors-gray-400)" />;
    }

    return (
        <Flex
            key={label} align="center" gap={2} opacity={isComplete || isActive ? 1 : 0.5} p={1}
            borderRadius="md" minW="110px" justifyContent="center" position="relative" overflow="hidden"
            sx={{
                background: hasProgress ? `linear-gradient(to right, ${bgFillColor} ${progress}%, transparent ${progress}%)` : 'transparent',
                transition: 'background 0.3s ease-in-out',
            }}
        >
            {icon}
            <Text fontSize="xs" fontWeight={isActive ? "bold" : "normal"} color={isActive ? (colorMode === 'dark' ? `${baseColor}.300` : `${baseColor}.600`) : 'inherit'} zIndex={1}>
                {label}
            </Text>
        </Flex>
    );
});

const HeaderProgressIndicator = React.memo(({ analysisStatus, recommendationData, stockProcessingState, marketProcessingState, industryProcessingState, activeAnalysisState, isTuning, tunerResults }) => {
    const { colorMode } = useColorMode();
    const stages = useProgressTracker(analysisStatus, activeAnalysisState.currentProgress?.stage, recommendationData, tunerResults, isTuning);
    const isVisible = activeAnalysisState.isActive && !!activeAnalysisState.currentStock;

    const getProgress = useCallback((stageKey) => {
        let state;
        if (stageKey === 'stockArticles') state = stockProcessingState;
        else if (stageKey === 'marketArticles') state = marketProcessingState;
        else if (stageKey === 'industryArticles') state = industryProcessingState;
        else if (stageKey === 'tuning') {
            const { progress = 0, total = 1 } = activeAnalysisState.tunerProgress || {};
            return total > 0 ? (progress / total) * 100 : -1;
        }
        else return -1;

        if (!state || !state.totalArticles || state.totalArticles === 0) return -1;
        return (state.articlesAnalyzed / state.totalArticles) * 100;
    }, [stockProcessingState, marketProcessingState, industryProcessingState, activeAnalysisState.tunerProgress]);

    if (!isVisible) return null;

    return (
        <HStack spacing={2} align="center" justify="center" w="100%">
            <HStack spacing={1} align="center" p={1} borderRadius="md" bg={colorMode === 'dark' ? 'gray.900' : 'gray.100'}>
                <Text fontSize="sm" fontWeight="bold" mr={2}>{activeAnalysisState.currentStock}</Text>
                {stages.map((stage) => (
                    <ProgressStage key={stage.key} label={stage.label} status={stage.status} progress={getProgress(stage.key)} colorMode={colorMode} />
                ))}
            </HStack>
            <Divider orientation="vertical" h="20px" />
            <HStack spacing={1.5} align="center">
                {activeAnalysisState.generatedImages && Object.keys(activeAnalysisState.generatedImages).map(category => {
                    const Icon = getImageIcon(category);
                    return <Icon key={category} size={14} color="var(--chakra-colors-green-500)" />;
                })}
            </HStack>
        </HStack>
    );
});

const HeaderActions = React.memo(() => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { colorMode, toggleColorMode } = useColorMode();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
      toast({ title: 'Logged Out', description: "You have been successfully logged out.", status: 'success', duration: 3000, isClosable: true });
    } catch (error) {
      toast({ title: 'Logout Failed', description: "There was an error logging you out. Please try again.", status: 'error', duration: 5000, isClosable: true });
    }
  };

  if (!currentUser) return null;
  const avatarName = currentUser.email ? currentUser.email.charAt(0).toUpperCase() : '?';
  const creationDate = currentUser.metadata?.creationTime ? new Date(currentUser.metadata.creationTime).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';

  return (
    <Flex zIndex={10} gap={3} alignItems="center">
      <Menu>
        <MenuButton as={IconButton} aria-label="User profile" icon={<Avatar size="sm" name={currentUser.email} bg="blue.500" color="white">{avatarName}</Avatar>} isRound={true} variant="ghost" size="md" />
        <MenuList boxShadow="xl" zIndex={20}>
          <Box px={4} py={2}>
            <Text fontWeight="bold">Signed in as</Text>
            <Text fontSize="sm" color="gray.500" isTruncated>{currentUser.email}</Text>
          </Box>
          <MenuDivider />
          <Flex align="center" py={2} px={4}>
            <Flex align="center" mr={4}><CalendarIcon size={16} style={{ marginRight: '8px' }} /><Text fontSize="sm">Member since</Text></Flex>
            <Spacer /><Text fontSize="sm" fontWeight="bold">{creationDate}</Text>
          </Flex>
          <MenuDivider />
          <MenuItem icon={<LogOut size={16} />} onClick={handleLogout}>Logout</MenuItem>
        </MenuList>
      </Menu>
      <IconButton aria-label="Toggle theme" icon={colorMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />} size="md" variant="ghost" onClick={toggleColorMode} borderRadius="full" />
    </Flex>
  );
});

const DashboardHeader = React.memo(({
  panelIsProcessing, panelHasContent, scrollToPanel, panelRefs, analysisStatus, recommendationData, tradingCalendar,
  nextScheduledRun, setIsToolsPanelVisible, setIsBulkProgressOpen, isAdmin, activeAnalysisState,
  stockProcessingState, marketProcessingState, industryProcessingState, isTuning, tunerResults
}) => {
  const { colorMode } = useColorMode();

  const getButtonProps = (panelName) => {
    if (panelIsProcessing[panelName]) {
      return {
        size: "sm",
        colorScheme: "green",
        variant: "solid",
        color: "white",
        animation: `${glowingAnimation} 2s ease-in-out infinite`,
      };
    }
    return {
      size: "sm",
      variant: "link",
    };
  };

  return (
    <Flex as="header" position="sticky" top="0" zIndex={100} bg={colorMode === 'dark' ? 'gray.800' : 'white'}
      boxShadow="md" p={3} px={6} align="center" flexShrink={0} justifyContent="space-between">
      <HStack spacing={8}>
        <Heading size="md" color="blue.400">MONEY PRINTER</Heading>
        <HStack spacing={4} align="center">
            <Button {...getButtonProps('chart')} onClick={() => scrollToPanel(panelRefs.chart)} isDisabled={!panelHasContent.chart}>Chart</Button>
            <Button {...getButtonProps('visualization')} onClick={() => scrollToPanel(panelRefs.visualization)} isDisabled={!panelHasContent.visualization}>Supplementary</Button>
            <Button {...getButtonProps('recommendation')} onClick={() => scrollToPanel(panelRefs.recommendation)} isDisabled={!panelHasContent.recommendation}>Recommendation</Button>
            <Divider orientation="vertical" h="20px" />
            <Button {...getButtonProps('systemSymbols')} onClick={() => scrollToPanel(panelRefs.systemSymbols)} isDisabled={!panelHasContent.systemSymbols}>System Symbols</Button>
            <Button {...getButtonProps('portfolio')} onClick={() => scrollToPanel(panelRefs.portfolio)} isDisabled={!panelHasContent.portfolio}>Portfolio</Button>
            <Button size="sm" variant="link" onClick={() => scrollToPanel(panelRefs.portfolioMonitor)} isDisabled={!panelHasContent.portfolioMonitor}>RT Monitor</Button>
            <Button size="sm" variant="link" onClick={() => scrollToPanel(panelRefs.portfolioPredictionAccuracy)} isDisabled={!panelHasContent.portfolioPredictionAccuracy}>Accuracy</Button>
            <Divider orientation="vertical" h="20px" />
            <Button {...getButtonProps('search')} onClick={() => scrollToPanel(panelRefs.search)}>Search</Button>
            <Button size="sm" variant="link" onClick={() => scrollToPanel(panelRefs.settings)}>Settings</Button>
            <Button {...getButtonProps('articles')} onClick={() => scrollToPanel(panelRefs.articles)} isDisabled={!panelHasContent.articles}>Articles</Button>
            <Button size="sm" variant="link" onClick={() => scrollToPanel(panelRefs.logs)}>Logs</Button>
        </HStack>
      </HStack>
      <HStack spacing={4} flex={1} justify="flex-end">
        <Box flex={1} minW="300px" mx={4}>
            <HeaderProgressIndicator activeAnalysisState={activeAnalysisState} analysisStatus={analysisStatus} recommendationData={recommendationData}
                stockProcessingState={stockProcessingState} marketProcessingState={marketProcessingState} industryProcessingState={industryProcessingState}
                isTuning={isTuning} tunerResults={tunerResults} />
        </Box>
        <HStack spacing={4} align="center">
            <MarketClock tradingCalendar={tradingCalendar} />
            <NextRunClock nextRun={nextScheduledRun} />
        </HStack>
        <IconButton aria-label="Toggle Tools Panel" size="sm" variant="ghost" icon={<SettingsIcon size={16} />} onClick={() => setIsToolsPanelVisible(prev => !prev)} />
        {isAdmin && (<IconButton aria-label="Open Bulk Analysis" icon={<BarChart size={18} />} size="md" variant="ghost" onClick={() => setIsBulkProgressOpen(true)} />)}
        <HeaderActions />
      </HStack>
    </Flex>
  );
});

const initialLoadingState = { analysis: false, marketSentiment: false, indexData: false, recommendation: false, tuning: false };

function loadingReducer(state, action) {
  switch (action.type) {
    case 'START_ANALYSIS': return { ...state, analysis: true };
    case 'END_ANALYSIS': return { ...state, analysis: false };
    case 'START_MARKET_SENTIMENT': return { ...state, marketSentiment: true };
    case 'END_MARKET_SENTIMENT': return { ...state, marketSentiment: false };
    case 'START_INDEX_DATA': return { ...state, indexData: true };
    case 'END_INDEX_DATA': return { ...state, indexData: false };
    case 'START_RECOMMENDATION': return { ...state, recommendation: true };
    case 'END_RECOMMENDATION': return { ...state, recommendation: false };
    case 'START_TUNING': return { ...state, tuning: true };
    case 'END_TUNING': return { ...state, tuning: false };
    case 'RESET': return initialLoadingState;
    default: return state;
  }
}

const useChartData = () => {
  const [stockSymbol, setStockSymbol] = useState('');
  const [companyInfo, setCompanyInfo] = useState(null);
  const [stockSentimentData, setStockSentimentData] = useState([]);
  const [stockPriceData, setStockPriceData] = useState([]);
  const [stockHistoricalData, setStockHistoricalDataState] = useState([]);
  const [marketSentimentData, setMarketSentimentData] = useState([]);
  const [industrySentimentData, setIndustrySentimentData] = useState([]);
  const [selectedMarketIndex, setSelectedMarketIndex] = useState(MARKET_INDICES.DEFAULT_INDEX);
  const [selectedIndexRecentData, setSelectedIndexRecentData] = useState([]);
  const [selectedIndexHistoricalData, setSelectedIndexHistoricalDataState] = useState([]);
  const [tradingCalendar, setTradingCalendar] = useState([]);
  const [sharedChartParams, setSharedChartParams] = useState(null);

  const setStockHistoricalData = useCallback((data) => setStockHistoricalDataState(data || []), []);
  const setSelectedIndexHistoricalData = useCallback((data) => setSelectedIndexHistoricalDataState(data || []), []);

  const handleChartParamsUpdate = useCallback((params) => {
    setSharedChartParams(prev => {
      const same = JSON.stringify(prev) === JSON.stringify(params);
      if (same) return prev;
      addLog(`Chart parameters updated: ${Object.keys(params).join(', ')}`, 'info');
      return params;
    });
  }, []);

  const preparedMarketIndexData = useMemo(() => ({ [selectedMarketIndex]: { recent_data: selectedIndexRecentData, historical_data: selectedIndexHistoricalData } }), [selectedMarketIndex, selectedIndexRecentData, selectedIndexHistoricalData]);

  return { stockSymbol, setStockSymbol, companyInfo, setCompanyInfo, stockSentimentData, setStockSentimentData, stockPriceData, setStockPriceData, stockHistoricalData, setStockHistoricalData, marketSentimentData, setMarketSentimentData, industrySentimentData, setIndustrySentimentData, selectedMarketIndex, setSelectedMarketIndex, selectedIndexRecentData, setSelectedIndexRecentData, selectedIndexHistoricalData, setSelectedIndexHistoricalData, tradingCalendar, setTradingCalendar, preparedMarketIndexData, sharedChartParams, handleChartParamsUpdate };
};

const useAnalysisData = () => {
  const [articles, setArticles] = useState([]);
  const [stockAnalyzedArticles, setStockAnalyzedArticles] = useState([]);
  const [industryAnalyzedArticles, setIndustryAnalyzedArticles] = useState([]);
  const [marketAnalyzedArticles, setMarketAnalyzedArticles] = useState([]);
  const [claudeImages, setClaudeImages] = useState(null);
  const [analysisHasRecommendation, setAnalysisHasRecommendation] = useState(false);
  const [stockProcessingState, setStockProcessingState] = useState({ articlesFetched: 0, articlesAnalyzed: 0, totalArticles: 0, rejectedArticles: 0 });
  const [industryProcessingState, setIndustryProcessingState] = useState({ articlesFetched: 0, articlesAnalyzed: 0, totalArticles: 0, rejectedArticles: 0 });
  const [marketProcessingState, setMarketProcessingState] = useState({ articlesFetched: 0, articlesAnalyzed: 0, totalArticles: 0, rejectedArticles: 0 });
  const [analysisStatus, setAnalysisStatus] = useState({ stockCompleted: false, industryCompleted: false, marketCompleted: false, imageReady: false, optionsReady: false });
  const [optionsData, setOptionsData] = useState(null);
  const [optionsImages, setOptionsImages] = useState(null);
  const [isLoadingOptionsData, setIsLoadingOptionsData] = useState(false);
  const [tunerResults, setTunerResults] = useState(null);
  return { articles, setArticles, stockAnalyzedArticles, setStockAnalyzedArticles, industryAnalyzedArticles, setIndustryAnalyzedArticles, marketAnalyzedArticles, setMarketAnalyzedArticles, claudeImages, setClaudeImages, analysisHasRecommendation, setAnalysisHasRecommendation, stockProcessingState, setStockProcessingState, industryProcessingState, setIndustryProcessingState, marketProcessingState, setMarketProcessingState, analysisStatus, setAnalysisStatus, optionsData, setOptionsData, optionsImages, setOptionsImages, isLoadingOptionsData, setIsLoadingOptionsData, tunerResults, setTunerResults };
};

const usePortfolioData = () => {
  const [recommendationData, setRecommendationData] = useState(null);
  const [portfolioRecommendation, setPortfolioRecommendation] = useState(null);
  const [systemSymbols, setSystemSymbols] = useState([]);
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState(false);
  const [isSystemSymbolsLoading, setIsSystemSymbolsLoading] = useState(false);
  const [thinkingStreams, setThinkingStreams] = useState([]);
  const [portfolioPredictionAccuracyData, setPortfolioPredictionAccuracyData] = useState(null);
  const [isLoadingPredictionAccuracy, setIsLoadingPredictionAccuracy] = useState(false);
  const [isAnalyzingPredictionAccuracy, setIsAnalyzingPredictionAccuracy] = useState(false);
  return { recommendationData, setRecommendationData, portfolioRecommendation, setPortfolioRecommendation, systemSymbols, setSystemSymbols, isLoadingPortfolio, setIsLoadingPortfolio, isSystemSymbolsLoading, setIsSystemSymbolsLoading, thinkingStreams, setThinkingStreams, portfolioPredictionAccuracyData, setPortfolioPredictionAccuracyData, isLoadingPredictionAccuracy, setIsLoadingPredictionAccuracy, isAnalyzingPredictionAccuracy, setIsAnalyzingPredictionAccuracy, };
};

const useUIState = () => {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsChanged, setSettingsChanged] = useState(false);
  const [logs, setLogs] = useState([]);
  const [minimizedPanels, setMinimizedPanels] = useState({ ...DEFAULT_PANEL_STATES, systemSymbols: false });
  const [userPanelOverrides, setUserPanelOverrides] = useState(new Set());
  const [isThinkingPanelMinimized, setIsThinkingPanelMinimized] = useState(false);
  const [isThinkingPanelOpen, setIsThinkingPanelOpen] = useState(false);
  const [thinkingPanelSource, setThinkingPanelSource] = useState('all');
  const [recentSearches, setRecentSearches] = useState([]);
  const [isBulkProgressOpen, setIsBulkProgressOpen] = useState(false);
  const [isBulkProgressMinimized, setIsBulkProgressMinimized] = useState(false);
  const [historicalDataFetched, setHistoricalDataFetched] = useState(false);
  const [isViewingHistorical, setIsViewingHistorical] = useState(false);
  const [isGeneratingViz, setIsGeneratingViz] = useState(false);
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  const [confirmationWarnings, setConfirmationWarnings] = useState([]);
  const [isConfirmationPermissionError, setIsConfirmationPermissionError] = useState(false);
  const [stockToAnalyze, setStockToAnalyze] = useState(null);
  const [nextScheduledRun, setNextScheduledRun] = useState(null);
  const [isTuning, setIsTuning] = useState(false);
  return { settings, setSettings, settingsChanged, setSettingsChanged, logs, setLogs, minimizedPanels, setMinimizedPanels, userPanelOverrides, setUserPanelOverrides, isThinkingPanelMinimized, setIsThinkingPanelMinimized, isThinkingPanelOpen, setIsThinkingPanelOpen, thinkingPanelSource, setThinkingPanelSource, recentSearches, setRecentSearches, isBulkProgressOpen, setIsBulkProgressOpen, isBulkProgressMinimized, setIsBulkProgressMinimized, historicalDataFetched, setHistoricalDataFetched, isViewingHistorical, setIsViewingHistorical, isGeneratingViz, setIsGeneratingViz, isConfirmationOpen, setIsConfirmationOpen, confirmationWarnings, setConfirmationWarnings, isConfirmationPermissionError, setIsConfirmationPermissionError, stockToAnalyze, setStockToAnalyze, nextScheduledRun, setNextScheduledRun, isTuning, setIsTuning };
};

const MemoizedSentimentChart = React.memo(SentimentChart);
const MemoizedSentimentSupplementaryContent = React.memo(SentimentSupplementaryContent);
const MemoizedArticleList = React.memo(ArticleList);

const DashboardContent = () => {
  const { userTier } = useAuth();
  const chartData = useChartData();
  const analysisData = useAnalysisData();
  const portfolioData = usePortfolioData();
  const uiState = useUIState();

  const [loadingState, dispatchLoading] = useReducer(loadingReducer, initialLoadingState);
  const [activeAnalysisState, dispatchAnalysis] = useReducer(analysisReducer, initialAnalysisState);
  const [analysisStartTime, setAnalysisStartTime] = useState(null);
  const [isToolsPanelVisible, setIsToolsPanelVisible] = useState(true);

  const recommendationRequestedRef = useRef(false);
  const stockSymbolRef = useRef('');
  const bulkCurrentStockStartTime = useRef(null);
  const runTimestamps = useRef({ run730: false, run830: false });
  const toast = useToast();
  const dataServiceRef = useRef(null);
  const thinkingSources = useRef(new Set());
  const isAdmin = useMemo(() => userTier === 'admin', [userTier]);

  const panelRefs = { search: useRef(null), chart: useRef(null), visualization: useRef(null), recommendation: useRef(null), systemSymbols: useRef(null), portfolio: useRef(null), portfolioMonitor: useRef(null), portfolioPredictionAccuracy: useRef(null), settings: useRef(null), articles: useRef(null), logs: useRef(null) };
  const scrollToPanel = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const panelHasContent = useMemo(() => ({
      chart: (chartData.stockSentimentData?.length > 0) || (chartData.marketSentimentData?.length > 0) || (chartData.stockPriceData?.length > 0),
      visualization: (chartData.stockSentimentData?.length > 0) || (chartData.marketSentimentData?.length > 0) || (chartData.stockPriceData?.length > 0),
      articles: (analysisData.stockAnalyzedArticles?.length > 0) || (analysisData.industryAnalyzedArticles?.length > 0) || (analysisData.marketAnalyzedArticles?.length > 0),
      logs: uiState.logs?.length > 0,
      recommendation: portfolioData.recommendationData && portfolioData.recommendationData.action !== 'ERROR',
      systemSymbols: portfolioData.systemSymbols?.length > 0,
      portfolio: portfolioData.portfolioRecommendation != null,
      portfolioMonitor: portfolioData.portfolioRecommendation != null,
      portfolioPredictionAccuracy: portfolioData.portfolioPredictionAccuracyData?.metadata?.processed_count > 0,
  }), [chartData, analysisData, uiState.logs, portfolioData]);

  const isArticleProcessing = loadingState.analysis && ((analysisData.stockProcessingState.totalArticles > 0 && analysisData.stockProcessingState.articlesAnalyzed < analysisData.stockProcessingState.totalArticles) || (analysisData.marketProcessingState.totalArticles > 0 && analysisData.marketProcessingState.articlesAnalyzed < analysisData.marketProcessingState.totalArticles) || (analysisData.industryProcessingState.totalArticles > 0 && analysisData.industryProcessingState.articlesAnalyzed < analysisData.industryProcessingState.totalArticles));
  const panelIsProcessing = useMemo(() => ({
      search: loadingState.analysis, chart: loadingState.analysis || uiState.isTuning, visualization: uiState.isGeneratingViz,
      articles: isArticleProcessing, recommendation: loadingState.recommendation, systemSymbols: portfolioData.isSystemSymbolsLoading,
      portfolio: portfolioData.isLoadingPortfolio, portfolioPredictionAccuracy: portfolioData.isLoadingPredictionAccuracy || portfolioData.isAnalyzingPredictionAccuracy
  }), [loadingState, uiState.isTuning, uiState.isGeneratingViz, isArticleProcessing, portfolioData]);

  const appendLog = useCallback((logEntry) => uiState.setLogs(prevLogs => [...prevLogs, logEntry].slice(-20)), []);
  const appendThinkingStream = useCallback((streamUpdate) => portfolioData.setThinkingStreams(prev => [...prev, streamUpdate].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))), []);
  const isNewThinkingSource = useCallback((source) => !thinkingSources.current.has(source) && thinkingSources.current.add(source), []);
  const handleOpenThinkingPanel = useCallback((source = 'all') => { uiState.setThinkingPanelSource(source); uiState.setIsThinkingPanelOpen(true); }, []);

  const clearAllState = useCallback(() => {
      chartData.setStockSymbol(''); chartData.setCompanyInfo(null); analysisData.setArticles([]); analysisData.setStockAnalyzedArticles([]); chartData.setStockSentimentData([]); chartData.setStockPriceData([]);
      chartData.setStockHistoricalData([]); analysisData.setClaudeImages(null); analysisData.setIndustryAnalyzedArticles([]); analysisData.setMarketAnalyzedArticles([]); chartData.setIndustrySentimentData([]);
      chartData.setMarketSentimentData([]); portfolioData.setRecommendationData(null); portfolioData.setThinkingStreams([]); analysisData.setOptionsData(null); analysisData.setOptionsImages(null);
      analysisData.setAnalysisHasRecommendation(false); chartData.setSelectedIndexRecentData([]); chartData.setSelectedIndexHistoricalData([]); uiState.setMinimizedPanels({ ...DEFAULT_PANEL_STATES, systemSymbols: false });
      uiState.setUserPanelOverrides(new Set());
      analysisData.setAnalysisStatus({ stockCompleted: false, industryCompleted: false, marketCompleted: false, imageReady: false, optionsReady: false, companyInfoCompleted: false, pricesCompleted: false });
      analysisData.setStockProcessingState({ articlesFetched: 0, articlesAnalyzed: 0, totalArticles: 0, rejectedArticles: 0 });
      analysisData.setIndustryProcessingState({ articlesFetched: 0, articlesAnalyzed: 0, totalArticles: 0, rejectedArticles: 0 });
      analysisData.setMarketProcessingState({ articlesFetched: 0, articlesAnalyzed: 0, totalArticles: 0, rejectedArticles: 0 });
      uiState.setHistoricalDataFetched(false); uiState.setIsGeneratingViz(false); dispatchLoading({ type: 'RESET' }); recommendationRequestedRef.current = false;
      analysisData.setTunerResults(null); uiState.setIsTuning(false);
  }, []);

  const handleBulkProgress = useCallback((stage, percentage, message) => { if (activeAnalysisState.isActive) { dispatchAnalysis({ type: 'UPDATE_PROGRESS', payload: { stage, percentage, message } }); } }, [activeAnalysisState.isActive]);
  const handleSearch = useCallback(async (symbol, isBulkMode = false) => {
    clearAllState();
    if (!isBulkMode) dispatchAnalysis({ type: 'START_SINGLE_ANALYSIS', payload: { symbol } });
    setAnalysisStartTime(Date.now()); thinkingSources.current.clear(); uiState.setIsViewingHistorical(false);
    if (symbol !== chartData.stockSymbol && !isBulkMode) uiState.setMinimizedPanels({ ...DEFAULT_PANEL_STATES, systemSymbols: false });

    if (dataServiceRef.current) {
      await dataServiceRef.current.handleSearch(symbol, uiState.settings, chartData.selectedMarketIndex).catch(error => { addLog(`Search failed for ${symbol}: ${error.message}`, 'error'); });
      const newSearch = { symbol: symbol.toUpperCase(), date: TimeService.getCurrentTime().toISOString() };
      uiState.setRecentSearches(prev => {
          const updated = [newSearch, ...prev.filter(item => item.symbol !== newSearch.symbol)].slice(0, 20);
          try { localStorage.setItem('recentStockSearches', JSON.stringify(updated)); } catch (e) { console.error('Error saving recent searches', e); }
          return updated;
      });
    }
  }, [uiState.settings, chartData.selectedMarketIndex, chartData.stockSymbol]);

  const requestAnalysis = useCallback((symbol) => {
    const lastAnalyzed = uiState.recentSearches.find(s => s.symbol === symbol.toUpperCase())?.date;
    const { needsConfirmation, warnings, isPermissionError } = checkReprocessConfirmation(lastAnalyzed, userTier);
    if (needsConfirmation) {
      uiState.setStockToAnalyze(symbol); uiState.setConfirmationWarnings(warnings);
      uiState.setIsConfirmationPermissionError(isPermissionError); uiState.setIsConfirmationOpen(true);
    } else {
      handleSearch(symbol).catch(err => console.error("Search failed from requestAnalysis", err));
    }
  }, [handleSearch, userTier, uiState.recentSearches]);

  const handleProceedWithAnalysis = useCallback(() => {
    if (uiState.stockToAnalyze) { handleSearch(uiState.stockToAnalyze).catch(err => console.error("Search failed after confirmation", err)); }
    uiState.setIsConfirmationOpen(false); uiState.setStockToAnalyze(null); uiState.setConfirmationWarnings([]); uiState.setIsConfirmationPermissionError(false);
  }, [handleSearch, uiState.stockToAnalyze]);

  const processNextBulkStock = useCallback(async () => {
    if (!activeAnalysisState.isActive || activeAnalysisState.isPaused || activeAnalysisState.queue.length === 0) return;
    const nextSymbol = activeAnalysisState.queue[0];
    bulkCurrentStockStartTime.current = Date.now();
    dispatchAnalysis({ type: 'START_STOCK', payload: { symbol: nextSymbol } });
    try {
        await new Promise(resolve => setTimeout(resolve, 0));
        await handleSearch(nextSymbol, true);
    } catch (error) {
        addLog(`Error processing bulk stock ${nextSymbol}: ${error.message}`, 'error');
        dispatchAnalysis({ type: 'FAIL_STOCK', payload: { error: error.message, startTime: bulkCurrentStockStartTime.current } });
    }
  }, [activeAnalysisState.isActive, activeAnalysisState.isPaused, activeAnalysisState.queue, handleSearch]);

  const handlePortfolioCardClick = useCallback(async (stock) => {
    if (!stock?.symbol) { addLog('Invalid stock object received', 'error'); return; }
    if (stock.forceRefresh) { requestAnalysis(stock.symbol); return; }
    clearAllState(); uiState.setIsViewingHistorical(true); chartData.setStockSymbol(stock.symbol);
    try {
        const timestamp = stock?.cache_key_timestamp;
        if (!timestamp) { showToast(toast, { title: 'Missing Cache Key', description: 'Cannot fetch specific recommendation without a cache key timestamp.', status: 'error' }); return; }
        const singleRec = await getHistoricalRecommendation(stock.symbol, 1, true, "target_date", timestamp);
        const exactRec = singleRec?.[0];
        if (exactRec) {
            portfolioData.setRecommendationData(exactRec);
            chartData.setCompanyInfo(exactRec.rawData?.company || { symbol: stock.symbol, name: stock.symbol });
            showToast(toast, { title: 'Recommendation Loaded', description: `Displaying cached ${exactRec.action} recommendation for ${stock.symbol}`, status: 'success' });
        } else {
            chartData.setCompanyInfo(null);
            showToast(toast, { title: 'Recommendation Not Found', description: 'Could not find a cached recommendation for that selection.', status: 'warning' });
        }
    } catch (error) {
        handleError(error, `Loading historical recommendation for ${stock.symbol}`, toast); chartData.setCompanyInfo(null);
    }
  }, [requestAnalysis, clearAllState]);

  useEffect(() => { stockSymbolRef.current = chartData.stockSymbol; }, [chartData.stockSymbol]);
  useEffect(() => {
    const unsubCancel = on('analysis_cancelled', (data) => {
      if (data.symbol === stockSymbolRef.current) {
        clearAllState();
        showToast(toast, { title: 'Analysis Cancelled', description: `Successfully cancelled analysis for ${data.symbol}`, status: 'warning' });
      }
      if (activeAnalysisState.currentStock === data.symbol) dispatchAnalysis({ type: 'CANCEL_BULK' });
    });
    const unsubStatus = on('status_update', (data) => { if (data.status === 'cancelled' && data.symbol === stockSymbolRef.current) clearAllState(); });
    return () => { unsubCancel(); unsubStatus(); };
  }, [activeAnalysisState.currentStock, clearAllState]);

  useEffect(() => {
    const callbacks = {
        setStockSymbol: chartData.setStockSymbol, setCompanyInfo: chartData.setCompanyInfo, setArticles: analysisData.setArticles, setStockAnalyzedArticles: analysisData.setStockAnalyzedArticles,
        setStockSentimentData: chartData.setStockSentimentData, setStockPriceData: chartData.setStockPriceData, setStockHistoricalData: chartData.setStockHistoricalData, setClaudeImages: analysisData.setClaudeImages,
        setMarketSentimentData: chartData.setMarketSentimentData, setMarketAnalyzedArticles: analysisData.setMarketAnalyzedArticles, setIndustrySentimentData: chartData.setIndustrySentimentData,
        setIndustryAnalyzedArticles: analysisData.setIndustryAnalyzedArticles, setSelectedIndexRecentData: chartData.setSelectedIndexRecentData, setSelectedIndexHistoricalData: chartData.setSelectedIndexHistoricalData,
        setAnalysisHasRecommendation: analysisData.setAnalysisHasRecommendation, setRecommendationData: portfolioData.setRecommendationData, setPortfolioRecommendation: portfolioData.setPortfolioRecommendation,
        setSystemSymbols: portfolioData.setSystemSymbols, setIsLoadingPortfolio: portfolioData.setIsLoadingPortfolio, setIsSystemSymbolsLoading: portfolioData.setIsSystemSymbolsLoading,
        setPortfolioPredictionAccuracyData: portfolioData.setPortfolioPredictionAccuracyData, setIsLoadingPredictionAccuracy: portfolioData.setIsLoadingPredictionAccuracy,
        setIsAnalyzingPredictionAccuracy: portfolioData.setIsAnalyzingPredictionAccuracy, setIsThinkingPanelMinimized: uiState.setIsThinkingPanelMinimized, dispatchLoading,
        setStockProcessingState: analysisData.setStockProcessingState, setIndustryProcessingState: analysisData.setIndustryProcessingState, setMarketProcessingState: analysisData.setMarketProcessingState,
        setAnalysisStatus: analysisData.setAnalysisStatus, setSettingsChanged: uiState.setSettingsChanged, setOptionsData: analysisData.setOptionsData, setOptionsImages: analysisData.setOptionsImages,
        setIsLoadingOptionsData: analysisData.setIsLoadingOptionsData, setTradingCalendar: chartData.setTradingCalendar, handleOpenThinkingPanel, appendLog, companyInfo: chartData.companyInfo,
        bulkProgressCallback: handleBulkProgress, appendThinkingStream, isNewThinkingSource, setThinkingStreams: portfolioData.setThinkingStreams
    };
    if (!dataServiceRef.current) dataServiceRef.current = new DashboardDataService(callbacks, toast);
    else dataServiceRef.current.updateCallbacks(callbacks);
  }, [
    chartData, analysisData, portfolioData, uiState.settings, uiState.setSettingsChanged,
    uiState.setIsThinkingPanelMinimized, handleOpenThinkingPanel, appendLog,
    handleBulkProgress, appendThinkingStream, isNewThinkingSource
  ]);

  useEffect(() => { if (dataServiceRef.current) dataServiceRef.current.optionsImages = analysisData.optionsImages; }, [analysisData.optionsImages]);
  useEffect(() => { TimeService.setTimeOverride(uiState.settings.enableTimeOverride, uiState.settings.overrideDateTime); }, [uiState.settings.enableTimeOverride, uiState.settings.overrideDateTime]);
  useEffect(() => { if (dataServiceRef.current) { dataServiceRef.current.setupSocketConnection(); dataServiceRef.current.fetchInitialCalendar(); } }, []);
  useEffect(() => { if (dataServiceRef.current) dataServiceRef.current.stockSymbolRef.current = chartData.stockSymbol; }, [chartData.stockSymbol]);
  useEffect(() => {
    if (portfolioData.recommendationData && chartData.stockSymbol && analysisStartTime) {
        const { action, cache_key_timestamp, cached_at, timestamp } = portfolioData.recommendationData;
        const recSymbol = portfolioData.recommendationData.rawData?.company?.symbol || portfolioData.recommendationData.symbol;
        if (chartData.stockSymbol !== recSymbol) return;
        uiState.setRecentSearches(prev => {
            const index = prev.findIndex(item => item.symbol === chartData.stockSymbol);
            if (index === -1) return prev;
            const newSearches = [...prev];
            newSearches[index] = { ...newSearches[index], action: action || 'N/A', duration: Date.now() - analysisStartTime, cache_key_timestamp: cache_key_timestamp || cached_at || timestamp };
            try { localStorage.setItem('recentStockSearches', JSON.stringify(newSearches)); } catch (e) { console.error('Error saving recent searches', e); }
            return newSearches;
        });
    }
  }, [portfolioData.recommendationData, chartData.stockSymbol, analysisStartTime]);

  const { setSystemSymbols, setPortfolioRecommendation, setPortfolioPredictionAccuracyData } = portfolioData;

  const handleRequestSystemSymbols = useCallback(async (isSilent = false) => {
    if (dataServiceRef.current) {
      const newSymbols = await dataServiceRef.current.handleFetchSystemSymbols(isSilent);
      if(newSymbols?.length > 0) {
        setSystemSymbols(current => (newSymbols[0]?.timestamp !== current[0]?.timestamp) ? newSymbols : current);
      }
    }
  }, [setSystemSymbols]);

const handleRequestPortfolioAnalysis = useCallback(async (forceRefresh = false) => {
  if (dataServiceRef.current) {
    const response = await dataServiceRef.current.handleRequestPortfolioAnalysis(forceRefresh).catch(err => {
      console.error(err);
      return null;
    });
    if (response) {
      setPortfolioRecommendation(current => {
        if (!current || response.timestamp !== current?.timestamp) {
          return response;
        }
        return current;
      });
    }
  }
}, [setPortfolioRecommendation]);

  const handleRequestPredictionAccuracy = useCallback(async (params) => {
    if (dataServiceRef.current) {
      const response = await dataServiceRef.current.handleRequestPredictionAccuracy('ALL', params).catch(err => console.error(err));
      if (response) {
        setPortfolioPredictionAccuracyData(current => (
            !current || params?.forceRefresh ||
            response.metadata?.last_updated !== current.metadata?.last_updated ||
            response.metadata?.processed_count !== current.metadata?.processed_count
          ) ? response : current);
      }
    }
  }, [setPortfolioPredictionAccuracyData]);

useEffect(() => {
      if (userTier === 'guest') return;

      handleRequestPortfolioAnalysis(false);
      handleRequestPredictionAccuracy({ forceRefresh: false });
      handleRequestSystemSymbols(false);

      const portfolioTimer = setInterval(() => {
        handleRequestPortfolioAnalysis(false);
      }, REFRESH_INTERVALS.PORTFOLIO_MS);

      const accuracyTimer = setInterval(() => {
        handleRequestPredictionAccuracy({ forceRefresh: false });
      }, REFRESH_INTERVALS.PREDICTION_ACCURACY_MS);

      const systemSymbolsTimer = setInterval(() => {
        handleRequestSystemSymbols(true);
      }, REFRESH_INTERVALS.SYSTEM_SYMBOLS_MS);

      return () => {
        clearInterval(portfolioTimer);
        clearInterval(accuracyTimer);
        clearInterval(systemSymbolsTimer);
      };
    }, [userTier, handleRequestPortfolioAnalysis, handleRequestPredictionAccuracy, handleRequestSystemSymbols]);

  const handleStockComplete = useCallback((recommendationAction) => {
    if (activeAnalysisState.currentStock) {
      dispatchAnalysis({
        type: 'COMPLETE_STOCK',
        payload: {
          startTime: bulkCurrentStockStartTime.current,
          action: recommendationAction || 'N/A'
        }
      });
    }
  }, [activeAnalysisState.currentStock]);

  const handleRequestRecommendation = useCallback(async () => {
    if (dataServiceRef.current) {
      handleBulkProgress('GENERATING_RECOMMENDATION', 95, 'Generating trading recommendation');
      recommendationRequestedRef.current = true;
      const recommendation = await dataServiceRef.current.handleRequestRecommendation(
        chartData.stockSymbol, chartData.companyInfo, analysisData.claudeImages,
        analysisData.stockAnalyzedArticles, analysisData.industryAnalyzedArticles,
        analysisData.marketAnalyzedArticles, true, chartData.selectedMarketIndex,
        uiState.settings, []
      ).catch(err => console.error(err));
      recommendationRequestedRef.current = false;
      handleBulkProgress('COMPLETE', 100, 'Analysis complete');
      setTimeout(() => handleStockComplete(recommendation?.action), 500);
    }
  }, [
      chartData.stockSymbol, chartData.companyInfo, analysisData.claudeImages,
      analysisData.stockAnalyzedArticles, analysisData.industryAnalyzedArticles,
      analysisData.marketAnalyzedArticles, chartData.selectedMarketIndex,
      uiState.settings, handleStockComplete, handleBulkProgress
  ]);

  useEffect(() => {
    const { stockCompleted, industryCompleted, marketCompleted, optionsReady, imageReady } = analysisData.analysisStatus;
    const tuningComplete = !!analysisData.tunerResults;
    if (stockCompleted && industryCompleted && marketCompleted && optionsReady && imageReady && tuningComplete) {
      if (!uiState.settings.disableAutoRecommendation && !analysisData.analysisHasRecommendation && !loadingState.recommendation && !recommendationRequestedRef.current && chartData.stockSymbol && chartData.stockPriceData.length > 0 && analysisData.stockAnalyzedArticles.length > 0 && analysisData.claudeImages) {
        analysisData.setAnalysisHasRecommendation(true);
        recommendationRequestedRef.current = true;
        setTimeout(() => handleRequestRecommendation(false).catch(err => console.error("Auto recommendation failed", err)), 500);
      } else if (uiState.settings.disableAutoRecommendation) {
        handleStockComplete();
      }
    }
  }, [
    analysisData.analysisStatus, analysisData.tunerResults, chartData.stockSymbol, analysisData.analysisHasRecommendation,
    chartData.stockPriceData.length, analysisData.stockAnalyzedArticles.length, loadingState.recommendation,
    uiState.settings.disableAutoRecommendation, analysisData.claudeImages,
    handleStockComplete, handleRequestRecommendation
  ]);

  useEffect(() => {
    if (uiState.isViewingHistorical) return;
    if (chartData.stockSymbol && uiState.settings.daysBack && dataServiceRef.current && !uiState.historicalDataFetched) {
      dataServiceRef.current.fetchSelectedMarketIndexData(chartData.selectedMarketIndex, chartData.stockSymbol, uiState.settings);
      uiState.setHistoricalDataFetched(true);
    }
  }, [uiState.isViewingHistorical, chartData.stockSymbol, chartData.selectedMarketIndex, uiState.historicalDataFetched, uiState.settings]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('recentStockSearches');
      if (saved) {
        uiState.setRecentSearches(JSON.parse(saved).slice(0, 20));
      }
    } catch (e) {
      console.error('Error loading recent searches', e);
    }
  }, []);

  const handleBulkComplete = useCallback(async () => {
    const successMsg = {
      title: 'Bulk Analysis Complete',
      description: `Processed ${activeAnalysisState.completedStocks.length} stocks successfully`,
      status: 'success'
    };
    if (uiState.settings.disableAutoRecommendation) {
      showToast(toast, { ...successMsg, description: `${successMsg.description} (recommendations disabled)` });
    } else {
      try {
        await handleRequestPortfolioAnalysis(true);
        showToast(toast, successMsg);
      } catch (error) {
        addLog(`Error generating final portfolio: ${error.message}`, 'error');
      }
    }
    dispatchAnalysis({ type: 'CANCEL_BULK' });
  }, [activeAnalysisState.completedStocks.length, uiState.settings.disableAutoRecommendation, handleRequestPortfolioAnalysis]);

  useEffect(() => {
    if (activeAnalysisState.queue.length === 0 && activeAnalysisState.isActive && !activeAnalysisState.currentStock) {
      handleBulkComplete().catch(err => console.error(err));
    }
  }, [activeAnalysisState, handleBulkComplete]);

  useEffect(() => {
    if (activeAnalysisState.isActive && !activeAnalysisState.isPaused && !activeAnalysisState.currentStock && activeAnalysisState.queue.length > 0) {
      processNextBulkStock().catch(err => console.error(err));
    }
  }, [activeAnalysisState, processNextBulkStock]);

  const autoOpenPanel = useCallback((panelName, hasData) => {
    if (uiState.userPanelOverrides.has(panelName) || !uiState.minimizedPanels[panelName]) return;
    if (hasData) {
      uiState.setMinimizedPanels(prev => ({ ...prev, [panelName]: false }));
    }
  }, [uiState.minimizedPanels, uiState.userPanelOverrides]);

  useEffect(() => { autoOpenPanel('chart', panelHasContent.chart); }, [panelHasContent.chart, autoOpenPanel]);
  useEffect(() => { autoOpenPanel('visualization', panelHasContent.visualization); }, [panelHasContent.visualization, autoOpenPanel]);
  useEffect(() => { autoOpenPanel('articles', panelHasContent.articles); }, [panelHasContent.articles, autoOpenPanel]);
  useEffect(() => { autoOpenPanel('logs', panelHasContent.logs); }, [panelHasContent.logs, autoOpenPanel]);
  useEffect(() => { autoOpenPanel('recommendation', panelHasContent.recommendation); }, [panelHasContent.recommendation, autoOpenPanel]);
  useEffect(() => { autoOpenPanel('systemSymbols', panelHasContent.systemSymbols); }, [panelHasContent.systemSymbols, autoOpenPanel]);
  useEffect(() => { autoOpenPanel('portfolio', panelHasContent.portfolio); autoOpenPanel('portfolioMonitor', panelHasContent.portfolioMonitor); }, [panelHasContent.portfolio, autoOpenPanel]);
  useEffect(() => { autoOpenPanel('portfolioPredictionAccuracy', panelHasContent.portfolioPredictionAccuracy); }, [panelHasContent.portfolioPredictionAccuracy, autoOpenPanel]);

  const handleStartBulkAnalysis = useCallback((selectedSymbols, disableRecOverride) => {
    if (selectedSymbols.length === 0) {
      showToast(toast, {
        title: 'No Stocks Selected',
        description: 'Please select at least one stock for bulk analysis',
        status: 'warning'
      });
      return;
    }
    if (disableRecOverride !== undefined) {
      uiState.setSettings(prev => ({ ...prev, disableAutoRecommendation: disableRecOverride }));
    }
    uiState.setIsBulkProgressOpen(true);
    dispatchAnalysis({
      type: 'START_BULK',
      payload: { stocks: selectedSymbols }
    });
    showToast(toast, {
      title: 'Bulk Analysis Started',
      description: `Processing ${selectedSymbols.length} stocks in sequence`,
      status: 'info'
    });
  }, []);

  const handlePauseResumeBulk = useCallback(() => {
    dispatchAnalysis({ type: activeAnalysisState.isPaused ? 'RESUME_BULK' : 'PAUSE_BULK' });
  }, [activeAnalysisState.isPaused]);

  const handleCancelBulk = useCallback(() => {
    dispatchAnalysis({ type: 'CANCEL_BULK' });
    clearAllSubscriptions();
    showToast(toast, {
      title: 'Bulk Analysis Cancelled',
      description: 'All queued analyses have been stopped',
      status: 'warning'
    });
  }, []);

  const handleCloseThinkingPanel = useCallback(() => uiState.setIsThinkingPanelOpen(false), []);
  const handleThinkingSourceChange = useCallback((source) => uiState.setThinkingPanelSource(source), []);
  const toggleMinimize = useCallback((panel) => {
    uiState.setUserPanelOverrides(prev => new Set([...prev, panel]));
    uiState.setMinimizedPanels(prev => ({ ...prev, [panel]: !prev[panel] }));
  }, []);
  const clearLogs = useCallback(() => {
    uiState.setLogs([]);
    addLog('Logs cleared', 'info');
  }, []);

  const handleMarketIndexChange = useCallback(async (indexName) => {
    if (indexName === chartData.selectedMarketIndex) return;
    chartData.setSelectedMarketIndex(indexName);
    if (dataServiceRef.current && chartData.stockSymbol) {
      await dataServiceRef.current.fetchMarketIndexChangeData(indexName, chartData.stockSymbol, uiState.settings).catch(err => console.error(err));
    }
  }, [chartData.selectedMarketIndex, chartData.stockSymbol, uiState.settings]);

  const handleSettingsChange = useCallback((newSettings) => {
    const settingsChanged = newSettings.daysBack !== uiState.settings.daysBack ||
      newSettings.totalArticlesPerDay !== uiState.settings.totalArticlesPerDay ||
      newSettings.useTurboModel !== uiState.settings.useTurboModel;

    uiState.setSettings(newSettings);
    TimeService.setTimeOverride(newSettings.enableTimeOverride, newSettings.overrideDateTime);

    if (settingsChanged) {
      uiState.setSettingsChanged(true);
      showToast(toast, {
        title: 'Settings Changed',
        description: 'Click Analyze to apply new settings',
        status: 'info'
      });
    }
  }, [uiState.settings]);

  const handleImageGenerated = useCallback((images) => {
    analysisData.setClaudeImages(images);
    analysisData.setAnalysisStatus(prev => ({...prev, imageReady: true}));
    const imageCategoryMap = images.reduce((acc, img) => ({...acc, [img.category]: true}), {});
    dispatchAnalysis({ type: 'UPDATE_IMAGES', payload: imageCategoryMap });
    if (activeAnalysisState.isActive) {
      handleBulkProgress('GENERATING_VISUALIZATION', 85, 'Visualization images generated');
    }
  }, [handleBulkProgress, activeAnalysisState.isActive]);

  const handleImageGenerationFailed = useCallback((error) => {
    addLog(`Failed to generate visualization image: ${error}`, 'error');
    showToast(toast, {
      title: 'Visualization Failed',
      description: 'Could not generate the visualization image for analysis',
      status: 'error'
    });
    dispatchAnalysis({
        type: 'FAIL_STOCK',
        payload: {
          error: `Visualization failed: ${error}`,
          startTime: bulkCurrentStockStartTime.current
        }
      });
  }, []);

  const handleTuningStatusChange = useCallback((isTuning) => {
    uiState.setIsTuning(isTuning);
  }, []);

  const handleTuningComplete = useCallback((results) => {
    analysisData.setTunerResults(results);
    uiState.setIsTuning(false);
  }, []);

  useEffect(() => {
    if (!uiState.settings.enableScheduledAnalysis) {
      uiState.setNextScheduledRun(null);
      return;
    }

    const checkSchedule = () => {
        const nowET = new Date(TimeService.getCurrentTime().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const day = nowET.getDay();
        const hour = nowET.getHours();
        const minute = nowET.getMinutes();

        if (hour === 0 && minute === 1) {
            runTimestamps.current = { run730: false, run830: false };
        }

        const isWeekday = day > 0 && day < 6;
        const { PRE_COMPUTATION_RUN: preCompRun, RECOMMENDATION_RUN: recRun } = SCHEDULED_ANALYSIS;

        let nextRunForToday = null;
        if (isWeekday) {
            const preCompTime = new Date(nowET).setHours(preCompRun.HOUR_ET, preCompRun.MINUTE_ET, 0, 0);
            const recTime = new Date(nowET).setHours(recRun.HOUR_ET, recRun.MINUTE_ET, 0, 0);
            if (nowET.getTime() < preCompTime) {
                nextRunForToday = { name: preCompRun.NAME, date: preCompTime };
            } else if (nowET.getTime() < recTime) {
                nextRunForToday = { name: recRun.NAME, date: recTime };
            }
        }
        if (!nextRunForToday) {
            let nextDay = new Date(nowET);
            nextDay.setDate(nextDay.getDate() + 1);
            if (nextDay.getDay() === 6) nextDay.setDate(nextDay.getDate() + 2);
            if (nextDay.getDay() === 0) nextDay.setDate(nextDay.getDate() + 1);
            nextRunForToday = { name: preCompRun.NAME, date: new Date(nextDay).setHours(preCompRun.HOUR_ET, preCompRun.MINUTE_ET, 0, 0) };
        }
        uiState.setNextScheduledRun(nextRunForToday);

        if (!isWeekday || uiState.isViewingHistorical || activeAnalysisState.isActive) return;

        const stocksForBulk = uiState.recentSearches.map(s => s.symbol).slice(0, 10);
        if (stocksForBulk.length === 0) return;

        if (hour === preCompRun.HOUR_ET && minute === preCompRun.MINUTE_ET && !runTimestamps.current.run730) {
            addLog(`Scheduler: Triggering ${preCompRun.NAME} run.`, 'system');
            handleStartBulkAnalysis(stocksForBulk, preCompRun.SETTINGS.disableAutoRecommendation);
            runTimestamps.current.run730 = true;
        }

        if (hour === recRun.HOUR_ET && minute === recRun.MINUTE_ET && !runTimestamps.current.run830) {
            addLog(`Scheduler: Triggering ${recRun.NAME} run.`, 'system');
            handleStartBulkAnalysis(stocksForBulk, recRun.SETTINGS.disableAutoRecommendation);
            runTimestamps.current.run830 = true;
        }
    };

    checkSchedule();
    const intervalId = setInterval(checkSchedule, 60000);
    return () => clearInterval(intervalId);
  }, [
    uiState.settings.enableScheduledAnalysis,
    uiState.recentSearches,
    activeAnalysisState.isActive,
    uiState.isViewingHistorical,
    handleStartBulkAnalysis
  ]);

  const memoizedPanelContent = useMemo(() => ({
    chart: panelHasContent.chart, visualization: panelHasContent.visualization, articles: panelHasContent.articles,
    logs: panelHasContent.logs, recommendation: panelHasContent.recommendation, systemSymbols: panelHasContent.systemSymbols,
    portfolio: panelHasContent.portfolio, portfolioMonitor: panelHasContent.portfolioMonitor, portfolioPredictionAccuracy: panelHasContent.portfolioPredictionAccuracy,
  }), [panelHasContent]);

  const memoizedSentimentData = useMemo(() => ({
    stock: chartData.stockSentimentData, market: chartData.marketSentimentData, industry: chartData.industrySentimentData
  }), [chartData.stockSentimentData, chartData.marketSentimentData, chartData.industrySentimentData]);

  const memoizedPriceData = useMemo(() => ({
    stock: chartData.stockPriceData, stockHistorical: chartData.stockHistoricalData,
    marketIndices: chartData.preparedMarketIndexData, selectedIndexHistorical: chartData.selectedIndexHistoricalData
  }), [chartData.stockPriceData, chartData.stockHistoricalData, chartData.preparedMarketIndexData, chartData.selectedIndexHistoricalData]);

  const memoizedChartParams = useMemo(() => {
      if (!chartData.sharedChartParams) {
          return { tunerResults: analysisData.tunerResults };
      }
      return { ...chartData.sharedChartParams, tunerResults: analysisData.tunerResults };
  }, [chartData.sharedChartParams, analysisData.tunerResults]);


  const memoizedArticles = useMemo(() => ([...analysisData.stockAnalyzedArticles, ...analysisData.industryAnalyzedArticles.map(a => ({...a, isIndustryArticle: true})), ...analysisData.marketAnalyzedArticles.map(a => ({...a, isMarketArticle: true}))]), [analysisData.stockAnalyzedArticles, analysisData.industryAnalyzedArticles, analysisData.marketAnalyzedArticles]);
  const isAnalysisComplete = analysisData.analysisStatus.stockCompleted && analysisData.analysisStatus.marketCompleted && analysisData.analysisStatus.industryCompleted;

  return (
    <>
      <CSSReset />
      <Box display="flex" flexDirection="column" height="100vh" overflow="hidden">
        <DashboardHeader
            panelIsProcessing={panelIsProcessing} panelHasContent={memoizedPanelContent} scrollToPanel={scrollToPanel} panelRefs={panelRefs}
            analysisStatus={analysisData.analysisStatus} recommendationData={portfolioData.recommendationData} tradingCalendar={chartData.tradingCalendar}
            nextScheduledRun={uiState.nextScheduledRun} setIsToolsPanelVisible={setIsToolsPanelVisible} setIsBulkProgressOpen={uiState.setIsBulkProgressOpen}
            isAdmin={isAdmin} activeAnalysisState={activeAnalysisState} stockProcessingState={analysisData.stockProcessingState}
            marketProcessingState={analysisData.marketProcessingState} industryProcessingState={analysisData.industryProcessingState}
            isTuning={uiState.isTuning} tunerResults={analysisData.tunerResults}
        />
        <ReprocessConfirmationDialog isOpen={uiState.isConfirmationOpen} onClose={() => uiState.setIsConfirmationOpen(false)} onConfirm={handleProceedWithAnalysis} warnings={uiState.confirmationWarnings} isPermissionError={uiState.isConfirmationPermissionError} />
        <Flex
            flex="1"
            p={4}
            gap={4}
            overflow="hidden"
            width="100%"
        >
            <Flex
                direction="column"
                gap={4}
                flex="2 1 0%"
                overflowY="auto"
                {...UI_EFFECTS.hardware.acceleration}
            >
                <Box ref={panelRefs.chart}>
                    <PanelContainer
                        isMinimized={uiState.minimizedPanels.chart}
                        onToggleMinimize={() => toggleMinimize('chart')}
                        title={chartData.companyInfo ? `${chartData.companyInfo.name} (${chartData.companyInfo.symbol})` : PANEL_NAMES.chart}
                        p={0}
                        panelLayout="adaptive"
                        isProcessing={loadingState.analysis || uiState.isTuning}
                    >
                        <MemoizedSentimentChart
                            stockSentimentData={memoizedSentimentData.stock}
                            marketSentimentData={memoizedSentimentData.market}
                            industrySentimentData={memoizedSentimentData.industry}
                            stockPriceData={memoizedPriceData.stock}
                            marketIndicesData={memoizedPriceData.marketIndices}
                            companyInfo={chartData.companyInfo}
                            isLoadingMarketIndices={loadingState.indexData}
                            showControls={true}
                            tradingCalendar={chartData.tradingCalendar}
                            futureWindowHours={8}
                            isAnalysisComplete={isAnalysisComplete}
                            onParamsUpdate={chartData.handleChartParamsUpdate}
                            onTuningStatusChange={handleTuningStatusChange}
                            onTuningComplete={handleTuningComplete}
                        />
                    </PanelContainer>
                </Box>

                <Box ref={panelRefs.visualization}>
                    <PanelContainer
                        isMinimized={uiState.minimizedPanels.visualization}
                        onToggleMinimize={() => toggleMinimize('visualization')}
                        title={PANEL_NAMES.visualization}
                        p={0}
                        panelLayout="adaptive"
                        isProcessing={uiState.isGeneratingViz}
                    >
                        <MemoizedSentimentSupplementaryContent
                            stockSentimentData={memoizedSentimentData.stock}
                            marketSentimentData={memoizedSentimentData.market}
                            industrySentimentData={memoizedSentimentData.industry}
                            stockPriceData={memoizedPriceData.stock}
                            stockHistoricalData={memoizedPriceData.stockHistorical}
                            marketIndicesData={memoizedPriceData.marketIndices}
                            selectedMarketIndex={chartData.selectedMarketIndex}
                            selectedIndexHistoricalData={memoizedPriceData.selectedIndexHistorical}
                            companyInfo={chartData.companyInfo}
                            analysisStatus={analysisData.analysisStatus}
                            onImageGenerated={handleImageGenerated}
                            onImageGenerationFailed={handleImageGenerationFailed}
                            settings={uiState.settings}
                            optionsData={analysisData.optionsData}
                            tradingCalendar={chartData.tradingCalendar}
                            futureWindowHours={8}
                            setIsGeneratingViz={uiState.setIsGeneratingViz}
                            chartParams={memoizedChartParams}
                            isTuning={uiState.isTuning}
                        />
                    </PanelContainer>
                </Box>

                <Box ref={panelRefs.recommendation}>
                    <PanelContainer
                        id="recommendation-panel"
                        isMinimized={uiState.minimizedPanels.recommendation}
                        onToggleMinimize={() => toggleMinimize('recommendation')}
                        title={PANEL_NAMES.recommendation}
                        p={0}
                        panelLayout="adaptive"
                        isProcessing={loadingState.recommendation}
                    >
                        <RecommendationPanel
                            recommendation={portfolioData.recommendationData}
                            rawData={portfolioData.recommendationData?.rawData}
                            isLoading={loadingState.recommendation}
                            onRequestAnalysis={() => handleRequestRecommendation(true).catch(err => console.error(err))}
                            companyInfo={chartData.companyInfo}
                            marketArticlesCount={analysisData.marketAnalyzedArticles.length}
                            industryArticlesCount={analysisData.industryAnalyzedArticles.length}
                            settings={uiState.settings}
                        />
                    </PanelContainer>
                </Box>
            </Flex>

            <Flex
                direction="column"
                gap={4}
                flex="2 1 0%"
                overflowY="auto"
                {...UI_EFFECTS.hardware.acceleration}
            >
                <Box ref={panelRefs.systemSymbols}>
                    <PanelContainer
                        isMinimized={uiState.minimizedPanels.systemSymbols}
                        onToggleMinimize={() => toggleMinimize('systemSymbols')}
                        title="System Symbols"
                        p={0}
                        panelLayout="adaptive"
                        isProcessing={portfolioData.isSystemSymbolsLoading}
                    >
                        <SystemSymbolsPanel
                            recommendations={portfolioData.systemSymbols}
                            onRefresh={() => handleRequestSystemSymbols(false)}
                            onCardClick={handlePortfolioCardClick}
                            setIsLoading={portfolioData.setIsSystemSymbolsLoading}
                        />
                    </PanelContainer>
                </Box>

                <Box ref={panelRefs.portfolio}>
                    <PanelContainer
                        isMinimized={uiState.minimizedPanels.portfolio}
                        onToggleMinimize={() => toggleMinimize('portfolio')}
                        title={PANEL_NAMES.portfolio}
                        p={0}
                        panelLayout="adaptive"
                        isProcessing={portfolioData.isLoadingPortfolio}
                    >
                        <PortfolioPanel
                            portfolioRecommendation={portfolioData.portfolioRecommendation}
                            isLoading={portfolioData.isLoadingPortfolio}
                            onRequestAnalysis={handleRequestPortfolioAnalysis}
                            settings={uiState.settings}
                            onCardClick={handlePortfolioCardClick}
                        />
                    </PanelContainer>
                </Box>

                <Box ref={panelRefs.portfolioMonitor}>
                    <PanelContainer
                        isMinimized={uiState.minimizedPanels.portfolioMonitor}
                        onToggleMinimize={() => toggleMinimize('portfolioMonitor')}
                        title={PANEL_NAMES.portfolioMonitor}
                        p={0}
                        panelLayout="adaptive"
                    >
                        <RealTimePortfolioMonitor
                            portfolioRecommendation={portfolioData.portfolioRecommendation}
                            onCardClick={handlePortfolioCardClick}
                        />
                    </PanelContainer>
                </Box>

                <Box ref={panelRefs.portfolioPredictionAccuracy}>
                    <PanelContainer
                        isMinimized={uiState.minimizedPanels.portfolioPredictionAccuracy}
                        onToggleMinimize={() => toggleMinimize('portfolioPredictionAccuracy')}
                        title={PANEL_NAMES.portfolioPredictionAccuracy}
                        p={0}
                        panelLayout="adaptive"
                        isProcessing={panelIsProcessing.portfolioPredictionAccuracy}
                    >
                        <PortfolioPredictionAccuracyPanel
                            portfolioData={portfolioData.portfolioPredictionAccuracyData}
                            isLoading={portfolioData.isLoadingPredictionAccuracy}
                            isAnalyzing={portfolioData.isAnalyzingPredictionAccuracy}
                            onRequestAnalysis={handleRequestPredictionAccuracy}
                        />
                    </PanelContainer>
                </Box>
            </Flex>

            <Collapse in={isToolsPanelVisible} animateOpacity style={{ flex: '1 1 0%' }}>
                <Flex
                    direction="column"
                    gap={4}
                    width="100%"
                    height="100%"
                    overflowY="auto"
                    {...UI_EFFECTS.hardware.acceleration}
                >
                    <Box ref={panelRefs.search}>
                        <PanelContainer
                            isMinimized={uiState.minimizedPanels.search}
                            onToggleMinimize={() => toggleMinimize('search')}
                            showMinimizeButton={true}
                            title={PANEL_NAMES.search}
                            p={0}
                            minHeight={THEME.components.panel.minHeight.compact}
                            panelLayout="fixed"
                            isProcessing={loadingState.analysis}
                            isDisabled={!isAdmin}
                        >
                            <SearchBar
                                onSearch={requestAnalysis}
                                isLoading={loadingState.analysis}
                                settingsChanged={uiState.settingsChanged}
                                companyInfo={chartData.companyInfo}
                                currentSymbol={chartData.stockSymbol}
                                marketKeywords={MARKET_SENTIMENT.KEYWORDS}
                                recentSearches={uiState.recentSearches}
                                onRecentSearchesChange={uiState.setRecentSearches}
                                onRecentSearchClick={handlePortfolioCardClick}
                            />
                        </PanelContainer>
                    </Box>

                    <Box ref={panelRefs.settings}>
                        <PanelContainer
                            isMinimized={uiState.minimizedPanels.settings}
                            onToggleMinimize={() => toggleMinimize('settings')}
                            title={PANEL_NAMES.settings}
                            p={0}
                            minHeight={THEME.components.panel.minHeight.compact}
                            panelLayout="fixed"
                            isDisabled={!isAdmin}
                        >
                            <Settings
                                settings={uiState.settings}
                                onSettingsChange={handleSettingsChange}
                                companyInfo={chartData.companyInfo}
                            />
                        </PanelContainer>
                    </Box>

                    <Box ref={panelRefs.articles}>
                        <PanelContainer
                            isMinimized={uiState.minimizedPanels.articles}
                            onToggleMinimize={() => toggleMinimize('articles')}
                            minHeight="400px"
                            maxHeight="400px"
                            title={PANEL_NAMES.articles}
                            p={0}
                            panelLayout="fixed"
                            isProcessing={isArticleProcessing}
                        >
                            <MemoizedArticleList
                                articles={memoizedArticles}
                                isLoading={loadingState.analysis}
                                stockProcessingState={analysisData.stockProcessingState}
                                industryProcessingState={analysisData.industryProcessingState}
                                marketProcessingState={analysisData.marketProcessingState}
                                analysisStatus={analysisData.analysisStatus}
                                settings={uiState.settings}
                            />
                        </PanelContainer>
                    </Box>

                    <Box ref={panelRefs.logs}>
                        <PanelContainer
                            isMinimized={uiState.minimizedPanels.logs}
                            onToggleMinimize={() => toggleMinimize('logs')}
                            minHeight="400px"
                            maxHeight="400px"
                            title={PANEL_NAMES.logs}
                            panelLayout="fixed"
                            actions={
                                <Button
                                    size="xs"
                                    variant="outline"
                                    colorScheme="red"
                                    isDisabled={uiState.logs.length === 0}
                                    onClick={clearLogs}
                                >
                                    Clear
                                </Button>
                            }
                            p={0}
                        >
                            <DebugLog logs={uiState.logs} />
                        </PanelContainer>
                    </Box>
                </Flex>
            </Collapse>
        </Flex>
        <FloatingThinkingPanel isOpen={uiState.isThinkingPanelOpen} onClose={handleCloseThinkingPanel} thinkingStreams={portfolioData.thinkingStreams} activeSource={uiState.thinkingPanelSource} onSourceChange={handleThinkingSourceChange} isMinimized={uiState.isThinkingPanelMinimized} onToggleMinimize={() => uiState.setIsThinkingPanelMinimized(prev => !prev)} />
        {isAdmin && (<FloatingBulkProgressPanel isOpen={uiState.isBulkProgressOpen} onClose={() => uiState.setIsBulkProgressOpen(false)} isMinimized={uiState.isBulkProgressMinimized} onToggleMinimize={() => uiState.setIsBulkProgressMinimized(prev => !prev)} activeAnalysisState={activeAnalysisState} onStartBulkAnalysis={handleStartBulkAnalysis} onPauseResume={handlePauseResumeBulk} onCancel={handleCancelBulk} isPaused={activeAnalysisState.isPaused} isProcessing={activeAnalysisState.isActive} isTuning={uiState.isTuning} recentSearches={uiState.recentSearches} settings={uiState.settings} analysisStatus={analysisData.analysisStatus} tunerResults={analysisData.tunerResults} />)}
      </Box>
    </>
  );
};

export default DashboardContent;