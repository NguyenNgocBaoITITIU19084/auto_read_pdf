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

def search_vessels(site_id: str, vessel_name: str, voyage: str = None) -> list[dict]:
    """
    Call the internal Saigon Newport ePort API to search for vessel schedule.
    
    Args:
        site_id (str): Port ID, e.g., 'CTL' (Cát Lái) or 'GNL' (Cát Lái Giang Nam)
        vessel_name (str): Vessel name
        voyage (str, optional): Voyage number
        
    Returns:
        list[dict]: List of vessel schedule details
    """
    url = "https://eport.saigonnewport.com.vn/ships/Searcher"
    
    # Process inputs
    site_id_query = site_id.strip() if site_id else ""
    vessel_query = vessel_name.strip() if vessel_name else ""
    voyage_query = voyage.strip() if voyage else ""
    
    # Construct combined vessel query as f"{vesselName}/{voyage}" if voyage exists
    if voyage_query:
        if "/" not in vessel_query:
            vessel_query = f"{vessel_query}/{voyage_query}"
            
    payload = {
        "siteId": site_id_query,
        "vesselName": vessel_query
    }
    
    headers = {
        "Content-Type": "application/json; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
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
                cleaned_models.append(cleaned_item)
                
            return cleaned_models
        else:
            error_content = res_data.get("content", "Unknown API error")
            raise ValueError(error_content or "Failed to search vessel schedule (unknown response type)")
            
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
        "SITE_ID": site_id.strip() if site_id else "CTL",
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
