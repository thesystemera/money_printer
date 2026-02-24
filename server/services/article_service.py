import re
import asyncio
import aiohttp
import random
import json
import functools
from datetime import datetime
import pytz
import feedparser
import email.utils
from urllib.parse import quote, urlparse
from services import log_service
from unidecode import unidecode


def async_retry_decorator(max_retries=3, initial_delay=1.0, backoff_factor=2.0, jitter=0.5,
                          retry_exceptions=(aiohttp.ClientError, asyncio.TimeoutError)):
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            delay = initial_delay
            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except retry_exceptions as e:
                    if attempt == max_retries:
                        await log_service.error(
                            f"Function {func.__name__} failed after {max_retries} retries. Final error: {e}")
                        return None
                    random_jitter = random.uniform(-jitter * delay, jitter * delay)
                    current_delay = delay + random_jitter
                    await log_service.warning(
                        f"Function {func.__name__} failed (Attempt {attempt + 1}/{max_retries}). Retrying in {current_delay:.2f}s. Error: {e}")
                    await asyncio.sleep(current_delay)
                    delay *= backoff_factor
        return wrapper
    return decorator

class ArticleService:
    def __init__(self, cache_service=None, config_service=None, enrichment_service=None):
        self.language = 'en'
        self.country = 'US'
        self.user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.109',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; rv:115.0) Gecko/20100101 Firefox/115.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
            'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0'
        ]
        self.referers = [
            'https://www.google.com/',
            'https://news.google.com/home',
            'https://news.google.com/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGxqWjNUN0VnVmxiaTFIUWlnQVAB?hl=en-US&gl=US&ceid=US%3Aen',
            'https://www.bing.com/',
            'https://duckduckgo.com/',
            'https://www.google.com/search?q=latest+market+news'
        ]
        self.cache = cache_service
        self.config = config_service
        self.enrichment_service = enrichment_service
        self.request_semaphore = asyncio.Semaphore(50)
        self.processing_semaphore = asyncio.Semaphore(50)
        self.batchexecute_semaphore = asyncio.Semaphore(25)
        self.session = None

    async def initialize(self):
        self.session = aiohttp.ClientSession()

    async def get_session(self):
        if self.session is None or self.session.closed:
            await log_service.warning("aiohttp session was closed unexpectedly. Recreating.")
            self.session = aiohttp.ClientSession()
        return self.session

    async def cache_article(self, article):
        return await self.cache.cache_article(article)

    def _get_random_headers(self):
        return {
            "User-Agent": random.choice(self.user_agents),
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            "Connection": "keep-alive",
            "Referer": random.choice(self.referers),
            "DNT": "1",
            "Upgrade-Insecure-Requests": "1"
        }

    async def decode_google_news_url(self, source_url):
        if not source_url.startswith("https://news.google.com/rss/articles/"):
            return source_url, 'not_google'
        path_parts = urlparse(source_url).path.split("/")
        if len(path_parts) < 3 or path_parts[-2] != "articles":
            return source_url, 'not_google'
        article_id = path_parts[-1].split('?')[0]
        decoded_result = await self._decode_with_batchexecute(article_id)
        if decoded_result:
            return decoded_result
        return source_url, 'batchexecute_failed_all_retries'

    @async_retry_decorator(max_retries=3, initial_delay=2.0, backoff_factor=2.0, jitter=1.0)
    async def _decode_with_batchexecute(self, article_id):
        session = await self.get_session()
        await asyncio.sleep(random.uniform(0.5, 2.0))
        async with self.batchexecute_semaphore:
            try:
                get_headers = self._get_random_headers()
                async with session.get(f"https://news.google.com/articles/{article_id}", headers=get_headers,
                                       timeout=15) as response:
                    if response.status != 200:
                        await log_service.error(f"Article fetch failed with status {response.status}: {article_id}")
                        response.raise_for_status()
                    text = await response.text()
                    sig_match = re.search(r'data-n-a-sg="([^"]*)"', text)
                    ts_match = re.search(r'data-n-a-ts="([^"]*)"', text)
                    if not sig_match or not ts_match:
                        await log_service.error(f"Could not find signature/timestamp in article page: {article_id}")
                        return None
                    signature = sig_match.group(1)
                    timestamp = ts_match.group(1)
            except Exception as e:
                await log_service.error(f"Exception fetching article page: {article_id} - {str(e)}")
                raise
            try:
                articles_req = ["Fbv4je",
                                f'["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{article_id}",{timestamp},"{signature}"]']
                payload = f"f.req={quote(json.dumps([[articles_req]]))}"
                post_headers = self._get_random_headers()
                post_headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8"
                async with session.post("https://news.google.com/_/DotsSplashUi/data/batchexecute",
                                        headers=post_headers, data=payload, timeout=15) as response:
                    if response.status != 200:
                        await log_service.error(f"Batchexecute failed with status {response.status}")
                        response.raise_for_status()
                    response_text = await response.text()
                    response_parts = response_text.split("\n\n")
                    if len(response_parts) < 2:
                        await log_service.error(f"Invalid batchexecute response format: {article_id}")
                        return None
                    decoded_data = json.loads(response_parts[1])
                    if decoded_data and len(decoded_data) > 0 and len(decoded_data[0]) > 2:
                        url_data = json.loads(decoded_data[0][2])
                        if url_data and len(url_data) > 1 and url_data[1]:
                            decoded_url = url_data[1]
                            return decoded_url, 'batchexecute'
                    await log_service.error(f"Could not extract URL from batchexecute response: {article_id}")
                    return None
            except Exception as e:
                await log_service.error(f"Exception in batchexecute: {article_id} - {str(e)}")
                raise

    async def search_articles(self, keyword, start_date_utc, end_date_utc,
                              callback=None, industry_keywords=None, use_recent_keyword=False):
        await log_service.workflow(
            f"Searching articles for '{keyword}' from {start_date_utc.isoformat()} to {end_date_utc.isoformat()} (use_recent_keyword={use_recent_keyword})")
        processed_urls, all_results = set(), []
        terms = industry_keywords if (industry_keywords and isinstance(industry_keywords, list)) else [keyword]
        tasks = [self._fetch_articles_for_date_range(t, start_date_utc, end_date_utc,
                                                     processed_urls, all_results,
                                                     callback, original_keyword=keyword,
                                                     use_recent_keyword=use_recent_keyword)
                 for t in terms]
        if tasks:
            await asyncio.gather(*tasks)
        await log_service.workflow(f"Search complete for '{keyword}': pooled={len(all_results)} (terms={len(terms)})")
        return all_results

    @async_retry_decorator(max_retries=3, initial_delay=1.0, backoff_factor=2.0)
    async def _fetch_rss_data(self, rss_url):
        session = await self.get_session()
        headers = self._get_random_headers()
        async with session.get(rss_url, timeout=15, headers=headers) as response:
            if response.status != 200:
                await log_service.error(f"Error fetching RSS feed: {response.status}")
                response.raise_for_status()
            return await response.text()

    async def _fetch_articles_for_date_range(self, keyword, start_date_utc, end_date_utc,
                                             processed_urls, all_results,
                                             callback, original_keyword=None, use_recent_keyword=False):
        try:
            if use_recent_keyword:
                query = f'"{keyword}" when:1d'
                await log_service.workflow(f"Recent pass is using query: {query}")
            else:
                start_date_str = start_date_utc.strftime('%Y-%m-%d')
                end_date_str = end_date_utc.strftime('%Y-%m-%d')
                query = f'"{keyword}" after:{start_date_str} before:{end_date_str}'
                await log_service.workflow(f"RSS fetch is using query: {query}")

            encoded_query = query.replace(' ', '%20')
            rss_url = (f"https://news.google.com/rss/search?q={encoded_query}"
                       f"&hl={self.language.lower()}&scoring=r")

            async with self.request_semaphore:
                text = await self._fetch_rss_data(rss_url)
                if not text:
                    await log_service.workflow(f"Failed to fetch RSS for '{keyword}'")
                    return []
                feed = feedparser.parse(text)

            candidates, before_pool, before_urls = len(getattr(feed, "entries", []) or []), len(all_results), len(
                processed_urls)
            results = await self._process_feed_entries(feed.entries, processed_urls, all_results,
                                                       callback, original_keyword, keyword)
            kept_delta = len(all_results) - before_pool
            dedup_prevented = max(0, len(processed_urls) - before_urls)
            skipped = max(0, candidates - kept_delta)

            await log_service.workflow(
                f"RSS fetch finished for '{keyword}': candidates={candidates} kept={kept_delta} skipped={skipped} dedup_prevented={dedup_prevented}")

            return results
        except Exception as e:
            await log_service.error(f"Error fetching RSS articles for keyword '{keyword}': {str(e)}")
            return []

    async def _process_feed_entries(self, entries, processed_titles, all_results,
                                    callback, original_keyword, keyword):
        if not entries:
            return []
        day_articles = []
        async with self.processing_semaphore:
            article_infos = []
            for entry in entries:
                article_info = await self._process_feed_entry(entry, original_keyword or keyword)
                if not article_info:
                    continue
                if original_keyword and original_keyword.startswith("INDUSTRY_") and original_keyword != keyword:
                    article_info['matchedKeyword'] = keyword
                article_infos.append(article_info)

            cache_tasks = [self.cache.get_cached_article(info['title']) for info in article_infos]
            cached_articles = await asyncio.gather(*cache_tasks)

            to_enrich = []
            for article_info, cached_article in zip(article_infos, cached_articles):
                if cached_article:
                    if article_info.get('matchedKeyword'):
                        cached_article['matchedKeyword'] = article_info['matchedKeyword']
                    day_articles.append(cached_article)
                else:
                    to_enrich.append(article_info)

            if to_enrich and self.enrichment_service and self.enrichment_service.enabled:
                decode_tasks = [self.decode_google_news_url(info['url']) for info in to_enrich]
                decoded_urls = await asyncio.gather(*decode_tasks)
                for info, (url, method) in zip(to_enrich, decoded_urls):
                    info['url'] = url
                    info['url_decode_method'] = method

                async def safe_enrich(info):
                    try:
                        enriched_article, status = await self.enrichment_service.enrich_article(info)
                        if status == 'failed_blacklist':
                            return None
                        enriched_article['enrichment_status'] = status
                        return enriched_article
                    except Exception as e:
                        await log_service.error(f"Enrichment failed for article: {str(e)}")
                        info['enrichment_status'] = 'error'
                        return info

                enrichment_tasks = [safe_enrich(info) for info in to_enrich]
                enriched_results = await asyncio.gather(*enrichment_tasks)
                day_articles.extend([r for r in enriched_results if r is not None])
            elif to_enrich:
                day_articles.extend(to_enrich)

        return await self._finalize_day_articles(day_articles, processed_titles, all_results, callback)

    async def _finalize_day_articles(self, day_articles, processed_titles, all_results, callback):
        article_tasks = []
        for article in day_articles:
            if article['title'] in processed_titles:
                continue
            processed_titles.add(article['title'])
            all_results.append(article)
            if not article.get('_from_cache', False):
                await self.cache.cache_article(article)
            if callback and callable(callback):
                article_tasks.append(callback(article))
        if article_tasks:
            await asyncio.gather(*article_tasks)
        return day_articles

    async def _process_feed_entry(self, entry, keyword):
        try:
            title_parts = entry.title.split(' - ')
            if len(title_parts) > 1:
                title = ' - '.join(title_parts[:-1])
                publisher = title_parts[-1]
            else:
                title = entry.title
                publisher = "Unknown"

            title = unidecode(title)
            publisher = unidecode(publisher)

            published_date = None
            if hasattr(entry, 'published'):
                try:
                    parsed_date_tuple = email.utils.parsedate_tz(entry.published)
                    if parsed_date_tuple:
                        dt = datetime.fromtimestamp(email.utils.mktime_tz(parsed_date_tuple), pytz.UTC)
                        published_date = dt.isoformat()
                    else:
                        dt = datetime.strptime(entry.published, "%a, %d %b %Y %H:%M:%S %Z")
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=pytz.UTC)
                        published_date = dt.isoformat()
                except (ValueError, TypeError):
                    await log_service.warning(
                        f"Could not parse date '{entry.published}' for article '{title}'. Skipping.")
                    return None

            if not published_date:
                await log_service.warning(f"Article '{title}' has no valid published date. Skipping.")
                return None

            description = entry.summary if hasattr(entry, 'summary') else title
            if '<' in description and '>' in description:
                description = re.sub(r'<[^>]+>', ' ', description)
                description = re.sub(r'\s+', ' ', description).strip()
            description = unidecode(description)

            return {
                'title': title,
                'publisher': publisher,
                'publishedDate': published_date,
                'url': entry.link,
                'summary': description,
                'keyword': keyword,
                'enriched': False
            }
        except Exception as e:
            await log_service.error(f"Error processing RSS entry: {str(e)}")
            return None