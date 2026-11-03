from datetime import date

from app.utils.dates import resolve_date, resolve_time

REF = date(2026, 9, 9)  # a Wednesday


def test_yesterday_resolves_exactly():
    r = resolve_date(None, "yesterday", REF)
    assert r.iso == "2026-09-08" and r.approximate is False


def test_hindi_kal_raat_means_yesterday():
    assert resolve_date(None, "kal raat", REF).iso == "2026-09-08"


def test_last_weekday_is_approximate_and_in_past():
    r = resolve_date(None, "last Thursday", REF)
    assert r.iso == "2026-09-03" and r.approximate is True


def test_explicit_calendar_date():
    r = resolve_date(None, "8 September 2026", REF)
    assert r.iso == "2026-09-08" and r.approximate is False


def test_calendar_date_without_year_is_approximate():
    r = resolve_date(None, "8 September", REF)
    assert r.iso == "2026-09-08" and r.approximate is True


def test_vague_date_stays_unresolved_but_kept():
    r = resolve_date(None, "recently", REF)
    assert r.iso is None and r.approximate is True and r.description == "recently"


def test_llm_supplied_iso_wins():
    assert resolve_date("2026-09-01", "some day", REF).iso == "2026-09-01"


def test_time_from_description():
    r = resolve_time(None, "around 8 pm")
    assert r.hhmm == "20:00" and r.approximate is True


def test_time_night_is_approximate_without_value():
    r = resolve_time(None, "night")
    assert r.hhmm is None and r.approximate is True and r.description == "night"


def test_time_12am_and_12pm():
    assert resolve_time(None, "12 am").hhmm == "00:00"
    assert resolve_time(None, "12 pm").hhmm == "12:00"
