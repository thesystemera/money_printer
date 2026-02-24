import asyncio
import random
import aiohttp
import pytz
import nltk
import os
import aiofiles
from unidecode import unidecode
from urllib.parse import urlparse
from services import log_service, time_service
from services.api_utils import async_retry_decorator
from undetected_playwright import Malenia

class ArticleEnrichmentService:
    def __init__(self, config_service=None):
        self.config = config_service
        self.enabled = False
        self.max_concurrent_enrichments = None
        self.max_concurrent_browsers = None
        self.enrichment_timeout = None
        self.enrichment_delay = None
        self.enrichment_max_total_length = None
        self.browser_semaphore = None
        self.direct_semaphore = None
        self.playwright = None
        self.browser = None
        self.newspaper_config = None
        self.session = None

        self.user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
        ]

        self.domain_blacklist = set()
        self.spam_tracker = {}
        self.SPAM_THRESHOLD = 5
        self.BLACKLIST_FILE = os.path.join(os.path.dirname(__file__), '..', 'config', 'domain_blacklist.txt')

    async def _load_blacklist(self):
        absolute_path = os.path.abspath(self.BLACKLIST_FILE)
        try:
            async with aiofiles.open(absolute_path, mode='r') as f:
                async for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        self.domain_blacklist.add(line)
            await log_service.system(f"Loaded {len(self.domain_blacklist)} domains from blacklist at {absolute_path}")
        except FileNotFoundError:
            await log_service.warning(f"Blacklist file not found. Creating a new one at {absolute_path}")
            try:
                dir_name = os.path.dirname(absolute_path)
                os.makedirs(dir_name, exist_ok=True)
                async with aiofiles.open(absolute_path, mode='w') as f:
                    await f.write("# Domains to be blocked by the article enrichment service\n")
                await log_service.system(f"Created empty blacklist file.")
            except Exception as e:
                await log_service.error(f"Failed to create blacklist file: {e}")
        except Exception as e:
            await log_service.error(f"Failed to load domain blacklist: {e}")

    async def _update_blacklist(self, domain):
        if domain not in self.domain_blacklist:
            self.domain_blacklist.add(domain)
            try:
                async with aiofiles.open(self.BLACKLIST_FILE, mode='a') as f:
                    await f.write(f"\n{domain}")
                await log_service.warning(f"Domain '{domain}' auto-blacklisted after hitting threshold.")
            except Exception as e:
                await log_service.error(f"Failed to write to domain blacklist file: {e}")

    async def initialize(self):
        if not self.config:
            await log_service.error("ArticleEnrichmentService: No config service provided")
            return

        await self._load_blacklist()
        self.enabled = self.config.get('article_enrichment_enabled')
        if not self.enabled:
            await log_service.enrichment("ArticleEnrichmentService: disabled by config")
            return

        self.max_concurrent_browsers = self.config.get('max_concurrent_browsers')
        self.enrichment_timeout = self.config.get('enrichment_timeout')
        self.enrichment_delay = self.config.get('enrichment_delay')
        self.enrichment_max_total_length = self.config.get('enrichment_max_total_length')

        self.browser_semaphore = asyncio.Semaphore(self.max_concurrent_browsers)
        self.direct_semaphore = asyncio.Semaphore(self.config.get('max_concurrent_direct'))

        required_resources = ['punkt', 'punkt_tab']
        for resource in required_resources:
            try:
                nltk.data.find(f'tokenizers/{resource}')
            except LookupError:
                await log_service.warning(f"NLTK '{resource}' model not found. Downloading...")
                nltk.download(resource, quiet=True)
            except Exception as e:
                await log_service.error(f"Error during NLTK initialization for resource '{resource}': {e}")

        try:
            from newspaper import Article, Config
            self.newspaper_config = Config()
            self.newspaper_config.browser_user_agent = random.choice(self.user_agents)
            self.newspaper_config.request_timeout = 15
            self.newspaper_config.fetch_images = False
            self.newspaper_config.memoize_articles = False
        except ImportError:
            await log_service.error("newspaper3k not installed - enrichment disabled")
            self.enabled = False
            return

        try:
            from playwright.async_api import async_playwright
            self.playwright = async_playwright()
            p = await self.playwright.__aenter__()
            self.browser = await p.chromium.launch(headless=True)
            await log_service.enrichment(
                f"Initialized with {self.max_concurrent_browsers} workers and persistent browser.")
        except ImportError:
            await log_service.warning("Playwright not installed - browser-based enrichment disabled.")
            self.browser = None
        except Exception as e:
            await log_service.error(f"Failed to launch persistent browser: {e}")
            self.browser = None

    async def get_session(self):
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(
                headers={"User-Agent": random.choice(self.user_agents)},
                timeout=aiohttp.ClientTimeout(total=self.enrichment_timeout)
            )
        return self.session

    async def close(self):
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.__aexit__(None, None, None)
        if self.session:
            await self.session.close()

    async def _parse_html_with_newspaper(self, html, url):
        from newspaper import Article
        domain = urlparse(url).netloc

        article = Article(url, config=self.newspaper_config)
        article.set_html(html)
        await asyncio.to_thread(article.parse)

        if not article.text:
            return None, None, 'no_text'

        def process_text_cpu_bound(text):
            normalized = unidecode(text.strip())
            sents = nltk.sent_tokenize(normalized)
            return normalized, sents

        normalized_text, sentences = await asyncio.to_thread(
            process_text_cpu_bound, article.text
        )

        text_len = len(normalized_text)

        if text_len < 250:
            tracker = self.spam_tracker.get(domain, {'last_len': -1, 'count': 0})
            if tracker['last_len'] == text_len:
                tracker['count'] += 1
            else:
                tracker['last_len'] = text_len
                tracker['count'] = 1

            self.spam_tracker[domain] = tracker
            if tracker['count'] >= self.SPAM_THRESHOLD:
                await self._update_blacklist(domain)
            return None, None, 'too_short'

        num_sentences = len(sentences)

        if num_sentences < 3:
            return None, None, 'not_enough_sentences'

        if domain in self.spam_tracker:
            del self.spam_tracker[domain]

        if num_sentences > 5:
            selected_sentences = sentences[:3] + sentences[-2:]
        else:
            selected_sentences = sentences

        final_summary = " ".join(selected_sentences)
        if len(final_summary) > self.enrichment_max_total_length:
            final_summary = final_summary[:self.enrichment_max_total_length].rsplit(' ', 1)[0] + '...'

        pub_date = article.publish_date
        if pub_date:
            if pub_date.tzinfo is None:
                pub_date = pub_date.replace(tzinfo=pytz.UTC)
            pub_date = pub_date.isoformat()

        return final_summary, pub_date, 'success'

    @async_retry_decorator(max_retries=2, retry_delay=1.0)
    async def _fast_extract(self, url: str):
        try:
            session = await self.get_session()
            async with session.get(url, allow_redirects=True) as response:
                if response.status == 200:
                    html = await response.text()
                    final_url = str(response.url)
                    return await self._parse_html_with_newspaper(html, final_url)
        except aiohttp.ClientPayloadError as e:
            await log_service.warning(f"Direct download failed (payload error): {e}")
            return None, None, 'payload_error'
        except Exception as e:
            await log_service.error(f"Fast extraction failed for {url}: {str(e)}")
        return None, None, 'exception'

    @async_retry_decorator(max_retries=2, retry_delay=1.0)
    async def _browser_extract(self, url: str):
        if not self.browser:
            return None, None, 'browser_disabled'

        context = await self.browser.new_context(user_agent=random.choice(self.user_agents), locale='en-US')
        page = None
        try:
            await Malenia.apply_stealth(context)
            page = await context.new_page()
            await page.goto(url, wait_until='domcontentloaded', timeout=self.enrichment_timeout * 1000)
            await page.wait_for_timeout(2000)
            final_url = page.url
            html = await page.content()
            return await self._parse_html_with_newspaper(html, final_url)
        except Exception as e:
            await log_service.error(f"Browser extraction failed for {url}: {e}")
            return None, None, 'exception'
        finally:
            if page and not page.is_closed():
                await page.close()
            if context:
                await context.close()

    async def enrich_article(self, article: dict) -> (dict, str):
        if not self.enabled:
            return article, 'disabled'

        url = article.get('url', '')
        if not url:
            return article, 'no_url'

        try:
            domain = urlparse(url).netloc
            if domain in self.domain_blacklist:
                return article, 'failed_blacklist'
        except (ValueError, TypeError):
            pass

        await asyncio.sleep(random.uniform(0.1, self.enrichment_delay))

        content, pub_date, status, method = None, None, 'unknown', 'none'

        async with self.direct_semaphore:
            content, pub_date, status = await self._fast_extract(url)
            if content:
                method = 'direct_newspaper3k'

        if not content:
            async with self.browser_semaphore:
                content, pub_date, status = await self._browser_extract(url)
                if content:
                    method = 'browser_newspaper3k'

        if content and status == 'success':
            log_method = "DIRECT" if method == 'direct_newspaper3k' else "BROWSER"

            await log_service.enrichment(f"✓ {log_method} '{url[:60]}...' ({len(content)} chars)")

            enhanced_article = article.copy()
            enhanced_article['summary'] = content
            if pub_date:
                enhanced_article['publishedDate'] = pub_date
            enhanced_article['enriched'] = True
            enhanced_article['enrichment_method'] = method
            enhanced_article['enriched_at'] = int(time_service.timestamp())
            return enhanced_article, method
        else:
            await log_service.enrichment(f"✗ FAILED ({status}) '{url[:60]}...'")
            return article, 'failed'