import json
from pathlib import Path

from backend.app.services.carrier_parsers import find_parser, interasia
from backend.app.services.extractor import detect_carrier, extract_booking_from_text

FIXTURES = Path(__file__).parent / "fixtures" / "booking_layouts"

# Text layer of Interasia_E_SO_A59GX32592.pdf (pages 1-2 up to the bulletin, plus its sign-off: the logo is
# an image, so the carrier is only named in the bulletin): bold labels doubled
INTERASIA_TEXT = """Move ahead. Interasia Lines, Ltd.
BBOOOOKKIINNGG CCOONNFFIIRRMMAATTIIOONN
**SShhiippppeerr **CCoonnssiiggnneeee
NNaammee:: REAL LOGISTICS CO., LTD NNaammee::
PPIICC:: Booking team PPIICC::
EE--mmaaiill::
EE--mmaaiill:: booking@reallogistics.vn
pricing@reallogistics.vn
PPOODD:: PASIR GUDANG,JOHOR, MALAYSIA
CCoonnttrraacctt NNoo::
PPLLDD:: PASIR GUDANG,JOHOR, MALAYSIA
**BBooookkeerr
EETTAA:: 2026-10-25
NNaammee:: REAL LOGISTICS CO., LTD
PPLLRR:: CAT LAI PORT, VIETNAM
PPOOLL:: CAT LAI PORT, VIETNAM
CClloossee DDaattee:: 2026-10-14 09:00
SSII CCuutt OOffff DDaattee:: 2026-10-13 14:00
EETTDD:: 2026-10-15
TTFFCC CCooddee:: S11528E
BBooookk NNoo BBooookkiinngg SSttaattuuss VVeesssseell NNaammee VVooyyaaggee
A59GX32592 Confirmed WAN HAI 286 S115
____________________________________ ____________________________________ ____________________________________ ____________________________________
TTSS PPoorrtt
MYPKG
CCoonnttaaiinneerr IInnffoorrmmaattiioonn 11
OOuutt DDeeppoott IInn DDeeppoott
Phuc Xuan Tan Van Depot CAT LAI TML
TTeell:: TTeell::
(+84) 274 6562618 19005168
AAdddd:: AAdddd::
Tan Van Highway, Binh An Ward, Di An Tow 1295B Nguyen Thi Dinh, Cat Lai Ward, Dist 2
n, Binh Duong Province , HCMC, Vietnam
CCoonnttaaiinneerr TTyyppee CCoonnttaaiinneerr SSiizzee CCoonnttaaiinneerr HHeeiigghhtt CCoonnttaaiinneerr VVoolluummee
SD 40 96 1
CCoonnttaaiinneerr KKiinndd PPOOLL TTeerrmm PPOODD TTeerrmm FFuullll//EEmmppttyy
CY-CY (FCL-FCL) CY CY F
CCoommmmooddiittyy OOvveerr WWeeiigghhtt
confectionery N
RReemmaarrkk
CAP CONT SACH TOT HOT SHIPMENT
"""

# Offline OCR (Apple Vision) of pages 1-2: each label with its value below, or a run of labels then values
INTERASIA_OCR = """• Interasia
BOOKING CONFIRMATION
*Shipper
Name: REAL LOGISTICS CO., LTD
PIC: Booking team
E-mail: booking@reallogistics.vn
pricing@reallogistics.vn
Contract No:
*Consignee
Name:
PIC:
E-mail:
POD: PASIR GUDANG,JOHOR, MALAYSIA
PLD: PASIR GUDANG,JOHOR, MALAYSIA
ETA: 2026-10-25
*Booker
Name: REAL LOGISTICS CO., LTD
PLR: CAT LAI PORT, VIETNAM
POL: CAT LAI PORT, VIETNAM
Close Date: 2026-10-14 09:00
SI Cut Off Date: 2026-10-13 14:00
ETD: 2026-10-15
TFC Code: S11528E
Book No
A59GX32592
Booking Status
Confirmed
Vessel Name
WAN HAI 286
Voyage
S115
TS Port
MYPKG
Container Information 1
Out Depot
Phuc Xuan Tan Van Depot
Tel:
(+84) 274 6562618
Add:
Tan Van Highway, Binh An Ward, Di An Tow
n, Binh Duong Province
Container Type
SD
Container Size
40
Container Kind
CY-CY (FCL-FCL)
POL Term
CY
Commodity
confectionery
In Depot
CAT LAI TML
Tel:
19005168
Add:
1295B Nguyen Thi Dinh, Cat Lai Ward, Dist 2
, HCMC, Vietnam
Container Height
Container Volume
96
1
POD Term
CY
Full/Empty
F
Over Weight
N
"""


def _words():
    return json.loads((FIXTURES / "interasia_words.json").read_text())


def _assert_booking(r):
    assert r["Booking No"] == "A59GX32592"
    assert r["Carrier"] == "INTERASIA"
    assert r["Vessel"] == r["Trunk Vessel"] == "WAN HAI 286 S115"
    assert r["ETD"] == r["ETD_Trunk"] == "15/10/2026"
    assert r["T/S Port"] == "MYPKG"
    assert r["Port of Discharging"] == r["Place of Delivery"] == "PASIR GUDANG,JOHOR, MALAYSIA"
    assert r["Block"] == "null"
    assert r["Equipment Type"] == "40'HC"
    assert r["Q'ty"] == "1"
    assert r["Empty Pick Up CY"] == "PHUC XUAN TAN VAN DEPOT"
    assert r["Full return CY"] == "CAT LAI TML"
    assert r["Port Cargo Cut-off"] == "14/10/2026 09:00"


def test_interasia_layout_is_detected():
    assert find_parser(INTERASIA_TEXT) is interasia
    assert find_parser(INTERASIA_OCR) is interasia


def test_interasia_grid_from_word_boxes():
    _assert_booking(extract_booking_from_text(INTERASIA_TEXT, "Interasia_E_SO_A59GX32592.pdf", _words()))


def test_interasia_offline_ocr():
    _assert_booking(extract_booking_from_text(INTERASIA_OCR, "interasia.jpg"))


def test_interasia_carrier_is_not_wan_hai():
    assert detect_carrier("Move ahead. Interasia Lines, Ltd. WAN HAI 286 S115") == "INTERASIA"


def test_undouble_only_touches_doubled_labels():
    assert interasia._undouble("BBooookk") == "Book"
    assert interasia._undouble("PPOODD::") == "POD:"
    assert interasia._undouble("A59GX32592") == "A59GX32592"
    assert interasia._undouble("11") == "11"
    assert interasia._undouble("1100") == "1100"


def test_interasia_reefer_and_several_containers():
    assert interasia._equipment(["SD", "RF"], ["40", "20"], ["96", "86"], ["2", "1"]) == ("2 X 40'HC + 1 X 20'RF", "3")
