import asyncio
import pytz
from datetime import datetime, time as dt_time, timedelta
from services import log_service, time_service


class MasterSchedulerService:
    def __init__(self, cache_service, fingerprint_service, options_scheduler_service):
        self.cache_service = cache_service
        self.fingerprint_service = fingerprint_service
        self.options_scheduler_service = options_scheduler_service
        self.est_timezone = pytz.timezone('US/Eastern')
        self.running = False
        self.scheduler_task = None
        self.SCHEDULE_CACHE_KEY = "master_scheduler_last_run"

        self.SCHEDULE_TIMES_EST = [
            dt_time(20, 5),
            dt_time(21, 0),
            dt_time(0, 5),
            dt_time(1, 30)
        ]
        self.BLACKOUT_START_EST = dt_time(2, 0)
        self.BLACKOUT_END_EST = dt_time(20, 0)

    async def initialize(self, force_refresh: bool = False, dry_run: bool = False):
        await log_service.system("MasterSchedulerService initialized.")

        if force_refresh:
            await self._run_all_jobs(force_refresh=True, dry_run=dry_run)
        else:
            self._start_scheduler()

    def _start_scheduler(self):
        if not self.running:
            self.running = True
            self.scheduler_task = asyncio.create_task(self._schedule_loop())

    async def stop_scheduler(self):
        self.running = False
        if self.scheduler_task:
            self.scheduler_task.cancel()
            try:
                await self.scheduler_task
            except asyncio.CancelledError:
                pass

    async def _schedule_loop(self):
        await log_service.scheduler("Scheduler loop started. Calculating next run...")
        while self.running:
            try:
                next_run_time = self._calculate_next_run_time()
                now_est = datetime.now(self.est_timezone)

                if now_est >= next_run_time:
                    if await self._should_run_today():
                        await log_service.scheduler(
                            f"Scheduled time {next_run_time.strftime('%H:%M:%S %Z')} has been reached. Running jobs now.")
                        await self._run_all_jobs(force_refresh=False, dry_run=False)

                    await asyncio.sleep(1)
                    continue

                time_to_next_run = next_run_time - now_est
                run_time_str = next_run_time.strftime('%Y-%m-%d %H:%M:%S %Z')
                countdown_str = self._format_timedelta(time_to_next_run)
                await log_service.scheduler(f"Next scheduled run in {countdown_str} at {run_time_str}")

                sleep_seconds = max(1.0, time_to_next_run.total_seconds())
                sleep_duration = min(sleep_seconds, 3600.0)
                await asyncio.sleep(sleep_duration)

            except asyncio.CancelledError:
                break
            except Exception as e:
                await log_service.error(f"Scheduler loop error: {e}")
                await asyncio.sleep(3600)

    @staticmethod
    def _format_timedelta(td: timedelta) -> str:
        """Formats a timedelta object into a human-readable string."""
        seconds = int(td.total_seconds())
        days, remainder = divmod(seconds, 86400)
        hours, remainder = divmod(remainder, 3600)
        minutes, _ = divmod(remainder, 60)

        parts = []
        if days > 0:
            parts.append(f"{days} day{'s' if days != 1 else ''}")
        if hours > 0:
            parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
        if minutes > 0:
            parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")

        if not parts:
            return f"{seconds} second{'s' if seconds != 1 else ''}"

        return ", ".join(parts)

    def _calculate_next_run_time(self):
        """Calculates the next valid run time based on a schedule and blackout window."""
        now_est = datetime.now(self.est_timezone)
        today_date = now_est.date()

        for run_time in sorted(self.SCHEDULE_TIMES_EST):
            is_in_blackout = self.BLACKOUT_START_EST <= run_time < self.BLACKOUT_END_EST
            if is_in_blackout:
                continue

            candidate_time = now_est.replace(
                hour=run_time.hour, minute=run_time.minute, second=0, microsecond=0
            )

            if candidate_time > now_est:
                return candidate_time

        tomorrow_date = today_date + timedelta(days=1)
        for run_time in sorted(self.SCHEDULE_TIMES_EST):
            is_in_blackout = self.BLACKOUT_START_EST <= run_time < self.BLACKOUT_END_EST
            if not is_in_blackout:
                return datetime.combine(tomorrow_date, run_time, self.est_timezone)

        return now_est.replace(hour=0, minute=0, second=0) + timedelta(days=2)

    async def _should_run_today(self):
        last_run = await self.cache_service.get(self.SCHEDULE_CACHE_KEY)
        if not last_run:
            return True

        now_est = datetime.now(self.est_timezone)
        last_run_date = datetime.fromtimestamp(last_run, self.est_timezone).date()
        today_date = now_est.date()

        return today_date > last_run_date

    async def _run_all_jobs(self, force_refresh: bool = False, dry_run: bool = False):
        log_prefix = "(DRY RUN) " if dry_run else ""
        force_text = " (FORCED)" if force_refresh else ""

        await log_service.scheduler(f"{log_prefix}Starting all scheduled jobs{force_text}...")

        start_time = time_service.timestamp()

        try:
            fingerprint_task = self.fingerprint_service.run_calculation_job(force_refresh=force_refresh,
                                                                            dry_run=dry_run)
            options_task = self.options_scheduler_service.run_scheduled_jobs(force_refresh=force_refresh,
                                                                             dry_run=dry_run)

            await asyncio.gather(fingerprint_task, options_task)

            if not dry_run:
                await self.cache_service.set(self.SCHEDULE_CACHE_KEY, time_service.timestamp(),
                                             48 * 60 * 60)

            duration = time_service.timestamp() - start_time
            await log_service.scheduler(f"{log_prefix}All scheduled jobs completed in {duration:.1f}s{force_text}")

        except Exception as e:
            await log_service.error(f"Scheduled jobs failed: {e}")