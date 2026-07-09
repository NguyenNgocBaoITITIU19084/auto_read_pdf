import pandas as pd

def export_to_excel(data: list[dict], output_path: str, selected_columns: list[str]) -> bool:
    if not data or not selected_columns:
        return False
        
    df = pd.DataFrame(data)
    
    df_filtered = df.reindex(columns=selected_columns).fillna("null")
    df_filtered = df_filtered.replace("", "null")
    df_filtered.to_excel(output_path, index=False)
    return True
