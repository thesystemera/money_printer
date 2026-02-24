import asyncio
import pytz
import re
import time
from services import log_service, time_service

from services.recommendation_service_helper import (
    get_next_market_open_info,
    preprocess_price_data,
    merge_price_data_by_timestamp,
    calculate_price_metrics,
    prepare_sentiment_data,
    process_to_time_resolution,
    filter_prediction_data_for_claude_analysis,
    create_condensed_prediction_summary,
    filter_prediction_data_for_specialist,
    convert_timestamp_to_eastern,
    parse_recommendation_response,
    filter_specialist_text_for_master,
    CLAUDE_FILTER_PRESETS
)

from services.recommendation_prompts import (
    get_master_analytics_system_prompt,
    create_master_analytics_user_prompt,
    get_options_analytics_system_prompt,
    create_options_analytics_user_prompt,
    get_image_analytics_system_prompt,
    create_image_analytics_user_prompt,
    get_vibe_analytics_system_prompt,
    create_vibe_analytics_user_prompt,
    get_historical_analytics_system_prompt,
    create_historical_analytics_user_prompt,
)


class RecommendationService:
    def __init__(self, cache_service=None, options_service=None, config_service=None,
                 ai_service=None, earnings_service=None, stock_service=None, prediction_accuracy_service=None):
        self.config = config_service
        self.stock_service = stock_service
        self.ai_service = ai_service
        self.api_semaphore = asyncio.Semaphore(5)
        self.cache = cache_service
        self.options_service = options_service
        self.earnings_service = earnings_service
        self.prediction_accuracy_service = prediction_accuracy_service

        self.eastern_tz = pytz.timezone('US/Eastern')

        self.market_hours = {
            "pre_market_open": "04:00",
            "regular_open": "09:30",
            "regular_close": "16:00",
            "after_hours_close": "20:00"
        }

        self.market_indices = {
            'sp500': 'S&P 500',
            'nasdaq': 'NASDAQ',
            'dow': 'Dow Jones',
            'russell2000': 'Russell 2000'
        }

    async def initialize(self):
        if not self.config:
            raise RuntimeError("RecommendationService initialization failed - no config service")
        if not self.ai_service:
            raise RuntimeError("RecommendationService initialization failed - no AI service")
        try:
            ai_clients_ready = any([
                bool(getattr(self.ai_service, "claude_client", None)),
                bool(getattr(self.ai_service, "gemini_client", None)),
                bool(getattr(self.ai_service, "openai_client", None))
            ])
        except Exception:
            ai_clients_ready = False
        if not ai_clients_ready:
            raise RuntimeError("RecommendationService initialization failed - no AI clients ready")
        if not self.cache:
            raise RuntimeError("RecommendationService initialization failed - no cache service")
        if not self.options_service:
            raise RuntimeError("RecommendationService initialization failed - no options service")
        if not self.earnings_service:
            raise RuntimeError("RecommendationService initialization failed - no earnings service")
        await log_service.system("RecommendationService initialized - all dependencies ready")

    async def _build_content_array_from_images(self, text_prompt, images):
        content_array = [{"type": "text", "text": text_prompt}]
        if images:
            for img in images:
                try:
                    base64_data = ""
                    if isinstance(img, dict):
                        raw = img.get("base64") or img.get("data") or img.get("image") or ""
                        base64_data = raw.split(",")[-1] if raw else ""
                    elif isinstance(img, str):
                        base64_data = img.split(",")[-1] if img else ""
                    if base64_data:
                        content_array.append({
                            "type": "image",
                            "source": {"type": "base64", "media_type": "image/png", "data": base64_data}
                        })
                except Exception as e:
                    await log_service.error(f"Error processing image: {str(e)}")
                    continue
        return content_array

    def _extract_text_from_ai_response(self, response, empty_error_message):
        if not response:
            raise RuntimeError(empty_error_message)
        text = ""
        content = getattr(response, "content", None)
        if isinstance(content, list):
            for block in content:
                if getattr(block, "type", None) == "text":
                    text = getattr(block, "text", "") or text
        if not text:
            raise RuntimeError(empty_error_message)
        return text

    def _extract_previous_insights(self, analysis_text):
        if not analysis_text:
            return None
        match = re.search(r'(\[PREDICTION HISTORY INSIGHTS].*?)(?=\n\[|$)', analysis_text, re.DOTALL)
        return match.group(1).strip() if match else None

    async def generate_recommendation(self, company_symbol, company_name, analyzed_articles,
                                      symbol_recent_prices, symbol_historical_prices=None,
                                      market_indices_data=None, visualization_images=None):
        if not visualization_images or not isinstance(visualization_images, list) or len(visualization_images) == 0:
            raise ValueError(f"Visualization images are required for {company_symbol}")

        # Parallelize image filtering operations
        image_filter_results = await asyncio.gather(
            self.config.filter_images_by_destination(visualization_images, 'send_to_master_analytics'),
            self.config.filter_images_by_destination(visualization_images, 'send_to_image_analytics'),
            self.config.filter_images_by_destination(visualization_images, 'send_to_options_analytics'),
            self.config.filter_images_by_destination(visualization_images, 'send_to_vibe_analytics')
        )
        master_analytics_images, image_analytics_images, options_analytics_images, vibe_analytics_images = image_filter_results

        await log_service.info(
            f"Image routing for {company_symbol}: {len(master_analytics_images)} to master, "
            f"{len(image_analytics_images)} to image, {len(options_analytics_images)} to options, "
            f"{len(vibe_analytics_images)} to vibe")

        if not image_analytics_images:
            raise ValueError(f"No images routed to image analytics for {company_symbol}")
        if not options_analytics_images:
            raise ValueError(f"No images routed to options analytics for {company_symbol}")
        if not vibe_analytics_images:
            raise ValueError(f"No images routed to vibe analytics for {company_symbol}")
        if not master_analytics_images:
            raise ValueError(f"No images routed to master analytics for {company_symbol}")

        if not self.ai_service.claude_client and not self.ai_service.gemini_client:
            raise RuntimeError("AI service not initialized - no AI clients available")

        prediction_data = await self._prepare_signal_and_prediction_data(company_symbol)
        full_prediction_accuracy = prediction_data["full_prediction_accuracy"]
        master_prediction_history = prediction_data["master_prediction_history"]
        image_prediction_history = prediction_data["image_prediction_history"]
        options_prediction_history = prediction_data["options_prediction_history"]
        vibe_prediction_history = prediction_data["vibe_prediction_history"]
        previous_master_insights = prediction_data["previous_master_insights"]
        previous_image_insights = prediction_data["previous_image_insights"]
        previous_options_insights = prediction_data["previous_options_insights"]
        previous_vibe_insights = prediction_data["previous_vibe_insights"]
        previous_date = prediction_data["previous_date"]

        market_articles = []
        industry_articles = []
        stock_articles = []

        for article in analyzed_articles:
            if 'sourceSymbol' in article and article.get('sourceSymbol') == 'GLOBAL_MARKET':
                market_articles.append(article)
            elif 'sourceSymbol' in article and article.get('sourceSymbol').startswith('INDUSTRY_'):
                industry_articles.append(article)
            else:
                stock_articles.append(article)

        stock_articles = sorted(stock_articles, key=lambda x: x.get('publishedDate', ''))
        industry_articles = sorted(industry_articles, key=lambda x: x.get('publishedDate', ''))
        market_articles = sorted(market_articles, key=lambda x: x.get('publishedDate', ''))

        await log_service.info(f"Processed {len(analyzed_articles)} articles for {company_symbol}: "
                               f"{len(stock_articles)} stock-specific, {len(industry_articles)} industry, "
                               f"{len(market_articles)} market-wide")

        market_timing_info = get_next_market_open_info(self.eastern_tz, self.market_hours)
        await log_service.info(f"Market timing for {company_symbol}: {market_timing_info}")

        await log_service.info(f"Processing price data for {company_symbol}: "
                               f"{len(symbol_recent_prices)} recent points, "
                               f"{len(symbol_historical_prices) if symbol_historical_prices else 0} historical points")

        symbol_recent_data = preprocess_price_data(symbol_recent_prices, 'recent', self.eastern_tz)
        symbol_historical_data = []
        if symbol_historical_prices:
            symbol_historical_data = preprocess_price_data(symbol_historical_prices, 'historical',
                                                           self.eastern_tz)

        index_recent_data = {}
        index_historical_data = {}

        if market_indices_data:
            await log_service.info(f"Processing market indices data for {company_symbol}: "
                                   f"{list(market_indices_data.keys())}")
            for index_name, index_data in market_indices_data.items():
                if index_name in self.market_indices:
                    if 'recent_data' in index_data and index_data['recent_data']:
                        index_recent_data[index_name] = preprocess_price_data(
                            index_data['recent_data'], 'recent', self.eastern_tz)

                    if 'historical_data' in index_data and index_data['historical_data']:
                        index_historical_data[index_name] = preprocess_price_data(
                            index_data['historical_data'], 'historical', self.eastern_tz)

        merged_recent_data = symbol_recent_data
        if index_recent_data:
            merged_recent_data = merge_price_data_by_timestamp(symbol_recent_data, index_recent_data, 'recent')
            await log_service.info(f"Merged recent data for {company_symbol} with indices: "
                                   f"{list(index_recent_data.keys())}")

        merged_historical_data = symbol_historical_data
        if index_historical_data and symbol_historical_data:
            merged_historical_data = merge_price_data_by_timestamp(symbol_historical_data, index_historical_data,
                                                                   'historical')
            await log_service.info(f"Merged historical data for {company_symbol} with indices: "
                                   f"{list(index_historical_data.keys())}")

        await log_service.info(f"Calculating price metrics for {company_symbol}")
        symbol_recent_metrics = calculate_price_metrics(merged_recent_data, 'recent', 'symbol')
        symbol_historical_metrics = calculate_price_metrics(merged_historical_data, 'historical', 'symbol')

        index_recent_metrics = {}
        index_historical_metrics = {}

        if merged_recent_data and any(f'{idx}_price' in merged_recent_data[0] for idx in self.market_indices.keys()):
            for index_name in self.market_indices.keys():
                if any(f'{index_name}_price' in point for point in merged_recent_data):
                    index_recent_metrics[index_name] = calculate_price_metrics(merged_recent_data, 'recent',
                                                                               index_name)

        if merged_historical_data and any(
                f'{idx}_price' in merged_historical_data[0] for idx in self.market_indices.keys()):
            for index_name in self.market_indices.keys():
                if any(f'{index_name}_price' in point for point in merged_historical_data):
                    index_historical_metrics[index_name] = calculate_price_metrics(merged_historical_data,
                                                                                   'historical', index_name)

        await log_service.info(f"Preparing sentiment analysis for {company_symbol}")
        stock_sentiment_result = prepare_sentiment_data(stock_articles, self.eastern_tz)
        industry_sentiment_result = prepare_sentiment_data(industry_articles, self.eastern_tz)
        market_sentiment_result = prepare_sentiment_data(market_articles, self.eastern_tz)

        await log_service.info(f"Sentiment processing complete for {company_symbol}: "
                               f"{stock_sentiment_result['filtered_count']} stock, {industry_sentiment_result['filtered_count']} industry, "
                               f"{market_sentiment_result['filtered_count']} market entries after filtering")

        visualization_categories = {
            "SENTIMENT_TEMPORAL": 0,
            "SENTIMENT_COMBINED": 0,
            "SENTIMENT_RECENT": 0,
            "OPTIONS_ANALYSIS": 0,
            "PREDICTION_HISTORY": 0,
            "HISTORICAL_ANALYSIS": 0
        }

        if visualization_images:
            for img in visualization_images:
                if isinstance(img, dict) and 'category' in img:
                    category = img['category']
                    if category in visualization_categories:
                        visualization_categories[category] += 1

        category_counts = ", ".join([f"{count} {cat}" for cat, count in visualization_categories.items() if count > 0])
        await log_service.info(f"Visualization breakdown for {company_symbol}: {category_counts}")

        visualization_metadata = {
            "count": len(visualization_images) if visualization_images else 0,
            "categories": [k for k, v in visualization_categories.items() if v > 0]
        }

        analysis_data = {
            "company": {
                "symbol": company_symbol,
                "name": company_name,
            },
            "marketTimingInfo": market_timing_info,
            "requestTime": time_service.now(self.eastern_tz).isoformat(),
            "sentimentAnalysis": {
                "stockArticles": {
                    "count": f"{stock_sentiment_result['filtered_count']} of {stock_sentiment_result['total_count']}",
                    "articles": stock_sentiment_result['articles']
                },
                "industryArticles": {
                    "count": f"{industry_sentiment_result['filtered_count']} of {industry_sentiment_result['total_count']}",
                    "articles": industry_sentiment_result['articles']
                },
                "marketArticles": {
                    "count": f"{market_sentiment_result['filtered_count']} of {market_sentiment_result['total_count']}",
                    "articles": market_sentiment_result['articles']
                },
                "filter_note": "Displaying articles with an absolute impact score of 0.5 or greater."
            },
            "marketData": {
                "recent_data": merged_recent_data,
                "historical_data": merged_historical_data,
                "symbol_recent_metrics": symbol_recent_metrics,
                "symbol_historical_metrics": symbol_historical_metrics,
                "index_recent_metrics": index_recent_metrics,
                "index_historical_metrics": index_historical_metrics
            },
            "visualizationImages": visualization_metadata
        }

        if master_prediction_history:
            analysis_data["predictionAccuracy"] = master_prediction_history

        await log_service.ai(f"Getting earnings data for {company_symbol}")
        earnings_analysis = await self.earnings_service.prepare_earnings_analysis(company_symbol)
        analysis_data["earningsAnalysis"] = earnings_analysis

        if earnings_analysis.get("hasEarningsData"):
            days_until = earnings_analysis.get("daysUntil")
            if days_until is not None:
                await log_service.info(f"Earnings analysis complete for {company_symbol}: "
                                       f"next report in {days_until} days")
            else:
                await log_service.info(f"Earnings analysis complete for {company_symbol}: "
                                       f"no upcoming earnings scheduled")
        else:
            await log_service.info(f"No earnings data available for {company_symbol}")

        current_market_data = None
        if symbol_recent_prices:
            current_time_str = time_service.now(self.eastern_tz).isoformat()
            current_date_str = current_time_str[:10]

            current_day_data = []
            for price_point in symbol_recent_prices:
                try:
                    ts_str = convert_timestamp_to_eastern(price_point.get('timestamp', ''), self.eastern_tz)
                    if ts_str.startswith(current_date_str):
                        current_day_data.append(price_point)
                except:
                    continue

            if current_day_data:
                current_market_data = process_to_time_resolution(current_day_data, resolution_minutes=15)
                await log_service.info(
                    f"Processed {len(current_market_data)} 15-minute intervals for {company_symbol} (current day only)")

        options_task = asyncio.create_task(
            self._run_options_analysis(company_symbol, company_name, market_timing_info, options_analytics_images,
                                       current_market_data, options_prediction_history, previous_options_insights)
        )

        image_task = asyncio.create_task(
            self._run_image_analysis(company_name, company_symbol, market_timing_info, image_analytics_images,
                                     current_market_data, image_prediction_history, previous_image_insights)
        )

        vibe_task = asyncio.create_task(
            self._run_vibe_analysis(company_symbol, company_name, market_timing_info,
                                    vibe_analytics_images, current_market_data, vibe_prediction_history,
                                    previous_vibe_insights)
        )

        options_analysis_text, image_analysis_text, vibe_analysis_text = await asyncio.gather(
            options_task,
            image_task,
            vibe_task
        )

        options_analysis_text_for_master = filter_specialist_text_for_master(options_analysis_text)
        image_analysis_text_for_master = filter_specialist_text_for_master(image_analysis_text)
        vibe_analysis_text_for_master = filter_specialist_text_for_master(vibe_analysis_text)

        recommendation = await self._run_master_analysis(
            company_symbol, company_name, market_timing_info, master_analytics_images,
            analysis_data, image_analysis_text_for_master, options_analysis_text_for_master,
            vibe_analysis_text_for_master, previous_master_insights, previous_date,
            visualization_categories
        )

        if full_prediction_accuracy:
            recommendation['predictionAccuracy'] = full_prediction_accuracy

        action = recommendation['action']
        confidence_obj = recommendation['confidence']
        primary_confidence = confidence_obj.get(action.lower(), 0)

        await log_service.success(
            f"Recommendation for {company_symbol}: {action} with {primary_confidence * 100:.1f}% confidence")

        recommendation['image_analysis'] = image_analysis_text
        recommendation['options_analysis'] = options_analysis_text
        recommendation['vibe_analysis'] = vibe_analysis_text
        recommendation['earnings_data'] = earnings_analysis

        cache_timestamp = int(time_service.timestamp())
        if 'timestamp' in recommendation:
            try:
                import datetime
                rec_dt = datetime.datetime.fromisoformat(recommendation['timestamp'].replace('Z', '+00:00'))
                cache_timestamp = int(rec_dt.timestamp())
                await log_service.info(
                    f"Using recommendation timestamp {cache_timestamp} for caching {company_symbol}")
            except (ValueError, TypeError) as e:
                await log_service.warning(
                    f"Could not parse recommendation timestamp, using current time: {str(e)}")

        recommendation['cached_at'] = cache_timestamp

        recommendation_for_cache = recommendation.copy()
        image_metadata = {
            "count": len(visualization_images),
            "categories": [img.get('category', 'unknown') for img in visualization_images if isinstance(img, dict)]
        }
        recommendation_for_cache['images'] = image_metadata

        await log_service.info(
            f"Caching recommendation for {company_symbol} with timestamp {cache_timestamp}")

        cache_success = await self.cache.cache_recommendation(company_symbol, recommendation_for_cache,
                                                              visualization_images)

        if cache_success:
            await log_service.cache(
                f"Archived recommendation with images for {company_symbol} for later review")
        else:
            await log_service.warning(f"Failed to cache recommendation for {company_symbol}")

        recommendation['images'] = visualization_images
        await log_service.info(
            f"Returning recommendation with {len(visualization_images)} full images for immediate frontend display")

        return recommendation

    async def _prepare_signal_and_prediction_data(self, company_symbol):
        previous_recommendations = await self.get_previous_recommendations(company_symbol, 30)

        default_return = {
            "full_prediction_accuracy": None, "master_prediction_history": None,
            "image_prediction_history": None, "options_prediction_history": None,
            "vibe_prediction_history": None, "previous_master_insights": None,
            "previous_image_insights": None, "previous_options_insights": None,
            "previous_vibe_insights": None, "previous_date": None
        }

        if not previous_recommendations:
            await log_service.error(
                f"No historical recommendations found for symbol {company_symbol}. Continuing without historical analysis.")
            return default_return

        await log_service.info(f"Processing prediction accuracy for {company_symbol} "
                               f"with {len(previous_recommendations)} historical recommendations")

        full_prediction_accuracy = await self.prediction_accuracy_service.get_symbol_prediction_metrics(
            previous_recommendations
        )

        symbol_signal_performance = full_prediction_accuracy.get(
            'signal_performance') if full_prediction_accuracy else None

        await log_service.info("Fetching portfolio-wide signal analysis for comparative metrics")
        portfolio_wide_recs = await self.cache.get_cached_recommendations(
            symbol="ALL", limit=1000, filter_mode="intelligent", include_images=False
        )

        portfolio_signal_performance = None
        if portfolio_wide_recs:
            await log_service.info(
                f"Calculating portfolio signal metrics using {len(portfolio_wide_recs)} recommendations")
            portfolio_metrics = await self.prediction_accuracy_service.get_portfolio_prediction_metrics(
                portfolio_wide_recs
            )
            portfolio_signal_performance = portfolio_metrics.get('signal_performance') if portfolio_metrics else None
        else:
            await log_service.error(
                "Failed to fetch portfolio-wide recommendations. Signal analysis will only contain symbol-specific data.")

        prev_rec = previous_recommendations[0]
        previous_master_insights = prev_rec.get('predictionHistoryInsights', '')
        previous_image_insights = self._extract_previous_insights(prev_rec.get('image_analysis', ''))
        previous_options_insights = self._extract_previous_insights(prev_rec.get('options_analysis', ''))
        previous_vibe_insights = self._extract_previous_insights(prev_rec.get('vibe_analysis', ''))
        previous_date = prev_rec.get('target_trading_datetime', '').split('T')[0] if prev_rec.get(
            'target_trading_datetime') else 'Unknown'

        master_prediction_history = create_condensed_prediction_summary(full_prediction_accuracy, preset='master')
        merged_master_signals = self._merge_symbol_and_portfolio_signals(
            symbol_signal_performance, portfolio_signal_performance, 'master'
        )
        if merged_master_signals:
            master_prediction_history['signal_performance'] = merged_master_signals
            await log_service.info(f"Added merged signal performance to master prediction history")

        image_prediction_history = filter_prediction_data_for_specialist(full_prediction_accuracy, 'image')
        if image_prediction_history:
            merged_image_signals = self._merge_symbol_and_portfolio_signals(
                symbol_signal_performance, portfolio_signal_performance, 'image'
            )
            if merged_image_signals:
                image_prediction_history['signal_performance'] = merged_image_signals
                await log_service.info(f"Added merged signal performance to image prediction history")

        options_prediction_history = filter_prediction_data_for_specialist(full_prediction_accuracy, 'options')
        if options_prediction_history:
            merged_options_signals = self._merge_symbol_and_portfolio_signals(
                symbol_signal_performance, portfolio_signal_performance, 'options'
            )
            if merged_options_signals:
                options_prediction_history['signal_performance'] = merged_options_signals
                await log_service.info(f"Added merged signal performance to options prediction history")

        vibe_prediction_history = filter_prediction_data_for_specialist(full_prediction_accuracy, 'vibe')
        if vibe_prediction_history:
            merged_vibe_signals = self._merge_symbol_and_portfolio_signals(
                symbol_signal_performance, portfolio_signal_performance, 'vibe'
            )
            if merged_vibe_signals:
                vibe_prediction_history['signal_performance'] = merged_vibe_signals
                await log_service.info(f"Added merged signal performance to vibe prediction history")

        if 'metadata' in full_prediction_accuracy:
            processed_count = full_prediction_accuracy['metadata'].get('processed_count', 0)
            total_count = full_prediction_accuracy['metadata'].get('total_count', 0)
            await log_service.info(f"Prediction accuracy analysis complete for {company_symbol}: "
                                   f"{processed_count}/{total_count} recommendations processed")

        return {
            "full_prediction_accuracy": full_prediction_accuracy,
            "master_prediction_history": master_prediction_history,
            "image_prediction_history": image_prediction_history,
            "options_prediction_history": options_prediction_history,
            "vibe_prediction_history": vibe_prediction_history,
            "previous_master_insights": previous_master_insights,
            "previous_image_insights": previous_image_insights,
            "previous_options_insights": previous_options_insights,
            "previous_vibe_insights": previous_vibe_insights,
            "previous_date": previous_date,
        }

    def _merge_symbol_and_portfolio_signals(self, symbol_signals, portfolio_signals, model_name):
        if not symbol_signals and not portfolio_signals:
            return None

        merged = {
            'by_category': {},
            'by_model_summary': {}
        }

        all_categories = set()
        if symbol_signals and 'by_category' in symbol_signals:
            all_categories.update(symbol_signals['by_category'].keys())
        if portfolio_signals and 'by_category' in portfolio_signals:
            all_categories.update(portfolio_signals['by_category'].keys())

        for category in all_categories:
            merged['by_category'][category] = {}

            if symbol_signals and 'by_category' in symbol_signals and category in symbol_signals['by_category']:
                cat_data = symbol_signals['by_category'][category]
                if 'model_breakdown' in cat_data and model_name in cat_data['model_breakdown']:
                    merged['by_category'][category]['symbol'] = cat_data['model_breakdown'][model_name]

            if portfolio_signals and 'by_category' in portfolio_signals and category in portfolio_signals[
                'by_category']:
                cat_data = portfolio_signals['by_category'][category]
                if 'model_breakdown' in cat_data and model_name in cat_data['model_breakdown']:
                    merged['by_category'][category]['portfolio'] = cat_data['model_breakdown'][model_name]

        merged['by_category'] = {k: v for k, v in merged['by_category'].items() if v}

        if symbol_signals and 'by_model' in symbol_signals and model_name in symbol_signals['by_model']:
            merged['by_model_summary']['symbol'] = symbol_signals['by_model'][model_name]

        if portfolio_signals and 'by_model' in portfolio_signals and model_name in portfolio_signals['by_model']:
            merged['by_model_summary']['portfolio'] = portfolio_signals['by_model'][model_name]

        return merged if merged['by_category'] else None

    async def _run_options_analysis(self, company_symbol, company_name, market_timing_info, options_analytics_images,
                                    current_market_data=None, prediction_history=None, previous_insights=None):
        start_time = time.perf_counter()

        await log_service.ai(
            f"Starting options analysis for {company_symbol} with {len(options_analytics_images) if options_analytics_images else 0} visualizations")

        options_data = await self.options_service.get_options_data(
            symbol=company_symbol,
            data_view="ai",
            force_refresh=False,
            force_recalculate=False
        )
        if not isinstance(options_data, dict):
            raise RuntimeError(f"Options service returned no data for {company_symbol}")

        system_prompt = get_options_analytics_system_prompt()
        user_prompt = create_options_analytics_user_prompt(company_name, company_symbol, market_timing_info,
                                                           options_data, current_market_data, prediction_history,
                                                           previous_insights)
        content_array = await self._build_content_array_from_images(user_prompt, options_analytics_images)
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": content_array}]

        async with self.api_semaphore:
            response = await self.ai_service.call_api(messages=messages, model="gemini-2.5-pro", temperature=1.0,
                                                      with_thinking=True, tag="OPTIONS_ANALYTICS", save_debug=True,
                                                      additional_data=options_data, image_data=options_analytics_images,
                                                      symbol=company_symbol, ai_provider="gemini")

        analysis_text = self._extract_text_from_ai_response(response,
                                                            f"Options analysis returned empty text for {company_symbol}")

        duration = time.perf_counter() - start_time
        await log_service.success(
            f"Options analysis complete for {company_symbol}: gemini-2.5-pro, {len(options_analytics_images)} images, {duration:.1f}s, {len(analysis_text)} chars")

        return analysis_text

    async def _run_image_analysis(self, company_name, company_symbol, market_timing_info, image_analytics_images,
                                  current_market_data=None, prediction_history=None, previous_insights=None):
        start_time = time.perf_counter()

        await log_service.ai(
            f"Starting image analysis for {company_symbol} with {len(image_analytics_images) if image_analytics_images else 0} visualizations")

        system_prompt = get_image_analytics_system_prompt()
        user_prompt = create_image_analytics_user_prompt(company_name, company_symbol, market_timing_info,
                                                         current_market_data, prediction_history, previous_insights)
        content_array = await self._build_content_array_from_images(user_prompt, image_analytics_images)
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": content_array}]

        async with self.api_semaphore:
            image_analysis_response = await self.ai_service.call_api(messages=messages,
                                                                     model="gemini-2.5-pro",
                                                                     temperature=1.0, with_thinking=True,
                                                                     tag="IMAGE_ANALYTICS", save_debug=True,
                                                                     additional_data={"symbol": company_symbol,
                                                                                      "company_name": company_name,
                                                                                      "market_timing": market_timing_info,
                                                                                      "analysis_type": "sentiment_visualization"},
                                                                     image_data=image_analytics_images,
                                                                     symbol=company_symbol,
                                                                     ai_provider="gemini")

        image_analysis_text = self._extract_text_from_ai_response(image_analysis_response,
                                                                  f"Image analysis returned empty text for {company_symbol}")

        duration = time.perf_counter() - start_time
        await log_service.success(
            f"Image analysis complete for {company_symbol}: claude-3-7-sonnet, {len(image_analytics_images)} images, {duration:.1f}s, {len(image_analysis_text)} chars")

        return image_analysis_text

    async def _run_vibe_analysis(self, company_symbol, company_name, market_timing_info, vibe_analytics_images,
                                 current_market_data=None, prediction_history=None, previous_insights=None):
        start_time = time.perf_counter()

        await log_service.ai(
            f"Starting vibe analysis for {company_symbol} with {len(vibe_analytics_images) if vibe_analytics_images else 0} visualizations")

        system_prompt = get_vibe_analytics_system_prompt()
        user_prompt = create_vibe_analytics_user_prompt(company_name, company_symbol, market_timing_info,
                                                        current_market_data, prediction_history, previous_insights)
        content_array = await self._build_content_array_from_images(user_prompt, vibe_analytics_images)
        web_search_tools = [{"type": "web_search_preview"}]
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": content_array}]
        debug_data = {"symbol": company_symbol, "company_name": company_name, "market_timing": market_timing_info,
                      "analysis_type": "vibe_narrative_analysis", "web_search_enabled": True,
                      "ai_provider": "GPT-5 Responses API", "max_searches": "unlimited"}

        async with self.api_semaphore:
            response = await self.ai_service.call_api(messages=messages, model="gpt-5", temperature=1.0,
                                                      with_thinking=True, tag="VIBE_ANALYSIS", save_debug=True,
                                                      additional_data=debug_data, image_data=vibe_analytics_images,
                                                      symbol=company_symbol, tools=web_search_tools,
                                                      ai_provider="openai",
                                                      reasoning_effort="low", verbosity="low")

        analysis_text = self._extract_text_from_ai_response(response,
                                                            f"Vibe analysis returned empty text for {company_symbol}")

        duration = time.perf_counter() - start_time
        await log_service.success(
            f"Vibe analysis complete for {company_symbol}: gpt-5, {len(vibe_analytics_images)} images, {duration:.1f}s, {len(analysis_text)} chars")

        return analysis_text

    async def _run_master_analysis(self, company_symbol, company_name, market_timing_info, master_analytics_images,
                                   analysis_data, image_analysis_text, options_analysis_text, vibe_analysis_text,
                                   previous_master_insights, previous_date, visualization_categories):
        start_time = time.perf_counter()

        system_prompt = get_master_analytics_system_prompt(visualization_categories)
        user_data_prompt = create_master_analytics_user_prompt(
            company_name,
            company_symbol,
            market_timing_info,
            analysis_data,
            image_analysis_text,
            options_analysis_text,
            vibe_analysis_text,
            previous_master_insights,
            previous_date
        )

        content_array = [{"type": "text", "text": user_data_prompt}]
        for img in master_analytics_images:
            base64_data = img.split(',')[1] if ',' in img else img
            content_array.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": base64_data}
            })

        full_analysis_messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content_array}
        ]

        response = await self.ai_service.call_api(
            messages=full_analysis_messages,
            model="gemini-2.5-pro",
            temperature=1.0,
            with_thinking=True,
            tag="MASTER_ANALYTICS",
            save_debug=True,
            additional_data=analysis_data,
            image_data=master_analytics_images,
            symbol=company_symbol,
            ai_provider='gemini'
        )

        if not response:
            raise RuntimeError(f"Master analytics API call failed for {company_symbol}")

        response_text = ""
        for content_block in response.content:
            if content_block.type == "text":
                response_text = content_block.text

        if not response_text:
            raise RuntimeError(f"Master analytics returned empty text for {company_symbol}")

        recommendation = parse_recommendation_response(response_text, analysis_data)

        duration = time.perf_counter() - start_time
        await log_service.success(
            f"Master analysis complete for {company_symbol}: gemini-2.5-pro, {len(master_analytics_images)} images, {duration:.1f}s, {len(response_text)} chars")

        return recommendation

    async def get_previous_recommendations(self, company_symbol, target_count=10):
        limit = int(target_count) if isinstance(target_count, int) or (
                isinstance(target_count, str) and str(target_count).isdigit()) else 10
        limit = max(1, min(limit, 50))
        results = await self.cache.get_cached_recommendations(symbol=company_symbol, limit=limit,
                                                              filter_mode="intelligent", include_images=False)
        return results or []

    async def _run_historical_analysis(self, portfolio_metrics_data):
        start_time = time.perf_counter()

        filtered_data = filter_prediction_data_for_claude_analysis(portfolio_metrics_data,
                                                                   CLAUDE_FILTER_PRESETS['standard'])
        original_size = len(str(portfolio_metrics_data))
        filtered_size = len(str(filtered_data))
        if original_size > 0:
            reduction_pct = ((original_size - filtered_size) / original_size) * 100
            await log_service.info(
                f"Data filtered: {reduction_pct:.1f}% reduction ({original_size} -> {filtered_size} chars)")

        system_prompt = get_historical_analytics_system_prompt()
        user_prompt = create_historical_analytics_user_prompt(create_condensed_prediction_summary(filtered_data))
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]

        async with self.api_semaphore:
            response = await self.ai_service.call_api(messages=messages, model="gemini-2.5-pro", temperature=1.0,
                                                      with_thinking=True, tag="HISTORICAL_ANALYTICS", save_debug=True,
                                                      additional_data={"analysis_type": "historical",
                                                                       "processed_count": portfolio_metrics_data.get(
                                                                           'metadata', {}).get('processed_count', 0)},
                                                      symbol="PORTFOLIO", ai_provider='gemini')

        analysis_text = self._extract_text_from_ai_response(response, "Historical analysis returned empty text")

        duration = time.perf_counter() - start_time
        await log_service.success(
            f"Historical analysis complete: gemini-2.5-pro, 0 images, {duration:.1f}s, {len(analysis_text)} chars")

        return analysis_text