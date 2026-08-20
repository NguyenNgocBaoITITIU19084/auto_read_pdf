import json
import requests
import urllib3
import re
import logging
from datetime import datetime

logger = logging.getLogger(__name__)
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
    """
    url = "https://eport.saigonnewport.com.vn/ships/Searcher"
    
    site_id_query = site_id.strip().upper() if (site_id and site_id.strip()) else "CTL"
    raw_vessel = vessel_name.strip() if vessel_name else ""
    voyage_query = voyage.strip() if voyage else ""
    
    # ePort Searcher requires the base vessel name in 'vesselName' without the voyage appended
    # Strip any slashes/extra text if present (e.g. 'EVER WARM / 1752-014S' -> 'EVER WARM')
    clean_vessel_name = re.split(r"[/\\|]", raw_vessel)[0].strip() if raw_vessel else ""
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
    
    logger.info(
        f"\n➡️ [ePort API REQUEST]\n"
        f"   URL: {url}\n"
        f"   Payload: {json.dumps(payload, ensure_ascii=False)}\n"
        f"   Target Voyage: '{voyage_query or 'ALL'}'"
    )
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=15)
        response.raise_for_status()
        
        res_data = response.json()
        status_type = res_data.get("type", "unknown")
        content_msg = res_data.get("content", "")
        models = res_data.get("model", [])
        
        logger.info(
            f"⬅️ [ePort API RESPONSE] Status: {response.status_code} | Type: {status_type} | Message: '{content_msg}' | Total Models: {len(models) if isinstance(models, list) else 0}"
        )
        
        if status_type == "success" and isinstance(models, list):
            cleaned_models = []
            for item in models:
                if not isinstance(item, dict):
                    continue
                cleaned_item = {}
                for k, v in item.items():
                    if isinstance(v, str):
                        cleaned_item[k] = v.strip()
                    else:
                        cleaned_item[k] = v
                cleaned_models.append(cleaned_item)
                
            # If a specific voyage was queried, find matching voyage records
            if voyage_query and cleaned_models:
                clean_voy = voyage_query.lower().strip()
                voy_tokens = [tok for tok in re.split(r"[\s\-\/\_\,]+", clean_voy) if len(tok) >= 2]
                
                def is_voyage_match(m: dict) -> bool:
                    m_voy = str(m.get("IN_OUT_VOYAGE", "")).lower()
                    if not m_voy:
                        return False
                    if clean_voy in m_voy or m_voy in clean_voy:
                        return True
                    if voy_tokens and any(tok in m_voy for tok in voy_tokens):
                        return True
                    return False
                    
                matched = [m for m in cleaned_models if is_voyage_match(m)]
                logger.info(f"   🔍 Filtered by voyage '{voyage_query}': {len(matched)} / {len(cleaned_models)} matched")
                if matched:
                    return matched
                    
            return cleaned_models
        elif status_type == "error":
            logger.info(f"   ⚠️ ePort returned error/empty for '{clean_vessel_name}' at '{site_id_query}': {content_msg}")
            return []
        else:
            return []
            
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ [ePort API ERROR] Failed to connect: {e}")
        raise ConnectionError(f"Không thể kết nối tới máy chủ ePort: {e}")

def search_containers(site_id: str, container_nos: str) -> list[dict]:
    """
    Call the Saigon Newport ePort API to search for container information.
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
                        if val_str.startswith("/Date(") and val_str.endswith(")/"):
                            cleaned_item[k] = parse_eport_date(val_str)
                        else:
                            cleaned_item[k] = val_str
                    else:
                        cleaned_item[k] = v
                cleaned_data.append(cleaned_item)
            return cleaned_data
        elif res_data.get("ContentType") == "error":
            msg = res_data.get("Message", "")
            if "không tìm thấy" in msg.lower() or not res_data.get("Data"):
                return []
            raise ValueError(msg or "Không tìm thấy thông tin container")
        else:
            return []
    except requests.exceptions.RequestException as e:
        raise ConnectionError(f"Không thể kết nối tới máy chủ ePort: {e}")
