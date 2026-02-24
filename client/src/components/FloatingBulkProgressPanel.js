import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Text, Flex, useColorMode, Portal, Progress,
  Tooltip, Badge, VStack, HStack, IconButton, Heading,
  Button, Checkbox, Divider, TabList, TabPanels, Tab,
  Tabs, TabPanel
} from '@chakra-ui/react';
import {
  X, Maximize2, Minimize2, Play, Pause, Clock, CheckCircle,
  AlertCircle, RefreshCw, BarChart, List as ListIcon, History,
  AlertTriangle, StopCircle, Image, TrendingUp, Activity, PieChart, BarChart3, Zap
} from 'lucide-react';
import { UI_ANIMATIONS, UI_EFFECTS } from '../config/Config';
import { addLog, sendCancelMessage, sendPauseMessage } from '../services/socketService';
import { useDraggable } from './PanelContainer';
import { formatDuration } from './SearchBar';
import { useProgressTracker } from '../hooks/useProgressTracker';

const getRecommendationColor = (action) => {
  switch (action?.toUpperCase()) {
    case 'BUY': return 'green';
    case 'SELL': return 'red';
    case 'HOLD': return 'gray';
    default: return 'yellow';
  }
};

const FloatingBulkProgressPanel = ({
  isOpen,
  onClose,
  isMinimized = false,
  onToggleMinimize,
  activeAnalysisState = null,
  onStartBulkAnalysis,
  onPauseResume = null,
  onCancel = null,
  isPaused = false,
  isProcessing = false,
  isTuning = false,
  recentSearches = [],
  settings,
  analysisStatus = null,
  tunerResults = null
}) => {
  const [tabIndex, setTabIndex] = useState(isProcessing ? 1 : 0);
  const [selectedStocks, setSelectedStocks] = useState({});
  const [selectAll, setSelectAll] = useState(false);

  const {
    position,
    dimensions,
    panelRef,
    handleDragStart
  } = useDraggable(
    { x: 20, y: 80 },
    { width: 450, height: 550, minHeight: 550 },
    'bulkProgressPanelState'
  );

  const { colorMode } = useColorMode();

  const stages = useProgressTracker(
    analysisStatus,
    activeAnalysisState?.currentProgress?.stage,
    null,
    tunerResults,
    isTuning
  );

  const bgColor = colorMode === 'dark' ? 'gray.800' : 'white';
  const borderColor = colorMode === 'dark' ? 'gray.700' : 'gray.200';
  const textColor = colorMode === 'dark' ? 'gray.400' : 'gray.600';

  useEffect(() => {
    if (recentSearches.length > 0) {
      const initialSelected = {};
      recentSearches.forEach(item => {
        initialSelected[item.symbol] = true;
      });
      setSelectedStocks(initialSelected);
      setSelectAll(true);
    }
  }, [recentSearches]);

  useEffect(() => {
    setTabIndex(isProcessing ? 1 : 0);
  }, [isProcessing]);

  const toggleSelectAll = useCallback(() => {
    const newSelectAll = !selectAll;
    setSelectAll(newSelectAll);

    const newSelectedStocks = {};
    recentSearches.forEach(item => {
      newSelectedStocks[item.symbol] = newSelectAll;
    });
    setSelectedStocks(newSelectedStocks);
  }, [selectAll, recentSearches]);

  const toggleStock = useCallback((symbol) => {
    setSelectedStocks(prev => {
      const newSelectedStocks = { ...prev, [symbol]: !prev[symbol] };

      const allSelected = recentSearches.every(item => newSelectedStocks[item.symbol]);
      setSelectAll(allSelected);

      return newSelectedStocks;
    });
  }, [recentSearches]);

  const handleStartAnalysis = useCallback(() => {
    const orderedSymbols = recentSearches.slice().reverse().map(item => item.symbol);
    const selectedSymbols = orderedSymbols.filter(symbol => selectedStocks[symbol]);

    if (selectedSymbols.length === 0) {
      addLog('No stocks selected for bulk analysis', 'warning');
      return;
    }

    addLog(`Starting bulk analysis for ${selectedSymbols.length} stocks`, 'info');
    onStartBulkAnalysis(selectedSymbols);
    setTabIndex(1);
  }, [selectedStocks, onStartBulkAnalysis, recentSearches]);

  const handlePauseResume = useCallback(() => {
    if (!activeAnalysisState?.currentStock) {
      addLog('No active stock to pause/resume', 'warning');
      return;
    }

    const currentSymbol = activeAnalysisState.currentStock;
    const success = sendPauseMessage(currentSymbol, isPaused);

    if (success) {
      const action = isPaused ? 'resume' : 'pause';
      addLog(`${action} request sent for ${currentSymbol}`, 'info');
      if (onPauseResume) {
        onPauseResume();
      }
    } else {
      addLog(`Failed to send ${isPaused ? 'resume' : 'pause'} request`, 'error');
    }
  }, [activeAnalysisState?.currentStock, isPaused, onPauseResume]);

  const handleCancel = useCallback(() => {
    if (!activeAnalysisState?.currentStock) {
      addLog('No active analysis to cancel', 'warning');
      if (onCancel) {
        onCancel();
      }
      return;
    }

    const currentSymbol = activeAnalysisState.currentStock;
    const success = sendCancelMessage(currentSymbol);

    if (success) {
      addLog(`Cancel request sent for ${currentSymbol}`, 'warning');
      if (onCancel) {
        onCancel();
      }
    } else {
      addLog('Failed to send cancel request', 'error');
    }
  }, [activeAnalysisState?.currentStock, onCancel]);

  if (!isOpen) return null;

  const selectedCount = Object.values(selectedStocks).filter(selected => selected).length;
  const totalStocks = activeAnalysisState?.totalCount || 0;
  const completedCount = (activeAnalysisState?.completedStocks?.length || 0) + (activeAnalysisState?.failedStocks?.length || 0);
  const percentComplete = totalStocks > 0 ? (completedCount / totalStocks) * 100 : 0;

  const getProgressPercent = () => {
    if (isTuning) {
        const { progress = 0, total = 1 } = activeAnalysisState.tunerProgress || {};
        return total > 0 ? (progress / total) * 100 : 0;
    }
    if (!activeAnalysisState?.currentStock) return 0;
    return activeAnalysisState.currentProgress?.percentage || 0;
  };

  const getImageIcon = (category) => {
    const iconMap = {
      'SENTIMENT_TEMPORAL': TrendingUp,
      'SENTIMENT_COMBINED': Activity,
      'SENTIMENT_RECENT': BarChart,
      'OPTIONS_ANALYSIS': PieChart,
      'PREDICTION_HISTORY': BarChart3,
      'HISTORICAL_ANALYSIS': History,
    };
    return iconMap[category] || Image;
  };

  const getImageLabel = (category) => {
    const labelMap = {
      'SENTIMENT_TEMPORAL': 'Temporal Impact',
      'SENTIMENT_COMBINED': 'Combined Analysis',
      'SENTIMENT_RECENT': 'Recent Trends',
      'OPTIONS_ANALYSIS': 'Options Chart',
      'PREDICTION_HISTORY': 'Prediction History',
      'HISTORICAL_ANALYSIS': 'Historical Analysis'
    };
    return labelMap[category] || category;
  };

  const renderProgressContent = () => {
    if (!activeAnalysisState) return <Text>No analysis in progress</Text>;

    const isBulkMode = activeAnalysisState.totalCount > 1;

    return (
      <Box>
        <Flex justify="space-between" align="center" mb={2}>
          <Text fontSize="sm" fontWeight="medium">Overall Progress</Text>
          {isBulkMode && (
            <Badge colorScheme="blue">
              {completedCount} of {totalStocks} complete
            </Badge>
          )}
        </Flex>

        {isBulkMode && (
          <Progress
            value={percentComplete}
            size="sm"
            colorScheme={activeAnalysisState.error ? "red" : (isPaused ? "orange" : "blue")}
            mb={3}
            borderRadius="full"
            hasStripe
            isAnimated={!isPaused && !activeAnalysisState.error}
          />
        )}

        {activeAnalysisState.currentStock && (
          <Box mb={3}>
            <Flex justify="space-between" align="center" mb={2}>
              <HStack>
                <Heading size="sm">{activeAnalysisState.currentStock}</Heading>
                <Badge colorScheme={isTuning ? "yellow" : "purple"} variant="solid" fontSize="xs">
                  {isTuning ? "Auto-Tuning" : "Currently Processing"}
                </Badge>
              </HStack>
            </Flex>

            <VStack spacing={2} align="stretch" mb={3}>
              {stages.slice(0, 9).map((stage) => {
                const isCurrent = stage.status === 'active';
                const isComplete = stage.status === 'complete';

                let icon;
                if (isComplete) {
                    icon = <CheckCircle size={16} color="var(--chakra-colors-green-500)" />;
                } else if (isCurrent) {
                    if (stage.key === 'tuning') {
                        icon = <Zap size={16} style={{ animation: 'spin 2s linear infinite', color: 'var(--chakra-colors-yellow-500)' }} />;
                    } else {
                        icon = <RefreshCw size={16} style={{ animation: 'spin 2s linear infinite', color: 'var(--chakra-colors-blue-500)' }} />;
                    }
                } else {
                    icon = <Clock size={16} color="var(--chakra-colors-gray-400)" />;
                }
                const colorScheme = stage.key === 'tuning' && isCurrent ? 'yellow' : isComplete ? 'green' : isCurrent ? 'blue' : 'gray';

                return (
                  <Flex key={stage.key} align="center" justify="space-between" p={2}
                        bg={isCurrent ? (colorMode === 'dark' ? `${colorScheme}.900` : `${colorScheme}.50`) : 'transparent'}
                        borderRadius="md" transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}>
                    <HStack>
                      <Box>{icon}</Box>
                      <Text fontSize="sm" fontWeight={isCurrent ? "bold" : "normal"}>{stage.label}</Text>
                    </HStack>
                    <Badge
                      colorScheme={colorScheme}
                      variant={isCurrent ? "solid" : "outline"}
                      fontSize="xs"
                    >
                      {isComplete ? "DONE" : isCurrent ? "ACTIVE" : "PENDING"}
                    </Badge>
                  </Flex>
                );
              })}
            </VStack>

            {isTuning && activeAnalysisState.tunerProgress && (
                <Box mb={3}>
                    <Text fontSize="xs" fontWeight="medium" mb={1}>Tuning Progress: {activeAnalysisState.tunerProgress.phaseName}</Text>
                    <Progress
                        value={(activeAnalysisState.tunerProgress.progress / (activeAnalysisState.tunerProgress.total || 1)) * 100}
                        size="xs" colorScheme="yellow" hasStripe isAnimated
                    />
                    <Text fontSize="xs" color={textColor} fontStyle="italic" textAlign="center" mt={1}>
                        {activeAnalysisState.tunerProgress.progress} / {activeAnalysisState.tunerProgress.total} iterations
                    </Text>
                </Box>
            )}

            {activeAnalysisState.generatedImages && (
              <Box mb={3}>
                <Text fontSize="xs" fontWeight="medium" mb={2}>Visualization Images</Text>
                <VStack spacing={1} align="stretch">
                  {Object.entries(activeAnalysisState.generatedImages).map(([category, isGenerated]) => {
                    const IconComponent = getImageIcon(category);
                    return (
                      <Flex key={category} align="center" justify="space-between" p={1}
                            bg={colorMode === 'dark' ? 'gray.700' : 'white'}
                            borderRadius="md">
                        <HStack>
                          <IconComponent size={14} color={isGenerated ? 'var(--chakra-colors-green-500)' : 'var(--chakra-colors-gray-400)'} />
                          <Text fontSize="xs">{getImageLabel(category)}</Text>
                        </HStack>
                        <Badge
                          colorScheme={isGenerated ? "green" : "gray"}
                          variant={isGenerated ? "solid" : "outline"}
                          fontSize="xs"
                        >
                          {isGenerated ? "✓" : "○"}
                        </Badge>
                      </Flex>
                    );
                  })}
                </VStack>
              </Box>
            )}

            {activeAnalysisState.currentProgress?.message && !isTuning && (
              <Text fontSize="xs" color={textColor} fontStyle="italic" textAlign="center">
                {activeAnalysisState.currentProgress.message}
              </Text>
            )}

            {analysisStatus && !isTuning && (
              <Text fontSize="xs" color={textColor} textAlign="center" mt={2}>
                Articles: {analysisStatus.stockCompleted ? '✓' : '○'} Stock • {analysisStatus.marketCompleted ? '✓' : '○'} Market • {analysisStatus.industryCompleted ? '✓' : '○'} Industry
              </Text>
            )}
          </Box>
        )}

        <Flex gap={3} mt={4}>
          {onPauseResume && (
            <Button
              size="sm"
              leftIcon={isPaused ? <Play size={14} /> : <Pause size={14} />}
              colorScheme={isPaused ? "green" : "orange"}
              onClick={handlePauseResume}
              flex="1"
              isDisabled={!activeAnalysisState?.currentStock || !isBulkMode}
            >
              {isPaused ? "Resume" : "Pause"}
            </Button>
          )}

          {onCancel && (
            <Button
              size="sm"
              leftIcon={<StopCircle size={14} />}
              colorScheme="red"
              variant="outline"
              onClick={handleCancel}
              flex="1"
            >
              Cancel
            </Button>
          )}
        </Flex>

        {isBulkMode && (
          <>
            <Divider my={3} />
            <Box>
              <Text fontSize="xs" fontWeight="medium" mb={1}>Up Next</Text>
              {(() => {
                const queuedStocks = activeAnalysisState.queue?.filter(symbol => symbol !== activeAnalysisState.currentStock) || [];
                if (queuedStocks.length === 0) {
                  return <Text fontSize="xs" color={textColor} fontStyle="italic">Queue empty</Text>;
                }
                return (
                  <VStack spacing={1} align="stretch">
                    {queuedStocks.slice(0, Math.min(5, queuedStocks.length)).map((symbol, index) => (
                      <Flex key={`queue-${symbol}-${index}`} p={1} bg={colorMode === 'dark' ? 'gray.700' : 'white'} borderRadius="md" align="center">
                        <Badge colorScheme="blue" variant="outline" fontSize="0.6em" mr={1}>{index + 1}</Badge>
                        <Text fontSize="xs" fontWeight="medium">{symbol}</Text>
                      </Flex>
                    ))}
                    {queuedStocks.length > 5 && (
                      <Text fontSize="xs" color={textColor} textAlign="center">+{queuedStocks.length - 5} more</Text>
                    )}
                  </VStack>
                );
              })()}
            </Box>
            <Box mt={4}>
              <Text fontSize="xs" fontWeight="medium" mb={1}>Completed</Text>
              {(!activeAnalysisState.completedStocks || activeAnalysisState.completedStocks.length === 0) &&
               (!activeAnalysisState.failedStocks || activeAnalysisState.failedStocks.length === 0) ? (
                <Text fontSize="xs" color={textColor} fontStyle="italic">No completed analyses yet</Text>
              ) : (
                <VStack spacing={1} align="stretch">
                  {[...(activeAnalysisState.completedStocks || []), ...(activeAnalysisState.failedStocks || [])]
                    .slice(-5).map((stockInfo, index) => (
                    <Box key={`completed-${stockInfo.symbol}-${index}`}>
                      <Flex p={1} bg={colorMode === 'dark' ? 'gray.700' : 'white'} borderRadius="md" align="center" justify="space-between">
                        <Flex align="center">
                          <Badge colorScheme={stockInfo.status === 'ERROR' ? 'red' : 'green'} variant="subtle" fontSize="0.6em" mr={1}>
                            {stockInfo.status === 'ERROR' ? <AlertCircle size={10} /> : <CheckCircle size={10} />}
                          </Badge>
                          <Text fontSize="xs" fontWeight="medium">{stockInfo.symbol}</Text>
                          {stockInfo.action && stockInfo.action !== 'N/A' && (
                            <Badge ml={2} colorScheme={getRecommendationColor(stockInfo.action)} variant="solid">
                              {stockInfo.action}
                            </Badge>
                          )}
                        </Flex>
                        <Tooltip label={new Date(stockInfo.completedAt).toLocaleString()}>
                          <Flex align="center">
                            <Clock size={10} style={{ marginRight: '2px' }} />
                            <Text fontSize="xs" color={textColor}>{formatDuration(stockInfo.duration)}</Text>
                          </Flex>
                        </Tooltip>
                      </Flex>
                      {stockInfo.generatedImages && (
                        <Flex wrap="wrap" gap={1} mt={1} justify="center">
                          {Object.entries(stockInfo.generatedImages).map(([category, isGenerated]) => {
                            if (!isGenerated) return null;
                            const IconComponent = getImageIcon(category);
                            return (
                              <Tooltip key={category} label={getImageLabel(category)}>
                                <Box><IconComponent size={10} color="var(--chakra-colors-green-500)" /></Box>
                              </Tooltip>
                            );
                          })}
                        </Flex>
                      )}
                    </Box>
                  ))}
                  {completedCount > 5 && (
                    <Text fontSize="xs" color={textColor} textAlign="center">+{completedCount - 5} more</Text>
                  )}
                </VStack>
              )}
            </Box>
          </>
        )}

        {activeAnalysisState.error && (
          <Box mt={3} p={2} bg="red.900" borderRadius="md">
            <Heading size="xs" color="red.200" mb={1}>Error</Heading>
            <Text fontSize="xs" color="red.200">{activeAnalysisState.error.message || activeAnalysisState.error || 'An unknown error occurred'}</Text>
          </Box>
        )}
      </Box>
    );
  };

  const renderSelectionContent = () => {
    return (
      <Box display="flex" flexDirection="column" height="100%">
        <Flex justify="space-between" align="center" mb={2}>
          <Text fontSize="sm" fontWeight="medium">Select Stocks to Analyze</Text>
          <Tooltip label={selectAll ? 'Deselect all' : 'Select all'}>
            <Button
              size="xs"
              leftIcon={<ListIcon size={12} />}
              variant="outline"
              onClick={toggleSelectAll}
              transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
            >
              {selectAll ? 'Deselect All' : 'Select All'}
            </Button>
          </Tooltip>
        </Flex>

        {settings.disableAutoRecommendation && (
          <Flex mb={4} p={2} bg="yellow.800" borderRadius="md" alignItems="center">
            <AlertTriangle size={14} style={{ marginRight: '8px', color: 'orange' }} />
            <Text fontSize="xs" color="yellow.100">
              Auto-recommendations are disabled in settings. Bulk analysis will only collect data.
            </Text>
          </Flex>
        )}

        <Box
          flex="1"
          overflowY="auto"
          borderRadius="md"
          borderWidth="1px"
          borderColor={colorMode === 'dark' ? 'gray.600' : 'gray.200'}
          mb={4}
        >
          {recentSearches.length === 0 ? (
            <Flex justify="center" align="center" p={4} minHeight="200px">
              <VStack spacing={2}>
                <History size={24} color={colorMode === 'dark' ? '#718096' : '#A0AEC0'} />
                <Text color={textColor}>No recent searches found</Text>
                <Text fontSize="xs" color={textColor}>
                  Search for stocks first to add them to your analysis queue
                </Text>
              </VStack>
            </Flex>
          ) : (
            <VStack spacing={0} align="stretch" maxHeight="300px" overflowY="auto">
              {recentSearches.slice().reverse().map((item, index) => (
                <HStack
                  key={`stock-${item.symbol}-${index}`}
                  p={2}
                  bg={index % 2 === 0 ? (colorMode === 'dark' ? 'gray.800' : 'white') : (colorMode === 'dark' ? 'gray.700' : 'gray.50')}
                  borderBottomWidth={index < recentSearches.length - 1 ? '1px' : '0'}
                  borderBottomColor={colorMode === 'dark' ? 'gray.600' : 'gray.200'}
                  transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
                >
                  <Checkbox
                    isChecked={selectedStocks[item.symbol] || false}
                    onChange={() => toggleStock(item.symbol)}
                    colorScheme="blue"
                  >
                    <Text fontWeight="bold" fontSize="sm">{item.symbol}</Text>
                  </Checkbox>

                  <Text fontSize="xs" color={textColor} flex="1" isTruncated>
                    {new Date(item.date).toLocaleString()}
                  </Text>
                </HStack>
              ))}
            </VStack>
          )}
        </Box>

        <Button
          width="100%"
          colorScheme="blue"
          leftIcon={<Play size={14} />}
          onClick={handleStartAnalysis}
          isDisabled={selectedCount === 0 || isProcessing}
          transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
          mt="auto"
        >
          Start Analysis ({selectedCount})
        </Button>

        <Text fontSize="xs" mt={3} color={textColor}>
          Bulk analysis will process each selected stock in sequence using your current settings.
          This process may take several minutes per stock.
        </Text>
      </Box>
    );
  };

  return (
    <Portal>
      <Box
        ref={panelRef}
        position="fixed"
        left={`${position.x}px`}
        top={`${position.y}px`}
        width={isMinimized ? '300px' : `${dimensions.width}px`}
        height={isMinimized ? 'auto' : dimensions.height}
        minHeight={!isMinimized ? dimensions.minHeight : "auto"}
        bg={bgColor}
        borderRadius="md"
        boxShadow="lg"
        zIndex={1000}
        border="1px solid"
        borderColor={isPaused ? 'orange.400' : (activeAnalysisState?.error ? 'red.400' : (isTuning ? 'yellow.400' : borderColor))}
        display="flex"
        flexDirection="column"
        overflow="hidden"
        opacity={0.95}
        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
        _hover={{ opacity: 1 }}
        {...UI_EFFECTS.hardware.acceleration}
      >
        <Flex
          className="drag-handle"
          py={2} px={3}
          bg={colorMode === 'dark' ? 'gray.700' : 'gray.100'}
          justify="space-between"
          align="center"
          cursor="move"
          onMouseDown={handleDragStart}
          borderBottom="1px solid"
          borderColor={borderColor}
        >
          <Flex align="center">
            <BarChart size={14} style={{ marginRight: '8px' }} />
            <Text fontWeight="medium" fontSize="sm">
              Bulk Stock Analysis {isProcessing && isPaused ? '(Paused)' : ''} {isTuning ? '(Tuning)' : ''}
            </Text>
          </Flex>

          <Flex>
            <Tooltip label={isMinimized ? 'Expand' : 'Minimize'}>
              <IconButton
                icon={isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                size="xs"
                variant="ghost"
                aria-label={isMinimized ? 'Expand' : 'Minimize'}
                onClick={onToggleMinimize}
                mr={1}
                transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
              />
            </Tooltip>
            <Tooltip label="Close">
              <IconButton
                icon={<X size={14} />}
                size="xs"
                variant="ghost"
                aria-label="Close"
                onClick={onClose}
                transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
              />
            </Tooltip>
          </Flex>
        </Flex>

        {!isMinimized && (
          <Box p={4} flex="1" overflow="hidden" display="flex" flexDirection="column">
            <Tabs
              index={tabIndex}
              onChange={setTabIndex}
              variant="enclosed"
              size="sm"
              isFitted
              isLazy
              flex="1"
              display="flex"
              flexDirection="column"
              height="100%"
            >
              <TabList mb={3}>
                <Tab isDisabled={isProcessing && !isPaused}>Setup</Tab>
                <Tab isDisabled={!isProcessing && !activeAnalysisState}>Progress</Tab>
              </TabList>

              <TabPanels flex="1" display="flex" flexDirection="column" overflow="hidden">
                <TabPanel height="100%" display="flex" flexDirection="column" px={2} py={2}>
                  {renderSelectionContent()}
                </TabPanel>
                <TabPanel flex="1" overflowY="auto">
                  {renderProgressContent()}
                </TabPanel>
              </TabPanels>
            </Tabs>
          </Box>
        )}

        {isMinimized && isProcessing && activeAnalysisState?.currentStock && (
          <Box p={2}>
            <Flex align="center" justify="space-between" mb={1}>
              <Text fontSize="sm" fontWeight="medium">{activeAnalysisState.currentStock}</Text>
              <Badge colorScheme={isPaused ? "orange" : (isTuning ? "yellow" : "blue")}>
                {isPaused ? "Paused" : (isTuning ? "Tuning" : "Processing")}
              </Badge>
            </Flex>
            <Progress
              value={getProgressPercent()}
              size="xs"
              colorScheme={isPaused ? "orange" : (isTuning ? "yellow" : "blue")}
              isIndeterminate={!isPaused && !isTuning && activeAnalysisState.currentProgress?.stage !== 'COMPLETE'}
              hasStripe={isTuning}
              isAnimated={isTuning}
            />
            <Text fontSize="xs" mt={1}>
              {activeAnalysisState.totalCount > 1 ? `${completedCount} of ${totalStocks} complete` : (activeAnalysisState.tunerProgress ? `${activeAnalysisState.tunerProgress.phaseName}` : 'Analysis in progress...')}
            </Text>

            {activeAnalysisState.generatedImages && (
              <Flex wrap="wrap" gap={1} mt={1} justify="center">
                {Object.entries(activeAnalysisState.generatedImages).map(([category, isGenerated]) => {
                  if (!isGenerated) return null;
                  const IconComponent = getImageIcon(category);
                  return (
                    <Tooltip key={category} label={getImageLabel(category)}>
                      <Box>
                        <IconComponent size={8} color="var(--chakra-colors-green-500)" />
                      </Box>
                    </Tooltip>
                  );
                })}
              </Flex>
            )}
          </Box>
        )}
      </Box>
    </Portal>
  );
};

export default FloatingBulkProgressPanel;