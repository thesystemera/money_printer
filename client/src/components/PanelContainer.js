import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Box, IconButton, Tooltip, useColorMode, Heading, Flex,
  Button, Collapse, Icon as ChakraIcon
} from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import {
  Maximize2, Minimize2, ChevronUp, ChevronDown, Lock
} from 'lucide-react';
import { THEME, PANEL_MODES, UI_ANIMATIONS, UI_EFFECTS } from '../config/Config';

export const useDraggable = (initialPosition = { x: 20, y: 20 }, initialDimensions = { width: 500, height: 300 }, storageKey = null) => {
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState(initialDimensions);
  const panelRef = useRef(null);

  const handleDragStart = (e) => {
    if (e.target.closest('.drag-handle')) {
      e.preventDefault();
      setIsDragging(true);
      const rect = panelRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleDragMove = (e) => {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      const maxX = window.innerWidth - dimensions.width;
      const maxY = window.innerHeight - 50;

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
    };

    const handleDragEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleDragMove, { passive: true });
    document.addEventListener('mouseup', handleDragEnd);

    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
    };
  }, [isDragging, dragOffset, dimensions]);

  useEffect(() => {
    if (!storageKey) return;

    try {
      const savedState = localStorage.getItem(storageKey);
      if (savedState) {
        const state = JSON.parse(savedState);
        if (state.position) setPosition(state.position);
        if (state.dimensions) setDimensions(state.dimensions);
      }
    } catch (e) {
      console.error(`Could not load ${storageKey} state`, e);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;

    const saveState = () => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          position,
          dimensions
        }));
      } catch (e) {
        console.error(`Could not save ${storageKey} state`, e);
      }
    };

    window.addEventListener('beforeunload', saveState);
    return () => {
      window.removeEventListener('beforeunload', saveState);
      saveState();
    };
  }, [position, dimensions, storageKey]);

  return {
    position,
    dimensions,
    panelRef,
    handleDragStart,
    setDimensions
  };
};

const processingPulseAnimation = keyframes`
  0% {
    border-color: var(--pulse-base-color);
  }
  50% {
    border-color: var(--chakra-colors-green-400);
  }
  100% {
    border-color: var(--pulse-base-color);
  }
`;

const PanelContainer = ({
  children,
  title,
  actions,
  isMinimized = false,
  onToggleMinimize = null,
  showMinimizeButton = true,
  minHeight = THEME.components.panel.minHeight.standard,
  maxHeight = "100%",
  minimizedHeight = THEME.components.panel.collapsedHeight,
  flex = "1",
  mode = "normal",
  isExpanded,
  onToggleExpand,
  icon: Icon,
  iconColor = "blue.500",
  borderColor,
  isLoading = false,
  isEmpty = false,
  panelLayout = "fixed",
  isProcessing = false,
  isDisabled = false,
  ...props
}) => {
  const { colorMode } = useColorMode();
  const panelBorderColor = borderColor || (colorMode === "dark" ? "gray.700" : "gray.200");

  const getProcessingBackgroundStyle = () => {
    if (!isProcessing) return {};
    const baseColor = colorMode === "dark" ? "green.900" : "green.100";
    return {
      backgroundColor: `var(--chakra-colors-${baseColor.replace('.', '-')})`,
    };
  };

  const handleToggleMinimize = useCallback(() => {
    if (onToggleMinimize) {
      onToggleMinimize();
    }
  }, [onToggleMinimize]);

  const DisabledOverlay = () => (
    <Tooltip label="This feature is available for Admin users only.">
      <Box
        position="absolute"
        top="0"
        left="0"
        right="0"
        bottom="0"
        bg={colorMode === 'dark' ? 'rgba(26, 32, 44, 0.8)' : 'rgba(255, 255, 255, 0.8)'}
        zIndex="10"
        display="flex"
        alignItems="center"
        justifyContent="center"
        borderRadius={THEME.borders.radius.md}
        cursor="not-allowed"
      >
        <ChakraIcon as={Lock} color="yellow.500" boxSize={8} />
      </Box>
    </Tooltip>
  );

  if (mode === "expandable") {
    return (
      <Box
        borderWidth="1px"
        borderRadius={THEME.borders.radius.md}
        borderColor={isProcessing ? "green.400" : panelBorderColor}
        mb={4}
        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
        sx={getProcessingBackgroundStyle()}
        position="relative"
        {...props}
      >
        {isDisabled && <DisabledOverlay />}
        <Flex p={4} justifyContent="space-between" alignItems="center">
          <Flex align="center">
            {Icon && <Icon size={16} style={{ marginRight: '8px', color: `var(--chakra-colors-${iconColor})` }} />}
            <Heading size="sm">{title}</Heading>
          </Flex>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleExpand}
            rightIcon={isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            transition="none"
          >
            {isExpanded ? "Hide" : "Show"}
          </Button>
        </Flex>
        <Collapse in={isExpanded} animateOpacity={UI_ANIMATIONS.enabled}>
          <Box p={4} pt={0} borderTop="1px solid" borderColor={panelBorderColor}>
            {children}
          </Box>
        </Collapse>
      </Box>
    );
  }

  const modeConfig = PANEL_MODES[panelLayout] || PANEL_MODES.fixed;
  const panelStyles = {
    flex: isMinimized ? `0 0 ${minimizedHeight}` : modeConfig.panel.flex,
    minHeight: isMinimized ? minimizedHeight : minHeight,
    maxHeight: isMinimized ? minimizedHeight : maxHeight || modeConfig.panel.maxHeight,
    overflow: modeConfig.panel.overflow
  };

  return (
    <Box
      bg={isProcessing ? 'transparent' : (colorMode === "dark" ? "gray.800" : "white")}
      borderRadius={THEME.borders.radius.md}
      position="relative"
      transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
      boxShadow={colorMode === "dark" ? "none" : "sm"}
      borderLeft="3px solid"
      borderLeftColor={isMinimized ? "transparent" : (isProcessing ? "green.400" : "blue.400")}
      animation={isProcessing ? `${processingPulseAnimation} 2s ease-in-out infinite` : 'none'}
      data-draggable="true"
      className="panel-container"
      display="flex"
      flexDirection="column"
      sx={getProcessingBackgroundStyle()}
      {...UI_EFFECTS.hardware.acceleration}
      {...panelStyles}
      {...props}
    >
      {isDisabled && <DisabledOverlay />}
      {showMinimizeButton && onToggleMinimize && (
        <Tooltip label={isMinimized ? "Expand" : "Minimize"}>
          <IconButton
            icon={isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
            aria-label={isMinimized ? "Expand" : "Minimize"}
            position="absolute"
            top="5px"
            right="5px"
            zIndex={5}
            size="xs"
            variant="ghost"
            onClick={handleToggleMinimize}
            transition="none"
          />
        </Tooltip>
      )}

      <Box
        height="100%"
        width="100%"
        display="flex"
        flexDirection="column"
        pointerEvents={isMinimized ? "none" : "auto"}
        transition="none"
        overflow={isMinimized ? "hidden" : panelLayout === "adaptive" ? "visible" : "hidden"}
      >
        {title && (
          <Flex
            justify="space-between"
            align="center"
            px={3}
            py={1}
            borderBottom="1px solid"
            borderColor={colorMode === "dark" ? "gray.700" : "gray.200"}
            flexShrink={0}
            height="36px"
            filter={isMinimized ? "blur(3px)" : "none"}
            transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
            bg="transparent"
          >
            <Heading size="sm" color={isProcessing ? 'green.600' : undefined}>
              {title}
            </Heading>
            {actions && <Box mr={6}>{actions}</Box>}
          </Flex>
        )}

        <Box
          className="panel-content"
          display={isMinimized ? 'none' : 'flex'}
          position="relative"
          flexDirection="column"
          flex={modeConfig.content.flex}
          overflow={modeConfig.content.overflow}
          height={modeConfig.content.height}
          css={{
            '&::-webkit-scrollbar': {
              width: THEME.scrollbar.width,
              height: THEME.scrollbar.height
            },
            '&::-webkit-scrollbar-track': {
              background: colorMode === 'dark' ?
                THEME.scrollbar.trackBg.dark :
                THEME.scrollbar.trackBg.light
            },
            '&::-webkit-scrollbar-thumb': {
              background: colorMode === 'dark' ?
                THEME.scrollbar.thumbBg.dark :
                THEME.scrollbar.thumbBg.light,
              borderRadius: '4px'
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: colorMode === 'dark' ?
                THEME.scrollbar.thumbHoverBg.dark :
                THEME.scrollbar.thumbHoverBg.light
            }
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
};

export default PanelContainer;