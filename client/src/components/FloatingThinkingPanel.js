import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  Box, Text, Flex, useColorMode, IconButton, Portal, Collapse, Heading
} from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import {
  X, Brain, Image, TrendingUp, Briefcase, Network, BarChart, Users, ChevronUp, ChevronDown, Maximize2, Minimize2
} from 'lucide-react';
import { UI_EFFECTS, LOG_COLORS, COLORS } from '../config/Config';
import { useDraggable } from './PanelContainer';

const MasterIcon = () => <TrendingUp size={16} />;
const ImageIcon = () => <Image size={16} />;
const PortfolioIcon = () => <Briefcase size={16} />;
const OptionsIcon = () => <Network size={16} />;
const VibeIcon = () => <Users size={16} />;
const HistoricalIcon = () => <BarChart size={16} />;

const sourceConfig = {
  'MASTER_ANALYTICS': { name: 'Master Analytics', color: COLORS.revised_prediction || LOG_COLORS.ai, icon: <MasterIcon /> },
  'IMAGE_ANALYTICS': { name: 'Image Analytics', color: COLORS.image_prediction || LOG_COLORS.enrichment, icon: <ImageIcon /> },
  'PORTFOLIO_ANALYTICS': { name: 'Portfolio Analytics', color: LOG_COLORS.portfolio, icon: <PortfolioIcon /> },
  'OPTIONS_ANALYTICS': { name: 'Options Analytics', color: COLORS.options_prediction || LOG_COLORS.options, icon: <OptionsIcon /> },
  'VIBE_ANALYSIS': { name: 'Vibe Analysis', color: COLORS.vibe_prediction || '#f97316', icon: <VibeIcon /> },
  'HISTORICAL_ANALYTICS': { name: 'Historical Analytics', color: LOG_COLORS.market, icon: <HistoricalIcon /> },
  'default': { name: 'Analysis', color: LOG_COLORS.debug, icon: <Brain size={16} /> }
};

const SingleStreamPanel = React.memo(({ source, content, isActive }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const { colorMode } = useColorMode();
  const config = sourceConfig[source] || sourceConfig.default;
  const contentRef = useRef(null);
  const prevIsActiveRef = useRef(false);

  const performantPulse = keyframes`
    0% { filter: drop-shadow(0 0 2px ${config.color}); }
    70% { filter: drop-shadow(0 0 8px ${config.color}); }
    100% { filter: drop-shadow(0 0 2px ${config.color}); }
  `;

  useEffect(() => {
    if (contentRef.current && isExpanded) {
      requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
      });
    }
  }, [content, isExpanded]);

  useEffect(() => {
    if (prevIsActiveRef.current && !isActive) {
      setIsExpanded(false);
    }
    prevIsActiveRef.current = isActive;
  }, [isActive]);


  return (
    <Box
      border="1px solid"
      borderColor={isActive ? config.color : (colorMode === 'dark' ? 'gray.700' : 'gray.300')}
      borderRadius="md"
      mb={2}
      boxShadow="md"
      bg={colorMode === 'dark' ? 'gray.800' : 'white'}
      transition="border-color 0.3s ease-in-out"
    >
      <Flex
        as="header"
        align="center"
        justify="space-between"
        p={2}
        bg={colorMode === 'dark' ? 'gray.700' : 'gray.100'}
        borderTopRadius="md"
        borderLeft="4px solid"
        borderLeftColor={config.color}
        cursor="pointer"
        onClick={() => setIsExpanded(prev => !prev)}
      >
        <Flex align="center">
          <Box color={config.color} mr={2}>{config.icon}</Box>
          <Text fontWeight="bold" fontSize="sm">{config.name}</Text>
          {isActive && (
            <Box ml={2} w={2} h={2} bg={config.color} borderRadius="full" sx={{ animation: `${performantPulse} 2s ease-in-out infinite` }} />
          )}
        </Flex>
        <IconButton
          icon={isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          size="xs"
          variant="ghost"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          isRound
        />
      </Flex>
      <Collapse in={isExpanded}>
        <Box
          ref={contentRef}
          p={3}
          minHeight="100px"
          maxHeight="250px"
          overflowY="auto"
          fontSize="xs"
          fontFamily="monospace"
          whiteSpace="pre-wrap"
          bg={colorMode === 'dark' ? 'gray.900' : 'gray.50'}
          borderBottomRadius="md"
        >
          {content || "Waiting for stream..."}
        </Box>
      </Collapse>
    </Box>
  );
});

const greenPulse = keyframes`
  0% { filter: drop-shadow(0 0 2px var(--chakra-colors-green-400)); }
  70% { filter: drop-shadow(0 0 8px var(--chakra-colors-green-400)); }
  100% { filter: drop-shadow(0 0 2px var(--chakra-colors-green-400)); }
`;

const FloatingThinkingPanel = ({ isOpen, onClose, thinkingStreams = [] }) => {
  const { colorMode } = useColorMode();
  const [isMinimized, setIsMinimized] = useState(false);

  const { position, panelRef, handleDragStart } = useDraggable(
    { x: window.innerWidth - 420, y: 20 },
    { width: 400, height: 'auto' },
    'thinkingStreamManagerState'
  );

  const groupedStreams = useMemo(() => {
    const groups = {};
    thinkingStreams.forEach(stream => {
      if (!groups[stream.source]) {
        groups[stream.source] = { content: '', isActive: false, lastUpdate: stream.timestamp };
      }
      groups[stream.source].content += stream.content;
      groups[stream.source].isActive = !stream.isComplete;
      if (stream.timestamp > groups[stream.source].lastUpdate) {
        groups[stream.source].lastUpdate = stream.timestamp;
      }
    });
    return Object.entries(groups).sort(([, a], [, b]) => new Date(b.lastUpdate) - new Date(a.lastUpdate));
  }, [thinkingStreams]);

  const isAnyStreamActive = useMemo(() => groupedStreams.some(([, data]) => data.isActive), [groupedStreams]);

  if (!isOpen) return null;

  return (
    <Portal>
      <Box
        ref={panelRef}
        position="fixed"
        left={`${position.x}px`}
        top={`${position.y}px`}
        width={isMinimized ? '300px' : '400px'}
        zIndex={1400}
        bg={colorMode === 'dark' ? 'gray.800' : 'gray.200'}
        borderRadius="lg"
        boxShadow="lg"
        border="1px solid"
        borderColor={isAnyStreamActive && isMinimized ? 'green.400' : (colorMode === 'dark' ? 'black' : 'gray.300')}
        transition="width 0.2s ease-in-out, border-color 0.3s ease-in-out"
        {...UI_EFFECTS.hardware.acceleration}
      >
        <Flex
          className="drag-handle"
          onMouseDown={handleDragStart}
          cursor="move"
          p={2}
          align="center"
          justifyContent="space-between"
          borderBottom="1px solid"
          borderColor={colorMode === 'dark' ? 'black' : 'gray.300'}
        >
          <Flex align="center">
             <Brain size={16} style={{ marginRight: '8px' }}/>
             <Heading size="sm">AI Analysis Streams</Heading>
             {isAnyStreamActive && (
                 <Box ml={2} w={2} h={2} bg="green.400" borderRadius="full" sx={{ animation: `${greenPulse} 2s ease-in-out infinite` }} />
             )}
          </Flex>
          <Flex>
            <IconButton
                icon={isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                size="xs"
                variant="ghost"
                aria-label={isMinimized ? 'Expand' : 'Minimize'}
                onClick={() => setIsMinimized(prev => !prev)}
                mr={1}
            />
            <IconButton icon={<X size={16} />} size="xs" variant="ghost" onClick={onClose} aria-label="Close" />
          </Flex>
        </Flex>

        <Collapse in={!isMinimized} animateOpacity>
            <Box p={2}>
              {groupedStreams.length > 0 ? (
                groupedStreams.map(([source, data]) => (
                  <SingleStreamPanel
                    key={source}
                    source={source}
                    content={data.content}
                    isActive={data.isActive}
                  />
                ))
              ) : (
                <Flex justify="center" align="center" height="100px" bg={colorMode === 'dark' ? 'gray.900' : 'white'} borderRadius="md">
                  <Text color="gray.500">Waiting for AI analysis...</Text>
                </Flex>
              )}
            </Box>
        </Collapse>
      </Box>
    </Portal>
  );
};

export default FloatingThinkingPanel;