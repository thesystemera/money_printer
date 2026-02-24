import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Box, Flex, useToast, useColorMode, Button } from '@chakra-ui/react';
import { getHistoricalRecommendation, fetchMarketData } from '../services/apiService';
import { downloadRawData, getSectionColors, PredictionDataAdapter } from './RecommendationHelper';
import { DEFAULT_UI_STATES, UI_ANIMATIONS } from '../config/Config';
import { showToast, handleError, addLog } from '../services/socketService';
import { Download, RefreshCw } from 'lucide-react';
import {
  HistoricalSelector, MarketTimingSection,
  RecommendationHeader, MarketContextSection, VolatilitySection,
  StrategySection, HourlyPriceTable,
  FactorsSection, DetailsSection,
  SuggestionsSection,
  ImageAnalysisSection, OptionsAnalyticsSection, VibeAnalysisSection, PredictionSynthesisSection, PredictionHistorySection, SignalReliabilityLogSection
} from './RecommendationComponents';
import { PredictionChart } from './RecommendationPredictionChart';
import { PredictionAccuracySection } from './RecommendationPredictionAccuracy';
import RecommendationImages from './RecommendationImages';
import { getCurrentTime } from '../services/timeService';

const useHistoricalRecommendations = (symbol, toast) => {
  const [recommendations, setRecommendations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSpecificRec, setLoadingSpecificRec] = useState(false);

  const fetchHistorical = useCallback(async () => {
    if (!symbol) return;
    setIsLoading(true);
    try {
      const fetchedRecs = await getHistoricalRecommendation(symbol, 50, false, "all");
      setRecommendations(fetchedRecs.map(rec => ({
        timestamp: rec.timestamp,
        target_trading_datetime: rec.target_trading_datetime,
        action: rec.action,
        confidence: rec.confidence,
        images: [],
        data: rec
      })));

      showToast(toast, {
        title: 'Recommendations Loaded',
        description: `Found ${fetchedRecs.length} recommendations (images load on selection)`,
        status: 'success'
      });
    } catch (error) {
      handleError(error, 'Fetching historical recommendations', toast);
    } finally {
      setIsLoading(false);
    }
  }, [symbol, toast]);

  const loadSpecificRecommendationWithImages = useCallback(async (recommendationData) => {
    if (!symbol || !recommendationData) return null;

    setLoadingSpecificRec(true);
    try {
      const targetTimestamp = recommendationData.cached_at || recommendationData.timestamp;
      const specificRecs = await getHistoricalRecommendation(
        symbol,
        1,
        true, // Include images this time
        "target_date",
        targetTimestamp
      );

      if (specificRecs && specificRecs.length > 0) {
        const recWithImages = specificRecs[0];
        addLog(`Loaded ${recWithImages.images?.length || 0} images for selected recommendation`, 'success');
        return recWithImages;
      }
      return null;
    } catch (error) {
      addLog(`Failed to load images for recommendation: ${error.message}`, 'error');
      return null;
    } finally {
      setLoadingSpecificRec(false);
    }
  }, [symbol, toast]);

  useEffect(() => {
    fetchHistorical().catch(console.error);
  }, [fetchHistorical]);

  return {
    historicalRecommendations: recommendations,
    setHistoricalRecommendations: setRecommendations,
    isLoadingHistorical: isLoading,
    fetchHistoricalRecommendation: fetchHistorical,
    loadSpecificRecommendationWithImages,
    loadingSpecificRec
  };
};

const useActualPriceData = (symbol, activeRecommendation) => {
  const [priceData, setPriceData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPrices = useCallback(async () => {
    if (!symbol || !activeRecommendation) return;

    setIsLoading(true);
    try {
      const targetDateTime = activeRecommendation.target_trading_datetime || activeRecommendation.timestamp;
      if (!targetDateTime) return;

      const targetDate = new Date(targetDateTime);
      const formattedDate = targetDate.toISOString().split('T')[0];

      addLog(`Fetching actual price data for ${symbol} on ${formattedDate}`, 'info');

      const result = await fetchMarketData(symbol, 'stock', 'recent', 5);
      const pricesArray = Array.isArray(result) ? result : (result?.prices || []);
      const filteredPrices = pricesArray.filter(price => price.timestamp.startsWith(formattedDate));

      const formattedPrices = filteredPrices.map(price => ({
        hour: price.timestamp.split('T')[1].substring(0, 5),
        price: price.price,
        session: price.marketSession || 'regular',
        timestamp: new Date(price.timestamp).getTime(),
        isActual: true
      }));

      setPriceData(formattedPrices);
      if (formattedPrices.length > 0) {
        addLog(`Retrieved ${formattedPrices.length} actual price points for ${symbol} on ${formattedDate}`, 'success');
      }
    } catch (error) {
      addLog(`Error fetching actual price data: ${error.message}`, 'error');
      console.error("Error details:", error);
    } finally {
      setIsLoading(false);
    }
  }, [symbol, activeRecommendation]);

  useEffect(() => {
    fetchPrices().catch(console.error);
  }, [fetchPrices]);

  useEffect(() => {
    if (!activeRecommendation) return;
    const targetDateStr = activeRecommendation.target_trading_datetime ? new Date(activeRecommendation.target_trading_datetime).toDateString() : null;
    if (!targetDateStr || targetDateStr !== getCurrentTime().toDateString()) return;

    const intervalId = setInterval(() => {
      addLog('Polling for live price data...', 'info');
      fetchPrices().catch(console.error);
    }, 600000);

    return () => clearInterval(intervalId);
  }, [activeRecommendation, fetchPrices]);

  return {
    actualPriceData: priceData,
    setActualPriceData: setPriceData,
    isLoadingActualPrices: isLoading
  };
};

const RecommendationPanel = ({
  recommendation,
  rawData,
  isLoading,
  onRequestAnalysis,
  companyInfo,
}) => {
  const [panelStates, setPanelStates] = useState(DEFAULT_UI_STATES.expandedSections);
  const [selectedHistoricalRec, setSelectedHistoricalRec] = useState(null);

  const reportRef = useRef(null);
  const toast = useToast();
  const { colorMode } = useColorMode();
  const { borderColor, textColor, highlightBg } = getSectionColors(colorMode);

  const {
    historicalRecommendations,
    setHistoricalRecommendations,
    isLoadingHistorical,
    fetchHistoricalRecommendation,
    loadSpecificRecommendationWithImages, // NEW
    loadingSpecificRec // NEW
  } = useHistoricalRecommendations(companyInfo?.symbol, toast);

  const activeRecommendation = selectedHistoricalRec || recommendation;

  const {
    actualPriceData,
    setActualPriceData,
    isLoadingActualPrices
  } = useActualPriceData(companyInfo?.symbol, activeRecommendation);

  const togglePanel = useCallback((panel) => {
    setPanelStates(prev => ({...prev, [panel]: !prev[panel]}));
  }, []);

  const clearHistoricalSelection = useCallback(() => {
    setSelectedHistoricalRec(null);
    setActualPriceData([]);
  }, [setActualPriceData]);

  const handleHistoricalSelection = useCallback(async (recommendationData) => {
    setActualPriceData([]);

    const recWithImages = await loadSpecificRecommendationWithImages(recommendationData);
    if (recWithImages) {
      setSelectedHistoricalRec(recWithImages);
    } else {
      setSelectedHistoricalRec(recommendationData);
    }
  }, [setActualPriceData, loadSpecificRecommendationWithImages]);

  useEffect(() => {
    if (recommendation && !isLoading) {
      setHistoricalRecommendations(prev => {
        const isDuplicate = prev.some(rec =>
          new Date(rec.timestamp).getTime() === new Date(recommendation.timestamp).getTime()
        );
        if (!isDuplicate) {
          const newRec = {
            timestamp: recommendation.timestamp,
            target_trading_datetime: recommendation.target_trading_datetime,
            action: recommendation.action,
            confidence: recommendation.confidence,
            images: recommendation.images || [],
            data: recommendation
          };
          return [newRec, ...prev];
        }
        return prev;
      });
    }
  }, [recommendation, isLoading, setHistoricalRecommendations]);

  useEffect(() => {
    setSelectedHistoricalRec(null);
    setActualPriceData([]);
  }, [companyInfo?.symbol, setActualPriceData]);

  const handleDownloadData = useCallback(() => {
    try {
      downloadRawData(rawData, companyInfo, toast);
    } catch (error) {
      handleError(error, 'Downloading data', toast);
    }
  }, [companyInfo, rawData, toast]);

  const filteredHistoricalRecs = useMemo(() => {
    const currentSymbol = companyInfo?.symbol;
    if (!currentSymbol) return [];

    return historicalRecommendations
      .filter(rec => {
        const recSymbol = rec.data?.rawData?.company?.symbol;
        return recSymbol === currentSymbol;
      })
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [historicalRecommendations, companyInfo?.symbol]);

  const masterPredictions = useMemo(() => PredictionDataAdapter.getMasterPredictions(activeRecommendation), [activeRecommendation]);
  const marketTiming = masterPredictions?.marketTiming || '';
  const hourlyPrices = masterPredictions?.hourlyPrices || [];

  if (isLoading || !recommendation || recommendation.action === 'ERROR' || !companyInfo) {
    return null;
  }

  return (
    <Box height="100%" width="100%" p={4} display="flex" flexDirection="column">
      <Flex justify="space-between" mb={4} align="center">
        <Flex>
          <HistoricalSelector
            selectedHistoricalRec={selectedHistoricalRec}
            clearHistoricalSelection={clearHistoricalSelection}
            historicalRecommendations={filteredHistoricalRecs}
            recommendation={recommendation}
            isLoadingHistorical={isLoadingHistorical}
            fetchHistoricalRecommendation={fetchHistoricalRecommendation}
            companyInfo={companyInfo}
            setSelectedHistoricalRec={handleHistoricalSelection}
            loadingSpecificRec={loadingSpecificRec}
          />
        </Flex>

        <Flex>
          <Button
            size="xs"
            leftIcon={<Download size={14} />}
            colorScheme="blue"
            variant="outline"
            onClick={handleDownloadData}
            mr={2}
          >
            Data
          </Button>
          <Button
            size="xs"
            leftIcon={<RefreshCw size={14} />}
            colorScheme="purple"
            variant="outline"
            onClick={onRequestAnalysis}
          >
            Refresh
          </Button>
        </Flex>
      </Flex>

      <Box
        ref={reportRef}
        flexGrow={1}
        overflowY="auto"
        px={0}
        display="flex"
        flexDirection="column"
        bg={colorMode === 'dark' ? 'gray.800' : 'white'}
        borderRadius="md"
        p={4}
        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
      >
        {marketTiming && (
          <MarketTimingSection
            marketTiming={marketTiming}
            borderColor={borderColor}
            highlightBgColor={highlightBg}
          />
        )}

        <RecommendationHeader
          activeRecommendation={activeRecommendation}
          borderColor={borderColor}
          textColor={textColor}
          colorMode={colorMode}
        />

        <RecommendationImages
          images={activeRecommendation.images}
          isOpen={panelStates.images}
          onToggle={() => togglePanel('images')}
          borderColor={borderColor}
          companySymbol={companyInfo?.symbol}
        />

        {activeRecommendation.image_analysis && (
          <ImageAnalysisSection
            imageAnalysis={activeRecommendation.image_analysis}
            isImageAnalysisOpen={panelStates.imageAnalysis}
            toggleImageAnalysis={() => togglePanel('imageAnalysis')}
            borderColor={borderColor}
            textColor={textColor}
          />
        )}

        {activeRecommendation.options_analysis && (
          <OptionsAnalyticsSection
            optionsAnalysis={activeRecommendation.options_analysis}
            isOptionsAnalysisOpen={panelStates.optionsAnalysis}
            toggleOptionsAnalysis={() => togglePanel('optionsAnalysis')}
            borderColor={borderColor}
            textColor={textColor}
          />
        )}

        {activeRecommendation.vibe_analysis && (
          <VibeAnalysisSection
            vibeAnalysis={activeRecommendation.vibe_analysis}
            isVibeAnalysisOpen={panelStates.vibeAnalysis}
            toggleVibeAnalysis={() => togglePanel('vibeAnalysis')}
            borderColor={borderColor}
            textColor={textColor}
          />
        )}

        <MarketContextSection
          marketContext={activeRecommendation.marketContext}
          isMarketContextOpen={panelStates.marketContext}
          toggleMarketContext={() => togglePanel('marketContext')}
          borderColor={borderColor}
        />

        <VolatilitySection
          volatility={activeRecommendation.volatility}
          factors={activeRecommendation.factors}
          isVolatilityOpen={panelStates.volatility}
          toggleVolatility={() => togglePanel('volatility')}
          borderColor={borderColor}
        />

        <StrategySection
          dayTradingStrategy={activeRecommendation.dayTradingStrategy}
          isStrategyOpen={panelStates.strategy}
          toggleStrategy={() => togglePanel('strategy')}
          borderColor={borderColor}
        />

        {hourlyPrices.length > 0 && (
          <HourlyPriceTable
            predictions={hourlyPrices}
            borderColor={borderColor}
            colorMode={colorMode}
          />
        )}

        {activeRecommendation.predictionSynthesis && (
          <PredictionSynthesisSection
            predictionSynthesis={activeRecommendation.predictionSynthesis}
            isPredictionSynthesisOpen={panelStates.predictionSynthesis}
            togglePredictionSynthesis={() => togglePanel('predictionSynthesis')}
            borderColor={borderColor}
            textColor={textColor}
          />
        )}

        <PredictionChart
          activeRecommendation={activeRecommendation}
          borderColor={borderColor}
          textColor={textColor}
          colorMode={colorMode}
          highlightBgColor={highlightBg}
          actualPriceData={actualPriceData}
          isLoadingActualPrices={isLoadingActualPrices}
        />

        <PredictionAccuracySection
          predictionAccuracyData={activeRecommendation.predictionAccuracy}
          isPredictionAccuracyOpen={panelStates.predictionAccuracy}
          togglePredictionAccuracy={() => togglePanel('predictionAccuracy')}
          borderColor={borderColor}
          colorMode={colorMode}
        />

        {activeRecommendation.predictionHistoryInsights && (
          <PredictionHistorySection
            predictionHistoryInsights={activeRecommendation.predictionHistoryInsights}
            isPredictionHistoryOpen={panelStates.predictionHistory}
            togglePredictionHistory={() => togglePanel('predictionHistory')}
            borderColor={borderColor}
            textColor={textColor}
          />
        )}

        {activeRecommendation.signalReliabilityLog && (
          <SignalReliabilityLogSection
            signalReliabilityLog={activeRecommendation.signalReliabilityLog}
            isSignalLogOpen={panelStates.signalLog}
            toggleSignalLog={() => togglePanel('signalLog')}
            borderColor={borderColor}
            textColor={textColor}
          />
        )}

        <FactorsSection
          factors={activeRecommendation.factors}
          isFactorsOpen={panelStates.factors}
          toggleFactors={() => togglePanel('factors')}
          borderColor={borderColor}
        />

        {activeRecommendation.dataImprovementSuggestions && (
          <SuggestionsSection
            suggestions={activeRecommendation.dataImprovementSuggestions}
            isSuggestionsOpen={panelStates.suggestions}
            toggleSuggestions={() => togglePanel('suggestions')}
            borderColor={borderColor}
            textColor={textColor}
          />
        )}

        <DetailsSection
          activeRecommendation={activeRecommendation}
          rawData={rawData}
          isDetailsOpen={panelStates.details}
          toggleDetails={() => togglePanel('details')}
          borderColor={borderColor}
          textColor={textColor}
        />
      </Box>
    </Box>
  );
};

export default React.memo(RecommendationPanel);