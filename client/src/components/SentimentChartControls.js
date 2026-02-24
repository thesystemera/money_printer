import React, { memo, useMemo, useCallback, useState, useEffect } from 'react';
import {
  Box, Text, Flex, Select,
  Button, ButtonGroup, Tooltip, HStack, Grid, GridItem,
  Slider, SliderTrack, SliderFilledTrack, SliderThumb, SliderMark,
  Accordion, AccordionItem, AccordionButton, AccordionPanel, AccordionIcon,
  Switch, Progress, VStack, Badge,
  Tabs, TabList, TabPanels, Tab, TabPanel,
  Table, Thead, Tbody, Tr, Th, Td, TableContainer,
} from '@chakra-ui/react';
import { RefreshCw, ChevronLeft, ChevronRight, Play, Zap, BarChart2, TrendingUp, RotateCcw } from 'lucide-react';
import { LegendItem, ColorWheelLegendItem } from './SentimentChartComponents';
import {
  TIME_WINDOW_OPTIONS,
  MARKET_INDICES,
  RESOLUTION_OPTIONS,
  UI_ANIMATIONS,
} from '../config/Config';

const ControlSelect = memo(({ value, onChange, options, tooltip, isDisabled = false }) => (
    <Tooltip label={tooltip}>
      <Select
        value={value}
        onChange={onChange}
        size="xs"
        width="auto"
        variant="filled"
        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
        isDisabled={isDisabled}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label || option.name}
          </option>
        ))}
      </Select>
    </Tooltip>
));

const ParamSlider = memo(({
  min, max, step, value, onChange, marks, colorScheme, label, description, suffix = "", isInteractive = true
}) => (
  <Box mb={4} position="relative" zIndex={isInteractive ? 3 : 1}>
    <Flex justify="space-between" mb={1}>
      <Text fontSize="xs">{label}: {value}{suffix}</Text>
      {description && <Text fontSize="xs">{description}</Text>}
    </Flex>
    <Slider
      min={min} max={max} step={step} value={value}
      onChange={onChange} size="sm" colorScheme={colorScheme}
      mt={2} pointerEvents="auto" zIndex={2}
    >
      {marks}
      <SliderTrack><SliderFilledTrack /></SliderTrack>
      <SliderThumb zIndex={3} />
    </Slider>
  </Box>
));

const TimeWindowButtons = memo(({ zoomToTimeWindow }) => {
  const timeWindows = useMemo(() => [
    { days: 1, label: '1D' },
    { days: 2, label: '2D' },
    { days: 5, label: '5D' },
    { days: 7, label: '1W' },
    { days: 14, label: '2W' },
    { days: 30, label: '1M' }
  ], []);

  return (
    <ButtonGroup size="xs" isAttached variant="outline" mb={1}>
      {timeWindows.map(({ days, label }) => (
        <Tooltip key={days} label={`${days} day${days > 1 ? 's' : ''} view`}>
          <Button
            onClick={() => zoomToTimeWindow(days)}
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          >
            {label}
          </Button>
        </Tooltip>
      ))}
    </ButtonGroup>
  );
});

const NavigationButtons = memo(({ moveLeft, moveRight, resetView, viewDomain }) => (
  <ButtonGroup size="xs" isAttached variant="outline" ml={2}>
    <Tooltip label="Move left">
      <Button
        aria-label="Move left"
        onClick={moveLeft}
        isDisabled={!viewDomain}
        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
      >
        <ChevronLeft size={14} />
      </Button>
    </Tooltip>
    <Tooltip label="Reset view">
      <Button
        aria-label="Reset view"
        onClick={resetView}
        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
      >
        <RefreshCw size={14} />
      </Button>
    </Tooltip>
    <Tooltip label="Move right">
      <Button
        aria-label="Move right"
        onClick={moveRight}
        isDisabled={!viewDomain}
        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
      >
        <ChevronRight size={14} />
      </Button>
    </Tooltip>
  </ButtonGroup>
));

const BucketControlPanel = memo(({ bucket, params, onParamChange, sourceCategoryCounts }) => {
    const newMarks = useMemo(() => [0, 0.5, 1, 1.5, 2].map(value => (
        <SliderMark key={`mark-${value}`} value={value} mt={2} ml={-2.5} fontSize="xs">
          {value.toFixed(1)}
        </SliderMark>
    )), []);

    const temporalMarks = useMemo(() => [0.0, 0.5, 1.0, 1.5, 2.0].map(value => (
        <SliderMark key={`mark-temporal-${value}`} value={value} mt={2} ml={-2.5} fontSize="xs">
          {value.toFixed(1)}
        </SliderMark>
    )), []);

    return (
        <Box>
            <Box bg="gray.800" p={3} borderRadius="md" mt={2}>
              <Text fontSize="sm" fontWeight="bold" mb={3}>Component Weights</Text>
              <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap={6}>
                  <ParamSlider
                    min={0} max={2} step={0.1} value={params.component.sentimentWeight}
                    onChange={(val) => onParamChange(bucket, 'component', 'sentimentWeight', val)}
                    marks={newMarks} colorScheme="blue" label="Sentiment" suffix="x"
                  />
                  <ParamSlider
                    min={0} max={2} step={0.1} value={params.component.influenceWeight}
                    onChange={(val) => onParamChange(bucket, 'component', 'influenceWeight', val)}
                    marks={newMarks} colorScheme="purple" label="Influence" suffix="x"
                  />
                  <ParamSlider
                    min={0} max={2} step={0.1} value={params.component.certaintyWeight}
                    onChange={(val) => onParamChange(bucket, 'component', 'certaintyWeight', val)}
                    marks={newMarks} colorScheme="orange" label="Certainty" suffix="x"
                  />
              </Grid>
            </Box>

            <Box bg="gray.800" p={3} borderRadius="md" mt={2}>
              <Text fontSize="sm" fontWeight="bold" mb={3}>Source Weights</Text>
              <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap={6}>
                <GridItem>
                  <ParamSlider
                    min={0} max={2} step={0.1} value={params.source.RETAIL}
                    onChange={(val) => onParamChange(bucket, 'source', 'RETAIL', val)}
                    marks={newMarks} colorScheme="green" label={`Retail (${sourceCategoryCounts?.RETAIL || 0})`} suffix="x"
                  />
                </GridItem>
                <GridItem>
                  <ParamSlider
                    min={0} max={2} step={0.1} value={params.source.INSTITUTIONAL}
                    onChange={(val) => onParamChange(bucket, 'source', 'INSTITUTIONAL', val)}
                    marks={newMarks} colorScheme="yellow" label={`Institutional (${sourceCategoryCounts?.INSTITUTIONAL || 0})`} suffix="x"
                  />
                </GridItem>
                <GridItem>
                  <ParamSlider
                    min={0} max={2} step={0.1} value={params.source.AMBIGUOUS}
                    onChange={(val) => onParamChange(bucket, 'source', 'AMBIGUOUS', val)}
                    marks={newMarks} colorScheme="gray" label={`Ambiguous (${sourceCategoryCounts?.AMBIGUOUS || 0})`} suffix="x"
                  />
                </GridItem>
              </Grid>
            </Box>

            <Box bg="gray.800" p={3} borderRadius="md" mt={2}>
              <Text fontSize="sm" fontWeight="bold" mb={3}>Temporal Weights</Text>
               <Grid templateColumns="repeat(2, 1fr)" gap={6}>
                  <ParamSlider
                    min={0} max={2} step={0.25} value={params.temporal.pastWeight}
                    onChange={(val) => onParamChange(bucket, 'temporal', 'pastWeight', val)}
                    marks={temporalMarks} colorScheme="blue" label="Past Focus" suffix="x"
                  />
                  <ParamSlider
                    min={0} max={2} step={0.25} value={params.temporal.futureWeight}
                    onChange={(val) => onParamChange(bucket, 'temporal', 'futureWeight', val)}
                    marks={temporalMarks} colorScheme="green" label="Future Focus" suffix="x"
                  />
               </Grid>
            </Box>
        </Box>
    )
});

const GlobalTemporalControls = memo(({
  globalTemporalParams, onGlobalTemporalParamChange, enableImpactNormalization,
  setEnableImpactNormalization,
}) => {
  const smoothingMarks = useMemo(() => [1, 5, 10, 15, 20].map(value => (
    <SliderMark key={`smoothing-${value}`} value={value} mt={2} ml={-2.5} fontSize="xs">
        {value}
    </SliderMark>
  )), []);
  const momentumMarks = useMemo(() => [0, 0.5, 1, 1.5, 2].map(value => (
    <SliderMark
      key={`momentum-${value}`}
      value={value}
      mt={2}
      ml={-2.5}
      fontSize="xs"
    >
      {value.toFixed(1)}
    </SliderMark>
  )), []);

  const handleSliderChange = useCallback((param, value) => {
    let roundedValue = value;
    if (param === 'momentumBlend') {
      roundedValue = Math.round(value * 10) / 10;
    } else if (param === 'derivativeSmoothingWindow') {
      roundedValue = Math.round(value);
    }
    onGlobalTemporalParamChange(param, roundedValue);
  }, [onGlobalTemporalParamChange]);

  return (
    <Accordion allowToggle>
        <AccordionItem border="0">
             <AccordionButton bg="gray.800" borderRadius="md" py={2}>
                <Box flex="1" textAlign="left" fontWeight="bold" fontSize="xs">Global Temporal Shaping</Box>
                <AccordionIcon />
            </AccordionButton>
            <AccordionPanel bg="gray.800" borderBottomRadius="md" p={3}>
                <Grid templateColumns="repeat(2, 1fr)" gap={6}>
                        <ParamSlider
                        min={0} max={2} step={0.1} value={globalTemporalParams.momentumBlend}
                        onChange={(val) => handleSliderChange('momentumBlend', val)}
                        marks={momentumMarks} colorScheme="orange" label="Momentum Blend"
                        description={
                            globalTemporalParams.momentumBlend < 0.8 ? '(Impact-focused)' :
                            globalTemporalParams.momentumBlend > 1.2 ? '(Trend-focused)' : '(Balanced)'
                        }
                    />
                    <ParamSlider
                        min={1} max={20} step={1} value={globalTemporalParams.derivativeSmoothingWindow}
                        onChange={(val) => handleSliderChange('derivativeSmoothingWindow', val)}
                        marks={smoothingMarks} colorScheme="cyan" label="V/A Smoothing Window"
                        description={
                            globalTemporalParams.derivativeSmoothingWindow < 5 ? '(Responsive)' :
                            globalTemporalParams.derivativeSmoothingWindow > 12 ? '(Smooth)' : '(Balanced)'
                        }
                    />
                </Grid>
                <Flex justify="space-between" align="center" mt={4}>
                    <Tooltip label="Normalizes total story impact against the average story lifespan to create a constant energy model.">
                        <Text fontSize="xs" fontWeight="bold">Pure Energy Normalization</Text>
                    </Tooltip>
                    <Switch
                        size="sm"
                        isChecked={enableImpactNormalization}
                        onChange={(e) => setEnableImpactNormalization(e.target.checked)}
                        colorScheme="green"
                    />
                </Flex>
            </AccordionPanel>
        </AccordionItem>
    </Accordion>
  );
});

const AutoTunerResults = memo(({ results }) => {
    if (!results || !results.bestParams) return null;

    const { bestParams, perBucketStats, finalBlendedCorrelation } = results;
    const { stock_params, market_params, industry_params } = bestParams;
    const channels = ['stock', 'market', 'industry'];

    const formatValue = (value) => {
        if (typeof value === 'number') {
            return value.toFixed(2);
        }
        return value;
    }

    return (
        <Box>
            <HStack justify="space-between" align="center" mb={3}>
                <Text fontSize="sm" fontWeight="bold">Optimization Complete</Text>
                <Badge colorScheme="green" leftIcon={<TrendingUp size={12} />}>
                    Optimized
                </Badge>
            </HStack>

            <Text fontSize="sm" fontWeight="bold" mb={2} mt={4}>Per-Channel Performance</Text>
            <TableContainer>
                <Table size="sm" variant="simple">
                    <Thead>
                        <Tr>
                            <Th>Channel</Th>
                            <Th isNumeric>Original</Th>
                            <Th isNumeric>Tuned</Th>
                            <Th isNumeric>Improvement</Th>
                            <Th isNumeric>Optimal Lag (h)</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {channels.map(channel => {
                            const stats = perBucketStats?.[channel];
                            if (!stats) return null;

                            const improvement = Math.abs(stats.originalCorrelation) > 0.001
                                ? ((stats.tunedCorrelation - stats.originalCorrelation) / Math.abs(stats.originalCorrelation)) * 100
                                : (stats.tunedCorrelation > 0 ? Infinity : 0);

                            const improvementColor = improvement >= 0 ? "green.300" : "red.300";

                            return (
                                <Tr key={channel}>
                                    <Td textTransform="capitalize">{channel}</Td>
                                    <Td isNumeric>{(stats.originalCorrelation * 100).toFixed(1)}%</Td>
                                    <Td isNumeric fontWeight="bold">{(stats.tunedCorrelation * 100).toFixed(1)}%</Td>
                                    <Td isNumeric color={improvementColor}>
                                        {isFinite(improvement) ? `${improvement >= 0 ? '+' : ''}${improvement.toFixed(0)}%` : 'N/A'}
                                    </Td>
                                    <Td isNumeric>{stats.tunedLag?.toFixed(2)}</Td>
                                </Tr>
                            );
                        })}
                    </Tbody>
                </Table>
            </TableContainer>

            {finalBlendedCorrelation !== undefined && (
                <Flex justify="space-between" align="center" mt={4} p={3} bg="gray.900" borderRadius="md">
                    <Text fontWeight="bold" fontSize="md">Master Blend Correlation</Text>
                    <Badge colorScheme="purple" fontSize="lg" px={3} py={1}>
                        {(finalBlendedCorrelation * 100).toFixed(1)}%
                    </Badge>
                </Flex>
            )}

            {bestParams.optimal_lag_hours !== undefined && (
                <Flex justify="space-between" align="center" mt={2} p={3} bg="gray.900" borderRadius="md">
                    <Text fontWeight="bold" fontSize="md">Master Blend Optimum Lag</Text>
                    <Badge colorScheme="green" fontSize="lg" px={3} py={1}>
                        {bestParams.optimal_lag_hours.toFixed(2)}h
                    </Badge>
                </Flex>
            )}

            {bestParams.blend_price_window_ms && (
                <Flex justify="space-between" align="center" mt={2} p={3} bg="gray.900" borderRadius="md">
                    <Text fontWeight="bold" fontSize="md">Master Blend Price Window</Text>
                    <Badge colorScheme="cyan" fontSize="lg" px={3} py={1}>
                        {(bestParams.blend_price_window_ms / 60000).toFixed(0)} min
                    </Badge>
                </Flex>
            )}

            <Text fontSize="sm" fontWeight="bold" mb={2} mt={4}>Optimal Core Parameters</Text>
            <TableContainer>
                <Table size="sm" variant="simple">
                    <Thead>
                        <Tr>
                            <Th>Parameter</Th>
                            <Th isNumeric>Stock</Th>
                            <Th isNumeric>Market</Th>
                            <Th isNumeric>Industry</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        <Tr>
                            <Td>Sentiment Window</Td>
                            <Td isNumeric>{(stock_params.sentimentWindowMs / 3600000).toFixed(1)} hr</Td>
                            <Td isNumeric>{(market_params.sentimentWindowMs / 3600000).toFixed(1)} hr</Td>
                            <Td isNumeric>{(industry_params.sentimentWindowMs / 3600000).toFixed(1)} hr</Td>
                        </Tr>
                        <Tr>
                            <Td>Price Window</Td>
                            <Td isNumeric>{(stock_params.priceWindowMs / 60000).toFixed(0)} min</Td>
                            <Td isNumeric>{(market_params.priceWindowMs / 60000).toFixed(0)} min</Td>
                            <Td isNumeric>{(industry_params.priceWindowMs / 60000).toFixed(0)} min</Td>
                        </Tr>
                        <Tr>
                            <Td>Trend Factor</Td>
                            <Td isNumeric>{formatValue(stock_params.trendFactor)}</Td>
                            <Td isNumeric>{formatValue(market_params.trendFactor)}</Td>
                            <Td isNumeric>{formatValue(industry_params.trendFactor)}</Td>
                        </Tr>
                        <Tr>
                            <Td>Energy Factor</Td>
                            <Td isNumeric>{formatValue(stock_params.energyFactor)}</Td>
                            <Td isNumeric>{formatValue(market_params.energyFactor)}</Td>
                            <Td isNumeric>{formatValue(industry_params.energyFactor)}</Td>
                        </Tr>
                    </Tbody>
                </Table>
            </TableContainer>
        </Box>
    );
});

const AutoTunerPanel = memo(({ tunerResults, onStartTuning, onViewComparison, onProgressUpdate }) => {
    const [tunerProgress, setTunerProgress] = useState({ isTuning: false, progress: 0, total: 0, phaseName: '' });

    useEffect(() => {
        if (onProgressUpdate) {
            onProgressUpdate((progressData) => {
                setTunerProgress(progressData);
            });
        }
        return () => {
            if (onProgressUpdate) {
                onProgressUpdate(null);
            }
        };
    }, [onProgressUpdate]);

    return (
        <Accordion allowToggle defaultIndex={[0]}>
            <AccordionItem border="0">
                <AccordionButton bg="gray.800" borderRadius="md" py={2}>
                    <Box flex="1" textAlign="left" fontWeight="bold" fontSize="xs">Auto-Tune & Prediction</Box>
                    <AccordionIcon />
                </AccordionButton>
                <AccordionPanel bg="gray.800" borderBottomRadius="md" p={3}>
                    {tunerProgress.isTuning && (
                        <VStack spacing={3}>
                            <Text fontSize="sm">Optimizing sentiment-price correlation...</Text>
                            <Progress
                                value={tunerProgress.progress}
                                max={tunerProgress.total || 1}
                                isIndeterminate={tunerProgress.total === 0}
                                hasStripe
                                isAnimated
                                colorScheme="blue"
                                width="100%"
                            />
                            <Text fontSize="xs" color="gray.400">
                              {tunerProgress.progress > 0
                                ? `${tunerProgress.phaseName || 'Processing'}: ${tunerProgress.progress} / ${tunerProgress.total} iterations`
                                : 'Initializing optimization engine...'}
                            </Text>
                        </VStack>
                    )}

                    {!tunerProgress.isTuning && !tunerResults && (
                         <VStack spacing={3} align="stretch">
                            <Button
                                leftIcon={<Play size={14} />}
                                colorScheme="blue"
                                size="sm"
                                onClick={onStartTuning}
                                isLoading={tunerProgress.isTuning}
                            >
                                Run Full Optimization
                            </Button>
                        </VStack>
                    )}

                    {tunerResults && (
                        <Box>
                            <AutoTunerResults results={tunerResults} />
                             <HStack mt={4} spacing={2}>
                                <Button
                                    leftIcon={<BarChart2 size={14} />}
                                    colorScheme="purple"
                                    size="sm"
                                    onClick={onViewComparison}
                                    flex="1"
                                >
                                    View Analysis
                                </Button>
                                <Button
                                    leftIcon={<Play size={14} />}
                                    variant="outline"
                                    size="sm"
                                    onClick={onStartTuning}
                                    flex="1"
                                >
                                    Re-optimize
                                </Button>
                            </HStack>
                        </Box>
                    )}
                </AccordionPanel>
            </AccordionItem>
        </Accordion>
    );
});

const TuningStatusBadge = memo(({ status }) => {
    if (!status) return null;

    let colorScheme = 'gray';
    let text = 'Default Settings';

    switch (status.state) {
        case 'Optimizing':
            colorScheme = 'blue';
            text = 'Optimizing...';
            break;
        case 'Tuned':
            colorScheme = 'green';
            text = `Tuned (Corr: ${(status.correlation * 100).toFixed(1)}%)`;
            break;
        case 'Custom':
            colorScheme = 'orange';
            text = 'Custom Settings';
            break;
        default:
            break;
    }

    return (
        <Badge colorScheme={colorScheme} ml={3} variant="solid">
            {text}
        </Badge>
    );
});

const SentimentChartControls = memo(({
  showControls,
  timeWindow, setTimeWindow, timezoneDisplay, setTimezoneDisplay,
  selectedMarketIndex, onMarketIndexChange, zoomToTimeWindow, moveLeft, moveRight, resetView,
  viewDomain, visibleLines, setVisibleLines, legendItems, isLoadingMarketIndices,
  dataResolutionMinutes = 15, setDataResolutionMinutes,
  bucketParams, onParamChange, globalTemporalParams, onGlobalTemporalParamChange,
  enableBiasNormalization = true, setEnableBiasNormalization,
  enableImpactNormalization, setEnableImpactNormalization,
  masterWeights, onMasterWeightChange,
  sourceCategoryCounts,
  tunerResults, onStartTuning, onViewComparison, onResetToDefaults, onApplyToSupplementary,
  onProgressUpdate,
  tuningStatus
}) => {

  const handleLegendClick = useCallback((dataKey) => {
    setVisibleLines(prev => ({...prev, [dataKey]: !prev[dataKey]}));
  }, [setVisibleLines]);

  const timezoneOptions = useMemo(() => [
    { value: 'local', label: 'Local Time' },
    { value: 'et', label: 'Eastern (ET)' },
    { value: 'utc', label: 'UTC' }
  ], []);

  const marketIndexOptions = useMemo(() =>
    Object.entries(MARKET_INDICES.INFO).map(([key, info]) => ({ value: key, name: info.name }))
  , []);

  const masterMarks = useMemo(() => [0, 0.5, 1, 1.5, 2].map(value => (
    <SliderMark key={`mark-master-${value}`} value={value} mt={2} ml={-2.5} fontSize="xs">
        {value.toFixed(1)}
    </SliderMark>
  )), []);

  return (
    <Box width="100%" px={1}>
      <Accordion allowToggle defaultIndex={showControls ? [0] : []}>
        <AccordionItem border="0">
          <AccordionButton p={2} bg="gray.700" borderRadius="md">
            <HStack flex="1" textAlign="left">
              <Text fontSize="sm" fontWeight="bold">Chart Controls</Text>
              <TuningStatusBadge status={tuningStatus} />
            </HStack>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel bg="gray.700" p={3}>
            <Grid
              templateColumns={{ base: "1fr", md: "1fr auto 1fr" }}
              gap={2}
              mb={1}
            >
              <GridItem>
                <Flex align="center" mb={1} flexWrap="wrap">
                  <Text fontSize="sm" color="gray.400" mr={2}>Bias Normalization:</Text>
                  <Tooltip label={enableBiasNormalization ? "Zero-mean normalization removes inherent media bias from sentiment data" : "Raw sentiment data shows natural media bias"}>
                    <HStack spacing={2}>
                      <Switch
                        size="sm"
                        isChecked={enableBiasNormalization}
                        onChange={(e) => setEnableBiasNormalization(e.target.checked)}
                        colorScheme="blue"
                      />
                      <Text fontSize="xs" color={enableBiasNormalization ? "blue.400" : "gray.500"}>
                        {enableBiasNormalization ? "Normalized" : "Raw Data"}
                      </Text>
                    </HStack>
                  </Tooltip>
                </Flex>
              </GridItem>
              <GridItem>
                <Flex justify="center" align="center" wrap="wrap">
                  <TimeWindowButtons zoomToTimeWindow={zoomToTimeWindow} />
                  <NavigationButtons
                    moveLeft={moveLeft}
                    moveRight={moveRight}
                    resetView={resetView}
                    viewDomain={viewDomain}
                  />
                  <ButtonGroup size="xs" isAttached variant="outline" ml={2}>
                    <Button
                        leftIcon={<Zap size={14} />}
                        colorScheme={tuningStatus.state === 'Custom' ? "green" : "gray"}
                        onClick={onApplyToSupplementary}
                        isDisabled={tuningStatus.state !== 'Custom'}
                    >
                        Apply to Supplementary
                    </Button>
                    <Tooltip label="Reset all parameters to their default values">
                        <Button
                            onClick={onResetToDefaults}
                            aria-label="Reset to Defaults"
                        >
                            <RotateCcw size={14} />
                        </Button>
                    </Tooltip>
                  </ButtonGroup>
                </Flex>
              </GridItem>
              <GridItem>
                <Flex justify="flex-end" align="center" wrap="wrap">
                  <HStack spacing={1} align="center">
                    <ControlSelect
                      value={dataResolutionMinutes}
                      onChange={(e) => setDataResolutionMinutes(Number(e.target.value))}
                      options={RESOLUTION_OPTIONS}
                      tooltip="Data resolution"
                    />
                    <ControlSelect
                      value={timezoneDisplay}
                      onChange={(e) => setTimezoneDisplay(e.target.value)}
                      options={timezoneOptions}
                      tooltip="Timezone display"
                    />
                    <ControlSelect
                      value={selectedMarketIndex}
                      onChange={(e) => onMarketIndexChange(e.target.value)}
                      options={marketIndexOptions}
                      tooltip="Market index"
                      isDisabled={isLoadingMarketIndices}
                    />
                    <ControlSelect
                      value={timeWindow}
                      onChange={(e) => {
                        const value = e.target.value;
                        setTimeWindow(value === 'temporal' ? value : Number(value));
                      }}
                      options={TIME_WINDOW_OPTIONS}
                      tooltip="Time window"
                    />
                  </HStack>
                </Flex>
              </GridItem>
            </Grid>
            <Tabs isFitted variant='enclosed' mt={4}>
                <TabList>
                    <Tab _selected={{ color: 'white', bg: 'blue.500' }}>Master</Tab>
                    <Tab _selected={{ color: 'white', bg: 'blue.500' }}>Stock</Tab>
                    <Tab _selected={{ color: 'white', bg: 'blue.500' }}>Market</Tab>
                    <Tab _selected={{ color: 'white', bg: 'blue.500' }}>Industry</Tab>
                </TabList>
                <TabPanels>
                    <TabPanel p={0}>
                       <Box bg="gray.800" p={3} borderRadius="md" mt={2}>
                        <Text fontSize="sm" fontWeight="bold" mb={3}>Master Blend Weights</Text>
                            <Grid templateColumns="repeat(3, 1fr)" gap={6}>
                            <ParamSlider
                                min={0} max={2} step={0.1} value={masterWeights.stock}
                                onChange={(val) => onMasterWeightChange('stock', val)}
                                marks={masterMarks} colorScheme="blue" label="Stock"
                                suffix="x"
                            />
                            <ParamSlider
                                min={0} max={2} step={0.1} value={masterWeights.market}
                                onChange={(val) => onMasterWeightChange('market', val)}
                                marks={masterMarks} colorScheme="pink" label="Market"
                                suffix="x"
                            />
                            <ParamSlider
                                min={0} max={2} step={0.1} value={masterWeights.industry}
                                onChange={(val) => onMasterWeightChange('industry', val)}
                                marks={masterMarks} colorScheme="green" label="Industry"
                                suffix="x"
                            />
                        </Grid>
                        </Box>
                    </TabPanel>
                    <TabPanel p={0}>
                       <BucketControlPanel
                         bucket="stock"
                         params={bucketParams.stock}
                         onParamChange={onParamChange}
                         sourceCategoryCounts={sourceCategoryCounts}
                       />
                    </TabPanel>
                    <TabPanel p={0}>
                       <BucketControlPanel
                         bucket="market"
                         params={bucketParams.market}
                         onParamChange={onParamChange}
                         sourceCategoryCounts={sourceCategoryCounts}
                       />
                    </TabPanel>
                    <TabPanel p={0}>
                       <BucketControlPanel
                         bucket="industry"
                         params={bucketParams.industry}
                         onParamChange={onParamChange}
                         sourceCategoryCounts={sourceCategoryCounts}
                       />
                    </TabPanel>
                </TabPanels>
            </Tabs>

            <GlobalTemporalControls
                globalTemporalParams={globalTemporalParams}
                onGlobalTemporalParamChange={onGlobalTemporalParamChange}
                enableImpactNormalization={enableImpactNormalization}
                setEnableImpactNormalization={setEnableImpactNormalization}
            />

            <AutoTunerPanel
                tunerResults={tunerResults}
                onStartTuning={onStartTuning}
                onViewComparison={onViewComparison}
                onProgressUpdate={onProgressUpdate}
            />
            <Flex justifyContent="center" alignItems="center" flexWrap="wrap" bg="rgba(0,0,0,0.6)" borderRadius="md" p={1} mt={3}>
              {legendItems.map((entry) => {
                const LegendComponent = entry.isColorWheel ? ColorWheelLegendItem : LegendItem;
                return (
                  <LegendComponent
                    key={entry.dataKey}
                    entry={entry}
                    isVisible={visibleLines[entry.dataKey]}
                    onClick={() => handleLegendClick(entry.dataKey)}
                  />
                );
              })}
            </Flex>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Box>
  );
});

export default SentimentChartControls;