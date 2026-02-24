import {
  fetchStockInfo,
  fetchArticles,
  getRecommendation,
  fetchMarketData,
  getPortfolioRecommendation,
  getPredictionAccuracy,
  fetchOptionsData,
  getHistoricalRecommendation
} from '../services/apiService';
import {
  connectSocket, subscribeToStock, on,
  addLog, showToast, handleError, clearAllSubscriptions
} from '../services/socketService';
import {
  MARKET_SENTIMENT,
  MARKET_INDICES,
  HISTORICAL_BASELINE,
  SYSTEM,
  getStockArticleFetchParams,
  getMarketArticleFetchParams
} from '../config/Config';

class DashboardDataService {
  constructor(callbacks, toast) {
    this.callbacks = callbacks;
    this.toast = toast;
    this.stockSymbolRef = { current: '' };
    this.industrySymbolRef = { current: '' };
    this.socketHandlers = [];
    this.optionsImages = null;
    this.batchSize = SYSTEM.ARTICLE_PROCESSING_BATCH_SIZE;
    this.isProcessingBatch = false;
    this.batchProcessTimeout = null;
    this.isCancelled = false;

    this.analysisConfigs = {
      stock: {
        symbolCheck: (s) => s === this.stockSymbolRef.current,
        setArticles: this.callbacks.setStockAnalyzedArticles,
        setSentiment: this.callbacks.setStockSentimentData,
        setStatus: (prev) => ({...prev, stockCompleted: true}),
        setProcessing: this.callbacks.setStockProcessingState,
        title: 'Stock Analysis Complete'
      },
      market: {
        symbolCheck: (s) => s === MARKET_SENTIMENT.SYMBOL,
        setArticles: this.callbacks.setMarketAnalyzedArticles,
        setSentiment: this.callbacks.setMarketSentimentData,
        setStatus: (prev) => ({...prev, marketCompleted: true}),
        setProcessing: this.callbacks.setMarketProcessingState,
        title: 'Market Analysis Complete'
      },
      industry: {
        symbolCheck: (s) => s && s.startsWith('INDUSTRY_') && s === this.industrySymbolRef.current,
        setArticles: this.callbacks.setIndustryAnalyzedArticles,
        setSentiment: this.callbacks.setIndustrySentimentData,
        setStatus: (prev) => ({...prev, industryCompleted: true}),
        setProcessing: this.callbacks.setIndustryProcessingState,
        title: 'Industry Analysis Complete'
      }
    };

    this.articleProcessors = {
      stock: {
        buffer: [], processedUrls: new Set(),
        setProcessingState: this.callbacks.setStockProcessingState,
        setAnalyzedArticles: this.callbacks.setStockAnalyzedArticles,
        setSentimentData: this.callbacks.setStockSentimentData,
        isMatch: (s) => s === this.stockSymbolRef.current,
        transformArticle: (a) => ({...a, matchedKeyword: this.getMatchedKeyword(a)}),
        createSentimentData: (a) => this.createBaseSentimentData(a, false, false)
      },
      industry: {
        buffer: [], processedUrls: new Set(),
        setProcessingState: this.callbacks.setIndustryProcessingState,
        setAnalyzedArticles: this.callbacks.setIndustryAnalyzedArticles,
        setSentimentData: this.callbacks.setIndustrySentimentData,
        isMatch: (s) => s && s.startsWith('INDUSTRY_') && s === this.industrySymbolRef.current,
        transformArticle: (a) => ({...a, isIndustryArticle: true}),
        createSentimentData: (a) => this.createBaseSentimentData(a, false, true)
      },
      market: {
        buffer: [], processedUrls: new Set(),
        setProcessingState: this.callbacks.setMarketProcessingState,
        setAnalyzedArticles: this.callbacks.setMarketAnalyzedArticles,
        setSentimentData: this.callbacks.setMarketSentimentData,
        isMatch: (s) => s === MARKET_SENTIMENT.SYMBOL,
        transformArticle: (a) => a,
        createSentimentData: (a) => this.createBaseSentimentData(a, true, false)
      }
    };

    this.setupSocketConnection = this.setupSocketConnection.bind(this);
    this.analyzeMarketSentiment = this.analyzeMarketSentiment.bind(this);
    this.fetchSelectedMarketIndexData = this.fetchSelectedMarketIndexData.bind(this);
    this.fetchHistoricalDataOnly = this.fetchHistoricalDataOnly.bind(this);
    this.fetchMarketIndexChangeData = this.fetchMarketIndexChangeData.bind(this);
    this.handleSearch = this.handleSearch.bind(this);
    this.handleRequestRecommendation = this.handleRequestRecommendation.bind(this);
    this.handleRequestPortfolioAnalysis = this.handleRequestPortfolioAnalysis.bind(this);
    this.handleRequestPredictionAccuracy = this.handleRequestPredictionAccuracy.bind(this);
    this.handleFetchSystemSymbols = this.handleFetchSystemSymbols.bind(this);
    this.cleanupSocketConnection = this.cleanupSocketConnection.bind(this);
    this.fetchOptionsData = this.fetchOptionsData.bind(this);
    this.processBatch = this.processBatch.bind(this);
    this.resetAllState = this.resetAllState.bind(this);
    this.processArticleType = this.processArticleType.bind(this);
    this.getMatchedKeyword = this.getMatchedKeyword.bind(this);
    this.normalizeHistoricalData = this.normalizeHistoricalData.bind(this);
    this.validateAndFormatHistoricalData = this.validateAndFormatHistoricalData.bind(this);
    this.handleCancellation = this.handleCancellation.bind(this);
    this.fetchInitialCalendar = this.fetchInitialCalendar.bind(this);
  }

  updateCallbacks(newCallbacks) {
    this.callbacks = newCallbacks;

    this.articleProcessors.stock.setProcessingState = newCallbacks.setStockProcessingState;
    this.articleProcessors.stock.setAnalyzedArticles = newCallbacks.setStockAnalyzedArticles;
    this.articleProcessors.stock.setSentimentData = newCallbacks.setStockSentimentData;

    this.articleProcessors.industry.setProcessingState = newCallbacks.setIndustryProcessingState;
    this.articleProcessors.industry.setAnalyzedArticles = newCallbacks.setIndustryAnalyzedArticles;
    this.articleProcessors.industry.setSentimentData = newCallbacks.setIndustrySentimentData;

    this.articleProcessors.market.setProcessingState = newCallbacks.setMarketProcessingState;
    this.articleProcessors.market.setAnalyzedArticles = newCallbacks.setMarketAnalyzedArticles;
    this.articleProcessors.market.setSentimentData = newCallbacks.setMarketSentimentData;
  }

  createBaseSentimentData(article, isMarket, isIndustry) {
    return {
      date: new Date(article.publishedDate),
      sentiment: article.sentimentScore,
      influence: article.influenceScore,
      certaintyScore: article.certaintyScore,
      sourceCategory: article.sourceCategory,
      propagationSpeed: article.propagationSpeed,
      impactDuration: article.impactDuration,
      temporalOrientation: article.temporalOrientation,
      title: article.title,
      matchedKeyword: article.matchedKeyword || (isMarket ? "market" : isIndustry ? "industry" : null),
      isMarketSentiment: isMarket,
      isIndustrySentiment: isIndustry
    };
  }

  getAnalysisType(symbol) {
    if (symbol === MARKET_SENTIMENT.SYMBOL) return 'market';
    if (symbol && symbol.startsWith('INDUSTRY_')) return 'industry';
    return 'stock';
  }

  handleCancellation(symbol) {
    if (symbol === this.stockSymbolRef.current ||
        symbol === this.industrySymbolRef.current ||
        symbol === MARKET_SENTIMENT.SYMBOL) {

      addLog(`DashboardDataService: Processing cancellation for ${symbol}`, 'warning');
      this.isCancelled = true;

      Object.values(this.articleProcessors).forEach(processor => {
        processor.buffer = [];
        processor.processedUrls.clear();
      });

      if (this.batchProcessTimeout) {
        clearTimeout(this.batchProcessTimeout);
        this.batchProcessTimeout = null;
      }

      this.isProcessingBatch = false;

      addLog(`DashboardDataService: Cancellation processing complete for ${symbol}`, 'info');
    }
  }

  handleAnalysisComplete(symbol, data) {
    if (this.isCancelled) {
      addLog(`Ignoring analysis completion for ${symbol} - operation was cancelled`, 'info');
      return;
    }

    const type = this.getAnalysisType(symbol);
    const config = this.analysisConfigs[type];
    if (!config || !config.symbolCheck(symbol)) return;

    const cacheDetails = data.cache_analysis || {};
    const fetchDetails = data.fetch_analysis || {};

    let description = `${type.charAt(0).toUpperCase() + type.slice(1)}: ${data.articles_analyzed || 0} articles analyzed`;
    if (cacheDetails.relevance_hit_rate) description += `, ${cacheDetails.relevance_hit_rate}% relevance cache`;
    if (fetchDetails.cache_hit_rate) description += `, ${fetchDetails.cache_hit_rate}% article cache`;
    if (data.processing_time) description += `, ${data.processing_time}s processing`;

    showToast(this.toast, {
      title: config.title,
      description: description,
      status: 'success',
      duration: 5000,
      skipLog: true
    });

    this.callbacks.setAnalysisStatus(config.setStatus);

    if (data.articles_rejected !== undefined) {
      config.setProcessing(prev => ({
        ...prev,
        irrelevantArticles: data.articles_rejected,
        articlesAnalyzed: data.articles_analyzed || prev.articlesAnalyzed,
        totalArticles: data.articles_fetched || prev.totalArticles
      }));
    }

    const processor = this.articleProcessors[type];
    if (processor && processor.buffer.length > 0) {
      this.processBatch(true);
    }
  }

  handleStatusUpdate(message) {
    const { symbol, bucket, phase, status, data } = message;

    if (status === 'cancelled') {
      this.handleCancellation(symbol);
      return;
    }

    if (this.isCancelled) {
      addLog(`Ignoring status update for ${symbol} - operation was cancelled`, 'info');
      return;
    }

    if (['stock', 'market', 'industry'].includes(bucket) && phase === 'complete' && status === 'complete') {
      this.handleAnalysisComplete(symbol, data);
    } else if (bucket === 'portfolio' && phase === 'complete' && status === 'complete') {
      showToast(this.toast, {
        title: 'Portfolio Analysis Complete',
        description: `${data.opportunities || 0} opportunities identified`,
        status: 'success'
      });
      this.callbacks.setPortfolioRecommendation(data.recommendation);
      this.callbacks.setIsLoadingPortfolio(false);
      addLog(`Portfolio recommendation received with ${data.opportunities || 0} opportunities`, 'success');
    } else if (bucket === 'recommendation' && phase === 'complete' && status === 'complete') {
      if (symbol !== this.stockSymbolRef.current) return;
      showToast(this.toast, {
        title: 'Recommendation Ready',
        description: `${data.action} recommendation generated with ${data.confidence}% confidence`,
        status: 'success'
      });
      this.callbacks.setRecommendationData(data.recommendation);
      this.callbacks.dispatchLoading({ type: 'END_RECOMMENDATION' });
      addLog(`Recommendation received: ${data.action}`, 'success');
    } else if (phase === 'analyzing' && status === 'in_progress') {
      if (this.callbacks.bulkProgressCallback && bucket === 'stock') {
        this.callbacks.bulkProgressCallback('ANALYZING_ARTICLES', 60, 'Analyzing market sentiment');
      }
    } else if (status === 'error') {
      showToast(this.toast, {
        title: `${bucket.charAt(0).toUpperCase() + bucket.slice(1)} Analysis Error`,
        description: data.error || 'An error occurred during analysis',
        status: 'error'
      });
      addLog(`Error in ${bucket} analysis for ${symbol}: ${data.error}`, 'error');
    }
  }

  resetAllState() {
    Object.values(this.articleProcessors).forEach(processor => {
      processor.processedUrls.clear();
      processor.buffer = [];
    });
    this.isProcessingBatch = false;
    this.isCancelled = false;
    if (this.batchProcessTimeout) {
      clearTimeout(this.batchProcessTimeout);
      this.batchProcessTimeout = null;
    }
    this.stockSymbolRef.current = '';
    this.industrySymbolRef.current = '';

    if (this.callbacks.setMarketAnalyzedArticles) {
        this.callbacks.setMarketAnalyzedArticles([]);
    }
    if (this.callbacks.setMarketSentimentData) {
        this.callbacks.setMarketSentimentData([]);
    }
  }

  getMatchedKeyword(article) {
    if (article.matchedKeyword) return article.matchedKeyword;
    if (!this.callbacks.companyInfo) return null;

    const title = (article.title || '').toLowerCase();
    const content = (article.summary || '').toLowerCase();
    const companyInfo = this.callbacks.companyInfo;

    if (title.includes(companyInfo.symbol.toLowerCase()) ||
        content.includes(companyInfo.symbol.toLowerCase())) {
      return 'symbol';
    }
    if (title.includes(companyInfo.name.toLowerCase()) ||
        content.includes(companyInfo.name.toLowerCase())) {
      return 'companyName';
    }
    if (companyInfo.ceo &&
        (title.includes(companyInfo.ceo.toLowerCase()) ||
         content.includes(companyInfo.ceo.toLowerCase()))) {
      return 'ceo';
    }
    return null;
  }

  normalizeHistoricalData(recentData, historicalData) {
    if (!recentData || recentData.length === 0) return recentData;

    const validHistoricalPrices = historicalData
      .filter(item => item.originalPrice && !isNaN(item.originalPrice) && item.originalPrice > 0)
      .map(item => item.originalPrice);

    if (validHistoricalPrices.length < HISTORICAL_BASELINE.MINIMUM_DATA_POINTS) {
      return recentData;
    }

    const last90Days = validHistoricalPrices.slice(-HISTORICAL_BASELINE.ROLLING_AVERAGE_DAYS);
    const rollingAverage = last90Days.reduce((sum, price) => sum + price, 0) / last90Days.length;

    const variance = last90Days.reduce((sum, price) =>
      sum + Math.pow(price - rollingAverage, 2), 0) / last90Days.length;
    const stdDev = Math.sqrt(variance);

    return recentData.map(item => ({
      ...item,
      basePrice: rollingAverage,
      stdDev: stdDev
    }));
  }

  validateAndFormatHistoricalData(rawData, dataType = 'stock') {
    if (!rawData) return [];

    let dataArray = rawData;
    if (rawData.prices && Array.isArray(rawData.prices)) {
      dataArray = rawData.prices;
    } else if (rawData.data && Array.isArray(rawData.data)) {
      dataArray = rawData.data;
    } else if (!Array.isArray(rawData)) {
      return [];
    }

    if (!dataArray || dataArray.length === 0) return [];

    const formattedData = dataArray
      .map((item, index) => {
        if (!item) return null;

        let timestamp;
        if (item.timestamp) {
          timestamp = new Date(item.timestamp);
        } else if (item.date) {
          timestamp = new Date(item.date);
        } else {
          return null;
        }

        if (isNaN(timestamp.getTime())) return null;

        let price = item.price || item.close || item.value;
        if (price === null || price === undefined || isNaN(price) || price <= 0) {
          return null;
        }

        const formattedItem = {
          timestamp: timestamp.toISOString(),
          date: timestamp,
          price: parseFloat(price),
          originalPrice: parseFloat(price)
        };

        if (item.open !== undefined && !isNaN(item.open)) formattedItem.open = parseFloat(item.open);
        if (item.high !== undefined && !isNaN(item.high)) formattedItem.high = parseFloat(item.high);
        if (item.low !== undefined && !isNaN(item.low)) formattedItem.low = parseFloat(item.low);
        if (item.volume !== undefined && !isNaN(item.volume)) formattedItem.volume = parseInt(item.volume);
        if (item.marketSession) formattedItem.marketSession = item.marketSession;

        return formattedItem;
      })
      .filter(item => item !== null)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return formattedData;
  }

  processArticleType(articleType, article) {
        if (this.isCancelled) {
          return;
        }

        const processor = this.articleProcessors[articleType];

        const MAX_PROPAGATION_HOURS = 168;
        const MAX_DURATION_HOURS = 720;

        const hasZeroScores = article.sentimentScore === 0 || article.influenceScore === 0 ||
                              article.sentimentScore === undefined || article.sentimentScore === null ||
                              article.influenceScore === undefined || article.influenceScore === null;

        const hasExtremeDurations = (article.propagationSpeed && article.propagationSpeed > MAX_PROPAGATION_HOURS) ||
                                    (article.impactDuration && article.impactDuration > MAX_DURATION_HOURS);

        const hasInvalidRangeScores = (typeof article.certaintyScore === 'number' && (article.certaintyScore < 0 || article.certaintyScore > 1)) ||
                                      (typeof article.temporalOrientation === 'number' && (article.temporalOrientation < -1 || article.temporalOrientation > 1));

        if (hasZeroScores || hasExtremeDurations || hasInvalidRangeScores) {
            if (hasExtremeDurations || hasInvalidRangeScores) {
              addLog(`[FILTER] Rejecting article with out-of-bounds AI values: "${article.title}"`, 'warning');
            }
            processor.setProcessingState(prev => ({
              ...prev,
              rejectedArticles: prev.rejectedArticles + 1
            }));
            return;
        }

        processor.setProcessingState(prev => ({
            ...prev,
            articlesAnalyzed: prev.articlesAnalyzed + 1
        }));

        const transformedArticle = processor.transformArticle(article);
        processor.buffer.push(transformedArticle);

        if (!this.isProcessingBatch && processor.buffer.length >= this.batchSize) {
            this.processBatch(false);
        }
    }

setupSocketConnection() {
    if (this.socketHandlers && this.socketHandlers.length > 0) {
      this.socketHandlers.forEach(unsubscribe => unsubscribe());
      this.socketHandlers = [];
    }

    connectSocket();
    this.socketHandlers = [];

    const registerHandler = (eventType, handler) => {
      const unsubscribe = on(eventType, (data) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in ${eventType} handler:`, error);
          addLog(`Error handling ${eventType} event: ${error.message}`, 'error');
        }
      });
      this.socketHandlers.push(unsubscribe);
      return unsubscribe;
    };

    registerHandler('connect', () => {
      if (this.stockSymbolRef.current) {
        subscribeToStock(this.stockSymbolRef.current);
        if (this.industrySymbolRef.current) {
          subscribeToStock(this.industrySymbolRef.current);
        }
      }
      subscribeToStock(MARKET_SENTIMENT.SYMBOL);
      subscribeToStock("PORTFOLIO");
    });

    registerHandler('disconnect', (data) => {
      addLog(`Connection lost: ${data.reason || 'Unknown reason'}`, 'warning');
      showToast(this.toast, {
        title: 'Connection Lost',
        description: 'Disconnected from server. Attempting to reconnect...',
        status: 'warning'
      });
    });

    registerHandler('error', () => {
      addLog('Connection error', 'error');
      showToast(this.toast, {
        title: 'Connection Error',
        description: 'Error connecting to server',
        status: 'error'
      });
    });

    registerHandler('clientLog', (logEntry) => {
      this.callbacks.appendLog(logEntry);
    });

    registerHandler('status_update', (message) => {
      this.handleStatusUpdate(message);
    });

    registerHandler('analysis_cancelled', (data) => {
      const { symbol } = data;
      addLog(`DashboardDataService: Received cancellation notification for ${symbol}`, 'warning');
      this.handleCancellation(symbol);
    });

    registerHandler('article_fetched', (data) => {
      if (this.isCancelled) return;

      const { article, articles, count, symbol } = data;
      const articlesToProcess = articles || (article ? [article] : []);

      if (articlesToProcess.length === 0) return;

      if (this.callbacks.bulkProgressCallback) {
        this.callbacks.bulkProgressCallback('FETCHING_ARTICLES', 35, `Gathering articles (${count} fetched)`);
      }

      this.callbacks.setArticles(prev => {
        const existingUrls = new Set(prev.map(a => a.url));
        const newArticles = articlesToProcess.filter(a => !existingUrls.has(a.url));
        return [...prev, ...newArticles];
      });

      const processorsToUpdate = new Map();
      articlesToProcess.forEach(art => {
        const articleType = this.getAnalysisType(art.sourceSymbol);
        const processor = this.articleProcessors[articleType];
        if (processor) {
          if (!processorsToUpdate.has(processor)) {
            processorsToUpdate.set(processor, 0);
          }
          processorsToUpdate.set(processor, processorsToUpdate.get(processor) + 1);
        }
      });

      processorsToUpdate.forEach((numArticles, processor) => {
        processor.setProcessingState(prev => ({
          ...prev,
          articlesFetched: prev.articlesFetched + numArticles,
          totalArticles: Math.max(prev.totalArticles, count)
        }));
      });
    });

    registerHandler('article_analyzed', (data) => {
      if (this.isCancelled || !data.article) {
        return;
      }

      const articleType = this.getAnalysisType(data.symbol);
      const processor = this.articleProcessors[articleType];

      if (processor && processor.isMatch(data.symbol)) {
        if (this.callbacks.bulkProgressCallback && articleType === 'stock') {
          this.callbacks.bulkProgressCallback('ANALYZING_ARTICLES', 60, 'Analyzing market sentiment');
        }
        this.processArticleType(articleType, data.article);
      }
    });

    registerHandler('thinking_stream', (data) => {
        if (this.isCancelled) {
            return;
        }

        const streamUpdate = {
            content: data.content,
            timestamp: data.timestamp,
            isComplete: data.is_complete || false,
            source: data.source
        };

        this.callbacks.appendThinkingStream(streamUpdate);

        if (streamUpdate.source) {
            const isNewStream = this.callbacks.isNewThinkingSource(streamUpdate.source);
            if (isNewStream && !streamUpdate.isComplete) {
                setTimeout(() => {
                    this.callbacks.handleOpenThinkingPanel(streamUpdate.source);
                    this.callbacks.setIsThinkingPanelMinimized(false);
                }, 0);
            }

            if (streamUpdate.isComplete) {
                setTimeout(() => {
                    this.callbacks.setIsThinkingPanelMinimized(true);
                }, 1500);
            }
        }
    });

    return () => this.cleanupSocketConnection();
  }

  processBatch(isFinalFlush = false) {
    if (this.isCancelled) {
      return;
    }

    this.isProcessingBatch = true;

    Object.entries(this.articleProcessors).forEach(([type, processor]) => {
        if (processor.buffer.length === 0) return;

        const articleBatch = processor.buffer.splice(0, this.batchSize);
        const validArticles = articleBatch.filter(article =>
            !processor.processedUrls.has(article.url)
        );

        if (validArticles.length > 0) {
            validArticles.forEach(article => {
                processor.processedUrls.add(article.url);
            });

            processor.setAnalyzedArticles(prev => [...prev, ...validArticles]);

            const sentimentData = validArticles.map(article =>
                processor.createSentimentData(article)
            );

            processor.setSentimentData(prev =>
                [...prev, ...sentimentData].sort((a, b) => a.date - b.date)
            );

            processor.setProcessingState(prev => ({
                ...prev,
                articlesAnalyzed: prev.articlesAnalyzed + validArticles.length
            }));
        }
    });

    this.isProcessingBatch = false;

    const hasBufferedArticles = Object.values(this.articleProcessors)
        .some(processor => processor.buffer.length > 0);

    if (hasBufferedArticles && !this.isCancelled) {
        if (isFinalFlush) {
            this.processBatch(true);
        } else {
            if (this.batchProcessTimeout) {
                clearTimeout(this.batchProcessTimeout);
            }
            this.batchProcessTimeout = setTimeout(() => this.processBatch(false), 0);
        }
    }
  }

  cleanupSocketConnection() {
    clearAllSubscriptions();

    if (this.socketHandlers && this.socketHandlers.length > 0) {
      this.socketHandlers.forEach(unsubscribe => {
        try {
          unsubscribe();
        } catch (error) {
          console.error('Error unsubscribing handler:', error);
        }
      });
      this.socketHandlers = [];
    }

    if (this.batchProcessTimeout) {
      clearTimeout(this.batchProcessTimeout);
      this.batchProcessTimeout = null;
    }
  }

  async fetchInitialCalendar() {
    try {
      const marketData = await fetchMarketData('SPY', "stock", "recent", 1);
      if (this.isCancelled) return;
      if (marketData.calendar) {
        this.callbacks.setTradingCalendar(marketData.calendar);
        addLog('Initial trading calendar loaded successfully.', 'info');
      }
    } catch (error) {
      if (!this.isCancelled) {
        handleError(error, 'Fetching initial trading calendar', this.toast);
      }
    }
  }

  async analyzeMarketSentiment(settings) {
    this.callbacks.dispatchLoading({ type: 'START_MARKET_SENTIMENT' });

    const marketProcessor = this.articleProcessors.market;
    this.callbacks.setMarketAnalyzedArticles([]);
    this.callbacks.setMarketSentimentData([]);
    marketProcessor.processedUrls.clear();
    marketProcessor.buffer = [];

    this.callbacks.setMarketProcessingState({
      articlesFetched: 0, articlesAnalyzed: 0, totalArticles: 0, rejectedArticles: 0
    });
    this.callbacks.setAnalysisStatus(prev => ({...prev, marketCompleted: false}));

    subscribeToStock(MARKET_SENTIMENT.SYMBOL);

    try {
      const { totalArticles } = getMarketArticleFetchParams(settings);

      await fetchArticles({
        symbol: MARKET_SENTIMENT.SYMBOL,
        companyName: MARKET_SENTIMENT.NAME,
        ceo: "",
        keywords: MARKET_SENTIMENT.KEYWORDS,
        daysBack: settings.daysBack,
        totalArticles: totalArticles,
        useTurboModel: settings.useTurboModel
      });
    } catch (error) {
      if (!this.isCancelled) {
        handleError(error, "Analyzing market sentiment", this.toast);
      }
      this.callbacks.setAnalysisStatus(prev => ({...prev, marketCompleted: true}));
    } finally {
      this.callbacks.dispatchLoading({ type: 'END_MARKET_SENTIMENT' });
    }
  }

  async fetchHistoricalDataOnly(indexSymbol, stockSymbol) {
    if (!stockSymbol || !indexSymbol || this.isCancelled) return;

    addLog(`[HISTORICAL_PANEL_DATA] Fetching ONLY historical data for index ${indexSymbol} - Requested by: Market Index Change`, 'info');

    try {
      const historicalIndexData = await fetchMarketData(indexSymbol, "index", "historical", HISTORICAL_BASELINE.HISTORICAL_YEARS_BACK);

      if (this.isCancelled) return;

      const formattedIndexHistorical = this.validateAndFormatHistoricalData(historicalIndexData, 'index');

      this.callbacks.setSelectedIndexHistoricalData(formattedIndexHistorical);
      addLog(`[HISTORICAL_PANEL_DATA] Historical index data updated: ${formattedIndexHistorical.length} points for ${indexSymbol}`, 'success');

    } catch (error) {
      if (!this.isCancelled) {
        addLog(`[HISTORICAL_PANEL_DATA] Error fetching historical data for ${indexSymbol}: ${error.message}`, 'error');
        handleError(error, `Fetching historical data for ${indexSymbol}`, this.toast);
      }
    }
  }

  async fetchMarketIndexChangeData(indexSymbol, stockSymbol, settings) {
    if (!stockSymbol || !indexSymbol || !settings.daysBack || this.isCancelled) return;

    addLog(`[MAIN_CHART_DATA] Fetching index data for ${indexSymbol} change - Recent + Historical`, 'info');

    try {
      const [recentIndexData, historicalIndexData] = await Promise.all([
        fetchMarketData(indexSymbol, "index", "recent", settings.daysBack),
        fetchMarketData(indexSymbol, "index", "historical", HISTORICAL_BASELINE.HISTORICAL_YEARS_BACK)
      ]);

      if (this.isCancelled) return;

      const formattedIndexRecent = this.validateAndFormatHistoricalData(recentIndexData, 'index');
      const formattedIndexHistorical = this.validateAndFormatHistoricalData(historicalIndexData, 'index');

      const contextualizedIndexData = this.normalizeHistoricalData(formattedIndexRecent, formattedIndexHistorical);

      this.callbacks.setSelectedIndexRecentData(contextualizedIndexData);
      this.callbacks.setSelectedIndexHistoricalData(formattedIndexHistorical);

      addLog(`[MAIN_CHART_DATA] Index change completed for ${indexSymbol}: ${contextualizedIndexData.length} recent points, ${formattedIndexHistorical.length} historical points`, 'success');

    } catch (error) {
      if (!this.isCancelled) {
        addLog(`[MAIN_CHART_DATA] Error fetching index data for ${indexSymbol}: ${error.message}`, 'error');
        handleError(error, `Fetching index data for ${indexSymbol}`, this.toast);
      }
    }
  }

  async fetchSelectedMarketIndexData(indexSymbol, stockSymbol, settings) {
    if (!stockSymbol || !settings.daysBack || this.isCancelled) return;

    addLog(`[MAIN_CHART_DATA] Fetching full market data for ${stockSymbol} - Requested by: Initial Analysis`, 'info');

    this.callbacks.dispatchLoading({ type: 'START_INDEX_DATA' });

    if (this.callbacks.bulkProgressCallback) {
      this.callbacks.bulkProgressCallback('FETCHING_PRICES', 15, 'Retrieving price data');
    }

    try {
      const [recentIndexData, historicalIndexData, recentStockData, historicalStockData] = await Promise.all([
        fetchMarketData(indexSymbol, "index", "recent", settings.daysBack),
        fetchMarketData(indexSymbol, "index", "historical", HISTORICAL_BASELINE.HISTORICAL_YEARS_BACK),
        fetchMarketData(stockSymbol, "stock", "recent", settings.daysBack),
        fetchMarketData(stockSymbol, "stock", "historical", HISTORICAL_BASELINE.HISTORICAL_YEARS_BACK)
      ]);

      if (this.isCancelled) return;

      const formattedStockHistorical = this.validateAndFormatHistoricalData(historicalStockData, 'stock');
      const formattedIndexHistorical = this.validateAndFormatHistoricalData(historicalIndexData, 'index');
      const formattedStockRecent = this.validateAndFormatHistoricalData(recentStockData, 'stock');
      const formattedIndexRecent = this.validateAndFormatHistoricalData(recentIndexData, 'index');

      this.callbacks.setStockHistoricalData(formattedStockHistorical);
      this.callbacks.setSelectedIndexHistoricalData(formattedIndexHistorical);

      const contextualizedStockData = this.normalizeHistoricalData(formattedStockRecent, formattedStockHistorical);
      const contextualizedIndexData = this.normalizeHistoricalData(formattedIndexRecent, formattedIndexHistorical);

      this.callbacks.setStockPriceData(contextualizedStockData);
      this.callbacks.setSelectedIndexRecentData(contextualizedIndexData);

      if (recentStockData.calendar) {
        this.callbacks.setTradingCalendar(recentStockData.calendar);
      }

      addLog(`[MAIN_CHART_DATA] Full market data fetch completed for ${stockSymbol}: ${contextualizedStockData.length} recent points, ${formattedStockHistorical.length} historical points`, 'success');

    } catch (error) {
      if (!this.isCancelled) {
        addLog(`[MAIN_CHART_DATA] Error fetching market data for ${stockSymbol}: ${error.message}`, 'error');
        handleError(error, `Fetching market index data for ${indexSymbol}`, this.toast);
      }
    } finally {
      this.callbacks.dispatchLoading({ type: 'END_INDEX_DATA' });
    }
  }

  async fetchOptionsData(symbol) {
    if (!symbol || this.isCancelled) return null;

    this.callbacks.setIsLoadingOptionsData(true);

    if (this.callbacks.bulkProgressCallback) {
      this.callbacks.bulkProgressCallback('FETCHING_OPTIONS', 25, 'Loading options data');
    }

    try {
      const optionsData = await fetchOptionsData(symbol);

      if (this.isCancelled) return null;

      this.callbacks.setOptionsData(optionsData);
      this.callbacks.setAnalysisStatus(prev => ({...prev, optionsReady: true}));
      return optionsData;
    } catch (error) {
      if (!this.isCancelled) {
        handleError(error, `Fetching options data for ${symbol}`, this.toast);
      }
      this.callbacks.setAnalysisStatus(prev => ({...prev, optionsReady: true}));
      return null;
    } finally {
      this.callbacks.setIsLoadingOptionsData(false);
    }
  }

  async handleSearch(symbol, settings, selectedMarketIndex) {
      if (!symbol) return;

      this.cleanupSocketConnection();
      this.resetAllState();
      this.setupSocketConnection();

      this.callbacks.setAnalysisHasRecommendation(false);
      this.callbacks.setClaudeImages(null);
      this.callbacks.setOptionsImages(null);
      this.callbacks.setOptionsData(null);
      this.callbacks.setAnalysisStatus({
        stockCompleted: false,
        industryCompleted: false,
        marketCompleted: false,
        imageReady: false,
        optionsReady: false,
        companyInfoCompleted: false,
        pricesCompleted: false
      });

      this.callbacks.setStockHistoricalData([]);
      this.callbacks.setSelectedIndexHistoricalData([]);

      this.callbacks.setStockSymbol(symbol);
      this.stockSymbolRef.current = symbol;
      this.industrySymbolRef.current = '';
      this.callbacks.dispatchLoading({ type: 'START_ANALYSIS' });

      this.callbacks.setArticles([]);
      this.callbacks.setStockAnalyzedArticles([]);
      this.callbacks.setIndustryAnalyzedArticles([]);
      this.callbacks.setStockSentimentData([]);
      this.callbacks.setIndustrySentimentData([]);
      this.callbacks.setStockPriceData([]);
      this.callbacks.setRecommendationData(null);
      this.callbacks.setSettingsChanged(false);
      this.callbacks.setThinkingStreams([]);

      this.callbacks.setStockProcessingState({
        articlesFetched: 0, articlesAnalyzed: 0, totalArticles: 0, rejectedArticles: 0
      });

      this.callbacks.setIndustryProcessingState({
        articlesFetched: 0, articlesAnalyzed: 0, totalArticles: 0, rejectedArticles: 0
      });

      this.callbacks.setMarketProcessingState({
        articlesFetched: 0, articlesAnalyzed: 0, totalArticles: 0, rejectedArticles: 0
      });

      const marketSentimentPromise = this.analyzeMarketSentiment(settings);

      addLog(`Analyzing ${symbol} over ${settings.daysBack} days`, 'info');

      try {
        if (this.callbacks.bulkProgressCallback) {
          this.callbacks.bulkProgressCallback('FETCHING_INFO', 5, `Fetching company info for ${symbol}`);
        }

        let companyData;
        try {
          companyData = await fetchStockInfo(symbol);
          if (this.isCancelled) return;
          this.callbacks.setCompanyInfo(companyData);
          this.callbacks.setAnalysisStatus(prev => ({...prev, companyInfoCompleted: true}));
          subscribeToStock(symbol);
        } catch (error) {
          if (!this.isCancelled) {
            handleError(error, "Fetching company information", this.toast);
          }
          throw error;
        }

        if (this.callbacks.bulkProgressCallback) {
          this.callbacks.bulkProgressCallback('STARTING_PARALLEL_FETCH', 10, 'Starting parallel data fetch');
        }

        if (companyData.industry_keywords && companyData.industry_keywords.length > 0) {
          const industrySymbol = `INDUSTRY_${symbol}`;
          this.industrySymbolRef.current = industrySymbol;
          subscribeToStock(industrySymbol);
          this.callbacks.setIndustryProcessingState({
            articlesFetched: 0, articlesAnalyzed: 0, totalArticles: 0, rejectedArticles: 0
          });
        } else {
          this.callbacks.setAnalysisStatus(prev => ({...prev, industryCompleted: true}));
        }

        const allPromises = [];

        const marketDataPromise = this.fetchSelectedMarketIndexData(selectedMarketIndex, symbol, settings)
          .then(() => {
            if (!this.isCancelled) {
              this.callbacks.setAnalysisStatus(prev => ({...prev, pricesCompleted: true}));
            }
          });
        allPromises.push(marketDataPromise);

        allPromises.push(
          this.fetchOptionsData(symbol)
            .catch(error => {
              if (!this.isCancelled) {
                handleError(error, "Fetching options data", this.toast);
              }
            })
        );

        const { totalArticles } = getStockArticleFetchParams(settings, companyData);

        allPromises.push(
          fetchArticles({
            symbol,
            companyName: companyData.name,
            ceo: companyData.ceo,
            keywords: companyData.search_keywords || [],
            daysBack: settings.daysBack,
            totalArticles: totalArticles,
            useTurboModel: settings.useTurboModel
          }).then(() => {
            if (!this.isCancelled) {
              addLog(`Stock articles fetching initiated for ${symbol}`, 'success');
            }
          }).catch(error => {
            if (!this.isCancelled) {
              handleError(error, "Fetching stock news articles", this.toast);
              this.callbacks.setAnalysisStatus(prev => ({...prev, stockCompleted: true}));
            }
          })
        );

        if (companyData.industry_keywords && companyData.industry_keywords.length > 0) {
          const industrySymbol = `INDUSTRY_${symbol}`;

          allPromises.push(
            fetchArticles({
              symbol: industrySymbol,
              companyName: `${companyData.name} Industry`,
              ceo: "",
              keywords: companyData.industry_keywords,
              daysBack: settings.daysBack,
              totalArticles: totalArticles,
              useTurboModel: settings.useTurboModel
            }).then(() => {
              if (!this.isCancelled) {
                addLog(`Industry articles fetching initiated for ${symbol}`, 'success');
              }
            }).catch(error => {
              if (!this.isCancelled) {
                handleError(error, "Fetching industry news articles", this.toast);
                this.callbacks.setAnalysisStatus(prev => ({...prev, industryCompleted: true}));
              }
            })
          );
        }

        if (this.callbacks.bulkProgressCallback) {
          this.callbacks.bulkProgressCallback('PARALLEL_PROCESSING', 30, 'Processing all data streams in parallel');
        }

        await Promise.all([...allPromises, marketSentimentPromise]);

        if (!this.isCancelled) {
          addLog(`All parallel operations completed for ${symbol}`, 'success');
        }

      } catch (error) {
        if (!this.isCancelled) {
          handleError(error, `Analyzing stock ${symbol}`, this.toast);
          this.callbacks.setAnalysisStatus(prev => ({
            ...prev,
            stockCompleted: true,
            industryCompleted: true,
            marketCompleted: true,
            optionsReady: true,
            companyInfoCompleted: true,
            pricesCompleted: true
          }));
        }
      } finally {
        this.callbacks.dispatchLoading({ type: 'END_ANALYSIS' });
      }
    }

  async handleRequestRecommendation(
    stockSymbol,
    companyInfo,
    claudeImages,
    stockAnalyzedArticles,
    industryAnalyzedArticles,
    marketAnalyzedArticles,
    displayRecommendation,
    selectedMarketIndex,
    settings
  ) {
    if (this.isCancelled) return;

    if (!stockSymbol || !companyInfo) {
      showToast(this.toast, {
        title: 'Missing Data',
        description: 'Cannot generate recommendation without company information',
        status: 'warning'
      });
      return;
    }

    if (!claudeImages || !claudeImages.length) {
      showToast(this.toast, {
        title: 'Visualization Missing',
        description: 'Cannot generate recommendation without visualization images',
        status: 'warning'
      });
      return;
    }

    this.callbacks.setThinkingStreams([]);
    this.callbacks.dispatchLoading({ type: 'START_RECOMMENDATION' });

    const marketIndex = selectedMarketIndex || MARKET_INDICES.DEFAULT_INDEX;

    try {
      if (stockAnalyzedArticles.length === 0) {
        showToast(this.toast, {
          title: 'Missing Data',
          description: 'Cannot generate recommendation without analyzed articles',
          status: 'warning'
        });
        this.callbacks.dispatchLoading({ type: 'END_RECOMMENDATION' });
        return;
      }

      const articlesForRecommendation = [
        ...stockAnalyzedArticles,
        ...(industryAnalyzedArticles || []),
        ...(marketAnalyzedArticles || [])
      ];

      const recommendation = await getRecommendation({
        symbol: stockSymbol,
        companyName: companyInfo.name,
        analyzedArticleIds: articlesForRecommendation.map(a => a.url),
        marketIndices: [marketIndex],
        daysBack: settings.daysBack,
        yearsBack: 2,
        visualizationImages: claudeImages,
        optionsVisualizationImages: this.optionsImages || []
      });

      if (!this.isCancelled) {
        this.callbacks.setRecommendationData(recommendation);
      }
      this.callbacks.dispatchLoading({ type: 'END_RECOMMENDATION' });
      return recommendation;
    } catch (error) {
      if (!this.isCancelled) {
        handleError(error, "Generating recommendation", this.toast);
      }
      this.callbacks.dispatchLoading({ type: 'END_RECOMMENDATION' });
    }
  }

  async handleRequestPortfolioAnalysis(forceRefresh = false) {
    if (this.isCancelled) return;

    this.callbacks.setIsLoadingPortfolio(true);
    try {
      const response = await getPortfolioRecommendation({ forceRefresh });
      return response;
    } catch (error) {
      if (!this.isCancelled) {
        handleError(error, "Requesting portfolio analysis", this.toast);
      }
      return null;
    } finally {
      this.callbacks.setIsLoadingPortfolio(false);
    }
  }

  async handleRequestPredictionAccuracy(symbol = 'ALL', params = {}) {
      if (this.isCancelled) return;

      const { forceRefresh = false, includeClaudeAnalysis = false } = params;

      if (includeClaudeAnalysis) {
        this.callbacks.setIsAnalyzingPredictionAccuracy(true);
        addLog(`Requesting AI analysis of prediction data for ${symbol}`, 'info');
      } else {
        this.callbacks.setIsLoadingPredictionAccuracy(true);
        addLog(`Requesting prediction accuracy for ${symbol}${forceRefresh ? ' (force refresh)' : ''}`, 'info');
      }

      try {
        const response = await getPredictionAccuracy(symbol, {
          forceRefresh,
          includeClaudeAnalysis
        });

        if (!this.isCancelled) {
            if (includeClaudeAnalysis) {
              if (response?.ai_analysis) {
                addLog(`AI historical analysis completed successfully for ${symbol}`, 'success');
                showToast(this.toast, {
                  title: 'AI Analysis Complete',
                  description: 'AI insights generated for prediction performance',
                  status: 'success'
                });
              } else if (response?.ai_analysis_error) {
                addLog(`AI analysis failed for ${symbol}: ${response.ai_analysis_error}`, 'error');
                showToast(this.toast, {
                  title: 'AI Analysis Failed',
                  description: response.ai_analysis_error,
                  status: 'error'
                });
              }
            } else {
               if (response?.metadata) {
                const scope = symbol === 'ALL' ? 'Portfolio' : symbol;
                const symbolsText = response.metadata.symbols_count > 1 ? ` across ${response.metadata.symbols_count} symbols` : '';
                addLog(`${scope} prediction accuracy loaded: ${response.metadata.processed_count} predictions${symbolsText}`, 'success');
                showToast(this.toast, {
                  title: `${scope} Analysis Complete`,
                  description: `Analyzed ${response.metadata.processed_count} predictions${symbolsText}`,
                  status: 'success'
                });
              }
            }
        }
        return response;
      } catch (error) {
        if (!this.isCancelled) {
          handleError(error, `Loading prediction accuracy for ${symbol}`, this.toast);
        }
        return null;
      } finally {
        if (includeClaudeAnalysis) {
          this.callbacks.setIsAnalyzingPredictionAccuracy(false);
        } else {
          this.callbacks.setIsLoadingPredictionAccuracy(false);
        }
      }
    }

  async handleFetchSystemSymbols(isSilent = false) {
    if (!isSilent) {
        this.callbacks.setIsSystemSymbolsLoading(true);
    }
    try {
        const allRecs = await getHistoricalRecommendation('ALL', 20, false, 'portfolio');
        if (!isSilent) {
            showToast(this.toast, {
                title: 'System Symbols Loaded',
                description: `Fetched the latest recommendations for ${allRecs.length} symbols.`,
                status: 'success'
            });
        }
        return allRecs;
    } catch (error) {
        handleError(error, 'Fetching system symbols', this.toast);
        return null;
    } finally {
        if (!isSilent) {
            this.callbacks.setIsSystemSymbolsLoading(false);
        }
    }
  }
}

export default DashboardDataService;