import React, { memo, useMemo } from 'react';
import {
  Box, Text, Flex, Spinner, HStack
} from '@chakra-ui/react';
import { COLORS, MARKET_INDICES } from '../config/Config';
import { formatValue } from '../services/socketService';

export const CustomSentimentDot = memo((props) => {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload) return null;

  const minSize = 2;
  const maxSize = 6;
  const sentimentStrength = Math.abs(payload.adjustedSentiment || 0);
  const size = minSize + sentimentStrength * (maxSize - minSize);

  let fill = payload.isMarketSentiment ? COLORS.marketSentiment :
             payload.isIndustrySentiment ? COLORS.industrySentiment : COLORS.stockSentiment;

  return <circle
    cx={cx}
    cy={cy}
    r={size}
    fill={fill}
    stroke="transparent"
    opacity={0.8}
  />;
});

const formatPriceValue = (value, format = 'currency') => {
  return formatValue(value, { format });
};

const getOriginalPrice = (dataPoint) => {
  if (dataPoint.originalPrice !== undefined && dataPoint.originalPrice !== null) {
    return dataPoint.originalPrice;
  }
  return dataPoint.price;
};

const renderDataRow = (icon, label, value, color = "white") => (
  <Box display="flex" alignItems="center" mb={1}>
    <Box width="8px" height="8px" borderRadius="50%" bg={icon} mr={2} />
    <Text color="white" fontWeight="medium">
      {label}: <Text as="span" fontWeight="bold" color={color}>
        {value}
      </Text>
    </Text>
  </Box>
);

const renderSourceContributions = (sourceContributions, colorMixRatios) => {
  if (!sourceContributions) return null;

  const sourceColors = {
    stock: COLORS.stockSentiment,
    market: COLORS.marketSentiment,
    industry: COLORS.industrySentiment
  };

  return (
    <>
      <Text fontSize="xs" fontWeight="bold" mb={1} color="gray.300">Source Contributions:</Text>
      {Object.entries(sourceContributions).map(([source, contrib]) => (
        <Box key={`source-${source}`} display="flex" alignItems="center" mb={1}>
          <Box width="8px" height="8px" borderRadius="50%" bg={sourceColors[source]} mr={2} />
          <Text color="white" fontWeight="medium">
            {source.charAt(0).toUpperCase() + source.slice(1)}: <Text as="span" fontWeight="bold">
              {formatValue(contrib.sentiment)} ({contrib.articleCount} articles, {Math.round((colorMixRatios?.[source] || 0) * 100)}%)
            </Text>
          </Text>
        </Box>
      ))}
    </>
  );
};

const renderTemporalInfo = (dataPoint) => {
  const temporalFields = [
    { key: 'originalTemporalOrientation', label: 'Temporal Orientation',
      formatter: (val) => `${formatValue(val)} ${val < -0.3 ? '(Past-focused)' : val > 0.3 ? '(Future-focused)' : '(Present-focused)'}` },
    { key: 'propagationSpeed', label: 'Propagation Speed', formatter: (val) => `${val}h` },
    { key: 'impactDuration', label: 'Impact Duration', formatter: (val) => `${val}h` },
    { key: 'contributingArticlesCount', label: 'Contributing Articles', formatter: (val) => val },
    { key: 'totalArticleCount', label: 'Total Articles', formatter: (val) => val }
  ];

  return temporalFields.map(({ key, label, formatter }) => {
    if (dataPoint[key] === undefined) return null;
    return <div key={key}>{renderDataRow("", label, formatter(dataPoint[key]))}</div>;
  });
};

const renderSentimentInfo = (dataPoint) => {
  const sentimentFields = [
    { key: 'originalSentiment', label: 'Sentiment Score', icon: dataPoint.isMarketSentiment ? COLORS.marketSentiment : COLORS.stockSentiment },
    { key: 'originalInfluence', label: 'Influence Score', icon: "" },
    { key: 'certaintyScore', label: 'Certainty Score', icon: "" },
    { key: 'sourceCategory', label: 'Source Type', icon: "", formatter: (val) => val },
    { key: 'adjustedSentiment', label: 'Weighted Score', icon: dataPoint.isMarketSentiment ? COLORS.marketSentiment : COLORS.stockSentiment }
  ];

  return sentimentFields.map(({ key, label, icon, formatter }) => {
    if (dataPoint[key] === undefined) return null;
    const displayValue = formatter ? formatter(dataPoint[key]) : formatValue(dataPoint[key]);
    return <div key={key}>{renderDataRow(icon, label, displayValue)}</div>;
  });
};

export const CustomTooltip = memo(({ active, payload, label, selectedMarketIndex, isInteractiveMode = true }) => {
  const dataPoint = useMemo(() => {
    if (!payload?.length) return null;
    const firstPayloadItem = payload[0]?.payload;
    const titlePayloadItem = payload.find(p => p.payload?.title)?.payload;
    return titlePayloadItem || firstPayloadItem;
  }, [payload]);

  const marketIndexPayload = useMemo(() => {
    if (!payload?.length) return null;
    return selectedMarketIndex ?
      payload.find(p => p.name === MARKET_INDICES.INFO[selectedMarketIndex]?.name) :
      null;
  }, [payload, selectedMarketIndex]);

  if (!isInteractiveMode || !active || !payload?.length || !dataPoint) {
    return null;
  }

  const timestamp = dataPoint.timestamp || label;

  return (
    <Box
      p={3}
      bg="gray.800"
      border="1px solid #4A5568"
      borderRadius="md"
      boxShadow="lg"
      fontSize="sm"
      maxW="320px"
      color="white"
      pointerEvents="none"
    >
      <Text fontWeight="bold" mb={1}>{dataPoint.title || new Date(timestamp).toLocaleString()}</Text>
      <Text fontSize="xs" color="gray.400" mb={2}>{new Date(dataPoint.timestamp || timestamp).toLocaleString()}</Text>

      {dataPoint.marketSession && renderDataRow(
        COLORS.stockPrice,
        "Market",
        dataPoint.marketSession === 'regular' ? 'Regular Hours' :
        dataPoint.marketSession === 'pre-market' ? 'Pre-Market' :
        dataPoint.marketSession === 'after-hours' ? 'After-Hours' : 'Closed'
      )}

      {renderSourceContributions(dataPoint.sourceContributions, dataPoint.colorMixRatios)}

      {dataPoint.matchedKeyword && renderDataRow("", "Matched", dataPoint.matchedKeyword)}

      {dataPoint.isMarketSentiment && renderDataRow(COLORS.marketSentiment, "Market Sentiment", "")}

      {renderSentimentInfo(dataPoint)}
      {renderTemporalInfo(dataPoint)}

      {dataPoint.dataType === "stock" && (dataPoint.price !== undefined || dataPoint.originalPrice !== undefined) &&
        renderDataRow(COLORS.stockPrice, "Stock Price", formatPriceValue(getOriginalPrice(dataPoint)))}

      {dataPoint.dataType === "index" && (dataPoint.price !== undefined || dataPoint.originalPrice !== undefined) &&
        renderDataRow(
          MARKET_INDICES.INFO[selectedMarketIndex]?.color,
          MARKET_INDICES.INFO[selectedMarketIndex]?.name,
          formatPriceValue(getOriginalPrice(dataPoint))
        )}

      {payload.map((entry, index) => {
        if (!entry || !entry.name) return null;
        if (entry.name === MARKET_INDICES.INFO[selectedMarketIndex]?.name) return null;
        if (["Sentiment", "Weighted Sentiment", "Influence", "Stock Price", "Combined Rolling Average"].includes(entry.name)) return null;
        if (entry.value === undefined) return null;

        let displayValue = entry.value;
        if (entry.name === "Stock Price" || entry.name.includes("Price")) {
          const entryPayload = entry.payload;
          if (entryPayload && (entryPayload.originalPrice !== undefined && entryPayload.originalPrice !== null)) {
            displayValue = entryPayload.originalPrice;
          }
          return <div key={`payload-${index}-${entry.name}`}>{renderDataRow(entry.color, entry.name, formatPriceValue(displayValue))}</div>;
        }

        return <div key={`payload-${index}-${entry.name}`}>{renderDataRow(entry.color, entry.name, formatValue(displayValue))}</div>;
      })}

      {dataPoint.volume && renderDataRow(COLORS.volume, "Volume", dataPoint.volume.toLocaleString())}

      {marketIndexPayload && (marketIndexPayload.payload?.originalPrice !== undefined || marketIndexPayload.value !== undefined) && (
        <Box mt={2} pt={2} borderTop="1px solid" borderColor="gray.600">
          {renderDataRow(
            MARKET_INDICES.INFO[selectedMarketIndex]?.color,
            MARKET_INDICES.INFO[selectedMarketIndex]?.name,
            formatPriceValue(getOriginalPrice(marketIndexPayload.payload) || marketIndexPayload.value)
          )}
        </Box>
      )}
    </Box>
  );
});

export const CrossHair = memo(({ x, y, chartHeight, chartWidth, isInteractiveMode = true }) => {
  if (!isInteractiveMode || x === null || y === null) return null;

  return (
    <>
      <line
        x1={0}
        y1={y}
        x2={chartWidth}
        y2={y}
        stroke={COLORS.referenceLine}
        strokeWidth={1}
        strokeDasharray="3 3"
        pointerEvents="none"
      />
      <line
        x1={x}
        y1={0}
        x2={x}
        y2={chartHeight}
        stroke={COLORS.referenceLine}
        strokeWidth={1}
        strokeDasharray="3 3"
        pointerEvents="none"
      />
    </>
  );
});

export const PricePointDot = memo(({ cx, cy, point, colorMode, chartWidth = 800, chartHeight = 600 }) => {
  if (!cx || !cy || !point) return null;

  const dotStyles = {
    'open': { fill: COLORS.latestPrice, r: 3 },
    'close': { fill: COLORS.latestPrice, r: 3 },
    'pre-market-open': { fill: COLORS.latestPrice, r: 3 },
    'after-hours-close': { fill: COLORS.latestPrice, r: 3 },
    'latest': { fill: COLORS.latestPrice, r: 4, strokeWidth: 2 }
  };

  const dotStyle = {
    ...dotStyles[point.pointType] || { fill: '#FFFFFF', r: 3 },
    stroke: 'white',
    strokeWidth: dotStyles[point.pointType]?.strokeWidth || 1
  };

  const labelY = cy - 15;
  const labelX = cx;
  const textColor = colorMode === 'dark' ? 'white' : 'black';
  const bgColor = colorMode === 'dark' ? 'rgba(26, 32, 44, 0.8)' : 'rgba(255, 255, 255, 0.8)';
  const borderColor = colorMode === 'dark' ? 'rgba(74, 85, 104, 0.7)' : 'rgba(226, 232, 240, 0.7)';

  let labelText = point.label || '';
  if (point.originalPrice !== undefined && point.originalPrice !== null) {
    labelText = `$${point.originalPrice.toFixed(2)}`;
  }

  const textWidth = labelText.length * 5;
  const paddingX = 1;
  const paddingY = 1;
  const labelHeight = 10;

  const rectX = labelX - (textWidth / 2) - paddingX;
  const rectY = labelY - (labelHeight / 2) - paddingY;
  const rectWidth = textWidth + (paddingX * 2);
  const rectHeight = labelHeight + (paddingY * 2);

  const labelIsOutOfBounds =
    rectX < 0 ||
    rectY < 0 ||
    rectX + rectWidth > chartWidth ||
    rectY + rectHeight > chartHeight;

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={dotStyle.r}
        fill={dotStyle.fill}
        stroke={dotStyle.stroke}
        strokeWidth={dotStyle.strokeWidth}
      />

      {!labelIsOutOfBounds && (
        <g opacity={0.8}>
          <line
            x1={cx}
            y1={cy}
            x2={labelX}
            y2={labelY}
            stroke={dotStyle.fill}
            strokeWidth={1}
            strokeDasharray="2,2"
            opacity={0.6}
          />

          <rect
            x={rectX}
            y={rectY}
            width={rectWidth}
            height={rectHeight}
            rx={3}
            ry={3}
            fill={bgColor}
            stroke={borderColor}
            strokeWidth={1}
          />

          <text
            x={labelX}
            y={labelY}
            textAnchor="middle"
            fill={textColor}
            fontSize={9}
            fontWeight={point.pointType === 'latest' ? 'bold' : 'normal'}
            dominantBaseline="middle"
          >
            {labelText}
          </text>
        </g>
      )}
    </g>
  );
});

export const ColorWheelLegendItem = memo(({ entry, isVisible, onClick }) => (
  <Box
    key={`legend-item-${entry.dataKey}`}
    mx={1} my={0} cursor="pointer"
    onClick={onClick}
    px={2} py={0.5} borderRadius="sm"
    _hover={{ bg: "rgba(255,255,255,0.1)" }}
    opacity={isVisible ? 1 : 0.5}
  >
    <Flex alignItems="center">
      <Box position="relative" width="16px" height="16px" mr={1}>
        <Box
          position="absolute"
          top="0px"
          left="4px"
          width="6px"
          height="6px"
          borderRadius="50%"
          bg={COLORS.stockSentiment}
          opacity={0.9}
        />
        <Box
          position="absolute"
          top="6px"
          left="0px"
          width="6px"
          height="6px"
          borderRadius="50%"
          bg={COLORS.marketSentiment}
          opacity={0.9}
        />
        <Box
          position="absolute"
          top="6px"
          right="0px"
          width="6px"
          height="6px"
          borderRadius="50%"
          bg={COLORS.industrySentiment}
          opacity={0.9}
        />
      </Box>
      <Text fontSize="xs" color="white">{entry.value}</Text>
    </Flex>
  </Box>
));

export const LegendItem = memo(({ entry, isVisible, onClick }) => (
  <Box
    key={`legend-item-${entry.dataKey}`}
    mx={1} my={0} cursor="pointer"
    onClick={onClick}
    px={2} py={0.5} borderRadius="sm"
    _hover={{ bg: "rgba(255,255,255,0.1)" }}
    opacity={isVisible ? 1 : 0.5}
  >
    <Flex alignItems="center">
      <Box
        width="8px"
        height="8px"
        borderRadius="50%"
        bg={entry.color}
        mr={1}
      />
      <Text fontSize="xs" color="white">{entry.value}</Text>
    </Flex>
  </Box>
));

export const InlineLoading = memo(({ label = "Loading..." }) => (
  <HStack spacing={2}>
    <Spinner size="sm" />
    <Text>{label}</Text>
  </HStack>
));

export const PredictionMarker = memo(({ cx, cy, chartData, tunerResults }) => {
    if (!tunerResults || !tunerResults.bestScore) return null;

    const { bestScore } = tunerResults;
    const isPositive = bestScore > 0;
    const confidence = Math.abs(bestScore);
    const color = isPositive ? COLORS.positiveSentiment : COLORS.negativeSentiment;

    const barWidth = 80;
    const barHeight = 200;

    const opacity = 0.1 + (confidence * 0.4);

    return (
        <g transform={`translate(${cx - barWidth / 2}, ${cy - barHeight / 2})`}>
            <rect
                width={barWidth}
                height={barHeight}
                fill={color}
                opacity={opacity}
                rx={5}
                ry={5}
            />
            <foreignObject x={0} y={0} width={barWidth} height={barHeight}>
                <Flex
                    direction="column"
                    align="center"
                    justify="center"
                    height="100%"
                    color="white"
                    textAlign="center"
                    p={2}
                >
                    <Text fontSize="xs" fontWeight="bold">NEXT DAY BIAS</Text>
                    <Text fontSize="lg" fontWeight="bold" color={isPositive ? "green.300" : "red.300"}>
                        {isPositive ? "POSITIVE" : "NEGATIVE"}
                    </Text>
                    <Text fontSize="xs" mt={1}>CONFIDENCE</Text>
                    <Text fontSize="md" fontWeight="bold">
                        {(confidence * 100).toFixed(1)}%
                    </Text>
                </Flex>
            </foreignObject>
        </g>
    );
});