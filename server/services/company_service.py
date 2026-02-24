import asyncio
import aiohttp
import aiofiles
import csv
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from services import log_service, time_service
from services.api_utils import async_retry_decorator

class CompanyService:
    STOCK_DATABASE_PATH = 'data/stock_database.json'
    STOCK_CSV_PATH = 'data/nasdaq_stocks.csv'
    CACHE_KEY_TRENDING = 'market_data_trending'
    CACHE_KEY_GROWING = 'market_data_growing'
    CACHE_KEY_NEWCOMERS = 'market_data_newcomers'
    CACHE_KEY_EXPIRY = 3600

    def __init__(self, cache_service=None, config_service=None, ai_service=None):
        self.config = config_service
        self.cache = cache_service
        self.api_key = None
        self.stock_database = {}
        self.ai_service = ai_service
        self.api_semaphore = asyncio.Semaphore(5)
        self.session = None

    async def initialize(self):
        await self.config.initialize()
        self.api_key = self.config.get_key('alpha_vantage')
        await asyncio.to_thread(__import__('os').makedirs, 'data', exist_ok=True)
        self.stock_database = await self._load_stock_database()

        if not self.stock_database and not self.api_key:
            await log_service.error("CompanyService initialization failed - no stock database or Alpha Vantage API key")
            return

        await log_service.system("CompanyService initialized - stock database and API ready")

    async def _get_session(self):
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
        return self.session

    async def get_company_info(self, symbol: str, offline_only: bool = False) -> Optional[Dict]:
        symbol = symbol.upper()
        cached_company = await self.cache.get_cached_company(symbol)

        if cached_company and 'industry_keywords' in cached_company and 'search_keywords' in cached_company:
            await log_service.market(f"Found complete company info for {symbol} in cache")
            try:
                fingerprints = await asyncio.gather(
                    self.cache.get(f"fingerprint:{symbol}"),
                    self.cache.get(f"fingerprint:INDUSTRY_{symbol}"),
                    self.cache.get(f"fingerprint:GLOBAL_MARKET")
                )
                stock_fingerprint, industry_fingerprint, market_fingerprint = fingerprints

                if stock_fingerprint:
                    cached_company['sentiment_fingerprint_STOCK'] = stock_fingerprint
                if industry_fingerprint:
                    cached_company['sentiment_fingerprint_INDUSTRY'] = industry_fingerprint
                if market_fingerprint:
                    cached_company['sentiment_fingerprint_MARKET'] = market_fingerprint

            except Exception as e:
                await log_service.warning(f"Could not retrieve sentiment fingerprints for cached {symbol}: {e}")
            return cached_company

        if offline_only:
            await log_service.system(f"[Offline Mode] Incomplete or no cache for {symbol}. Skipping external calls.")
            return None

        await log_service.market(f"Found basic company info for {symbol} in cache, enriching with Claude")

        if not cached_company:
            await log_service.market(f"Fetching company information for {symbol}")
            if self.api_key:
                cached_company = await self._fetch_from_alpha_vantage(symbol)

            if not cached_company:
                cached_company = await self._get_from_database(symbol)

            if not cached_company:
                raise ValueError(f"Stock symbol '{symbol}' not found in database or API")

        @async_retry_decorator(
            max_retries=3,
            retry_delay=1.0,
            backoff_factor=2.0,
            retry_exceptions=(Exception,)
        )
        async def get_enriched_data():
            await log_service.market(f"Enriching company data with Claude for {symbol}")
            enriched_info = await self._add_industry_data(cached_company)
            if not enriched_info or 'industry_keywords' not in enriched_info or 'search_keywords' not in enriched_info:
                await log_service.error(f"Claude failed to return complete data for {symbol}")
                raise Exception(f"Claude did not return complete data for {symbol}")
            await log_service.success(f"Successfully enriched {symbol} data with Claude")
            return enriched_info

        enriched_info = await get_enriched_data()

        try:
            fingerprints = await asyncio.gather(
                self.cache.get(f"fingerprint:{symbol}"),
                self.cache.get(f"fingerprint:INDUSTRY_{symbol}"),
                self.cache.get(f"fingerprint:GLOBAL_MARKET")
            )
            stock_fingerprint, industry_fingerprint, market_fingerprint = fingerprints

            if stock_fingerprint:
                enriched_info['sentiment_fingerprint_STOCK'] = stock_fingerprint
                await log_service.market(f"Attached stock sentiment fingerprint to {symbol} company info.")
            if industry_fingerprint:
                enriched_info['sentiment_fingerprint_INDUSTRY'] = industry_fingerprint
                await log_service.market(f"Attached industry sentiment fingerprint to {symbol} company info.")
            if market_fingerprint:
                enriched_info['sentiment_fingerprint_MARKET'] = market_fingerprint
                await log_service.market(f"Attached market sentiment fingerprint to {symbol} company info.")

        except Exception as e:
            await log_service.warning(f"Could not retrieve sentiment fingerprints for {symbol}: {e}")

        await self.cache.cache_company(symbol, enriched_info)
        return enriched_info

    async def _add_industry_data(self, company_info: Dict) -> Optional[Dict]:
        if not company_info:
            return None

        company_name = company_info.get('name', '')
        symbol = company_info.get('symbol', '')
        company_sector = company_info.get('sector', '')
        company_industry = company_info.get('industry', '')
        company_ceo = company_info.get('ceo', 'N/A')
        description = company_info.get('description', '')

        prompt = f"""
        I need weighted keywords for {company_name} ({symbol}), which operates in the {company_industry} industry within the {company_sector} sector.

        Company description: {description}
        Current CEO information: {company_ceo}

        Please provide the following information in JSON format:

        1. search_keywords: For stock sentiment analysis, include both formal and common company names, ticker symbol, and CEO. Assign weights based on how frequently each term appears in stock discussions:
           - Full registered name (e.g., "Tesla Inc")
           - Common name (e.g., "Tesla") 
           - Stock symbol ({symbol})
           - CEO name
           - 1-2 additional terms ONLY if space (products, subsidiaries)

        Weight 0.1-1.0 based on actual usage in financial news and discussions.

        2. industry_keywords: A list of 5-7 weighted industry phrases, following this pattern:

        EXAMPLES OF GOOD INDUSTRY KEYWORDS:
        - For Tesla: [{{"term": "Electric Vehicle Industry", "weight": 1.0}}, {{"term": "Automotive Industry", "weight": 0.8}}, {{"term": "Clean Energy Industry", "weight": 0.7}}]
        - For Apple: [{{"term": "Technology Industry", "weight": 1.0}}, {{"term": "Consumer Electronics Industry", "weight": 0.8}}, {{"term": "Smartphone Industry", "weight": 0.7}}]

        3. ceo_name: If the CEO name is not already provided or is "N/A", suggest the likely current CEO based on your knowledge.

        Format your response as valid JSON only:
        {{
            "search_keywords": [
                {{"term": "Company Inc", "weight": 0.7}},
                {{"term": "Company", "weight": 1.0}},
                {{"term": "TICK", "weight": 0.8}},
                {{"term": "CEO Name", "weight": 0.6}}
            ],
            "industry_keywords": [
                {{"term": "Primary Industry", "weight": 1.0}},
                {{"term": "Secondary Industry", "weight": 0.8}}
            ],
            "ceo_name": "Name of CEO"
        }}
        """

        response = await self.ai_service.call_api(
            messages=[
                {"role": "system", "content": "You are a financial data assistant. Respond with only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            model="claude-3-7-sonnet-20250219",
            temperature=0,
            with_thinking=False,
            tag=f"company_data_{symbol}"
        )

        if not response or not hasattr(response, 'content'):
            await log_service.error(f"No response from Claude for {symbol}")
            return None

        claude_data = None

        for content_block in response.content:
            if content_block.type == "text":
                text = content_block.text.strip()
                try:
                    import re
                    json_match = re.search(r'\{.*\}', text, re.DOTALL)
                    if json_match:
                        json_str = json_match.group(0)
                        claude_data = await asyncio.to_thread(__import__('json').loads, json_str)
                        break
                except Exception as e:
                    await log_service.error(f"Error parsing Claude response for {symbol}: {str(e)}")
                    await log_service.error(f"Claude response text: {text[:200]}...")
                    return None

        if not claude_data:
            await log_service.error(f"Could not extract valid JSON from Claude for {symbol}")
            return None

        required_fields = ['industry_keywords', 'search_keywords']
        for field in required_fields:
            if field not in claude_data or not claude_data[field]:
                await log_service.error(f"Claude response missing {field} for {symbol}")
                return None
            if not isinstance(claude_data[field], list):
                await log_service.error(f"Claude's {field} is not a list for {symbol}")
                return None

        if claude_data.get('ceo_name') and company_info.get('ceo') in ['N/A', '', None]:
            company_info['ceo'] = claude_data['ceo_name']

        await log_service.market(
            f"Claude successfully provided {len(claude_data['industry_keywords'])} industry keywords and {len(claude_data['search_keywords'])} search keywords for {symbol}")

        enriched_data = {**company_info, **claude_data}

        if 'ceo_name' in enriched_data:
            enriched_data['ceo'] = enriched_data['ceo_name']

        return enriched_data

    @async_retry_decorator(
        max_retries=3,
        retry_delay=1.0,
        backoff_factor=2.0,
        retry_exceptions=(aiohttp.ClientError, Exception)
    )
    async def _fetch_from_alpha_vantage(self, symbol: str) -> Optional[Dict]:
        if not self.api_key:
            return None

        async with self.api_semaphore:
            try:
                session = await self._get_session()
                url = f"https://www.alphavantage.co/query?function=OVERVIEW&symbol={symbol}&apikey={self.api_key}"

                async with session.get(url) as response:
                    response.raise_for_status()
                    data = await response.json()

                if 'Symbol' in data and data['Symbol']:
                    company_info = {
                        'symbol': data.get('Symbol', symbol),
                        'name': data.get('Name', ''),
                        'description': data.get('Description', ''),
                        'exchange': data.get('Exchange', ''),
                        'industry': data.get('Industry', ''),
                        'sector': data.get('Sector', ''),
                        'employees': data.get('FullTimeEmployees', ''),
                        'ceo': data.get('CEO', ''),
                        'website': data.get('Website', ''),
                        'marketCap': data.get('MarketCapitalization', ''),
                        'peRatio': data.get('PERatio', '')
                    }
                    await self._update_database_entry(symbol, company_info)
                    await log_service.success(f"Successfully fetched info for {symbol} from Alpha Vantage")
                    return company_info
                else:
                    await log_service.market(f"Alpha Vantage returned incomplete data for {symbol}")
            except Exception as e:
                await log_service.error(f"Error fetching from Alpha Vantage: {str(e)}")
        return None

    async def _get_from_database(self, symbol: str) -> Optional[Dict]:
        return self.stock_database.get(symbol)

    async def _load_stock_database(self) -> Dict:
        try:
            if await asyncio.to_thread(__import__('os').path.exists, self.STOCK_DATABASE_PATH):
                async with aiofiles.open(self.STOCK_DATABASE_PATH, 'r') as f:
                    content = await f.read()
                    data = await asyncio.to_thread(__import__('json').loads, content)
                    await log_service.market(f"Loaded {len(data)} stocks from database")
                    return data
        except Exception as e:
            await log_service.error(f"Error loading stock database: {str(e)}")

        database = {}
        try:
            if await asyncio.to_thread(__import__('os').path.exists, self.STOCK_CSV_PATH):
                async with aiofiles.open(self.STOCK_CSV_PATH, 'r') as f:
                    content = await f.read()
                    reader = csv.DictReader(content.splitlines())

                    for row in reader:
                        symbol = row.get('Symbol', '')
                        if symbol:
                            database[symbol] = {
                                'symbol': symbol,
                                'name': row.get('Name', ''),
                                'sector': row.get('Sector', ''),
                                'industry': row.get('Industry', ''),
                                'exchange': row.get('Exchange', ''),
                                'ceo': ''
                            }

                await log_service.market(f"Loaded {len(database)} stocks from CSV")
                await self._save_stock_database(database)
                return database
        except Exception as e:
            await log_service.error(f"Error loading stock CSV: {str(e)}")

        await log_service.market(
            "No stock database found. Search functionality will be limited to Alpha Vantage API calls.")
        return {}

    async def _save_stock_database(self, database: Optional[Dict] = None) -> bool:
        try:
            data_to_save = database or self.stock_database
            async with aiofiles.open(self.STOCK_DATABASE_PATH, 'w') as f:
                content = await asyncio.to_thread(__import__('json').dumps, data_to_save)
                await f.write(content)
            await log_service.market(f"Saved {len(data_to_save)} stocks to database")
            return True
        except Exception as e:
            await log_service.error(f"Error saving stock database: {str(e)}")
            return False

    async def _update_database_entry(self, symbol: str, company_info: Dict) -> bool:
        try:
            self.stock_database[symbol] = company_info
            if len(self.stock_database) % 10 == 0:
                asyncio.create_task(self._save_stock_database())
            return True
        except Exception as e:
            await log_service.error(f"Error updating database entry: {str(e)}")
            return False

    async def search_stocks(self, query: str, limit: int = 10) -> List[Dict]:
        if not query or len(query) < 1:
            return []

        query = query.upper()
        results = []

        for symbol, data in self.stock_database.items():
            if query == symbol:
                results.append(data)
                break

        if len(results) < limit:
            for symbol, data in self.stock_database.items():
                if symbol.startswith(query) and data not in results:
                    results.append(data)
                    if len(results) >= limit:
                        break

        if len(results) < limit:
            for symbol, data in self.stock_database.items():
                name = data.get('name', '').upper()
                if query in name and data not in results:
                    results.append(data)
                    if len(results) >= limit:
                        break

        if not results and self.api_key and len(query) >= 1:
            try:
                company_info = await self._fetch_from_alpha_vantage(query)
                if company_info:
                    results.append(company_info)
            except Exception as e:
                await log_service.error(f"Error searching Alpha Vantage: {str(e)}")

        return results[:limit]

    async def get_stock_suggestions(self, category: Optional[str] = None) -> Dict:
        try:
            if category:
                if category == 'trending':
                    return await self._get_trending_stocks()
                elif category == 'growing':
                    return await self._get_growing_stocks()
                elif category == 'newcomers':
                    return await self._get_newcomer_stocks()
                return []

            trending_task = self._get_trending_stocks()
            growing_task = self._get_growing_stocks()
            newcomers_task = self._get_newcomer_stocks()

            trending, growing, newcomers = await asyncio.gather(trending_task, growing_task, newcomers_task)

            return {
                'trending': trending,
                'growing': growing,
                'newcomers': newcomers
            }
        except Exception as e:
            await log_service.error(f"Error getting stock suggestions: {str(e)}")
            return [] if category else {}

    @async_retry_decorator(
        max_retries=3,
        retry_delay=1.0,
        backoff_factor=2.0,
        retry_exceptions=(aiohttp.ClientError, Exception)
    )
    async def _get_trending_stocks(self, limit: int = 5) -> List[Dict]:
        cached_data = await self.cache.get(self.CACHE_KEY_TRENDING)
        if cached_data and time_service.timestamp() - cached_data.get('timestamp', 0) < self.CACHE_KEY_EXPIRY:
            return cached_data.get('data', [])

        if not self.api_key:
            return []

        trending_stocks = []
        async with self.api_semaphore:
            try:
                session = await self._get_session()
                url = f"https://www.alphavantage.co/query?function=TOP_GAINERS_LOSERS&apikey={self.api_key}"

                async with session.get(url) as response:
                    response.raise_for_status()
                    data = await response.json()

                combined = []
                for key in ['top_gainers', 'top_losers', 'most_actively_traded']:
                    if key in data:
                        combined.extend(data[key])

                seen_symbols = set()
                for item in combined:
                    symbol = item.get('ticker', '')
                    if symbol and symbol not in seen_symbols and len(trending_stocks) < limit:
                        name = item.get('name', '')
                        if not name and symbol in self.stock_database:
                            name = self.stock_database[symbol].get('name', '')

                        trending_stocks.append({
                            'symbol': symbol,
                            'name': name,
                            'change_percentage': item.get('change_percentage', ''),
                            'price': item.get('price', ''),
                            'volume': item.get('volume', '')
                        })
                        seen_symbols.add(symbol)
            except Exception as e:
                await log_service.error(f"Error fetching trending stocks: {str(e)}")

        await self.cache.set(self.CACHE_KEY_TRENDING, {'data': trending_stocks, 'timestamp': time_service.timestamp()})
        return trending_stocks

    @async_retry_decorator(
        max_retries=3,
        retry_delay=1.0,
        backoff_factor=2.0,
        retry_exceptions=(aiohttp.ClientError, Exception)
    )
    async def _get_growing_stocks(self, limit: int = 5) -> List[Dict]:
        cached_data = await self.cache.get(self.CACHE_KEY_GROWING)
        if cached_data and time_service.timestamp() - cached_data.get('timestamp', 0) < self.CACHE_KEY_EXPIRY:
            return cached_data.get('data', [])

        if not self.api_key:
            return []

        growing_stocks = []
        async with self.api_semaphore:
            try:
                session = await self._get_session()
                url = f"https://www.alphavantage.co/query?function=SECTOR&apikey={self.api_key}"

                async with session.get(url) as response:
                    response.raise_for_status()
                    data = await response.json()

                top_sectors = []
                for time_range, sectors in data.items():
                    if isinstance(sectors, dict) and "Information Technology" in sectors:
                        if "Rank A" in time_range or "Rank B" in time_range:
                            for sector, performance in sectors.items():
                                if sector != "Meta Data":
                                    try:
                                        perf = float(performance.strip('%'))
                                        if perf > 0:
                                            top_sectors.append(sector)
                                    except:
                                        pass

                if top_sectors:
                    unique_sectors = list(set(top_sectors))
                    for symbol, data in self.stock_database.items():
                        sector = data.get('sector', '')
                        if sector in unique_sectors and len(growing_stocks) < limit:
                            growing_stocks.append({
                                'symbol': symbol,
                                'name': data.get('name', ''),
                                'sector': sector
                            })
            except Exception as e:
                await log_service.error(f"Error fetching growing stocks: {str(e)}")

        await self.cache.set(self.CACHE_KEY_GROWING, {'data': growing_stocks, 'timestamp': time_service.timestamp()})
        return growing_stocks

    @async_retry_decorator(
        max_retries=3,
        retry_delay=1.0,
        backoff_factor=2.0,
        retry_exceptions=(aiohttp.ClientError, Exception)
    )
    async def _get_newcomer_stocks(self, limit: int = 5) -> List[Dict]:
        cached_data = await self.cache.get(self.CACHE_KEY_NEWCOMERS)
        if cached_data and time_service.timestamp() - cached_data.get('timestamp', 0) < self.CACHE_KEY_EXPIRY:
            return cached_data.get('data', [])

        if not self.api_key:
            return []

        newcomer_stocks = []
        async with self.api_semaphore:
            try:
                session = await self._get_session()
                url = f"https://www.alphavantage.co/query?function=LISTING_STATUS&apikey={self.api_key}"

                async with session.get(url) as response:
                    response.raise_for_status()
                    response_text = await response.text()

                lines = response_text.strip().split('\n')
                if len(lines) > 1:
                    reader = csv.DictReader(lines)
                    listings = []

                    for row in reader:
                        if 'ipoDate' in row and row['ipoDate']:
                            try:
                                ipo_date = datetime.strptime(row['ipoDate'], '%Y-%m-%d')
                                if ipo_date > time_service.now() - timedelta(days=180):
                                    listings.append({
                                        'symbol': row.get('symbol', ''),
                                        'name': row.get('name', ''),
                                        'ipo_date': row.get('ipoDate', '')
                                    })
                            except:
                                pass

                    listings.sort(key=lambda x: x['ipo_date'], reverse=True)
                    for listing in listings[:limit]:
                        if not any(s['symbol'] == listing['symbol'] for s in newcomer_stocks):
                            newcomer_stocks.append({
                                'symbol': listing['symbol'],
                                'name': listing['name'],
                                'ipo_date': listing['ipo_date']
                            })
            except Exception as e:
                await log_service.error(f"Error fetching newcomer stocks: {str(e)}")

        await self.cache.set(self.CACHE_KEY_NEWCOMERS, {'data': newcomer_stocks, 'timestamp': time_service.timestamp()})
        return newcomer_stocks

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()