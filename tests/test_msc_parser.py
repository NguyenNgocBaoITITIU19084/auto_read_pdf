from backend.app.services.carrier_parsers import find_parser, msc
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

# Text layer of Booking_Confirmation_339IVN0121044.pdf (pages 1-2, legal text and parties trimmed)
MSC_TEXT = """BOOKING CONFIRMATION
MSC MEDITERRANEAN SHIPPING COMPANY S.A.
BOOKING REFERENCE ORIGINAL/SEA WAYBILL(**) MEDUABE44198 BOOKING DATE
339IVN0121044
VALID FOR GATE-IN(*) NUMBER 15/09/2026
SERVICE CONTRACT/RATE REF. N* 26-670GAC EDI TRANSACTION N* COC202609140081
FREIGHT PAYMENT TERMS COLLECT FREIGHT PAYABLE AT
CUSTOMER REFERENCE NUMBER 3487-VNNguyenHu2 PURCHASE ORDER N* 3487-VNNguyenHu2
GATE IN AT TERMINAL PHUOC AN PORT
CONTACT DETAILS .
PLACE OF ORIGIN HO CHI MINH CITY, HO CHI MINH, THANH PHO [SAI GON],VCIEATR RNIAEMR'S HAULAGE BY /SUBLOC. Barge /Inland Container Depot
PORT OF LOADING DONG NAI EST. TIME OF ARRIVAL/DEPARTURE 24/10/2026 15:00 25/10/2026 03:00
VESSEL NAME / FLAG MSC MONICA III (LLOYDS NO. 9060649) / LR VOYAGE NUMBER HR642R
PORT OF TRANSHIPMENT N*1 BUSAN EST. TIME OF DEPARTURE 05/11/2026 21:30
CONNECTING VESSEL N*1 / FLAG ONE SINCERITY (LLOYDS NO. 9976185) / SG VOYAGE NUMBER 2642E
PORT OF TRANSHIPMENT N*2 EST. TIME OF DEPARTURE
CONNECTING VESSEL N*2 / FLAG VOYAGE NUMBER
PORT OF DISCHARGE VALPARAISO EST. TIME OF ARRIVAL 13/12/2026 22:30
TERMINAL OF DISCHARGE
FINAL DESTINATION CARRIER'S HAULAGE BY /SUBLOC.
TOTAL CONTAINER (S) 2 TEUS 4 OUT OF WHICH IMO/HAZ 0 REEFER 0 S.O.C 0
Detail of equipment (including cargo description) is shown on next page. Please note that this equipment is reserved for this specific booking and cannot be used for other
shipment or booking. Any costs resulting from an undue substitution of containers and/or wrong cargo stuffing is for cargo’s account only.
GATE-IN AT TERMINAL First Receiving(Date/Time) CUT-OFF(Date/Time)
DRY 06/10/2026 00:00 20/10/2026 02:00
REEFER 06/10/2026 00:00 20/10/2026 02:00
OTHERS DATE/TIME
SHIPPING INSTRUCTIONS CUT-OFF 18/10/2026 10:00
HAZ/IMO CUT-OFF 20/10/2026 02:00
VERIFIED GROSS MASS CONFIRMATION(SOLAS) CUT-OFF 19/10/2026 04:00
SPECIAL CUT-OFF ( GATE IN AT ICDs - CUT OFF ) 19/10/2026 04:00
EQUIP.TYPE/ISO/NUMBER 40HC/4510 QUANTITY 2 HAZARDOUS N S.O.C N
PICKUP BY PICKUP REF SMART CONT.REQUESTED N
PICK UP AT DEPOT AS FROM UNTIL
DATE/TIME/LOAD.REF /
"""

# Offline OCR (Apple Vision) of the same pages: labels and values come out in separate runs
MSC_OCR = """BOOKING CONFIRMATION
BOOKING REFERENCE
VALID FOR GATE-IN(*)
339IVN0121044
ORIGINAL/SEA WAYBILL(**)
NUMBER
MEDUABE44198
BOOKING DATE
15/09/2026
Unless expressly confirmed in writing by the Carrier, each quotation issued by the Carrier is predicated upon the assumption that the value of the Goods per Container does not exceed USD 200,000.00. Should the value of the
Goods exceed this amount and the Merchant fail to notify the Carrier in writing prior to the acceptance of the quotation by the booking party, the Goods shall be deemed not to constitute an ordinary commercial shipment
made in the ordinary course of trade for the purposes of the Hague Rules or Hague-Visby Rules. In such circumstances, the Carrier's liability shall be limited to USD 200,000.00 or to the limitation provided for in the contract
of carriage, whichever is the lesser. Failure by the Merchant to provide such notification shall result in the application of a high-value commodity mis-declaration fee of not less than USD 25,000 per Container. The Merchant
ad valorem unless expressly agreed by MSC in writing and the corresponding ad valorem surcharge has been paid by the Merchant prior to the arrival of the Goods at the port of loading
SHIPPER
BOOKING REQUESTOR AND DETAIL
SERVICE CONTRACT/RATE REF. N*
26-670GAC
COLLECT
3487-VNNguyenHu2
EDI TRANSACTION N*
FREIGHT PAYABLE AT
PURCHASE ORDER N*
COC202609140081
FREIGHT PAYMENT TERMS
CUSTOMER REFERENCE NUMBER
GATE IN AT TERMINAL
CONTACT DETAILS
3487-VNNguyenHu2
PHUOC AN PORT
PLACE OF ORIGIN
PORT OF LOADING
VESSEL NAME / FLAG
PORT OF TRANSHIPMENT N*1
CONNECTING VESSEL N*1 / FLAG
PORT OF TRANSHIPMENT N*2
HO CHI MINH CITY, HO CHI MINH, THANH PHO [SAI GO CARRIER'S HAULAGE BY /SUBLOC.
DONG NAI
MSC MONICA III (LLOYDS NO. 9060649) / LR
BUSAN
EST. TIME OF ARRIVAL/DEPARTURE
VOYAGE NUMBER
EST. TIME OF DEPARTURE
ONE SINCERITY (LLOYDS NO. 9976185) / SG
VOYAGE NUMBER
EST. TIME OF DEPARTURE
VOYAGE NUMBER
VALPARAISO
EST. TIME OF ARRIVAL
Barge /Inland Container Depot
24/10/2026 15:00 25/10/2026 03:00
HR642R
05/11/2026 21:30
2642E
CONNECTING VESSEL N*2 / FLAG
PORT OF DISCHARGE
TERMINAL OF DISCHARGE
FINAL DESTINATION
13/12/2026 22:30
CARRIER'S HAULAGE BY /SUBLOC.
TOTAL CONTAINER (S)
TEUS
OUT OF WHICH
IMO/HAZ
REEFER
S.O.C
GATE-IN AT TERMINAL
First Receiving(Date/Time)
DRY
06/10/2026 00:00
06/10/2026 00:00
CUT-OFF(Date/Time)
20/10/2026 02:00
20/10/2026 02:00
REEFER
OTHERS
SHIPPING INSTRUCTIONS CUT-OFF
HAZ/IMO CUT-OFF
VERIFIED GROSS MASS CONFIRMATION(SOLAS) CUT-OFF
DATE/TIME
18/10/2026 10:00
20/10/2026 02:00
19/10/2026 04:00
19/10/2026 04:00
SPECIAL CUT-OFF ( GATE IN AT ICDs - CUT OFF)
m
SC
EQUIP. TYPE/SO/NUMBER
PICKUP BY
PICK UP AT DEPOT
ORIGIN ADDRESS
40HC/4510
QUANTITY
PICKUP REF
2
"""


def _assert_booking(r):
    assert r["Booking No"] == "339IVN0121044"
    assert r["Carrier"] == "MSC"
    assert r["Vessel"] == r["Pre Carrier"] == "MSC MONICA III HR642R"
    assert r["ETD"] == r["ETD_Pre"] == "25/10/2026 03:00"
    assert r["Trunk Vessel"] == "ONE SINCERITY 2642E"
    assert r["ETD_Trunk"] == "05/11/2026 21:30"
    assert r["T/S Port"] == "BUSAN"
    assert r["Port of Discharging"] == "VALPARAISO"
    assert r["Place of Delivery"] == "null"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "2"
    assert r["Empty Pick Up CY"] == "null"
    assert r["Full return CY"] == "PHUOC AN PORT"
    assert r["Port Cargo Cut-off"] == "19/10/2026 04:00"


def test_msc_layout_is_detected():
    assert find_parser(MSC_TEXT) is msc
    assert find_parser(MSC_OCR) is msc


def test_msc_booking_confirmation_fields():
    _assert_booking(extract_booking_from_text(MSC_TEXT, "Booking_Confirmation_339IVN0121044.pdf"))


def test_msc_offline_ocr_runs():
    _assert_booking(extract_booking_from_text(MSC_OCR, "msc.jpg"))


def test_msc_direct_route_terminal_cut_off_depot_and_final_destination():
    text = (MSC_TEXT
            .replace("PORT OF TRANSHIPMENT N*1 BUSAN EST. TIME OF DEPARTURE 05/11/2026 21:30",
                     "PORT OF TRANSHIPMENT N*1 EST. TIME OF DEPARTURE")
            .replace("CONNECTING VESSEL N*1 / FLAG ONE SINCERITY (LLOYDS NO. 9976185) / SG VOYAGE NUMBER 2642E",
                     "CONNECTING VESSEL N*1 / FLAG VOYAGE NUMBER")
            .replace("SPECIAL CUT-OFF ( GATE IN AT ICDs - CUT OFF ) 19/10/2026 04:00",
                     "SPECIAL CUT-OFF ( GATE IN AT ICDs - CUT OFF )")
            .replace("FINAL DESTINATION CARRIER'S HAULAGE BY /SUBLOC.",
                     "FINAL DESTINATION SANTIAGO CARRIER'S HAULAGE BY /SUBLOC.")
            .replace("PICK UP AT DEPOT AS FROM UNTIL", "PICK UP AT DEPOT TAN CANG MY THUY AS FROM UNTIL"))
    r = extract_booking_from_text(text, "msc.pdf")
    assert r["T/S Port"] == "null"
    assert r["Pre Carrier"] == "null"
    assert r["Vessel"] == r["Trunk Vessel"] == "MSC MONICA III HR642R"
    assert r["ETD_Trunk"] == "25/10/2026 03:00"
    assert r["Port Cargo Cut-off"] == "20/10/2026 02:00"
    assert r["Place of Delivery"] == "SANTIAGO"
    assert r["Empty Pick Up CY"] == "TAN CANG MY THUY"


def test_msc_carrier_detection():
    assert detect_carrier("MSC MEDITERRANEAN SHIPPING COMPANY S.A.") == "MSC"
    assert detect_carrier(booking_no="MEDUABE44198") == "MSC"
    assert detect_carrier(vessel="MSC MONICA III HR642R") == "MSC"
