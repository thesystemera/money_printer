# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Market Wizard is a stock sentiment analysis and trading recommendation platform. It combines real-time news article sentiment analysis with market data, options analysis, and AI-generated trading recommendations.

## Architecture

### Monorepo Structure
- **client/**: React 18 frontend with Chakra UI, using Create React App
- **server/**: Python FastAPI backend with async/await patterns throughout

### Backend Services (server/services/)

The backend uses a layered service architecture initialized in sequence at startup:

1. **Core Layer**: `cache_service.py` (Redis), `config_service.py`
2. **Infrastructure Layer**: `ai_service.py` (OpenAI/Anthropic), `stock_service.py` (Alpaca API), `article_enrichment_service.py`
3. **Data Layer**: `earnings_service.py`, `article_service.py`
4. **Business Layer**: `company_service.py`, `recommendation_options_service.py`, `recommendation_portfolio_service.py`
5. **Top Layer**: `recommendation_service.py` - orchestrates all services for final trading recommendations

Key service patterns:
- Services receive dependencies via constructor injection
- All services have async `initialize()` methods
- `cache_service.py` handles Redis caching with file-based fallback
- `article_workflow_service.py` coordinates article fetching, enrichment, and analysis

### Frontend Architecture (client/src/)

- **components/**: React components, largest being `DashboardContent.js`, `SentimentChart.js`, recommendation panels
- **services/**: `apiService.js` (REST), `socketService.js` (WebSocket for real-time updates)
- **config/Config.js**: All constants, styling, timeouts, default settings
- **contexts/AuthContext.js**: Firebase authentication

### Real-Time Communication
- WebSocket endpoint at `/ws/{client_id}` for live updates during article processing
- `ConnectionManager` in `app.py` manages subscriptions per stock symbol
- Client subscribes/unsubscribes to symbols for targeted updates

### Authentication
- Firebase Auth on frontend, tokens validated via `auth_service.py`
- Three-tier access: guest, premium, admin
- `require_tier()` decorator protects endpoints

## Development Commands

### Client (React)
```bash
cd client
npm install
npm start        # Dev server on port 3000, proxies to localhost:5000
npm run build    # Production build to client/build/
npm test         # Jest tests
```

### Server (Python)
```bash
# Create/activate virtual environment
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # Unix

pip install -r requirements.txt
python server/app.py     # Starts FastAPI on port 5000
```

### Running Both
Start server first (port 5000), then client (port 3000). Client proxies API calls via `package.json` proxy setting.

## Key API Endpoints

- `POST /api/articles` - Fetches and analyzes news articles (background task)
- `POST /api/get-recommendation` - Generates AI trading recommendation
- `GET /api/options-data/{symbol}` - Options chain analysis
- `GET /api/market-data` - Stock/index price data (Alpaca)
- `GET /api/prediction-accuracy/{symbol}` - Historical prediction metrics

## Environment Variables

Root `.env` and `client/.env` contain:
- Firebase credentials
- Alpaca API keys (stock data)
- OpenAI/Anthropic API keys (AI analysis)
- Redis connection (optional, falls back to file cache)

## Important Patterns

### Async Everything
The backend is fully async. Use `await` for all service calls, file I/O via `aiofiles`, and Redis operations.

### NaN-Safe JSON
`NaNSafeJSONResponse` class handles NaN/Infinity in numeric data before JSON serialization.

### Time Override
`TimeOverrideMiddleware` allows testing with historical dates by passing `overrideDateTime` in requests.

### Recommendation Generation
The recommendation flow:
1. Articles fetched and cached via `article_workflow_service.py`
2. Sentiment analyzed per article via `analysis_service.py`
3. Stock/market data fetched via `stock_service.py`
4. Visualization images captured from frontend charts
5. All data sent to `recommendation_service.py` which calls AI models
6. Response includes action (BUY/SELL/HOLD), confidence, predictions, options strategies

### Options Analysis
`recommendation_options_service.py` (237KB) is the largest service, handling Black-Scholes calculations, Greeks, options chain analysis, and strategy suggestions.
