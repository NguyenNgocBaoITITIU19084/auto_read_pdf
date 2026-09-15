import io

def export_to_excel_buffer(data: list[dict], selected_columns: list[str]) -> io.BytesIO:
    if not data or not selected_columns:
        raise ValueError("Data and selected columns cannot be empty")

    # Heavy imports are deferred so backend startup stays fast
    import pandas as pd
    from openpyxl import load_workbook
    from openpyxl.styles import PatternFill, Font, Alignment, Border, Side

    df = pd.DataFrame(data)
    df_filtered = df.reindex(columns=selected_columns).fillna("null")
    df_filtered = df_filtered.replace("", "null")
    
    excel_buffer = io.BytesIO()
    df_filtered.to_excel(excel_buffer, index=False)
    excel_buffer.seek(0)
    
    wb = load_workbook(excel_buffer)
    ws = wb.active
    
    fill_white = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
    fill_tint = PatternFill(start_color="F2F7FA", end_color="F2F7FA", fill_type="solid")
    header_fill = PatternFill(start_color="2C3E50", end_color="2C3E50", fill_type="solid")
    
    header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    cell_font = Font(name="Segoe UI", size=10)
    
    thin_border = Border(
        left=Side(style='thin', color='CCCCCC'),
        right=Side(style='thin', color='CCCCCC'),
        top=Side(style='thin', color='CCCCCC'),
        bottom=Side(style='thin', color='CCCCCC')
    )
    
    ws.row_dimensions[1].height = 28
    for col_idx in range(1, len(selected_columns) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border
        
    for row_idx in range(2, ws.max_row + 1):
        ws.row_dimensions[row_idx].height = 20
        for col_idx in range(1, len(selected_columns) + 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.font = cell_font
            cell.border = thin_border
            
            if col_idx % 2 == 0:
                cell.fill = fill_tint
            else:
                cell.fill = fill_white
            
            col_name = selected_columns[col_idx - 1]
            if col_name in ["STT", "No.", "Q'ty", "Booking No", "Số Booking", "Block", "Equipment Type", "Loại cont", "ETD", "Ngày tàu chạy"]:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")
                
    for col in ws.columns:
        max_len = 0
        for cell in col:
            val = str(cell.value or '')
            lines = val.split('\n')
            for line in lines:
                if len(line) > max_len:
                    max_len = len(line)
        col_letter = col[0].column_letter
        ws.column_dimensions[col_letter].width = max(max_len + 4, 12)
        
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output
