import React, {useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react';
import {Box, useColorMode} from '@chakra-ui/react';
import {
    Area,
    Brush,
    CartesianGrid,
    ComposedChart,
    Line,
    ReferenceArea,
    ReferenceDot,
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis
} from 'recharts';
import SentimentChartControls from './SentimentChartControls';
import { TunerComparisonModal } from './SentimentTunerVisualization';
import {
    CrossHair,
    CustomSentimentDot,
    CustomTooltip,
    PredictionMarker,
    PricePointDot
} from './SentimentChartComponents';
import {
    CHART_ANIMATIONS,
    CHART_DIMENSIONS,
    CHART_STYLING,
    COLORS,
    DEFAULT_DATA_SETTINGS,
    DEFAULT_MASTER_WEIGHTS,
    DEFAULT_UI_STATES,
    HISTORICAL_BASELINE,
    MARKET_INDICES,
    STOCK_BUCKET_PARAMS,
    MARKET_BUCKET_PARAMS,
    INDUSTRY_BUCKET_PARAMS,
    GLOBAL_TEMPORAL_PARAMS,
    SYSTEM
} from '../config/Config';
import {prepareChartData} from './SentimentDataProcessor';
import {
    chartStateReducer,
    createIndexYAxisConfig,
    createXAxisConfig,
    createYAxisConfigs,
    generateCommonLegendItems,
    generateLineConfigs,
    getTimezoneOffset,
    initialChartState,
    positionLabels
} from './SentimentChartUtils';
import {findOptimalFingerprint} from './SentimentTuner';
import {getCurrentTime} from '../services/timeService';

const getTemporalDotSize = (payload, globalMaxImpactMagnitude, isActive = false) => {
  const impactMagnitude = payload?.impactMagnitude || 0;
  const normalizedMagnitude = impactMagnitude / globalMaxImpactMagnitude;
  const minSize = 0.3;
  const maxSize = 6.0;
  let size = minSize + (normalizedMagnitude * (maxSize - minSize));
  if (isActive) {
    size = Math.min(maxSize + 2, size * 1.5);
  }
  return size;
};

const TemporalDot = ({ cx, cy, payload, color, globalMaxImpactMagnitude }) => {
  if (!cx || !cy || !payload || !payload.impactMagnitude || payload.impactMagnitude < 0.01) return null;
  const size = getTemporalDotSize(payload, globalMaxImpactMagnitude);
  return <circle cx={cx} cy={cy} r={size} fill={color} opacity={0.8} />;
};

const TemporalActiveDot = ({ cx, cy, payload, color, globalMaxImpactMagnitude }) => {
  if (!cx || !cy || !payload) return null;
  const size = getTemporalDotSize(payload, globalMaxImpactMagnitude, true);
  return (
    <g>
      <circle cx={cx} cy={cy} r={size + 2} fill="white" opacity={0.8} />
      <circle cx={cx} cy={cy} r={size} fill={color} opacity={1} />
    </g>
  );
};

const initialBucketParams = {
  stock: { ...STOCK_BUCKET_PARAMS },
  market: { ...MARKET_BUCKET_PARAMS },
  industry: { ...INDUSTRY_BUCKET_PARAMS }
};

const initialGlobalTemporalParams = { ...GLOBAL_TEMPORAL_PARAMS };

const TUNING_CACHE_VERSION = 2;

const SentimentChart = ({
  stockSentimentData = [],
  marketSentimentData = [],
  industrySentimentData = [],
  stockPriceData,
  marketIndicesData = {},
  companyInfo,
  isLoadingMarketIndices = false,
  showControls = DEFAULT_UI_STATES.showChartControls,
  visibleLines: visibleLinesProp = null,
  timeWindowOverride = null,
  timeRangeOverride = null,
  customRenderables = [],
  isInteractiveMode = true,
  dataResolutionMinutes: dataResolutionProp = null,
  tradingCalendar = null,
  futureWindowHours: futureWindowHoursProp = null,
  chartParamsOverride = null,
  isAnalysisComplete = false,
  onParamsUpdate = () => {},
  onTuningStatusChange = () => {},
  onTuningComplete = () => {}
}) => {
  const chartContainerRef = useRef(null);
  const mouseFrameRef = useRef(null);
  const { colorMode } = useColorMode();

  const [chartState, dispatch] = useReducer(chartStateReducer, initialChartState);
  const [localBucketParams, setLocalBucketParams] = useState(initialBucketParams);
  const [internalDataResolution, setInternalDataResolution] = useState(dataResolutionProp || DEFAULT_DATA_SETTINGS.dataResolutionMinutes);
  const [visibleLines, setVisibleLines] = useState(DEFAULT_UI_STATES.visibleLines);
  const [enableBiasNormalization, setEnableBiasNormalization] = useState(true);
  const [enableImpactNormalization, setEnableImpactNormalization] = useState(true);
  const [selectedMarketIndex, setSelectedMarketIndex] = useState(MARKET_INDICES.DEFAULT_INDEX);
  const [masterWeights, setMasterWeights] = useState({ ...DEFAULT_MASTER_WEIGHTS });
  const [globalTemporalParams, setGlobalTemporalParams] = useState(initialGlobalTemporalParams);

  const tunerProgressCallbackRef = useRef(null);
  const [tunerResults, setTunerResults] = useState(null);
  const [tuningStatus, setTuningStatus] = useState({ state: 'Default', correlation: null });
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false);

  const [cacheLoaded, setCacheLoaded] = useState(false);
  const cacheCheckedRef = useRef(false);
  const prevSymbolRef = useRef(null);
  const currentParamsRef = useRef({ bucketParams: initialBucketParams, masterWeights: { ...DEFAULT_MASTER_WEIGHTS }, globalTemporalParams: initialGlobalTemporalParams });
  const currentTunerResultsRef = useRef(null);

  const paramsToUse = showControls
    ? { bucketParams: localBucketParams, globalTemporalParams: globalTemporalParams }
    : chartParamsOverride;

  const bucketParams = paramsToUse?.bucketParams || initialBucketParams;
  const effectiveGlobalTemporalParams = paramsToUse?.globalTemporalParams || initialGlobalTemporalParams;

  const effectiveMasterWeights = chartParamsOverride?.masterWeights ?? masterWeights;

  const futureWindowHours = futureWindowHoursProp !== null ? futureWindowHoursProp : effectiveGlobalTemporalParams.futureWindowHours;
  const effectiveDataResolution = dataResolutionProp !== null ? dataResolutionProp : internalDataResolution;
  const setEffectiveDataResolution = dataResolutionProp !== null ? () => {} : setInternalDataResolution;
  const effectiveVisibleLines = visibleLinesProp !== null ? visibleLinesProp : visibleLines;
  const setEffectiveVisibleLines = visibleLinesProp !== null ? () => {} : setVisibleLines;

  const currentTimeWindow = timeWindowOverride || chartState.timeWindow;

  const setCurrentTimeWindow = useCallback((value) => {
    if (timeWindowOverride !== null) return;
    dispatch({ type: 'SET_TIME_WINDOW', payload: value });
  }, [timeWindowOverride]);

  const saveCache = useCallback((params, weights, results, correlation) => {
    if (!companyInfo?.symbol || SYSTEM.DISABLE_TUNER_CACHE) return;

    const cacheData = {
      version: TUNING_CACHE_VERSION,
      params: params,
      masterWeights: weights,
      timestamp: Date.now(),
      correlation: correlation || results?.bestScore || null,
      tunerResults: results ? {
        bestParams: results.bestParams,
        bestScore: results.bestScore,
        originalScore: results.originalScore,
        perBucketStats: results.perBucketStats,
        finalBlendedCorrelation: results.finalBlendedCorrelation
      } : null
    };

    try {
      localStorage.setItem(`tuning_${companyInfo.symbol}`, JSON.stringify(cacheData));
    } catch (error) {
      console.error("Failed to cache tuning results:", error);
    }
  }, [companyInfo?.symbol]);

  const loadCache = useCallback(() => {
    if (!companyInfo?.symbol || SYSTEM.DISABLE_TUNER_CACHE) return null;

    const cacheKey = `tuning_${companyInfo.symbol}`;
    try {
      const cachedItem = localStorage.getItem(cacheKey);
      if (!cachedItem) return null;

      const cachedData = JSON.parse(cachedItem);
      if (cachedData.version !== TUNING_CACHE_VERSION) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      const isFresh = (Date.now() - cachedData.timestamp) < 24 * 60 * 60 * 1000;
      if (!isFresh) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      return cachedData;
    } catch (error) {
      localStorage.removeItem(cacheKey);
      return null;
    }
  }, [companyInfo?.symbol]);

  const handleParamChange = useCallback((bucket, type, param, value) => {
    const newParams = JSON.parse(JSON.stringify(currentParamsRef.current.bucketParams));
    newParams[bucket][type][param] = value;

    setLocalBucketParams(newParams);
    currentParamsRef.current.bucketParams = newParams;
    setTuningStatus({ state: 'Custom', correlation: null });

    saveCache(newParams, currentParamsRef.current.masterWeights, currentTunerResultsRef.current, null);
  }, [saveCache]);

  const handleGlobalTemporalParamChange = useCallback((param, value) => {
    const newGlobalParams = { ...currentParamsRef.current.globalTemporalParams, [param]: value };

    setGlobalTemporalParams(newGlobalParams);
    currentParamsRef.current.globalTemporalParams = newGlobalParams;
    setTuningStatus({ state: 'Custom', correlation: null });
  }, []);

  const handleMasterWeightChange = useCallback((source, value) => {
    const newWeights = {
      ...currentParamsRef.current.masterWeights,
      [source]: parseFloat(value)
    };

    setMasterWeights(newWeights);
    currentParamsRef.current.masterWeights = newWeights;
    setTuningStatus({ state: 'Custom', correlation: null });

    saveCache(currentParamsRef.current.bucketParams, newWeights, currentTunerResultsRef.current, null);
  }, [saveCache]);

  const handleApplyToSupplementary = useCallback(() => {
    const {
      targetPriceCurve,
      timeGrid,
      optimalSentimentCurve,
      currentSentimentCurve,
      ...slimResults
    } = currentTunerResultsRef.current || {};

    const resultsForParent = Object.keys(slimResults).length > 0 ? slimResults : null;

    const paramsToApply = {
      bucketParams: currentParamsRef.current.bucketParams,
      globalTemporalParams: currentParamsRef.current.globalTemporalParams,
      masterWeights: currentParamsRef.current.masterWeights,
      tunerResults: resultsForParent,
      currentTimeWindow: currentTimeWindow
    };

    onParamsUpdate(paramsToApply);
  }, [currentTimeWindow, onParamsUpdate]);

  const handleResetToDefaults = useCallback(() => {
    const defaultParams = initialBucketParams;
    const defaultGlobalParams = initialGlobalTemporalParams;
    const defaultWeights = { ...DEFAULT_MASTER_WEIGHTS };

    setLocalBucketParams(defaultParams);
    setGlobalTemporalParams(defaultGlobalParams);
    setMasterWeights(defaultWeights);
    setTunerResults(null);
    setTuningStatus({ state: 'Default', correlation: null });

    currentParamsRef.current = {
      bucketParams: defaultParams,
      masterWeights: defaultWeights,
      globalTemporalParams: defaultGlobalParams
    };
    currentTunerResultsRef.current = null;

    if (companyInfo?.symbol) {
      localStorage.removeItem(`tuning_${companyInfo.symbol}`);
    }
  }, [companyInfo?.symbol]);

  const handleLoadTunerSettings = useCallback((results) => {
    if (!results?.bestParams) return;

    const { bestParams } = results;
    const newMasterWeights = bestParams.blend_weights || DEFAULT_MASTER_WEIGHTS;
    const newBucketParams = JSON.parse(JSON.stringify(initialBucketParams));

    const applyParams = (bucketKey, tunedParams, tunedSourceWeights) => {
      if (!tunedParams || !tunedSourceWeights) return;
      newBucketParams[bucketKey].component.sentimentWeight = tunedParams.sentimentWeight;
      newBucketParams[bucketKey].component.influenceWeight = tunedParams.influenceWeight;
      newBucketParams[bucketKey].component.certaintyWeight = tunedParams.certaintyWeight;
      newBucketParams[bucketKey].temporal.pastWeight = tunedParams.temporalPastWeight;
      newBucketParams[bucketKey].temporal.futureWeight = tunedParams.temporalFutureWeight;
      newBucketParams[bucketKey].source = tunedSourceWeights;
    };

    applyParams('stock', bestParams.stock_params, bestParams.stock_source_weights);
    applyParams('market', bestParams.market_params, bestParams.market_source_weights);
    applyParams('industry', bestParams.industry_params, bestParams.industry_source_weights);

    setLocalBucketParams(newBucketParams);
    setMasterWeights(newMasterWeights);
    setCurrentTimeWindow('optimized');
    setTunerResults(results);
    setTuningStatus({ state: 'Tuned', correlation: results.bestScore });

    currentParamsRef.current = {
      bucketParams: newBucketParams,
      masterWeights: newMasterWeights,
      globalTemporalParams: currentParamsRef.current.globalTemporalParams
    };
    currentTunerResultsRef.current = results;

    saveCache(newBucketParams, newMasterWeights, results, results.bestScore);
    onTuningComplete(results);
  }, [setCurrentTimeWindow, onTuningComplete, saveCache]);

  const handleStartTuning = useCallback(async (phaseToRun = 'all') => {
    onTuningStatusChange(true);
    setTuningStatus({ state: 'Optimizing', correlation: null });

    if (tunerProgressCallbackRef.current) {
      tunerProgressCallbackRef.current({ isTuning: true, progress: 0, total: 0, phaseName: '' });
    }

    setTunerResults(null);
    currentTunerResultsRef.current = null;

    try {
      const results = await findOptimalFingerprint({
        stockPriceData,
        stockSentimentData,
        marketSentimentData,
        industrySentimentData,
        tradingCalendar,
        onProgress: (progress, total, phaseName) => {
          if (tunerProgressCallbackRef.current) {
            tunerProgressCallbackRef.current({ isTuning: true, progress, total, phaseName });
          }
        },
        phaseToRun
      });

      if (results && results.bestParams) {
        currentTunerResultsRef.current = results;
        handleLoadTunerSettings(results);
      }

      if (tunerProgressCallbackRef.current) {
        tunerProgressCallbackRef.current({ isTuning: false, progress: 0, total: 0, phaseName: '' });
      }
    } catch (error) {
      console.error("Tuning failed", error);
      if (tunerProgressCallbackRef.current) {
        tunerProgressCallbackRef.current({ isTuning: false, progress: 0, total: 0, phaseName: '' });
      }
      onTuningComplete(null);
    } finally {
      onTuningStatusChange(false);
    }
  }, [stockPriceData, stockSentimentData, marketSentimentData, industrySentimentData, tradingCalendar, onTuningStatusChange, onTuningComplete, handleLoadTunerSettings]);

  useEffect(() => {
    if (companyInfo?.symbol !== prevSymbolRef.current) {
      prevSymbolRef.current = companyInfo?.symbol;

      setCacheLoaded(false);
      cacheCheckedRef.current = false;
      currentTunerResultsRef.current = null;
      setTunerResults(null);
      setTuningStatus({ state: 'Default', correlation: null });

      const defaultParams = {
        bucketParams: JSON.parse(JSON.stringify(initialBucketParams)),
        masterWeights: { ...DEFAULT_MASTER_WEIGHTS },
        globalTemporalParams: { ...initialGlobalTemporalParams }
      };

      currentParamsRef.current = defaultParams;
      setLocalBucketParams(defaultParams.bucketParams);
      setGlobalTemporalParams(defaultParams.globalTemporalParams);
      setMasterWeights(defaultParams.masterWeights);
    }

    if (!isAnalysisComplete || !companyInfo?.symbol || cacheCheckedRef.current) {
      return;
    }

    if (SYSTEM.DISABLE_TUNER_CACHE) {
      cacheCheckedRef.current = true;
      setCacheLoaded(true);
      handleStartTuning();
      return;
    }

    cacheCheckedRef.current = true;
    const cachedData = loadCache();

    if (cachedData && cachedData.tunerResults) {
      currentParamsRef.current = {
        bucketParams: cachedData.params,
        masterWeights: cachedData.masterWeights,
        globalTemporalParams: currentParamsRef.current.globalTemporalParams
      };
      currentTunerResultsRef.current = cachedData.tunerResults;
      handleLoadTunerSettings(cachedData.tunerResults);
      setCacheLoaded(true);
    } else {
      setCacheLoaded(true);
      handleStartTuning();
    }
  }, [isAnalysisComplete, companyInfo?.symbol, handleStartTuning, handleLoadTunerSettings, loadCache]);

  useEffect(() => {
    if (tuningStatus.state === 'Default' || tuningStatus.state === 'Tuned') {
      handleApplyToSupplementary();
    }
  }, [tuningStatus.state, handleApplyToSupplementary]);

  const chartData = useMemo(() => {
    return prepareChartData({
      stockSentimentData,
      marketSentimentData,
      industrySentimentData,
      stockPriceData,
      marketIndicesData,
      tradingCalendar,
      companyInfo,
      options: {
        stockParams: {
          temporalParams: bucketParams.stock.temporal,
          sourceCategoryWeights: bucketParams.stock.source,
          sentimentComponentWeights: bucketParams.stock.component,
        },
        marketParams: {
          temporalParams: bucketParams.market.temporal,
          sourceCategoryWeights: bucketParams.market.source,
          sentimentComponentWeights: bucketParams.market.component,
        },
        industryParams: {
          temporalParams: bucketParams.industry.temporal,
          sourceCategoryWeights: bucketParams.industry.source,
          sentimentComponentWeights: bucketParams.industry.component,
        },
        momentumBlend: effectiveGlobalTemporalParams.momentumBlend,
        derivativeSmoothingWindow: effectiveGlobalTemporalParams.derivativeSmoothingWindow,
        dataResolutionMinutes: effectiveDataResolution,
        articleCountResolution: DEFAULT_DATA_SETTINGS.articleCountResolutionMinutes,
        selectedMarketIndex,
        currentTimeWindow: chartParamsOverride?.currentTimeWindow || currentTimeWindow,
        futureWindowHours,
        visibleLines: effectiveVisibleLines,
        enableBiasNormalization,
        enableImpactNormalization,
        masterWeights: effectiveMasterWeights,
        tunerResults: chartParamsOverride?.tunerResults || tunerResults,
      }
    });
  }, [
    stockSentimentData, marketSentimentData, industrySentimentData, stockPriceData,
    marketIndicesData, tradingCalendar, companyInfo, bucketParams, effectiveDataResolution,
    selectedMarketIndex, currentTimeWindow, futureWindowHours, effectiveVisibleLines,
    enableBiasNormalization, enableImpactNormalization, effectiveMasterWeights,
    effectiveGlobalTemporalParams, chartParamsOverride, tunerResults
  ]);

  const positionedPricePoints = useMemo(() => positionLabels(chartData.keyPricePoints?.pricePoints || []), [chartData.keyPricePoints]);

  const lineConfigs = useMemo(() => generateLineConfigs(
    chartData.stockSentimentPoints, chartData.marketSentimentPoints, chartData.industrySentimentPoints,
    chartData.stockRollingAvg, chartData.marketRollingAvg, chartData.industryRollingAvg,
    chartData.combinedRollingAvg, chartData.stockData, chartData.volumeData,
    chartData.indexData, selectedMarketIndex,
    chartData.stockTemporalData, chartData.marketTemporalData, chartData.industryTemporalData, chartData.masterTemporalData
  ), [chartData, selectedMarketIndex]);

  const chartDomain = useMemo(() => {
    if (timeRangeOverride) {
      return [
        timeRangeOverride[0] !== null ? timeRangeOverride[0] : chartData.timeRange.min,
        timeRangeOverride[1] !== null ? timeRangeOverride[1] : chartData.timeRange.max
      ];
    }
    return chartState.viewDomain || [chartData.timeRange.min, chartData.timeRange.max];
  }, [timeRangeOverride, chartState.viewDomain, chartData.timeRange]);

  const createDomain = useCallback((data) => {
    if (!data || !data.length) return [0, 1];
    const firstDataPoint = data.find(item => item.basePrice !== undefined && item.stdDev !== undefined);
    if (!firstDataPoint || !firstDataPoint.basePrice) return null;
    const basePrice = firstDataPoint.basePrice;
    const stdDev = firstDataPoint.stdDev;
    const minDomain = basePrice - (HISTORICAL_BASELINE.STANDARD_DEVIATION_MULTIPLIER * stdDev);
    const maxDomain = basePrice + (HISTORICAL_BASELINE.STANDARD_DEVIATION_MULTIPLIER * stdDev);
    return [minDomain, maxDomain];
  }, []);

  const priceDomain = useMemo(() => createDomain(chartData.stockData), [chartData.stockData]);
  const indexDomain = useMemo(() => createDomain(chartData.indexData), [chartData.indexData]);

  const yAxisConfigs = useMemo(() => {
    const configs = createYAxisConfigs();
    configs.price.domain = priceDomain || [0, 1];

    const createCustomTickFormatter = (data) => (tickValue) => {
      if (!data || data.length === 0) return `$${tickValue.toFixed(2)}`;
      const samplePoint = data.find(point => point.price !== undefined && point.originalPrice !== undefined && !point.isBreak);
      if (!samplePoint) return `$${tickValue.toFixed(2)}`;
      const scaleFactor = samplePoint.originalPrice / samplePoint.price;
      const originalValue = tickValue * scaleFactor;
      if (originalValue < 1) return `$${originalValue.toFixed(3)}`;
      if (originalValue < 100) return `$${originalValue.toFixed(2)}`;
      return `$${originalValue.toFixed(0)}`;
    };

    configs.price.tickFormatter = createCustomTickFormatter(chartData.stockData);

    if (chartData.indexData.length > 0 && indexDomain) {
      configs.index = createIndexYAxisConfig(configs.price, selectedMarketIndex);
      configs.index.domain = indexDomain || [0, 1];
      configs.index.tickFormatter = createCustomTickFormatter(chartData.indexData);
    }
    return configs;
  }, [priceDomain, indexDomain, chartData.stockData, chartData.indexData, selectedMarketIndex]);

  const xAxisConfig = useMemo(() => createXAxisConfig(chartDomain, chartState.timezoneDisplay, chartState.width), [chartDomain, chartState.timezoneDisplay, chartState.width]);

  const globalMaxImpactMagnitude = useMemo(() => {
      const allTemporalData = [
        ...(chartData.stockTemporalData || []),
        ...(chartData.marketTemporalData || []),
        ...(chartData.industryTemporalData || []),
        ...(chartData.masterTemporalData || [])
      ];

      if (allTemporalData.length === 0) {
        return 0.001;
      }

      const maxImpact = allTemporalData.reduce((max, point) => {
        const impact = point.impactMagnitude || 0;
        return impact > max ? impact : max;
      }, 0);

      return Math.max(0.001, maxImpact);
    }, [chartData.stockTemporalData, chartData.marketTemporalData, chartData.industryTemporalData, chartData.masterTemporalData]);

  const legendItems = useMemo(() => generateCommonLegendItems(chartData, currentTimeWindow, selectedMarketIndex), [chartData, currentTimeWindow, selectedMarketIndex]);

  const hasStockBaseline = chartData.stockData.some(point => point.basePrice !== undefined);
  const hasIndexBaseline = chartData.indexData.some(point => point.basePrice !== undefined);

  const chartMargins = { top: 5, right: 20, left: 10, bottom: 5 };
  const plotAreaWidth = chartState.width - chartMargins.left - chartMargins.right;
  const plotAreaHeight = chartState.height - chartMargins.top - chartMargins.bottom - 20;

  useEffect(() => {
    return () => { if (mouseFrameRef.current) cancelAnimationFrame(mouseFrameRef.current); };
  }, []);

  useEffect(() => {
    if (dataResolutionProp !== null && dataResolutionProp !== internalDataResolution) {
      setInternalDataResolution(dataResolutionProp);
    }
  }, [dataResolutionProp, internalDataResolution]);

  useEffect(() => {
    const updateChartDimensions = () => {
      if (chartContainerRef.current) {
        const height = chartContainerRef.current.clientHeight;
        const width = chartContainerRef.current.clientWidth;
        if (height !== chartState.height) dispatch({ type: 'SET_HEIGHT', payload: height });
        if (width !== chartState.width) dispatch({ type: 'SET_WIDTH', payload: width });
      }
    };
    updateChartDimensions();
    const resizeObserver = new ResizeObserver(updateChartDimensions);
    if (chartContainerRef.current) resizeObserver.observe(chartContainerRef.current);
    return () => resizeObserver.disconnect();
  }, [chartState.height, chartState.width]);

  const handleChartMouseMove = useCallback((e) => {
    if (!isInteractiveMode || !e?.activeCoordinate) return;
    if (mouseFrameRef.current) cancelAnimationFrame(mouseFrameRef.current);
    mouseFrameRef.current = requestAnimationFrame(() => {
      dispatch({ type: 'SET_CROSSHAIR', payload: { x: e.activeCoordinate.x, y: e.activeCoordinate.y } });
    });
  }, [isInteractiveMode]);

  const handleChartMouseLeave = useCallback(() => {
    if (isInteractiveMode) {
      if (mouseFrameRef.current) cancelAnimationFrame(mouseFrameRef.current);
      dispatch({ type: 'SET_CROSSHAIR', payload: { x: null, y: null } });
    }
  }, [isInteractiveMode]);

  const resetView = useCallback(() => {
    dispatch({ type: 'RESET_VIEW' });
    const allSentimentData = [...(chartData.stockSentimentPoints || []), ...(chartData.marketSentimentPoints || []), ...(chartData.industrySentimentPoints || [])];
    if (allSentimentData.length > 0) {
      dispatch({ type: 'SET_BRUSH_INDICES', payload: { startIndex: 0, endIndex: allSentimentData.length - 1 } });
    } else if (chartData.stockData.length > 0) {
      dispatch({ type: 'SET_BRUSH_INDICES', payload: { startIndex: 0, endIndex: chartData.stockData.length - 1 } });
    }
  }, [chartData]);

  const zoomToTimeWindow = useCallback((days) => {
    const { timeRange } = chartData;
    if (timeRange.min === Infinity || timeRange.max === -Infinity) return;
    const tzOffset = getTimezoneOffset(chartState.timezoneDisplay);
    let newDomain;

    if (days === 5) {
      const localNow = getCurrentTime();
      let endDate = new Date(Math.min(timeRange.max, localNow.getTime()) - tzOffset);
      const dayOfWeek = new Date(localNow.getTime() - tzOffset).getDay();
      if (dayOfWeek === 0) endDate.setDate(endDate.getDate() - 2);
      else if (dayOfWeek === 6) endDate.setDate(endDate.getDate() - 1);
      endDate.setHours(23, 59, 59, 999);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 4);
      startDate.setHours(0, 0, 0, 0);
      newDomain = [Math.max(timeRange.min, startDate.getTime() + tzOffset), Math.min(timeRange.max, endDate.getTime() + tzOffset)];
    } else {
      const centerTime = chartState.viewDomain ? (chartState.viewDomain[0] + chartState.viewDomain[1]) / 2 : (timeRange.min + timeRange.max) / 2;
      const centerDate = new Date(centerTime - tzOffset);
      const startDate = new Date(centerDate);
      const endDate = new Date(centerDate);
      if (days === 1) {
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
      } else {
        const halfDays = Math.floor(days / 2);
        startDate.setDate(startDate.getDate() - halfDays);
        startDate.setHours(0, 0, 0, 0);
        endDate.setDate(startDate.getDate() + days - 1);
        endDate.setHours(23, 59, 59, 999);
      }
      newDomain = [Math.max(timeRange.min, startDate.getTime() + tzOffset), Math.min(timeRange.max, endDate.getTime() + tzOffset)];
    }
    dispatch({ type: 'SET_VIEW_DOMAIN', payload: newDomain });
  }, [chartData.timeRange, chartState.viewDomain, chartState.timezoneDisplay]);

  const moveView = useCallback((direction) => {
    if (!chartState.viewDomain) return;
    const tzOffset = getTimezoneOffset(chartState.timezoneDisplay);
    const msPerDay = 24 * 60 * 60 * 1000;
    const viewWidth = chartState.viewDomain[1] - chartState.viewDomain[0];
    const viewDays = Math.max(1, Math.round(viewWidth / msPerDay));
    const newStartDate = new Date(chartState.viewDomain[0] - tzOffset);
    newStartDate.setDate(newStartDate.getDate() + (direction * viewDays));
    newStartDate.setHours(0, 0, 0, 0);
    const newEndDate = new Date(newStartDate);
    newEndDate.setDate(newEndDate.getDate() + viewDays - 1);
    newEndDate.setHours(23, 59, 59, 999);
    dispatch({ type: 'SET_VIEW_DOMAIN', payload: [Math.max(chartData.timeRange.min, newStartDate.getTime() + tzOffset), Math.min(chartData.timeRange.max, newEndDate.getTime() + tzOffset)] });
  }, [chartState.viewDomain, chartState.timezoneDisplay, chartData.timeRange]);

  const moveLeft = useCallback(() => moveView(-1), [moveView]);
  const moveRight = useCallback(() => moveView(1), [moveView]);

  const handleBrushChange = useCallback((brushData) => {
    if (!brushData || brushData.startIndex === undefined || brushData.endIndex === undefined) return;
    if (chartState.brushIndices.startIndex === brushData.startIndex && chartState.brushIndices.endIndex === brushData.endIndex) return;

    dispatch({ type: 'SET_BRUSH_INDICES', payload: { startIndex: brushData.startIndex, endIndex: brushData.endIndex } });
    const combinedData = [...(chartData.stockSentimentPoints || []), ...(chartData.marketSentimentPoints || []), ...(chartData.industrySentimentPoints || []), ...(chartData.stockData || [])].sort((a, b) => a.timestamp - b.timestamp);
    if (combinedData.length > 0) {
      const startItem = combinedData[Math.max(0, Math.min(brushData.startIndex, combinedData.length - 1))];
      const endItem = combinedData[Math.min(combinedData.length - 1, Math.max(0, brushData.endIndex))];
      if (startItem && endItem) {
        dispatch({ type: 'SET_VIEW_DOMAIN', payload: [startItem.timestamp, endItem.timestamp] });
      }
    }
  }, [chartData, chartState.brushIndices]);

  const renderTemporalLine = useCallback((data, color, yAxisId = "sentiment", name = "") => {
    if (!data || data.length === 0) return null;
    return (
      <Line type="monotone" dataKey="sentimentRollingAvg" data={data} stroke={color} strokeWidth={3} yAxisId={yAxisId} name={name} isAnimationActive={false} connectNulls={true}
        dot={({ key, ...rest }) => (<TemporalDot key={key} {...rest} color={color} globalMaxImpactMagnitude={globalMaxImpactMagnitude} name={name}/>)}
        activeDot={({ key, ...rest }) => (<TemporalActiveDot key={key} {...rest} color={color} globalMaxImpactMagnitude={globalMaxImpactMagnitude} name={name}/>)}
      />
    );
  }, [globalMaxImpactMagnitude]);

  const renderScatter = useCallback((config, visibleKey) => {
    if (!effectiveVisibleLines[visibleKey]) return null;
    return <Scatter {...config} isAnimationActive={CHART_ANIMATIONS.enabled} animationDuration={CHART_ANIMATIONS.duration} animationEasing={CHART_ANIMATIONS.easing} shape={(props) => <CustomSentimentDot {...props} />} />;
  }, [effectiveVisibleLines]);

  const renderLine = useCallback((config, visibleKey) => {
    if (!effectiveVisibleLines[visibleKey]) return null;
    return <Line {...config} isAnimationActive={CHART_ANIMATIONS.enabled} animationDuration={CHART_ANIMATIONS.duration} animationEasing={CHART_ANIMATIONS.easing} />;
  }, [effectiveVisibleLines]);

  const renderCombinedAverageShape = useCallback(({ cx, cy, payload, index }) => {
      if (!cx || !cy || !payload || !payload.totalArticleCount || payload.totalArticleCount < 1) return null;
      const size = 0.25 + ((5 - 0.25) * Math.min(1.0, (payload.totalArticleCount || 1) / 50));
      return <circle cx={cx} cy={cy} r={size} fill={payload.precomputedColor} key={`dot-combined-${payload.timestamp}-${index}`} />;
  }, []);

  const renderCombinedAverage = useCallback((data, name) => {
    if (!data || data.length === 0) return null;
    return (
        <Scatter
            dataKey="sentimentRollingAvg"
            data={data}
            yAxisId="sentiment"
            name={name}
            isAnimationActive={false}
            shape={renderCombinedAverageShape}
        />
    );
  }, [renderCombinedAverageShape]);

  const renderArea = useCallback((data, dataKey, fill, yAxisId, name, visibleKey) => {
    if (!effectiveVisibleLines[visibleKey] || !data || data.length === 0) return null;
    return <Area dataKey={dataKey} data={data} fill={fill} stroke={fill} fillOpacity={0.3} strokeWidth={1} yAxisId={yAxisId} name={name} type="monotone" isAnimationActive={CHART_ANIMATIONS.enabled} animationDuration={CHART_ANIMATIONS.duration} animationEasing={CHART_ANIMATIONS.easing} baseValue={0} />;
  }, [effectiveVisibleLines]);

  const renderDerivativeArea = useCallback((config, visibleKey) => {
    if (!effectiveVisibleLines[visibleKey]) return null;
    return <Area {...config} isAnimationActive={CHART_ANIMATIONS.enabled} animationDuration={CHART_ANIMATIONS.duration} animationEasing={CHART_ANIMATIONS.easing} baseValue={0} />;
  }, [effectiveVisibleLines]);

  return (
    <Box height="100%" display="flex" flexDirection="column">
      {showControls && (
        <SentimentChartControls
            showControls={showControls}
            timeWindow={currentTimeWindow}
            setTimeWindow={setCurrentTimeWindow}
            timezoneDisplay={chartState.timezoneDisplay}
            setTimezoneDisplay={(value) => dispatch({ type: 'SET_TIMEZONE', payload: value })}
            selectedMarketIndex={selectedMarketIndex}
            onMarketIndexChange={setSelectedMarketIndex}
            zoomToTimeWindow={zoomToTimeWindow}
            moveLeft={moveLeft}
            moveRight={moveRight}
            resetView={resetView}
            viewDomain={chartState.viewDomain}
            visibleLines={effectiveVisibleLines}
            setVisibleLines={setEffectiveVisibleLines}
            legendItems={legendItems}
            isLoadingMarketIndices={isLoadingMarketIndices}
            dataResolutionMinutes={effectiveDataResolution}
            setDataResolutionMinutes={setEffectiveDataResolution}
            companyInfo={companyInfo}
            bucketParams={localBucketParams}
            onParamChange={handleParamChange}
            globalTemporalParams={globalTemporalParams}
            onGlobalTemporalParamChange={handleGlobalTemporalParamChange}
            enableBiasNormalization={enableBiasNormalization}
            setEnableBiasNormalization={setEnableBiasNormalization}
            enableImpactNormalization={enableImpactNormalization}
            setEnableImpactNormalization={setEnableImpactNormalization}
            masterWeights={masterWeights}
            onMasterWeightChange={handleMasterWeightChange}
            sourceCategoryCounts={chartData.sourceCategoryCounts}
            tunerResults={tunerResults}
            onProgressUpdate={(callback) => { tunerProgressCallbackRef.current = callback; }}
            onStartTuning={handleStartTuning}
            onApplyToSupplementary={handleApplyToSupplementary}
            onViewComparison={() => setIsComparisonModalOpen(true)}
            onResetToDefaults={handleResetToDefaults}
            tuningStatus={tuningStatus}
        />
      )}
      <Box ref={chartContainerRef} height={CHART_DIMENSIONS.plotHeight} position="relative">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={chartMargins} onMouseMove={handleChartMouseMove} onMouseLeave={handleChartMouseLeave}>
            <CartesianGrid strokeDasharray={CHART_STYLING.lines.dashed.strokeDasharray} stroke={COLORS.axisLight} opacity={0.5} />
            {chartData.marketSessions?.length > 0 && effectiveVisibleLines.marketSessions && chartData.marketSessions.map((area, index) => (
              <ReferenceArea key={`market-area-${area.day || ''}-${index}`} x1={area.start} x2={area.end} yAxisId="price" fill={area.session === 'regular' ? COLORS.marketRegularBg : COLORS.marketOffHoursBg} fillOpacity={0.3} stroke={area.session === 'regular' ? COLORS.axisLight : COLORS.referenceLine} strokeOpacity={0.1} strokeWidth={1} ifOverflow="hidden" isAnimationActive={CHART_ANIMATIONS.enabled} animationDuration={CHART_ANIMATIONS.duration} animationEasing={CHART_ANIMATIONS.easing}/>
            ))}
            <XAxis {...xAxisConfig} />
            <YAxis {...yAxisConfigs.sentiment} />
            <YAxis {...yAxisConfigs.price} />
            <YAxis {...yAxisConfigs.volume} />
            <YAxis {...yAxisConfigs.articleCount} />
            {chartData.indexData.length > 0 && effectiveVisibleLines.marketIndex && <YAxis {...yAxisConfigs.index} />}
            <RechartsTooltip content={<CustomTooltip selectedMarketIndex={selectedMarketIndex} isInteractiveMode={isInteractiveMode} />} cursor={false} />
            <ReferenceLine y={0} yAxisId="sentiment" stroke={COLORS.referenceLine} strokeDasharray="3 3"/>
            {effectiveVisibleLines.currentTimeLine && <ReferenceLine x={getCurrentTime().getTime()} yAxisId="price" stroke={COLORS.currentTimeLine} strokeWidth={2} strokeDasharray="3 3" label={{ value: "NOW", position: 'top', fill: COLORS.currentTimeLine, fontSize: 11 }} />}
            {tunerResults && (
              <ReferenceDot
                x={chartData.timeRange.max + (futureWindowHours * 3600000 / 2)}
                y={0}
                yAxisId="sentiment"
                ifOverflow="extendDomain"
                shape={(props) => <PredictionMarker {...props} chartData={chartData} tunerResults={tunerResults} />}
              />
            )}
            {renderDerivativeArea(lineConfigs.stockAcceleration, "stockAcceleration")}
            {renderDerivativeArea(lineConfigs.marketAcceleration, "marketAcceleration")}
            {renderDerivativeArea(lineConfigs.industryAcceleration, "industryAcceleration")}
            {renderDerivativeArea(lineConfigs.masterAcceleration, "masterAcceleration")}
            {renderArea(chartData.volumeData, "volume", COLORS.volume, "volume", "Volume", "volume")}
            {renderArea(chartData.stockArticleCountData, "articleCount", COLORS.stockArticleCount, "articleCount", "Stock Article Count", "stockArticleCount")}
            {renderArea(chartData.marketArticleCountData, "articleCount", COLORS.marketArticleCount, "articleCount", "Market Article Count", "marketArticleCount")}
            {renderArea(chartData.industryArticleCountData, "articleCount", COLORS.industryArticleCount, "articleCount", "Industry Article Count", "industryArticleCount")}
            {renderScatter(lineConfigs.stockSentimentPoints, "stockSentimentPoints")}
            {renderLine(lineConfigs.stockRollingAvg, "stockRollingAvg")}
            {renderScatter(lineConfigs.industrySentimentPoints, "industrySentimentPoints")}
            {renderLine(lineConfigs.industryRollingAvg, "industryRollingAvg")}
            {renderScatter(lineConfigs.marketSentimentPoints, "marketSentimentPoints")}
            {renderLine(lineConfigs.marketRollingAvg, "marketRollingAvg")}
            {effectiveVisibleLines.combinedRollingAvg && renderCombinedAverage(chartData.combinedRollingAvg, "Combined Rolling Average")}
            {renderLine(lineConfigs.stockVelocity, "stockVelocity")}
            {renderLine(lineConfigs.marketVelocity, "marketVelocity")}
            {renderLine(lineConfigs.industryVelocity, "industryVelocity")}
            {renderLine(lineConfigs.masterVelocity, "masterVelocity")}
            {effectiveVisibleLines.marketTemporalImpact && renderTemporalLine(chartData.marketTemporalData, COLORS.marketTemporalImpact, "sentiment", "Market Temporal Impact")}
            {effectiveVisibleLines.industryTemporalImpact && renderTemporalLine(chartData.industryTemporalData, COLORS.industryTemporalImpact, "sentiment", "Industry Temporal Impact")}
            {effectiveVisibleLines.stockTemporalImpact && renderTemporalLine(chartData.stockTemporalData, COLORS.stockTemporalImpact, "sentiment", "Stock Temporal Impact")}
            {effectiveVisibleLines.masterTemporalImpact && renderTemporalLine(chartData.masterTemporalData, COLORS.masterTemporalImpact, "sentiment", "Master Temporal Impact")}
            {effectiveVisibleLines.marketIndex && hasIndexBaseline && chartData.indexData.length > 0 && renderLine(lineConfigs.marketIndex, "marketIndex")}
            {effectiveVisibleLines.stockPrice && hasStockBaseline && renderLine(lineConfigs.stockPrice, "stockPrice")}
            {effectiveVisibleLines.stockPriceBubbles && hasStockBaseline && positionedPricePoints && positionedPricePoints.length > 0 && (
              positionedPricePoints.map((point, index) => (
                <ReferenceDot
                  key={`price-point-${index}`}
                  x={point.timestamp}
                  y={point.price}
                  yAxisId="price"
                  shape={(props) => <PricePointDot {...props} point={point} colorMode={colorMode} chartWidth={plotAreaWidth} chartHeight={plotAreaHeight} />}
                />
              ))
            )}
            {customRenderables.map((element, index) => React.cloneElement(element, { key: `custom-${index}` }))}
            {chartState.crosshairPosition.x !== null && isInteractiveMode && <g className="crosshair"><CrossHair x={chartState.crosshairPosition.x} y={chartState.crosshairPosition.y} chartHeight={chartState.height} chartWidth={chartState.width} isInteractiveMode={isInteractiveMode} /></g>}
            <Brush dataKey="timestamp" height={20} stroke={COLORS.info} fill="rgba(132, 132, 216, 0.2)" travellerWidth={10} startIndex={chartState.brushIndices.startIndex} endIndex={chartState.brushIndices.endIndex} onChange={handleBrushChange} y={chartState.height - 20} />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <TunerComparisonModal
        isOpen={isComparisonModalOpen}
        onClose={() => setIsComparisonModalOpen(false)}
        data={tunerResults}
      />
    </Box>
  );
};

export default React.memo(SentimentChart);