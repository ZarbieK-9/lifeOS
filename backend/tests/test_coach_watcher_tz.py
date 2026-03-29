"""Coach watcher resolves per-user IANA zones with fallback."""

from zoneinfo import ZoneInfo

from app.services.coach_watcher_service import resolve_user_coach_zoneinfo


def test_resolve_user_coach_zoneinfo_valid():
    z = resolve_user_coach_zoneinfo("America/New_York")
    assert z == ZoneInfo("America/New_York")


def test_resolve_user_coach_zoneinfo_whitespace_trimmed():
    z = resolve_user_coach_zoneinfo("  Europe/London  ")
    assert z == ZoneInfo("Europe/London")


def test_resolve_user_coach_zoneinfo_invalid_falls_back():
    z_bad = resolve_user_coach_zoneinfo("Not/A_Real_Zone")
    z_none = resolve_user_coach_zoneinfo(None)
    z_empty = resolve_user_coach_zoneinfo("")
    z_blank = resolve_user_coach_zoneinfo("   ")
    assert z_bad == z_none == z_empty == z_blank
