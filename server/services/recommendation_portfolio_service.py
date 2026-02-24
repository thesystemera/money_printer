import os
import asyncio
import aiofiles
import pytz
from datetime import datetime
from typing import List, Dict, Any, Optional

from services import log_service, time_service

from services.recommendation_service_helper import (
    PredictionDataAdapter,
    process_to_time_resolution,
    compare_predictions_with_actual,
    filter_recommendation_data_minimal,
    parse_portfolio_response
)

from services.recommendation_prompts import (
    get_portfolio_system_prompt,
    create_portfolio_user_prompt
)


class PortfolioService:
    def __init__(self, cache_service=None, stock_service=None, config_service=None, ai_service=None):
        self.config = config_service
        self.ai_service = ai_service
        self.cache = cache_service
        self.stock_service = stock_service
        self.api_semaphore = asyncio.Semaphore(5)
        self.eastern_tz = pytz.timezone('US/Eastern')

    async def initialize(self):
        await log_service.system("PortfolioService initialized")

    async def fetch_recent_recommendations(self) -> List[Dict[str, Any]]:
        try:
            best_recommendations = await self.cache.get_cached_recommendations(
                symbol="ALL",
                filter_mode="portfolio",
                include_images=False
            )

            fresh_count = len([r for r in best_recommendations if r.get('freshness') == 'fresh'])
            recent_count = len([r for r in best_recommendations if r.get('freshness') == 'recent'])
            aged_count = len([r for r in best_recommendations if r.get('freshness') == 'aged'])
            outdated_count = len([r for r in best_recommendations if r.get('freshness') == 'outdated'])

            await log_service.portfolio(
                f"Selected {len(best_recommendations)} best recommendations from cache: {fresh_count} fresh, {recent_count} recent, {aged_count} aged, {outdated_count} outdated")

            return best_recommendations
        except Exception as e:
            await log_service.error(f"Error fetching portfolio recommendations from cache: {str(e)}")
            return []

    async def fetch_actual_price_data_for_recommendations(self, recommendations):
        actual_price_data = {}

        # Build a map of unique symbols to their target dates
        symbol_to_date = {}
        for rec in recommendations:
            if not rec.get('rawData') or not rec.get('rawData').get('company') or not rec.get('rawData').get(
                    'company').get('symbol'):
                continue
            symbol = rec['rawData']['company']['symbol']
            if symbol not in symbol_to_date and rec.get('target_trading_datetime'):
                symbol_to_date[symbol] = rec['target_trading_datetime']

        # Parallelize price data fetching for all symbols
        async def fetch_symbol_price_data(symbol, target_datetime_str):
            try:
                target_date = datetime.fromisoformat(target_datetime_str.replace('Z', '+00:00'))
                start_date = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
                end_date = target_date.replace(hour=23, minute=59, second=59, microsecond=999999)

                price_data = await self.stock_service.get_market_data(symbol, data_type='stock',
                                                                      resolution='minute', time_range=1)

                if price_data:
                    filtered_data = []
                    for point in price_data:
                        try:
                            point_time = datetime.fromisoformat(point['timestamp'].replace('Z', '+00:00'))
                            if start_date <= point_time <= end_date:
                                filtered_data.append(point)
                        except Exception:
                            continue

                    hourly_data = process_to_time_resolution(filtered_data, resolution_minutes=60)
                    return symbol, hourly_data
                return symbol, None
            except Exception as e:
                await log_service.error(f"Error fetching price data for {symbol}: {str(e)}")
                return symbol, None

        if symbol_to_date:
            # Fetch all symbols in parallel
            fetch_tasks = [fetch_symbol_price_data(symbol, target_dt) for symbol, target_dt in symbol_to_date.items()]
            results = await asyncio.gather(*fetch_tasks)

            # Build the result dictionary
            symbols_processed = 0
            for symbol, data in results:
                if data:
                    actual_price_data[symbol] = data
                    symbols_processed += 1

            if symbols_processed > 0:
                await log_service.portfolio(f"Retrieved price data for {symbols_processed} symbols")

        return actual_price_data

    async def generate_portfolio_recommendation(self, force_refresh: bool = False) -> Dict[str, Any]:
        if not self.ai_service.claude_client and not self.ai_service.gemini_client:
            raise RuntimeError("AI service not initialized - no clients available")

        if not force_refresh:
            cached_recommendation = await self.cache.get_cached_portfolio()
            if cached_recommendation:
                return cached_recommendation

        recommendations = await self.fetch_recent_recommendations()

        if not recommendations:
            await log_service.warning("No recent recommendations available. Returning default portfolio structure.")
            now = time_service.now(self.eastern_tz)
            return {
                'timestamp': now.isoformat(),
                'target_trading_datetime': now.isoformat(),
                'marketOutlook': "Market outlook is not available as markets are likely closed.",
                'topOpportunities': [],
                'portfolioAllocation': {},
                'watchlist': [],
                'avoidList': [],
                'rankedBuys': [],
                'strategy': "No strategy available. This may be due to markets being closed for the weekend or a holiday.",
                'riskAssessment': "No risk assessment available.",
                'correlations': {},
                'stockCount': { 'buys': 0, 'holds': 0, 'sells': 0, 'total': 0 },
                'alternativeInvestments': [],
                'disclaimer': "This is for informational purposes only and not financial advice. Investing in stocks involves risk.",
                'isEmpty': True,
                'recommendationStats': { 'fresh': 0, 'recent': 0, 'aged': 0, 'outdated': 0, 'total': 0 },
                'freshness': 'stale',
                'generatedAt': now.isoformat()
            }

        symbol_to_rec = {}
        for rec in recommendations:
            if 'rawData' in rec and 'company' in rec['rawData'] and 'symbol' in rec['rawData']['company']:
                symbol = rec['rawData']['company']['symbol']
                symbol_to_rec[symbol] = rec

        actual_price_data = await self.fetch_actual_price_data_for_recommendations(recommendations)

        if actual_price_data:
            await compare_predictions_with_actual(recommendations, actual_price_data)

        system_message = get_portfolio_system_prompt()
        user_message = create_portfolio_user_prompt(recommendations, self.eastern_tz)

        stocks_data = []
        for rec in recommendations:
            filtered_rec = filter_recommendation_data_minimal(rec)
            stocks_data.append(filtered_rec)

        debug_data = {
            "recommendationCount": len(recommendations),
            "timestamp": time_service.now(self.eastern_tz).isoformat(),
            "symbols": list(symbol_to_rec.keys()),
            "hasActualPriceData": bool(actual_price_data),
            "stocks_data": stocks_data,
            "actual_price_data": actual_price_data
        }

        response = await self.ai_service.call_api(
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ],
            model="gemini-2.5-pro",
            temperature=1.0,
            with_thinking=True,
            tag="PORTFOLIO_ANALYTICS",
            save_debug=True,
            additional_data=debug_data,
            ai_provider='gemini'
        )

        if not response:
            raise RuntimeError("Failed to get portfolio recommendation from AI service")

        response_text = ""
        thinking_content = ""

        for content_block in response.content:
            if content_block.type == "text":
                response_text = content_block.text
            elif content_block.type == "thinking":
                thinking_content = content_block.thinking

        portfolio_recommendation = await parse_portfolio_response(response_text, symbol_to_rec, self.eastern_tz)

        if thinking_content:
            portfolio_recommendation['thinking'] = thinking_content

        await self.cache.cache_portfolio(portfolio_recommendation)
        await log_service.portfolio(
            f"Generated portfolio recommendation with {len(portfolio_recommendation.get('topOpportunities', []))} opportunities")
        return portfolio_recommendation