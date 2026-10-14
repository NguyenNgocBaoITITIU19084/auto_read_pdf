import json
from pathlib import Path

from backend.app.services.carrier_parsers import find_parser, maersk
from backend.app.services.extractor import extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of DB_aabhijjieggd0x0E21.pdf (page 1, notes trimmed)
MAERSK_TEXT = """BOOKING CONFIRMATION
Booking No.: 277374922 Print Date: 2026-09-21 09:57 UTC
Booked by Party: NESTLE INTEGRATED BUSINESS SERVICES Service Mode: CY/CY
Contact Name: ARVIN ALLEN LLAMOSA From: Ho Chi Minh City,Ho Chi Minh,Vietnam
Booked by Ref. No: C202609210039 To: Cagayan de Oro,Philippines
Service Contract: 65918167 Cargo Detail: FOODGRADE - PQC
Price Owner: NESTLE SUISSE SA Business Unit: Maersk Line Ho Chi Minh
Named Account Customer: NESTLE SUISSE SA Commodity Description:Coffee, roasted , non-frozen
Service : IA9
FOODGRADE - PQC
|
|
Price Calculation Date: 2026-10-26
Equipment
Quantity Size/Type/Height (ft.in) Collapsible Sub. Equip Gross Weight Pack. Qty/Kind Cargo Volume
2 40 DRY 9 6 30000.000 KGS 2 CARTON(S) /CARTON(S)
Intended Transport Plan
From To Mode Vessel Voy No. ETD ETA
Cat Lai Terminal Pelabuhan Tanjung Pelepas MVS MAERSK NUSSFJORD(PA) 641S 2026-10-26 2026-10-31
Terminal
Pelabuhan Tanjung Pelepas Mindanao Container MVS AS SOPHIA(PT) 645N 2026-11-02 2026-11-18
Terminal Terminal
Load Itinerary
Type Location Release Date From To Return Date Time Load Ref.
Empty Container Tan Cang My Thuy Depot 2026-10-20 01:00
Depot Tan Cang My Thuy Depot
Industrial Zone district 2, Ward Tha
Ho Chi Minh City
Return Equip Cat Lai Terminal
Delivery Terminal Cat Lai Terminal
1295B Nguyen Thi dinh, Cat LAi Dist
Ho Chi Minh City
"""

# Offline OCR (Apple Vision) of the same page: the transport plan comes out column by column
MAERSK_OCR = """BOOKING CONFIRMATION
MAERSK
Booking No.: 277374922
Booked by Party:
NESTLE INTEGRATED BUSINESS SERVICES
Contact Name:
ARVIN ALLEN LLAMOSA
Booked by Ref. No:
C202609210039
Service Contract:
65918167
Price Owner:
NESTLE SUISSE SA
Named Account Customer:
NESTLE SUISSE SA
Print Date: 2026-09-21 09:57 UTC
Service Mode:
CY/CY
From:
Ho Chi Minh City, Ho Chi Minh, Vietnam
To:
Cagayan de Oro, Philippines
Equipment
Quantity
2
Size/Type/Height
(ft.in)
40 DRY 96
Collapsible
Sub. Equip
Gross Weight
30000.000 KGS
Intended Transport Plan
From
To
Mode
Vessel
Cat Lai Terminal
Pelabuhan Tanjung Pelepas MVS
MAERSK NUSSFJORD(PA)
Terminal
Pelabuhan Tanjung Pelepas Mindanao Container
MVS
AS SOPHIA(PT)
Terminal
Terminal
Pack. Qty/Kind
Cargo Volume
2 CARTON(S) / CARTON(S)
Voy No.
641S
645N
ETD
2026-10-26
2026-11-02
ETA
2026-10-31
2026-11-18
Load Itinerary
Type
Empty Container
Depot
Release Date
From
To
Return Date
Time
Load Ref.
2026-10-20
01:00
Return Equip
Delivery Terminal
Location
Tan Cang My Thuy Depot
Tan Cang My Thuy Depot
Industrial Zone district 2, Ward Tha
Ho Chi Minh City
Cat Lai Terminal
Cat Lai Terminal
1295B Nguyen Thi dinh, Cat LAi Dist
Ho Chi Minh City
"""


def _plan_words():
    return json.loads((FIXTURES / "maersk_words.json").read_text())


def _assert_common(r):
    assert r["Booking No"] == "277374922"
    assert r["Carrier"] == "MAERSK"
    assert r["Vessel"] == r["Pre Carrier"] == "MAERSK NUSSFJORD 641S"
    assert r["ETD"] == r["ETD_Pre"] == "26/10/2026"
    assert r["Trunk Vessel"] == "AS SOPHIA 645N"
    assert r["ETD_Trunk"] == "02/11/2026"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "2"
    assert r["Empty Pick Up CY"] == "TAN CANG MY THUY DEPOT"
    assert r["Full return CY"] == "CAT LAI TERMINAL"
    assert r["Port Cargo Cut-off"] == "null"


def test_maersk_layout_is_detected():
    assert find_parser(MAERSK_TEXT) is maersk
    assert find_parser(MAERSK_OCR) is maersk


def test_maersk_transport_plan_from_word_boxes():
    r = extract_booking_from_text(MAERSK_TEXT, "DB_aabhijjieggd0x0E21.pdf", [_plan_words()])
    _assert_common(r)
    assert r["T/S Port"] == "PELABUHAN TANJUNG PELEPAS TERMINAL"
    assert r["Port of Discharging"] == "MINDANAO CONTAINER TERMINAL"
    assert r["Place of Delivery"] == "CAGAYAN DE ORO,PHILIPPINES"


def test_maersk_transport_plan_on_the_last_page():
    r = extract_booking_from_text(MAERSK_TEXT, "maersk.pdf", [[], [], _plan_words()])
    assert r["T/S Port"] == "PELABUHAN TANJUNG PELEPAS TERMINAL"
    assert r["Port of Discharging"] == "MINDANAO CONTAINER TERMINAL"


def test_maersk_offline_ocr_columns():
    r = extract_booking_from_text(MAERSK_OCR, "maersk.jpg")
    _assert_common(r)
    assert r["Place of Delivery"] == "CAGAYAN DE ORO, PHILIPPINES"
    # From / To names are merged by OCR: left empty rather than guessed
    assert r["T/S Port"] == "null"
    assert r["Port of Discharging"] == "null"


def test_maersk_skips_barge_leg_and_reads_direct_route():
    words = _plan_words()
    first_leg = min(w["top"] for w in words if w["text"] == "MVS")
    # Drop the second leg, and add a barge leg from an ICD above the vessel leg
    words = [w for w in words if w["top"] <= first_leg + 12 or w["top"] > first_leg + 40]
    words = [dict(w, top=w["top"] + 10) if w["top"] >= first_leg else w for w in words]
    words += [{"text": t, "x0": x, "x1": x + 30, "top": first_leg}
              for t, x in (("ICD", 32.0), ("Cat", 131.0), ("Lai", 145.0), ("BAR", 230.0), ("BARGE", 273.0),
                           ("TBA", 372.0), ("2026-10-24", 417.0))]
    r = extract_booking_from_text(MAERSK_TEXT, "maersk.pdf", [words])
    assert r["Vessel"] == r["Trunk Vessel"] == "MAERSK NUSSFJORD 641S"
    assert r["ETD"] == "26/10/2026"
    assert r["Pre Carrier"] == "null"
    assert r["T/S Port"] == "null"
    assert r["Port of Discharging"] == "PELABUHAN TANJUNG PELEPAS TERMINAL"
