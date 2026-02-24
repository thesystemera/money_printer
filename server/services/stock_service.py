import asyncio
import aiofiles
import pytz
import pandas as pd
from datetime import datetime, timedelta, time
from alpaca.data.timeframe import TimeFrame
from alpaca.data.requests import StockBarsRequest
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import GetCalendarRequest
from services import log_service, time_service
from services.api_utils import async_retry_decorator
from collections import defaultdict, Counter


class StockService:
    MARKET_INDEX_PROXIES = {'sp500': 'SPY', 'nasdaq': 'QQQ', 'dow': 'DIA', 'russell2000': 'IWM'}
    ALPACA_SUBSCRIPTION = False

    def __init__(self, config_service=None, cache_service=None):
        self.config = config_service
        self.cache = cache_service
        self.client = None
        self.trading_client = None
        self.api_semaphore = asyncio.Semaphore(5)

    async def initialize(self):
        alpaca_api_key = self.config.get_key('alpaca_api_key')
        alpaca_api_secret = self.config.get_key('alpaca_api_secret')

        if not alpaca_api_key or not alpaca_api_secret:
            try:
                async with aiofiles.open('keys/alpaca_keys.txt', 'r') as file:
                    lines = await file.readlines()
                    alpaca_api_key = lines[0].strip()
                    alpaca_api_secret = lines[1].strip()
            except:
                await log_service.error("Alpaca API keys not found")

        if alpaca_api_key and alpaca_api_secret:
            self.client = StockHistoricalDataClient(alpaca_api_key, alpaca_api_secret)
            self.trading_client = TradingClient(alpaca_api_key, alpaca_api_secret, paper=False)
            subscription_status = "PAID" if self.ALPACA_SUBSCRIPTION else "FREE"
            await log_service.system(f"StockService initialized - Alpaca API clients ready ({subscription_status})")
        else:
            await log_service.error("StockService initialization failed - no Alpaca API keys found")

    def _parse_timestamp(self, timestamp_str):
        if isinstance(timestamp_str, datetime):
            return timestamp_str
        return datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))

    def _determine_market_session(self, timestamp):
        dt = self._parse_timestamp(timestamp) if isinstance(timestamp, str) else timestamp
        eastern = pytz.timezone('US/Eastern')
        dt_eastern = dt.astimezone(eastern)

        hour, minute, weekday = dt_eastern.hour, dt_eastern.minute, dt_eastern.weekday()

        if weekday >= 5:
            return 'closed'
        elif (hour == 9 and minute >= 30) or (9 < hour < 16):
            return 'regular'
        elif (4 <= hour < 9) or (hour == 9 and minute < 30):
            return 'pre-market'
        elif 16 <= hour < 20:
            return 'after-hours'
        else:
            return 'closed'

    def _process_bars(self, bars_response, symbol):
        if bars_response is None or bars_response.df.empty:
            return []

        processed_data = []
        bars_df = bars_response.df.reset_index()

        for _, row in bars_df.iterrows():
            if row['symbol'] == symbol:
                data_point = {
                    'timestamp': row['timestamp'].isoformat(),
                    'price': float(row['close']),
                    'open': float(row['open']),
                    'high': float(row['high']),
                    'low': float(row['low']),
                    'volume': int(row['volume']),
                    'marketSession': self._determine_market_session(row['timestamp'])
                }
                processed_data.append(data_point)

        return sorted(processed_data, key=lambda x: self._parse_timestamp(x['timestamp']))

    def _merge_data(self, existing_data, new_data):
        merged_dict = {item['timestamp']: item for item in existing_data}
        for item in new_data:
            merged_dict[item['timestamp']] = item

        merged_list = list(merged_dict.values())
        merged_list.sort(key=lambda x: self._parse_timestamp(x['timestamp']))
        return merged_list

    def _classify_day_quality(self, day_bars, day_date=None, resolution='minute'):
        bar_count = len(day_bars)

        if resolution == 'day':
            if bar_count >= 1:
                return {'tier': 'COMPLETE', 'issue': 'None', 'bar_count': bar_count, 'coverage_pct': 100.0}
            else:
                return {'tier': 'MISSING', 'issue': 'No data', 'bar_count': bar_count, 'coverage_pct': 0.0}

        now = time_service.now(pytz.UTC)
        eastern = pytz.timezone('US/Eastern')
        now_et = now.astimezone(eastern)

        if day_date and day_date == now_et.date():
            current_time_et = now_et.time()

            if current_time_et < time(9, 30):
                expected_bars = max(60, (current_time_et.hour - 4) * 60 + current_time_et.minute)
            elif current_time_et < time(16, 0):
                pre_market_bars = 330
                regular_minutes = (current_time_et.hour - 9) * 60 + current_time_et.minute - 30
                expected_bars = pre_market_bars + regular_minutes
            else:
                expected_bars = 720

            coverage_pct = (bar_count / expected_bars * 100) if expected_bars > 0 else 0
            if coverage_pct >= 50:
                return {'tier': 'INTRADAY', 'issue': 'In Progress', 'bar_count': bar_count,
                        'coverage_pct': coverage_pct}

        regular_hours_expected = 390
        extended_hours_expected = 960

        first_bar_time_et = self._parse_timestamp(day_bars[0]['timestamp']).astimezone(eastern).time()
        last_bar_time_et = self._parse_timestamp(day_bars[-1]['timestamp']).astimezone(eastern).time()

        has_extended_hours = first_bar_time_et < time(9, 30) or last_bar_time_et > time(16, 5)

        if has_extended_hours:
            coverage_pct = (bar_count / extended_hours_expected * 100)
            if coverage_pct >= 85:
                return {'tier': 'EXTENDED_COMPLETE', 'issue': 'None', 'bar_count': bar_count,
                        'coverage_pct': coverage_pct}
            elif coverage_pct >= 50:
                return {'tier': 'EXTENDED_PARTIAL', 'issue': f'Extended coverage {coverage_pct:.1f}%',
                        'bar_count': bar_count, 'coverage_pct': coverage_pct}
            else:
                return {'tier': 'BROKEN', 'issue': f'Sparse extended data {coverage_pct:.1f}%', 'bar_count': bar_count,
                        'coverage_pct': coverage_pct}
        else:
            coverage_pct = (bar_count / regular_hours_expected * 100)
            if coverage_pct >= 85:
                return {'tier': 'REGULAR_ONLY', 'issue': 'Missing extended hours', 'bar_count': bar_count,
                        'coverage_pct': coverage_pct}
            elif coverage_pct >= 50:
                return {'tier': 'REGULAR_PARTIAL', 'issue': f'Regular coverage {coverage_pct:.1f}%',
                        'bar_count': bar_count, 'coverage_pct': coverage_pct}
            else:
                return {'tier': 'BROKEN', 'issue': f'Sparse regular data {coverage_pct:.1f}%', 'bar_count': bar_count,
                        'coverage_pct': coverage_pct}

    def _calculate_fetch_window(self, now, resolution):
        if resolution == 'minute':
            delay_minutes = 0 if self.ALPACA_SUBSCRIPTION else 15
            end_date = now - timedelta(minutes=delay_minutes)
            return end_date
        elif resolution == 'day':
            delay_days = 0 if self.ALPACA_SUBSCRIPTION else 1
            end_date = now - timedelta(days=delay_days)
            return end_date
        else:
            raise ValueError(f"Unsupported resolution: {resolution}")

    def _setup_resolution_params(self, resolution, time_range, now):
        cache_suffix = "paid" if self.ALPACA_SUBSCRIPTION else "free"

        if resolution == 'minute':
            return {
                'timeframe': TimeFrame.Minute,
                'end_date': self._calculate_fetch_window(now, resolution),
                'start_date': now - timedelta(days=time_range),
                'cache_key_pattern': f"stock_prices_{{symbol}}_minute_{cache_suffix}",
                'cache_method': self.cache.cache_stocks,
                'get_method': self.cache.get_cached_stocks,
                'max_lookback_days': 90,
                'resolution_label': "MINUTE"
            }
        elif resolution == 'day':
            return {
                'timeframe': TimeFrame.Day,
                'end_date': self._calculate_fetch_window(now, resolution),
                'start_date': now - timedelta(days=time_range * 365),
                'cache_key_pattern': f"stock_prices_{{symbol}}_daily_{cache_suffix}",
                'cache_method': self.cache.cache_stocks_historical,
                'get_method': self.cache.get_cached_stocks_historical,
                'max_lookback_days': 365 * 2,
                'resolution_label': "DAILY"
            }
        else:
            raise ValueError(f"Unsupported resolution: {resolution}")

    async def _load_cached_data(self, cache_key, get_method):
        current_data = await get_method(cache_key) or []
        bars_by_day = defaultdict(list)
        for item in current_data:
            bars_by_day[self._parse_timestamp(item['timestamp']).date()].append(item)
        return current_data, bars_by_day

    def _check_intraday_staleness(self, today_et, requested_trading_days, bars_by_day, resolution, now):
        eastern = pytz.timezone('US/Eastern')
        now_et = now.astimezone(eastern)
        current_time_et = now_et.time()

        needs_intraday_update = False
        last_cached_timestamp_today = None
        staleness_minutes = 0

        if today_et in requested_trading_days and today_et in bars_by_day and resolution == 'minute':
            if time(4, 0) <= current_time_et <= time(20, 0):
                today_bars = bars_by_day[today_et]
                if today_bars:
                    last_cached_timestamp_today = max(self._parse_timestamp(bar['timestamp']) for bar in today_bars)
                    staleness_minutes = (now - last_cached_timestamp_today).total_seconds() / 60
                    if staleness_minutes > 1:
                        needs_intraday_update = True

        return needs_intraday_update, last_cached_timestamp_today, staleness_minutes

    def _build_fetch_ranges(self, missing_days, all_days_in_range, bars_by_day, today_et, needs_intraday_update,
                            resolution):
        if not missing_days:
            return []

        fetch_ranges = []
        range_start = all_days_in_range[0]
        range_end = all_days_in_range[-1]

        complete_days_in_range = set()
        for day in all_days_in_range:
            if day in bars_by_day and day != today_et:
                quality = self._classify_day_quality(bars_by_day[day], day, resolution)
                if quality['tier'] in ['EXTENDED_COMPLETE', 'COMPLETE']:
                    complete_days_in_range.add(day)

        if not complete_days_in_range:
            fetch_ranges.append((range_start, range_end))
        else:
            current_start = None
            for day in all_days_in_range:
                if day not in bars_by_day or (day in bars_by_day and (day == today_et and needs_intraday_update)) or \
                        self._classify_day_quality(bars_by_day[day], day, resolution)['tier'] not in [
                    'EXTENDED_COMPLETE', 'COMPLETE']:
                    if current_start is None:
                        current_start = day
                else:
                    if current_start is not None:
                        fetch_ranges.append((current_start, all_days_in_range[all_days_in_range.index(day) - 1]))
                        current_start = None

            if current_start is not None:
                fetch_ranges.append((current_start, range_end))

        return fetch_ranges

    async def _execute_fetches(self, fetch_ranges, actual_symbol, today_et, needs_intraday_update,
                               last_cached_timestamp_today, end_date, timeframe, resolution):
        eastern = pytz.timezone('US/Eastern')
        tasks = []

        for start_day, end_day in fetch_ranges:
            if start_day == today_et and needs_intraday_update and last_cached_timestamp_today:
                day_start = last_cached_timestamp_today + timedelta(minutes=1)
            else:
                day_start_et = eastern.localize(datetime(start_day.year, start_day.month, start_day.day, 4, 0))
                day_start = day_start_et.astimezone(pytz.UTC)

            if end_day == today_et:
                market_close_et = eastern.localize(datetime(end_day.year, end_day.month, end_day.day, 20, 0))
                market_close_utc = market_close_et.astimezone(pytz.UTC)
                day_end = min(end_date, market_close_utc)
            else:
                day_end_et = eastern.localize(datetime(end_day.year, end_day.month, end_day.day, 20, 0))
                day_end = day_end_et.astimezone(pytz.UTC)

            if day_start >= day_end:
                continue

            tasks.append(self._fetch_data(actual_symbol, day_start, day_end, timeframe, resolution))

        return tasks

    async def _execute_upgrades(self, days_to_upgrade, actual_symbol, today_et, end_date, timeframe, resolution,
                                bars_by_day):
        eastern = pytz.timezone('US/Eastern')
        upgrade_ranges = []
        sorted_upgrade_days = sorted(days_to_upgrade)

        if sorted_upgrade_days:
            current_start = sorted_upgrade_days[0]

            for i in range(1, len(sorted_upgrade_days)):
                has_complete_between = False
                for day in bars_by_day:
                    if current_start < day < sorted_upgrade_days[i]:
                        quality = self._classify_day_quality(bars_by_day[day], day, resolution)
                        if quality['tier'] in ['EXTENDED_COMPLETE', 'INTRADAY', 'COMPLETE']:
                            has_complete_between = True
                            break

                if has_complete_between:
                    upgrade_ranges.append((current_start, sorted_upgrade_days[i - 1]))
                    current_start = sorted_upgrade_days[i]

            upgrade_ranges.append((current_start, sorted_upgrade_days[-1]))

        tasks = []
        for start_day, end_day in upgrade_ranges:
            day_start_et = eastern.localize(datetime(start_day.year, start_day.month, start_day.day, 4, 0))
            day_start = day_start_et.astimezone(pytz.UTC)

            if end_day == today_et:
                market_close_et = eastern.localize(datetime(end_day.year, end_day.month, end_day.day, 20, 0))
                market_close_utc = market_close_et.astimezone(pytz.UTC)
                day_end = min(end_date, market_close_utc)
            else:
                day_end_et = eastern.localize(datetime(end_day.year, end_day.month, end_day.day, 20, 0))
                day_end = day_end_et.astimezone(pytz.UTC)

            if day_start >= day_end:
                continue

            tasks.append(self._fetch_data(actual_symbol, day_start, day_end, timeframe, resolution))

        return tasks

    def _generate_status_report(self, status, resolution_label, log_prefix, initial_bar_count, final_bar_count,
                                final_day_count, requested_day_count, total_cached_days, initial_quality_summary,
                                final_quality_summary, fetched_missing_days_count, upgraded_count, resolution,
                                initial_coverage_summary=None, final_coverage_summary=None):
        log_message = f"{log_prefix} {resolution_label} {status}"

        if status not in ["MISSING"]:
            day_summary = f"{final_day_count} of {requested_day_count} days available"
            log_message += f" | {day_summary}"

        if status in ["UPDATED", "UPGRADED", "FETCHED", "INTRADAY_UPDATED"]:
            log_message += f" | Bars: {initial_bar_count} -> {final_bar_count}"
        elif status not in ["MISSING"]:
            log_message += f" | {final_bar_count} total bars (cache pool: {total_cached_days} days)"

        if status in ["UPDATED", "UPGRADED", "INTRADAY_UPDATED"] and resolution == 'minute':
            log_message += f" | Quality: {initial_quality_summary} -> {final_quality_summary}"
            if initial_coverage_summary and final_coverage_summary:
                log_message += f" | Coverage: {initial_coverage_summary} -> {final_coverage_summary}"
        elif final_quality_summary and resolution == 'minute':
            log_message += f" | Quality: {final_quality_summary}"
            if final_coverage_summary:
                log_message += f" | Coverage: {final_coverage_summary}"

        if status == "CACHE_OK":
            log_message += " (Cache current)"

        if fetched_missing_days_count > 0:
            log_message += f" | Fetched {fetched_missing_days_count} new days"

        if upgraded_count > 0:
            log_message += f" | Upgraded {upgraded_count} days"

        return log_message

    @async_retry_decorator(max_retries=3, retry_delay=1.0, backoff_factor=2.0)
    async def _fetch_data(self, symbol, start_date, end_date, timeframe, resolution):
        if not self.client:
            await log_service.error(f"No client available to fetch data for {symbol}")
            return None

        feeds_to_try = ['sip', 'iex'] if not self.ALPACA_SUBSCRIPTION else ['sip']
        sip_result = None

        for feed in feeds_to_try:
            try:
                request_params = StockBarsRequest(
                    symbol_or_symbols=[symbol],
                    timeframe=timeframe,
                    start=start_date,
                    end=end_date,
                    feed=feed
                )
                async with self.api_semaphore:
                    bars_response = await asyncio.to_thread(self.client.get_stock_bars, request_params)

                if bars_response and not bars_response.df.empty:
                    processed_bars = self._process_bars(bars_response, symbol)
                    if processed_bars:
                        if feed == 'sip':
                            quality = self._classify_day_quality(processed_bars, start_date.date(), resolution)
                            if quality['tier'] in ['EXTENDED_COMPLETE', 'EXTENDED_PARTIAL', 'REGULAR_ONLY', 'COMPLETE',
                                                   'INTRADAY']:
                                return processed_bars
                            sip_result = processed_bars
                            await log_service.market(
                                f"SIP returned {quality['tier']} ({quality['coverage_pct']:.1f}% coverage) for {symbol}, trying IEX")
                        else:
                            return processed_bars if not sip_result else (
                                processed_bars if len(processed_bars) > len(sip_result) else sip_result)

            except Exception as e:
                await log_service.error(f"Error fetching {feed.upper()} data for {symbol}: {str(e).strip()}")

        if sip_result:
            return sip_result

        await log_service.warning(f"No data returned for {symbol} from any feed")
        return None

    async def _filter_and_annotate(self, data, start_date=None, end_date=None):
        if not data:
            return []

        all_data = {item['timestamp']: item for item in data}
        merged_data = sorted(list(all_data.values()), key=lambda x: self._parse_timestamp(x['timestamp']))

        for item in merged_data:
            if 'marketSession' not in item:
                item['marketSession'] = self._determine_market_session(item['timestamp'])

        if start_date and end_date:
            filtered_data = []
            start_date_aware = start_date.astimezone(pytz.UTC) if start_date.tzinfo is None else start_date
            end_date_aware = end_date.astimezone(pytz.UTC) if end_date.tzinfo is None else end_date

            for item in merged_data:
                try:
                    ts = self._parse_timestamp(item['timestamp'])
                    if start_date_aware <= ts <= end_date_aware:
                        filtered_data.append(item)
                except Exception as e:
                    await log_service.warning(f"Error filtering stock data item: {str(e)}")
            merged_data = filtered_data

        if merged_data and len(merged_data) > 1:
            opening_price = merged_data[0]['price']
            closing_price = merged_data[-1]['price']
            price_change = closing_price - opening_price
            price_change_pct = (price_change / opening_price) * 100 if opening_price > 0 else 0
            high_price = max(item['high'] for item in merged_data)
            low_price = min(item['low'] for item in merged_data)

            merged_data[0]['metrics'] = {
                'opening_price': opening_price,
                'closing_price': closing_price,
                'price_change': price_change,
                'price_change_pct': price_change_pct,
                'high_price': high_price,
                'low_price': low_price,
                'total_bars': len(merged_data)
            }
        return merged_data

    async def get_trading_calendar(self, start_date, end_date):
        cache_key = "trading_calendar_master"
        cached = await self.cache.get(cache_key) or []

        existing_df = pd.DataFrame(cached) if cached else pd.DataFrame(columns=['date', 'open', 'close'])
        if not existing_df.empty:
            existing_df['date'] = pd.to_datetime(existing_df['date']).dt.date

        existing_dates = set(existing_df['date']) if not existing_df.empty else set()

        if existing_dates:
            min_date, max_date = min(existing_dates), max(existing_dates)
            if min_date <= start_date.date() <= end_date.date() <= max_date:
                return existing_df[(existing_df['date'] >= start_date.date()) &
                                   (existing_df['date'] <= end_date.date())].copy()

        if not self.trading_client:
            await log_service.error("[Calendar] Trading client not available")
            return existing_df

        fetch_ranges = []
        if not existing_dates:
            fetch_ranges = [(start_date, end_date)]
        else:
            if start_date.date() < min(existing_dates):
                fetch_ranges.append((start_date, datetime.combine(min(existing_dates) - timedelta(days=1),
                                                                  datetime.min.time()).replace(
                    tzinfo=start_date.tzinfo)))
            if end_date.date() > max(existing_dates):
                fetch_ranges.append((datetime.combine(max(existing_dates) + timedelta(days=1),
                                                      datetime.min.time()).replace(tzinfo=end_date.tzinfo), end_date))

        new_frames = []
        for fetch_start, fetch_end in fetch_ranges:
            try:
                async with self.api_semaphore:
                    calendar_list = await asyncio.to_thread(
                        self.trading_client.get_calendar,
                        GetCalendarRequest(start=fetch_start.strftime('%Y-%m-%d'),
                                           end=fetch_end.strftime('%Y-%m-%d'))
                    )
                if calendar_list:
                    df = pd.DataFrame([dict(item) for item in calendar_list])
                    df['date'] = pd.to_datetime(df['date']).dt.date
                    new_frames.append(df)
            except Exception as e:
                await log_service.error(f"[Calendar] Fetch failed: {str(e)}")

        if new_frames:
            all_frames = [existing_df] if not existing_df.empty else []
            all_frames.extend(new_frames)
            combined_df = pd.concat(all_frames, ignore_index=True).drop_duplicates(subset=['date']).sort_values('date')
            await self.cache.set(cache_key, combined_df.to_dict('records'), 365 * 24 * 3600)
            return combined_df[(combined_df['date'] >= start_date.date()) &
                               (combined_df['date'] <= end_date.date())].copy()

        return existing_df[(existing_df['date'] >= start_date.date()) &
                           (existing_df['date'] <= end_date.date())].copy() if not existing_df.empty else existing_df

    async def get_market_data(self, symbol, data_type='stock', resolution='minute', time_range=7):
        is_index = data_type == 'market_index'
        actual_symbol = self.MARKET_INDEX_PROXIES.get(symbol.lower()) if is_index else symbol.upper()
        if not actual_symbol:
            await log_service.error(f"Unsupported market index: {symbol}")
            return []

        now = time_service.now(pytz.UTC)
        log_prefix = f"[{actual_symbol}]"

        params = self._setup_resolution_params(resolution, time_range, now)
        cache_key = params['cache_key_pattern'].format(symbol=actual_symbol)

        current_data, bars_by_day = await self._load_cached_data(cache_key, params['get_method'])
        initial_bar_count = len(current_data)

        calendar_df = await self.get_trading_calendar(params['start_date'], params['end_date'])
        if calendar_df is None:
            return []

        requested_trading_days = set(
            d for d in calendar_df['date'] if params['start_date'].date() <= d <= params['end_date'].date())
        requested_day_count = len(requested_trading_days)
        cached_days = set(bars_by_day.keys())
        missing_from_request = requested_trading_days - cached_days

        eastern = pytz.timezone('US/Eastern')
        today_et = now.astimezone(eastern).date()
        needs_intraday_update, last_cached_timestamp_today, staleness_minutes = self._check_intraday_staleness(
            today_et, requested_trading_days, bars_by_day, resolution, now
        )

        if needs_intraday_update:
            missing_from_request.add(today_et)
            await log_service.market(
                f"{log_prefix} Intraday data is {staleness_minutes:.1f} minutes stale, fetching update")

        data_was_modified = False
        fetched_missing_days_count = 0

        if missing_from_request:
            today_utc = now.astimezone(pytz.UTC).date()
            missing_days = sorted([d for d in missing_from_request
                                   if not (d == today_utc and now < datetime.combine(d, time(8, 0), tzinfo=pytz.UTC))])

            if missing_days:
                all_days_in_range = sorted(requested_trading_days)
                fetch_ranges = self._build_fetch_ranges(missing_days, all_days_in_range, bars_by_day,
                                                        today_et, needs_intraday_update, resolution)

                tasks = await self._execute_fetches(fetch_ranges, actual_symbol, today_et, needs_intraday_update,
                                                    last_cached_timestamp_today, params['end_date'],
                                                    params['timeframe'], resolution)

                if tasks:
                    range_start = all_days_in_range[0] if all_days_in_range else None
                    range_end = all_days_in_range[-1] if all_days_in_range else None
                    days_span = (range_end - range_start).days + 1 if range_start and range_end else 0

                    if needs_intraday_update:
                        await log_service.market(
                            f"{log_prefix} Fetching {params['resolution_label']} data: updating intraday + {len(missing_days) - 1} missing days across {days_span}-day span using {len(tasks)} API calls")
                    else:
                        await log_service.market(
                            f"{log_prefix} Fetching {params['resolution_label']} data: {len(missing_days)} missing days across {days_span}-day span using {len(tasks)} API calls")

                    new_data_results = await asyncio.gather(*tasks)
                    flat_new_data = [item for sublist in new_data_results if sublist for item in sublist]

                    if flat_new_data:
                        current_data = self._merge_data(current_data, flat_new_data)
                        data_was_modified = True
                        fetched_missing_days_count = len(
                            {self._parse_timestamp(i['timestamp']).date() for i in flat_new_data})

                        bars_by_day.clear()
                        for item in current_data:
                            bars_by_day[self._parse_timestamp(item['timestamp']).date()].append(item)

        days_with_data_in_request = requested_trading_days & cached_days
        if missing_from_request:
            days_with_data_in_request.update({self._parse_timestamp(item['timestamp']).date()
                                              for item in current_data
                                              if self._parse_timestamp(
                    item['timestamp']).date() in requested_trading_days})

        initial_quality_by_day = {day: self._classify_day_quality(bars, day, resolution)
                                  for day, bars in bars_by_day.items()
                                  if day in days_with_data_in_request}
        initial_tier_counts = Counter(q['tier'] for q in initial_quality_by_day.values())
        initial_quality_summary = ", ".join([f"{tier}: {count}" for tier, count in sorted(initial_tier_counts.items())])

        initial_coverage_avg = sum(q['coverage_pct'] for q in initial_quality_by_day.values()) / len(
            initial_quality_by_day) if initial_quality_by_day else 0
        initial_coverage_summary = f"Avg {initial_coverage_avg:.1f}%"

        upgraded_count = 0
        upgrade_attempted = False
        days_to_upgrade = {day for day, quality in initial_quality_by_day.items()
                           if quality['tier'] not in ['EXTENDED_COMPLETE', 'INTRADAY', 'COMPLETE']
                           and day in requested_trading_days}

        if days_to_upgrade and resolution == 'minute':
            upgrade_attempted = True
            upgrade_tasks = await self._execute_upgrades(days_to_upgrade, actual_symbol, today_et,
                                                         params['end_date'], params['timeframe'],
                                                         resolution, bars_by_day)

            if upgrade_tasks:
                upgrade_results = await asyncio.gather(*upgrade_tasks)
                newly_fetched_bars_by_day = defaultdict(list)

                for day_data in upgrade_results:
                    if day_data:
                        for bar in day_data:
                            day = self._parse_timestamp(bar['timestamp']).date()
                            newly_fetched_bars_by_day[day].append(bar)

                if newly_fetched_bars_by_day:
                    tier_ranking = {'BROKEN': 0, 'REGULAR_PARTIAL': 1, 'REGULAR_ONLY': 2,
                                    'EXTENDED_PARTIAL': 3, 'EXTENDED_COMPLETE': 4,
                                    'INTRADAY': 5, 'COMPLETE': 4, 'MISSING': 0}
                    final_bars_by_day = bars_by_day.copy()

                    for day, new_bars in newly_fetched_bars_by_day.items():
                        new_quality = self._classify_day_quality(new_bars, day, resolution)
                        old_quality = initial_quality_by_day.get(day)

                        if old_quality and tier_ranking[new_quality['tier']] > tier_ranking[old_quality['tier']]:
                            final_bars_by_day[day] = new_bars
                            upgraded_count += 1
                            data_was_modified = True

                    if upgraded_count > 0:
                        reconstructed_data = []
                        for day in sorted(final_bars_by_day.keys()):
                            reconstructed_data.extend(final_bars_by_day[day])
                        current_data = reconstructed_data

        if resolution == 'minute' and data_was_modified:
            cutoff_date = now.date() - timedelta(days=params['max_lookback_days'])
            current_data = [item for item in current_data
                            if self._parse_timestamp(item['timestamp']).date() >= cutoff_date]

        final_bar_count = len(current_data)
        final_bars_by_day = defaultdict(list)
        for item in current_data:
            final_bars_by_day[self._parse_timestamp(item['timestamp']).date()].append(item)

        final_day_count = len([d for d in final_bars_by_day.keys() if d in requested_trading_days])
        total_cached_days = len(final_bars_by_day)

        final_quality_by_day = {day: self._classify_day_quality(bars, day, resolution)
                                for day, bars in final_bars_by_day.items()
                                if day in requested_trading_days}
        final_tier_counts = Counter(q['tier'] for q in final_quality_by_day.values())
        final_quality_summary = ", ".join([f"{tier}: {count}" for tier, count in sorted(final_tier_counts.items())])

        final_coverage_avg = sum(q['coverage_pct'] for q in final_quality_by_day.values()) / len(
            final_quality_by_day) if final_quality_by_day else 0
        final_coverage_summary = f"Avg {final_coverage_avg:.1f}%"

        if resolution == 'minute':
            all_final_days_are_complete = all(
                tier in ['EXTENDED_COMPLETE', 'INTRADAY'] for tier in final_tier_counts) and final_day_count > 0
        else:
            all_final_days_are_complete = all(tier == 'COMPLETE' for tier in final_tier_counts) and final_day_count > 0

        status = "OK"
        if data_was_modified:
            if needs_intraday_update and fetched_missing_days_count > 0:
                status = "INTRADAY_UPDATED"
            elif fetched_missing_days_count > 0 and upgraded_count > 0:
                status = "UPDATED"
            elif fetched_missing_days_count > 0:
                status = "FETCHED"
            elif upgraded_count > 0:
                status = "UPGRADED"
        elif upgrade_attempted and upgraded_count == 0 and final_day_count > 0:
            status = "CACHE_OK"
        elif final_day_count == 0 and requested_day_count > 0:
            status = "MISSING"

        if status == "OK" and (not all_final_days_are_complete or final_day_count < requested_day_count):
            status = "PARTIAL"

        log_message = self._generate_status_report(
            status, params['resolution_label'], log_prefix, initial_bar_count, final_bar_count,
            final_day_count, requested_day_count, total_cached_days, initial_quality_summary,
            final_quality_summary, fetched_missing_days_count, upgraded_count, resolution,
            initial_coverage_summary, final_coverage_summary
        )

        if data_was_modified:
            log_message += " | Cache updated"
            await params['cache_method'](cache_key, current_data)

        if initial_bar_count > 0 or data_was_modified or status == "MISSING":
            if status in ["CACHE_OK", "OK", "UPGRADED", "FETCHED", "UPDATED", "INTRADAY_UPDATED"]:
                log_level = log_service.market
            else:
                log_level = log_service.warning
            await log_level(log_message)

        strict_result = await self._filter_and_annotate(current_data, params['start_date'], params['end_date'])

        final_result = strict_result
        if not strict_result and current_data:
            await log_service.warning(
                f"{log_prefix} No data for requested range; falling back to most recent cached data.")
            fallback_result = await self._filter_and_annotate(current_data)
            final_result = fallback_result

        if is_index:
            for item in final_result:
                item['index_name'] = symbol.lower()


        return final_result