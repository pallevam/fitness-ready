"""Fetcher plumbing: credentials, token cache, pacing, retries.

No network and no `garminconnect` import -- the API extra stays optional, and
`make test` must run offline (SPEC implementation note).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from fetcher import client as fc
from fetcher.endpoints import BY_NAME, ENDPOINTS


# ----------------------------------------------------------------- credentials

def test_credentials_come_from_the_environment(monkeypatch):
    monkeypatch.setenv("GARMIN_EMAIL", "a@b.com")
    monkeypatch.setenv("GARMIN_PASSWORD", "secret")
    assert fc.resolve_credentials() == ("a@b.com", "secret")


def test_arguments_beat_the_environment(monkeypatch):
    monkeypatch.setenv("GARMIN_EMAIL", "env@b.com")
    monkeypatch.setenv("GARMIN_PASSWORD", "envpass")
    assert fc.resolve_credentials("arg@b.com", "argpass") == ("arg@b.com", "argpass")


def test_missing_credentials_prompt_rather_than_read_a_file(monkeypatch):
    monkeypatch.delenv("GARMIN_EMAIL", raising=False)
    monkeypatch.delenv("GARMIN_PASSWORD", raising=False)
    got = fc.resolve_credentials(
        prompt_email=lambda _: "typed@b.com", prompt_password=lambda _: "typed"
    )
    assert got == ("typed@b.com", "typed")


def test_non_interactive_run_fails_loudly_instead_of_hanging(monkeypatch):
    monkeypatch.delenv("GARMIN_EMAIL", raising=False)
    monkeypatch.delenv("GARMIN_PASSWORD", raising=False)
    with pytest.raises(fc.FetcherError, match="GARMIN_EMAIL"):
        fc.resolve_credentials(allow_prompt=False)


# ------------------------------------------------------------------- tokens

def test_token_dir_precedence(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("GARMIN_TOKENS", raising=False)
    assert fc.resolve_token_dir() == fc.DEFAULT_TOKEN_DIR
    monkeypatch.setenv("GARMIN_TOKENS", str(tmp_path / "env"))
    assert fc.resolve_token_dir() == tmp_path / "env"
    assert fc.resolve_token_dir(tmp_path / "explicit") == tmp_path / "explicit"


def test_token_dir_default_is_outside_the_repo():
    assert Path.cwd() not in fc.DEFAULT_TOKEN_DIR.parents
    assert fc.DEFAULT_TOKEN_DIR != Path.cwd()


# ------------------------------------------------------------------- pacing

class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def test_rate_limiter_spaces_calls_out():
    clock = FakeClock()
    limiter = fc.RateLimiter(interval=1.0, sleep=clock.sleep, monotonic=clock.monotonic)
    assert limiter.wait() == 0.0          # first call is free
    assert limiter.wait() == 1.0          # no time passed, so wait the full interval
    clock.now += 5.0                      # a slow call already covered the interval
    assert limiter.wait() == 0.0
    assert clock.slept == [1.0]


def test_backoff_grows_and_is_capped():
    delays = [fc.backoff_seconds(n) for n in range(1, 7)]
    assert delays == sorted(delays)
    assert delays[0] == fc.BACKOFF_BASE_SECONDS
    assert max(delays) <= fc.BACKOFF_CAP_SECONDS


@pytest.mark.parametrize(
    "message, retryable, rate_limited",
    [
        ("429 Client Error: Too Many Requests", True, True),
        ("Rate limit exceeded", True, True),
        ("503 Service Unavailable", True, False),
        ("Connection aborted", True, False),
        ("401 Unauthorized", False, False),
        ("Something unexpected", False, False),
    ],
)
def test_error_classification(message, retryable, rate_limited):
    error = Exception(message)
    assert fc.is_retryable(error) is retryable
    assert fc.is_rate_limited(error) is rate_limited


# ------------------------------------------------------------------- session

class FakeClient:
    """Stands in for garminconnect.Garmin; records calls, fails on cue."""

    def __init__(self, failures: int = 0, error: str = "429 Too Many Requests") -> None:
        self.calls: list[tuple] = []
        self.failures = failures
        self.error = error

    def get_user_summary(self, cdate: str):
        self.calls.append(("get_user_summary", cdate))
        if self.failures > 0:
            self.failures -= 1
            raise RuntimeError(self.error)
        return {"calendarDate": cdate, "restingHeartRate": 54}


def _session(client, clock: FakeClock) -> fc.GarminSession:
    return fc.GarminSession(
        client=client,
        limiter=fc.RateLimiter(interval=1.0, sleep=clock.sleep, monotonic=clock.monotonic),
        sleep=clock.sleep,
    )


def test_call_returns_the_payload_and_paces():
    clock = FakeClock()
    session = _session(FakeClient(), clock)
    assert session.call("get_user_summary", "2026-09-13")["restingHeartRate"] == 54
    session.call("get_user_summary", "2026-09-12")
    assert clock.slept == [1.0]


def test_call_retries_rate_limits_then_succeeds():
    clock = FakeClock()
    client = FakeClient(failures=2)
    session = _session(client, clock)
    assert session.call("get_user_summary", "2026-09-13") is not None
    assert len(client.calls) == 3
    # Two backoffs, growing, on top of the pacing waits.
    assert fc.BACKOFF_BASE_SECONDS in clock.slept
    assert fc.backoff_seconds(2) in clock.slept


def test_call_gives_up_after_max_attempts():
    clock = FakeClock()
    client = FakeClient(failures=99)
    session = _session(client, clock)
    with pytest.raises(fc.FetcherError, match="get_user_summary"):
        session.call("get_user_summary", "2026-09-13")
    assert len(client.calls) == fc.MAX_ATTEMPTS


def test_non_retryable_errors_fail_immediately():
    clock = FakeClock()
    client = FakeClient(failures=99, error="401 Unauthorized")
    session = _session(client, clock)
    with pytest.raises(fc.FetcherError):
        session.call("get_user_summary", "2026-09-13")
    assert len(client.calls) == 1


def test_a_day_with_no_data_is_a_gap_not_a_failure():
    clock = FakeClock()
    client = FakeClient(failures=1, error="404 Not Found")
    session = _session(client, clock)
    assert session.call("get_user_summary", "2026-09-13") is None


def test_unknown_method_is_caught_before_any_network_call():
    session = _session(FakeClient(), FakeClock())
    with pytest.raises(fc.FetcherError, match="no method"):
        session.call("get_training_readiness", "2026-09-13")


# ----------------------------------------------------------------- endpoints

def test_endpoint_registry_covers_every_table():
    assert {e.table for e in ENDPOINTS} == {"daily", "sleep", "hrv", "activities", "user_metrics"}


def test_registry_excludes_training_readiness_and_status():
    """SPEC §3: the vivoactive 5 does not produce these, so we never ask for them."""
    methods = " ".join(e.method for e in ENDPOINTS).lower()
    assert "readiness" not in methods
    assert "trainingstatus" not in methods


def test_only_activities_is_a_range_call():
    assert BY_NAME["activities"].per_day is False
    assert all(e.per_day for e in ENDPOINTS if e.name != "activities")


# -------------------------------------------------------------- login errors

def test_rate_limited_login_does_not_blame_the_password():
    """A 429 on the mobile paths surfaces as a 401 from the portal fallback."""
    error = Exception("401 Unauthorized (Invalid Username or Password)")
    message = fc.login_failure_message("a@b.com", error, saw_rate_limit=True)
    assert "rate-limited" in message
    assert "not about your password" in message
    assert "GARMIN_PASSWORD" not in message


def test_genuine_auth_failure_does_blame_the_password():
    error = Exception("401 Unauthorized (Invalid Username or Password)")
    message = fc.login_failure_message("a@b.com", error, saw_rate_limit=False)
    assert "GARMIN_PASSWORD" in message
    assert "MFA" in message


def test_watcher_notices_rate_limiting_the_library_only_logs():
    import logging

    watcher = fc._LoginWatcher()
    library_log = logging.getLogger("garminconnect.test")
    library_log.addHandler(watcher)
    try:
        assert watcher.saw_rate_limit is False
        library_log.warning("mobile+cffi returned 429: Mobile login returned 429 — IP rate limited")
        assert watcher.saw_rate_limit is True
    finally:
        library_log.removeHandler(watcher)
