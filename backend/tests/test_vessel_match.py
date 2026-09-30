import pytest

from backend.app.services.vessel_match import build_schedule_index, find_eport_cutoff, parse_closing_time


def sched(name, voyage, closing="2026-09-23 11:00:00"):
    return {"vessel_name": name, "in_out_voyage": voyage, "closing_time": closing}


INDEX = build_schedule_index([
    sched("HMM HOPE", "062E-062E"),
    sched("WAN HAI 286", "S114-S114", "2026-09-28 15:00:00"),
    sched("WAN HAI 317", "E246-W247", "2026-09-29 09:00:00"),
    sched("WAN HAI 31", "E246-W247", "2026-01-01 00:00:00"),
    sched("EVER CONSIST", "0556-070S", "2026-10-01 03:00:00"),
    sched("ACX PEARL", "0292N-0292N", "2026-10-02 13:30:00"),
])


@pytest.mark.parametrize("text, expected", [
    ("HMM HOPE 062E(EC2)", "23/09/2026 11:00"),        # service suffix dropped
    ("HMM HOPE 062E", "23/09/2026 11:00"),
    ("WAN HAI 286 S114", "28/09/2026 15:00"),          # one leg of S114-S114
    ("WAN HAI 317 W247(TE2)", "29/09/2026 09:00"),     # not confused with WAN HAI 31
    ("EVER CONSIST 0556-070S", "01/10/2026 03:00"),
    ("EVER CONSIST 0556 070S", "01/10/2026 03:00"),
    ("ACX PEARL 0292N(CTP)", "02/10/2026 13:30"),
    ("Tàu: hmm hope 062e", "23/09/2026 11:00"),
])
def test_matches_real_booking_strings(text, expected):
    assert find_eport_cutoff(text, INDEX) == expected


@pytest.mark.parametrize("text", [
    "HMM HOPE",                 # no voyage -> ambiguous
    "HMM HOPE 999E",            # voyage ePort doesn't list
    "HMM HOP 062E",             # name must be identical
    "HMM 062E",
    "MSC VENICE FV638N",        # unknown vessel
    "",
    None,
])
def test_no_match_returns_none(text):
    assert find_eport_cutoff(text, INDEX) is None


def test_voyage_must_not_swallow_extra_words():
    # "EVER" is a prefix of "EVER CONSIST" but the leftover "CONSIST" is not a voyage
    idx = build_schedule_index([sched("EVER", "0556-070S")])
    assert find_eport_cutoff("EVER CONSIST 0556-070S", idx) is None


def test_ambiguous_sites_are_skipped_and_identical_ones_are_not():
    diff = build_schedule_index([sched("HMM HOPE", "062E-062E", "2026-09-23 11:00:00"),
                                 sched("HMM HOPE", "062E-062E", "2026-09-24 11:00:00")])
    assert find_eport_cutoff("HMM HOPE 062E", diff) is None
    same = build_schedule_index([sched("HMM HOPE", "062E-062E"), sched("HMM HOPE", "062E-062E")])
    assert find_eport_cutoff("HMM HOPE 062E", same) == "23/09/2026 11:00"


@pytest.mark.parametrize("raw, expected", [
    ("2026-09-23 11:00:00", "23/09/2026 11:00"),
    ("2026-09-23 11:00", "23/09/2026 11:00"),
    ("06:00 16/09/2026", "16/09/2026 06:00"),       # format stored by older versions
    ("6:05 1/9/2026", "01/09/2026 06:05"),
    ("23/09/2026 11:00", "23/09/2026 11:00"),
    ("23/09/2026", None),                           # a date alone is not a cut-off
    ("", None),
    (None, None),
    ("/Date(-2209017600000)/", None),   # ePort placeholder for "no date"
    ("1900-01-01 00:00:00", None),
    ("2026-13-40 00:00:00", None),
    ("not a date", None),
])
def test_parse_closing_time(raw, expected):
    assert parse_closing_time(raw) == expected


def test_matches_vessel_rows_stored_in_the_old_display_format():
    idx = build_schedule_index([sched("HMM HOPE", "062E-062E", "11:00 23/09/2026")])
    assert find_eport_cutoff("HMM HOPE 062E(EC2)", idx) == "23/09/2026 11:00"
