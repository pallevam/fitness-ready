"""Authenticated, politely paced Garmin Connect session.

The official Garmin Health API needs business approval, so this uses the
community `garminconnect` library (>=0.3.15), which speaks Garmin's mobile SSO
flow directly and caches DI OAuth tokens. Credentials come from the environment
or an interactive prompt -- never from a file in this repo.

`garminconnect` is an optional dependency (`pip install -e ".[api]"`). It is
imported lazily so the test suite, the loader and the tools server never need
it, and `make test` stays network-free.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from getpass import getpass
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("fetcher")

# Garmin publishes no rate limit for this surface. One call per second is far
# below what the mobile app does and has no practical cost for a 180-day pull.
MIN_REQUEST_INTERVAL = 1.0
MAX_ATTEMPTS = 5
BACKOFF_BASE_SECONDS = 5.0
BACKOFF_CAP_SECONDS = 120.0

DEFAULT_TOKEN_DIR = Path.home() / ".garminconnect"

# Substrings that mark a response as "slow down" rather than "this is broken".
RATE_LIMIT_MARKERS = ("429", "too many requests", "rate limit", "temporarily blocked")
RETRYABLE_MARKERS = RATE_LIMIT_MARKERS + ("502", "503", "504", "timeout", "timed out", "connection")


class FetcherError(RuntimeError):
    """Raised when a call cannot be completed after retries."""


class _LoginWatcher(logging.Handler):
    """Notices rate limiting that the library logs but does not raise.

    garminconnect tries several SSO paths. When the first ones are refused with
    a 429 it falls back to the portal, which answers a generic 401 -- so the
    exception we catch blames the password for what is really an IP cooldown.
    This watches the library's own log records so the message we raise says
    which of the two actually happened.
    """

    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.saw_rate_limit = False

    def emit(self, record: logging.LogRecord) -> None:
        message = record.getMessage().lower()
        if any(marker in message for marker in RATE_LIMIT_MARKERS):
            self.saw_rate_limit = True


def resolve_token_dir(explicit: str | os.PathLike[str] | None = None) -> Path:
    """Where DI OAuth tokens are cached: argument, then $GARMIN_TOKENS, then ~/.garminconnect."""
    if explicit:
        return Path(explicit).expanduser()
    from_env = os.environ.get("GARMIN_TOKENS")
    return Path(from_env).expanduser() if from_env else DEFAULT_TOKEN_DIR


def resolve_credentials(
    email: str | None = None,
    password: str | None = None,
    *,
    allow_prompt: bool = True,
    prompt_email: Callable[[str], str] = input,
    prompt_password: Callable[[str], str] = getpass,
) -> tuple[str, str]:
    """Credentials from arguments, then $GARMIN_EMAIL / $GARMIN_PASSWORD, then a prompt.

    Nothing is written to disk and nothing is echoed. Run the first login in
    your own terminal so the password and any MFA code stay there.
    """
    email = email or os.environ.get("GARMIN_EMAIL") or ""
    password = password or os.environ.get("GARMIN_PASSWORD") or ""
    if not email:
        if not allow_prompt:
            raise FetcherError("no email: set GARMIN_EMAIL or pass --email")
        email = prompt_email("Garmin email: ").strip()
    if not password:
        if not allow_prompt:
            raise FetcherError("no password: set GARMIN_PASSWORD or run interactively")
        password = prompt_password("Garmin password: ")
    if not email or not password:
        raise FetcherError("email and password are both required")
    return email, password


def is_retryable(error: BaseException) -> bool:
    return any(marker in str(error).lower() for marker in RETRYABLE_MARKERS)


def is_rate_limited(error: BaseException) -> bool:
    return any(marker in str(error).lower() for marker in RATE_LIMIT_MARKERS)


def backoff_seconds(attempt: int) -> float:
    """Exponential backoff, capped. `attempt` is 1-based."""
    return min(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)), BACKOFF_CAP_SECONDS)


@dataclass
class RateLimiter:
    """Keeps at least `interval` seconds between calls.

    Clock and sleep are injected so the tests can assert the pacing without
    actually waiting.
    """

    interval: float = MIN_REQUEST_INTERVAL
    sleep: Callable[[float], None] = time.sleep
    monotonic: Callable[[], float] = time.monotonic
    _last_call: float | None = field(default=None, repr=False)

    def wait(self) -> float:
        """Block until the next call is allowed. Returns how long it waited."""
        now = self.monotonic()
        if self._last_call is None:
            self._last_call = now
            return 0.0
        elapsed = now - self._last_call
        delay = max(0.0, self.interval - elapsed)
        if delay:
            self.sleep(delay)
        self._last_call = self.monotonic()
        return delay


@dataclass
class GarminSession:
    """Thin wrapper over the `garminconnect` client: pacing, retries, logging.

    Every read goes through `call`, so politeness is not something a caller can
    forget. `not_found_ok` covers the ordinary case of a day the device simply
    has no data for -- that is a data gap, not a failure.
    """

    client: Any
    limiter: RateLimiter = field(default_factory=RateLimiter)
    sleep: Callable[[float], None] = time.sleep

    def call(self, method: str, *args: Any, not_found_ok: bool = True, **kwargs: Any) -> Any:
        fn = getattr(self.client, method, None)
        if fn is None:
            raise FetcherError(f"garminconnect has no method {method!r}")

        last_error: BaseException | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self.limiter.wait()
            try:
                return fn(*args, **kwargs)
            except Exception as error:  # noqa: BLE001 - library raises several types
                last_error = error
                if not_found_ok and "404" in str(error):
                    log.debug("%s%s: no data", method, args)
                    return None
                if not is_retryable(error) or attempt == MAX_ATTEMPTS:
                    break
                delay = backoff_seconds(attempt)
                log.warning(
                    "%s%s failed (%s); %s backoff %.0fs (attempt %d/%d)",
                    method, args, error,
                    "rate limited," if is_rate_limited(error) else "retrying,",
                    delay, attempt, MAX_ATTEMPTS,
                )
                self.sleep(delay)
        raise FetcherError(f"{method}{args} failed: {last_error}") from last_error


def login_failure_message(address: str, error: BaseException, saw_rate_limit: bool) -> str:
    """Blame the right thing: an IP cooldown reads as a 401 on the fallback path."""
    if saw_rate_limit or is_rate_limited(error):
        return (
            f"Garmin rate-limited this IP (429) while logging in as {address}, then fell back "
            f"to a path that answered: {error}. That 401 is probably not about your password. "
            "Wait 30-60 minutes without retrying, or try once from a different network "
            "(a phone hotspot is the quickest test). Confirm the password in a browser at "
            "connect.garmin.com rather than by retrying here."
        )
    return (
        f"Garmin rejected the login for {address}: {error}. Check GARMIN_EMAIL/GARMIN_PASSWORD. "
        "If the account has MFA enabled, run this in a terminal where you can type the code."
    )


def _import_garmin() -> Any:
    try:
        from garminconnect import Garmin
    except ImportError as error:  # pragma: no cover - depends on the environment
        raise FetcherError(
            'garminconnect is not installed. Run: pip install -e ".[api]"'
        ) from error
    return Garmin


def connect(
    email: str | None = None,
    password: str | None = None,
    *,
    token_dir: str | os.PathLike[str] | None = None,
    allow_prompt: bool = True,
) -> GarminSession:
    """Log in, preferring cached tokens so a normal run needs no credentials.

    A cached login is resumed silently. Only a cold start or an expired refresh
    token asks for the password, and MFA is prompted for on the terminal.
    """
    Garmin = _import_garmin()
    tokens = resolve_token_dir(token_dir)

    if tokens.exists():
        try:
            client = Garmin()
            client.login(tokenstore=str(tokens))
            log.info("resumed Garmin session from %s", tokens)
            return GarminSession(client=client)
        except Exception as error:  # noqa: BLE001 - any failure means "log in again"
            log.info("cached tokens unusable (%s); logging in again", error)

    address, secret = resolve_credentials(email, password, allow_prompt=allow_prompt)
    client = Garmin(address, secret, prompt_mfa=lambda: input("MFA code: ").strip())

    watcher = _LoginWatcher()
    library_log = logging.getLogger("garminconnect")
    library_log.addHandler(watcher)
    try:
        client.login(tokenstore=str(tokens))
    except Exception as error:  # noqa: BLE001 - the library raises its own types
        # Surface this as our own error so callers handle one exception type and
        # the user gets a sentence rather than a stack trace.
        raise FetcherError(login_failure_message(address, error, watcher.saw_rate_limit)) from error
    finally:
        library_log.removeHandler(watcher)
    log.info("logged in; tokens cached at %s", tokens)
    return GarminSession(client=client)
