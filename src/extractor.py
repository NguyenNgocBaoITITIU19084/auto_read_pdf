import os
import pdfplumber
import re

def extract_booking_data(pdf_path: str) -> dict:
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"File not found: {pdf_path}")
    
    result = {
        "STT": "",
        "Tên file PDF": os.path.basename(pdf_path),
        "Booking No": "",
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
        "ETD_Trunk": ""
    }
    
    def parse_etd(eta_etd_str: str) -> str:
        if not eta_etd_str:
            return ""
        parts = eta_etd_str.split("/")
        return parts[-1].strip() if parts else ""
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            text = ""
            for page in pdf.pages:
                extracted_text = page.extract_text()
                if extracted_text:
                    text += extracted_text + "\n"
            
            # Extract Booking No
            booking_match = re.search(r"Booking No\s*:\s*([A-Z0-9]+)", text, re.IGNORECASE)
            if booking_match:
                result["Booking No"] = booking_match.group(1).strip()
            
            # Extract Port of Discharging
            pod_match = re.search(r"Port of Discharg(?:e|ing)?\s*:\s*(.*?)(?=\s+(?:Place\s+of\s+Delivery|Final\s+Destination|Terminal)|$)", text, re.IGNORECASE)
            if pod_match:
                result["Port of Discharging"] = pod_match.group(1).strip()

            # Extract Place of Delivery / Final Destination
            deliv_match = re.search(r"(?:Place of Delivery|Final Destination)\s*:\s*(.*?)(?=\s+Terminal|$)", text, re.IGNORECASE)
            if deliv_match:
                result["Place of Delivery"] = deliv_match.group(1).strip()
            
            # Extract Block
            block_match = re.search(r"Block\s*:\s*([A-Za-z0-9]+)", text, re.IGNORECASE)
            if block_match:
                result["Block"] = block_match.group(1).strip()
            
            # Extract T/S Port
            ts_match = re.search(r"T/S Port\s*:\s*(.*?)(?=\s+(?:POD\s*/|Terminal)|$)", text, re.IGNORECASE)
            if ts_match:
                result["T/S Port"] = ts_match.group(1).strip()
            
            # Extract Empty Pick Up CY
            empty_cy_match = re.search(r"Empty Pick UP CY\s*:\s*(.*?)(?=\s+Empty\s+Pick\s+Up\s+Date|$)", text, re.IGNORECASE)
            if empty_cy_match:
                result["Empty Pick Up CY"] = empty_cy_match.group(1).strip()
            
            # Extract Full Return CY
            full_cy_match = re.search(r"Full Return CY\s*:\s*(.*?)(?=\s+Full\s+Return\s+Date|$)", text, re.IGNORECASE)
            if full_cy_match:
                result["Full return CY"] = full_cy_match.group(1).strip()
            
            # Extract Equipment Type/Q'ty
            eq_match = re.search(r"Equipment Type/Q['’]ty\s*:\s*(.*?)(?=\n|$)", text, re.IGNORECASE)
            if eq_match:
                eq_val = eq_match.group(1).strip()
                split_match = re.search(r'^(.*?)(?:\.-|-)\s*(\d+)$', eq_val)
                if split_match:
                    result["Equipment Type"] = split_match.group(1).strip()
                    result["Q'ty"] = split_match.group(2).strip()
                else:
                    result["Equipment Type"] = eq_val
                    result["Q'ty"] = ""
            
            # Extract Port Cargo Cut-off
            cutoff_match = re.search(r"Port Cargo Cut-off\s*:\s*(.*?)(?=\n|Rail\s*Receiving\s*Date|$)", text, re.IGNORECASE)
            if cutoff_match:
                result["Port Cargo Cut-off"] = cutoff_match.group(1).strip()
            
            # Pre Carrier & Trunk Vessel and their ETDs
            pre_carrier = ""
            etd_pre = ""
            trunk_vessel = ""
            etd_trunk = ""
            
            pre_carrier_match = re.search(r"Pre Carrier\s*:\s*(.*?)\s*Latest ETA/ETD\s*:\s*([^\s\n]*)", text, re.IGNORECASE)
            if pre_carrier_match:
                pre_val = pre_carrier_match.group(1).strip()
                eta_etd_val = pre_carrier_match.group(2).strip()
                if pre_val:
                    pre_carrier = pre_val
                    etd_pre = parse_etd(eta_etd_val)
                    
            trunk_match = re.search(r"Trunk Vessel\s*:\s*(.*?)\s*Latest ETA/ETD\s*:\s*([^\s\n]*)", text, re.IGNORECASE)
            if trunk_match:
                trunk_val = trunk_match.group(1).strip()
                eta_etd_val = trunk_match.group(2).strip()
                if trunk_val:
                    trunk_vessel = trunk_val
                    etd_trunk = parse_etd(eta_etd_val)
                    
            if pre_carrier:
                result["Pre Carrier"] = pre_carrier
                result["ETD_Pre"] = etd_pre
                result["Trunk Vessel"] = ""
                result["ETD_Trunk"] = ""
            else:
                result["Pre Carrier"] = ""
                result["ETD_Pre"] = ""
                result["Trunk Vessel"] = trunk_vessel
                result["ETD_Trunk"] = etd_trunk
                
    except Exception as e:
        print(f"Error parsing {pdf_path}: {e}")
        
    for k in result:
        if k != "Tên file PDF" and k != "STT":
            if result[k] is None or result[k] == "":
                result[k] = "null"
        
    return result
