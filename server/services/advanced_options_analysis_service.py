import json
import os
import tempfile
import asyncio
from services import log_service
from scipy import stats
import numpy as np
import time


class JavaScriptOptionsAnalyzer:
    BLEND_TIMEOUT = 90
    SLICING_TIMEOUT = 120
    ANALYSIS_TIMEOUT = 60

    def __init__(self):
        self.js_code = '''
    function findOptimalBlend(optionsData) {
        const startTime = Date.now();
        console.error('[JS] findOptimalBlend started');
        let bestScore = -Infinity;
        let bestBlend = {};
        let combinationsTested = 0;

        const trendDataForBlending = calculateEnhancedTrendData(optionsData, 36, 12, 0.25, {});
        console.error('[JS] calculateEnhancedTrendData returned ' + trendDataForBlending.length + ' items');

        const historicalOnlyForBlending = trendDataForBlending.filter(item => !item.isSnapshot);
        console.error('[JS] historicalOnlyForBlending has ' + historicalOnlyForBlending.length + ' items');

        if (historicalOnlyForBlending.length < 20) {
            console.error('WARNING: Only ' + historicalOnlyForBlending.length + ' data points available for blending (minimum recommended: 20)');
        }

        const weightSteps = [0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];

        for (const rawFlowWeight of weightSteps) {
            for (const structureWeight of weightSteps) {
                const trendWeightRaw = 1.0 - rawFlowWeight - structureWeight;
                if (trendWeightRaw < -0.01) continue;

                const trendWeight = Math.round(trendWeightRaw * 100) / 100;
                if (trendWeight < 0) continue;

                const currentBlend = {
                    rawFlow: rawFlowWeight,
                    marketStructure: structureWeight,
                    smoothedTrend: trendWeight
                };
                combinationsTested++;

                const blendedSentiments = historicalOnlyForBlending.map(d => {
                    const rawFlow = (d.premiumSentimentScore + d.volumeSentimentScore) / 2;
                    const smoothedTrend = (d.rollingPremiumTrend + d.rollingVolumeTrend) / 2;
                    return (rawFlow * currentBlend.rawFlow) +
                            (d.marketStructureSentimentScore * currentBlend.marketStructure) +
                            (smoothedTrend * currentBlend.smoothedTrend);
                });

                const tempDailyAggregates = calculateDailyAggregatesForBlending(historicalOnlyForBlending, blendedSentiments);

                if (tempDailyAggregates.length < 2) {
                    console.error('WARNING: Skipping blend combination due to insufficient daily aggregates: ' + tempDailyAggregates.length);
                    continue;
                }

                const slopeBias = calculateOptimalDailyBias(tempDailyAggregates, 'intradaySlope');
                const score = calculateRiskAdjustedReturnsScore(tempDailyAggregates, slopeBias, 'intradaySlope');

                if (score > bestScore) {
                    bestScore = score;
                    bestBlend = currentBlend;
                }
            }
        }

        const finalBlendConfig = {
            name: 'Dynamic Optimal Blend',
            premiumSentimentScore: bestBlend.rawFlow / 2,
            volumeSentimentScore: bestBlend.rawFlow / 2,
            marketStructureSentimentScore: bestBlend.marketStructure,
            rollingPremiumTrend: bestBlend.smoothedTrend / 2,
            rollingVolumeTrend: bestBlend.smoothedTrend / 2,
        };

        console.error('[JS] findOptimalBlend completed in ' + ((Date.now() - startTime) / 1000) + 's');
        return {
            best_blend: finalBlendConfig,
            execution_time_seconds: (Date.now() - startTime) / 1000,
            combinations_tested: combinationsTested,
            data_points_used: historicalOnlyForBlending.length,
            warnings: historicalOnlyForBlending.length < 20 ? ['Insufficient data: only ' + historicalOnlyForBlending.length + ' points'] : []
        };
    }

    function findBestSlicingParams(optionsData, optimalBlend) {
        const startTime = Date.now();
        console.error('[JS] findBestSlicingParams started');

        const lookaroundOptions = [6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72];
        const minSegmentOptions = [6, 9, 12, 15, 18, 21, 24];
        const sensitivityOptions = [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];

        const results = [];
        const skippedConfigs = [];
        let minReturns = Infinity, maxReturns = -Infinity;
        let minCtcAccuracy = Infinity, maxCtcAccuracy = -Infinity;
        let minIntradayAccuracy = Infinity, maxIntradayAccuracy = -Infinity;

        let configCount = 0;
        const totalConfigs = lookaroundOptions.length * minSegmentOptions.length * sensitivityOptions.length;

        for (const lookaround of lookaroundOptions) {
            for (const minSegment of minSegmentOptions) {
                for (const sensitivity of sensitivityOptions) {
                    configCount++;
                    if (configCount % 50 === 0) {
                        console.error('[JS] Processing config ' + configCount + '/' + totalConfigs);
                    }

                    const currentTrendData = calculateEnhancedTrendData(
                        optionsData, lookaround, minSegment, sensitivity, optimalBlend
                    );

                    const historicalOnlyTrendData = currentTrendData.filter(item => !item.isSnapshot);

                    if (historicalOnlyTrendData.length < 20) {
                        console.error('WARNING: Config (lookaround=' + lookaround + ', minSegment=' + minSegment + ', sensitivity=' + sensitivity + ') has only ' + historicalOnlyTrendData.length + ' data points');
                        skippedConfigs.push({lookaround, minSegment, sensitivity, dataPoints: historicalOnlyTrendData.length});
                        if (historicalOnlyTrendData.length < 5) {
                            continue;
                        }
                    }

                    const currentDailyAggregatesResult = calculateDailyAggregates(historicalOnlyTrendData);
                    const currentDailyAggregates = currentDailyAggregatesResult.dailyData || [];

                    if (currentDailyAggregates.length < 2) {
                        console.error('WARNING: Config has insufficient daily aggregates: ' + currentDailyAggregates.length);
                        if (currentDailyAggregates.length === 0) {
                            continue;
                        }
                    }

                    const ctcBias = calculateOptimalDailyBias(currentDailyAggregates, 'closeToClose');
                    const slopeBias = calculateOptimalDailyBias(currentDailyAggregates, 'intradaySlope');

                    const returnsScore = calculateReturnsScore(currentDailyAggregates, slopeBias, 'intradaySlope');
                    const tempPredictionStats = calculatePredictionStats(
                        currentDailyAggregates, ctcBias, slopeBias
                    );

                    const ctcAccuracy = tempPredictionStats.closeToClose.accuracy;
                    const intradayAccuracy = tempPredictionStats.intradaySlope.accuracy;

                    results.push({
                        settings: {
                            lookaroundWindow: lookaround,
                            minSegmentSize: minSegment,
                            slicingSensitivity: sensitivity,
                        },
                        scores: { returnsScore, ctcAccuracy, intradayAccuracy },
                        dataPoints: historicalOnlyTrendData.length
                    });

                    if (returnsScore < minReturns) minReturns = returnsScore;
                    if (returnsScore > maxReturns) maxReturns = returnsScore;
                    if (ctcAccuracy < minCtcAccuracy) minCtcAccuracy = ctcAccuracy;
                    if (ctcAccuracy > maxCtcAccuracy) maxCtcAccuracy = ctcAccuracy;
                    if (intradayAccuracy < minIntradayAccuracy) minIntradayAccuracy = intradayAccuracy;
                    if (intradayAccuracy > maxIntradayAccuracy) maxIntradayAccuracy = intradayAccuracy;
                }
            }
        }

        console.error('[JS] Finished processing ' + results.length + ' valid configs');

        if (results.length === 0) {
            console.error("CRITICAL: No valid slicing configurations found!");
            return {
                best_slicing_params: {
                    lookaroundWindow: 36,
                    minSegmentSize: 12,
                    slicingSensitivity: 0.25
                },
                execution_time_seconds: (Date.now() - startTime) / 1000,
                combinations_tested: 0,
                error: "No valid configurations found",
                skipped_configs: skippedConfigs
            };
        }

        let bestCompositeScore = -Infinity;
        let bestResult = results[0];

        for (const result of results) {
            const normalizedReturns = (result.scores.returnsScore - minReturns) / (maxReturns - minReturns || 1);
            const normalizedCtcAccuracy = (result.scores.ctcAccuracy - minCtcAccuracy) / (maxCtcAccuracy - minCtcAccuracy || 1);
            const normalizedIntradayAccuracy = (result.scores.intradayAccuracy - minIntradayAccuracy) / (maxIntradayAccuracy - minIntradayAccuracy || 1);
            const compositeScore = normalizedReturns * 0.2 + normalizedCtcAccuracy * 0.2 + normalizedIntradayAccuracy * 0.6;

            if (compositeScore > bestCompositeScore) {
                bestCompositeScore = compositeScore;
                bestResult = result;
            }
        }

        console.error('[JS] findBestSlicingParams completed in ' + ((Date.now() - startTime) / 1000) + 's');
        return {
            best_slicing_params: bestResult.settings,
            execution_time_seconds: (Date.now() - startTime) / 1000,
            combinations_tested: results.length,
            data_points_in_best: bestResult.dataPoints,
            skipped_configs_count: skippedConfigs.length,
            warnings: skippedConfigs.length > 0 ? ['Skipped ' + skippedConfigs.length + ' configs due to insufficient data'] : []
        };
    }

    function calculateEnhancedTrendData(optionsData, lookaroundWindow, minSegmentSize, sensitivity, sentimentBlend = { rollingCombinedTrend: 1.0 }) {
        console.error('[JS] calculateEnhancedTrendData started with lookaround=' + lookaroundWindow);

        const dailyDataDict = optionsData?.tier_2_historical?.daily_data;
        if (!dailyDataDict) {
            console.error("CRITICAL: No daily data in tier_2_historical!");
            return [];
        }

        const missingPriceDates = [];
        const timeBucketData = [];

        Object.entries(dailyDataDict).forEach(([date, dayData]) => {
            const timeBuckets = dayData.time_buckets;
            if (!timeBuckets) {
                console.error('WARNING: No time_buckets for date ' + date);
                return;
            }

            let dayHasValidPrice = false;
            Object.entries(timeBuckets).forEach(([_bucketKey, bucketData]) => {
                const price = bucketData.current_price || 0;
                if (price === 0) {
                    missingPriceDates.push(date + ' ' + (bucketData.time_label || _bucketKey));
                } else {
                    dayHasValidPrice = true;
                }

                timeBucketData.push({
                    date: date + ' ' + (bucketData.time_label || ''),
                    price: price,
                    volumePutCallRatio: bucketData.put_call_ratios?.volume_put_call_ratio || 0,
                    premiumPutCallRatio: bucketData.put_call_ratios?.premium_put_call_ratio || 0,
                    volumeSentimentScore: bucketData.volume_sentiment_score || 0,
                    premiumSentimentScore: bucketData.premium_sentiment_score || 0,
                    marketStructureSentimentScore: bucketData.market_structure_sentiment_score || 0,
                    callVolume: bucketData.put_call_ratios?.call_volume || 0,
                    putVolume: bucketData.put_call_ratios?.put_volume || 0,
                    callPremium: bucketData.put_call_ratios?.call_premium || 0,
                    putPremium: bucketData.put_call_ratios?.put_premium || 0,
                    netFlow: (bucketData.put_call_ratios?.call_volume || 0) - (bucketData.put_call_ratios?.put_volume || 0)
                });
            });

            if (!dayHasValidPrice) {
                console.error('CRITICAL: Date ' + date + ' has NO valid prices in any bucket!');
            }
        });

        if (missingPriceDates.length > 0) {
            console.error('WARNING: ' + missingPriceDates.length + ' buckets have zero/missing prices');
        }

        const sorted = timeBucketData.sort((a, b) => {
            const getSortableString = (item) => {
                const parts = item.date.split(' ');
                const datePart = parts[0];
                const timePart = parts[1] ? parts[1].split('-')[0] : '00:00';
                return datePart + 'T' + timePart + ':00';
            };
            const aStr = getSortableString(a);
            const bStr = getSortableString(b);
            return aStr.localeCompare(bStr);
        });

        const historicalData = sorted;

        const firstValidPriceIndex = historicalData.findIndex(d => d.price > 0);
        if (firstValidPriceIndex > 0) {
            const firstValidPrice = historicalData[firstValidPriceIndex].price;
            for (let i = 0; i < firstValidPriceIndex; i++) {
                historicalData[i].price = firstValidPrice;
            }
        }

        const alpha5 = 2 / (5 + 1);
        const alpha7 = 2 / (7 + 1);
        const processedHistorical = [];
        let emaPremiumTrend = 0, emaVolumeTrend = 0, emaCombinedTrend = 0, emaMarketStructureTrend = 0;

        for (let i = 0; i < historicalData.length; i++) {
            const item = historicalData[i];

            const sentiments = [item.volumeSentimentScore, item.premiumSentimentScore, item.marketStructureSentimentScore];
            const meanSentiment = sentiments.reduce((a, b) => a + b, 0) / 3;
            const stdDev = Math.sqrt(sentiments.map(x => Math.pow(x - meanSentiment, 2)).reduce((a, b) => a + b, 0) / 3);
            const agreement = Math.max(0, 1 - stdDev);
            const currentCombined = meanSentiment * agreement;

            if (i === 0) {
                emaPremiumTrend = item.premiumSentimentScore;
                emaVolumeTrend = item.volumeSentimentScore;
                emaMarketStructureTrend = item.marketStructureSentimentScore;
                emaCombinedTrend = currentCombined;
            } else {
                emaPremiumTrend = (alpha5 * item.premiumSentimentScore) + ((1 - alpha5) * emaPremiumTrend);
                emaVolumeTrend = (alpha5 * item.volumeSentimentScore) + ((1 - alpha5) * emaVolumeTrend);
                emaMarketStructureTrend = (alpha5 * item.marketStructureSentimentScore) + ((1 - alpha5) * emaMarketStructureTrend);
                emaCombinedTrend = (alpha7 * currentCombined) + ((1 - alpha7) * emaCombinedTrend);
            }

            const blendedSentiment =
                (item.volumeSentimentScore * (sentimentBlend.volumeSentimentScore || 0)) +
                (item.premiumSentimentScore * (sentimentBlend.premiumSentimentScore || 0)) +
                (item.marketStructureSentimentScore * (sentimentBlend.marketStructureSentimentScore || 0)) +
                (emaVolumeTrend * (sentimentBlend.rollingVolumeTrend || 0)) +
                (emaPremiumTrend * (sentimentBlend.rollingPremiumTrend || 0)) +
                (emaCombinedTrend * (sentimentBlend.rollingCombinedTrend || 0)) +
                (emaMarketStructureTrend * (sentimentBlend.rollingMarketStructureTrend || 0));

            const previous = i > 0 ? processedHistorical[i - 1] : null;
            processedHistorical.push({
                ...item,
                rollingPremiumTrend: emaPremiumTrend,
                rollingVolumeTrend: emaVolumeTrend,
                rollingCombinedTrend: emaCombinedTrend,
                rollingMarketStructureTrend: emaMarketStructureTrend,
                blendedSentiment: blendedSentiment,
                volumeMomentum: previous ? item.volumeSentimentScore - previous.volumeSentimentScore : 0,
                premiumMomentum: previous ? item.premiumSentimentScore - previous.premiumSentimentScore : 0,
                marketStructureMomentum: previous ? item.marketStructureSentimentScore - previous.marketStructureSentimentScore : 0,
                premiumTrendMomentum: previous ? emaPremiumTrend - previous.rollingPremiumTrend : 0,
                volumeTrendMomentum: previous ? emaVolumeTrend - previous.rollingVolumeTrend : 0,
                combinedTrendMomentum: previous ? emaCombinedTrend - previous.rollingCombinedTrend : 0,
                marketStructureTrendMomentum: previous ? emaMarketStructureTrend - previous.rollingMarketStructureTrend : 0,
            });
        }

        console.error('[JS] About to detect inflection points for ' + processedHistorical.length + ' data points');

        const historicalPriceData = processedHistorical.map(p => p.price);
        const inflectionPoints = detectInflectionPoints(historicalPriceData, lookaroundWindow, sensitivity);

        console.error('[JS] Detected ' + inflectionPoints.length + ' inflection points');

        const segmentBoundaries = [0, ...inflectionPoints.map(p => p.index), processedHistorical.length - 1];
        const segmentData = [];
        for (let i = 0; i < segmentBoundaries.length - 1; i++) {
            const start = segmentBoundaries[i];
            const end = segmentBoundaries[i+1];
            const isLastSegment = (i === segmentBoundaries.length - 2);

            if (start >= end) continue;
            if (!isLastSegment && (end - start) < minSegmentSize) continue;

            const priceSlice = historicalPriceData.slice(start, end + 1);
            const trendSlice = processedHistorical.slice(start, end + 1).map(p => p.blendedSentiment);
            segmentData.push({
                startIndex: start,
                endIndex: end,
                minPrice: Math.min(...priceSlice),
                maxPrice: Math.max(...priceSlice),
                minTrend: Math.min(...trendSlice),
                maxTrend: Math.max(...trendSlice)
            });
        }

        let segmentIndex = 0;
        const historicalFinal = processedHistorical.map((item, index) => {
            while (segmentIndex < segmentData.length - 1 && index > segmentData[segmentIndex].endIndex) {
                segmentIndex++;
            }
            const currentSegment = segmentData[segmentIndex];
            if (!currentSegment || index < currentSegment.startIndex || index > currentSegment.endIndex) {
                return { ...item, normalizedPrice: 0, normalizedTrend: 0, dislocation: 0 };
            }
            const { minPrice, maxPrice, minTrend, maxTrend } = currentSegment;

            const normalizedPrice = 2 * ((item.price - minPrice) / (maxPrice - minPrice || 1)) - 1;
            const normalizedTrend = 2 * ((item.blendedSentiment - minTrend) / (maxTrend - minTrend || 1)) - 1;
            const dislocation = normalizedTrend - normalizedPrice;

            return { ...item, normalizedPrice, normalizedTrend, dislocation };
        });

        const tier1 = optionsData?.tier_1_current;
        if (tier1 && historicalFinal.length > 0) {
            const lastHistorical = historicalFinal[historicalFinal.length - 1];
            const snapshotPoint = {
                date: lastHistorical.date.split(' ')[0] + ' 16:00-SNAPSHOT',
                isSnapshot: true,
                price: tier1.current_price || 0,
                volumeSentimentScore: tier1.volume_sentiment_score || 0,
                premiumSentimentScore: tier1.premium_sentiment_score || 0,
                marketStructureSentimentScore: tier1.market_structure_sentiment_score || 0,
                volumePutCallRatio: tier1.put_call_ratios?.volume_put_call_ratio || 0,
                premiumPutCallRatio: tier1.put_call_ratios?.premium_put_call_ratio || 0,
                callVolume: null,
                putVolume: null,
                callPremium: null,
                putPremium: null,
                netFlow: null,
                rollingPremiumTrend: lastHistorical.rollingPremiumTrend,
                rollingVolumeTrend: lastHistorical.rollingVolumeTrend,
                rollingCombinedTrend: lastHistorical.rollingCombinedTrend,
                rollingMarketStructureTrend: lastHistorical.rollingMarketStructureTrend,
            };

            const sentiments = [snapshotPoint.volumeSentimentScore, snapshotPoint.premiumSentimentScore, snapshotPoint.marketStructureSentimentScore];
            const meanSentiment = sentiments.reduce((a, b) => a + b, 0) / 3;
            const stdDev = Math.sqrt(sentiments.map(x => Math.pow(x - meanSentiment, 2)).reduce((a, b) => a + b, 0) / 3);
            const agreement = Math.max(0, 1 - stdDev);

            snapshotPoint.blendedSentiment =
                (snapshotPoint.volumeSentimentScore * (sentimentBlend.volumeSentimentScore || 0)) +
                (snapshotPoint.premiumSentimentScore * (sentimentBlend.premiumSentimentScore || 0)) +
                (snapshotPoint.marketStructureSentimentScore * (sentimentBlend.marketStructureSentimentScore || 0)) +
                (snapshotPoint.rollingVolumeTrend * (sentimentBlend.rollingVolumeTrend || 0)) +
                (snapshotPoint.rollingPremiumTrend * (sentimentBlend.rollingPremiumTrend || 0)) +
                (snapshotPoint.rollingCombinedTrend * (sentimentBlend.rollingCombinedTrend || 0)) +
                (snapshotPoint.rollingMarketStructureTrend * (sentimentBlend.rollingMarketStructureTrend || 0));

            snapshotPoint.volumeMomentum = snapshotPoint.volumeSentimentScore - lastHistorical.volumeSentimentScore;
            snapshotPoint.premiumMomentum = snapshotPoint.premiumSentimentScore - lastHistorical.premiumSentimentScore;
            snapshotPoint.marketStructureMomentum = snapshotPoint.marketStructureSentimentScore - lastHistorical.marketStructureSentimentScore;
            snapshotPoint.premiumTrendMomentum = snapshotPoint.rollingPremiumTrend - lastHistorical.rollingPremiumTrend;
            snapshotPoint.volumeTrendMomentum = snapshotPoint.rollingVolumeTrend - lastHistorical.rollingVolumeTrend;
            snapshotPoint.combinedTrendMomentum = snapshotPoint.rollingCombinedTrend - lastHistorical.rollingCombinedTrend;
            snapshotPoint.marketStructureTrendMomentum = snapshotPoint.rollingMarketStructureTrend - lastHistorical.rollingMarketStructureTrend;

            snapshotPoint.normalizedPrice = 0;
            snapshotPoint.normalizedTrend = 0;
            snapshotPoint.dislocation = 0;

            return [...historicalFinal, snapshotPoint];
        }

        console.error('[JS] calculateEnhancedTrendData completed, returning ' + historicalFinal.length + ' items');
        return historicalFinal;
    }

    function calculateDailyAggregates(enhancedTrendData) {
        console.error('[JS] calculateDailyAggregates started with ' + enhancedTrendData.length + ' items');

        if (!enhancedTrendData || enhancedTrendData.length === 0) {
            console.error("CRITICAL: No enhanced trend data available for daily aggregates!");
            return { dailyData: [], optimalWeights: { closeToClose: {}, intradaySlope: {} } };
        }

        const historicalOnly = enhancedTrendData.filter(item => !item.isSnapshot);

        if (historicalOnly.length === 0) {
            console.error("CRITICAL: No historical data after filtering snapshots!");
            return { dailyData: [], optimalWeights: { closeToClose: {}, intradaySlope: {} } };
        }

        const groupedByDay = historicalOnly.reduce((acc, item, index) => {
            const day = item.date.split(' ')[0];
            if (!acc[day]) {
                acc[day] = { dislocations: [], prices: [], indices: [] };
            }
            acc[day].dislocations.push(item.dislocation);
            acc[day].prices.push(item.price);
            acc[day].indices.push(index);
            return acc;
        }, {});

        const dayCount = Object.keys(groupedByDay).length;
        if (dayCount === 0) {
            console.error("CRITICAL: No days found after grouping!");
            return { dailyData: [], optimalWeights: { closeToClose: {}, intradaySlope: {} } };
        }

        console.error('[JS] Processing ' + dayCount + ' days of data');

        const temporalExponents = [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0];
        const magnitudeFactors = [0.0, 0.15, 0.3, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0];

        let bestCloseToCloseScore = -Infinity;
        let bestCloseToCloseDailyData = [];
        let bestCloseToCloseWeights = { temporalExponent: 1.0, magnitudeFactor: 0.0 };

        console.error('[JS] Starting closeToClose optimization with ' + (temporalExponents.length * magnitudeFactors.length) + ' combinations');

        for (const tempExp of temporalExponents) {
            for (const magFactor of magnitudeFactors) {
                const dailyData = Object.keys(groupedByDay).map(day => {
                    const dislocations = groupedByDay[day].dislocations;
                    const prices = groupedByDay[day].prices;
                    let weightedSum = 0;
                    let totalWeight = 0;
                    for (let i = 0; i < dislocations.length; i++) {
                        const timeWeight = Math.pow((i + 1) / dislocations.length, tempExp);
                        const magnitudeWeight = 1 + magFactor * Math.abs(dislocations[i]);
                        const combinedWeight = timeWeight * magnitudeWeight;
                        weightedSum += dislocations[i] * combinedWeight;
                        totalWeight += combinedWeight;
                    }
                    const meanDislocation = totalWeight > 0 ? weightedSum / totalWeight : 0;
                    const openPrice = prices[0];
                    const closePrice = prices[prices.length - 1];
                    return { date: day, meanDislocation, openPrice, closePrice };
                }).sort((a, b) => a.date.localeCompare(b.date));

                const withNextDay = dailyData.map((day, i, arr) => {
                    const nextDay = arr[i + 1];
                    const nextDayPriceChange = nextDay ? nextDay.closePrice - day.closePrice : null;
                    const nextDayIntradaySlope = nextDay ? nextDay.closePrice - nextDay.openPrice : null;
                    return { ...day, nextDayPriceChange, nextDayIntradaySlope };
                });

                let closeToCloseScore = 0;
                let closeToCloseCount = 0;
                for (let i = 0; i < withNextDay.length - 1; i++) {
                    const day = withNextDay[i];
                    const predictedDirection = Math.sign(day.meanDislocation);
                    const actualDirection = Math.sign(day.nextDayPriceChange);
                    if (predictedDirection !== 0 && actualDirection !== 0) {
                        if (predictedDirection === actualDirection) {
                            closeToCloseScore += Math.abs(day.nextDayPriceChange);
                        } else {
                            closeToCloseScore -= Math.abs(day.nextDayPriceChange);
                        }
                        closeToCloseCount++;
                    }
                }

                if (closeToCloseCount > 0) {
                    const normalizedScore = closeToCloseScore / closeToCloseCount;
                    if (normalizedScore > bestCloseToCloseScore) {
                        bestCloseToCloseScore = normalizedScore;
                        bestCloseToCloseDailyData = withNextDay;
                        bestCloseToCloseWeights = { temporalExponent: tempExp, magnitudeFactor: magFactor };
                    }
                }
            }
        }

        console.error('[JS] closeToClose optimization complete, best score: ' + bestCloseToCloseScore);

        let bestIntradaySlopeScore = -Infinity;
        let bestIntradaySlopeWeights = { temporalExponent: 1.0, magnitudeFactor: 0.0 };

        console.error('[JS] Starting intradaySlope optimization');

        for (const tempExp of temporalExponents) {
            for (const magFactor of magnitudeFactors) {
                const dailyData = Object.keys(groupedByDay).map(day => {
                    const dislocations = groupedByDay[day].dislocations;
                    const prices = groupedByDay[day].prices;
                    let weightedSum = 0;
                    let totalWeight = 0;
                    for (let i = 0; i < dislocations.length; i++) {
                        const timeWeight = Math.pow((i + 1) / dislocations.length, tempExp);
                        const magnitudeWeight = 1 + magFactor * Math.abs(dislocations[i]);
                        const combinedWeight = timeWeight * magnitudeWeight;
                        weightedSum += dislocations[i] * combinedWeight;
                        totalWeight += combinedWeight;
                    }
                    const meanDislocation = totalWeight > 0 ? weightedSum / totalWeight : 0;
                    const openPrice = prices[0];
                    const closePrice = prices[prices.length - 1];
                    return { date: day, meanDislocation, openPrice, closePrice };
                }).sort((a, b) => a.date.localeCompare(b.date));

                const withNextDay = dailyData.map((day, i, arr) => {
                    const nextDay = arr[i + 1];
                    const nextDayPriceChange = nextDay ? nextDay.closePrice - day.closePrice : 0;
                    const nextDayIntradaySlope = nextDay ? nextDay.closePrice - nextDay.openPrice : 0;
                    return { ...day, nextDayPriceChange, nextDayIntradaySlope };
                });

                let intradaySlopeScore = 0;
                let intradaySlopeCount = 0;
                for (let i = 0; i < withNextDay.length - 1; i++) {
                    const day = withNextDay[i];
                    const predictedDirection = Math.sign(day.meanDislocation);
                    const actualDirection = Math.sign(day.nextDayIntradaySlope);
                    if (predictedDirection !== 0 && actualDirection !== 0) {
                        if (predictedDirection === actualDirection) {
                            intradaySlopeScore += Math.abs(day.nextDayIntradaySlope);
                        } else {
                            intradaySlopeScore -= Math.abs(day.nextDayIntradaySlope);
                        }
                        intradaySlopeCount++;
                    }
                }

                if (intradaySlopeCount > 0) {
                    const normalizedScore = intradaySlopeScore / intradaySlopeCount;
                    if (normalizedScore > bestIntradaySlopeScore) {
                        bestIntradaySlopeScore = normalizedScore;
                        bestIntradaySlopeWeights = { temporalExponent: tempExp, magnitudeFactor: magFactor };
                    }
                }
            }
        }

        console.error('[JS] intradaySlope optimization complete, best score: ' + bestIntradaySlopeScore);
        console.error('[JS] calculateDailyAggregates completed, returning ' + bestCloseToCloseDailyData.length + ' daily aggregates');

        return {
            dailyData: bestCloseToCloseDailyData,
            optimalWeights: {
                closeToClose: bestCloseToCloseWeights,
                intradaySlope: bestIntradaySlopeWeights
            }
        };
    }

    function calculateOptimalDailyBias(dailyAggregates, metricType = 'closeToClose') {
        if (!dailyAggregates || dailyAggregates.length < 2) return 0;
        let bestBias = 0;
        let bestScore = -Infinity;
        for (let i = -200; i <= 200; i++) {
            const bias = i / 200.0;
            let totalScore = 0;
            let validPredictions = 0;
            for (let j = 0; j < dailyAggregates.length - 1; j++) {
                const day = dailyAggregates[j];
                const correctedMeanDislocation = day.meanDislocation + bias;
                const priceChange = metricType === 'intradaySlope' ? day.nextDayIntradaySlope : day.nextDayPriceChange;
                if (Math.abs(priceChange) > 0.001) {
                    const predictedMagnitude = Math.abs(correctedMeanDislocation);
                    const actualMagnitude = Math.abs(priceChange);
                    const normalizedActual = Math.tanh(actualMagnitude / (day.closePrice * 0.01));
                    const predictedDirection = Math.sign(correctedMeanDislocation);
                    const actualDirection = Math.sign(priceChange);
                    if (Math.abs(predictedMagnitude) > 0.02) {
                        let score = 0;
                        if (predictedDirection === actualDirection) {
                            const proximityBonus = Math.exp(-Math.abs(predictedMagnitude - normalizedActual) * 5);
                            score = normalizedActual * (1 + proximityBonus);
                        } else {
                            score = -normalizedActual * (1 + predictedMagnitude);
                        }
                        totalScore += score;
                        validPredictions++;
                    }
                }
            }
            if (validPredictions > 0) {
                const avgScore = totalScore / validPredictions;
                if (avgScore > bestScore) {
                    bestScore = avgScore;
                    bestBias = bias;
                }
            }
        }
        return bestScore > 0.05 ? bestBias : 0;
    }

    function calculateReturnsScore(dailyAggregates, bias, metricType = 'closeToClose') {
        if (!dailyAggregates || dailyAggregates.length === 0) return 0;
        let totalReturns = 0;
        for (let i = 0; i < dailyAggregates.length - 1; i++) {
            const day = dailyAggregates[i];
            const correctedMeanDislocation = day.meanDislocation + bias;
            const predictedDirection = Math.sign(correctedMeanDislocation);
            const priceChange = metricType === 'intradaySlope' ? day.nextDayIntradaySlope : day.nextDayPriceChange;
            const actualDirection = Math.sign(priceChange);
            const actualMagnitude = Math.abs(priceChange);
            if (predictedDirection !== 0 && actualDirection !== 0) {
                if (predictedDirection === actualDirection) {
                    totalReturns += actualMagnitude;
                } else {
                    totalReturns -= actualMagnitude;
                }
            }
        }
        return totalReturns;
    }

    function calculatePredictionStats(dailyAggregates, closeToCloseBias, intradaySlopeBias) {
        const emptyResult = {
            accuracy: 0, correct: 0, total: 0,
            predictionLabel: 'Neutral', predictionDirection: 'Neutral', predictionStrength: 0,
            concurrence: 0, signalCount: 0, concurrenceCorrectCount: 0
        };
        if (!dailyAggregates || dailyAggregates.length < 2) {
            return { closeToClose: emptyResult, intradaySlope: emptyResult };
        }
        let ctcCorrect = 0, ctcTotal = 0;
        let slopeCorrect = 0, slopeTotal = 0;
        for (let i = 0; i < dailyAggregates.length - 1; i++) {
            const day = dailyAggregates[i];
            const ctcCorrectedDislocation = day.meanDislocation + closeToCloseBias;
            const ctcPredictedDirection = Math.sign(ctcCorrectedDislocation);
            const ctcActualDirection = Math.sign(day.nextDayPriceChange);
            if (ctcPredictedDirection !== 0 && ctcActualDirection !== 0) {
                if (ctcPredictedDirection === ctcActualDirection) ctcCorrect++;
                ctcTotal++;
            }
            const slopeCorrectedDislocation = day.meanDislocation + intradaySlopeBias;
            const slopePredictedDirection = Math.sign(slopeCorrectedDislocation);
            const slopeActualDirection = Math.sign(day.nextDayIntradaySlope);
            if (slopePredictedDirection !== 0 && slopeActualDirection !== 0) {
                if (slopePredictedDirection === slopeActualDirection) slopeCorrect++;
                slopeTotal++;
            }
        }
        const lastDay = dailyAggregates[dailyAggregates.length - 1];
        const historicalDays = dailyAggregates.slice(0, -1);
        const getPredictionStrengthLabel = (strength, direction) => {
            if (direction === 'Neutral') return 'Neutral';
            let label = '';
            if (strength > 1.5) label = 'Extremely';
            else if (strength > 1.0) label = 'Very';
            else if (strength > 0.5) label = '';
            else if (strength > 0.2) label = 'Slightly';
            else label = 'Weakly';
            return (label + ' ' + direction).trim();
        };
        const calculateNeighborhoodConcurrence = (currentStrength, historicalData, bias, metric) => {
            if (historicalData.length === 0) return { concurrence: 50, signalCount: 0 };
            const bandwidth = 0.5;
            let weightedOutcomeSum = 0;
            let weightSum = 0;
            historicalData.forEach(day => {
                const historicalDislocation = day.meanDislocation + bias;
                const historicalStrength = Math.abs(historicalDislocation);
                const distance = Math.abs(currentStrength - historicalStrength);
                const weight = Math.exp(-Math.pow(distance, 2) / (2 * Math.pow(bandwidth, 2)));
                const predictedDirection = Math.sign(historicalDislocation);
                const actualDirection = Math.sign(metric === 'closeToClose' ? day.nextDayPriceChange : day.nextDayIntradaySlope);
                if (predictedDirection !== 0 && actualDirection !== 0) {
                    const outcome = (predictedDirection === actualDirection) ? 1 : -1;
                    weightedOutcomeSum += outcome * weight;
                    weightSum += weight;
                }
            });
            if (weightSum === 0) return { concurrence: 50, signalCount: historicalData.length };
            const weightedAverageOutcome = weightedOutcomeSum / weightSum;
            const concurrence = (weightedAverageOutcome + 1) / 2 * 100;
            return { concurrence, signalCount: historicalData.length };
        };
        const ctcFinalDislocation = lastDay.meanDislocation + closeToCloseBias;
        const ctcStrength = Math.abs(ctcFinalDislocation);
        let ctcDirection = 'Neutral';
        if (ctcFinalDislocation > 0.001) ctcDirection = 'Bullish';
        if (ctcFinalDislocation < -0.001) ctcDirection = 'Bearish';
        const ctcConcurrenceResult = calculateNeighborhoodConcurrence(ctcStrength, historicalDays, closeToCloseBias, 'closeToClose');
        const slopeFinalDislocation = lastDay.meanDislocation + intradaySlopeBias;
        const slopeStrength = Math.abs(slopeFinalDislocation);
        let slopeDirection = 'Neutral';
        if (slopeFinalDislocation > 0.001) slopeDirection = 'Bullish';
        if (slopeFinalDislocation < -0.001) slopeDirection = 'Bearish';
        const slopeConcurrenceResult = calculateNeighborhoodConcurrence(slopeStrength, historicalDays, intradaySlopeBias, 'intradaySlope');
        return {
            closeToClose: {
                accuracy: ctcTotal > 0 ? (ctcCorrect / ctcTotal) * 100 : 0,
                correct: ctcCorrect,
                total: ctcTotal,
                predictionLabel: getPredictionStrengthLabel(ctcStrength, ctcDirection),
                predictionDirection: ctcDirection,
                predictionStrength: ctcStrength,
                concurrence: ctcConcurrenceResult.concurrence,
                signalCount: ctcConcurrenceResult.signalCount,
                concurrenceCorrectCount: 0,
            },
            intradaySlope: {
                accuracy: slopeTotal > 0 ? (slopeCorrect / slopeTotal) * 100 : 0,
                correct: slopeCorrect,
                total: slopeTotal,
                predictionLabel: getPredictionStrengthLabel(slopeStrength, slopeDirection),
                predictionDirection: slopeDirection,
                predictionStrength: slopeStrength,
                concurrence: slopeConcurrenceResult.concurrence,
                signalCount: slopeConcurrenceResult.signalCount,
                concurrenceCorrectCount: 0,
            }
        };
    }

    function detectInflectionPoints(data, lookaround, sensitivity = 0.2) {
        const points = [];
        if (data.length < 5) return [];

        const angleChanges = [];

        for (let i = 3; i < data.length - 3; i++) {
            const beforeSlope = (data[i] - data[i - 3]) / 3;
            const afterSlope = (data[i + 3] - data[i]) / 3;

            const angleBefore = Math.atan(beforeSlope);
            const angleAfter = Math.atan(afterSlope);
            const angleChange = Math.abs(angleAfter - angleBefore);

            angleChanges.push({
                index: i,
                angleChange: angleChange,
                value: data[i]
            });
        }

        angleChanges.sort((a, b) => b.angleChange - a.angleChange);

        const threshold = angleChanges[Math.floor(angleChanges.length * sensitivity)].angleChange;

        for (const point of angleChanges) {
            if (point.angleChange < threshold) break;

            const minSpacing = Math.max(3, Math.floor(lookaround / 4));
            const tooClose = points.some(p => Math.abs(p.index - point.index) < minSpacing);

            if (!tooClose) {
                points.push(point);
            }
        }

        return points.sort((a, b) => a.index - b.index);
    }

    function calculateRiskAdjustedReturnsScore(dailyAggregates, bias, metricType = 'closeToClose') {
        if (!dailyAggregates || dailyAggregates.length < 2) return 0;

        const dailyReturns = [];
        for (let i = 0; i < dailyAggregates.length - 1; i++) {
            const day = dailyAggregates[i];
            const correctedMeanDislocation = day.meanDislocation + bias;
            const predictedDirection = Math.sign(correctedMeanDislocation);

            if (predictedDirection !== 0) {
                const priceChange = metricType === 'intradaySlope' ? day.nextDayIntradaySlope : day.nextDayPriceChange;
                if (priceChange !== null) {
                    const dailyReturn = predictedDirection * priceChange;
                    dailyReturns.push(dailyReturn);
                }
            }
        }

        if (dailyReturns.length < 2) return 0;

        const meanReturn = dailyReturns.reduce((acc, val) => acc + val, 0) / dailyReturns.length;
        const stdDev = Math.sqrt(dailyReturns.map(x => Math.pow(x - meanReturn, 2)).reduce((a, b) => a + b) / dailyReturns.length);

        if (stdDev === 0) return meanReturn > 0 ? 1000 : 0;

        const sharpeRatio = meanReturn / stdDev;
        return sharpeRatio;
    }

    function calculateDailyAggregatesForBlending(trendData, blendedSentiments) {
        const historicalOnly = trendData.filter(item => !item.isSnapshot);
        const groupedByDay = historicalOnly.reduce((acc, item, index) => {
            const day = item.date.split(' ')[0];
            if (!acc[day]) {
                acc[day] = { sentiments: [], prices: [] };
            }
            acc[day].sentiments.push(blendedSentiments[index]);
            acc[day].prices.push(item.price);
            return acc;
        }, {});

        const dailyData = Object.keys(groupedByDay).map(day => {
            const sentiments = groupedByDay[day].sentiments;
            const prices = groupedByDay[day].prices;
            const meanSentiment = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
            return {
                date: day,
                meanDislocation: meanSentiment,
                openPrice: prices[0],
                closePrice: prices[prices.length - 1]
            };
        }).sort((a, b) => a.date.localeCompare(b.date));

        return dailyData.map((day, i, arr) => {
            const nextDay = arr[i + 1];
            return {
                ...day,
                nextDayPriceChange: nextDay ? nextDay.closePrice - day.closePrice : null,
                nextDayIntradaySlope: nextDay ? nextDay.closePrice - nextDay.openPrice : null
            };
        });
    }

    function runAnalysisWithParams(optionsData, best_params) {
        const startTime = Date.now();
        console.error('[JS] runAnalysisWithParams started');
        console.error('[JS] Parameters: ' + JSON.stringify(best_params));

        console.error('[JS] Calling calculateEnhancedTrendData...');
        const enhanced_trend_data = calculateEnhancedTrendData(
            optionsData, best_params.lookaroundWindow, best_params.minSegmentSize, best_params.slicingSensitivity, best_params.sentimentBlend
        );
        console.error('[JS] calculateEnhancedTrendData returned ' + enhanced_trend_data.length + ' items');

        console.error('[JS] Calling calculateDailyAggregates...');
        const agg_result = calculateDailyAggregates(enhanced_trend_data);
        const daily_aggregates = agg_result.dailyData;
        const optimal_weights = agg_result.optimalWeights;
        console.error('[JS] calculateDailyAggregates returned ' + daily_aggregates.length + ' daily aggregates');

        console.error('[JS] Calculating biases...');
        const ctcBias = calculateOptimalDailyBias(daily_aggregates, 'closeToClose');
        const slopeBias = calculateOptimalDailyBias(daily_aggregates, 'intradaySlope');
        console.error('[JS] Biases calculated: ctc=' + ctcBias + ', slope=' + slopeBias);

        console.error('[JS] Calculating prediction stats...');
        const prediction_stats = calculatePredictionStats(daily_aggregates, ctcBias, slopeBias);
        console.error('[JS] Prediction stats calculated');

        console.error('[JS] runAnalysisWithParams completed in ' + ((Date.now() - startTime) / 1000) + 's');

        return {
            best_params: best_params,
            enhanced_trend_data: enhanced_trend_data,
            daily_aggregates: daily_aggregates,
            optimal_weights: optimal_weights,
            prediction_stats: prediction_stats,
            optimal_bias: { closeToClose: ctcBias, intradaySlope: slopeBias },
            execution_time_seconds: (Date.now() - startTime) / 1000
        };
    }

    if (typeof process !== 'undefined' && process.stdin) {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('readable', () => {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) {
                data += chunk;
            }
        });
        process.stdin.on('end', () => {
            try {
                console.error('[JS] Stdin data received, length: ' + data.length);
                const { mode, optionsData, params } = JSON.parse(data);
                console.error('[JS] Mode: ' + mode);
                let result;
                if (mode === 'findOptimalBlend') {
                    result = findOptimalBlend(optionsData);
                } else if (mode === 'findBestSlicingParams') {
                    result = findBestSlicingParams(optionsData, params);
                } else if (mode === 'runAnalysisWithParams') {
                    result = runAnalysisWithParams(optionsData, params);
                }
                console.error('[JS] About to output result');
                console.log(JSON.stringify(result));
                console.error('[JS] Result output complete');
            } catch (e) {
                console.error('[JS] FATAL ERROR: ' + e.message);
                console.error('[JS] Stack: ' + e.stack);
                process.exit(1);
            }
        });
    }
    '''

    async def _run_js_command(self, mode, options_data, params=None, timeout=60):
        start_time = time.time()

        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as f:
            f.write(self.js_code)
            js_file = f.name

        try:
            payload = json.dumps({"mode": mode, "optionsData": options_data, "params": params})
            payload_size_mb = len(payload) / (1024 * 1024)

            await log_service.options(
                f"Starting JS {mode} | Payload: {payload_size_mb:.2f}MB | Timeout: {timeout}s"
            )

            process = await asyncio.create_subprocess_exec(
                'node',
                '--max-old-space-size=2048',
                js_file,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            await log_service.options(f"Node.js process started (PID: {process.pid})")

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(input=payload.encode()),
                    timeout=timeout
                )
                elapsed = time.time() - start_time
                await log_service.options(f"Node.js process completed in {elapsed:.2f}s")

            except asyncio.TimeoutError:
                elapsed = time.time() - start_time
                await log_service.error(
                    f"TIMEOUT after {elapsed:.2f}s (limit: {timeout}s) in {mode}! Killing PID {process.pid}"
                )

                try:
                    process.terminate()
                    await asyncio.wait_for(process.wait(), timeout=5)
                except asyncio.TimeoutError:
                    await log_service.error(f"Force killing PID {process.pid}")
                    process.kill()
                    await process.wait()

                raise TimeoutError(f"JavaScript {mode} timed out after {elapsed:.2f}s")

            if stderr:
                decoded_stderr = stderr.decode().strip()
                if decoded_stderr:
                    await log_service.options(f"Node stderr output:\n{decoded_stderr}")

            if process.returncode != 0:
                decoded_stderr = stderr.decode() if stderr else "No stderr"
                await log_service.error(
                    f"Node.js failed with exit code {process.returncode}\nStderr: {decoded_stderr}"
                )
                raise Exception(f"Node.js error (exit {process.returncode}): {decoded_stderr}")

            try:
                result = json.loads(stdout.decode())
            except json.JSONDecodeError as e:
                stdout_preview = stdout.decode()[:500]
                await log_service.error(
                    f"Failed to parse JSON output. Preview: {stdout_preview}"
                )
                raise Exception(f"Invalid JSON from Node.js: {e}")

            if 'error' in result:
                await log_service.error(f"Result contains error: {result['error']}")
                raise Exception(f"JavaScript error: {result['error']}")

            if 'execution_time_seconds' in result:
                await log_service.options(
                    f"{mode} JS execution time: {result['execution_time_seconds']:.2f}s"
                )

            return result

        finally:
            try:
                os.unlink(js_file)
            except Exception as e:
                await log_service.error(f"Failed to delete temp file: {e}")

    async def find_optimal_blend(self, options_data):
        return await self._run_js_command(
            'findOptimalBlend',
            options_data,
            timeout=self.BLEND_TIMEOUT
        )

    async def find_best_slicing_params(self, options_data, params):
        return await self._run_js_command(
            'findBestSlicingParams',
            options_data,
            params,
            timeout=self.SLICING_TIMEOUT
        )

    async def run_analysis_with_params(self, options_data, params):
        return await self._run_js_command(
            'runAnalysisWithParams',
            options_data,
            params,
            timeout=self.ANALYSIS_TIMEOUT
        )


class AdvancedOptionsAnalysisService:
    def __init__(self, cache_service=None):
        self.js_analyzer = JavaScriptOptionsAnalyzer()
        self.cache = cache_service

    def _validate_cached_params(self, params):
        required_keys = ['sentimentBlend', 'lookaroundWindow', 'minSegmentSize', 'slicingSensitivity']

        if not isinstance(params, dict):
            return False

        for key in required_keys:
            if key not in params:
                return False

        if not isinstance(params['sentimentBlend'], dict):
            return False

        try:
            if not (0 < params['lookaroundWindow'] < 200):
                return False
            if not (0 < params['minSegmentSize'] < 100):
                return False
            if not (0 < params['slicingSensitivity'] < 1):
                return False
        except (TypeError, KeyError):
            return False

        return True

    def _calculate_ema(self, data, period):
        if len(data) < period:
            return data
        alpha = 2 / (period + 1.0)
        ema = [data[0]]
        for i in range(1, len(data)):
            ema.append(alpha * data[i] + (1 - alpha) * ema[i - 1])
        return ema

    def _characterize_daily_sentiment_pattern(self, sentiment_scores):
        if len(sentiment_scores) < 4:
            return "Insufficient Data"

        smoothed_scores = self._calculate_ema(sentiment_scores, period=3)
        x_axis = np.arange(len(smoothed_scores))
        slope, _, r_value, _, _ = stats.linregress(x_axis, smoothed_scores)
        r_squared = r_value ** 2

        R_SQUARED_STRONG_TREND = 0.50
        SLOPE_SIGNIFICANT_TREND = 0.05
        REVERSAL_MAGNITUDE = 0.40
        VOLATILITY_THRESHOLD = 0.40

        opening_score = smoothed_scores[0]
        closing_score = smoothed_scores[-1]
        raw_std_dev = np.std(sentiment_scores)

        if r_squared > R_SQUARED_STRONG_TREND:
            if slope > SLOPE_SIGNIFICANT_TREND:
                return "Sustained Bull Trend"
            elif slope < -SLOPE_SIGNIFICANT_TREND:
                return "Sustained Bear Trend"
            else:
                return "Flat / Low-Conviction Trend"

        is_bullish_reversal = opening_score < 0 and closing_score > opening_score + REVERSAL_MAGNITUDE
        if is_bullish_reversal:
            return "Bullish Reversal (V-Shape)"

        is_bearish_reversal = opening_score > 0 and closing_score < opening_score - REVERSAL_MAGNITUDE
        if is_bearish_reversal:
            return "Bearish Reversal (A-Shape)"

        if raw_std_dev > VOLATILITY_THRESHOLD:
            return "Choppy / Volatile"

        return "Sideways / Directionless"

    async def run_full_analysis(self, symbol: str, options_data: dict, force_recalculate: bool = False):
        analysis_start = time.time()
        params_cache_key = f"adv_params_fingerprint_v2_{symbol}"

        await log_service.options(
            f"Starting advanced analysis for {symbol} (force_recalculate={force_recalculate})"
        )

        best_params = None

        if self.cache and not force_recalculate:
            try:
                cached_params_data = await self.cache.get_cached_options_data(symbol, params_cache_key)
                if cached_params_data:
                    if self._validate_cached_params(cached_params_data):
                        best_params = cached_params_data
                        await log_service.options(
                            f"Valid cache hit for {symbol}"
                        )
                    else:
                        await log_service.error(
                            f"CORRUPTED CACHE for {symbol}! Invalidating and recalculating..."
                        )
                        await self.cache.delete_cached_options_data(symbol, params_cache_key)
            except Exception as e:
                await log_service.error(
                    f"Cache load failed: {e}"
                )

        if not best_params:
            try:
                await log_service.options(
                    f"Stage 1: Finding Optimal Sentiment Blend for {symbol}..."
                )
                stage1_start = time.time()

                blend_result = await self.js_analyzer.find_optimal_blend(options_data)

                stage1_elapsed = time.time() - stage1_start
                await log_service.options(
                    f"Stage 1 complete in {stage1_elapsed:.2f}s"
                )

                if not blend_result or 'best_blend' not in blend_result:
                    raise ValueError("Invalid blend result - missing 'best_blend'")

                optimal_blend = blend_result['best_blend']

                await log_service.options(
                    f"Stage 2: Finding Optimal Slicing Parameters for {symbol}..."
                )
                stage2_start = time.time()

                slicing_result = await self.js_analyzer.find_best_slicing_params(
                    options_data,
                    optimal_blend
                )

                stage2_elapsed = time.time() - stage2_start
                await log_service.options(
                    f"Stage 2 complete in {stage2_elapsed:.2f}s"
                )

                if not slicing_result or 'best_slicing_params' not in slicing_result:
                    raise ValueError("Invalid slicing result - missing 'best_slicing_params'")

                best_params = {
                    "sentimentBlend": optimal_blend,
                    **slicing_result['best_slicing_params']
                }

                if self.cache:
                    try:
                        await self.cache.cache_options_data(
                            symbol,
                            params_cache_key,
                            best_params,
                            expiry_seconds=604800
                        )
                        await log_service.options(
                            f"Parameters cached for {symbol} (7 days)"
                        )
                    except Exception as e:
                        await log_service.error(
                            f"Cache write failed: {e}"
                        )

            except TimeoutError as e:
                await log_service.error(
                    f"TIMEOUT during parameter calculation for {symbol}: {e}"
                )
                return None
            except Exception as e:
                await log_service.error(
                    f"Parameter calculation failed for {symbol}: {e}"
                )
                return None

        try:
            await log_service.options(
                f"Running final analysis for {symbol}..."
            )
            final_start = time.time()

            final_analysis_result = await self.js_analyzer.run_analysis_with_params(
                options_data,
                best_params
            )

            final_elapsed = time.time() - final_start
            await log_service.options(
                f"Final analysis complete in {final_elapsed:.2f}s"
            )

            if not final_analysis_result:
                raise ValueError("Final analysis returned None")

            if 'enhanced_trend_data' in final_analysis_result:
                trend_data_by_day = {}
                for item in final_analysis_result['enhanced_trend_data']:
                    if not item.get('isSnapshot', False):
                        day = item['date'].split(' ')[0]
                        if day not in trend_data_by_day:
                            trend_data_by_day[day] = []
                        trend_data_by_day[day].append(item['blendedSentiment'])

                for day_agg in final_analysis_result.get('daily_aggregates', []):
                    day_key = day_agg['date']
                    if day_key in trend_data_by_day:
                        sentiment_scores = trend_data_by_day[day_key]
                        day_agg['daily_pattern'] = self._characterize_daily_sentiment_pattern(
                            sentiment_scores
                        )

            total_elapsed = time.time() - analysis_start
            await log_service.options(
                f"Advanced analysis complete for {symbol} in {total_elapsed:.2f}s"
            )

            return final_analysis_result

        except TimeoutError as e:
            await log_service.error(
                f"TIMEOUT during final analysis for {symbol}: {e}"
            )
            return None
        except Exception as e:
            await log_service.error(
                f"Final analysis failed for {symbol}: {e}"
            )
            return None