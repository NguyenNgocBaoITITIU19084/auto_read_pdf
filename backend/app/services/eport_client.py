import json
import requests
import urllib3
import re
import logging
import time
from datetime import datetime
from zoneinfo import ZoneInfo

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

logger = logging.getLogger("backend.eport_client")
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def parse_eport_date(date_str: str) -> str:
    """
    Convert a Saigon Newport date string like '/Date(1782769311000)/' into 'YYYY-MM-DD HH:MM:SS' (Asia/Ho_Chi_Minh local time).
    """
    if not date_str:
        return ""
    match = re.search(r"Date\((\d+)\)", date_str)
    if match:
        try:
            ms = int(match.group(1))
            dt = datetime.fromtimestamp(ms / 1000.0, tz=VN_TZ)
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
    Returns only schedules matching the vessel name (and voyage, if given).
    """
    return search_vessels_detailed(site_id, vessel_name, voyage)["items"]

def search_vessels_detailed(site_id: str, vessel_name: str, voyage: str = None) -> dict:
    """
    Same lookup as `search_vessels`, but also explains an empty result.

    Returns:
    {
        "items": [...],                 # identical to search_vessels() output
        "available_voyages": [...],     # voyages ePort has for this vessel name (when the voyage did not match)
        "reason": "ok" | "voyage_mismatch" | "vessel_not_found" | "eport_error" | "unexpected_response",
        "message": str,
    }
    Raises ConnectionError on network failure (same as search_vessels).
    """
    url = "https://eport.saigonnewport.com.vn/ships/Searcher"
    
    site_id_query = site_id.strip().upper() if (site_id and site_id.strip()) else "CTL"
    raw_vessel = vessel_name.strip() if vessel_name else ""
    voyage_query = voyage.strip() if voyage else ""
    
    # Clean vessel name to ensure NO voyage is sent to ePort
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
    
    logger.debug(
        f"[ePort REQUEST: VESSEL SEARCH] url={url} site='{site_id_query}' raw='{raw_vessel}' "
        f"cleaned='{clean_vessel_name}' voyage='{voyage_query or 'ALL'}' "
        f"payload={json.dumps(payload, ensure_ascii=False)}"
    )
    
    def _result(items, reason, message="", available=None):
        return {"items": items, "available_voyages": available or [], "reason": reason, "message": message}

    start_time = time.time()
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=15)
        elapsed_ms = int((time.time() - start_time) * 1000)
        response.raise_for_status()
        
        res_data = response.json()
        status_type = res_data.get("type", "unknown")
        content_msg = res_data.get("content", "")
        models = res_data.get("model", [])
        
        logger.info(
            f"[ePort VESSEL SEARCH] '{clean_vessel_name}' voyage='{voyage_query or 'ALL'}' site='{site_id_query}' "
            f"-> HTTP {response.status_code}, type='{status_type}', "
            f"{len(models) if isinstance(models, list) else 0} schedule(s) ({elapsed_ms}ms)"
        )
        if content_msg:
            logger.debug(f"[ePort VESSEL SEARCH] message: '{content_msg}'")
        
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
                # Ensure SITE_ID is stored with ePort site or fallback to query site
                if not cleaned_item.get("SITE_ID"):
                    cleaned_item["SITE_ID"] = site_id_query
                cleaned_models.append(cleaned_item)
                
            # 1. Strictly filter by Vessel Name (Must match target vessel name completely)
            cleaned_models = [m for m in cleaned_models if is_vessel_name_match(clean_vessel_name, m.get("VESSELNAME", ""))]
            
            if cleaned_models:
                for i, m in enumerate(cleaned_models):
                    logger.debug(f"   [{i+1}] Vessel: '{m.get('VESSELNAME')}' | Voyage: '{m.get('IN_OUT_VOYAGE')}' | Berth: '{m.get('ACTUAL_BERTH_TIME')}' | Dep: '{m.get('ACTUAL_DEPATURE_TIME')}' | Closing: '{m.get('CLOSING_TIME')}'")
            else:
                logger.warning(f"[ePort VESSEL SEARCH] Không tìm thấy lịch tàu nào khớp chính xác với tên tàu '{clean_vessel_name}'")
                return _result([], "vessel_not_found",
                               f"Không tìm thấy tàu '{clean_vessel_name}' tại cảng '{site_id_query}' trên ePort")

            # 2. Strictly filter by Voyage (Must match target voyage completely)
            if voyage_query:
                matched = [m for m in cleaned_models if is_voyage_match(voyage_query, m.get("IN_OUT_VOYAGE", ""))]
                logger.debug(f"[ePort VESSEL SEARCH] Strict voyage match '{voyage_query}': {len(matched)} / {len(cleaned_models)}")
                if matched:
                    return _result(matched, "ok")
                available = []
                for m in cleaned_models:
                    v = m.get("IN_OUT_VOYAGE")
                    if v and v not in available:
                        available.append(v)
                logger.warning(
                    f"[ePort VESSEL SEARCH] Chuyến tàu ePort KHÔNG trùng khớp với số chuyến yêu cầu '{voyage_query}'. "
                    f"Các chuyến hiện có trên ePort: {available}. -> Bỏ qua, KHÔNG cập nhật."
                )
                return _result([], "voyage_mismatch",
                               f"Không có chuyến '{voyage_query}' trên ePort. Các chuyến hiện có: {', '.join(available)}",
                               available)
                    
            return _result(cleaned_models, "ok")
        elif status_type == "error":
            logger.warning(
                f"[ePort VESSEL SEARCH] ePort returned error for vessel '{clean_vessel_name}' at site '{site_id_query}': '{content_msg}'"
            )
            return _result([], "eport_error", content_msg or "ePort trả về lỗi")
        else:
            logger.warning(
                f"[ePort VESSEL SEARCH] Unexpected ePort response for vessel '{clean_vessel_name}': Type='{status_type}', Content='{content_msg}'"
            )
            return _result([], "unexpected_response", content_msg or f"Phản hồi ePort không hợp lệ ({status_type})")
            
    except requests.exceptions.RequestException as e:
        elapsed_ms = int((time.time() - start_time) * 1000)
        logger.error(f"[ePort API ERROR] Failed to connect to ePort ({elapsed_ms}ms): {e}")
        raise ConnectionError(f"Không thể kết nối tới máy chủ ePort: {e}")

def search_containers(
    site_id: str,
    container_nos: str,
    is_search_by_in_yard: bool = False,
    is_search_by_batch: bool = False
) -> list[dict]:
    """
    Call the Saigon Newport ePort API to search for container information.
    """
    url = "https://eport.saigonnewport.com.vn/ContainerInformation/FindContInfo"
    site_query = site_id.strip().upper() if site_id else "CTL"
    cleaned_conts = container_nos.strip()
    
    payload = {
        "SITE_ID": site_query,
        "SearchContainerNos": cleaned_conts,
        "IsSearchByInYard": bool(is_search_by_in_yard),
        "IsSearchByBatch": bool(is_search_by_batch)
    }
    headers = {
        "Content-Type": "application/json; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": "https://eport.saigonnewport.com.vn",
        "Referer": "https://eport.saigonnewport.com.vn/ContainerInformation"
    }
    
    logger.debug(
        f"[ePort REQUEST: CONTAINER SEARCH] url={url} site='{site_query}' containers='{cleaned_conts}' "
        f"payload={json.dumps(payload, ensure_ascii=False)}"
    )
    
    start_time = time.time()
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=15)
        elapsed_ms = int((time.time() - start_time) * 1000)
        response.raise_for_status()
        
        res_data = response.json()
        content_type = res_data.get("ContentType", "unknown")
        msg = res_data.get("Message", "")
        data = res_data.get("Data", [])
        
        logger.info(
            f"[ePort CONTAINER SEARCH] '{cleaned_conts}' site='{site_query}' -> HTTP {response.status_code}, "
            f"type='{content_type}', {len(data) if isinstance(data, list) else 0} record(s) ({elapsed_ms}ms)"
        )
        if msg:
            logger.debug(f"[ePort CONTAINER SEARCH] message: '{msg}'")
        
        if content_type == "success" and "Data" in res_data:
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
                        if "/Date(" in val_str:
                            cleaned_item[k] = parse_eport_date(val_str)
                        else:
                            cleaned_item[k] = val_str
                    else:
                        cleaned_item[k] = v
                        
                # Clean HTML tags in NOTE if present (e.g. </br>, <br/>, <br>)
                if "NOTE" in cleaned_item and isinstance(cleaned_item["NOTE"], str):
                    cleaned_note = re.sub(r"<\s*/?\s*br\s*/?\s*>", "\n", cleaned_item["NOTE"], flags=re.IGNORECASE)
                    cleaned_item["NOTE"] = cleaned_note.strip()

                cleaned_data.append(cleaned_item)
                
            if cleaned_data:
                logger.debug(f"[ePort CONTAINER SEARCH] Found {len(cleaned_data)} container event(s) for '{cleaned_conts}'")
            return cleaned_data
        elif content_type == "error":
            logger.warning(f"   ⚠️ ePort container search error: '{msg}'")
            if "không tìm thấy" in msg.lower() or not res_data.get("Data"):
                return []
            raise ValueError(msg or "Không tìm thấy thông tin container")
        else:
            logger.warning(f"   ⚠️ Unexpected ePort container response: ContentType='{content_type}', Message='{msg}'")
            return []
    except requests.exceptions.RequestException as e:
        elapsed_ms = int((time.time() - start_time) * 1000)
        logger.error(f"❌ [ePort API ERROR: CONTAINERS] Failed to connect ({elapsed_ms}ms): {e}")
        raise ConnectionError(f"Không thể kết nối tới máy chủ ePort: {e}")
