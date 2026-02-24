import aiohttp
import json
import asyncio
from datetime import datetime, timedelta
import traceback
import pytz
from services import log_service, time_service
from services.api_utils import async_retry_decorator

class EarningsService:
    def __init__(self, cache_service=None, config_service=None):
        self.cache = cache_service
        self.config = config_service
        self.alpha_vantage_key = None
        self.finnhub_api_key = None
        self.api_semaphore = asyncio.Semaphore(5)

    async def initialize(self):
        self.alpha_vantage_key = self.config.get_key('alpha_vantage')
        self.finnhub_api_key = self.config.get_key('finnhub')

        if not self.alpha_vantage_key:
            await log_service.warning("Alpha Vantage API key not found. Falling back to Finnhub.")

        if not self.finnhub_api_key:
            self.finnhub_api_key = 'clfb57pr01qoveppt23gclfb57pr01qoveppt240'

        await log_service.system("EarningsService initialized")

    async def get_earnings_data(self, symbol, force_refresh=False):
        if not force_refresh:
            cached_data = await self.cache.get_cached_earnings(symbol)
            if cached_data:
                await log_service.cache(f"[EARNINGS] ✓ Using cached earnings data for {symbol}")
                return cached_data

        try:
            await log_service.info(f"Fetching earnings data for {symbol}")

            combined_events = []

            tasks = []
            if self.alpha_vantage_key:
                tasks.append(self._fetch_alpha_vantage_earnings(symbol))
            else:
                tasks.append(asyncio.create_task(asyncio.sleep(0, result=[])))  # Empty placeholder
            tasks.append(self._fetch_finnhub_earnings(symbol))

            historical_events, upcoming_events = await asyncio.gather(*tasks)

            if historical_events and len(historical_events) > 1:
                await log_service.success(
                    f"Successfully retrieved {len(historical_events)} historical earnings records from Alpha Vantage for {symbol}")
                combined_events.extend(historical_events)

            if upcoming_events:
                await log_service.success(
                    f"Retrieved {len(upcoming_events)} upcoming earnings events from Finnhub for {symbol}")

                existing_dates = {event.get('Date') for event in combined_events if event.get('Date')}
                new_events = [event for event in upcoming_events if event.get('Date') not in existing_dates]

                if new_events:
                    await log_service.info(f"Adding {len(new_events)} unique upcoming earnings events from Finnhub")
                    combined_events.extend(new_events)

            if combined_events:
                await self.cache.cache_earnings(symbol, combined_events)
                return combined_events

            await log_service.warning(f"No earnings data available for {symbol} from any source")
            return []
        except Exception as e:
            await log_service.error(f"Exception in get_earnings_data for {symbol}: {str(e)}")
            await log_service.error(traceback.format_exc())
            return []

    @async_retry_decorator(
        max_retries=3,
        retry_delay=1.0,
        backoff_factor=2.0,
        retry_exceptions=(Exception,)
    )
    async def _fetch_alpha_vantage_earnings(self, symbol):
        if not self.alpha_vantage_key:
            return []

        url = f'https://www.alphavantage.co/query?function=EARNINGS&symbol={symbol}&apikey={self.alpha_vantage_key}'
        await log_service.fetch(f"Fetching earnings data from Alpha Vantage: {symbol}")

        async with self.api_semaphore:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, timeout=15) as response:
                        response_status = response.status
                        response_text = await response.text()

                        if response_status != 200:
                            await log_service.error(f"Alpha Vantage error: {response_status}")
                            return []

                        try:
                            data = await asyncio.to_thread(json.loads, response_text)

                            if "Error Message" in data:
                                await log_service.error(f"Alpha Vantage error: {data.get('Error Message')}")
                                return []

                            if "Note" in data and "API call frequency" in data["Note"]:
                                await log_service.warning(f"Alpha Vantage rate limit: {data.get('Note')}")

                            quarterly_earnings = data.get('quarterlyEarnings', [])
                            if not quarterly_earnings:
                                await log_service.warning(f"No quarterly earnings data found for {symbol}")
                                return []

                            await log_service.success(
                                f"Retrieved {len(quarterly_earnings)} quarterly earnings records for {symbol}")

                            events = []
                            for earnings in quarterly_earnings:
                                reported_date = earnings.get('reportedDate')
                                fiscal_date = earnings.get('fiscalDateEnding')

                                quarter = 1
                                year = int(fiscal_date.split('-')[0]) if fiscal_date else 0
                                month = int(fiscal_date.split('-')[1]) if fiscal_date else 0

                                if month >= 1 and month <= 3:
                                    quarter = 1
                                elif month >= 4 and month <= 6:
                                    quarter = 2
                                elif month >= 7 and month <= 9:
                                    quarter = 3
                                elif month >= 10 and month <= 12:
                                    quarter = 4

                                reported_eps = earnings.get('reportedEPS')
                                estimated_eps = earnings.get('estimatedEPS')

                                if reported_eps == 'None' or reported_eps is None:
                                    reported_eps = 0
                                else:
                                    try:
                                        reported_eps = float(reported_eps)
                                    except (ValueError, TypeError):
                                        reported_eps = 0

                                if estimated_eps == 'None' or estimated_eps is None:
                                    estimated_eps = 0
                                else:
                                    try:
                                        estimated_eps = float(estimated_eps)
                                    except (ValueError, TypeError):
                                        estimated_eps = 0

                                event_data = {
                                    'Symbol': symbol,
                                    'Date': reported_date,
                                    'EPS Actual': reported_eps,
                                    'EPS Estimate': estimated_eps,
                                    'Hour': 'amc',
                                    'Quarter': quarter,
                                    'Revenue Actual': None,
                                    'Revenue Estimate': None,
                                    'Year': year
                                }
                                events.append(event_data)

                            return events
                        except json.JSONDecodeError as e:
                            await log_service.error(f"Invalid JSON from Alpha Vantage for {symbol}: {str(e)}")
                            return []
            except Exception as e:
                await log_service.error(f"Exception in Alpha Vantage API call for {symbol}: {str(e)}")
                raise

    @async_retry_decorator(
        max_retries=3,
        retry_delay=1.0,
        backoff_factor=2.0,
        retry_exceptions=(Exception,)
    )
    async def _fetch_finnhub_earnings(self, symbol):
        if not self.finnhub_api_key:
            return []

        now = time_service.now(pytz.UTC)
        start_date = now.strftime('%Y-%m-%d')
        end_date = (now + timedelta(days=90)).strftime('%Y-%m-%d')

        url = f'https://finnhub.io/api/v1/calendar/earnings?symbol={symbol}&from={start_date}&to={end_date}&token={self.finnhub_api_key}'
        await log_service.fetch(f"Fetching upcoming earnings from Finnhub: {symbol}")

        async with self.api_semaphore:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url) as response:
                        if response.status != 200:
                            return []

                        data = await response.json()
                        events_data = data.get('earningsCalendar', [])

                        if not events_data:
                            return []

                        filtered_events = []
                        for event in events_data:
                            event_data = {
                                'Symbol': event.get('symbol'),
                                'Date': event.get('date'),
                                'EPS Actual': event.get('epsActual'),
                                'EPS Estimate': event.get('epsEstimate'),
                                'Hour': event.get('hour'),
                                'Quarter': event.get('quarter'),
                                'Revenue Actual': event.get('revenueActual'),
                                'Revenue Estimate': event.get('revenueEstimate'),
                                'Year': event.get('year')
                            }
                            filtered_events.append(event_data)

                        return filtered_events
            except Exception as e:
                await log_service.error(f"Exception in Finnhub earnings fetch: {str(e)}")
                return []

    async def get_next_earnings_event(self, symbol):
        events = await self.get_earnings_data(symbol)
        if not events:
            await log_service.warning(f"No earnings events found for {symbol}")
            return None, None

        now = time_service.now(pytz.UTC)
        now_date = now.date()
        current_time = now.time()
        future_events = []

        for event in events:
            try:
                event_date_str = event.get('Date', '')
                if not event_date_str:
                    continue

                naive_date = datetime.fromisoformat(event_date_str)
                utc_date = datetime(
                    year=naive_date.year,
                    month=naive_date.month,
                    day=naive_date.day,
                    tzinfo=pytz.UTC
                )
                event_date = utc_date.date()

                if event_date >= now_date:
                    days_until = (event_date - now_date).days

                    if days_until == 0:
                        report_time = event.get('Hour', '').lower()

                        if (report_time == 'amc' and current_time.hour < 16) or \
                                (report_time == 'bmo' and (current_time.hour < 9 or (
                                        current_time.hour == 9 and current_time.minute < 30))):
                            future_events.append((event, days_until))
                    else:
                        future_events.append((event, days_until))
            except (ValueError, TypeError) as e:
                await log_service.error(f"Error parsing date '{event_date_str}' for {symbol}: {str(e)}")
                continue

        if not future_events:
            await log_service.info(f"No future earnings events found for {symbol}")
            return None, None

        future_events.sort(key=lambda x: x[1])
        next_event, days = future_events[0]
        await log_service.info(f"Next earnings for {symbol} in {days} days: {next_event.get('Date')}")
        return next_event, days

    async def prepare_earnings_analysis(self, symbol):
        try:
            await log_service.info(f"Preparing earnings analysis for {symbol}")
            raw_earnings = await self.get_earnings_data(symbol)

            await log_service.info(f"Retrieved {len(raw_earnings) if raw_earnings else 0} earnings events for {symbol}")
            if raw_earnings:
                for idx, event in enumerate(raw_earnings[:3]):
                    await log_service.info(
                        f"Event {idx + 1}: Date={event.get('Date')}, EPS Est={event.get('EPS Estimate')}, Actual={event.get('EPS Actual')}")

            upcoming_event, days_until = await self.get_next_earnings_event(symbol)

            if not raw_earnings:
                await log_service.warning(f"No earnings data available for {symbol}")
                return {
                    "hasEarningsData": False,
                    "upcomingEarnings": None,
                    "daysUntil": None,
                    "historicalEarnings": [],
                    "pattern": None,
                    "consistency": None,
                    "expectedVolatility": "UNKNOWN",
                    "earningsRisk": "UNKNOWN"
                }

            historical_earnings = sorted(
                [e for e in raw_earnings if e.get('Date') and e.get('EPS Actual') is not None],
                key=lambda x: x.get('Date', ''),
                reverse=True
            )

            await log_service.info(f"Found {len(historical_earnings)} valid historical earnings events for {symbol}")

            surprise_metrics = []
            for event in historical_earnings:
                if event.get('EPS Estimate') is not None and event.get('EPS Actual') is not None:
                    estimate = event.get('EPS Estimate')
                    actual = event.get('EPS Actual')

                    if abs(estimate) < 0.001:
                        surprise_pct = 0 if abs(actual) < 0.001 else 100 if actual > 0 else -100
                    else:
                        surprise_pct = ((actual - estimate) / abs(estimate)) * 100

                    direction = "beat" if actual > estimate else "miss" if actual < estimate else "match"

                    surprise_metrics.append({
                        "date": event.get('Date'),
                        "quarter": f"Q{event.get('Quarter')} {event.get('Year')}",
                        "epsEstimate": event.get('EPS Estimate'),
                        "epsActual": event.get('EPS Actual'),
                        "surprisePct": round(surprise_pct, 2),
                        "direction": direction
                    })

            if len(surprise_metrics) >= 3:
                directions = [m.get('direction') for m in surprise_metrics[:4]]
                beats = directions.count('beat')
                misses = directions.count('miss')
                matches = directions.count('match')

                await log_service.info(
                    f"Earnings pattern for {symbol}: {beats} beats, {misses} misses, {matches} matches")

                if beats >= 3:
                    pattern = "CONSISTENT_BEATS"
                    consistency = "HIGH" if beats == 4 else "MEDIUM"
                elif misses >= 3:
                    pattern = "CONSISTENT_MISSES"
                    consistency = "HIGH" if misses == 4 else "MEDIUM"
                elif beats == 2 and misses == 2:
                    pattern = "ALTERNATING"
                    consistency = "MEDIUM"
                else:
                    pattern = "MIXED"
                    consistency = "LOW"
            else:
                await log_service.info(f"Insufficient earnings history for {symbol} to determine pattern")
                pattern = "INSUFFICIENT_DATA"
                consistency = "LOW"

            volatility_estimate = "MEDIUM"
            if pattern == "CONSISTENT_BEATS":
                volatility_estimate = "LOW" if consistency == "HIGH" else "MEDIUM"
            elif pattern in ["CONSISTENT_MISSES", "MIXED"]:
                volatility_estimate = "HIGH"
            elif pattern == "ALTERNATING":
                volatility_estimate = "MEDIUM"

            earnings_risk = "LOW"
            if days_until is not None:
                if days_until == 0:
                    earnings_risk = "EXTREME"
                elif days_until <= 3:
                    earnings_risk = "EXTREME"
                elif days_until <= 7:
                    earnings_risk = "HIGH"
                elif days_until <= 14:
                    earnings_risk = "MEDIUM"

            if pattern == "CONSISTENT_BEATS" and earnings_risk != "EXTREME":
                risk_levels = ["LOW", "MEDIUM", "HIGH", "EXTREME"]
                current_risk_index = risk_levels.index(earnings_risk)
                if current_risk_index > 0:
                    earnings_risk = risk_levels[current_risk_index - 1]
            elif pattern == "CONSISTENT_MISSES":
                risk_levels = ["LOW", "MEDIUM", "HIGH", "EXTREME"]
                current_risk_index = risk_levels.index(earnings_risk)
                if current_risk_index < len(risk_levels) - 1:
                    earnings_risk = risk_levels[current_risk_index + 1]

            upcoming_formatted = None
            if upcoming_event:
                report_time = upcoming_event.get('Hour', 'Unknown')
                time_map = {
                    'bmo': 'Before Market Open',
                    'amc': 'After Market Close',
                    'dmh': 'During Market Hours'
                }
                formatted_time = time_map.get(report_time, report_time)

                upcoming_formatted = {
                    "date": upcoming_event.get('Date'),
                    "quarter": f"Q{upcoming_event.get('Quarter')} {upcoming_event.get('Year')}",
                    "epsEstimate": upcoming_event.get('EPS Estimate'),
                    "revenueEstimate": upcoming_event.get('Revenue Estimate'),
                    "reportTime": formatted_time
                }

            analysis = {
                "hasEarningsData": True,
                "upcomingEarnings": upcoming_formatted,
                "daysUntil": days_until,
                "historicalEarnings": surprise_metrics[:4] if surprise_metrics else [],
                "pattern": pattern,
                "consistency": consistency,
                "expectedVolatility": volatility_estimate,
                "earningsRisk": earnings_risk
            }

            await log_service.success(f"Completed earnings analysis for {symbol}")
            return analysis

        except Exception as e:
            await log_service.error(f"Error in prepare_earnings_analysis for {symbol}: {str(e)}")
            await log_service.error(traceback.format_exc())

            return {
                "hasEarningsData": False,
                "upcomingEarnings": None,
                "daysUntil": None,
                "historicalEarnings": [],
                "pattern": None,
                "consistency": None,
                "expectedVolatility": None,
                "earningsRisk": None
            }