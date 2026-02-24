import asyncio
from services import log_service

class OptionsSchedulerService:
    def __init__(self, cache_service, options_service):
        self.cache_service = cache_service
        self.options_service = options_service

    async def initialize(self):
        await log_service.scheduler("OptionsSchedulerService initialized.")

    async def run_scheduled_jobs(self, force_refresh: bool = False, dry_run: bool = False):
        await asyncio.sleep(0)

        if not force_refresh:
            await log_service.scheduler("Skipping options jobs as force_refresh is False.")
            return

        log_prefix = "(DRY RUN) " if dry_run else ""
        await log_service.scheduler(f"{log_prefix}Starting options scheduled jobs...")

        await self._prefetch_all_options_data(dry_run)

        await log_service.scheduler(f"{log_prefix}Options scheduled jobs completed.")

    async def _prefetch_all_options_data(self, dry_run: bool = False):
        log_prefix = "(DRY RUN) " if dry_run else ""
        await log_service.scheduler(f"{log_prefix}Starting options pre-fetch task.")

        all_symbols = await self.cache_service.get_all_cached_company_symbols()

        if not all_symbols:
            await log_service.scheduler(f"{log_prefix}No cached companies found to process. Ending task.")
            return

        await log_service.scheduler(
            f"{log_prefix}Found {len(all_symbols)} cached symbols to process: {', '.join(all_symbols)}")

        if dry_run:
            await log_service.scheduler(f"{log_prefix}Would fetch options for {len(all_symbols)} symbols. Skipping.")
            return

        tasks = []
        api_semaphore = asyncio.Semaphore(10)

        for symbol in all_symbols:
            async def fetch_and_cache(s):
                async with api_semaphore:
                    try:
                        await self.options_service.get_options_data(symbol=s, force_refresh=False)
                        await log_service.scheduler(f"Successfully cached options data for {s}")
                    except Exception as e:
                        await log_service.error(f"OPTIONS_SCHEDULER: Failed options pre-fetch for {s}: {e}")

            tasks.append(fetch_and_cache(symbol))

        await asyncio.gather(*tasks)
        await log_service.scheduler(f"{log_prefix}Options pre-fetch task finished.")