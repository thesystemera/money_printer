import { API, LOG_COLORS } from '../config/Config';
import { getCurrentTime } from './timeService';
import { auth } from '../firebase';

let socket = null;
let reconnectTimeout = null;
let clientId = `client_${Math.random().toString(36).substr(2, 9)}`;
let isConnecting = false;
let subscriptions = new Set();
let reconnectAttempts = 0;

const eventListeners = {
  listeners: {},

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  },

  off(event, callback) {
    if (!this.listeners[event]) return;
    if (callback) {
      const index = this.listeners[event].indexOf(callback);
      if (index !== -1) this.listeners[event].splice(index, 1);
    } else {
      delete this.listeners[event];
    }
  },

  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in listener for "${event}":`, error);
      }
    });
  },

  clear() {
    this.listeners = {};
  }
};

export const connectSocket = async () => {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket;
  }

  if (isConnecting) {
    return socket;
  }

  isConnecting = true;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  try {
    if (!auth.currentUser) {
      addLog('Cannot connect to WebSocket, no user logged in.', 'error');
      isConnecting = false;
      return null;
    }
    const token = await auth.currentUser.getIdToken();
    const url = `${API.WS_URL}/${clientId}?token=${token}`;

    socket = new WebSocket(url);

    socket.onopen = () => {
      isConnecting = false;
      reconnectAttempts = 0;

      if (subscriptions.size > 0) {
        addLog(`Resubscribing to ${subscriptions.size} symbols after connection`, 'info');
        subscriptions.forEach(symbol => {
          sendSocketMessage('subscribe', { symbol });
        });
      }

      eventListeners.emit('connect', { clientId });
      addLog('Connection established successfully', 'success');
    };

    socket.onclose = (event) => {
      isConnecting = false;

      if (reconnectAttempts < 5) {
        const delay = 1000 * Math.pow(2, reconnectAttempts);
        reconnectAttempts++;

        reconnectTimeout = setTimeout(() => {
          connectSocket();
        }, delay);

        eventListeners.emit('disconnect', {
          reason: event.reason,
          reconnecting: true
        });
      } else {
        eventListeners.emit('disconnect', {
          reason: event.reason,
          reconnecting: false
        });
      }

      addLog(`Connection lost: ${event.reason || 'Unknown reason'}. ${
        reconnectAttempts < 5 ? 'Attempting to reconnect...' : 'Please refresh the page.'
      }`, 'warning');
    };

    socket.onerror = (error) => {
      isConnecting = false;
      eventListeners.emit('error', { error });
      addLog('Connection error', 'error');
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const messageType = data.type;

        if (messageType) {
          eventListeners.emit(messageType, data);
          if (messageType === 'log') {
            addLog(data.message, data.log_type || 'info', data.details);
          }
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    window.addEventListener('beforeunload', () => {
      if (socket) {
        socket.close();
        socket = null;
      }
    });

    return socket;
  } catch (error) {
    isConnecting = false;
    console.error('Error creating WebSocket connection:', error);
    addLog(`Error creating WebSocket connection: ${error.message}`, 'error');
    return null;
  }
};

const sendSocketMessage = (messageType, data = {}) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  const message = {
    type: messageType,
    ...data,
    timestamp: getCurrentTime().toISOString()
  };

  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch (error) {
    console.error('Error sending WebSocket message:', error);
    return false;
  }
};

export const sendCancelMessage = (symbol) => {
  if (!symbol) {
    addLog('Cannot send cancel message: no symbol provided', 'error');
    return false;
  }

  const success = sendSocketMessage('cancel', { symbol });
  if (success) {
    addLog(`Cancel request sent for ${symbol}`, 'info');
  } else {
    addLog(`Failed to send cancel request for ${symbol}`, 'error');
  }
  return success;
};

export const sendPauseMessage = (symbol, isPaused) => {
  if (!symbol) {
    addLog('Cannot send pause message: no symbol provided', 'error');
    return false;
  }

  const messageType = isPaused ? 'resume' : 'pause';
  const success = sendSocketMessage(messageType, { symbol });
  if (success) {
    addLog(`${messageType} request sent for ${symbol}`, 'info');
  } else {
    addLog(`Failed to send ${messageType} request for ${symbol}`, 'error');
  }
  return success;
};

export const clearAllSubscriptions = () => {
  const currentSubscriptions = [...subscriptions];
  let clearedCount = 0;

  currentSubscriptions.forEach(symbol => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendSocketMessage('unsubscribe', { symbol });
    }
    subscriptions.delete(symbol);
    clearedCount++;
    addLog(`Unsubscribed from ${symbol}`, 'info');
  });

  if (clearedCount > 0) {
    addLog(`Cleared ${clearedCount} subscriptions for a full reset.`, 'info');
  }

  return clearedCount > 0;
};

export const subscribeToStock = (symbol) => {
  if (!symbol) return false;

  subscriptions.add(symbol);

  if (socket && socket.readyState === WebSocket.OPEN) {
    addLog(`Subscribing to ${symbol}`, 'info');
    return sendSocketMessage('subscribe', { symbol });
  } else {
    addLog(`Will subscribe to ${symbol} when connected`, 'info');
    return true;
  }
};

export const addLog = (message, type = 'info', details = null) => {
  const timestamp = getCurrentTime().toLocaleTimeString();
  const logEntry = { timestamp, message, type, details };

  const color = LOG_COLORS[type] || LOG_COLORS.info;
  const prefix = `[${type.toUpperCase()}]`;
  console.log(`%c${prefix} %c${message}`,
    `color: ${color}; font-weight: bold`,
    'color: inherit',
    details || '');

  eventListeners.emit('clientLog', logEntry);
  return logEntry;
};

export const showToast = (toast, options) => {
  if (!toast) return;

  if (options.status === 'error') {
    const { title, error, description } = options;
    const errorMessage = error?.message || error || description || 'An unexpected error occurred';

    toast({
      title: title || 'Error',
      description: errorMessage,
      status: 'error',
      duration: 5000,
      isClosable: true,
    });

    if (!options.skipLog) {
      addLog(`${title || 'Error'}: ${errorMessage}`, 'error');
    }
    return;
  }

  if (options.status === 'success') {
    toast({
      title: options.title || 'Success',
      description: options.description,
      status: 'success',
      duration: 3000,
      isClosable: true,
    });

    if (!options.skipLog) {
      addLog(options.description || options.title, 'success');
    }
    return;
  }

  toast({
    title: options.title,
    description: options.description,
    status: options.status || 'info',
    duration: options.duration || 4000,
    isClosable: true,
  });

  if (!options.skipLog) {
    addLog(options.description || options.title,
      options.status === 'warning' ? 'warning' : 'info');
  }
};

export const handleError = (error, context, toast = null) => {
  const errorMessage = error?.message || String(error) || 'Unknown error';

  console.error(`[ERROR] ${context}:`, error);
  addLog(`${context}: ${errorMessage}`, 'error');

  if (toast) {
    showToast(toast, {
      title: `Error: ${context}`,
      description: errorMessage,
      status: 'error',
      skipLog: true
    });
  }

  return errorMessage;
};

export const formatValue = (value, options = {}) => {
  const {
    decimals = 2,
    format = 'number',
    fallback = 'N/A'
  } = options;

  if (value === undefined || value === null || isNaN(value)) {
    return fallback;
  }

  switch (format) {
    case 'percent':
      return `${value.toFixed(decimals)}%`;
    case 'currency':
      return `$${value.toFixed(decimals)}`;
    default:
      return value.toFixed(decimals);
  }
};

export const on = (event, callback) => {
  return eventListeners.on(event, callback);
};

export const off = (event, callback) => {
  eventListeners.off(event, callback);
};