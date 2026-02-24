import asyncio
import random
import pytz
import math
from datetime import datetime, timedelta
from services import log_service, time_service

class DateFilterHelper:
    @staticmethod
    def is_article_in_date_range(article, start_date_utc, end_date_utc):
        pub_date_str = article.get('publishedDate', '')
        if not pub_date_str:
            return False
        try:
            pub_date = datetime.fromisoformat(pub_date_str.replace('Z', '+00:00'))
            if pub_date.tzinfo is None:
                pub_date = pub_date.replace(tzinfo=pytz.UTC)
            else:
                pub_date = pub_date.astimezone(pytz.UTC)
            return start_date_utc <= pub_date < end_date_utc
        except (ValueError, TypeError):
            return False

class KeywordAllocationService:
    @staticmethod
    def calculate_weighted_allocation(keywords, total_articles):
        if not keywords or not isinstance(keywords, list):
            return {}
        total_weight = sum(kw.get('weight', 0) for kw in keywords)
        if total_weight <= 0:
            return {}
        allocation = {}
        for kw in keywords:
            term = kw.get('term', '')
            weight = kw.get('weight', 0)
            if term and weight > 0:
                articles = max(1, math.ceil((weight / total_weight) * total_articles))
                allocation[term] = articles
        return allocation

class ProgressTracker:
    def __init__(self):
        self.task_tracking = {}
        self.counter_lock = asyncio.Lock()

    async def init_tracking(self, symbol, total_articles, client_id=None, status_callback=None):
        async with self.counter_lock:
            self.task_tracking[symbol] = {
                'total_articles': total_articles,
                'analyzed_articles': 0,
                'irrelevant_articles': 0,
                'client_ids': {client_id} if client_id else set(),
                'cache_stats': {
                    'total_processed': 0,
                    'cached_relevance': 0,
                    'cached_sentiment': 0,
                    'fully_cached': 0
                },
                'enrichment_stats': {
                    'direct': 0,
                    'browser': 0,
                    'failed': 0,
                    'from_cache': 0
                },
                'url_decode_stats': {
                    'base64': 0,
                    'batchexecute': 0,
                    'not_google': 0,
                    'failed': 0
                },
                'rss_dedup_stats': {
                    'total_candidates': 0,
                    'total_kept': 0,
                    'total_duplicates': 0
                },
                'analyzed_articles_data': [],
                'start_time': time_service.now(pytz.UTC),
                'day_breakdown': {},
                'high_water_mark': None
            }
            if status_callback:
                await status_callback(symbol, 'stock', 'analyzing', 'in_progress', {
                    'analyzed': 0,
                    'total': total_articles,
                    'percentage': 0
                })

    async def update_high_water_mark(self, symbol, article):
        if symbol not in self.task_tracking:
            return
        try:
            pub_date_str = article.get('publishedDate', '')
            pub_date = datetime.fromisoformat(pub_date_str.replace('Z', '+00:00'))
            if pub_date.tzinfo is None:
                pub_date = pub_date.replace(tzinfo=pytz.UTC)
            async with self.counter_lock:
                current_mark = self.task_tracking[symbol].get('high_water_mark')
                if current_mark is None or pub_date > current_mark:
                    self.task_tracking[symbol]['high_water_mark'] = pub_date
        except:
            pass

    async def get_high_water_mark(self, symbol):
        if symbol not in self.task_tracking:
            return None
        async with self.counter_lock:
            return self.task_tracking[symbol].get('high_water_mark')

    async def increment_counter(self, symbol, status_callback=None):
        if symbol not in self.task_tracking:
            return
        async with self.counter_lock:
            self.task_tracking[symbol]['analyzed_articles'] += 1
            analyzed = self.task_tracking[symbol]['analyzed_articles']
            total = self.task_tracking[symbol]['total_articles']
            percentage = (analyzed / total * 100) if total > 0 else 0
            if status_callback:
                await status_callback(symbol, 'stock', 'analyzing', 'in_progress', {
                    'analyzed': analyzed,
                    'total': total,
                    'percentage': round(percentage, 1)
                })

    async def complete_analysis_for_symbol(self, symbol, bucket_type, pre_cache_stats=None, status_callback=None):
        if symbol not in self.task_tracking:
            return
        async with self.counter_lock:
            tracking_data = self.task_tracking[symbol]
            end_time = time_service.now(pytz.UTC)
            start_time = tracking_data.get('start_time', end_time)
            duration = (end_time - start_time).total_seconds()
            completion_data = {
                'articles_fetched': tracking_data.get('total_articles', 0),
                'articles_analyzed': tracking_data.get('analyzed_articles', 0),
                'articles_rejected': tracking_data.get('irrelevant_articles', 0),
                'processing_time': round(duration, 2),
                'cache_analysis': self._calculate_detailed_cache_stats(tracking_data),
                'fetch_analysis': self._calculate_fetch_stats(pre_cache_stats) if pre_cache_stats else {},
                'day_breakdown': tracking_data.get('day_breakdown', {})
            }
            if 'analyzed_articles_data' in tracking_data:
                completion_data['analyzed_articles_data'] = tracking_data['analyzed_articles_data']
            if status_callback:
                await status_callback(symbol, bucket_type, 'complete', 'complete', completion_data)
            await self._log_completion_report(symbol, tracking_data)

    @staticmethod
    async def _log_completion_report(symbol, tracking_data):
        day_breakdown = tracking_data.get('day_breakdown', {})
        report_lines = [f"\n[COMPLETION REPORT] {symbol} Analysis Complete:", "=" * 120]

        total_cached_used = 0
        total_fetched = 0
        total_articles = 0
        total_relevant = 0
        total_target = 0
        total_fully_cached = 0
        total_partially_cached = 0
        total_no_cache = 0
        total_rss_candidates = 0
        total_rss_kept = 0
        total_rss_duplicates = 0

        report_lines.append("DAY-BY-DAY BREAKDOWN:")
        for day_idx in sorted(day_breakdown.keys()):
            day_data = day_breakdown[day_idx]
            day_name = "Today" if day_idx == 0 else f"{day_idx}d ago"
            cached = day_data.get('cached_used', 0)
            fetched = day_data.get('fetched', 0)
            relevant = day_data.get('relevant', 0)
            target = day_data.get('target', 0)
            fully_cached_served = day_data.get('fully_cached_served', 0)
            partially_cached = day_data.get('partially_cached', 0)
            no_cache = day_data.get('no_cache', 0)
            day_total = cached + fetched
            total_cached_used += cached
            total_fetched += fetched
            total_articles += day_total
            total_relevant += relevant
            total_target += target
            total_fully_cached += fully_cached_served
            total_partially_cached += partially_cached
            total_no_cache += no_cache
            relevance_rate = (relevant / day_total * 100) if day_total > 0 else 0

            rss_cand = day_data.get('rss_candidates', 0)
            rss_kept = day_data.get('rss_kept', 0)
            rss_dup = day_data.get('rss_duplicates', 0)
            total_rss_candidates += rss_cand
            total_rss_kept += rss_kept
            total_rss_duplicates += rss_dup

            report_lines.append(
                f"Day {day_idx:2d} ({day_name:8s}): {cached:3d} cached + {fetched:3d} fetched = "
                f"{day_total:3d}/{target:3d} target | {relevant:3d} relevant ({relevance_rate:4.1f}%) | "
                f"Cache: Full={fully_cached_served} Partial={partially_cached} None={no_cache}"
            )

        report_lines.append("-" * 120)
        cache_hit_rate = (total_cached_used / total_articles * 100) if total_articles > 0 else 0
        overall_relevance_rate = (total_relevant / total_articles * 100) if total_articles > 0 else 0
        queue_skip_rate = (total_fully_cached / total_articles * 100) if total_articles > 0 else 0

        report_lines.append("OVERALL STATISTICS:")
        report_lines.append(
            f"  Articles: {total_cached_used} cached + {total_fetched} fetched = {total_articles}/{total_target} total")
        report_lines.append(f"  Cache Hit Rate: {cache_hit_rate:.1f}%")
        report_lines.append(
            f"  Relevance Rate: {overall_relevance_rate:.1f}% ({total_relevant}/{total_articles} articles)")

        report_lines.append(f"\nCACHE EFFICIENCY:")
        report_lines.append(f"  Fully Cached (skipped queue): {total_fully_cached} ({queue_skip_rate:.1f}%)")
        report_lines.append(f"  Partially Cached: {total_partially_cached}")
        report_lines.append(f"  No Cache (full analysis): {total_no_cache}")

        cache_stats = tracking_data.get('cache_stats', {})
        if cache_stats:
            report_lines.append(f"\nANALYSIS CACHE PERFORMANCE:")
            report_lines.append(
                f"  Relevance Cache Hits: {cache_stats.get('cached_relevance', 0)}/{cache_stats.get('total_processed', 0)}")
            report_lines.append(
                f"  Sentiment Cache Hits: {cache_stats.get('cached_sentiment', 0)}/{cache_stats.get('total_processed', 0)}")
            report_lines.append(f"  Fully Cached Articles: {cache_stats.get('fully_cached', 0)}")

        rss_stats = tracking_data.get('rss_dedup_stats', {})
        total_rss_candidates = rss_stats.get('total_candidates', total_rss_candidates)
        total_rss_kept = rss_stats.get('total_kept', total_rss_kept)
        total_rss_duplicates = rss_stats.get('total_duplicates', total_rss_duplicates)

        if total_rss_candidates > 0:
            rss_dedup_rate = (total_rss_duplicates / total_rss_candidates * 100)
            report_lines.append(f"\nRSS DEDUPLICATION:")
            report_lines.append(f"  Total RSS Candidates: {total_rss_candidates}")
            report_lines.append(f"  Articles Kept: {total_rss_kept}")
            report_lines.append(f"  Duplicates Removed: {total_rss_duplicates} ({rss_dedup_rate:.1f}%)")

        enrich_stats = tracking_data.get('enrichment_stats', {})
        total_enriched = enrich_stats.get('direct', 0) + enrich_stats.get('browser', 0)
        total_attempts = total_enriched + enrich_stats.get('failed', 0)

        if total_attempts > 0:
            success_rate = (total_enriched / total_attempts * 100)
            report_lines.append(f"\nENRICHMENT:")
            report_lines.append(f"  Success: {total_enriched}/{total_attempts} ({success_rate:.1f}%)")
            report_lines.append(
                f"  Direct: {enrich_stats.get('direct', 0)}, Browser: {enrich_stats.get('browser', 0)}, Failed: {enrich_stats.get('failed', 0)}")

        decode_stats = tracking_data.get('url_decode_stats', {})
        total_decoded = decode_stats.get('base64', 0) + decode_stats.get('batchexecute', 0)
        total_decode_attempts = total_decoded + decode_stats.get('failed', 0)

        if total_decode_attempts > 0:
            decode_success_rate = (total_decoded / total_decode_attempts * 100)
            report_lines.append(f"\nURL DECODING:")
            report_lines.append(f"  Success: {total_decoded}/{total_decode_attempts} ({decode_success_rate:.1f}%)")
            report_lines.append(
                f"  BatchExecute: {decode_stats.get('batchexecute', 0)}, Failed: {decode_stats.get('failed', 0)}")

        report_lines.append("=" * 120)
        for line in report_lines:
            await log_service.workflow(line)

    @staticmethod
    def _calculate_detailed_cache_stats(task_tracking_data):
        cache_stats = task_tracking_data.get('cache_stats', {})
        total = cache_stats.get('total_processed', 0)
        if total == 0:
            return {}
        cached_relevance = cache_stats.get('cached_relevance', 0)
        cached_sentiment = cache_stats.get('cached_sentiment', 0)
        fully_cached = cache_stats.get('fully_cached', 0)
        return {
            'total_processed': total,
            'cached_relevance': cached_relevance,
            'cached_sentiment': cached_sentiment,
            'fully_cached': fully_cached,
            'relevance_hit_rate': round(cached_relevance / total * 100, 1) if total > 0 else 0,
            'sentiment_hit_rate': round(cached_sentiment / total * 100, 1) if total > 0 else 0,
            'full_cache_rate': round(fully_cached / total * 100, 1) if total > 0 else 0,
            'cache_misses': total - cached_relevance,
            'relevance_but_no_sentiment': cached_relevance - cached_sentiment
        }

    @staticmethod
    def _calculate_fetch_stats(pre_cache_stats):
        if not pre_cache_stats:
            return {}
        sources = pre_cache_stats.get('sources', {})
        total_articles = sources.get('pre_cache', 0) + sources.get('runtime_cache', 0) + sources.get('web_fresh', 0)
        if total_articles == 0:
            return {}
        cache_hit_rate = round(((sources.get('pre_cache', 0) + sources.get('runtime_cache', 0)) / total_articles) * 100,
                               1)
        return {
            'total_articles': total_articles,
            'pre_cache': sources.get('pre_cache', 0),
            'runtime_cache': sources.get('runtime_cache', 0),
            'web_fresh': sources.get('web_fresh', 0),
            'cache_hit_rate': cache_hit_rate,
            'total_loaded': pre_cache_stats.get('total_loaded', 0),
            'total_selected': pre_cache_stats.get('total_selected', 0),
            'duplicates_avoided': pre_cache_stats.get('total_duplicates_avoided', 0)
        }

class TaskManager:
    def __init__(self):
        self.running_tasks = {}

    def is_task_cancelled(self, symbol):
        return symbol not in self.running_tasks or (
                symbol in self.running_tasks and self.running_tasks[symbol].cancelled())

    async def cancel_analysis(self, symbol, status_callback=None, progress_tracker=None):
        task_keys_to_cancel = []
        if symbol in self.running_tasks:
            task_keys_to_cancel.append(symbol)
        if symbol.startswith('INDUSTRY_'):
            base_symbol = symbol.replace('INDUSTRY_', '')
            if base_symbol in self.running_tasks:
                task_keys_to_cancel.append(base_symbol)
        else:
            industry_symbol = f"INDUSTRY_{symbol}"
            if industry_symbol in self.running_tasks:
                task_keys_to_cancel.append(industry_symbol)
        cancelled_count = 0
        for task_key in task_keys_to_cancel:
            if task_key in self.running_tasks:
                task = self.running_tasks[task_key]
                if not task.done():
                    task.cancel()
                    cancelled_count += 1
                del self.running_tasks[task_key]
            if progress_tracker and task_key in progress_tracker.task_tracking:
                del progress_tracker.task_tracking[task_key]
        if status_callback:
            await status_callback(symbol, 'stock', 'cancelled', 'cancelled', {
                'cancelled_tasks': cancelled_count,
                'message': f'Analysis cancelled for {symbol}'
            })
        return cancelled_count

    def register_task(self, symbol, task):
        self.running_tasks[symbol] = task

    def unregister_task(self, symbol):
        if symbol in self.running_tasks:
            del self.running_tasks[symbol]


class AnalysisCoordinator:
    def __init__(self, analysis_service, progress_tracker, task_manager, websocket_manager):
        self.analysis_service = analysis_service
        self.progress_tracker = progress_tracker
        self.task_manager = task_manager
        self.websocket_manager = websocket_manager

    async def analyze_article(self, article, company_name, symbol, ceo, use_turbo=True, status_callback=None):
        try:
            if self.task_manager.is_task_cancelled(symbol):
                return

            cache_status = article.get('_cache_status', {})

            if cache_status.get('relevance') is not None:
                is_relevant = cache_status['relevance']
                is_cached_relevance = True
            else:
                is_relevant = await self.analysis_service.is_article_relevant(
                    publisher=article['publisher'],
                    headline=article['title'],
                    summary=article['summary'],
                    company_name=company_name,
                    company_symbol=symbol,
                    company_ceo=ceo,
                    article_url=article['url'],
                    use_turbo=use_turbo
                )
                is_cached_relevance = self.analysis_service.was_last_relevance_cached()

            if self.task_manager.is_task_cancelled(symbol):
                return

            if is_cached_relevance and symbol in self.progress_tracker.task_tracking and 'cache_stats' in \
                    self.progress_tracker.task_tracking[symbol]:
                self.progress_tracker.task_tracking[symbol]['cache_stats']['cached_relevance'] += 1

            if '_analysis_day_idx' in article and article['_analysis_day_idx'] is not None:
                for task_symbol, tracking in self.progress_tracker.task_tracking.items():
                    if task_symbol == symbol:
                        if 'day_breakdown' in tracking:
                            day_idx = article['_analysis_day_idx']
                            if day_idx not in tracking['day_breakdown']:
                                tracking['day_breakdown'][day_idx] = {
                                    'cached_used': 0,
                                    'fetched': 0,
                                    'relevant': 0,
                                    'analyzed': 0,
                                    'target': 0,
                                    'fully_cached_served': 0,
                                    'partially_cached': 0,
                                    'no_cache': 0
                                }
                            tracking['day_breakdown'][day_idx]['analyzed'] += 1
                            if is_relevant:
                                tracking['day_breakdown'][day_idx]['relevant'] += 1

            if not is_relevant:
                if symbol in self.progress_tracker.task_tracking:
                    if 'irrelevant_articles' not in self.progress_tracker.task_tracking[symbol]:
                        self.progress_tracker.task_tracking[symbol]['irrelevant_articles'] = 0
                    self.progress_tracker.task_tracking[symbol]['irrelevant_articles'] += 1
                await self.progress_tracker.increment_counter(symbol, status_callback)
                return

            if self.task_manager.is_task_cancelled(symbol):
                return

            matched_keyword = article.get('matchedKeyword') or article.get('keyword')

            sentiment_result = await self.analysis_service.analyze_article_sentiment(
                publisher=article['publisher'],
                headline=article['title'],
                url=article['url'],
                content=article['summary'],
                company_name=company_name,
                company_symbol=symbol,
                company_ceo=ceo,
                matched_keyword=matched_keyword,
                use_turbo=use_turbo
            )

            if self.task_manager.is_task_cancelled(symbol):
                return

            is_cached_sentiment = self.analysis_service.was_last_sentiment_cached()

            if is_cached_sentiment and symbol in self.progress_tracker.task_tracking and 'cache_stats' in \
                    self.progress_tracker.task_tracking[symbol]:
                self.progress_tracker.task_tracking[symbol]['cache_stats']['cached_sentiment'] += 1

            if is_cached_relevance and is_cached_sentiment and symbol in self.progress_tracker.task_tracking and 'cache_stats' in \
                    self.progress_tracker.task_tracking[symbol]:
                self.progress_tracker.task_tracking[symbol]['cache_stats']['fully_cached'] += 1

            if sentiment_result:
                analyzed_article = {
                    'url': article['url'],
                    'title': article['title'],
                    'publisher': article['publisher'],
                    'summary': article['summary'],
                    'publishedDate': article['publishedDate'],
                    'sentimentScore': sentiment_result.get('sentimentScore'),
                    'influenceScore': sentiment_result.get('influenceScore'),
                    'certaintyScore': sentiment_result.get('certaintyScore'),
                    'propagationSpeed': sentiment_result.get('propagationSpeed'),
                    'impactDuration': sentiment_result.get('impactDuration'),
                    'temporalOrientation': sentiment_result.get('temporalOrientation'),
                    'sourceCategory': sentiment_result.get('sourceCategory'),
                    'matchedKeyword': matched_keyword,
                    'sourceSymbol': symbol,
                    'enriched': article.get('enriched', False),
                    'enrichment_method': article.get('enrichment_method'),
                    'redirected_url': article.get('redirected_url'),
                    'cache_status': 'partial' if is_cached_relevance else 'none'
                }

                if symbol in self.progress_tracker.task_tracking:
                    if 'analyzed_articles_data' not in self.progress_tracker.task_tracking[symbol]:
                        self.progress_tracker.task_tracking[symbol]['analyzed_articles_data'] = []
                    self.progress_tracker.task_tracking[symbol]['analyzed_articles_data'].append(analyzed_article)

                await self.websocket_manager.broadcast_to_symbol(
                    symbol,
                    {'type': 'article_analyzed', 'article': analyzed_article, 'symbol': symbol}
                )

            await self.progress_tracker.increment_counter(symbol, status_callback)

        except asyncio.CancelledError:
            raise
        except Exception as e:
            await log_service.error(f"Error analyzing article: {str(e)}")
            await self.progress_tracker.increment_counter(symbol, status_callback)

class ArticleFetchCoordinator:
    def __init__(self, article_service, cache_service):
        self.article_service = article_service
        self.cache_service = cache_service

    def get_article_id(self, article):
        return self.cache_service._get_safe_filename(article['title'])

    async def load_cached_articles(self, symbol, start_date_utc, end_date_utc):
        all_cached_articles = await self.cache_service.get_previously_relevant_cached_articles_from_previous_session(
            symbol,
            limit=None,
            start_date_utc=start_date_utc,
            end_date_utc=end_date_utc
        )
        relevant_cached_articles = [a for a in all_cached_articles if a.get('_is_relevant', False)]
        return all_cached_articles, relevant_cached_articles

    async def fetch_fresh_articles(self, keyword, start_date_utc, end_date_utc, use_recent_keyword=False):
        task = asyncio.create_task(
            self.article_service.search_articles(
                keyword=keyword,
                start_date_utc=start_date_utc,
                end_date_utc=end_date_utc,
                callback=None,
                use_recent_keyword=use_recent_keyword
            )
        )
        result = await task
        if isinstance(result, tuple):
            return result[0], result[1]
        return result, None

    @staticmethod
    def select_articles_with_time_distribution(articles, target_count, bucket_hours=4):
        if len(articles) <= target_count:
            return articles
        article_buckets = {}
        for article in sorted(articles, key=lambda x: x.get('publishedDate', ''), reverse=False):
            try:
                pub_date = datetime.fromisoformat(article['publishedDate'].replace('Z', '+00:00'))
                bucket_idx = pub_date.hour // bucket_hours
                if bucket_idx not in article_buckets:
                    article_buckets[bucket_idx] = []
                article_buckets[bucket_idx].append(article)
            except:
                continue
        if not article_buckets:
            return random.sample(articles, target_count)
        num_buckets = len(article_buckets)
        average_per_bucket = target_count / num_buckets
        min_per_bucket = max(1, int(average_per_bucket / 5))
        selected = []
        for bucket_idx in sorted(article_buckets.keys()):
            bucket_articles = article_buckets[bucket_idx]
            if bucket_articles:
                take = min(min_per_bucket, len(bucket_articles))
                selected.extend(bucket_articles[:take])
        remaining = target_count - len(selected)
        if remaining > 0:
            for bucket_idx in sorted(article_buckets.keys()):
                if remaining <= 0:
                    break
                bucket_articles = article_buckets[bucket_idx]
                already_taken = min(min_per_bucket, len(bucket_articles))
                available = len(bucket_articles) - already_taken
                if available > 0:
                    bucket_weight = len(bucket_articles) / len(articles)
                    additional = min(available, max(1, int(remaining * bucket_weight)))
                    selected.extend(bucket_articles[already_taken:already_taken + additional])
                    remaining -= additional
        if len(selected) < target_count:
            all_unselected = []
            for bucket_articles in article_buckets.values():
                all_unselected.extend([a for a in bucket_articles if a not in selected])
            if all_unselected:
                all_unselected.sort(key=lambda x: x.get('publishedDate', ''))
                selected.extend(all_unselected[:target_count - len(selected)])
        return selected[:target_count]

class ArticleWorkflowOrchestrator:
    def __init__(self, keyword_service, fetch_coordinator, progress_tracker, task_manager,
                 analysis_coordinator, company_service, status_callback, websocket_manager):
        self.keyword_service = keyword_service
        self.fetch_coordinator = fetch_coordinator
        self.progress_tracker = progress_tracker
        self.task_manager = task_manager
        self.analysis_coordinator = analysis_coordinator
        self.company_service = company_service
        self.status_callback = status_callback
        self.websocket_manager = websocket_manager
        self.articles_being_processed = set()
        self.processing_lock = asyncio.Lock()

    def _update_day_breakdown(self, symbol, day_idx, metric, value=1):
        if symbol in self.progress_tracker.task_tracking:
            if 'day_breakdown' not in self.progress_tracker.task_tracking[symbol]:
                self.progress_tracker.task_tracking[symbol]['day_breakdown'] = {}
            if day_idx not in self.progress_tracker.task_tracking[symbol]['day_breakdown']:
                self.progress_tracker.task_tracking[symbol]['day_breakdown'][day_idx] = {
                    'cached_used': 0,
                    'fetched': 0,
                    'relevant': 0,
                    'analyzed': 0,
                    'target': 0,
                    'fully_cached_served': 0,
                    'partially_cached': 0,
                    'no_cache': 0
                }
            self.progress_tracker.task_tracking[symbol]['day_breakdown'][day_idx][metric] += value

    @staticmethod
    def _match_article_to_keyword(article, keyword_allocation, is_industry_mode, symbol):
        article_title = article.get('title', '').lower()
        article_summary = article.get('summary', '').lower()
        original_keyword = article.get('keyword', '').lower()

        for keyword in keyword_allocation.keys():
            if not keyword:
                continue
            keyword_lower = keyword.lower()
            if original_keyword == keyword_lower:
                return keyword

        for keyword in keyword_allocation.keys():
            if not keyword:
                continue
            keyword_lower = keyword.lower()
            if (f' {keyword_lower} ' in f' {article_title} ' or
                    f' {keyword_lower} ' in f' {article_summary} '):
                return keyword

        is_global_market = symbol == "GLOBAL_MARKET"
        if not is_industry_mode and not is_global_market:
            symbol_lower = symbol.lower()
            if symbol_lower in article_title or symbol_lower in article_summary:
                return next(iter(keyword_allocation.keys()))

        return None

    async def _check_article_cache_status(self, article, symbol):
        """Check cache status for a single article (use for individual lookups)"""
        title = article['title']
        cached_relevance = await self.fetch_coordinator.cache_service.get_cached_relevance(title, symbol)
        cached_sentiment = None

        if cached_relevance is True:
            cached_sentiment = await self.fetch_coordinator.cache_service.get_cached_analysis(title, symbol)

        return {
            'relevance': cached_relevance,
            'sentiment': cached_sentiment,
            'is_fully_cached': cached_relevance is not None and cached_sentiment is not None,
            'is_relevant_cached': cached_relevance is True,
            'needs_processing': cached_relevance is None or (cached_relevance is True and cached_sentiment is None)
        }

    async def _batch_check_article_cache_status(self, articles, symbol):
        """Batch check cache status for multiple articles to prevent N+1 queries"""
        if not articles:
            return {}

        titles = [article['title'] for article in articles]

        relevance_tasks = [
            self.fetch_coordinator.cache_service.get_cached_relevance(title, symbol)
            for title in titles
        ]
        relevance_results = await asyncio.gather(*relevance_tasks)

        relevance_map = {title: rel for title, rel in zip(titles, relevance_results)}

        relevant_titles = [title for title, rel in relevance_map.items() if rel is True]
        sentiment_tasks = [
            self.fetch_coordinator.cache_service.get_cached_analysis(title, symbol)
            for title in relevant_titles
        ]
        sentiment_results = await asyncio.gather(*sentiment_tasks) if relevant_titles else []
        sentiment_map = {title: sent for title, sent in zip(relevant_titles, sentiment_results)}

        cache_statuses = {}
        for article in articles:
            title = article['title']
            cached_relevance = relevance_map.get(title)
            cached_sentiment = sentiment_map.get(title)

            cache_statuses[title] = {
                'relevance': cached_relevance,
                'sentiment': cached_sentiment,
                'is_fully_cached': cached_relevance is not None and cached_sentiment is not None,
                'is_relevant_cached': cached_relevance is True,
                'needs_processing': cached_relevance is None or (cached_relevance is True and cached_sentiment is None)
            }

        return cache_statuses

    async def _process_fully_cached_article(self, article, symbol, cache_status):
        if symbol in self.progress_tracker.task_tracking:
            stats = self.progress_tracker.task_tracking[symbol]['cache_stats']
            stats['total_processed'] += 1
            stats['cached_relevance'] += 1
            if cache_status['sentiment']:
                stats['cached_sentiment'] += 1
                stats['fully_cached'] += 1

        day_idx = article.get('_day_idx', 0)
        self._update_day_breakdown(symbol, day_idx, 'fully_cached_served')

        if cache_status['relevance'] and cache_status['sentiment']:
            self._update_day_breakdown(symbol, day_idx, 'relevant')

            analyzed_article = {
                'url': article['url'],
                'title': article['title'],
                'publisher': article['publisher'],
                'summary': article['summary'],
                'publishedDate': article['publishedDate'],
                'sentimentScore': cache_status['sentiment'].get('sentimentScore'),
                'influenceScore': cache_status['sentiment'].get('influenceScore'),
                'certaintyScore': cache_status['sentiment'].get('certaintyScore'),
                'propagationSpeed': cache_status['sentiment'].get('propagationSpeed'),
                'impactDuration': cache_status['sentiment'].get('impactDuration'),
                'temporalOrientation': cache_status['sentiment'].get('temporalOrientation'),
                'sourceCategory': cache_status['sentiment'].get('sourceCategory'),
                'matchedKeyword': article.get('matchedKeyword') or article.get('keyword'),
                'sourceSymbol': symbol,
                'cache_status': 'fully_cached'
            }

            if symbol in self.progress_tracker.task_tracking:
                if 'analyzed_articles_data' not in self.progress_tracker.task_tracking[symbol]:
                    self.progress_tracker.task_tracking[symbol]['analyzed_articles_data'] = []
                self.progress_tracker.task_tracking[symbol]['analyzed_articles_data'].append(analyzed_article)

            await self.websocket_manager.broadcast_to_symbol(
                symbol,
                {'type': 'article_analyzed', 'article': analyzed_article, 'symbol': symbol}
            )
        else:
            if symbol in self.progress_tracker.task_tracking:
                self.progress_tracker.task_tracking[symbol]['irrelevant_articles'] += 1

        await self.progress_tracker.increment_counter(symbol, self.status_callback)

    async def _queue_article_for_analysis(self, article, symbol, company_name, ceo, use_turbo_model,
                                          articles_being_analyzed, all_articles, cache_status=None):
        article_key = f"{symbol}:{article['title']}"

        async with self.processing_lock:
            if article_key in self.articles_being_processed:
                await log_service.warning(
                    f"[RACE PREVENTED] Article already being processed: '{article['title'][:50]}...' for {symbol}"
                )
                return
            self.articles_being_processed.add(article_key)

        try:
            if 'url_decode_method' in article and symbol in self.progress_tracker.task_tracking:
                decode_method = article['url_decode_method']
                stats_dict = self.progress_tracker.task_tracking[symbol]['url_decode_stats']
                if 'batchexecute' in decode_method:
                    if 'failed' in decode_method or 'exception' in decode_method:
                        stats_dict['failed'] += 1
                    else:
                        stats_dict['batchexecute'] += 1
                elif 'base64' in decode_method:
                    stats_dict['base64'] += 1
                elif 'not_google' in decode_method:
                    stats_dict['not_google'] += 1

            enrich_status = article.get('enrichment_status')
            if symbol in self.progress_tracker.task_tracking:
                stats_dict = self.progress_tracker.task_tracking[symbol]['enrichment_stats']
                if not article.get('enriched', False) and not enrich_status:
                    stats_dict['from_cache'] += 1
                elif enrich_status == 'direct_newspaper3k':
                    stats_dict['direct'] += 1
                elif enrich_status == 'browser_newspaper3k':
                    stats_dict['browser'] += 1
                elif enrich_status == 'failed':
                    stats_dict['failed'] += 1

            await self.progress_tracker.update_high_water_mark(symbol, article)

            if article['_source'] == "pre_cache":
                self._update_day_breakdown(symbol, article['_day_idx'], 'cached_used')
            else:
                self._update_day_breakdown(symbol, article['_day_idx'], 'fetched')

            article_count = len([a for a in all_articles if a.get('sourceSymbol') == symbol])
            await self.websocket_manager.broadcast_to_symbol(
                symbol,
                {'type': 'article_fetched', 'article': article, 'count': article_count, 'symbol': symbol}
            )

            if cache_status is None:
                cache_status = await self._check_article_cache_status(article, symbol)

            if symbol in self.progress_tracker.task_tracking and 'cache_stats' in self.progress_tracker.task_tracking[
                symbol]:
                self.progress_tracker.task_tracking[symbol]['cache_stats']['total_processed'] += 1

            if cache_status['is_fully_cached']:
                await self._process_fully_cached_article(article, symbol, cache_status)
                return

            day_idx = article.get('_day_idx', 0)
            if cache_status['relevance'] is not None:
                self._update_day_breakdown(symbol, day_idx, 'partially_cached')
            else:
                self._update_day_breakdown(symbol, day_idx, 'no_cache')

            article['_analysis_day_idx'] = article['_day_idx']
            article['_cache_status'] = cache_status

            analysis_task = asyncio.create_task(
                self.analysis_coordinator.analyze_article(
                    article, company_name, symbol, ceo,
                    use_turbo_model, self.status_callback
                )
            )
            articles_being_analyzed.append(analysis_task)

        finally:
            async with self.processing_lock:
                self.articles_being_processed.discard(article_key)

    async def _process_day_articles(self, day_bucket, symbol, keyword_allocation,
                                    all_cached_articles, processed_titles, sent_articles_ids,
                                    all_articles, articles_being_analyzed, pre_cache_stats,
                                    company_name, ceo, use_turbo_model, is_industry_mode=False):
        day_idx = day_bucket.get('day_idx', -1)
        start_date_utc = day_bucket['start_utc']
        end_date_utc = day_bucket['end_utc']
        total_expected_per_day = sum(keyword_allocation.values())
        day_pool = []
        day_titles = set()
        run_rss_fetch = False

        for article in all_cached_articles:
            if not DateFilterHelper.is_article_in_date_range(article, start_date_utc, end_date_utc):
                continue
            if article['title'] in day_titles:
                continue
            if is_industry_mode:
                matched_keyword = next(iter(keyword_allocation.keys()), None)
            else:
                matched_keyword = self._match_article_to_keyword(article, keyword_allocation, is_industry_mode, symbol)
            if matched_keyword:
                article['_source'] = 'pre_cache'
                day_pool.append(article)
                day_titles.add(article['title'])

        selected_articles = self.fetch_coordinator.select_articles_with_time_distribution(day_pool,
                                                                                          total_expected_per_day)

        if len(selected_articles) < total_expected_per_day:
            run_rss_fetch = True

        rss_candidates = 0
        rss_kept = 0
        rss_duplicates = 0
        total_rss_pool_for_day = 0
        deduplicated_kept_from_rss = 0

        if run_rss_fetch:
            keywords = list(keyword_allocation.keys())
            fetch_tasks = []
            for keyword in keywords:
                if self.task_manager.is_task_cancelled(symbol):
                    break
                fetch_tasks.append(self.fetch_coordinator.fetch_fresh_articles(
                    keyword, start_date_utc, end_date_utc, use_recent_keyword=False
                ))

            if fetch_tasks:
                results = await asyncio.gather(*fetch_tasks)
                all_fresh_articles_for_day = []

                for result in results:
                    if isinstance(result, tuple):
                        fresh_articles, rss_stats = result
                        if rss_stats:
                            rss_candidates += rss_stats.get('candidates', 0)
                            rss_kept += rss_stats.get('kept', 0)
                            rss_duplicates += rss_stats.get('duplicates', 0)
                            if symbol in self.progress_tracker.task_tracking:
                                self.progress_tracker.task_tracking[symbol]['rss_dedup_stats'][
                                    'total_candidates'] += rss_stats.get('candidates', 0)
                                self.progress_tracker.task_tracking[symbol]['rss_dedup_stats'][
                                    'total_kept'] += rss_stats.get('kept', 0)
                                self.progress_tracker.task_tracking[symbol]['rss_dedup_stats'][
                                    'total_duplicates'] += rss_stats.get('duplicates', 0)
                    else:
                        fresh_articles = result

                    if fresh_articles:
                        all_fresh_articles_for_day.extend(fresh_articles)

                total_rss_pool_for_day = len(all_fresh_articles_for_day)

                for article in all_fresh_articles_for_day:
                    if not DateFilterHelper.is_article_in_date_range(article, start_date_utc, end_date_utc):
                        continue
                    article_id = self.fetch_coordinator.get_article_id(article)
                    if article['title'] not in day_titles and article[
                        'title'] not in processed_titles and article_id not in sent_articles_ids:
                        deduplicated_kept_from_rss += 1
                        article['_source'] = 'runtime_cache' if article.get('_from_cache', False) else 'web_fresh'
                        day_pool.append(article)
                        day_titles.add(article['title'])

                selected_articles = self.fetch_coordinator.select_articles_with_time_distribution(day_pool,
                                                                                                  total_expected_per_day)

        src_counts = {'pre_cache': 0, 'runtime_cache': 0, 'web_fresh': 0}
        for a in selected_articles:
            src = a.get('_source', 'pre_cache')
            src_counts[src] = src_counts.get(src, 0) + 1

        if symbol in self.progress_tracker.task_tracking:
            day_map = self.progress_tracker.task_tracking[symbol].setdefault('day_breakdown', {})
            slot = day_map.setdefault(day_idx, {
                'cached_used': 0, 'fetched': 0, 'relevant': 0, 'analyzed': 0, 'target': 0,
                'fully_cached_served': 0, 'partially_cached': 0, 'no_cache': 0
            })
            slot['rss_candidates'] = rss_candidates
            slot['rss_kept'] = rss_kept
            slot['rss_duplicates'] = rss_duplicates
            slot['total_rss_pool'] = total_rss_pool_for_day
            slot['deduplicated_kept_from_rss'] = deduplicated_kept_from_rss
            slot['selected_pre_cache'] = src_counts.get('pre_cache', 0)
            slot['selected_runtime_cache'] = src_counts.get('runtime_cache', 0)
            slot['selected_web_fresh'] = src_counts.get('web_fresh', 0)

        articles_to_process = []
        for article in selected_articles:
            if not DateFilterHelper.is_article_in_date_range(article, start_date_utc, end_date_utc):
                continue
            if self.task_manager.is_task_cancelled(symbol):
                return
            article_id = self.fetch_coordinator.get_article_id(article)
            if article['title'] in processed_titles or article_id in sent_articles_ids:
                pre_cache_stats["total_duplicates_avoided"] += 1
                continue
            articles_to_process.append(article)

        cache_statuses = await self._batch_check_article_cache_status(articles_to_process, symbol)

        for article in articles_to_process:
            article['_day_idx'] = day_idx
            article['sourceSymbol'] = symbol
            article_id = self.fetch_coordinator.get_article_id(article)
            processed_titles.add(article['title'])
            sent_articles_ids.add(article_id)
            all_articles.append(article)
            pre_cache_stats["sources"][article['_source']] += 1
            pre_cache_stats["total_selected"] += 1

            cache_status = cache_statuses.get(article['title'])

            asyncio.create_task(
                self._queue_article_for_analysis(article, symbol, company_name, ceo, use_turbo_model,
                                                 articles_being_analyzed, all_articles, cache_status))

    async def _process_recent_pass_results(self, recent_result, symbol, high_water_mark,
                                           processed_titles, sent_articles_ids, all_articles,
                                           articles_being_analyzed, pre_cache_stats, company_name, ceo,
                                           use_turbo_model, target_count):
        if isinstance(recent_result, tuple):
            recent_articles, rss_stats = recent_result
            if rss_stats and symbol in self.progress_tracker.task_tracking:
                self.progress_tracker.task_tracking[symbol]['rss_dedup_stats']['total_candidates'] += rss_stats.get(
                    'candidates', 0)
                self.progress_tracker.task_tracking[symbol]['rss_dedup_stats']['total_kept'] += rss_stats.get('kept', 0)
                self.progress_tracker.task_tracking[symbol]['rss_dedup_stats']['total_duplicates'] += rss_stats.get(
                    'duplicates', 0)
        else:
            recent_articles = recent_result

        if not recent_articles:
            return

        future_end_date = time_service.now(pytz.UTC) + timedelta(hours=1)
        truly_new_articles = [
            article for article in recent_articles
            if DateFilterHelper.is_article_in_date_range(article, high_water_mark, future_end_date)
        ]
        if not truly_new_articles:
            return

        selected_recent_articles = self.fetch_coordinator.select_articles_with_time_distribution(
            truly_new_articles, target_count
        )

        articles_to_process = []
        for article in selected_recent_articles:
            if not DateFilterHelper.is_article_in_date_range(article, high_water_mark, future_end_date):
                continue
            if self.task_manager.is_task_cancelled(symbol):
                return
            article_id = self.fetch_coordinator.get_article_id(article)
            if article['title'] in processed_titles or article_id in sent_articles_ids:
                pre_cache_stats["total_duplicates_avoided"] += 1
                continue
            articles_to_process.append(article)

        cache_statuses = await self._batch_check_article_cache_status(articles_to_process, symbol)

        for article in articles_to_process:
            article['_day_idx'] = 0
            article['sourceSymbol'] = symbol
            article['_source'] = 'web_fresh'
            article_id = self.fetch_coordinator.get_article_id(article)
            processed_titles.add(article['title'])
            sent_articles_ids.add(article_id)
            all_articles.append(article)
            pre_cache_stats["sources"][article['_source']] += 1
            pre_cache_stats["total_selected"] += 1

            cache_status = cache_statuses.get(article['title'])

            await self._queue_article_for_analysis(article, symbol, company_name, ceo, use_turbo_model,
                                                   articles_being_analyzed, all_articles, cache_status)

    async def process_articles(self, articles_data: dict):
        symbol = articles_data['symbol']
        company_name = articles_data['companyName']
        ceo = articles_data.get('ceo')
        use_turbo_model = articles_data.get('useTurboModel', False)
        pre_cache_only = articles_data.get('preCacheOnly', False)
        execution_mode = articles_data.get('execution_mode', 'frontend')
        BATCH_SIZE = 250

        task = asyncio.current_task()
        self.task_manager.register_task(symbol, task)
        try:
            day_buckets = []
            current_time = time_service.now(pytz.UTC)
            for day_idx in range(articles_data['daysBack'] + 1):
                if day_idx == 0:
                    start_date = current_time - timedelta(hours=12)
                    end_date = current_time + timedelta(hours=1)
                else:
                    start_date = current_time - timedelta(days=day_idx)
                    end_date = current_time - timedelta(days=day_idx - 1)
                day_buckets.append({
                    'day_idx': day_idx - 1, 'start_utc': start_date, 'end_utc': end_date
                })

            is_global_market = symbol == "GLOBAL_MARKET"
            is_industry_symbol = symbol.startswith('INDUSTRY_')
            is_stock_symbol = not is_global_market and not is_industry_symbol
            if is_industry_symbol:
                base_symbol = symbol.replace('INDUSTRY_', '')
                company_info = await self.company_service.get_company_info(base_symbol)
                industry_keywords = company_info.get('industry_keywords', [])
                keyword_allocation = self.keyword_service.calculate_weighted_allocation(
                    industry_keywords, articles_data['totalArticles']
                )
            elif is_global_market:
                keyword_allocation = self.keyword_service.calculate_weighted_allocation(
                    articles_data.get('keywords'), articles_data['totalArticles']
                ) if articles_data.get('keywords') else {}
            else:
                if self.task_manager.is_task_cancelled(symbol):
                    return
                company_info = await self.company_service.get_company_info(symbol)
                stock_keywords = company_info.get('search_keywords', [])
                keyword_allocation = self.keyword_service.calculate_weighted_allocation(
                    stock_keywords, articles_data['totalArticles']
                )

            if pre_cache_only:
                await log_service.workflow(
                    f"Starting PRE_CACHE_ONLY mode for {symbol} for {articles_data['daysBack']} days (Mode: {execution_mode}).")

                overall_start_date = day_buckets[-1]['start_utc']
                overall_end_date = day_buckets[0]['end_utc']

                _, relevant_cached_articles = await self.fetch_coordinator.load_cached_articles(
                    symbol, overall_start_date, overall_end_date
                )

                if execution_mode == 'backend':
                    return relevant_cached_articles
                else:
                    await self.progress_tracker.init_tracking(symbol, 0, status_callback=self.status_callback)
                    await self.status_callback(symbol, 'stock', 'complete', 'complete', {
                        'message': f'Loaded {len(relevant_cached_articles)} articles from cache.',
                        'articles_analyzed': len(relevant_cached_articles),
                        'analyzed_articles_data': relevant_cached_articles,
                        'isPreCacheOnly': True
                    })
                    return

            total_target_articles = sum(keyword_allocation.values()) * len(day_buckets)
            daily_target_count = sum(keyword_allocation.values())

            await log_service.workflow(
                f"Starting analysis for {symbol}: Targeting {total_target_articles} articles ({daily_target_count} per day) with keywords: {list(keyword_allocation.keys())}")

            processed_titles = set()
            sent_articles_ids = set()
            all_articles = []
            articles_being_analyzed = []
            pre_cache_stats = {
                "total_loaded": 0, "total_matched_keywords": 0, "total_in_date_range": 0,
                "total_selected": 0, "total_duplicates_avoided": 0, "by_day": {},
                "sources": {"pre_cache": 0, "runtime_cache": 0, "web_fresh": 0}
            }

            last_sent_count = 0

            async def send_article_batches():
                nonlocal last_sent_count
                newly_added_count = len(all_articles) - last_sent_count

                if newly_added_count >= BATCH_SIZE:
                    articles_to_send = all_articles[last_sent_count:]

                    for i in range(0, len(articles_to_send), BATCH_SIZE):
                        batch = articles_to_send[i:i + BATCH_SIZE]
                        if len(batch) == BATCH_SIZE:
                            await self.websocket_manager.broadcast_to_symbol(
                                symbol,
                                {
                                    'type': 'article_fetched',
                                    'articles': batch,
                                    'count': last_sent_count + i + BATCH_SIZE,
                                    'symbol': symbol
                                }
                            )
                    last_sent_count = len(all_articles)

            overall_start_date = day_buckets[-1]['start_utc'] if day_buckets else time_service.now(pytz.UTC)
            overall_end_date = day_buckets[0]['end_utc'] if day_buckets else time_service.now(pytz.UTC)
            await self.progress_tracker.init_tracking(symbol, total_target_articles,
                                                      status_callback=self.status_callback)
            for day_bucket in day_buckets:
                self._update_day_breakdown(symbol, day_bucket['day_idx'], 'target', sum(keyword_allocation.values()))
            all_cached_articles, _ = await self.fetch_coordinator.load_cached_articles(symbol, overall_start_date,
                                                                                       overall_end_date)
            pre_cache_stats["total_loaded"] = len(all_cached_articles)

            day_processing_tasks = []
            for day_bucket in day_buckets:
                if self.task_manager.is_task_cancelled(symbol):
                    return
                day_task = self._process_day_articles(
                    day_bucket, symbol, keyword_allocation,
                    all_cached_articles, processed_titles, sent_articles_ids,
                    all_articles, articles_being_analyzed, pre_cache_stats,
                    company_name, ceo, use_turbo_model, is_industry_mode=is_industry_symbol
                )
                day_processing_tasks.append(day_task)

            await asyncio.gather(*day_processing_tasks)
            await send_article_batches()

            if keyword_allocation:
                keywords_for_recent_pass = list(keyword_allocation.keys())
                await log_service.workflow(
                    f"Queueing parallel recent pass for {len(keywords_for_recent_pass)} keywords.")

                recent_pass_tasks = [
                    self.fetch_coordinator.fetch_fresh_articles(
                        keyword=keyword,
                        start_date_utc=overall_end_date - timedelta(days=1),
                        end_date_utc=overall_end_date,
                        use_recent_keyword=True
                    ) for keyword in keywords_for_recent_pass
                ]

                recent_pass_results = await asyncio.gather(*recent_pass_tasks)

                if recent_pass_results:
                    combined_recent_articles = []
                    for result in recent_pass_results:
                        if result and isinstance(result, tuple):
                            articles, _ = result
                            if articles:
                                combined_recent_articles.extend(articles)
                        elif result:
                            combined_recent_articles.extend(result)

                    high_water_mark = await self.progress_tracker.get_high_water_mark(symbol)
                    if combined_recent_articles and high_water_mark:
                        await self._process_recent_pass_results(
                            (combined_recent_articles, {}), symbol, high_water_mark,
                            processed_titles, sent_articles_ids, all_articles,
                            articles_being_analyzed, pre_cache_stats, company_name, ceo,
                            use_turbo_model, target_count=daily_target_count
                        )

            if len(all_articles) > last_sent_count:
                articles_to_send = all_articles[last_sent_count:]
                await self.websocket_manager.broadcast_to_symbol(
                    symbol,
                    {
                        'type': 'article_fetched',
                        'articles': articles_to_send,
                        'count': len(all_articles),
                        'symbol': symbol
                    }
                )

            if self.task_manager.is_task_cancelled(symbol):
                await log_service.workflow(f"Analysis cancelled for {symbol}")
                return
            if len(all_articles) == 0:
                await self.status_callback(symbol, 'stock' if is_stock_symbol else (
                    'industry' if is_industry_symbol else 'market'), 'complete', 'error',
                                           {'error': 'No articles found', 'total': 0})
                return

            bucket_type = 'market' if is_global_market else ('industry' if is_industry_symbol else 'stock')
            await self.status_callback(symbol, bucket_type, 'fetching', 'complete',
                                       {'total': len(all_articles), 'articles_fetched': len(all_articles)})
            async with self.progress_tracker.counter_lock:
                if symbol in self.progress_tracker.task_tracking:
                    self.progress_tracker.task_tracking[symbol]['total_articles'] = sum(
                        1 for a in all_articles if a.get('sourceSymbol') == symbol)
            if articles_being_analyzed and not self.task_manager.is_task_cancelled(symbol):
                await asyncio.gather(*articles_being_analyzed)

            bucket_type = 'market' if is_global_market else ('industry' if is_industry_symbol else 'stock')
            await self.progress_tracker.complete_analysis_for_symbol(symbol, bucket_type, pre_cache_stats,
                                                                     self.status_callback)
            async with self.progress_tracker.counter_lock:
                if symbol in self.progress_tracker.task_tracking:
                    self.progress_tracker.task_tracking[symbol]['analyzed_articles'] = \
                        self.progress_tracker.task_tracking[symbol]['total_articles']

        except asyncio.CancelledError:
            await self.status_callback(symbol, 'stock', 'cancelled', 'cancelled',
                                       {'message': f'Processing cancelled for {symbol}'})
            raise
        except Exception:
            await log_service.error(f"Error in article processing: {__import__('traceback').format_exc()}")
        finally:
            self.task_manager.unregister_task(symbol)