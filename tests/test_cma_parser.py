import json
from pathlib import Path

from backend.app.services.carrier_parsers import cma, find_parser
from backend.app.services.extractor import extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of BKGCONF_SGN3454804.pdf, page 2 (booking details up to the depot information)
CMA_TEXT = """Booking Confirmation
Booking Confirmation Date:
SGN3454804 14-SEP-2026 06:59
From: CMA CGM VIETNAM To: NESTLE INTEGRATED BUSINESS SERVICES
Booking Number: SGN3454804 Customer Ref: 2971-VNTuanDi1
Electronic REF: C202608250005 Contact Email: OHUB.OPERATIONS.AOA.NBSMANILA@PH.NESTLE.
COM
Quote: GA056X
Quote Validity Period: 01-AUG-2026 - 30-APR-2027
PARTIES INFORMATION
Booking Party:NESTLE INTEGRATED BUSINESS Shipper:NESTLE VIETNAM LTD
SERVICES Country: VN
Address:YYA+CIANELLE MANAGAOANG
Country: PH
Party REF: 2971-VNTuanDi1
Deciding Party:NESTLE SA HEADQUARTERS
Country: Switzerland
ROUTE INFORMATION
Movement Terms: Ramp / Ramp
Departure Vessel / Mode of
Location Arrival (ETA) LVR Service Terminal
(ETD) Transport
HO CHI MINH CITY Barge
VUNG TAU 20-OCT-2026 21-OCT-2026 CMA CGM LITANI PX30C0E19 PEX3 GEMALINK PORT
SHEKOU CONTAINER TERMINAL
SHEKOU 01-NOV-2026 01-NOV-2026 HENG HUI 6 CM30W0W19 CIMEX3
LTD
FUJAIRAH 17-NOV-2026 Rail/Road FUJAYRAH PORT
JEBEL ALI
CUT-OFF INFORMATION
SI Cut-Off VGM Cut-Off Port Cut-Off
19-OCT-2026 11:59 19-OCT-2026 11:59 20-OCT-2026 21:21
CARGO INFORMATION 1
Container Quantity Container Number Seal No. Container Grade HS Code Commodity Net Cargo weight Gross Cargo weight
1 x 40'HC Foodstuff 210111 Extracts, essences 15000 KGM 18900 KGM
and concentrates,
of coffee
DEPOT AND TERMINAL INFORMATION
Empty Pickup Location: HO CHI MINH CITY Eqp Available Date: 09-Oct-26
Pickup Mode: Road
"""

# Offline OCR (Apple Vision) of the same page: the route table comes out column by column
CMA_OCR = """Booking Number: SGN3454804
Electronic REF: C202608250005
Booking Confirmation
SGN3454804
Booking Confirmation Date:
14-SEP-2026 06:59
To: NESTLE INTEGRATED BUSINESS SERVICES
Customer Ref: 2971-VNTuanDi1
Contact Email: OHUB.OPERATIONS.AOA.NBSMANILA@PH.NESTLE.
COM
Quote: GA056X
Quote Validity Period: 01-AUG-2026 - 30-APR-2027
Shipper: NESTLE VIETNAM LTD
Country: VN
PARTIES INFORMATION
Booking Party: NESTLE INTEGRATED BUSINESS
SERVICES
Address: YYA+CIANELLE MANAGAOANG
Country: PH
Party REF: 2971-VNTuanDi1
Deciding Party: NESTLE SA HEADQUARTERS
Country: Switzerland
ROUTE INFORMATION
Location
Arrival (ETA)
Departure
(ETD)
HO CHI MINH CITY
VUNG TAU
20-OCT-2026
21-OCT-2026
SHEKOU
01-NOV-2026
01-NOV-2026
FUJAIRAH
17-NOV-2026
JEBEL ALI
CUT-OFF INFORMATION
VGM Cut-Off
Vessel / Mode of
Transport
Barge
CMA CGM LITANI
HENG HUI 6
Rail/Road
SI Cut-Off
Port Cut-Off
19-OCT-2026 11:59 19-OCT-2026 11:59
20-OCT-2026 21:21
CARGO INFORMATION 1
Container Quantity
Container Number
Seal No.
Container Grade
1 x 40'HC
Foodstuff
LVR
Service
PX30C0E19
PEX3
CM30WOW19 CIMEX3
Movement Terms: Ramp / Ramp
Terminal
GEMALINK PORT
SHEKOU CONTAINER TERMINAL
LTD
FUJAYRAH PORT
HS Code
Commodity
Net Cargo weight
210111
Extracts, essences
and concentrates,
of coffee
15000 KGM
Gross Cargo weight
18900 KGM
DEPOT AND TERMINAL INFORMATION
Empty Pickup Location: HO CHI MINH CITY
Eqp Available Date: 09-Oct-26
Pickup Mode: Road
"""


def _words():
    return [json.loads((FIXTURES / "cma_words.json").read_text())]


def _assert_booking(r):
    assert r["Booking No"] == "SGN3454804"
    assert r["Carrier"] == "CMA CGM"
    assert r["Vessel"] == r["Pre Carrier"] == "CMA CGM LITANI PX30C0E19"
    assert r["ETD"] == r["ETD_Pre"] == "21/10/2026"
    assert r["Trunk Vessel"].startswith("HENG HUI 6 CM30")  # OCR reads its voyage as 'CM30WOW19'
    assert r["ETD_Trunk"] == "01/11/2026"
    assert r["T/S Port"] == "SHEKOU"
    assert r["Port of Discharging"] == "JEBEL ALI"
    assert r["Place of Delivery"] == "JEBEL ALI"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "HO CHI MINH CITY"
    assert r["Full return CY"] == "GEMALINK PORT"
    assert r["Port Cargo Cut-off"] == "20/10/2026 21:21"


def test_cma_layout_is_detected():
    assert find_parser(CMA_TEXT) is cma
    assert find_parser(CMA_OCR) is cma


def test_cma_route_table_from_word_boxes():
    _assert_booking(extract_booking_from_text(CMA_TEXT, "BKGCONF_SGN3454804.pdf", _words()))


def test_cma_route_table_from_text_lines():
    _assert_booking(extract_booking_from_text(CMA_TEXT, "BKGCONF_SGN3454804.pdf"))


def test_cma_offline_ocr_columns():
    _assert_booking(extract_booking_from_text(CMA_OCR, "cma.jpg"))


def test_cma_route_columns_split_by_header():
    route = cma._route_from_words(_words())
    assert [r["location"] for r in route] == ["HO CHI MINH CITY", "VUNG TAU", "SHEKOU", "FUJAIRAH", "JEBEL ALI"]
    assert route[1]["vessel"] == "CMA CGM LITANI" and route[1]["voyage"] == "PX30C0E19"
    assert route[2]["terminal"] == "SHEKOU CONTAINER TERMINAL LTD"


def test_anl_direct_booking_is_read_as_cma_cgm():
    text = (CMA_TEXT
            .replace("From: CMA CGM VIETNAM", "From: ANL CONTAINER LINE")
            .replace("SHEKOU CONTAINER TERMINAL\n", "")
            .replace("SHEKOU 01-NOV-2026 01-NOV-2026 HENG HUI 6 CM30W0W19 CIMEX3\nLTD\n", "")
            .replace("1 x 40'HC", "2 x 20'GP"))
    r = extract_booking_from_text(text, "anl.pdf")
    assert r["Carrier"] == "CMA CGM"
    assert r["T/S Port"] == "null"
    assert r["Pre Carrier"] == "null"
    assert r["Vessel"] == r["Trunk Vessel"] == "CMA CGM LITANI PX30C0E19"
    assert r["Port of Discharging"] == "JEBEL ALI"
    assert r["Equipment Type"] == "20'GP"
    assert r["Q'ty"] == "2"
