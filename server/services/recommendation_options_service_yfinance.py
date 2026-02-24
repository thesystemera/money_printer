import yfinance as yf
import pandas as pd
from services import log_service
import asyncio
from typing import Dict, Any, Tuple, Optional
import datetime
import re


class YFinanceEnrichmentService:
    def __init__(self, cache_service=None, max_iv: float = 10.0):
        self.cache_service = cache_service
        self.max_iv = max_iv

    async def _get_ticker_object(self, ticker_symbol: str) -> Optional[yf.Ticker]:
        try:
            loop = asyncio.get_running_loop()
            ticker = await loop.run_in_executor(
                None,
                lambda: yf.Ticker(ticker_symbol)
            )

            if not ticker.info or 'symbol' not in ticker.info:
                return None

            return ticker
        except Exception as e:
            await log_service.options(f"[YFinance] Error getting ticker object for {ticker_symbol}: {str(e)}")
            return None

    async def _fetch_all_contracts(self, ticker: yf.Ticker) -> Tuple[Optional[pd.DataFrame], Optional[pd.DataFrame]]:
        try:
            loop = asyncio.get_running_loop()
            expirations = await loop.run_in_executor(None, getattr, ticker, 'options')
            if not expirations:
                return (None, None)

            await log_service.options(
                f"[YFinance] API returned {len(expirations)} expiration dates: {expirations[:10]}")

            tasks = []
            for expiry in expirations:
                task = loop.run_in_executor(None, lambda exp=expiry: ticker.option_chain(exp))
                tasks.append(task)

            results = await asyncio.gather(*tasks, return_exceptions=True)

            all_calls = pd.DataFrame()
            all_puts = pd.DataFrame()

            for i, opts in enumerate(results):
                if isinstance(opts, Exception):
                    continue

                if hasattr(opts, 'calls') and not opts.calls.empty:
                    all_calls = pd.concat([all_calls, opts.calls], ignore_index=True)
                if hasattr(opts, 'puts') and not opts.puts.empty:
                    all_puts = pd.concat([all_puts, opts.puts], ignore_index=True)

            return (all_calls, all_puts)
        except Exception as e:
            await log_service.options(f"[YFinance] Error fetching contracts: {str(e)}")
            return (None, None)

    def _extract_polygon_components(self, ticker: str) -> Optional[dict]:
        clean = ticker[2:] if ticker.startswith('O:') else ticker

        for i in range(len(clean) - 1, -1, -1):
            if clean[i] in ['C', 'P']:
                if i >= 6 and clean[i - 6:i].isdigit() and len(clean) > i + 8:
                    symbol = clean[:i - 6]
                    date = clean[i - 6:i]
                    option_type = clean[i]
                    strike_str = clean[i + 1:i + 9] if len(clean) >= i + 9 else clean[i + 1:]

                    if strike_str.isdigit() and len(strike_str) == 8:
                        strike = float(strike_str) / 1000
                        return {
                            'symbol': symbol,
                            'date': date,
                            'type': option_type,
                            'strike': strike,
                            'expiry': f"20{date[:2]}-{date[2:4]}-{date[4:6]}"
                        }
        return None

    def _create_enhanced_lookup(self, yfinance_data: dict) -> dict:
        lookup = {}

        for symbol, data in yfinance_data.items():
            lookup[symbol] = data

            strike = data.get('strike', 0)
            if strike <= 0:
                continue

            try:
                match = re.search(r'([A-Z]+)(\d{6})([CP])', symbol)
                if match:
                    base, date, opt_type = match.groups()

                    strike_formatted = int(strike * 1000)
                    lookup[f"{base}{date}{opt_type}{strike_formatted:08d}"] = data

                    strike_int = int(strike)
                    if strike_int == strike:
                        lookup[f"{base}{date}{opt_type}{strike_int}"] = data

                    if '.' not in symbol:
                        lookup[f"{symbol}.0"] = data
            except Exception as e:
                pass

        return lookup

    async def get_enrichment_data(self, ticker_symbol: str, force_refresh: bool = False) -> Dict[str, Any]:
        if self.cache_service and not force_refresh:
            cache_key = f"yfinance_enrichment_{ticker_symbol}"
            cached_data = await self.cache_service.get_cached_options_data(ticker_symbol, cache_key)
            if cached_data:
                today = datetime.datetime.now()
                today_ymd = int(today.strftime('%y%m%d'))

                expired_count = 0
                for key in cached_data.keys():
                    match = re.search(r'(\d{6})', key)
                    if match:
                        date_int = int(match.group(1))
                        if date_int < today_ymd:
                            expired_count += 1

                if expired_count > 0:
                    await log_service.options(
                        f"[YFinance] CACHE HAS {expired_count} EXPIRED CONTRACTS! Forcing refresh...")
                else:
                    await log_service.options(f"[YFinance] Cache hit with {len(cached_data)} contracts")
                    return cached_data

        await log_service.options(f"[YFinance] FETCHING FRESH FROM API for {ticker_symbol}")
        ticker_obj = await self._get_ticker_object(ticker_symbol)
        if not ticker_obj:
            return {}

        calls_df, puts_df = await self._fetch_all_contracts(ticker_obj)
        if (calls_df is None or calls_df.empty) and (puts_df is None or puts_df.empty):
            await log_service.options(f"[YFinance] API returned EMPTY data")
            return {}

        yfinance_lookup = {}
        expired_in_fresh = 0
        today = datetime.datetime.now()
        today_ymd = int(today.strftime('%y%m%d'))

        if calls_df is not None:
            for _, row in calls_df.iterrows():
                symbol = row['contractSymbol']
                match = re.search(r'(\d{6})', symbol)
                if match:
                    date_int = int(match.group(1))
                    if date_int < today_ymd:
                        expired_in_fresh += 1
                yfinance_lookup[symbol] = row.to_dict()

        if puts_df is not None:
            for _, row in puts_df.iterrows():
                symbol = row['contractSymbol']
                match = re.search(r'(\d{6})', symbol)
                if match:
                    date_int = int(match.group(1))
                    if date_int < today_ymd:
                        expired_in_fresh += 1
                yfinance_lookup[symbol] = row.to_dict()

        if expired_in_fresh > 0:
            await log_service.options(
                f"[YFinance] WARNING: API returned {expired_in_fresh} EXPIRED contracts! YFinance is broken!")

        await log_service.options(f"[YFinance] Fresh fetch got {len(yfinance_lookup)} contracts")

        if self.cache_service and yfinance_lookup:
            cache_key = f"yfinance_enrichment_{ticker_symbol}"
            await self.cache_service.cache_options_data(
                ticker_symbol,
                cache_key,
                yfinance_lookup,
                expiry_seconds=300
            )

        return yfinance_lookup

    def merge_data(self, primary_data: list, enrichment_lookup: dict) -> list:
        if not enrichment_lookup:
            asyncio.create_task(log_service.options("[YFinance] No enrichment data to merge"))
            return primary_data

        enhanced_lookup = self._create_enhanced_lookup(enrichment_lookup)

        polygon_dates = set()
        yfinance_dates = set()

        for contract in primary_data:
            ticker = contract.get("details", {}).get("ticker", "")
            if ticker:
                match = re.search(r'(\d{6})', ticker)
                if match:
                    polygon_dates.add(match.group(1))

        for key in enrichment_lookup.keys():
            match = re.search(r'(\d{6})', key)
            if match:
                yfinance_dates.add(match.group(1))

        polygon_sorted = sorted(polygon_dates) if polygon_dates else []
        yfinance_sorted = sorted(yfinance_dates) if yfinance_dates else []

        today = datetime.datetime.now()
        today_str = today.strftime('%y%m%d')

        asyncio.create_task(log_service.options(
            f"[YFinance] TODAY: {today_str} | Polygon dates: {polygon_sorted[0] if polygon_sorted else 'none'} to {polygon_sorted[-1] if polygon_sorted else 'none'} ({len(polygon_dates)} unique) | YFinance dates: {yfinance_sorted[0] if yfinance_sorted else 'none'} to {yfinance_sorted[-1] if yfinance_sorted else 'none'} ({len(yfinance_dates)} unique)"
        ))

        overlapping = polygon_dates & yfinance_dates
        polygon_only = polygon_dates - yfinance_dates
        yfinance_only = yfinance_dates - polygon_dates

        asyncio.create_task(log_service.options(
            f"[YFinance] Date overlap: {len(overlapping)} dates | Polygon-only: {len(polygon_only)} dates | YFinance-only: {len(yfinance_only)} dates"
        ))

        if polygon_only:
            asyncio.create_task(log_service.options(
                f"[YFinance] Sample Polygon-only dates (missing from YFinance): {sorted(polygon_only)[:10]}"
            ))

        enriched_count = 0
        failed_reasons = {"no_match": 0, "no_components": 0, "bad_spread": 0}
        total = len(primary_data)

        for i, contract in enumerate(primary_data):
            contract_ticker = contract.get("details", {}).get("ticker")
            if not contract_ticker:
                continue

            lookup_key = contract_ticker[2:] if contract_ticker.startswith('O:') else contract_ticker
            yf_match = enhanced_lookup.get(lookup_key)

            if not yf_match:
                components = self._extract_polygon_components(contract_ticker)
                if not components:
                    failed_reasons["no_components"] += 1
                    continue

                for yf_key, yf_data in enrichment_lookup.items():
                    yf_strike = yf_data.get('strike', 0)
                    if (abs(yf_strike - components['strike']) < 0.01 and
                            components['type'] in yf_key and
                            components['date'] in yf_key):
                        yf_match = yf_data
                        break

                if not yf_match:
                    failed_reasons["no_match"] += 1

            if yf_match:
                bid = yf_match.get('bid', 0)
                ask = yf_match.get('ask', 0)

                if bid > 0 and ask > 0:
                    spread_ratio = (ask - bid) / ask if ask > 0 else 1
                    if spread_ratio < 0.7:
                        contract["last_quote"]["bid"] = bid
                        contract["last_quote"]["ask"] = ask
                    else:
                        failed_reasons["bad_spread"] += 1

                volume = contract.get("day", {}).get("volume", 0)
                last_price = yf_match.get('lastPrice', 0)

                if not last_price or last_price <= 0:
                    if bid > 0 and ask > 0:
                        last_price = (bid + ask) / 2

                if volume > 0 and last_price > 0:
                    contract["premium"] = last_price * volume * 100
                else:
                    contract["premium"] = 0

                enriched_count += 1

        match_rate = (enriched_count / total * 100) if total > 0 else 0

        asyncio.create_task(log_service.options(
            f"[YFinance] Match rate: {match_rate:.1f}% ({enriched_count}/{total}) | No components: {failed_reasons['no_components']} | No match: {failed_reasons['no_match']} | Bad spread: {failed_reasons['bad_spread']}"
        ))

        return primary_data