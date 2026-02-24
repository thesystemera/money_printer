import React, { useState } from 'react';
import {
  Box, Text, VStack, HStack, Flex, Badge, SimpleGrid,
  Button, Collapse, Stat, StatLabel, StatNumber, StatHelpText,
  Alert, AlertIcon, Table, Thead, Tbody, Tr, Th, Td, Progress, Tabs, TabList, Tab, TabPanels, TabPanel, Tooltip
} from '@chakra-ui/react';
import {
  TrendingDown, Target, Zap, AlertTriangle,
  Brain, History, BarChart3, Eye, DollarSign, Users, Award, Globe,
  LineChart, Clock, Sun, Sunset, Moon, CheckCircle, Activity
} from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, BarChart, Tooltip as RechartsTooltip, ResponsiveContainer, Bar } from 'recharts';
import TrendsSection from './RecommendationPredictionTrendAnalysis';
import { SignalPerformanceSection } from './RecommendationPredictionAccuracySignal';

const COLOR_MAPPINGS = {
  accuracy: {
    thresholds: [{ min: 70, color: 'green' }, { min: 60, color: 'yellow' }, { min: 50, color: 'orange' }],
    default: 'red'
  },
  rating: {
    values: { excellent: 'green', good: 'blue', fair: 'yellow', poor: 'orange', missed: 'red' },
    default: 'gray'
  },
  returnError: {
    thresholds: [{ min: 0, max: 10, color: 'green' }, { min: 10, max: 25, color: 'blue' }, { min: 25, max: 50, color: 'yellow' }],
    default: 'red'
  },
  bias: {
    threshold: { abs: 2, positive: 'green', negative: 'red', neutral: 'blue' },
    default: 'gray'
  },
  tier: {
    values: { excellent: 'green', good: 'blue', average: 'yellow', poor: 'red' },
    default: 'gray'
  },
  correlation: {
    thresholds: [{ min: 0.7, color: 'green' }, { min: 0.5, color: 'blue' }, { min: 0.3, color: 'yellow' }],
    default: 'red'
  },
  trend: {
    values: { improving: 'green', declining: 'red', stable: 'blue' },
    default: 'gray'
  },
  magnitude: {
    values: { extreme: 'purple', major: 'red', large: 'orange', moderate: 'yellow', small: 'blue', minor: 'green', noise: 'gray' },
    default: 'gray'
  },
  action: {
    values: { buy: 'green', sell: 'red', hold: 'blue' },
    default: 'gray'
  },
  timepoint: {
    values: { pre_market: 'blue', market_open: 'green', market_close: 'orange', after_hours: 'purple' },
    default: 'gray'
  }
};

const TIMEPOINT_DATA = {
  pre_market: { icon: Clock, label: 'Pre-Market', color: 'blue' },
  market_open: { icon: Sun, label: 'Market Open', color: 'green' },
  market_close: { icon: Sunset, label: 'Market Close', color: 'orange' },
  after_hours: { icon: Moon, label: 'After Hours', color: 'purple' }
};

const getColor = (type, value) => {
  if (value === null || value === undefined) return COLOR_MAPPINGS[type]?.default || 'gray';

  const mapping = COLOR_MAPPINGS[type];
  if (!mapping) return 'gray';

  if (mapping.values) {
    return mapping.values[value?.toLowerCase()] || mapping.default;
  }

  if (mapping.thresholds) {
    if (type === 'correlation') {
      const absVal = Math.abs(value);
      for (const threshold of mapping.thresholds) {
        if (absVal >= threshold.min) return threshold.color;
      }
    } else if (type === 'returnError') {
      for (const threshold of mapping.thresholds) {
        if (value >= threshold.min && (!threshold.max || value < threshold.max)) return threshold.color;
      }
    } else {
      for (const threshold of mapping.thresholds) {
        if (value >= threshold.min) return threshold.color;
      }
    }
    return mapping.default;
  }

  if (mapping.threshold && type === 'bias') {
    const absVal = Math.abs(value);
    if (absVal < mapping.threshold.abs) return mapping.threshold.neutral;
    return value > 0 ? mapping.threshold.positive : mapping.threshold.negative;
  }

  return mapping.default;
};

const getTimepointData = (timepoint) => {
  return TIMEPOINT_DATA[timepoint] || { icon: Clock, label: timepoint, color: 'gray' };
};

const formatValue = (value, decimals = 2) => {
  if (value === null || value === undefined) return 'N/A';
  return typeof value === 'number' ? value.toFixed(decimals) : value;
};

const formatDate = (dateString) => {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateString;
  }
};

const PanelContainer = ({ mode, title, icon: Icon, iconColor, isExpanded, onToggleExpand, borderColor, actions, children }) => (
  <Box borderWidth="1px" borderColor={borderColor} borderRadius="lg" overflow="hidden">
    <Flex
      p={3}
      align="center"
      justify="space-between"
      cursor={mode === 'expandable' ? 'pointer' : 'default'}
      onClick={mode === 'expandable' ? onToggleExpand : undefined}
      bg="gray.50"
      _dark={{ bg: 'gray.700' }}
    >
      <HStack spacing={3}>
        {Icon && <Icon size={20} color={`var(--chakra-colors-${iconColor.replace('.', '-')})`} />}
        <Text fontSize="md" fontWeight="bold">{title}</Text>
      </HStack>
      {actions && <Box onClick={(e) => e.stopPropagation()}>{actions}</Box>}
    </Flex>
    {mode === 'expandable' ? (
      <Collapse in={isExpanded}>
        <Box p={4}>{children}</Box>
      </Collapse>
    ) : (
      <Box p={4}>{children}</Box>
    )}
  </Box>
);

const MetricStat = ({ label, value, suffix = '', helpText, color, size = 'sm', onClick, cursor = 'default' }) => (
  <Stat
    size={size}
    cursor={cursor}
    onClick={onClick}
    _hover={onClick ? { bg: 'blackAlpha.50', _dark: { bg: 'whiteAlpha.100' } } : {}}
    borderRadius="md"
    p={onClick ? 2 : 0}
    mx={onClick ? -2 : 0}
  >
    <StatLabel fontSize="xs" color="gray.600" _dark={{ color: 'gray.400' }}>{label}</StatLabel>
    <StatNumber fontSize="lg" color={color ? `${color}.500` : undefined}>
      {value}{suffix}
    </StatNumber>
    {helpText && <StatHelpText fontSize="xs">{helpText}</StatHelpText>}
  </Stat>
);

const MetricBox = ({ icon: Icon, iconColor, label, value, subtitle, borderColor, children, ...props }) => (
  <Box p={3} borderWidth="1px" borderColor={borderColor} borderRadius="md" {...props}>
    <Flex align="center" gap={2} mb={2}>
      {Icon && <Icon size={16} color={`var(--chakra-colors-${iconColor}-500)`} />}
      <Text fontSize="xs" fontWeight="medium">{label}</Text>
    </Flex>
    {value && (
      <Text fontSize="lg" fontWeight="bold" mb={1}>
        {value}
      </Text>
    )}
    {subtitle && (
      <Text fontSize="xs" color="gray.600" _dark={{ color: 'gray.400' }}>
        {subtitle}
      </Text>
    )}
    {children}
  </Box>
);

const MetricTable = ({ columns, data, size = 'sm' }) => (
  <Table size={size} variant="simple">
    <Thead>
      <Tr>
        {columns.map((col, idx) => (
          <Th key={idx} fontSize="xs" isNumeric={col.numeric}>
            {col.header}
          </Th>
        ))}
      </Tr>
    </Thead>
    <Tbody>
      {data.map((row, idx) => (
        <Tr key={idx}>
          {columns.map((col, colIdx) => (
            <Td key={colIdx} fontSize="xs" isNumeric={col.numeric}>
              {col.render ? col.render(row) : row[col.key]}
            </Td>
          ))}
        </Tr>
      ))}
    </Tbody>
  </Table>
);

const StandardChart = ({ data, dataKey, colorScheme = 'blue', colorMode = 'light', height = "200px", children }) => (
  <Box h={height} minH={height} bg={colorMode === 'dark' ? 'whiteAlpha.100' : 'blackAlpha.50'} borderRadius="md" p={3}>
    <ResponsiveContainer width="100%" height="100%" minHeight={150}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={colorMode === 'dark' ? '#374151' : '#E5E7EB'} />
        <XAxis
          dataKey={dataKey}
          stroke={colorMode === 'dark' ? '#9CA3AF' : '#6B7280'}
          fontSize={10}
          angle={-45}
          textAnchor="end"
          height={60}
        />
        <YAxis stroke={colorMode === 'dark' ? '#9CA3AF' : '#6B7280'} fontSize={12} />
        <RechartsTooltip
          contentStyle={{
            backgroundColor: colorMode === 'dark' ? '#1F2937' : '#FFFFFF',
            border: '1px solid',
            borderColor: colorMode === 'dark' ? '#374151' : '#E5E7EB',
            borderRadius: '6px'
          }}
        />
        {children}
      </BarChart>
    </ResponsiveContainer>
  </Box>
);

const SectionToggleButton = ({ section, activeSection, onClick, icon: Icon, colorScheme, children, count }) => (
  <Button
    size="sm"
    variant="outline"
    onClick={() => onClick(section)}
    leftIcon={<Icon size={14} />}
    colorScheme={activeSection === section ? colorScheme : 'gray'}
  >
    {children}
    {count && (
      <Text fontSize="xs" ml={1} color="gray.500">
        ({count})
      </Text>
    )}
  </Button>
);

const PredictionAccuracySection = ({
  predictionAccuracyData,
  isPredictionAccuracyOpen,
  togglePredictionAccuracy,
  borderColor,
  colorMode = 'light'
}) => {
  const [activeSection, setActiveSection] = useState('');

  const textColor = colorMode === 'dark' ? 'gray.300' : 'gray.700';
  const accentBg = colorMode === 'dark' ? 'whiteAlpha.100' : 'blackAlpha.50';

  const hasData = predictionAccuracyData &&
    predictionAccuracyData.metadata &&
    predictionAccuracyData.metadata.processed_count > 0;

  const isPortfolioMode = hasData &&
    predictionAccuracyData.metadata.mode === 'portfolio' &&
    predictionAccuracyData.metadata.symbols_count > 1;

  const toggleSection = (section) => {
    setActiveSection(activeSection === section ? '' : section);
  };

  if (!hasData) {
    return (
      <PanelContainer
        mode="expandable"
        title="Prediction Accuracy"
        icon={History}
        iconColor="blue.500"
        isExpanded={isPredictionAccuracyOpen}
        onToggleExpand={togglePredictionAccuracy}
        borderColor={borderColor}
      >
        <Alert status="info" borderRadius="md">
          <AlertIcon />
          <Text fontSize="sm">No prediction history available yet</Text>
        </Alert>
      </PanelContainer>
    );
  }

  const {
    accuracy_metrics,
    portfolio_metrics,
    model_comparison,
    weekly_performance,
    trends,
    confidence_correlation,
    magnitude_analysis,
    movement_weighted_metrics,
    movement_detection,
    metadata,
    portfolio_specific,
    symbol_performance,
    signal_performance
  } = predictionAccuracyData;

  const AIAnalysisSection = () => (
    <Collapse in={activeSection === 'ai'}>
      {predictionAccuracyData?.ai_analysis && (
        <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
          <Flex justify="space-between" align="center" mb={4}>
            <Flex align="center" gap={2}>
              <Brain size={20} color="var(--chakra-colors-purple-500)" />
              <Text fontSize="md" fontWeight="bold">AI Analysis</Text>
            </Flex>
            <Badge colorScheme="purple" variant="solid">AI Insights</Badge>
          </Flex>

          <Box className="ai-analysis-content">
            {predictionAccuracyData.ai_analysis.split('\n').map((paragraph, index) => {
              const line = paragraph.trim();

              if (line.match(/^\[.*\]$/)) {
                return (
                  <Text
                    key={index}
                    fontSize="md"
                    fontWeight="bold"
                    color="purple.600"
                    _dark={{ color: 'purple.300' }}
                    mt={index > 0 ? 4 : 0}
                    mb={2}
                  >
                    {line.replace(/[\[\]]/g, '')}
                  </Text>
                );
              }

              if (line.match(/^[-•*]\s/)) {
                return (
                  <Text key={index} fontSize="sm" color={textColor} pl={4} mb={1}>
                    • {line.replace(/^[-•*]\s/, '')}
                  </Text>
                );
              }

              if (line.match(/^\d+\.\s/)) {
                return (
                  <Text key={index} fontSize="sm" color={textColor} pl={4} mb={1} fontWeight="medium">
                    {line}
                  </Text>
                );
              }

              if (line.length > 0) {
                return (
                  <Text key={index} fontSize="sm" color={textColor} mb={2} lineHeight="1.6">
                    {line}
                  </Text>
                );
              }

              return <Box key={index} h={2} />;
            })}
          </Box>

          <Box mt={4} p={3} bg={accentBg} borderRadius="md">
            <Text fontSize="xs" color={textColor}>
              <strong>Analysis Generated:</strong> {new Date().toLocaleString()}
            </Text>
            <Text fontSize="xs" color={textColor} mt={1}>
              This AI analysis is based on historical prediction data and is intended for informational purposes only.
              Consider these insights alongside other factors when evaluating trading strategies.
            </Text>
          </Box>
        </Box>
      )}
    </Collapse>
  );

  const OverviewSection = () => (
    <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="lg">
      <Flex justify="space-between" align="center" mb={4}>
        <Text fontSize="lg" fontWeight="bold">
          {isPortfolioMode ? 'Portfolio Prediction Performance' : 'Prediction Performance Overview'}
        </Text>
        {isPortfolioMode && (
          <Flex align="center" gap={2}>
            <Globe size={16} color="var(--chakra-colors-blue-500)" />
            <Badge colorScheme="blue" variant="subtle">
              {metadata.symbols_count} Symbols
            </Badge>
          </Flex>
        )}
      </Flex>

      <SimpleGrid columns={{ base: 2, md: isPortfolioMode ? 6 : 5 }} spacing={4} mb={4}>
        <MetricStat
          label="Total Predictions"
          value={metadata.processed_count}
          helpText={isPortfolioMode ? `across ${metadata.symbols_count} symbols` : `of ${metadata.total_count} recommendations`}
        />

        {isPortfolioMode && (
          <MetricStat
            label="Symbols Analyzed"
            value={metadata.symbols_count}
            helpText={`${formatValue(metadata.processed_count / metadata.symbols_count, 1)} avg per symbol`}
            onClick={() => toggleSection('symbols')}
            cursor="pointer"
          />
        )}

        {accuracy_metrics?.directional && (
          <MetricStat
            label="Directional Accuracy"
            value={formatValue(accuracy_metrics.directional.accuracy, 1)}
            suffix="%"
            helpText={`${accuracy_metrics.directional.correct}/${accuracy_metrics.directional.total}`}
            color={getColor('accuracy', accuracy_metrics.directional.accuracy)}
            onClick={() => toggleSection('accuracy')}
            cursor="pointer"
          />
        )}

        {accuracy_metrics?.movement_weighted && (
          <MetricStat
            label="Movement-Weighted"
            value={formatValue(accuracy_metrics.movement_weighted.accuracy, 1)}
            suffix="%"
            helpText="Weighted by significance"
            color="purple"
            onClick={() => toggleSection('accuracy')}
            cursor="pointer"
          />
        )}

        {accuracy_metrics?.return_accuracy?.avg_error !== null && (
          <MetricStat
            label="Return Accuracy"
            value={formatValue(accuracy_metrics.return_accuracy?.avg_error, 1)}
            suffix="%"
            helpText={
              <HStack spacing={1} fontSize="xs">
                <Text>Bias:</Text>
                <Text color={`${getColor('bias', accuracy_metrics.return_accuracy?.bias)}.500`} fontWeight="bold">
                  {accuracy_metrics.return_accuracy?.bias > 0 ? '+' : ''}
                  {formatValue(accuracy_metrics.return_accuracy?.bias, 1)}%
                </Text>
              </HStack>
            }
            color={getColor('returnError', accuracy_metrics.return_accuracy?.avg_error)}
            onClick={() => toggleSection('accuracy')}
            cursor="pointer"
          />
        )}

        {movement_detection && (
          <MetricStat
            label="Detection Rate"
            value={formatValue(movement_detection.significant_move_detection_rate, 1)}
            suffix="%"
            helpText={`${movement_detection.total_significant_moves} opportunities`}
            color={getColor('accuracy', movement_detection.significant_move_detection_rate)}
            onClick={() => toggleSection('magnitude')}
            cursor="pointer"
          />
        )}

        {portfolio_metrics?.returns && (
          <MetricStat
            label="Strategy Return"
            value={`${portfolio_metrics.returns.strategy >= 0 ? '+' : ''}${formatValue(portfolio_metrics.returns.strategy, 1)}`}
            suffix="%"
            helpText={`vs ${formatValue(portfolio_metrics.returns.buy_hold, 1)}% buy & hold`}
            color={portfolio_metrics.returns.strategy >= 0 ? 'green' : 'red'}
            onClick={() => toggleSection('portfolio')}
            cursor="pointer"
          />
        )}
      </SimpleGrid>

      {accuracy_metrics?.price && (
        <Box mb={4} p={3} bg={accentBg} borderRadius="md" cursor="pointer" onClick={() => toggleSection('accuracy')} _hover={{ bg: colorMode === 'dark' ? 'whiteAlpha.200' : 'blackAlpha.100' }}>
          <Flex align="center" gap={2} mb={3}>
            <Target size={16} color="var(--chakra-colors-blue-500)" />
            <Text fontSize="sm" fontWeight="medium">Price Prediction Accuracy by Timepoint</Text>
          </Flex>
          <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
            {Object.entries(accuracy_metrics.price).map(([timepoint, data]) => {
              const { icon: Icon, label, color } = getTimepointData(timepoint);
              const ratingColor = getColor('rating', data.rating);

              return (
                <Box key={timepoint}>
                  <Flex align="center" gap={2} mb={1}>
                    <Icon size={14} color={`var(--chakra-colors-${color}-500)`} />
                    <Text fontSize="xs" color={textColor}>{label}</Text>
                  </Flex>
                  <Text fontSize="sm" fontWeight="bold" color={`${ratingColor}.500`}>
                    {formatValue(data.avg_diff, 1)}% error
                  </Text>
                  <Badge size="xs" colorScheme={ratingColor} variant="subtle">
                    {data.rating}
                  </Badge>
                </Box>
              );
            })}
          </SimpleGrid>
        </Box>
      )}

      {(movement_weighted_metrics || movement_detection) && (
        <Box mb={4} p={3} bg={accentBg} borderRadius="md" cursor="pointer" onClick={() => toggleSection('magnitude')} _hover={{ bg: colorMode === 'dark' ? 'whiteAlpha.200' : 'blackAlpha.100' }}>
          <Flex align="center" gap={2} mb={3}>
            <Zap size={16} color="var(--chakra-colors-orange-500)" />
            <Text fontSize="sm" fontWeight="medium">Significant Movement Analysis</Text>
          </Flex>
          <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4}>
            {movement_weighted_metrics && (
              <>
                <MetricBox
                  icon={Target}
                  iconColor="purple"
                  label="Movement-Weighted Accuracy"
                  value={`${formatValue(movement_weighted_metrics.movement_weighted_accuracy, 1)}%`}
                  subtitle="Weighted by significance"
                  borderColor="transparent"
                />
                <MetricBox
                  icon={Award}
                  iconColor="green"
                  label="High-Movement Wins"
                  value={movement_weighted_metrics.high_movement_wins}
                  subtitle="Major predictions captured"
                  borderColor="transparent"
                />
              </>
            )}

            {movement_detection && (
              <>
                <MetricBox
                  icon={Target}
                  iconColor="green"
                  label="Detection Quality"
                  value={movement_detection.detection_quality}
                  subtitle={`${formatValue(movement_detection.precision_rate, 1)}% precision`}
                  borderColor="transparent"
                />
                <MetricBox
                  icon={Eye}
                  iconColor="blue"
                  label="Significant Move Detection"
                  value={`${formatValue(movement_detection.significant_move_detection_rate, 1)}%`}
                  subtitle="Predicted active positions"
                  borderColor="transparent"
                />
              </>
            )}
          </SimpleGrid>
        </Box>
      )}

      {isPortfolioMode && portfolio_specific && (
        <Box mb={4} p={3} bg={accentBg} borderRadius="md" cursor="pointer" onClick={() => toggleSection('symbols')} _hover={{ bg: colorMode === 'dark' ? 'whiteAlpha.200' : 'blackAlpha.100' }}>
          <Text fontSize="sm" fontWeight="medium" mb={3}>Performance Highlights</Text>
          <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
            {portfolio_specific.best_performer && (
              <MetricBox
                icon={Award}
                iconColor="green"
                label="Best Performer"
                value={portfolio_specific.best_performer[0]}
                subtitle={`${formatValue(portfolio_specific.best_performer[1].movement_weighted_accuracy, 1)}% movement-weighted`}
                borderColor="transparent"
              />
            )}

            {portfolio_specific.worst_performer && (
              <MetricBox
                icon={TrendingDown}
                iconColor="red"
                label="Needs Improvement"
                value={portfolio_specific.worst_performer[0]}
                subtitle={`${formatValue(portfolio_specific.worst_performer[1].movement_weighted_accuracy, 1)}% movement-weighted`}
                borderColor="transparent"
              />
            )}

            {portfolio_specific.consistency && (
              <MetricBox
                icon={Target}
                iconColor="blue"
                label="Consistency"
                value={`${formatValue(portfolio_specific.consistency.movement_weighted_std, 1)}% std dev`}
                subtitle={`${portfolio_specific.consistency.movement_weighted_std < 10 ? 'High' : portfolio_specific.consistency.movement_weighted_std < 20 ? 'Medium' : 'Low'} consistency`}
                borderColor="transparent"
              />
            )}
          </SimpleGrid>
        </Box>
      )}

      <HStack spacing={2} flexWrap="wrap">
        <SectionToggleButton section="accuracy" activeSection={activeSection} onClick={toggleSection} icon={Target} colorScheme="blue">
          Accuracy Details
        </SectionToggleButton>

        {signal_performance && (
          <SectionToggleButton section="signals" activeSection={activeSection} onClick={toggleSection} icon={Activity} colorScheme="teal">
            Signal Analysis
          </SectionToggleButton>
        )}

        {(magnitude_analysis || movement_weighted_metrics) && (
          <SectionToggleButton section="magnitude" activeSection={activeSection} onClick={toggleSection} icon={Zap} colorScheme="orange">
            Movement Analysis
          </SectionToggleButton>
        )}

        {trends && (
          <SectionToggleButton section="trends" activeSection={activeSection} onClick={toggleSection} icon={LineChart} colorScheme="purple">
            Trend Analysis
          </SectionToggleButton>
        )}

        {model_comparison && (
          <SectionToggleButton section="models" activeSection={activeSection} onClick={toggleSection} icon={Brain} colorScheme="purple">
            Model Comparison
          </SectionToggleButton>
        )}

        {portfolio_metrics && (
          <SectionToggleButton section="portfolio" activeSection={activeSection} onClick={toggleSection} icon={DollarSign} colorScheme="green">
            Portfolio Impact
          </SectionToggleButton>
        )}

        {isPortfolioMode && symbol_performance && (
          <SectionToggleButton section="symbols" activeSection={activeSection} onClick={toggleSection} icon={Users} colorScheme="cyan">
            Symbol Rankings
          </SectionToggleButton>
        )}

        {weekly_performance && (
          <SectionToggleButton section="weekly" activeSection={activeSection} onClick={toggleSection} icon={BarChart3} colorScheme="orange">
            Weekly Patterns
          </SectionToggleButton>
        )}

        {confidence_correlation && (
          <SectionToggleButton section="confidence" activeSection={activeSection} onClick={toggleSection} icon={Eye} colorScheme="teal">
            Confidence Calibration
          </SectionToggleButton>
        )}

        {predictionAccuracyData?.ai_analysis && (
          <SectionToggleButton section="ai" activeSection={activeSection} onClick={toggleSection} icon={Brain} colorScheme="purple">
            AI Insights
          </SectionToggleButton>
        )}
      </HStack>
    </Box>
  );

  const MagnitudeAnalysisSection = () => (
    <Collapse in={activeSection === 'magnitude'}>
      {(magnitude_analysis || movement_weighted_metrics || movement_detection) && (
        <VStack spacing={4} align="stretch">
          <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
            <Flex justify="space-between" align="center" mb={4}>
              <Flex align="center" gap={2}>
                <Zap size={20} color="var(--chakra-colors-orange-500)" />
                <Text fontSize="md" fontWeight="bold">Significant Movement Detection</Text>
              </Flex>
              <Badge colorScheme="orange" variant="solid">Movement Analysis</Badge>
            </Flex>

            {magnitude_analysis && (
              <Box mb={6}>
                <Text fontSize="sm" fontWeight="medium" mb={3}>Accuracy by Movement Magnitude</Text>

                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6} mb={4}>
                  <Box>
                    <Text fontSize="xs" fontWeight="medium" mb={3}>Movement Distribution</Text>
                    <VStack spacing={2} align="stretch">
                      {Object.entries(magnitude_analysis.by_magnitude).map(([tier, data]) => (
                        <Box key={tier} p={3} borderWidth="1px" borderColor={borderColor} borderRadius="md">
                          <Flex justify="space-between" align="center" mb={2}>
                            <Text fontSize="xs" fontWeight="bold" color={`${getColor('magnitude', tier)}.500`}>
                              {tier}
                            </Text>
                            <Badge size="xs" colorScheme={getColor('magnitude', tier)} variant="subtle">
                              {formatValue(data.percentage_of_total, 1)}%
                            </Badge>
                          </Flex>

                          <SimpleGrid columns={3} spacing={2}>
                            <Box>
                              <Text fontSize="xs" color={textColor}>Accuracy</Text>
                              <Text fontSize="sm" fontWeight="bold" color={`${getColor('accuracy', data.accuracy)}.500`}>
                                {formatValue(data.accuracy, 1)}%
                              </Text>
                            </Box>
                            <Box>
                              <Text fontSize="xs" color={textColor}>Count</Text>
                              <Text fontSize="sm" fontWeight="bold">
                                {data.correct_predictions}/{data.total_predictions}
                              </Text>
                            </Box>
                            <Box>
                              <Text fontSize="xs" color={textColor}>Avg Move</Text>
                              <Text fontSize="sm" fontWeight="bold">
                                {formatValue(data.avg_movement, 1)}%
                              </Text>
                            </Box>
                          </SimpleGrid>
                        </Box>
                      ))}
                    </VStack>
                  </Box>

                  <Box>
                    <Text fontSize="xs" fontWeight="medium" mb={3}>Significant Moves Summary</Text>
                    <Box p={4} bg={accentBg} borderRadius="md">
                      <SimpleGrid columns={2} spacing={4}>
                        <MetricStat
                          label="Total Significant"
                          value={magnitude_analysis.significant_moves_summary.total_significant}
                          helpText={`${formatValue(magnitude_analysis.significant_moves_summary.percentage_significant, 1)}% of all`}
                          color="orange"
                        />
                        <MetricStat
                          label="Accuracy on Significant Moves"
                          value={formatValue(magnitude_analysis.significant_moves_summary.significant_accuracy, 1)}
                          suffix="%"
                          helpText={`${magnitude_analysis.significant_moves_summary.correct_significant} correct`}
                          color={getColor('accuracy', magnitude_analysis.significant_moves_summary.significant_accuracy)}
                        />
                      </SimpleGrid>
                    </Box>

                    <Box mt={4}>
                      <Text fontSize="xs" fontWeight="medium" mb={2}>Movement Impact Chart</Text>
                      <StandardChart
                        data={Object.entries(magnitude_analysis.by_magnitude).map(([tier, data]) => ({
                          tier,
                          accuracy: data.accuracy,
                          count: data.total_predictions,
                          percentage: data.percentage_of_total
                        }))}
                        dataKey="tier"
                        colorMode={colorMode}
                      >
                        <Bar dataKey="accuracy" fill="#F59E0B" />
                      </StandardChart>
                    </Box>
                  </Box>
                </SimpleGrid>
              </Box>
            )}

            {movement_detection && (
              <Box mb={6}>
                <Text fontSize="sm" fontWeight="medium" mb={3}>Significant Movement Detection Performance</Text>

                <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4}>
                  <MetricBox
                    icon={Eye}
                    iconColor="blue"
                    label="Detection Rate"
                    value={`${formatValue(movement_detection.significant_move_detection_rate, 1)}%`}
                    subtitle="Predicted non-HOLD actions"
                    borderColor={borderColor}
                  />

                  <MetricBox
                    icon={Target}
                    iconColor="green"
                    label="Significant Move Accuracy"
                    value={`${formatValue(movement_detection.significant_move_accuracy, 1)}%`}
                    subtitle="Correct when moves occurred"
                    borderColor={borderColor}
                  />

                  <MetricBox
                    icon={AlertTriangle}
                    iconColor="orange"
                    label="False Alarm Rate"
                    value={`${formatValue(movement_detection.false_alarm_rate, 1)}%`}
                    subtitle="Lower is better"
                    borderColor={borderColor}
                  />

                  <MetricBox
                    icon={Zap}
                    iconColor="purple"
                    label="Precision Rate"
                    value={`${formatValue(movement_detection.precision_rate, 1)}%`}
                    subtitle="True positive rate"
                    borderColor={borderColor}
                  />
                </SimpleGrid>

                <Box mt={4} p={3} bg={accentBg} borderRadius="md">
                  <Text fontSize="xs" fontWeight="medium" mb={2}>Detection vs Accuracy Explanation</Text>
                  <VStack spacing={1} align="stretch">
                    <Text fontSize="xs" color={textColor}>
                      <strong>Detection Rate:</strong> When significant moves occurred, what % did we predict a non-HOLD action?
                    </Text>
                    <Text fontSize="xs" color={textColor}>
                      <strong>Significant Move Accuracy:</strong> When significant moves occurred, what % did we predict the direction correctly?
                    </Text>
                    <Text fontSize="xs" color={textColor}>
                      <strong>Overall Quality:</strong> {movement_detection.detection_quality} - Based on detection rate and false alarm rate
                    </Text>
                  </VStack>
                </Box>
              </Box>
            )}

            {movement_weighted_metrics && (
              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={3}>Movement-Weighted Prediction Analysis</Text>

                <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={4}>
                  <MetricBox
                    label="Movement-Weighted Accuracy"
                    value={`${formatValue(movement_weighted_metrics.movement_weighted_accuracy, 1)}%`}
                    subtitle={movement_weighted_metrics.overall_rating}
                    borderColor={borderColor}
                  />

                  <MetricBox
                    label="Value Capture Rate"
                    value={`${formatValue(movement_weighted_metrics.value_capture_rate, 1)}%`}
                    subtitle="Movement value captured"
                    borderColor={borderColor}
                  />

                  <MetricBox
                    label="High-Movement Wins"
                    value={movement_weighted_metrics.high_movement_wins}
                    subtitle="Major predictions captured"
                    borderColor={borderColor}
                  />
                </SimpleGrid>

                {(movement_weighted_metrics.top_wins?.length > 0 || movement_weighted_metrics.worst_misses?.length > 0) && (
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                    {movement_weighted_metrics.top_wins?.length > 0 && (
                      <Box>
                        <Flex align="center" gap={2} mb={2} color="green.500">
                          <Award size={12} />
                          <Text fontSize="xs" fontWeight="medium">Top High-Movement Wins</Text>
                        </Flex>
                        <VStack spacing={2} align="stretch">
                          {movement_weighted_metrics.top_wins.slice(0, 3).map((win, index) => (
                            <Box key={index} p={2} bg="green.50" _dark={{ bg: 'green.900' }} borderRadius="sm">
                              <Flex justify="space-between" align="center">
                                <Text fontSize="xs" fontWeight="bold">{win.symbol}</Text>
                                <Badge size="xs" colorScheme="green">
                                  +{formatValue(win.abs_movement, 1)}%
                                </Badge>
                              </Flex>
                              <Text fontSize="xs" color={textColor}>
                                {win.action} • {formatDate(win.date)}
                              </Text>
                            </Box>
                          ))}
                        </VStack>
                      </Box>
                    )}

                    {movement_weighted_metrics.worst_misses?.length > 0 && (
                      <Box>
                        <Flex align="center" gap={2} mb={2} color="red.500">
                          <AlertTriangle size={12} />
                          <Text fontSize="xs" fontWeight="medium">Missed Opportunities</Text>
                        </Flex>
                        <VStack spacing={2} align="stretch">
                          {movement_weighted_metrics.worst_misses.slice(0, 3).map((miss, index) => (
                            <Box key={index} p={2} bg="red.50" _dark={{ bg: 'red.900' }} borderRadius="sm">
                              <Flex justify="space-between" align="center">
                                <Text fontSize="xs" fontWeight="bold">{miss.symbol}</Text>
                                <Badge size="xs" colorScheme="red">
                                  {formatValue(miss.abs_movement, 1)}%
                                </Badge>
                              </Flex>
                              <Text fontSize="xs" color={textColor}>
                                {miss.action} • {formatDate(miss.date)}
                              </Text>
                            </Box>
                          ))}
                        </VStack>
                      </Box>
                    )}
                  </SimpleGrid>
                )}
              </Box>
            )}
          </Box>
        </VStack>
      )}
    </Collapse>
  );

  const SymbolRankingsSection = () => (
    <Collapse in={activeSection === 'symbols'}>
      {isPortfolioMode && symbol_performance && (
        <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
          <Text fontSize="md" fontWeight="bold" mb={3}>Symbol Performance Rankings</Text>

          <MetricTable
            columns={[
              { header: 'Rank', key: 'rank', render: (row) => (
                <Flex align="center" gap={1}>
                  #{row.rank}
                  {row.rank === 1 && <Award size={12} color="var(--chakra-colors-yellow-500)" />}
                </Flex>
              )},
              { header: 'Symbol', key: 'symbol', render: (row) => (
                <Text fontWeight="bold">{row.symbol}</Text>
              )},
              { header: 'Directional', key: 'directional_accuracy', numeric: true, render: (row) => (
                <Text color={`${getColor('accuracy', row.directional_accuracy)}.500`}>
                  {formatValue(row.directional_accuracy, 1)}%
                </Text>
              )},
              { header: 'Movement-Wtd', key: 'movement_weighted_accuracy', numeric: true, render: (row) => (
                <Text color="purple.500">
                  {formatValue(row.movement_weighted_accuracy, 1)}%
                </Text>
              )},
              { header: 'Return Acc.', key: 'return_accuracy', numeric: true, render: (row) => (
                row.return_accuracy != null ? (
                  <Text color={`${getColor('returnError', row.return_accuracy)}.500`}>
                    {formatValue(row.return_accuracy, 1)}%
                  </Text>
                ) : (
                  <Text color="gray.500">N/A</Text>
                )
              )},
              { header: 'Return Bias', key: 'return_accuracy_bias', numeric: true, render: (row) => (
                row.return_accuracy_bias != null ? (
                  <Tooltip
                    label={
                      <>
                        <Text>Upward Error: {formatValue(row.upward_error, 1)}%</Text>
                        <Text>Downward Error: {formatValue(row.downward_error, 1)}%</Text>
                      </>
                    }
                    fontSize="xs"
                    placement="top"
                    hasArrow
                  >
                    <Text cursor="help" color={`${getColor('bias', row.return_accuracy_bias)}.500`}>
                      {row.return_accuracy_bias > 0 ? '+' : ''}{formatValue(row.return_accuracy_bias, 1)}%
                    </Text>
                  </Tooltip>
                ) : (
                  <Text color="gray.500">N/A</Text>
                )
              )},
              { header: 'Predictions', key: 'predictions', numeric: true, render: (row) => (
                <Text>{row.correct_predictions}/{row.total_predictions}</Text>
              )},
              { header: 'Tier', key: 'tier', render: (row) => (
                <Badge size="xs" colorScheme={getColor('tier', row.tier)} variant="subtle">
                  {row.tier}
                </Badge>
              )}
            ]}
            data={symbol_performance}
          />
        </Box>
      )}
    </Collapse>
  );

  const AccuracySection = () => (
    <Collapse in={activeSection === 'accuracy'}>
      <VStack spacing={4} align="stretch">
        <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
          <Text fontSize="md" fontWeight="bold" mb={3}>Core Accuracy Metrics</Text>

          <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6} mb={6}>
            <Box p={4} bg={accentBg} borderRadius="md">
              <Text fontSize="sm" fontWeight="medium" mb={3}>Directional Accuracy</Text>
              <Flex justify="space-between" mb={3}>
                <Text fontSize="sm" color={textColor}>Overall</Text>
                <HStack>
                  <Text fontSize="sm" fontWeight="medium">
                    {accuracy_metrics.directional.correct} / {accuracy_metrics.directional.total}
                  </Text>
                  <Badge colorScheme={getColor('accuracy', accuracy_metrics.directional.accuracy)}>
                    {formatValue(accuracy_metrics.directional.accuracy, 1)}%
                  </Badge>
                </HStack>
              </Flex>
              <VStack spacing={2} align="stretch">
                {Object.entries(accuracy_metrics.action_breakdown).map(([action, stats]) => (
                  <Flex key={action} justify="space-between" align="center">
                    <Text fontSize="sm" fontWeight="medium">{action}</Text>
                    <HStack>
                      <Text fontSize="sm" color={textColor}>
                        {stats.correct}/{stats.total}
                      </Text>
                      <Badge colorScheme={getColor('accuracy', stats.accuracy)} size="sm">
                        {formatValue(stats.accuracy, 0)}%
                      </Badge>
                    </HStack>
                  </Flex>
                ))}
              </VStack>
            </Box>

            <Box p={4} bg={accentBg} borderRadius="md">
              <Text fontSize="sm" fontWeight="medium" mb={3}>Movement-Weighted Accuracy</Text>
              <Flex justify="space-between" mb={3}>
                <Text fontSize="sm" color={textColor}>Overall Weighted</Text>
                <Badge colorScheme="purple" fontSize="md">
                  {formatValue(accuracy_metrics.movement_weighted.accuracy, 1)}%
                </Badge>
              </Flex>
              <VStack spacing={2} align="stretch">
                {Object.entries(accuracy_metrics.action_breakdown).map(([action, stats]) =>
                  stats.movement_weighted_accuracy !== undefined && (
                    <Flex key={action} justify="space-between" align="center">
                      <Text fontSize="sm" fontWeight="medium">{action}</Text>
                      <Badge colorScheme="purple" size="sm">
                        {formatValue(stats.movement_weighted_accuracy, 0)}%
                      </Badge>
                    </Flex>
                  )
                )}
              </VStack>
            </Box>

            {accuracy_metrics?.return_accuracy && (
              <Box p={4} bg={accentBg} borderRadius="md">
                <Text fontSize="sm" fontWeight="medium" mb={3}>Return (Gradient) Accuracy</Text>
                <Flex justify="space-between" mb={2}>
                  <Text fontSize="sm" color={textColor}>Avg. Error</Text>
                  <Badge colorScheme={getColor('returnError', accuracy_metrics.return_accuracy.avg_error)} fontSize="md">
                    {formatValue(accuracy_metrics.return_accuracy.avg_error, 1)}%
                  </Badge>
                </Flex>
                <Flex justify="space-between" mb={3}>
                  <Text fontSize="sm" color={textColor}>Bias</Text>
                  <Tooltip
                    label={
                      <>
                        <Text>Upward Error: {formatValue(accuracy_metrics.return_accuracy.upward_error, 1)}%</Text>
                        <Text>Downward Error: {formatValue(accuracy_metrics.return_accuracy.downward_error, 1)}%</Text>
                      </>
                    }
                    fontSize="xs"
                    placement="top"
                    hasArrow
                  >
                    <Badge colorScheme={getColor('bias', accuracy_metrics.return_accuracy.bias)} fontSize="md" cursor="help">
                      {accuracy_metrics.return_accuracy.bias > 0 ? '+' : ''}{formatValue(accuracy_metrics.return_accuracy.bias, 1)}%
                    </Badge>
                  </Tooltip>
                </Flex>
                <Text fontSize="xs" color={textColor}>
                  Avg Error: How close the predicted return % was to actual. Bias: Difference in error between Up/Down moves.
                </Text>
              </Box>
            )}
          </SimpleGrid>

          {accuracy_metrics?.price && (
            <Box mt={4}>
              <Text fontSize="sm" fontWeight="medium" mb={3}>Price Accuracy by Trading Session</Text>
              <Text fontSize="xs" color={textColor} mb={3}>
                This shows the average error for absolute price points. Each card includes context on when the prediction was made relative to the event.
              </Text>
              <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
                {Object.entries(accuracy_metrics.price).map(([timepoint, data]) => {
                  const { icon: Icon, label, color } = getTimepointData(timepoint);
                  const ratingColor = getColor('rating', data.rating);

                  const timeDelta = data.prediction_timedelta_minutes;
                  let deltaText = '';
                  if (timeDelta != null) {
                    if (data.is_known) {
                      deltaText = `Known at prediction`;
                    } else {
                      const hours = Math.floor(timeDelta / 60);
                      const minutes = timeDelta % 60;
                      deltaText = `Pred. ${hours > 0 ? `${hours}h ` : ''}${minutes}m prior`;
                    }
                  }

                  return (
                    <Box key={timepoint} p={3} borderWidth="1px" borderColor={borderColor} borderRadius="md">
                      <Flex align="center" justify="space-between" mb={2}>
                        <Flex align="center" gap={2}>
                          <Icon size={16} color={`var(--chakra-colors-${color}-500)`} />
                          <Text fontSize="sm" fontWeight="medium">{label}</Text>
                        </Flex>
                        {data.is_known && (
                          <Tooltip label="Price was known at prediction time" fontSize="xs">
                            <Box>
                              <CheckCircle size={14} color="var(--chakra-colors-green-500)" />
                            </Box>
                          </Tooltip>
                        )}
                      </Flex>
                      <VStack align="start" spacing={1}>
                        <Flex justify="space-between" w="100%">
                          <Text fontSize="xs" color={textColor}>Avg Error</Text>
                          <Text fontSize="sm" fontWeight="bold">
                            {formatValue(data.avg_diff, 1)}%
                          </Text>
                        </Flex>
                        <Flex justify="space-between" w="100%">
                          <Text fontSize="xs" color={textColor}>Rating</Text>
                          <Badge size="xs" colorScheme={ratingColor}>
                            {data.rating}
                          </Badge>
                        </Flex>
                        {deltaText && (
                          <Text fontSize="10px" color="gray.500" pt={1}>
                            {deltaText}
                          </Text>
                        )}
                      </VStack>
                    </Box>
                  );
                })}
              </SimpleGrid>
            </Box>
          )}
        </Box>
      </VStack>
    </Collapse>
  );

  const ModelComparisonSection = () => (
    <Collapse in={activeSection === 'models'}>
      {model_comparison && (
        <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
          <Text fontSize="md" fontWeight="bold" mb={3}>Model Performance Comparison</Text>

          <MetricTable
            columns={[
              { header: 'Model', key: 'model', render: (row) => (
                <Text fontWeight="medium" textTransform="capitalize">{row.model}</Text>
              )},
              { header: 'Pool', key: 'pool', numeric: true, render: (row) => (
                row.total_predictions > 0 ? `${row.correct_predictions} / ${row.total_predictions}` : 'N/A'
              )},
              { header: 'Direction', key: 'direction_accuracy', numeric: true, render: (row) => (
                <Text color={`${getColor('accuracy', row.direction_accuracy)}.500`}>
                  {formatValue(row.direction_accuracy, 1)}%
                </Text>
              )},
              { header: 'Movement-Wtd', key: 'movement_weighted_accuracy', numeric: true, render: (row) => (
                <Text color="purple.500">
                  {formatValue(row.movement_weighted_accuracy, 1)}%
                </Text>
              )},
              { header: 'Return Acc.', key: 'return_accuracy', numeric: true, render: (row) => (
                row.return_accuracy?.avg_error != null ? (
                  <Text color={`${getColor('returnError', row.return_accuracy.avg_error)}.500`}>
                    {formatValue(row.return_accuracy.avg_error, 1)}%
                  </Text>
                ) : <Text color="gray.500">N/A</Text>
              )},
              { header: 'Return Bias', key: 'return_bias', numeric: true, render: (row) => (
                row.return_accuracy?.bias != null ? (
                  <Tooltip
                    label={
                      <>
                        <Text>Upward Error: {formatValue(row.return_accuracy.upward_error, 1)}%</Text>
                        <Text>Downward Error: {formatValue(row.return_accuracy.downward_error, 1)}%</Text>
                      </>
                    }
                    fontSize="xs"
                    placement="top"
                    hasArrow
                  >
                    <Text cursor="help" color={`${getColor('bias', row.return_accuracy.bias)}.500`}>
                      {row.return_accuracy.bias > 0 ? '+' : ''}{formatValue(row.return_accuracy.bias, 1)}%
                    </Text>
                  </Tooltip>
                ) : <Text color="gray.500">N/A</Text>
              )},
              { header: 'Best Timepoint', key: 'best_timepoint', render: (row) => {
                const bestTimepoint = Object.entries(row.price_errors || {})
                  .filter(([_, error]) => error !== null && error !== undefined)
                  .sort(([_, a], [__, b]) => a - b)[0];

                return bestTimepoint ? (
                  <VStack align="start" spacing={0}>
                    <Text fontSize="xs">{getTimepointData(bestTimepoint[0]).label}</Text>
                    <Badge size="xs" colorScheme={getColor('rating', row.price_ratings?.[bestTimepoint[0]])}>
                      {formatValue(bestTimepoint[1], 1)}% error
                    </Badge>
                  </VStack>
                ) : (
                  <Text fontSize="xs" color={textColor}>N/A</Text>
                );
              }}
            ]}
            data={Object.entries(model_comparison).map(([modelName, modelData]) => ({
              model: modelName,
              ...modelData
            }))}
          />

          {Object.keys(model_comparison).length > 0 && (
            <Box mt={6}>
              <Text fontSize="sm" fontWeight="medium" mb={3}>Detailed Price Accuracy by Timepoint</Text>
              <Tabs size="sm" variant="soft-rounded" colorScheme="blue">
                <TabList mb={4} flexWrap="wrap">
                  {Object.keys(model_comparison).map(modelName => (
                    <Tab key={modelName} fontSize="xs" textTransform="capitalize" m={1}>
                      {modelName} Model
                    </Tab>
                  ))}
                </TabList>

                <TabPanels>
                  {Object.entries(model_comparison).map(([modelName, modelData]) => (
                    <TabPanel key={modelName} p={0}>
                      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
                        {Object.entries(modelData.price_errors || {}).map(([timepoint, error]) => {
                          const { icon: Icon, label, color } = getTimepointData(timepoint);
                          const rating = modelData.price_ratings?.[timepoint] || 'N/A';
                          const ratingColor = getColor('rating', rating);

                          return (
                            <MetricBox
                              key={timepoint}
                              icon={Icon}
                              iconColor={color}
                              label={label}
                              value={error !== null && error !== undefined ? `${formatValue(error, 1)}% error` : 'No data'}
                              borderColor={borderColor}
                            >
                              {error !== null && error !== undefined && (
                                <Badge size="xs" colorScheme={ratingColor}>
                                  {rating}
                                </Badge>
                              )}
                            </MetricBox>
                          );
                        })}
                      </SimpleGrid>
                    </TabPanel>
                  ))}
                </TabPanels>
              </Tabs>
            </Box>
          )}
        </Box>
      )}
    </Collapse>
  );

  const PortfolioSection = () => (
    <Collapse in={activeSection === 'portfolio'}>
      {portfolio_metrics && (
        <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
          <Text fontSize="md" fontWeight="bold" mb={3}>Portfolio Performance Comparison</Text>

          {portfolio_metrics.returns && (
            <>
              <Text fontSize="sm" fontWeight="medium" mb={3} color={textColor}>Strategy Returns</Text>
              <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4} mb={4}>
                <MetricStat
                  label="Our Strategy"
                  value={`${portfolio_metrics.returns.strategy >= 0 ? '+' : ''}${formatValue(portfolio_metrics.returns.strategy, 1)}`}
                  suffix="%"
                  helpText="AI-driven decisions"
                  color={portfolio_metrics.returns.strategy >= 0 ? 'green' : 'red'}
                />

                <MetricStat
                  label="Buy & Hold"
                  value={`${portfolio_metrics.returns.buy_hold >= 0 ? '+' : ''}${formatValue(portfolio_metrics.returns.buy_hold, 1)}`}
                  suffix="%"
                  helpText="Passive strategy"
                  color={portfolio_metrics.returns.buy_hold >= 0 ? 'green' : 'red'}
                />

                <MetricStat
                  label="Perfect Timing"
                  value={`${portfolio_metrics.returns.perfect >= 0 ? '+' : ''}${formatValue(portfolio_metrics.returns.perfect, 1)}`}
                  suffix="%"
                  helpText="Theoretical maximum"
                  color="purple"
                />

                <MetricStat
                  label="Worst Timing"
                  value={`${portfolio_metrics.returns.worst >= 0 ? '+' : ''}${formatValue(portfolio_metrics.returns.worst, 1)}`}
                  suffix="%"
                  helpText="Theoretical minimum"
                  color="red"
                />
              </SimpleGrid>

              <Text fontSize="sm" fontWeight="medium" mb={3} color={textColor}>Performance Analysis</Text>
              <SimpleGrid columns={{ base: 2, md: 3 }} spacing={4} mb={4}>
                <MetricStat
                  label="vs Buy & Hold"
                  value={`${portfolio_metrics.returns.outperformance >= 0 ? '+' : ''}${formatValue(portfolio_metrics.returns.outperformance, 1)}`}
                  suffix="%"
                  helpText="Outperformance"
                  color={portfolio_metrics.returns.outperformance >= 0 ? 'green' : 'red'}
                />

                <MetricStat
                  label="Missed Potential"
                  value={formatValue(portfolio_metrics.returns.max_potential, 1)}
                  suffix="%"
                  helpText="vs Perfect timing"
                  color="orange"
                />

                <MetricStat
                  label="Risk Avoided"
                  value={`+${formatValue(portfolio_metrics.returns.avoided_loss, 1)}`}
                  suffix="%"
                  helpText="vs Worst timing"
                  color="green"
                />
              </SimpleGrid>
            </>
          )}

          {portfolio_metrics.trades && (
            <>
              <Text fontSize="sm" fontWeight="medium" mb={2}>Trading Statistics</Text>
              <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
                <MetricStat
                  label="Total Trades"
                  value={portfolio_metrics.trades.total}
                />
                <MetricStat
                  label="Win Rate"
                  value={formatValue(portfolio_metrics.trades.win_rate, 1)}
                  suffix="%"
                  color={portfolio_metrics.trades.win_rate >= 60 ? 'green' : 'yellow'}
                />
                <MetricStat
                  label="Avg Win"
                  value={formatValue(portfolio_metrics.trades.avg_win, 1)}
                  suffix="%"
                  color="green"
                />
                <MetricStat
                  label="Profit Factor"
                  value={formatValue(portfolio_metrics.trades.profit_factor, 2)}
                  color={portfolio_metrics.trades.profit_factor >= 1 ? 'green' : 'red'}
                />
              </SimpleGrid>
            </>
          )}
        </Box>
      )}
    </Collapse>
  );

  const WeeklySection = () => (
    <Collapse in={activeSection === 'weekly'}>
      {weekly_performance && (
        <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
          <Text fontSize="md" fontWeight="bold" mb={3}>Weekly Performance Patterns</Text>

          <SimpleGrid columns={5} spacing={3} mb={4}>
            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(day => {
              const dayData = weekly_performance[day];
              return (
                <Box
                  key={day}
                  p={3}
                  borderRadius="md"
                  bg={accentBg}
                  borderLeft="3px solid"
                  borderLeftColor={dayData ? `${getColor('accuracy', dayData.accuracy)}.500` : 'gray.300'}
                >
                  <Text fontSize="xs" fontWeight="medium" mb={1}>{day.slice(0, 3)}</Text>
                  {dayData ? (
                    <VStack spacing={1} align="start">
                      <Box>
                        <Text fontSize="xs" color={textColor}>Directional</Text>
                        <Text fontSize="sm" fontWeight="bold" color={`${getColor('accuracy', dayData.accuracy)}.500`}>
                          {formatValue(dayData.accuracy, 0)}%
                        </Text>
                      </Box>
                      {dayData.movement_weighted_accuracy !== undefined && (
                        <Box>
                          <Text fontSize="xs" color={textColor}>Movement-Weighted</Text>
                          <Text fontSize="sm" fontWeight="bold" color="purple.500">
                            {formatValue(dayData.movement_weighted_accuracy, 0)}%
                          </Text>
                        </Box>
                      )}
                      <Text fontSize="xs" color={textColor}>
                        {dayData.correct}/{dayData.total}
                      </Text>
                    </VStack>
                  ) : (
                    <Text fontSize="xs" color={textColor}>No data</Text>
                  )}
                </Box>
              );
            })}
          </SimpleGrid>
        </Box>
      )}
    </Collapse>
  );

  const ConfidenceSection = () => (
    <Collapse in={activeSection === 'confidence'}>
      {confidence_correlation && (
        <Box p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
          <Text fontSize="md" fontWeight="bold" mb={4}>Confidence Calibration Analysis</Text>

          {confidence_correlation.data_summary && (
            <Box mb={6} p={3} bg={accentBg} borderRadius="md">
              <Text fontSize="sm" fontWeight="medium" mb={3}>Data Distribution Summary</Text>
              <SimpleGrid columns={{ base: 1, md: Object.keys(confidence_correlation.data_summary).length }} spacing={4}>
                {Object.entries(confidence_correlation.data_summary).map(([action, summary]) => (
                  <MetricBox
                    key={action}
                    label="Data Pool"
                    value={`${summary.total_predictions} predictions`}
                    borderColor={borderColor}
                  >
                    <Badge size="sm" colorScheme={getColor('action', action)} variant="solid" mb={2}>
                      {action}
                    </Badge>
                    <VStack align="start" spacing={1}>
                      <Text fontSize="xs" color={textColor}>
                        {summary.correct_predictions} correct ({formatValue(summary.overall_accuracy, 1)}%)
                      </Text>
                      <Text fontSize="xs" color={textColor}>
                        Confidence: {formatValue(summary.confidence_range.min * 100, 0)}% - {formatValue(summary.confidence_range.max * 100, 0)}%
                      </Text>
                      <Text fontSize="xs" color={textColor}>
                        Avg: {formatValue(summary.confidence_range.avg * 100, 1)}%
                      </Text>
                    </VStack>
                  </MetricBox>
                ))}
              </SimpleGrid>
            </Box>
          )}

          <Box mb={6} p={3} bg={accentBg} borderRadius="md">
            <Text fontSize="sm" fontWeight="medium" mb={3}>Confidence vs Accuracy Correlation</Text>
            <Text fontSize="xs" color={textColor} mb={3}>
              Positive correlation means higher confidence leads to better accuracy (well-calibrated).
              Each action is split into 4 equal-sized confidence quartiles for analysis.
            </Text>

            <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
              {Object.entries(confidence_correlation.calibration_summary).map(([action, correlation]) => (
                <MetricBox
                  key={action}
                  label="Correlation"
                  value={`${correlation > 0 ? '+' : ''}${formatValue(correlation * 100, 0)}%`}
                  subtitle={`${Math.abs(correlation) >= 0.5 ? 'Well calibrated' : Math.abs(correlation) >= 0.3 ? 'Moderately calibrated' : 'Poorly calibrated'}`}
                  borderColor={borderColor}
                >
                  <Badge size="sm" colorScheme={getColor('action', action)} variant="solid" mb={2}>
                    {action}
                  </Badge>
                  {confidence_correlation.data_summary?.[action] && (
                    <Text fontSize="xs" color={textColor} mt={1}>
                      {confidence_correlation.data_summary[action].total_predictions} samples
                    </Text>
                  )}
                </MetricBox>
              ))}
            </SimpleGrid>
          </Box>

          <Tabs size="sm" variant="soft-rounded" colorScheme="blue">
            <TabList mb={4}>
              {Object.keys(confidence_correlation.confidence_calibration).map(action => (
                <Tab key={action} fontSize="xs">
                  <Badge colorScheme={getColor('action', action)} variant="subtle" mr={2}>
                    {action}
                  </Badge>
                  Quartile Analysis
                  {confidence_correlation.data_summary?.[action] && (
                    <Text fontSize="xs" ml={1} color="gray.500">
                      ({confidence_correlation.data_summary[action].total_predictions})
                    </Text>
                  )}
                </Tab>
              ))}
            </TabList>

            <TabPanels>
              {Object.entries(confidence_correlation.confidence_calibration).map(([action, quartiles]) => (
                <TabPanel key={action} p={0}>
                  <Box>
                    <Text fontSize="sm" fontWeight="medium" mb={3}>
                      {action} Predictions: Confidence Quartile Breakdown
                    </Text>
                    <Text fontSize="xs" color={textColor} mb={4}>
                      Each quartile contains roughly 25% of {action} predictions, sorted by confidence level.
                      Well-calibrated models show increasing accuracy from bottom to top quartiles.
                    </Text>

                    <Box mb={4} p={3} bg="gray.50" _dark={{ bg: 'gray.800' }} borderRadius="md">
                      <Text fontSize="xs" fontWeight="medium" mb={2}>Quartile Distribution</Text>
                      <SimpleGrid columns={4} spacing={2}>
                        {quartiles.map((quartile, index) => (
                          <Box key={index} textAlign="center">
                            <Text fontSize="xs" fontWeight="bold" color={`${getColor('action', action)}.500`}>
                              {quartile.percentile_name || `Q${quartile.bucket_index}`}
                            </Text>
                            <Text fontSize="xs" color={textColor}>
                              {quartile.count} samples
                            </Text>
                            <Text fontSize="xs" color={textColor}>
                              ({formatValue(quartile.percentage_of_total, 1)}%)
                            </Text>
                          </Box>
                        ))}
                      </SimpleGrid>
                    </Box>

                    <VStack spacing={3} align="stretch">
                      {quartiles.map((quartile, index) => (
                        <Box key={index} p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
                          <Flex justify="space-between" align="center" mb={3}>
                            <VStack align="start" spacing={0}>
                              <Text fontSize="md" fontWeight="bold" color={`${getColor('action', action)}.500`}>
                                {quartile.percentile_name}
                              </Text>
                              <Text fontSize="xs" color={textColor}>
                                Confidence Range: {quartile.range}%
                              </Text>
                            </VStack>
                            <VStack align="end" spacing={0}>
                              <Badge size="sm" colorScheme="blue" variant="outline">
                                {quartile.count} predictions
                              </Badge>
                              <Text fontSize="xs" color={textColor}>
                                {formatValue(quartile.percentage_of_total, 1)}% of total
                              </Text>
                            </VStack>
                          </Flex>

                          <SimpleGrid columns={{ base: 2, md: 5 }} spacing={4} mb={3}>
                            <MetricStat
                              label="Accuracy Rate"
                              value={formatValue(quartile.accuracy, 1)}
                              suffix="%"
                              helpText={`${quartile.correct_predictions}/${quartile.count} correct`}
                              color={getColor('accuracy', quartile.accuracy)}
                              size="xs"
                            />

                            <MetricStat
                              label="Avg Confidence"
                              value={formatValue(quartile.avg_confidence, 1)}
                              suffix="%"
                              helpText={`Range: ${formatValue(quartile.confidence_bounds.min * 100, 0)}-${formatValue(quartile.confidence_bounds.max * 100, 0)}%`}
                              size="xs"
                            />

                            <MetricStat
                              label="Sample Size"
                              value={quartile.count}
                              helpText={quartile.count < 10 ? 'Small sample' : quartile.count < 20 ? 'Medium sample' : 'Good sample'}
                              size="xs"
                            />

                            <MetricStat
                              label="Calibration Gap"
                              value={formatValue(Math.abs(quartile.avg_confidence - quartile.accuracy), 1)}
                              suffix="%"
                              helpText={quartile.accuracy < quartile.avg_confidence ? 'Overconfident' : quartile.accuracy > quartile.avg_confidence ? 'Underconfident' : 'Well calibrated'}
                              color={Math.abs(quartile.avg_confidence - quartile.accuracy) < 10 ? 'green' : Math.abs(quartile.avg_confidence - quartile.accuracy) < 20 ? 'yellow' : 'red'}
                              size="xs"
                            />

                            <MetricStat
                              label="Quartile Rank"
                              value={`#${quartile.bucket_index}`}
                              helpText="of 4 quartiles"
                              size="xs"
                            />
                          </SimpleGrid>

                          <Box>
                            <Progress
                              size="md"
                              value={quartile.accuracy}
                              colorScheme={getColor('accuracy', quartile.accuracy)}
                              borderRadius="full"
                            />
                            {quartile.count < 10 && (
                              <Text fontSize="xs" color="orange.500" mt={1}>
                                ⚠️ Small sample size may reduce reliability
                              </Text>
                            )}
                          </Box>
                        </Box>
                      ))}
                    </VStack>

                    <Box mt={4} p={3} bg={accentBg} borderRadius="md">
                      <Text fontSize="xs" fontWeight="medium" mb={2}>Calibration Analysis</Text>
                      <Text fontSize="xs" color={textColor}>
                        {Object.entries(confidence_correlation.calibration_summary).find(([a]) => a === action)?.[1] > 0.3 ?
                          `✅ Your ${action} confidence shows good calibration. Higher confidence quartiles generally achieve better accuracy.` :
                          `⚠ Your ${action} confidence needs improvement. Weak correlation between confidence level and actual performance.`
                        }
                      </Text>

                      {quartiles.length >= 2 && (
                        <Box mt={2}>
                          <Text fontSize="xs" color={textColor}>
                            <strong>Performance Spread:</strong> Top quartile achieves {formatValue(quartiles[quartiles.length-1]?.accuracy || 0, 1)}% accuracy
                            vs {formatValue(quartiles[0]?.accuracy || 0, 1)}% for bottom quartile
                            ({formatValue(Math.abs((quartiles[quartiles.length-1]?.accuracy || 0) - (quartiles[0]?.accuracy || 0)), 1)}% difference)
                          </Text>
                        </Box>
                      )}

                      {confidence_correlation.data_summary?.[action] && confidence_correlation.data_summary[action].total_predictions < 20 && (
                        <Box mt={2} p={2} bg="orange.50" _dark={{ bg: 'orange.900' }} borderRadius="sm">
                          <Text fontSize="xs" color="orange.600" _dark={{ color: 'orange.300' }}>
                            ⚠️ Low sample size ({confidence_correlation.data_summary[action].total_predictions} predictions) may limit statistical significance.
                            Consider collecting more {action} predictions for better calibration analysis.
                          </Text>
                        </Box>
                      )}
                    </Box>
                  </Box>
                </TabPanel>
              ))}
            </TabPanels>
          </Tabs>
        </Box>
      )}
    </Collapse>
  );

  return (
    <PanelContainer
      mode="expandable"
      title={isPortfolioMode ? "Portfolio Prediction Accuracy" : "Prediction Accuracy Analysis"}
      icon={History}
      iconColor="blue.500"
      isExpanded={isPredictionAccuracyOpen}
      onToggleExpand={togglePredictionAccuracy}
      borderColor={borderColor}
      actions={
        <Flex align="center" gap={2}>
          {isPortfolioMode && (
            <Badge colorScheme="purple" variant="outline">
              {metadata.symbols_count} symbols
            </Badge>
          )}
          {accuracy_metrics?.directional && accuracy_metrics?.movement_weighted && (
            <>
              <Badge colorScheme={getColor('accuracy', accuracy_metrics.directional.accuracy)} variant="subtle">
                {formatValue(accuracy_metrics.directional.accuracy, 1)}% Directional
              </Badge>
              <Badge colorScheme="purple" variant="subtle">
                {formatValue(accuracy_metrics.movement_weighted.accuracy, 1)}% Movement-Wtd
              </Badge>
              {accuracy_metrics?.return_accuracy && (
                <Badge colorScheme={getColor('returnError', accuracy_metrics.return_accuracy.avg_error)} variant="outline">
                  {formatValue(accuracy_metrics.return_accuracy.avg_error, 1)}% Return Error
                </Badge>
              )}
            </>
          )}
          {movement_detection && (
            <Badge colorScheme="orange" variant="outline">
              {formatValue(movement_detection.significant_move_accuracy, 1)}% Sig. Move Accuracy
            </Badge>
          )}
          {trends?.master?.trend && (
            <Badge colorScheme={getColor('trend', trends.master.trend)} variant="outline">
              {trends.master.trend.toLowerCase()}
            </Badge>
          )}
          {predictionAccuracyData?.ai_analysis && (
            <Badge colorScheme="purple" variant="solid">
              AI Analyzed
            </Badge>
          )}
        </Flex>
      }
    >
      <VStack spacing={4} align="stretch">
        <OverviewSection />
        <Collapse in={activeSection === 'signals'}>
          <SignalPerformanceSection
            signal_performance={signal_performance}
            borderColor={borderColor}
            colorMode={colorMode}
          />
        </Collapse>
        <AIAnalysisSection />
        <MagnitudeAnalysisSection />
        <Collapse in={activeSection === 'trends'}>
          <TrendsSection trends={trends} colorMode={colorMode} borderColor={borderColor} />
        </Collapse>
        <AccuracySection />
        <ModelComparisonSection />
        <PortfolioSection />
        {isPortfolioMode && <SymbolRankingsSection />}
        <WeeklySection />
        <ConfidenceSection />
      </VStack>
    </PanelContainer>
  );
};

export { PredictionAccuracySection };