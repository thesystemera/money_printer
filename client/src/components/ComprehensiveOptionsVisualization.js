import React, { useMemo, useEffect, useRef, useState } from 'react';
import { Box, Text, Flex, Grid, Badge, VStack, HStack, Heading, Alert, AlertIcon, Accordion, AccordionItem, AccordionButton, AccordionPanel, AccordionIcon, Stat, StatLabel, StatNumber, StatHelpText } from '@chakra-ui/react';
import { Line, XAxis, YAxis, CartesianGrid, Legend, ReferenceLine, ReferenceArea, ResponsiveContainer, Area, Bar, ComposedChart, Cell, ReferenceDot } from 'recharts';
import { SPACING, COMPONENT_STYLES, FORMATTERS, COLORS, CHART_DIMENSIONS, OPTIONS_CHART_STYLING } from '../config/Config';
import { getUniqueDays, calculateNiceTicks } from './ComprehensiveOptionsAnalsys';

const StandardChart = ({ data, title, badge, height, children, emptyMessage = "No data available" }) => {
  const containerStyle = {
    ...COMPONENT_STYLES.chartContainer.base,
    ...(height && { height }),
    boxShadow: OPTIONS_CHART_STYLING.effects.boxShadow,
    backdropFilter: OPTIONS_CHART_STYLING.effects.backdropFilter,
    bg: OPTIONS_CHART_STYLING.background.container
  };

  return (
    <Box {...containerStyle}>
      {(title || badge) && (
        <Flex justify="space-between" align="center" mb={SPACING.sm}>
          {title && <Text {...COMPONENT_STYLES.sectionHeader}>{title}</Text>}
          {badge}
        </Flex>
      )}
      <Box flex="1" height={height ? `calc(${height} - 35px)` : "95%"}>
        {!data || data.length === 0 ? (
          <Flex height="90%" align="center" justify="center">
            <Text color="gray.400">{emptyMessage}</Text>
          </Flex>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        )}
      </Box>
    </Box>
  );
};

const UnifiedXAxisTick = ({ x, y, payload, index, data, showDetailedTimes = false }) => {
  const { value } = payload;

  if (value && value.includes('SNAPSHOT')) {
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={10} textAnchor="end" fill={COLORS.maxPain} transform="rotate(-35)" fontWeight="bold" fontSize={OPTIONS_CHART_STYLING.text.fontSize.small}>
          SNAPSHOT
        </text>
      </g>
    );
  }

  let label;
  let fontWeight = 'bold';

  if (showDetailedTimes) {
    const isNewDay = index === 0 || !data[index - 1] || value.split(' ')[0] !== data[index - 1].date.split(' ')[0];
    label = isNewDay ? formatHistoricalXAxisLabel(value) : value.split(' ')[1]?.split('-')[0] || '';
    fontWeight = isNewDay ? 'bold' : 'normal';
  } else {
    const currentDate = value.split(' ')[0];
    const isFirstOfDay = index === 0 || (data && data[index - 1] && data[index - 1].date.split(' ')[0] !== currentDate);
    if (!isFirstOfDay) return null;
    label = formatHistoricalXAxisLabel(value);
  }

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={10} textAnchor="end" fill={OPTIONS_CHART_STYLING.text.fill} transform="rotate(-35)" fontWeight={fontWeight} fontSize={OPTIONS_CHART_STYLING.text.fontSize.small}>
        {label}
      </text>
    </g>
  );
};

const DailyResultIcon = ({ cx, cy, payload }) => {
  const { isCorrect, isPrediction, predictedDirection } = payload;
  const iconSize = isPrediction ? 40 : 20;
  const color = isCorrect ? 'rgba(46, 204, 113, 0.9)' : 'rgba(244, 67, 54, 0.9)';
  const arrowIconSize = iconSize * 0.5;
  const isBullish = predictedDirection === 1;

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <circle r={iconSize / 2 + 5} fill="rgba(0, 0, 0, 0.5)" stroke={color} strokeWidth={0.5} />
      {predictedDirection !== 0 ? (
        isBullish ? (
          <path d={`M 0 ${-arrowIconSize/2} L ${arrowIconSize/2} ${arrowIconSize/2} L ${-arrowIconSize/2} ${arrowIconSize/2} Z`} fill={color} />
        ) : (
          <path d={`M 0 ${arrowIconSize/2} L ${arrowIconSize/2} ${-arrowIconSize/2} L ${-arrowIconSize/2} ${-arrowIconSize/2} Z`} fill={color} />
        )
      ) : (
        isCorrect ? (
          <path d={`M ${-iconSize/3} 0 L ${-iconSize/8} ${iconSize/4} L ${iconSize/3} ${-iconSize/4}`} stroke={color} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        ) : (
          <path d={`M ${-iconSize/4} ${-iconSize/4} L ${iconSize/4} ${iconSize/4} M ${iconSize/4} ${-iconSize/4} L ${-iconSize/4} ${iconSize/4}`} stroke={color} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        )
      )}
    </g>
  );
};

const SentimentPriceDislocationChart = ({ data, title, height, showDetailedTimes = false, priceTicks, segmentBoundaries = [], predictionStats }) => {
  const dailyResults = useMemo(() => {
    if (!data || data.length === 0) return [];
    const groupedByDay = data.reduce((acc, item) => {
      const day = item.date.split(' ')[0];
      if (!acc[day]) acc[day] = [];
      acc[day].push(item);
      return acc;
    }, {});

    const result = Object.entries(groupedByDay).map(([_date, items]) => {
      const predictionItem = items.find(item => item.predictedDirection !== undefined);
      const isCorrect = predictionItem ? predictionItem.isCorrectPrediction : false;
      const predictedDirection = predictionItem ? predictionItem.predictedDirection : 0;
      const midIndex = Math.floor(items.length / 2);
      return { date: items[midIndex].date, isCorrect, predictedDirection };
    });

    if (result.length > 0 && predictionStats?.predictionDirection !== 'Neutral') {
      const finalResult = result[result.length - 1];
      finalResult.predictedDirection = predictionStats?.predictionDirection === 'Bullish' ? 1 : -1;
      finalResult.isCorrect = true;
      finalResult.isPrediction = true;
    }

    return result;
  }, [data, predictionStats]);

  const [hidden, setHidden] = useState({});
  const handleLegendClick = (o) => {
    if (!o || !o.dataKey) return;
    setHidden(prev => ({ ...prev, [o.dataKey]: !prev[o.dataKey] }));
  };

  return (
    <StandardChart data={data} title={title} height={height}>
      <ChartWithDayBands data={data}>
        <CartesianGrid strokeDasharray={OPTIONS_CHART_STYLING.grid.strokeDasharray} stroke={OPTIONS_CHART_STYLING.grid.stroke} vertical={true} horizontal={OPTIONS_CHART_STYLING.grid.horizontal} />
        <XAxis dataKey="date" height={OPTIONS_CHART_STYLING.dimensions.xAxisHeight} interval={0} tick={<UnifiedXAxisTick data={data} showDetailedTimes={showDetailedTimes} />} />
        <YAxis yAxisId="price" tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} orientation="left" tickFormatter={(v) => `${v.toFixed(0)}`} ticks={priceTicks} domain={priceTicks.length > 1 ? [priceTicks[0], priceTicks[priceTicks.length - 1]] : ['auto', 'auto']} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.narrow} />
        <YAxis yAxisId="sentiment" orientation="right" domain={[-2, 2]} ticks={[-2, -1, 0, 1, 2]} tickFormatter={(v) => v.toFixed(1)} tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.narrow} />
        <ReferenceLine y={0} yAxisId="sentiment" stroke={OPTIONS_CHART_STYLING.text.fill} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.neutral} strokeDasharray={OPTIONS_CHART_STYLING.strokeDashArrays.neutral} />
        <ReferenceLine y={2} yAxisId="sentiment" stroke="transparent" label={{ value: "BULLISH", position: "topRight", fill: COLORS.bullish, fontSize: OPTIONS_CHART_STYLING.text.fontSize.legend, fontWeight: "bold" }} />
        <ReferenceLine y={-2} yAxisId="sentiment" stroke="transparent" label={{ value: "BEARISH", position: "bottomRight", fill: COLORS.bearish, fontSize: OPTIONS_CHART_STYLING.text.fontSize.legend, fontWeight: "bold" }} />
        {segmentBoundaries.map((boundary, index) => (
          <ReferenceLine key={`segment-${index}`} x={boundary} yAxisId="sentiment" stroke="#FFD700" strokeWidth={2} opacity={0.8} />
        ))}
        <Bar yAxisId="sentiment" dataKey="dislocation" name="Dislocation" isAnimationActive={false} hide={!!hidden['dislocation']}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.dislocationColor} />
          ))}
        </Bar>
        <Line yAxisId="price" type="monotone" dataKey="price" stroke={COLORS.stockPrice} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.line} dot={false} name="Stock Price" isAnimationActive={false} hide={!!hidden['price']} />
        {dailyResults.map((result, index) => (
          <ReferenceDot key={`result-${index}`} x={result.date} y={0} yAxisId="sentiment" shape={<DailyResultIcon payload={result} />} isFront={true} />
        ))}
        <Legend wrapperStyle={{ paddingTop: '8px' }} iconType="line" onClick={handleLegendClick} formatter={(value) => {
          if (value === 'Dislocation') {
            return (
              <span style={{ color: OPTIONS_CHART_STYLING.text.fill }}>
                <span style={{ color: '#4CAF50' }}>● </span>
                <span style={{ color: '#F44336' }}>● </span> Dislocation
              </span>
            );
          }
          return <span style={{ color: OPTIONS_CHART_STYLING.text.fill }}>{value}</span>;
        }} />
      </ChartWithDayBands>
    </StandardChart>
  );
};

const MetricBadge = ({ type, value, label, ...props }) => {
  let colorScheme = 'gray';
  let boxShadow = '';
  if (type === 'sentiment') {
    const sentiment = FORMATTERS.sentiment(value);
    colorScheme = sentiment === 'bullish' ? 'green' : sentiment === 'bearish' ? 'red' : 'blue';
    boxShadow = sentiment === 'bullish' ? OPTIONS_CHART_STYLING.effects.glowGreen : sentiment === 'bearish' ? OPTIONS_CHART_STYLING.effects.glowRed : OPTIONS_CHART_STYLING.effects.glowBlue;
  } else if (type === 'quality') {
    const quality = FORMATTERS.dataQuality(value);
    colorScheme = quality.color;
  } else if (type === 'ratio') {
    if (value < 0.8) colorScheme = 'green';
    else if (value > 1.2) colorScheme = 'red';
    else colorScheme = 'blue';
  }
  return (
    <Badge colorScheme={colorScheme} boxShadow={boxShadow} transition="all 0.3s ease" {...props}>
      {label || value}
    </Badge>
  );
};

const SentimentGauge = ({ score, width = 150, height = 20 }) => {
  const radius = height / 2;
  const normalizedScore = Math.max(-1, Math.min(1, score));
  const position = ((normalizedScore + 1) / 2) * width;
  return (
    <Flex direction="column" align="center" width={`${width}px`}>
      <Box position="relative" width={`${width}px`} height={`${height}px`}>
        <Box bg="linear-gradient(90deg, #F44336 0%, #FF6B6B 15%, #FFC107 45%, #FFD93D 55%, #4CAF50 85%, #6BCF7F 100%)" height="100%" width="100%" borderRadius={`${radius}px`} boxShadow="inset 0 2px 4px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)" />
        <Box position="absolute" left={`${position}px`} top="50%" width={`${radius * 2.5}px`} height={`${radius * 2.5}px`} borderRadius="50%" border="3px solid white" bg="black" transform="translate(-50%, -50%)" boxShadow={OPTIONS_CHART_STYLING.effects.glowWhite} transition="all 0.3s ease" />
      </Box>
      <Text mt={1} fontSize="xs" fontWeight="bold" color={normalizedScore > 0.1 ? COLORS.bullish : normalizedScore < -0.1 ? COLORS.bearish : COLORS.neutral}>
        {score.toFixed(2)}
      </Text>
    </Flex>
  );
};

const dynamicTickFormatter = (value) => {
  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (absValue >= 1000000) {
    return `${sign}${(absValue / 1000000).toFixed(absValue >= 10000000 ? 0 : 1)}M`;
  } else if (absValue >= 1000) {
    return `${sign}${(absValue / 1000).toFixed(0)}K`;
  }
  return value.toFixed(0);
};

const createCurrentPriceRef = (currentPrice, yAxisId = "gamma") =>
  currentPrice && currentPrice > 0 ? (
    <ReferenceLine x={currentPrice} yAxisId={yAxisId} stroke={COLORS.stockPrice} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.reference} strokeDasharray={OPTIONS_CHART_STYLING.strokeDashArrays.reference} label={{ value: `$${currentPrice.toFixed(0)}`, position: 'top', fill: COLORS.stockPrice, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axisLabel, fontWeight: 'bold', style: { textShadow: '0 0 4px rgba(0,0,0,0.8)' } }} />
  ) : null;

const createKeyLevelRefs = (keyLevels, maxPain, yAxisId = "gamma") => {
  const refs = [];
  keyLevels.filter(level => level.strength === 'strong').slice(0, 6).forEach((level, i) => {
    refs.push(
      <ReferenceLine key={`level-${i}`} x={level.price} yAxisId={yAxisId} stroke={level.type === 'support' ? COLORS.support : COLORS.resistance} strokeDasharray={level.type === 'support' ? OPTIONS_CHART_STYLING.strokeDashArrays.support : OPTIONS_CHART_STYLING.strokeDashArrays.resistance} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.support} opacity={OPTIONS_CHART_STYLING.opacities.support} label={{ value: `${level.type === 'support' ? 'S' : 'R'} ${level.price}` , position: level.type === 'support' ? 'bottomLeft' : 'topLeft', fill: level.type === 'support' ? COLORS.support : COLORS.resistance, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis, fontWeight: 'bold', style: { textShadow: '0 0 3px rgba(0,0,0,0.8)' } }} />
    );
  });
  if (maxPain?.price) {
    refs.push(
      <ReferenceLine key="maxpain" x={maxPain.price} yAxisId={yAxisId} stroke={COLORS.maxPain} strokeDasharray={OPTIONS_CHART_STYLING.strokeDashArrays.maxPain} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.maxPain} opacity={OPTIONS_CHART_STYLING.opacities.maxPain} label={{ value: `MP ${maxPain.price.toFixed(0)}`, position: 'topRight', fill: COLORS.maxPain, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis, fontWeight: 'bold', style: { textShadow: '0 0 3px rgba(0,0,0,0.8)' } }} />
    );
  }
  return refs;
};

const createDayBands = (data) => {
  if (!data || data.length === 0) return [];
  const boundaries = extractDayBoundaries(data);
  if (boundaries.length === 0) return [];
  const areas = [];
  for (let i = 0; i < boundaries.length; i++) {
    if (i % 2 === 0) {
      const start = boundaries[i];
      const end = boundaries[i + 1] || data[data.length - 1].date;
      areas.push(
        <ReferenceArea key={`day-band-${start}`} x1={start} x2={end} yAxisId="sentiment" fill="rgba(255, 255, 255, 0.08)" fillOpacity={1} stroke="none" ifOverflow="hidden" />
      );
    }
  }
  const snapshotIndex = data.findIndex(item => item.isSnapshot);
  if (snapshotIndex > 0) {
    const gradientStart = Math.max(0, snapshotIndex - 13);
    const startDate = data[gradientStart].date;
    const endDate = data[data.length - 1].date;
    areas.push(
      <defs key="snapshot-defs">
        <linearGradient id="snapshotFadeGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255, 165, 0, 0)" />
          <stop offset="100%" stopColor="rgba(255, 165, 0, 0.2)" />
        </linearGradient>
      </defs>
    );
    areas.push(
      <ReferenceArea key="snapshot-gradient" x1={startDate} x2={endDate} yAxisId="sentiment" fill="url(#snapshotFadeGradient)" fillOpacity={1} stroke="none" ifOverflow="hidden" />
    );
  }
  return areas;
};

const extractDayBoundaries = (data) => {
  if (!data || data.length === 0) return [];
  const boundaries = [];
  let currentDay = null;
  data.forEach((item) => {
    const day = item.date.split(' ')[0];
    if (day !== currentDay) {
      boundaries.push(item.date);
      currentDay = day;
    }
  });
  return boundaries;
};

const ChartWithDayBands = ({ data, children }) => (
  <ResponsiveContainer width="100%" height="100%">
    <ComposedChart data={data} style={{ backgroundColor: OPTIONS_CHART_STYLING.background.chart }}>
      {createDayBands(data)}
      {children}
    </ComposedChart>
  </ResponsiveContainer>
);

const formatHistoricalXAxisLabel = (dateStr) => {
  try {
    const date = new Date(dateStr.split(' ')[0]);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dayNames[date.getUTCDay()];
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return `${dayName} ${month}/${day}`;
  } catch {
    return dateStr.slice(5, 10);
  }
};

const createSentimentGradients = (data, suffix = "") => (
  <defs>
    <linearGradient id={`masterSignalGradient${suffix}`} x1="0" y1="0" x2="1" y2="0">
      {data.map((item, index) => {
        const offset = `${(index / Math.max(1, data.length - 1)) * 100}%`;
        const value = item.blendedSentiment || 0;
        const color = value > 0.05 ? (COLORS.masterSignalBullish || '#00BFFF') : value < -0.05 ? (COLORS.masterSignalBearish || '#FF4500') : (COLORS.masterSignalNeutral || '#FFFFFF');
        const opacity = Math.min(1, 0.6 + Math.abs(value));
        return <stop key={index} offset={offset} stopColor={color} stopOpacity={opacity} />;
      })}
    </linearGradient>
    <linearGradient id={`volumeGradient${suffix}`} x1="0" y1="0" x2="1" y2="0">
      {data.map((item, index) => {
        const offset = `${(index / Math.max(1, data.length - 1)) * 100}%`;
        const momentum = item.volumeMomentum || 0;
        const color = momentum > 0 ? COLORS.volumeBullish : momentum < 0 ? COLORS.volumeBearish : COLORS.neutral;
        const opacity = Math.min(1, 0.6 + Math.abs(momentum) * 3);
        return <stop key={index} offset={offset} stopColor={color} stopOpacity={opacity} />;
      })}
    </linearGradient>
    <linearGradient id={`premiumGradient${suffix}`} x1="0" y1="0" x2="1" y2="0">
      {data.map((item, index) => {
        const offset = `${(index / Math.max(1, data.length - 1)) * 100}%`;
        const momentum = item.premiumMomentum || 0;
        const color = momentum > 0 ? COLORS.bullish : momentum < 0 ? COLORS.bearish : COLORS.neutral;
        const opacity = Math.min(1, 0.6 + Math.abs(momentum) * 3);
        return <stop key={index} offset={offset} stopColor={color} stopOpacity={opacity} />;
      })}
    </linearGradient>
    <linearGradient id={`marketStructureGradient${suffix}`} x1="0" y1="0" x2="1" y2="0">
      {data.map((item, index) => {
        const offset = `${(index / Math.max(1, data.length - 1)) * 100}%`;
        const momentum = item.marketStructureMomentum || 0;
        const color = momentum > 0 ? '#4DD0E1' : momentum < 0 ? '#FF8A65' : COLORS.neutral;
        const opacity = Math.min(1, 0.6 + Math.abs(momentum) * 2);
        return <stop key={index} offset={offset} stopColor={color} stopOpacity={opacity} />;
      })}
    </linearGradient>
    <linearGradient id={`marketStructureTrendGradient${suffix}`} x1="0" y1="0" x2="1" y2="0">
      {data.map((item, index) => {
        const offset = `${(index / Math.max(1, data.length - 1)) * 100}%`;
        const momentum = item.marketStructureTrendMomentum || 0;
        const color = momentum > 0 ? '#80D8FF' : momentum < 0 ? '#FF7043' : COLORS.neutral;
        return <stop key={index} offset={offset} stopColor={color} stopOpacity={0.9} />;
      })}
    </linearGradient>
    <linearGradient id={`premiumTrendGradient${suffix}`} x1="0" y1="0" x2="1" y2="0">
      {data.map((item, index) => {
        const offset = `${(index / Math.max(1, data.length - 1)) * 100}%`;
        const momentum = item.premiumTrendMomentum || 0;
        const color = momentum > 0 ? COLORS.bullish : momentum < 0 ? COLORS.bearish : COLORS.neutral;
        return <stop key={index} offset={offset} stopColor={color} stopOpacity={1} />;
      })}
    </linearGradient>
    <linearGradient id={`volumeTrendGradient${suffix}`} x1="0" y1="0" x2="1" y2="0">
      {data.map((item, index) => {
        const offset = `${(index / Math.max(1, data.length - 1)) * 100}%`;
        const momentum = item.volumeTrendMomentum || 0;
        const color = momentum > 0 ? COLORS.volumeBullish : momentum < 0 ? COLORS.volumeBearish : COLORS.neutral;
        return <stop key={index} offset={offset} stopColor={color} stopOpacity={1} />;
      })}
    </linearGradient>
    <linearGradient id={`combinedTrendGradient${suffix}`} x1="0" y1="0" x2="1" y2="0">
      {data.map((item, index) => {
        const offset = `${(index / Math.max(1, data.length - 1)) * 100}%`;
        const momentum = item.combinedTrendMomentum || 0;
        const color = momentum > 0 ? '#FFD700' : momentum < 0 ? '#8A2BE2' : '#A0A0A0';
        const intensity = Math.min(1, 0.8 + Math.abs(momentum) * 2);
        return <stop key={index} offset={offset} stopColor={color} stopOpacity={intensity} />;
      })}
    </linearGradient>
  </defs>
);

const renderSentimentLines = (suffix = "", visibility = {}) => (
  <>
    <Line yAxisId="sentiment" type="monotone" dataKey="volumeSentimentScore" stroke={`url(#volumeGradient${suffix})`} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.line} opacity={0.5} dot={false} name="Volume Flow" isAnimationActive={false} hide={!!visibility['volumeSentimentScore']} />
    <Line yAxisId="sentiment" type="monotone" dataKey="premiumSentimentScore" stroke={`url(#premiumGradient${suffix})`} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.lineThick} opacity={0.5} dot={false} name="Premium Flow" isAnimationActive={false} hide={!!visibility['premiumSentimentScore']} />
    <Line yAxisId="sentiment" type="monotone" dataKey="marketStructureSentimentScore" stroke={`url(#marketStructureGradient${suffix})`} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.line} strokeDasharray="3 3" opacity={0.8} dot={false} name="Market Structure" isAnimationActive={false} hide={!!visibility['marketStructureSentimentScore']} />
    <Line yAxisId="sentiment" type="monotone" dataKey="rollingVolumeTrend" stroke={`url(#volumeTrendGradient${suffix})`} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.lineThick} opacity={0.7} dot={false} name="Volume Trend (5-EMA)" isAnimationActive={false} hide={!!visibility['rollingVolumeTrend']} />
    <Line yAxisId="sentiment" type="monotone" dataKey="rollingPremiumTrend" stroke={`url(#premiumTrendGradient${suffix})`} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.lineHeavy} opacity={0.7} dot={false} name="Premium Trend (5-EMA)" isAnimationActive={false} hide={!!visibility['rollingPremiumTrend']} />
    <Line yAxisId="sentiment" type="monotone" dataKey="rollingMarketStructureTrend" stroke={`url(#marketStructureTrendGradient${suffix})`} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.lineHeavy} opacity={0.7} dot={false} name="Market Structure Trend (5-EMA)" isAnimationActive={false} hide={!!visibility['rollingMarketStructureTrend']} />
    <Line yAxisId="sentiment" type="monotone" dataKey="rollingCombinedTrend" stroke={`url(#combinedTrendGradient${suffix})`} strokeWidth={4} opacity={0.8} dot={false} name="Combined Trend (7-EMA Correlation)" isAnimationActive={false} hide={!!visibility['rollingCombinedTrend']} />
    <Line yAxisId="sentiment" type="monotone" dataKey="blendedSentiment" stroke={`url(#masterSignalGradient${suffix})`} strokeWidth={7} opacity={1} dot={false} name="Master Signal" isAnimationActive={false} hide={!!visibility['blendedSentiment']} />
    <Line yAxisId="price" type="monotone" dataKey="price" stroke={COLORS.stockPrice} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.line} dot={false} name="Stock Price" isAnimationActive={false} hide={!!visibility['price']} />
  </>
);

const OptionsVisualization = ({ optionsData, symbol, currentPrice: propCurrentPrice, captureRefs, onRenderComplete }) => {
  const topSectionRef = useRef(null);
  const tier1Ref = useRef(null);
  const tier2Ref = useRef(null);
  const [dataFullyReady, setDataFullyReady] = useState(false);
  const [chartsRendered, setChartsRendered] = useState(false);

  const [hiddenGamma, setHiddenGamma] = useState({});
  const handleLegendClickGamma = (o) => { if (!o || !o.dataKey) return; setHiddenGamma(prev => ({ ...prev, [o.dataKey]: !prev[o.dataKey] })); };

  const [hiddenVolume, setHiddenVolume] = useState({});
  const handleLegendClickVolume = (o) => { if (!o || !o.dataKey) return; setHiddenVolume(prev => ({ ...prev, [o.dataKey]: !prev[o.dataKey] })); };

  const [hiddenHist, setHiddenHist] = useState({});
  const handleLegendClickHist = (o) => { if (!o || !o.dataKey) return; setHiddenHist(prev => ({ ...prev, [o.dataKey]: !prev[o.dataKey] })); };

  const [hiddenRecent, setHiddenRecent] = useState({});
  const handleLegendClickRecent = (o) => { if (!o || !o.dataKey) return; setHiddenRecent(prev => ({ ...prev, [o.dataKey]: !prev[o.dataKey] })); };

  const [hiddenFlow, setHiddenFlow] = useState({});
  const handleLegendClickFlow = (o) => { if (!o || !o.dataKey) return; setHiddenFlow(prev => ({ ...prev, [o.dataKey]: !prev[o.dataKey] })); };

  useEffect(() => {
    if (captureRefs) {
      captureRefs.top = topSectionRef;
      captureRefs.tier1 = tier1Ref;
      captureRefs.tier2 = tier2Ref;
    }
  }, [captureRefs]);

  const extractedData = useMemo(() => {
    const tier1 = optionsData?.tier_1_current;
    const tier2 = optionsData?.tier_2_historical;
    const tier3 = optionsData?.tier_3_comparative;
    const availableSentiments = [];
    if (tier1?.volume_sentiment_score !== undefined) {
      availableSentiments.push({ type: 'volume', score: tier1.volume_sentiment_score, category: tier1.volume_sentiment_category || 'neutral', label: 'Volume' });
    }
    if (tier1?.premium_sentiment_score !== undefined) {
      availableSentiments.push({ type: 'premium', score: tier1.premium_sentiment_score, category: tier1.premium_sentiment_category || 'neutral', label: 'Premium' });
    }
    if (tier1?.market_structure_sentiment_score !== undefined) {
      availableSentiments.push({ type: 'market_structure', score: tier1.market_structure_sentiment_score, category: tier1.market_structure_sentiment_category || 'neutral', label: 'Market Structure' });
    }
    if (tier1?.oi_sentiment_score !== undefined) {
      availableSentiments.push({ type: 'oi', score: tier1.oi_sentiment_score, category: tier1.oi_sentiment_category || 'neutral', label: 'Open Interest' });
    }
    if (tier1?.delta_sentiment_score !== undefined) {
      availableSentiments.push({ type: 'delta', score: tier1.delta_sentiment_score, category: tier1.delta_sentiment_category || 'neutral', label: 'Delta' });
    }
    const totalScore = availableSentiments.reduce((acc, s) => acc + s.score, 0);
    const averageScore = availableSentiments.length > 0 ? totalScore / availableSentiments.length : 0;
    const historicalSummaryData = tier2?.summary ? {
      daysSampled: tier2.summary.days_sampled || 0,
      primaryDataSource: tier2.summary.primary_data_source || 'unknown',
      dataReliability: tier2.summary.data_reliability || 'unknown',
      hasPremiumData: tier2.summary.data_availability?.has_premium_data || tier2.summary.primary_data_source === 'premium' || false,
      premiumCoverage: tier2.summary.data_availability?.premium_data_coverage_pct || (tier2.summary.primary_data_source === 'premium' ? 100 : 0)
    } : {
      daysSampled: tier2?.data_source?.sampling_percentage ? Math.round(30 * tier2.data_source.sampling_percentage / 100) : 0,
      primaryDataSource: tier2?.data_source?.primary_source || 'unknown',
      dataReliability: tier2?.data_source?.access_level || 'unknown',
      hasPremiumData: tier2?.data_source?.capabilities?.has_premium_data || false,
      premiumCoverage: tier2?.data_source?.capabilities?.has_premium_data ? 100 : 0
    };
    return {
      currentPrice: tier1?.current_price || propCurrentPrice || 0,
      currentSentiment: { available: availableSentiments, primary: availableSentiments[0] || { score: 0, category: 'neutral', label: 'N/A' }, averageScore },
      ratios: tier1?.put_call_ratios ? {
        volume: tier1.put_call_ratios.volume_put_call_ratio || 0,
        oi: tier1.put_call_ratios.oi_put_call_ratio || 0,
        premium: tier1.put_call_ratios.premium_put_call_ratio || 0,
        deltaWeighted: tier1.put_call_ratios.delta_weighted_put_call_ratio || 0,
        callVolume: tier1.put_call_ratios.call_volume || 0,
        putVolume: tier1.put_call_ratios.put_volume || 0,
        callOI: tier1.put_call_ratios.call_oi || 0,
        putOI: tier1.put_call_ratios.put_oi || 0,
        callPremium: tier1.put_call_ratios.call_premium || 0,
        putPremium: tier1.put_call_ratios.put_premium || 0,
        isPremiumBased: (tier1?.data_source?.primary_source || 'volume') === 'premium',
        optionsStockRatio: tier1.put_call_ratios.options_stock_volume_ratio || 0
      } : {},
      gammaExposure: tier1?.gamma_exposure?.gamma_metrics ? {
        net: tier1.gamma_exposure.gamma_metrics.net_gamma_exposure || 0,
        isLong: tier1.gamma_exposure.gamma_metrics.dealer_positioning?.long_gamma || false,
        volatility: tier1.gamma_exposure.gamma_metrics.dealer_positioning?.expected_volatility || 'unknown'
      } : { net: 0, isLong: false, volatility: 'unknown' },
      dataQuality: tier1?.data_source ? {
        primarySource: tier1.data_source.primary_source || 'unknown',
        reliability: tier1.data_source.access_level || 'unknown',
        primaryMetrics: tier1.data_source.primary_metrics || []
      } : { primarySource: 'unknown', reliability: 'unknown', primaryMetrics: [] },
      analysisScope: tier1?.distribution ? { totalContracts: tier1.distribution.total_contracts || 0 } : { totalContracts: 0 },
      volumePercentile: tier3?.historical_context?.volume_percentile || 0,
      keyLevels: tier1?.distribution?.key_levels?.levels || [],
      maxPain: tier1?.distribution?.max_pain || null,
      volatilityAnalysis: tier3?.volatility_analysis ? {
        impliedVol: tier3.volatility_analysis.current_implied_volatility || 0,
        realizedVol: tier3.volatility_analysis.current_realized_volatility || 0,
        avgHistoricalRv: tier3.volatility_analysis.average_historical_rv || 0,
        rvPercentile: tier3.volatility_analysis.rv_percentile || 0,
        volPremium: tier3.volatility_analysis.volatility_premium || 0,
        ivRvRatio: tier3.volatility_analysis.iv_rv_ratio || 0,
        volRegime: tier3.volatility_analysis.volatility_regime || 'unknown',
        interpretation: tier3.volatility_analysis.interpretation || '',
        hasData: true
      } : { hasData: false, volRegime: 'unknown', interpretation: '' },
      smartMoney: tier3?.smart_money_analysis ? {
        totalSignals: tier3.smart_money_analysis.summary?.total_signals || 0,
        flowBias: tier3.smart_money_analysis.summary?.flow_bias || 'unknown',
        dominantStrategy: tier3.smart_money_analysis.summary?.dominant_strategy || 'unknown',
        signals: tier3.smart_money_analysis.signals || {},
        detailedSignals: tier3.smart_money_analysis.signals ? Object.values(tier3.smart_money_analysis.signals).flat() : [],
        hasData: true
      } : { hasData: false, flowBias: 'unknown', dominantStrategy: 'unknown', signals: {}, detailedSignals: [] },
      historicalContext: tier3?.historical_context ? {
        currentVsMedian: tier3.historical_context.activity_level || 'N/A',
        medianPcRatio: tier3.historical_context.median_pc_ratio || 0,
        daysAnalyzed: tier3.historical_context.days_analyzed || 0,
        samplingPercentage: tier3.historical_context.sampling_percentage || 0,
        comparisonType: tier3.historical_context.comparison_type || 'N/A',
        hasData: true
      } : { hasData: false, currentVsMedian: 'N/A', comparisonType: 'N/A' },
      historicalSummary: historicalSummaryData,
      analysisNote: tier1?.data_source?.analysis_note || "Analysis context not available."
    };
  }, [optionsData, propCurrentPrice]);

  const { currentPrice, currentSentiment, ratios, gammaExposure, dataQuality, analysisScope, keyLevels, maxPain, volatilityAnalysis, historicalSummary, analysisNote } = extractedData;

  const nearestExpiry = useMemo(() => {
    const expirations = optionsData?.tier_1_current?.active_contracts;
    if (!expirations) return null;
    const expirationKeys = Object.keys(expirations).sort();
    return expirationKeys.length > 0 ? expirationKeys[0] : null;
  }, [optionsData]);

  const strikeData = useMemo(() => {
    const gammaByStrike = optionsData?.tier_1_current?.gamma_exposure?.gamma_metrics?.gamma_by_strike;
    const volatilitySkew = optionsData?.tier_1_current?.distribution?.volatility_skew?.expirations?.[nearestExpiry];
    if (!gammaByStrike || !currentPrice || currentPrice <= 0) return [];
    return gammaByStrike
      .filter(item => item.strike >= currentPrice * 0.7 && item.strike <= currentPrice * 1.3)
      .map(item => {
        const skewData = volatilitySkew && item.strike === Math.round(item.strike) ? { iv: volatilitySkew.atm_call_iv || 0 } : { iv: 0 };
        return { strike: item.strike, callGamma: item.call_gamma || 0, putGamma: item.put_gamma || 0, netGamma: item.net_gamma || 0, impliedVol: skewData.iv * 100 };
      })
      .sort((a, b) => a.strike - b.strike);
  }, [optionsData, currentPrice, nearestExpiry]);

  const volumeData = useMemo(() => {
    const expirations = optionsData?.tier_1_current?.active_contracts;
    if (!nearestExpiry || !expirations?.[nearestExpiry] || !currentPrice || currentPrice <= 0) return [];
    const expiryData = expirations[nearestExpiry];
    const calls = expiryData.calls || [];
    const puts = expiryData.puts || [];
    const volumeByStrike = {};
    [...calls, ...puts].forEach(contract => {
      const strike = contract.strike;
      if (!volumeByStrike[strike]) {
        volumeByStrike[strike] = { strike, callVolume: 0, putVolume: 0, callOI: 0, putOI: 0, netVolume: 0, volumeRatio: 0 };
      }
      if (calls.includes(contract)) {
        volumeByStrike[strike].callVolume = contract.volume || 0;
        volumeByStrike[strike].callOI = contract.open_interest || 0;
      } else {
        volumeByStrike[strike].putVolume = contract.volume || 0;
        volumeByStrike[strike].putOI = contract.open_interest || 0;
      }
      volumeByStrike[strike].netVolume = volumeByStrike[strike].callVolume - volumeByStrike[strike].putVolume;
      volumeByStrike[strike].volumeRatio = volumeByStrike[strike].callVolume > 0 ? volumeByStrike[strike].putVolume / volumeByStrike[strike].callVolume : 0;
    });
    return Object.values(volumeByStrike)
      .filter(item => item.strike >= currentPrice * 0.7 && item.strike <= currentPrice * 1.3)
      .sort((a, b) => a.strike - b.strike);
  }, [optionsData, nearestExpiry, currentPrice]);

  const advancedAnalysis = useMemo(() => optionsData?.tier_2_historical?.advanced_analysis, [optionsData]);
  const predictionStats = useMemo(() => {
    const defaults = { closeToClose: {}, intradaySlope: {} };
    const fromAPI = advancedAnalysis?.prediction_stats;
    return { ...defaults, ...fromAPI };
  }, [advancedAnalysis]);

  const enhancedTrendData = useMemo(() => advancedAnalysis?.enhanced_trend_data || [], [advancedAnalysis]);
  const dailyAggregates = useMemo(() => advancedAnalysis?.daily_aggregates || [], [advancedAnalysis]);
  const intradaySlopeBias = useMemo(() => advancedAnalysis?.optimal_bias?.intradaySlope || 0, [advancedAnalysis]);
  const bestParams = useMemo(() => advancedAnalysis?.best_params || {}, [advancedAnalysis]);
  const optimalWeights = useMemo(() => advancedAnalysis?.optimal_weights || {}, [advancedAnalysis]);

  const dataWithPredictions = useMemo(() => {
    if (!dailyAggregates || dailyAggregates.length === 0 || !enhancedTrendData) return enhancedTrendData;

    const predictionsMap = new Map();
    for (let i = 0; i < dailyAggregates.length - 1; i++) {
        const day = dailyAggregates[i];
        const correctedMeanDislocation = day.meanDislocation + intradaySlopeBias;
        const predictedDirection = Math.sign(correctedMeanDislocation);
        const actualDirection = Math.sign(day.nextDayIntradaySlope);

        if (predictedDirection !== 0 && actualDirection !== 0) {
            predictionsMap.set(day.date, {
                isCorrect: predictedDirection === actualDirection,
                predictedDirection: predictedDirection
            });
        }
    }

    return enhancedTrendData.map(item => {
        const day = item.date.split(' ')[0];
        const prediction = predictionsMap.get(day);

        const dislocation = item.dislocation + intradaySlopeBias;
        const opacity = Math.min(1, 0.2 + Math.abs(dislocation) / 2);
        const dislocationColor = dislocation > 0 ? `rgba(76, 175, 80, ${opacity})` : `rgba(244, 67, 54, ${opacity})`;

        return {
            ...item,
            isCorrectPrediction: prediction ? prediction.isCorrect : undefined,
            predictedDirection: prediction ? prediction.predictedDirection : undefined,
            dislocation,
            dislocationColor
        };
    });
  }, [enhancedTrendData, dailyAggregates, intradaySlopeBias]);

  const segmentBoundaries = useMemo(() => {
    if (!enhancedTrendData || !bestParams.lookaroundWindow) return [];
    return [];
  }, [enhancedTrendData, bestParams]);

  const priceTicks = useMemo(() => calculateNiceTicks(enhancedTrendData, 'price', false, 6), [enhancedTrendData]);
  const threeDayData = useMemo(() => dataWithPredictions.slice(-72), [dataWithPredictions]);
  const callPutFlowData = useMemo(() => enhancedTrendData.slice(-40), [enhancedTrendData]);
  const historicalDaysCount = useMemo(() => getUniqueDays(enhancedTrendData), [enhancedTrendData]);
  const recentDaysCount = useMemo(() => getUniqueDays(threeDayData), [threeDayData]);
  const callPutFlowDays = useMemo(() => getUniqueDays(callPutFlowData), [callPutFlowData]);

  const blendWeights = useMemo(() => {
      const blend = bestParams.sentimentBlend;
      if (!blend) return [];
      const weights = [
          { label: 'Volume Flow', value: blend.volumeSentimentScore },
          { label: 'Premium Flow', value: blend.premiumSentimentScore },
          { label: 'Market Structure', value: blend.marketStructureSentimentScore },
          { label: 'Volume Trend', value: blend.rollingVolumeTrend },
          { label: 'Premium Trend', value: blend.rollingPremiumTrend },
      ];
      return weights.filter(w => w.value !== undefined && w.value > 0.001);
  }, [bestParams.sentimentBlend]);

  useEffect(() => {
    const isDataReady = strikeData.length > 0 && volumeData.length > 0 && enhancedTrendData.length > 0 && dailyAggregates.length > 0;
    setDataFullyReady(isDataReady);
  }, [strikeData, volumeData, enhancedTrendData, dailyAggregates]);

  useEffect(() => {
    if (dataFullyReady && !chartsRendered) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setChartsRendered(true);
        });
      });
    }
  }, [dataFullyReady, chartsRendered]);

  useEffect(() => {
    if (dataFullyReady && chartsRendered && onRenderComplete) {
      const timer = setTimeout(() => {
        onRenderComplete();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [dataFullyReady, chartsRendered, onRenderComplete]);

  useEffect(() => {
    setDataFullyReady(false);
    setChartsRendered(false);
  }, [symbol]);

  const gammaTicks = useMemo(() => {
    if (strikeData.length === 0) return [];
    const allGammaValues = strikeData.flatMap(d => [d.callGamma, d.putGamma, d.netGamma]);
    const maxAbs = Math.max(...allGammaValues.map(Math.abs));
    const baseTicks = calculateNiceTicks(allGammaValues, '', false, 8);
    const interval = (baseTicks[1] - baseTicks[0]) || 1;
    const ticks = [];
    for (let tick = -Math.ceil(maxAbs / interval) * interval; tick <= Math.ceil(maxAbs / interval) * interval; tick += interval) {
      if (Math.abs(tick) < 0.001 && tick !== 0) continue;
      ticks.push(tick);
    }
    return ticks;
  }, [strikeData]);

  if (!optionsData || !extractedData.currentPrice) {
    return (
      <Flex height="400px" align="center" justify="center">
        <Text color="gray.400">Loading options data...</Text>
      </Flex>
    );
  }

  return (
    <Box w="100%">
      <Box ref={topSectionRef} p={4}>
        <VStack spacing={SPACING.lg} align="stretch">
          <Box>
            <Flex justify="space-between" align="center" mb={SPACING.sm}>
              <Text {...COMPONENT_STYLES.sectionHeader}>Sentiment Overview</Text>
              <Badge colorScheme={currentSentiment.primary.category === 'bullish' ? 'green' : currentSentiment.primary.category === 'bearish' ? 'red' : 'blue'} variant="subtle">Multi-Factor</Badge>
            </Flex>
            {analysisNote && (
              <Alert status="info" variant="subtle" borderRadius="md" mb={SPACING.md} fontSize="xs" bg="rgba(45, 55, 72, 0.5)" borderColor={COLORS.neutral} borderWidth="1px">
                <AlertIcon color={COLORS.neutral} />
                {analysisNote}
              </Alert>
            )}
            <Grid templateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap={SPACING.md}>
              {currentSentiment.available.map((sentiment, i) => (
                <VStack key={i} spacing={1}>
                  <Text fontSize="sm" color="gray.300" fontWeight="medium">{sentiment.label}</Text>
                  <SentimentGauge score={sentiment.score} width={150} height={18} />
                </VStack>
              ))}
              {currentSentiment.available.length > 1 && (
                <VStack spacing={1}>
                  <Text fontSize="sm" color="gray.300" fontWeight="bold">OVERALL</Text>
                  <SentimentGauge score={currentSentiment.averageScore} width={150} height={18} />
                </VStack>
              )}
            </Grid>
          </Box>
        </VStack>
      </Box>

      <Box ref={tier1Ref} p={4}>
        <Flex justify="space-between" align="center" mb={SPACING.md} mt={SPACING.xl}>
          <Heading size="sm" color="white">Tier 1 - Current Options Data</Heading>
          <Flex gap={SPACING.sm} flexWrap="wrap">
            <MetricBadge type="quality" value={dataQuality.primarySource} label={`${dataQuality.primarySource} based`} />
            <MetricBadge type="quality" value={dataQuality.reliability} label={`${dataQuality.reliability} quality`} />
            <Badge colorScheme="blue" variant="outline">{analysisScope.totalContracts} contracts</Badge>
            {currentSentiment.averageScore !== 0 && (
              <MetricBadge type="sentiment" value={currentSentiment.averageScore} label={`SENTIMENT: ${currentSentiment.averageScore.toFixed(2)}`} />
            )}
          </Flex>
        </Flex>
        <VStack spacing={SPACING.lg}>
          <StandardChart data={strikeData} title="Gamma Exposure by Strike" height={CHART_DIMENSIONS.standard.height} badge={
            <HStack spacing={2}>
              <MetricBadge type="sentiment" value={gammaExposure.isLong ? 1 : -1} label={`Net: ${FORMATTERS.number(gammaExposure.net)}`} />
              {volatilityAnalysis.hasData && (
                <Badge colorScheme="purple" variant="subtle">IV: {volatilityAnalysis.impliedVol.toFixed(1)}%</Badge>
              )}
            </HStack>
          } emptyMessage="No gamma exposure data available">
            <ComposedChart data={strikeData} style={{ backgroundColor: OPTIONS_CHART_STYLING.background.chart }}>
              <defs>
                <linearGradient id="callGammaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.call} stopOpacity={OPTIONS_CHART_STYLING.opacities.areaHigh}/>
                  <stop offset="95%" stopColor={COLORS.call} stopOpacity={OPTIONS_CHART_STYLING.opacities.gradient.end}/>
                </linearGradient>
                <linearGradient id="putGammaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.put} stopOpacity={OPTIONS_CHART_STYLING.opacities.gradient.end}/>
                  <stop offset="95%" stopColor={COLORS.put} stopOpacity={OPTIONS_CHART_STYLING.opacities.areaHigh}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray={OPTIONS_CHART_STYLING.grid.strokeDasharray} stroke={OPTIONS_CHART_STYLING.grid.stroke} vertical={OPTIONS_CHART_STYLING.grid.vertical} horizontal={OPTIONS_CHART_STYLING.grid.horizontal} />
              <XAxis dataKey="strike" tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} tickFormatter={(tick) => `${tick}`} domain={['dataMin', 'dataMax']} />
              <YAxis yAxisId="gamma" tickFormatter={dynamicTickFormatter} tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} ticks={gammaTicks} domain={[dataMin => Math.min(dataMin, gammaTicks[0]), dataMax => Math.max(dataMax, gammaTicks[gammaTicks.length - 1])]} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.left} />
              {volatilityAnalysis.hasData && strikeData.some(d => d.impliedVol > 0) && (
                <YAxis yAxisId="iv" orientation="right" tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} tickFormatter={(v) => `${v.toFixed(0)}%`} ticks={calculateNiceTicks(strikeData, 'impliedVol', true, 5)} domain={[0, 'auto']} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.right} />
              )}
              <Area yAxisId="gamma" dataKey="callGamma" fill="url(#callGammaGradient)" stroke={COLORS.call} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.area} name="Call Gamma" isAnimationActive={false} hide={!!hiddenGamma['callGamma']} />
              <Area yAxisId="gamma" dataKey="putGamma" fill="url(#putGammaGradient)" stroke={COLORS.put} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.area} name="Put Gamma" isAnimationActive={false} hide={!!hiddenGamma['putGamma']} />
              <Line yAxisId="gamma" dataKey="netGamma" stroke={COLORS.netGamma} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.lineThick} dot={false} name="Net Gamma" isAnimationActive={false} hide={!!hiddenGamma['netGamma']} />
              {volatilityAnalysis.hasData && strikeData.some(d => d.impliedVol > 0) && (
                <Line yAxisId="iv" dataKey="impliedVol" stroke={COLORS.premium} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.line} strokeDasharray={OPTIONS_CHART_STYLING.strokeDashArrays.implied} dot={{ r: OPTIONS_CHART_STYLING.dimensions.dotRadius, fill: COLORS.premium }} name="Implied Vol %" isAnimationActive={false} hide={!!hiddenGamma['impliedVol']} />
              )}
              {createKeyLevelRefs(keyLevels, maxPain, "gamma")}
              {createCurrentPriceRef(currentPrice, "gamma")}
              <ReferenceLine y={0} yAxisId="gamma" stroke="#666" strokeDasharray={OPTIONS_CHART_STYLING.strokeDashArrays.neutral} />
              <Legend wrapperStyle={{ paddingTop: '8px' }} iconType="line" onClick={handleLegendClickGamma} formatter={(value) => <span style={{ color: OPTIONS_CHART_STYLING.text.fill }}>{value}</span>} />
            </ComposedChart>
          </StandardChart>

          <StandardChart data={volumeData} title="Volume & Open Interest Profile" height={CHART_DIMENSIONS.standard.height} badge={
            <HStack spacing={2}>
              <Badge colorScheme="blue">Expiry: {nearestExpiry || 'N/A'}</Badge>
              <Badge colorScheme="purple" variant="subtle">Total Vol: {FORMATTERS.number(ratios.callVolume + ratios.putVolume)}</Badge>
            </HStack>
          } emptyMessage="No volume data available for this expiration">
            <ComposedChart data={volumeData} style={{ backgroundColor: OPTIONS_CHART_STYLING.background.chart }}>
              <defs>
                <linearGradient id="callVolumeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.call} stopOpacity={OPTIONS_CHART_STYLING.opacities.areaHigh}/>
                  <stop offset="95%" stopColor={COLORS.call} stopOpacity={OPTIONS_CHART_STYLING.opacities.areaMedium}/>
                </linearGradient>
                <linearGradient id="putVolumeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.put} stopOpacity={OPTIONS_CHART_STYLING.opacities.areaMedium}/>
                  <stop offset="95%" stopColor={COLORS.put} stopOpacity={OPTIONS_CHART_STYLING.opacities.areaHigh}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray={OPTIONS_CHART_STYLING.grid.strokeDasharray} stroke={OPTIONS_CHART_STYLING.grid.stroke} vertical={OPTIONS_CHART_STYLING.grid.vertical} horizontal={OPTIONS_CHART_STYLING.grid.horizontal} />
              <XAxis dataKey="strike" tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} tickFormatter={(tick) => `${tick}`} domain={['dataMin', 'dataMax']} />
              <YAxis yAxisId="volume" tickFormatter={dynamicTickFormatter} tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} ticks={calculateNiceTicks(volumeData.flatMap(d => [d.callVolume, d.putVolume]), '', true, 6)} domain={[0, 'auto']} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.left} />
              <YAxis yAxisId="oi" orientation="right" tickFormatter={dynamicTickFormatter} tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} ticks={calculateNiceTicks(volumeData.flatMap(d => [d.callOI, d.putOI]), '', true, 6)} domain={[0, 'auto']} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.right} />
              <Bar yAxisId="volume" dataKey="callVolume" fill="url(#callVolumeGradient)" name="Call Volume" maxBarSize={OPTIONS_CHART_STYLING.dimensions.maxBarSize} isAnimationActive={false} hide={!!hiddenVolume['callVolume']} />
              <Bar yAxisId="volume" dataKey="putVolume" fill="url(#putVolumeGradient)" name="Put Volume" maxBarSize={OPTIONS_CHART_STYLING.dimensions.maxBarSize} isAnimationActive={false} hide={!!hiddenVolume['putVolume']} />
              <Line yAxisId="oi" dataKey="callOI" stroke={COLORS.call} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.line} dot={false} name="Call OI" strokeDasharray={OPTIONS_CHART_STYLING.strokeDashArrays.implied} isAnimationActive={false} hide={!!hiddenVolume['callOI']} />
              <Line yAxisId="oi" dataKey="putOI" stroke={COLORS.put} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.line} dot={false} name="Put OI" strokeDasharray={OPTIONS_CHART_STYLING.strokeDashArrays.implied} isAnimationActive={false} hide={!!hiddenVolume['putOI']} />
              <Line yAxisId="volume" dataKey="netVolume" stroke={COLORS.neutral} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.line} dot={false} name="Net Volume" isAnimationActive={false} hide={!!hiddenVolume['netVolume']} />
              {createCurrentPriceRef(currentPrice, "volume")}
              <Legend wrapperStyle={{ paddingTop: '8px' }} iconType="line" onClick={handleLegendClickVolume} formatter={(value) => <span style={{ color: OPTIONS_CHART_STYLING.text.fill }}>{value}</span>} />
            </ComposedChart>
          </StandardChart>
        </VStack>
      </Box>

      <Box ref={tier2Ref} p={4}>
        <Flex justify="space-between" align="center" mb={SPACING.md} mt={SPACING.xl}>
          <Heading size="sm" color="white">Tier 2 - Historical Options Flow Analysis</Heading>
          <Flex gap={SPACING.sm} flexWrap="wrap">
            <MetricBadge type="quality" value={historicalSummary.primaryDataSource} label={`${historicalSummary.primaryDataSource} based`} />
            <MetricBadge type="quality" value={historicalSummary.dataReliability} label={`${historicalSummary.dataReliability} quality`} />
            <Badge colorScheme="blue" variant="outline">{historicalDaysCount} days</Badge>
            {historicalSummary.hasPremiumData && historicalSummary.premiumCoverage > 90 && (
              <Badge colorScheme="green" variant="outline">{historicalSummary.premiumCoverage.toFixed(0)}% premium coverage</Badge>
            )}
          </Flex>
        </Flex>

        <Accordion allowToggle mb={SPACING.lg}>
          <AccordionItem border="none">
            <h2>
              <AccordionButton bg="rgba(45, 55, 72, 0.3)" _hover={{bg: "rgba(45, 55, 72, 0.5)"}} borderRadius="md">
                <Box flex="1" textAlign="left" fontWeight="bold" color="white">Model Parameters</Box>
                <AccordionIcon />
              </AccordionButton>
            </h2>
            <AccordionPanel pb={4} bg="rgba(45, 55, 72, 0.3)" borderBottomRadius="md">
              <Text fontSize="xs" color="gray.400" mb={3}>The following parameters were determined by the backend model to be optimal for analyzing this stock's historical data.</Text>
              {bestParams && (
                <Grid templateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={4}>
                  <Stat><StatLabel>Sentiment Blend</StatLabel><StatNumber fontSize="md">{bestParams.sentimentBlend?.name || 'N/A'}</StatNumber></Stat>
                  <Stat><StatLabel>Lookaround Window</StatLabel><StatNumber fontSize="md">{bestParams.lookaroundWindow || 'N/A'}</StatNumber></Stat>
                  <Stat><StatLabel>Min Segment Size</StatLabel><StatNumber fontSize="md">{bestParams.minSegmentSize || 'N/A'}</StatNumber></Stat>
                  <Stat><StatLabel>Slicing Sensitivity</StatLabel><StatNumber fontSize="md">{bestParams.slicingSensitivity?.toFixed(2) || 'N/A'}</StatNumber></Stat>
                </Grid>
              )}
              {blendWeights.length > 0 && (
                <Box mt={4} pt={4} borderTop="1px solid" borderColor="gray.700">
                  <Text fontSize="sm" fontWeight="bold" mb={2} color="gray.200">Optimal Sentiment Blend Weights</Text>
                  <Grid templateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap={3}>
                    {blendWeights.map(w => (
                      <Flex key={w.label} justify="space-between" fontSize="sm">
                        <Text color="gray.400">{w.label}:</Text>
                        <Text fontWeight="bold" color="white">{(w.value * 100).toFixed(1)}%</Text>
                      </Flex>
                    ))}
                  </Grid>
                </Box>
              )}
              {optimalWeights?.closeToClose && (
                <Box mt={4}>
                  <Text fontSize="sm" fontWeight="bold" mb={2}>Optimal Weighting Factors</Text>
                  <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                    <Box bg="rgba(76, 175, 80, 0.1)" p={2} borderRadius="md">
                      <Text fontSize="xs" color="green.300" fontWeight="bold" mb={1}>Close-to-Close</Text>
                      <Text fontSize="xs" color="gray.300">Temporal: <Text as="span" fontWeight="bold">{optimalWeights.closeToClose.temporalExponent?.toFixed(2) || 'N/A'}</Text> | Magnitude: <Text as="span" fontWeight="bold">{optimalWeights.closeToClose.magnitudeFactor?.toFixed(2) || 'N/A'}</Text></Text>
                    </Box>
                    <Box bg="rgba(244, 67, 54, 0.1)" p={2} borderRadius="md">
                      <Text fontSize="xs" color="red.300" fontWeight="bold" mb={1}>Intraday Slope</Text>
                      <Text fontSize="xs" color="gray.300">Temporal: <Text as="span" fontWeight="bold">{optimalWeights.intradaySlope.temporalExponent?.toFixed(2) || 'N/A'}</Text> | Magnitude: <Text as="span" fontWeight="bold">{optimalWeights.intradaySlope.magnitudeFactor?.toFixed(2) || 'N/A'}</Text></Text>
                    </Box>
                  </Grid>
                </Box>
              )}
            </AccordionPanel>
          </AccordionItem>
        </Accordion>

        <Grid
          templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }}
          bg="rgba(45, 55, 72, 0.3)"
          p={4}
          borderRadius="md"
          mb={SPACING.lg}
          gap={6}
        >
          <Stat>
            <StatLabel>Close-to-Close Accuracy</StatLabel>
            <StatNumber fontSize="xl" color={(predictionStats.closeToClose?.accuracy || 0) > 60 ? "green.300" : "yellow.300"}>{predictionStats.closeToClose?.accuracy?.toFixed(1) || 0}%</StatNumber>
            <StatHelpText>{predictionStats.closeToClose?.correct || 0} / {predictionStats.closeToClose?.total || 0} Correct</StatHelpText>
          </Stat>
          <Stat>
            <StatLabel>Intraday Slope Accuracy</StatLabel>
            <StatNumber fontSize="xl" color={(predictionStats.intradaySlope?.accuracy || 0) > 60 ? "green.300" : "yellow.300"}>{predictionStats.intradaySlope?.accuracy?.toFixed(1) || 0}%</StatNumber>
            <StatHelpText>{predictionStats.intradaySlope?.correct || 0} / {predictionStats.intradaySlope?.total || 0} Correct</StatHelpText>
          </Stat>
          <Stat>
            <StatLabel>Close-to-Close Prediction</StatLabel>
            <StatNumber fontSize="xl" color={predictionStats.closeToClose?.predictionDirection === 'Bullish' ? 'green.300' : predictionStats.closeToClose?.predictionDirection === 'Bearish' ? 'red.300' : 'gray.300'}>{predictionStats.closeToClose?.predictionLabel || 'Neutral'}</StatNumber>
            <StatHelpText>{predictionStats.closeToClose?.predictionDirection !== 'Neutral' && (predictionStats.closeToClose?.signalCount || 0) > 5 ? `On ${predictionStats.closeToClose?.signalCount} similar signals, this has been correct ${predictionStats.closeToClose?.concurrence?.toFixed(0) || 0}% of the time.` : 'Insufficient historical data for context.'}</StatHelpText>
          </Stat>
          <Stat>
            <StatLabel>Intraday Slope Prediction</StatLabel>
            <StatNumber fontSize="xl" color={predictionStats.intradaySlope?.predictionDirection === 'Bullish' ? 'green.300' : predictionStats.intradaySlope?.predictionDirection === 'Bearish' ? 'red.300' : 'gray.300'}>{predictionStats.intradaySlope?.predictionLabel || 'Neutral'}</StatNumber>
            <StatHelpText>{predictionStats.intradaySlope?.predictionDirection !== 'Neutral' && (predictionStats.intradaySlope?.signalCount || 0) > 5 ? `On ${predictionStats.intradaySlope?.signalCount} similar signals, this has been correct ${predictionStats.intradaySlope?.concurrence?.toFixed(0) || 0}% of the time.` : 'Insufficient historical data for context.'}</StatHelpText>
          </Stat>
        </Grid>

        <VStack spacing={SPACING.lg}>
          <StandardChart data={enhancedTrendData} title={`Historical Price & Flow Momentum Analysis - ${historicalDaysCount} Days`} height={CHART_DIMENSIONS.standard.height} emptyMessage="No historical data available">
            <ChartWithDayBands data={enhancedTrendData}>
              {createSentimentGradients(enhancedTrendData)}
              <CartesianGrid strokeDasharray={OPTIONS_CHART_STYLING.grid.strokeDasharray} stroke={OPTIONS_CHART_STYLING.grid.stroke} vertical={true} horizontal={OPTIONS_CHART_STYLING.grid.horizontal} />
              <XAxis dataKey="date" height={OPTIONS_CHART_STYLING.dimensions.xAxisHeight} interval={0} tick={<UnifiedXAxisTick data={enhancedTrendData} showDetailedTimes={false} />} />
              <YAxis yAxisId="price" tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} orientation="left" tickFormatter={(v) => `${v.toFixed(0)}`} ticks={priceTicks} domain={priceTicks.length > 1 ? [priceTicks[0], priceTicks[priceTicks.length - 1]] : ['auto', 'auto']} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.narrow} />
              <YAxis yAxisId="sentiment" orientation="right" domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} tickFormatter={(v) => v.toFixed(1)} tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.narrow} />
              {renderSentimentLines("", hiddenHist)}
              <ReferenceLine y={0} yAxisId="sentiment" stroke={OPTIONS_CHART_STYLING.text.fill} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.neutral} strokeDasharray={OPTIONS_CHART_STYLING.strokeDashArrays.neutral} />
              <ReferenceLine y={1} yAxisId="sentiment" stroke="transparent" label={{ value: "BULLISH", position: "topRight", fill: COLORS.bullish, fontSize: OPTIONS_CHART_STYLING.text.fontSize.legend, fontWeight: "bold" }} />
              <ReferenceLine y={-1} yAxisId="sentiment" stroke="transparent" label={{ value: "BEARISH", position: "bottomRight", fill: COLORS.bearish, fontSize: OPTIONS_CHART_STYLING.text.fontSize.legend, fontWeight: "bold" }} />
              <Legend wrapperStyle={{ paddingTop: '8px' }} iconType="line" onClick={handleLegendClickHist} formatter={(value) => <span style={{ color: OPTIONS_CHART_STYLING.text.fill }}>{value}</span>} />
            </ChartWithDayBands>
          </StandardChart>

          <SentimentPriceDislocationChart data={dataWithPredictions} title={`Historical Sentiment vs. Price Dislocation - ${historicalDaysCount} Days`} height={CHART_DIMENSIONS.standard.height} showDetailedTimes={false} priceTicks={priceTicks} segmentBoundaries={segmentBoundaries} predictionStats={predictionStats.intradaySlope} />

          <StandardChart data={threeDayData} title={`Recent Price & Flow Momentum Analysis - ${recentDaysCount} Days`} height={CHART_DIMENSIONS.standard.height} emptyMessage="No recent data available">
            <ChartWithDayBands data={threeDayData}>
              {createSentimentGradients(threeDayData, "3d")}
              <CartesianGrid strokeDasharray={OPTIONS_CHART_STYLING.grid.strokeDasharray} stroke={OPTIONS_CHART_STYLING.grid.stroke} vertical={true} horizontal={OPTIONS_CHART_STYLING.grid.horizontal} />
              <XAxis dataKey="date" height={OPTIONS_CHART_STYLING.dimensions.xAxisHeight} interval={0} tick={<UnifiedXAxisTick data={threeDayData} showDetailedTimes={true} />} />
              <YAxis yAxisId="price" tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} orientation="left" tickFormatter={(v) => `${v.toFixed(0)}`} ticks={priceTicks} domain={priceTicks.length > 1 ? [priceTicks[0], priceTicks[priceTicks.length - 1]] : ['auto', 'auto']} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.narrow} />
              <YAxis yAxisId="sentiment" orientation="right" domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} tickFormatter={(v) => v.toFixed(1)} tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.narrow} />
              {renderSentimentLines("3d", hiddenRecent)}
              <ReferenceLine y={0} yAxisId="sentiment" stroke={OPTIONS_CHART_STYLING.text.fill} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.neutral} strokeDasharray={OPTIONS_CHART_STYLING.strokeDashArrays.neutral} />
              <ReferenceLine y={1} yAxisId="sentiment" stroke="transparent" label={{ value: "BULLISH", position: "topRight", fill: COLORS.bullish, fontSize: OPTIONS_CHART_STYLING.text.fontSize.legend, fontWeight: "bold" }} />
              <ReferenceLine y={-1} yAxisId="sentiment" stroke="transparent" label={{ value: "BEARISH", position: "bottomRight", fill: COLORS.bearish, fontSize: OPTIONS_CHART_STYLING.text.fontSize.legend, fontWeight: "bold" }} />
              <Legend wrapperStyle={{ paddingTop: '8px' }} iconType="line" onClick={handleLegendClickRecent} formatter={(value) => <span style={{ color: OPTIONS_CHART_STYLING.text.fill }}>{value}</span>} />
            </ChartWithDayBands>
          </StandardChart>

          <SentimentPriceDislocationChart data={threeDayData} title={`Recent Sentiment vs. Price Dislocation - ${recentDaysCount} Days`} height={CHART_DIMENSIONS.standard.height} showDetailedTimes={true} priceTicks={priceTicks} segmentBoundaries={segmentBoundaries.filter(boundary => threeDayData.some(item => item.date === boundary))} predictionStats={predictionStats.intradaySlope} />

          <StandardChart data={callPutFlowData} title={`Call/Put Volume Flow - Last ${callPutFlowDays} Days Detail`} height={CHART_DIMENSIONS.standard.height} emptyMessage="No volume trend data available">
            <ChartWithDayBands data={callPutFlowData}>
              <defs>
                <linearGradient id="callBarGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={COLORS.call} stopOpacity={OPTIONS_CHART_STYLING.opacities.areaHigh}/><stop offset="95%" stopColor={COLORS.call} stopOpacity={OPTIONS_CHART_STYLING.opacities.areaMedium}/></linearGradient>
                <linearGradient id="putBarGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={COLORS.put} stopOpacity={OPTIONS_CHART_STYLING.opacities.areaMedium}/><stop offset="95%" stopColor={COLORS.put} stopOpacity={OPTIONS_CHART_STYLING.opacities.areaHigh}/></linearGradient>
                <linearGradient id="netFlowGradient" x1="0" y1="0" x2="1" y2="0">
                  {callPutFlowData.map((item, index, arr) => {
                    const offset = `${(index / Math.max(1, arr.length - 1)) * 100}%`;
                    const previous = index > 0 ? arr[index - 1].netFlow : item.netFlow;
                    const momentum = item.netFlow - previous;
                    const color = momentum > 0 ? COLORS.bullish : momentum < 0 ? COLORS.bearish : COLORS.neutral;
                    const opacity = Math.min(1, 0.6 + Math.abs(momentum) / 1000);
                    return <stop key={index} offset={offset} stopColor={color} stopOpacity={opacity} />;
                  })}
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray={OPTIONS_CHART_STYLING.grid.strokeDasharray} stroke={OPTIONS_CHART_STYLING.grid.stroke} vertical={true} horizontal={OPTIONS_CHART_STYLING.grid.horizontal} />
              <XAxis dataKey="date" height={OPTIONS_CHART_STYLING.dimensions.xAxisHeight} interval={0} tick={<UnifiedXAxisTick data={callPutFlowData} showDetailedTimes={true} />} />
              <YAxis yAxisId="sentiment" orientation="right" domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} tickFormatter={(v) => v.toFixed(1)} tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.narrow} hide={true} />
              <YAxis yAxisId="price" orientation="left" tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.axis }} tickFormatter={(v) => `${v.toFixed(0)}`} ticks={priceTicks} domain={priceTicks.length > 1 ? [priceTicks[0], priceTicks[priceTicks.length - 1]] : ['auto', 'auto']} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.narrow} hide={true} />
              <YAxis yAxisId="volume" orientation="left" tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.legend }} tickFormatter={dynamicTickFormatter} ticks={calculateNiceTicks(callPutFlowData.flatMap(d => [d.callVolume, d.putVolume]), '', true, 5)} domain={[0, 'auto']} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.left} label={{ value: 'Volume', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: OPTIONS_CHART_STYLING.text.fill } }} />
              {historicalSummary.hasPremiumData && (
                <YAxis yAxisId="premium" orientation="left" tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.legend }} tickFormatter={dynamicTickFormatter} ticks={calculateNiceTicks(callPutFlowData.flatMap(d => [d.callPremium, d.putPremium]), '', true, 5)} domain={[0, 'auto']} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.left} label={{ value: 'Premium ($)', angle: -90, position: 'outside', offset: -40, style: { textAnchor: 'middle', fill: OPTIONS_CHART_STYLING.text.fill } }} />
              )}
              <Bar yAxisId="volume" dataKey="callVolume" fill="url(#callBarGradient)" name="Call Volume" maxBarSize={OPTIONS_CHART_STYLING.dimensions.maxBarSize} isAnimationActive={false} hide={!!hiddenFlow['callVolume']} />
              <Bar yAxisId="volume" dataKey="putVolume" fill="url(#putBarGradient)" name="Put Volume" maxBarSize={OPTIONS_CHART_STYLING.dimensions.maxBarSize} isAnimationActive={false} hide={!!hiddenFlow['putVolume']} />
              {historicalSummary.hasPremiumData && (
                <>
                  <Bar yAxisId="premium" dataKey="callPremium" fill="url(#callBarGradient)" name="Call Premium" maxBarSize={OPTIONS_CHART_STYLING.dimensions.maxBarSize} isAnimationActive={false} hide={!!hiddenFlow['callPremium']} />
                  <Bar yAxisId="premium" dataKey="putPremium" fill="url(#putBarGradient)" name="Put Premium" maxBarSize={OPTIONS_CHART_STYLING.dimensions.maxBarSize} isAnimationActive={false} hide={!!hiddenFlow['putPremium']} />
                </>
              )}
              <YAxis yAxisId="ratio" orientation="right" tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.legend }} tickFormatter={(v) => v.toFixed(1)} ticks={[0, 0.5, 1.0, 1.5, 2.0]} domain={[0, 'auto']} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.right} hide={true} />
              <YAxis yAxisId="netflow" orientation="right" tick={{ fill: OPTIONS_CHART_STYLING.text.fill, fontSize: OPTIONS_CHART_STYLING.text.fontSize.legend }} tickFormatter={dynamicTickFormatter} width={OPTIONS_CHART_STYLING.dimensions.axisWidth.right} hide={true} />
              <Line yAxisId="ratio" type="monotone" dataKey="volumePutCallRatio" stroke={COLORS.putCallRatio} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.line} dot={{ r: OPTIONS_CHART_STYLING.dimensions.dotRadius, fill: COLORS.putCallRatio }} name="Volume P/C" isAnimationActive={false} hide={!!hiddenFlow['volumePutCallRatio']} />
              {historicalSummary.hasPremiumData && (
                <Line yAxisId="ratio" type="monotone" dataKey="premiumPutCallRatio" stroke={COLORS.premium} strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.line} strokeDasharray={OPTIONS_CHART_STYLING.strokeDashArrays.maxPain} dot={{ r: OPTIONS_CHART_STYLING.dimensions.dotRadius, fill: COLORS.premium }} name="Premium P/C" isAnimationActive={false} hide={!!hiddenFlow['premiumPutCallRatio']} />
              )}
              <Line yAxisId="netflow" type="monotone" dataKey="netFlow" stroke="url(#netFlowGradient)" strokeWidth={OPTIONS_CHART_STYLING.strokeWidths.lineThick} dot={false} name="Net Flow" isAnimationActive={false} hide={!!hiddenFlow['netFlow']} />
              <Legend wrapperStyle={{ paddingTop: '8px' }} iconType="line" onClick={handleLegendClickFlow} formatter={(value) => <span style={{ color: OPTIONS_CHART_STYLING.text.fill }}>{value}</span>} />
            </ChartWithDayBands>
          </StandardChart>
        </VStack>
      </Box>
    </Box>
  );
};

export default OptionsVisualization;