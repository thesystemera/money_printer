# Market Wizard - Technical Deep Dive

A comprehensive overview of the sophisticated engineering, advanced algorithms, and innovative architecture powering Market Wizard.

---

## Codebase Statistics

| Metric | Value |
|--------|-------|
| **Total Lines of Code** | 53,431 |
| **Python Backend (server/)** | 23,858 lines |
| **React Frontend (client/src/)** | 29,573 lines |
| **Backend Services** | 28 Python modules |
| **React Components** | 44 components |
| **Largest Single Service** | 4,759 lines (Options Analytics) |
| **AI Prompt Engineering** | 2,946 lines across 2 files |
| **Embedded JavaScript in Python** | 939 lines |
| **Signal Processing Rules** | 40+ individually weighted metrics |
| **Visual Intelligence Parameters** | 859 lines of chart interpretation logic |

### Top Backend Services by Size
1. `recommendation_options_service.py` - 4,759 lines (Options chain analysis, Greeks, flow classification)
2. `prediction_accuracy_service.py` - 2,363 lines (Feedback loop, signal extraction, self-calibration)
3. `recommendation_prompts_json_structures.py` - 1,602 lines (AI output schemas)
4. `recommendation_prompts.py` - 1,344 lines (Expert system prompts, 859 lines Image Analyst)
5. `advanced_options_analysis_service.py` - 1,297 lines (JS-in-Python compute engine)
6. `article_workflow_service.py` - 1,225 lines (Orchestration, progress tracking)
7. `cache_service.py` - 1,154 lines (Dual-layer caching with worker pools)
8. `ai_service.py` - 1,019 lines (Multi-provider AI orchestration)

### Top Frontend Components by Size
1. `RecommendationPredictionAccuracy.js` - 1,736 lines (Learning visualization)
2. `DashboardContent.js` - 1,361 lines
3. `PortfolioPanel.js` - 1,263 lines
4. `SentimentDataProcessor.js` - 1,248 lines
5. `RecommendationPredictionChart.js` - 1,236 lines
6. `SentimentTuner.js` - 1,147 lines (FFT signal processing)

---

## Executive Summary

Market Wizard is a **self-learning AI-powered quantitative trading intelligence platform** combining:
- **Multi-AI orchestration** across 3 providers (Claude, GPT, Gemini) with 4 specialist expert agents
- **Visual intelligence layer** interpreting sentiment momentum through computer vision on financial charts
- **Physics-based sentiment modeling** treating market sentiment as signal propagation with attack/decay dynamics
- **Real-time signal processing** using Fast Fourier Transforms (FFT) for cross-correlation analysis
- **Self-calibrating prediction engine** with adaptive learning from 40+ individually weighted metrics
- **Quantitative options analytics** with Black-Scholes Greeks and institutional flow classification
- **Hybrid caching architecture** with Redis + file-based fallback
- **JavaScript-in-Python compute engine** for 10x faster parameter optimization

---

## 1. Multi-AI Orchestration System

### Architecture
- **Tri-Provider System**: Seamlessly routes requests to Claude (Anthropic), GPT (OpenAI), or Gemini (Google) based on model name prefixes
- **Unified Interface**: Single API supporting different model capabilities (thinking budget, temperature, reasoning effort)
- **Streaming with Thinking Extraction**: Real-time streaming that separates cognitive "thinking" from final output for transparency

### Concurrency & Reliability
- **50 concurrent API calls** managed via asyncio Semaphore
- **Exponential backoff** up to 60 seconds on failures
- **Provider-agnostic caching** for response reuse across models
- **Debug persistence**: All requests/responses/thinking/images saved to disk for analysis

### Four Specialist AI Agents
The recommendation system employs **role-based expert agents with distinct analytical methodologies**:

| Agent | Expertise | Focus | Learning Integration |
|-------|-----------|-------|---------------------|
| **Master Analyst** | Multi-dimensional synthesis | Comprehensive daily recommendations | Incorporates all specialist outputs with historical performance weighting |
| **Image Analyst** | Visual chart interpretation | Temporal sentiment patterns, momentum physics | Decodes velocity/acceleration from visualized sentiment signals |
| **Options Analyst** | Derivatives market analysis | Institutional flow, gamma exposure, positioning | Correlates options positioning with price prediction accuracy |
| **Vibe Analyst** | Public discourse analysis | Narrative momentum, social sentiment | Tracks narrative velocity and viral content impact |

Each specialist operates with unique **1,000+ word system prompts** defining expertise, methodology, and output formats, then feeds into a master synthesis layer. **Crucially, each agent receives its own prediction history and performance metrics, enabling self-calibration.**

---

## 2. Visual Intelligence Layer

### Overview
The Image Analyst represents a sophisticated **computer vision approach to financial time series analysis**. Rather than processing raw numerical data, this agent interprets rendered sentiment visualizations as a human technical analyst would—detecting patterns, momentum shifts, and divergence signals from chart imagery.

### Visual Elements Architecture

**Sentiment Signal Decomposition:**
- **YELLOW LINE** = Master Temporal Impact (adaptively-weighted synthesis of all sentiment sources)
- **BLUE LINE** = Stock Temporal Impact (company-specific sentiment momentum)
- **GREEN LINE** = Industry Temporal Impact (sector-level sentiment momentum)
- **PINK/MAGENTA LINE** = Market Temporal Impact (broader market sentiment momentum)
- **MULTI-COLORED DOTS/LINE** = Tuned Hybrid Signal (rolling average with trend and energy normalization)

**Derivative Signals (Calculated from Temporal Impact):**
- **THIN COLORED LINES** = Sentiment Velocity (rate of change, first derivative)
- **SHADED AREAS** = Sentiment Acceleration (force of change, second derivative)

**Price and Context Overlay:**
- **WHITE LINE** = Stock Price (actual price movements)
- **GREY LINE** = Market Index (correlation reference)
- **YELLOW BARS** = Trading volume
- **LIGHT BLUE/PINK/GREEN BARS** = Article count by source category
- **GREEN/RED BACKGROUND** = Market session indicators

### Critical Analysis Methodology

**Momentum Physics Interpretation:**
The Image Analyst prioritizes **momentum changes, acceleration patterns, and directional shifts** over absolute values. The most significant predictive signals emerge from:

1. **Zero-Crossing Detection**: When velocity lines cross zero, indicating sentiment momentum inflection points
2. **Acceleration Extrema**: Shaded regions showing maximum sentiment force (building or fading)
3. **Convergence/Divergence Patterns**: When component signals (Stock/Market/Industry) align or conflict
4. **Lead/Lag Analysis**: Temporal relationships between sentiment shifts and price movements

**Terminology Precision:**
- **Lead Relationships**: "predictive lead," "advance signal," "preceded by X hours"
- **Lag Relationships**: "materialized after X hours," "followed with X hour delay"
- **Directional Language**: Explicit terms avoiding confirmation bias

### Four-Chart Analysis Framework

**1. Master Temporal Impact (Tuned)**
- Single most important predictive signal (Yellow Line)
- Auto-tuned blend of three underlying components using optimized weights
- Displays overall correlation percentage and predictive lead time
- Foundation for all other visual interpretations

**2. Component Temporal Impacts (Tuned)**
- Decomposition into Stock (Blue), Market (Pink), and Industry (Green)
- Identifies which narrative is driving the trend
- Individual lead times and correlations for each component
- **Divergence Detection**: When components move apart, signals uncertainty or conflicting narratives

**3. All Signal Dynamics (Velocity & Acceleration)**
- Derivative view showing momentum (thin lines) and force (shaded areas)
- Highly predictive for identifying trend shifts before they appear in price
- **Inflection Point Detection**: Zero-crossings on velocity lines predict momentum changes
- **Conviction Analysis**: Large acceleration areas indicate strong sentiment force

**4. Tuned Hybrid Signal**
- Complementary responsive signal using rolling average + trend-following + energy normalization
- Multi-colored line indicates dominant sentiment source via color mixing
- Confirms or contradicts smoother Temporal Impact signals
- Early warning system for trend reversals

### Predictive Pattern Recognition

The Image Analyst performs **historical pattern backtesting** on visualizations:
- Identifies reliable bullish/bearish signal patterns
- Tally of high-confidence predictive patterns vs. failures
- Assessment of pattern reliability for the specific stock
- Integration with quantitative JSON performance metrics

---

## 3. Physics-Based Sentiment Modeling

### Signal Propagation Physics
Market Wizard treats sentiment not as discrete events but as **continuous signal propagation through market time**, modeled using concepts from physics:

### Attack-Decay Dynamics

Each news article generates a sentiment "impulse" with characteristic temporal dynamics:

**Attack Phase (Initial Impact):**
- Rapid sentiment accumulation following article publication
- Velocity peaks as the narrative spreads
- Duration: Typically 1-6 hours for high-impact news
- Modeled using exponential rise functions

**Decay Phase (Impact Duration):**
- Gradual sentiment dissipation as novelty fades
- Exponential decay with stock-specific time constants
- Long-tail effects from article propagation through social media
- Integration with subsequent articles creating compound signals

**Impact Score Calculation:**
```
Temporal_Impact(t) = Σ [Impact_Score_i × Attack_Function(t - t_i) × Decay_Function(t - t_i)]
```

Where:
- `Impact_Score_i` = Article relevance × sentiment intensity × source credibility
- `Attack_Function` = Logistic or exponential rise curve
- `Decay_Function` = Exponential decay with configurable half-life

### Propagation Speed Modeling

**Three-Tier Propagation Architecture:**

| Tier | Scope | Propagation Speed | Decay Half-Life |
|------|-------|-------------------|-----------------|
| **Stock-Specific** | Individual company | Fastest (hours) | 6-12 hours |
| **Industry** | Sector-wide | Medium (days) | 24-48 hours |
| **Market-Wide** | Broad market conditions | Slowest (days-weeks) | 48-72 hours |

**Propagation Speed Factors:**
- **Viral Coefficient**: Social media share velocity
- **Institutional Response Time**: How quickly institutional investors react
- **News Cycle Overlap**: Competing stories accelerating or dampening propagation
- **Market Hours Effect**: Different propagation during trading vs. off-hours

### Impact Duration & Temporal Orientation

**Temporal Orientation Classification:**
- **Immediate** (0-4 hours): Breaking news, earnings surprises
- **Session** (4-8 hours): Day-trading catalysts, intraday developments
- **Short-term** (1-3 days): Analyst upgrades, product announcements
- **Medium-term** (1-2 weeks): Strategic initiatives, competitive moves
- **Long-term** (1+ months): Regulatory changes, macro shifts

**Impact Duration Scoring:**
Each article receives an impact duration score (1-5) based on:
- Source authority (Tier 1 financial news vs. social media)
- Content significance (earnings vs. routine announcements)
- Market conditions (high volatility extends impact)
- Competitive landscape (unique vs. crowded news space)

### Adaptive Weighting by Temporal Correlation

The system continuously optimizes sentiment blend weights using **FFT-based cross-correlation**:

1. **Frequency Domain Transformation**: Sentiment and price time series converted via FFT
2. **Cross-Correlation Analysis**: Complex conjugate multiplication reveals lead/lag relationships
3. **Optimal Lag Detection**: Maximum correlation point identifies predictive time offset
4. **Weight Optimization**: Grid search over 441 weight combinations (21×21 matrix)

**Tuning Parameters:**
- **Lag Search Range**: 0.5 to 18 hours
- **Resolution**: 1-minute granularity
- **Scoring Metric**: Sharpe ratio (risk-adjusted returns)
- **Re-tuning Frequency**: Automatic when correlation degrades

### Sentiment Momentum Physics

**Velocity Calculation:**
Rate of sentiment change normalized to daily scale:
```
Velocity(t) = (Sentiment(t) - Sentiment(t-Δt)) / Δt × Normalization_Factor
```

**Acceleration Calculation:**
Rate of velocity change (momentum of momentum):
```
Acceleration(t) = (Velocity(t) - Velocity(t-Δt)) / Δt
```

**Physical Interpretation:**
- **High Velocity + High Acceleration**: Strong trending sentiment, high conviction
- **High Velocity + Deceleration**: Trend exhaustion, potential reversal
- **Low Velocity + High Acceleration**: Early trend formation, inflection point
- **Near-Zero Velocity + Zero Acceleration**: Consolidation, equilibrium

### Tukey Tapering & Spectral Analysis

To reduce spectral leakage in FFT processing:
- **1% Cosine Taper**: Applied at signal boundaries
- **Spectral Windowing**: Hamming/Hanning windows for frequency analysis
- **Noise Floor Filtering**: Frequency components below threshold discarded

---

## 4. Adaptive Learning & Self-Calibration System

### Overview
The platform implements a **closed-loop learning system** where prediction accuracy feeds back into model behavior, continuously improving forecast quality through statistical self-calibration.

### Prediction History Analysis Methodology

Each AI agent receives its own prediction history with three integrated information sources:

**1. Developer Context & Model Evolution Notes**
- Human-curated notes on model changes and known limitations
- Context for interpreting historical performance anomalies
- Version tracking for model capability evolution

**2. Previous Insights Log (Adaptive Learning Memory)**
- Hypotheses from past analyses (treated as starting points, not facts)
- Confidence-weighted observations (>60% confidence retained)
- Anecdotal patterns requiring validation against new data

**3. Latest Performance Data (Primary Truth Source)**
- JSON metrics with statistical aggregations
- Visual accuracy trend charts
- Rolling window calculations (daily accuracy, volume-weighted)

### Confidence Calibration System

**Calibration Buckets:**
| Confidence Level | Expected Accuracy | Calibration Gap |
|------------------|-------------------|-----------------|
| Very High (80-100%) | 80-100% | |actual - expected||
| High (60-79%) | 60-79% | Tracked per bucket |
| Medium (40-59%) | 40-59% | Statistical significance |
| Low (0-39%) | 0-39% | Model humility metric |

**Calibration Analysis:**
- Tracks whether 80% confidence predictions actually win ~80% of the time
- Identifies overconfidence (gap > 15%) or underconfidence (gap < -15%)
- Feeds into future confidence score adjustments

### Movement-Weighted Accuracy Scoring

Traditional accuracy metrics treat all predictions equally. Market Wizard uses **magnitude-weighted scoring** where large moves count more:

**Magnitude Classification:**
| Tier | Movement | Level | Impact Weight (level^1.5) |
|------|----------|-------|---------------------------|
| Noise | <0.25% | 0 | 0 |
| Minor | 0.25-0.75% | 1 | 1.0 |
| Small | 0.75-1.5% | 2 | 2.8 |
| Moderate | 1.5-2.5% | 3 | 5.2 |
| Large | 2.5-4.0% | 4 | 8.0 |
| Major | 4.0-6.0% | 5 | 11.2 |
| Extreme | >6.0% | 6 | 14.7 |

**Formula:**
```
Movement_Weighted_Accuracy = Σ(correct_i × weight_i) / Σ(weight_i)
```

This ensures the model optimizes for capturing significant moves, not just high-probability small fluctuations.

### Signal Performance Tracking (40+ Metrics)

**Per-Signal Accuracy Calculation:**
Each of the 40+ tracked signals receives individual performance metrics:
- Total predictions using this signal
- Directional accuracy (BUY/SELL/HOLD)
- Movement-weighted accuracy
- Confidence-weighted accuracy
- Calibration gap (confidence vs. actual accuracy)

**Category Aggregation:**
| Category | Signal Count | Examples |
|----------|--------------|----------|
| Options Signals | 16 | Put/Call ratios, Gamma exposure, Smart money flow, IV percentile, Max pain, Unusual activity |
| Vibe Signals | 8 | Narrative strength, SEC filings, Social momentum, Virality coefficient |
| Image Signals | 4 | Temporal impacts, Velocity patterns, Acceleration zones, Hybrid signal convergence |
| Master Signals | 12 | Composite sentiment, Price action patterns, Cross-asset correlation, Earnings context |

**Signal Consensus Analysis:**
- Aggregate direction votes across all 40+ signals
- Confidence-weighted consensus calculation
- Divergence detection (when signals conflict)
- Kernel density estimation for signal clustering

### Per-Symbol Learning Profiles

The system maintains **individual learning profiles** for each tracked symbol:

**Symbol-Specific Metrics:**
- Historical prediction accuracy for this specific stock
- Which signal categories perform best for this symbol
- Bias analysis (systematic over/under-prediction)
- Optimal sentiment blend weights (may differ from portfolio average)

**Portfolio vs. Symbol Comparison:**
- Portfolio metrics: Larger sample, statistically reliable baseline
- Symbol metrics: Smaller sample, may reveal genuine stock-specific patterns
- Divergence analysis: When symbol differs from portfolio, investigate why

### Model Comparison & Ensemble Weighting

**Four-Model Performance Tracking:**
| Model | Primary Metric | Historical Performance |
|-------|---------------|------------------------|
| Master | movement_weighted_accuracy | Portfolio-wide synthesis |
| Image | visual pattern accuracy | Chart interpretation skill |
| Options | options flow correlation | Institutional positioning prediction |
| Vibe | narrative momentum accuracy | Sentiment velocity prediction |

**Dynamic Ensemble Weighting:**
- Models with higher historical accuracy receive greater weight in final synthesis
- Performance decay factors (recent predictions weighted more heavily)
- Cross-model consistency scoring (agreement = confidence boost)

### Adaptive Learning Log Structure

The **Adaptive Learning Log** captures nuanced observations:

**Entry Format:**
```
[Hypothesis] -> [Evidence from JSON/Charts] -> [Strategic Implication] [Confidence%]
```

**Update Process:**
1. Reproduce previous log entries
2. Re-validate each against newest data
3. Adjust confidence scores up/down based on validation
4. Remove entries with confidence < 20%
5. Add new observations with initial confidence 30%
6. Prioritize high-confidence (>60%) insights for strategy formulation

**Evolved Strategy Formulation:**
Synthesizes baseline performance assessment with high-confidence nuanced observations to produce integrated trading strategy.

### Bias Detection & Correction

**Systematic Bias Analysis:**
- **Directional Bias**: Tendency to over-predict BUY vs. SELL (or vice versa)
- **Magnitude Bias**: Systematic over/under-estimation of price moves
- **Timing Bias**: Consistent early/late predictions
- **Volatility Bias**: Over/under-reaction to high-volatility periods

**Bias Correction:**
Identified biases feed back into prompt engineering and confidence calibration.

---

## 5. Intelligence Architecture & Prompt Engineering

### Scale & Sophistication
- **2,946 lines** of prompt engineering across 2 files
- **859 lines** dedicated to Image Analyst visual interpretation
- **Role-specific system prompts** for each analyst type
- **Structured output schemas** (1,602 lines of JSON structures)
- **Multi-turn reasoning** with thinking extraction

### Core Principles Embedded in Every Prompt

**1. Objective & Unbiased Analysis:**
- Primary directive: remain neutral, avoiding bullish/bearish bias
- "HOLD" or "No clear opportunity" is valid and often prudent
- Challenge own assumptions before reaching conclusions

**2. Intellectual Rigor:**
- Distinguish correlation from causation
- Consider second-order effects ("what happens next?")
- Assess narratives for potential fallacies and randomness
- Avoid anchoring on initial data points
- Seek disconfirming evidence actively

**3. Data-Agnostic Synthesis:**
- Integrate all available data sources (technical, fundamental, sentiment)
- Identify points of convergence (multiple sources agree)
- Highlight points of divergence (conflicting signals = uncertainty)
- Weight data by context, not fixed rules

**4. Risk-Aware Communication:**
- All market analysis is probabilistic
- Explicitly state risks, uncertainties, invalidating factors
- Use probabilistic language and confidence levels
- Distinguish between likely, possible, and speculative

### Source Quality Tiering System

**Tier 1 - High Signal Sources (Prioritized):**
- Traditional Financial News: Reuters, Bloomberg, WSJ, CNBC, Financial Times, Barron's
- Official Regulatory: SEC EDGAR filings (Form 4, 8-K, 10-Q, 10-K)
- Official Company: Press releases, investor relations, earnings transcripts
- Research Firms: Gartner, Fundstrat, major investment banks (UBS, Goldman, Morgan Stanley)

**Tier 2 - Low Signal/High Noise (Avoided):**
- Social Media: Reddit, StockTwits, Twitter/X, Yahoo Finance Conversations
- Aggregator Sites: TechCrunch, Investing.com, GuruFocus, TipRanks
- Prediction Sites: Forecasting sites, "marketminute" spam

**Efficiency Guidelines:**
- Prioritize analyst upgrades/downgrades (immediate sentiment drivers)
- Weight overnight and pre-market developments most heavily
- Focus on institutional commentary over retail discussion
- Prefer primary sources (SEC filings) over secondary summaries

### Data Weighting Transparency

Every Master Analyst recommendation includes explicit **percentage weighting** of all 14+ data sources:

| Data Source | Typical Range | Adjustment Logic |
|-------------|---------------|------------------|
| Sentiment Visualization Analysis | 5-25% | Higher when visual patterns are clear |
| Options Market Analysis | 10-30% | Higher near expiration, high IV periods |
| Vibe & Narrative Analysis | 5-20% | Higher during viral news events |
| Stock-specific News Sentiment | 10-25% | Higher during company-specific catalysts |
| Industry-wide Sentiment | 5-15% | Higher during sector rotation |
| Market-wide Sentiment | 5-15% | Higher during macro events |
| Recent Stock Price Action | 10-20% | Always significant technical input |
| Historical Stock Price Trends | 5-15% | Higher when patterns repeat |
| Prediction Accuracy History | 5-15% | Higher when historical accuracy is strong |

**Weights sum to 100%** and vary dynamically based on market conditions.

### Reasoning Transparency Requirements

**Structured Output Sections:**
1. **[SUMMARY]** - One-sentence recommendation summary
2. **[REASONING]** - Primary signal, supporting evidence (3-4 metrics), signal integration, contradicting factors
3. **[MARKET CONTEXT]** - Broader market impact analysis
4. **[PREDICTION SYNTHESIS]** - How hourly predictions integrate data sources
5. **[DATA WEIGHTING]** - Percentage allocation across 14+ sources with justification
6. **[SIGNAL RELIABILITY LOG]** - Deconstruction into 12+ individual metrics

**Hourly Price Prediction Methodology:**
- 17 hourly predictions (4 AM - 8 PM)
- Inflection point identification for each hour
- Volatility expressed as symmetrical radius (±X.X%)
- Alignment with overall directional thesis

### Signal Reliability Log Format

Each prediction generates a **decomposed signal table** tracking:

| Metric | Signal | Direction | Strength | Confidence |
|--------|--------|-----------|----------|------------|
| Stock-specific News Sentiment | [value] | BUY/SELL/HOLD | Very Strong/Strong/Neutral/Weak/Very Weak | 0-100% |
| Options: Gamma Exposure | [value] | BUY/SELL/HOLD | Very Strong/Strong/Neutral/Weak/Very Weak | 0-100% |
| Image: Master Temporal Impact | [value] | BUY/SELL/HOLD | Very Strong/Strong/Neutral/Weak/Very Weak | 0-100% |
| ... (40+ metrics) | ... | ... | ... | ... |

This enables:
- Post-hoc analysis of which signals drove correct/incorrect predictions
- Signal reliability scoring over time
- Identification of systematically misleading indicators

---

## 6. Prediction Accuracy Feedback Loop (Expanded)

### Signal Tracking Architecture

The system tracks **40+ individual signals** across four model categories, each receiving independent accuracy scoring:

**Signal Extraction & Validation:**
- Regex-based signal parsing from AI analysis text
- Direction extraction (BUY/SELL/HOLD)
- Confidence score capture (0-100%)
- Cross-reference with actual price movements

**Per-Signal Metrics Calculated:**
- Total predictions using this signal
- Raw accuracy (% correct)
- Movement-weighted accuracy (magnitude^1.5 weighting)
- Confidence-weighted accuracy (higher confidence = more weight)
- Average confidence vs. actual accuracy (calibration gap)
- Performance by market condition (bull/bear/sideways)

### Model Consistency Analysis

**Cross-Model Validation:**
When Master, Image, Options, and Vibe models all predict the same direction:
- High consistency = confidence boost
- Low consistency = uncertainty flag

**Consistency Scoring:**
```
Consistency_Score = 1 - (max_deviation / average_prediction)
```

Ratings: Very High (>99.5%), High (99-99.5%), Moderate (98-99%), Low (96-98%), Very Low (<96%)

### Movement Detection Quality

**Significant Move Detection Rate:**
- Tracks what percentage of large moves (>2.5%) the system predicted
- **Major Move Detection**: Tracks moves >4.0%
- **False Alarm Rate**: Predictions that didn't materialize

**Detection Quality Ratings:**
| Detection Rate | False Alarm Rate | Rating |
|----------------|------------------|--------|
| ≥70% | ≤30% | Excellent |
| ≥60% | ≤40% | Good |
| ≥50% | ≤50% | Fair |
| ≥40% | - | Poor |
| <40% | - | Needs Improvement |

### Portfolio Performance Simulation

**Backtesting Framework:**
- **Strategy Simulation**: Simulated $10,000 portfolio executing recommendations
- **Buy & Hold Benchmark**: Same portfolio, buy-and-hold strategy
- **Perfect Foresight**: Optimal strategy (knowing actual direction)
- **Worst Strategy**: Anti-optimal (always wrong)
- **Random Strategy**: Random action selection

**Metrics Calculated:**
- Strategy return vs. benchmarks
- Outperformance vs. buy-and-hold
- Win rate (profitable trades / total trades)
- Profit factor (gross wins / gross losses)
- Sharpe ratio (risk-adjusted returns)

### Weekly & Trend Analysis

**Performance Trend Detection:**
- First half vs. second half comparison
- Trend direction (improving/declining/stable)
- Trend strength (steepness of change)
- Momentum indicators

**Day-of-Week Analysis:**
- Accuracy patterns by trading day
- Volume patterns by day
- Identifies systematic day-based biases

### Signal Category Rankings

**Dynamic Category Performance:**
```python
top_categories = sorted(
    category_performance.items(),
    key=lambda x: (x[1]['movement_weighted_accuracy'], x[1]['accuracy']),
    reverse=True
)
```

Identifies:
- Best performing category (highest movement-weighted accuracy)
- Worst performing category (systematically misleading)
- Model-specific category strengths (Options Analyst best at flow signals, etc.)

---

## 7. JavaScript-in-Python Compute Engine

### The Innovation
939 lines of JavaScript embedded directly in Python, executed via Node.js subprocess for **10x faster parameter optimization**.

### Why?
Options analysis requires testing thousands of parameter combinations. Python alone was too slow for real-time use.

### Three-Stage Optimization Pipeline

**Stage 1: Optimal Sentiment Blend Discovery**
- Grid search over **441 weight combinations** (21 x 21 matrix)
- Tests blends of: Raw Flow, Market Structure, Smoothed Trend
- Scoring via **Sharpe ratio** (risk-adjusted returns)
- Timeout: 90 seconds

**Stage 2: Best Slicing Parameters**
- Tests **1,008 configurations** (12 lookaround × 7 minSegment × 12 sensitivity)
- Composite scoring: 20% returns + 20% close-to-close accuracy + 60% intraday accuracy
- Timeout: 120 seconds

**Stage 3: Final Analysis**
- Inflection point detection using angle change calculations
- Segment normalization to [-1, 1] scale
- Daily aggregation with temporal/magnitude weighting
- Timeout: 60 seconds

### Process Management
- Node.js execution with **2GB memory allocation** (`--max-old-space-size=2048`)
- Strict timeout enforcement with process termination
- JSON payload marshalling between Python and JavaScript
- Stderr stream logging for debugging

---

## 8. Real-Time Signal Processing with FFT

### Fast Fourier Transform Cross-Correlation
The frontend (1,147-line `SentimentTuner.js`) uses FFT to find optimal lag between sentiment signals and price movements.

### What It Does
1. Transforms sentiment and price time series to frequency domain
2. Performs complex conjugate multiplication
3. Inverse transforms to get correlation at all possible lags
4. Finds the lag (in hours) where sentiment best predicts price

### Configuration
- **Lag search range**: 0.5 to 18 hours
- **Resolution**: 1-minute granularity
- **Ramp functions**: Smooth weighting at lag boundaries to avoid edge effects

### Additional Signal Processing
- **Velocity calculation**: Rate of sentiment change (normalized to daily scale)
- **Acceleration calculation**: Rate of velocity change (momentum of momentum)
- **Tukey tapering**: 1% cosine taper to reduce spectral leakage
- **EMA trend smoothing**: Configurable trend factor blending

---

## 9. Quantitative Options Analytics

### Scale
- **4,759 lines** dedicated to options analysis
- **22-field data structure** per options contract
- **6 Greeks calculated**: Delta, Gamma, Theta, Vega, Vanna, Charm

### Black-Scholes Implementation
Uses `blackscholes` and `py_vollib` libraries for:
- Options pricing
- Implied volatility solving
- Full Greeks calculation

### Flow Classification
Distinguishes between institutional ("smart money") and retail flow:
- Premium/volume ratio analysis
- **Unusual activity scoring** (z-score percentile 75+)
- Volume/OI ratio thresholds
- Classification: "Intelligent", "Retail", or "Ambiguous"

### Volatility Analysis
- IV vs RV comparison with historical percentiles
- Regime classification: "high_iv" (fear), "low_iv" (complacency), "normal_iv"
- Volatility premium calculation (IV - RV)

### Momentum Pattern Analysis
Multi-factor scoring:
- Volume trend (increasing/decreasing)
- Put/Call ratio trend (bullish/bearish)
- Premium trend analysis
- Volume vs recent average comparison
- Composite momentum strength: "strong", "moderate", "weak"

### Time Bucket Analysis
- Market hours divided into **13 thirty-minute buckets** (9:30 AM - 4:00 PM)
- Per-bucket statistics for intraday pattern detection
- Historical comparison across same time buckets

---

## 10. Dual-Layer Caching Architecture

### Multi-Tier Strategy

**Primary Layer: Redis**
- Connection pooling with **150 max connections**
- Health checks every **30 seconds**
- **100 concurrent operations** via Semaphore

**Fallback Layer: Async File System**
- Asynchronous queue with **5,000 item capacity**
- **3 concurrent worker pools** for file operations
- Atomic writes using temp files + `os.replace()`
- **5 max retry attempts** with exponential backoff

### Aggregation System
Batches related cache entries to reduce I/O:
- Flush threshold: **100 entries** OR **10 seconds** (whichever comes first)
- Reduces I/O operations by **~70%**
- Lock-based synchronization

### Tiered TTL Configuration

| Category | TTL |
|----------|-----|
| Stocks | 30 days |
| Historical | 180 days |
| Articles | 90 days |
| Recommendations | 180 days |
| Options Tier1 (intraday) | 1 hour |
| Prediction Accuracy | 8 hours |

### Image Optimization
- WebP compression at **quality=85**
- Lazy loading from manifest files
- Base64 encoding for API transport

---

## 11. Real-Time WebSocket Architecture

### Connection Manager
- Maintains map of **client_id → WebSocket** connections
- **Symbol-based subscriptions**: clients only receive updates for subscribed stocks
- Automatic cleanup on disconnect
- Reconnection support with subscription restoration

### Message Types
- `subscribe` / `unsubscribe`: Symbol subscription management
- `status_update`: Article processing progress
- `analysis_cancelled`: Cancellation confirmations
- `time_settings`: Time override for testing with historical dates
- `log`: Server-side log streaming to client

### Broadcast Efficiency
- Targeted broadcasts only to subscribed clients
- Connection lock prevents race conditions
- Automatic dead connection cleanup

---

## 12. Concurrent Task Management

### Semaphore Patterns

| Service | Limit | Purpose |
|---------|-------|---------|
| AIService | 50 | Concurrent AI API calls |
| RecommendationService | 5 | Concurrent recommendation generations |
| CacheService (Redis) | 100 | Concurrent Redis operations |
| PolygonOptionsClient | 25 | Options API rate limiting |
| FingerprintService | 3 | Batch background processing |
| PortfolioMonitor (Client) | 5 | Concurrent data fetches |

### Client-Side Concurrency
Manual semaphore implementation in React using `useRef`:
- Prevents thundering herd problem
- Request deduplication via Set tracking
- Configurable delay between semaphore checks

---

## 13. Timezone-Aware Scheduling

### Master Scheduler Configuration
- **Run times (EST)**: 20:05, 21:00, 00:05, 01:30
- **Blackout window**: 02:00 - 20:00 EST (during market hours)
- Dynamic next-run calculation with fallback to next day

### Parallel Job Execution
- Fingerprint calculation and options analysis run concurrently
- Graceful cancellation handling
- Human-readable timedelta formatting for logging

### Time Override System
- Middleware intercepts `overrideDateTime` parameter
- Allows testing with historical dates
- Propagates through all services via `time_service`

---

## 14. Article Workflow Orchestration

### Weighted Keyword Allocation
- Distributes article fetching based on keyword importance weights
- Formula: `articles_per_keyword = ceil((weight / total_weight) × total_articles)`
- Minimum 1 article per keyword

### Progress Tracking
Comprehensive statistics per symbol:
- **Cache stats**: Total processed, cached relevance, cached sentiment, fully cached
- **Enrichment stats**: Direct fetch, browser fetch, failed, from cache
- **URL decode stats**: Base64, batchexecute, not_google, failed
- **RSS dedup stats**: Total candidates, kept, duplicates

### High Water Mark
- Tracks most recent article processed per symbol
- Enables incremental updates (only fetch newer articles)
- Persisted across sessions

### Completion Reporting
- Detailed breakdown by day
- Processing time tracking
- Cache efficiency metrics

---

## 15. Sentiment Fingerprinting

### Background Batch Processing
- **Expiry**: 7 days before recalculation
- **Target**: 50 articles per symbol over 90 days
- **Concurrency limit**: 3 simultaneous calculations

### Fingerprint Types
1. **GLOBAL_MARKET**: Market-wide sentiment using 9 keywords (stock market, interest rates, inflation, etc.)
2. **Per-Symbol**: Company-specific sentiment with auto-generated keywords
3. **INDUSTRY_{symbol}**: Sector sentiment for context

### ProcessPoolExecutor
- **4 worker processes** for CPU-intensive calculations
- Proper shutdown handling on service close

---

## Technology Stack Summary

### Backend
| Technology | Purpose |
|------------|---------|
| FastAPI | Async web framework |
| asyncio | Concurrency primitives |
| Redis | Primary cache layer |
| aiofiles | Async file operations |
| Anthropic SDK | Claude AI |
| OpenAI SDK | GPT models |
| Google GenAI | Gemini models |
| Polygon.io | Options data |
| Alpaca | Stock market data |
| BlackScholes/py_vollib | Options math |
| scipy.stats | Statistical analysis |
| Node.js (subprocess) | Heavy compute |
| numpy | Numerical operations |
| pandas | Data manipulation |

### Frontend
| Technology | Purpose |
|------------|---------|
| React 18 | UI framework |
| Chakra UI | Component library |
| Recharts | Data visualization |
| fft.js | Signal processing |
| Firebase | Authentication |
| Native WebSocket | Real-time updates |

---

## Key Differentiators

1. **Physics-Based Sentiment Modeling**: Attack-decay dynamics, propagation speed, impact duration—treating market sentiment as signal propagation through time

2. **Visual Intelligence Layer**: Computer vision analysis of sentiment charts with velocity/acceleration detection, momentum physics interpretation

3. **Self-Calibrating Prediction Engine**: Adaptive learning from 40+ individually weighted metrics with confidence calibration and bias correction

4. **Hybrid Compute Architecture**: JavaScript embedded in Python for 10x faster parameter optimization (1,449 total combinations tested per analysis)

5. **FFT-Based Signal Processing**: Real-time cross-correlation finding optimal sentiment-price lag across 0.5-18 hour range

6. **Multi-AI Agent Synthesis**: Four specialist analysts with distinct expertise, self-assessment capabilities, and weighted ensemble synthesis

7. **Closed-Loop Learning System**: Prediction accuracy feeds back into model behavior via signal reliability tracking, category performance ranking, and evolved strategy formulation

8. **Movement-Weighted Accuracy**: Magnitude^1.5 weighting ensures optimization for capturing significant market moves, not just high-probability noise

9. **Enterprise Caching**: Dual-layer Redis/file system with 3-worker pools, batching (70% I/O reduction), and 6-tier TTL configuration

10. **Full Quantitative Options**: 4,759-line service calculating 6 Greeks with flow classification, regime detection, and institutional positioning analysis

11. **Intelligence Architecture**: 2,946 lines of prompt engineering with source quality tiering, data weighting transparency, and reasoning extraction

---

*Document Version: 2.0 - Enhanced with Visual Intelligence, Physics-Based Sentiment Modeling, and Adaptive Learning Systems*
