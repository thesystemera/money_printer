import hashlib
import re
import numpy as np
import pytz
import asyncio
from datetime import datetime, timedelta, time
from collections import defaultdict
from typing import Dict, List, Any, Optional
from services import log_service, time_service
from services.prediction_accuracy_signal_helper import SignalExtractionHelper

class PredictionAccuracyService:
    def __init__(self, cache_service=None, stock_service=None):
        self.cache = cache_service
        self.stock_service = stock_service
        self.signal_helper = SignalExtractionHelper()
        self.eastern_tz = pytz.timezone('US/Eastern')

    async def get_symbol_prediction_metrics(self, historical_recommendations: List[Dict], bypass_cache: bool = False) -> \
    Dict[str, Any]:
        if not historical_recommendations:
            return self._create_empty_response(single_symbol_mode=True)

        symbol = self._extract_symbol_from_recommendation(historical_recommendations[0])
        rec_count = len(historical_recommendations)
        cache_key = f"symbol_accuracy_{symbol}_{rec_count}"

        if not bypass_cache:
            cached_data = await self.cache.get_cached_prediction_accuracy(cache_key)
            if cached_data:
                await log_service.cache(f"[PREDICTION_ACCURACY] âœ“ Using cached metrics for symbol {symbol}")
                return cached_data

        await log_service.info(
            f"Cache {'bypassed' if bypass_cache else 'miss'} for symbol {symbol}. Calculating prediction metrics.")
        metrics = await self._generate_portfolio_prediction_metrics(
            historical_recommendations,
            single_symbol_mode=True
        )

        if not bypass_cache:
            await self.cache.cache_prediction_accuracy(cache_key, metrics)
        return metrics

    async def get_portfolio_prediction_metrics(self, historical_recommendations: List[Dict],
                                               bypass_cache: bool = False) -> Dict[str, Any]:
        if not historical_recommendations:
            return self._create_empty_response(single_symbol_mode=False)

        rec_count = len(historical_recommendations)
        cache_key = f"portfolio_accuracy_ALL_{rec_count}"

        if not bypass_cache:
            cached_data = await self.cache.get_cached_prediction_accuracy(cache_key)
            if cached_data:
                await log_service.cache("[PREDICTION_ACCURACY] âœ“ Using cached portfolio metrics for 'ALL'")
                return cached_data

        await log_service.info(
            f"Cache {'bypassed' if bypass_cache else 'miss'} for portfolio 'ALL'. Calculating prediction metrics.")
        metrics = await self._generate_portfolio_prediction_metrics(
            historical_recommendations,
            single_symbol_mode=False
        )

        if not bypass_cache:
            await self.cache.cache_prediction_accuracy(cache_key, metrics)
        return metrics

    async def _generate_portfolio_prediction_metrics(self, historical_recommendations: List[Dict],
                                                     single_symbol_mode: bool = False) -> Dict[str, Any]:
        if not self.stock_service:
            await log_service.error("Stock service not initialized")
            return self._create_empty_response(single_symbol_mode)

        if not self.cache:
            await log_service.warning("Cache service not initialized, proceeding without caching")

        recommendations_count = len(historical_recommendations)
        current_date = time_service.now(self.eastern_tz).date()

        await log_service.info(
            f"Processing {recommendations_count} historical recommendations ({'single-symbol' if single_symbol_mode else 'portfolio-wide'} mode)")

        if not historical_recommendations:
            return self._create_empty_response(single_symbol_mode)

        recommendations_by_symbol = defaultdict(list)
        symbols_found = set()

        for rec in historical_recommendations:
            symbol = self._extract_symbol_from_recommendation(rec)
            if symbol:
                recommendations_by_symbol[symbol].append(rec)
                symbols_found.add(symbol)
            else:
                await log_service.warning("Recommendation missing symbol information")

        if not symbols_found:
            await log_service.error("No symbols found in recommendations")
            return self._create_empty_response(single_symbol_mode)

        await log_service.info(
            f"Found recommendations for {len(symbols_found)} symbols: {', '.join(sorted(symbols_found))}")

        stock_data_by_symbol = await self._fetch_stock_data_for_symbols(
            list(symbols_found),
            recommendations_by_symbol
        )

        if not stock_data_by_symbol:
            await log_service.error("No stock data retrieved for any symbols")
            return self._create_empty_response(single_symbol_mode)

        all_prediction_entries = []
        symbol_results = {}

        for symbol, symbol_recommendations in recommendations_by_symbol.items():
            if symbol not in stock_data_by_symbol:
                await log_service.warning(f"No stock data available for {symbol}, skipping")
                continue

            await log_service.info(f"Processing {len(symbol_recommendations)} recommendations for {symbol}")

            symbol_entries = []
            for rec in symbol_recommendations:
                try:
                    entry = await self._process_single_recommendation(rec, stock_data_by_symbol[symbol], current_date)
                    if entry:
                        entry['symbol'] = symbol
                        symbol_entries.append(entry)
                        all_prediction_entries.append(entry)
                except (KeyError, ValueError, TypeError) as e:
                    rec_id = rec.get('timestamp') or rec.get('id', 'N/A')
                    await log_service.error(
                        f"Skipping malformed recommendation for {symbol} (ID: {rec_id}) due to error: {e}")
                    continue

            if symbol_entries:
                symbol_results[symbol] = {
                    'entries': symbol_entries,
                    'symbol_metrics': self._calculate_symbol_specific_metrics(symbol_entries),
                    'prediction_count': len(symbol_entries),
                    'total_recommendations': len(symbol_recommendations)
                }

        if not all_prediction_entries:
            await log_service.warning("No valid prediction entries generated")
            return self._create_empty_response(single_symbol_mode)

        portfolio_metrics = self._calculate_portfolio_performance(all_prediction_entries)
        accuracy_metrics = self._calculate_overall_accuracy_metrics(all_prediction_entries)
        model_comparison = self._compare_prediction_models(all_prediction_entries)
        weekly_performance = self._calculate_weekly_performance(all_prediction_entries)
        trends = await self._analyze_daily_accuracy_trends(all_prediction_entries)
        confidence_correlation = self._calculate_action_confidence_calibration(all_prediction_entries)
        magnitude_analysis = self._calculate_magnitude_based_accuracy(all_prediction_entries)
        movement_weighted_metrics = self._calculate_movement_weighted_metrics(all_prediction_entries)
        movement_detection = self._analyze_movement_detection(all_prediction_entries)
        signal_performance = self.signal_helper.calculate_portfolio_signal_performance(all_prediction_entries)

        portfolio_specific_metrics = None
        symbol_performance_ranking = None

        if not single_symbol_mode and len(symbols_found) > 1:
            portfolio_specific_metrics = self._calculate_portfolio_specific_metrics(symbol_results,
                                                                                    all_prediction_entries)
            symbol_performance_ranking = self._rank_symbols_by_performance(symbol_results)

        response = {
            'entries': all_prediction_entries,
            'portfolio_metrics': portfolio_metrics,
            'accuracy_metrics': accuracy_metrics,
            'model_comparison': model_comparison,
            'weekly_performance': weekly_performance,
            'trends': trends,
            'magnitude_analysis': magnitude_analysis,
            'movement_weighted_metrics': movement_weighted_metrics,
            'signal_performance': signal_performance,
            'metadata': {
                'processed_count': len(all_prediction_entries),
                'total_count': recommendations_count,
                'symbols_count': len(symbols_found),
                'symbols': sorted(list(symbols_found)),
                'mode': 'single_symbol' if single_symbol_mode else 'portfolio'
            }
        }

        if confidence_correlation:
            response['confidence_correlation'] = confidence_correlation

        if movement_detection:
            response['movement_detection'] = movement_detection

        if not single_symbol_mode and len(symbols_found) > 1:
            response['portfolio_specific'] = portfolio_specific_metrics
            response['symbol_performance'] = symbol_performance_ranking
            response['symbol_results'] = symbol_results

        return response

    def _classify_movement_magnitude_detailed(self, percentage_change: float) -> Dict[str, Any]:
        abs_change = abs(percentage_change)
        if abs_change < 0.25:
            return {"tier": "Noise", "level": 0, "impact": "none"}
        elif abs_change < 0.75:
            return {"tier": "Minor", "level": 1, "impact": "low"}
        elif abs_change < 1.5:
            return {"tier": "Small", "level": 2, "impact": "low"}
        elif abs_change < 2.5:
            return {"tier": "Moderate", "level": 3, "impact": "medium"}
        elif abs_change < 4.0:
            return {"tier": "Large", "level": 4, "impact": "high"}
        elif abs_change < 6.0:
            return {"tier": "Major", "level": 5, "impact": "high"}
        else:
            return {"tier": "Extreme", "level": 6, "impact": "extreme"}

    def __calculate_movement_weighted_accuracy(self, entries: List[Dict], model_name: str = 'master') -> float:
        weighted_accuracy_scores = []
        intensity_weights = []

        for entry in entries:
            model_timepoints = entry.get('models', {}).get(model_name, {}).get('timepoints', {})
            pred_open = model_timepoints.get('market_open')
            pred_close = model_timepoints.get('market_close')

            actual_timepoints = entry.get('actual', {})
            actual_open = actual_timepoints.get('market_open')
            actual_close = actual_timepoints.get('market_close')

            if not all(isinstance(val, (int, float)) for val in [pred_open, pred_close, actual_open, actual_close]):
                continue

            if actual_open == 0 or pred_open == 0:
                continue

            actual_return_percent = ((actual_close - actual_open) / actual_open) * 100
            if abs(actual_return_percent) <= 0.5:
                continue

            predicted_return_percent = ((pred_close - pred_open) / pred_open) * 100

            return_error_percent = abs(predicted_return_percent - actual_return_percent)
            error_score = return_error_percent * 10

            if np.sign(predicted_return_percent) == np.sign(actual_return_percent):
                base_accuracy = max(0, 100 - error_score)
            else:
                base_accuracy = max(-100, -error_score)

            magnitude_info = self._classify_movement_magnitude_detailed(actual_return_percent)
            intensity_weight = max(1.0, magnitude_info['level'] ** 1.5)

            weighted_accuracy_scores.append(base_accuracy * intensity_weight)
            intensity_weights.append(intensity_weight)

        if not intensity_weights:
            return None

        internal_score = np.sum(weighted_accuracy_scores) / np.sum(intensity_weights)

        final_score = (internal_score + 100) / 2

        return float(final_score)

    def _extract_symbol_from_recommendation(self, rec: Dict) -> Optional[str]:
        if 'rawData' in rec and 'company' in rec['rawData'] and 'symbol' in rec['rawData']['company']:
            return rec['rawData']['company']['symbol']
        elif 'symbol' in rec:
            return rec['symbol']
        elif 'company_symbol' in rec:
            return rec['company_symbol']
        return None

    async def _fetch_stock_data_for_symbols(self, symbols: List[str],
                                            recommendations_by_symbol: Dict[str, List[Dict]]) -> Dict[str, Dict]:
        if self.stock_service is None:
            await log_service.error("Stock service is None - this indicates a dependency injection issue")
            return {}

        all_dates = []
        for symbol_recs in recommendations_by_symbol.values():
            for rec in symbol_recs:
                if rec.get('target_trading_datetime'):
                    try:
                        target_dt = datetime.fromisoformat(rec['target_trading_datetime'].replace('Z', '+00:00'))
                        if target_dt.tzinfo is None:
                            target_dt = pytz.UTC.localize(target_dt)
                        target_dt_eastern = target_dt.astimezone(self.eastern_tz)
                        all_dates.append(target_dt_eastern.date())
                    except Exception as e:
                        await log_service.warning(f"Error parsing recommendation date: {str(e)}")
                        continue

        if not all_dates:
            await log_service.error("No valid recommendation dates found")
            return {}

        earliest_date = min(all_dates) - timedelta(days=5)
        latest_date = max(all_dates) + timedelta(days=5)
        days_needed = (latest_date - earliest_date).days + 1

        await log_service.info(
            f"Fetching stock data for {len(symbols)} symbols CONCURRENTLY from {earliest_date} to {latest_date}")

        async def fetch_single_symbol_data(symbol):
            try:
                await log_service.info(f"Fetching stock data for {symbol}")

                raw_stock_data = await self.stock_service.get_market_data(
                    symbol=symbol,
                    data_type='stock',
                    resolution='minute',
                    time_range=days_needed
                )

                if not raw_stock_data:
                    await log_service.warning(f"No stock data retrieved for {symbol}")
                    return symbol, {}

                processed_data = {}
                for point in raw_stock_data:
                    try:
                        timestamp_str = point.get('timestamp', '')
                        if not timestamp_str:
                            continue

                        dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                        if dt.tzinfo is None:
                            dt = pytz.UTC.localize(dt)
                        dt_eastern = dt.astimezone(self.eastern_tz)
                        date_str = dt_eastern.date().isoformat()

                        if date_str not in processed_data:
                            processed_data[date_str] = []

                        data_point = {
                            'timestamp': timestamp_str,
                            'price': point.get('price'),
                            'symbol_price': point.get('price')
                        }

                        for field in ['open', 'high', 'low', 'volume', 'marketSession']:
                            if field in point:
                                data_point[field] = point[field]

                        processed_data[date_str].append(data_point)

                    except Exception as e:
                        await log_service.warning(f"Error processing stock data point for {symbol}: {str(e)}")
                        continue

                await log_service.info(f"Processed {len(processed_data)} trading days for {symbol}")
                return symbol, processed_data

            except Exception as e:
                await log_service.error(f"Error fetching stock data for {symbol}: {str(e)}")
                return symbol, {}

        tasks = [fetch_single_symbol_data(symbol) for symbol in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        stock_data_by_symbol = {}
        for result in results:
            if isinstance(result, Exception):
                await log_service.error(f"Task failed with exception: {str(result)}")
                continue

            symbol, data = result
            if data:
                stock_data_by_symbol[symbol] = data

        await log_service.info(
            f"Successfully retrieved stock data for {len(stock_data_by_symbol)} symbols via concurrent requests")
        return stock_data_by_symbol

    def __calculate_return_accuracy_metrics(self, entries: List[Dict], model_name: str = 'master') -> Dict:
        upward_errors = []
        downward_errors = []
        all_errors = []

        for entry in entries:
            return_acc = entry.get('return_accuracies', {}).get(model_name)
            if not return_acc or return_acc.get('return_error_percent') is None:
                continue

            error = return_acc['return_error_percent']
            all_errors.append(error)

            actual_return = return_acc.get('actual_return_percent', 0)
            if actual_return >= 0:
                upward_errors.append(error)
            else:
                downward_errors.append(error)

        avg_error = np.mean(all_errors) if all_errors else None
        upward_error = np.mean(upward_errors) if upward_errors else None
        downward_error = np.mean(downward_errors) if downward_errors else None
        bias = (downward_error - upward_error) if upward_error is not None and downward_error is not None else None

        rating = self._get_rating(avg_error)

        return {
            'avg_error': avg_error,
            'rating': rating,
            'bias': bias,
            'upward_error': upward_error,
            'downward_error': downward_error,
            'count': len(all_errors)
        }

    def __calculate_accuracy_metrics(self, entries: List[Dict], model_name: str = 'master') -> Dict[str, Any]:
        if not entries:
            return {
                'accuracy': 0, 'movement_weighted_accuracy': 50.0, 'correct': 0, 'total': 0,
                'return_accuracy': {'avg_error': None, 'rating': 'N/A', 'bias': None, 'upward_error': None,
                                    'downward_error': None, 'count': 0}
            }

        correct_model_direction = 0
        total_model_direction = 0
        for entry in entries:
            model_timepoints = entry.get('models', {}).get(model_name, {}).get('timepoints', {})
            pred_open = model_timepoints.get('market_open')
            pred_close = model_timepoints.get('market_close')

            actual_timepoints = entry.get('actual', {})
            actual_open = actual_timepoints.get('market_open')
            actual_close = actual_timepoints.get('market_close')

            if not all(isinstance(val, (int, float)) for val in [pred_open, pred_close, actual_open, actual_close]):
                continue

            if actual_open == 0:
                continue

            predicted_change = pred_close - pred_open
            actual_change = actual_close - actual_open

            if predicted_change != 0 and actual_change != 0:
                total_model_direction += 1
                if np.sign(predicted_change) == np.sign(actual_change):
                    correct_model_direction += 1

        model_directional_accuracy = (
                                             correct_model_direction / total_model_direction * 100) if total_model_direction > 0 else 0

        movement_weighted_accuracy = self.__calculate_movement_weighted_accuracy(entries, model_name)
        return_accuracy_metrics = self.__calculate_return_accuracy_metrics(entries, model_name)

        return {
            'accuracy': model_directional_accuracy,
            'movement_weighted_accuracy': movement_weighted_accuracy,
            'correct': correct_model_direction,
            'total': total_model_direction,
            'return_accuracy': return_accuracy_metrics
        }

    def _calculate_portfolio_specific_metrics(self, symbol_results: Dict[str, Dict],
                                              all_entries: List[Dict]) -> Dict[str, Any]:
        symbols_count = len(symbol_results)
        symbol_accuracies = {}

        for symbol, data in symbol_results.items():
            metrics = self.__calculate_accuracy_metrics(data['entries'])
            symbol_accuracies[symbol] = {
                'accuracy': metrics['accuracy'],
                'movement_weighted_accuracy': metrics['movement_weighted_accuracy'],
                'correct': metrics['correct'],
                'total': metrics['total'],
                'return_accuracy': metrics['return_accuracy']
            }

        best_symbol = max(symbol_accuracies.items(),
                          key=lambda x: x[1]['movement_weighted_accuracy']) if symbol_accuracies else None
        worst_symbol = min(symbol_accuracies.items(),
                           key=lambda x: x[1]['movement_weighted_accuracy']) if symbol_accuracies else None

        accuracies = [data['accuracy'] for data in symbol_accuracies.values()]
        movement_weighted_accuracies = [data['movement_weighted_accuracy'] for data in symbol_accuracies.values()]
        accuracy_std = np.std(accuracies) if len(accuracies) > 1 else 0
        accuracy_mean = np.mean(accuracies) if accuracies else 0
        movement_weighted_std = np.std(movement_weighted_accuracies) if len(movement_weighted_accuracies) > 1 else 0
        movement_weighted_mean = np.mean(movement_weighted_accuracies) if movement_weighted_accuracies else 0

        entries_by_week = defaultdict(list)
        for entry in all_entries:
            if 'target_trading_datetime' in entry:
                try:
                    dt = datetime.fromisoformat(entry['target_trading_datetime'].replace('Z', '+00:00'))
                    week_key = f"{dt.year}-W{dt.isocalendar()[1]:02d}"
                    entries_by_week[week_key].append(entry)
                except ValueError:
                    continue

        weekly_portfolio_performance = {}
        for week, week_entries in entries_by_week.items():
            metrics = self.__calculate_accuracy_metrics(week_entries)
            weekly_portfolio_performance[week] = {
                **metrics,
                'symbols': len(set(entry.get('symbol', 'unknown') for entry in week_entries))
            }

        return {
            'symbols_analyzed': symbols_count,
            'symbol_accuracies': symbol_accuracies,
            'best_performer': best_symbol,
            'worst_performer': worst_symbol,
            'consistency': {
                'accuracy_std': accuracy_std,
                'accuracy_mean': accuracy_mean,
                'movement_weighted_std': movement_weighted_std,
                'movement_weighted_mean': movement_weighted_mean,
                'coefficient_of_variation': (accuracy_std / accuracy_mean) if accuracy_mean > 0 else 0
            },
            'weekly_portfolio_performance': weekly_portfolio_performance,
            'coverage': {
                'total_predictions': len(all_entries),
                'avg_predictions_per_symbol': len(all_entries) / symbols_count if symbols_count > 0 else 0
            }
        }

    def _rank_symbols_by_performance(self, symbol_results: Dict[str, Dict]) -> List[Dict]:
        rankings = []
        for symbol, data in symbol_results.items():
            entries = data['entries']
            metrics = self.__calculate_accuracy_metrics(entries)

            price_errors = {}
            for timepoint in ['pre_market', 'market_open', 'market_close', 'after_hours']:
                errors = [
                    entry.get('models', {}).get('master', {}).get('accuracy', {}).get(timepoint, {}).get(
                        'abs_percent_diff',
                        0)
                    for entry in entries if timepoint in entry.get('models', {}).get('master', {}).get('accuracy', {})
                ]
                price_errors[timepoint] = np.mean(errors) if errors else None

            confidences, correct_predictions = [], []
            for entry in entries:
                confidence_obj = entry.get('confidence', {})
                action = entry.get('action', 'HOLD').lower()
                if isinstance(confidence_obj, dict) and action in confidence_obj:
                    confidences.append(confidence_obj[action])
                    correct_predictions.append(
                        1.0 if entry.get('directional_accuracy', {}).get('is_correct', False) else 0.0)

            confidence_correlation = self._calculate_safe_correlation(confidences, correct_predictions) if len(
                confidences) > 2 else None

            rankings.append({
                'symbol': symbol,
                'directional_accuracy': metrics['accuracy'],
                'movement_weighted_accuracy': metrics['movement_weighted_accuracy'],
                'return_accuracy': metrics['return_accuracy']['avg_error'],
                'return_accuracy_bias': metrics['return_accuracy']['bias'],
                'correct_predictions': metrics['correct'],
                'total_predictions': metrics['total'],
                'price_errors': price_errors,
                'confidence_correlation': confidence_correlation if confidence_correlation != 0.0 else None,
                'prediction_frequency': metrics['total']
            })

        rankings.sort(key=lambda x: (x['movement_weighted_accuracy'], x['directional_accuracy'], x['total_predictions']),
                      reverse=True)

        for i, ranking in enumerate(rankings):
            ranking['rank'] = i + 1
            accuracy = ranking['movement_weighted_accuracy']
            if accuracy >= 70:
                ranking['tier'] = 'Excellent'
            elif accuracy >= 60:
                ranking['tier'] = 'Good'
            elif accuracy >= 50:
                ranking['tier'] = 'Average'
            else:
                ranking['tier'] = 'Poor'

        return rankings

    def _calculate_symbol_specific_metrics(self, symbol_entries: List[Dict]) -> Optional[Dict]:
        if not symbol_entries:
            return None

        overall_metrics = self.__calculate_accuracy_metrics(symbol_entries)
        action_entries = defaultdict(list)
        for entry in symbol_entries:
            action_entries[entry.get('action', 'HOLD')].append(entry)

        action_breakdown = {}
        for action, entries in action_entries.items():
            metrics = self.__calculate_accuracy_metrics(entries)
            action_breakdown[action] = {
                'total': metrics['total'],
                'correct': metrics['correct'],
                'accuracy': metrics['accuracy'],
                'movement_weighted_accuracy': metrics['movement_weighted_accuracy'],
                'return_accuracy': metrics['return_accuracy']
            }

        price_errors = {}
        for timepoint in ['pre_market', 'market_open', 'market_close', 'after_hours']:
            errors = [
                entry.get('models', {}).get('master', {}).get('accuracy', {}).get(timepoint, {}).get(
                    'abs_percent_diff')
                for entry in symbol_entries if
                timepoint in entry.get('models', {}).get('master', {}).get('accuracy', {})
            ]
            valid_errors = [e for e in errors if e is not None]
            price_errors[timepoint] = np.mean(valid_errors) if valid_errors else None

        return {
            'total_predictions': overall_metrics['total'],
            'correct_predictions': overall_metrics['correct'],
            'directional_accuracy': overall_metrics['accuracy'],
            'movement_weighted_accuracy': overall_metrics['movement_weighted_accuracy'],
            'return_accuracy': overall_metrics['return_accuracy'],
            'action_breakdown': action_breakdown,
            'price_errors': price_errors,
            'price_ratings': {tp: self._get_rating(err) if err is not None else 'N/A' for tp, err in
                              price_errors.items()}
        }

    def _create_empty_response(self, single_symbol_mode: bool) -> Dict[str, Any]:
        base_response = {
            'entries': [],
            'portfolio_metrics': None,
            'accuracy_metrics': self._calculate_overall_accuracy_metrics([]),
            'model_comparison': self._compare_prediction_models([]),
            'weekly_performance': None,
            'trends': None,
            'confidence_correlation': None,
            'magnitude_analysis': None,
            'movement_weighted_metrics': None,
            'movement_detection': None,
            'metadata': {
                'processed_count': 0,
                'total_count': 0,
                'symbols_count': 0,
                'symbols': [],
                'mode': 'single_symbol' if single_symbol_mode else 'portfolio'
            }
        }

        if not single_symbol_mode:
            base_response['portfolio_specific'] = None
            base_response['symbol_performance'] = []
            base_response['symbol_results'] = {}

        return base_response

    def __get_model_hourly_predictions(self, rec: Dict, model_name: str) -> List[Dict]:
        mp = rec.get('model_predictions')
        if isinstance(mp, dict):
            md = mp.get(model_name)
            if isinstance(md, dict):
                hp = md.get('hourlyPrices') or md.get('hourly_prices')
                if isinstance(hp, list):
                    return hp

        if model_name == 'master':
            preds = rec.get('predictions')
            if isinstance(preds, dict):
                ntd = preds.get('nextTradingDay')
                if isinstance(ntd, dict):
                    hp = ntd.get('hourlyPrices') or ntd.get('hourly_prices')
                    if isinstance(hp, list):
                        return hp

        analysis_field = {
            'image': 'image_analysis',
            'options': 'options_analysis',
            'vibe': 'vibe_analysis',
            'master': 'predictionSynthesis'
        }.get(model_name)

        if analysis_field and isinstance(rec.get(analysis_field), str):
            return self._extract_hourly_predictions(rec.get(analysis_field) or '')

        return []

    async def _process_single_recommendation(self, rec: Dict, all_price_data: Dict,
                                             current_date: datetime.date) -> Optional[Dict]:

        if not rec.get('target_trading_datetime') or not rec.get('timestamp'):
            return None

        try:
            target_dt = datetime.fromisoformat(rec['target_trading_datetime'].replace('Z', '+00:00'))
            if target_dt.tzinfo is None:
                target_dt = pytz.UTC.localize(target_dt)
        except Exception:
            return None

        try:
            prediction_dt_utc = datetime.fromisoformat(rec['timestamp'].replace('Z', '+00:00'))
            if prediction_dt_utc.tzinfo is None:
                prediction_dt_utc = pytz.UTC.localize(prediction_dt_utc)
        except Exception:
            prediction_dt_utc = None

        target_dt_eastern = target_dt.astimezone(self.eastern_tz)
        target_date = target_dt_eastern.date()
        target_date_str = target_date.isoformat()

        if target_date >= current_date:
            await log_service.info(f"Skipping {target_date_str} - day not complete yet (current: {current_date})")
            return None

        day_prices = all_price_data.get(target_date_str)
        if not isinstance(day_prices, list) or not day_prices:
            await log_service.info(f"Skipping {target_date_str} - no price data available")
            return None

        master_predictions = self.__get_model_hourly_predictions(rec, 'master')
        image_predictions = self.__get_model_hourly_predictions(rec, 'image')
        options_predictions = self.__get_model_hourly_predictions(rec, 'options')
        vibe_predictions = self.__get_model_hourly_predictions(rec, 'vibe')

        if not master_predictions:
            await log_service.info(f"Skipping {target_date_str} - no hourly predictions for master model")
            return None

        price_field = None
        first_point = day_prices[0]
        if isinstance(first_point, dict):
            if 'symbol_price' in first_point:
                price_field = 'symbol_price'
            elif 'price' in first_point:
                price_field = 'price'
        if not price_field:
            await log_service.info(f"Skipping {target_date_str} - cannot determine price field")
            return None

        processed_data: List[Dict[str, Any]] = []
        for p in day_prices:
            try:
                ts = p.get('timestamp')
                if not ts:
                    continue
                dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                if dt.tzinfo is None:
                    dt = pytz.UTC.localize(dt)
                dt_eastern = dt.astimezone(self.eastern_tz)
                processed_data.append({
                    'timestamp': ts,
                    'utc_dt': dt,
                    'eastern_dt': dt_eastern,
                    'eastern_time': dt_eastern.strftime('%H:%M:%S'),
                    'price': p.get(price_field)
                })
            except Exception:
                continue

        master_timepoints = self._extract_timepoint_prices(master_predictions)
        image_timepoints = self._extract_timepoint_prices(image_predictions)
        options_timepoints = self._extract_timepoint_prices(options_predictions)
        vibe_timepoints = self._extract_timepoint_prices(vibe_predictions)

        actual_timepoints_data = self._extract_actual_timepoints(processed_data)
        actual_timepoints = {tp: (d.get('price') if isinstance(d, dict) else None)
                             for tp, d in actual_timepoints_data.items()}

        if not actual_timepoints.get('market_open') or not actual_timepoints.get('market_close'):
            await log_service.info(f"Skipping {target_date_str} - no market open/close actual data")
            return None

        missing = [tp for tp in ('pre_market', 'after_hours') if not actual_timepoints.get(tp)]
        if missing:
            await log_service.info(f"Processing {target_date_str} with missing data: {', '.join(missing)}")

        master_accuracy = self._calculate_price_accuracy(master_timepoints, actual_timepoints_data,
                                                         prediction_dt_utc)
        image_accuracy = self._calculate_price_accuracy(image_timepoints, actual_timepoints_data,
                                                        prediction_dt_utc)
        options_accuracy = self._calculate_price_accuracy(options_timepoints, actual_timepoints_data,
                                                          prediction_dt_utc)
        vibe_accuracy = self._calculate_price_accuracy(vibe_timepoints, actual_timepoints_data,
                                                       prediction_dt_utc)

        directional_accuracy = self._calculate_directional_accuracy(
            rec.get('action', 'HOLD'),
            actual_timepoints.get('market_open'),
            actual_timepoints.get('market_close')
        )

        return_accuracies: Dict[str, Any] = {}
        for model_name, tps in (('master', master_timepoints),
                                ('image', image_timepoints),
                                ('options', options_timepoints),
                                ('vibe', vibe_timepoints)):
            ra = self._calculate_return_accuracy(tps, actual_timepoints)
            if ra:
                return_accuracies[model_name] = ra

        if directional_accuracy and 'master' in return_accuracies:
            directional_accuracy['return_accuracy'] = return_accuracies['master']

        movement_weight = self._calculate_movement_weight(
            directional_accuracy.get('is_correct', False),
            directional_accuracy.get('abs_price_change', 0)
        )

        volatility_assessment = self._assess_volatility(actual_timepoints, rec.get('volatility', ''))

        prediction_quality = self._calculate_prediction_quality(
            master_timepoints,
            image_timepoints,
            options_timepoints,
            actual_timepoints
        )

        predicted_data = {}
        if 'predicted' in rec and isinstance(rec['predicted'], dict):
            predicted_data = rec['predicted']

        signal_accuracy_data = {}

        for model_name in ['options', 'image', 'vibe', 'master']:
            analysis_text = ''
            if model_name == 'master':
                log_content = rec.get('signalReliabilityLog', '')
                if log_content:
                    analysis_text = f"[SIGNAL RELIABILITY LOG]\n{log_content}"
            else:
                analysis_text = rec.get(f'{model_name}_analysis', '')

            if analysis_text:
                extracted_signals = self.signal_helper.extract_signals_from_analysis(analysis_text, model_name)

                if extracted_signals:
                    processed_signals = []
                    for signal in extracted_signals:
                        signal_directional_accuracy = self._calculate_directional_accuracy(
                            signal['predicted_direction'],
                            actual_timepoints.get('market_open'),
                            actual_timepoints.get('market_close')
                        )

                        if signal_directional_accuracy:
                            signal['is_correct'] = signal_directional_accuracy.get('is_correct', False)
                            signal['actual_direction'] = self._determine_actual_direction_from_prices(
                                actual_timepoints.get('market_open'),
                                actual_timepoints.get('market_close')
                            )
                            signal['price_change_pct'] = signal_directional_accuracy.get('price_change', 0)
                            processed_signals.append(signal)

                    if processed_signals:
                        signal_aggregates = self.signal_helper.calculate_signal_aggregates(processed_signals)
                        signal_accuracy_data[model_name] = {
                            'signal_results': processed_signals,
                            **signal_aggregates
                        }

        return {
            'timestamp': rec.get('timestamp'),
            'target_trading_datetime': rec.get('target_trading_datetime'),
            'action': rec.get('action', 'HOLD'),
            'confidence': rec.get('confidence', {'buy': 0, 'hold': 0, 'sell': 0}),
            'predicted': predicted_data,
            'actual': actual_timepoints,
            'models': {
                'master': {'timepoints': master_timepoints, 'accuracy': master_accuracy},
                'image': {'timepoints': image_timepoints, 'accuracy': image_accuracy},
                'options': {'timepoints': options_timepoints, 'accuracy': options_accuracy},
                'vibe': {'timepoints': vibe_timepoints, 'accuracy': vibe_accuracy},
            },
            'directional_accuracy': directional_accuracy,
            'return_accuracies': return_accuracies,
            'movement_weight': movement_weight,
            'volatility_assessment': volatility_assessment,
            'prediction_quality': prediction_quality,
            'signal_accuracy': signal_accuracy_data,
            'day_of_week': target_dt_eastern.strftime('%A'),
            'week_of_year': target_dt_eastern.isocalendar()[1]
        }

    def _calculate_movement_weight(self, is_correct: bool, abs_price_change: float) -> float:
        magnitude_info = self._classify_movement_magnitude_detailed(abs_price_change)
        base_weight = max(1.0, magnitude_info['level'] ** 1.5)
        return base_weight if is_correct else 0

    def _extract_hourly_predictions(self, analysis_text: str) -> List[Dict]:
        if not analysis_text:
            return []

        predictions = []
        predictions_section = re.search(r'\[HOURLY PRICE PREDICTIONS.*?](.*?)(?=\n\[|$)', analysis_text, re.DOTALL)

        if predictions_section:
            pattern = r'[-â€¢]\s*(\d{1,2}:\d{2}):\s*\$(\d+\.\d+)\s*\(([^)]+)\)'
            for match in re.finditer(pattern, predictions_section.group(1)):
                hour, price, session = match.groups()
                try:
                    predictions.append({
                        "hour": hour,
                        "price": float(price),
                        "session": session.strip().lower()
                    })
                except ValueError:
                    continue

        return predictions

    def _extract_timepoint_prices(self, hourly_predictions: List[Dict]) -> Dict[str, Optional[float]]:
        timepoints = {
            'pre_market': None,
            'market_open': None,
            'market_close': None,
            'after_hours': None
        }

        pre_market = next((p for p in hourly_predictions if p["hour"] == "07:00"), None)
        if not pre_market:
            pre_market = next((p for p in hourly_predictions if "pre-market" in p["session"]), None)
        if pre_market:
            timepoints['pre_market'] = pre_market['price']

        market_open = next((p for p in hourly_predictions if p["hour"] == "09:30"), None)
        if not market_open:
            market_open = next((p for p in hourly_predictions if "market open" in p["session"]), None)
        if market_open:
            timepoints['market_open'] = market_open['price']

        market_close = next((p for p in hourly_predictions if p["hour"] == "16:00"), None)
        if not market_close:
            market_close = next((p for p in hourly_predictions if "market close" in p["session"]), None)
        if market_close:
            timepoints['market_close'] = market_close['price']

        after_hours = next((p for p in hourly_predictions if p["hour"] == "20:00"), None)
        if not after_hours:
            after_hours = next((p for p in hourly_predictions if "after-hours" in p["session"]), None)
        if after_hours:
            timepoints['after_hours'] = after_hours['price']

        return timepoints

    def __find_closest_price_point(self, data: List[Dict], target_time: time) -> Optional[Dict]:
        if not data:
            return None
        closest_point = min(data, key=lambda p: abs(p['eastern_dt'].hour - target_time.hour))
        return closest_point

    def _extract_actual_timepoints(self, processed_data: List[Dict]) -> Dict[str, Optional[Dict]]:
        timepoints = {
            'pre_market': None, 'market_open': None, 'market_close': None,
            'after_hours': None, 'high': None, 'low': None
        }

        pre_market_data = [p for p in processed_data if p['eastern_dt'].time() < time(9, 30)]
        regular_hours_data = [p for p in processed_data if time(9, 30) <= p['eastern_dt'].time() < time(16, 0)]
        after_hours_data = [p for p in processed_data if p['eastern_dt'].time() >= time(16, 0)]

        timepoints['pre_market'] = self.__find_closest_price_point(pre_market_data, time(7, 0))

        market_open_window = [p for p in processed_data if time(9, 29) <= p['eastern_dt'].time() <= time(9, 31)]
        if market_open_window:
            timepoints['market_open'] = market_open_window[0]
        else:
            fallback_open_window = [p for p in processed_data if time(9, 25) <= p['eastern_dt'].time() <= time(9, 35)]
            if fallback_open_window:
                timepoints['market_open'] = fallback_open_window[0]

        market_close_window = [p for p in processed_data if time(15, 59) <= p['eastern_dt'].time() <= time(16, 1)]
        if market_close_window:
            timepoints['market_close'] = market_close_window[-1]
        else:
            fallback_close_window = [p for p in processed_data if time(15, 55) <= p['eastern_dt'].time() <= time(16, 5)]
            if fallback_close_window:
                timepoints['market_close'] = fallback_close_window[-1]

        valid_after_hours = [p for p in after_hours_data if p['eastern_dt'].time() <= time(20, 0)]
        timepoints['after_hours'] = self.__find_closest_price_point(valid_after_hours, time(20, 0))

        if regular_hours_data:
            prices = [p['price'] for p in regular_hours_data if p.get('price') is not None]
            if prices:
                timepoints['high'] = {'price': max(prices)}
                timepoints['low'] = {'price': min(prices)}

        return timepoints

    def _calculate_price_accuracy(self, predicted_timepoints: Dict[str, Optional[float]],
                                  actual_timepoints_data: Dict[str, Optional[Dict]],
                                  prediction_dt_utc: datetime) -> Dict[str, Dict]:
        accuracy = {}

        for timepoint in ['pre_market', 'market_open', 'market_close', 'after_hours']:
            pred = predicted_timepoints.get(timepoint)
            actual_data = actual_timepoints_data.get(timepoint)
            actual = actual_data.get('price') if actual_data else None

            if pred is not None and actual is not None:
                diff = actual - pred
                percent_diff = (diff / pred) * 100 if pred != 0 else 0
                abs_percent_diff = abs(percent_diff)
                rating = self._get_rating(abs_percent_diff)

                actual_dt_utc = actual_data.get('utc_dt')
                timedelta_minutes = None
                is_known = None

                if actual_dt_utc and prediction_dt_utc:
                    timedelta_minutes = round((actual_dt_utc - prediction_dt_utc).total_seconds() / 60)
                    is_known = timedelta_minutes < 0

                accuracy[timepoint] = {
                    'predicted': pred,
                    'actual': actual,
                    'diff': diff,
                    'percent_diff': percent_diff,
                    'abs_percent_diff': abs_percent_diff,
                    'rating': rating,
                    'prediction_timedelta_minutes': timedelta_minutes,
                    'is_known': is_known
                }

        return accuracy

    def _calculate_return_accuracy(self, predicted_timepoints: Dict, actual_timepoints: Dict) -> Optional[Dict]:
        pred_open = predicted_timepoints.get('market_open')
        pred_close = predicted_timepoints.get('market_close')
        actual_open = actual_timepoints.get('market_open')
        actual_close = actual_timepoints.get('market_close')

        if not all(isinstance(val, (int, float)) for val in [pred_open, pred_close, actual_open, actual_close]):
            return None

        if pred_open == 0 or actual_open == 0:
            return None

        predicted_return_percent = ((pred_close - pred_open) / pred_open) * 100
        actual_return_percent = ((actual_close - actual_open) / actual_open) * 100
        return_error_percent = abs(predicted_return_percent - actual_return_percent)

        if return_error_percent < 10:
            rating = "Excellent"
        elif return_error_percent < 25:
            rating = "Good"
        elif return_error_percent < 50:
            rating = "Fair"
        else:
            rating = "Poor"

        return {
            'predicted_return_percent': predicted_return_percent,
            'actual_return_percent': actual_return_percent,
            'return_error_percent': return_error_percent,
            'rating': rating
        }

    def _calculate_directional_accuracy(self, action: str, open_price: Optional[float],
                                        close_price: Optional[float]) -> Optional[
        Dict]:
        if open_price is None or close_price is None:
            return None

        percent_change = ((close_price - open_price) / open_price) * 100
        direction = "up" if percent_change >= 0 else "down"
        abs_percent_change = abs(percent_change)

        magnitude = self._classify_movement_magnitude(abs_percent_change)

        if action == "BUY":
            is_correct = direction == "up"
            explanation = "Correct - Price rose" if is_correct else "Incorrect - Price fell"
            score = percent_change if is_correct else -abs_percent_change
        elif action == "SELL":
            is_correct = direction == "down"
            explanation = "Correct - Price fell" if is_correct else "Incorrect - Price rose"
            score = abs_percent_change if is_correct else -percent_change
        else:
            is_correct = abs(percent_change) <= 0.5
            if is_correct:
                explanation = f"Correct - Price moved {percent_change:.2f}%, within the Â±0.5% HOLD threshold."
            else:
                explanation = f"Incorrect - Price moved {percent_change:.2f}%, which is outside the Â±0.5% HOLD threshold."
            score = percent_change

        return {
            'action': action,
            'price_change': percent_change,
            'abs_price_change': abs_percent_change,
            'is_correct': is_correct,
            'explanation': explanation,
            'magnitude': magnitude,
            'score': score
        }

    def _determine_actual_direction_from_prices(self, open_price: Optional[float], close_price: Optional[float]) -> str:
        if open_price is None or close_price is None:
            return 'UNKNOWN'

        percent_change = ((close_price - open_price) / open_price) * 100

        if abs(percent_change) <= 0.5:
            return 'HOLD'
        elif percent_change >= 0:
            return 'BUY'
        else:
            return 'SELL'

    def _assess_volatility(self, actual_timepoints: Dict[str, Optional[float]],
                           volatility_prediction: str) -> Optional[Dict]:
        if not actual_timepoints or not actual_timepoints.get('high') or not actual_timepoints.get('low'):
            return None

        open_price = actual_timepoints.get('market_open')
        if not open_price or open_price == 0:
            return None

        high = actual_timepoints.get('high')
        low = actual_timepoints.get('low')

        range_percent = ((high - low) / open_price) * 100

        if range_percent > 3:
            actual_volatility = "HIGH"
        elif range_percent > 1:
            actual_volatility = "MEDIUM"
        else:
            actual_volatility = "LOW"

        if volatility_prediction and "HIGH" in volatility_prediction.upper():
            predicted_volatility = "HIGH"
        elif volatility_prediction and "LOW" in volatility_prediction.upper():
            predicted_volatility = "LOW"
        else:
            predicted_volatility = "MEDIUM"

        is_correct = predicted_volatility == actual_volatility

        return {
            'predicted': predicted_volatility,
            'actual': actual_volatility,
            'range_percent': range_percent,
            'is_correct': is_correct
        }

    def _classify_movement_magnitude(self, percentage_change: float) -> str:
        if percentage_change < 0.5:
            return "Minimal"
        elif percentage_change < 1.0:
            return "Low"
        elif percentage_change < 2.5:
            return "Moderate"
        elif percentage_change < 5.0:
            return "Significant"
        else:
            return "Extreme"

    def _calculate_magnitude_based_accuracy(self, prediction_entries: List[Dict]) -> Optional[Dict]:
        if not prediction_entries:
            return None

        magnitude_stats = defaultdict(lambda: {'total': 0, 'correct': 0, 'movements': []})

        for entry in prediction_entries:
            if entry.get('action', 'HOLD') == 'HOLD':
                continue

            directional_acc = entry.get('directional_accuracy')
            if not directional_acc:
                continue

            abs_change = directional_acc.get('abs_price_change', 0)
            is_correct = directional_acc.get('is_correct', False)
            magnitude_info = self._classify_movement_magnitude_detailed(abs_change)

            tier = magnitude_info['tier']
            magnitude_stats[tier]['total'] += 1
            magnitude_stats[tier]['movements'].append(abs_change)

            if is_correct:
                magnitude_stats[tier]['correct'] += 1

        results = {}
        tier_order = ['Noise', 'Minor', 'Small', 'Moderate', 'Large', 'Major', 'Extreme']

        active_predictions = [e for e in prediction_entries if e.get('action', 'HOLD') != 'HOLD']
        total_active_count = len(active_predictions)

        for tier in tier_order:
            if tier in magnitude_stats:
                stats = magnitude_stats[tier]
                accuracy = (stats['correct'] / stats['total'] * 100) if stats['total'] > 0 else 0
                avg_movement = np.mean(stats['movements']) if stats['movements'] else 0

                results[tier] = {
                    'total_predictions': stats['total'],
                    'correct_predictions': stats['correct'],
                    'accuracy': accuracy,
                    'avg_movement': avg_movement,
                    'percentage_of_total': (stats[
                                                'total'] / total_active_count) * 100 if total_active_count > 0 else 0
                }

        significant_moves = {}
        for tier in ['Large', 'Major', 'Extreme']:
            if tier in results:
                significant_moves[tier] = results[tier]

        total_significant = sum(data['total_predictions'] for data in significant_moves.values())
        correct_significant = sum(data['correct_predictions'] for data in significant_moves.values())
        significant_accuracy = (correct_significant / total_significant * 100) if total_significant > 0 else 0

        return {
            'by_magnitude': results,
            'significant_moves_summary': {
                'total_significant': total_significant,
                'correct_significant': correct_significant,
                'significant_accuracy': significant_accuracy,
                'percentage_significant': (
                                                      total_significant / total_active_count) * 100 if total_active_count > 0 else 0
            },
            'impact_distribution': {
                tier: results.get(tier, {}).get('percentage_of_total', 0)
                for tier in tier_order
            }
        }

    def _calculate_movement_weighted_metrics(self, prediction_entries: List[Dict]) -> Optional[Dict]:
        if not prediction_entries:
            return None

        movement_weighted_accuracy = self.__calculate_movement_weighted_accuracy(prediction_entries)

        value_weighted_correct = 0
        value_weighted_total = 0
        high_movement_predictions = []
        missed_opportunities = []

        for entry in prediction_entries:
            directional_acc = entry.get('directional_accuracy')
            if not directional_acc:
                continue

            abs_change = directional_acc.get('abs_price_change', 0)
            is_correct = directional_acc.get('is_correct', False)
            action = entry.get('action', 'HOLD')
            magnitude_info = self._classify_movement_magnitude_detailed(abs_change)
            impact_level = magnitude_info['level']

            value_weighted_total += abs_change
            if is_correct:
                value_weighted_correct += abs_change

            if impact_level >= 4:
                prediction_data = {
                    'date': entry.get('target_trading_datetime', ''),
                    'symbol': entry.get('symbol', ''),
                    'action': action,
                    'movement': directional_acc.get('price_change', 0),
                    'abs_movement': abs_change,
                    'is_correct': is_correct,
                    'magnitude_tier': magnitude_info['tier'],
                    'impact_level': impact_level
                }

                if is_correct and action != 'HOLD':
                    high_movement_predictions.append(prediction_data)
                elif not is_correct and abs_change >= 2.5:
                    missed_opportunities.append(prediction_data)

        value_capture_rate = (value_weighted_correct / value_weighted_total * 100) if value_weighted_total > 0 else None

        rating_score = movement_weighted_accuracy
        if rating_score >= 70:
            overall_rating = "Excellent"
        elif rating_score >= 60:
            overall_rating = "Good"
        elif rating_score >= 50:
            overall_rating = "Fair"
        else:
            overall_rating = "Needs Improvement"

        return {
            'movement_weighted_accuracy': movement_weighted_accuracy,
            'value_capture_rate': value_capture_rate,
            'high_movement_wins': len(high_movement_predictions),
            'missed_opportunities': len(missed_opportunities),
            'top_wins': sorted(high_movement_predictions, key=lambda x: x['abs_movement'], reverse=True)[:5],
            'worst_misses': sorted(missed_opportunities, key=lambda x: x['abs_movement'], reverse=True)[:5],
            'overall_rating': overall_rating
        }

    def _analyze_movement_detection(self, prediction_entries: List[Dict]) -> Optional[Dict]:
        if not prediction_entries:
            return None

        significant_move_threshold = 2.5
        major_move_threshold = 4.0

        actual_significant_moves = []
        predicted_actions = []

        for entry in prediction_entries:
            directional_acc = entry.get('directional_accuracy')
            if not directional_acc:
                continue

            abs_change = directional_acc.get('abs_price_change', 0)
            action = entry.get('action', 'HOLD')
            is_correct = directional_acc.get('is_correct', False)

            if abs_change >= significant_move_threshold:
                actual_significant_moves.append({
                    'movement': abs_change,
                    'was_predicted_active': action != 'HOLD',
                    'was_predicted_correctly': is_correct,
                    'action_taken': action,
                    'is_major': abs_change >= major_move_threshold
                })

            predicted_actions.append({
                'action': action,
                'was_significant_move': abs_change >= significant_move_threshold,
                'was_correct': is_correct,
                'movement': abs_change
            })

        if not actual_significant_moves:
            return None

        detected_significant_moves = sum(1 for move in actual_significant_moves if move['was_predicted_active'])
        detection_rate = (detected_significant_moves / len(actual_significant_moves)) * 100

        correctly_predicted_significant_moves = sum(
            1 for move in actual_significant_moves if move['was_predicted_correctly'])
        significant_move_accuracy = (correctly_predicted_significant_moves / len(actual_significant_moves)) * 100

        total_predictions = len(predicted_actions)
        if total_predictions > 0:
            correct_actions = sum(1 for p in predicted_actions if p['was_correct'])
            precision = (correct_actions / total_predictions) * 100
            false_alarm_rate = 100.0 - precision
        else:
            precision = None
            false_alarm_rate = None

        major_moves = [move for move in actual_significant_moves if move['is_major']]
        major_detection_rate = 0
        if major_moves:
            detected_major = sum(1 for move in major_moves if move['was_predicted_active'])
            major_detection_rate = (detected_major / len(major_moves)) * 100

        non_hold_predictions_count = sum(1 for p in predicted_actions if p['action'] != 'HOLD')

        return {
            'significant_move_detection_rate': detection_rate,
            'significant_move_accuracy': significant_move_accuracy,
            'false_alarm_rate': false_alarm_rate,
            'precision_rate': precision,
            'major_move_detection_rate': major_detection_rate,
            'total_significant_moves': len(actual_significant_moves),
            'total_major_moves': len(major_moves),
            'predicted_moves': non_hold_predictions_count,
            'detection_quality': self._get_detection_quality_rating(detection_rate, false_alarm_rate),
            'move_distribution': {
                'significant_moves_percentage': (len(actual_significant_moves) / len(prediction_entries)) * 100,
                'major_moves_percentage': (len(major_moves) / len(prediction_entries)) * 100
            }
        }

    def _get_movement_rating(self, movement_accuracy: float) -> str:
        if movement_accuracy >= 75:
            return "Excellent"
        elif movement_accuracy >= 65:
            return "Good"
        elif movement_accuracy >= 55:
            return "Fair"
        elif movement_accuracy >= 45:
            return "Poor"
        else:
            return "Needs Improvement"

    def _get_detection_quality_rating(self, detection_rate: float, false_alarm_rate: float) -> str:
        if detection_rate >= 70 and false_alarm_rate <= 30:
            return "Excellent"
        elif detection_rate >= 60 and false_alarm_rate <= 40:
            return "Good"
        elif detection_rate >= 50 >= false_alarm_rate:
            return "Fair"
        elif detection_rate >= 40:
            return "Poor"
        else:
            return "Needs Improvement"

    def _calculate_prediction_quality(self, master_timepoints: Dict, image_timepoints: Dict, options_timepoints: Dict,
                                      actual_timepoints: Dict) -> Dict[str, Any]:
        quality = {
            'consistency': self._assess_model_consistency(master_timepoints, image_timepoints, options_timepoints),
            'accuracy_ranking': self._rank_models_by_accuracy(master_timepoints, image_timepoints,
                                                              options_timepoints,
                                                              actual_timepoints),
            'overall_success': None
        }

        if not quality['accuracy_ranking'] or len(quality['accuracy_ranking']) == 0:
            return quality

        best_avg_diff = quality['accuracy_ranking'][0].get('avg_diff')

        if best_avg_diff is not None:
            if best_avg_diff < 1.0:
                quality['overall_success'] = 'Excellent'
            elif best_avg_diff < 2.5:
                quality['overall_success'] = 'Good'
            elif best_avg_diff < 5.0:
                quality['overall_success'] = 'Adequate'
            else:
                quality['overall_success'] = 'Poor'

        return quality

    def _assess_model_consistency(self, master_timepoints: Dict, image_timepoints: Dict,
                                  options_timepoints: Dict) -> Optional[
        Dict]:
        has_master = master_timepoints and (
                master_timepoints.get('market_open') or master_timepoints.get('market_close'))
        has_image = image_timepoints and (image_timepoints.get('market_open') or image_timepoints.get('market_close'))
        has_options = options_timepoints and (
                options_timepoints.get('market_open') or options_timepoints.get('market_close'))

        if not (has_master and has_image and has_options):
            return None

        consistency_scores = {}

        for timepoint in ['market_open', 'market_close']:
            master_value = master_timepoints.get(timepoint)
            image_value = image_timepoints.get(timepoint)
            options_value = options_timepoints.get(timepoint)

            values = [v for v in [master_value, image_value, options_value] if v is not None]
            if len(values) <= 1:
                continue

            avg = sum(values) / len(values)
            if avg == 0:
                continue

            devs = [abs((v - avg) / avg * 100) for v in values]
            max_dev = max(devs)

            if max_dev < 0.5:
                rating = "Very High"
            elif max_dev < 1.0:
                rating = "High"
            elif max_dev < 2.0:
                rating = "Moderate"
            elif max_dev < 4.0:
                rating = "Low"
            else:
                rating = "Very Low"

            consistency_scores[timepoint] = {
                'max_deviation_percent': max_dev,
                'rating': rating
            }

        if not consistency_scores:
            return None

        avg_max_dev = sum(score['max_deviation_percent'] for score in consistency_scores.values()) / len(
            consistency_scores)

        if avg_max_dev < 0.5:
            overall_rating = "Very High"
        elif avg_max_dev < 1.0:
            overall_rating = "High"
        elif avg_max_dev < 2.0:
            overall_rating = "Moderate"
        elif avg_max_dev < 4.0:
            overall_rating = "Low"
        else:
            overall_rating = "Very Low"

        return {
            'timepoints': consistency_scores,
            'overall': {
                'avg_max_deviation': avg_max_dev,
                'rating': overall_rating
            }
        }

    def _rank_models_by_accuracy(self, master_timepoints: Dict, image_timepoints: Dict, options_timepoints: Dict,
                                 actual_timepoints: Dict) -> Optional[List[Dict]]:
        if not actual_timepoints:
            return None

        model_errors = {
            'master': self._calculate_model_error(master_timepoints, actual_timepoints),
            'image': self._calculate_model_error(image_timepoints, actual_timepoints),
            'options': self._calculate_model_error(options_timepoints, actual_timepoints)
        }

        valid_models = {name: error for name, error in model_errors.items() if error is not None}
        if not valid_models:
            return None

        ranking = [{'model': name, 'avg_diff': error} for name, error in valid_models.items()]
        ranking.sort(key=lambda x: x['avg_diff'])

        for i, model in enumerate(ranking):
            model['rank'] = i + 1
            if model['avg_diff'] < 0.5:
                model['rating'] = "Excellent"
            elif model['avg_diff'] < 1.5:
                model['rating'] = "Good"
            elif model['avg_diff'] < 3:
                model['rating'] = "Fair"
            elif model['avg_diff'] < 5:
                model['rating'] = "Poor"
            else:
                model['rating'] = "Missed"

        return ranking

    def _calculate_model_error(self, model_timepoints: Dict, actual_timepoints: Dict) -> Optional[float]:
        if not model_timepoints or not actual_timepoints:
            return None

        errors = []
        for timepoint in ['market_open', 'market_close']:
            predicted = model_timepoints.get(timepoint)
            actual = actual_timepoints.get(timepoint)

            if predicted is not None and actual is not None:
                error = abs((actual - predicted) / predicted * 100) if predicted != 0 else 0
                errors.append(error)

        if not errors:
            return None

        return sum(errors) / len(errors)

    def _calculate_portfolio_performance(self, prediction_entries: List[Dict]) -> Optional[Dict]:
        INITIAL_INVESTMENT = 10000

        if not prediction_entries:
            return None

        entries_by_symbol = defaultdict(list)
        for entry in prediction_entries:
            symbol = entry.get('symbol', 'UNKNOWN')
            entries_by_symbol[symbol].append(entry)

        num_symbols = len(entries_by_symbol)
        if num_symbols == 0:
            return None

        investment_per_symbol = INITIAL_INVESTMENT / num_symbols

        portfolio_results = {
            'strategy': 0,
            'buy_hold': 0,
            'perfect': 0,
            'worst': 0,
            'random': 0
        }

        all_histories = {
            'strategy': [],
            'buy_hold': [],
            'perfect': [],
            'worst': [],
            'random': []
        }

        symbol_performances = {}
        overall_trades = {
            'total': 0,
            'correct': 0,
            'winning': 0,
            'losing': 0,
            'winning_amount': 0.0,
            'losing_amount': 0.0
        }

        for symbol, symbol_entries in entries_by_symbol.items():
            sorted_entries = sorted(symbol_entries, key=lambda x: datetime.fromisoformat(
                x['target_trading_datetime'].replace('Z', '+00:00')))

            strategy_portfolio = {'cash': investment_per_symbol, 'shares': 0, 'value': investment_per_symbol}
            perfect_portfolio = {'cash': investment_per_symbol, 'shares': 0, 'value': investment_per_symbol}
            worst_portfolio = {'cash': investment_per_symbol, 'shares': 0, 'value': investment_per_symbol}
            random_portfolio = {'cash': investment_per_symbol, 'shares': 0, 'value': investment_per_symbol}

            first_open = None
            last_close = None

            symbol_trades = {
                'total': 0,
                'correct': 0,
                'winning': 0,
                'losing': 0,
                'winning_amount': 0.0,
                'losing_amount': 0.0
            }

            for entry in sorted_entries:
                action = entry.get('action', 'HOLD')
                open_price = entry['actual'].get('market_open')
                close_price = entry['actual'].get('market_close')

                if open_price is None or open_price == 0 or close_price is None:
                    continue

                if first_open is None:
                    first_open = open_price
                last_close = close_price

                is_up_day = close_price > open_price
                day_return = ((close_price - open_price) / open_price) * 100

                value_at_open = strategy_portfolio['cash'] + (strategy_portfolio['shares'] * open_price)
                cash_before_trade = strategy_portfolio['cash']
                shares_before_trade = strategy_portfolio['shares']

                if action == "BUY" and cash_before_trade > 0:
                    strategy_portfolio['shares'] = cash_before_trade / open_price
                    strategy_portfolio['cash'] = 0
                elif action == "SELL" and shares_before_trade > 0:
                    strategy_portfolio['cash'] = shares_before_trade * open_price
                    strategy_portfolio['shares'] = 0

                value_at_close = strategy_portfolio['cash'] + (strategy_portfolio['shares'] * close_price)
                trade_pl_cash = value_at_close - value_at_open
                strategy_portfolio['value'] = value_at_close

                if action == "BUY":
                    is_correct = is_up_day
                elif action == "SELL":
                    is_correct = not is_up_day
                else:
                    is_correct = day_return >= 0

                if action != "HOLD":
                    symbol_trades['total'] += 1
                    if is_correct:
                        symbol_trades['correct'] += 1

                    if trade_pl_cash > 0:
                        symbol_trades['winning'] += 1
                        symbol_trades['winning_amount'] += trade_pl_cash
                    elif trade_pl_cash < 0:
                        symbol_trades['losing'] += 1
                        symbol_trades['losing_amount'] += abs(trade_pl_cash)

                perfect_portfolio['value'] = perfect_portfolio['cash'] + (perfect_portfolio['shares'] * open_price)
                if is_up_day and perfect_portfolio['cash'] > 0:
                    perfect_portfolio['shares'] = perfect_portfolio['cash'] / open_price
                    perfect_portfolio['cash'] = 0
                elif not is_up_day and perfect_portfolio['shares'] > 0:
                    perfect_portfolio['cash'] = perfect_portfolio['shares'] * open_price
                    perfect_portfolio['shares'] = 0
                perfect_portfolio['value'] = perfect_portfolio['cash'] + (perfect_portfolio['shares'] * close_price)

                worst_portfolio['value'] = worst_portfolio['cash'] + (worst_portfolio['shares'] * open_price)
                if not is_up_day and worst_portfolio['cash'] > 0:
                    worst_portfolio['shares'] = worst_portfolio['cash'] / open_price
                    worst_portfolio['cash'] = 0
                elif is_up_day and worst_portfolio['shares'] > 0:
                    worst_portfolio['cash'] = worst_portfolio['shares'] * open_price
                    worst_portfolio['shares'] = 0
                worst_portfolio['value'] = worst_portfolio['cash'] + (worst_portfolio['shares'] * close_price)

                import random
                seed_string = f"{symbol}_{entry['target_trading_datetime']}"
                seed_hash = hashlib.md5(seed_string.encode()).hexdigest()
                seed_int = int(seed_hash, 16) % (2 ** 32)
                random.seed(seed_int)
                random_action = random.choice(["BUY", "SELL", "HOLD"])

                random_portfolio['value'] = random_portfolio['cash'] + (random_portfolio['shares'] * open_price)
                if random_action == "BUY" and random_portfolio['cash'] > 0:
                    random_portfolio['shares'] = random_portfolio['cash'] / open_price
                    random_portfolio['cash'] = 0
                elif random_action == "SELL" and random_portfolio['shares'] > 0:
                    random_portfolio['cash'] = random_portfolio['shares'] * open_price
                    random_portfolio['shares'] = 0
                random_portfolio['value'] = random_portfolio['cash'] + (random_portfolio['shares'] * close_price)

                date = datetime.fromisoformat(
                    entry['target_trading_datetime'].replace('Z', '+00:00')).date().isoformat()

                all_histories['strategy'].append({
                    'date': date,
                    'symbol': symbol,
                    'action': action,
                    'value': strategy_portfolio['value'],
                    'position': 'Long' if strategy_portfolio['shares'] > 0 else 'Cash',
                    'is_correct': is_correct,
                    'day_return': day_return,
                    'trade_pl': trade_pl_cash
                })

            buy_hold_value = investment_per_symbol
            if first_open and last_close:
                buy_hold_return = ((last_close - first_open) / first_open) * 100
                buy_hold_value = investment_per_symbol * (1 + buy_hold_return / 100)

            symbol_performances[symbol] = {
                'investment': investment_per_symbol,
                'strategy_value': strategy_portfolio['value'],
                'buy_hold_value': buy_hold_value,
                'perfect_value': perfect_portfolio['value'],
                'worst_value': worst_portfolio['value'],
                'random_value': random_portfolio['value'],
                'strategy_return': ((strategy_portfolio[
                                         'value'] - investment_per_symbol) / investment_per_symbol) * 100,
                'buy_hold_return': ((buy_hold_value - investment_per_symbol) / investment_per_symbol) * 100,
                'trades': symbol_trades,
                'first_price': first_open,
                'last_price': last_close,
                'final_position': 'Long' if strategy_portfolio['shares'] > 0 else 'Cash'
            }

            portfolio_results['strategy'] += strategy_portfolio['value']
            portfolio_results['buy_hold'] += buy_hold_value
            portfolio_results['perfect'] += perfect_portfolio['value']
            portfolio_results['worst'] += worst_portfolio['value']
            portfolio_results['random'] += random_portfolio['value']

            for key in ['total', 'correct', 'winning', 'losing']:
                overall_trades[key] += symbol_trades[key]
            overall_trades['winning_amount'] += symbol_trades['winning_amount']
            overall_trades['losing_amount'] += symbol_trades['losing_amount']

        strategy_return = ((portfolio_results['strategy'] - INITIAL_INVESTMENT) / INITIAL_INVESTMENT) * 100
        buy_hold_return = ((portfolio_results['buy_hold'] - INITIAL_INVESTMENT) / INITIAL_INVESTMENT) * 100
        perfect_return = ((portfolio_results['perfect'] - INITIAL_INVESTMENT) / INITIAL_INVESTMENT) * 100
        worst_return = ((portfolio_results['worst'] - INITIAL_INVESTMENT) / INITIAL_INVESTMENT) * 100
        random_return = ((portfolio_results['random'] - INITIAL_INVESTMENT) / INITIAL_INVESTMENT) * 100

        avg_win = overall_trades['winning_amount'] / overall_trades['winning'] if overall_trades['winning'] > 0 else 0
        avg_loss = overall_trades['losing_amount'] / overall_trades['losing'] if overall_trades['losing'] > 0 else 0
        win_rate = (overall_trades['winning'] / overall_trades['total'] * 100) if overall_trades['total'] > 0 else 0
        accuracy = (overall_trades['correct'] / overall_trades['total'] * 100) if overall_trades['total'] > 0 else 0

        profit_factor = None
        if overall_trades['losing_amount'] > 0:
            profit_factor = overall_trades['winning_amount'] / overall_trades['losing_amount']

        return {
            'initial_investment': INITIAL_INVESTMENT,
            'investment_per_symbol': investment_per_symbol,
            'num_symbols': num_symbols,
            'final_values': {
                'strategy': portfolio_results['strategy'],
                'buy_hold': portfolio_results['buy_hold'],
                'perfect': portfolio_results['perfect'],
                'worst': portfolio_results['worst'],
                'random': portfolio_results['random']
            },
            'returns': {
                'strategy': strategy_return,
                'buy_hold': buy_hold_return,
                'perfect': perfect_return,
                'worst': worst_return,
                'random': random_return,
                'outperformance': strategy_return - buy_hold_return,
                'vs_random': strategy_return - random_return,
                'max_potential': perfect_return - strategy_return,
                'avoided_loss': strategy_return - worst_return
            },
            'trades': {
                'total': overall_trades['total'],
                'correct': overall_trades['correct'],
                'winning': overall_trades['winning'],
                'losing': overall_trades['losing'],
                'accuracy': accuracy,
                'win_rate': win_rate,
                'avg_win': avg_win,
                'avg_loss': avg_loss,
                'profit_factor': profit_factor
            },
            'symbol_performances': symbol_performances,
            'history': all_histories
        }

    def _calculate_overall_accuracy_metrics(self, prediction_entries: List[Dict]) -> Dict[str, Any]:
        if not prediction_entries:
            return {
                'directional': {'total': 0, 'correct': 0, 'accuracy': 0},
                'movement_weighted': {'accuracy': 50.0},
                'return_accuracy': {'avg_error': None, 'rating': 'N/A', 'bias': None, 'upward_error': None,
                                    'downward_error': None, 'count': 0},
                'price': {tp: {'avg_diff': 0, 'rating': 'N/A'} for tp in
                          ['pre_market', 'market_open', 'market_close', 'after_hours']},
                'action_breakdown': {}
            }

        overall_metrics = self.__calculate_accuracy_metrics(prediction_entries)
        price_errors = defaultdict(list)
        action_entries = defaultdict(list)

        for entry in prediction_entries:
            action_entries[entry.get('action', 'HOLD')].append(entry)
            master_accuracy = entry.get('models', {}).get('master', {}).get('accuracy', {})
            for timepoint in ['pre_market', 'market_open', 'market_close', 'after_hours']:
                if timepoint in master_accuracy:
                    error_value = master_accuracy[timepoint].get('abs_percent_diff')
                    if error_value is not None:
                        price_errors[timepoint].append(error_value)

        price_metrics = {}
        for timepoint, errors in price_errors.items():
            avg_diff = np.mean(errors) if errors else 0
            price_metrics[timepoint] = {'avg_diff': avg_diff,
                                        'rating': self._get_rating(avg_diff) if errors else 'N/A'}

        action_results = {}
        for action, entries in action_entries.items():
            metrics = self.__calculate_accuracy_metrics(entries)
            action_results[action] = {
                'total': metrics['total'],
                'correct': metrics['correct'],
                'accuracy': metrics['accuracy'],
                'movement_weighted_accuracy': metrics['movement_weighted_accuracy'],
                'return_accuracy': metrics['return_accuracy']
            }

        return {
            'directional': {
                'total': overall_metrics['total'],
                'correct': overall_metrics['correct'],
                'accuracy': overall_metrics['accuracy']
            },
            'movement_weighted': {'accuracy': overall_metrics['movement_weighted_accuracy']},
            'return_accuracy': overall_metrics['return_accuracy'],
            'price': price_metrics,
            'action_breakdown': action_results
        }

    def _compare_prediction_models(self, prediction_entries: List[Dict]) -> Optional[Dict]:
        if not prediction_entries:
            return None

        results = {}
        for model_name in ['master', 'image', 'options', 'vibe']:
            model_entries = [
                entry for entry in prediction_entries
                if entry.get('models', {}).get(model_name, {}).get('timepoints', {}).get('market_open') is not None and
                   entry.get('models', {}).get(model_name, {}).get('timepoints', {}).get('market_close') is not None
            ]

            if not model_entries:
                continue

            metrics = self.__calculate_accuracy_metrics(model_entries, model_name=model_name)

            price_errors = defaultdict(list)
            for entry in model_entries:
                accuracy = entry.get('models', {}).get(model_name, {}).get('accuracy', {})
                for timepoint in ['pre_market', 'market_open', 'market_close', 'after_hours']:
                    if timepoint in accuracy:
                        abs_diff = accuracy[timepoint].get('abs_percent_diff')
                        if abs_diff is not None:
                            price_errors[timepoint].append(abs_diff)

            avg_price_errors = {}
            for timepoint, errors in price_errors.items():
                avg_price_errors[timepoint] = np.mean(errors) if errors else None

            results[model_name] = {
                'predictions': len(model_entries),
                'correct': metrics['correct'],
                'direction_accuracy': metrics['accuracy'],
                'movement_weighted_accuracy': metrics['movement_weighted_accuracy'],
                'price_errors': avg_price_errors,
                'return_accuracy': metrics['return_accuracy'],
                'valid_predictions': metrics['total'],
                'price_ratings': {
                    timepoint: self._get_rating(error) if error is not None else 'N/A'
                    for timepoint, error in avg_price_errors.items()
                }
            }

        return results

    def _calculate_weekly_performance(self, prediction_entries: List[Dict]) -> Optional[Dict]:
        if not prediction_entries:
            return None

        entries_by_day = defaultdict(list)
        for entry in prediction_entries:
            if entry.get('directional_accuracy') and entry.get('day_of_week'):
                entries_by_day[entry['day_of_week']].append(entry)

        results = {}
        for day, entries in entries_by_day.items():
            metrics = self.__calculate_accuracy_metrics(entries)
            price_errors = defaultdict(list)

            for entry in entries:
                master_accuracy = entry.get('models', {}).get('master', {}).get('accuracy', {})
                for timepoint in ['pre_market', 'market_open', 'market_close', 'after_hours']:
                    if timepoint in master_accuracy:
                        error_value = master_accuracy[timepoint].get('abs_percent_diff')
                        if error_value is not None:
                            price_errors[timepoint].append(error_value)

            avg_price_errors = {tp: np.mean(errs) if errs else None for tp, errs in price_errors.items()}

            results[day] = {
                'total': metrics['total'],
                'correct': metrics['correct'],
                'accuracy': metrics['accuracy'],
                'movement_weighted_accuracy': metrics['movement_weighted_accuracy'],
                'return_accuracy': metrics['return_accuracy'],
                'price_errors': avg_price_errors,
                'price_ratings': {tp: self._get_rating(err) if err is not None else 'N/A' for tp, err in
                                  avg_price_errors.items()}
            }

        return results

    async def _analyze_daily_accuracy_trends(self, prediction_entries: List[Dict]) -> Optional[Dict]:
        if not prediction_entries:
            return None

        trends_by_model = {}
        for model_name in ['master', 'image', 'options', 'vibe']:
            model_trends = await self.__generate_single_model_trends(prediction_entries, model_name)
            if model_trends:
                trends_by_model[model_name] = model_trends

        return trends_by_model if trends_by_model else None

    def __calculate_metrics_for_window(self, window_entries: List[Dict], model_name: str) -> Dict:
        if not window_entries:
            return {}

        metrics = self.__calculate_accuracy_metrics(window_entries, model_name=model_name)
        buy_entries = [e for e in window_entries if e.get('action') == 'BUY']
        sell_entries = [e for e in window_entries if e.get('action') == 'SELL']
        hold_entries = [e for e in window_entries if e.get('action', 'HOLD') == 'HOLD']

        buy_metrics = self.__calculate_accuracy_metrics(buy_entries, model_name=model_name) if buy_entries else None
        sell_metrics = self.__calculate_accuracy_metrics(sell_entries, model_name=model_name) if sell_entries else None
        hold_metrics = self.__calculate_accuracy_metrics(hold_entries, model_name=model_name) if hold_entries else None

        price_errors = defaultdict(list)
        for entry in window_entries:
            model_accuracy = entry.get('models', {}).get(model_name, {}).get('accuracy', {})
            for timepoint in ['pre_market', 'market_open', 'market_close', 'after_hours']:
                if timepoint in model_accuracy:
                    error_value = model_accuracy[timepoint].get('abs_percent_diff')
                    if error_value is not None:
                        price_errors[timepoint].append(error_value)

        avg_price_errors = {tp: float(np.mean(errs)) if errs else None for tp, errs in price_errors.items()}

        window_buy_accuracy = buy_metrics['accuracy'] if buy_metrics else None
        window_sell_accuracy = sell_metrics['accuracy'] if sell_metrics else None
        window_hold_accuracy = hold_metrics['accuracy'] if hold_metrics else None
        window_buy_movement_weighted = buy_metrics['movement_weighted_accuracy'] if buy_metrics else None
        window_sell_movement_weighted = sell_metrics['movement_weighted_accuracy'] if sell_metrics else None
        window_hold_movement_weighted = hold_metrics['movement_weighted_accuracy'] if hold_metrics else None

        directional_bias = float(
            window_buy_accuracy - window_sell_accuracy) if window_buy_accuracy is not None and window_sell_accuracy is not None else None
        movement_weighted_bias = float(
            window_buy_movement_weighted - window_sell_movement_weighted) if window_buy_movement_weighted is not None and window_sell_movement_weighted is not None else None

        return {
            'directional_accuracy': metrics['accuracy'],
            'movement_weighted_accuracy': metrics['movement_weighted_accuracy'],
            'return_accuracy': metrics['return_accuracy']['avg_error'],
            'return_accuracy_bias': metrics['return_accuracy']['bias'],
            'price_errors': avg_price_errors,
            'price_ratings': {
                timepoint: self._get_rating(error) if error is not None else 'N/A'
                for timepoint, error in avg_price_errors.items()
            },
            'correct_predictions': metrics['correct'],
            'total_predictions': metrics['total'],
            'buy_accuracy': window_buy_accuracy,
            'sell_accuracy': window_sell_accuracy,
            'hold_accuracy': window_hold_accuracy,
            'buy_movement_weighted_accuracy': window_buy_movement_weighted,
            'sell_movement_weighted_accuracy': window_sell_movement_weighted,
            'hold_movement_weighted_accuracy': window_hold_movement_weighted,
            'directional_bias': directional_bias,
            'movement_weighted_bias': movement_weighted_bias,
            'action_distribution': {
                'buy_count': len(buy_entries),
                'sell_count': len(sell_entries),
                'hold_count': len(hold_entries),
                'buy_percentage': float((len(buy_entries) / len(window_entries) * 100)) if len(
                    window_entries) > 0 else 0.0,
                'sell_percentage': float((len(sell_entries) / len(window_entries) * 100)) if len(
                    window_entries) > 0 else 0.0,
                'hold_percentage': float((len(hold_entries) / len(window_entries) * 100)) if len(
                    window_entries) > 0 else 0.0
            }
        }

    async def __generate_single_model_trends(self, prediction_entries: List[Dict], model_name: str) -> Optional[Dict]:
        model_entries = [
            entry for entry in prediction_entries
            if entry.get('models', {}).get(model_name, {}).get('timepoints', {}).get('market_open') is not None and
               entry.get('models', {}).get(model_name, {}).get('timepoints', {}).get('market_close') is not None
        ]

        if not model_entries:
            return None

        entries_by_date = defaultdict(list)
        for entry in model_entries:
            try:
                target_dt = datetime.fromisoformat(entry['target_trading_datetime'].replace('Z', '+00:00'))
                if target_dt.tzinfo is None:
                    target_dt = pytz.UTC.localize(target_dt)
                target_dt_eastern = target_dt.astimezone(self.eastern_tz)
                date = target_dt_eastern.date()
                entries_by_date[date].append(entry)
            except Exception as e:
                await log_service.warning(f"Error processing entry date for model {model_name}: {str(e)}")
                continue

        daily_metrics = []
        for date, entries in sorted(entries_by_date.items()):
            metrics = self.__calculate_metrics_for_window(entries, model_name)
            daily_metrics.append({'date': date.isoformat(), **metrics})

        sorted_dates = sorted(entries_by_date.keys())
        total_days = len(sorted_dates)

        window_size = max(3, int(total_days * 0.2))
        step_size = 1

        if len(daily_metrics) < 3:
            return {
                'trend': 'INSUFFICIENT_DATA',
                'trend_strength': 'N/A',
                'momentum': 0,
                'recent_accuracy': daily_metrics[-1]['directional_accuracy'] if daily_metrics else None,
                'recent_movement_weighted_accuracy': daily_metrics[-1][
                    'movement_weighted_accuracy'] if daily_metrics else None,
                'rolling_windows': [],
                'daily_metrics': daily_metrics
            }

        rolling_windows = []

        if total_days >= window_size:
            for i in range(0, total_days - window_size + 1, step_size):
                window_dates = sorted_dates[i: i + window_size]
                window_entries = [entry for date in window_dates for entry in entries_by_date[date]]
                if window_entries:
                    metrics = self.__calculate_metrics_for_window(window_entries, model_name)
                    rolling_windows.append({
                        'start_date': window_dates[0].isoformat(),
                        'end_date': window_dates[-1].isoformat(),
                        'window_index': i + 1,
                        'window_size': len(window_dates),
                        **metrics
                    })

        if not rolling_windows:
            return {
                'trend': 'INSUFFICIENT_DATA',
                'trend_strength': 'N/A',
                'momentum': 0,
                'recent_accuracy': None,
                'recent_movement_weighted_accuracy': None,
                'rolling_windows': [],
                'daily_metrics': daily_metrics
            }

        recent_accuracy = rolling_windows[-1]['directional_accuracy'] if rolling_windows else None
        recent_movement_weighted_accuracy = rolling_windows[-1][
            'movement_weighted_accuracy'] if rolling_windows else None

        accuracy_values = [w['movement_weighted_accuracy'] for w in rolling_windows if
                           w['movement_weighted_accuracy'] is not None]

        if not accuracy_values:
            return {
                'trend': 'INSUFFICIENT_DATA',
                'trend_strength': 'N/A',
                'momentum': 0,
                'recent_accuracy': recent_accuracy,
                'recent_movement_weighted_accuracy': recent_movement_weighted_accuracy,
                'rolling_windows': rolling_windows,
                'daily_metrics': daily_metrics
            }

        first_third = accuracy_values[:len(accuracy_values) // 3]
        last_third = accuracy_values[-len(accuracy_values) // 3:]

        first_median = float(np.median(first_third)) if first_third else float(accuracy_values[0])
        last_median = float(np.median(last_third)) if last_third else float(accuracy_values[-1])
        diff = last_median - first_median

        if diff > 15:
            trend = "IMPROVING"
            trend_strength = "STRONG"
        elif diff > 5:
            trend = "IMPROVING"
            trend_strength = "MODERATE"
        elif diff < -15:
            trend = "DECLINING"
            trend_strength = "STRONG"
        elif diff < -5:
            trend = "DECLINING"
            trend_strength = "MODERATE"
        else:
            trend = "STABLE"
            trend_strength = "WEAK"

        momentum = float(diff)

        bias_values = [w['movement_weighted_bias'] for w in rolling_windows if w['movement_weighted_bias'] is not None]

        bias_trend = None
        bias_improvement = None
        if len(bias_values) >= 3:
            first_bias_third = bias_values[:len(bias_values) // 3]
            last_bias_third = bias_values[-len(bias_values) // 3:]
            first_bias_median = float(np.median(first_bias_third))
            last_bias_median = float(np.median(last_bias_third))
            bias_change = abs(last_bias_median) - abs(first_bias_median)

            if bias_change < -5:
                bias_trend = "IMPROVING"
            elif bias_change > 5:
                bias_trend = "WORSENING"
            else:
                bias_trend = "STABLE"
            bias_improvement = bool(bias_change < 0)

        first_half = daily_metrics[:len(daily_metrics) // 2]
        second_half = daily_metrics[len(daily_metrics) // 2:]

        first_half_predictions = sum(d['total_predictions'] for d in first_half)
        second_half_predictions = sum(d['total_predictions'] for d in second_half)

        first_half_correct = sum(d['correct_predictions'] for d in first_half)
        second_half_correct = sum(d['correct_predictions'] for d in second_half)

        first_half_weighted_sum = sum(d['movement_weighted_accuracy'] * d['total_predictions'] for d in first_half if
                                      d['movement_weighted_accuracy'] is not None)
        first_half_weighted_count = sum(
            d['total_predictions'] for d in first_half if d['movement_weighted_accuracy'] is not None)

        second_half_weighted_sum = sum(d['movement_weighted_accuracy'] * d['total_predictions'] for d in second_half if
                                       d['movement_weighted_accuracy'] is not None)
        second_half_weighted_count = sum(
            d['total_predictions'] for d in second_half if d['movement_weighted_accuracy'] is not None)

        first_half_accuracy = float(
            (first_half_correct / first_half_predictions * 100)) if first_half_predictions > 0 else 0.0
        second_half_accuracy = float(
            (second_half_correct / second_half_predictions * 100)) if second_half_predictions > 0 else 0.0
        first_half_movement_weighted = float(
            (first_half_weighted_sum / first_half_weighted_count)) if first_half_weighted_count > 0 else 0.0
        second_half_movement_weighted = float(
            (second_half_weighted_sum / second_half_weighted_count)) if second_half_weighted_count > 0 else 0.0

        half_diff = second_half_accuracy - first_half_accuracy
        movement_weighted_half_diff = second_half_movement_weighted - first_half_movement_weighted

        return {
            'trend': trend,
            'trend_strength': trend_strength,
            'momentum': momentum,
            'recent_accuracy': recent_accuracy,
            'recent_movement_weighted_accuracy': recent_movement_weighted_accuracy,
            'rolling_windows': rolling_windows,
            'daily_metrics': daily_metrics,
            'comparison': {
                'first_half': first_half_accuracy,
                'second_half': second_half_accuracy,
                'difference': float(half_diff),
                'first_half_movement_weighted': first_half_movement_weighted,
                'second_half_movement_weighted': second_half_movement_weighted,
                'movement_weighted_difference': float(movement_weighted_half_diff),
                'improvement': bool(half_diff > 0)
            },
            'bias_analysis': {
                'trend': bias_trend,
                'improvement': bool(bias_improvement) if bias_improvement is not None else None,
                'recent_bias': rolling_windows[-1]['movement_weighted_bias'] if rolling_windows else None,
                'recent_buy_accuracy': rolling_windows[-1][
                    'buy_movement_weighted_accuracy'] if rolling_windows else None,
                'recent_sell_accuracy': rolling_windows[-1][
                    'sell_movement_weighted_accuracy'] if rolling_windows else None,
                'avg_bias': float(np.median(bias_values)) if bias_values else None,
                'bias_volatility': float(np.std(bias_values)) if len(bias_values) > 1 else None
            }
        }

    def _calculate_action_confidence_calibration(self, prediction_entries: List[Dict]) -> Optional[Dict]:
        if not prediction_entries or len(prediction_entries) < 10:
            return None

        action_data = {'BUY': [], 'SELL': [], 'HOLD': []}

        for entry in prediction_entries:
            confidence_obj = entry.get('confidence')
            directional_accuracy = entry.get('directional_accuracy')
            action = entry.get('action', 'HOLD').upper()

            if not confidence_obj or not directional_accuracy or action not in action_data:
                continue

            confidence_value = confidence_obj.get(action.lower(), 0)
            is_correct = directional_accuracy.get('is_correct', False)

            action_data[action].append({
                'confidence': confidence_value,
                'is_correct': is_correct
            })

        results = {}
        correlations = {}
        data_summary = {}

        for action in ['BUY', 'SELL', 'HOLD']:
            data = action_data[action]
            if len(data) < 5:
                continue

            correct_count = sum(1 for d in data if d['is_correct'])
            total_count = len(data)
            action_accuracy = (correct_count / total_count * 100) if total_count > 0 else 0

            confidences = [d['confidence'] for d in data]
            accuracies = [1.0 if d['is_correct'] else 0.0 for d in data]

            correlation = self._calculate_safe_correlation(confidences, accuracies)
            correlations[action] = correlation

            data_summary[action] = {
                'total_predictions': total_count,
                'correct_predictions': correct_count,
                'overall_accuracy': action_accuracy,
                'confidence_range': {
                    'min': min(confidences) if confidences else 0,
                    'max': max(confidences) if confidences else 0,
                    'avg': sum(confidences) / len(confidences) if confidences else 0
                }
            }

            buckets = self._create_confidence_percentile_buckets(data)
            if buckets:
                results[action] = buckets

        if not results:
            return None

        return {
            'confidence_calibration': results,
            'calibration_summary': correlations,
            'data_summary': data_summary,
            'total_predictions': sum(len(data) for data in action_data.values()),
            'actions_analyzed': list(results.keys())
        }

    def _create_confidence_percentile_buckets(self, data):
        if len(data) < 10:
            return []

        data_sorted = sorted(data, key=lambda x: x['confidence'])

        bucket_size = len(data) // 4
        if bucket_size < 2:
            return []

        buckets = []
        percentile_names = ['Bottom 25%', 'Lower 25%', 'Upper 25%', 'Top 25%']

        for i in range(4):
            start_idx = i * bucket_size
            if i == 3:
                end_idx = len(data)
            else:
                end_idx = (i + 1) * bucket_size

            bucket_data = data_sorted[start_idx:end_idx]

            if len(bucket_data) < 2:
                continue

            confidences = [d['confidence'] for d in bucket_data]
            min_conf = min(confidences)
            max_conf = max(confidences)
            avg_conf = sum(confidences) / len(confidences)

            correct_count = sum(1 for d in bucket_data if d['is_correct'])
            accuracy = (correct_count / len(bucket_data)) * 100

            buckets.append({
                'range': f"{int(min_conf * 100)}-{int(max_conf * 100)}",
                'percentile': percentile_names[i],
                'percentile_name': percentile_names[i],
                'accuracy': accuracy,
                'count': len(bucket_data),
                'avg_confidence': avg_conf * 100,
                'correct_predictions': correct_count,
                'bucket_index': i + 1,
                'percentage_of_total': (len(bucket_data) / len(data)) * 100,
                'confidence_bounds': {
                    'min': min_conf,
                    'max': max_conf,
                    'avg': avg_conf
                }
            })

        return buckets

    def _calculate_safe_correlation(self, x_values, y_values):
        try:
            x_array = np.array(x_values, dtype=float)
            y_array = np.array(y_values, dtype=float)

            if len(x_array) != len(y_array) or len(x_array) < 3:
                return None

            mask = ~(np.isnan(x_array) | np.isnan(y_array) | np.isinf(x_array) | np.isinf(y_array))
            x_clean = x_array[mask]
            y_clean = y_array[mask]

            if len(x_clean) < 3:
                return None

            x_std = np.std(x_clean)
            y_std = np.std(y_clean)

            if x_std == 0 or y_std == 0 or np.isnan(x_std) or np.isnan(y_std):
                return None

            with np.errstate(divide='ignore', invalid='ignore'):
                correlation_matrix = np.corrcoef(x_clean, y_clean)
                correlation = correlation_matrix[0, 1]

            if np.isnan(correlation) or np.isinf(correlation):
                return None

            return float(correlation)

        except (ValueError, np.linalg.LinAlgError):
            return None

    def _get_rating(self, avg_diff):
        if avg_diff is None:
            return "N/A"
        elif avg_diff < 0.5:
            return "Excellent"
        elif avg_diff < 1.0:
            return "Good"
        elif avg_diff < 2.0:
            return "Fair"
        elif avg_diff < 4.0:
            return "Poor"
        else:
            return "Missed"