import asyncio
import functools
from typing import Callable, TypeVar, Optional, Tuple, Type
from services import log_service

T = TypeVar('T')

async def async_with_retry(
    func: Callable[..., T],
    *args,
    max_retries: int = 3,
    retry_delay: float = 1.0,
    backoff_factor: float = 2.0,
    retry_exceptions: Tuple[Type[Exception], ...] = (Exception,),
    **kwargs
) -> Optional[T]:

    for attempt in range(max_retries):
        try:
            if asyncio.iscoroutinefunction(func):
                result = await func(*args, **kwargs)
            else:
                result = await asyncio.to_thread(func, *args, **kwargs)
            return result
        except retry_exceptions as e:
            last_exception = e
            wait_time = retry_delay * (backoff_factor ** attempt)
            log_message = f"API call failed (attempt {attempt + 1}/{max_retries}): {str(e)}"
            if attempt < max_retries - 1:
                log_message += f" Retrying in {wait_time:.1f}s"
                await log_service.api(log_message)
                await asyncio.sleep(wait_time)
            else:
                await log_service.api(f"All {max_retries} retry attempts failed: {str(last_exception)}")

    return None

def async_retry_decorator(
    max_retries: int = 3,
    retry_delay: float = 1.0,
    backoff_factor: float = 2.0,
    retry_exceptions: Tuple[Type[Exception], ...] = (Exception,)
):
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            return await async_with_retry(
                func, *args,
                max_retries=max_retries,
                retry_delay=retry_delay,
                backoff_factor=backoff_factor,
                retry_exceptions=retry_exceptions,
                **kwargs
            )
        return wrapper
    return decorator