import re
from typing import Dict, List, Any, Optional
from collections import defaultdict

class SignalExtractionHelper:
    def __init__(self):
        self.signal_categories = {
            'options': {
                'T1: Aggregate Put/Call Ratio Analysis',
                'T1: Max Pain & Volatility Skew',
                'T1: Gamma Exposure & Key Levels',
                'T1: Volatility Term Structure',
                'T1: Sentiment Term Structure',
                'T1: Unusual Activity Analysis',
                'T1: Smart Money Flow',
                'T2: Close-to-Close & Intraday Slope Prediction',
                'T2: Historical Price & Flow Momentum Analysis',
                'T2: Historical Sentiment vs Price Dislocation',
                'T3: Historical Context & Percentile Ranking',
                'T3: Comparative Volatility Analysis',
                'T3: Net Institutional Premium Bias',
                'T3: Analogous Flow Profile Analysis',
                'T3: Analogous Gamma Profile Analysis',
                'T3: Analogous Unusual Activity Profile Analysis'
            },
            'image': {
                'Master Temporal Impact (Tuned)',
                'Component Temporal Impacts (Tuned)',
                'All Signal Dynamics (Velocity & Acceleration)',
                'Tuned Hybrid Signal'
            },
            'vibe': {
                'Primary Bullish Narrative Strength',
                'Primary Bearish Narrative Strength',
                'SEC Filing Impact (e.g., Form 4, 8-K)',
                'Aggregate Analyst Commentary Tone',
                'Competitive Landscape Shift',
                'Narrative Velocity/Virality',
                'Contrarian Signal Presence',
                'Source Reliability Weighted Conviction'
            },
            'master': {
                'Stock-specific News Sentiment',
                'Industry-wide Sentiment',
                'Market-wide Sentiment',
                'Recent Stock Price Action',
                'Historical Stock Price Trends',
                'Recent Market Index Behavior',
                'Historical Market Index Trends',
                'Earnings Context',
                'Prediction Accuracy History (JSON)',
                'Visual Prediction History Analysis',
                'Previous Prediction History Insights',
                'Intraday Pattern Prediction Analysis',
            },
        }

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

    def _calculate_movement_weighted_accuracy(self, signal_results: List[Dict]) -> float:
        if not signal_results:
            return 50.0

        weighted_accuracy_scores = []
        intensity_weights = []

        for signal in signal_results:
            price_change_pct = signal.get('price_change_pct')
            is_correct = signal.get('is_correct', False)

            if price_change_pct is None:
                continue

            if abs(price_change_pct) <= 0.5:
                continue

            magnitude_info = self._classify_movement_magnitude_detailed(price_change_pct)
            intensity_weight = max(1.0, magnitude_info['level'] ** 1.5)

            if is_correct:
                base_accuracy = 100.0
            else:
                base_accuracy = 0.0

            weighted_accuracy_scores.append(base_accuracy * intensity_weight)
            intensity_weights.append(intensity_weight)

        if not intensity_weights:
            return None

        internal_score = sum(weighted_accuracy_scores) / sum(intensity_weights)
        return float(internal_score)

    def extract_signals_from_analysis(self, analysis_text: str, model_name: str) -> List[Dict[str, Any]]:
        if model_name not in self.signal_categories:
            return []

        log_section = re.search(r'\[SIGNAL RELIABILITY LOG\](.*?)(?=\n\[|$)', analysis_text, re.DOTALL)
        if not log_section:
            return []

        return self._parse_signal_table(log_section.group(1), model_name)

    def _parse_signal_table(self, table_text: str, model_name: str) -> List[Dict[str, Any]]:
        signals = []
        table_pattern = r'\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|'

        valid_categories = self.signal_categories.get(model_name, set())

        matches = re.finditer(table_pattern, table_text)
        for match in matches:
            if len(match.groups()) >= 5:
                metric, signal_desc, direction, strength, confidence = [g.strip() for g in match.groups()]

                if metric.lower() in ['metric', ':---', ''] or not direction or direction == '':
                    continue

                if metric not in valid_categories:
                    continue

                confidence_match = re.search(r'(\d+)', confidence)
                confidence_pct = int(confidence_match.group(1)) if confidence_match else 0

                if direction.upper() in ['BUY', 'SELL', 'HOLD']:
                    signal_data = {
                        'signal_name': metric,
                        'signal_description': signal_desc,
                        'predicted_direction': direction.upper(),
                        'strength': strength,
                        'confidence': confidence_pct / 100.0,
                        'model': model_name,
                        'category': metric
                    }
                    signals.append(signal_data)

        return signals

    def calculate_signal_aggregates(self, signal_results: List[Dict]) -> Dict[str, Any]:
        if not signal_results:
            return {}

        total_signals = len(signal_results)
        correct_signals = sum(1 for s in signal_results if s.get('is_correct', False))
        overall_accuracy = (correct_signals / total_signals * 100) if total_signals > 0 else 0

        category_stats = self._group_stats_by_field(signal_results, 'category')
        strength_stats = self._group_stats_by_field(signal_results, 'strength')
        direction_stats = self._group_stats_by_field(signal_results, 'predicted_direction')

        confidence_weighted_accuracy = self._calculate_confidence_weighted_accuracy(signal_results)
        movement_weighted_accuracy = self._calculate_movement_weighted_accuracy(signal_results)
        signal_consensus = self._calculate_signal_consensus(signal_results)

        return {
            'total_signals': total_signals,
            'correct_signals': correct_signals,
            'overall_accuracy': overall_accuracy,
            'confidence_weighted_accuracy': confidence_weighted_accuracy,
            'movement_weighted_accuracy': movement_weighted_accuracy,
            'accuracy_by_category': category_stats,
            'accuracy_by_strength': strength_stats,
            'accuracy_by_direction': direction_stats,
            'signal_consensus': signal_consensus,
            'confidence_calibration': self._calculate_confidence_calibration(signal_results)
        }

    def _group_stats_by_field(self, signal_results: List[Dict], field_name: str) -> Dict[str, Dict]:
        groups = defaultdict(lambda: {'total': 0, 'correct': 0, 'confidence_sum': 0, 'weighted_scores': [], 'weights': []})

        for signal in signal_results:
            field_value = signal.get(field_name, 'Unknown')
            groups[field_value]['total'] += 1
            groups[field_value]['confidence_sum'] += signal.get('confidence', 0)

            if signal.get('is_correct', False):
                groups[field_value]['correct'] += 1

            price_change_pct = signal.get('price_change_pct')
            if price_change_pct is not None and abs(price_change_pct) > 0.5:
                magnitude_info = self._classify_movement_magnitude_detailed(price_change_pct)
                intensity_weight = max(1.0, magnitude_info['level'] ** 1.5)
                base_accuracy = 100.0 if signal.get('is_correct', False) else 0.0
                groups[field_value]['weighted_scores'].append(base_accuracy * intensity_weight)
                groups[field_value]['weights'].append(intensity_weight)

        stats = {}
        for field_value, data in groups.items():
            if data['total'] > 0:
                movement_weighted = None
                if data['weights']:
                    movement_weighted = sum(data['weighted_scores']) / sum(data['weights'])

                stats[field_value] = {
                    'total': data['total'],
                    'correct': data['correct'],
                    'accuracy': (data['correct'] / data['total']) * 100,
                    'avg_confidence': (data['confidence_sum'] / data['total']) * 100,
                    'movement_weighted_accuracy': movement_weighted
                }

        return stats

    def _calculate_confidence_weighted_accuracy(self, signal_results: List[Dict]) -> float:
        if not signal_results:
            return 50.0

        weighted_sum = 0
        weight_total = 0

        for signal in signal_results:
            confidence = signal.get('confidence', 0)
            is_correct = signal.get('is_correct', False)

            weighted_sum += confidence * (100.0 if is_correct else 0.0)
            weight_total += confidence

        if weight_total == 0:
            return 50.0

        return weighted_sum / weight_total

    def _calculate_signal_consensus(self, signal_results: List[Dict]) -> Dict[str, Any]:
        if not signal_results:
            return {}

        direction_counts = defaultdict(int)
        direction_confidence_sums = defaultdict(float)

        for signal in signal_results:
            direction = signal.get('predicted_direction', 'UNKNOWN')
            confidence = signal.get('confidence', 0)

            direction_counts[direction] += 1
            direction_confidence_sums[direction] += confidence

        consensus_direction = max(direction_counts.keys(), key=lambda d: direction_counts[d])
        consensus_strength = direction_counts[consensus_direction] / len(signal_results)

        consensus_correct = False
        if signal_results:
            actual_direction = signal_results[0].get('actual_direction')
            consensus_correct = (consensus_direction == actual_direction)

        return {
            'consensus_direction': consensus_direction,
            'consensus_strength': consensus_strength,
            'consensus_correct': consensus_correct,
            'direction_distribution': dict(direction_counts),
            'weighted_confidence_by_direction': {
                direction: direction_confidence_sums[direction] / direction_counts[direction]
                for direction in direction_counts.keys() if direction_counts[direction] > 0
            }
        }

    def _calculate_confidence_calibration(self, signal_results: List[Dict]) -> Dict[str, Any]:
        if len(signal_results) < 5:
            return {}

        buckets = {
            'Very High (80-100%)': [],
            'High (60-79%)': [],
            'Medium (40-59%)': [],
            'Low (0-39%)': []
        }

        for signal in signal_results:
            confidence_pct = signal.get('confidence', 0) * 100
            if confidence_pct >= 80:
                buckets['Very High (80-100%)'].append(signal)
            elif confidence_pct >= 60:
                buckets['High (60-79%)'].append(signal)
            elif confidence_pct >= 40:
                buckets['Medium (40-59%)'].append(signal)
            else:
                buckets['Low (0-39%)'].append(signal)

        calibration_data = {}
        for bucket_name, signals in buckets.items():
            if len(signals) > 0:
                correct_count = sum(1 for s in signals if s.get('is_correct', False))
                accuracy = (correct_count / len(signals)) * 100
                avg_confidence = sum(s.get('confidence', 0) for s in signals) / len(signals) * 100

                calibration_data[bucket_name] = {
                    'signal_count': len(signals),
                    'correct_count': correct_count,
                    'accuracy': accuracy,
                    'avg_confidence': avg_confidence,
                    'calibration_gap': abs(avg_confidence - accuracy)
                }

        return calibration_data

    def calculate_portfolio_signal_performance(self, all_prediction_entries: List[Dict]) -> Optional[Dict]:
        if not all_prediction_entries:
            return None

        all_signals = []
        signals_by_model = defaultdict(list)
        signals_by_category = defaultdict(list)

        recommendations_with_signals = set()
        for entry in all_prediction_entries:
            signal_accuracy = entry.get('signal_accuracy', {})
            if signal_accuracy:
                recommendations_with_signals.add(entry.get('timestamp'))

            for model_name, model_data in signal_accuracy.items():
                signal_results = model_data.get('signal_results', [])
                for signal in signal_results:
                    signal_copy = signal.copy()
                    signal_copy['symbol'] = entry.get('symbol', 'UNKNOWN')
                    signal_copy['date'] = entry.get('target_trading_datetime', '')

                    all_signals.append(signal_copy)
                    signals_by_model[model_name].append(signal_copy)
                    category = signal.get('category', 'Other')
                    signals_by_category[category].append(signal_copy)

        if not all_signals:
            return None

        overall_correct = sum(1 for s in all_signals if s.get('is_correct', False))
        overall_accuracy = (overall_correct / len(all_signals) * 100) if all_signals else 0
        overall_movement_weighted = self._calculate_movement_weighted_accuracy(all_signals)

        model_performance = {}
        for model_name, model_signals in signals_by_model.items():
            correct = sum(1 for s in model_signals if s.get('is_correct', False))
            accuracy = (correct / len(model_signals) * 100) if model_signals else 0
            confidence_weighted = self._calculate_confidence_weighted_accuracy(model_signals)
            movement_weighted = self._calculate_movement_weighted_accuracy(model_signals)
            model_performance[model_name] = {
                'total': len(model_signals),
                'correct': correct,
                'accuracy': accuracy,
                'movement_weighted_accuracy': movement_weighted,
                'confidence_weighted_accuracy': confidence_weighted,
                'rating': self._get_performance_rating(accuracy)
            }

        category_performance = {}
        for category, category_signals in signals_by_category.items():
            correct = sum(1 for s in category_signals if s.get('is_correct', False))
            accuracy = (correct / len(category_signals) * 100) if category_signals else 0
            confidence_weighted = self._calculate_confidence_weighted_accuracy(category_signals)
            movement_weighted = self._calculate_movement_weighted_accuracy(category_signals)

            model_breakdown_signals = defaultdict(list)
            for signal in category_signals:
                model_breakdown_signals[signal.get('model', 'unknown')].append(signal)

            model_breakdown_stats = {}
            for model_name, model_signals in model_breakdown_signals.items():
                model_correct = sum(1 for s in model_signals if s.get('is_correct', False))
                model_accuracy = (model_correct / len(model_signals) * 100) if model_signals else 0
                model_confidence_weighted = self._calculate_confidence_weighted_accuracy(model_signals)
                model_movement_weighted = self._calculate_movement_weighted_accuracy(model_signals)
                model_breakdown_stats[model_name] = {
                    'total': len(model_signals),
                    'correct': model_correct,
                    'accuracy': model_accuracy,
                    'movement_weighted_accuracy': model_movement_weighted,
                    'confidence_weighted_accuracy': model_confidence_weighted,
                    'rating': self._get_performance_rating(model_accuracy)
                }

            category_performance[category] = {
                'total': len(category_signals),
                'correct': correct,
                'accuracy': accuracy,
                'movement_weighted_accuracy': movement_weighted,
                'confidence_weighted_accuracy': confidence_weighted,
                'rating': self._get_performance_rating(accuracy),
                'model_breakdown': model_breakdown_stats
            }

        top_categories_tuples = sorted(
            category_performance.items(),
            key=lambda x: (x[1].get('movement_weighted_accuracy') or 0, x[1]['accuracy']),
            reverse=True
        )

        model_rankings_tuples = sorted(
            model_performance.items(),
            key=lambda x: (x[1].get('movement_weighted_accuracy') or 0, x[1]['accuracy']),
            reverse=True
        )

        top_categories = [{'category': cat, **metrics} for cat, metrics in top_categories_tuples]
        model_rankings = [{'model': model, **metrics} for model, metrics in model_rankings_tuples]

        return {
            'overall_accuracy': overall_accuracy,
            'overall_movement_weighted_accuracy': overall_movement_weighted,
            'total_signals': len(all_signals),
            'by_model': model_performance,
            'by_category': category_performance,
            'top_categories': top_categories,
            'model_rankings': model_rankings,
            'recommendations_with_signals': len(recommendations_with_signals),
            'best_performing_category': top_categories[0]['category'] if top_categories else None,
            'worst_performing_category': top_categories[-1]['category'] if len(top_categories) > 1 else None
        }

    def _get_performance_rating(self, accuracy: float) -> str:
        if accuracy >= 70:
            return "Excellent"
        elif accuracy >= 60:
            return "Good"
        elif accuracy >= 50:
            return "Average"
        elif accuracy >= 40:
            return "Below Average"
        else:
            return "Poor"