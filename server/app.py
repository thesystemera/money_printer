import os
import asyncio
import aiofiles
import math
import pytz
import traceback
from datetime import timedelta
from contextlib import asynccontextmanager
from typing import List, Optional
from pydantic import BaseModel, Field

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks, Depends, Header, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.websockets import WebSocketState
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.status import HTTP_401_UNAUTHORIZED

from services.cache_service import CacheService
from services.config_service import ConfigService
from services.ai_service import AIService
from services.earnings_service import EarningsService
from services.article_service import ArticleService
from services.article_enrichment_service import ArticleEnrichmentService
from services.analysis_service import AnalysisService
from services.stock_service import StockService
from services.company_service import CompanyService
from services.recommendation_service import RecommendationService
from services.recommendation_options_service import OptionsService
from services.recommendation_options_service_yfinance import YFinanceEnrichmentService
from services.recommendation_portfolio_service import PortfolioService
from services.prediction_accuracy_service import PredictionAccuracyService
from services.article_workflow_service import (
    KeywordAllocationService,
    ProgressTracker,
    TaskManager,
    AnalysisCoordinator,
    ArticleFetchCoordinator,
    ArticleWorkflowOrchestrator
)
from services.fingerprint_service import FingerprintService
from services.options_scheduler_service import OptionsSchedulerService
from services.master_scheduler_service import MasterSchedulerService

from services import log_service, time_service

from services.auth_service import verify_token
from models.user import User

TIER_LEVELS = {
    'guest': 0,
    'premium': 1,
    'admin': 2
}

def require_tier(minimum_tier: str):
    async def tier_checker(current_user: User = Depends(get_current_user)):
        user_level = TIER_LEVELS.get(current_user.tier, 0)
        required_level = TIER_LEVELS.get(minimum_tier, 0)
        if user_level < required_level:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Requires '{minimum_tier}' tier or higher."
            )
        return current_user

    return tier_checker

async def get_current_user(authorization: str = Header(...)) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Invalid token scheme")
    token = authorization.split("Bearer ")[1]
    user = verify_token(token)
    await log_service.api(f"Authenticated request for user: {user.uid} with tier: {user.tier}")
    return user

cache_service = CacheService()
config_service = ConfigService()

ai_service = AIService(
    cache_service=cache_service,
    config_service=config_service
)
stock_service = StockService(
    cache_service=cache_service,
    config_service=config_service
)
analysis_service = AnalysisService(
    cache_service=cache_service,
    config_service=config_service,
    ai_service=ai_service
)
article_enrichment_service = ArticleEnrichmentService(
    config_service=config_service
)
article_service = ArticleService(
    cache_service=cache_service,
    config_service=config_service,
    enrichment_service=article_enrichment_service
)
earnings_service = EarningsService(
    cache_service=cache_service,
    config_service=config_service
)
company_service = CompanyService(
    cache_service=cache_service,
    config_service=config_service,
    ai_service=ai_service
)
yfinance_enrichment_service = YFinanceEnrichmentService(cache_service)
options_service = OptionsService(
    cache_service=cache_service,
    config_service=config_service,
    stock_service=stock_service,
    yfinance_enricher=yfinance_enrichment_service,
    export_json=False
)
portfolio_service = PortfolioService(
    cache_service=cache_service,
    config_service=config_service,
    ai_service=ai_service,
    stock_service=stock_service
)
prediction_accuracy_service = PredictionAccuracyService(
    cache_service=cache_service,
    stock_service=stock_service
)
recommendation_service = RecommendationService(
    cache_service=cache_service,
    config_service=config_service,
    ai_service=ai_service,
    earnings_service=earnings_service,
    options_service=options_service,
    stock_service=stock_service,
    prediction_accuracy_service=prediction_accuracy_service
)

keyword_allocation_service = KeywordAllocationService()
progress_tracker = ProgressTracker()
task_manager = TaskManager()
fetch_coordinator = ArticleFetchCoordinator(article_service, cache_service)

class NaNSafeJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        def clean_nan(obj):
            if isinstance(obj, dict):
                return {k: clean_nan(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [clean_nan(item) for item in obj]
            elif isinstance(obj, float):
                if math.isnan(obj) or math.isinf(obj):
                    return None
                return obj
            return obj

        content = clean_nan(content)
        return __import__('json').dumps(content, ensure_ascii=False).encode("utf-8")

class TimeOverrideMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        override_datetime = None
        if "overrideDateTime" in request.query_params:
            override_datetime = request.query_params["overrideDateTime"]
        if override_datetime is None and request.method in ["POST", "PUT"]:
            try:
                body_bytes = await request.body()

                async def receive():
                    return {"type": "http.request", "body": body_bytes}

                request._receive = receive
                body = await asyncio.to_thread(__import__('json').loads, body_bytes)
                if isinstance(body, dict) and "overrideDateTime" in body:
                    override_datetime = body["overrideDateTime"]
            except Exception:
                pass
        if override_datetime:
            await time_service.set_override_datetime(override_datetime)
        response = await call_next(request)
        return response

class ConnectionManager:
    def __init__(self):
        self.active_connections = {}
        self.subscriptions = {}
        self.connection_lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        async with self.connection_lock:
            self.active_connections[client_id] = websocket
        await log_service.ws(f"Client connected: {client_id}")
        await self.send_personal_json(websocket, {"type": "log", "message": "Socket connected successfully",
                                                  "log_type": "success"})

    async def disconnect(self, client_id: str):
        async with self.connection_lock:
            if client_id in self.active_connections:
                del self.active_connections[client_id]
            for symbol, clients in list(self.subscriptions.items()):
                if client_id in clients:
                    clients.remove(client_id)
                    if not clients:
                        del self.subscriptions[symbol]
        await log_service.ws(f"Client disconnected: {client_id}")

    async def send_personal_json(self, websocket: WebSocket, message: dict):
        if websocket.client_state == WebSocketState.CONNECTED:
            try:
                await websocket.send_json(message)
                return True
            except Exception as e:
                await log_service.error(f"Error sending message: {str(e)}")
                return False
        return False

    async def send_personal_message(self, client_id: str, message: dict):
        async with self.connection_lock:
            if client_id in self.active_connections:
                return await self.send_personal_json(self.active_connections[client_id], message)
        return False

    async def broadcast(self, message: dict):
        disconnected = []
        async with self.connection_lock:
            connections = list(self.active_connections.items())
        for client_id, websocket in connections:
            success = await self.send_personal_json(websocket, message)
            if not success:
                disconnected.append(client_id)
        for client_id in disconnected:
            await self.disconnect(client_id)

    async def broadcast_to_symbol(self, symbol: str, message: dict):
        if symbol not in self.subscriptions:
            return
        disconnected = []
        async with self.connection_lock:
            if symbol in self.subscriptions:
                client_ids = list(self.subscriptions[symbol])
            else:
                return
        for client_id in client_ids:
            async with self.connection_lock:
                if client_id in self.active_connections:
                    websocket = self.active_connections[client_id]
                    success = await self.send_personal_json(websocket, message)
                    if not success:
                        disconnected.append(client_id)
                else:
                    disconnected.append(client_id)
        for client_id in disconnected:
            await self.disconnect(client_id)

    async def subscribe(self, client_id: str, symbol: str):
        async with self.connection_lock:
            if symbol not in self.subscriptions:
                self.subscriptions[symbol] = set()
            self.subscriptions[symbol].add(client_id)
        await log_service.ws(f"Client {client_id} subscribed to {symbol}")

    async def unsubscribe(self, client_id: str, symbol: str):
        async with self.connection_lock:
            if symbol in self.subscriptions and client_id in self.subscriptions[symbol]:
                self.subscriptions[symbol].remove(client_id)
                if not self.subscriptions[symbol]:
                    del self.subscriptions[symbol]
        await log_service.ws(f"Client {client_id} unsubscribed from {symbol}")

    async def send_log(self, client_id: str, message: str, log_type: str = "info"):
        return await self.send_personal_message(client_id, {"type": "log", "message": message, "log_type": log_type})

    async def broadcast_log(self, message: str, log_type: str = "info"):
        await self.broadcast({"type": "log", "message": message, "log_type": log_type})

manager = ConnectionManager()

class ArticleRequest(BaseModel):
    symbol: str
    companyName: str
    ceo: Optional[str] = None
    keywords: Optional[List[dict]] = None
    daysBack: int = 7
    totalArticles: int = 40
    useTurboModel: bool = False
    overrideDateTime: Optional[str] = None
    preCacheOnly: Optional[bool] = False


class RecommendationRequest(BaseModel):
    symbol: str
    companyName: str
    analyzedArticleIds: List[str] = Field(default_factory=list)
    marketIndices: List[str] = Field(default_factory=list)
    daysBack: int = 7
    yearsBack: int = 2
    overrideDateTime: Optional[str] = None
    visualizationImages: Optional[List[dict]] = None

async def startup_sequence():
    await log_service.start_log_worker()
    await log_service.system("Initializing services...")

    await log_service.system("Layer 1: Core services...")
    await cache_service.initialize()
    await config_service.initialize()

    await log_service.system("Layer 2: Infrastructure services...")
    await ai_service.initialize()
    await stock_service.initialize()
    await article_enrichment_service.initialize()

    await log_service.system("Layer 3: Data services...")
    await earnings_service.initialize()
    await article_service.initialize()

    await log_service.system("Layer 4: Business services...")
    await company_service.initialize()
    await options_service.initialize_options_service()
    await portfolio_service.initialize()

    await log_service.system("Layer 5: Top-level services...")
    await recommendation_service.initialize()

    await log_service.system("Layer 6: Analytics services...")
    await fingerprint_service.initialize()
    await options_scheduler_service.initialize()
    await master_scheduler_service.initialize(force_refresh=False, dry_run=False)

    log_service.set_websocket_manager(manager)
    await log_service.system("All services initialized successfully")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await startup_sequence()
    yield
    await cache_service.close()
    await article_enrichment_service.close()

app = FastAPI(
    title="Stock Sentiment Analysis API",
    description="API for analyzing stock sentiment based on news articles",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"],
                   allow_headers=["*"])
app.add_middleware(TimeOverrideMiddleware)


async def send_status_update(symbol, bucket, phase, status, data=None):
    message = {
        'type': 'status_update',
        'symbol': symbol,
        'bucket': bucket,
        'phase': phase,
        'status': status,
        'data': data or {},
        'timestamp': time_service.now(pytz.UTC).isoformat()
    }
    await manager.broadcast_to_symbol(symbol, message)


analysis_coordinator = AnalysisCoordinator(analysis_service, progress_tracker, task_manager, manager)

article_workflow_orchestrator = ArticleWorkflowOrchestrator(
    keyword_allocation_service,
    fetch_coordinator,
    progress_tracker,
    task_manager,
    analysis_coordinator,
    company_service,
    send_status_update,
    manager
)

fingerprint_service = FingerprintService(
    cs=cache_service,
    comps=company_service,
    workflow_orchestrator=article_workflow_orchestrator
)

options_scheduler_service = OptionsSchedulerService(
    cache_service=cache_service,
    options_service=options_service
)

master_scheduler_service = MasterSchedulerService(
    cache_service=cache_service,
    fingerprint_service=fingerprint_service,
    options_scheduler_service=options_scheduler_service
)


@app.get("/api/stock-info/{symbol}")
async def get_stock_info(symbol: str, current_user: User = Depends(require_tier("premium"))):
    await log_service.api(f"GET /api/stock-info/{symbol}")
    company_info = await company_service.get_company_info(symbol)
    return company_info


@app.post("/api/articles")
async def fetch_articles(articles_data: ArticleRequest, background_tasks: BackgroundTasks,
                         current_user: User = Depends(require_tier("premium"))):
    await log_service.api(f"POST /api/articles for {articles_data.symbol}")

    background_tasks.add_task(article_workflow_orchestrator.process_articles, articles_data.model_dump())

    return {
        "status": "processing",
        "message": f"Fetching articles for {articles_data.companyName}",
        "articles": []
    }


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str, token: str = Query(...)):
    try:
        user = verify_token(token)
        if not user:
            await websocket.close(code=1008, reason="Invalid authentication credentials")
            return
        await log_service.ws(f"Authenticated WebSocket connection for user: {user.uid}")

        await manager.connect(websocket, client_id)
    except Exception as e:
        await log_service.error(f"WebSocket connection failed for {client_id}: {str(e)}")
        await websocket.close(code=1008, reason=str(e))
        return

    try:
        while True:
            message = await websocket.receive_json()
            if "type" not in message:
                continue

            message_type = message["type"]
            if message_type == "subscribe":
                if "symbol" in message:
                    symbol = message["symbol"]
                    await manager.subscribe(client_id, symbol)
                    await manager.send_log(client_id, f"Subscribed to {symbol}", "success")
            elif message_type == "unsubscribe":
                if "symbol" in message:
                    symbol = message["symbol"]
                    await manager.unsubscribe(client_id, symbol)
                    await manager.send_log(client_id, f"Unsubscribed from {symbol}", "info")
            elif message_type == "cancel":
                if "symbol" in message:
                    symbol = message["symbol"]
                    cancelled_count = await task_manager.cancel_analysis(
                        symbol,
                        send_status_update,
                        progress_tracker
                    )
                    await manager.send_log(client_id, f"Cancelled analysis for {symbol} ({cancelled_count} tasks)",
                                           "warning")
                    await manager.send_personal_message(client_id, {
                        "type": "analysis_cancelled",
                        "symbol": symbol,
                        "cancelled_tasks": cancelled_count
                    })
            elif message_type == "time_settings":
                if "enableTimeOverride" in message:
                    enable_override = message.get("enableTimeOverride", False)
                    override_datetime = message.get("overrideDateTime")
                    if enable_override and override_datetime:
                        await time_service.set_override_datetime(override_datetime)
                        await manager.send_log(client_id, f"Time override set to {override_datetime}", "info")
                    else:
                        await time_service.set_override_datetime(None)
                        await manager.send_log(client_id, "Time override disabled", "info")
            elif message_type == "debug":
                await websocket.send_json({
                    "type": "debug_response",
                    "received": message,
                    "timestamp": time_service.now(pytz.UTC).isoformat()
                })
    except WebSocketDisconnect:
        await manager.disconnect(client_id)
    except Exception:
        traceback.print_exc()
        await log_service.error(f"WebSocket error: {traceback.format_exc()}")
        await manager.disconnect(client_id)


@app.post("/api/get-recommendation")
async def get_recommendation(request_data: RecommendationRequest,
                             current_user: User = Depends(require_tier("premium"))):
    symbol = request_data.symbol
    await log_service.api(f"POST /api/get-recommendation for {symbol}")

    company_name = request_data.companyName
    days_back = request_data.daysBack
    years_back = request_data.yearsBack
    visualization_images = request_data.visualizationImages

    if visualization_images:
        categories = {}
        for img in visualization_images:
            if 'category' in img:
                category = img['category']
                categories[category] = categories.get(category, 0) + 1

        master_images = await config_service.filter_images_by_destination(visualization_images,
                                                                          'send_to_master_analytics')
        image_analytics_images = await config_service.filter_images_by_destination(visualization_images,
                                                                                   'send_to_image_analytics')
        options_images = await config_service.filter_images_by_destination(visualization_images,
                                                                           'send_to_options_analytics')

        categories_summary = ", ".join([f"{count} {cat}" for cat, count in categories.items()])
        routing_summary = f"{len(master_images)} to master analytics, {len(image_analytics_images)} to image analytics, {len(options_images)} to options analytics"

        await log_service.info(f"Received {len(visualization_images)} images: {categories_summary}")
        await log_service.info(f"Image routing: {routing_summary}")

    market_indices = request_data.marketIndices
    if not market_indices:
        await log_service.warning(f"No market indices provided for {symbol}, defaulting to NASDAQ")
        market_indices = ['nasdaq']
    await log_service.info(f"Using market indices for {symbol}: {market_indices}")

    if not visualization_images or not isinstance(visualization_images, list) or len(visualization_images) == 0:
        return NaNSafeJSONResponse(
            status_code=400,
            content={"error": "At least one visualization image is required for generating a recommendation."}
        )

    analyzed_articles = []
    market_articles = []
    industry_articles = []

    if symbol in progress_tracker.task_tracking and 'analyzed_articles_data' in progress_tracker.task_tracking[symbol]:
        all_articles = progress_tracker.task_tracking[symbol]['analyzed_articles_data']
        if request_data.analyzedArticleIds:
            analyzed_articles = [article for article in all_articles if
                                 article['url'] in request_data.analyzedArticleIds]
        else:
            analyzed_articles = all_articles

    market_symbol = "GLOBAL_MARKET"
    if market_symbol in progress_tracker.task_tracking and 'analyzed_articles_data' in progress_tracker.task_tracking[
        market_symbol]:
        market_all_articles = progress_tracker.task_tracking[market_symbol]['analyzed_articles_data']
        if request_data.analyzedArticleIds:
            market_articles = [article for article in market_all_articles if
                               article['url'] in request_data.analyzedArticleIds]
        else:
            market_articles = market_all_articles

    industry_symbol = f"INDUSTRY_{symbol}"
    if industry_symbol in progress_tracker.task_tracking and 'analyzed_articles_data' in progress_tracker.task_tracking[
        industry_symbol]:
        industry_all_articles = progress_tracker.task_tracking[industry_symbol]['analyzed_articles_data']
        if request_data.analyzedArticleIds:
            industry_articles = [article for article in industry_all_articles if
                                 article['url'] in request_data.analyzedArticleIds]
        else:
            industry_articles = industry_all_articles

    all_analyzed_articles = analyzed_articles + market_articles + industry_articles

    if not all_analyzed_articles:
        return NaNSafeJSONResponse(
            status_code=400,
            content={"error": "No analyzed articles available. Please run a new analysis."}
        )

    await log_service.info(
        f"Fetching stock data for {symbol} over {days_back} days (recent) and {years_back} years (historical)")

    stock_prices_task = stock_service.get_market_data(
        symbol=symbol,
        data_type='stock',
        resolution='minute',
        time_range=days_back
    )

    historical_prices_task = stock_service.get_market_data(
        symbol=symbol,
        data_type='stock',
        resolution='day',
        time_range=years_back
    )

    stock_prices, historical_prices = await asyncio.gather(stock_prices_task, historical_prices_task)

    if not stock_prices:
        await log_service.error(f"No stock price data available for {symbol}")
        return NaNSafeJSONResponse(
            status_code=400,
            content={"error": "No recent price data available. Please try again later."}
        )

    await log_service.info(f"Retrieved {len(stock_prices)} recent price points for {symbol}")
    await log_service.info(f"Retrieved {len(historical_prices)} historical price points for {symbol}")

    market_indices_data = {}
    fetch_indices_tasks = []
    for index_name in market_indices:
        if index_name in stock_service.MARKET_INDEX_PROXIES:
            await log_service.info(f"Setting up tasks to fetch {index_name} index data")
            recent_task = stock_service.get_market_data(
                symbol=index_name,
                data_type='market_index',
                resolution='minute',
                time_range=days_back
            )
            historical_task = stock_service.get_market_data(
                symbol=index_name,
                data_type='market_index',
                resolution='day',
                time_range=years_back
            )
            fetch_indices_tasks.append((index_name, recent_task, historical_task))
        else:
            await log_service.warning(f"Skipping unsupported market index: {index_name}")

    if fetch_indices_tasks:
        await log_service.info(f"Executing {len(fetch_indices_tasks)} market index fetch tasks")
        for index_name, recent_task, historical_task in fetch_indices_tasks:
            recent_data, historical_data = await asyncio.gather(recent_task, historical_task)
            await log_service.info(
                f"Retrieved {len(recent_data)} recent and {len(historical_data)} historical data points for {index_name} index")
            market_indices_data[index_name] = {
                'recent_data': recent_data,
                'historical_data': historical_data
            }
    else:
        await log_service.warning(f"No valid market indices to fetch data for {symbol}")

    if not market_indices_data:
        await log_service.warning(
            f"No market index data was retrieved for {symbol} - recommendations may be less accurate")

    await log_service.info(
        f"Generating recommendation for {symbol} with {len(all_analyzed_articles)} articles and {len(visualization_images)} visualizations")
    recommendation = await recommendation_service.generate_recommendation(
        company_symbol=symbol,
        company_name=company_name,
        analyzed_articles=all_analyzed_articles,
        symbol_recent_prices=stock_prices,
        symbol_historical_prices=historical_prices,
        market_indices_data=market_indices_data,
        visualization_images=visualization_images
    )

    await send_status_update(symbol, 'recommendation', 'complete', 'complete', {
        'recommendation': recommendation,
        'action': recommendation.get('action', 'UNKNOWN'),
        'confidence': recommendation.get('confidence', 0),
        'articles_analyzed': len(all_analyzed_articles),
        'visualizations_used': len(visualization_images)
    })

    return NaNSafeJSONResponse(content=recommendation)


@app.get("/api/historical-recommendation/{symbol}")
async def get_historical_recommendation(symbol: str, count: int = 10, include_images: bool = False,
                                        filter_mode: str = "intelligent", target_date: Optional[str] = None,
                                        current_user: User = Depends(require_tier("premium"))):
    await log_service.api(
        f"GET /api/historical-recommendation/{symbol}?count={count}&include_images={include_images}&filter_mode={filter_mode}&target_date={target_date}")
    recommendations = await cache_service.get_cached_recommendations(
        symbol=symbol,
        limit=count,
        filter_mode=filter_mode,
        target_date=target_date,
        include_images=include_images
    )
    return NaNSafeJSONResponse(content=recommendations)


@app.get("/api/market-data")
async def get_stock_or_index_data(symbol: str, data_type: str, time_frame: str, duration: int = 7,
                                  current_user: User = Depends(require_tier("premium"))):
    await log_service.api(
        f"GET /api/market-data?symbol={symbol}&data_type={data_type}&time_frame={time_frame}&duration={duration}")

    if data_type not in ["stock", "index"]:
        return JSONResponse(status_code=400,
                            content={"error": f"Invalid data_type: {data_type}. Must be 'stock' or 'index'"})

    if time_frame not in ["recent", "historical"]:
        return JSONResponse(status_code=400, content={
            "error": f"Invalid time_frame: {time_frame}. Must be 'recent' or 'historical'"})

    if data_type == "index" and symbol.lower() not in stock_service.MARKET_INDEX_PROXIES:
        return JSONResponse(status_code=400, content={
            "error": f"Unsupported market index: {symbol}. Supported indices: {list(stock_service.MARKET_INDEX_PROXIES.keys())}"})

    resolution = "day" if time_frame == "historical" else "minute"
    service_data_type = "market_index" if data_type == "index" else "stock"

    now = time_service.now(pytz.UTC)
    if time_frame == "recent":
        end_date = now
        start_date = now - timedelta(days=duration)
    else:
        end_date = now
        start_date = now - timedelta(days=duration * 365)

    prices_task = stock_service.get_market_data(
        symbol=symbol,
        data_type=service_data_type,
        resolution=resolution,
        time_range=duration
    )

    calendar_task = None
    if data_type == "stock" and time_frame == "recent":
        calendar_task = stock_service.get_trading_calendar(start_date, end_date)

    if calendar_task:
        prices, calendar_data = await asyncio.gather(prices_task, calendar_task)
        if calendar_data is not None:
            calendar_data = calendar_data.to_dict('records')
    else:
        prices = await prices_task
        calendar_data = None

    if not prices:
        await log_service.market(f"No data available for {symbol} {time_frame}")

    for price_point in prices:
        if 'price' in price_point and 'originalPrice' not in price_point:
            price_point['originalPrice'] = price_point['price']

    result_key = "index" if data_type == "index" else "symbol"
    response_data = {result_key: symbol, "prices": prices}

    if calendar_data:
        response_data["calendar"] = calendar_data

    return response_data


@app.get("/api/stock-suggestions")
async def get_stock_suggestions(category: Optional[str] = None, refresh: bool = False,
                                current_user: User = Depends(require_tier("premium"))):
    await log_service.api(f"GET /api/stock-suggestions?category={category}&refresh={refresh}")
    if refresh:
        if category:
            if category == 'trending':
                await company_service.cache.delete(company_service.CACHE_KEY_TRENDING)
            elif category == 'growing':
                await company_service.cache.delete(company_service.CACHE_KEY_GROWING)
            elif category == 'newcomers':
                await company_service.cache.delete(company_service.CACHE_KEY_NEWCOMERS)
        else:
            delete_tasks = [
                company_service.cache.delete(company_service.CACHE_KEY_TRENDING),
                company_service.cache.delete(company_service.CACHE_KEY_GROWING),
                company_service.cache.delete(company_service.CACHE_KEY_NEWCOMERS)
            ]
            await asyncio.gather(*delete_tasks)

    suggestions = await company_service.get_stock_suggestions(category)
    return {"suggestions": suggestions}


@app.get("/api/market-data/refresh")
async def refresh_market_data(current_user: User = Depends(require_tier("premium"))):
    await log_service.api("GET /api/market-data/refresh")

    delete_tasks = [
        company_service.cache.delete(company_service.CACHE_KEY_TRENDING),
        company_service.cache.delete(company_service.CACHE_KEY_GROWING),
        company_service.cache.delete(company_service.CACHE_KEY_NEWCOMERS)
    ]
    await asyncio.gather(*delete_tasks)

    trending_task = company_service._get_trending_stocks()
    growing_task = company_service._get_growing_stocks()
    newcomers_task = company_service._get_newcomer_stocks()

    trending, growing, newcomers = await asyncio.gather(trending_task, growing_task, newcomers_task)

    return {
        "status": "success",
        "message": "Market data refreshed successfully",
        "counts": {
            "trending": len(trending),
            "growing": len(growing),
            "newcomers": len(newcomers)
        }
    }


@app.get("/api/search-stocks")
async def search_stocks(query: Optional[str] = None, current_user: User = Depends(require_tier("admin"))):
    if not query or len(query) < 1:
        return JSONResponse(content={"results": []})
    await log_service.api(f"GET /api/search-stocks?query={query}")
    results = await company_service.search_stocks(query)
    return JSONResponse(content={"results": results})


@app.get("/api/portfolio-recommendation")
async def get_portfolio_recommendation(force_refresh: bool = False,
                                       current_user: User = Depends(require_tier("premium"))):
    await log_service.api(f"GET /api/portfolio-recommendation?force_refresh={force_refresh}")

    recommendation = await portfolio_service.generate_portfolio_recommendation(force_refresh=force_refresh)

    await send_status_update('PORTFOLIO', 'portfolio', 'complete', 'complete', {
        'recommendation': recommendation,
        'opportunities': len(recommendation.get('topOpportunities', [])),
        'processing_complete': True
    })

    return recommendation


@app.get("/api/portfolio-recommendation/history")
async def get_portfolio_recommendation_history(limit: int = 10, current_user: User = Depends(require_tier("premium"))):
    await log_service.api(f"GET /api/portfolio-recommendation/history?limit={limit}")
    recommendations = []
    portfolio_dir = os.path.join(cache_service.cache_dir, 'portfolio')

    if await asyncio.to_thread(os.path.exists, portfolio_dir):
        files = await asyncio.to_thread(os.listdir, portfolio_dir)
        json_files = [f for f in files if f.endswith('.json')]

        file_paths = [os.path.join(portfolio_dir, f) for f in json_files]

        async def get_file_mtime(filepath):
            return await asyncio.to_thread(os.path.getmtime, filepath)

        mtime_tasks = [get_file_mtime(fp) for fp in file_paths]
        mtimes = await asyncio.gather(*mtime_tasks)

        files_with_times = list(zip(file_paths, mtimes))
        files_with_times.sort(key=lambda x: x[1], reverse=True)

        sorted_files = [fp for fp, _ in files_with_times[:limit]]

        async def load_recommendation(filepath):
            try:
                async with aiofiles.open(filepath, 'r') as f:
                    content = await f.read()
                    return await asyncio.to_thread(__import__('json').loads, content)
            except Exception as e:
                await log_service.error(f"Error reading portfolio recommendation file {filepath}: {str(e)}")
                return None

        load_tasks = [load_recommendation(fp) for fp in sorted_files]
        results = await asyncio.gather(*load_tasks)
        recommendations = [r for r in results if r is not None]

    return {"history": recommendations, "count": len(recommendations)}


@app.get("/api/prediction-accuracy/{symbol}")
async def get_prediction_accuracy(symbol: str, include_ai_analysis: bool = False, force_refresh: bool = False,
                                  current_user: User = Depends(require_tier("premium"))):
    await log_service.api(
        f"GET /api/prediction-accuracy/{symbol}?include_ai_analysis={include_ai_analysis}&force_refresh={force_refresh}")

    is_portfolio_mode = symbol.upper() == "ALL"

    limit = 1000 if is_portfolio_mode else 65

    historical_recommendations = await cache_service.get_cached_recommendations(
        symbol=symbol.upper(),
        limit=limit,
        filter_mode="intelligent",
        include_images=False
    )

    if not historical_recommendations:
        return NaNSafeJSONResponse(content={"error": "No historical recommendations found for the given scope."})

    if is_portfolio_mode:
        metrics = await prediction_accuracy_service.get_portfolio_prediction_metrics(
            historical_recommendations,
            bypass_cache=force_refresh
        )
    else:
        metrics = await prediction_accuracy_service.get_symbol_prediction_metrics(
            historical_recommendations,
            bypass_cache=force_refresh
        )

    if include_ai_analysis and is_portfolio_mode:
        await log_service.api("Running Claude analysis on historical prediction data")
        try:
            ai_analysis = await recommendation_service._run_historical_analysis(metrics)
            metrics['ai_analysis'] = ai_analysis
            await log_service.api("Claude historical analysis completed successfully")
        except Exception as e:
            await log_service.error(f"AI analysis for prediction accuracy failed: {str(e)}")
            metrics['ai_analysis_error'] = str(e)

    return NaNSafeJSONResponse(content=metrics)

@app.get("/api/options-data/{symbol}")
async def get_options_data(symbol: str, force_refresh: bool = False, data_view: str = "frontend",
                           force_recalculate: bool = False,
                           current_user: User = Depends(require_tier("premium"))):
    await log_service.api(
        f"GET /api/options-data/{symbol}?force_refresh={force_refresh}&data_view={data_view}&force_recalculate={force_recalculate}")

    options_data = await options_service.get_options_data(
        symbol=symbol,
        data_view=data_view,
        force_refresh=force_refresh,
        force_recalculate=force_recalculate
    )
    return options_data

if __name__ == "__main__":
    import uvicorn
    from uvicorn.config import Config


    async def main():
        port = int(os.environ.get("PORT", 5000))
        await log_service.system(f"Starting server on port {port}")

        config = Config(
            app="app:app",
            host="0.0.0.0",
            port=port,
            reload=False,
            ws_ping_interval=120,
            ws_ping_timeout=300,
            timeout_keep_alive=300
        )
        server = uvicorn.Server(config)
        await server.serve()


    asyncio.run(main())