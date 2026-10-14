from backend.app.services.carrier_parsers import find_parser, hmm
from backend.app.services.extractor import extract_booking_from_text

# Text layer of 'SGNM42330700 -- empty release.pdf' (page 1, up to the special instructions)
HMM_TEXT = """Booking Notice < Booking Status : Firm >
Thank you for booking with HMM, please review the booking details below and advise us of any discrepancies and/or changes, if required.
Booking Date : 2026/03/18 10:45 VGM PIN : 8308 Attn : Sarah Pham
Tel No. : +84 (08) 39435330 Fax No. : E-mail : sarahpham@sejunggroup.com
Booking Information
Booking Number : SGNM42330700
Booking Office : SGNBR Tel No. : +84-28-38233798 Fax No. :
Booking Staff BOMSC / Om Padyal Tel No. : E-mail : inomp@hmm21.com
HMM Sales Person : SGNBR / Nguyen Thi Thuy Duong Tel No. : +84-28-3823-3798 E-mail : vnntd@hmm21.com
B/L Issue Office :
Customer Information
Shipper : SE JUNG SHIPPING CO.,LTD Forwarder :
Customer's Ref.No : S/C : KR25L2095 N/Cust : OVERSEAS FOOD TRADING
Shipping Information
1st Vessel/Voyage : HMM HANUL 025E(KMP/HMM) T/S Port : Call Sign : D7NO
2nd Vessel/Voyage : T/S Port : Call Sign :
3rd Vessel/Voyage : Call Sign :
Place of Receipt : HOCHIMINH, VIETNAM Trans Mode : Barge (Origin)
Port of Loading : BA RIA VUNG TAU, TML : TANCANG-CAIMEP INTERNATIONAL Facility Code : VNQOECIT
ETB : 2026/04/03 19:00 ETD : 2026/04/05 02:00
Port of Discharging : LONG BEACH, CA(USLGB) TML : INTERNATIONAL TRANSPORTATION SERVICES ETA : 2026/04/26 21:00
Place of Delivery : LONG BEACH, CA TML : INTERNATIONAL TRANSPORTATION SERVICES ETA : 2026/04/26 21:00
Rec./Del. Term : CY / CY Block : USLB6 Stop Off : N Rating Date : 2026/04/05
Cargo Information ** Equipment subject to Availability **
Equipment Type : Dry Container Equipment Size : 4H Equipment Qty : 1 SOC Qty : 0
Equipment Type : Equipment Size : Equipment Qty : SOC Qty :
Equipment Type : Equipment Size : Equipment Qty : SOC Qty :
Commodity Code : 2100000001 Commodity Desc. : FOODSTUFFS, NOS Flex EQ : No
PKG-Count : 0 Gross WGT : 15,000.000 KGS Measurement : 0
Special Cargo Information
RF : No DG : No Oversize/Bulk : No / No Licensed Auto / Flexi-Bag : No / No Rev.Empty : No Hide : No
Food Grade /
Pick- up/Return Location ** Pick-up CY subject to Availability **
Empty Pick-up CY : TAN CANG HMM LOGISTICS CO., LTD Estimated Empty Pick-up Date (for shipper's own reference) : 2026/03/30 19:00
(Business Hours) : Type/Size / QTY :
Address : 938A13, Road A, Cat Lai Industrial Park Thanh My Tel No. : +84 28 36366190 Fax No. : +84 28 36366191
Full Return CY : CAT LAI TERMINAL
(Business Hours) : 00:00 ~ 23:59 (Weekdays) 00:00 ~ 23:59
Address : INTER PROVINCIAL ROAD NO.25 (NGUYEN THI Tel No. : 0084 08 5120591 Fax No. : 0084 08 5120591
Estimated Cut- off Information (If the Documentation cut- off falls on the weekend, documents are due the Friday before).
Cargo Cut-off (Terminal Facility) (DC) 2026/04/02 07:00 Cargo Cut-off (Return Facility) (DC) 2026/04/02 07:00
SI General Cut-off 2026/04/01 09:00 VGM Cut-off 2026/04/01 09:00
Door Information (Only in case that receive term is Door)
Special Instructions
REMARK "HOT DELIVERY"
FULL RETURN CY: CAT LAI GIANG NAM
HMM SC# KR25L2095 BULLET 4 NAC: OVERSEAS FOOD TRADING.
Booking Reference No. : SGNM42330700
"""

# Offline OCR (Apple Vision) of the same page: ': value' on the next line, equipment in columns
HMM_OCR = """HMM
Booking Notice
< Booking Status: Firm >
Thank you for booking with HMM, please review the booking details below and advise us of any discrepancies and/or changes, if required.
Booking Date
Tel No.
2026/03/18 10:45
+84 (08) 39435330
Booking Information
Booking Number
Booking Office
Booking Staff
HMM Sales Person
: SGNM42330700
: SGNBR
BOMSC / Om Padyal
: SGNBR / Nguyen Thi Thuy Duong
B/L Issue Office
Customer Information
Shipper
: SE JUNG SHIPPING CO.,LTD
Customer's Ref.No
Shipping Information
1st Vessel/Voyage : HMM HANUL 025E(KMP/HMM)
2nd VesselVoyage :
3гd Vessel/Voyage :
Place of Receipt
Port of Loading
: HOCHIMINH, VIETNAM
: BA RIA VUNG TAU,
VGM PIN : 8308
Fax No. :
Attn : Sarah Pham
E-mail : sarahpham@sejunggroup.com
Tel No. : +84-28-38233798
Tel No.
Tel No. : +84-28-3823-3798
Fax No.
E-mail : inomp@hmm21.com
E-mail : vnntd@hmm21.com
Forwarder
S/C : KR25L2095
N/Cust : OVERSEAS FOOD TRADING
T/S Port:
T/S Port :
Call Sign : D7NO
Call Sign :
Call Sign :
Trans Mode : Barge (Origin)
TML : TANCANG-CAIMEP INTERNATIONAL Facility Code : VNQOECIT
ETB : 2026/04/03 19:00
Port of Discharging : LONG BEACH, CA(USLGB)
TML : INTERNATIONAL TRANSPORTATION SERVICES
Place of Delivery
: LONG BEACH, CA
TML : INTERNATIONAL TRANSPORTATION SERVICES
Rec./Del. Term
: CY / CY
Block : USLB6
Stop Off : N
Cargo Information ** Equipment subject to Availability **
Equipment Type
: Dry Container
Equipment Size : 4H
Equipment Type
Equipment Size :
Equipment Type
Equipment Size :
Equipment Qty : 1
Equipment Qty :
Equipment Qty :
ETD : 2026/04/05 02:00
ETA : 2026/04/26 21:00
ETA: 2026/04/26 21:00
Rating Date : 2026/04/05
SOC Qty : 0
SOC Qty :
SOC Qty :
Commodity Code
: 2100000001
PKG-Count : 0
Commodity Desc. : FOODSTUFFS, NOS
Gross WGT : 15,000.000 KGS
Flex EQ : No
Measurement : 0
Special Cargo Information
RF: No
DG : No
Oversize/Bulk : No / No Licensed Auto / Flexi-Bag: No / No Rev.Empty : No
Hide: No
Food Grade /
Pick- up/Return Location ** Pick-up CY subject to Availability **
Empty Pick-up CY
: TAN CANG HMM LOGISTICS CO., LTD
(Business Hours)
Address
: 938A13, Road A, Cat Lai Industrial Park Thanh My
Estimated Empty Pick-up Date (for shipper's own reference) : 2026/03/30 19:00
Type/Size / QTY :
Fax No. : +84 28 36366191
Tel No. : +84 28 36366190
Full Retum CY
: CAT LAI TERMINAL
(Business Hours)
: 00:00 ~ 23:59 (Weekdays) 00:00 ~ 23:59
Address
: INTER PROVINCIAL ROAD NO.25 (NGUYEN THI
Tel No. : 0084 08 5120591
Fax No. : 0084 08 5120591
Estimated Cut-off Information (If the Documentation cut- off falls on the weekend, documents are due the Friday before).
Cargo Cut-off (Terminal Facility) (DC)
2026/04/02 07:00
Cargo Cut-off (Retum Facility) (DC)
SI General Cut-off
2026/04/01 09:00
VGM Cut-off
2026/04/02 07:00
2026/04/01 09:00
Door Information (Only in case that receive term is Door)
Special Instructions
REMARK "HOT DELIVERY"
FULL RETURN CY: CAT LAI GIANG NAM
HMM SC# KR25L2095 BULLET 4 NAC: OVERSEAS FOOD TRADING.
Booking Reference No. : SGNM42330700
"""


def _assert_booking(r):
    assert r["Booking No"] == "SGNM42330700"
    assert r["Carrier"] == "HMM"
    assert r["Vessel"] == r["Trunk Vessel"] == "HMM HANUL 025E"
    assert r["ETD"] == r["ETD_Trunk"] == "05/04/2026 02:00"
    assert r["Pre Carrier"] == "null"
    assert r["T/S Port"] == "null"
    assert r["Port of Discharging"] == "LONG BEACH, CA(USLGB)"
    assert r["Place of Delivery"] == "LONG BEACH, CA"
    assert r["Block"] == "USLB6"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "TAN CANG HMM LOGISTICS CO., LTD"
    assert r["Full return CY"] == "CAT LAI TERMINAL"  # not 'CAT LAI GIANG NAM' from the remark
    assert r["Port Cargo Cut-off"] == "02/04/2026 07:00"


def test_hmm_layout_is_detected():
    assert find_parser(HMM_TEXT) is hmm
    assert find_parser(HMM_OCR) is hmm


def test_hmm_booking_notice_fields():
    _assert_booking(extract_booking_from_text(HMM_TEXT, "SGNM42330700 -- empty release.pdf"))


def test_hmm_offline_ocr_lines():
    _assert_booking(extract_booking_from_text(HMM_OCR, "hmm.jpg"))


def test_hmm_second_vessel_transshipment_and_mixed_equipment():
    text = (HMM_TEXT
            .replace("1st Vessel/Voyage : HMM HANUL 025E(KMP/HMM) T/S Port : Call Sign : D7NO",
                     "1st Vessel/Voyage : HMM HANUL 025E(KMP/HMM) T/S Port : BUSAN, KOREA Call Sign : D7NO")
            .replace("2nd Vessel/Voyage : T/S Port : Call Sign :",
                     "2nd Vessel/Voyage : HMM ALGECIRAS 0012E(HMM) T/S Port : Call Sign : D7AB")
            .replace("Equipment Type : Equipment Size : Equipment Qty : SOC Qty :",
                     "Equipment Type : Reefer Container Equipment Size : 20 Equipment Qty : 2 SOC Qty : 0", 1))
    r = extract_booking_from_text(text, "hmm.pdf")
    assert r["T/S Port"] == "BUSAN, KOREA"
    assert r["Pre Carrier"] == "HMM HANUL 025E"
    assert r["ETD_Pre"] == "05/04/2026 02:00"
    assert r["Trunk Vessel"] == "HMM ALGECIRAS 0012E"
    assert r["Equipment Type"] == "1 X 40'HC + 2 X 20'RF"
    assert r["Q'ty"] == "3"
