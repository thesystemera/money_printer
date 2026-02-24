import React, { memo, useState, useMemo, useCallback } from 'react';
import {
  Box, Text, Flex, Select,
  Button, ButtonGroup, Tooltip, HStack, Grid, GridItem,
  Slider, SliderTrack, SliderFilledTrack, SliderThumb, SliderMark,
  Accordion, AccordionItem, AccordionButton, AccordionPanel, AccordionIcon,
  Switch
} from '@chakra-ui/react';
import { RefreshCw, ChevronLeft, ChevronRight, Lock, Unlock } from 'lucide-react';
import { LegendItem, ColorWheelLegendItem } from './SentimentChartComponents';
import {
  TIME_WINDOW_OPTIONS,
  MARKET_INDICES,
  RESOLUTION_OPTIONS,
  UI_ANIMATIONS,
  DEFAULT_TEMPORAL_PARAMETERS,
  DEFAULT_SENTIMENT_WEIGHTS
} from '../config/Config';

const TemporalSlider = memo(({
  min, max, step, value, onChange, marks, colorScheme, label, description, suffix = "", isInteractive = true
}) => (
  <Box mb={4} position="relative" zIndex={isInteractive ? 3 : 1}>
    <Flex justify="space-between" mb={1}>
      <Text fontSize="xs">{label}: {value}{suffix}</Text>
      <Text fontSize="xs">{description}</Text>
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

const createSliderMarks = (range, step, showAll = false) => {
  const marks = [];
  for (let i = 0; i <= range; i++) {
    const value = i * step;
    marks.push(
      <SliderMark
        key={`mark-${value}`}
        value={value}
        mt={2}
        ml={-2.5}
        fontSize="xs"
        color="gray.500"
      >
        {showAll || i % (range / 4) === 0 ? value.toFixed(step < 1 ? 1 : 0) : ""}
      </SliderMark>
    );
  }
  return marks;
};

const getWeightDescription = (weight) => {
  return weight === 0 ? '(Muted)' :
         weight < 1 ? '(Reduced)' :
         weight > 1 ? '(Amplified)' : '(Normal)';
};

const getShiftDescription = (shift) => {
  return shift === 0 ? '(No shift)' : shift > 0 ? '(Forward)' : '(Backward)';
};

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

const MasterWeightsControl = memo(({ masterWeights, onMasterWeightChange }) => {
  const weightMarks = useMemo(() => [0, 0.5, 1, 1.5, 2].map(value => (
    <SliderMark key={`mark-master-${value}`} value={value} mt={2} ml={-2.5} fontSize="xs">
      {value}
    </SliderMark>
  )), []);

  return (
    <Box bg="gray.700" p={3} borderRadius="md" mt={4}>
      <Text fontSize="xs" fontWeight="bold" mb={3}>Master Temporal Line Composition</Text>
      <Grid templateColumns="repeat(3, 1fr)" gap={6}>
        <TemporalSlider
          min={0} max={2} step={0.1} value={masterWeights.stock}
          onChange={(val) => onMasterWeightChange('stock', val)}
          marks={weightMarks} colorScheme="blue" label="Stock Weight" suffix="x"
        />
        <TemporalSlider
          min={0} max={2} step={0.1} value={masterWeights.industry}
          onChange={(val) => onMasterWeightChange('industry', val)}
          marks={weightMarks} colorScheme="green" label="Industry Weight" suffix="x"
        />
        <TemporalSlider
          min={0} max={2} step={0.1} value={masterWeights.market}
          onChange={(val) => onMasterWeightChange('market', val)}
          marks={weightMarks} colorScheme="pink" label="Market Weight" suffix="x"
        />
      </Grid>
    </Box>
  );
});

const TemporalControls = memo(({
  temporalParams, onTemporalParamChange, lockedWeights, setLockedWeights,
  lockedShifts, setLockedShifts, resetParameters, enableImpactNormalization,
  setEnableImpactNormalization, masterWeights, onMasterWeightChange
}) => {
  const weightMarks = useMemo(() => createSliderMarks(8, 0.25), []);
  const shiftMarks = useMemo(() => createSliderMarks(12, 4), []);
  const smoothingMarks = useMemo(() => [1, 5, 10, 15, 20].map(value => (
    <SliderMark key={`smoothing-${value}`} value={value} mt={2} ml={-2.5} fontSize="xs">
        {value}
    </SliderMark>
  )), []);
  const momentumMarks = useMemo(() => [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1].map(value => (
    <SliderMark
      key={`momentum-${value}`}
      value={value}
      mt={2}
      ml={-2.5}
      fontSize="xs"
      color="gray.500"
    >
      {[0, 0.5, 1].includes(value) ? value.toFixed(1) : ""}
    </SliderMark>
  )), []);

  const rollingWindowHours = temporalParams.rollingAverageWindow / (60 * 60 * 1000);

  const handleSliderChange = useCallback((param, value) => {
    let roundedValue = value;

    if (param === 'pastWeight' || param === 'futureWeight') {
      roundedValue = Math.round(value * 4) / 4;
    } else if (param === 'pastShift' || param === 'futureShift') {
      roundedValue = Math.round(value / 4) * 4;
    } else if (param === 'momentumBlend') {
      roundedValue = Math.round(value * 10) / 10;
    } else if (param === 'derivativeSmoothingWindow') {
      roundedValue = Math.round(value);
    }

    if (lockedWeights && (param === 'pastWeight' || param === 'futureWeight')) {
      onTemporalParamChange('pastWeight', roundedValue);
      onTemporalParamChange('futureWeight', roundedValue);
    } else if (lockedShifts && (param === 'pastShift' || param === 'futureShift')) {
      onTemporalParamChange('pastShift', roundedValue);
      onTemporalParamChange('futureShift', roundedValue);
    } else {
      onTemporalParamChange(param, roundedValue);
    }
  }, [onTemporalParamChange, lockedWeights, lockedShifts]);

  return (
    <Accordion allowToggle defaultIndex={[0]} mt={3}>
      <AccordionItem border="0">
        <Flex align="center" bg="gray.800" borderRadius="md">
          <AccordionButton flex="1" py={2} mr={1}>
            <Box flex="1" textAlign="left">
              <Text fontSize="xs" fontWeight="bold">Temporal Model Controls ({rollingWindowHours}h rolling avg)</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <Button
            size="xs"
            colorScheme="blue"
            onClick={resetParameters}
            leftIcon={<RefreshCw size={12} />}
            mr={2}
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          >
            Reset
          </Button>
        </Flex>
        <AccordionPanel bg="gray.800" borderBottomRadius="md" p={3}>
          <Box bg="gray.700" p={3} borderRadius="md" mb={4} position="relative" zIndex={10}>
            <Text fontSize="xs" fontWeight="bold" mb={3}>Master Mix & V/A Control</Text>
            <Grid templateColumns="repeat(2, 1fr)" gap={6}>
                 <TemporalSlider
                    min={0} max={1} step={0.1} value={temporalParams.momentumBlend}
                    onChange={(val) => handleSliderChange('momentumBlend', val)}
                    marks={momentumMarks} colorScheme="orange" label="Momentum Blend"
                    description={
                        temporalParams.momentumBlend < 0.4 ? '(Impact-focused)' :
                        temporalParams.momentumBlend > 0.6 ? '(Trend-focused)' : '(Balanced)'
                    }
                />
                <TemporalSlider
                    min={1} max={20} step={1} value={temporalParams.derivativeSmoothingWindow}
                    onChange={(val) => handleSliderChange('derivativeSmoothingWindow', val)}
                    marks={smoothingMarks} colorScheme="cyan" label="V/A Smoothing Window"
                    description={
                        temporalParams.derivativeSmoothingWindow < 5 ? '(Responsive)' :
                        temporalParams.derivativeSmoothingWindow > 12 ? '(Smooth)' : '(Balanced)'
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
          </Box>
          <Grid templateColumns="repeat(2, 1fr)" gap={6}>
            <Box bg="gray.700" p={3} borderRadius="md">
              <Flex justify="space-between" align="center" mb={3}>
                <Text fontSize="xs" fontWeight="bold">Past-Focused Articles (-1.0)</Text>
                <Button
                  size="xs" variant="ghost" onClick={() => setLockedWeights(!lockedWeights)}
                  leftIcon={lockedWeights ? <Lock size={10} /> : <Unlock size={10} />}
                  transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                >
                  <Text fontSize="xs">Lock weights</Text>
                </Button>
              </Flex>
              <TemporalSlider
                min={0} max={2} step={0.25} value={temporalParams.pastWeight}
                onChange={(val) => handleSliderChange('pastWeight', val)}
                marks={weightMarks} colorScheme="blue" label="Weight Multiplier" suffix="x"
                description={getWeightDescription(temporalParams.pastWeight)}
              />
              <Flex justify="space-between" align="center" mb={3} mt={5}>
                <Text fontSize="xs" fontWeight="bold">Time Shift Settings</Text>
                <Button
                  size="xs" variant="ghost" onClick={() => setLockedShifts(!lockedShifts)}
                  leftIcon={lockedShifts ? <Lock size={10} /> : <Unlock size={10} />}
                  transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                >
                  <Text fontSize="xs">Lock shifts</Text>
                </Button>
              </Flex>
              <TemporalSlider
                min={0} max={48} step={4} value={temporalParams.pastShift}
                onChange={(val) => handleSliderChange('pastShift', val)}
                marks={shiftMarks} colorScheme="purple" label="Time Shift" suffix=" hours"
                description={getShiftDescription(temporalParams.pastShift)}
              />
            </Box>
            <Box bg="gray.700" p={3} borderRadius="md">
              <Text fontSize="xs" fontWeight="bold" mb={3}>Future-Focused Articles (+1.0)</Text>
              <TemporalSlider
                min={0} max={2} step={0.25} value={temporalParams.futureWeight}
                onChange={(val) => handleSliderChange('futureWeight', val)}
                marks={weightMarks} colorScheme="green" label="Weight Multiplier" suffix="x"
                description={getWeightDescription(temporalParams.futureWeight)}
              />
              <Text fontSize="xs" fontWeight="bold" mb={3} mt={5}>Time Shift Settings</Text>
              <TemporalSlider
                min={0} max={48} step={4} value={temporalParams.futureShift}
                onChange={(val) => handleSliderChange('futureShift', val)}
                marks={shiftMarks} colorScheme="teal" label="Time Shift" suffix=" hours"
                description={getShiftDescription(temporalParams.futureShift)}
              />
            </Box>
          </Grid>
          <MasterWeightsControl
            masterWeights={masterWeights}
            onMasterWeightChange={onMasterWeightChange}
          />
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
});

const SentimentChartControls = memo(({
  timeWindow, setTimeWindow, timezoneDisplay, setTimezoneDisplay,
  selectedMarketIndex, onMarketIndexChange, zoomToTimeWindow, moveLeft, moveRight, resetView,
  viewDomain, visibleLines, setVisibleLines, legendItems, isLoadingMarketIndices,
  dataResolutionMinutes = 15, setDataResolutionMinutes,
  temporalParams = DEFAULT_TEMPORAL_PARAMETERS,
  onTemporalParamChange, showTemporalControls = false, showControls = true,
  enableBiasNormalization = true, setEnableBiasNormalization,
  enableImpactNormalization, setEnableImpactNormalization,
  masterWeights, onMasterWeightChange,
  sourceCategoryWeights, onSourceWeightChange,
  sentimentComponentWeights, onSentimentComponentWeightChange,
  sourceCategoryCounts
}) => {
  const [lockedWeights, setLockedWeights] = useState(false);
  const [lockedShifts, setLockedShifts] = useState(false);

  const handleLegendClick = useCallback((dataKey) => {
    setVisibleLines(prev => ({...prev, [dataKey]: !prev[dataKey]}));
  }, [setVisibleLines]);

  const resetParameters = useCallback(() => {
    onTemporalParamChange('pastWeight', DEFAULT_TEMPORAL_PARAMETERS.pastWeight);
    onTemporalParamChange('futureWeight', DEFAULT_TEMPORAL_PARAMETERS.futureWeight);
    onTemporalParamChange('pastShift', DEFAULT_TEMPORAL_PARAMETERS.pastShift);
    onTemporalParamChange('futureShift', DEFAULT_TEMPORAL_PARAMETERS.futureShift);
    onTemporalParamChange('momentumBlend', DEFAULT_TEMPORAL_PARAMETERS.momentumBlend);
    onTemporalParamChange('derivativeSmoothingWindow', DEFAULT_TEMPORAL_PARAMETERS.derivativeSmoothingWindow);
  }, [onTemporalParamChange]);

  const componentWeightMarks = useMemo(() => [0, 0.5, 1, 1.5, 2].map(value => (
    <SliderMark key={`mark-comp-${value}`} value={value} mt={2} ml={-2.5} fontSize="xs">
      {value}
    </SliderMark>
  )), []);

  const timezoneOptions = useMemo(() => [
    { value: 'local', label: 'Local Time' },
    { value: 'et', label: 'Eastern (ET)' },
    { value: 'utc', label: 'UTC' }
  ], []);

  const marketIndexOptions = useMemo(() =>
    Object.entries(MARKET_INDICES.INFO).map(([key, info]) => ({ value: key, name: info.name }))
  , []);

  return (
    <Box width="100%" px={1}>
      <Accordion allowToggle defaultIndex={showControls ? [0] : []}>
        <AccordionItem border="0">
          <AccordionButton p={2} bg="gray.700" borderRadius="md">
            <Box flex="1" textAlign="left">
              <Text fontSize="sm" fontWeight="bold">Chart Controls</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel bg="gray.700" p={3}>
            <Grid
              templateColumns={{ base: "1fr", md: "1fr 1fr 1fr" }}
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
                <Flex justify="center" wrap="wrap">
                  <TimeWindowButtons zoomToTimeWindow={zoomToTimeWindow} />
                  <NavigationButtons
                    moveLeft={moveLeft}
                    moveRight={moveRight}
                    resetView={resetView}
                    viewDomain={viewDomain}
                  />
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

            <Box bg="gray.800" p={3} borderRadius="md" mt={2}>
              <Text fontSize="sm" fontWeight="bold" mb={3}>Sentiment Component Weights</Text>
              <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap={6}>
                 <TemporalSlider
                    min={0} max={2} step={0.1} value={sentimentComponentWeights.sentimentWeight}
                    onChange={(val) => onSentimentComponentWeightChange('sentimentWeight', val)}
                    marks={componentWeightMarks} colorScheme="teal" label="Sentiment Weight" suffix=" (Multiplier)"
                  />
                  <TemporalSlider
                    min={0} max={2} step={0.1} value={sentimentComponentWeights.influenceWeight}
                    onChange={(val) => onSentimentComponentWeightChange('influenceWeight', val)}
                    marks={componentWeightMarks} colorScheme="purple" label="Influence Weight"
                  />
                  <TemporalSlider
                    min={0} max={2} step={0.1} value={sentimentComponentWeights.certaintyWeight}
                    onChange={(val) => onSentimentComponentWeightChange('certaintyWeight', val)}
                    marks={componentWeightMarks} colorScheme="orange" label="Certainty Weight"
                  />
              </Grid>
            </Box>

            <Box bg="gray.800" p={3} borderRadius="md" mt={2}>
              <Text fontSize="sm" fontWeight="bold" mb={3}>Source Category Weights</Text>
              <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap={6}>
                <GridItem>
                  <TemporalSlider
                    min={0} max={2} step={0.1} value={sourceCategoryWeights.RETAIL}
                    onChange={(val) => onSourceWeightChange('RETAIL', val)}
                    marks={componentWeightMarks} colorScheme="green" label={`Retail Weight (${sourceCategoryCounts?.RETAIL || 0})`} suffix="x"
                  />
                </GridItem>
                <GridItem>
                  <TemporalSlider
                    min={0} max={2} step={0.1} value={sourceCategoryWeights.INSTITUTIONAL}
                    onChange={(val) => onSourceWeightChange('INSTITUTIONAL', val)}
                    marks={componentWeightMarks} colorScheme="yellow" label={`Institutional Weight (${sourceCategoryCounts?.INSTITUTIONAL || 0})`} suffix="x"
                  />
                </GridItem>
                <GridItem>
                  <TemporalSlider
                    min={0} max={2} step={0.1} value={sourceCategoryWeights.AMBIGUOUS}
                    onChange={(val) => onSourceWeightChange('AMBIGUOUS', val)}
                    marks={componentWeightMarks} colorScheme="gray" label={`Ambiguous Weight (${sourceCategoryCounts?.AMBIGUOUS || 0})`} suffix="x"
                  />
                </GridItem>
              </Grid>
            </Box>

            {showTemporalControls && (
              <TemporalControls
                temporalParams={temporalParams}
                onTemporalParamChange={onTemporalParamChange}
                lockedWeights={lockedWeights}
                setLockedWeights={setLockedWeights}
                lockedShifts={lockedShifts}
                setLockedShifts={setLockedShifts}
                resetParameters={resetParameters}
                enableImpactNormalization={enableImpactNormalization}
                setEnableImpactNormalization={setEnableImpactNormalization}
                masterWeights={masterWeights}
                onMasterWeightChange={onMasterWeightChange}
              />
            )}
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