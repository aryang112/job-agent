"""Rate limiting, scheduling, and daily caps."""
import time
import random
from datetime import datetime
from logger import log


class Throttle:
    def __init__(self, config: dict):
        self.min_delay = config.get("min_delay_seconds", 45)
        self.max_delay = config.get("max_delay_seconds", 90)
        self.pause_every_n = config.get("pause_every_n", 10)
        self.pause_duration = config.get("pause_duration_seconds", 300)
        self.max_daily = config.get("max_daily", 100)
        self.active_start = config.get("active_hours_start", 6)
        self.active_end = config.get("active_hours_end", 23)
        self.apps_today = 0
        self.apps_since_pause = 0
        self.last_date = datetime.now().date()

    def is_active_hours(self) -> bool:
        """Check if we're within allowed operating hours (ET)."""
        hour = datetime.now().hour  # Assumes system is in ET
        return self.active_start <= hour < self.active_end

    def can_apply(self) -> bool:
        """Check if we haven't hit the daily cap."""
        today = datetime.now().date()
        if today != self.last_date:
            self.apps_today = 0
            self.last_date = today
        return self.apps_today < self.max_daily

    def wait_between_apps(self):
        """Random delay between applications + periodic longer pause."""
        self.apps_today += 1
        self.apps_since_pause += 1

        if self.apps_since_pause >= self.pause_every_n:
            log.info(f"Pause: {self.pause_duration}s cooldown after {self.pause_every_n} apps")
            time.sleep(self.pause_duration)
            self.apps_since_pause = 0
        else:
            delay = random.uniform(self.min_delay, self.max_delay)
            log.info(f"Throttle: waiting {delay:.0f}s before next application")
            time.sleep(delay)

    def wait_until_active(self):
        """Sleep until active hours if currently outside them."""
        while not self.is_active_hours():
            log.info("Outside active hours, sleeping 5 minutes...")
            time.sleep(300)
