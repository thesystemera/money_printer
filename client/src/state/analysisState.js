export const initialAnalysisState = {
  isActive: false,
  isPaused: false,
  currentStock: null,
  queue: [],
  completedStocks: [],
  failedStocks: [],
  error: null,
  totalCount: 0,
  currentProgress: {
    stage: 'WAITING',
    percentage: 0,
    message: ''
  },
  startTime: null,
  retryAttempts: {},
  generatedImages: {}
};

export function analysisReducer(state, action) {
  switch (action.type) {
    case 'START_SINGLE_ANALYSIS':
      return {
        ...initialAnalysisState,
        isActive: true,
        queue: [action.payload.symbol],
        totalCount: 1,
        startTime: Date.now(),
        currentStock: action.payload.symbol,
        currentProgress: {
          stage: 'FETCHING_INFO',
          percentage: 5,
          message: `Starting analysis for ${action.payload.symbol}`
        },
      };
    case 'START_BULK':
      return {
        ...initialAnalysisState,
        isActive: true,
        queue: [...action.payload.stocks],
        totalCount: action.payload.stocks.length,
        startTime: Date.now(),
        retryAttempts: {}
      };
    case 'PAUSE_BULK':
      return { ...state, isPaused: true };
    case 'RESUME_BULK':
      return { ...state, isPaused: false, error: null };
    case 'CANCEL_BULK':
      return { ...initialAnalysisState };
    case 'START_STOCK':
      return {
        ...state,
        currentStock: action.payload.symbol,
        currentProgress: {
          stage: 'FETCHING_INFO',
          percentage: 5,
          message: `Starting analysis for ${action.payload.symbol}`
        },
        generatedImages: {}
      };
    case 'UPDATE_PROGRESS':
      return {
        ...state,
        currentProgress: {
          ...state.currentProgress,
          ...action.payload
        }
      };
    case 'UPDATE_IMAGES':
      return {
        ...state,
        generatedImages: {
          ...state.generatedImages,
          ...action.payload
        }
      };
    case 'COMPLETE_STOCK':
      const remainingQueue = state.queue.filter(s => s !== state.currentStock);
      const isNowInactive = remainingQueue.length === 0;

      return {
          ...state,
          isActive: !isNowInactive, // <-- THIS IS THE FIX
          queue: remainingQueue,
          completedStocks: [...state.completedStocks, {
              symbol: state.currentStock,
              status: 'COMPLETE',
              action: action.payload.action,
              completedAt: Date.now(),
              duration: Date.now() - (action.payload.startTime || Date.now()),
              generatedImages: { ...state.generatedImages }
          }],
          currentStock: null,
          currentProgress: { stage: 'WAITING', percentage: 0, message: '' },
          generatedImages: {}
      };
    case 'FAIL_STOCK':
      const maxRetries = 2;
      const currentRetries = state.retryAttempts[state.currentStock] || 0;

      if (currentRetries < maxRetries) {
        return {
          ...state,
          retryAttempts: {
            ...state.retryAttempts,
            [state.currentStock]: currentRetries + 1
          },
          queue: [...state.queue, state.currentStock],
          currentStock: null,
          currentProgress: { stage: 'WAITING', percentage: 0, message: '' },
          generatedImages: {}
        };
      } else {
        const remainingQueueAfterFail = state.queue.filter(s => s !== state.currentStock);
        return {
          ...state,
          queue: remainingQueueAfterFail,
          failedStocks: [...state.failedStocks, {
            symbol: state.currentStock,
            status: 'ERROR',
            error: action.payload.error,
            completedAt: Date.now(),
            duration: Date.now() - (action.payload.startTime || Date.now()),
            generatedImages: { ...state.generatedImages }
          }],
          currentStock: null,
          currentProgress: { stage: 'WAITING', percentage: 0, message: '' },
          generatedImages: {}
        };
      }
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    default:
      return state;
  }
}