import React, { useRef, useEffect } from 'react';
import { Box, VStack, Text, Badge, Flex, useColorMode } from '@chakra-ui/react';
import { LOG_COLORS, THEME, UI_ANIMATIONS } from '../config/Config';

const LogEntry = ({ log }) => {
  const type = log.type?.toLowerCase() || 'info';
  const color = LOG_COLORS[type] || 'blue';
  const bgIntensity = type === 'market' ? '700' : '900';

  const formatMessage = () => {
    if (type !== 'cache') return log.message;
    if (/cache hit|hit:/i.test(log.message)) return log.message.replace(/cache hit|hit:/i, m => `✓ ${m.toUpperCase()}`);
    if (/cache miss|miss:/i.test(log.message)) return log.message.replace(/cache miss|miss:/i, m => `✗ ${m.toUpperCase()}`);
    return log.message;
  };

  return (
    <Box
      py={1}
      px={2}
      mb={1}
      width="100%"
      borderRadius="md"
      bg={`${color}.${bgIntensity}`}
      fontSize="xs"
      borderLeft="3px solid"
      borderLeftColor={`${color}.400`}
      transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
    >
      <Flex justify="space-between" mb={0.5}>
        <Badge size="sm" variant="subtle" colorScheme={color} fontSize="2xs">{log.type?.toUpperCase()}</Badge>
        {log.timestamp && <Text fontSize="2xs" color="gray.500">{new Date(log.timestamp).toLocaleTimeString()}</Text>}
      </Flex>
      <Text fontSize="xs" wordBreak="break-word" color="white" fontWeight={type === 'cache' ? "medium" : "normal"}>{formatMessage()}</Text>
      {log.details && (
        <Text fontSize="2xs" color="gray.500" mt={1}>
          {Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(' | ')}
        </Text>
      )}
    </Box>
  );
};

const DebugLog = ({ logs = [] }) => {
  const logContainerRef = useRef(null);
  const { colorMode } = useColorMode();
  const bgColor = colorMode === 'dark' ? 'gray.900' : 'gray.50';

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Box height="100%" width="100%" p={4} display="flex" flexDirection="column">
      <Box
        ref={logContainerRef}
        flexGrow={1}
        overflowY="auto"
        borderRadius="md"
        p={2}
        maxHeight="100%"
        bg={bgColor}
        transition={UI_ANIMATIONS.enabled ? UI_ANIMATIONS.transition : 'none'}
        css={{
          '&::-webkit-scrollbar': {
            width: THEME.scrollbar.width,
            height: THEME.scrollbar.height
          },
          '&::-webkit-scrollbar-track': {
            background: useColorMode().colorMode === 'dark' ? THEME.scrollbar.trackBg.dark : THEME.scrollbar.trackBg.light
          },
          '&::-webkit-scrollbar-thumb': {
            background: useColorMode().colorMode === 'dark' ? THEME.scrollbar.thumbBg.dark : THEME.scrollbar.thumbBg.light,
            borderRadius: '4px'
          },
          '&::-webkit-scrollbar-thumb:hover': {
            background: useColorMode().colorMode === 'dark' ? THEME.scrollbar.thumbHoverBg.dark : THEME.scrollbar.thumbHoverBg.light
          }
        }}
      >
        {logs.length === 0 ? (
          <Text color="gray.500" fontSize="sm" textAlign="center" mt={4}>System messages appear here</Text>
        ) : (
          <VStack spacing={0} align="stretch">
            {logs.map((log, index) => <LogEntry key={index} log={log} />)}
          </VStack>
        )}
      </Box>
    </Box>
  );
};

export default DebugLog;