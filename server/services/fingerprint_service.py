import asyncio
import numpy as np
from datetime import datetime
import concurrent.futures
from services import log_service, time_service

DEFAULT_TEMPORAL_PARAMETERS = {
    "pastWeight": 1.0,
    "futureWeight": 1.0,
    "pastShiftHours": 0.0,
    "futureShiftHours": 0.0,
    "momentumBlend": 0.5,
    "rollingAverageWindowMs": 12 * 60 * 60 * 1000,
}

class FingerprintService:
    def __init__(self, cs, comps, workflow_orchestrator):
        self.cache = cs
        self.company_service = comps
        self.workflow_orchestrator = workflow_orchestrator
        self.FINGERPRINT_EXPIRY_SECONDS = 7 * 24 * 60 * 60
        self.FINGERPRINT_CACHE_KEY = "sentiment_fingerprint_last_run"
        self.FINGERPRINT_TARGET_ARTICLES = 50
        self.CONCURRENCY_LIMIT = 3
        self.process_pool = None
        self.GLOBAL_MARKET_KEYWORDS = [
            {"term": "stock market", "weight": 1.2},
            {"term": "global markets", "weight": 1.1},
            {"term": "market sentiment", "weight": 1.0},
            {"term": "interest rates", "weight": 1.3},
            {"term": "economic outlook", "weight": 1.0},
            {"term": "bull market", "weight": 0.9},
            {"term": "bear market", "weight": 0.9},
            {"term": "inflation", "weight": 1.1},
            {"term": "recession", "weight": 0.9},
        ]

    async def initialize(self):
        self.process_pool = concurrent.futures.ProcessPoolExecutor(max_workers=4)
        await log_service.fingerprint("FingerprintService initialized with ProcessPoolExecutor.")

    async def close(self):
        if self.process_pool:
            self.process_pool.shutdown(wait=True)
            await log_service.fingerprint("FingerprintService ProcessPoolExecutor shut down.")

    async def run_calculation_job(self, force_refresh: bool = False, dry_run: bool = False):
        last_run = await self.cache.get(self.FINGERPRINT_CACHE_KEY)
        if not force_refresh and last_run and (
                time_service.timestamp() - last_run) < self.FINGERPRINT_EXPIRY_SECONDS:
            await log_service.fingerprint("Sentiment fingerprints are up-to-date. Skipping batch calculation.")
            return

        log_message = "Starting sentiment fingerprint batch calculation"
        if force_refresh: log_message += " (FORCED RUN)"
        if dry_run: log_message += " (DRY RUN)"
        await log_service.fingerprint(log_message + "...")

        all_symbols = await self.cache.get_all_cached_company_symbols()
        if not all_symbols:
            await log_service.fingerprint("No cached companies found to generate fingerprints for. Ending job.")
            return

        await log_service.fingerprint(f"Found {len(all_symbols)} cached companies to process...")

        all_tasks = []

        global_task = asyncio.create_task(
            self.calculate_and_cache_fingerprint("GLOBAL_MARKET", self.GLOBAL_MARKET_KEYWORDS, dry_run)
        )
        all_tasks.append(global_task)

        for symbol in all_symbols:
            try:
                company_info = await self.company_service.get_company_info(symbol, offline_only=True)
                if not company_info:
                    await log_service.fingerprint(
                        f"Skipping fingerprint for '{symbol}' as no complete, cached company profile was found.")
                    continue

                if company_info.get('search_keywords'):
                    stock_keywords = company_info.get('search_keywords', [])
                    existing_terms = {kw['term'].lower() for kw in stock_keywords}
                    core_terms_to_add = {
                        company_info.get('symbol'): 1.0,
                        company_info.get('name'): 0.8,
                        company_info.get('ceo'): 0.7
                    }
                    for term, weight in core_terms_to_add.items():
                        if term and term.lower() not in existing_terms:
                            stock_keywords.append({"term": term, "weight": weight})

                    stock_task = asyncio.create_task(
                        self.calculate_and_cache_fingerprint(symbol, stock_keywords, dry_run)
                    )
                    all_tasks.append(stock_task)

                if company_info.get('industry_keywords'):
                    industry_keywords = company_info.get('industry_keywords', [])
                    industry_task = asyncio.create_task(
                        self.calculate_and_cache_fingerprint(f"INDUSTRY_{symbol}", industry_keywords, dry_run)
                    )
                    all_tasks.append(industry_task)

            except Exception as e:
                await log_service.fingerprint(f"Failed to create fingerprint tasks for symbol {symbol}: {e}")

        if all_tasks:
            semaphore = asyncio.Semaphore(self.CONCURRENCY_LIMIT)

            async def run_with_semaphore(task):
                async with semaphore:
                    return await task

            limited_tasks = [run_with_semaphore(task) for task in all_tasks]
            await asyncio.gather(*limited_tasks, return_exceptions=True)

        if not dry_run:
            await self.cache.set(self.FINGERPRINT_CACHE_KEY, time_service.timestamp(),
                                 self.FINGERPRINT_EXPIRY_SECONDS * 2)

        await log_service.fingerprint(
            f"Sentiment fingerprint batch calculation complete {'(DRY RUN)' if dry_run else ''}.")

    async def calculate_and_cache_fingerprint(self, symbol: str, keywords: list, dry_run: bool = False):
        try:
            await log_service.fingerprint(f"--- STARTING FINGERPRINT CALCULATION FOR SYMBOL: '{symbol}' ---")

            keywords_log_str = ", ".join([f"'{kw['term']}'({kw['weight']})" for kw in keywords])
            await log_service.fingerprint(f"[{symbol}] Using {len(keywords)} keywords: {keywords_log_str}")

            request_data = {
                "symbol": symbol,
                "companyName": "Market" if symbol == "GLOBAL_MARKET" else symbol,
                "daysBack": 90,
                "preCacheOnly": True,
                "execution_mode": "backend",
                "totalArticles": self.FINGERPRINT_TARGET_ARTICLES,
                "keywords": keywords
            }

            await log_service.fingerprint(
                f"[{symbol}] Requesting {self.FINGERPRINT_TARGET_ARTICLES} articles per day for 90 days.")

            selected_articles = await self.workflow_orchestrator.process_articles(request_data)

            if not selected_articles:
                await log_service.fingerprint(f"[{symbol}] Skipping: No cached articles found.")
                return

            await log_service.fingerprint(f"[{symbol}] Found {len(selected_articles)} relevant articles from cache.")

            if len(selected_articles) < 20:
                await log_service.fingerprint(f"[{symbol}] Skipping: Not enough RELEVANT articles for fingerprint.")
                return

            await asyncio.sleep(0)

            analysis_tasks = [self.cache.get_cached_analysis(art['title'], symbol) for art in selected_articles]
            analysis_results = await asyncio.gather(*analysis_tasks)

            await asyncio.sleep(0)

            valid_articles_count = 0
            sentiment_data_for_calc = []

            for article, analysis in zip(selected_articles, analysis_results):
                if not analysis:
                    continue

                sentiment_score = analysis.get('sentimentScore')
                influence_score = analysis.get('influenceScore')

                if (sentiment_score is None or sentiment_score == 0 or
                        influence_score is None or influence_score == 0):
                    continue

                valid_articles_count += 1
                sentiment_data_for_calc.append({
                    'timestamp': int(
                        datetime.fromisoformat(article['publishedDate'].replace('Z', '+00:00')).timestamp() * 1000),
                    'adjustedSentiment': sentiment_score * influence_score,
                    'temporalOrientation': analysis.get('temporalOrientation', 0),
                    'propagationSpeed': analysis.get('propagationSpeed', 0),
                    'impactDuration': analysis.get('impactDuration', 0)
                })

            await log_service.fingerprint(
                f"[{symbol}] Filtered to {valid_articles_count} valid articles (excluded dead articles with 0 sentiment/influence).")

            if len(sentiment_data_for_calc) < 20:
                await log_service.fingerprint(f"[{symbol}] Skipping: Not enough valid analysis data to calculate.")
                return

            if sentiment_data_for_calc:
                sorted_for_dates = sorted(sentiment_data_for_calc, key=lambda x: x['timestamp'])
                start_date = datetime.fromtimestamp(sorted_for_dates[0]['timestamp'] / 1000).strftime('%Y-%m-%d')
                end_date = datetime.fromtimestamp(sorted_for_dates[-1]['timestamp'] / 1000).strftime('%Y-%m-%d')
                await log_service.fingerprint(
                    f"[{symbol}] Article date range for fingerprint: {start_date} to {end_date}")

            valid_adjusted_sentiments = [
                item['adjustedSentiment']
                for item in sentiment_data_for_calc
                if item['adjustedSentiment'] is not None
            ]

            if valid_adjusted_sentiments:
                mean_adjusted_sentiment = sum(valid_adjusted_sentiments) / len(valid_adjusted_sentiments)
                for item in sentiment_data_for_calc:
                    if item['adjustedSentiment'] is not None:
                        item['adjustedSentiment'] -= mean_adjusted_sentiment

            await log_service.fingerprint(
                f"[{symbol}] Performing advanced temporal impact calculation on {len(sentiment_data_for_calc)} data points...")

            if not self.process_pool:
                self.process_pool = concurrent.futures.ProcessPoolExecutor(max_workers=4)

            loop = asyncio.get_event_loop()
            temporal_values = await loop.run_in_executor(
                self.process_pool,
                _python_calculate_temporal_sentiment,
                sentiment_data_for_calc,
                DEFAULT_TEMPORAL_PARAMETERS
            )

            if not temporal_values:
                return

            sentiment_series = [p['sentimentRollingAvg'] for p in temporal_values if
                                p.get('sentimentRollingAvg') is not None]

            if len(sentiment_series) < 20:
                return

            fingerprint_result = await loop.run_in_executor(
                self.process_pool,
                _calculate_fingerprint_stats,
                sentiment_series
            )

            if not fingerprint_result:
                return

            fingerprint = {
                'mean': float(fingerprint_result['mean']),
                'stdDev': float(fingerprint_result['std_dev']),
                'min': float(fingerprint_result['min_val']),
                'max': float(fingerprint_result['max_val']),
                'article_count': valid_articles_count
            }

            log_str = (
                f"[{symbol}] SUCCESS: Cached fingerprint with {fingerprint['article_count']} valid articles - "
                f"Min: {fingerprint['min']:.3f}, Max: {fingerprint['max']:.3f}, Mean: {fingerprint['mean']:.3f}, StdDev: {fingerprint['stdDev']:.3f}"
            )
            dry_run_log_str = log_str.replace("SUCCESS: Cached", "DRY RUN: Calculated")

            if not dry_run:
                await self.cache.set(f"fingerprint:{symbol}", fingerprint, self.FINGERPRINT_EXPIRY_SECONDS * 2)
                await log_service.fingerprint(log_str)
            else:
                await log_service.fingerprint(dry_run_log_str)

            await log_service.fingerprint(f"--- FINISHED FINGERPRINT CALCULATION FOR SYMBOL: '{symbol}' ---")

        except Exception as e:
            await log_service.fingerprint(f"Failed to calculate fingerprint for {symbol}: {e}")

def _calculate_fingerprint_stats(sentiment_series):
    try:
        mean = np.mean(sentiment_series)
        std_dev = np.std(sentiment_series)
        min_val = np.min(sentiment_series)
        max_val = np.max(sentiment_series)

        if std_dev == 0:
            return None

        return {
            'mean': mean,
            'std_dev': std_dev,
            'min_val': min_val,
            'max_val': max_val
        }
    except Exception:
        return None

def _find_closest_index(sorted_array, target_timestamp):
    low = 0
    high = len(sorted_array) - 1
    best_index = 0
    while low <= high:
        mid = (low + high) // 2
        mid_time = sorted_array[mid].get('timestamp')
        if mid_time is None:
            high = mid - 1
            continue
        if mid_time < target_timestamp:
            best_index = mid
            low = mid + 1
        elif mid_time > target_timestamp:
            high = mid - 1
        else:
            return mid
    return best_index

def _python_calculate_temporal_sentiment(sentiment_data, params):
    if not sentiment_data:
        return []

    sorted_data = sorted(sentiment_data, key=lambda x: x['timestamp'])

    average_lifespan = 24.0
    if sorted_data:
        total_lifespan = sum(
            (a.get('propagationSpeed', 0) or 0) + (a.get('impactDuration', 0) or 0)
            for a in sorted_data
        )
        if total_lifespan > 0:
            average_lifespan = total_lifespan / len(sorted_data)

    time_step = 5 * 60 * 1000

    if not sorted_data or 'timestamp' not in sorted_data[0]:
        return []

    first_time = sorted_data[0]['timestamp']
    last_article_time = sorted_data[-1]['timestamp']

    max_impact_window = 0
    if sorted_data:
        max_impact_window = max(
            (a.get('propagationSpeed', 0) + a.get('impactDuration', 0)) * 3600000 for a in sorted_data
        )

    last_time = last_article_time + max_impact_window if max_impact_window > 0 else last_article_time

    time_points_set = set(article['timestamp'] for article in sorted_data if 'timestamp' in article)

    t = first_time
    while t <= last_time:
        time_points_set.add(t)
        t += time_step

    final_time_stamps = sorted(list(time_points_set))
    time_points = [{'timestamp': ts} for ts in final_time_stamps]

    cumulative_impacts = [0.0] * len(time_points)

    for article in sorted_data:
        if article.get('adjustedSentiment') is None:
            continue

        temporal_orientation = article.get('temporalOrientation', 0)
        time_shift_hours, weight_multiplier = 0.0, 1.0

        if temporal_orientation < 0:
            time_shift_hours = temporal_orientation * params['pastShiftHours']
            weight_multiplier = 1.0 - abs(temporal_orientation) + (abs(temporal_orientation) * params['pastWeight'])
        elif temporal_orientation > 0:
            time_shift_hours = temporal_orientation * params['futureShiftHours']
            weight_multiplier = 1.0 - temporal_orientation + (temporal_orientation * params['futureWeight'])

        if weight_multiplier <= 0:
            continue

        time_shift_ms = time_shift_hours * 3600000
        adjusted_article_time = article['timestamp'] + time_shift_ms
        propagation_speed = article.get('propagationSpeed', 0)
        impact_duration = article.get('impactDuration', 0)

        if propagation_speed <= 0 and impact_duration <= 0:
            continue

        adjusted_sentiment_value = article['adjustedSentiment']
        total_article_lifespan = (article.get('propagationSpeed', 0) or 0) + (article.get('impactDuration', 0) or 0)
        if total_article_lifespan > 0:
            normalization_factor = average_lifespan / total_article_lifespan
            adjusted_sentiment_value *= normalization_factor

        final_sentiment_value = adjusted_sentiment_value * weight_multiplier

        if abs(final_sentiment_value) < 0.001:
            continue

        impact_end_time = adjusted_article_time + ((propagation_speed + impact_duration) * 3600000)
        start_index = _find_closest_index(time_points, adjusted_article_time)
        end_index = _find_closest_index(time_points, impact_end_time)

        for i in range(start_index, end_index + 2):
            if i >= len(time_points):
                break
            time_point = time_points[i]
            if not time_point:
                continue

            delta_t_hr = (time_point['timestamp'] - adjusted_article_time) / 3600000
            if delta_t_hr < 0:
                continue

            propagation_factor = 1.0 / (
                    1.0 + np.exp(-8 * (delta_t_hr / propagation_speed - 0.5))) if propagation_speed > 0 else 1.0

            decay_factor = 1.0
            if delta_t_hr > propagation_speed:
                decay_factor = max(0, 1 - (
                        (delta_t_hr - propagation_speed) / impact_duration)) if impact_duration > 0 else 0

            impact = final_sentiment_value * propagation_factor * decay_factor
            if abs(impact) > 0.001:
                cumulative_impacts[i] += impact

    result = []
    trend_ema = 0.0
    rolling_window_ms = params.get('rollingAverageWindowMs', 12 * 60 * 60 * 1000)
    period = (rolling_window_ms / time_step) if time_step > 0 else 1
    alpha = 2 / (period + 1)
    momentum_blend = params.get('momentumBlend', 0.5)

    for i, point in enumerate(time_points):
        momentary_impact = cumulative_impacts[i]
        trend_ema = (momentary_impact * alpha) + (trend_ema * (1 - alpha))
        final_sentiment = (1 - momentum_blend) * momentary_impact + momentum_blend * trend_ema
        result.append({'timestamp': point['timestamp'], 'sentimentRollingAvg': final_sentiment})

    return result