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

### Top Backend Services by Size
1. `recommendation_options_service.py` - 4,759 lines (Options chain analysis, Greeks, flow classification)
2. `prediction_accuracy_service.py` - 2,363 lines (Feedback loop, signal extraction)
3. `recommendation_prompts_json_structures.py` - 1,602 lines (AI output schemas)
4. `recommendation_prompts.py` - 1,344 lines (Expert system prompts)
5. `advanced_options_analysis_service.py` - 1,297 lines (JS-in-Python compute engine)
6. `article_workflow_service.py` - 1,225 lines (Orchestration, progress tracking)
7. `cache_service.py` - 1,154 lines (Dual-layer caching with worker pools)
8. `ai_service.py` - 1,019 lines (Multi-provider AI orchestration)

### Top Frontend Components by Size
1. `RecommendationPredictionAccuracy.js` - 1,736 lines
2. `DashboardContent.js` - 1,361 lines
3. `PortfolioPanel.js` - 1,263 lines
4. `SentimentDataProcessor.js` - 1,248 lines
5. `RecommendationPredictionChart.js` - 1,236 lines
6. `SentimentTuner.js` - 1,147 lines (FFT signal processing)

---

## Executive Summary

Market Wizard is an AI-powered stock sentiment analysis and trading recommendation platform combining:
- **Multi-AI orchestration** across 3 providers (Claude, GPT, Gemini)
- **Real-time signal processing** using Fast Fourier Transforms (FFT)
- **Quantitative options analytics** with Black-Scholes Greeks
- **Hybrid caching architecture** with Redis + file-based fallback
- **JavaScript-in-Python compute engine** for performance-critical calculations
- **Prediction accuracy feedback loops** tracking 40+ signals

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
The recommendation system employs role-based expert agents:

| Agent | Expertise | Focus |
|-------|-----------|-------|
| **Master Analyst** | Multi-dimensional synthesis | Comprehensive daily recommendations |
| **Image Analyst** | Visual chart interpretation | Temporal sentiment patterns from visualizations |
| **Options Analyst** | Derivatives market analysis | Institutional flow, gamma exposure, positioning |
| **Vibe Analyst** | Public discourse analysis | Narrative momentum, social sentiment |

Each specialist operates with unique 1,000+ word system prompts defining expertise, methodology, and output formats, then feeds into a master synthesis layer.

---

## 2. JavaScript-in-Python Compute Engine

### The Innovation
939 lines of JavaScript embedded directly in Python, executed via Node.js subprocess for 10x faster parameter optimization.

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

## 3. Real-Time Signal Processing with FFT

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

## 4. Quantitative Options Analytics

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

## 5. Dual-Layer Caching Architecture

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

## 6. Prediction Accuracy Feedback Loop

### Signal Tracking
The system tracks **40+ signals** across categories:

| Category | Signal Count | Examples |
|----------|--------------|----------|
| Options Signals | 16 | Put/Call ratios, Gamma exposure, Smart money flow, IV percentile |
| Vibe Signals | 8 | Narrative strength, SEC filings, Social momentum |
| Image Signals | 4 | Temporal impacts, Sentiment dynamics |
| Master Signals | 12 | Composite sentiment, Price action, Cross-asset correlation |

### Sophisticated Accuracy Metrics

**Movement-Weighted Accuracy**
- Magnitude classification from Noise (0) to Extreme (6)
- Intensity weighting using **magnitude^1.5**
- Only counts price movements **>0.5%**
- Prevents noise from diluting accuracy metrics

**Confidence-Weighted Accuracy**
- Formula: `Σ(confidence × is_correct) / Σ(confidence)`
- Higher confidence predictions count more toward accuracy

**Signal Consensus Analysis**
- Aggregate direction votes with confidence weighting
- Kernel density estimation for signal clustering
- Identifies when multiple signals agree/disagree

### Per-Symbol and Portfolio Metrics
- Individual symbol tracking with caching
- Portfolio-wide aggregation across all tracked stocks
- Historical comparison for trend detection

---

## 7. Real-Time WebSocket Architecture

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

## 8. Concurrent Task Management

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

## 9. Timezone-Aware Scheduling

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

## 10. Article Workflow Orchestration

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

## 11. Sentiment Fingerprinting

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

## 12. AI Prompt Engineering

### Scale
- **2,946 lines** of prompt engineering across 2 files
- Role-specific system prompts for each analyst type
- Structured output schemas (JSON structures file: 1,602 lines)

### Core Principles Embedded in Every Prompt
1. **Objective & Unbiased Analysis**: Neutral stance, acknowledging HOLD as valid
2. **Intellectual Rigor**: Challenge assumptions, avoid anchoring bias
3. **Data-Agnostic Synthesis**: Weight data by context, not fixed rules
4. **Risk-Aware Communication**: Probabilistic language, explicit uncertainty

### Source Quality Tiering
Prompts include guidance on source reliability:
- **Tier 1 (High Signal)**: Reuters, Bloomberg, SEC EDGAR, company press releases
- **Tier 2 (Avoid)**: Social media, aggregator sites, prediction sites

### Hourly Price Prediction Methodology
Each analyst generates 17 hourly price predictions (4 AM - 8 PM):
- Inflection point identification
- Volatility expressed as symmetrical radius (±X.X%)
- Alignment with overall directional thesis

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

1. **Hybrid Compute Architecture**: JavaScript embedded in Python for 10x faster parameter optimization (1,449 total combinations tested per analysis)

2. **FFT-Based Signal Processing**: Real-time cross-correlation finding optimal sentiment-price lag across 0.5-18 hour range

3. **Multi-AI Agent Synthesis**: Four specialist analysts with distinct expertise feeding into master synthesis

4. **Prediction Feedback Loop**: 40+ signals tracked with movement-weighted (magnitude^1.5) and confidence-weighted accuracy metrics

5. **Enterprise Caching**: Dual-layer Redis/file system with 3-worker pools, batching (70% I/O reduction), and 6-tier TTL configuration

6. **Full Quantitative Options**: 4,759-line service calculating 6 Greeks with flow classification and regime detection

7. **Real-time Subscription Model**: WebSocket with symbol-based targeting (only relevant updates to subscribed clients)

8. **Timezone-Aware Scheduling**: EST-based job scheduling with blackout windows during market hours
