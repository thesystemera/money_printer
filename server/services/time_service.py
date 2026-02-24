import asyncio
import time
import pytz
from datetime import datetime
from services import log_service

_override_datetime = None
_lock = asyncio.Lock()


async def set_override_datetime(dt_str):
    global _override_datetime
    async with _lock:
        if not dt_str:
            _override_datetime = None
            await log_service.system("Time override disabled")
            return True

        try:
            _override_datetime = datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
            await log_service.system(f"Time override set to: {_override_datetime.isoformat()}")
            return True
        except (ValueError, TypeError) as e:
            await log_service.error(f"Invalid override datetime format: {dt_str} - {str(e)}")
            _override_datetime = None
            return False


def set_override_datetime_sync(dt_str):
    global _override_datetime
    if not dt_str:
        _override_datetime = None
        return True

    try:
        _override_datetime = datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
        return True
    except (ValueError, TypeError):
        _override_datetime = None
        return False


def now(timezone=pytz.UTC):
    if _override_datetime:
        return _override_datetime.astimezone(timezone)
    return datetime.now(timezone)


def timestamp():
    if _override_datetime:
        return _override_datetime.timestamp()
    return time.time()


def is_override_active():
    return _override_datetime is not None


def get_override_datetime():
    return _override_datetime