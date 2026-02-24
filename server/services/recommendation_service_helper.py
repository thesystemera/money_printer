import re
import json
import pytz
from datetime import datetime, timedelta
from collections import Counter
from typing import Dict, List, Any, Optional
from services import time_service

def _extract_daily_log(entries: List[Dict], model_name: str) -> List[Dict]:
    daily_log = []
    sorted_entries = sorted(entries, key=lambda x: x.get('target_trading_datetime', ''))

    for entry in sorted_entries:
        model_data = entry.get('models', {}).get(model_name, {})
        return_accuracy_data = entry.get('return_accuracies', {}).get(model_name, {})
        directional_accuracy_data = entry.get('directional_accuracy', {})

        if not all([model_data, return_accuracy_data, directional_accuracy_data]):
            continue

        time_delta = model_data.get('accuracy', {}).get('market_open', {}).get('prediction_timedelta_minutes')

        log_entry = {
            "target_date": entry.get('target_trading_datetime', 'N/A').split('T')[0],
            "prediction_made_at": entry.get('timestamp'),
            "prediction_timedelta_minutes": time_delta,
            "action": entry.get('action'),
            "confidence": entry.get('confidence'),
            "outcome_correct_direction": directional_accuracy_data.get('is_correct'),
            "outcome_magnitude": directional_accuracy_data.get('magnitude'),
            "outcome_actual_return_percent": return_accuracy_data.get('actual_return_percent'),
            "outcome_predicted_return_percent": return_accuracy_data.get('predicted_return_percent')
        }
        daily_log.append(log_entry)
    return daily_log

def round_floats_in_object(obj, precision=4):
    if isinstance(obj, float):
        return round(obj, precision)
    if isinstance(obj, dict):
        return {k: round_floats_in_object(v, precision) for k, v in obj.items()}
    if isinstance(obj, list):
        return [round_floats_in_object(elem, precision) for elem in obj]
    return obj

def create_condensed_prediction_summary(prediction_accuracy: Dict, preset: str = 'master') -> Optional[Dict]:
    if not prediction_accuracy:
        return None

    if preset == 'specialist' and 'model_comparison' in prediction_accuracy:
        filtered_data = {
            "metadata": prediction_accuracy.get("metadata", {}),
            "model_comparison": prediction_accuracy["model_comparison"]
        }
        return round_floats_in_object(filtered_data)

    filtered_data = {}
    keys_to_keep = [
        'accuracy_metrics', 'model_comparison',
        'magnitude_analysis', 'movement_detection', 'metadata'
    ]
    for key in keys_to_keep:
        if key in prediction_accuracy:
            filtered_data[key] = prediction_accuracy[key]

    if 'trends' in prediction_accuracy:
        trends_data = prediction_accuracy['trends']
        if isinstance(trends_data, dict):
            filtered_trends = {}
            for model_name, model_trends in trends_data.items():
                if isinstance(model_trends, dict):
                    lightweight_trends = model_trends.copy()
                    if 'rolling_windows' in lightweight_trends:
                        del lightweight_trends['rolling_windows']
                    if 'daily_metrics' in lightweight_trends:
                        del lightweight_trends['daily_metrics']
                    filtered_trends[model_name] = lightweight_trends
            if filtered_trends:
                filtered_data['trends'] = filtered_trends

    if 'entries' in prediction_accuracy and prediction_accuracy['entries']:
        daily_log = _extract_daily_log(prediction_accuracy['entries'], 'master')
        if len(daily_log) > 14:
            filtered_data['daily_log'] = daily_log[-14:]
        else:
            filtered_data['daily_log'] = daily_log

    return round_floats_in_object(filtered_data)

def filter_prediction_data_for_specialist(prediction_accuracy: Dict, model_name: str) -> Optional[Dict]:
    if not prediction_accuracy:
        return None

    model_performance = prediction_accuracy.get('model_comparison', {}).get(model_name)
    if not model_performance:
        return None

    filtered_data = {
        "performance_summary": model_performance
    }

    trends_data = prediction_accuracy.get('trends', {})
    if isinstance(trends_data, dict) and model_name in trends_data:
        model_trends = trends_data[model_name]
        if isinstance(model_trends, dict):
            lightweight_trends = model_trends.copy()
            if 'rolling_windows' in lightweight_trends:
                del lightweight_trends['rolling_windows']
            if 'daily_metrics' in lightweight_trends:
                del lightweight_trends['daily_metrics']
            filtered_data["trends"] = lightweight_trends

    if 'entries' in prediction_accuracy and prediction_accuracy['entries']:
        daily_log = _extract_daily_log(prediction_accuracy['entries'], model_name)
        if daily_log:
            if len(daily_log) > 14:
                filtered_data['daily_log'] = daily_log[-14:]
            else:
                filtered_data['daily_log'] = daily_log

    return round_floats_in_object(filtered_data)

def normalize_volatility_range(volatility_input: Any) -> Optional[float]:
    if volatility_input is None:
        return None
    if isinstance(volatility_input, (int, float)):
        return abs(float(volatility_input))
    if isinstance(volatility_input, str):
        clean = re.sub(r'[Â±+\-\s%]', '', str(volatility_input))
        try:
            return abs(float(clean))
        except ValueError:
            return None
    return None

def get_eastern_time_now() -> str:
    eastern_tz = pytz.timezone('US/Eastern')
    return time_service.now(eastern_tz).isoformat()

def convert_timestamp_to_eastern(timestamp_str: str, eastern_tz: pytz.timezone) -> str:
    if not timestamp_str:
        return timestamp_str
    try:
        dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        eastern_dt = dt.astimezone(eastern_tz)
        return eastern_dt.isoformat()
    except (ValueError, TypeError):
        return timestamp_str

def get_next_trading_day(eastern_tz: pytz.timezone) -> datetime.date:
    current_time = time_service.now(eastern_tz)
    current_weekday = current_time.weekday()

    if current_weekday < 5:
        if current_time.time() >= datetime.strptime("16:00", "%H:%M").time():
            if current_weekday == 4:
                next_trading_day = current_time.date() + timedelta(days=3)
            else:
                next_trading_day = current_time.date() + timedelta(days=1)
        else:
            next_trading_day = current_time.date()
    else:
        days_to_monday = (7 - current_weekday) % 7
        if days_to_monday == 0:
            days_to_monday = 1
        next_trading_day = current_time.date() + timedelta(days=days_to_monday)

    return next_trading_day

def get_next_market_open_info(eastern_tz: pytz.timezone, market_hours: Dict[str, str]) -> str:
    now = time_service.now(eastern_tz)
    weekday = now.weekday()
    market_open_time = datetime.strptime(market_hours["regular_open"], "%H:%M").time()
    market_close_time = datetime.strptime(market_hours["regular_close"], "%H:%M").time()

    if weekday >= 5:
        days_to_monday = (7 - weekday) % 7
        next_market_day = now.date() + timedelta(days=days_to_monday)
        next_open_datetime = eastern_tz.localize(datetime.combine(next_market_day, market_open_time))
        time_to_open = next_open_datetime - now
        if days_to_monday == 1:
            return f"Market opens tomorrow at 9:30 AM ET ({time_to_open.total_seconds() // 3600:.0f} hours, {(time_to_open.total_seconds() % 3600) // 60:.0f} minutes from now)"
        else:
            return f"Market opens on Monday at 9:30 AM ET ({time_to_open.total_seconds() // 3600:.0f} hours from now)"

    current_time = now.time()
    if market_open_time <= current_time < market_close_time and weekday < 5:
        minutes_to_close = ((datetime.combine(now.date(), market_close_time) - datetime.combine(now.date(),
                                                                                                current_time)).total_seconds() // 60)
        return f"Market is currently open, closes in {minutes_to_close:.0f} minutes at 4:00 PM ET"

    if current_time < market_open_time and weekday < 5:
        time_to_open = eastern_tz.localize(datetime.combine(now.date(), market_open_time)) - now
        return f"Market opens today at 9:30 AM ET ({time_to_open.total_seconds() // 3600:.0f} hours, {(time_to_open.total_seconds() % 3600) // 60:.0f} minutes from now)"

    next_market_day = now.date() + timedelta(days=1)
    if weekday == 4:
        next_market_day = now.date() + timedelta(days=3)

    next_open_datetime = eastern_tz.localize(datetime.combine(next_market_day, market_open_time))
    time_to_open = next_open_datetime - now

    if weekday == 4:
        return f"Market opens on Monday at 9:30 AM ET ({time_to_open.total_seconds() // 3600:.0f} hours from now)"
    else:
        return f"Market opens tomorrow at 9:30 AM ET ({time_to_open.total_seconds() // 3600:.0f} hours, {(time_to_open.total_seconds() % 3600) // 60:.0f} minutes from now)"

def preprocess_price_data(raw_data: List[Dict], interval_type: str = 'recent',
                          eastern_tz: Optional[pytz.timezone] = None) -> List[Dict]:
    if not raw_data:
        return []

    grouped_data = {}
    for point in raw_data:
        try:
            ts_str = convert_timestamp_to_eastern(point.get('timestamp', ''), eastern_tz)
            ts = datetime.fromisoformat(ts_str)
            if interval_type == 'recent':
                key = ts.replace(minute=0, second=0, microsecond=0).isoformat()
            else:
                key = ts.replace(day=1, hour=0, minute=0, second=0, microsecond=0).strftime('%Y-%m')

            if key not in grouped_data:
                grouped_data[key] = {'timestamps': [], 'prices': [], 'volumes': [], 'market_sessions': []}

            grouped_data[key]['timestamps'].append(ts)
            grouped_data[key]['prices'].append(point.get('price', 0))
            grouped_data[key]['volumes'].append(point.get('volume') or 0)
            grouped_data[key]['market_sessions'].append(point.get('marketSession', 'regular'))
        except (ValueError, TypeError, KeyError):
            continue

    result = []
    for key, values in sorted(grouped_data.items()):
        if values['prices']:
            avg_price = sum(values['prices']) / len(values['prices'])
            avg_volume = sum(values['volumes']) / len(values['volumes']) if values['volumes'] else 0
            price_point = {'timestamp': key, 'price': round(avg_price, 2), 'volume': int(avg_volume)}

            if interval_type == 'recent' and values['market_sessions']:
                session_counts = Counter(values['market_sessions'])
                most_common_session = session_counts.most_common(1)[0][0]
                price_point['marketSession'] = most_common_session

            if interval_type == 'historical':
                price_point['month'] = key

            result.append(price_point)

    if interval_type == 'historical' and len(result) > 1:
        for i in range(1, len(result)):
            prev_price = result[i - 1]['price']
            curr_price = result[i]['price']
            if prev_price > 0:
                change_pct = ((curr_price - prev_price) / prev_price * 100)
                result[i]['change_pct'] = round(change_pct, 2)
            else:
                result[i]['change_pct'] = 0.0

    return result

def merge_price_data_by_timestamp(symbol_data: List[Dict], index_data: Dict[str, List[Dict]],
                                  interval_type: str = 'recent') -> List[Dict]:
    merged_data = {}
    for point in symbol_data:
        time_key = point.get('timestamp', '') if interval_type == 'recent' else point.get('month', '')
        if time_key:
            merged_data[time_key] = {
                'timestamp': time_key,
                'symbol_price': point.get('price', 0),
                'symbol_volume': point.get('volume', 0)
            }
            if interval_type == 'recent' and 'marketSession' in point:
                merged_data[time_key]['symbol_marketSession'] = point.get('marketSession', 'regular')
            if interval_type == 'historical' and 'change_pct' in point:
                merged_data[time_key]['symbol_change_pct'] = point.get('change_pct', 0)

    for index_name, index_points in index_data.items():
        for point in index_points:
            time_key = point.get('timestamp', '') if interval_type == 'recent' else point.get('month', '')
            if time_key in merged_data:
                merged_data[time_key][f'{index_name}_price'] = point.get('price', 0)
                if interval_type == 'historical' and 'change_pct' in point:
                    merged_data[time_key][f'{index_name}_change_pct'] = point.get('change_pct', 0)

    return sorted(merged_data.values(), key=lambda x: x['timestamp'])

def calculate_price_metrics(price_data: List[Dict], data_type: str = 'recent', data_source: str = 'symbol') -> Dict[
    str, Any]:
    price_key = f'{data_source}_price'
    change_pct_key = f'{data_source}_change_pct'
    valid_points = [p for p in price_data if price_key in p and p[price_key] is not None]

    if not valid_points:
        return {}

    first_price = valid_points[0][price_key]
    last_price = valid_points[-1][price_key]
    prices = [p[price_key] for p in valid_points]
    price_change = last_price - first_price
    price_change_pct = (price_change / first_price * 100) if first_price > 0 else 0

    metrics = {
        "firstPrice": round(first_price, 2),
        "lastPrice": round(last_price, 2),
        "priceChange": round(price_change, 2),
        "priceChangePct": round(price_change_pct, 2),
        "highestPrice": round(max(prices), 2),
        "lowestPrice": round(min(prices), 2),
    }

    volume_key = f'{data_source}_volume'
    if data_source == 'symbol' and any(volume_key in p for p in valid_points):
        volumes = [p[volume_key] for p in valid_points if volume_key in p]
        if volumes:
            metrics["avgVolume"] = int(sum(volumes) / len(volumes))

    if data_type == 'historical':
        metrics["totalPeriods"] = len(valid_points)
        if len(valid_points) > 1:
            period_changes = [p.get(change_pct_key, 0) for p in valid_points[1:] if change_pct_key in p]
            if period_changes:
                avg_period_change = sum(period_changes) / len(period_changes)
                metrics["avgPeriodChange"] = round(avg_period_change, 2)
                if len(period_changes) > 1:
                    volatility = (sum((x - avg_period_change) ** 2 for x in period_changes) / len(
                        period_changes)) ** 0.5
                    metrics["volatility"] = round(volatility, 2)

    return metrics

def prepare_sentiment_data(analyzed_articles: List[Dict], eastern_tz: pytz.timezone, impact_threshold: float = 0.5) -> Dict[str, Any]:
    sentiment_data = []
    total_count = len(analyzed_articles)

    for article in analyzed_articles:
        published_date = convert_timestamp_to_eastern(article.get('publishedDate', 'Unknown'), eastern_tz)
        sentiment_score = article.get('sentimentScore')
        influence_score = article.get('influenceScore')
        impact_score = None

        if sentiment_score is not None and influence_score is not None:
            impact_score = round(sentiment_score * influence_score, 2)
            if impact_score is not None and abs(impact_score) < impact_threshold:
                continue

        article_data = {
            "date": published_date,
            "title": article.get('title', 'Unknown'),
            "impactScore": impact_score,
            "propagationSpeed": article.get('propagationSpeed'),
            "impactDuration": article.get('impactDuration'),
            "publisher": article.get('publisher', 'Unknown'),
            "matchedKeyword": article.get('matchedKeyword', 'N/A'),
        }

        certainty_score = article.get('certaintyScore')
        if certainty_score is not None:
            article_data["certaintyScore"] = certainty_score

        temporal_orientation = article.get('temporalOrientation')
        if temporal_orientation is not None and temporal_orientation != 0:
            article_data["temporalOrientation"] = temporal_orientation

        source_category = article.get('sourceCategory')
        if source_category:
            article_data['sourceCategory'] = source_category

        sentiment_data.append(article_data)

    return {
        'articles': sentiment_data,
        'filtered_count': len(sentiment_data),
        'total_count': total_count
    }

def filter_recommendation_data_minimal(recommendation: Dict[str, Any]) -> Dict[str, Any]:
    filtered_data = recommendation.copy()

    if 'rawData' in filtered_data:
        raw_data = filtered_data['rawData']
        filtered_raw_data = {}

        essential_raw_fields = ['company', 'marketTimingInfo', 'requestTime']
        for key in essential_raw_fields:
            if key in raw_data:
                filtered_raw_data[key] = raw_data[key]

        if 'sentimentAnalysis' in raw_data:
            sentiment = raw_data['sentimentAnalysis']
            filtered_sentiment = {}
            for article_type in ['stockArticles', 'industryArticles', 'marketArticles']:
                if article_type in sentiment:
                    filtered_sentiment[article_type] = {
                        'count': sentiment[article_type].get('count', 0)
                    }
            filtered_raw_data['sentimentAnalysis'] = filtered_sentiment

        filtered_data['rawData'] = filtered_raw_data

    fields_to_remove = [
        'visualizationImages', 'predictionAccuracy', 'portfolio_metrics', 'confidence_correlation',
        'dataImprovementSuggestions', 'image_analysis', 'vibe_analysis', 'options_analysis', 'earnings_data',
        'has_images', 'image_count', 'images'
    ]

    for field in fields_to_remove:
        if field in filtered_data:
            del filtered_data[field]

    model_predictions = PredictionDataAdapter.get_all_model_predictions(filtered_data)
    if model_predictions:
        filtered_data['model_predictions'] = model_predictions

    return filtered_data

def process_to_time_resolution(minute_data: List[Dict], resolution_minutes: int = 60) -> List[Dict]:
    if not minute_data:
        return []

    eastern_tz = pytz.timezone('US/Eastern')
    hourly_data = {}

    for data_point in minute_data:
        try:
            eastern_ts_str = convert_timestamp_to_eastern(data_point['timestamp'], eastern_tz)
            eastern_timestamp = datetime.fromisoformat(eastern_ts_str)

            total_minutes = eastern_timestamp.hour * 60 + eastern_timestamp.minute
            boundary_minutes = (total_minutes // resolution_minutes) * resolution_minutes
            boundary_hour = boundary_minutes // 60
            boundary_minute = boundary_minutes % 60

            boundary_key = eastern_timestamp.replace(
                hour=boundary_hour,
                minute=boundary_minute,
                second=0,
                microsecond=0
            )

            if boundary_key not in hourly_data:
                hourly_data[boundary_key] = {
                    'prices': [], 'volumes': [], 'timestamps': [], 'market_sessions': []
                }

            hourly_data[boundary_key]['prices'].append(data_point['price'])
            hourly_data[boundary_key]['volumes'].append(data_point.get('volume', 0))
            hourly_data[boundary_key]['timestamps'].append(eastern_timestamp)
            hourly_data[boundary_key]['market_sessions'].append(data_point.get('marketSession', 'regular'))

        except (ValueError, TypeError, KeyError):
            continue

    result = []
    for boundary_time, data in sorted(hourly_data.items()):
        if data['prices']:
            avg_price = sum(data['prices']) / len(data['prices'])
            avg_volume = sum(data['volumes']) / len(data['volumes']) if data['volumes'] else 0

            most_representative_ts = min(data['timestamps'], key=lambda ts: min(
                abs((ts.minute - boundary_time.minute) % resolution_minutes),
                abs((ts.minute - (boundary_time.minute + resolution_minutes // 2)) % resolution_minutes)
            ))

            session_counts = Counter(data['market_sessions'])
            most_common_session = session_counts.most_common(1)[0][0] if session_counts else 'regular'

            result.append({
                'timestamp': most_representative_ts.isoformat(),
                'hour': f"{boundary_time.hour:02d}:{boundary_time.minute:02d}",
                'price': round(avg_price, 2),
                'volume': int(avg_volume),
                'marketSession': most_common_session
            })

    return sorted(result, key=lambda x: datetime.fromisoformat(x['timestamp']))

async def compare_predictions_with_actual(recommendations: List[Dict],
                                          actual_price_data: Dict[str, List[Dict]]) -> None:
    for rec in recommendations:
        if not rec.get('rawData') or not rec.get('rawData').get('company') or not rec.get('rawData').get('company').get(
                'symbol'):
            continue

        symbol = rec['rawData']['company']['symbol']
        if symbol not in actual_price_data:
            continue

        master_predictions = PredictionDataAdapter.get_master_predictions(rec)
        if not master_predictions:
            continue

        hourly_predictions = master_predictions.get('hourlyPrices', [])
        actual_prices = actual_price_data[symbol]
        prediction_accuracy = []
        actual_by_hour = {item['hour']: item for item in actual_prices}

        rec_timestamp = datetime.fromisoformat(rec['timestamp'].replace('Z', '+00:00'))

        for prediction in hourly_predictions:
            hour = prediction.get('hour')
            if not hour:
                continue

            pred_hour, pred_min = map(int, hour.split(':'))
            pred_datetime = rec_timestamp.replace(hour=pred_hour, minute=pred_min, second=0, microsecond=0)
            is_forward_prediction = rec_timestamp < pred_datetime

            closest_hour = None
            closest_diff = float('inf')
            if hour in actual_by_hour:
                closest_hour = hour
            else:
                pred_minutes = pred_hour * 60 + pred_min
                for actual_hour in actual_by_hour:
                    act_hour, act_min = map(int, actual_hour.split(':'))
                    act_minutes = act_hour * 60 + act_min
                    diff = abs(pred_minutes - act_minutes)
                    if diff < closest_diff:
                        closest_diff = diff
                        closest_hour = actual_hour

            if closest_hour and closest_diff <= 30:
                actual_price = actual_by_hour[closest_hour]['price']
                predicted_price = prediction['price']
                if actual_price > 0:
                    deviation = (predicted_price - actual_price) / actual_price
                    deviation_pct = deviation * 100
                else:
                    deviation = 0
                    deviation_pct = 0

                prediction_accuracy.append({
                    'hour': hour,
                    'predicted': predicted_price,
                    'actual': actual_price,
                    'deviation': deviation,
                    'deviation_pct': deviation_pct,
                    'is_forward_prediction': is_forward_prediction
                })

        if prediction_accuracy:
            avg_deviation = sum(abs(item['deviation']) for item in prediction_accuracy) / len(prediction_accuracy)

            market_open_pred = next((p for p in hourly_predictions if
                                     p['hour'] == "09:30" or 'market open' in p.get('session', '').lower()), None)
            market_close_pred = next((p for p in hourly_predictions if
                                      p['hour'] == "16:00" or 'market close' in p.get('session', '').lower()), None)
            market_open_actual = next((p for p in actual_prices if p['hour'] == "09:30"), None)
            market_close_actual = next((p for p in actual_prices if p['hour'] == "16:00"), None)

            predicted_return = None
            actual_return = None
            if market_open_pred and market_close_pred:
                predicted_return = (market_close_pred['price'] - market_open_pred['price']) / market_open_pred['price']
            if market_open_actual and market_close_actual:
                actual_return = (market_close_actual['price'] - market_open_actual['price']) / market_open_actual[
                    'price']

            return_accuracy = None
            if predicted_return is not None and actual_return is not None:
                direction_correct = (predicted_return >= 0 and actual_return >= 0) or (
                        predicted_return < 0 and actual_return < 0)
                return_diff = abs(predicted_return - actual_return)
                return_accuracy = {
                    'predicted_return': predicted_return,
                    'actual_return': actual_return,
                    'direction_correct': direction_correct,
                    'return_difference': return_diff
                }

            rec['realtime_accuracy'] = {
                'hourly_comparison': prediction_accuracy,
                'average_deviation': avg_deviation,
                'accuracy_score': 1 - min(avg_deviation, 1.0),
                'return_accuracy': return_accuracy
            }

class PredictionDataAdapter:
    @staticmethod
    def normalize_hourly_predictions(hourly_prices: List[Dict]) -> List[Dict]:
        if not hourly_prices:
            return []

        normalized = []
        for prediction in hourly_prices:
            if not isinstance(prediction, dict):
                continue

            normalized_pred = {
                'hour': prediction.get('hour', ''),
                'price': float(prediction.get('price', 0)),
                'session': prediction.get('session', '').lower()
            }

            vol_range = normalize_volatility_range(prediction.get('volatility_range'))
            if vol_range is not None:
                normalized_pred['volatility_range'] = vol_range

            normalized.append(normalized_pred)

        return normalized

    @staticmethod
    def get_master_predictions(recommendation: Dict) -> Optional[Dict]:
        if not recommendation:
            return None

        model_predictions = recommendation.get('model_predictions', {})
        if 'master' in model_predictions:
            master = model_predictions['master']
            return {
                'hourlyPrices': PredictionDataAdapter.normalize_hourly_predictions(master.get('hourlyPrices', [])),
                'marketOpen': master.get('marketOpen'),
                'marketClose': master.get('marketClose'),
                'marketTiming': master.get('marketTiming', '')
            }

        return None

    @staticmethod
    def get_all_model_predictions(recommendation: Dict) -> Dict[str, Any]:
        if not recommendation:
            return {}

        result = {}
        model_predictions = recommendation.get('model_predictions', {})

        master = PredictionDataAdapter.get_master_predictions(recommendation)
        if master:
            result['master'] = master

        for model_type in ['image', 'options', 'revised', 'vibe']:
            if model_type in model_predictions:
                model_data = model_predictions[model_type]
                result[model_type] = {
                    'hourlyPrices': PredictionDataAdapter.normalize_hourly_predictions(
                        model_data.get('hourlyPrices', [])),
                    'marketOpen': model_data.get('marketOpen'),
                    'marketClose': model_data.get('marketClose'),
                    'marketTiming': model_data.get('marketTiming', '')
                }

        return result

    @staticmethod
    def parse_predictions_from_analysis_text(analysis_text: str, model_name: str) -> Optional[Dict]:
        if not analysis_text:
            return None

        hourly_prices = []
        predictions_section = re.search(r'\[HOURLY PRICE PREDICTIONS.*?](.*?)(?=\n\[|$)', analysis_text, re.DOTALL)

        if predictions_section:
            patterns = [
                r'[-â€¢]\s*(\d{1,2}:\d{2}):\s*\$(\d+\.\d+)\s*\([Â±+\-]?(\d+\.\d+)%\)\s*\(([^)]+)\)',
                r'[-â€¢]\s*(\d{1,2}:\d{2}):\s*\$(\d+\.\d+)\s*\(([^)]+)\)',
                r'[-â€¢]\s*(\d{1,2}:\d{2}):\s*\$(\d+\.\d+)'
            ]

            for i, pattern in enumerate(patterns):
                prediction_matches = list(re.finditer(pattern, predictions_section.group(1)))
                if prediction_matches:
                    for match in prediction_matches:
                        groups = match.groups()
                        try:
                            if i == 0:
                                hour, price, volatility_range, session = groups
                                hourly_prices.append({
                                    "hour": hour,
                                    "price": float(price),
                                    "volatility_range": normalize_volatility_range(volatility_range),
                                    "session": session.strip(),
                                    "model": model_name
                                })
                            elif i == 1:
                                hour, price, session = groups
                                hourly_prices.append({
                                    "hour": hour,
                                    "price": float(price),
                                    "session": session.strip(),
                                    "model": model_name
                                })
                            elif i == 2:
                                hour, price = groups
                                hourly_prices.append({
                                    "hour": hour,
                                    "price": float(price),
                                    "model": model_name
                                })
                        except (ValueError, TypeError, IndexError):
                            continue
                    break

        if not hourly_prices:
            return None

        market_open_price = next((p for p in hourly_prices if p["hour"] == "09:30" or "open" in p.get("session", "")),
                                 None)
        market_close_price = next((p for p in hourly_prices if p["hour"] == "16:00" or "close" in p.get("session", "")),
                                  None)

        return {
            "hourlyPrices": hourly_prices,
            "marketOpen": market_open_price["price"] if market_open_price else None,
            "marketClose": market_close_price["price"] if market_close_price else None,
            "model": model_name,
            "marketTiming": ""
        }

def filter_prediction_data_for_claude_analysis(prediction_accuracy: Dict, include_config: Optional[Dict] = None) -> \
        Optional[Dict]:
    if not prediction_accuracy:
        return None

    default_config = {
        'entries': False, 'symbol_results': False, 'rolling_windows': True, 'confidence_calibration_details': True,
        'portfolio_history': True, 'top_wins_details': True, 'accuracy_metrics': True, 'model_comparison': True,
        'trends_summary': True, 'confidence_summary': True, 'high_impact_metrics': True, 'big_move_detection': True,
        'magnitude_analysis': True, 'portfolio_metrics_summary': True, 'weekly_performance': True,
        'portfolio_specific': True, 'symbol_performance_summary': True, 'metadata': True
    }

    config = default_config.copy()
    if include_config:
        config.update(include_config)

    filtered_data = {}

    if config.get('entries', False) and 'entries' in prediction_accuracy:
        filtered_data['entries'] = prediction_accuracy['entries']

    if config.get('symbol_results', False) and 'symbol_results' in prediction_accuracy:
        filtered_data['symbol_results'] = prediction_accuracy['symbol_results']

    if config.get('accuracy_metrics', True) and 'accuracy_metrics' in prediction_accuracy:
        filtered_data['accuracy_metrics'] = prediction_accuracy['accuracy_metrics']

    if config.get('model_comparison', True) and 'model_comparison' in prediction_accuracy:
        filtered_data['model_comparison'] = prediction_accuracy['model_comparison']

    if config.get('trends_summary', True) and 'trends' in prediction_accuracy:
        trends = prediction_accuracy['trends'].copy()

        if not config.get('rolling_windows', False) and 'rolling_windows' in trends:
            windows = trends['rolling_windows']
            if windows:
                trends['rolling_summary'] = {
                    'total_windows': len(windows),
                    'first_accuracy': windows[0].get('directional_accuracy'),
                    'last_accuracy': windows[-1].get('directional_accuracy'),
                    'trend_direction': 'improving' if windows[-1].get('directional_accuracy', 0) > windows[0].get(
                        'directional_accuracy', 0) else 'declining'
                }
            del trends['rolling_windows']

        filtered_data['trends'] = trends

    if config.get('confidence_summary', True) and 'confidence_correlation' in prediction_accuracy:
        conf_corr = prediction_accuracy['confidence_correlation'].copy()

        if not config.get('confidence_calibration_details', False) and 'confidence_calibration' in conf_corr:
            calibration = conf_corr['confidence_calibration']
            calibration_summary = {}
            for action, quartiles in calibration.items():
                if quartiles:
                    calibration_summary[action] = {
                        'quartile_count': len(quartiles),
                        'accuracy_range': [quartiles[0].get('accuracy'), quartiles[-1].get('accuracy')],
                        'total_predictions': sum(q.get('count', 0) for q in quartiles)
                    }
            conf_corr['calibration_overview'] = calibration_summary
            del conf_corr['confidence_calibration']

        filtered_data['confidence_correlation'] = conf_corr

    if config.get('high_impact_metrics', True) and 'high_impact_metrics' in prediction_accuracy:
        high_impact = prediction_accuracy['high_impact_metrics'].copy()

        if not config.get('top_wins_details', False):
            if 'top_wins' in high_impact:
                high_impact['top_wins_count'] = len(high_impact['top_wins'])
                del high_impact['top_wins']
            if 'worst_misses' in high_impact:
                high_impact['worst_misses_count'] = len(high_impact['worst_misses'])
                del high_impact['worst_misses']

        filtered_data['high_impact_metrics'] = high_impact

    if config.get('big_move_detection', True) and 'big_move_detection' in prediction_accuracy:
        filtered_data['big_move_detection'] = prediction_accuracy['big_move_detection']

    if config.get('magnitude_analysis', True) and 'magnitude_analysis' in prediction_accuracy:
        filtered_data['magnitude_analysis'] = prediction_accuracy['magnitude_analysis']

    if config.get('portfolio_metrics_summary', True) and 'portfolio_metrics' in prediction_accuracy:
        portfolio = prediction_accuracy['portfolio_metrics'].copy()

        if not config.get('portfolio_history', False) and 'history' in portfolio:
            history = portfolio['history']
            portfolio['history_summary'] = {
                'total_trades': len(history.get('strategy', [])),
                'trading_days': len(history.get('buy_hold', []))
            }
            del portfolio['history']

        filtered_data['portfolio_metrics'] = portfolio

    if config.get('weekly_performance', True) and 'weekly_performance' in prediction_accuracy:
        filtered_data['weekly_performance'] = prediction_accuracy['weekly_performance']

    if config.get('portfolio_specific', True) and 'portfolio_specific' in prediction_accuracy:
        filtered_data['portfolio_specific'] = prediction_accuracy['portfolio_specific']

    if config.get('symbol_performance_summary', True) and 'symbol_performance' in prediction_accuracy:
        symbol_perf = prediction_accuracy['symbol_performance']
        if symbol_perf and len(symbol_perf) > 0:
            sorted_symbols = sorted(symbol_perf, key=lambda x: x.get('directional_accuracy', 0), reverse=True)
            filtered_data['symbol_performance'] = {
                'total_symbols': len(sorted_symbols),
                'top_performers': sorted_symbols[:5],
                'bottom_performers': sorted_symbols[-3:] if len(sorted_symbols) > 3 else [],
                'performance_stats': {
                    'best_accuracy': sorted_symbols[0].get('directional_accuracy') if sorted_symbols else None,
                    'worst_accuracy': sorted_symbols[-1].get('directional_accuracy') if sorted_symbols else None,
                    'average_accuracy': sum(s.get('directional_accuracy', 0) for s in sorted_symbols) / len(
                        sorted_symbols)
                }
            }

    if config.get('metadata', True) and 'metadata' in prediction_accuracy:
        filtered_data['metadata'] = prediction_accuracy['metadata']

    return filtered_data

def parse_recommendation_response(response_text, analysis_data):
    action_match = re.search(r'\[ACTION]\s*(\w+)', response_text)
    if not action_match:
        raise ValueError("ACTION field is required but not found in response")

    target_datetime_match = re.search(r'\[TARGET_TRADING_DATETIME]\s*([\d\-T:.+]+)', response_text)
    if not target_datetime_match:
        raise ValueError("TARGET_TRADING_DATETIME field is required but not found in response")

    target_trading_datetime = target_datetime_match.group(1).strip()

    buy_confidence_match = re.search(r'BUY:\s*(\d+)', response_text)
    hold_confidence_match = re.search(r'HOLD:\s*(\d+)', response_text)
    sell_confidence_match = re.search(r'SELL:\s*(\d+)', response_text)

    buy_score = float(buy_confidence_match.group(1)) / 100 if buy_confidence_match else 0
    hold_score = float(hold_confidence_match.group(1)) / 100 if hold_confidence_match else 0
    sell_score = float(sell_confidence_match.group(1)) / 100 if sell_confidence_match else 0

    summary_match = re.search(r'\[SUMMARY](.*?)(?=\n\[|$)', response_text, re.DOTALL)
    reasoning_match = re.search(r'\[REASONING](.*?)(?=\n\[|$)', response_text, re.DOTALL)
    market_context_match = re.search(r'\[MARKET CONTEXT](.*?)(?=\n\[|$)', response_text, re.DOTALL)
    volatility_match = re.search(r'\[INTRADAY VOLATILITY](.*?)(?=\n\[|$)', response_text, re.DOTALL)
    strategy_match = re.search(r'\[DAY TRADING STRATEGY](.*?)(?=\n\[|$)', response_text, re.DOTALL)
    prediction_synthesis_match = re.search(r'\[PREDICTION SYNTHESIS](.*?)(?=\n\[|$)', response_text, re.DOTALL)
    prediction_history_match = re.search(r'\[PREDICTION HISTORY INSIGHTS](.*?)(?=\n\[|$)', response_text, re.DOTALL)
    signal_log_match = re.search(r'\[SIGNAL RELIABILITY LOG](.*?)(?=\n\[|$)', response_text, re.DOTALL)
    data_improvement_match = re.search(r'\[DATA IMPROVEMENT SUGGESTIONS](.*?)(?=\n\[|$)', response_text, re.DOTALL)

    data_weighting = {}
    data_weighting_section = re.search(r'\[DATA WEIGHTING](.*?)(?=\n\[|$)', response_text, re.DOTALL)
    if data_weighting_section:
        weighting_text = data_weighting_section.group(1).strip()
        lines = weighting_text.split('\n')
        note = None
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if line.startswith('Note:'):
                note = line.replace('Note:', '').strip()
                continue
            if line.startswith('-') and ':' in line:
                parts = line.strip('- ').split(':', 1)
                if len(parts) == 2:
                    key, value_text = parts
                    key = key.strip()
                    percentage_match = re.search(r'(\d+)%', value_text)
                    if not percentage_match:
                        continue
                    percentage = int(percentage_match.group(1)) / 100
                    explanation_match = re.search(r'\((.*?)\)', value_text)
                    explanation = explanation_match.group(1).strip() if explanation_match else ""
                    data_weighting[key] = {"value": percentage, "explanation": explanation}
        if note:
            data_weighting["note"] = note

    factors = []
    factors_section = re.search(r'\[FACTORS](.*?)(?=\n\[|$)', response_text, re.DOTALL)
    if factors_section:
        factor_lines = factors_section.group(1).strip().split('\n')
        factors = [factor.strip('- ').strip() for factor in factor_lines if factor.strip()]

    hourly_prices = []
    predictions_section = re.search(r'\[HOURLY PRICE PREDICTIONS.*?](.*?)(?=\n\[|$)', response_text, re.DOTALL)
    if predictions_section:
        prediction_pattern = r'[-â€¢]\s*(\d{1,2}:\d{2}):\s*\$(\d+\.\d+)\s*\([Â±+\-](\d+\.\d+)%\)\s*\(([^)]+)\)'
        prediction_matches = list(re.finditer(prediction_pattern, predictions_section.group(1)))
        if not prediction_matches:
            prediction_pattern = r'[-â€¢]\s*(\d{1,2}:\d{2}):\s*\$(\d+\.\d+)\s*\(([^)]+)\)'
            prediction_matches = re.finditer(prediction_pattern, predictions_section.group(1))
            for match in prediction_matches:
                hour, price, session = match.groups()
                try:
                    hourly_prices.append({
                        "hour": hour,
                        "price": float(price),
                        "session": session.strip().lower()
                    })
                except (ValueError, TypeError, IndexError):
                    continue
        else:
            for match in prediction_matches:
                hour, price, volatility_range, session = match.groups()
                try:
                    hourly_prices.append({
                        "hour": hour,
                        "price": float(price),
                        "volatility_range": normalize_volatility_range(volatility_range),
                        "session": session.strip().lower()
                    })
                except (ValueError, TypeError, IndexError):
                    continue

    model_predictions = {}
    if hourly_prices:
        model_predictions['master'] = {
            "hourlyPrices": hourly_prices,
            "marketTiming": analysis_data.get("marketTimingInfo", "")
        }

    clean_analysis_data = analysis_data.copy() if analysis_data else {}
    if "visualizationImages" in clean_analysis_data:
        visualization_images = clean_analysis_data["visualizationImages"]
        if isinstance(visualization_images, list) and len(visualization_images) > 0:
            visualization_summary = {
                "count": len(visualization_images),
                "categories": []
            }
            for img in visualization_images:
                if isinstance(img, dict) and 'category' in img:
                    visualization_summary["categories"].append(img['category'])
                elif isinstance(img, dict) and 'destination' in img:
                    visualization_summary["categories"].append(img.get('destination', 'unknown'))
            clean_analysis_data["visualizationImages"] = visualization_summary
        else:
            del clean_analysis_data["visualizationImages"]

    eastern_tz = pytz.timezone('US/Eastern')
    result = {
        "action": action_match.group(1).upper(),
        "target_trading_datetime": target_trading_datetime,
        "confidence": {"buy": buy_score, "hold": hold_score, "sell": sell_score},
        "dataWeighting": data_weighting,
        "factors": factors,
        "disclaimer": "This is for informational purposes only and not financial advice. Day trading involves substantial risk.",
        "timestamp": time_service.now(eastern_tz).isoformat(),
        "rawData": clean_analysis_data,
        "predictionAccuracy": analysis_data.get("predictionAccuracy"),
        "model_predictions": model_predictions
    }

    if summary_match:
        result["summary"] = summary_match.group(1).strip()
    if reasoning_match:
        result["reasoning"] = reasoning_match.group(1).strip()
    if market_context_match:
        result["marketContext"] = market_context_match.group(1).strip()
    if volatility_match:
        result["volatility"] = volatility_match.group(1).strip()
    if strategy_match:
        result["dayTradingStrategy"] = strategy_match.group(1).strip()
    if prediction_synthesis_match:
        result["predictionSynthesis"] = prediction_synthesis_match.group(1).strip()
    if prediction_history_match:
        result["predictionHistoryInsights"] = prediction_history_match.group(1).strip()
    if signal_log_match:
        result["signalReliabilityLog"] = signal_log_match.group(1).strip()
    if data_improvement_match:
        result["dataImprovementSuggestions"] = data_improvement_match.group(1).strip()

    return result

def repair_json_string(text):
    if not text:
        return text

    text = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', text)
    text = re.sub(r'("[\w_]+"):\s*("[\d.]+),\s*\n', r'\1: \2",\n', text)
    text = re.sub(r'("[\w_]+"):\s*("[\d.]+)\s*\n\s*}', r'\1: \2"\n        }', text)
    text = re.sub(r'("[\w_]+"):\s*("[\d.]+)\s*,\s*\n\s*"', r'\1: \2",\n          "', text)
    text = re.sub(r',\s*([}\]])', r'\1', text)
    text = re.sub(r':\s*"([^"]*)\n([^"]*)"', r': "\1 \2"', text)
    text = re.sub(r'"([^"]*)\n\s*([^"]*)":', r'"\1 \2":', text)
    text = re.sub(r'}\s*\n\s*{', r'},\n    {', text)
    text = re.sub(r']\s*\n\s*\[', r'],\n    [', text)

    return text

def extract_json_with_fallbacks(text):
    strategies = [
        lambda t: json.loads(repair_json_string(t)),
        lambda t: json.loads(
            repair_json_string(re.search(r'```json\s*([\s\S]*?)\s*```', t, re.IGNORECASE).group(1))) if re.search(
            r'```json\s*([\s\S]*?)\s*```', t, re.IGNORECASE) else None,
        lambda t: json.loads(repair_json_string(re.search(r'({[\s\S]*})', t).group(1))) if re.search(r'({[\s\S]*})',
                                                                                                     t) else None,
    ]

    for strategy in strategies:
        try:
            result = strategy(text)
            if result:
                return result
        except Exception:
            continue

    brace_positions = []
    for i, char in enumerate(text):
        if char in '{}':
            brace_positions.append((i, char))

    for start_pos in range(len(brace_positions)):
        if brace_positions[start_pos][1] == '{':
            brace_count = 1
            for end_pos in range(start_pos + 1, len(brace_positions)):
                if brace_positions[end_pos][1] == '{':
                    brace_count += 1
                elif brace_positions[end_pos][1] == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        try:
                            start_idx = brace_positions[start_pos][0]
                            end_idx = brace_positions[end_pos][0] + 1
                            candidate = repair_json_string(text[start_idx:end_idx])
                            return json.loads(candidate)
                        except (json.JSONDecodeError, TypeError):
                            continue

    lines = text.split('\n')
    repaired_lines = []
    for line in lines:
        if '"accuracy_score":' in line and line.count('"') % 2 == 1:
            line = re.sub(r'("accuracy_score"):\s*("[\d.]+),?\s*$', r'\1: \2",', line)
        elif '"deviation_pct":' in line and line.count('"') % 2 == 1:
            line = re.sub(r'("deviation_pct"):\s*("[\d.-]+),?\s*$', r'\1: \2",', line)
        elif '"projectedReturn":' in line and line.count('"') % 2 == 1:
            line = re.sub(r'("projectedReturn"):\s*("[\d.-]+),?\s*$', r'\1: \2",', line)
        repaired_lines.append(line)

    try:
        return json.loads('\n'.join(repaired_lines))
    except (json.JSONDecodeError, TypeError):
        pass

    raise ValueError(f"Could not parse JSON after all strategies. Preview: {text[:1000]}")

async def parse_portfolio_response(response_text, symbol_to_rec, eastern_tz):
    from services import log_service, time_service
    from datetime import datetime

    try:
        await log_service.info(f"Parsing portfolio response, length: {len(response_text)} characters")

        response_json = extract_json_with_fallbacks(response_text)

        analyzed_stocks = (response_json.get("stockAnalysis") or {}).get("stocks") or []
        if not analyzed_stocks:
            raise ValueError("No stocks found in portfolio analysis")

        ranked_buys = (response_json.get("stockAnalysis") or {}).get("rankedBuys") or []

        top_opportunities = []
        watchlist = []
        avoid_list = []

        for stock in analyzed_stocks:
            symbol = stock.get("symbol")
            if not symbol:
                continue

            action = stock.get("action", "").upper()
            category = stock.get("category", "").upper()
            original_rec = symbol_to_rec.get(symbol, {})

            stock_obj = {
                'symbol': symbol,
                'companyName': stock.get('companyName',
                                         original_rec.get('rawData', {}).get('company', {}).get('name', '')),
                'action': action,
                'confidence': original_rec.get('confidence', {}),
                'revisedConfidence': stock.get('confidence', {}),
                'timestamp': stock.get('timestamp', original_rec.get('timestamp', '')),
                'cache_key_timestamp': original_rec.get('cached_at'),
                'target_trading_datetime': stock.get('target_trading_datetime',
                                                     original_rec.get('target_trading_datetime', '')),
                'freshness': stock.get('freshness', original_rec.get('freshness', 'unknown')),
                'reason': stock.get('reason', ''),
                'description': stock.get('reason', ''),
                'sector': stock.get('sector', ''),
                'volatility': stock.get('volatility', ''),
                'factors': stock.get('factors', []),
                'projectedReturn': stock.get('projectedReturn', original_rec.get('projectedReturn', 0))
            }

            if 'model_predictions' in original_rec:
                stock_obj['model_predictions'] = original_rec['model_predictions'].copy()
            else:
                stock_obj['model_predictions'] = {}

            for field in ['image_analysis', 'options_analysis', 'vibe_analysis', 'rawData',
                          'predictionAccuracy', 'realtime_accuracy', 'earnings_data']:
                if field in original_rec:
                    stock_obj[field] = original_rec[field]

            revised_preds = stock.get('revised_predictions')
            if revised_preds and 'nextTradingDay' in revised_preds:
                revised_data = revised_preds['nextTradingDay']

                normalized_hourly = []
                for pred in revised_data.get('hourlyPrices', []):
                    normalized_pred = pred.copy()
                    if 'volatility_range' in normalized_pred:
                        normalized_pred['volatility_range'] = normalize_volatility_range(
                            normalized_pred['volatility_range'])
                    normalized_hourly.append(normalized_pred)

                stock_obj['model_predictions']['revised'] = {
                    'hourlyPrices': normalized_hourly,
                    'marketOpen': revised_data.get('marketOpen'),
                    'marketClose': revised_data.get('marketClose'),
                    'marketTiming': revised_data.get('marketTiming', ''),
                    'reasoning': revised_data.get('reasoning', '')
                }

            if category == "TOP_OPPORTUNITY":
                top_opportunities.append(stock_obj)
            elif category == "WATCHLIST":
                watchlist.append(stock_obj)
            elif category == "AVOID":
                avoid_list.append(stock_obj)
            else:
                if action == "BUY":
                    top_opportunities.append(stock_obj)
                elif action == "HOLD":
                    watchlist.append(stock_obj)
                elif action == "SELL":
                    avoid_list.append(stock_obj)
                else:
                    watchlist.append(stock_obj)

        stock_count = {
            'buys': len(top_opportunities),
            'holds': len(watchlist),
            'sells': len(avoid_list),
            'total': len(analyzed_stocks)
        }

        portfolio_allocation = {}
        raw_allocation = response_json.get('portfolioAllocation') or {}
        for key, value in raw_allocation.items():
            try:
                portfolio_allocation[key] = float(value) if isinstance(value, (int, float, str)) else 0
            except (ValueError, TypeError):
                portfolio_allocation[key] = 0

        now = time_service.now(eastern_tz)
        next_trading_day = get_next_trading_day(eastern_tz)
        next_market_open = datetime.combine(next_trading_day, datetime.strptime("09:30", "%H:%M").time())
        next_market_open = eastern_tz.localize(next_market_open)

        portfolio_recommendation = {
            'timestamp': now.isoformat(),
            'target_trading_datetime': next_market_open.isoformat(),
            'marketOutlook': response_json.get('marketOutlook'),
            'topOpportunities': top_opportunities,
            'portfolioAllocation': portfolio_allocation,
            'watchlist': watchlist,
            'avoidList': avoid_list,
            'rankedBuys': ranked_buys,
            'strategy': response_json.get('strategy'),
            'riskAssessment': response_json.get('riskAssessment'),
            'correlations': response_json.get('sectorCorrelations', {}),
            'stockCount': stock_count,
            'alternativeInvestments': response_json.get('alternativeInvestments') or [],
            'disclaimer': "This is for informational purposes only and not financial advice. Investing in stocks involves risk."
        }

        fresh_count = len([s for s in analyzed_stocks if s.get('freshness') == 'fresh'])
        recent_count = len([s for s in analyzed_stocks if s.get('freshness') == 'recent'])
        aged_count = len([s for s in analyzed_stocks if s.get('freshness') == 'aged'])
        outdated_count = len([s for s in analyzed_stocks if s.get('freshness') == 'outdated'])

        portfolio_recommendation['recommendationStats'] = {
            'fresh': fresh_count,
            'recent': recent_count,
            'aged': aged_count,
            'outdated': outdated_count,
            'total': fresh_count + recent_count + aged_count + outdated_count
        }

        portfolio_recommendation['freshness'] = "fresh"
        portfolio_recommendation['generatedAt'] = now.isoformat()

        await log_service.success(f"Successfully parsed portfolio recommendation with {len(analyzed_stocks)} stocks")
        return portfolio_recommendation

    except Exception as e:
        await log_service.error(f"Error parsing portfolio response: {str(e)}")

        try:
            import os
            import aiofiles

            debug_file = os.path.join('/tmp', f'portfolio_response_debug_{time_service.timestamp()}.txt')
            async with aiofiles.open(debug_file, 'w') as f:
                await f.write(response_text)
            await log_service.info(f"Saved problematic response to {debug_file}")
        except IOError:
            pass

        raise RuntimeError(f"Error parsing portfolio response: {str(e)}")

def filter_specialist_text_for_master(analysis_text: str) -> str:
    if not analysis_text:
        return ""

    sections_to_remove = [
        r"\[PREDICTION HISTORY INSIGHTS].*?(?=\n\[|$)",
        r"\[DATA IMPROVEMENT SUGGESTIONS].*?(?=\n\[|$)",
        r"\[DATA INTEGRITY OBSERVATIONS].*?(?=\n\[|$)",
        r"\[DATA RELEVANCE ASSESSMENT].*?(?=\n\[|$)",
    ]

    filtered_text = analysis_text
    for section_pattern in sections_to_remove:
        filtered_text = re.sub(section_pattern, "", filtered_text, flags=re.DOTALL)

    filtered_text = re.sub(r'\[([^]]+)]\(([^)]+)\)', r'[\1]', filtered_text)
    filtered_text = re.sub(r'\n{3,}', '\n\n', filtered_text).strip()

    return filtered_text

CLAUDE_FILTER_PRESETS = {
    'minimal': {
        'entries': False, 'symbol_results': False, 'rolling_windows': False, 'confidence_calibration_details': False,
        'portfolio_history': False, 'top_wins_details': False, 'accuracy_metrics': True, 'model_comparison': True,
        'trends_summary': True, 'confidence_summary': True, 'big_move_detection': True, 'metadata': True
    },
    'standard': {
        'entries': False, 'symbol_results': False, 'rolling_windows': False, 'confidence_calibration_details': False,
        'portfolio_history': False, 'top_wins_details': True, 'accuracy_metrics': True, 'model_comparison': True,
        'trends_summary': True, 'confidence_summary': True, 'high_impact_metrics': True, 'big_move_detection': True,
        'magnitude_analysis': True, 'portfolio_metrics_summary': True, 'weekly_performance': True,
        'portfolio_specific': True, 'symbol_performance_summary': True, 'metadata': True
    },
    'experimental': {
        'entries': False, 'symbol_results': False, 'rolling_windows': True, 'confidence_calibration_details': True,
        'portfolio_history': True, 'top_wins_details': True, 'accuracy_metrics': True, 'model_comparison': True,
        'trends_summary': True, 'confidence_summary': True, 'high_impact_metrics': True, 'big_move_detection': True,
        'magnitude_analysis': True, 'portfolio_metrics_summary': True, 'weekly_performance': True,
        'portfolio_specific': True, 'symbol_performance_summary': True, 'metadata': True
    }
}