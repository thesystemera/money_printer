import asyncio
import pytz
from typing import Optional
from services import time_service

ENABLE_INFO_LOGS = True
ENABLE_ERROR_LOGS = True
ENABLE_WARNING_LOGS = True
ENABLE_SUCCESS_LOGS = True
ENABLE_DEBUG_LOGS = False
ENABLE_CACHE_LOGS = False
ENABLE_FETCH_LOGS = False
ENABLE_AI_LOGS = False
ENABLE_ANALYSIS_LOGS = False
ENABLE_MARKET_LOGS = False
ENABLE_API_LOGS = False
ENABLE_SYSTEM_LOGS = True
ENABLE_WS_LOGS = False
ENABLE_PORTFOLIO_LOGS = False
ENABLE_WORKFLOW_LOGS = False
ENABLE_ENRICHMENT_LOGS = False
ENABLE_OPTIONS_LOGS = True
ENABLE_FINGERPRINT_LOGS = True
ENABLE_SCHEDULER_LOGS = True

ENABLE_CONSOLE_OUTPUT = True
ENABLE_UI_OUTPUT = True

COLORS = {
    'RED': '\033[91m',
    'GREEN': '\033[92m',
    'YELLOW': '\033[93m',
    'BLUE': '\033[94m',
    'MAGENTA': '\033[95m',
    'CYAN': '\033[96m',
    'WHITE': '\033[97m',
    'GRAY': '\033[90m',
    'ORANGE': '\033[38;5;208m',
    'LAVENDER': '\033[38;5;147m',
    'GOLD': '\033[38;5;220m',
    'TEAL': '\033[38;5;51m',
    'PURPLE': '\033[38;5;129m',
    'LIME': '\033[38;5;118m',
    'CORAL': '\033[38;5;203m',
    'PINK': '\033[38;5;206m',
    'INDIGO': '\033[38;5;75m',
    'SEA_GREEN': '\033[38;5;42m',
    'SKY_BLUE': '\033[38;5;117m',
    'BOLD': '\033[1m',
    'RESET': '\033[0m'
}

LOG_TYPES = {
    'info': {'color': 'BLUE', 'prefix': 'INFO', 'enabled': lambda: ENABLE_INFO_LOGS},
    'error': {'color': 'RED', 'prefix': 'ERROR', 'enabled': lambda: ENABLE_ERROR_LOGS},
    'warning': {'color': 'YELLOW', 'prefix': 'WARN', 'enabled': lambda: ENABLE_WARNING_LOGS},
    'success': {'color': 'GREEN', 'prefix': 'OK', 'enabled': lambda: ENABLE_SUCCESS_LOGS},
    'debug': {'color': 'GRAY', 'prefix': 'DEBUG', 'enabled': lambda: ENABLE_DEBUG_LOGS},
    'cache': {'color': 'LAVENDER', 'prefix': 'CACHE', 'enabled': lambda: ENABLE_CACHE_LOGS},
    'fetch': {'color': 'CYAN', 'prefix': 'FETCH', 'enabled': lambda: ENABLE_FETCH_LOGS},
    'ai': {'color': 'MAGENTA', 'prefix': 'AI', 'enabled': lambda: ENABLE_AI_LOGS},
    'analysis': {'color': 'INDIGO', 'prefix': 'ANALYSIS', 'enabled': lambda: ENABLE_ANALYSIS_LOGS},
    'market': {'color': 'GOLD', 'prefix': 'MARKET', 'enabled': lambda: ENABLE_MARKET_LOGS},
    'api': {'color': 'TEAL', 'prefix': 'API', 'enabled': lambda: ENABLE_API_LOGS},
    'system': {'color': 'WHITE', 'prefix': 'SYS', 'enabled': lambda: ENABLE_SYSTEM_LOGS},
    'ws': {'color': 'ORANGE', 'prefix': 'WS', 'enabled': lambda: ENABLE_WS_LOGS},
    'portfolio': {'color': 'PURPLE', 'prefix': 'PORTFOLIO', 'enabled': lambda: ENABLE_PORTFOLIO_LOGS},
    'workflow': {'color': 'LIME', 'prefix': 'WORKFLOW', 'enabled': lambda: ENABLE_WORKFLOW_LOGS},
    'enrichment': {'color': 'CORAL', 'prefix': 'ENRICH', 'enabled': lambda: ENABLE_ENRICHMENT_LOGS},
    'options': {'color': 'PINK', 'prefix': 'OPTIONS', 'enabled': lambda: ENABLE_OPTIONS_LOGS},
    'fingerprint': {'color': 'SEA_GREEN', 'prefix': 'FPRINT', 'enabled': lambda: ENABLE_FINGERPRINT_LOGS},
    'scheduler': {'color': 'SKY_BLUE', 'prefix': 'SCHED', 'enabled': lambda: ENABLE_SCHEDULER_LOGS}
}

_websocket_manager = None
_log_queue = asyncio.Queue()
_log_task = None

def set_websocket_manager(manager):
    global _websocket_manager
    _websocket_manager = manager

async def start_log_worker():
    global _log_task
    if _log_task is None:
        _log_task = asyncio.create_task(_log_worker())

def _colorize(message: str, log_type: str) -> str:
    log_config = LOG_TYPES.get(log_type, LOG_TYPES['info'])
    color = COLORS[log_config['color']]
    prefix = log_config['prefix']
    return f"{color}[{prefix}] {message}{COLORS['RESET']}"

def _format_cache_message(message: str) -> str:
    cache_hit = f"{COLORS['BOLD']}✓ HIT{COLORS['RESET']}"
    cache_miss = f"{COLORS['BOLD']}✗ MISS{COLORS['RESET']}"

    replacements = [
        ("hit:", f"{cache_hit}:"),
        ("miss:", f"{cache_miss}:"),
        ("Cache hit:", cache_hit),
        ("Cache miss:", cache_miss)
    ]

    for old, new in replacements:
        if old.lower() in message.lower():
            return message.replace(old, new)

    return message

async def _log_worker():
    while True:
        try:
            log_entry = await _log_queue.get()
            if log_entry is None:
                break

            message, log_type, symbol = log_entry
            log_config = LOG_TYPES.get(log_type, LOG_TYPES['info'])

            if not log_config['enabled']():
                continue

            if log_type == "cache":
                message = _format_cache_message(message)

            if ENABLE_CONSOLE_OUTPUT:
                print(_colorize(message, log_type))

            if ENABLE_UI_OUTPUT and _websocket_manager:
                await _send_to_ui(message, log_type, symbol)

        except Exception as e:
            print(f"Error in log worker: {e}")

async def _send_to_ui(message: str, log_type: str, symbol: Optional[str] = None):
    log_data = {"type": "log", "message": message, "log_type": log_type}
    try:
        if symbol:
            await _websocket_manager.broadcast_to_symbol(symbol, log_data)
        else:
            await _websocket_manager.broadcast(log_data)
    except Exception:
        pass

async def send_thinking_stream(content, source, is_complete=False):
    if not _websocket_manager:
        return

    if ENABLE_CONSOLE_OUTPUT and is_complete:
        print(_colorize(f"Thinking complete for {source}", "ai"))

    if ENABLE_UI_OUTPUT:
        message = {
            'type': 'thinking_stream',
            'content': content,
            'source': source,
            'is_complete': is_complete,
            'timestamp': time_service.now(pytz.UTC).isoformat()
        }
        try:
            await _websocket_manager.broadcast(message)
        except Exception:
            pass

async def log(message: str, log_type: str = "info", symbol: Optional[str] = None):
    await _log_queue.put((message, log_type, symbol))

async def info(msg, symbol=None):
    await log(msg, "info", symbol)

async def success(msg, symbol=None):
    await log(msg, "success", symbol)

async def warning(msg, symbol=None):
    await log(msg, "warning", symbol)

async def error(msg, symbol=None):
    await log(msg, "error", symbol)

async def debug(msg, symbol=None):
    await log(msg, "debug", symbol)

async def cache(msg, symbol=None):
    await log(msg, "cache", symbol)

async def fetch(msg, symbol=None):
    await log(msg, "fetch", symbol)

async def ai(msg, symbol=None):
    await log(msg, "ai", symbol)

async def analysis(msg, symbol=None):
    await log(msg, "analysis", symbol)

async def market(msg, symbol=None):
    await log(msg, "market", symbol)

async def api(msg, symbol=None):
    await log(msg, "api", symbol)

async def system(msg, symbol=None):
    await log(msg, "system", symbol)

async def ws(msg, symbol=None):
    await log(msg, "ws", symbol)

async def portfolio(msg, symbol=None):
    await log(msg, "portfolio", symbol)

async def workflow(msg, symbol=None):
    await log(msg, "workflow", symbol)

async def enrichment(msg, symbol=None):
    await log(msg, "enrichment", symbol)

async def options(msg, symbol=None):
    await log(msg, "options", symbol)

async def fingerprint(msg, symbol=None):
    await log(msg, "fingerprint", symbol)

async def scheduler(msg, symbol=None):
    await log(msg, "scheduler", symbol)
