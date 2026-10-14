from backend.app.services.carrier_parsers import find_parser, tslines
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

# Text layer of 341BK6004600_202607071256.pdf (page 1 up to the booking creator): leg 1 on an Interasia vessel
TSLINES_TEXT = """RELEASE ORDER
RELEASE ORDER NO. 341BK6004600-0
BOOKING NO.: 341BK6004600
UNBL NUMBER: 341610046638 *341BK6004600-0*
PRINT DATE: 07-Jul-2026 SO No.:
RELEASE FROM: G-FORTUNE DONG AN
RETURN INTO: CAT LAI CLOSING DATE: 10-JUL-2026 05:00
LEG VESSEL VESSEL NAME VOYAGE POL POL ETA/ETD POD POD ETA
1 IETE INTERASIA ELEVATE N068 VNHCM 10-JUL-2026 00:00/11-JUL-2026 00:00 CNSKU 14-JUL-2026 00:00
2 EVEN EVER ENVOY 203S CNSKU 15-JUL-2026 00:00/16-JUL-2026 00:00 AUBNE 01-AUG-2026 00:00
PLACE OF RECEIPT: HOCHIMINH-CAT LAI
PORT OF LOADING: HOCHIMINH-CAT LAI
PORT OF DISCHARGE: BRISBANE
FINAL PLACE OF DELIVERY: BRISBANE
VANNING LOCATION: Warehouse
NO. OF PKGS: 100 Commodity: TOILET PAPER
HS CODE: 4818100000
GR. WT. : 11 (MT)
CONT. QTY/TYPE: 1X40HQ
NOTES:
CUSTOMER: SUPER CARGO SERVICE PHONE: 0384053467
SHIPPER: SUPER CARGO SERVICE PHONE: 0384053467
SPECIAL INSTRUCTION: CAP CONT SACH TOT//TS PORT SHEKOU
Validate Date:07-JUL-2026 - 10-JUL-2026
For & on behalf of
T.S. CONTAINER LINES VIETNAM COMPANY LIMITED
As Agents Only
"""

# Offline OCR (Apple Vision) of the same page: 'LABEL:' / value lines, leg table split into columns
TSLINES_OCR = """T.S. LINES
RELEASE ORDER
RELEASE ORDER NO.
341BK6004600-0
BOOKING NO.:
341BK6004600
UNBL NUMBER:
341610046638
*341BK6004600-0*
PRINT DATE: 07-Jul-2026
SO No.:
RELEASE FROM:
G-FORTUNE DONG AN
RETURN INTO:
CAT LAI
LEG VESSEL VESSEL NAME
VOYAGE
IETE
INTERASIA ELEVATE N068
EVEN
TEVER ENVOY
203S
PLACE OF RECEIPT:
HOCHIMINH-CAT LAI
PORT OF LOADING:
HOCHIMINH-CAT LAI
PORT OF DISCHARGE:
BRISBANE
FINAL PLACE OF DELIVERY: BRISBANE
VANNING LOCATION:
Warehouse
NO. OF PKGS: 100
Commodity:
TOILET PAPER
HS CODE: 4818100000
CLOSING DATE: 10-JUL-2026 05:00
POL POL ETAVETD
POD PODETA
VNHCM 10-JUL-2026 00:00/11-JUL-2026 00:00
CNSKU 14-JUL-2026 00:00
CNSKU 15-JUL-2026 00:00/16-JUL-2026 00:00 AUBNE 01-AUG-2026 00:00
GR. WT.:
11 (MT)
CONT. QTY/TYPE: 1X40HQ
NOTES:
CUSTOMER: SUPER CARGO SERVICE
SHIPPER:
SUPER CARGO SERVICE
PHONE: 0384053467
PHONE: 0384053467
SPECIAL INSTRUCTION: CAP CONT SACH TOT//TS PORT SHEKOU
"""


def _assert_booking(r):
    assert r["Booking No"] == "341BK6004600"
    assert r["Carrier"] == "TS LINE"  # not INTERASIA, despite the vessel name
    assert r["Vessel"] == r["Pre Carrier"] == "INTERASIA ELEVATE N068"
    assert r["ETD"] == r["ETD_Pre"] == "11/07/2026 00:00"
    assert r["Trunk Vessel"].endswith("EVER ENVOY 203S")  # OCR reads 'TEVER ENVOY'
    assert r["ETD_Trunk"] == "16/07/2026 00:00"
    assert r["T/S Port"] == "SHEKOU (CNSKU)"
    assert r["Port of Discharging"] == "BRISBANE (AUBNE)"
    assert r["Place of Delivery"] == "BRISBANE"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "G-FORTUNE DONG AN"
    assert r["Full return CY"] == "CAT LAI"
    assert r["Port Cargo Cut-off"] == "10/07/2026 05:00"


def test_tslines_layout_is_detected():
    assert find_parser(TSLINES_TEXT) is tslines
    assert find_parser(TSLINES_OCR) is tslines


def test_tslines_release_order_fields():
    _assert_booking(extract_booking_from_text(TSLINES_TEXT, "341BK6004600_202607071256.pdf"))


def test_tslines_offline_ocr():
    _assert_booking(extract_booking_from_text(TSLINES_OCR, "tslines.jpg"))


def test_tslines_carrier_detection_ignores_partner_vessel_names():
    assert detect_carrier("T.S. CONTAINER LINES VIETNAM COMPANY LIMITED\n1 IETE INTERASIA ELEVATE N068") == "TS LINE"
    assert detect_carrier("terms and conditions of T. S. Lines bill of lading") == "TS LINE"
    assert detect_carrier("Move ahead. Interasia Lines, Ltd.") == "INTERASIA"


def test_tslines_direct_route_and_mixed_equipment():
    text = (TSLINES_TEXT
            .replace("1 IETE INTERASIA ELEVATE N068 VNHCM 10-JUL-2026 00:00/11-JUL-2026 00:00 CNSKU 14-JUL-2026 00:00\n"
                     "2 EVEN EVER ENVOY 203S CNSKU 15-JUL-2026 00:00/16-JUL-2026 00:00 AUBNE 01-AUG-2026 00:00",
                     "1 EVEN EVER ENVOY 203S VNHCM 10-JUL-2026 00:00/11-JUL-2026 00:00 AUBNE 01-AUG-2026 00:00")
            .replace("1X40HQ", "1X40HQ, 2X20GP"))
    r = extract_booking_from_text(text, "tslines.pdf")
    assert r["T/S Port"] == "null"
    assert r["Pre Carrier"] == "null"
    assert r["Vessel"] == r["Trunk Vessel"] == "EVER ENVOY 203S"
    assert r["Port of Discharging"] == "BRISBANE (AUBNE)"
    assert r["Equipment Type"] == "1 X 40'HC + 2 X 20'GP"
    assert r["Q'ty"] == "3"
