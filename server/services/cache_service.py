import os
import json
import redis
from redis import asyncio as aioredis
import hashlib
import asyncio
from typing import Dict, Any, Optional, List, Callable
from dataclasses import dataclass, field
from enum import Enum
import base64
from PIL import Image
import io
import pandas as pd
import pytz
from datetime import datetime, date, timedelta
from services import time_service, log_service
import aiofiles
from collections import defaultdict
import time as time_module

class CacheConnectivityError(Exception):
    pass

class FileOperationType(Enum):
    WRITE = "write"
    DELETE = "delete"
    FLUSH_AGGREGATED = "flush_aggregated"

@dataclass
class FileWriteTask:
    operation: FileOperationType
    filepath: str
    data: Any = None
    cache_type: str = "generic"
    log_key: str = ""
    retry_count: int = 0
    max_retries: int = 5
    created_at: float = field(default_factory=lambda: asyncio.get_event_loop().time())

class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime, date, pd.Timestamp)):
            return obj.isoformat()
        elif isinstance(obj, pd.DataFrame):
            return obj.to_dict('records')
        elif pd.isna(obj):
            return None
        return super().default(obj)

class AggregatedDataManager:
    def __init__(self, flush_interval: int = 10, flush_threshold: int = 100):
        self.data = defaultdict(dict)
        self.operation_counts = defaultdict(int)
        self.last_flush = defaultdict(float)
        self.flush_interval = flush_interval
        self.flush_threshold = flush_threshold
        self.lock = asyncio.Lock()

    async def add(self, filepath: str, key: str, value: Any) -> bool:
        async with self.lock:
            self.data[filepath][key] = value
            self.operation_counts[filepath] += 1
            if filepath not in self.last_flush:
                self.last_flush[filepath] = time_module.time()
            return (self.operation_counts[filepath] >= self.flush_threshold or
                    (time_module.time() - self.last_flush[filepath]) >= self.flush_interval)

    async def get_and_reset(self, filepath: str) -> Optional[Dict]:
        async with self.lock:
            if filepath not in self.data:
                return None
            data = self.data[filepath].copy()
            del self.data[filepath]
            self.operation_counts[filepath] = 0
            self.last_flush[filepath] = time_module.time()
            return data

    async def get_all_pending(self) -> Dict[str, Dict]:
        async with self.lock:
            result = {fp: data.copy() for fp, data in self.data.items() if data}
            self.data.clear()
            self.operation_counts.clear()
            return result

class CacheService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CacheService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self.cache_dir = 'cache'
        self.redis_client: Optional[aioredis.Redis] = None
        self.file_backup_enabled = True
        self.redis_available = False
        self._redis_initialized = False
        self.redis_semaphore = asyncio.Semaphore(100)
        self.file_write_queue: asyncio.Queue = asyncio.Queue(maxsize=5000)
        self.file_write_workers: List[asyncio.Task] = []
        self.aggregated_manager = AggregatedDataManager(flush_interval=10, flush_threshold=100)
        self.aggregated_flush_task: Optional[asyncio.Task] = None
        self.queue_monitor_task: Optional[asyncio.Task] = None
        self.shutdown_event = asyncio.Event()

        self.DEFAULT_EXPIRY = {
            'stocks': 30 * 24 * 60 * 60, 'stocks_historical': 6 * 30 * 24 * 60 * 60,
            'earnings': 24 * 60 * 60, 'response': 60 * 60, 'portfolio': 72 * 60 * 60,
            'prediction_accuracy': 8 * 60 * 60, 'options_tier1': 1 * 60 * 60,
            'options_tier2': 6 * 30 * 24 * 60 * 60, 'generic': 7 * 24 * 60 * 60,
            'articles': 90 * 24 * 60 * 60, 'relevance': 90 * 24 * 60 * 60,
            'analysis': 90 * 24 * 60 * 60, 'companies': 90 * 24 * 60 * 60,
            'recommendations': 180 * 24 * 60 * 60
        }

        self._create_cache_directories()
        self._initialized = True

    async def initialize(self):
        if self._redis_initialized:
            await log_service.system("CacheService already initialized - skipping")
            return

        for i in range(3):
            self.file_write_workers.append(asyncio.create_task(self._file_write_worker(i)))

        self.aggregated_flush_task = asyncio.create_task(self._aggregated_flush_monitor())
        self.queue_monitor_task = asyncio.create_task(self._queue_monitor())

        try:
            redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
            self.redis_client = aioredis.from_url(
                redis_url, decode_responses=True, max_connections=150,
                socket_keepalive=True, socket_connect_timeout=5,
                retry_on_timeout=True, health_check_interval=30
            )

            await self._test_redis_connection()
            await log_service.system(f"Redis connected successfully: {redis_url}")
            asyncio.create_task(self._redis_health_monitor())

            cache_types = ['articles', 'relevance', 'analysis', 'companies', 'recommendations', 'options',
                           'stocks', 'stocks_historical', 'earnings', 'portfolio', 'response', 'generic']
            counts = await asyncio.gather(*[self._count_redis_keys(ct) for ct in cache_types])
            total_keys = sum(counts)

            if total_keys == 0:
                await log_service.system("No Redis data found - starting migration...")
                await self._migrate_files_to_redis()
                await log_service.system("Migration completed")
            else:
                await log_service.system(f"Redis already contains {total_keys} keys - skipping migration")

            self._redis_initialized = True
            await self._log_cache_stats()
            await log_service.system("CacheService initialized successfully")

        except Exception as e:
            await log_service.error(f"Redis initialization failed: {str(e)}")
            await log_service.system("Falling back to file-only mode")
            self.redis_available = False
            self._redis_initialized = False
            await self._log_cache_stats()

    async def shutdown(self):
        await log_service.system("CacheService shutting down...")
        self.shutdown_event.set()

        await self.flush_aggregated_data()

        for worker in self.file_write_workers:
            worker.cancel()
        await asyncio.gather(*self.file_write_workers, return_exceptions=True)

        if self.aggregated_flush_task:
            self.aggregated_flush_task.cancel()
        if self.queue_monitor_task:
            self.queue_monitor_task.cancel()

        await log_service.system("CacheService shutdown complete")

    async def _count_redis_keys(self, cache_type: str) -> int:
        pattern = f"cache:{cache_type}:*"
        count = 0
        cursor = '0'
        async with self.redis_semaphore:
            while cursor != 0:
                cursor, keys = await self.redis_client.scan(cursor=cursor, match=pattern, count=1000)
                count += len(keys)
        return count

    async def _aggregated_flush_monitor(self):
        await log_service.system("Aggregated flush monitor started")
        while not self.shutdown_event.is_set():
            try:
                await asyncio.sleep(10)
                pending = await self.aggregated_manager.get_all_pending()
                if pending:
                    await log_service.system(f"Auto-saving {len(pending)} aggregated files to disk")
                    for filepath, data in pending.items():
                        try:
                            await asyncio.wait_for(
                                self.file_write_queue.put(FileWriteTask(
                                    operation=FileOperationType.FLUSH_AGGREGATED,
                                    filepath=filepath, data=data, cache_type='aggregated'
                                )),
                                timeout=5.0
                            )
                        except asyncio.TimeoutError:
                            await log_service.error(f"Queue full, dropping aggregated flush for {filepath}")
            except asyncio.CancelledError:
                break
            except Exception as e:
                await log_service.error(f"Aggregated flush monitor error: {str(e)}")

    async def _file_write_worker(self, worker_id: int):
        await log_service.system(f"File write worker {worker_id} started")
        operations_completed = 0

        while not self.shutdown_event.is_set():
            try:
                try:
                    task = await asyncio.wait_for(self.file_write_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                operations_completed += 1

                if operations_completed % 100 == 0:
                    await log_service.system(f"Worker {worker_id}: {operations_completed} files saved")

                try:
                    if task.operation == FileOperationType.DELETE:
                        await self._execute_file_delete(task)
                    else:
                        merge = task.operation == FileOperationType.FLUSH_AGGREGATED
                        await self._execute_file_operation(task, merge)
                except Exception as e:
                    await log_service.error(f"Worker {worker_id} failed for {task.filepath}: {str(e)}")
                    if task.retry_count < task.max_retries:
                        task.retry_count += 1
                        await asyncio.sleep(min(2 ** task.retry_count, 30))
                        try:
                            await asyncio.wait_for(self.file_write_queue.put(task), timeout=1.0)
                        except asyncio.TimeoutError:
                            await log_service.error(f"Could not requeue {task.filepath} - queue full")
                    else:
                        await log_service.error(f"CRITICAL: Failed after {task.max_retries} retries: {task.filepath}")

            except asyncio.CancelledError:
                break
            except Exception as e:
                await log_service.error(f"Worker {worker_id} unexpected error: {str(e)}")
                await asyncio.sleep(1)

        await log_service.system(f"Worker {worker_id} stopped after {operations_completed} operations")

    async def _execute_file_operation(self, task: FileWriteTask, merge: bool = False):
        data_to_write = task.data

        if merge and os.path.exists(task.filepath):
            try:
                async with aiofiles.open(task.filepath, 'r', encoding='utf-8') as f:
                    existing = json.loads(await f.read())
                    existing.update(task.data)
                    data_to_write = existing
            except Exception as e:
                await log_service.warning(f"Could not read existing file {task.filepath}: {str(e)}")

        for attempt in range(3):
            temp_filepath = f"{task.filepath}.tmp.{os.getpid()}"
            try:
                os.makedirs(os.path.dirname(task.filepath), exist_ok=True)
                async with aiofiles.open(temp_filepath, 'w', encoding='utf-8') as f:
                    await f.write(json.dumps(data_to_write, cls=DateTimeEncoder))
                    await f.flush()

                os.replace(temp_filepath, task.filepath)

                if merge:
                    await log_service.cache(
                        f"[AGGREGATED] Saved {len(task.data)} entries: {os.path.basename(task.filepath)}")
                return
            except (OSError, PermissionError) as e:
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                raise
            finally:
                if os.path.exists(temp_filepath):
                    try:
                        os.remove(temp_filepath)
                    except:
                        pass

    async def _execute_file_delete(self, task: FileWriteTask):
        if os.path.exists(task.filepath):
            try:
                os.remove(task.filepath)
            except:
                pass

    async def _queue_monitor(self):
        await log_service.system("Queue monitor started")
        last_warning_size = 0
        while not self.shutdown_event.is_set():
            try:
                await asyncio.sleep(30)
                queue_size = self.file_write_queue.qsize()
                if queue_size > 1000:
                    await log_service.warning(f"File save queue size: {queue_size}")
                    last_warning_size = queue_size if queue_size > last_warning_size else last_warning_size
                elif queue_size < 500:
                    last_warning_size = 0
            except asyncio.CancelledError:
                break
            except Exception as e:
                await log_service.error(f"Queue monitor error: {str(e)}")

    async def _test_redis_connection(self):
        try:
            await self.redis_client.ping()
            info = await self.redis_client.info()
            await log_service.system(f"Redis health check passed - version: {info.get('redis_version')}")
            if not self.redis_available:
                await log_service.error("!!! REDIS IS BACK ONLINE !!!")
            self.redis_available = True
        except Exception as e:
            if self.redis_available:
                await log_service.error(f"!!! REDIS WENT DOWN: {str(e)} !!!")
            self.redis_available = False
            raise

    async def _redis_health_monitor(self):
        while True:
            await asyncio.sleep(30)
            try:
                if self.redis_client:
                    await self._test_redis_connection()
            except asyncio.CancelledError:
                break
            except Exception as e:
                await log_service.error(f"!!! REDIS HEALTH CHECK FAILED: {str(e)} !!!")
                self.redis_available = False

    def _create_cache_directories(self):
        for subdir in ['articles', 'relevance', 'analysis', 'companies', 'stocks', 'stocks_historical',
                       'generic', 'recommendations', 'recommendation_images', 'options', 'earnings',
                       'portfolio', 'response']:
            os.makedirs(os.path.join(self.cache_dir, subdir), exist_ok=True)

    async def _log_cache_stats(self):
        total_files = 0
        for cache_type in ['articles', 'relevance', 'analysis', 'companies', 'stocks', 'stocks_historical',
                           'generic', 'recommendations', 'recommendation_images', 'options', 'earnings',
                           'portfolio', 'response']:
            dir_path = os.path.join(self.cache_dir, cache_type)
            if os.path.exists(dir_path):
                files = await asyncio.to_thread(os.listdir, dir_path)
                total_files += len(files)

        if self.redis_available:
            try:
                cache_types = ['articles', 'relevance', 'analysis', 'companies', 'stocks', 'stocks_historical',
                               'generic', 'recommendations', 'options', 'earnings', 'portfolio', 'response']
                counts = await asyncio.gather(*[self._count_redis_keys(ct) for ct in cache_types])
                total_redis = sum(counts)
                await log_service.cache(f"Cache status: {total_files} files, {total_redis} Redis keys")
            except Exception as e:
                await log_service.error(f"Error getting Redis stats: {str(e)}")
                await log_service.cache(f"Cache status: {total_files} files")
        else:
            await log_service.cache(f"Cache status (files only): {total_files} files")

    def _get_key_hash(self, key: str) -> str:
        return hashlib.md5(key.lower().strip().encode('utf-8')).hexdigest()[:10]

    def _get_safe_filename(self, key: str) -> str:
        if not key:
            return "empty_key"
        normalized = key.lower().strip()
        readable = normalized[:40] if len(normalized) > 40 else normalized
        for char in '/:?&="%\'|\\<>*+ ':
            readable = readable.replace(char, '_')
        return f"{readable}_{self._get_key_hash(key)}"

    async def _redis_operation(self, operation: Callable, error_context: str = "Redis operation"):
        if not self.redis_available:
            await log_service.error(f"!!! REDIS UNAVAILABLE - {error_context} !!!")
            raise CacheConnectivityError(f"Redis unavailable for {error_context}")
        try:
            async with self.redis_semaphore:
                return await operation()
        except redis.RedisError as e:
            await log_service.error(f"!!! {error_context} failed: {str(e)} !!!")
            self.redis_available = False
            raise CacheConnectivityError(error_context) from e

    async def _get_cached_data_from_redis(self, cache_type: str, log_key: str, redis_key: str,
                                          expiry_seconds: Optional[int] = None) -> Optional[Any]:
        cached_data_str = await self._redis_operation(
            lambda: self.redis_client.get(redis_key),
            f"Redis read for {cache_type}"
        )

        if not cached_data_str:
            await log_service.cache(f"[{cache_type.upper()}] ✗ MISS '{log_key[:30]}...'")
            return None

        data = json.loads(cached_data_str)
        now = int(time_service.timestamp())

        if expiry_seconds is None:
            await log_service.cache(f"[{cache_type.upper()}] ✓ REDIS '{log_key[:30]}...'")
            return data

        def _get_cached_at(item):
            try:
                return int(item.get('cached_at', now)) if isinstance(item, dict) else now
            except:
                return now

        if isinstance(data, dict) and 'cached_at' not in data and any(isinstance(v, dict) for v in data.values()):
            filtered = {k: v for k, v in data.items()
                        if isinstance(v, dict) and now - _get_cached_at(v) <= expiry_seconds}
            if not filtered:
                await log_service.cache(f"[{cache_type.upper()}] ✗ EXPIRED '{log_key[:30]}...'")
                return None
            await log_service.cache(f"[{cache_type.upper()}] ✓ REDIS '{log_key[:30]}...'")
            return filtered

        if isinstance(data, dict) and now - _get_cached_at(data) > expiry_seconds:
            await log_service.cache(f"[{cache_type.upper()}] ✗ EXPIRED '{log_key[:30]}...'")
            return None

        await log_service.cache(f"[{cache_type.upper()}] ✓ REDIS '{log_key[:30]}...'")
        return data

    async def _set_redis_data(self, redis_key: str, data: Any, expiry_seconds: int) -> bool:
        try:
            await self._redis_operation(
                lambda: self.redis_client.setex(redis_key, expiry_seconds, json.dumps(data, cls=DateTimeEncoder)),
                f"Redis write for {redis_key}"
            )
            return True
        except CacheConnectivityError:
            return False
        except Exception as e:
            await log_service.error(f"!!! NON-REDIS ERROR IN CACHE WRITE: {str(e)} !!!")
            return False

    async def _cache_value_wrapper(self, cache_type: str, key: str, data: Any,
                                   expiry_seconds: Optional[int] = None,
                                   subdir: Optional[str] = None) -> bool:
        try:
            expiry = expiry_seconds if expiry_seconds is not None else self.DEFAULT_EXPIRY.get(cache_type,
                                                                                               self.DEFAULT_EXPIRY[
                                                                                                   'generic'])
            data_to_cache = {'value': data, 'cached_at': int(time_service.timestamp())}
            redis_key = f"cache:{cache_type}:{key}"

            success_redis = await self._set_redis_data(redis_key, data_to_cache, expiry)

            if self.file_backup_enabled:
                filepath = os.path.join(self.cache_dir, subdir or cache_type, f"{self._get_safe_filename(key)}.json")
                try:
                    await asyncio.wait_for(
                        self.file_write_queue.put(FileWriteTask(
                            operation=FileOperationType.WRITE, filepath=filepath,
                            data=data_to_cache, cache_type=cache_type, log_key=key
                        )),
                        timeout=2.0
                    )
                except asyncio.TimeoutError:
                    await log_service.warning(f"File write queue full, skipping disk backup for {key[:30]}")

            if success_redis:
                await log_service.cache(f"[{cache_type.upper()}] + CACHED '{key[:30]}...'")

            return success_redis or self.file_backup_enabled
        except Exception as e:
            await log_service.error(f"Error caching {cache_type}: {e}")
            return False

    async def _get_cached_value_wrapper(self, cache_type: str, key: str,
                                        expiry_seconds: Optional[int] = None) -> Optional[Any]:
        redis_key = f"cache:{cache_type}:{key}"
        data = await self._get_cached_data_from_redis(cache_type, key, redis_key, expiry_seconds)
        return data.get('value') if data else None

    async def _cache_with_aggregation(self, cache_type: str, title: str, symbol: str,
                                      data: Dict[str, Any], log_message: str) -> bool:
        try:
            dict_key = f"{title}_{symbol}"
            safe_key = self._get_key_hash(dict_key)
            data.update({'cached_at': int(time_service.timestamp()), 'title': title, 'dict_key': dict_key})

            redis_key = f"cache:{cache_type}:{symbol}:{safe_key}"
            success_redis = await self._set_redis_data(redis_key, data, self.DEFAULT_EXPIRY[cache_type])

            if self.file_backup_enabled:
                filepath = os.path.join(self.cache_dir, cache_type, f"{self._get_safe_filename(symbol)}.json")
                if await self.aggregated_manager.add(filepath, safe_key, data):
                    if data_to_flush := await self.aggregated_manager.get_and_reset(filepath):
                        try:
                            await asyncio.wait_for(
                                self.file_write_queue.put(FileWriteTask(
                                    operation=FileOperationType.FLUSH_AGGREGATED, filepath=filepath,
                                    data=data_to_flush, cache_type=cache_type,
                                    log_key=f"{symbol} (saving {len(data_to_flush)} items)"
                                )),
                                timeout=2.0
                            )
                        except asyncio.TimeoutError:
                            await log_service.warning(f"Queue full, could not flush aggregated data for {symbol}")

            if success_redis:
                await log_service.cache(log_message)
            return success_redis or self.file_backup_enabled
        except Exception as e:
            await log_service.error(f"Error caching {cache_type}: {e}")
            return False

    async def cache_stocks(self, key: str, data: Any, expiry_seconds: int = None) -> bool:
        return await self._cache_value_wrapper('stocks', key, data, expiry_seconds, 'stocks')

    async def get_cached_stocks(self, key: str) -> Optional[Any]:
        return await self._get_cached_value_wrapper('stocks', key)

    async def cache_stocks_historical(self, key: str, data: Any, expiry_seconds: int = None) -> bool:
        return await self._cache_value_wrapper('stocks_historical', key, data, expiry_seconds, 'stocks_historical')

    async def get_cached_stocks_historical(self, key: str) -> Optional[Any]:
        return await self._get_cached_value_wrapper('stocks_historical', key)

    async def cache_earnings(self, symbol: str, earnings_data: Any, expiry_seconds: int = None) -> bool:
        return await self._cache_value_wrapper('earnings', f"earnings_{symbol.upper()}", earnings_data, expiry_seconds,
                                               'earnings')

    async def get_cached_earnings(self, symbol: str) -> Optional[Any]:
        return await self._get_cached_value_wrapper('earnings', f"earnings_{symbol.upper()}")

    async def cache_response(self, cache_key: str, response_data: Any, expiry_seconds: int = None) -> bool:
        return await self._cache_value_wrapper('response', cache_key, response_data, expiry_seconds, 'response')

    async def get_cached_response(self, cache_key: str, expiry_seconds: int = None) -> Optional[Any]:
        return await self._get_cached_value_wrapper('response', cache_key,
                                                    expiry_seconds if expiry_seconds is not None else
                                                    self.DEFAULT_EXPIRY['response'])

    async def cache_prediction_accuracy(self, key: str, data: Any, expiry_seconds: int = None) -> bool:
        return await self._cache_value_wrapper('prediction_accuracy', key, data, expiry_seconds, 'prediction_accuracy')

    async def get_cached_prediction_accuracy(self, key: str, expiry_seconds: int = None) -> Optional[Any]:
        return await self._get_cached_value_wrapper('prediction_accuracy', key, expiry_seconds)

    async def cache_portfolio(self, data: Any, expiry_seconds: int = None) -> bool:
        return await self._cache_value_wrapper('portfolio', 'portfolio_recommendation', data, expiry_seconds,
                                               'portfolio')

    async def get_cached_portfolio(self, expiry_seconds: int = None) -> Optional[Any]:
        return await self._get_cached_value_wrapper('portfolio', 'portfolio_recommendation',
                                                    expiry_seconds if expiry_seconds is not None else
                                                    self.DEFAULT_EXPIRY['portfolio'])

    async def cache_article(self, article: Dict[str, Any]) -> bool:
        if not article or 'title' not in article:
            await log_service.warning("Cannot cache article - missing title")
            return False
        try:
            title = article['title']
            article['cached_at'] = int(time_service.timestamp())
            redis_key = f"cache:articles:{self._get_key_hash(title)}"
            success_redis = await self._set_redis_data(redis_key, article, self.DEFAULT_EXPIRY['articles'])

            if self.file_backup_enabled:
                filepath = os.path.join(self.cache_dir, 'articles', f"{self._get_safe_filename(title)}.json")
                try:
                    await asyncio.wait_for(
                        self.file_write_queue.put(FileWriteTask(
                            operation=FileOperationType.WRITE, filepath=filepath,
                            data=article, cache_type='article', log_key=title
                        )),
                        timeout=2.0
                    )
                except asyncio.TimeoutError:
                    await log_service.warning(f"Queue full, skipping article disk backup: {title[:30]}")

            if success_redis:
                await log_service.cache(f"[ARTICLE] + CACHED '{title[:30]}...'")
            return success_redis or self.file_backup_enabled
        except Exception as e:
            await log_service.error(f"Error caching article: {e}")
            return False

    async def get_cached_article(self, title: str) -> Optional[Dict[str, Any]]:
        redis_key = f"cache:articles:{self._get_key_hash(title)}"
        article = await self._get_cached_data_from_redis('article', title, redis_key, self.DEFAULT_EXPIRY['articles'])
        if article:
            article['_from_cache'] = True
        return article

    async def cache_relevance(self, title: str, symbol: str, is_relevant: bool) -> bool:
        return await self._cache_with_aggregation('relevance', title, symbol, {'is_relevant': is_relevant},
                                                  f"[RELEVANCE:{symbol}] + CACHED '{title[:30]}...' → {is_relevant}")

    async def get_cached_relevance(self, title: str, symbol: str) -> Optional[bool]:
        redis_key = f"cache:relevance:{symbol}:{self._get_key_hash(f'{title}_{symbol}')}"
        result = await self._get_cached_data_from_redis(f"relevance:{symbol}", title, redis_key,
                                                        self.DEFAULT_EXPIRY['relevance'])
        if result:
            is_relevant = result.get('is_relevant')
            await log_service.cache(f"[RELEVANCE:{symbol}] {'✓' if is_relevant else '⚠'} REDIS '{title[:30]}...'")
            return is_relevant
        await log_service.cache(f"[RELEVANCE:{symbol}] ✗ MISS '{title[:30]}...'")
        return None

    async def cache_analysis(self, title: str, symbol: str, analysis_result: Dict[str, Any]) -> bool:
        score = analysis_result.get('sentimentScore', 'N/A')
        return await self._cache_with_aggregation('analysis', title, symbol, analysis_result,
                                                  f"[SENTIMENT:{symbol}] + CACHED '{title[:30]}...' ({score})")

    async def get_cached_analysis(self, title: str, symbol: str) -> Optional[Dict[str, Any]]:
        redis_key = f"cache:analysis:{symbol}:{self._get_key_hash(f'{title}_{symbol}')}"
        result = await self._get_cached_data_from_redis(f"sentiment:{symbol}", title, redis_key,
                                                        self.DEFAULT_EXPIRY['analysis'])
        if result:
            await log_service.cache(
                f"[SENTIMENT:{symbol}] ✓ REDIS '{title[:30]}...' ({result.get('sentimentScore', 'N/A')})")
        else:
            await log_service.cache(f"[SENTIMENT:{symbol}] ✗ MISS '{title[:30]}...'")
        return result

    async def cache_company(self, symbol: str, company_info: Dict[str, Any]) -> bool:
        try:
            company_info['cached_at'] = int(time_service.timestamp())
            redis_key = f"cache:companies:{symbol}"
            success_redis = await self._set_redis_data(redis_key, company_info, self.DEFAULT_EXPIRY['companies'])

            if self.file_backup_enabled:
                filepath = os.path.join(self.cache_dir, 'companies', f"{self._get_safe_filename(symbol)}.json")
                try:
                    await asyncio.wait_for(
                        self.file_write_queue.put(FileWriteTask(
                            operation=FileOperationType.WRITE, filepath=filepath,
                            data=company_info, cache_type='company', log_key=symbol
                        )),
                        timeout=2.0
                    )
                except asyncio.TimeoutError:
                    await log_service.warning(f"Queue full, skipping company disk backup: {symbol}")

            if success_redis:
                await log_service.cache(f"[COMPANY] + CACHED '{symbol}'")
            return success_redis or self.file_backup_enabled
        except Exception as e:
            await log_service.error(f"Error caching company: {e}")
            return False

    async def get_cached_company(self, symbol: str) -> Optional[Dict[str, Any]]:
        return await self._get_cached_data_from_redis('company', symbol, f"cache:companies:{symbol}",
                                                      self.DEFAULT_EXPIRY['companies'])

    async def cache_recommendation(self, symbol: str, recommendation: Dict[str, Any],
                                   images: List[Dict[str, Any]] = None) -> bool:
        try:
            timestamp = recommendation.get('cached_at', int(time_service.timestamp()))
            rec_id = f"{self._get_safe_filename(symbol)}_{timestamp}"

            rec_data = recommendation.copy()
            rec_data.update({
                'cached_at': timestamp, 'has_images': bool(images),
                'image_count': len(images) if images else 0, 'rec_id': rec_id
            })

            manifest = None
            if images and self.file_backup_enabled:
                image_dir = os.path.join(self.cache_dir, 'recommendation_images', rec_id)
                os.makedirs(image_dir, exist_ok=True)
                saved_images = []
                for idx, img in enumerate(images):
                    if isinstance(img, dict) and 'category' in img and 'data' in img:
                        filename = f"{img['category'].lower().replace(' ', '_')}_{idx}.webp"
                        if self._save_image_as_webp(img['data'], os.path.join(image_dir, filename)):
                            saved_images.append({
                                'filename': filename, 'category': img['category'],
                                'index': idx, 'destination': img.get('destination', 'unknown')
                            })
                if saved_images:
                    manifest = {'images': saved_images, 'count': len(saved_images), 'created_at': timestamp}

            expiry = self.DEFAULT_EXPIRY['recommendations']
            success_redis = True

            if self.redis_available:
                if not await self._set_redis_data(f"cache:recommendations:{symbol}:{timestamp}", rec_data, expiry):
                    success_redis = False
                if manifest and not await self._set_redis_data(f"cache:recommendation_images:{symbol}:{timestamp}",
                                                               manifest, expiry):
                    success_redis = False

            if self.file_backup_enabled:
                try:
                    await asyncio.wait_for(
                        self.file_write_queue.put(FileWriteTask(
                            operation=FileOperationType.WRITE,
                            filepath=os.path.join(self.cache_dir, 'recommendations', f"{rec_id}.json"),
                            data=rec_data, cache_type='recommendation', log_key=symbol
                        )),
                        timeout=2.0
                    )
                    if manifest:
                        await asyncio.wait_for(
                            self.file_write_queue.put(FileWriteTask(
                                operation=FileOperationType.WRITE,
                                filepath=os.path.join(self.cache_dir, 'recommendation_images', rec_id, 'manifest.json'),
                                data=manifest, cache_type='recommendation_images', log_key=symbol
                            )),
                            timeout=2.0
                        )
                except asyncio.TimeoutError:
                    await log_service.warning(f"Queue full, skipping recommendation disk backup: {symbol}")

            if success_redis or self.file_backup_enabled:
                await log_service.cache(
                    f"[RECOMMENDATION] + CACHED '{symbol}' with {len(images) if images else 0} images")
                return True
            return False
        except Exception as e:
            await log_service.error(f"Error caching recommendation for '{symbol}': {str(e)}")
            return False

    def _save_image_as_webp(self, base64_data: str, filepath: str) -> bool:
        try:
            if ',' in base64_data:
                base64_data = base64_data.split(',')[1]
            img = Image.open(io.BytesIO(base64.b64decode(base64_data)))
            if img.mode in ('RGBA', 'LA'):
                bg = Image.new('RGB', img.size, (255, 255, 255))
                bg.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else img.split()[1])
                img = bg
            elif img.mode not in ('RGB', 'L'):
                img = img.convert('RGB')
            img.save(filepath, 'WEBP', quality=85, method=6)
            return True
        except Exception as e:
            asyncio.create_task(log_service.error(f"Error saving image: {str(e)}"))
            return False

    async def _load_image_as_base64(self, filepath: str) -> Optional[str]:
        try:
            async with aiofiles.open(filepath, 'rb') as f:
                image_bytes = await f.read()

            def process():
                with Image.open(io.BytesIO(image_bytes)) as img:
                    buffer = io.BytesIO()
                    img.save(buffer, format='PNG')
                    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('utf-8')}"

            return await asyncio.to_thread(process)
        except Exception as e:
            await log_service.error(f"Error loading image: {str(e)}")
            return None

    async def get_cached_recommendations(self, symbol: str, limit: int = 10, filter_mode: str = "intelligent",
                                         target_date: Optional[str] = None, include_images: bool = True) -> List[Dict]:
        try:
            if not self.redis_available:
                return []

            eastern_tz = pytz.timezone('US/Eastern')

            def _parse_iso(ts: str):
                try:
                    return datetime.fromisoformat((ts or '').replace('Z', '+00:00'))
                except:
                    return datetime.min.replace(tzinfo=pytz.UTC)

            def _target_et_date(rec: dict):
                if ttd := rec.get('target_trading_datetime'):
                    try:
                        dt = datetime.fromisoformat(ttd.replace('Z', '+00:00'))
                        return (eastern_tz.localize(dt) if dt.tzinfo is None else dt).astimezone(eastern_tz).date()
                    except:
                        pass
                if ts := rec.get('timestamp'):
                    try:
                        return _parse_iso(ts).astimezone(eastern_tz).date()
                    except:
                        pass
                return time_service.now(eastern_tz).date()

            if filter_mode == "target_date" and target_date:
                cached = await self._redis_operation(
                    lambda: self.redis_client.get(f"cache:recommendations:{symbol}:{target_date}"),
                    "Get specific recommendation"
                )
                if not cached:
                    return []
                rec = json.loads(cached)
                if include_images and rec.get('cached_at'):
                    sym = symbol if symbol != "ALL" else rec.get('rawData', {}).get('company', {}).get('symbol', '')
                    if sym and (images := await self._load_recommendation_images(sym, rec['cached_at'])):
                        rec['images'] = images
                return [rec]

            pattern = f"cache:recommendations:*" if symbol == "ALL" else f"cache:recommendations:{symbol}:*"
            keys = []
            cursor = '0'
            async with self.redis_semaphore:
                while cursor != 0:
                    cursor, batch = await self.redis_client.scan(cursor=cursor, match=pattern, count=1000)
                    keys.extend(batch)

            if not keys:
                return []

            async def _load(key):
                try:
                    async with self.redis_semaphore:
                        if data := await self.redis_client.get(key):
                            return json.loads(data)
                except:
                    pass
                return None

            all_recs = [r for r in await asyncio.gather(*[_load(k) for k in keys]) if r]

            if filter_mode == "intelligent":
                today = time_service.now(eastern_tz).date()
                daily_groups = defaultdict(list)
                for rec in all_recs:
                    day = _target_et_date(rec)
                    if day < today:
                        daily_groups[day].append(rec)

                selected = []
                for recs in daily_groups.values():
                    symbol_groups = defaultdict(list)
                    for rec in recs:
                        if sym := (rec.get('rawData', {}).get('company', {}).get('symbol') or
                                   rec.get('symbol') or rec.get('company_symbol')):
                            symbol_groups[sym].append(rec)

                    for grp in symbol_groups.values():
                        grp.sort(key=lambda r: abs((_parse_iso(r.get('target_trading_datetime')) -
                                                    datetime.fromtimestamp(r.get('cached_at', 0),
                                                                           tz=pytz.UTC)).total_seconds()))
                        selected.append(grp[0])

                selected.sort(key=lambda r: r.get('target_trading_datetime', ''), reverse=True)
                all_recs = selected[:limit]

            elif filter_mode == "portfolio":
                cutoff = time_service.now(eastern_tz) - timedelta(hours=24)
                all_recs = [r for r in all_recs if _parse_iso(r.get('timestamp')) >= cutoff]
                portfolio_groups = {}
                for rec in all_recs:
                    sym = rec.get('rawData', {}).get('company', {}).get('symbol', rec.get('symbol', 'UNKNOWN')).upper()
                    if sym not in portfolio_groups or rec.get('timestamp', '') > portfolio_groups[sym].get('timestamp',
                                                                                                           ''):
                        portfolio_groups[sym] = rec
                all_recs = sorted(portfolio_groups.values(), key=lambda r: r.get('timestamp', ''), reverse=True)

            else:
                all_recs.sort(key=lambda r: r.get('timestamp', ''), reverse=True)
                if limit:
                    all_recs = all_recs[:limit]

            if include_images:
                async def load_imgs(rec):
                    if ts := rec.get('cached_at'):
                        sym = rec.get('rawData', {}).get('company', {}).get('symbol', '') if symbol == "ALL" else symbol
                        if sym and (imgs := await self._load_recommendation_images(sym, ts)):
                            rec['images'] = imgs
                    return rec

                all_recs = [r for r in await asyncio.gather(*[load_imgs(rec) for rec in all_recs]) if r]

            return all_recs
        except Exception as e:
            await log_service.error(f"Error retrieving recommendations: {str(e)}")
            return []

    async def _load_recommendation_images(self, symbol: str, timestamp: int) -> Optional[List[Dict[str, Any]]]:
        try:
            manifest_data = await self._redis_operation(
                lambda: self.redis_client.get(f"cache:recommendation_images:{symbol}:{timestamp}"),
                "Load image manifest"
            )
            if not manifest_data or not (manifest := json.loads(manifest_data)).get('images'):
                return None

            rec_id = f"{self._get_safe_filename(symbol)}_{timestamp}"
            image_dir = os.path.join(self.cache_dir, 'recommendation_images', rec_id)

            async def load_img(info):
                filepath = os.path.join(image_dir, info['filename'])
                if await asyncio.to_thread(os.path.exists, filepath):
                    if data := await self._load_image_as_base64(filepath):
                        return {'category': info['category'], 'data': data,
                                'index': info['index'], 'destination': info.get('destination', 'unknown')}
                return None

            return [img for img in await asyncio.gather(*[load_img(info) for info in manifest['images']]) if img]
        except Exception as e:
            await log_service.error(f"Error loading images: {str(e)}")
            return None

    async def get_previously_relevant_cached_articles_from_previous_session(self, symbol, limit=None,
                                                                            start_date_utc=None, end_date_utc=None):
        try:
            if not self.redis_available:
                return []

            keys = []
            cursor = '0'
            async with self.redis_semaphore:
                while cursor != 0:
                    cursor, batch = await self.redis_client.scan(cursor=cursor, match=f"cache:relevance:{symbol}:*",
                                                                 count=500)
                    keys.extend(batch)

            async def get_relevance(key):
                if data := await self._get_cached_data_from_redis('symbol_cache', symbol, key):
                    return data.get('title'), data.get('is_relevant', False)
                return None, None

            titles = [res for res in await asyncio.gather(*[get_relevance(k) for k in keys]) if res[0]]
            articles = [a for a in await asyncio.gather(*[self.get_cached_article(t) for t, _ in titles]) if a]

            relevance_map = {t: rel for t, rel in titles}
            for article in articles:
                article['_is_relevant'] = relevance_map.get(article.get('title'))

            if start_date_utc and end_date_utc:
                def in_range(a):
                    if not (pub := a.get('publishedDate')):
                        return False
                    try:
                        dt = datetime.fromisoformat(pub.replace('Z', '+00:00'))
                        dt = dt.astimezone(pytz.UTC) if dt.tzinfo else dt.replace(tzinfo=pytz.UTC)
                        return start_date_utc <= dt < end_date_utc
                    except:
                        return False

                articles = [a for a in articles if in_range(a)]

            articles.sort(key=lambda x: x.get('publishedDate', ''), reverse=True)
            if limit:
                articles = articles[:limit]

            relevant = sum(1 for a in articles if a.get('_is_relevant'))
            await log_service.cache(f"[SYMBOL CACHE] ✓ REDIS {relevant} relevant / {len(articles)} total for {symbol}")
            return articles
        except Exception as e:
            await log_service.error(f"Error retrieving cached articles: {str(e)}")
            return []

    async def cache_options_data(self, symbol: str, date: str, options_data: Any, expiry_seconds: int = None) -> bool:
        try:
            expiry = expiry_seconds or (
                self.DEFAULT_EXPIRY['options_tier1'] if "tier1" in date else self.DEFAULT_EXPIRY['options_tier2'])
            cache_key = f"{symbol}_{date}"
            data = {'value': options_data, 'cached_at': int(time_service.timestamp()), 'symbol': symbol,
                    'date_key': date}

            success_redis = await self._set_redis_data(f"cache:options:{cache_key}", data, expiry)

            if self.file_backup_enabled:
                filepath = os.path.join(self.cache_dir, 'options', f"{self._get_safe_filename(cache_key)}.json")
                try:
                    await asyncio.wait_for(
                        self.file_write_queue.put(FileWriteTask(
                            operation=FileOperationType.WRITE, filepath=filepath,
                            data=data, cache_type='options', log_key=cache_key
                        )),
                        timeout=2.0
                    )
                except asyncio.TimeoutError:
                    await log_service.warning(f"Queue full, skipping options disk backup: {cache_key}")

            if success_redis:
                await log_service.cache(f"[OPTIONS] + CACHED '{cache_key}'")
            return success_redis or self.file_backup_enabled
        except Exception as e:
            await log_service.error(f"Error caching options: {e}")
            return False

    async def get_cached_options_data(self, symbol: str, date: str) -> Optional[Any]:
        data = await self._get_cached_data_from_redis('options', f"{symbol}_{date}", f"cache:options:{symbol}_{date}")
        return data.get('value') if data else None

    async def get_all_cached_company_symbols(self) -> List[str]:
        if not self.redis_available:
            try:
                company_dir = os.path.join(self.cache_dir, 'companies')
                if os.path.exists(company_dir):
                    files = await asyncio.to_thread(os.listdir, company_dir)
                    return list(set(f.split('_')[0].upper() for f in files if f.endswith('.json')))
            except Exception as e:
                await log_service.error(f"Error reading company symbols: {e}")
            return []

        try:
            keys = []
            cursor = '0'
            async with self.redis_semaphore:
                while cursor != 0:
                    cursor, batch = await self.redis_client.scan(cursor=cursor, match="cache:companies:*", count=1000)
                    keys.extend(batch)
            return [k.split(':')[-1] for k in keys]
        except Exception as e:
            await log_service.error(f"Error scanning company symbols: {e}")
            return []

    async def get(self, key: str) -> Optional[Any]:
        return await self._get_cached_value_wrapper('generic', key)

    async def set(self, key: str, value: Any, expiry_seconds: int = None) -> bool:
        return await self._cache_value_wrapper('generic', key, value, expiry_seconds, 'generic')

    async def delete(self, key: str) -> bool:
        redis_key = f"cache:generic:{key}"
        try:
            await self._redis_operation(lambda: self.redis_client.delete(redis_key), "Delete cache key")
            if self.file_backup_enabled:
                filepath = os.path.join(self.cache_dir, 'generic', f"{self._get_safe_filename(key)}.json")
                try:
                    await asyncio.wait_for(
                        self.file_write_queue.put(FileWriteTask(
                            operation=FileOperationType.DELETE, filepath=filepath,
                            cache_type='generic', log_key=key
                        )),
                        timeout=2.0
                    )
                except asyncio.TimeoutError:
                    await log_service.warning(f"Queue full, could not queue delete for {key}")
            return True
        except CacheConnectivityError:
            return False

    async def flush_aggregated_data(self):
        if pending := await self.aggregated_manager.get_all_pending():
            await log_service.system(f"Manually saving {len(pending)} aggregated files")
            for filepath, data in pending.items():
                try:
                    await asyncio.wait_for(
                        self.file_write_queue.put(FileWriteTask(
                            operation=FileOperationType.FLUSH_AGGREGATED,
                            filepath=filepath, data=data, cache_type='aggregated'
                        )),
                        timeout=5.0
                    )
                except asyncio.TimeoutError:
                    await log_service.error(f"Could not flush aggregated data for {filepath} - queue full")

    async def _migrate_files_to_redis(self):
        async def read_json(path):
            async with aiofiles.open(path, 'r', encoding='utf-8') as f:
                return json.loads(await f.read())

        async def migrate_simple(cache_type: str, get_redis_key: Callable):
            cache_dir = os.path.join(self.cache_dir, cache_type)
            if not os.path.exists(cache_dir):
                return 0, 0

            files = await asyncio.to_thread(lambda: [f for f in os.listdir(cache_dir) if f.endswith('.json')])
            expiry = self.DEFAULT_EXPIRY.get(cache_type, self.DEFAULT_EXPIRY['generic'])
            count, errors = 0, 0

            for filename in files:
                try:
                    data = await read_json(os.path.join(cache_dir, filename))
                    key = get_redis_key(filename, data)

                    async def set_operation():
                        await self.redis_client.setex(key, expiry, json.dumps(data, cls=DateTimeEncoder))

                    await self._redis_operation(set_operation, f"Migrate {cache_type}")
                    count += 1
                except Exception as e:
                    await log_service.error(f"Error migrating {cache_type} {filename}: {str(e)}")
                    errors += 1

            await log_service.system(f"[MIGRATION] {cache_type.capitalize()}: {count} migrated, {errors} errors")
            return count, errors

        async def migrate_aggregated(cache_type: str):
            cache_dir = os.path.join(self.cache_dir, cache_type)
            if not os.path.exists(cache_dir):
                return 0, 0

            files = await asyncio.to_thread(lambda: [f for f in os.listdir(cache_dir) if f.endswith('.json')])
            expiry = self.DEFAULT_EXPIRY[cache_type]
            count, errors = 0, 0

            for filename in files:
                batch_operations = []
                try:
                    data_dict = await read_json(os.path.join(cache_dir, filename))
                    parts = filename.replace('.json', '').split('_')
                    symbol = ('GLOBAL_MARKET' if parts[0] == 'global' else
                              f"INDUSTRY_{parts[1].upper()}" if parts[0] == 'industry' else parts[0].upper())

                    for item in data_dict.values():
                        if isinstance(item, dict):
                            if 'cached_at' not in item:
                                item['cached_at'] = int(time_service.timestamp())
                            if title := item.get('title'):
                                key = f"cache:{cache_type}:{symbol}:{self._get_key_hash(f'{title}_{symbol}')}"
                                batch_operations.append((key, item))

                    for key, item in batch_operations:
                        try:
                            async with self.redis_semaphore:
                                await self.redis_client.setex(key, expiry, json.dumps(item, cls=DateTimeEncoder))
                            count += 1
                        except Exception:
                            errors += 1

                except Exception as e:
                    await log_service.error(f"Error migrating {cache_type} {filename}: {str(e)}")
                    errors += 1

            await log_service.system(f"[MIGRATION] {cache_type.capitalize()}: {count:,} entries, {errors} errors")
            return count, errors

        try:
            results = await asyncio.gather(
                migrate_simple('stocks', lambda f, d: f"cache:stocks:{f.replace('.json', '')}"),
                migrate_simple('stocks_historical', lambda f, d: f"cache:stocks_historical:{f.replace('.json', '')}"),
                migrate_simple('earnings', lambda f, d: f"cache:earnings:{f.replace('.json', '')}"),
                migrate_simple('portfolio', lambda f, d: "cache:portfolio:portfolio_recommendation"),
                migrate_simple('response', lambda f, d: f"cache:response:{f.replace('.json', '')}"),
                migrate_simple('generic', lambda f, d: f"cache:generic:{f.replace('.json', '')}"),
                migrate_simple('companies', lambda f, d: f"cache:companies:{d.get('symbol', f.split('_')[0]).upper()}"),
                migrate_simple('options', lambda f, d: f"cache:options:{d.get('symbol', '')}_{d.get('date_key', '')}"),
                migrate_aggregated('relevance'),
                migrate_aggregated('analysis'),
                migrate_simple('articles', lambda f, d: f"cache:articles:{self._get_key_hash(d.get('title', ''))}"),
            )

            total = sum(r[0] for r in results)
            errors = sum(r[1] for r in results)
            await log_service.system(f"Migration complete: {total:,} entries, {errors} errors")
        except Exception as e:
            await log_service.error(f"Migration failed: {str(e)}")
            raise