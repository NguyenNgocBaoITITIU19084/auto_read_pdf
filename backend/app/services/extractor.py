import os
import pdfplumber
import re
from datetime import datetime

MONTH_MAP = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
    "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12"
}

def parse_date_str(date_str: str) -> str:
    """
    Normalizes dates from various formats:
    - '14Jul26' -> '14/07/2026'
    - '13Jul26 02:00' -> '13/07/2026 02:00'
    - '18Jul2617:00' -> '18/07/2026 17:00'
    - '2026-05-04' -> '2026-05-04'
    - '2026-05-03 13:00' -> '2026-05-03 13:00'
    """
    if not date_str:
        return ""
    
    date_str = date_str.strip()
    
    # Check for DDMonYY HH:MM format, e.g. 13Jul26 02:00 or 13Jul2602:00
    match_dt = re.search(r"^(\d{1,2})([A-Za-z]{3})(\d{2,4})(?:\s*(\d{1,2}:\d{2}))?$", date_str)
    if match_dt:
        day, mon, yr, time_part = match_dt.groups()
        mon_num = MONTH_MAP.get(mon.lower(), "")
        if mon_num:
            year_full = f"20{yr}" if len(yr) == 2 else yr
            day_full = f"{int(day):02d}"
            formatted = f"{day_full}/{mon_num}/{year_full}"
            if time_part:
                formatted += f" {time_part}"
            return formatted
            
    return date_str

def parse_etd(eta_etd_str: str) -> str:
    """
    Extracts and normalizes the ETD portion (after '/') of an ETA/ETD string.
    e.g. '13Jul26/14Jul26' -> '14/07/2026' or '2026-05-03/2026-05-04' -> '2026-05-04'
    """
    if not eta_etd_str:
        return ""
    parts = eta_etd_str.split("/")
    raw_etd = parts[-1].strip() if parts else ""
    return parse_date_str(raw_etd)

def detect_carrier(text: str = "", booking_no: str = "", vessel: str = "", pdf_name: str = "") -> str:
    """
    Identifies the carrier / shipping line name from extracted text and booking metadata.
    """
    upper_text = f"{text} {booking_no} {vessel} {pdf_name}".upper()
    
    if "DONGJIN" in upper_text or "DJSC" in upper_text or booking_no.upper().startswith("DJ"):
        return "DONGJIN"
    if "PACIFIC INTERNATIONAL LINES" in upper_text or "PIL" in upper_text or booking_no.upper().startswith("SGN6") or "KOTA" in vessel.upper():
        return "PIL"
    if "OCEAN NETWORK EXPRESS" in upper_text or "ONEY" in upper_text or booking_no.upper().startswith("ONEY"):
        return "ONE"
    if "SITC" in upper_text:
        return "SITC"
    if "COSCO" in upper_text or "COSU" in upper_text:
        return "COSCO"
    if "MAERSK" in upper_text or "SEALAND" in upper_text:
        return "MAERSK"
    if "CMA CGM" in upper_text or "CNC" in upper_text or "ANL" in upper_text:
        return "CMA CGM"
    if "EVERGREEN" in upper_text or "EMC" in upper_text or "EVER " in vessel.upper():
        return "EVERGREEN"
    if "WAN HAI" in upper_text or "WHL" in upper_text:
        return "WAN HAI"
    if "HAPAG-LLOYD" in upper_text:
        return "HAPAG-LLOYD"
    if "YANG MING" in upper_text or "YML" in upper_text:
        return "YANG MING"
    if "HYUNDAI" in upper_text or "HMM" in upper_text:
        return "HMM"
    if "SINOKOR" in upper_text:
        return "SINOKOR"
    if "HEUNG-A" in upper_text or "HEUNG A" in upper_text:
        return "HEUNG-A"
    if "SAMUDERA" in upper_text:
        return "SAMUDERA"
    if "TS LINES" in upper_text or "TSL" in upper_text:
        return "TS LINES"
    if "RCL" in upper_text:
        return "RCL"
    if "OOCL" in upper_text:
        return "OOCL"
        
    return "Khác"

def extract_booking_from_text(text: str, filename: str = "") -> dict:
    """
    Parses booking information from raw text extracted from PDF or OCR.
    """
    result = {
        "STT": "",
        "Tên file PDF": filename,
        "Booking No": "",
        "Carrier": "",
        "Port of Discharging": "",
        "Place of Delivery": "",
        "Block": "",
        "T/S Port": "",
        "Equipment Type": "",
        "Q'ty": "",
        "Empty Pick Up CY": "",
        "Full return CY": "",
        "Port Cargo Cut-off": "",
        "Pre Carrier": "",
        "ETD_Pre": "",
        "Trunk Vessel": "",
        "ETD_Trunk": "",
        "Vessel": "",
        "ETD": ""
    }
    
    if not text:
        for k in result:
            if k != "Tên file PDF" and k != "STT":
                result[k] = "null"
        return result
        
    try:
        # Extract Booking No
        booking_match = re.search(r"Booking\s*No\s*:\s*([A-Z0-9]+)", text, re.IGNORECASE)
        if not booking_match:
            booking_match = re.search(r"(?:Booking|BKG)\s*(?:No|Number|#)?\s*[:\.]?\s*([A-Z0-9]{6,25})", text, re.IGNORECASE)
        if booking_match:
            result["Booking No"] = booking_match.group(1).strip()
        
        # Extract Ocean Route Type & T/S Port
        ocean_route_match = re.search(r"Ocean\s*Route\s*Type\s*:\s*(.*?)(?=\n|Receiving\s*Term|Delivery\s*Term|$)", text, re.IGNORECASE)
        ocean_route_val = ocean_route_match.group(1).strip() if ocean_route_match else ""
        
        # Check T/S Port embedded in Ocean Route Type (e.g. Non-direct(T/S Port : SINGAPORE))
        ts_in_route = re.search(r"T/S\s*Port\s*:\s*([^\)]+)", ocean_route_val, re.IGNORECASE)
        if ts_in_route:
            result["T/S Port"] = ts_in_route.group(1).strip()
        elif "direct" in ocean_route_val.lower() and "non-direct" not in ocean_route_val.lower():
            result["T/S Port"] = ""
        else:
            # Standalone T/S Port search
            ts_match = re.search(r"T/S\s*Port\s*:\s*(.*?)(?=\s*(?:POD\s*/|Terminal|\)|$))", text, re.IGNORECASE)
            if ts_match:
                ts_clean = ts_match.group(1).strip()
                if ts_clean and not ts_clean.startswith(":"):
                    result["T/S Port"] = ts_clean
        
        # Extract Port of Discharging
        pod_match = re.search(r"Port\s*of\s*Discharg(?:e|ing)?\s*:\s*(.*?)(?=\s*(?:Place\s*of\s*Delivery|Final\s*Destination|Terminal|ETA|\n|$))", text, re.IGNORECASE)
        if not pod_match:
            pod_match = re.search(r"POD\s*:\s*([^\n\r]+)", text, re.IGNORECASE)
        if pod_match:
            pod_val = pod_match.group(1).strip()
            result["Port of Discharging"] = pod_val
        
        # Extract Place of Delivery / Final Destination
        deliv_match = re.search(r"(?:Place\s*of\s*Delivery|Final\s*Destination)\s*:\s*(.*?)(?=\s*(?:Terminal|Ocean\s*Route|ETA|\n|$))", text, re.IGNORECASE)
        if deliv_match:
            result["Place of Delivery"] = deliv_match.group(1).strip()
        
        # Extract Block
        block_match = re.search(r"(?:\(|^|\s)Block\s*:\s*([A-Za-z0-9]+)", text, re.IGNORECASE)
        if block_match:
            result["Block"] = block_match.group(1).strip()
        
        # Extract Equipment Type/Q'ty
        eq_match = re.search(r"Equipment\s*Type/Q['’]ty\s*:\s*(.*?)(?=\n|Commodity|Estimated|$)", text, re.IGNORECASE)
        if not eq_match:
            eq_match = re.search(r"(?:Container|Equip|Eq)\s*(?:Type|Size)?\s*[:\.]?\s*([0-9]{2}['A-Za-z0-9\s\.\-]+)", text, re.IGNORECASE)
        if eq_match:
            eq_val = eq_match.group(1).strip()
            split_match = re.search(r'^(.*?)(?:\.-|-|\.)\s*(\d+)$', eq_val)
            if split_match:
                result["Equipment Type"] = split_match.group(1).strip()
                result["Q'ty"] = split_match.group(2).strip()
            else:
                result["Equipment Type"] = eq_val
                result["Q'ty"] = ""
        
        # Extract Empty Pick Up CY
        empty_cy_match = re.search(r"Empty\s*Pick\s*UP\s*CY\s*:\s*([\s\S]*?)(?=\s*(?:Empty\s*Pick\s*Up\s*Date|Address|TEL|Yard\s*PIC|Full\s*Return|$))", text, re.IGNORECASE)
        if empty_cy_match:
            raw_cy = empty_cy_match.group(1).strip()
            cy_cleaned = " ".join([line.strip() for line in raw_cy.splitlines() if line.strip()])
            result["Empty Pick Up CY"] = cy_cleaned
        
        # Extract Full Return CY
        full_cy_match = re.search(r"Full\s*Return\s*CY\s*:\s*(.*?)(?=\s*(?:Full\s*Return\s*Date|Address|TEL|Yard\s*PIC|Doc\s*Cut-off|Port\s*Cargo|$))", text, re.IGNORECASE)
        if full_cy_match:
            result["Full return CY"] = full_cy_match.group(1).strip()
        
        # Extract Port Cargo Cut-off
        cutoff_match = re.search(r"Port\s*Cargo\s*Cut[- ]*off\s*:\s*(.*?)(?=\n|VGM\s*Cut-off|Customs\s*Cut-off|Rail\s*Receiving\s*Date|$)", text, re.IGNORECASE)
        if not cutoff_match:
            cutoff_match = re.search(r"(?:Cargo|CY)\s*Cut[- ]*off\s*:\s*(.*?)(?=\n|$)", text, re.IGNORECASE)
        if cutoff_match:
            raw_cutoff = cutoff_match.group(1).strip()
            result["Port Cargo Cut-off"] = parse_date_str(raw_cutoff)
        
        # Pre Carrier & Trunk Vessel and their ETDs
        pre_carrier = ""
        etd_pre = ""
        trunk_vessel = ""
        etd_trunk = ""
        
        pre_carrier_match = re.search(r"Pre\s*Carrier\s*:\s*(.*?)\s*(?:Latest\s*)?ETA/ETD\s*:\s*([^\s\n]*)", text, re.IGNORECASE)
        if pre_carrier_match:
            pre_val = pre_carrier_match.group(1).strip()
            eta_etd_val = pre_carrier_match.group(2).strip()
            if pre_val and pre_val != ":":
                pre_carrier = pre_val
                etd_pre = parse_etd(eta_etd_val)
                
        trunk_match = re.search(r"Trunk\s*Vessel\s*:\s*(.*?)\s*(?:Latest\s*)?ETA/ETD\s*:\s*([^\s\n]*)", text, re.IGNORECASE)
        if trunk_match:
            trunk_val = trunk_match.group(1).strip()
            eta_etd_val = trunk_match.group(2).strip()
            if trunk_val and trunk_val != ":":
                trunk_vessel = trunk_val
                etd_trunk = parse_etd(eta_etd_val)
                
        if pre_carrier:
            result["Pre Carrier"] = pre_carrier
            result["ETD_Pre"] = etd_pre
            result["Trunk Vessel"] = ""
            result["ETD_Trunk"] = ""
            result["Vessel"] = pre_carrier
            result["ETD"] = etd_pre
        else:
            result["Pre Carrier"] = ""
            result["ETD_Pre"] = ""
            result["Trunk Vessel"] = trunk_vessel
            result["ETD_Trunk"] = etd_trunk
            result["Vessel"] = trunk_vessel
            result["ETD"] = etd_trunk
            
        # Detect Carrier
        result["Carrier"] = detect_carrier(text, result["Booking No"], result["Vessel"], filename)
            
    except Exception as e:
        print(f"Error parsing booking text ({filename}): {e}")
        
    for k in result:
        if k != "Tên file PDF" and k != "STT":
            if result[k] is None or result[k] == "":
                result[k] = "null"
    
    return result

def extract_booking_data(pdf_path: str) -> dict:
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"File not found: {pdf_path}")
    
    filename = os.path.basename(pdf_path)
    try:
        with pdfplumber.open(pdf_path) as pdf:
            text = ""
            for page in pdf.pages:
                extracted_text = page.extract_text()
                if extracted_text:
                    text += extracted_text + "\n"
                    
            return extract_booking_from_text(text, filename)
    except Exception as e:
        print(f"Error parsing PDF {pdf_path}: {e}")
        return extract_booking_from_text("", filename)

