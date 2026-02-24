import { useMemo } from 'react';

const PROGRESS_STAGES = [
  {
    key: 'company',
    label: 'Company Info',
    isComplete: (analysisStatus) => analysisStatus?.companyInfoCompleted,
    stageName: 'FETCHING_INFO'
  },
  {
    key: 'prices',
    label: 'Stock Prices',
    isComplete: (analysisStatus) => analysisStatus?.pricesCompleted,
    stageName: 'FETCHING_PRICES'
  },
  {
    key: 'options',
    label: 'Options Data',
    isComplete: (analysisStatus) => analysisStatus?.optionsReady,
    stageName: 'FETCHING_OPTIONS'
  },
  {
    key: 'stockArticles',
    label: 'Stock Articles',
    isComplete: (analysisStatus) => analysisStatus?.stockCompleted,
    stageName: 'FETCHING_ARTICLES'
  },
  {
    key: 'marketArticles',
    label: 'Market Articles',
    isComplete: (analysisStatus) => analysisStatus?.marketCompleted,
    stageName: 'FETCHING_ARTICLES'
  },
  {
    key: 'industryArticles',
    label: 'Industry Articles',
    isComplete: (analysisStatus) => analysisStatus?.industryCompleted,
    stageName: 'FETCHING_ARTICLES'
  },
  {
    key: 'tuning',
    label: 'Auto-Tuning',
    isComplete: (analysisStatus, recommendationData, tunerResults) => !!tunerResults,
    stageName: 'TUNING'
  },
  {
    key: 'visualization',
    label: 'Visualization',
    isComplete: (analysisStatus) => analysisStatus?.imageReady,
    stageName: 'GENERATING_VISUALIZATION'
  },
  {
    key: 'recommendation',
    label: 'AI Recommendation',
    isComplete: (analysisStatus, recommendationData) => !!recommendationData,
    stageName: 'GENERATING_RECOMMENDATION'
  },
];

export const useProgressTracker = (analysisStatus, currentStageName, recommendationData, tunerResults, isTuning) => {
  const stages = useMemo(() => {
    if (!analysisStatus) return [];

    return PROGRESS_STAGES.map((stage) => {
      const isComplete = stage.isComplete(analysisStatus, recommendationData, tunerResults);
      let status = 'pending';

      if (isComplete) {
        status = 'complete';
      } else if (stage.key === 'tuning' && isTuning) {
        status = 'active';
      } else {
        const isActiveStageName = currentStageName && stage.stageName === currentStageName;
        if (isActiveStageName) {
          status = 'active';
        }
      }

      return {
        ...stage,
        status,
      };
    });
  }, [analysisStatus, currentStageName, recommendationData, tunerResults, isTuning]);

  return stages;
};