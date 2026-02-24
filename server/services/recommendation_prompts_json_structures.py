def get_master_json_structure():
    return """MARKET DATA JSON STRUCTURE: This is a reference guide to the market data format. **Do not reproduce this schema in your response.**
```json
{
  "company": {
    "symbol": "Stock ticker symbol",
    "name": "Full legal company name"
  },
  "marketTimingInfo": "Current market hours status and next opening/closing time",
  "requestTime": "ISO timestamp when data was requested (Eastern Time)",
  "sentimentAnalysis": {
    "stockArticles": {
      "count": "Number of relevant articles found vs. total analyzed (e.g., '63 of 442')",
      "articles": [
        {
          "date": "ISO publication timestamp (Eastern Time)",
          "title": "Article headline",
          "impactScore": "Combined sentiment/credibility score (-1.0 to 1.0).",
          "certaintyScore": "Confidence in the impact assessment (0.0 to 1.0) based on the article's clarity and completeness. High certainty requires unambiguous information.",
          "propagationSpeed": "Hours until peak market awareness (1-48).",
          "impactDuration": "Hours news remains market-relevant (24-720+).",
          "publisher": "News source name",
          "matchedKeyword": "The search term from the monitoring system that led to the discovery of this article, providing context for the query.",
          "sourceCategory": "The category of the news source (e.g., 'INSTITUTIONAL', 'RETAIL').",
          "temporalOrientation": "Time focus (-1.0=past-focused, 0.0=present-focused, 1.0=future-focused)."
        }
      ]
    },
    "industryArticles": {
      "count": "Number of relevant articles found vs. total analyzed",
      "articles": [
        {
          "date": "ISO publication timestamp (Eastern Time)",
          "title": "Article headline",
          "impactScore": "Combined sentiment/credibility score (-1.0 to 1.0).",
          "certaintyScore": "Confidence in the impact assessment (0.0 to 1.0) based on the article's clarity and completeness. High certainty requires unambiguous information.",
          "propagationSpeed": "Hours until peak industry awareness (1-48)",
          "impactDuration": "Hours news remains industry-relevant (24-720+)",
          "publisher": "News source name",
          "matchedKeyword": "The search term from the monitoring system that led to the discovery of this article, providing context for the query.",
          "sourceCategory": "The category of the news source (e.g., 'INSTITUTIONAL', 'RETAIL').",
          "temporalOrientation": "Time focus (-1.0=past, 0.0=present, 1.0=future)."
        }
      ]
    },
    "marketArticles": {
      "count": "Number of relevant articles found vs. total analyzed",
      "articles": [
        {
          "date": "ISO publication timestamp (Eastern Time)",
          "title": "Article headline",
          "impactScore": "Combined sentiment/credibility score (-1.0 to 1.0).",
          "certaintyScore": "Confidence in the impact assessment (0.0 to 1.0) based on the article's clarity and completeness. High certainty requires unambiguous information.",
          "propagationSpeed": "Hours until peak market awareness (1-48)",
          "impactDuration": "Hours news remains market-relevant (24-720+)",
          "publisher": "News source name",
          "matchedKeyword": "The search term from the monitoring system that led to the discovery of this article, providing context for the query.",
          "sourceCategory": "The category of the news source (e.g., 'INSTITUTIONAL', 'RETAIL').",
          "temporalOrientation": "Time focus (-1.0=past, 0.0=present, 1.0=future)."
        }
      ]
    },
    "filter_note": "A note explaining the criteria used to filter the displayed articles."
  },
  "marketData": {
    "recent_data": [
      {
        "timestamp": "ISO datetime of hourly price record (Eastern Time)",
        "symbol_price": "Stock price at timestamp",
        "symbol_volume": "Trading volume during hour",
        "symbol_marketSession": "Trading session (pre-market, regular, after-hours)",
        "nasdaq_price": "Market index price at same timestamp"
      }
    ],
    "historical_data": [
      {
        "timestamp": "Month identifier (YYYY-MM)",
        "symbol_price": "Average monthly stock price",
        "symbol_volume": "Total monthly trading volume",
        "symbol_change_pct": "Monthly stock percentage change",
        "nasdaq_price": "Average monthly index price",
        "nasdaq_change_pct": "Monthly index percentage change"
      }
    ],
    "symbol_recent_metrics": {
      "firstPrice": "Stock price at period start",
      "lastPrice": "Most recent stock price",
      "priceChange": "Absolute price change over period",
      "priceChangePct": "Percentage price change over period",
      "highestPrice": "Highest price in period",
      "lowestPrice": "Lowest price in period",
      "avgVolume": "Average hourly trading volume"
    },
    "symbol_historical_metrics": {
      "firstPrice": "Stock price at historical period start",
      "lastPrice": "Stock price at historical period end",
      "priceChange": "Absolute historical price change",
      "priceChangePct": "Percentage historical price change",
      "highestPrice": "Highest monthly price in historical period",
      "lowestPrice": "Lowest monthly price in historical period",
      "avgVolume": "Average monthly trading volume",
      "totalPeriods": "Number of months in historical data",
      "avgPeriodChange": "Average monthly percentage change",
      "volatility": "Statistical measure of price movement variance"
    },
    "index_recent_metrics": {
      "nasdaq": {
        "firstPrice": "Index price at recent period start",
        "lastPrice": "Latest index price",
        "priceChange": "Absolute index change in recent period",
        "priceChangePct": "Percentage index change in recent period",
        "highestPrice": "Highest recent index price",
        "lowestPrice": "Lowest recent index price"
      }
    },
    "index_historical_metrics": {
      "nasdaq": {
        "firstPrice": "Index price at historical period start",
        "lastPrice": "Index price at historical period end",
        "priceChange": "Absolute historical index change",
        "priceChangePct": "Percentage historical index change",
        "highestPrice": "Highest monthly index price",
        "lowestPrice": "Lowest monthly index price",
        "totalPeriods": "Number of months in historical data",
        "avgPeriodChange": "Average monthly percentage change",
        "volatility": "Statistical measure of index movement variance"
      }
    }
  },
  "visualizationImages": {
    "count": "Total number of available image categories",
    "categories": [
      "An array of strings listing the available visualization types (e.g., SENTIMENT_TEMPORAL, OPTIONS_ANALYSIS)"
    ]
  },
  "earningsAnalysis": {
    "hasEarningsData": "Boolean indicating if earnings data is available",
    "upcomingEarnings": {
      "date": "ISO date of next earnings report",
      "quarter": "Quarter being reported (e.g., Q3 2025)",
      "epsEstimate": "Analyst consensus EPS estimate",
      "revenueEstimate": "Analyst consensus revenue estimate",
      "reportTime": "When earnings will be reported (e.g., 'After Market Close')"
    },
    "daysUntil": "Number of days until next earnings report",
    "historicalEarnings": [
      {
        "date": "ISO date of a previous earnings report",
        "quarter": "The quarter that was reported",
        "epsEstimate": "The consensus EPS estimate for that quarter",
        "epsActual": "Actual reported EPS for that quarter",
        "surprisePct": "The percentage by which the actual EPS beat or missed the estimate",
        "direction": "'beat' or 'miss'"
      }
    ],
    "pattern": "Describes the historical trend (e.g., CONSISTENT_BEATS)",
    "consistency": "Reliability of the earnings pattern (e.g., HIGH)",
    "expectedVolatility": "Expected price movement around earnings (e.g., LOW)",
    "earningsRisk": "Trading risk associated with the upcoming earnings event (e.g., LOW)"
  }
}
```"""

def get_options_json_structure():
    return """OPTIONS DATA JSON STRUCTURE: This is a reference guide to the options market data format. **Do not reproduce this schema in your response.**
```json
{
  "symbol": "Stock ticker symbol",
  "timestamp": "ISO timestamp when options data was collected",
  "days_analyzed": "Number of historical days included in analysis",
  "tier_1_current": {
    "current_price": "Current stock price at time of analysis",
    "realized_volatility": "Current realized volatility measure",
    "put_call_ratios": {
      "call_volume": "Total call option volume",
      "put_volume": "Total put option volume",
      "total_options_volume": "Combined options volume",
      "volume_put_call_ratio": "Put/Call volume ratio",
      "call_oi": "Total call open interest",
      "put_oi": "Total put open interest",
      "oi_put_call_ratio": "Put/Call open interest ratio",
      "call_premium": "Total call premium",
      "put_premium": "Total put premium",
      "premium_put_call_ratio": "Put/Call premium ratio",
      "delta_weighted_put_call_ratio": "Delta-adjusted put/call ratio",
      "options_stock_volume_ratio": "Options volume relative to stock volume",
      "stock_volume": "Underlying stock volume"
    },
    "data_source": {
      "primary_source": "Primary data source used (volume/premium/contract_count)",
      "tier": "Data tier level",
      "data_source": "Specific data source identifier",
      "access_level": "API access level",
      "capabilities": {
        "has_volume_data": "Boolean indicating volume data availability",
        "has_premium_data": "Boolean indicating premium data availability",
        "has_oi_data": "Boolean indicating open interest data availability",
        "has_delta_data": "Boolean indicating delta data availability",
        "has_gamma_data": "Boolean indicating gamma data availability",
        "has_iv_data": "Boolean indicating implied volatility data availability"
      },
      "coverage": {
        "volume_coverage_percent": "Percentage of contracts with volume data",
        "open_interest_coverage_percent": "Percentage of contracts with open interest data",
        "premium_coverage_percent": "Percentage of contracts with premium data",
        "delta_coverage_percent": "Percentage of contracts with delta data",
        "gamma_coverage_percent": "Percentage of contracts with gamma data",
        "implied_volatility_coverage_percent": "Percentage of contracts with IV data",
        "note": "A summary note on data coverage"
      },
      "primary_metrics": "Array of primary metrics available",
      "analysis_note": "Notes about analysis methodology and limitations",
      "api_limitations": "Description of API limitations"
    },
    "term_structure_analysis": {
      "volatility_term_structure": {
        "status": "Market volatility state (e.g., Backwardation, Contango)",
        "interpretation": "Explanation of what the current volatility structure implies for market expectations",
        "data_points": [
          {
            "dte": "Days to expiration for the data point",
            "iv": "Implied volatility for this expiration"
          }
        ]
      },
      "sentiment_term_structure": {
        "weekly": {
          "dte_range": "Days to expiration range for weekly analysis",
          "premium_put_call_ratio": "Put/call ratio based on premium for the weekly timeframe",
          "interpretation": "Sentiment interpretation for the weekly timeframe"
        },
        "monthly": {
          "dte_range": "Days to expiration range for monthly analysis",
          "premium_put_call_ratio": "Put/call ratio based on premium for the monthly timeframe",
          "interpretation": "Sentiment interpretation for the monthly timeframe"
        },
        "quarterly": {
          "dte_range": "Days to expiration range for quarterly analysis",
          "premium_put_call_ratio": "Put/call ratio based on premium for the quarterly timeframe",
          "interpretation": "Sentiment interpretation for the quarterly timeframe"
        }
      },
      "theta_landscape": {
        "summary": {
          "total_strikes_analyzed": "Total number of strikes analyzed for the expiration",
          "strikes_shown": "Number of top strikes displayed"
        },
        "analysis_expiration_date": "Specific expiration date analyzed for theta decay",
        "total_daily_theta_burn": "Dollar value of time decay for all positions in the expiration",
        "interpretation": "Explanation of how high theta strikes can act as price magnets",
        "top_strikes": [
          {
            "strike": "Strike price with high theta",
            "total_theta": "Total time decay value",
            "call_theta": "Call-specific time decay",
            "put_theta": "Put-specific time decay"
          }
        ]
      }
    },
    "distribution": {
      "total_contracts": "Number of option contracts analyzed",
      "moneyness_distribution": {
        "call_volume": {
          "itm": "In-the-money call volume",
          "atm": "At-the-money call volume",
          "otm": "Out-of-the-money call volume"
        },
        "put_volume": {
          "itm": "In-the-money put volume",
          "atm": "At-the-money put volume",
          "otm": "Out-of-the-money put volume"
        },
        "call_oi": {
          "itm": "In-the-money call open interest",
          "atm": "At-the-money call open interest",
          "otm": "Out-of-the-money call open interest"
        },
        "put_oi": {
          "itm": "In-the-money put open interest",
          "atm": "At-the-money put open interest",
          "otm": "Out-of-the-money put open interest"
        },
        "call_premium": {
          "itm": "In-the-money call premium (0 if unavailable)",
          "atm": "At-the-money call premium (0 if unavailable)",
          "otm": "Out-of-the-money call premium (0 if unavailable)"
        },
        "put_premium": {
          "itm": "In-the-money put premium (0 if unavailable)",
          "atm": "At-the-money put premium (0 if unavailable)",
          "otm": "Out-of-the-money put premium (0 if unavailable)"
        },
        "ratios": {
          "atm_put_call_volume_ratio": "At-the-money put/call volume ratio",
          "atm_put_call_oi_ratio": "At-the-money put/call open interest ratio",
          "atm_put_call_premium_ratio": "At-the-money put/call premium ratio"
        }
      },
      "key_levels": {
        "summary": {
          "total_levels_found": "Total number of key levels identified",
          "levels_shown": "Number of key levels displayed",
          "resistance_levels": "Count of all identified resistance levels",
          "support_levels": "Count of all identified support levels",
          "strength_breakdown": {
            "strong": "Count of all strong levels",
            "moderate": "Count of all moderate levels",
            "weak": "Count of all weak levels"
          }
        },
        "levels": [
          {
            "price": "Strike price level",
            "type": "support/resistance classification",
            "strength": "Level strength (weak/moderate/strong)",
            "gamma": "Gamma exposure at this level",
            "market_impact_note": "Explanation of the level's potential market impact"
          }
        ]
      },
      "max_pain": {
        "price": "Max pain strike price",
        "distance_from_current": "Distance from current price as percentage",
        "pain_value": "Total pain value calculation"
      },
      "volatility_skew": {
        "expirations": {
          "YYYY-MM-DD": {
            "25_delta_skew": "25-delta skew value",
            "put_25d_iv": "25-delta put implied volatility",
            "call_25d_iv": "25-delta call implied volatility",
            "interpretation": "Interpretation of skew (greed/fear indicator)"
          }
        }
      }
    },
    "active_contracts": {
      "YYYY-MM-DD": {
        "calls": [
          {
            "strike": "Call option strike price",
            "expiration": "Expiration date",
            "type": "call",
            "volume": "Trading volume",
            "open_interest": "Open interest",
            "stock_price": "Underlying stock price",
            "moneyness": "Moneyness vs current price",
            "moneyness_bucket": "Moneyness bucket (itm/atm/otm)",
            "activity_score": "Activity scoring metric",
            "flow_classification": "Classification of trade flow (Likely Institutional/Retail/Ambiguous)",
            "implied_volatility": "Implied volatility (if available)",
            "delta": "Option delta",
            "gamma": "Option gamma",
            "theta": "Option theta",
            "vega": "Option vega"
          }
        ],
        "puts": [
          {
            "strike": "Put option strike price",
            "expiration": "Expiration date",
            "type": "put",
            "volume": "Trading volume",
            "open_interest": "Open interest",
            "stock_price": "Underlying stock price",
            "moneyness": "Moneyness vs current price",
            "moneyness_bucket": "Moneyness bucket (itm/atm/otm)",
            "activity_score": "Activity scoring metric",
            "flow_classification": "Classification of trade flow (Likely Institutional/Retail/Ambiguous)",
            "implied_volatility": "Implied volatility (if available)",
            "delta": "Option delta (negative for puts)",
            "gamma": "Option gamma",
            "theta": "Option theta",
            "vega": "Option vega"
          }
        ],
        "summary": {
          "total_call_volume": "Total call volume for expiration",
          "total_put_volume": "Total put volume for expiration",
          "total_call_oi": "Total call open interest",
          "total_put_oi": "Total put open interest",
          "total_contracts": "Number of contracts for this expiration",
          "contracts_shown": "Number of contracts shown"
        }
      }
    },
    "volume_sentiment_score": "Volume-based sentiment score (-1.0 to 1.0)",
    "volume_sentiment_category": "Volume sentiment category classification",
    "premium_sentiment_score": "Premium-based sentiment score (-1.0 to 1.0)",
    "premium_sentiment_category": "Premium sentiment category",
    "oi_sentiment_score": "Open interest sentiment score (-1.0 to 1.0)",
    "oi_sentiment_category": "Open interest sentiment category classification",
    "delta_sentiment_score": "Delta-based sentiment score (-1.0 to 1.0)",
    "delta_sentiment_category": "Delta sentiment category classification",
    "market_structure_sentiment_score": "Sentiment based on IV skew and Gamma (-1.0 to 1.0)",
    "market_structure_sentiment_category": "Market structure sentiment category",
    "unusual_activity": {
      "summary": {
        "total_contracts_found": "Total unusual contracts identified",
        "contracts_shown": "Number of top contracts displayed",
        "call_count_shown": "Number of unusual call contracts in displayed list",
        "put_count_shown": "Number of unusual put contracts in displayed list"
      },
      "top_contracts": [
        {
          "contract_type": "call/put",
          "strike_price": "Option strike price",
          "expiration": "Option expiration date",
          "volume": "Contract volume",
          "open_interest": "Open interest",
          "options_price": "Option price (0 if unavailable)",
          "premium": "Premium value (0 if unavailable)",
          "moneyness": "Moneyness relative to current price",
          "unusual_score": "Unusual activity scoring",
          "z_score": "Statistical z-score for volume",
          "vol_oi_ratio": "Volume to open interest ratio",
          "unusual_reasons": "Array of reasons for unusual classification"
        }
      ]
    },
    "smart_money_analysis": {
      "summary": {
        "total_signals_found": "Total number of smart money signals identified",
        "signals_shown": "Number of smart money signals included in the output",
        "flow_bias": "Flow bias classification (aggressive/defensive/neutral)",
        "dominant_strategy": "Dominant strategy type"
      },
      "signals": {
        "high_conviction": [
          {
            "strike": "Strike price",
            "type": "call/put",
            "volume": "Volume",
            "unusual_score": "Unusual activity score",
            "vol_oi_ratio": "Volume to open interest ratio",
            "premium": "Premium of the trade",
            "reason": "Reason for high conviction classification"
          }
        ],
        "hedge_protection": [
          {
            "strike": "Strike price",
            "type": "call/put",
            "volume": "Volume",
            "unusual_score": "Unusual activity score",
            "vol_oi_ratio": "Volume to open interest ratio",
            "premium": "Premium of the trade",
            "reason": "Reason for hedge or protection classification"
          }
        ],
        "leveraged_speculation": [
          {
            "strike": "Strike price",
            "type": "call/put",
            "volume": "Volume",
            "unusual_score": "Unusual activity score",
            "vol_oi_ratio": "Volume to open interest ratio",
            "premium": "Premium of the trade",
            "reason": "Reason for leveraged speculation classification"
          }
        ],
        "volume_driven_unconfirmed": [
          {
            "strike": "Strike price",
            "type": "call/put",
            "volume": "Volume",
            "unusual_score": "Unusual activity score",
            "vol_oi_ratio": "Volume to open interest ratio",
            "premium": "Premium of the trade (usually 0)",
            "reason": "Reason for classification (premium unconfirmed)"
          }
        ]
      },
      "analysis_note": "Notes about smart money analysis methodology"
    },
    "gamma_exposure": {
      "summary": {
        "total_strikes_found": "Total number of strikes with gamma exposure",
        "strikes_shown": "Number of top strikes displayed",
        "positive_net_gamma_strikes": "Count of all strikes with net positive gamma",
        "negative_net_gamma_strikes": "Count of all strikes with net negative gamma"
      },
      "gamma_metrics": {
        "net_gamma_exposure": "Total net gamma exposure",
        "normalized_gamma_exposure": "Gamma exposure normalized by stock price/volume",
        "gamma_flip_point": "Strike price where net gamma flips from negative to positive",
        "dealer_positioning": {
          "long_gamma": "Boolean indicating if dealers are long gamma",
          "expected_volatility": "Expected volatility impact (suppressed/amplified)"
        },
        "gamma_by_strike": [
          {
            "strike": "Strike price level",
            "call_gamma": "Call gamma exposure at strike",
            "put_gamma": "Put gamma exposure at strike",
            "net_gamma": "Net gamma exposure at strike"
          }
        ]
      }
    }
  },
  "tier_2_historical": {
    "data_source": {
      "tier": "Data tier level (e.g., 2)",
      "data_source": "Specific data source identifier",
      "access_level": "API access level for this tier",
      "capabilities": {
        "has_volume_data": "Boolean indicating volume data availability",
        "has_premium_data": "Boolean indicating premium data availability",
        "has_oi_data": "Boolean indicating open interest data availability",
        "has_delta_data": "Boolean indicating delta data availability",
        "has_gamma_data": "Boolean indicating gamma data availability",
        "has_iv_data": "Boolean indicating implied volatility data availability"
      },
      "coverage": "Object for coverage details, may be empty",
      "primary_metrics": "Array of primary metrics used in analysis",
      "analysis_note": "Notes about analysis methodology and limitations",
      "scaling_note": "Description of any data scaling applied",
      "sampling_percentage": "Percentage of data sampled for analysis"
    },
    "summary": {
      "days_sampled": "Number of historical days sampled",
      "primary_data_source": "Primary data source for historical analysis",
      "volume_trend": "Volume trend direction (increasing/decreasing/stable)",
      "pcr_trend": "Put/call ratio trend direction (bullish/bearish/neutral)",
      "momentum_strength": "Momentum strength (weak/moderate/strong)"
    },
    "model_performance": {
      "forecast_note": "Contains the model's predictive forecasts for the next trading day, based on the historical data analysis.",
      "close_to_close": {
        "accuracy_percent": "The historical backtested accuracy of the close-to-close prediction model.",
        "prediction_label": "The model's overall sentiment forecast for the next day's price change (e.g., 'Slightly Bullish').",
        "prediction_direction": "The core directional forecast (Bullish/Bearish) for the next trading day's close price relative to the current close.",
        "prediction_strength": "The model's numerical confidence score in this forecast (0.0 to 1.0).",
        "historical_concurrence_percent": "In past instances with similar market conditions, this is the percentage of times the outcome matched the model's current prediction."
      },
      "intraday_trend": {
        "accuracy_percent": "The historical backtested accuracy of the intraday trend prediction model.",
        "prediction_label": "The model's forecast for the dominant price pattern during the next trading session.",
        "prediction_direction": "The core directional forecast (Bullish/Bearish) for the trend during the next trading day.",
        "prediction_strength": "The model's numerical confidence score in this forecast (0.0 to 1.0).",
        "historical_concurrence_percent": "In past instances with similar market conditions, this is the percentage of times the intraday trend matched the model's current prediction."
      }
    },
    "daily_summaries": [
      {
        "date": "Trading date (YYYY-MM-DD)",
        "daily_pattern": "Classification of the day's intraday sentiment trend",
        "price_change_percent": "Stock price change percentage for the day",
        "put_call_ratios": {
          "volume_pc_ratio": "Aggregated daily put/call volume ratio"
        },
        "activity_summary": {
          "total_options_volume": "Total options volume for the day",
          "volume_vs_average_percent": "Daily volume vs. historical average percentage"
        },
        "moneyness_summary": {
          "call_volume": {
            "itm": "In-the-money call volume",
            "atm": "At-the-money call volume",
            "otm": "Out-of-the-money call volume"
          },
          "put_volume": {
            "itm": "In-the-money put volume",
            "atm": "At-the-money put volume",
            "otm": "Out-of-the-money put volume"
          }
        },
        "dislocation_summary": {
            "mean_dislocation": "Mean dislocation value for the day"
        }
      }
    ]
  },
  "tier_3_comparative": {
    "historical_context": {
      "volume_percentile": "Current volume percentile vs history",
      "activity_level": "Activity level vs average",
      "pc_ratio_percentile": "Put/call ratio percentile vs history",
      "median_pc_ratio": "Historical median put/call ratio",
      "days_analyzed": "Number of days analyzed for context",
      "comparison_type": "Type of comparison used",
      "current_vs_median": "Current vs median description"
    },
    "daily_comparison": {
      "comparison_method": "Description of the comparison methodology (e.g., Full Day vs. Full Day)",
      "comparison_note": "Additional context for the comparison method",
      "total_volume_percentile": "Total volume percentile ranking",
      "volume_pc_ratio_percentile": "Volume put/call ratio percentile",
      "premium_pc_ratio_percentile": "Premium put/call ratio percentile",
      "call_volume_percentile": "Call volume percentile",
      "put_volume_percentile": "Put volume percentile",
      "days_analyzed": "Number of days analyzed for comparison",
      "comparison_source": "Source of comparison data"
    },
    "momentum_analysis": {
      "volume_trend": "Volume trend direction",
      "pcr_trend": "Put/call ratio trend direction",
      "premium_trend": "Premium trend direction",
      "volume_acceleration_pct": "Volume acceleration percentage",
      "pcr_change_pct": "Put/call ratio change percentage",
      "volume_vs_recent_avg_pct": "Volume vs recent average percentage",
      "momentum_strength": "Momentum strength classification",
      "momentum_score": "Numerical momentum score"
    },
    "volatility_analysis": {
      "current_realized_volatility": "Current RV",
      "average_historical_rv": "Historical average RV",
      "rv_percentile": "RV percentile rank",
      "historical_rv_samples": "Number of historical RV data points",
      "current_implied_volatility": "Current IV",
      "average_historical_iv": "Historical average IV",
      "iv_percentile": "IV percentile rank",
      "historical_iv_samples": "Number of historical IV data points",
      "volatility_premium": "Difference between IV and RV",
      "iv_calculation_method": "Method used for IV (e.g., 25_delta_skew)",
      "volatility_regime": "Categorization of the current IV level (e.g., normal_iv)",
      "interpretation": "Volatility analysis interpretation"
    },
    "pattern_performance": {
      "analysis_note": "Note regarding availability of pattern performance data"
    },
    "net_institutional_premium": {
      "net_premium": "Net institutional premium (Call Premium - Put Premium)",
      "institutional_call_premium": "Total call premium from institutional-classified flow",
      "institutional_put_premium": "Total put premium from institutional-classified flow",
      "institutional_call_volume": "Total call volume from institutional-classified flow",
      "institutional_put_volume": "Total put volume from institutional-classified flow",
      "bias": "Overall bias (Bullish/Bearish/Neutral)",
      "interpretation": "Plain-language interpretation of the institutional flow bias"
    },
    "analogous_flow_profile": {
      "summary": "Summary of similar days based on options flow",
      "comparison_method": "Description of the comparison method",
      "similar_days": [
        {
          "date": "Date of the similar historical day",
          "similarity_score": "Similarity score (0-100) to the current day",
          "is_best_match": "Boolean indicating if this is the closest historical match",
          "outcome_period": "The period over which the outcome was measured (intraday/next_day)",
          "price_change_percent": "The stock's price change during the outcome period",
          "outcome": "Outcome of the day (winning/losing/unknown)"
        }
      ]
    },
    "analogous_gamma_profile": {
      "summary": "Summary of similar days based on gamma profile",
      "comparison_method": "Description of the comparison method",
      "methodology_note": "Explanation of OI vs Volume weighting for transparency",
      "similar_days": [
        {
          "date": "Date of the similar historical day",
          "similarity_score": "Similarity score (0-100) to the current day",
          "is_best_match": "Boolean indicating if this is the closest historical match",
          "outcome_period": "The period over which the outcome was measured (intraday/next_day)",
          "price_change_percent": "The stock's price change during the outcome period",
          "outcome": "Outcome of the day (winning/losing/unknown)"
        }
      ]
    },
    "analogous_unusual_activity_profile": {
      "summary": "Summary of similar days based on unusual trading activity",
      "comparison_method": "Description of the comparison method",
      "similar_days": [
        {
          "date": "Date of the similar historical day",
          "similarity_score": "Similarity score (0-100) to the current day",
          "is_best_match": "Boolean indicating if this is the closest historical match",
          "outcome_period": "The period over which the outcome was measured (intraday/next_day)",
          "price_change_percent": "The stock's price change during the outcome period",
          "outcome": "Outcome of the day (winning/losing/unknown)"
        }
      ]
    }
  }
}
```"""

def get_prediction_history_master_json_structure():
    return """PREDICTION HISTORY JSON STRUCTURE: This is a reference guide to the prediction accuracy data format. **Do not reproduce this schema in your response.**
```json
{
  "predictionAccuracy": {
    "accuracy_metrics": {
      "directional": {
        "total": "Total number of predictions made",
        "correct": "Number of correct directional predictions (BUY=up, SELL=down, HOLD=within +/-0.5%)",
        "accuracy": "Percentage of correct directional predictions"
      },
      "movement_weighted": {
        "accuracy": "The primary skill score (0-100). It's heavily weighted by the magnitude of the actual price movement, rewarding correct predictions on large, impactful moves more than predictions on small, insignificant moves."
      },
      "return_accuracy": {
        "avg_error": "Measures skill in predicting the intraday 'gradient' or 'shape' of price movement. It's the average percentage point difference between the predicted open-to-close return and the actual return. A low value indicates the model accurately predicted the magnitude and direction of the day's move, even if absolute price targets were missed.",
        "rating": "Qualitative rating of the return accuracy (e.g., 'Fair')",
        "bias": "Measures the model's 'skill imbalance' between predicting upward vs. downward price movements. It is calculated as `(error on down days) - (error on up days)`. A value close to 0 indicates balanced skill. A value further from 0 indicates a significant imbalance. A NEGATIVE value means the model has LOWER ERROR on down-trending days (skill is biased towards SELLs). A POSITIVE value means the model has LOWER ERROR on up-trending days (skill is biased towards BUYs).",
        "upward_error": "Average prediction error on days with positive returns",
        "downward_error": "Average prediction error on days with negative returns",
        "count": "Number of predictions included in return accuracy calculation"
      },
      "price": {
        "pre_market": {
          "avg_diff": "Average absolute percentage error in pre-market (07:00) price predictions. Must be interpreted with 'prediction_timedelta_minutes' from the 'daily_log'. A low or negative time delta suggests this is a 'backcast' with little predictive value.",
          "rating": "Qualitative rating of pre-market price accuracy"
        },
        "market_open": {
          "avg_diff": "Average absolute percentage error in market open (09:30) price predictions. Must be interpreted with 'prediction_timedelta_minutes' from the 'daily_log'. A low or negative time delta suggests this is a 'backcast' with little predictive value.",
          "rating": "Qualitative rating of market open price accuracy"
        },
        "market_close": {
          "avg_diff": "Average absolute percentage error in market close (16:00) price predictions. This is often the most reliable price accuracy metric, as the time delta is always significantly positive.",
          "rating": "Qualitative rating of market close price accuracy"
        },
        "after_hours": {
          "avg_diff": "Average absolute percentage error in after-hours (20:00) price predictions.",
          "rating": "Qualitative rating of after-hours price accuracy"
        }
      },
      "action_breakdown": {
        "BUY": {
          "total": "Number of BUY recommendations made",
          "correct": "Number of correct BUY recommendations",
          "accuracy": "Directional accuracy for BUY recommendations",
          "movement_weighted_accuracy": "Movement-weighted accuracy for BUY recommendations",
          "return_accuracy": { "avg_error": "...", "rating": "...", "bias": "...", "upward_error": "...", "downward_error": "...", "count": "..." }
        },
        "SELL": {
          "total": "Number of SELL recommendations made",
          "correct": "Number of correct SELL recommendations",
          "accuracy": "Directional accuracy for SELL recommendations",
          "movement_weighted_accuracy": "Movement-weighted accuracy for SELL recommendations",
          "return_accuracy": { "avg_error": "...", "rating": "...", "bias": "...", "upward_error": "...", "downward_error": "...", "count": "..." }
        },
        "HOLD": {
          "total": "Number of HOLD recommendations made",
          "correct": "Number of correct HOLD recommendations",
          "accuracy": "Directional accuracy for HOLD recommendations",
          "movement_weighted_accuracy": "Movement-weighted accuracy for HOLD recommendations",
          "return_accuracy": { "avg_error": "...", "rating": "...", "bias": "...", "upward_error": "...", "downward_error": "...", "count": "..." }
        }
      }
    },
    "model_comparison": {
      "master": {
        "predictions": "Number of predictions where the model provided valid open and close prices",
        "correct": "Number of times the model correctly predicted the direction of price movement",
        "direction_accuracy": "Directional accuracy of the model's open-to-close predictions",
        "movement_weighted_accuracy": "The primary skill score (0-100). It's heavily weighted by the magnitude of the actual price movement, rewarding correct predictions on large, impactful moves more than predictions on small, insignificant moves.",
        "price_errors": {
          "pre_market": "Average absolute percentage error in pre-market (07:00) price predictions. Must be interpreted with 'prediction_timedelta_minutes' from the 'daily_log'. A low or negative time delta suggests this is a 'backcast' with little predictive value.",
          "market_open": "Average absolute percentage error in market open (09:30) price predictions. Must be interpreted with 'prediction_timedelta_minutes' from the 'daily_log'. A low or negative time delta suggests this is a 'backcast' with little predictive value.",
          "market_close": "Average absolute percentage error in market close (16:00) price predictions. This is often the most reliable price accuracy metric, as the time delta is always significantly positive.",
          "after_hours": "Average absolute percentage error in after-hours (20:00) price predictions."
        },
        "return_accuracy": {
          "avg_error": "Measures skill in predicting the intraday 'gradient' or 'shape' of price movement. It's the average percentage point difference between the predicted open-to-close return and the actual return. A low value indicates the model accurately predicted the magnitude and direction of the day's move, even if absolute price targets were missed.",
          "rating": "Qualitative rating of the return accuracy (e.g., 'Fair')",
          "bias": "Measures the model's 'skill imbalance' between predicting upward vs. downward price movements. It is calculated as `(error on down days) - (error on up days)`. A value close to 0 indicates balanced skill. A value further from 0 indicates a significant imbalance. A NEGATIVE value means the model has LOWER ERROR on down-trending days (skill is biased towards SELLs). A POSITIVE value means the model has LOWER ERROR on up-trending days (skill is biased towards BUYs).",
          "count": "Number of predictions included in return accuracy calculation"
        },
        "valid_predictions": "Count of predictions used for accuracy calculations",
        "price_ratings": {
          "pre_market": "Qualitative rating of pre-market price accuracy",
          "market_open": "Qualitative rating of market open price accuracy",
          "market_close": "Qualitative rating of market close price accuracy",
          "after_hours": "Qualitative rating of after-hours price accuracy"
        }
      },
      "image": {
        "predictions": "...", "correct": "...", "direction_accuracy": "...", "movement_weighted_accuracy": "...",
        "price_errors": { "...": "..." }, "return_accuracy": { "...": "..." }, "valid_predictions": "...", "price_ratings": { "...": "..." }
      },
      "options": {
        "predictions": "...", "correct": "...", "direction_accuracy": "...", "movement_weighted_accuracy": "...",
        "price_errors": { "...": "..." }, "return_accuracy": { "...": "..." }, "valid_predictions": "...", "price_ratings": { "...": "..." }
      },
      "vibe": {
        "predictions": "...", "correct": "...", "direction_accuracy": "...", "movement_weighted_accuracy": "...",
        "price_errors": { "...": "..." }, "return_accuracy": { "...": "..." }, "valid_predictions": "...", "price_ratings": { "...": "..." }
      }
    },
    "magnitude_analysis": {
      "by_magnitude": {
        "Noise": { "total_predictions": "Total non-HOLD predictions on days with <0.25% movement", "correct_predictions": "...", "accuracy": "..." },
        "Minor": { "total_predictions": "Total non-HOLD predictions on days with 0.25% to <0.75% movement", "correct_predictions": "...", "accuracy": "..." },
        "Small": { "total_predictions": "Total non-HOLD predictions on days with 0.75% to <1.5% movement", "correct_predictions": "...", "accuracy": "..." },
        "Moderate": { "total_predictions": "Total non-HOLD predictions on days with 1.5% to <2.5% movement", "correct_predictions": "...", "accuracy": "..." },
        "Large": { "total_predictions": "Total non-HOLD predictions on days with 2.5% to <4.0% movement", "correct_predictions": "...", "accuracy": "..." },
        "Major": { "total_predictions": "Total non-HOLD predictions on days with 4.0% to <6.0% movement", "correct_predictions": "...", "accuracy": "..." },
        "Extreme": { "total_predictions": "Total non-HOLD predictions on days with >=6.0% movement", "correct_predictions": "...", "accuracy": "..." }
      },
      "significant_moves_summary": {
        "total_significant": "Total predictions on days with 'Large', 'Major', or 'Extreme' moves",
        "correct_significant": "Number of correct predictions on those significant move days",
        "significant_accuracy": "Directional accuracy on significant move days",
        "percentage_significant": "Percentage of all non-HOLD predictions that occurred on significant move days"
      },
      "impact_distribution": {
        "Noise": "Percentage of non-HOLD predictions that were on 'Noise' magnitude days",
        "Minor": "Percentage of non-HOLD predictions that were on 'Minor' magnitude days",
        "Small": "...", "Moderate": "...", "Large": "...", "Major": "...", "Extreme": "..."
      }
    },
    "movement_detection": {
      "significant_move_detection_rate": "Of all days with significant moves (>2.5%), what percentage had a non-HOLD (BUY/SELL) prediction",
      "significant_move_accuracy": "Of all days with significant moves (>2.5%), what percentage were predicted in the correct direction",
      "false_alarm_rate": "Of all non-HOLD predictions, what percentage were on days with insignificant (<2.5%) movement",
      "precision_rate": "Of all non-HOLD predictions, what percentage were both directionally correct AND on a significant move day",
      "major_move_detection_rate": "Detection rate specifically for 'Major' moves (>4.0%)",
      "total_significant_moves": "Count of days where actual price movement was >2.5%",
      "total_major_moves": "Count of days where actual price movement was >4.0%",
      "predicted_moves": "Total number of non-HOLD (BUY/SELL) predictions made",
      "detection_quality": "Qualitative rating for move detection (e.g., Needs Improvement)"
    },
    "metadata": {
      "processed_count": "Number of historical recommendations successfully processed for analysis",
      "total_count": "Total number of historical recommendations found",
      "symbols_count": "Number of unique symbols analyzed",
      "symbols": ["Array of symbols included in the analysis"],
      "mode": "Analysis mode (single_symbol or portfolio)"
    },
    "trends": {
      "master": {
        "trend": "Overall accuracy trend for master model (IMPROVING, DECLINING, STABLE) - indicates if your core synthesis approach is getting better over time",
        "trend_strength": "Strength of the trend (STRONG, MODERATE, WEAK, INSUFFICIENT_DATA) - how confident we are in the trend direction",
        "momentum": "Numerical momentum indicator showing direction and magnitude of performance change for master model - positive values indicate improvement acceleration",
        "recent_accuracy": "Most recent 10% of dataset directional accuracy percentage for master model - your latest performance snapshot (e.g., ~9 days for 90-day dataset)",
        "recent_movement_weighted_accuracy": "Most recent 10% of dataset movement-weighted accuracy for master model - your latest skill score on significant moves",
        "comparison": {
          "first_half": "Directional accuracy percentage for first half of all master predictions - your early baseline performance",
          "second_half": "Directional accuracy percentage for second half of all master predictions - your evolved performance",
          "difference": "Difference between second half and first half directional accuracy for master - positive means you've improved",
          "first_half_movement_weighted": "Movement-weighted accuracy for first half of master predictions - early skill on significant moves",
          "second_half_movement_weighted": "Movement-weighted accuracy for second half of master predictions - evolved skill on significant moves",
          "movement_weighted_difference": "Difference between second half and first half movement-weighted accuracy for master - positive means significant improvement on impactful predictions",
          "improvement": "Boolean indicating if second half performance improved over first half for master model"
        },
        "bias_analysis": {
          "trend": "Bias trend for master model (IMPROVING, WORSENING, STABLE) - whether your BUY vs SELL skill imbalance is getting better",
          "improvement": "Boolean indicating if bias is improving (moving toward 0) - true means you're becoming more balanced",
          "recent_bias": "Most recent movement-weighted bias score for master model - current BUY vs SELL skill difference",
          "recent_buy_accuracy": "Recent movement-weighted accuracy specifically for BUY predictions from master model",
          "recent_sell_accuracy": "Recent movement-weighted accuracy specifically for SELL predictions from master model",
          "avg_bias": "Average bias across all windows for master model - overall BUY vs SELL skill imbalance",
          "bias_volatility": "Standard deviation of bias values for master model - how consistently biased you are"
        }
      },
      "image": {
        "trend": "Overall accuracy trend for image analysis model (IMPROVING, DECLINING, STABLE) - indicates if your visual pattern recognition is getting sharper",
        "trend_strength": "Strength of the trend (STRONG, MODERATE, WEAK, INSUFFICIENT_DATA)",
        "momentum": "Numerical momentum indicator for image model - positive values indicate your visual analysis skills are accelerating",
        "recent_accuracy": "Most recent 10% of dataset directional accuracy for image model - how well your latest visual analysis performed",
        "recent_movement_weighted_accuracy": "Most recent 10% of dataset movement-weighted accuracy for image model - your latest skill on significant moves from chart patterns",
        "comparison": {
          "first_half": "Early baseline directional accuracy for image analysis - your initial visual pattern recognition skill",
          "second_half": "Evolved directional accuracy for image analysis - your improved visual pattern recognition",
          "difference": "Improvement in directional accuracy for image analysis - positive means your chart reading is getting better",
          "first_half_movement_weighted": "Early movement-weighted accuracy for image analysis",
          "second_half_movement_weighted": "Evolved movement-weighted accuracy for image analysis",
          "movement_weighted_difference": "Improvement in movement-weighted accuracy for image analysis - positive means you're getting better at spotting significant moves in charts",
          "improvement": "Boolean indicating if your visual analysis performance improved over time"
        },
        "bias_analysis": { "trend": "...", "improvement": "...", "recent_bias": "...", "recent_buy_accuracy": "...", "recent_sell_accuracy": "...", "avg_bias": "...", "bias_volatility": "..." }
      },
      "options": {
        "trend": "Overall accuracy trend for options analysis model (IMPROVING, DECLINING, STABLE) - indicates if your derivatives market analysis is getting more sophisticated",
        "trend_strength": "Strength of the trend (STRONG, MODERATE, WEAK, INSUFFICIENT_DATA)",
        "momentum": "Numerical momentum indicator for options model - positive values indicate your options analysis skills are advancing",
        "recent_accuracy": "Most recent 10% of dataset directional accuracy for options model - how well your latest options flow analysis performed",
        "recent_movement_weighted_accuracy": "Most recent 10% of dataset movement-weighted accuracy for options model - your latest skill on significant moves from options positioning",
        "comparison": {
          "first_half": "Early baseline directional accuracy for options analysis - your initial options flow interpretation skill",
          "second_half": "Evolved directional accuracy for options analysis - your improved options market reading",
          "difference": "Improvement in directional accuracy for options analysis - positive means your options analysis is getting sharper",
          "first_half_movement_weighted": "Early movement-weighted accuracy for options analysis",
          "second_half_movement_weighted": "Evolved movement-weighted accuracy for options analysis",
          "movement_weighted_difference": "Improvement in movement-weighted accuracy for options analysis - positive means you're getting better at reading institutional positioning for big moves",
          "improvement": "Boolean indicating if your options analysis performance improved over time"
        },
        "bias_analysis": { "trend": "...", "improvement": "...", "recent_bias": "...", "recent_buy_accuracy": "...", "recent_sell_accuracy": "...", "avg_bias": "...", "bias_volatility": "..." }
      },
      "vibe": {
        "trend": "Overall accuracy trend for vibe analysis model (IMPROVING, DECLINING, STABLE) - indicates if your narrative and sentiment analysis is getting more insightful",
        "trend_strength": "Strength of the trend (STRONG, MODERATE, WEAK, INSUFFICIENT_DATA)",
        "momentum": "Numerical momentum indicator for vibe model - positive values indicate your sentiment analysis skills are evolving",
        "recent_accuracy": "Most recent 10% of dataset directional accuracy for vibe model - how well your latest narrative analysis performed",
        "recent_movement_weighted_accuracy": "Most recent 10% of dataset movement-weighted accuracy for vibe model - your latest skill on significant moves from sentiment shifts",
        "comparison": {
          "first_half": "Early baseline directional accuracy for vibe analysis - your initial sentiment and narrative interpretation skill",
          "second_half": "Evolved directional accuracy for vibe analysis - your improved market psychology reading",
          "difference": "Improvement in directional accuracy for vibe analysis - positive means your sentiment analysis is getting more accurate",
          "first_half_movement_weighted": "Early movement-weighted accuracy for vibe analysis",
          "second_half_movement_weighted": "Evolved movement-weighted accuracy for vibe analysis", 
          "movement_weighted_difference": "Improvement in movement-weighted accuracy for vibe analysis - positive means you're getting better at reading crowd psychology for big moves",
          "improvement": "Boolean indicating if your sentiment analysis performance improved over time"
        },
        "bias_analysis": { "trend": "...", "improvement": "...", "recent_bias": "...", "recent_buy_accuracy": "...", "recent_sell_accuracy": "...", "avg_bias": "...", "bias_volatility": "..." }
      }
    },
    "daily_log": [
    # highlight-start
    # NOTE: This log is a truncated view of only the most recent predictions (max 14) to provide recent context. 
    # The `performance_summary` block reflects the model's ENTIRE historical performance.
    # highlight-end
      {
        "target_date": "The date for which the prediction was made",
        "prediction_made_at": "The timestamp when the prediction was generated",
        "prediction_timedelta_minutes": "Minutes between prediction and market open. A negative value indicates a 'backcast' where the price was already known, making high accuracy for that timepoint less meaningful.",
        "action": "The recommended action (e.g., HOLD, SELL, BUY)",
        "confidence": { "buy": "...", "hold": "...", "sell": "..." },
        "outcome_correct_direction": "Boolean indicating if the prediction direction was correct",
        "outcome_magnitude": "Classification of the actual return's size, from 'Minimal' to 'Extreme'",
        "outcome_actual_return_percent": "The actual open-to-close percentage return for the target date",
        "outcome_predicted_return_percent": "The open-to-close return percentage predicted by the primary 'master' model"
      }
    ],
    "signal_performance": {
      "by_model_summary": {
        "symbol": {
          "total": "Total signals for THIS SPECIFIC SYMBOL ONLY - smaller sample size, less statistically significant, but may reveal symbol-specific patterns that portfolio averages obscure",
          "correct": "Correct signals for this symbol only",
          "accuracy": "Directional accuracy for this symbol",
          "movement_weighted_accuracy": "Movement-weighted accuracy for this symbol",
          "confidence_weighted_accuracy": "Confidence-weighted accuracy for this symbol",
          "rating": "Performance rating for this symbol"
        },
        "portfolio": {
          "total": "Total signals across ALL PORTFOLIO SYMBOLS - much larger sample size, more statistically reliable, but may mask symbol-specific strengths through averaging",
          "correct": "Correct signals across entire portfolio",
          "accuracy": "Directional accuracy across portfolio",
          "movement_weighted_accuracy": "Movement-weighted accuracy across portfolio",
          "confidence_weighted_accuracy": "Confidence-weighted accuracy across portfolio",
          "rating": "Performance rating across portfolio"
        }
      },
      "by_category": {
        "STRING: Signal Category Name As Key": {
          "symbol": {
            "total": "Symbol-specific total for this signal category - may show unique strengths/weaknesses for this stock",
            "correct": "Symbol-specific correct count",
            "accuracy": "Symbol-specific accuracy",
            "movement_weighted_accuracy": "Symbol-specific movement-weighted accuracy",
            "confidence_weighted_accuracy": "Symbol-specific confidence-weighted accuracy"
          },
          "portfolio": {
            "total": "Portfolio-wide total for this signal category - statistically more reliable baseline",
            "correct": "Portfolio-wide correct count",
            "accuracy": "Portfolio-wide accuracy",
            "movement_weighted_accuracy": "Portfolio-wide movement-weighted accuracy",
            "confidence_weighted_accuracy": "Portfolio-wide confidence-weighted accuracy"
          }
        }
      }
    }
  }
}
```"""

def get_independent_model_prediction_json_structure():
    return """MODEL PREDICTION HISTORY JSON STRUCTURE: This is a reference guide to the individual model's prediction history format. **Do not reproduce this schema in your response.**
```json
{
  "performance_summary": {
    "predictions": "Number of predictions where the model provided valid open and close prices",
    "correct": "Number of times the model correctly predicted the direction of price movement",
    "direction_accuracy": "Directional accuracy of the model's open-to-close predictions",
    "movement_weighted_accuracy": "The primary skill score (0-100). It's heavily weighted by the magnitude of the actual price movement, rewarding correct predictions on large, impactful moves more than predictions on small, insignificant moves.",
    "price_errors": {
      "pre_market": "Average absolute percentage error in pre-market (07:00) price predictions. Must be interpreted with 'prediction_timedelta_minutes' from the 'daily_log'. A low or negative time delta suggests this is a 'backcast' with little predictive value.",
      "market_open": "Average absolute percentage error in market open (09:30) price predictions. Must be interpreted with 'prediction_timedelta_minutes' from the 'daily_log'. A low or negative time delta suggests this is a 'backcast' with little predictive value.",
      "market_close": "Average absolute percentage error in market close (16:00) price predictions. This is often the most reliable price accuracy metric, as the time delta is always significantly positive.",
      "after_hours": "Average absolute percentage error in after-hours (20:00) price predictions."
    },
    "return_accuracy": {
      "avg_error": "Measures skill in predicting the intraday 'gradient' or 'shape' of price movement. It's the average percentage point difference between the predicted open-to-close return and the actual return. A low value indicates the model accurately predicted the magnitude and direction of the day's move, even if absolute price targets were missed.",
      "rating": "Qualitative rating of the return accuracy",
      "bias": "Measures the model's 'skill imbalance' between predicting upward vs. downward price movements. It is calculated as `(error on down days) - (error on up days)`. A value close to 0 indicates balanced skill. A value further from 0 indicates a significant imbalance. A NEGATIVE value means the model has LOWER ERROR on down-trending days (skill is biased towards SELLs). A POSITIVE value means the model has LOWER ERROR on up-trending days (skill is biased towards BUYs).",
      "upward_error": "Average prediction error on days with positive returns",
      "downward_error": "Average prediction error on days with negative returns",
      "count": "Number of predictions included in return accuracy calculation"
    },
    "valid_predictions": "Count of predictions used for accuracy calculations",
    "price_ratings": {
      "pre_market": "Qualitative rating of pre-market price accuracy",
      "market_open": "Qualitative rating of market open price accuracy",
      "market_close": "Qualitative rating of market close price accuracy",
      "after_hours": "Qualitative rating of after-hours price accuracy"
    }
  },
  "trends": {
    "trend": "Overall accuracy trend for THIS SPECIFIC MODEL (IMPROVING, DECLINING, STABLE) - indicates if YOUR specialized analysis approach is getting better over time",
    "trend_strength": "Strength of the trend (STRONG, MODERATE, WEAK, INSUFFICIENT_DATA) - how confident we are that YOUR trend direction is real",
    "momentum": "Numerical momentum indicator showing direction and magnitude of YOUR performance change - positive values indicate YOUR skills are accelerating",
    "recent_accuracy": "Most recent 10% of dataset directional accuracy percentage for YOUR MODEL - your latest performance snapshot (e.g., ~9 days for 90-day dataset)",
    "recent_movement_weighted_accuracy": "Most recent 10% of dataset movement-weighted accuracy for YOUR MODEL - your latest skill score on significant moves that matter most",
    "comparison": {
      "first_half": "Directional accuracy percentage for first half of all YOUR predictions - your early baseline performance when you were learning",
      "second_half": "Directional accuracy percentage for second half of all YOUR predictions - your evolved performance after gaining experience",
      "difference": "Difference between second half and first half directional accuracy for YOUR MODEL - positive means YOU have genuinely improved",
      "first_half_movement_weighted": "Movement-weighted accuracy for first half of YOUR predictions - your early skill on significant moves",
      "second_half_movement_weighted": "Movement-weighted accuracy for second half of YOUR predictions - your evolved skill on significant moves",
      "movement_weighted_difference": "Difference between second half and first half movement-weighted accuracy for YOUR MODEL - positive means significant improvement on the predictions that matter most",
      "improvement": "Boolean indicating if YOUR second half performance improved over first half - true means you are demonstrably getting better"
    },
    "bias_analysis": {
      "trend": "Bias trend for YOUR MODEL (IMPROVING, WORSENING, STABLE) - whether your BUY vs SELL skill imbalance is getting better over time",
      "improvement": "Boolean indicating if YOUR bias is improving (moving toward 0) - true means you're becoming more balanced in your predictions",
      "recent_bias": "Most recent movement-weighted bias score for YOUR MODEL - your current BUY vs SELL skill difference",
      "recent_buy_accuracy": "Recent movement-weighted accuracy specifically for YOUR BUY predictions - how well you're doing on bullish calls lately",
      "recent_sell_accuracy": "Recent movement-weighted accuracy specifically for YOUR SELL predictions - how well you're doing on bearish calls lately",
      "avg_bias": "Average bias across all windows for YOUR MODEL - your overall BUY vs SELL skill imbalance throughout your entire history",
      "bias_volatility": "Standard deviation of bias values for YOUR MODEL - how consistently biased you are (lower is more stable)"
    }
  },
  "daily_log": [
    {
      "target_date": "The date for which the prediction was made",
      "prediction_made_at": "The timestamp when the prediction was generated",
      "prediction_timedelta_minutes": "Minutes between prediction and market open. A negative value indicates a 'backcast' where the price was already known, making high accuracy for that timepoint less meaningful.",
      "action": "The recommended action from the master model (BUY, SELL, or HOLD)",
      "confidence": {
        "buy": "Model's confidence score for a BUY action",
        "hold": "Model's confidence score for a HOLD action",
        "sell": "Model's confidence score for a SELL action"
      },
      "outcome_correct_direction": "Boolean indicating if the master model's action was directionally correct",
      "outcome_magnitude": "Classification of the actual return's size, from 'Minimal' to 'Extreme'",
      "outcome_actual_return_percent": "The actual open-to-close percentage return for the target date",
      "outcome_predicted_return_percent": "The open-to-close return percentage predicted by YOUR SPECIFIC MODEL"
    }
  ],
  "signal_performance": {
    "by_model_summary": {
      "symbol": {
        "total": "Total signals for THIS SPECIFIC SYMBOL ONLY - smaller sample size, less statistically significant, but may reveal symbol-specific patterns",
        "correct": "Correct signals for this symbol only",
        "accuracy": "Directional accuracy for this symbol",
        "movement_weighted_accuracy": "Movement-weighted accuracy for this symbol",
        "confidence_weighted_accuracy": "Confidence-weighted accuracy for this symbol",
        "rating": "Performance rating for this symbol"
      },
      "portfolio": {
        "total": "Total signals across ALL PORTFOLIO SYMBOLS - much larger sample size, more statistically reliable baseline",
        "correct": "Correct signals across entire portfolio",
        "accuracy": "Directional accuracy across portfolio",
        "movement_weighted_accuracy": "Movement-weighted accuracy across portfolio",
        "confidence_weighted_accuracy": "Confidence-weighted accuracy across portfolio",
        "rating": "Performance rating across portfolio"
      }
    },
    "by_category": {
      "STRING: Signal Category Name As Key": {
        "symbol": {
          "total": "Symbol-specific total - may reveal unique patterns for this stock",
          "correct": "Symbol-specific correct count",
          "accuracy": "Symbol-specific accuracy",
          "movement_weighted_accuracy": "Symbol-specific movement-weighted accuracy",
          "confidence_weighted_accuracy": "Symbol-specific confidence-weighted accuracy"
        },
        "portfolio": {
          "total": "Portfolio-wide total - statistically more reliable",
          "correct": "Portfolio-wide correct count",
          "accuracy": "Portfolio-wide accuracy",
          "movement_weighted_accuracy": "Portfolio-wide movement-weighted accuracy",
          "confidence_weighted_accuracy": "Portfolio-wide confidence-weighted accuracy"
        }
      }
    }
  }
}
```"""

def get_portfolio_json_structure():
    return """PORTFOLIO ANALYSIS JSON STRUCTURE: This is a reference guide to the portfolio recommendation format. **Do not reproduce this schema in your response.**
```json
{
  "stockAnalysis": {
    "stocks": [
      {
        "symbol": "Stock ticker symbol (e.g., 'AAPL')",
        "companyName": "Full legal company name",
        "sector": "The company's industry sector (e.g., 'Technology')",
        "action": "Your final recommendation: 'BUY', 'HOLD', or 'SELL'",
        "confidence": {
          "buy": "Your calculated confidence score for a BUY action (0.0 to 1.0)",
          "hold": "Your calculated confidence score for a HOLD action (0.0 to 1.0)",
          "sell": "Your calculated confidence score for a SELL action (0.0 to 1.0)",
          "reasoning": "Brief explanation if confidence levels were revised from the original input"
        },
        "freshness": "fresh/recent/aged/outdated",
        "volatility": "high/medium/low",
        "projectedReturn": 0.055,
        "category": "TOP_OPPORTUNITY/WATCHLIST/AVOID",
        "allocation": XX,
        "factors": ["Factor 1", "Factor 2", "Factor 3"],
        "reason": "Detailed explanation for the recommendation",
        "realtime_accuracy": {
          "hourly_comparison": [
            {
              "hour": "Hour of prediction",
              "predicted": "Predicted price",
              "actual": "Actual price",
              "deviation": "Prediction error ratio",
              "deviation_pct": "Prediction error percentage",
              "is_forward_prediction": "Boolean indicating if prediction was made before the predicted time (true prediction vs backcast)"
            }
          ],
          "average_deviation": "Mean percentage difference between predicted and actual prices",
          "accuracy_score": "Overall accuracy score (1 - average_deviation)",
          "return_accuracy": {
            "predicted_return": "Predicted return from open to close",
            "actual_return": "Actual return from open to close",
            "direction_correct": "Boolean indicating if prediction correctly anticipated market direction",
            "return_difference": "Absolute difference between predicted and actual returns"
          }
        },
        "revised_predictions": {
          "nextTradingDay": {
            "hourlyPrices": [
              {"hour": "04:00", "price": XX.XX, "volatility_range": X.X, "session": "pre-market"},
              {"hour": "05:00", "price": XX.XX, "volatility_range": X.X, "session": "pre-market"},
              {"hour": "06:00", "price": XX.XX, "volatility_range": X.X, "session": "pre-market"},
              {"hour": "07:00", "price": XX.XX, "volatility_range": X.X, "session": "pre-market"},
              {"hour": "08:00", "price": XX.XX, "volatility_range": X.X, "session": "pre-market"},
              {"hour": "09:00", "price": XX.XX, "volatility_range": X.X, "session": "pre-market"},
              {"hour": "09:30", "price": XX.XX, "volatility_range": X.X, "session": "market open"},
              {"hour": "10:00", "price": XX.XX, "volatility_range": X.X, "session": "regular"},
              {"hour": "11:00", "price": XX.XX, "volatility_range": X.X, "session": "regular"},
              {"hour": "12:00", "price": XX.XX, "volatility_range": X.X, "session": "regular"},
              {"hour": "13:00", "price": XX.XX, "volatility_range": X.X, "session": "regular"},
              {"hour": "14:00", "price": XX.XX, "volatility_range": X.X, "session": "regular"},
              {"hour": "15:00", "price": XX.XX, "volatility_range": X.X, "session": "regular"},
              {"hour": "16:00", "price": XX.XX, "volatility_range": X.X, "session": "market close"},
              {"hour": "17:00", "price": XX.XX, "volatility_range": X.X, "session": "after-hours"},
              {"hour": "18:00", "price": XX.XX, "volatility_range": X.X, "session": "after-hours"},
              {"hour": "19:00", "price": XX.XX, "volatility_range": X.X, "session": "after-hours"},
              {"hour": "20:00", "price": XX.XX, "volatility_range": X.X, "session": "after-hours"}
            ],
            "marketOpen": XX.XX,
            "marketClose": XX.XX,
            "reasoning": "Brief explanation of how the revised prediction differs from original"
          }
        }
      }
    ]
  },
  "marketOutlook": "Brief paragraph on overall market sentiment",
  "sectorCorrelations": {
    "Technology": X.XX,
    "Finance": X.XX
  },
  "portfolioAllocation": {
    "SYMBOL1": XX,
    "SYMBOL2": XX,
    "cash": XX
  },
  "alternativeInvestments": [
    {
      "sector": "SECTOR NAME",
      "description": "Brief explanation of why this sector offers protection",
      "stocks": [
        {
          "symbol": "XXX",
          "company": "Company name",
          "details": "Why this specific stock is recommended",
          "projectedReturn": X.XX
        }
      ]
    }
  ],
  "strategy": "Your recommended daily investment strategy and key actions to take.",
  "riskAssessment": "A summary of the primary risks associated with your recommendations."
}
```"""

def get_historical_json_structure():
    return """HISTORICAL PERFORMANCE JSON STRUCTURE: This is a reference guide to the historical analysis data format. **Do not reproduce this schema in your response.**
```json
{
  "accuracy_metrics": {
    "directional": {
      "total": "Total number of directional predictions made",
      "correct": "Number of directionally correct predictions",
      "accuracy": "Percentage of directionally correct predictions"
    },
    "price": {
      "pre_market": {
        "avg_diff": "Average percentage error in pre-market price predictions",
        "rating": "Rating for pre-market price accuracy (Excellent, Good, Fair, Poor, Missed)"
      },
      "market_open": {
        "avg_diff": "Average percentage error in market open price predictions",
        "rating": "Rating for market open price accuracy (Excellent, Good, Fair, Poor, Missed)"
      },
      "market_close": {
        "avg_diff": "Average percentage error in market close price predictions",
        "rating": "Rating for market close price accuracy (Excellent, Good, Fair, Poor, Missed)"
      },
      "after_hours": {
        "avg_diff": "Average percentage error in after-hours price predictions",
        "rating": "Rating for after-hours price accuracy (Excellent, Good, Fair, Poor, Missed)"
      }
    },
    "action_breakdown": {
      "BUY": {
        "total": "Number of BUY recommendations made",
        "correct": "Number of correct BUY recommendations",
        "accuracy": "Percentage accuracy of BUY recommendations"
      },
      "SELL": {
        "total": "Number of SELL recommendations made",
        "correct": "Number of correct SELL recommendations",
        "accuracy": "Percentage accuracy of SELL recommendations"
      },
      "HOLD": {
        "total": "Number of HOLD recommendations made",
        "correct": "Number of correct HOLD recommendations",
        "accuracy": "Percentage accuracy of HOLD recommendations"
      }
    }
  },
  "model_comparison": {
    "master": {
      "predictions": "Number of predictions made by master model",
      "correct": "Number of directionally correct predictions by master model",
      "direction_accuracy": "Percentage directional accuracy for master model",
      "avg_percent_diff": "Average percentage error in price predictions",
      "valid_predictions": "Number of valid price predictions made",
      "rating": "Overall accuracy rating (Excellent, Good, Fair, Poor, Missed)"
    },
    "image": {
      "predictions": "Number of predictions made by image analysis model",
      "correct": "Number of directionally correct predictions by image model",
      "direction_accuracy": "Percentage directional accuracy for image model",
      "avg_percent_diff": "Average percentage error in price predictions",
      "valid_predictions": "Number of valid price predictions made",
      "rating": "Overall accuracy rating (Excellent, Good, Fair, Poor, Missed)"
    },
    "options": {
      "predictions": "Number of predictions made by options analysis model",
      "correct": "Number of directionally correct predictions by options model",
      "direction_accuracy": "Percentage directional accuracy for options model",
      "avg_percent_diff": "Average percentage error in price predictions",
      "valid_predictions": "Number of valid price predictions made",
      "rating": "Overall accuracy rating (Excellent, Good, Fair, Poor, Missed)"
    }
  },
  "trends": {
    "trend": "Overall accuracy trend (IMPROVING, DECLINING, STABLE)",
    "trend_strength": "Strength of the trend (STRONG, MODERATE, WEAK, INSUFFICIENT_DATA)",
    "momentum": "Numerical momentum indicator showing direction and magnitude of change",
    "recent_accuracy": "Most recent rolling window accuracy percentage",
    "comparison": {
      "first_half": "Accuracy percentage for first half of all predictions",
      "second_half": "Accuracy percentage for second half of all predictions",
      "difference": "Difference between second half and first half accuracy",
      "improvement": "Boolean indicating if second half performance improved"
    },
    "rolling_summary": {
      "total_windows": "Total number of rolling accuracy windows analyzed",
      "first_accuracy": "First window accuracy percentage",
      "last_accuracy": "Last window accuracy percentage",
      "trend_direction": "Overall trend direction (improving/declining/stable)"
    }
  },
  "confidence_correlation": {
    "calibration_summary": {
      "BUY": "Correlation coefficient between confidence scores and accuracy for BUY recommendations",
      "SELL": "Correlation coefficient between confidence scores and accuracy for SELL recommendations",
      "HOLD": "Correlation coefficient between confidence scores and accuracy for HOLD recommendations"
    },
    "data_summary": {
      "BUY": {
        "total_predictions": "Total BUY predictions made",
        "correct_predictions": "Number of correct BUY predictions",
        "overall_accuracy": "Overall BUY accuracy percentage",
        "confidence_range": {
          "min": "Minimum confidence score for BUY recommendations",
          "max": "Maximum confidence score for BUY recommendations",
          "avg": "Average confidence score for BUY recommendations"
        }
      },
      "SELL": {
        "total_predictions": "Total SELL predictions made",
        "correct_predictions": "Number of correct SELL predictions",
        "overall_accuracy": "Overall SELL accuracy percentage",
        "confidence_range": {
          "min": "Minimum confidence score for SELL recommendations",
          "max": "Maximum confidence score for SELL recommendations",
          "avg": "Average confidence score for SELL recommendations"
        }
      },
      "HOLD": {
        "total_predictions": "Total HOLD predictions made",
        "correct_predictions": "Number of correct HOLD predictions",
        "overall_accuracy": "Overall HOLD accuracy percentage",
        "confidence_range": {
          "min": "Minimum confidence score for HOLD recommendations",
          "max": "Maximum confidence score for HOLD recommendations",
          "avg": "Average confidence score for HOLD recommendations"
        }
      }
    },
    "total_predictions": "Total number of predictions analyzed for confidence correlation",
    "actions_analyzed": "Array of action types that had sufficient data for confidence analysis",
    "calibration_overview": {
      "BUY": {
        "quartile_count": "Number of quartiles analyzed for BUY recommendations",
        "accuracy_range": "Array showing accuracy range across quartiles",
        "total_predictions": "Total BUY predictions in calibration analysis"
      },
      "SELL": {
        "quartile_count": "Number of quartiles analyzed for SELL recommendations",
        "accuracy_range": "Array showing accuracy range across quartiles",
        "total_predictions": "Total SELL predictions in calibration analysis"
      }
    }
  },
  "high_impact_metrics": {
    "impact_weighted_accuracy": "Accuracy percentage weighted by the magnitude of price movements",
    "value_capture_rate": "Percentage of total price movement value captured by correct predictions",
    "high_impact_wins": "Number of correct predictions on high-impact (large movement) days",
    "missed_opportunities": "Number of incorrect predictions on high-impact days",
    "top_wins": [
      {
        "date": "ISO date of the prediction",
        "symbol": "Stock symbol",
        "action": "Recommended action (BUY/SELL/HOLD)",
        "movement": "Actual price movement percentage (positive=up, negative=down)",
        "abs_movement": "Absolute value of price movement percentage",
        "is_correct": "Boolean indicating if prediction was directionally correct",
        "magnitude_tier": "Movement magnitude category (Minimal, Low, Moderate, Significant, Extreme)",
        "impact_level": "Numerical impact level (0-6, higher = more significant)"
      }
    ],
    "worst_misses": [
      {
        "date": "ISO date of the missed prediction",
        "symbol": "Stock symbol",
        "action": "Recommended action that was incorrect",
        "movement": "Actual price movement percentage",
        "abs_movement": "Absolute value of price movement percentage",
        "is_correct": "Boolean (always false for missed opportunities)",
        "magnitude_tier": "Movement magnitude category",
        "impact_level": "Numerical impact level"
      }
    ],
    "overall_rating": "Overall rating for high-impact prediction performance (Excellent, Good, Fair, Poor, Needs Improvement)"
  },
  "big_move_detection": {
    "big_move_detection_rate": "Percentage of big moves (>2.5%) that were predicted with active recommendations",
    "big_move_accuracy": "Percentage of big moves that were predicted correctly (directionally)",
    "false_alarm_rate": "Percentage of active recommendations that were incorrect or on small moves",
    "precision_rate": "Percentage of active recommendations that correctly identified big moves",
    "major_move_detection_rate": "Percentage of major moves (>4.0%) that were detected",
    "total_big_moves": "Total number of big moves (>2.5%) that occurred",
    "total_major_moves": "Total number of major moves (>4.0%) that occurred",
    "predicted_moves": "Total number of active (non-HOLD) recommendations made",
    "detection_quality": "Overall quality rating for big move detection (Excellent, Good, Fair, Poor, Needs Improvement)",
    "move_distribution": {
      "big_moves_percentage": "Percentage of all trading days that had big moves",
      "major_moves_percentage": "Percentage of all trading days that had major moves"
    }
  },
  "magnitude_analysis": {
    "by_magnitude": {
      "Noise": {
        "total_predictions": "Number of predictions for noise-level movements",
        "correct_predictions": "Number of correct predictions for noise movements",
        "accuracy": "Accuracy percentage for noise movements",
        "avg_movement": "Average movement percentage for this category",
        "percentage_of_total": "Percentage of total predictions in this category"
      },
      "Minor": {
        "total_predictions": "Number of predictions for minor movements",
        "correct_predictions": "Number of correct predictions for minor movements",
        "accuracy": "Accuracy percentage for minor movements",
        "avg_movement": "Average movement percentage for this category",
        "percentage_of_total": "Percentage of total predictions in this category"
      },
      "Small": {
        "total_predictions": "Number of predictions for small movements",
        "correct_predictions": "Number of correct predictions for small movements",
        "accuracy": "Accuracy percentage for small movements",
        "avg_movement": "Average movement percentage for this category",
        "percentage_of_total": "Percentage of total predictions in this category"
      },
      "Moderate": {
        "total_predictions": "Number of predictions for moderate movements",
        "correct_predictions": "Number of correct predictions for moderate movements",
        "accuracy": "Accuracy percentage for moderate movements",
        "avg_movement": "Average movement percentage for this category",
        "percentage_of_total": "Percentage of total predictions in this category"
      },
      "Large": {
        "total_predictions": "Number of predictions for large movements",
        "correct_predictions": "Number of correct predictions for large movements",
        "accuracy": "Accuracy percentage for large movements",
        "avg_movement": "Average movement percentage for this category",
        "percentage_of_total": "Percentage of total predictions in this category"
      },
      "Major": {
        "total_predictions": "Number of predictions for major movements",
        "correct_predictions": "Number of correct predictions for major movements",
        "accuracy": "Accuracy percentage for major movements",
        "avg_movement": "Average movement percentage for this category",
        "percentage_of_total": "Percentage of total predictions in this category"
      },
      "Extreme": {
        "total_predictions": "Number of predictions for extreme movements",
        "correct_predictions": "Number of correct predictions for extreme movements",
        "accuracy": "Accuracy percentage for extreme movements",
        "avg_movement": "Average movement percentage for this category",
        "percentage_of_total": "Percentage of total predictions in this category"
      }
    },
    "significant_moves_summary": {
      "total_significant": "Total number of significant moves (Large, Major, or Extreme)",
      "correct_significant": "Number of significant moves predicted correctly",
      "significant_accuracy": "Percentage accuracy on significant moves",
      "percentage_significant": "Percentage of all predictions that were on significant move days"
    },
    "impact_distribution": {
      "Noise": "Percentage distribution of noise-level movements",
      "Minor": "Percentage distribution of minor movements",
      "Small": "Percentage distribution of small movements",
      "Moderate": "Percentage distribution of moderate movements",
      "Large": "Percentage distribution of large movements",
      "Major": "Percentage distribution of major movements",
      "Extreme": "Percentage distribution of extreme movements"
    }
  },
  "portfolio_metrics": {
    "initial_investment": "Starting portfolio value used for simulation",
    "investment_per_symbol": "Amount invested per symbol",
    "num_symbols": "Number of symbols in portfolio analysis",
    "final_values": {
      "strategy": "Final portfolio value following the recommendation strategy",
      "buy_hold": "Final portfolio value from buy-and-hold strategy",
      "perfect": "Final portfolio value from perfect timing strategy",
      "worst": "Final portfolio value from worst timing strategy",
      "random": "Final portfolio value from random trading strategy"
    },
    "returns": {
      "strategy": "Total return percentage from following all recommendations",
      "buy_hold": "Total return percentage from simple buy-and-hold strategy",
      "perfect": "Total return percentage from perfect timing (theoretical maximum)",
      "worst": "Total return percentage from worst possible timing (theoretical minimum)",
      "random": "Total return percentage from random trading strategy",
      "outperformance": "Strategy return minus buy-hold return percentage",
      "vs_random": "Strategy return minus random strategy return percentage",
      "max_potential": "Perfect strategy return minus actual strategy return (missed potential)",
      "avoided_loss": "Strategy return minus worst strategy return (loss avoidance)"
    },
    "trades": {
      "total": "Total number of trading decisions made",
      "correct": "Number of directionally correct trading decisions",
      "winning": "Number of profitable trades",
      "losing": "Number of losing trades",
      "accuracy": "Percentage of directionally correct trades",
      "win_rate": "Percentage of profitable trades",
      "avg_win": "Average percentage gain on winning trades",
      "avg_loss": "Average percentage loss on losing trades",
      "profit_factor": "Ratio of total gains to total losses"
    },
    "symbol_performances": {
      "SYMBOL": {
        "investment": "Amount invested in this symbol",
        "strategy_value": "Final value using trading strategy",
        "buy_hold_value": "Final value using buy-and-hold",
        "perfect_value": "Final value using perfect timing",
        "worst_value": "Final value using worst timing",
        "random_value": "Final value using random strategy",
        "strategy_return": "Return percentage using trading strategy",
        "buy_hold_return": "Return percentage using buy-and-hold",
        "trades": {
          "total": "Number of trades for this symbol",
          "correct": "Number of correct directional predictions",
          "winning": "Number of profitable trades",
          "losing": "Number of losing trades",
          "winning_amount": "Total profit from winning trades",
          "losing_amount": "Total loss from losing trades"
        },
        "first_price": "Starting price for analysis period",
        "last_price": "Ending price for analysis period",
        "final_position": "Final position (Long/Cash)"
      }
    },
    "history_summary": {
      "total_trades": "Total number of trades across all symbols",
      "trading_days": "Number of trading days analyzed"
    }
  },
  "weekly_performance": {
    "Monday": {
      "total": "Total predictions made on Mondays",
      "correct": "Correct predictions made on Mondays",
      "accuracy": "Monday accuracy percentage",
      "avg_diff": "Average prediction error on Mondays",
      "rating": "Monday performance rating"
    },
    "Tuesday": {
      "total": "Total predictions made on Tuesdays",
      "correct": "Correct predictions made on Tuesdays",
      "accuracy": "Tuesday accuracy percentage",
      "avg_diff": "Average prediction error on Tuesdays",
      "rating": "Tuesday performance rating"
    },
    "Wednesday": {
      "total": "Total predictions made on Wednesdays",
      "correct": "Correct predictions made on Wednesdays",
      "accuracy": "Wednesday accuracy percentage",
      "avg_diff": "Average prediction error on Wednesdays",
      "rating": "Wednesday performance rating"
    },
    "Thursday": {
      "total": "Total predictions made on Thursdays",
      "correct": "Correct predictions made on Thursdays",
      "accuracy": "Thursday accuracy percentage",
      "avg_diff": "Average prediction error on Thursdays",
      "rating": "Thursday performance rating"
    },
    "Friday": {
      "total": "Total predictions made on Fridays",
      "correct": "Correct predictions made on Fridays",
      "accuracy": "Friday accuracy percentage",
      "avg_diff": "Average prediction error on Fridays",
      "rating": "Friday performance rating"
    }
  },
  "portfolio_specific": {
    "symbols_analyzed": "Number of symbols in portfolio analysis",
    "symbol_accuracies": {
      "SYMBOL": {
        "accuracy": "Accuracy percentage for this symbol",
        "correct": "Number of correct predictions for this symbol",
        "total": "Total predictions for this symbol"
      }
    },
    "best_performer": "Array with symbol and performance metrics for best performing symbol",
    "worst_performer": "Array with symbol and performance metrics for worst performing symbol",
    "consistency": {
      "accuracy_std": "Standard deviation of accuracy across symbols",
      "accuracy_mean": "Mean accuracy across all symbols",
      "coefficient_of_variation": "Coefficient of variation for accuracy consistency"
    },
    "weekly_portfolio_performance": {
      "YYYY-WXX": {
        "accuracy": "Portfolio accuracy for this week",
        "correct": "Correct predictions for this week",
        "total": "Total predictions for this week",
        "symbols": "Number of symbols analyzed this week"
      }
    },
    "coverage": {
      "total_predictions": "Total predictions across all symbols",
      "avg_predictions_per_symbol": "Average number of predictions per symbol"
    }
  },
  "symbol_performance": {
    "total_symbols": "Total number of symbols analyzed",
    "top_performers": [
      {
        "symbol": "Stock symbol",
        "directional_accuracy": "Directional prediction accuracy percentage",
        "correct_predictions": "Number of correct predictions",
        "total_predictions": "Total predictions made",
        "avg_price_error": "Average price prediction error percentage",
        "confidence_correlation": "Correlation between confidence and accuracy",
        "prediction_frequency": "Number of predictions made for this symbol",
        "rank": "Performance rank among all symbols",
        "tier": "Performance tier (Excellent/Good/Average/Poor/Terrible)"
      }
    ],
    "bottom_performers": [
      {
        "symbol": "Stock symbol",
        "directional_accuracy": "Directional prediction accuracy percentage",
        "correct_predictions": "Number of correct predictions",
        "total_predictions": "Total predictions made",
        "avg_price_error": "Average price prediction error percentage",
        "confidence_correlation": "Correlation between confidence and accuracy",
        "prediction_frequency": "Number of predictions made for this symbol",
        "rank": "Performance rank among all symbols",
        "tier": "Performance tier (Excellent/Good/Average/Poor/Terrible)"
      }
    ],
    "performance_stats": {
      "best_accuracy": "Highest symbol accuracy percentage",
      "worst_accuracy": "Lowest symbol accuracy percentage",
      "average_accuracy": "Average accuracy across all symbols"
    }
  },
  "metadata": {
    "processed_count": "Number of historical recommendations successfully processed for analysis",
    "total_count": "Total number of historical recommendations found",
    "symbols_count": "Number of unique symbols analyzed",
    "symbols": "Array of symbols included in the analysis",
    "mode": "Analysis mode (single_symbol or portfolio)"
  }
}
```"""