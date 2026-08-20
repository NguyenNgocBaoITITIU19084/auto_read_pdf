import requests
import urllib3
import re
from datetime import datetime

# Suppress insecure request warnings if they occur
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def parse_eport_date(date_str: str) -> str:
    """
    Convert a Saigon Newport date string like '/Date(1782769311000)/' into 'YYYY-MM-DD HH:MM:SS'.
    """
    if not date_str:
        return ""
    match = re.search(r"Date\((\d+)\)", date_str)
    if match:
        try:
            ms = int(match.group(1))
            dt = datetime.fromtimestamp(ms / 1000.0)
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass
    return date_str

def normalize_string(s: str) -> str:
    """Normalize string by removing all non-alphanumeric characters, lowercased."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def is_voyage_match(query_voy: str, eport_voy: str) -> bool:
    """
    So sánh chính xác 2 chuỗi số chuyến (1-1 exact match).
    Chỉ cập nhật khi số chuyến của ePort trùng khớp hoàn toàn với số chuyến yêu cầu.
    """
    if not query_voy or not eport_voy:
        return False
    return normalize_string(query_voy) == normalize_string(eport_voy)

def clean_vessel_name_for_eport(vessel_name: str, voyage: str = None) -> str:
    """
    Extract only the clean vessel name, removing any voyage codes, slashes, or trailing codes.
    ePort /ships/Searcher API strictly requires only the vessel name in the request body.
    """
    if not vessel_name:
        return ""
    v_name = vessel_name.strip()
    
    # 1. Remove prefixes like 'TÀU ', 'VESSEL: ', 'SHIP: '
    v_name = re.sub(r"^(?:tàu|vessel|ship)[:\s]+", "", v_name, flags=re.IGNORECASE).strip()
    
    # 2. If separated by slash/backslash/pipe (e.g. 'KOTA NEKAD / 0272S' -> 'KOTA NEKAD')
    if re.search(r"[/\\|]", v_name):
        parts = re.split(r"[/\\|]", v_name)
        v_name = parts[0].strip()
        
    # 3. If a specific voyage was provided, remove it from vessel name if present
    if voyage:
        voy_clean = voyage.strip()
        if voy_clean:
            pattern = re.escape(voy_clean)
            v_name = re.sub(rf"[-–—\s]*\b{pattern}\b[-–—\s]*", " ", v_name, flags=re.IGNORECASE).strip()
            
    # 4. If ends with ' - VOYAGE' or ' - 1752-014S'
    v_name = re.sub(r"[-–—]\s*[0-9]+[A-Za-z0-9\-\/]*\s*$", "", v_name).strip()
    
    # 5. Clean up multiple spaces
    v_name = re.sub(r"\s+", " ", v_name).strip()
    return v_name

def is_vessel_name_match(query_vessel: str, model_vessel: str) -> bool:
    """
    So sánh tên tàu: khớp chính xác hoặc tên tàu trả về chứa tên tàu tìm kiếm.
    e.g. 'EVER OMNI' khớp 'EVER OMNI', 'EVER' khớp 'EVER OMNI'.
    """
    if not query_vessel or not model_vessel:
        return False
    q_clean = clean_vessel_name_for_eport(query_vessel)
    m_clean = clean_vessel_name_for_eport(model_vessel)
    q_norm = normalize_string(q_clean)
    m_norm = normalize_string(m_clean)
    return q_norm == m_norm or q_norm in m_norm or m_norm in q_norm

def search_vessels(site_id: str, vessel_name: str, voyage: str = None) -> list[dict]:
    """
    Call the internal Saigon Newport ePort API to search for vessel schedule.
    Body sent to ePort:
    {
        "siteId": site_id,
        "vesselName": clean_vessel_name
    }
    """
    url = "https://eport.saigonnewport.com.vn/ships/Searcher"
    
    # Process inputs
    site_id_query = site_id.strip().upper() if (site_id and site_id.strip()) else "CTL"
    raw_vessel = vessel_name.strip() if vessel_name else ""
    voyage_query = voyage.strip() if voyage else ""
    
    clean_vessel_name = clean_vessel_name_for_eport(raw_vessel, voyage_query)
    if not clean_vessel_name:
        clean_vessel_name = raw_vessel
        
    payload = {
        "siteId": site_id_query,
        "vesselName": clean_vessel_name
    }
    
    headers = {
        "Content-Type": "application/json; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": "https://eport.saigonnewport.com.vn",
        "Referer": "https://eport.saigonnewport.com.vn/Ships"
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=15)
        response.raise_for_status()
        
        res_data = response.json()
        if res_data.get("type") == "success" and "model" in res_data:
            models = res_data["model"]
            if not isinstance(models, list):
                return []
                
            cleaned_models = []
            for item in models:
                if not isinstance(item, dict):
                    continue
                # Clean up trailing spaces from all string fields in the ePort response
                cleaned_item = {}
                for k, v in item.items():
                    if isinstance(v, str):
                        cleaned_item[k] = v.strip()
                    else:
                        cleaned_item[k] = v
                if not cleaned_item.get("SITE_ID"):
                    cleaned_item["SITE_ID"] = site_id_query
                cleaned_models.append(cleaned_item)
                
            # 1. Strictly filter by Vessel Name (Must match target vessel name completely)
            cleaned_models = [m for m in cleaned_models if is_vessel_name_match(clean_vessel_name, m.get("VESSELNAME", ""))]

            # 2. Strictly filter by Voyage (Must match target voyage completely)
            if voyage_query and cleaned_models:
                matched = [m for m in cleaned_models if is_voyage_match(voyage_query, m.get("IN_OUT_VOYAGE", ""))]
                return matched
                    
            return cleaned_models
        elif res_data.get("type") == "error":
            return []
        else:
            return []
            
    except requests.exceptions.RequestException as e:
        raise ConnectionError(f"Network connection failed: {e}")

def search_containers(site_id: str, container_nos: str) -> list[dict]:
    """
    Call the Saigon Newport ePort API to search for container information.
    
    Args:
        site_id (str): Port ID, e.g., 'CTL' (Cát Lái) or 'GNL' (Cát Lái Giang Nam)
        container_nos (str): Comma-separated list of container numbers
        
    Returns:
        list[dict]: List of container details
    """
    url = "https://eport.saigonnewport.com.vn/ContainerInformation/FindContInfo"
    payload = {
        "SITE_ID": site_id.strip().upper() if site_id else "CTL",
        "SearchContainerNos": container_nos.strip(),
        "IsSearchByInYard": True,
        "IsSearchByBatch": False
    }
    headers = {
        "Content-Type": "application/json; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": "https://eport.saigonnewport.com.vn/ContainerInformation"
    }
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=15)
        response.raise_for_status()
        res_data = response.json()
        if res_data.get("ContentType") == "success" and "Data" in res_data:
            data = res_data["Data"]
            if not isinstance(data, list):
                return []
            cleaned_data = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                cleaned_item = {}
                for k, v in item.items():
                    if isinstance(v, str):
                        val_str = v.strip()
                        # Auto parse date time fields if they match ePort date format
                        if val_str.startswith("/Date(") and val_str.endswith(")/"):
                            cleaned_item[k] = parse_eport_date(val_str)
                        else:
                            cleaned_item[k] = val_str
                    else:
                        cleaned_item[k] = v
                cleaned_data.append(cleaned_item)
            return cleaned_data
        else:
            error_content = res_data.get("Message", "Unknown API error")
            raise ValueError(error_content or "Failed to search container info")
    except requests.exceptions.RequestException as e:
        raise ConnectionError(f"Network connection failed: {e}")
