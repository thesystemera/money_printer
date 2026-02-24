import React, { useState } from 'react';
import {
  Box, Flex, Button, Text, Spinner, useColorMode, HStack
} from '@chakra-ui/react';
import { RefreshCw, Brain } from 'lucide-react';
import { PredictionAccuracySection } from './RecommendationPredictionAccuracy';
import { getSectionColors } from './RecommendationHelper';
import { TimeElapsedBadge } from './PortfolioPanel';

const PortfolioPredictionAccuracyPanel = ({
  portfolioData,
  isLoading,
  isAnalyzing,
  onRequestAnalysis
}) => {
  const [isPredictionAccuracyOpen, setIsPredictionAccuracyOpen] = useState(true);
  const { colorMode } = useColorMode();
  const { borderColor } = getSectionColors(colorMode);

  if (isLoading && !portfolioData) {
    return (
      <Box height="100%" width="100%" p={4} display="flex" flexDirection="column">
        <Flex justify="center" align="center" py={10}>
          <Spinner mr={3} color="blue.500" />
          <Text>Loading portfolio prediction accuracy...</Text>
        </Flex>
      </Box>
    );
  }

  if (!portfolioData) {
    return (
        <Box height="100%" width="100%" p={4} display="flex" flexDirection="column">
            <Flex justify="center" align="center" py={10}>
                <Text>No portfolio data available to analyze accuracy.</Text>
            </Flex>
        </Box>
    );
  }

  const hasAIAnalysis = portfolioData?.ai_analysis;
  const hasAIError = portfolioData?.ai_analysis_error;
  const lastFetched = portfolioData?.timestamp ? new Date(portfolioData.timestamp) : null;

  return (
    <Box width="100%" p={4} display="flex" flexDirection="column">
      <Flex justify="space-between" mb={4} align="center">
        {lastFetched ? (
            <TimeElapsedBadge timestamp={lastFetched.getTime()} />
        ) : <Box />}

        <HStack spacing={2}>
          <Button
            size="sm"
            variant="outline"
            colorScheme="purple"
            onClick={() => onRequestAnalysis({ includeClaudeAnalysis: true })}
            isLoading={isAnalyzing}
            isDisabled={!portfolioData || isLoading}
            leftIcon={<Brain size={14} />}
          >
            {hasAIAnalysis ? 'Re-analyze' : 'Analyze with AI'}
          </Button>

          <Button
            size="sm"
            variant="outline"
            colorScheme="teal"
            onClick={() => onRequestAnalysis({ forceRefresh: true })}
            isLoading={isLoading && !isAnalyzing}
            leftIcon={<RefreshCw size={14} />}
          >
            Refresh
          </Button>
        </HStack>
      </Flex>

      {hasAIError && (
        <Box mb={4} p={3} bg="red.50" _dark={{ bg: 'red.900' }} borderRadius="md" borderLeft="4px solid" borderLeftColor="red.500">
          <Text fontSize="sm" color="red.600" _dark={{ color: 'red.300' }}>
            <strong>AI Analysis Failed:</strong> {hasAIError}
          </Text>
        </Box>
      )}

      <PredictionAccuracySection
        predictionAccuracyData={portfolioData}
        isPredictionAccuracyOpen={isPredictionAccuracyOpen}
        togglePredictionAccuracy={() => setIsPredictionAccuracyOpen(!isPredictionAccuracyOpen)}
        borderColor={borderColor}
        colorMode={colorMode}
      />
    </Box>
  );
};

export default PortfolioPredictionAccuracyPanel;