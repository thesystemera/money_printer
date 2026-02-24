from __future__ import annotations

from typing import Dict, Any, Optional, List
import aiofiles
import aiohttp
import math
import numpy as np
from collections import defaultdict
from polygon import RESTClient
from services import log_service, time_service
from services.api_utils import async_retry_decorator
from services.advanced_options_analysis_service import AdvancedOptionsAnalysisService
import datetime
import asyncio
from scipy import stats
from dataclasses import dataclass
from abc import ABC, abstractmethod
import json
import pytz
import traceback
import os
import random
from datetime import timedelta
from blackscholes import BlackScholesCall, BlackScholesPut
from py_vollib.black_scholes.implied_volatility import implied_volatility as iv_solver
import time
import hashlib

class Constants:
    MAX_RETRIES = 5
    INITIAL_DELAY = 0.5
    API_SEMAPHORE_LIMIT = 25
    API_DELAY_VOLUME = 0.5
    API_DELAY_GENERAL = 0.25

    GRANULAR_SAMPLE_PERCENTAGE = 0.25
    FULL_SAMPLE_PERCENTAGE = 1.0

    CURRENT_SNAPSHOT_TTL = 1 * 60 * 60
    HISTORICAL_TTL = 6 * 30 * 24 * 60 * 60
    ANNUAL_TRADING_DAYS = 252
    TRADING_MINUTES_PER_DAY = 390
    UNUSUAL_Z_SCORE_PERCENTILE = 75
    UNUSUAL_VOL_OI_PERCENTILE = 65

    MAX_DTE = 180
    MAX_ACTIVE_CONTRACTS_PER_TYPE = 10
    MAX_DAILY_HISTORICAL_ENTRIES = 30
    MAX_EXPIRATIONS_DETAILED = 6
    MAX_OUTPUT_UNUSUAL_CONTRACTS = 20
    MAX_OUTPUT_GAMMA_STRIKES = 20
    MAX_GREEKS_DETAIL_CONTRACTS = 20
    MAX_KEY_LEVELS_OUTPUT = 20
    MAX_SMART_MONEY_SIGNALS_PER_CATEGORY = 5
    MAX_ANALOGOUS_DAYS = 10
    MIN_DATA_POINTS_FOR_STATS = 10

    MARKET_START_TIME = "09:30"
    MARKET_END_TIME = "16:00"
    BUCKET_INTERVAL_MINUTES = 30

    RISK_FREE_RATE = 0.04

    MIN_PATTERN_PERFORMANCE_DAYS = 2

    @staticmethod
    def generate_time_buckets():
        buckets = []
        start_h, start_m = map(int, Constants.MARKET_START_TIME.split(':'))
        end_h, end_m = map(int, Constants.MARKET_END_TIME.split(':'))
        current = start_h * 60 + start_m
        end = end_h * 60 + end_m

        while current < end:
            h1, m1 = current // 60, current % 60
            h2, m2 = (current + Constants.BUCKET_INTERVAL_MINUTES) // 60, (
                    current + Constants.BUCKET_INTERVAL_MINUTES) % 60
            buckets.append({
                "name": f"bucket_{h1:02d}{m1:02d}",
                "start_time": f"{h1:02d}:{m1:02d}",
                "end_time": f"{h2:02d}:{m2:02d}",
                "label": f"{h1:02d}:{m1:02d}-{h2:02d}:{m2:02d}"
            })
            current += Constants.BUCKET_INTERVAL_MINUTES
        return buckets

Constants.TIME_BUCKETS = Constants.generate_time_buckets()


@dataclass
class UnifiedContract:
    ticker: str
    contract_type: str
    strike_price: float
    expiration_date: str
    timestamp: datetime.datetime
    stock_price: float = 0
    volume: float = 0
    open_interest: float = 0
    options_price: float = 0
    premium: float = 0
    delta: float = 0
    gamma: float = 0
    theta: float = 0
    vega: float = 0
    vanna: float = 0
    charm: float = 0
    implied_volatility: float = 0
    data_source: str = ""
    tier: int = 0
    time_bucket: str = ""
    moneyness: float = 0
    moneyness_bucket: str = ""
    activity_score: float = 0
    flow_classification: str = "Ambiguous"

    def export_contract_as_dict(self) -> dict:
        result = {
            "strike": self.strike_price,
            "expiration": self.expiration_date,
            "type": self.contract_type,
            "volume": self.volume,
            "open_interest": self.open_interest,
            "stock_price": self.stock_price,
            "moneyness": round(self.moneyness, 4),
            "moneyness_bucket": self.moneyness_bucket,
            "activity_score": self.activity_score,
            "flow_classification": self.flow_classification
        }
        if self.options_price > 0:
            result["options_price"] = round(self.options_price, 2)
        if self.premium > 0:
            result["premium"] = self.premium
        if self.implied_volatility > 0:
            result["implied_volatility"] = round(self.implied_volatility, 4)
        if self.delta != 0:
            result["delta"] = round(self.delta, 4)
        if self.gamma != 0:
            result["gamma"] = round(self.gamma, 6)
        if self.theta != 0:
            result["theta"] = round(self.theta, 2)
        if self.vega != 0:
            result["vega"] = round(self.vega, 4)
        if self.vanna != 0:
            result["vanna"] = round(self.vanna, 4)
        if self.charm != 0:
            result["charm"] = round(self.charm, 4)
        return result

@dataclass
class UnifiedMetrics:
    call_volume: float = 0
    put_volume: float = 0
    call_oi: float = 0
    put_oi: float = 0
    call_premium: float = 0
    put_premium: float = 0
    call_delta_sum: float = 0
    put_delta_sum: float = 0
    volume_ratio: float = 0
    oi_ratio: float = 0
    premium_ratio: float = 0
    delta_weighted_ratio: float = 0
    has_volume_data: bool = False
    has_premium_data: bool = False
    has_oi_data: bool = False
    has_delta_data: bool = False
    has_gamma_data: bool = False
    has_iv_data: bool = False
    stock_volume: float = 0
    current_price: float = 0
    total_contracts: int = 0

@dataclass
class ProcessedResults:
    metrics: UnifiedMetrics
    processed_contracts: List[UnifiedContract]
    unusual_contracts: Dict[str, Any]
    gamma_exposure: Dict[str, Any]
    moneyness_distribution: Dict[str, Any]
    key_levels: Dict[str, Any]
    smart_money_analysis: Optional[Dict[str, Any]]
    max_pain: Optional[Dict[str, Any]]
    volatility_skew: Optional[Dict[str, Any]]
    term_structure_analysis: Optional[Dict[str, Any]]
    realized_volatility: float = 0.0

class HistoricalContext:
    def __init__(self, daily_data: List[Dict]):
        """Stores historical daily data and calculates prediction-weighted baselines."""
        self.daily_data = daily_data
        self.contract_volumes = []
        self.contract_premiums = []
        self._bucket_baselines_cache = {}
        self.prediction_weighted_volume_pc_ratio = 1.0
        self.prediction_weighted_premium_pc_ratio = 1.0

        self.price_baselines = {}
        self.volume_baselines = {}
        self.daily_price_changes = []
        self.intraday_volatilities = []
        self.call_volumes = []
        self.put_volumes = []
        self.call_premiums = []
        self.put_premiums = []
        self.total_volumes = []
        self.volume_pc_ratios = []
        self.premium_pc_ratios = []
        self.daily_total_volumes = []
        self.daily_volume_pc_ratios_agg = []
        self.daily_premium_pc_ratios_agg = []
        self.all_vol_oi_ratios = []
        self.all_volumes = []
        self.all_premiums = []
        self.volume_threshold = 0
        self.premium_threshold = 0
        self.premium_percentile_10 = 0
        self.premium_percentile_20 = 0
        self.premium_percentile_80 = float('inf')
        self.premium_percentile_85 = float('inf')
        self.premium_percentile_90 = float('inf')
        self.premium_percentile_95 = float('inf')
        self.premium_percentile_98 = float('inf')
        self.vol_oi_percentile_80 = float('inf')
        self.vol_oi_percentile_85 = float('inf')
        self.vol_oi_percentile_90 = float('inf')
        self.vol_oi_percentile_95 = float('inf')
        self.volume_percentile_10 = 10
        self.volume_percentile_80 = float('inf')
        self.volume_percentile_85 = float('inf')
        self.volume_percentile_90 = float('inf')
        self.volume_percentile_95 = float('inf')
        self.volume_percentile_75 = 1000
        self.market_structure_baselines = defaultdict(list)
        self.volume_deviations_by_bucket = {}
        self.premium_deviations_by_bucket = {}

    async def build_baselines(self):
        if not self.daily_data:
            await log_service.options("[HistoricalContext] No historical data provided. Baselines will be empty.")
            return

        await log_service.options("[HistoricalContext] Building Historical Baselines...")
        self.prediction_weighted_volume_pc_ratio = await self._calculate_prediction_weighted_ratio('volume')
        self.prediction_weighted_premium_pc_ratio = await self._calculate_prediction_weighted_ratio('premium')
        await log_service.options(
            f"[HistoricalContext] Prediction-Weighted Volume P/C Ratio: {self.prediction_weighted_volume_pc_ratio:.4f}")
        await log_service.options(
            f"[HistoricalContext] Prediction-Weighted Premium P/C Ratio: {self.prediction_weighted_premium_pc_ratio:.4f}")

        await self.baseline_calculate_historical_metrics()
        await self.baseline_calculate_time_buckets()
        await self.baseline_calculate_volatility_patterns()
        await self.baseline_calculate_market_structure()

        await log_service.options("[HistoricalContext] Historical Baselines Calculated.")

    async def _calculate_prediction_weighted_ratio(self, ratio_type: str) -> float:
        outcomes_by_ratio: Dict[float, Dict[str, Any]] = defaultdict(lambda: {'correct': 0, 'total': 0, 'outcomes': []})
        all_ratios = []

        all_price_changes = []
        for day_idx, day in enumerate(self.daily_data):
            time_buckets = day.get('time_buckets', {})
            bucket_names = list(time_buckets.keys())

            for bucket_idx, bucket_name in enumerate(bucket_names):
                bucket_data = time_buckets.get(bucket_name, {})
                current_price = bucket_data.get('stock_price', 0)
                if not current_price > 0: continue

                next_price = self._get_next_price(time_buckets, bucket_names, bucket_idx, day_idx)
                if next_price == 0: next_price = current_price

                price_change = abs((next_price - current_price) / current_price)
                if price_change > 0:
                    all_price_changes.append(round(price_change, 10))

        if len(all_price_changes) > 3:
            volatility_std = round(float(np.std(all_price_changes)), 10)
            volatility_mean = round(float(np.mean(all_price_changes)), 10)
            volatility_75th = round(float(np.percentile(all_price_changes, 75)), 10)
        else:
            volatility_std = 0.02
            volatility_mean = 0.01
            volatility_75th = 0.03

        for day_idx, day in enumerate(self.daily_data):
            time_buckets = day.get('time_buckets', {})
            bucket_names = list(time_buckets.keys())

            for bucket_idx, bucket_name in enumerate(bucket_names):
                bucket_data = time_buckets.get(bucket_name, {})
                metrics = bucket_data.get("put_call_ratios", {})

                ratio = 0
                if ratio_type == 'volume':
                    ratio = UnifiedUtils.calculate_safe_ratio(metrics.get('put_volume', 0),
                                                              metrics.get('call_volume', 0))
                elif ratio_type == 'premium':
                    ratio = UnifiedUtils.calculate_safe_ratio(metrics.get('put_premium', 0),
                                                              metrics.get('call_premium', 0))

                if ratio > 0 and ratio != 99.99 and ratio != 1.0:
                    all_ratios.append(ratio)
                    current_price = bucket_data.get('stock_price', 0)
                    if not current_price > 0: continue

                    next_price = self._get_next_price(time_buckets, bucket_names, bucket_idx, day_idx)
                    if next_price == 0: next_price = current_price

                    price_change = round((next_price - current_price) / current_price, 10)
                    predicted_direction = 1 if ratio < 1 else -1
                    actual_direction = 1 if price_change > 0 else -1
                    is_correct = 1 if predicted_direction == actual_direction else 0

                    abs_price_change = abs(price_change)

                    if volatility_std > 0:
                        price_change_zscore = round((abs_price_change - volatility_mean) / volatility_std, 8)
                        capped_zscore = max(0, min(price_change_zscore, 3.0))
                        magnitude_weight = round(1.0 + (capped_zscore * 0.3), 8)
                    else:
                        if abs_price_change > volatility_75th:
                            magnitude_weight = 1.5
                        else:
                            magnitude_weight = 1.0

                    accuracy_weight = 1.0 if is_correct else 0.4

                    final_weight = round(accuracy_weight * magnitude_weight, 8)

                    ratio_key = round(ratio, 2)
                    outcomes_by_ratio[ratio_key]['correct'] += is_correct
                    outcomes_by_ratio[ratio_key]['total'] += 1
                    outcomes_by_ratio[ratio_key]['outcomes'].append({'ratio': ratio, 'weight': final_weight})

        weighted_ratios = []
        total_weight = 0
        for ratio_key, data in outcomes_by_ratio.items():
            if data['total'] == 0: continue
            consistency_score = round(data['correct'] / data['total'], 8)
            for outcome in data['outcomes']:
                final_weight = round(consistency_score * outcome['weight'], 8)
                weighted_ratios.append(round(outcome['ratio'] * final_weight, 10))
                total_weight = round(total_weight + final_weight, 10)

        if total_weight > 0:
            return round(sum(weighted_ratios) / total_weight, 6)

        return sorted(all_ratios)[len(all_ratios) // 2]

    def _get_next_price(self, time_buckets, bucket_names, bucket_idx, day_idx):
        """Helper to get next price, extracted to reduce duplication."""
        next_price = 0

        for next_idx in range(bucket_idx + 1, len(bucket_names)):
            next_price = time_buckets.get(bucket_names[next_idx], {}).get('stock_price', 0)
            if next_price > 0: break

        if next_price == 0 and day_idx + 1 < len(self.daily_data):
            next_day_buckets = self.daily_data[day_idx + 1].get('time_buckets', {})
            for next_bucket in next_day_buckets.values():
                next_price = next_bucket.get('stock_price', 0)
                if next_price > 0: break

        return next_price

    async def baseline_calculate_time_buckets(self):
        self.price_baselines = {}
        self.volume_baselines = {}

        for bucket_config in Constants.TIME_BUCKETS:
            bucket_name = bucket_config["name"]
            bucket_prices, bucket_call_volumes, bucket_put_volumes, bucket_total_volumes = [], [], [], []

            for day in self.daily_data:
                time_buckets = day.get('time_buckets', {})
                bucket_data = time_buckets.get(bucket_name, {})
                metrics = bucket_data.get("put_call_ratios", {})

                if (stock_price := bucket_data.get('stock_price', 0)) > 0:
                    bucket_prices.append(stock_price)

                call_vol = metrics.get('call_volume', 0)
                put_vol = metrics.get('put_volume', 0)
                total_vol = call_vol + put_vol

                if call_vol > 0: bucket_call_volumes.append(call_vol)
                if put_vol > 0: bucket_put_volumes.append(put_vol)
                if total_vol > 0: bucket_total_volumes.append(total_vol)

            if not bucket_prices:
                self.price_baselines[bucket_name] = {'median': 0, 'count': 0}
                continue

            self.price_baselines[bucket_name] = {'median': sorted(bucket_prices)[len(bucket_prices) // 2],
                                                 'count': len(bucket_prices)}
            self.volume_baselines[bucket_name] = {
                'call_median': sorted(bucket_call_volumes)[len(bucket_call_volumes) // 2] if bucket_call_volumes else 0,
                'put_median': sorted(bucket_put_volumes)[len(bucket_put_volumes) // 2] if bucket_put_volumes else 0,
                'total_median': sorted(bucket_total_volumes)[
                    len(bucket_total_volumes) // 2] if bucket_total_volumes else 0,
                'call_count': len(bucket_call_volumes),
                'put_count': len(bucket_put_volumes),
                'total_count': len(bucket_total_volumes)
            }

        await log_service.options(f"[HistoricalContext] Time Buckets: Processed {len(self.volume_baselines)} buckets.")

    async def baseline_calculate_volatility_patterns(self):
        """Calculate volatility distribution patterns from historical price movements."""
        self.daily_price_changes = []
        self.intraday_volatilities = []
        for day in self.daily_data:
            day_prices = [b.get('stock_price', 0) for b in day.get('time_buckets', {}).values() if
                          b.get('stock_price', 0) > 0]
            if len(day_prices) > 1:
                daily_open, daily_close = day_prices[0], day_prices[-1]
                self.daily_price_changes.append(abs(daily_close - daily_open) / daily_open)
                self.intraday_volatilities.append((max(day_prices) - min(day_prices)) / daily_open)

        self.daily_price_changes.sort()
        self.intraday_volatilities.sort()
        median_daily_change = self.daily_price_changes[
            len(self.daily_price_changes) // 2] if self.daily_price_changes else 0
        median_intraday_vol = self.intraday_volatilities[
            len(self.intraday_volatilities) // 2] if self.intraday_volatilities else 0

        await log_service.options(
            f"[HistoricalContext] Volatility: Median Daily Change={median_daily_change:.4f}, Median Intraday Range={median_intraday_vol:.4f}")

    async def baseline_calculate_historical_metrics(self):
        self.call_volumes, self.put_volumes, self.call_premiums, self.put_premiums = [], [], [], []
        self.total_volumes, self.volume_pc_ratios, self.premium_pc_ratios = [], [], []
        self.daily_total_volumes = []
        self.daily_volume_pc_ratios_agg = []
        self.daily_premium_pc_ratios_agg = []
        self.all_vol_oi_ratios = []

        if not self.contract_volumes:
            self.all_volumes = []
        else:
            self.all_volumes = self.contract_volumes

        if not self.contract_premiums:
            self.all_premiums = []
        else:
            self.all_premiums = self.contract_premiums

        for day in self.daily_data:
            current_day_total_volume = 0
            day_total_call_vol, day_total_put_vol, day_total_call_prem, day_total_put_prem = 0, 0, 0, 0

            for bucket_data in day.get('time_buckets', {}).values():
                metrics = bucket_data.get("put_call_ratios", {})
                call_vol, put_vol = metrics.get('call_volume', 0), metrics.get('put_volume', 0)
                call_prem, put_prem = metrics.get('call_premium', 0), metrics.get('put_premium', 0)

                day_total_call_vol += call_vol
                day_total_put_vol += put_vol
                day_total_call_prem += call_prem
                day_total_put_prem += put_prem

                if call_vol > 0: self.call_volumes.append(call_vol)
                if put_vol > 0: self.put_volumes.append(put_vol)
                if call_prem > 0: self.call_premiums.append(call_prem)
                if put_prem > 0: self.put_premiums.append(put_prem)
                total_bucket_vol = call_vol + put_vol
                if total_bucket_vol > 0:
                    self.total_volumes.append(total_bucket_vol)
                    current_day_total_volume += total_bucket_vol
                vol_ratio = UnifiedUtils.calculate_safe_ratio(put_vol, call_vol)
                if vol_ratio != 1.0 and vol_ratio != 99.99: self.volume_pc_ratios.append(vol_ratio)
                prem_ratio = UnifiedUtils.calculate_safe_ratio(put_prem, call_prem)
                if prem_ratio != 1.0 and prem_ratio != 99.99: self.premium_pc_ratios.append(prem_ratio)

                for expiry_data in bucket_data.get('active_contracts', {}).values():
                    for contract_data in expiry_data.get('calls', []) + expiry_data.get('puts', []):
                        vol = contract_data.get('volume', 0)
                        oi = contract_data.get('open_interest', 0)
                        if vol > 0 and oi > 0:
                            self.all_vol_oi_ratios.append(vol / oi)

            if current_day_total_volume > 0:
                self.daily_total_volumes.append(current_day_total_volume)

            daily_vol_ratio_agg = UnifiedUtils.calculate_safe_ratio(day_total_put_vol, day_total_call_vol)
            if daily_vol_ratio_agg != 1.0 and daily_vol_ratio_agg != 99.99:
                self.daily_volume_pc_ratios_agg.append(daily_vol_ratio_agg)

            daily_prem_ratio_agg = UnifiedUtils.calculate_safe_ratio(day_total_put_prem, day_total_call_prem)
            if daily_prem_ratio_agg != 1.0 and daily_prem_ratio_agg != 99.99:
                self.daily_premium_pc_ratios_agg.append(daily_prem_ratio_agg)

        self.all_volumes.sort()
        self.all_premiums.sort()
        self.all_vol_oi_ratios.sort()

        self.volume_threshold = self.all_volumes[int(len(self.all_volumes) * 0.25)] if len(self.all_volumes) > 4 else 0
        self.premium_threshold = self.all_premiums[int(len(self.all_premiums) * 0.25)] if len(
            self.all_premiums) > 4 else 0

        if len(self.all_premiums) > 4:
            self.premium_percentile_10 = self.all_premiums[int(len(self.all_premiums) * 0.10)]
            self.premium_percentile_20 = self.all_premiums[int(len(self.all_premiums) * 0.20)]
            self.premium_percentile_80 = self.all_premiums[int(len(self.all_premiums) * 0.80)]
            self.premium_percentile_85 = self.all_premiums[int(len(self.all_premiums) * 0.85)]
            self.premium_percentile_90 = self.all_premiums[int(len(self.all_premiums) * 0.90)]
            self.premium_percentile_95 = self.all_premiums[int(len(self.all_premiums) * 0.95)]
            self.premium_percentile_98 = self.all_premiums[int(len(self.all_premiums) * 0.98)]
        else:
            self.premium_percentile_10 = 0
            self.premium_percentile_20 = 0
            self.premium_percentile_80 = float('inf')
            self.premium_percentile_85 = float('inf')
            self.premium_percentile_90 = float('inf')
            self.premium_percentile_95 = float('inf')
            self.premium_percentile_98 = float('inf')

        if len(self.all_vol_oi_ratios) > 4:
            self.vol_oi_percentile_80 = self.all_vol_oi_ratios[int(len(self.all_vol_oi_ratios) * 0.80)]
            self.vol_oi_percentile_85 = self.all_vol_oi_ratios[int(len(self.all_vol_oi_ratios) * 0.85)]
            self.vol_oi_percentile_90 = self.all_vol_oi_ratios[int(len(self.all_vol_oi_ratios) * 0.90)]
            self.vol_oi_percentile_95 = self.all_vol_oi_ratios[int(len(self.all_vol_oi_ratios) * 0.95)]
        else:
            self.vol_oi_percentile_80 = float('inf')
            self.vol_oi_percentile_85 = float('inf')
            self.vol_oi_percentile_90 = float('inf')
            self.vol_oi_percentile_95 = float('inf')

        if len(self.all_volumes) > 4:
            self.volume_percentile_10 = self.all_volumes[int(len(self.all_volumes) * 0.10)]
            self.volume_percentile_80 = self.all_volumes[int(len(self.all_volumes) * 0.80)]
            self.volume_percentile_85 = self.all_volumes[int(len(self.all_volumes) * 0.85)]
            self.volume_percentile_90 = self.all_volumes[int(len(self.all_volumes) * 0.90)]
            self.volume_percentile_95 = self.all_volumes[int(len(self.all_volumes) * 0.95)]
        else:
            self.volume_percentile_10 = 10
            self.volume_percentile_80 = float('inf')
            self.volume_percentile_85 = float('inf')
            self.volume_percentile_90 = float('inf')
            self.volume_percentile_95 = float('inf')

        self.volume_percentile_75 = np.percentile(self.total_volumes, 75) if self.total_volumes else 1000
        median_daily_volume = sorted(self.daily_total_volumes)[
            len(self.daily_total_volumes) // 2] if self.daily_total_volumes else 0
        await log_service.options(
            f"[HistoricalContext] Volume Distributions: Processed {len(self.total_volumes)} buckets. Median Daily Volume: {median_daily_volume:,.0f}")

    def baseline_calculate_atm_range(self):
        """Get ATM range multiplier based on historical volatility patterns."""
        if not hasattr(self, 'intraday_volatilities') or not self.intraday_volatilities:
            return 0.05
        idx = int(len(self.intraday_volatilities) * 0.5)
        if idx < len(self.intraday_volatilities):
            median_intraday_vol = self.intraday_volatilities[idx]
            return max(0.02, min(0.15, median_intraday_vol * 0.5))
        return 0.05

    def baseline_get_percentile(self, value, metric_type):
        metric_map = {
            'call_volume': self.call_volumes, 'put_volume': self.put_volumes,
            'call_premium': self.call_premiums, 'put_premium': self.put_premiums,
            'total_volume': self.total_volumes,
            'volume_pc_ratio': self.volume_pc_ratios,
            'premium_pc_ratio': self.premium_pc_ratios,
            'daily_total_volume': self.daily_total_volumes,
            'daily_volume_pc_ratio': self.daily_volume_pc_ratios_agg,
            'daily_premium_pc_ratio': self.daily_premium_pc_ratios_agg
        }
        data = metric_map.get(metric_type, [])
        if not hasattr(self, 'call_volumes') or not data: return 50
        return stats.percentileofscore(data, value) if data else 50

    async def baseline_get_current_bucket_baseline(self, ratio_type='volume'):
        """Get current time bucket baseline for real-time comparison."""
        eastern = pytz.timezone('US/Eastern')
        current_time = time_service.now(eastern)

        market_start_time = datetime.datetime.strptime(Constants.MARKET_START_TIME, "%H:%M").time()
        market_end_time = datetime.datetime.strptime(Constants.MARKET_END_TIME, "%H:%M").time()

        target_bucket_name = None

        if current_time.time() < market_start_time:
            target_bucket_name = Constants.TIME_BUCKETS[0]["name"]
        elif current_time.time() >= market_end_time:
            target_bucket_name = Constants.TIME_BUCKETS[-1]["name"]
        else:
            current_minutes = current_time.hour * 60 + current_time.minute
            for bucket_config in Constants.TIME_BUCKETS:
                start_minutes = int(bucket_config["start_time"][:2]) * 60 + int(bucket_config["start_time"][3:])
                end_minutes = int(bucket_config["end_time"][:2]) * 60 + int(bucket_config["end_time"][3:])
                if start_minutes <= current_minutes < end_minutes:
                    target_bucket_name = bucket_config["name"]
                    break

        if target_bucket_name:
            return await self.baseline_get_bucket_prediction_weighted_ratio(target_bucket_name, ratio_type)

        raise ValueError("Could not determine a valid time bucket. Check system constants and configuration.")

    async def baseline_get_bucket_prediction_weighted_ratio(self, bucket_name, ratio_type='volume'):
        """Get prediction-weighted median P/C ratio for specific time bucket."""
        cache_key = f"{bucket_name}_{ratio_type}_prediction_weighted"
        if cache_key in self._bucket_baselines_cache:
            return self._bucket_baselines_cache[cache_key]

        bucket_ratios_with_outcomes = []
        for day_idx, day in enumerate(self.daily_data):
            bucket_data = day.get('time_buckets', {}).get(bucket_name, {})
            if not bucket_data: continue

            metrics = bucket_data.get("put_call_ratios", {})
            ratio = 0
            if ratio_type == 'volume':
                ratio = UnifiedUtils.calculate_safe_ratio(metrics.get('put_volume', 0), metrics.get('call_volume', 0))
            elif ratio_type == 'premium':
                ratio = UnifiedUtils.calculate_safe_ratio(metrics.get('put_premium', 0), metrics.get('call_premium', 0))

            current_price = bucket_data.get('stock_price', 0)
            if current_price > 0:
                all_buckets = list(day.get('time_buckets', {}).keys())
                current_idx = all_buckets.index(bucket_name) if bucket_name in all_buckets else -1
                if current_idx == -1: continue

                next_price = 0
                for next_idx in range(current_idx + 1, len(all_buckets)):
                    next_price = day.get('time_buckets', {}).get(all_buckets[next_idx], {}).get('stock_price', 0)
                    if next_price > 0: break
                if next_price == 0 and day_idx + 1 < len(self.daily_data):
                    next_day_bucket = self.daily_data[day_idx + 1].get('time_buckets', {}).get(bucket_name, {})
                    next_price = next_day_bucket.get('stock_price', 0)
                if next_price == 0: next_price = current_price

                price_change = (next_price - current_price) / current_price
                predicted_direction = 1 if ratio < 1 else -1
                actual_direction = 1 if price_change > 0 else -1
                prediction_accuracy = 1.0 if predicted_direction == actual_direction else 0.3
                bucket_ratios_with_outcomes.append(
                    {'ratio': ratio, 'weight': prediction_accuracy * (1 + abs(price_change) * 10)})

        total_weight = sum(item['weight'] for item in bucket_ratios_with_outcomes)
        result = sum(item['ratio'] * item['weight'] for item in bucket_ratios_with_outcomes) / total_weight

        self._bucket_baselines_cache[cache_key] = result
        return result

    async def baseline_calculate_market_structure(self):
        self.market_structure_baselines = defaultdict(list)

        for day in self.daily_data:
            for bucket_name, bucket_data in day.get("time_buckets", {}).items():
                contracts = bucket_data.get("active_contracts", {})
                all_contracts_for_bucket = []
                for expiry_data in contracts.values():
                    all_contracts_for_bucket.extend(expiry_data.get("calls", []))
                    all_contracts_for_bucket.extend(expiry_data.get("puts", []))

                if not all_contracts_for_bucket:
                    continue

                near_money_puts = [c.get('implied_volatility', 0) for c in all_contracts_for_bucket if
                                   c.get('type') == 'put' and abs(c.get('moneyness', 0)) < 0.10 and c.get(
                                       'implied_volatility', 0) > 0]
                near_money_calls = [c.get('implied_volatility', 0) for c in all_contracts_for_bucket if
                                    c.get('type') == 'call' and abs(c.get('moneyness', 0)) < 0.10 and c.get(
                                        'implied_volatility', 0) > 0]

                skew_score = 0
                if near_money_puts and near_money_calls:
                    avg_put_iv = sum(near_money_puts) / len(near_money_puts)
                    avg_call_iv = sum(near_money_calls) / len(near_money_calls)
                    if avg_call_iv > 0:
                        skew_score = -((avg_put_iv / avg_call_iv) - 1)

                total_call_gamma = sum(
                    c.get('gamma', 0) for c in all_contracts_for_bucket if
                    c.get('type') == 'call' and c.get('gamma', 0) > 0)
                total_put_gamma = sum(
                    c.get('gamma', 0) for c in all_contracts_for_bucket if
                    c.get('type') == 'put' and c.get('gamma', 0) > 0)

                gamma_score = 0
                if total_call_gamma > 0 and total_put_gamma > 0:
                    gamma_score = (total_call_gamma / total_put_gamma) - 1

                if skew_score != 0 or gamma_score != 0:
                    composite_score = (skew_score * 0.6) + (gamma_score * 0.4)
                    self.market_structure_baselines[bucket_name].append(composite_score)

        await log_service.options(
            f"[HistoricalContext] Market Structure: Processed {sum(len(v) for v in self.market_structure_baselines.values())} total bucket scores.")

class UnifiedUtils:
    @staticmethod
    def extract_strike_from_ticker(ticker: str) -> float:
        clean_ticker = ticker[2:] if ticker.startswith('O:') else ticker
        if len(clean_ticker) < 8 or not clean_ticker[-8:].isdigit():
            raise ValueError(f"Invalid ticker format: '{ticker}'")
        return float(clean_ticker[-8:]) / 1000.0

    @staticmethod
    async def extract_expiration_from_ticker(ticker: str) -> str:
        """Extract expiration date from options ticker symbol."""
        try:
            clean_ticker = ticker[2:] if ticker.startswith('O:') else ticker
            if len(clean_ticker) < 15:
                raise ValueError(f"Ticker too short: '{ticker}'")
            option_type_pos = -1
            for i in range(len(clean_ticker) - 9, -1, -1):
                if clean_ticker[i] in ['C', 'P']:
                    option_type_pos = i
                    break
            if option_type_pos == -1 or option_type_pos < 6:
                raise ValueError("Invalid option type position")
            date_part = clean_ticker[option_type_pos - 6:option_type_pos]
            if len(date_part) != 6 or not date_part.isdigit():
                raise ValueError(f"Invalid date format: '{date_part}'")
            year = "20" + date_part[:2]
            month = date_part[2:4]
            day = date_part[4:6]
            if not (1 <= int(month) <= 12 and 1 <= int(day) <= 31):
                raise ValueError(f"Invalid month/day: {month}/{day}")
            return f"{year}-{month}-{day}"
        except (ValueError, TypeError, IndexError) as e:
            await log_service.options(
                f"[UnifiedUtils] CRITICAL ERROR in extract_expiration_from_ticker: ticker='{ticker}', error={str(e)}")
            raise ValueError(f"Expiration extraction failed for ticker '{ticker}': {str(e)}")

    @staticmethod
    def parse_polygon_contract_type(contract_type):
        """Parse Polygon API contract type into standardized format."""
        if contract_type is None:
            return "unknown"
        type_str = str(contract_type).lower()
        if type_str in ('c', 'call', '0'):
            return "call"
        elif type_str in ('p', 'put', '1'):
            return "put"
        return "unknown"

    @staticmethod
    def calculate_safe_ratio(numerator: float, denominator: float):
        if numerator < 1e-6 and denominator < 1e-6:
            return 0.0

        if denominator < 1e-6:
            return 20.0

        if numerator < 1e-6:
            return 0.05

        ratio = numerator / denominator

        if ratio > 20.0:
            return 20.0
        if ratio < 0.05:
            return 0.05

        return ratio

    @staticmethod
    def normalize_moneyness(strike: float, current_price: float) -> float:
        """Normalize strike price relative to current price as moneyness."""
        return (strike / current_price) - 1 if current_price > 0 else 0

    @staticmethod
    async def get_stock_data_eastern(stock_service, symbol: str, resolution: str = 'minute', time_range: float = 7) -> \
            List[Dict]:
        stock_data = await stock_service.get_market_data(
            symbol=symbol,
            resolution=resolution,
            time_range=time_range
        )

        if not stock_data:
            await log_service.error(
                f"[UnifiedUtils] CRITICAL: stock_service returned no data for {symbol} over the last {time_range} days.")
            return []

        eastern = pytz.timezone('US/Eastern')
        converted_data = []

        for data_point in stock_data:
            utc_dt = datetime.datetime.fromisoformat(data_point['timestamp'].replace('Z', '+00:00'))
            eastern_dt = utc_dt.astimezone(eastern)

            converted_point = data_point.copy()
            converted_point['datetime_eastern'] = eastern_dt
            converted_point['stock_price'] = data_point.get('price', 0)
            converted_data.append(converted_point)

        converted_data.sort(key=lambda x: x['timestamp'])

        if converted_data:
            last_data_point_dt = converted_data[-1]['datetime_eastern']
            now_eastern = time_service.now(eastern)
            time_since_last_data = now_eastern - last_data_point_dt

            if time_since_last_data > datetime.timedelta(days=2.5):
                await log_service.error(
                    f"[UnifiedUtils] WARNING: The most recent stock data for {symbol} is from {last_data_point_dt.strftime('%Y-%m-%d %H:%M')}, which is over 2.5 days old. The dataset from Alpaca may be incomplete or stale.")

        return converted_data

    @staticmethod
    def calculate_coverage_metrics(contracts: List[UnifiedContract], fields_to_check: List[str]) -> Dict[str, Any]:
        if not contracts:
            return {f"{field}_coverage_percent": 0.0 for field in fields_to_check}

        total_contracts = len(contracts)
        coverage_counts = {field: 0 for field in fields_to_check}

        for contract in contracts:
            for field in fields_to_check:
                value = getattr(contract, field, 0)
                if value is not None and value != 0:
                    coverage_counts[field] += 1

        return {f"{field}_coverage_percent": round((count / total_contracts) * 100, 2)
                for field, count in coverage_counts.items()}

    @staticmethod
    def calculate_greeks(
            stock_price: float,
            strike_price: float,
            days_to_expiration: int,
            contract_type: str,
            options_price: float = 0,
            implied_volatility: float = 0
    ) -> dict:
        result = {
            "implied_volatility": 0,
            "delta": 0,
            "gamma": 0,
            "theta": 0,
            "vega": 0,
            "vanna": 0,
            "charm": 0
        }

        if days_to_expiration <= 0:
            return result

        time_to_expiration_yrs = days_to_expiration / 365.25
        flag = 'c' if contract_type == 'call' else 'p'

        try:
            if implied_volatility <= 0 and options_price > 0.01:
                implied_volatility = iv_solver(
                    options_price, stock_price, strike_price,
                    time_to_expiration_yrs, Constants.RISK_FREE_RATE, flag
                )

            if not (0.01 < implied_volatility < 3.0):
                return result

            if contract_type == 'call':
                bs_model = BlackScholesCall(
                    S=stock_price, K=strike_price, T=time_to_expiration_yrs,
                    r=Constants.RISK_FREE_RATE, sigma=implied_volatility
                )
            else:
                bs_model = BlackScholesPut(
                    S=stock_price, K=strike_price, T=time_to_expiration_yrs,
                    r=Constants.RISK_FREE_RATE, sigma=implied_volatility
                )

            result["implied_volatility"] = implied_volatility
            result["delta"] = bs_model.delta()
            result["gamma"] = bs_model.gamma()
            result["theta"] = bs_model.theta()
            result["vega"] = bs_model.vega()
            result["vanna"] = bs_model.vanna()
            result["charm"] = bs_model.charm()

        except (ValueError, ZeroDivisionError, ArithmeticError, Exception):
            pass

        return result

class DataAdapter(ABC):
    @abstractmethod
    async def transform_contracts_to_unified(self, raw_data: Any, **kwargs) -> List[
        UnifiedContract]:
        pass

    @abstractmethod
    def adapter_get_tier_metadata(self) -> Dict[str, Any]:
        pass


class Tier1Adapter(DataAdapter):
    def __init__(self, utils: UnifiedUtils):
        """Initialize Tier 1 adapter for current snapshot data."""
        self.utils = utils

    async def transform_contracts_to_unified(self, raw_data: List[Dict], **kwargs) -> List[UnifiedContract]:
        stock_data = kwargs.get("stock_data", [])
        contracts = []
        eastern = pytz.timezone('US/Eastern')
        current_timestamp = time_service.now(eastern)

        current_price = 0
        if stock_data and len(stock_data) > 0:
            current_price = stock_data[-1]['stock_price']

        for option in raw_data:
            details = option.get("details", {})
            day_data = option.get("day", {})
            greeks = option.get("greeks", {})
            last_quote = option.get("last_quote", {})

            contract_type = details.get("contract_type", "").lower()
            volume = day_data.get("volume", 0)
            open_interest = option.get("open_interest", 0)

            premium = option.get("premium", 0)
            options_price = 0
            bid = last_quote.get("bid", 0)
            ask = last_quote.get("ask", 0)
            if bid > 0 and ask > 0:
                options_price = (bid + ask) / 2

            if premium > 0 and options_price == 0 and volume > 0:
                options_price = premium / (volume * 100)
            elif options_price > 0 >= premium and volume > 0:
                premium = volume * options_price * 100

            theta = greeks.get("theta", 0)
            if options_price > 0 and abs(theta) > (options_price * 0.5):
                theta = 0

            if volume >= 0 or open_interest >= 0:
                contracts.append(UnifiedContract(
                    ticker=details.get("ticker", ""),
                    contract_type=contract_type,
                    strike_price=details.get("strike_price", 0),
                    expiration_date=details.get("expiration_date", ""),
                    timestamp=current_timestamp,
                    stock_price=current_price,
                    volume=volume,
                    open_interest=open_interest,
                    options_price=options_price,
                    premium=premium,
                    delta=greeks.get("delta", 0),
                    gamma=greeks.get("gamma", 0),
                    theta=theta,
                    vega=greeks.get("vega", 0),
                    implied_volatility=option.get("implied_volatility", 0),
                    data_source="live_snapshot",
                    tier=1
                ))

        return contracts

    def parse_tier1_snapshot_structure(self, opt, contract_type, details):
        """Parse Tier 1 snapshot data structure into standardized format."""
        day_data = opt.get("day", {})
        greeks = opt.get("greeks", {})
        last_quote = opt.get("last_quote", {})

        return {
            "details": {
                "contract_type": contract_type,
                "strike_price": details.get("strike_price", 0),
                "expiration_date": details.get("expiration_date", ""),
                "ticker": details.get("ticker", "")
            },
            "day": {
                "volume": day_data.get("volume", 0)
            },
            "open_interest": opt.get("open_interest", 0),
            "last_quote": {
                "bid": last_quote.get("bid", 0),
                "ask": last_quote.get("ask", 0)
            },
            "greeks": {
                "delta": greeks.get("delta", 0),
                "gamma": greeks.get("gamma", 0),
                "theta": greeks.get("theta", 0),
                "vega": greeks.get("vega", 0)
            },
            "implied_volatility": opt.get("implied_volatility", 0)
        }

    def transform_tier1_snapshot_to_contracts(self, all_results):
        """Transform Tier 1 snapshot API response to contract format."""
        snapshots = []

        for opt in all_results:
            if not isinstance(opt, dict):
                continue

            details = opt.get("details", {})
            raw_contract_type = details.get("contract_type", "")
            contract_type = self.utils.parse_polygon_contract_type(raw_contract_type)

            snapshot = self.parse_tier1_snapshot_structure(opt, contract_type, details)
            snapshots.append(snapshot)

        return snapshots

    def adapter_get_tier_metadata(self, premium_data_available: bool = False,
                                  coverage_results: Optional[Dict[str, float]] = None) -> Dict[str, Any]:

        capabilities = {
            "has_volume_data": True,
            "has_premium_data": premium_data_available,
            "has_oi_data": True,
            "has_delta_data": True,
            "has_gamma_data": True,
            "has_iv_data": True
        }

        primary_metrics = [key.replace('has_', '').replace('_data', '') for key, value in capabilities.items() if value]
        unavailable_metrics = [key.replace('has_', '').replace('_data', '') for key, value in capabilities.items() if
                               not value]

        if premium_data_available:
            analysis_note = f"Current snapshot analysis using a hybrid data source. Core data (OI, Volume, Greeks) from Polygon, enriched with real-time premium data from yfinance. Contracts filtered to DTE < {Constants.MAX_DTE} days."
        else:
            analysis_note = f"Current snapshot analysis using Polygon data. No real-time premium data available. Contracts filtered to DTE < {Constants.MAX_DTE} days."

        if unavailable_metrics:
            analysis_note += f" No {', '.join(unavailable_metrics)} analysis available."

        coverage_obj: Dict[str, Any] = {}
        if coverage_results:
            COVERAGE_THRESHOLD = 80.0
            warnings = []
            affected_metrics = []

            metric_impact_map = {
                'volume': ['volume_put_call_ratio', 'unusual_activity_detection'],
                'premium': ['premium_put_call_ratio', 'flow_classification', 'smart_money_analysis'],
                'open_interest': ['open_interest_ratios', 'max_pain_calculation', 'gamma_exposure_weighting'],
                'delta': ['delta_weighted_ratios', 'flow_classification_accuracy'],
                'gamma': ['gamma_exposure_analysis', 'key_levels_identification'],
                'implied_volatility': ['volatility_skew_analysis', 'term_structure_analysis']
            }

            for field, coverage_pct in coverage_results.items():
                metric_name = field.replace('_coverage_percent', '')
                if coverage_pct < COVERAGE_THRESHOLD:
                    warnings.append(f"{metric_name.title()} at {coverage_pct:.1f}%")
                    affected_metrics.extend(metric_impact_map.get(metric_name, []))

            note_parts = []
            for key, value in coverage_results.items():
                metric_name = key.replace('_coverage_percent', '').replace('_', ' ').title()
                note_parts.append(f"{metric_name} ({value:.2f}%)")

            coverage_note = f"Factual Data Coverage: {', '.join(note_parts)}."
            coverage_obj = {
                **coverage_results,
                "note": coverage_note
            }

            if warnings:
                coverage_obj["quality_alert"] = {
                    "status": "WARNING",
                    "threshold_percent": COVERAGE_THRESHOLD,
                    "issues": warnings,
                    "affected_analyses": list(set(affected_metrics)),
                    "reliability_impact": "HIGH" if len(warnings) > 2 else "MODERATE"
                }  # type: Dict[str, Any]
            else:
                coverage_obj["quality_alert"] = {"status": "OK"}

        return {
            "tier": 1,
            "data_source": "polygon_snapshot_enriched" if premium_data_available else "polygon_snapshot",
            "access_level": "tier1_developer",
            "capabilities": capabilities,
            "coverage": coverage_obj,
            "primary_metrics": primary_metrics,
            "analysis_note": analysis_note,
            "api_limitations": "Developer subscription - no quotes access means premium is unavailable from Polygon. yfinance used as a fallback for enrichment."
        }

class Tier2Adapter(DataAdapter):
    def __init__(self, utils: UnifiedUtils, polygon_client=None):
        """Initializes the Tier 2 adapter for historical data transformation."""
        self.utils = utils
        self.polygon_client = polygon_client

    async def transform_contracts_to_unified(self, raw_data: Dict, **kwargs) -> List[UnifiedContract]:
        bucketed_volume_data = raw_data
        contracts = []
        analysis_date_str = kwargs['analysis_date_str']
        analysis_date = datetime.datetime.strptime(analysis_date_str, "%Y-%m-%d").date()

        for bucket_name, bucket_data in bucketed_volume_data.items():
            bucket_price = bucket_data["stock_price"]
            if bucket_price <= 0:
                continue

            for ticker, volume_info in bucket_data["ticker_volume_data"].items():
                strike_price = self.utils.extract_strike_from_ticker(ticker)
                expiration_str = await self.utils.extract_expiration_from_ticker(ticker)
                options_price = volume_info["options_price"]
                contract_type = volume_info["type"]

                expiration_date = datetime.datetime.strptime(expiration_str, "%Y-%m-%d").date()
                days_to_expiration = (expiration_date - analysis_date).days

                greeks = self.utils.calculate_greeks(
                    stock_price=bucket_price,
                    strike_price=strike_price,
                    days_to_expiration=days_to_expiration,
                    contract_type=contract_type,
                    options_price=options_price
                )

                contracts.append(UnifiedContract(
                    ticker=ticker,
                    contract_type=contract_type,
                    strike_price=strike_price,
                    expiration_date=expiration_str,
                    timestamp=datetime.datetime.now(),
                    stock_price=bucket_price,
                    volume=volume_info["volume"],
                    options_price=options_price,
                    premium=volume_info["volume"] * options_price * 100,
                    implied_volatility=greeks["implied_volatility"],
                    delta=greeks["delta"],
                    gamma=greeks["gamma"],
                    theta=greeks["theta"],
                    vega=greeks["vega"],
                    vanna=greeks["vanna"],
                    charm=greeks["charm"],
                    data_source="historical_sample_enriched",
                    tier=2,
                    time_bucket=bucket_name
                ))
        return contracts

    def adapter_get_tier_metadata(self, coverage_results: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        capabilities = {
            "has_volume_data": True,
            "has_premium_data": True,
            "has_oi_data": False,
            "has_delta_data": True,
            "has_gamma_data": True,
            "has_iv_data": True
        }

        primary_metrics = [key.replace('has_', '').replace('_data', '') for key, value in capabilities.items() if value]
        unavailable_metrics = [key.replace('has_', '').replace('_data', '') for key, value in capabilities.items() if
                               not value]

        analysis_note = "Historical analysis using an activity-weighted 25% sample of the most relevant contracts, enriched with Black-Scholes calculations for Implied Volatility and Greeks. Intraday bucket data is precisely scaled against ground-truth daily totals to ensure maximum accuracy."
        if unavailable_metrics:
            analysis_note += f" No {', '.join(unavailable_metrics)} analysis available."

        coverage_obj = {}
        if coverage_results:
            note_parts = []
            for key, value in coverage_results.items():
                metric_name = key.replace('_coverage_percent', '').replace('_', ' ').title()
                note_parts.append(f"{metric_name} ({value:.2f}%)")

            coverage_note = f"Avg. Daily Factual Coverage: {', '.join(note_parts)}. Volume & Premium from aggregates; Greeks & IV calculated."
            coverage_obj = {
                **coverage_results,
                "note": coverage_note
            }

        return {
            "tier": 2,
            "data_source": "polygon_historical_enriched",
            "access_level": "tier2_historical",
            "capabilities": capabilities,
            "coverage": coverage_obj,
            "primary_metrics": primary_metrics,
            "analysis_note": analysis_note,
            "scaling_note": "Intraday bucket volumes and premiums have been scaled using independent factors for calls and puts to match the ground-truth daily totals.",
            "sampling_percentage": Constants.GRANULAR_SAMPLE_PERCENTAGE * 100
        }

    def get_tier2_bucket_for_time_from_config(self, hour, minute):
        """Maps a time to a configured time bucket name."""
        time_str = f"{hour:02d}:{minute:02d}"
        for bucket_config in Constants.TIME_BUCKETS:
            if bucket_config["start_time"] <= time_str < bucket_config["end_time"]:
                return bucket_config["name"]
        return None

    def get_tier2_stratified_sample(self, calls: List[Dict], puts: List[Dict],
                                    daily_summary_results: List[Dict],
                                    sample_percentage: float = Constants.GRANULAR_SAMPLE_PERCENTAGE,
                                    underlying_price: float = 0) -> Dict[str, List[str]]:

        all_contracts = calls + puts
        if not all_contracts or not underlying_price > 0 or not daily_summary_results:
            return {"call_tickers": [], "put_tickers": []}

        contract_hash_input = ""
        for ctr in sorted(all_contracts, key=lambda x: x.get('ticker', '')):
            contract_hash_input += f"{ctr.get('ticker', '')}{ctr.get('strike_price', 0)}{ctr.get('expiration_date', '')}"

        seed_hash = hashlib.md5(contract_hash_input.encode()).hexdigest()
        deterministic_seed = int(seed_hash[:8], 16)
        np.random.seed(deterministic_seed)
        random.seed(deterministic_seed)

        if sample_percentage >= 1.0:
            call_tickers = [c['ticker'] for c in calls if c.get('ticker')]
            put_tickers = [p['ticker'] for p in puts if p.get('ticker')]
            return {"call_tickers": call_tickers, "put_tickers": put_tickers}

        summary_map = {s['ticker']: s for s in daily_summary_results if s and 'ticker' in s}

        def _get_stratum(contract: Dict, current_price: float) -> str:
            strike = contract.get("strike_price", 0)
            moneyness = abs(strike / current_price - 1)

            if moneyness <= 0.02:
                moneyness_bucket = "atm"
            elif moneyness <= 0.10:
                moneyness_bucket = "ntm"
            else:
                moneyness_bucket = "ftm"

            today = datetime.datetime.now().date()
            try:
                expiration_date = datetime.datetime.strptime(contract.get("expiration_date", ""), "%Y-%m-%d").date()
                dte = (expiration_date - today).days
            except (ValueError, TypeError):
                return f"{moneyness_bucket}_unknown"

            if dte <= 7:
                time_bucket = "weekly"
            elif dte <= 45:
                time_bucket = "monthly"
            else:
                time_bucket = "quarterly"

            return f"{moneyness_bucket}_{time_bucket}"

        strata_map = defaultdict(list)
        for contract in all_contracts:
            stratum_key = _get_stratum(contract, underlying_price)
            activity_score = summary_map.get(contract.get("ticker"), {}).get("volume", 0)
            if activity_score > 0:
                contract['activity_score'] = activity_score
                strata_map[stratum_key].append(contract)

        total_sample_size = int(len(all_contracts) * sample_percentage)
        final_sample_contracts = []

        for stratum, contracts_in_stratum in strata_map.items():
            stratum_weight = len(contracts_in_stratum) / len(all_contracts)
            num_to_sample = max(1, round(total_sample_size * stratum_weight))
            actual_sample_size = min(num_to_sample, len(contracts_in_stratum))

            weights = np.array([c.get('activity_score', 0) for c in contracts_in_stratum], dtype=float)
            total_weight = np.sum(weights)

            if total_weight > 0:
                probabilities = weights / total_weight
                sampled_indices = np.random.choice(
                    len(contracts_in_stratum),
                    size=actual_sample_size,
                    replace=False,
                    p=probabilities
                )
                sampled_for_stratum = [contracts_in_stratum[i] for i in sampled_indices]
            else:
                sampled_for_stratum = random.sample(contracts_in_stratum, actual_sample_size)

            final_sample_contracts.extend(sampled_for_stratum)

        call_tickers = [c['ticker'] for c in final_sample_contracts if
                        c.get('contract_type') == 'call' and c.get('ticker')]
        put_tickers = [p['ticker'] for p in final_sample_contracts if
                       p.get('contract_type') == 'put' and p.get('ticker')]

        return {"call_tickers": call_tickers, "put_tickers": put_tickers}

    async def fetch_and_bucket_daily_volume_data(self, all_tickers, date, call_tickers, put_tickers,
                                                 stock_data_for_date, volume_results=None):
        try:
            if volume_results is None:
                volume_results = await self.polygon_client.fetch_tier2_bulk_volume_data(all_tickers, date)

            bucket_stock_prices = {}
            for data_point in stock_data_for_date:
                eastern_dt = data_point.get('datetime_eastern')
                if eastern_dt:
                    bucket_name = self.get_tier2_bucket_for_time_from_config(eastern_dt.hour, eastern_dt.minute)
                    if bucket_name and bucket_name not in bucket_stock_prices and data_point.get('stock_price', 0) > 0:
                        bucket_stock_prices[bucket_name] = data_point.get('stock_price', 0)

            if not bucket_stock_prices:
                await log_service.options(
                    f"[Tier2Adapter] WARNING: No valid stock prices found for any time bucket on date {date}. Buckets will be missing price data.")

            bucket_results = {
                bucket_config["name"]: {
                    "time_label": bucket_config["label"],
                    "ticker_volume_data": {},
                    "stock_price": bucket_stock_prices.get(bucket_config["name"], 0)
                } for bucket_config in Constants.TIME_BUCKETS
            }

            processing_tasks = []
            for result in volume_results:
                result_ticker = result.get("ticker", "")
                if not result_ticker: continue
                result_minute_data = result.get("results", [])
                processing_tasks.append((result_ticker, result_minute_data))

            def background_processing_loop():
                processed_data = []
                for proc_ticker, proc_minute_data in processing_tasks:
                    proc_bucket_data = self.process_tier2_minute_results_into_buckets(proc_ticker, proc_minute_data)
                    processed_data.append((proc_ticker, proc_bucket_data))
                return processed_data

            all_ticker_bucket_data = await asyncio.to_thread(background_processing_loop)

            for final_ticker, final_bucket_data in all_ticker_bucket_data:
                for final_bucket_name, final_bucket_info in final_bucket_data.get("buckets", {}).items():
                    if final_bucket_info.get("volume", 0) > 0:
                        if final_bucket_name in bucket_results:
                            if final_ticker in call_tickers:
                                contract_type = "call"
                            elif final_ticker in put_tickers:
                                contract_type = "put"
                            else:
                                continue

                            bucket_results[final_bucket_name]["ticker_volume_data"][final_ticker] = {
                                "volume": final_bucket_info["volume"],
                                "options_price": final_bucket_info["options_price"],
                                "type": contract_type
                            }
            return bucket_results
        except Exception as e:
            await log_service.options(f"[Tier2Adapter] ERROR in fetch_and_bucket_daily_volume_data: {str(e)}")
            return {}

    def process_tier2_minute_results_into_buckets(self, ticker, minute_results):
        """Aggregates raw minute-by-minute trade data into the service's time buckets."""
        eastern = pytz.timezone('US/Eastern')
        buckets = {b_config["name"]: {"volume": 0, "options_price": 0, "data_points": 0} for b_config in
                   Constants.TIME_BUCKETS}

        for result in minute_results:
            ts = result.get("t", 0)
            dt_eastern = datetime.datetime.fromtimestamp(ts / 1000, tz=pytz.UTC).astimezone(eastern)

            if not ((dt_eastern.hour == 9 and dt_eastern.minute >= 30) or (10 <= dt_eastern.hour < 16)):
                continue

            bucket_name = self.get_tier2_bucket_for_time_from_config(dt_eastern.hour, dt_eastern.minute)
            volume = result.get("v", 0)

            if bucket_name and volume > 0:
                buckets[bucket_name]["volume"] += volume
                buckets[bucket_name]["data_points"] += 1
                if result.get("c", 0) > 0:
                    buckets[bucket_name]["options_price"] = result["c"]

        return {"ticker": ticker, "buckets": buckets}


class UnifiedOptionsProcessor:
    def __init__(self, utils: UnifiedUtils):
        self.utils = utils

    async def process_unified_contracts_to_results(self, contracts: List[UnifiedContract], current_price: float,
                                                   stock_volume: float, historical_context: HistoricalContext,
                                                   tier_capabilities: Dict[str, bool],
                                                   stock_data_history: List[Dict] = None) -> ProcessedResults:

        def run_sync_processing():
            metrics_sync = self.calculate_current_metrics(contracts, stock_volume, current_price, tier_capabilities)
            processed_contracts_sync = self.calculate_contract_metrics(contracts, current_price, historical_context,
                                                                       tier_capabilities)
            gamma_exposure_data_sync = self.calculate_gamma_exposure(contracts, current_price, tier_capabilities) if \
                tier_capabilities[
                    "has_gamma_data"] else {
                "strikes": [], "summary": {}, "total_gamma": 0, "normalized_total_gamma": 0, "dealer_long_gamma": False,
                "expected_volatility": "unknown"}
            moneyness_distribution_sync = self.calculate_moneyness_distribution(contracts, current_price,
                                                                                historical_context,
                                                                                tier_capabilities)
            key_levels_sync = self.calculate_key_levels(gamma_exposure_data_sync["strikes"], current_price) if \
            tier_capabilities[
                "has_gamma_data"] else {}

            max_pain_sync = None
            if tier_capabilities["has_oi_data"]:
                expiries = defaultdict(lambda: {"contracts": [], "total_oi": 0})
                for contract in contracts:
                    expiries[contract.expiration_date]["contracts"].append(contract)
                    expiries[contract.expiration_date]["total_oi"] += contract.open_interest

                if expiries:
                    today = datetime.datetime.now(pytz.timezone('US/Eastern')).date()
                    all_future_expiries = {
                        datetime.datetime.strptime(d, "%Y-%m-%d").date(): d
                        for d in expiries.keys()
                        if datetime.datetime.strptime(d, "%Y-%m-%d").date() >= today
                    }

                    if all_future_expiries:
                        nearest_expiry_date_obj = min(all_future_expiries.keys())
                        monthly_expiries = {}
                        for date_obj, date_str in all_future_expiries.items():
                            if date_obj.weekday() == 4 and 15 <= date_obj.day <= 21:
                                monthly_expiries[date_obj] = date_str

                        target_expiry_str = None
                        if monthly_expiries:
                            nearest_monthly_date_obj = min(monthly_expiries.keys())
                            if (nearest_monthly_date_obj - today).days < 45:
                                target_expiry_str = monthly_expiries[nearest_monthly_date_obj]

                        if not target_expiry_str:
                            target_expiry_str = all_future_expiries[nearest_expiry_date_obj]

                        contracts_for_max_pain = expiries[target_expiry_str]["contracts"]
                        max_pain_sync = self.calculate_max_pain_for_expiry(contracts_for_max_pain, current_price)

            return metrics_sync, processed_contracts_sync, gamma_exposure_data_sync, moneyness_distribution_sync, key_levels_sync, max_pain_sync

        metrics, processed_contracts, gamma_exposure, moneyness_distribution, key_levels, max_pain = await asyncio.to_thread(
            run_sync_processing)

        unusual_contracts = await self.analyze_unusual_activity(processed_contracts, historical_context,
                                                                tier_capabilities) if \
            tier_capabilities["has_volume_data"] else {}

        smart_money_analysis = self.analyze_smart_money_signals(
            unusual_contracts.get("contracts", []),
            historical_context,
            {"capabilities": tier_capabilities}
        ) if unusual_contracts else None

        volatility_skew = self.calculate_volatility_skew(contracts, metrics) if tier_capabilities[
            "has_iv_data"] else None

        analysis_date = datetime.datetime.now(pytz.timezone('US/Eastern')).date()
        term_structure_analysis = self.analyze_term_structures(processed_contracts, analysis_date) if tier_capabilities[
            "has_iv_data"] else None

        realized_volatility = self.calculate_realized_volatility(stock_data_history) if stock_data_history else 0.0

        return ProcessedResults(
            metrics=metrics,
            processed_contracts=processed_contracts,
            unusual_contracts=unusual_contracts,
            gamma_exposure=gamma_exposure,
            key_levels=key_levels,
            smart_money_analysis=smart_money_analysis,
            moneyness_distribution=moneyness_distribution,
            max_pain=max_pain,
            volatility_skew=volatility_skew,
            term_structure_analysis=term_structure_analysis,
            realized_volatility=realized_volatility
        )

    def calculate_current_metrics(self, contracts: List[UnifiedContract], stock_volume: float,
                                  current_price: float, tier_capabilities: Dict[str, bool]) -> UnifiedMetrics:
        metrics = UnifiedMetrics(
            stock_volume=stock_volume,
            current_price=current_price,
            total_contracts=len(contracts),
            has_volume_data=tier_capabilities["has_volume_data"],
            has_premium_data=tier_capabilities["has_premium_data"],
            has_oi_data=tier_capabilities["has_oi_data"],
            has_delta_data=tier_capabilities["has_delta_data"],
            has_gamma_data=tier_capabilities["has_gamma_data"],
            has_iv_data=tier_capabilities["has_iv_data"]
        )

        weighting_metric = 'open_interest' if metrics.has_oi_data else 'volume'

        for contract in contracts:
            if contract.contract_type == "call":
                if metrics.has_volume_data:
                    metrics.call_volume += contract.volume
                if metrics.has_oi_data:
                    metrics.call_oi += contract.open_interest
                if metrics.has_premium_data:
                    metrics.call_premium += contract.premium
                if metrics.has_delta_data and contract.delta != 0:
                    weight = getattr(contract, weighting_metric, 0)
                    metrics.call_delta_sum += abs(contract.delta) * weight
            elif contract.contract_type == "put":
                if metrics.has_volume_data:
                    metrics.put_volume += contract.volume
                if metrics.has_oi_data:
                    metrics.put_oi += contract.open_interest
                if metrics.has_premium_data:
                    metrics.put_premium += contract.premium
                if metrics.has_delta_data and contract.delta != 0:
                    weight = getattr(contract, weighting_metric, 0)
                    metrics.put_delta_sum += abs(contract.delta) * weight

        if metrics.has_volume_data:
            metrics.volume_ratio = self.utils.calculate_safe_ratio(metrics.put_volume, metrics.call_volume)
        if metrics.has_oi_data:
            metrics.oi_ratio = self.utils.calculate_safe_ratio(metrics.put_oi, metrics.call_oi)
        if metrics.has_premium_data:
            metrics.premium_ratio = self.utils.calculate_safe_ratio(metrics.put_premium, metrics.call_premium)
        if metrics.has_delta_data:
            metrics.delta_weighted_ratio = self.utils.calculate_safe_ratio(metrics.put_delta_sum,
                                                                           metrics.call_delta_sum)

        return metrics

    def _get_moneyness_bucket(self, contract: UnifiedContract, current_price: float, atm_range: float) -> str:
        if abs(contract.strike_price - current_price) <= atm_range:
            return "atm"

        if contract.contract_type == "call":
            return "itm" if contract.strike_price < current_price else "otm"
        elif contract.contract_type == "put":
            return "itm" if contract.strike_price > current_price else "otm"

        return "unknown"

    def _calculate_flow_score(self, contract: UnifiedContract, historical_context: HistoricalContext,
                              tier_capabilities: Dict[str, bool]) -> float:
        if not tier_capabilities.get("has_premium_data") or not hasattr(historical_context,
                                                                        'all_premiums') or not historical_context.all_premiums:
            return 0.0

        premium_score = 0.0
        activity_score = 0.0

        if contract.premium > historical_context.premium_percentile_95:
            premium_score = 2.5
        elif contract.premium > historical_context.premium_percentile_85:
            premium_score = 1.5
        elif contract.premium < historical_context.premium_percentile_20:
            premium_score = -1.5
        elif contract.premium < historical_context.premium_percentile_10:
            premium_score = -2.5

        vol_oi_ratio = UnifiedUtils.calculate_safe_ratio(contract.volume, contract.open_interest)
        min_volume = historical_context.volume_percentile_10 if hasattr(historical_context,
                                                                        'volume_percentile_10') else 10

        if vol_oi_ratio > 10.0 and contract.volume > min_volume:
            activity_score = 1.5
        elif vol_oi_ratio > 3.0:
            activity_score = 0.75

        normalized_premium = premium_score / 2.5
        normalized_activity = (activity_score - 0.75) / 0.75 if activity_score > 0 else 0
        final_score = (normalized_premium * 0.65) + (normalized_activity * 0.35)

        return final_score

    def calculate_contract_metrics(self, contracts: List[UnifiedContract], current_price: float,
                                   historical_context: HistoricalContext, tier_capabilities: Dict[str, bool]) -> List[
        UnifiedContract]:
        atm_range = current_price * historical_context.baseline_calculate_atm_range()
        today = datetime.datetime.now(pytz.timezone('US/Eastern')).date()

        for contract in contracts:
            if contract.vanna == 0 or contract.charm == 0:
                try:
                    exp_date = datetime.datetime.strptime(contract.expiration_date, "%Y-%m-%d").date()
                    days_to_expiration = (exp_date - today).days

                    greeks = self.utils.calculate_greeks(
                        stock_price=current_price,
                        strike_price=contract.strike_price,
                        days_to_expiration=days_to_expiration,
                        contract_type=contract.contract_type,
                        implied_volatility=contract.implied_volatility
                    )

                    contract.vanna = greeks["vanna"]
                    contract.charm = greeks["charm"]
                except (ValueError, TypeError):
                    pass

        all_flow_scores = []
        for contract in contracts:
            activity_score = 0
            if tier_capabilities["has_premium_data"]:
                activity_score += contract.premium
            if tier_capabilities["has_volume_data"]:
                activity_score += (contract.volume * current_price)
            if tier_capabilities["has_oi_data"]:
                activity_score += (contract.open_interest * current_price * 0.1)

            contract.moneyness = self.utils.normalize_moneyness(contract.strike_price, current_price)
            contract.moneyness_bucket = self._get_moneyness_bucket(contract, current_price, atm_range)
            contract.activity_score = activity_score

            flow_score = self._calculate_flow_score(contract, historical_context, tier_capabilities)
            all_flow_scores.append(flow_score)

        if len(all_flow_scores) > 10:
            institutional_threshold = np.percentile(all_flow_scores, 85)
            retail_threshold = np.percentile(all_flow_scores, 15)
        else:
            institutional_threshold = 0.75
            retail_threshold = -0.75

        for i, contract in enumerate(contracts):
            score = all_flow_scores[i]
            if score >= institutional_threshold:
                contract.flow_classification = "Likely Institutional"
            elif score <= retail_threshold:
                contract.flow_classification = "Likely Retail"
            else:
                contract.flow_classification = "Ambiguous"

        return sorted(contracts, key=lambda c: c.activity_score, reverse=True)

    def calculate_moneyness_distribution(self, contracts: List[UnifiedContract], current_price: float,
                                         historical_context: HistoricalContext, tier_capabilities: Dict[str, bool]) -> \
            Dict[str, Any]:
        distribution = {
            "call_volume": {"itm": 0, "atm": 0, "otm": 0},
            "put_volume": {"itm": 0, "atm": 0, "otm": 0},
            "call_oi": {"itm": 0, "atm": 0, "otm": 0},
            "put_oi": {"itm": 0, "atm": 0, "otm": 0}
        }

        if tier_capabilities["has_premium_data"]:
            distribution["call_premium"] = {"itm": 0, "atm": 0, "otm": 0}
            distribution["put_premium"] = {"itm": 0, "atm": 0, "otm": 0}

        atm_range = current_price * historical_context.baseline_calculate_atm_range()

        for contract in contracts:
            bucket = self._get_moneyness_bucket(contract, current_price, atm_range)
            if bucket == "unknown":
                continue

            if contract.contract_type == "call":
                distribution["call_volume"][bucket] += contract.volume
                distribution["call_oi"][bucket] += contract.open_interest
                if tier_capabilities["has_premium_data"]:
                    distribution["call_premium"][bucket] += contract.premium
            elif contract.contract_type == "put":
                distribution["put_volume"][bucket] += contract.volume
                distribution["put_oi"][bucket] += contract.open_interest
                if tier_capabilities["has_premium_data"]:
                    distribution["put_premium"][bucket] += contract.premium

        ratios = {}
        if tier_capabilities["has_volume_data"]:
            ratios["atm_put_call_volume_ratio"] = self.utils.calculate_safe_ratio(
                distribution["put_volume"]["atm"], distribution["call_volume"]["atm"])
        if tier_capabilities["has_oi_data"]:
            ratios["atm_put_call_oi_ratio"] = self.utils.calculate_safe_ratio(
                distribution["put_oi"]["atm"], distribution["call_oi"]["atm"])
        if tier_capabilities["has_premium_data"]:
            ratios["atm_put_call_premium_ratio"] = self.utils.calculate_safe_ratio(
                distribution["put_premium"]["atm"], distribution["call_premium"]["atm"])

        distribution["ratios"] = ratios
        return distribution

    async def analyze_unusual_activity(self, contracts: List[UnifiedContract], historical_context: HistoricalContext,
                                       tier_capabilities: Dict[str, bool]) -> Dict[str, Any]:
        unusual_contracts = []
        expiration_groups = defaultdict(list)

        for contract in contracts:
            if contract.expiration_date:
                expiration_groups[contract.expiration_date].append(contract)

        for expiration, exp_contracts in expiration_groups.items():
            all_volumes = [c.volume for c in exp_contracts if c.volume > 0]
            if len(all_volumes) < 3:
                continue

            mean_volume = sum(all_volumes) / len(all_volumes)

            for contract in exp_contracts:
                if contract.volume == 0:
                    continue

                avg_premium_per_contract = contract.premium / contract.volume if contract.volume > 0 else 0

                if avg_premium_per_contract < historical_context.premium_threshold:
                    continue

                try:
                    unusual_data = self.analyze_single_contract_for_unusual_activity(
                        contract, mean_volume, historical_context,
                        tier_capabilities["has_premium_data"]
                    )
                    if unusual_data:
                        unusual_contracts.append(unusual_data)
                except Exception as e:
                    await log_service.options(
                        f"[UnifiedOptionsProcessor] ERROR in analyze_unusual_activity: {str(e)}\nTRACEBACK: {traceback.format_exc()}")
                    continue

        unusual_contracts.sort(key=lambda x: x["unusual_score"], reverse=True)

        total_found = len(unusual_contracts)
        institutional_count = sum(1 for c in unusual_contracts if c['flow_classification'] == 'Likely Institutional')
        retail_count = sum(1 for c in unusual_contracts if c['flow_classification'] == 'Likely Retail')
        ambiguous_count = total_found - institutional_count - retail_count

        return {
            "contracts": unusual_contracts[:Constants.MAX_OUTPUT_UNUSUAL_CONTRACTS],
            "total_found": total_found,
            "institutional_count": institutional_count,
            "retail_count": retail_count,
            "ambiguous_count": ambiguous_count
        }

    def analyze_single_contract_for_unusual_activity(self, contract: UnifiedContract, mean_volume: float,
                                                     historical_context: HistoricalContext,
                                                     has_premium_data: bool) -> Optional[Dict]:
        vol_oi_ratio = contract.volume / contract.open_interest if contract.open_interest > 0 else 0
        unusual_reasons = []

        moneyness = self.utils.normalize_moneyness(contract.strike_price, contract.stock_price)
        abs_moneyness = abs(moneyness)

        is_far_otm = (contract.contract_type == "call" and moneyness > 0.10) or \
                     (contract.contract_type == "put" and moneyness < -0.10)
        is_near_money = abs_moneyness <= 0.05
        is_moderate_otm = 0.05 < abs_moneyness <= 0.10

        volume_score = 0
        if contract.volume > historical_context.volume_percentile_90:
            volume_score += 4.0
            unusual_reasons.append(f"Volume >90th percentile ({contract.volume:,.0f})")
        elif contract.volume > historical_context.volume_percentile_85:
            volume_score += 3.0
            unusual_reasons.append(f"Volume >85th percentile ({contract.volume:,.0f})")
        elif contract.volume > historical_context.volume_percentile_80:
            volume_score += 2.0
            unusual_reasons.append(f"Volume >80th percentile ({contract.volume:,.0f})")

        if vol_oi_ratio > 0 and contract.open_interest > 0:
            if vol_oi_ratio > historical_context.vol_oi_percentile_90:
                volume_score += 2.5
                unusual_reasons.append(f"Vol/OI ratio >90th percentile ({vol_oi_ratio:.1f}x)")
            elif vol_oi_ratio > historical_context.vol_oi_percentile_85:
                volume_score += 2.0
                unusual_reasons.append(f"Vol/OI ratio >85th percentile ({vol_oi_ratio:.1f}x)")
            elif vol_oi_ratio > historical_context.vol_oi_percentile_80:
                volume_score += 1.0
                unusual_reasons.append(f"Vol/OI ratio >80th percentile ({vol_oi_ratio:.1f}x)")

        premium_score = 0
        if has_premium_data and contract.premium > 0:
            if contract.premium > historical_context.premium_percentile_98:
                premium_score = 8
                unusual_reasons.append(f"Exceptional Premium (${contract.premium / 1000:,.0f}K, >98th percentile)")
            elif contract.premium > historical_context.premium_percentile_95:
                premium_score = 5
                unusual_reasons.append(f"Very High Premium (${contract.premium / 1000:,.0f}K, >95th percentile)")
            elif contract.premium > historical_context.premium_percentile_90:
                premium_score = 3
                unusual_reasons.append(f"High Premium (${contract.premium / 1000:,.0f}K, >90th percentile)")

        if is_far_otm:
            if contract.contract_type == "call":
                weight_volume = 0.70
                weight_premium = 0.30
            else:
                weight_volume = 0.65
                weight_premium = 0.35
        elif is_moderate_otm:
            weight_volume = 0.50
            weight_premium = 0.50
        elif is_near_money:
            weight_volume = 0.35
            weight_premium = 0.65
        else:
            weight_volume = 0.30
            weight_premium = 0.70

        unusual_score = (volume_score * weight_volume) + (premium_score * weight_premium)

        if is_far_otm and contract.volume > mean_volume:
            unusual_score += 2.5
            unusual_reasons.append(f"Significant volume on far OTM contract (Moneyness: {moneyness:.1%})")
        elif is_near_money and vol_oi_ratio > 5.0 and contract.volume > historical_context.volume_percentile_80:
            unusual_score += 1.5
            unusual_reasons.append(f"High turnover near-money strike (Vol/OI: {vol_oi_ratio:.1f}x)")

        min_volume = historical_context.volume_percentile_10 if hasattr(historical_context,
                                                                        'volume_percentile_10') else 10

        adaptive_threshold = 3.5
        if is_far_otm:
            adaptive_threshold = 2.5
        elif is_near_money:
            adaptive_threshold = 4.0

        if unusual_score >= adaptive_threshold and contract.volume >= min_volume:
            return {
                "contract_type": contract.contract_type, "strike_price": contract.strike_price,
                "expiration": contract.expiration_date, "volume": contract.volume,
                "open_interest": contract.open_interest, "options_price": contract.options_price,
                "premium": contract.premium,
                "moneyness": moneyness,
                "unusual_score": round(unusual_score, 2),
                "vol_oi_ratio": round(vol_oi_ratio, 2), "unusual_reasons": unusual_reasons,
                "flow_classification": contract.flow_classification
            }
        return None

    def calculate_gamma_exposure(self, contracts: List[UnifiedContract], current_price: float,
                                 tier_capabilities: Dict[str, bool]) -> Dict[str, Any]:
        gamma_by_strike = {}
        weighting_metric = 'open_interest' if tier_capabilities.get("has_oi_data", False) else 'volume'

        for contract in contracts:
            weight = getattr(contract, weighting_metric, 0)
            if contract.gamma == 0 or weight == 0:
                continue

            gamma_exposure = contract.gamma * weight * 100
            if contract.contract_type == "put":
                gamma_exposure = -gamma_exposure

            strike_key = str(contract.strike_price)
            if strike_key not in gamma_by_strike:
                gamma_by_strike[strike_key] = {
                    "strike": contract.strike_price,
                    "call_gamma": 0,
                    "put_gamma": 0,
                    "net_gamma": 0
                }

            if contract.contract_type == "call":
                gamma_by_strike[strike_key]["call_gamma"] += gamma_exposure
            else:
                gamma_by_strike[strike_key]["put_gamma"] += gamma_exposure

        gamma_strikes = []
        positive_gamma_count = 0
        negative_gamma_count = 0

        for strike_data in gamma_by_strike.values():
            strike_data["net_gamma"] = strike_data["call_gamma"] + strike_data["put_gamma"]
            if strike_data["net_gamma"] > 0:
                positive_gamma_count += 1
            elif strike_data["net_gamma"] < 0:
                negative_gamma_count += 1
            gamma_strikes.append(strike_data)

        gamma_strikes.sort(key=lambda x: abs(x["net_gamma"]), reverse=True)
        total_gamma = sum(strike["net_gamma"] for strike in gamma_strikes)
        total_strikes_found = len(gamma_strikes)
        strikes_to_show = gamma_strikes[:Constants.MAX_OUTPUT_GAMMA_STRIKES]

        normalized_gamma = total_gamma / current_price if current_price > 0 else 0
        gamma_flip_point = self._find_gamma_flip_point(gamma_strikes, current_price)

        return {
            "strikes": strikes_to_show,
            "summary": {
                "total_strikes_found": total_strikes_found,
                "strikes_shown": len(strikes_to_show),
                "positive_net_gamma_strikes": positive_gamma_count,
                "negative_net_gamma_strikes": negative_gamma_count
            },
            "total_gamma": total_gamma,
            "normalized_total_gamma": normalized_gamma,
            "gamma_flip_point": gamma_flip_point,
            "dealer_long_gamma": bool(total_gamma > 0),
            "expected_volatility": "suppressed" if total_gamma > 0 else "amplified"
        }

    def _find_gamma_flip_point(self, gamma_strikes: List[Dict], current_price: float) -> Optional[float]:
        if not gamma_strikes or len(gamma_strikes) < 2:
            return None

        relevant_strikes = [s for s in gamma_strikes if 0.8 * current_price <= s['strike'] <= 1.2 * current_price]

        if not relevant_strikes or len(relevant_strikes) < 2:
            return None

        sorted_strikes = sorted(relevant_strikes, key=lambda x: x['strike'])

        prev_sign = None
        for strike_data in sorted_strikes:
            current_sign = 1 if strike_data['net_gamma'] > 0 else -1 if strike_data['net_gamma'] < 0 else 0

            if current_sign == 0:
                continue

            if prev_sign is not None and prev_sign != current_sign:
                prev_idx = sorted_strikes.index(strike_data) - 1
                if prev_idx >= 0:
                    prev_strike = sorted_strikes[prev_idx]
                    curr_strike = strike_data

                    prev_gamma_abs = abs(prev_strike['net_gamma'])
                    curr_gamma_abs = abs(curr_strike['net_gamma'])
                    total_weight = prev_gamma_abs + curr_gamma_abs

                    if total_weight > 0:
                        weighted_strike = (prev_strike['strike'] * curr_gamma_abs + curr_strike[
                            'strike'] * prev_gamma_abs) / total_weight
                        return round(weighted_strike, 2)
                    else:
                        return (prev_strike['strike'] + curr_strike['strike']) / 2

            prev_sign = current_sign

        return None

    def calculate_key_levels(self, gamma_strikes: List[Dict], current_price: float) -> Dict[str, Any]:
        key_levels = []

        if not gamma_strikes:
            return {}

        all_gamma_values = [abs(strike["net_gamma"]) for strike in gamma_strikes]
        all_gamma_values.sort()

        if len(all_gamma_values) < Constants.MIN_DATA_POINTS_FOR_STATS:
            return {}

        weak_threshold = all_gamma_values[int(len(all_gamma_values) * 0.5)]
        moderate_threshold = all_gamma_values[int(len(all_gamma_values) * 0.7)]
        strong_threshold = all_gamma_values[int(len(all_gamma_values) * 0.9)]

        summary_stats = {
            "resistance_levels": 0,
            "support_levels": 0,
            "strength_breakdown": defaultdict(int)
        }

        for strike_data in gamma_strikes:
            strike = strike_data["strike"]
            net_gamma = strike_data["net_gamma"]

            if current_price * 0.8 > strike or strike > current_price * 1.2:  # CHANGED FROM 0.6 and 1.4
                continue

            abs_gamma = abs(net_gamma)

            if abs_gamma >= strong_threshold:
                strength = "strong"
            elif abs_gamma >= moderate_threshold:
                strength = "moderate"
            elif abs_gamma >= weak_threshold:
                strength = "weak"
            else:
                continue

            if net_gamma > 0:
                level_type = "support"
                market_impact_note = "Positive gamma wall - dealers are long gamma and will dampen price movements away from this level by providing liquidity."
            else:
                level_type = "resistance"
                market_impact_note = "Negative gamma - dealers are short gamma and may amplify price movements through this level due to hedging flow."

            summary_stats[f"{level_type}_levels"] += 1
            summary_stats["strength_breakdown"][strength] += 1

            key_levels.append({
                "price": strike,
                "type": level_type,
                "strength": strength,
                "gamma": net_gamma,
                "market_impact_note": market_impact_note
            })

        key_levels.sort(key=lambda x: abs(x["gamma"]), reverse=True)
        total_found = len(key_levels)
        levels_to_show = key_levels[:Constants.MAX_KEY_LEVELS_OUTPUT]

        return {
            "summary": {
                "total_levels_found": total_found,
                "levels_shown": len(levels_to_show),
                "resistance_levels": summary_stats["resistance_levels"],
                "support_levels": summary_stats["support_levels"],
                "strength_breakdown": dict(summary_stats["strength_breakdown"])
            },
            "levels": levels_to_show
        }

    def calculate_max_pain_for_expiry(self, contracts_for_expiry: List[UnifiedContract], current_price: float) -> \
    Optional[Dict[str, Any]]:
        call_oi = {}
        put_oi = {}

        for contract in contracts_for_expiry:
            if contract.strike_price > 0 and contract.open_interest > 0:
                if contract.contract_type == "call":
                    call_oi[contract.strike_price] = contract.open_interest
                elif contract.contract_type == "put":
                    put_oi[contract.strike_price] = contract.open_interest

        all_strikes = sorted(set(list(call_oi.keys()) + list(put_oi.keys())))
        relevant_strikes = [s for s in all_strikes if
                            current_price * 0.8 <= s <= current_price * 1.2]

        if not relevant_strikes:
            return None

        min_pain = float('inf')
        max_pain_strike = current_price

        for test_price in relevant_strikes:
            total_pain = 0.0

            for strike, oi in call_oi.items():
                call_value = max(0.0, test_price - strike)
                total_pain += oi * call_value

            for strike, oi in put_oi.items():
                put_value = max(0.0, strike - test_price)
                total_pain += oi * put_value

            if total_pain < min_pain:
                min_pain = total_pain
                max_pain_strike = test_price

        return {
            "price": max_pain_strike,
            "distance_from_current": ((max_pain_strike / current_price) - 1) * 100 if current_price > 0 else 0,
            "pain_value": min_pain
        }

    def calculate_volatility_skew(self, contracts: List[UnifiedContract], metrics: UnifiedMetrics):
        expirations = defaultdict(lambda: {"calls": [], "puts": []})
        for contract in contracts:
            if contract.implied_volatility is not None and contract.implied_volatility > 0:
                if contract.delta is not None and 0.01 < contract.delta < 0.99 and contract.contract_type == "call":
                    expirations[contract.expiration_date]["calls"].append(
                        {"delta": contract.delta, "iv": contract.implied_volatility})
                elif contract.delta is not None and -0.99 < contract.delta < -0.01 and contract.contract_type == "put":
                    expirations[contract.expiration_date]["puts"].append(
                        {"delta": contract.delta, "iv": contract.implied_volatility})

        volatility_data = {}
        for expiry, data in expirations.items():
            if not data["calls"] or not data["puts"]: continue

            try:
                closest_call = min(data["calls"], key=lambda x: abs(x["delta"] - 0.25))
                closest_put = min(data["puts"], key=lambda x: abs(x["delta"] - (-0.25)))

                put_iv = closest_put['iv']
                call_iv = closest_call['iv']

                if put_iv > 0 and call_iv > 0:
                    skew = (put_iv - call_iv) * 100

                    is_premium_bullish = metrics.has_premium_data and metrics.premium_ratio < 0.9
                    is_premium_bearish = metrics.has_premium_data and metrics.premium_ratio > 1.1

                    if skew < 0:
                        if is_premium_bearish:
                            interpretation = "Conflict: Bullish Skew vs. Bearish Premium"
                        else:
                            interpretation = "Bullish Alignment"
                    else:
                        if is_premium_bullish:
                            interpretation = "Conflict: Bearish Skew vs. Bullish Premium"
                        else:
                            interpretation = "Bearish Alignment"

                    volatility_data[expiry] = {
                        "25_delta_skew": round(skew, 2),
                        "put_25d_iv": round(put_iv, 4),
                        "call_25d_iv": round(call_iv, 4),
                        "interpretation": interpretation
                    }
            except (ValueError, IndexError):
                continue

        return {"expirations": volatility_data} if volatility_data else None

    def calculate_realized_volatility(self, stock_data: List[Dict]) -> float:
        if not stock_data:
            return 0.0

        prices = [d.get('stock_price', 0) for d in stock_data if d.get('stock_price', 0) > 0]

        if len(prices) < 2:
            return 0.0

        log_returns = np.log(np.array(prices[1:]) / np.array(prices[:-1]))

        if len(log_returns) < 2:
            return 0.0

        minute_std_dev = np.std(log_returns)
        annualized_vol = minute_std_dev * math.sqrt(Constants.TRADING_MINUTES_PER_DAY * Constants.ANNUAL_TRADING_DAYS)

        return annualized_vol * 100

    def analyze_term_structures(self, contracts: List[UnifiedContract], analysis_date: datetime.date) -> Dict[str, Any]:
        if not contracts:
            return {}

        contracts_by_expiry = defaultdict(list)
        for contract in contracts:
            try:
                exp_date = datetime.datetime.strptime(contract.expiration_date, "%Y-%m-%d").date()
                contracts_by_expiry[exp_date].append(contract)
            except ValueError:
                continue

        vol_data_points = []
        for expiry, expiry_contracts in contracts_by_expiry.items():
            dte = (expiry - analysis_date).days
            atm_contracts = [c for c in expiry_contracts if c.implied_volatility is not None and abs(
                c.moneyness) < 0.05 and c.implied_volatility > 0.01]
            if atm_contracts:
                avg_iv = sum(c.implied_volatility for c in atm_contracts) / len(atm_contracts)
                vol_data_points.append({"dte": dte, "iv": round(avg_iv, 4)})

        vol_data_points.sort(key=lambda x: x['dte'])
        volatility_analysis = {}
        if len(vol_data_points) > 1:
            slope = (vol_data_points[-1]['iv'] - vol_data_points[0]['iv']) / (
                    vol_data_points[-1]['dte'] - vol_data_points[0]['dte'])
            status = "Backwardation" if slope < 0 else "Contango"
            interpretation = (
                "Near-term options are more expensive than long-term, signaling fear or anticipation of a major event."
                if status == "Backwardation"
                else "Normal market conditions where long-term risk is priced higher than short-term risk."
            )
            volatility_analysis = {
                "status": status,
                "interpretation": interpretation,
                "data_points": vol_data_points[:10]
            }

        sentiment_buckets = {
            "weekly": {"dte_range": "0-10", "calls": 0, "puts": 0},
            "monthly": {"dte_range": "11-45", "calls": 0, "puts": 0},
            "quarterly": {"dte_range": "46-180", "calls": 0, "puts": 0},
        }
        for expiry, expiry_contracts in contracts_by_expiry.items():
            dte = (expiry - analysis_date).days
            bucket = None
            if 0 <= dte <= 10:
                bucket = "weekly"
            elif 11 <= dte <= 45:
                bucket = "monthly"
            elif 46 <= dte <= 180:
                bucket = "quarterly"

            if bucket:
                for contract in expiry_contracts:
                    if contract.contract_type == 'call':
                        sentiment_buckets[bucket]['calls'] += contract.premium
                    elif contract.contract_type == 'put':
                        sentiment_buckets[bucket]['puts'] += contract.premium

        sentiment_term_structure = {}
        for name, data in sentiment_buckets.items():
            ratio = self.utils.calculate_safe_ratio(data['puts'], data['calls'])
            interpretation = "Neutral"
            if ratio < 0.7: interpretation = "Bullish sentiment."
            if ratio < 0.5: interpretation = "Strongly bullish sentiment."
            if ratio > 1.3: interpretation = "Bearish sentiment."
            if ratio > 1.7: interpretation = "Strongly bearish sentiment."

            sentiment_term_structure[name] = {
                "dte_range": data['dte_range'],
                "premium_put_call_ratio": round(ratio, 2),
                "interpretation": interpretation
            }

        theta_landscape = {}
        relevant_expiries = {}
        for expiry, expiry_contracts in contracts_by_expiry.items():
            dte = (expiry - analysis_date).days
            if 1 < dte < 45:
                total_oi = sum(c.open_interest for c in expiry_contracts)
                if total_oi > 0:
                    relevant_expiries[expiry] = total_oi

        if relevant_expiries:
            most_active_expiry = max(relevant_expiries, key=relevant_expiries.get)
            theta_by_strike = defaultdict(lambda: {"call_theta": 0.0, "put_theta": 0.0})
            total_theta_burn = 0

            for contract in contracts_by_expiry[most_active_expiry]:
                if contract.theta is not None and contract.theta != 0 and contract.open_interest > 0:
                    total_theta_burn += (contract.theta * contract.open_interest)
                    if contract.contract_type == 'call':
                        theta_by_strike[contract.strike_price]['call_theta'] += contract.theta
                    elif contract.contract_type == 'put':
                        theta_by_strike[contract.strike_price]['put_theta'] += contract.theta

            if theta_by_strike:
                top_strikes = []
                for strike, thetas in theta_by_strike.items():
                    total_theta = thetas['call_theta'] + thetas['put_theta']
                    top_strikes.append({
                        "strike": strike,
                        "total_theta": round(total_theta, 2),
                        "call_theta": round(thetas['call_theta'], 2),
                        "put_theta": round(thetas['put_theta'], 2)
                    })

                top_strikes.sort(key=lambda x: x['total_theta'])
                strikes_to_show = top_strikes[:Constants.MAX_KEY_LEVELS_OUTPUT]
                theta_landscape = {
                    "summary": {
                        "total_strikes_analyzed": len(theta_by_strike),
                        "strikes_shown": len(strikes_to_show)
                    },
                    "analysis_expiration_date": most_active_expiry.strftime("%Y-%m-%d"),
                    "total_daily_theta_burn": total_theta_burn,
                    "interpretation": "These strikes have the highest time decay pressure, potentially acting as price magnets. The Total Daily Theta Burn shows the dollar amount option holders lose to time decay each day for this expiration.",
                    "top_strikes": strikes_to_show
                }

        return {
            "volatility_term_structure": volatility_analysis,
            "sentiment_term_structure": sentiment_term_structure,
            "theta_landscape": theta_landscape
        }

    def analyze_smart_money_signals(self, unusual_contracts: List[Dict], historical_context: HistoricalContext,
                                    tier_metadata: dict) -> Optional[dict]:
        tier_capabilities = tier_metadata.get("capabilities", {})

        if not unusual_contracts:
            return {
                "summary": {"total_signals": 0, "flow_bias": "neutral"},
                "signals": {},
                "analysis_note": "No unusual contracts found to analyze for smart money signals."
            }

        def score_from_percentile(value, historical_percentiles):
            if value >= historical_percentiles.get('p98', float('inf')):
                return 10.0
            elif value >= historical_percentiles.get('p95', float('inf')):
                return 8.0
            elif value >= historical_percentiles.get('p90', float('inf')):
                return 6.0
            elif value >= historical_percentiles.get('p85', float('inf')):
                return 4.0
            elif value >= historical_percentiles.get('p80', float('inf')):
                return 2.0
            return 0.0

        conviction_percentiles = {
            'p98': historical_context.premium_percentile_98,
            'p95': historical_context.premium_percentile_95,
            'p90': historical_context.premium_percentile_90,
            'p85': historical_context.premium_percentile_85,
            'p80': historical_context.premium_percentile_80
        }

        scored_signals = []

        for contract in unusual_contracts:
            premium = contract.get("premium", 0)
            contract_type = contract.get("contract_type", "")
            vol_oi_ratio = contract.get("vol_oi_ratio", 0)
            unusual_score = contract.get("unusual_score", 0)
            moneyness = contract.get("moneyness", 0)
            volume = contract.get("volume", 0)

            conviction_score = 0.0
            if tier_capabilities.get("has_premium_data") and premium > 0:
                conviction_score = score_from_percentile(premium, conviction_percentiles)

            speculation_score = 0.0
            if contract_type == "call" and moneyness > 0.03:
                moneyness_score = min(abs(moneyness) / 0.15, 1.0) * 6

                if abs(moneyness) > 0.10:
                    vol_oi_boost = min(vol_oi_ratio / 2.0, 1.0) * 4
                else:
                    vol_oi_percentiles = {
                        'p98': historical_context.vol_oi_percentile_95,
                        'p95': historical_context.vol_oi_percentile_90,
                        'p90': historical_context.vol_oi_percentile_85,
                        'p85': historical_context.vol_oi_percentile_80,
                        'p80': historical_context.vol_oi_percentile_80
                    }
                    vol_oi_boost = score_from_percentile(vol_oi_ratio, vol_oi_percentiles) * 0.5

                speculation_score = moneyness_score + vol_oi_boost

            hedge_score = 0.0
            if contract_type == "put" and moneyness < -0.03:
                moneyness_score = min(abs(moneyness) / 0.20, 1.0) * 5
                premium_score = score_from_percentile(premium, conviction_percentiles) * 0.5
                hedge_score = moneyness_score + premium_score

            aggressive_score = 0.0
            if abs(moneyness) <= 0.05:
                if unusual_score > 6.0:
                    aggressive_score = 10.0
                elif unusual_score > 5.0:
                    aggressive_score = 8.0
                elif unusual_score > 4.0:
                    aggressive_score = 6.0
                elif unusual_score > 3.5:
                    aggressive_score = 4.0

            scores = {
                "high_conviction": conviction_score,
                "leveraged_speculation": speculation_score,
                "hedge_protection": hedge_score,
                "aggressive_positioning": aggressive_score
            }

            primary_category = max(scores.items(), key=lambda x: x[1])
            sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
            secondary_category = sorted_scores[1] if len(sorted_scores) > 1 and sorted_scores[1][1] >= 5 else None

            reasons = []
            if conviction_score >= 6:
                percentile = "98th" if premium > historical_context.premium_percentile_98 else \
                    "95th" if premium > historical_context.premium_percentile_95 else "90th"
                reasons.append(f"Exceptional premium (${premium / 1000:,.0f}K, >{percentile} percentile)")

            if speculation_score >= 5:
                reasons.append(f"{abs(moneyness) * 100:.1f}% OTM {contract_type} with {vol_oi_ratio:.1f}x Vol/OI ratio")

            if hedge_score >= 5:
                reasons.append(f"Protective positioning at {abs(moneyness) * 100:.1f}% OTM")

            if aggressive_score >= 6:
                reasons.append(f"Near-money aggressive trade (score: {unusual_score:.1f})")

            signal_data = {
                "strike": contract.get("strike_price"),
                "type": contract_type,
                "volume": volume,
                "unusual_score": unusual_score,
                "vol_oi_ratio": round(vol_oi_ratio, 2),
                "premium": premium,
                "moneyness": round(moneyness, 4),
                "primary_classification": primary_category[0],
                "primary_score": round(primary_category[1], 1),
                "conviction_score": round(conviction_score, 1),
                "speculation_score": round(speculation_score, 1),
                "hedge_score": round(hedge_score, 1),
                "aggressive_score": round(aggressive_score, 1),
                "reason": " | ".join(
                    reasons) if reasons else f"Unusual activity: {contract_type} at {moneyness * 100:.1f}% moneyness"
            }

            if secondary_category:
                signal_data["secondary_classification"] = secondary_category[0]
                signal_data["secondary_score"] = round(secondary_category[1], 1)

            scored_signals.append(signal_data)

        categorized_signals = {
            "high_conviction": [],
            "leveraged_speculation": [],
            "hedge_protection": [],
            "aggressive_positioning": []
        }

        for signal in scored_signals:
            primary = signal["primary_classification"]
            if primary in categorized_signals:
                categorized_signals[primary].append(signal)

        signals_to_show = {}
        for category, signals in categorized_signals.items():
            if signals:
                sorted_signals = sorted(signals, key=lambda x: x["primary_score"], reverse=True)
                signals_to_show[category] = sorted_signals[:Constants.MAX_SMART_MONEY_SIGNALS_PER_CATEGORY]

        total_speculation = sum(s["speculation_score"] for s in scored_signals)
        total_hedge = sum(s["hedge_score"] for s in scored_signals)

        if total_hedge > total_speculation * 1.3:
            flow_bias = "defensive"
        elif total_speculation > total_hedge * 1.3:
            flow_bias = "aggressive"
        else:
            flow_bias = "neutral"

        return {
            "summary": {
                "total_signals_found": len(scored_signals),
                "signals_shown": sum(len(s) for s in signals_to_show.values()),
                "flow_bias": flow_bias,
                "dominant_strategy": max(signals_to_show.keys(),
                                         key=lambda k: sum(s["primary_score"] for s in
                                                           signals_to_show[k])) if signals_to_show else "none",
                "aggregate_scores": {
                    "total_conviction": round(sum(s["conviction_score"] for s in scored_signals), 1),
                    "total_speculation": round(total_speculation, 1),
                    "total_hedge": round(total_hedge, 1),
                    "total_aggressive": round(sum(s["aggressive_score"] for s in scored_signals), 1)
                }
            },
            "signals": signals_to_show,
            "analysis_note": "Multi-dimensional scoring: signals rated on conviction, speculation, hedging, and aggressiveness. Primary classification based on dominant characteristic."
        }

    def _get_last_trading_day(self, current_dt_eastern: datetime.datetime) -> datetime.date:
        if current_dt_eastern.weekday() < 5 and current_dt_eastern.hour >= 16:
            return current_dt_eastern.date()

        days_to_subtract = 1
        if current_dt_eastern.weekday() == 6:
            days_to_subtract = 2
        elif current_dt_eastern.weekday() == 0:
            days_to_subtract = 3

        return (current_dt_eastern - timedelta(days=days_to_subtract)).date()

    async def export_processed_results_to_json(self, results: ProcessedResults, tier_metadata: Dict[str, Any],
                                               historical_context: HistoricalContext, market_status: Optional[Dict]) -> \
    Dict[str, Any]:
        sentiment_fields = await self.calculate_sentiment_scores(results.metrics, results.processed_contracts,
                                                                 historical_context)
        active_contracts = self.group_contracts_by_expiration_for_export(
            results.processed_contracts,
            results.metrics.has_premium_data
        )

        status_note = ""
        if market_status:
            eastern_now = datetime.datetime.now(pytz.timezone('US/Eastern'))
            last_trading_day = self._get_last_trading_day(eastern_now)
            last_trading_day_str = last_trading_day.strftime('%A, %B %d, %Y')
            current_time_str = eastern_now.strftime('%I:%M %p ET on %A')
            market_state = market_status.get("market", "unknown")

            if market_state == "early_trading":
                status_note = (f"It is currently pre-market ({current_time_str}). "
                               f"This data reflects the market's final state from the previous trading day, {last_trading_day_str}. "
                               "Options do not trade during pre-market hours.")
            elif market_state == "extended-hours":
                status_note = (f"It is currently after-hours ({current_time_str}). "
                               f"This data reflects the market's final state for {last_trading_day_str}. "
                               "Options have very limited to no liquidity in after-hours trading.")
            elif market_state == "closed":
                status_note = (f"The market is currently closed ({current_time_str}). "
                               f"This data reflects the market's final state from the last trading day, {last_trading_day_str}.")
            else:
                status_note = (f"The market is open. This is a live, intraday snapshot taken at {current_time_str}, "
                               "and metrics will change as the trading session progresses.")

        if "analysis_note" in tier_metadata and status_note:
            tier_metadata["analysis_note"] = f"{tier_metadata['analysis_note']} {status_note}"
        elif status_note:
            tier_metadata["analysis_note"] = status_note

        flow_methodology = {
            "flow_classification": {
                "description": "A weighted confidence score based on premium size relative to historical norms and new activity (Vol/OI ratio).",
                "weights": {
                    "premium_score": 0.65,
                    "activity_score": 0.35
                },
                "thresholds": {
                    "institutional": 1.25,
                    "retail": -1.25
                },
                "note": "The score for each factor is derived dynamically from historical percentile data."
            }
        }

        result = {
            "current_price": results.metrics.current_price,
            "methodology": flow_methodology,
            "realized_volatility": results.realized_volatility,
            "put_call_ratios": self.format_put_call_ratios_for_export(results.metrics),
            "data_source": {
                "primary_source": "premium" if results.metrics.has_premium_data else "volume",
                **tier_metadata
            }
        }

        if results.term_structure_analysis:
            result["term_structure_analysis"] = results.term_structure_analysis

        result["distribution"] = {
            "total_contracts": results.metrics.total_contracts,
            "moneyness_distribution": results.moneyness_distribution,
            "key_levels": {
                "summary": results.key_levels.get("summary", {}),
                "levels": results.key_levels.get("levels", [])
            },
            "max_pain": results.max_pain,
            "volatility_skew": results.volatility_skew
        }
        result["active_contracts"] = active_contracts
        result.update(sentiment_fields)

        if results.unusual_contracts and results.unusual_contracts.get("contracts"):
            result["unusual_activity"] = self.format_unusual_activity_for_export(results.unusual_contracts)

        if results.smart_money_analysis:
            result["smart_money_analysis"] = results.smart_money_analysis

        if results.gamma_exposure and results.gamma_exposure.get("strikes"):
            gamma_data = results.gamma_exposure
            result["gamma_exposure"] = {
                "summary": gamma_data.get("summary", {}),
                "gamma_metrics": {
                    "net_gamma_exposure": gamma_data.get("total_gamma", 0),
                    "normalized_gamma_exposure": gamma_data.get("normalized_total_gamma", 0),
                    "gamma_flip_point": gamma_data.get("gamma_flip_point"),
                    "dealer_positioning": {
                        "long_gamma": gamma_data.get("dealer_long_gamma", False),
                        "expected_volatility": gamma_data.get("expected_volatility", "unknown")
                    },
                    "gamma_by_strike": gamma_data.get("strikes", [])
                }
            }
        return result

    async def calculate_sentiment_scores(self, metrics: UnifiedMetrics, contracts: List[UnifiedContract],
                                         historical_context: HistoricalContext,
                                         bucket_name: Optional[str] = None) -> Dict[str, Any]:
        sentiment_fields = {}

        if hasattr(historical_context, 'volume_deviations_by_bucket') and bucket_name:
            volume_deviations = historical_context.volume_deviations_by_bucket.get(bucket_name, [])
            premium_deviations = historical_context.premium_deviations_by_bucket.get(bucket_name, [])
        else:
            volume_deviations = []
            premium_deviations = []
            for day in historical_context.daily_data:
                time_buckets = day.get('time_buckets', {})
                for historical_bucket_name, bucket_data in time_buckets.items():
                    ratios = bucket_data.get("put_call_ratios", {})
                    vol_ratio = UnifiedUtils.calculate_safe_ratio(ratios.get('put_volume', 0),
                                                                  ratios.get('call_volume', 0))
                    if vol_ratio > 0 and vol_ratio != 99.99 and vol_ratio != 1.0:
                        vol_baseline = await historical_context.baseline_get_bucket_prediction_weighted_ratio(
                            historical_bucket_name, 'volume')
                        vol_deviation = (vol_ratio / vol_baseline) - 1.0
                        volume_deviations.append(vol_deviation)
                    prem_ratio = UnifiedUtils.calculate_safe_ratio(ratios.get('put_premium', 0),
                                                                   ratios.get('call_premium', 0))
                    if prem_ratio > 0 and prem_ratio != 99.99 and prem_ratio != 1.0:
                        prem_baseline = await historical_context.baseline_get_bucket_prediction_weighted_ratio(
                            historical_bucket_name, 'premium')
                        prem_deviation = (prem_ratio / prem_baseline) - 1.0
                        premium_deviations.append(prem_deviation)

        async def get_anomaly_sentiment(ratio_type: str, current_ratio: float,
                                        bucket_name_for_baseline: Optional[str] = None):
            historical_deviations = volume_deviations if ratio_type == 'volume' else premium_deviations
            if bucket_name_for_baseline:
                baseline = await historical_context.baseline_get_bucket_prediction_weighted_ratio(
                    bucket_name_for_baseline, ratio_type)
            else:
                baseline = await historical_context.baseline_get_current_bucket_baseline(ratio_type)
            current_deviation = (current_ratio / baseline) - 1.0
            if len(historical_deviations) > 10:
                percentile = stats.percentileofscore(historical_deviations, current_deviation)
                return -((percentile / 50.0) - 1.0)
            return -current_deviation

        if metrics.has_volume_data and metrics.volume_ratio > 0:
            score = await get_anomaly_sentiment('volume', metrics.volume_ratio, bucket_name)
            sentiment_fields["volume_sentiment_score"] = score
            sentiment_fields["volume_sentiment_category"] = self.categorize_sentiment_score(score)

        if metrics.has_premium_data and metrics.premium_ratio > 0:
            score = await get_anomaly_sentiment('premium', metrics.premium_ratio, bucket_name)
            sentiment_fields["premium_sentiment_score"] = score
            sentiment_fields["premium_sentiment_category"] = self.categorize_sentiment_score(score)

        if metrics.has_oi_data and metrics.oi_ratio > 0:
            score = -(metrics.oi_ratio - 1.0)
            sentiment_fields["oi_sentiment_score"] = score
            sentiment_fields["oi_sentiment_category"] = self.categorize_sentiment_score(score)

        if metrics.has_delta_data and metrics.delta_weighted_ratio > 0:
            score = -(metrics.delta_weighted_ratio - 1.0)
            sentiment_fields["delta_sentiment_score"] = score
            sentiment_fields["delta_sentiment_category"] = self.categorize_sentiment_score(score)

        if metrics.has_iv_data and metrics.has_gamma_data and hasattr(historical_context, 'market_structure_baselines'):
            near_money_puts = [c.implied_volatility for c in contracts if
                               c.contract_type == 'put' and abs(c.moneyness) < 0.10 and c.implied_volatility > 0]
            near_money_calls = [c.implied_volatility for c in contracts if
                                c.contract_type == 'call' and abs(c.moneyness) < 0.10 and c.implied_volatility > 0]

            skew_score = 0
            if near_money_puts and near_money_calls:
                avg_put_iv = sum(near_money_puts) / len(near_money_puts)
                avg_call_iv = sum(near_money_calls) / len(near_money_calls)
                if avg_call_iv > 0:
                    skew_score = -((avg_put_iv / avg_call_iv) - 1)

            total_call_gamma = sum(c.gamma for c in contracts if c.contract_type == 'call' and c.gamma > 0)
            total_put_gamma = sum(c.gamma for c in contracts if c.contract_type == 'put' and c.gamma > 0)

            gamma_score = 0
            if total_call_gamma > 0 and total_put_gamma > 0:
                gamma_score = (total_call_gamma / total_put_gamma) - 1

            live_score = (skew_score * 0.6) + (gamma_score * 0.4)

            baseline_scores = historical_context.market_structure_baselines.get(bucket_name, [])
            if not baseline_scores:
                baseline_scores = [score for bucket_scores in historical_context.market_structure_baselines.values() for
                                   score in bucket_scores]

            if baseline_scores:
                percentile = stats.percentileofscore(baseline_scores, live_score)
                final_score = (percentile / 50.0) - 1.0
                sentiment_fields["market_structure_sentiment_score"] = final_score
                sentiment_fields["market_structure_sentiment_category"] = self.categorize_sentiment_score(final_score)

        return sentiment_fields

    def categorize_sentiment_score(self, score):
        if score > 0.7:
            return "strongly bullish"
        elif score > 0.3:
            return "bullish"
        elif score > 0.1:
            return "slightly bullish"
        elif score < -0.7:
            return "strongly bearish"
        elif score < -0.3:
            return "bearish"
        elif score < -0.1:
            return "slightly bearish"
        else:
            return "neutral"

    def group_contracts_by_expiration_for_export(self, processed_contracts: List[UnifiedContract],
                                                 has_premium_data: bool) -> Dict[
        str, Any]:
        expirations = defaultdict(lambda: {"calls": [], "puts": []})

        for contract in processed_contracts:
            contract_data = contract.export_contract_as_dict()

            if contract.contract_type == "call":
                expirations[contract.expiration_date]["calls"].append(contract_data)
            elif contract.contract_type == "put":
                expirations[contract.expiration_date]["puts"].append(contract_data)

        result = {}
        for expiry, data in expirations.items():
            all_contracts_for_expiry = data["calls"] + data["puts"]

            summary = {
                "total_call_volume": sum(c.get("volume", 0) for c in data["calls"]),
                "total_put_volume": sum(p.get("volume", 0) for p in data["puts"]),
                "total_call_oi": sum(c.get("open_interest", 0) for c in data["calls"]),
                "total_put_oi": sum(p.get("open_interest", 0) for p in data["puts"]),
                "total_contracts": len(all_contracts_for_expiry),
                "institutional_count": sum(
                    1 for c in all_contracts_for_expiry if c.get("flow_classification") == "Likely Institutional"),
                "retail_count": sum(
                    1 for c in all_contracts_for_expiry if c.get("flow_classification") == "Likely Retail"),
                "ambiguous_count": sum(
                    1 for c in all_contracts_for_expiry if c.get("flow_classification") == "Ambiguous")
            }

            if has_premium_data:
                summary["total_call_premium"] = sum(c.get("premium", 0) for c in data["calls"])
                summary["total_put_premium"] = sum(p.get("premium", 0) for p in data["puts"])

            data["calls"].sort(key=lambda x: x.get("activity_score", 0), reverse=True)
            data["puts"].sort(key=lambda x: x.get("activity_score", 0), reverse=True)

            limited_calls = data["calls"][:Constants.MAX_ACTIVE_CONTRACTS_PER_TYPE]
            limited_puts = data["puts"][:Constants.MAX_ACTIVE_CONTRACTS_PER_TYPE]

            summary["contracts_shown"] = len(limited_calls) + len(limited_puts)

            all_contracts = limited_calls + limited_puts
            for i, contract in enumerate(all_contracts):
                if i >= Constants.MAX_GREEKS_DETAIL_CONTRACTS:
                    contract.pop("gamma", None)
                    contract.pop("theta", None)
                    contract.pop("vega", None)

            result[expiry] = {
                "calls": limited_calls,
                "puts": limited_puts,
                "summary": summary
            }

        sorted_expirations = sorted(
            result.items(),
            key=lambda x: x[1]["summary"]["total_call_volume"] + x[1]["summary"]["total_put_volume"] +
                          x[1]["summary"]["total_call_oi"] + x[1]["summary"]["total_put_oi"],
            reverse=True
        )

        return dict(sorted_expirations[:Constants.MAX_EXPIRATIONS_DETAILED])

    def format_put_call_ratios_for_export(self, metrics: UnifiedMetrics) -> Dict[str, Any]:
        result = {}

        if metrics.has_volume_data:
            result.update({
                "call_volume": metrics.call_volume,
                "put_volume": metrics.put_volume,
                "total_options_volume": metrics.call_volume + metrics.put_volume,
                "volume_put_call_ratio": metrics.volume_ratio
            })

        if metrics.has_oi_data:
            result.update({
                "call_oi": metrics.call_oi,
                "put_oi": metrics.put_oi,
                "oi_put_call_ratio": metrics.oi_ratio
            })

        if metrics.has_premium_data:
            result.update({
                "call_premium": metrics.call_premium,
                "put_premium": metrics.put_premium,
                "premium_put_call_ratio": metrics.premium_ratio
            })

        if metrics.has_delta_data:
            result["delta_weighted_put_call_ratio"] = metrics.delta_weighted_ratio

        if metrics.stock_volume > 0 and metrics.has_volume_data and (metrics.call_volume + metrics.put_volume) > 0:
            result.update({
                "options_stock_volume_ratio": self.utils.calculate_safe_ratio(
                    metrics.call_volume + metrics.put_volume, metrics.stock_volume
                ),
                "stock_volume": metrics.stock_volume
            })

        return result

    def format_unusual_activity_for_export(self, unusual_activity_data: Dict[str, Any]) -> Dict[str, Any]:
        contracts_to_show = unusual_activity_data.get("contracts", [])
        total_found = unusual_activity_data.get("total_found", 0)

        call_count = sum(1 for c in contracts_to_show if c["contract_type"] == "call")
        put_count = sum(1 for c in contracts_to_show if c["contract_type"] == "put")

        return {
            "summary": {
                "total_contracts_found": total_found,
                "contracts_shown": len(contracts_to_show),
                "call_count_shown": call_count,
                "put_count_shown": put_count,
                "top_contracts": contracts_to_show
            }
        }


class CrossTierAnalyzer:
    def __init__(self, utils: 'UnifiedUtils'):
        """Initializes the analyzer for performing Tier 3 comparative analysis."""
        self.utils = utils

    async def run_full_analysis(self,
                                tier1_results: 'ProcessedResults',
                                tier1_json: Dict,
                                tier2_daily_data: Dict[str, Dict],
                                historical_context: 'HistoricalContext',
                                market_status: Optional[Dict]) -> dict:
        tier3_analysis = {}

        if not tier1_results or not historical_context or not tier2_daily_data:
            return tier3_analysis

        try:
            tier1_metadata = tier1_json.get("data_source", {})
            accurate_historical_volumes = [
                day.get("ground_truth_summary", {}).get("accurate_total_volume", 0)
                for day in tier2_daily_data.values()
            ]
            tier3_analysis["historical_context"] = self._analyze_current_vs_historical(
                tier1_json, historical_context, tier1_metadata, accurate_historical_volumes
            )
            tier3_analysis['daily_comparison'] = self._analyze_daily_aggregation_comparison(
                tier1_json, {"daily_data": tier2_daily_data}, market_status
            )
            tier3_analysis['momentum_analysis'] = self._analyze_momentum_patterns(
                tier1_json, {"daily_data": tier2_daily_data}
            )
            tier3_analysis['volatility_analysis'] = self._analyze_volatility_comparison(
                tier1_json, {"daily_data": tier2_daily_data}
            )
            tier3_analysis['pattern_performance'] = self._analyze_pattern_performance(tier2_daily_data)

            if tier1_results.processed_contracts:
                tier3_analysis['net_institutional_premium'] = self._calculate_net_institutional_premium(
                    tier1_results.processed_contracts
                )

            market_state = market_status.get("market", "unknown") if market_status else "unknown"
            is_live_market = market_state == "open"

            sorted_dates = sorted(tier2_daily_data.keys())

            intraday_outcome_map = {}
            for date in sorted_dates:
                day_data = tier2_daily_data.get(date, {})
                time_buckets = list(day_data.get("time_buckets", {}).values())
                if not time_buckets:
                    continue
                open_price = time_buckets[0].get("current_price", 0)
                close_price = time_buckets[-1].get("current_price", 0)
                if open_price > 0 and close_price > 0:
                    intraday_outcome_map[date] = ((close_price - open_price) / open_price) * 100

            for i in range(len(sorted_dates) - 1):
                current_date = sorted_dates[i]
                next_date = sorted_dates[i + 1]
                if next_date in intraday_outcome_map:
                    tier2_daily_data[current_date]['next_day_change_pct'] = intraday_outcome_map[next_date]

            current_profile_for_analogue = None
            historical_set_for_analogue = None
            snapshot_time = None

            if is_live_market:
                current_profile_for_analogue = tier1_json
                historical_set_for_analogue = tier2_daily_data

                snapshot_timestamp_str = tier1_json.get("timestamp")
                if snapshot_timestamp_str:
                    eastern_tz = pytz.timezone('US/Eastern')
                    utc_dt = datetime.datetime.fromisoformat(snapshot_timestamp_str.replace('Z', '+00:00'))
                    snapshot_time = utc_dt.astimezone(eastern_tz).time()

                tier3_analysis["analogue_analysis_mode"] = "Live Intraday vs. Time-Sliced History"
                tier3_analysis[
                    "analogue_analysis_note"] = f"Comparing live market data (up to {snapshot_time.strftime('%H:%M ET')}) against {len(historical_set_for_analogue)} prior trading days (sliced to the same timeframe)."
            else:
                last_valid_day_date = None
                for date in reversed(sorted_dates):
                    day_data = tier2_daily_data.get(date, {})
                    if day_data and day_data.get("time_buckets"):
                        current_profile_for_analogue = day_data
                        last_valid_day_date = date
                        break

                if last_valid_day_date:
                    historical_set_for_analogue = {date: data for date, data in tier2_daily_data.items() if
                                                   date != last_valid_day_date}
                    tier3_analysis["analogue_analysis_mode"] = "Post-Market: Last Day vs. Prior History"
                    tier3_analysis[
                        "analogue_analysis_note"] = f"Comparing the last full trading day ({last_valid_day_date}) against {len(historical_set_for_analogue)} prior trading days."

            if current_profile_for_analogue and historical_set_for_analogue:
                historical_profiles = []
                for date, day_data in historical_set_for_analogue.items():
                    if day_data and day_data.get("time_buckets"):
                        profile = {
                            "date": date,
                            "time_buckets": day_data.get("time_buckets", {}),
                            "next_day_change_pct": day_data.get('next_day_change_pct'),
                            "current_price": 0
                        }
                        time_buckets = list(day_data.get("time_buckets", {}).values())
                        if time_buckets:
                            open_price = time_buckets[0].get("current_price", 0)
                            close_price = time_buckets[-1].get("current_price", 0)
                            if open_price > 0 and close_price > 0:
                                profile["price_change_percent"] = ((close_price - open_price) / open_price) * 100
                                profile["outcome"] = "winning" if close_price > open_price else "losing"
                                profile["current_price"] = close_price
                            else:
                                profile["price_change_percent"] = 0
                                profile["outcome"] = "unknown"
                                profile["current_price"] = close_price if close_price > 0 else open_price
                        historical_profiles.append(profile)

                if historical_profiles:
                    tier3_analysis['analogous_flow_profile'] = self._analyze_analogous_profile(
                        current_profile_for_analogue, historical_profiles, market_status, 'flow', snapshot_time
                    )
                    tier3_analysis['analogous_gamma_profile'] = self._analyze_analogous_profile(
                        current_profile_for_analogue, historical_profiles, market_status, 'gamma', snapshot_time
                    )
                    tier3_analysis['analogous_unusual_activity_profile'] = self._analyze_analogous_profile(
                        current_profile_for_analogue, historical_profiles, market_status, 'unusual', snapshot_time
                    )

        except Exception as e:
            await log_service.options(f"Error during Tier 3 analysis: {str(e)}\nTRACEBACK: {traceback.format_exc()}")

        return tier3_analysis

    def _validate_analogue_results(self, similar_days: List[Dict], historical_profiles: List[Dict]) -> Dict[str, Any]:
        if not similar_days or not historical_profiles:
            return {"status": "insufficient_data"}

        sample_wins = sum(1 for d in similar_days if d.get('outcome') == 'winning')
        sample_size = len(similar_days)
        sample_win_rate = sample_wins / sample_size if sample_size > 0 else 0

        full_wins = sum(1 for d in historical_profiles if d.get('outcome') == 'winning')
        full_size = len(historical_profiles)
        full_win_rate = full_wins / full_size if full_size > 0 else 0

        win_rate_diff = abs(sample_win_rate - full_win_rate)

        validation = {
            "sample_size": sample_size,
            "sample_wins": sample_wins,
            "sample_losses": sample_size - sample_wins,
            "sample_win_rate": round(sample_win_rate, 3),
            "population_size": full_size,
            "population_wins": full_wins,
            "population_losses": full_size - full_wins,
            "population_win_rate": round(full_win_rate, 3),
            "win_rate_difference": round(win_rate_diff, 3)
        }

        if win_rate_diff < 0.05:
            validation[
                "warning"] = f"Sample win rate ({sample_win_rate:.1%}) suspiciously close to population ({full_win_rate:.1%})"
            validation["interpretation"] = "Selection algorithm may not be discriminating effectively"
        elif sample_size < full_size * 0.5:
            validation["note"] = f"Using {sample_size}/{full_size} days - consider reviewing similarity threshold"
        else:
            validation["status"] = "normal"

        return validation

    def _aggregate_daily_profile(self, day_data: Dict, snapshot_time: Optional[datetime.time] = None) -> Optional[Dict]:
        if not day_data or not day_data.get("time_buckets"):
            return None

        time_buckets = list(day_data.get("time_buckets", {}).values())
        if not time_buckets:
            return None

        time_buckets_to_process = time_buckets
        if snapshot_time:
            filtered_buckets = []
            for bucket in time_buckets_to_process:
                bucket_start_time_str = bucket.get("time_label", "00:00-00:00").split('-')[0]
                bucket_start_time = datetime.datetime.strptime(bucket_start_time_str, "%H:%M").time()
                if bucket_start_time <= snapshot_time:
                    filtered_buckets.append(bucket)
            time_buckets_to_process = filtered_buckets

        if not time_buckets_to_process:
            return None

        agg = {
            "put_call_ratios": defaultdict(float),
            "moneyness_distribution": {
                "call_volume": defaultdict(float), "put_volume": defaultdict(float),
                "call_premium": defaultdict(float), "put_premium": defaultdict(float)
            },
            "gamma_by_strike": defaultdict(lambda: {"call_gamma": 0.0, "put_gamma": 0.0, "strike": 0.0}),
            "unusual_contracts": [],
            "smart_money_signals": defaultdict(list)
        }

        for bucket in time_buckets_to_process:
            for key, value in bucket.get("put_call_ratios", {}).items():
                if isinstance(value, (int, float)):
                    agg["put_call_ratios"][key] += value

            dist = bucket.get("distribution", {}).get("moneyness_distribution", {})
            for c_type in ["call", "put"]:
                for m_type in ["volume", "premium"]:
                    for money_bucket in ["itm", "atm", "otm"]:
                        agg["moneyness_distribution"][f"{c_type}_{m_type}"][money_bucket] += dist.get(
                            f"{c_type}_{m_type}", {}).get(money_bucket, 0)

            gamma_strikes = bucket.get("gamma_exposure", {}).get("gamma_metrics", {}).get("gamma_by_strike", [])
            for strike_data in gamma_strikes:
                strike = strike_data["strike"]
                agg["gamma_by_strike"][strike]["strike"] = strike
                agg["gamma_by_strike"][strike]["call_gamma"] += strike_data.get("call_gamma", 0)
                agg["gamma_by_strike"][strike]["put_gamma"] += strike_data.get("put_gamma", 0)

            unusual = bucket.get("unusual_activity", {}).get("summary", {})
            agg["unusual_contracts"].extend(unusual.get("top_contracts", []))

            signals = bucket.get("smart_money_analysis", {}).get("signals", {})
            for category, signal_list in signals.items():
                agg["smart_money_signals"][category].extend(signal_list)

        full_day_profile = {"date": day_data.get("date")}
        open_price = time_buckets_to_process[0].get("current_price", 0)
        close_price = time_buckets_to_process[-1].get("current_price", 0)
        final_price = close_price if close_price > 0 else open_price
        full_day_profile["current_price"] = final_price

        if open_price > 0 and final_price > 0:
            full_day_profile["price_change_percent"] = ((final_price - open_price) / open_price) * 100
            full_day_profile["outcome"] = "winning" if final_price > open_price else "losing"
        else:
            full_day_profile["price_change_percent"] = 0
            full_day_profile["outcome"] = "unknown"

        pcr = agg["put_call_ratios"]
        pcr["volume_put_call_ratio"] = self.utils.calculate_safe_ratio(pcr.get('put_volume', 0),
                                                                       pcr.get('call_volume', 0))
        pcr["premium_put_call_ratio"] = self.utils.calculate_safe_ratio(pcr.get('put_premium', 0),
                                                                        pcr.get('call_premium', 0))
        full_day_profile["put_call_ratios"] = dict(pcr)

        full_day_profile["distribution"] = {
            "moneyness_distribution": {k: dict(v) for k, v in agg["moneyness_distribution"].items()}
        }

        final_gamma_strikes = []
        for strike, data in agg["gamma_by_strike"].items():
            data["net_gamma"] = data["call_gamma"] + data["put_gamma"]
            final_gamma_strikes.append(data)
        full_day_profile["gamma_exposure"] = {
            "gamma_metrics": {
                "gamma_by_strike": sorted(final_gamma_strikes, key=lambda x: abs(x['net_gamma']), reverse=True)
            }
        }

        sorted_unusual = sorted(agg["unusual_contracts"], key=lambda x: x.get("unusual_score", 0), reverse=True)
        full_day_profile["unusual_activity"] = {
            "summary": {
                "top_contracts": sorted_unusual,
                "call_count_shown": sum(1 for c in sorted_unusual if c.get('contract_type') == 'call'),
                "put_count_shown": sum(1 for c in sorted_unusual if c.get('contract_type') == 'put')
            }
        }

        full_day_profile["smart_money_analysis"] = {
            "signals": {k: sorted(v, key=lambda x: x.get('premium', 0), reverse=True) for k, v in
                        agg["smart_money_signals"].items()}
        }

        full_day_profile["next_day_change_pct"] = day_data.get("next_day_change_pct")
        return full_day_profile

    def _analyze_analogous_profile(self, current_profile, historical_profiles, market_status, profile_type,
                                   snapshot_time: Optional[datetime.time] = None):
        profile_configs = {
            'flow': {
                'description': 'options flow profile (Volume & Premium)',
                'comparison_method': 'Compares the normalized distribution of call/put volume and premium across ITM, ATM, and OTM strikes.',
                'vector_creator': self._create_flow_vector
            },
            'gamma': {
                'description': 'market structure (Gamma Profile)',
                'comparison_method': 'Compares the normalized distribution of Net Gamma Exposure in a -10% to +10% range around the stock price.',
                'methodology_note': 'This analysis compares the current market\'s gamma positioning (weighted by Open Interest) against historical days\' gamma flow (weighted by Volume) to find structurally similar risk profiles.',
                'vector_creator': self._create_gamma_vector
            },
            'unusual': {
                'description': 'high-conviction trading profile (Unusual Activity)',
                'comparison_method': 'Compares the footprint of unusual trades, including call/put counts, total premium, and dominant smart money strategies.',
                'vector_creator': self._create_unusual_vector
            }
        }

        config = profile_configs[profile_type]
        vector_creator = config['vector_creator']

        is_live_vs_historical_comparison = "time_buckets" not in current_profile

        current_vector = vector_creator(current_profile)
        if not current_vector or (isinstance(current_vector, list) and all(v == 0 for v in current_vector)):
            return {"summary": f"Current day {profile_type} data is insufficient for analysis."}

        for profile in historical_profiles:
            profile_to_process = profile
            if is_live_vs_historical_comparison:
                profile_to_process = self._aggregate_daily_profile(profile, snapshot_time)

            profile[f"{profile_type}_vector"] = vector_creator(profile_to_process)

        similar_days = self._find_analogous_days(
            current_vector, historical_profiles, f"{profile_type}_vector", market_status
        )
        if not similar_days:
            return {"summary": f"No historically analogous {profile_type} profiles found."}

        win_count = sum(1 for day in similar_days if day['outcome'] == 'winning')
        loss_count = len(similar_days) - win_count

        summary = (
            f"Found {len(similar_days)} days with a similar {config['description']}. "
            f"Of these, {win_count} were winning and {loss_count} were losing."
        )

        validation = self._validate_analogue_results(similar_days, historical_profiles)

        result = {
            "summary": summary,
            "comparison_method": config['comparison_method'],
            "similar_days": similar_days,
            "validation": validation
        }

        if 'methodology_note' in config:
            result['methodology_note'] = config['methodology_note']

        return result

    def _create_flow_vector(self, profile):
        if "time_buckets" in profile:
            buckets = profile.get("time_buckets", {})
            vector = []
            for bucket_config in Constants.TIME_BUCKETS:
                bucket_name = bucket_config["name"]
                bucket_data = buckets.get(bucket_name, {})
                pcr = bucket_data.get("put_call_ratios", {})
                dist = bucket_data.get("distribution", {}).get("moneyness_distribution", {})

                vector.extend([
                    pcr.get("call_volume", 0),
                    pcr.get("put_volume", 0),
                    pcr.get("call_premium", 0),
                    pcr.get("put_premium", 0),
                    pcr.get("delta_weighted_put_call_ratio", 0),
                    dist.get("call_volume", {}).get("atm", 0),
                    dist.get("put_volume", {}).get("atm", 0),
                    dist.get("ratios", {}).get("atm_put_call_volume_ratio", 0)
                ])
            return vector

        dist_source = profile.get("distribution", {}).get("moneyness_distribution", {})
        if not dist_source:
            return []

        vector = []
        for c_type in ["call", "put"]:
            for m_type in ["volume", "premium"]:
                dist_key = f"{c_type}_{m_type}"
                if dist_key in dist_source:
                    for money_bucket in ["itm", "atm", "otm"]:
                        vector.append(dist_source[dist_key].get(money_bucket, 0))

        return vector

    def _create_gamma_vector(self, profile):
        if "time_buckets" in profile:
            buckets = profile.get("time_buckets", {})
            vector = []
            for bucket_config in Constants.TIME_BUCKETS:
                bucket_name = bucket_config["name"]
                bucket_data = buckets.get(bucket_name, {})
                gamma_data = bucket_data.get("gamma_exposure", {}).get("gamma_metrics", {})

                net_gamma = gamma_data.get("net_gamma_exposure", 0)
                normalized_gamma = gamma_data.get("normalized_gamma_exposure", 0)
                gamma_flip = gamma_data.get("gamma_flip_point", 0)
                dealer_long = 1 if gamma_data.get("dealer_positioning", {}).get("long_gamma", False) else -1
                gamma_strikes = gamma_data.get("gamma_by_strike", [])
                top_3_gamma = sum(abs(s.get("net_gamma", 0)) for s in gamma_strikes[:3])

                vector.extend([net_gamma, normalized_gamma, gamma_flip, dealer_long, top_3_gamma])
            return vector

        gamma_metrics = profile.get("gamma_exposure", {}).get("gamma_metrics", {})
        price = profile.get("current_price", 0)
        gamma_by_strike = gamma_metrics.get("gamma_by_strike", [])
        if not gamma_by_strike or price == 0:
            return []

        vector = [0.0] * 21
        total_gamma_abs = sum(abs(s.get('net_gamma', 0)) for s in gamma_by_strike)
        if total_gamma_abs == 0:
            return vector

        for strike_data in gamma_by_strike:
            moneyness = (strike_data['strike'] / price) - 1
            index = int(round(moneyness * 100)) + 10
            if 0 <= index < 21:
                vector[index] += strike_data.get('net_gamma', 0) / total_gamma_abs
        return vector

    def _create_unusual_vector(self, profile):
        if "time_buckets" in profile:
            buckets = profile.get("time_buckets", {})
            vector = []
            for bucket_config in Constants.TIME_BUCKETS:
                bucket_name = bucket_config["name"]
                bucket_data = buckets.get(bucket_name, {})

                unusual = bucket_data.get("unusual_activity", {}).get("summary", {})
                top_contracts = unusual.get("top_contracts", [])

                call_unusual_vol = sum(c.get("volume", 0) for c in top_contracts if c.get("contract_type") == "call")
                put_unusual_vol = sum(c.get("volume", 0) for c in top_contracts if c.get("contract_type") == "put")
                call_unusual_prem = sum(c.get("premium", 0) for c in top_contracts if c.get("contract_type") == "call")
                put_unusual_prem = sum(c.get("premium", 0) for c in top_contracts if c.get("contract_type") == "put")
                max_unusual_score = max([c.get("unusual_score", 0) for c in top_contracts], default=0)

                smart_money = bucket_data.get("smart_money_analysis", {}).get("signals", {})
                high_conviction_count = len(smart_money.get("high_conviction", []))
                hedge_count = len(smart_money.get("hedge_protection", []))
                speculation_count = len(smart_money.get("leveraged_speculation", []))

                vector.extend([
                    call_unusual_vol, put_unusual_vol, call_unusual_prem,
                    put_unusual_prem, max_unusual_score, high_conviction_count,
                    hedge_count, speculation_count
                ])
            return vector

        unusual = profile.get("unusual_activity", {}).get("summary", {})
        smart_money = profile.get("smart_money_analysis", {})
        if not unusual or not smart_money:
            return []

        total_premium = sum(c.get('premium', 0) for c in unusual.get("top_contracts", []))
        signals = smart_money.get("signals", {})

        return [
            unusual.get("call_count_shown", 0),
            unusual.get("put_count_shown", 0),
            total_premium,
            len(signals.get("high_conviction", [])),
            len(signals.get("hedge_protection", [])),
            len(signals.get("leveraged_speculation", []))
        ]

    def _find_analogous_days(self, current_vector, historical_profiles, vector_key, market_status):
        if not current_vector or all(v == 0 for v in current_vector):
            return []

        current_log = np.log1p(np.abs(np.array(current_vector)))

        distances = []
        for hist_profile in historical_profiles:
            hist_vector = hist_profile.get(vector_key, [])
            if not hist_vector or all(v == 0 for v in hist_vector):
                continue

            hist_log = np.log1p(np.abs(np.array(hist_vector)))
            distance = np.linalg.norm(current_log - hist_log)
            distances.append({"profile": hist_profile, "distance": distance})

        if not distances:
            return []

        similar_days_raw = sorted(distances, key=lambda x: x["distance"])[:Constants.MAX_ANALOGOUS_DAYS]

        market_state = market_status.get("market", "unknown") if market_status else "unknown"
        is_pre_market_or_closed = market_state in ["early_trading", "closed", "extended-hours"]

        formatted_days = []
        max_dist = similar_days_raw[-1]['distance'] if similar_days_raw and similar_days_raw[-1][
            'distance'] > 0 else 1.0
        for i, day in enumerate(similar_days_raw):
            profile = day['profile']
            formatted_day = {
                "date": profile["date"],
                "similarity_score": int(max(0, (1 - day['distance'] / max_dist)) * 100),
                "is_best_match": i == 0
            }

            if is_pre_market_or_closed:
                formatted_day['outcome_period'] = 'next_day'
                next_day_change = profile.get('next_day_change_pct')
                if next_day_change is not None:
                    formatted_day['price_change_percent'] = round(next_day_change, 2)
                    formatted_day['outcome'] = 'winning' if next_day_change > 0 else 'losing'
                else:
                    formatted_day['price_change_percent'] = 0
                    formatted_day['outcome'] = 'unknown'
            else:
                formatted_day['outcome_period'] = 'intraday'
                formatted_day['price_change_percent'] = round(profile.get("price_change_percent", 0), 2)
                formatted_day['outcome'] = profile.get("outcome", "unknown")

            formatted_days.append(formatted_day)

        return formatted_days

    def _calculate_net_institutional_premium(self, contracts: List['UnifiedContract']) -> Dict[str, Any]:
        """Calculates the net premium difference between institutional calls and puts."""
        institutional_call_premium = 0
        institutional_put_premium = 0
        institutional_call_volume = 0
        institutional_put_volume = 0

        for contract in contracts:
            if contract.flow_classification == "Likely Institutional":
                if contract.contract_type == "call":
                    institutional_call_premium += contract.premium
                    institutional_call_volume += contract.volume
                elif contract.contract_type == "put":
                    institutional_put_premium += contract.premium
                    institutional_put_volume += contract.volume

        net_premium = institutional_call_premium - institutional_put_premium

        if net_premium > 0:
            bias = "Bullish"
            interpretation = f"Institutional traders are showing a bullish bias, with call premium exceeding put premium by ${abs(net_premium):,.0f}."
        elif net_premium < 0:
            bias = "Bearish"
            interpretation = f"Institutional traders are showing a bearish bias, with put premium exceeding call premium by ${abs(net_premium):,.0f}."
        else:
            bias = "Neutral"
            interpretation = "Institutional premium is balanced between calls and puts."

        return {
            "net_premium": net_premium,
            "institutional_call_premium": institutional_call_premium,
            "institutional_put_premium": institutional_put_premium,
            "institutional_call_volume": institutional_call_volume,
            "institutional_put_volume": institutional_put_volume,
            "bias": bias,
            "interpretation": interpretation
        }

    def _analyze_pattern_performance(self, tier2_daily_data: Dict[str, Dict]) -> Dict[str, Any]:
        pattern_outcomes = defaultdict(list)
        sorted_dates = sorted(tier2_daily_data.keys())

        if len(sorted_dates) < Constants.MIN_PATTERN_PERFORMANCE_DAYS:
            return {"analysis_note": "Insufficient historical data to analyze pattern performance."}

        for i in range(len(sorted_dates) - 1):
            current_date = sorted_dates[i]
            next_date = sorted_dates[i + 1]

            current_day = tier2_daily_data[current_date]
            next_day = tier2_daily_data[next_date]

            pattern = current_day.get("daily_pattern")

            current_buckets = list(current_day.get("time_buckets", {}).values())
            next_buckets = list(next_day.get("time_buckets", {}).values())

            if not current_buckets or not next_buckets:
                continue

            current_close = current_buckets[-1].get("current_price", 0)
            next_close = next_buckets[-1].get("current_price", 0)

            if current_close <= 0 or next_close <= 0:
                continue

            next_day_return = ((next_close - current_close) / current_close) * 100

            if pattern and pattern != "Unknown":
                pattern_outcomes[pattern].append(next_day_return)

        if not pattern_outcomes:
            return {"analysis_note": "Insufficient historical data to analyze pattern performance."}

        performance_stats = {}
        for pattern, returns in pattern_outcomes.items():
            if not returns:
                continue

            win_count = sum(1 for r in returns if r > 0)
            total_trades = len(returns)
            win_rate = (win_count / total_trades) * 100 if total_trades > 0 else 0
            average_return = sum(returns) / total_trades if total_trades > 0 else 0

            performance_stats[pattern] = {
                "occurrences": total_trades,
                "win_rate_percent": round(win_rate, 1),
                "average_next_day_return_percent": round(average_return, 2)
            }

        return {
            "analysis_note": "Performance is based on the price change of the day immediately following the pattern's occurrence.",
            "statistics": performance_stats
        }

    def _analyze_current_vs_historical(self, tier1_result: dict, historical_context: 'HistoricalContext',
                                       tier_metadata: dict, accurate_historical_volumes: List[float]) -> dict:
        enriched = {}
        metrics = tier1_result.get("put_call_ratios", {})
        current_total_volume = metrics.get("total_options_volume", 0)
        tier_capabilities = tier_metadata.get("capabilities", {})
        sample_size = len(historical_context.daily_data)

        if current_total_volume > 0:
            if accurate_historical_volumes:
                volume_percentile = stats.percentileofscore(accurate_historical_volumes, current_total_volume)
                enriched['volume_percentile'] = round(volume_percentile, 2)
                avg_daily_volume = sum(accurate_historical_volumes) / len(accurate_historical_volumes)
                if avg_daily_volume > 0:
                    volume_multiplier = current_total_volume / avg_daily_volume
                    enriched["activity_level"] = f"{volume_multiplier:.1f}x average daily volume"

            if tier_capabilities.get("has_premium_data", False):
                ratio_value = metrics.get("premium_put_call_ratio", 0)
                median_pc_ratio = historical_context.prediction_weighted_premium_pc_ratio
                pc_percentile = historical_context.baseline_get_percentile(ratio_value, 'daily_premium_pc_ratio')
                enriched['pc_ratio_percentile'] = round(pc_percentile, 2)
                comparison_type = "premium"
            else:
                ratio_value = metrics.get("volume_put_call_ratio", 0)
                median_pc_ratio = historical_context.prediction_weighted_volume_pc_ratio
                pc_percentile = historical_context.baseline_get_percentile(ratio_value, 'daily_volume_pc_ratio')
                enriched['pc_ratio_percentile'] = round(pc_percentile, 2)
                comparison_type = "volume"

            historical_context_info = {
                "median_pc_ratio": median_pc_ratio,
                "days_analyzed": sample_size,
                "comparison_type": comparison_type
            }

            if ratio_value > 0 and median_pc_ratio > 0:
                pct_vs_median = ((ratio_value / median_pc_ratio) - 1) * 100
                if pct_vs_median >= 0:
                    historical_context_info["current_vs_median"] = f"{pct_vs_median:.1f}% above historical median"
                else:
                    historical_context_info["current_vs_median"] = f"{abs(pct_vs_median):.1f}% below historical median"

            if "activity_level" in enriched:
                historical_context_info["activity_level"] = enriched["activity_level"]

            enriched.update(historical_context_info)
        return enriched

    def _analyze_daily_aggregation_comparison(self, tier1_result: dict, tier2_result: dict,
                                              market_status: Optional[Dict]) -> dict:
        current_metrics = tier1_result.get("put_call_ratios", {})
        current_volume = current_metrics.get("total_options_volume", 0)
        current_vol_ratio = current_metrics.get("volume_put_call_ratio", 0)
        current_call_vol = current_metrics.get("call_volume", 0)
        current_put_vol = current_metrics.get("put_volume", 0)

        sample_size = len(tier2_result.get("daily_data", {}))
        market_state = market_status.get("market", "unknown") if market_status else "unknown"
        is_live_intraday = market_state == "open"

        historical_call_vols, historical_put_vols = [], []
        historical_vol_ratios, historical_prem_ratios = [], []
        has_historical_premium = False

        if not is_live_intraday:
            comparison_method = "Full Day vs. Full Day"
            comparison_note = "Snapshot data is treated as a complete trading day and compared against historical total daily volumes."
            historical_volumes = [d.get("ground_truth_summary", {}).get("accurate_total_volume", 0)
                                  for d in tier2_result.get("daily_data", {}).values()]

            for daily_results in tier2_result.get("daily_data", {}).values():
                summary = daily_results.get("intraday_sample_summary", {})
                historical_call_vols.append(summary.get('call_volume', 0))
                historical_put_vols.append(summary.get('put_volume', 0))
                if summary.get('volume_put_call_ratio', 0) > 0:
                    historical_vol_ratios.append(summary['volume_put_call_ratio'])
                if summary.get('premium_put_call_ratio', 0) > 0:
                    historical_prem_ratios.append(summary['premium_put_call_ratio'])
                    has_historical_premium = True
        else:
            comparison_method = "Live Intraday vs. Time-Normalized Historical"
            comparison_note = "Live volume-so-far is compared against historical volumes up to the same time of day for an accurate percentile."
            historical_volumes = []

            eastern = pytz.timezone('US/Eastern')
            current_time = time_service.now(eastern)
            bucket_order = [b["name"] for b in Constants.TIME_BUCKETS]
            current_bucket_index = -1

            current_minutes = current_time.hour * 60 + current_time.minute
            for i, bucket_config in enumerate(Constants.TIME_BUCKETS):
                start_minutes = int(bucket_config["start_time"][:2]) * 60 + int(bucket_config["start_time"][3:])
                end_minutes = int(bucket_config["end_time"][:2]) * 60 + int(bucket_config["end_time"][3:])
                if start_minutes <= current_minutes < end_minutes:
                    current_bucket_index = i
                    break

            if current_bucket_index != -1:
                buckets_to_sum = bucket_order[:current_bucket_index + 1]
                for day_data in tier2_result.get("daily_data", {}).values():
                    volume_so_far = sum(day_data.get("time_buckets", {}).get(b, {}).get("put_call_ratios", {}).get(
                        "total_options_volume", 0) for b in buckets_to_sum)
                    if volume_so_far > 0:
                        historical_volumes.append(volume_so_far)

        result = {
            "comparison_method": comparison_method,
            "comparison_note": comparison_note,
            "total_volume_percentile": round(self.calculate_percentile_rank(current_volume, historical_volumes), 1),
            "volume_pc_ratio_percentile": round(
                self.calculate_percentile_rank(current_vol_ratio, historical_vol_ratios),
                1) if not is_live_intraday else "N/A (Full Day Metric)",
            "call_volume_percentile": round(self.calculate_percentile_rank(current_call_vol, historical_call_vols),
                                            1) if not is_live_intraday else "N/A (Full Day Metric)",
            "put_volume_percentile": round(self.calculate_percentile_rank(current_put_vol, historical_put_vols),
                                           1) if not is_live_intraday else "N/A (Full Day Metric)",
            "days_analyzed": sample_size,
            "comparison_source": "tier1_vs_tier2"
        }

        if has_historical_premium and "premium_put_call_ratio" in current_metrics and not is_live_intraday:
            current_prem_ratio = current_metrics.get("premium_put_call_ratio", 0)
            result["premium_pc_ratio_percentile"] = round(
                self.calculate_percentile_rank(current_prem_ratio, historical_prem_ratios), 1)

        return result

    def _analyze_momentum_patterns(self, tier1_result: dict, tier2_result: dict) -> Optional[dict]:
        """Analyzes short-term trends in volume and put/call ratios."""
        daily_data = tier2_result.get("daily_data", {})
        sorted_dates = sorted(daily_data.keys())

        recent_vol, recent_pcr, recent_premiums = [], [], []

        for date in sorted_dates:
            ground_truth = daily_data[date].get("ground_truth_summary", {})
            intraday_summary = daily_data[date].get("intraday_sample_summary", {})

            if ground_truth.get("accurate_total_volume", 0) > 0:
                recent_vol.append(ground_truth["accurate_total_volume"])

            total_prem = intraday_summary.get("call_premium", 0) + intraday_summary.get("put_premium", 0)
            if total_prem > 0:
                recent_premiums.append(total_prem)

            if intraday_summary.get("volume_put_call_ratio", 0) > 0:
                recent_pcr.append(intraday_summary["volume_put_call_ratio"])

        if len(recent_vol) < 2: return {"message": "Insufficient historical data for momentum analysis."}

        vol_trend = "increasing" if recent_vol[-1] > recent_vol[0] else "decreasing"
        pcr_trend = "bearish" if recent_pcr and recent_pcr[-1] > recent_pcr[0] else "bullish"

        vol_acceleration = (recent_vol[-1] / recent_vol[-2] - 1) * 100 if len(recent_vol) > 1 and recent_vol[
            -2] > 0 else 0
        pcr_change_pct = (recent_pcr[-1] / recent_pcr[-2] - 1) * 100 if len(recent_pcr) > 1 and recent_pcr[
            -2] > 0 else 0

        premium_trend = "stable"
        if len(recent_premiums) > 1 and recent_premiums[-2] > 0:
            premium_change = (recent_premiums[-1] / recent_premiums[-2] - 1) * 100
            if premium_change > 20:
                premium_trend = "increasing"
            elif premium_change < -20:
                premium_trend = "decreasing"

        avg_recent_vol = sum(recent_vol) / len(recent_vol)
        current_vol = tier1_result.get("put_call_ratios", {}).get("total_options_volume", 0)
        volume_vs_recent = (current_vol / avg_recent_vol - 1) * 100 if avg_recent_vol > 0 else 0

        momentum_score = 0
        if vol_trend == "increasing": momentum_score += 1
        if pcr_trend == "bullish": momentum_score += 1
        if premium_trend == "increasing": momentum_score += 1
        if volume_vs_recent > 50: momentum_score += 2

        momentum_strength = "strong" if momentum_score >= 4 else "moderate" if momentum_score >= 2 else "weak"

        return {
            "volume_trend": vol_trend, "pcr_trend": pcr_trend, "premium_trend": premium_trend,
            "volume_acceleration_pct": round(vol_acceleration, 1), "pcr_change_pct": round(pcr_change_pct, 1),
            "volume_vs_recent_avg_pct": round(volume_vs_recent, 1),
            "momentum_strength": momentum_strength, "momentum_score": momentum_score
        }

    def _analyze_volatility_comparison(self, tier1_result: dict, tier2_result: dict) -> dict:
        current_rv = tier1_result.get("realized_volatility", 0.0)
        current_iv = 0
        tier1_capabilities = tier1_result.get("data_source", {}).get("capabilities", {})
        iv_methodology = "contract_average"

        if tier1_capabilities.get("has_iv_data", False):
            volatility_skew = tier1_result.get("distribution", {}).get("volatility_skew")
            if volatility_skew and 'expirations' in volatility_skew:
                iv_values = [iv for expiry in volatility_skew['expirations'].values() for key, iv in expiry.items()
                             if 'iv' in key]
                if iv_values:
                    current_iv = (sum(iv_values) / len(iv_values)) * 100
                    iv_methodology = "25_delta_skew"

            if current_iv == 0:
                all_iv_values = []
                active_contracts = tier1_result.get("active_contracts", {})
                for expiry_data in active_contracts.values():
                    for contract_type in ["calls", "puts"]:
                        for contract in expiry_data.get(contract_type, []):
                            iv_val = contract.get("implied_volatility")
                            if iv_val is not None and iv_val > 0:
                                all_iv_values.append(iv_val * 100)
                if all_iv_values:
                    current_iv = sum(all_iv_values) / len(all_iv_values)

        historical_rvs = []
        historical_ivs = []
        if tier2_result and "daily_data" in tier2_result:
            for day_data in tier2_result.get("daily_data", {}).values():
                ivs_for_this_day = []
                rvs_for_this_day = []
                for bucket_data in day_data.get("time_buckets", {}).values():
                    if bucket_rv := bucket_data.get("realized_volatility", 0.0):
                        rvs_for_this_day.append(bucket_rv)

                    vol_skew = bucket_data.get("distribution", {}).get("volatility_skew")
                    if vol_skew and 'expirations' in vol_skew:
                        iv_values = [
                            iv for expiry in vol_skew['expirations'].values()
                            for key, iv in expiry.items()
                            if 'iv' in key and iv is not None and iv > 0.01
                        ]
                        if iv_values:
                            ivs_for_this_day.append((sum(iv_values) / len(iv_values)) * 100)

                if ivs_for_this_day:
                    historical_ivs.append(sum(ivs_for_this_day) / len(ivs_for_this_day))
                if rvs_for_this_day:
                    historical_rvs.append(sum(rvs_for_this_day) / len(rvs_for_this_day))

        MIN_SAMPLES = 5
        if len(historical_rvs) < MIN_SAMPLES:
            raise ValueError(
                f"Insufficient historical Realized Volatility daily samples ({len(historical_rvs)}) to calculate percentile. Minimum: {MIN_SAMPLES}.")

        avg_historical_rv = sum(historical_rvs) / len(historical_rvs)
        rv_percentile = stats.percentileofscore(historical_rvs, current_rv)

        result = {
            "current_realized_volatility": round(current_rv, 2),
            "average_historical_rv": round(avg_historical_rv, 2),
            "rv_percentile": round(rv_percentile, 1),
            "historical_rv_samples": len(historical_rvs)
        }

        if current_iv > 0:
            if len(historical_ivs) < MIN_SAMPLES:
                raise ValueError(
                    f"Insufficient historical Implied Volatility daily samples ({len(historical_ivs)}) to calculate percentile. Minimum: {MIN_SAMPLES}.")

            avg_historical_iv = sum(historical_ivs) / len(historical_ivs)
            iv_percentile = stats.percentileofscore(historical_ivs, current_iv)
            vol_premium = current_iv - current_rv

            result.update({
                "current_implied_volatility": round(current_iv, 2),
                "average_historical_iv": round(avg_historical_iv, 2),
                "iv_percentile": round(iv_percentile, 1),
                "historical_iv_samples": len(historical_ivs),
                "volatility_premium": round(vol_premium, 2),
                "iv_calculation_method": iv_methodology
            })

            if current_iv > avg_historical_iv * 1.2:
                vol_regime = "high_iv"
                interpretation = f"Current IV ({current_iv:.1f}%) is significantly above the recent historical average ({avg_historical_iv:.1f}%), suggesting elevated market fear or anticipation of a move."
            elif current_iv < avg_historical_iv * 0.8:
                vol_regime = "low_iv"
                interpretation = f"Current IV ({current_iv:.1f}%) is well below the recent historical average ({avg_historical_iv:.1f}%), suggesting market complacency or low expectations for future movement."
            else:
                vol_regime = "normal_iv"
                interpretation = f"Current IV ({current_iv:.1f}%) is in line with the recent historical average ({avg_historical_iv:.1f}%), suggesting normal market conditions."

            result.update({
                "volatility_regime": vol_regime,
                "interpretation": interpretation
            })
        else:
            interpretation = f"Current realized volatility ({current_rv:.1f}%) is at the {rv_percentile:.0f}th percentile of recent history. No implied volatility data is available for a deeper comparison."
            result.update({
                "interpretation": interpretation
            })

        return result

    def calculate_percentile_rank(self, value: float, historical_values: list) -> float:
        """Calculates the percentile rank of a value against a list of historical values."""
        if not historical_values or value == 0:
            return 50.0
        return round(stats.percentileofscore(historical_values, value), 1)

class PolygonOptionsClient:
    def __init__(self, api_key, stock_service=None, cache_service=None):
        self.api_key = api_key
        self.client = RESTClient(api_key)
        self.stock_service = stock_service
        self.cache_service = cache_service
        self.semaphore = asyncio.Semaphore(Constants.API_SEMAPHORE_LIMIT)

    @async_retry_decorator(max_retries=Constants.MAX_RETRIES, retry_delay=Constants.INITIAL_DELAY)
    async def fetch_market_status(self) -> Optional[Dict[str, Any]]:
        """Fetches the current market status from Polygon."""
        url = f"https://api.polygon.io/v1/marketstatus/now?apiKey={self.api_key}"
        try:
            async with aiohttp.ClientSession() as session:
                async with self.semaphore:
                    await asyncio.sleep(Constants.API_DELAY_GENERAL)
                    async with session.get(url) as response:
                        if response.status == 200:
                            return await response.json()
                        else:
                            await log_service.options(
                                f"[PolygonOptionsClient] Failed to fetch market status: Status {response.status}")
                            return None
        except Exception as e:
            await log_service.options(f"[PolygonOptionsClient] ERROR in fetch_market_status: {str(e)}")
            return None

    async def initialize_polygon_client(self):
        """Initialize Polygon API client."""
        await log_service.options("[PolygonOptionsClient] Initialized.")

    @async_retry_decorator(max_retries=Constants.MAX_RETRIES, retry_delay=Constants.INITIAL_DELAY)
    async def fetch_tier1_live_snapshot_data(self, symbol: str, force_refresh: bool = False):
        """Fetch Tier 1 live snapshot data from Polygon API."""
        cache_key = "tier1_snapshot"

        if self.cache_service and not force_refresh:
            cached_data = await self.cache_service.get_cached_options_data(symbol, cache_key)
            if cached_data:
                await log_service.options(f"[PolygonOptionsClient] Cache hit for Tier 1 snapshot.")
                return cached_data
            else:
                await log_service.options(f"[PolygonOptionsClient] Cache miss for Tier 1 snapshot. Fetching from API.")

        all_results = []
        url = f"https://api.polygon.io/v3/snapshot/options/{symbol}?limit=250&apiKey={self.api_key}"

        try:
            async with aiohttp.ClientSession() as session:
                while url:
                    async with self.semaphore:
                        await asyncio.sleep(Constants.API_DELAY_GENERAL)
                        async with session.get(url) as response:
                            data = await response.json()

                    if "results" not in data:
                        error_msg = f"Failed to get bulk options data for {symbol}: {data.get('error')}"
                        await log_service.options(
                            f"[PolygonOptionsClient] ERROR in fetch_tier1_live_snapshot_data: {error_msg}")
                        break

                    results = data["results"]
                    all_results.extend(results)
                    next_url = data.get("next_url")
                    if next_url:
                        url = f"{next_url}&apiKey={self.api_key}" if "apiKey" not in next_url else next_url
                    else:
                        break

            if self.cache_service:
                await self.cache_service.cache_options_data(symbol, cache_key, all_results,
                                                            expiry_seconds=Constants.CURRENT_SNAPSHOT_TTL)

            return all_results

        except Exception as e:
            await log_service.options(
                f"[PolygonOptionsClient] ERROR in fetch_tier1_live_snapshot_data: {str(e)}\nTRACEBACK: {traceback.format_exc()}")
            raise

    async def fetch_tier2_historical_raw_data(self, symbol: str, date: Optional[str]):
        """Fetch Tier 2 historical raw data from Polygon API. Caching is handled by the caller."""
        try:
            contracts = await self.fetch_tier2_options_chain(symbol)
            if not contracts:
                return None

            result = {
                "date": date,
                "contracts": contracts,
                "raw_data": True
            }
            return result

        except Exception as e:
            await log_service.options(
                f"[PolygonOptionsClient] ERROR in fetch_tier2_historical_raw_data: {str(e)}\nTRACEBACK: {traceback.format_exc()}")
            return None

    async def fetch_tier2_options_chain(self, symbol: str, expiration_date: Optional[str] = None):
        """Fetch Tier 2 options chain from Polygon API. This fetches the current chain."""
        params = {"underlying_ticker": symbol, "limit": 1000, "expired": "false"}
        if expiration_date:
            params["expiration_date"] = expiration_date

        try:
            all_options = await self.fetch_tier2_all_options_contracts(params)
            return self.parse_tier2_options_contracts(all_options)
        except Exception as e:
            await log_service.options(
                f"[PolygonOptionsClient] ERROR in fetch_tier2_options_chain: {str(e)}\nTRACEBACK: {traceback.format_exc()}")
            return []

    async def fetch_tier2_all_options_contracts(self, params):
        all_options = []
        try:
            def _fetch_page(page_params):
                return list(self.client.list_options_contracts(**page_params))

            async with self.semaphore:
                await asyncio.sleep(Constants.API_DELAY_VOLUME)
                options = await asyncio.to_thread(_fetch_page, params)
                all_options.extend(options)

            while len(options) == 1000:
                last_ticker = options[-1].ticker if hasattr(options[-1], 'ticker') else None
                if last_ticker is None:
                    break

                next_page_params = params.copy()
                next_page_params["ticker.gt"] = last_ticker

                async with self.semaphore:
                    await asyncio.sleep(Constants.API_DELAY_VOLUME)
                    options = await asyncio.to_thread(_fetch_page, next_page_params)
                    if not options:
                        break
                    all_options.extend(options)
        except Exception as e:
            await log_service.options(
                f"[PolygonOptionsClient] ERROR in fetch_tier2_all_options_contracts: {str(e)}\nTRACEBACK: {traceback.format_exc()}")
            raise

        return all_options

    @async_retry_decorator(max_retries=Constants.MAX_RETRIES, retry_delay=Constants.INITIAL_DELAY)
    async def fetch_tier2_daily_summary(self, ticker: str, date: str) -> Optional[Dict[str, Any]]:
        """Fetch daily open/close summary for a single options contract to get official volume and other ground truth daily metrics."""
        url = f"https://api.polygon.io/v1/open-close/{ticker}/{date}?adjusted=true&apiKey={self.api_key}"
        try:
            async with aiohttp.ClientSession() as session:
                async with self.semaphore:
                    await asyncio.sleep(Constants.API_DELAY_GENERAL)
                    async with session.get(url) as response:
                        if response.status == 200:
                            data = await response.json()
                            return {
                                "ticker": ticker,
                                "volume": data.get("volume", 0),
                                "open": data.get("open", 0),
                                "close": data.get("close", 0),
                                "high": data.get("high", 0),
                                "low": data.get("low", 0),
                                "pre_market": data.get("preMarket", 0),
                                "after_hours": data.get("afterHours", 0)
                            }
                        elif response.status == 404:
                            return {"ticker": ticker, "volume": 0}
                        else:
                            await log_service.options(
                                f"[PolygonOptionsClient] Failed to fetch daily summary for {ticker} on {date}: Status {response.status}")
                            return None
        except Exception as e:
            await log_service.options(
                f"[PolygonOptionsClient] ERROR in fetch_tier2_daily_summary for {ticker}: {str(e)}")
            return None

    async def fetch_tier2_bulk_daily_summaries(self, tickers: List[str], date: str) -> List[Dict[str, Any]]:
        """Fetch daily summaries for a list of tickers in parallel."""
        tasks = [self.fetch_tier2_daily_summary(ticker, date) for ticker in tickers]
        results = await asyncio.gather(*tasks)
        return [res for res in results if res is not None]

    def parse_tier2_options_contracts(self, all_options):
        """Parse Tier 2 options contracts from API response."""
        results = []
        for option in all_options:
            result = {}
            for attr in ['ticker', 'underlying_ticker', 'strike_price', 'shares_per_contract',
                         'expiration_date']:
                if hasattr(option, attr):
                    if attr == 'shares_per_contract':
                        result["share_count"] = getattr(option, attr)
                    else:
                        result[attr] = getattr(option, attr)

            if hasattr(option, 'contract_type'):
                result["contract_type"] = UnifiedUtils.parse_polygon_contract_type(option.contract_type)
            results.append(result)
        return results

    @async_retry_decorator(max_retries=Constants.MAX_RETRIES, retry_delay=Constants.INITIAL_DELAY)
    async def fetch_tier2_single_options_data(self, ticker, date):
        """Fetch single option data for Tier 2 analysis."""
        try:
            url = f"https://api.polygon.io/v2/aggs/ticker/{ticker}/range/1/minute/{date}/{date}?adjusted=true&sort=asc&limit=50000&apiKey={self.api_key}"

            async with aiohttp.ClientSession() as session:
                async with self.semaphore:
                    await asyncio.sleep(Constants.API_DELAY_GENERAL)
                    async with session.get(url) as response:
                        data = await response.json()

                        if data.get("status") == "OK" and "results" in data:
                            return {
                                "ticker": ticker,
                                "date": date,
                                "results": data.get("results", [])
                            }

            return {"ticker": ticker, "date": date, "results": []}
        except (aiohttp.ClientError, asyncio.TimeoutError, KeyError, ValueError) as e:
            await log_service.options(f"[PolygonOptionsClient] Error fetching options data for {ticker}: {str(e)}")
            return {"ticker": ticker, "date": date, "results": []}

    async def fetch_tier2_bulk_volume_data(self, tickers, date):
        """Fetch bulk volume data for Tier 2 analysis."""
        tasks = [self.fetch_tier2_single_options_data(ticker, date) for ticker in tickers]
        results = await asyncio.gather(*tasks)
        return results

class OptionsService:
    def __init__(self, cache_service=None, config_service=None, stock_service=None, yfinance_enricher=None,
                 export_json=False):
        """Initializes the main options service with all necessary dependencies."""
        self.cache = cache_service
        self.config = config_service
        self.stock_service = stock_service
        self.yfinance_enricher = yfinance_enricher
        self.export_json = export_json
        self.utils = UnifiedUtils()
        self.polygon_api_key = self.config.get_key('polygon') if self.config else None
        self.polygon_client = PolygonOptionsClient(self.polygon_api_key, self.stock_service,
                                                   self.cache) if self.polygon_api_key else None
        self.processor = UnifiedOptionsProcessor(self.utils)
        self.tier1_adapter = Tier1Adapter(self.utils)
        self.tier2_adapter = Tier2Adapter(self.utils, self.polygon_client)
        self.cross_analyzer = CrossTierAnalyzer(self.utils)
        self.advanced_analyzer = AdvancedOptionsAnalysisService(cache_service=self.cache)

    async def initialize_options_service(self):
        """Initializes all service dependencies."""
        await self.config.initialize()
        await self.stock_service.initialize()
        if self.polygon_client:
            await self.polygon_client.initialize_polygon_client()
            await log_service.options("OptionsService initialized with Polygon API")
        else:
            await log_service.options("OptionsService initialized without Polygon API key")

    async def get_options_data(self, symbol: str, data_view: str = "frontend", force_refresh: bool = False,
                               force_recalculate: bool = False, historical_days: int = 30) -> Optional[Dict[str, Any]]:
        try:
            full_options_data = await self.get_unified_options_data(
                symbol=symbol,
                force_refresh=force_refresh,
                force_recalculate=force_recalculate,
                historical_days=min(historical_days, Constants.MAX_DAILY_HISTORICAL_ENTRIES)
            )

            if not full_options_data:
                return None

            if self.export_json:
                await self.export_json_output(symbol, full_options_data)

            if data_view == "ai":
                return self.apply_ai_data_view(full_options_data)
            else:
                return full_options_data

        except Exception as e:
            await log_service.options(
                f"[OptionsService] FATAL ERROR in get_options_data for {symbol}: {str(e)}\nTRACEBACK: {traceback.format_exc()}")
            return None

    async def get_unified_options_data(self, symbol: str, force_refresh: bool = False, force_recalculate: bool = False,
                                       historical_days: int = 30) -> Optional[Dict[str, Any]]:
        try:
            yfinance_task = None
            if self.yfinance_enricher:
                yfinance_task = asyncio.create_task(
                    self.yfinance_enricher.get_enrichment_data(symbol, force_refresh=False)
                )
                await log_service.options(f"[OptionsService] Started YFinance fetch in background for {symbol}")

            market_status = await self.polygon_client.fetch_market_status() if self.polygon_client else None

            DATE_BUFFER_DAYS = 3
            buffered_time_range = historical_days + DATE_BUFFER_DAYS

            stock_data = await self.utils.get_stock_data_eastern(self.stock_service, symbol, resolution='minute',
                                                                 time_range=buffered_time_range)
            if not stock_data:
                if yfinance_task:
                    yfinance_task.cancel()
                return None

            try:
                current_price = stock_data[-1]['stock_price']
                if not current_price or current_price <= 0:
                    raise ValueError(f"Invalid current_price value: {current_price}")
            except (IndexError, KeyError, ValueError):
                if yfinance_task:
                    yfinance_task.cancel()
                return None

            today_eastern = time_service.now(pytz.timezone('US/Eastern')).strftime('%Y-%m-%d')
            stock_volume = sum(d.get('volume', 0) for d in stock_data if
                               d.get('datetime_eastern') and d['datetime_eastern'].strftime(
                                   '%Y-%m-%d') == today_eastern)

            tier2_daily_results, historical_context = await self.process_tier2_historical_analysis(
                symbol, stock_data, historical_days, force_refresh
            )

            enrichment_data = None
            if yfinance_task:
                try:
                    enrichment_data = await yfinance_task
                    await log_service.options(f"[OptionsService] YFinance data ready for {symbol}")
                except Exception as e:
                    await log_service.options(f"[OptionsService] YFinance fetch failed: {str(e)}")

            tier1_results_obj, tier1_json = await self.process_tier1_current_analysis(
                symbol, current_price, stock_volume, force_refresh, historical_context, stock_data, market_status,
                enrichment_data
            )

            advanced_analysis_result = None
            if tier2_daily_results:
                full_options_data_for_analysis = {
                    "tier_1_current": tier1_json,
                    "tier_2_historical": {"daily_data": tier2_daily_results}
                }
                advanced_analysis_result = await self.advanced_analyzer.run_full_analysis(
                    symbol, full_options_data_for_analysis, force_recalculate=force_recalculate
                )

                for day_agg in advanced_analysis_result.get('daily_aggregates', []):
                    date = day_agg.get('date')
                    if date in tier2_daily_results:
                        tier2_daily_results[date]['daily_pattern'] = day_agg.get('daily_pattern', 'Unknown')
                        tier2_daily_results[date]['price_change_percent'] = day_agg.get('price_change_percent', 0)

            tier3_result = None
            if tier1_results_obj and tier2_daily_results:
                tier3_result = await self.cross_analyzer.run_full_analysis(
                    tier1_results=tier1_results_obj,
                    tier1_json=tier1_json,
                    tier2_daily_data=tier2_daily_results,
                    historical_context=historical_context,
                    market_status=market_status
                )

            final_result = {
                "symbol": symbol,
                "timestamp": time_service.now().isoformat(),
                "days_analyzed": min(historical_days, Constants.MAX_DAILY_HISTORICAL_ENTRIES),
                "tier_1_current": tier1_json,
                "tier_2_historical": {
                    "data_source": self.tier2_adapter.adapter_get_tier_metadata(),
                    "daily_data": tier2_daily_results,
                    "advanced_analysis": advanced_analysis_result
                } if tier2_daily_results else None,
                "tier_3_comparative": tier3_result
            }

            return final_result

        except Exception as e:
            await log_service.options(
                f"[OptionsService] ERROR in get_unified_options_data for {symbol}: {str(e)}\nTRACEBACK: {traceback.format_exc()}")
            return None

    def validate_tier2_cache_data(self, data_type: str, data: Any) -> bool:
        if not data:
            return False

        if data_type == "contracts":
            contracts = data.get("contracts", [])
            if not contracts or len(contracts) < 10:
                return False
            valid_count = sum(1 for c in contracts if c.get("ticker") and c.get("expiration_date"))
            return valid_count >= len(contracts) * 0.1

        elif data_type == "summary":
            if not isinstance(data, list) or len(data) < 5:
                return False
            with_volume = sum(1 for item in data if item.get("volume", 0) > 0)
            return with_volume >= len(data) * 0.1

        elif data_type == "volume":
            if not isinstance(data, list) or not data:
                return False
            with_results = sum(1 for item in data if item.get("results") and len(item["results"]) > 0)
            return with_results >= len(data) * 0.1

        return False

    async def create_historical_context(self, context_data: Optional[List[Dict]],
                                        contract_volumes: Optional[List[float]] = None,
                                        contract_premiums: Optional[List[float]] = None) -> HistoricalContext:
        """Factory method to create and build the HistoricalContext."""
        if not context_data:
            context_data = []

        context = HistoricalContext(context_data)
        if contract_volumes:
            context.contract_volumes = contract_volumes
        if contract_premiums:
            context.contract_premiums = contract_premiums

        await context.build_baselines()
        return context

    async def process_tier1_current_analysis(self, symbol: str, current_price: float, stock_volume: float,
                                             force_refresh: bool, historical_context: HistoricalContext,
                                             stock_data: List[Dict], market_status: Optional[Dict],
                                             enrichment_data: Optional[Dict] = None) -> (
            Optional[ProcessedResults], Optional[Dict]):
        if not self.polygon_client:
            return None, None

        try:
            await log_service.options(f"[OptionsService] Starting Tier 1 current analysis for {symbol}...")
            snapshot_raw = await self.collect_tier1_snapshot_data(symbol, force_refresh)
            if not snapshot_raw:
                return None, None

            premium_data_was_enriched = False
            if enrichment_data and self.yfinance_enricher:
                snapshot_raw = self.yfinance_enricher.merge_data(snapshot_raw, enrichment_data)
                premium_data_was_enriched = True
                await log_service.options(f"[OptionsService] Successfully merged yfinance data for {symbol}.")
            elif self.yfinance_enricher:
                await log_service.options(
                    f"[OptionsService] No enrichment data from yfinance. Proceeding with Polygon data only.")

            all_contracts_unfiltered = await self.tier1_adapter.transform_contracts_to_unified(snapshot_raw,
                                                                                               stock_data=stock_data)

            contracts = []
            eastern = pytz.timezone("US/Eastern")
            market_state = market_status.get("market", "unknown") if market_status else "unknown"

            if market_state == "open":
                analysis_date = time_service.now(eastern).date()
            elif market_status and market_status.get("serverTime"):
                try:
                    server_time_str = market_status.get("serverTime")
                    server_dt_aware = datetime.datetime.fromisoformat(server_time_str)
                    analysis_date = server_dt_aware.astimezone(eastern).date()
                except (ValueError, TypeError) as e:
                    await log_service.options(
                        f"[OptionsService] Could not parse serverTime '{market_status.get('serverTime')}'. Error: {e}. Falling back to current Eastern date.")
                    analysis_date = time_service.now(eastern).date()
            else:
                await log_service.options(
                    "[OptionsService] Market status or serverTime unavailable. Defaulting to current Eastern date for analysis.")
                analysis_date = time_service.now(eastern).date()

            for contract in all_contracts_unfiltered:
                try:
                    expiration_date = datetime.datetime.strptime(contract.expiration_date, "%Y-%m-%d").date()
                    dte = (expiration_date - analysis_date).days
                    if 0 <= dte <= Constants.MAX_DTE:
                        contracts.append(contract)
                except ValueError:
                    continue

            await log_service.options(
                f"[OptionsService] Filtered out {len(all_contracts_unfiltered) - len(contracts)} contracts based on DTE relative to analysis date: {analysis_date}.")

            coverage_fields = ['volume', 'open_interest', 'premium', 'delta', 'gamma', 'implied_volatility']
            coverage_results = self.utils.calculate_coverage_metrics(contracts, coverage_fields)

            COVERAGE_THRESHOLD = 80.0
            coverage_warnings = []
            critical_issues = []

            for field, coverage_pct in coverage_results.items():
                metric_name = field.replace('_coverage_percent', '')
                if coverage_pct < COVERAGE_THRESHOLD:
                    coverage_warnings.append(f"{metric_name.title()}: {coverage_pct:.1f}%")
                    if coverage_pct < 60:
                        critical_issues.append(f"{metric_name.title()}: {coverage_pct:.1f}%")

            if coverage_warnings:
                await log_service.error(
                    f"[{symbol}] DATA QUALITY: {'; '.join(coverage_warnings)} below {COVERAGE_THRESHOLD}% threshold")

            if critical_issues:
                await log_service.error(
                    f"[{symbol}] CRITICAL: {'; '.join(critical_issues)} - prediction reliability severely compromised")

            tier_metadata = self.tier1_adapter.adapter_get_tier_metadata(
                premium_data_available=premium_data_was_enriched,
                coverage_results=coverage_results
            )
            tier_capabilities = tier_metadata.get("capabilities", {})

            processed_results_obj = await self.processor.process_unified_contracts_to_results(
                contracts, current_price, stock_volume, historical_context, tier_capabilities, stock_data
            )

            if premium_data_was_enriched and processed_results_obj.metrics.has_premium_data:
                if processed_results_obj.metrics.premium_ratio > 5 and processed_results_obj.metrics.volume_ratio < 0.6:
                    await log_service.error(
                        f"[OptionsService] ANOMALY DETECTED: Premium P/C {processed_results_obj.metrics.premium_ratio:.2f} "
                        f"vs Volume P/C {processed_results_obj.metrics.volume_ratio:.2f} - likely data quality issue in {symbol}"
                    )

            tier1_json = await self.processor.export_processed_results_to_json(
                processed_results_obj, tier_metadata, historical_context, market_status
            )
            await log_service.options(f"[OptionsService] Tier 1 analysis for {symbol} complete.")

            return processed_results_obj, tier1_json
        except Exception as e:
            await log_service.options(
                f"[OptionsService] ERROR in process_tier1_current_analysis: {str(e)}\nTRACEBACK: {traceback.format_exc()}")
            return None, None

    async def fetch_tier2_data_with_cache(self, symbol: str, date: str, data_type: str,
                                          fetch_func, fetch_params, force_refresh: bool = False):
        start_time = time.time()
        cache_key = f"tier2_{data_type}_{date}"

        if self.cache and not force_refresh:
            cached_data = await self.cache.get_cached_options_data(symbol, cache_key)
            if cached_data:
                is_valid = self.validate_tier2_cache_data(data_type, cached_data)
                if is_valid:
                    end_time = time.time()
                    duration = end_time - start_time
                    await log_service.options(
                        f"[OptionsService] Valid cache hit for {data_type} on {date}. (Took {duration:.4f}s)")
                    return cached_data
                else:
                    await log_service.options(
                        f"[OptionsService] Invalid cached {data_type} data for {date}, refetching...")

        await log_service.options(f"[OptionsService] Cache miss for {data_type} on {date}. Fetching from API.")

        api_start_time = time.time()
        result = await fetch_func(**fetch_params)
        api_end_time = time.time()
        api_duration = api_end_time - api_start_time
        await log_service.options(
            f"[OptionsService] API fetch for {data_type} on {date} took {api_duration:.2f} seconds.")

        is_valid_from_api = False
        if result:
            is_valid_from_api = self.validate_tier2_cache_data(data_type, result)

        if result and is_valid_from_api:
            if self.cache:
                await self.cache.cache_options_data(symbol, cache_key, result,
                                                    expiry_seconds=Constants.HISTORICAL_TTL)
            return result
        else:
            await log_service.options(f"[OptionsService] WARNING: API returned invalid {data_type} data for {date}")
            raise ValueError(f"Invalid {data_type} data from API for {date}")

    async def process_tier2_historical_analysis(self, symbol: str, stock_data: list, historical_days: int,
                                                force_refresh: bool) -> (Optional[Dict], Optional[HistoricalContext]):
        if not self.polygon_client:
            return None, None

        await log_service.options(f"[OptionsService] Starting Tier 2 historical analysis for {historical_days} days...")

        dates_with_stock_data = defaultdict(list)
        for data_point in stock_data:
            if dt := data_point.get('datetime_eastern'):
                dates_with_stock_data[dt.strftime('%Y-%m-%d')].append(data_point)

        eastern = pytz.timezone('US/Eastern')
        current_date = time_service.now(eastern).strftime('%Y-%m-%d')

        historical_dates = [date for date in dates_with_stock_data.keys() if date < current_date]
        target_dates = sorted(historical_dates, reverse=True)[:historical_days]

        async def process_single_day(date):
            await log_service.options(f"[OptionsService] PASS 1 (Aggregate): Processing raw data for {date}...")

            raw_daily_contracts = await self.fetch_tier2_data_with_cache(
                symbol, date, "contracts",
                self.polygon_client.fetch_tier2_historical_raw_data,
                {"symbol": symbol, "date": date},
                force_refresh
            )

            if not raw_daily_contracts or not raw_daily_contracts.get("contracts"):
                raise ValueError(f"No contracts data available for {date}")

            filtered_contracts = []
            historical_date_obj = datetime.datetime.strptime(date, '%Y-%m-%d').date()
            for contract in raw_daily_contracts["contracts"]:
                try:
                    expiration_date = datetime.datetime.strptime(contract["expiration_date"], "%Y-%m-%d").date()
                    dte = (expiration_date - historical_date_obj).days
                    if 0 <= dte <= Constants.MAX_DTE:
                        filtered_contracts.append(contract)
                except (ValueError, KeyError):
                    continue
            if not filtered_contracts:
                raise ValueError(f"No valid contracts after filtering for {date}")

            daily_summary_results = await self.fetch_tier2_data_with_cache(
                symbol, date, "summary",
                self.polygon_client.fetch_tier2_bulk_daily_summaries,
                {"tickers": [c['ticker'] for c in filtered_contracts], "date": date},
                force_refresh
            )

            if not daily_summary_results:
                raise ValueError(f"No summary data available for {date}")

            active_contracts_for_day = [c for c in filtered_contracts if any(
                s['ticker'] == c['ticker'] and s['volume'] > 0 for s in daily_summary_results)]
            if not active_contracts_for_day:
                raise ValueError(f"No active contracts found for {date}")

            stock_data_for_date = dates_with_stock_data.get(date, [])
            underlying_price = stock_data_for_date[0].get('stock_price', 0) if stock_data_for_date else 0

            calls = [c for c in active_contracts_for_day if c.get("contract_type") == "call"]
            puts = [p for p in active_contracts_for_day if p.get("contract_type") == "put"]

            sampled_contracts = await asyncio.to_thread(
                self.tier2_adapter.get_tier2_stratified_sample,
                calls, puts, daily_summary_results,
                Constants.GRANULAR_SAMPLE_PERCENTAGE,
                underlying_price
            )

            all_tickers = list(set(sampled_contracts["call_tickers"]) | set(sampled_contracts["put_tickers"]))
            if not all_tickers:
                raise ValueError(f"No tickers in sample for {date}")

            volume_results = await self.fetch_tier2_data_with_cache(
                symbol, date, "volume",
                self.polygon_client.fetch_tier2_bulk_volume_data,
                {"tickers": all_tickers, "date": date},
                force_refresh
            )

            if not volume_results:
                raise ValueError(f"No volume data available for {date}")

            bucketed_data = await self.tier2_adapter.fetch_and_bucket_daily_volume_data(
                all_tickers, date,
                sampled_contracts["call_tickers"],
                sampled_contracts["put_tickers"],
                stock_data_for_date,
                volume_results=volume_results
            )
            if not bucketed_data:
                raise ValueError(f"Failed to bucket data for {date}")

            return {
                "date": date,
                "bucketed_data": bucketed_data,
                "stock_data_for_date": stock_data_for_date,
                "daily_summary_results": daily_summary_results,
                "filtered_contracts": active_contracts_for_day
            }

        pre_processed_payloads = []
        results = await asyncio.gather(*[process_single_day(date) for date in target_dates], return_exceptions=True)

        failed_dates = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                failed_dates.append(target_dates[i])
                await log_service.error(f"[OptionsService] Failed to process {target_dates[i]}: {str(result)}")
            elif result is not None and isinstance(result, dict):
                pre_processed_payloads.append(result)

        if failed_dates:
            await log_service.error(
                f"[OptionsService] CRITICAL: Failed to process {len(failed_dates)} dates: {failed_dates}")
            if len(failed_dates) > len(target_dates) * 0.5:
                raise ValueError(f"Too many failures: {len(failed_dates)} out of {len(target_dates)} dates failed")

        if not pre_processed_payloads:
            raise ValueError("[OptionsService] No historical data could be processed")

        fully_processed_days = []
        total_coverage_stats = defaultdict(list)

        for payload in pre_processed_payloads:
            date = payload['date']
            await log_service.options(f"[OptionsService] PASS 2 (Enrich & Scale): Processing contracts for {date}...")
            unified_contracts = await self.tier2_adapter.transform_contracts_to_unified(payload["bucketed_data"],
                                                                                        analysis_date_str=date)

            daily_coverage = self.utils.calculate_coverage_metrics(unified_contracts, ['volume', 'premium'])
            for key, value in daily_coverage.items():
                total_coverage_stats[key].append(value)

            contract_type_lookup = {c['ticker']: c.get('contract_type', 'unknown') for c in
                                    payload['filtered_contracts']}
            true_call_volume = sum(s.get('volume', 0) for s in payload['daily_summary_results'] if
                                   contract_type_lookup.get(s.get('ticker')) == 'call')
            true_put_volume = sum(s.get('volume', 0) for s in payload['daily_summary_results'] if
                                  contract_type_lookup.get(s.get('ticker')) == 'put')

            sampled_call_volume = sum(c.volume for c in unified_contracts if c.contract_type == 'call')
            sampled_put_volume = sum(c.volume for c in unified_contracts if c.contract_type == 'put')

            call_scaling_factor = true_call_volume / sampled_call_volume if sampled_call_volume > 0 else 1.0
            put_scaling_factor = true_put_volume / sampled_put_volume if sampled_put_volume > 0 else 1.0

            for contract in unified_contracts:
                if contract.contract_type == 'call':
                    contract.volume *= call_scaling_factor
                    contract.premium *= call_scaling_factor
                else:
                    contract.volume *= put_scaling_factor
                    contract.premium *= put_scaling_factor

            fully_processed_days.append({
                "date": date,
                "contracts": unified_contracts,
                "stock_data_for_date": payload['stock_data_for_date'],
                "daily_summary_results": payload['daily_summary_results'],
                "bucketed_data_raw": payload['bucketed_data']
            })

        await log_service.options(
            f"[OptionsService] PASS 3 (Build): Creating historical context from fully processed data...")
        context_data_list = []
        all_perfected_contract_volumes = []
        all_perfected_contract_premiums = []

        for day_data in fully_processed_days:
            day_bucket_results_for_context: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
                "stock_price": 0, "put_call_ratios": defaultdict(float),
                "active_contracts": defaultdict(lambda: {"calls": [], "puts": []})
            })

            for ctr in day_data['contracts']:
                all_perfected_contract_volumes.append(ctr.volume)
                all_perfected_contract_premiums.append(ctr.premium)

                bucket_name = ctr.time_bucket
                if not bucket_name: continue

                bucket_context = day_bucket_results_for_context[bucket_name]
                bucket_context["stock_price"] = ctr.stock_price

                if ctr.contract_type == 'call':
                    bucket_context["put_call_ratios"]['call_volume'] += ctr.volume
                    bucket_context["put_call_ratios"]['call_premium'] += ctr.premium
                    bucket_context["active_contracts"][ctr.expiration_date]['calls'].append(
                        ctr.export_contract_as_dict())
                else:
                    bucket_context["put_call_ratios"]['put_volume'] += ctr.volume
                    bucket_context["put_call_ratios"]['put_premium'] += ctr.premium
                    bucket_context["active_contracts"][ctr.expiration_date]['puts'].append(
                        ctr.export_contract_as_dict())

            context_data_list.append({"date": day_data['date'], "time_buckets": dict(day_bucket_results_for_context)})

        historical_context = await self.create_historical_context(context_data_list, all_perfected_contract_volumes,
                                                                  all_perfected_contract_premiums)

        volume_deviations_by_bucket = defaultdict(list)
        premium_deviations_by_bucket = defaultdict(list)
        for day in historical_context.daily_data:
            time_buckets = day.get('time_buckets', {})
            for bucket_name, bucket_data in time_buckets.items():
                ratios = bucket_data.get("put_call_ratios", {})
                vol_ratio = UnifiedUtils.calculate_safe_ratio(ratios.get('put_volume', 0), ratios.get('call_volume', 0))
                if vol_ratio > 0 and vol_ratio != 99.99 and vol_ratio != 1.0:
                    vol_baseline = await historical_context.baseline_get_bucket_prediction_weighted_ratio(bucket_name,
                                                                                                          'volume')
                    vol_deviation = (vol_ratio / vol_baseline) - 1.0
                    volume_deviations_by_bucket[bucket_name].append(vol_deviation)
                prem_ratio = UnifiedUtils.calculate_safe_ratio(ratios.get('put_premium', 0),
                                                               ratios.get('call_premium', 0))
                if prem_ratio > 0 and prem_ratio != 99.99 and prem_ratio != 1.0:
                    prem_baseline = await historical_context.baseline_get_bucket_prediction_weighted_ratio(bucket_name,
                                                                                                           'premium')
                    prem_deviation = (prem_ratio / prem_baseline) - 1.0
                    premium_deviations_by_bucket[bucket_name].append(prem_deviation)
        historical_context.volume_deviations_by_bucket = dict(volume_deviations_by_bucket)
        historical_context.premium_deviations_by_bucket = dict(premium_deviations_by_bucket)

        for day_data in fully_processed_days:
            contracts_by_bucket = defaultdict(list)
            for contract in day_data['contracts']:
                contracts_by_bucket[contract.time_bucket].append(contract)
            day_data['contracts_by_bucket'] = dict(contracts_by_bucket)

        avg_coverage_results = {key: float(np.mean(values)) for key, values in total_coverage_stats.items()}
        tier_metadata = self.tier2_adapter.adapter_get_tier_metadata(coverage_results=avg_coverage_results)
        tier_capabilities = tier_metadata.get("capabilities", {})

        async def process_bucket(day_data, bucket_name, bucket_config):
            bucket_contracts = day_data['contracts_by_bucket'].get(bucket_name, [])
            if not bucket_contracts:
                return day_data['date'], bucket_name, None

            bucket_price = day_data['bucketed_data_raw'].get(bucket_name, {}).get("stock_price", 0)

            processed = await self.processor.process_unified_contracts_to_results(
                contracts=bucket_contracts,
                current_price=bucket_price,
                stock_volume=0,
                historical_context=historical_context,
                tier_capabilities=tier_capabilities,
                stock_data_history=day_data['stock_data_for_date']
            )

            bucket_json = await self.processor.export_processed_results_to_json(
                processed, tier_metadata, historical_context, market_status=None
            )
            bucket_json["time_label"] = bucket_config["label"]

            return day_data['date'], bucket_name, bucket_json

        tasks = []
        for day_data in fully_processed_days:
            for bucket_config in Constants.TIME_BUCKETS:
                tasks.append(process_bucket(day_data, bucket_config['name'], bucket_config))

        results = await asyncio.gather(*tasks)

        all_processed_days_json = {}
        for date, bucket_name, bucket_json in results:
            if date not in all_processed_days_json:
                all_processed_days_json[date] = {}
            if bucket_json:
                all_processed_days_json[date][bucket_name] = bucket_json

        for day_data in fully_processed_days:
            date = day_data['date']
            day_bucket_results_json = all_processed_days_json.get(date, {})

            scaled_granular_daily_metrics = defaultdict(float)
            for bucket_json in day_bucket_results_json.values():
                pcr_data = bucket_json.get("put_call_ratios", {})
                for key in ["call_volume", "put_volume", "call_premium", "put_premium"]:
                    scaled_granular_daily_metrics[key] += pcr_data.get(key, 0)

            active_contracts_summary = sorted(
                [res for res in day_data['daily_summary_results'] if res and res.get('volume', 0) > 0],
                key=lambda x: x['volume'], reverse=True)
            ground_truth_summary = {
                "methodology": "Absolute daily metrics calculated from 100% of contracts using the /v1/open-close endpoint.",
                "accurate_total_volume": sum(c.get('volume', 0) for c in active_contracts_summary),
                "active_contracts_count": len(active_contracts_summary),
                "top_active_contracts": active_contracts_summary[:Constants.MAX_ACTIVE_CONTRACTS_PER_TYPE]
            }
            intraday_sample_summary = {
                "methodology": "Metrics are derived from an activity-weighted 25% sample designed to capture the most significant trades. All historical bucket values have been pre-scaled against ground-truth daily totals to ensure the highest fidelity for both baseline creation and intraday analysis.",
                "call_volume": scaled_granular_daily_metrics["call_volume"],
                "put_volume": scaled_granular_daily_metrics["put_volume"],
                "call_premium": scaled_granular_daily_metrics["call_premium"],
                "put_premium": scaled_granular_daily_metrics["put_premium"],
                "volume_put_call_ratio": self.utils.calculate_safe_ratio(scaled_granular_daily_metrics["put_volume"],
                                                                         scaled_granular_daily_metrics["call_volume"]),
                "premium_put_call_ratio": self.utils.calculate_safe_ratio(scaled_granular_daily_metrics["put_premium"],
                                                                          scaled_granular_daily_metrics["call_premium"])
            }

            all_processed_days_json[date] = {
                "date": date,
                "ground_truth_summary": ground_truth_summary,
                "intraday_sample_summary": intraday_sample_summary,
                "stock_volume": sum(d.get('volume', 0) for d in day_data['stock_data_for_date']),
                "time_buckets": day_bucket_results_json,
                "summary": tier_metadata['capabilities']
            }

        await log_service.options("[OptionsService] Tier 2 analysis complete.")
        return all_processed_days_json, historical_context

    async def collect_tier1_snapshot_data(self, symbol: str, force_refresh: bool = False):
        """Collects Tier 1 snapshot data from the Polygon API."""
        if not self.polygon_client: return []
        try:
            all_results = await self.polygon_client.fetch_tier1_live_snapshot_data(symbol,
                                                                                   force_refresh=force_refresh)
            snapshots = self.tier1_adapter.transform_tier1_snapshot_to_contracts(all_results)
            return snapshots
        except Exception as e:
            await log_service.options(
                f"[OptionsService] ERROR in collect_tier1_snapshot_data: {str(e)}\nTRACEBACK: {traceback.format_exc()}")
            return []

    def apply_ai_data_view(self, full_data: dict) -> dict:
        """Applies AI view filtering to reduce data size for AI analysis."""
        if not full_data:
            return {}

        symbol = full_data.get("symbol")
        tier2_data = full_data.get("tier_2_historical", {})
        tier3_data = full_data.get("tier_3_comparative", {})

        advanced_analysis_result = tier2_data.get("advanced_analysis") if tier2_data else None

        tier_2_historical_summary = None
        if tier2_data and advanced_analysis_result:
            tier_2_historical_summary = self.minimize_tier2_for_ai_view(
                tier2_data,
                tier3_data,
                advanced_analysis_result
            )

        return {
            "symbol": symbol,
            "timestamp": full_data.get("timestamp"),
            "days_analyzed": full_data.get("days_analyzed"),
            "tier_1_current": full_data.get("tier_1_current"),
            "tier_2_historical": tier_2_historical_summary,
            "tier_3_comparative": tier3_data
        }

    def minimize_tier2_for_ai_view(self, tier2_data: dict, tier3_data: dict,
                                   advanced_analysis_result: dict) -> dict:
        if not tier2_data or not tier2_data.get("daily_data"):
            return {}

        tier2_metadata = tier2_data.get("data_source", {})
        tier2_capabilities = tier2_data.get("capabilities", {})

        historical_options_volumes = [
            day_info.get("ground_truth_summary", {}).get("accurate_total_volume", 0)
            for day_info in tier2_data["daily_data"].values()
            if day_info.get("ground_truth_summary")
        ]
        avg_historical_options_volume = np.mean(historical_options_volumes) if historical_options_volumes else 0

        advanced_aggregates = {day['date']: day for day in advanced_analysis_result.get('daily_aggregates', [])}
        prediction_stats = advanced_analysis_result.get('prediction_stats', {})

        daily_summaries = []
        for date, day_info in tier2_data.get("daily_data", {}).items():
            if not day_info.get("time_buckets"):
                continue

            intraday_summary = day_info.get("intraday_sample_summary", {})
            total_call_prem = intraday_summary.get("call_premium", 0)
            total_put_prem = intraday_summary.get("put_premium", 0)
            volume_pc_ratio = intraday_summary.get("volume_put_call_ratio", 1.0)

            daily_moneyness = {
                "call_volume": {"itm": 0, "atm": 0, "otm": 0},
                "put_volume": {"itm": 0, "atm": 0, "otm": 0}
            }
            if tier2_capabilities.get("has_premium_data", False):
                daily_moneyness["call_premium"] = {"itm": 0, "atm": 0, "otm": 0}
                daily_moneyness["put_premium"] = {"itm": 0, "atm": 0, "otm": 0}

            time_buckets = list(day_info["time_buckets"].values())
            open_price = time_buckets[0].get("current_price", 0) if time_buckets else 0
            close_price = time_buckets[-1].get("current_price", 0) if time_buckets else 0

            for bucket_data in time_buckets:
                dist = bucket_data.get("distribution", {}).get("moneyness_distribution", {})
                for c_type in ["call", "put"]:
                    for m_type in ["itm", "atm", "otm"]:
                        if f"{c_type}_volume" in dist:
                            daily_moneyness[f"{c_type}_volume"][m_type] += dist.get(f"{c_type}_volume", {}).get(m_type,
                                                                                                                0)
                if tier2_capabilities.get("has_premium_data", False):
                    for c_type in ["call", "put"]:
                        for m_type in ["itm", "atm", "otm"]:
                            if f"{c_type}_premium" in dist:
                                daily_moneyness[f"{c_type}_premium"][m_type] += dist.get(f"{c_type}_premium", {}).get(
                                    m_type, 0)

            price_change_percent = ((close_price - open_price) / open_price) * 100 if open_price > 0 else 0
            total_options_volume_ground_truth = day_info.get("ground_truth_summary", {}).get("accurate_total_volume", 0)
            volume_vs_avg_percent = ((
                                                 total_options_volume_ground_truth / avg_historical_options_volume) - 1) * 100 if avg_historical_options_volume > 0 else 0

            advanced_day_data = advanced_aggregates.get(date, {})

            daily_summary = {
                "date": date,
                "daily_pattern": advanced_day_data.get("daily_pattern", "N/A"),
                "price_change_percent": round(price_change_percent, 2),
                "put_call_ratios": {"volume_pc_ratio": round(volume_pc_ratio, 3)},
                "activity_summary": {
                    "total_options_volume": int(total_options_volume_ground_truth),
                    "volume_vs_average_percent": round(volume_vs_avg_percent, 2)
                },
                "moneyness_summary": daily_moneyness,
                "dislocation_summary": {
                    "mean_dislocation": round(advanced_day_data.get('meanDislocation', 0), 4),
                }
            }

            if tier2_capabilities.get("has_premium_data", False):
                premium_pc_ratio = self.utils.calculate_safe_ratio(total_put_prem, total_call_prem)
                daily_summary["put_call_ratios"]["premium_pc_ratio"] = round(premium_pc_ratio, 3)
                daily_summary["activity_summary"]["total_premium"] = int(total_call_prem + total_put_prem)

            daily_summaries.append(daily_summary)

        momentum = tier3_data.get("momentum_analysis", {})

        model_performance = {}
        if prediction_stats:
            ctc_stats = prediction_stats.get('closeToClose', {})
            if ctc_stats:
                model_performance['close_to_close'] = {
                    "accuracy_percent": round(ctc_stats.get('accuracy', 0), 2),
                    "prediction_label": ctc_stats.get('predictionLabel', 'Neutral'),
                    "prediction_direction": ctc_stats.get('predictionDirection', 'Neutral'),
                    "prediction_strength": round(ctc_stats.get('predictionStrength', 0), 4),
                    "historical_concurrence_percent": round(ctc_stats.get('concurrence', 0), 2)
                }

            intraday_stats = prediction_stats.get('intradaySlope', {})
            if intraday_stats:
                model_performance['intraday_trend'] = {
                    "accuracy_percent": round(intraday_stats.get('accuracy', 0), 2),
                    "prediction_label": intraday_stats.get('predictionLabel', 'Neutral'),
                    "prediction_direction": intraday_stats.get('predictionDirection', 'Neutral'),
                    "prediction_strength": round(intraday_stats.get('predictionStrength', 0), 4),
                    "historical_concurrence_percent": round(intraday_stats.get('concurrence', 0), 2)
                }

        if model_performance:
            model_performance[
                'methodology_note'] = "These accuracy percentages are in-sample metrics optimized on historical data and do not reflect real-world out-of-sample performance. While higher confidence predictions generally correlate with better outcomes, the absolute accuracy values should not be interpreted as forward-looking predictions."

        return {
            "data_source": tier2_metadata,
            "summary": {
                "days_sampled": len(daily_summaries),
                "primary_data_source": "advanced_blended_sentiment_model",
                "volume_trend": momentum.get("volume_trend", "N/A"),
                "pcr_trend": momentum.get("pcr_trend", "N/A"),
                "momentum_strength": momentum.get("momentum_strength", "N/A")
            },
            "model_performance": model_performance,
            "daily_summaries": sorted(daily_summaries, key=lambda x: x['date'], reverse=True)
        }

    async def export_json_output(self, symbol: str, frontend_data: dict):
        if not frontend_data:
            await log_service.options(f"[OptionsService] Skipping JSON export for {symbol}: no frontend data provided.")
            return

        timestamp = time_service.now().strftime('%Y%m%d_%H%M%S')

        frontend_filename = f"{symbol.lower()}_options_output_{timestamp}.json"
        try:
            async with aiofiles.open(frontend_filename, 'w') as f:
                await f.write(json.dumps(frontend_data, indent=2))
            frontend_size = os.path.getsize(frontend_filename)
            await log_service.options(
                f"[OptionsService] Frontend JSON export saved: {frontend_filename} ({frontend_size:,} bytes)")
        except Exception as e:
            await log_service.options(f"[OptionsService] Failed to export frontend JSON for {symbol}: {str(e)}")
            return

        await log_service.options(f"[OptionsService] Generating AI data view for {symbol} for export...")
        ai_data = self.apply_ai_data_view(frontend_data)

        if ai_data:
            ai_filename = f"{symbol.lower()}_ai_view_{timestamp}.json"
            try:
                async with aiofiles.open(ai_filename, 'w') as f:
                    await f.write(json.dumps(ai_data, indent=2))
                ai_size = os.path.getsize(ai_filename)
                reduction_pct = ((frontend_size - ai_size) / frontend_size) * 100 if frontend_size > 0 else 0
                await log_service.options(f"[OptionsService] AI view export saved: {ai_filename} ({ai_size:,} bytes)")
                await log_service.options(f"[OptionsService] Size reduction for AI view: {reduction_pct:.1f}%")
            except Exception as e:
                await log_service.options(f"[OptionsService] Failed to export AI JSON for {symbol}: {str(e)}")