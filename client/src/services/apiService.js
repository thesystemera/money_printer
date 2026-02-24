import { addLog } from './socketService';
import { API } from '../config/Config';
import * as TimeService from './timeService';
import { auth } from '../firebase';

const API_ENDPOINTS = {
  SEARCH_STOCKS: 'search-stocks',
  STOCK_INFO: 'stock-info',
  ARTICLES: 'articles',
  OPTIONS_DATA: 'options-data',
  GET_RECOMMENDATION: 'get-recommendation',
  MARKET_DATA: 'market-data',
  STOCK_SUGGESTIONS: 'stock-suggestions',
  HISTORICAL_RECOMMENDATION: 'historical-recommendation',
  MARKET_DATA_REFRESH: 'market-data/refresh',
  PORTFOLIO_RECOMMENDATION: 'portfolio-recommendation',
  PORTFOLIO_RECOMMENDATION_HISTORY: 'portfolio-recommendation/history',
  PREDICTION_ACCURACY: 'prediction-accuracy',
};

const getAuthHeader = async () => {
  if (!auth.currentUser) {
    return {};
  }
  try {
    const token = await auth.currentUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch (error) {
    addLog('Could not get auth token for API request', 'error');
    return {};
  }
};

const fetchWithTimeout = async (url, options = {}, timeout = API.TIMEOUTS.DEFAULT) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const authHeader = await getAuthHeader();

  try {
    const response = await fetch(url, {
      ...options,
      mode: 'cors',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...authHeader,
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch (e) {
        console.warn('Could not parse error response as JSON');
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
};

const apiGet = async (endpoint, params = {}, timeout = API.TIMEOUTS.DEFAULT) => {
  const timeState = TimeService.getTimeState();
  if (timeState.enableTimeOverride && timeState.overrideDateTime) {
    params.overrideDateTime = timeState.overrideDateTime;
  }

  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      queryParams.append(key, String(value));
    }
  });

  const queryString = queryParams.toString();
  const url = `${API.BASE_URL}/${endpoint}${queryString ? `?${queryString}` : ''}`;

  return fetchWithTimeout(url, { method: 'GET' }, timeout);
};

const apiPost = async (endpoint, data, timeout = API.TIMEOUTS.DEFAULT) => {
  const timeState = TimeService.getTimeState();
  if (timeState.enableTimeOverride && timeState.overrideDateTime) {
    data.overrideDateTime = timeState.overrideDateTime;
  }

  return fetchWithTimeout(
    `${API.BASE_URL}/${endpoint}`,
    {
      method: 'POST',
      body: JSON.stringify(data)
    },
    timeout
  );
};

export const searchStocks = async (query) => {
  if (!query || query.length < 1) return [];
  try {
    const response = await apiGet(API_ENDPOINTS.SEARCH_STOCKS, { query });
    return response.results || [];
  } catch (error) {
    addLog(`Error searching stocks: ${error.message}`, 'error');
    return [];
  }
};

export const fetchStockInfo = async (symbol) => {
  try {
    return await apiGet(`${API_ENDPOINTS.STOCK_INFO}/${symbol}`);
  } catch (error) {
    addLog(`Error fetching stock info: ${error.message}`, 'error');
    throw new Error(`Failed to fetch company information: ${error.message}`);
  }
};

export const fetchArticles = async ({
  symbol,
  companyName,
  ceo,
  daysBack,
  keywords,
  totalArticles,
  useTurboModel,
  preCacheOnly = false
}) => {
  try {
    const response = await apiPost(
      API_ENDPOINTS.ARTICLES,
      {
        symbol,
        companyName,
        ceo,
        daysBack,
        keywords,
        totalArticles,
        useTurboModel,
        preCacheOnly
      },
      API.TIMEOUTS.LONG
    );
    return response.articles || [];
  } catch (error) {
    addLog(`Error fetching articles: ${error.message}`, 'error');
    throw new Error(`Failed to fetch news articles: ${error.message}`);
  }
};

export const fetchOptionsData = async (symbol, forceRefresh = false) => {
  try {
    const params = forceRefresh ? { force_refresh: true } : {};
    return await apiGet(`${API_ENDPOINTS.OPTIONS_DATA}/${symbol}`, params, API.TIMEOUTS.LONG);
  } catch (error) {
    addLog(`Error fetching options data: ${error.message}`, 'error');
    throw new Error(`Failed to fetch options data: ${error.message}`);
  }
};

export const getRecommendation = async ({
  symbol,
  companyName,
  analyzedArticles = [],
  selectedMarketIndex = null,
  daysBack = 7,
  yearsBack = 2,
  visualizationImages = []
}) => {
  try {
    if (!Array.isArray(visualizationImages)) {
      throw new Error('visualizationImages must be an array');
    }
    if (visualizationImages.length === 0) {
      throw new Error('At least one visualization image is required');
    }

    const articleIds = analyzedArticles.map(article => article.url);
    const marketIndices = selectedMarketIndex ? [selectedMarketIndex] : [];

    const requestPayload = {
      symbol,
      companyName,
      analyzedArticleIds: articleIds,
      marketIndices,
      daysBack,
      yearsBack,
      visualizationImages
    };

    return await apiPost(API_ENDPOINTS.GET_RECOMMENDATION, requestPayload, API.TIMEOUTS.RECOMMENDATION);
  } catch (error) {
    addLog(`Error getting recommendation: ${error.message}`, 'error');
    throw new Error(`Failed to get recommendation: ${error.message}`);
  }
};

export const fetchMarketData = async (symbol, dataType, timeFrame, duration) => {
  try {
    const response = await apiGet(API_ENDPOINTS.MARKET_DATA, {
      symbol,
      data_type: dataType,
      time_frame: timeFrame,
      duration
    });

    return {
      prices: response.prices || [],
      calendar: response.calendar || null
    };
  } catch (error) {
    addLog(`Error fetching ${dataType} ${timeFrame} data for ${symbol}: ${error.message}`, 'error');
    throw new Error(`Failed to fetch market data: ${error.message}`);
  }
};

export const getStockSuggestions = async (category = null, refresh = false) => {
  try {
    const params = {};
    if (category) params.category = category;
    if (refresh) params.refresh = true;

    const response = await apiGet(API_ENDPOINTS.STOCK_SUGGESTIONS, params);
    return response.suggestions || {};
  } catch (error) {
    addLog(`Error fetching stock suggestions: ${error.message}`, 'error');
    return {};
  }
};

export const getHistoricalRecommendation = async (symbol, count = 10, includeImages = false, filterMode = "intelligent", targetDate = null) => {
  try {
    const params = { count, filter_mode: filterMode };
    if (includeImages) {
      params.include_images = true;
    }
    if (targetDate) {
      params.target_date = targetDate;
    }
    return await apiGet(`${API_ENDPOINTS.HISTORICAL_RECOMMENDATION}/${symbol}`, params, API.TIMEOUTS.LONG);
  } catch (error) {
    addLog(`Error fetching recommendations: ${error.message}`, 'error');
    return [];
  }
};

export const refreshMarketData = async () => {
  try {
    return await apiGet(API_ENDPOINTS.MARKET_DATA_REFRESH);
  } catch (error) {
    addLog(`Error refreshing market data: ${error.message}`, 'error');
    throw error;
  }
};

export const getPortfolioRecommendation = async (options = {}) => {
  try {
    const { forceRefresh = false, includeHistory = false, historyLimit = 10 } = options;

    if (includeHistory) {
      return await apiGet(API_ENDPOINTS.PORTFOLIO_RECOMMENDATION_HISTORY, { limit: historyLimit });
    }

    return await apiGet(API_ENDPOINTS.PORTFOLIO_RECOMMENDATION, {
      force_refresh: forceRefresh
    }, API.TIMEOUTS.RECOMMENDATION);
  } catch (error) {
    addLog(`Error getting portfolio recommendation: ${error.message}`, 'error');
    throw new Error(`Failed to get portfolio recommendation: ${error.message}`);
  }
};

export const getPredictionAccuracy = async (symbol = 'ALL', options = {}) => {
  try {
    const { forceRefresh = false, includeClaudeAnalysis = false } = options;
    const params = {};
    if (forceRefresh) {
      params.force_refresh = true;
    }
    if (includeClaudeAnalysis) {
      params.include_ai_analysis = true;
    }
    const timeout = includeClaudeAnalysis ? API.TIMEOUTS.RECOMMENDATION : API.TIMEOUTS.LONG;
    return await apiGet(`${API_ENDPOINTS.PREDICTION_ACCURACY}/${symbol}`, params, timeout);
  } catch (error) {
    addLog(`Error getting prediction accuracy for ${symbol}: ${error.message}`, 'error');
    throw new Error(`Failed to get prediction accuracy: ${error.message}`);
  }
};
