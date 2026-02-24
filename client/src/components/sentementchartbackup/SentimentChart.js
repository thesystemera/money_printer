import React, { useState, useEffect, useRef, useReducer, useMemo, useCallback } from 'react';
import { Box, useColorMode } from '@chakra-ui/react';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Brush, ComposedChart, Area, ReferenceLine, ReferenceArea, Scatter, ReferenceDot
} from 'recharts';
import SentimentChartControls from './SentimentChartControls';
import {
  CustomSentimentDot, CustomTooltip, CrossHair, PricePointDot
} from './SentimentChartComponents';
import {
  COLORS,
  MARKET_INDICES,
  CHART_STYLING,
  DEFAULT_UI_STATES,
  CHART_ANIMATIONS,
  DEFAULT_DATA_SETTINGS,
  DEFAULT_TEMPORAL_PARAMETERS,
  DEFAULT_SENTIMENT_WEIGHTS,
  HISTORICAL_BASELINE,
  CHART_DIMENSIONS
} from '../config/Config';
import { prepareChartData } from './SentimentDataProcessor';
import {
  generateLineConfigs, createXAxisConfig, createYAxisConfigs, createIndexYAxisConfig,
  generateCommonLegendItems, positionLabels, clearOccupiedRegions, getTimezoneOffset,
  chartStateReducer, initialChartState
} from './SentimentChartUtils';
import { getCurrentTime } from '../services/timeService';

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
  temporalParams: temporalParamsProp = null
}) => {
  const chartContainerRef = useRef(null);
  const mouseFrameRef = useRef(null);
  const { colorMode } = useColorMode();

  const [chartState, dispatch] = useReducer(chartStateReducer, initialChartState);
  const [localTemporalParams, setLocalTemporalParams] = useState(DEFAULT_TEMPORAL_PARAMETERS);
  const [internalDataResolution, setInternalDataResolution] = useState(dataResolutionProp || DEFAULT_DATA_SETTINGS.dataResolutionMinutes);
  const [visibleLines, setVisibleLines] = useState(DEFAULT_UI_STATES.visibleLines);
  const [enableBiasNormalization, setEnableBiasNormalization] = useState(true);
  const [enableImpactNormalization, setEnableImpactNormalization] = useState(true);
  const [selectedMarketIndex, setSelectedMarketIndex] = useState(MARKET_INDICES.DEFAULT_INDEX);
  const [masterWeights, setMasterWeights] = useState({ stock: 1.0, market: 1.0, industry: 1.0 });
  const [sourceCategoryWeights, setSourceCategoryWeights] = useState(DEFAULT_SENTIMENT_WEIGHTS.sourceWeights);
  const [sentimentComponentWeights, setSentimentComponentWeights] = useState(DEFAULT_SENTIMENT_WEIGHTS.componentWeights);

  const temporalParams = showControls ? localTemporalParams : (temporalParamsProp || DEFAULT_TEMPORAL_PARAMETERS);

  const futureWindowHours = futureWindowHoursProp !== null ? futureWindowHoursProp : temporalParams.futureWindowHours;
  const effectiveDataResolution = dataResolutionProp !== null ? dataResolutionProp : internalDataResolution;
  const setEffectiveDataResolution = dataResolutionProp !== null ? () => {} : setInternalDataResolution;
  const effectiveVisibleLines = visibleLinesProp !== null ? visibleLinesProp : visibleLines;
  const setEffectiveVisibleLines = visibleLinesProp !== null ? () => {} : setVisibleLines;

  const currentTimeWindow = timeWindowOverride || chartState.timeWindow;

  const setCurrentTimeWindow = useCallback((value) => {
    if (timeWindowOverride !== null) return;
    dispatch({ type: 'SET_TIME_WINDOW', payload: value });
  }, [timeWindowOverride, dispatch]);

  const handleTemporalParamChange = useCallback((param, value) => {
    setLocalTemporalParams(prevParams => ({
      ...prevParams,
      [param]: value
    }));
  }, []);

  const handleMasterWeightChange = useCallback((source, value) => {
    setMasterWeights(prev => ({
      ...prev,
      [source]: parseFloat(value)
    }));
  }, []);

  const handleSourceWeightChange = useCallback((category, value) => {
    setSourceCategoryWeights(prev => ({ ...prev, [category]: value }));
  }, []);

  const handleSentimentComponentWeightChange = useCallback((component, value) => {
    setSentimentComponentWeights(prev => ({ ...prev, [component]: parseFloat(value) }));
  }, []);

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
        temporalPastWeight: temporalParams.pastWeight,
        temporalFutureWeight: temporalParams.futureWeight,
        temporalPastShift: temporalParams.pastShift,
        temporalFutureShift: temporalParams.futureShift,
        momentumBlend: temporalParams.momentumBlend,
        derivativeSmoothingWindow: temporalParams.derivativeSmoothingWindow,
        rollingAverageWindow: temporalParams.rollingAverageWindowMs,
        dataResolutionMinutes: effectiveDataResolution,
        articleCountResolution: DEFAULT_DATA_SETTINGS.articleCountResolutionMinutes,
        selectedMarketIndex,
        currentTimeWindow,
        futureWindowHours,
        visibleLines: effectiveVisibleLines,
        enableBiasNormalization,
        enableImpactNormalization,
        masterWeights,
        sourceCategoryWeights,
        sentimentComponentWeights,
      }
    });
  }, [
    stockSentimentData, marketSentimentData, industrySentimentData, stockPriceData,
    marketIndicesData, tradingCalendar, companyInfo, temporalParams, effectiveDataResolution,
    selectedMarketIndex, currentTimeWindow, futureWindowHours, effectiveVisibleLines,
    enableBiasNormalization, enableImpactNormalization, masterWeights, sourceCategoryWeights,
    sentimentComponentWeights
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

  const priceDomain = useMemo(() => createDomain(chartData.stockData), [chartData.stockData, createDomain]);
  const indexDomain = useMemo(() => createDomain(chartData.indexData), [chartData.indexData, createDomain]);

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
      configs.index.domain = indexDomain;
      configs.index.tickFormatter = createCustomTickFormatter(chartData.indexData);
    }
    return configs;
  }, [priceDomain, indexDomain, chartData.stockData, chartData.indexData, selectedMarketIndex]);

  const xAxisConfig = useMemo(() => createXAxisConfig(chartDomain, chartState.timezoneDisplay, chartState.width), [chartDomain, chartState.timezoneDisplay, chartState.width]);

  const globalMaxImpactMagnitude = useMemo(() => {
    const allImpacts = [
      ...(chartData.scaledStockTemporalData || []),
      ...(chartData.marketTemporalData || []),
      ...(chartData.industryTemporalData || [])
    ].map(point => point.impactMagnitude || 0);
    return Math.max(0.001, ...allImpacts);
  }, [chartData.scaledStockTemporalData, chartData.marketTemporalData, chartData.industryTemporalData]);

  const legendItems = useMemo(() => generateCommonLegendItems(chartData, currentTimeWindow, selectedMarketIndex), [chartData, currentTimeWindow, selectedMarketIndex]);

  const showTemporalControls = effectiveVisibleLines.stockTemporalImpact ||
                             effectiveVisibleLines.marketTemporalImpact ||
                             effectiveVisibleLines.industryTemporalImpact ||
                             effectiveVisibleLines.masterTemporalImpact ||
                             effectiveVisibleLines.stockVelocity ||
                             effectiveVisibleLines.stockAcceleration ||
                             effectiveVisibleLines.marketVelocity ||
                             effectiveVisibleLines.marketAcceleration ||
                             effectiveVisibleLines.industryVelocity ||
                             effectiveVisibleLines.industryAcceleration ||
                             effectiveVisibleLines.masterVelocity ||
                             effectiveVisibleLines.masterAcceleration;

  const hasStockBaseline = chartData.stockData.some(point => point.basePrice !== undefined);
  const hasIndexBaseline = chartData.indexData.some(point => point.basePrice !== undefined);

  const chartMargins = { top: 5, right: 20, left: 10, bottom: 5 };
  const plotAreaWidth = chartState.width - chartMargins.left - chartMargins.right;
  const plotAreaHeight = chartState.height - chartMargins.top - chartMargins.bottom - 20;

  useEffect(() => {
    return () => { if (mouseFrameRef.current) cancelAnimationFrame(mouseFrameRef.current); };
  }, []);

  useEffect(() => {
    if (showTemporalControls && currentTimeWindow !== 'temporal' && !timeWindowOverride) {
      setCurrentTimeWindow('temporal');
    }
  }, [showTemporalControls, currentTimeWindow, timeWindowOverride, setCurrentTimeWindow]);

  useEffect(() => {
    if (dataResolutionProp !== null && dataResolutionProp !== internalDataResolution) {
      setInternalDataResolution(dataResolutionProp);
    }
  }, [dataResolutionProp, internalDataResolution]);

  useEffect(() => {
    if (stockPriceData?.length > 0 || companyInfo?.symbol) {
      clearOccupiedRegions();
    }
  }, [stockPriceData, companyInfo?.symbol]);

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
          avgSentiment={chartData.avgSentiment}
          avgMarketSentiment={chartData.avgMarketSentiment}
          avgIndustrySentiment={chartData.avgIndustrySentiment}
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
          temporalParams={localTemporalParams}
          onTemporalParamChange={handleTemporalParamChange}
          showTemporalControls={showTemporalControls}
          enableBiasNormalization={enableBiasNormalization}
          setEnableBiasNormalization={setEnableBiasNormalization}
          enableImpactNormalization={enableImpactNormalization}
          setEnableImpactNormalization={setEnableImpactNormalization}
          masterWeights={masterWeights}
          onMasterWeightChange={handleMasterWeightChange}
          sourceCategoryWeights={sourceCategoryWeights}
          onSourceWeightChange={handleSourceWeightChange}
          sentimentComponentWeights={sentimentComponentWeights}
          onSentimentComponentWeightChange={handleSentimentComponentWeightChange}
          sourceCategoryCounts={chartData.sourceCategoryCounts}
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
            {effectiveVisibleLines.combinedRollingAvgPresentFocus && renderCombinedAverage(chartData.combinedRollingAvgPresentFocus, "Combined Rolling Average (Present Focus)")}
            {renderLine(lineConfigs.stockVelocity, "stockVelocity")}
            {renderLine(lineConfigs.marketVelocity, "marketVelocity")}
            {renderLine(lineConfigs.industryVelocity, "industryVelocity")}
            {renderLine(lineConfigs.masterVelocity, "masterVelocity")}
            {effectiveVisibleLines.marketTemporalImpact && renderTemporalLine(chartData.marketTemporalData, COLORS.marketTemporalImpact, "sentiment", "Market Temporal Impact")}
            {effectiveVisibleLines.industryTemporalImpact && renderTemporalLine(chartData.industryTemporalData, COLORS.industryTemporalImpact, "sentiment", "Industry Temporal Impact")}
            {effectiveVisibleLines.stockTemporalImpact && renderTemporalLine(chartData.scaledStockTemporalData, COLORS.stockTemporalImpact, "sentiment", "Stock Temporal Impact")}
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
    </Box>
  );};

export default React.memo(SentimentChart);