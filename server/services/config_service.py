import os
from typing import Optional, List, Dict, Any
from services import log_service

class ConfigService:
    _instance = None
    USE_PORTFOLIO_FOR_SIGNALS = True
    INCLUDE_IMPROVEMENT_FEEDBACK = False
    ENABLE_ANALYSIS_PROMPT_LOGGING = False

    IMAGE_ROUTING = {
        "SENTIMENT_TEMPORAL": {
            "send_to_master_analytics": True,
            "send_to_options_analytics": False,
            "send_to_image_analytics": True,
            "send_to_vibe_analytics": False
        },
        "SENTIMENT_COMBINED": {
            "send_to_master_analytics": True,
            "send_to_options_analytics": False,
            "send_to_image_analytics": True,
            "send_to_vibe_analytics": False
        },
        "SENTIMENT_RECENT": {
            "send_to_master_analytics": True,
            "send_to_options_analytics": False,
            "send_to_image_analytics": True,
            "send_to_vibe_analytics": False
        },
        "OPTIONS_ANALYSIS": {
            "send_to_master_analytics": True,
            "send_to_options_analytics": True,
            "send_to_image_analytics": False,
            "send_to_vibe_analytics": False
        },
        "PREDICTION_HISTORY": {
            "send_to_master_analytics": True,
            "send_to_options_analytics": True,
            "send_to_image_analytics": True,
            "send_to_vibe_analytics": True
        },
        "HISTORICAL_ANALYSIS": {
            "send_to_master_analytics": True,
            "send_to_options_analytics": False,
            "send_to_image_analytics": False,
            "send_to_vibe_analytics": False
        }
    }

    ENRICHMENT_CONFIG = {
        "article_enrichment_enabled": False,
        "enrichment_timeout": 20,
        "enrichment_delay": 0.8,
        "enrichment_max_total_length": 2000,
        "max_concurrent_browsers": 10,
        "max_concurrent_direct": 50
    }

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConfigService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        current_dir = os.path.dirname(os.path.abspath(__file__))
        if os.path.basename(current_dir) == 'services':
            self.root_dir = os.path.dirname(current_dir)
        else:
            self.root_dir = current_dir

        self.market_indices = {
            'sp500': 'SPY',
            'nasdaq': 'QQQ',
            'dow': 'DIA',
            'russell2000': 'IWM'
        }

        self.cache_dir = os.path.join(self.root_dir, 'cache')
        os.makedirs(self.cache_dir, exist_ok=True)

        self.keys = {
            'openai': self._load_key('OPENAI_API_KEY', 'keys/api_secrets.txt'),
            'alpha_vantage': self._load_key('ALPHA_VANTAGE_API_KEY', 'keys/alphavantage_key.txt'),
            'alpaca_api_key': self._load_key('ALPACA_API_KEY', 'keys/alpaca_keys.txt', line=0),
            'alpaca_api_secret': self._load_key('ALPACA_API_SECRET', 'keys/alpaca_keys.txt', line=1),
            'anthropic': self._load_key('ANTHROPIC_API_KEY', 'keys/anthropic_key.txt'),
            'gemini': self._load_key('GEMINI_API_KEY', 'keys/gemini_key.txt'),
            'polygon': self._load_key('POLYGON_API_KEY', 'keys/polygon_key.txt'),
            'finnhub': self._load_key('FINNHUB_API_KEY', 'keys/finnhub_key.txt'),
        }

        self._initialized = True

    def _load_key(self, env_var: str, file_path: str, line: int = 0) -> Optional[str]:
        key = os.environ.get(env_var)
        if key:
            return key

        full_path = os.path.join(self.root_dir, file_path)
        try:
            with open(full_path, 'r') as file:
                lines = file.readlines()
                if line < len(lines):
                    return lines[line].strip()
        except FileNotFoundError:
            pass

        return None

    def get_key(self, key_name: str) -> Optional[str]:
        return self.keys.get(key_name)

    def get(self, config_key: str, default=None):
        env_value = os.environ.get(config_key.upper())
        if env_value is not None:
            if isinstance(default, bool):
                return env_value.lower() in ('true', '1', 'yes', 'on')
            elif isinstance(default, int):
                try:
                    return int(env_value)
                except ValueError:
                    return default
            elif isinstance(default, float):
                try:
                    return float(env_value)
                except ValueError:
                    return default
            return env_value

        return self.ENRICHMENT_CONFIG.get(config_key, default)

    def should_log_analysis_prompts(self) -> bool:
        return self.ENABLE_ANALYSIS_PROMPT_LOGGING

    async def get_newsapi_keys(self) -> List[str]:
        keys = []
        file_path = os.path.join(self.root_dir, 'keys/newsapi_key.txt')

        try:
            with open(file_path, 'r') as file:
                for line in file:
                    key = line.strip()
                    if key and key not in keys:
                        keys.append(key)
        except FileNotFoundError:
            pass

        return keys

    async def filter_images_by_destination(self, images: List[Dict[str, Any]], destination: str) -> List[str]:
        filtered_images = []

        await log_service.system(f"Filtering images for destination: {destination}")
        await log_service.system(f"Total images to filter: {len(images)}")

        for i, img in enumerate(images):
            if 'category' in img and img['category'] in self.IMAGE_ROUTING:
                config = self.IMAGE_ROUTING[img['category']]

                if destination in config and config[destination]:
                    filtered_images.append(img['data'])
                    await log_service.system(f"Image {i} ({img['category']}) included for {destination}")
                else:
                    await log_service.system(
                        f"Image {i} ({img['category']}) excluded for {destination} - config: {config}")
            else:
                if 'category' not in img:
                    await log_service.warning(f"Image {i} missing category field")
                else:
                    await log_service.warning(f"Image {i} has unknown category: {img['category']}")

        await log_service.system(f"Filtered result: {len(filtered_images)} images for {destination}")
        return filtered_images

    async def initialize(self):
        if hasattr(self, '_config_initialized') and self._config_initialized:
            return

        self._config_initialized = True
        await log_service.system("ConfigService initialized - API keys loaded")