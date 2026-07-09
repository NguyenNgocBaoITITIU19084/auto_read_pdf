import os
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import customtkinter as ctk

try:
    from src.extractor import extract_booking_data
    from src.exporter import export_to_excel
except ModuleNotFoundError:
    from extractor import extract_booking_data
    from exporter import export_to_excel

# Set appearance mode and color theme
ctk.set_appearance_mode("System")
ctk.set_default_color_theme("blue")

# Column translation dictionary
COLUMN_TRANSLATIONS = {
    "en": {
        "STT": "No.",
        "Tên file PDF": "PDF Filename",
        "Booking No": "Booking No",
        "Place of Delivery": "Place of Delivery",
        "Block": "Block",
        "T/S Port": "T/S Port",
        "Equipment Type": "Equipment Type",
        "Q'ty": "Q'ty",
        "Empty Pick Up CY": "Empty Pick Up CY",
        "Full return CY": "Full return CY",
        "Port Cargo Cut-off": "Port Cargo Cut-off",
        "Vessel": "Vessel",
        "ETD": "ETD"
    },
    "vi": {
        "STT": "STT",
        "Tên file PDF": "Tên file PDF",
        "Booking No": "Số Booking",
        "Place of Delivery": "Cảng đích",
        "Block": "Block",
        "T/S Port": "Cảng chuyển tải",
        "Equipment Type": "Loại cont",
        "Q'ty": "Số lượng",
        "Empty Pick Up CY": "Bãi cập rỗng",
        "Full return CY": "Nơi hạ bãi",
        "Port Cargo Cut-off": "Thời gian cắt máng",
        "Vessel": "Số chuyến",
        "ETD": "Ngày tàu chạy"
    }
}

class App(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("Auto Read PDF Booking")
        self.geometry("1100x650")

        self.pdf_files = []
        self.extracted_data = []
        self.display_data = [] # List of dicts for Treeview and Export
        self.language = "vi"   # Default language is Vietnamese
        self.font_size = 12    # Default font size for right data screen

        self.all_columns = [
            "STT",
            "Tên file PDF",
            "Booking No",
            "Place of Delivery",
            "Block",
            "T/S Port",
            "Equipment Type",
            "Q'ty",
            "Empty Pick Up CY",
            "Full return CY",
            "Port Cargo Cut-off",
            "Vessel",
            "ETD"
        ]

        # Config grid
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # --- Sidebar ---
        self.sidebar_frame = ctk.CTkFrame(self, width=280, corner_radius=0)
        self.sidebar_frame.grid(row=0, column=0, sticky="nsew")
        self.sidebar_frame.grid_rowconfigure(5, weight=1)

        self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="Auto Read PDF", font=ctk.CTkFont(size=20, weight="bold"))
        self.logo_label.grid(row=0, column=0, padx=20, pady=(20, 10))

        # Language Switcher
        self.lang_label = ctk.CTkLabel(self.sidebar_frame, text="Ngôn ngữ / Language:", font=ctk.CTkFont(size=12, weight="bold"))
        self.lang_label.grid(row=1, column=0, padx=20, pady=(5, 2))
        self.lang_switch = ctk.CTkSegmentedButton(
            self.sidebar_frame, 
            values=["Tiếng Việt", "English"],
            command=self.change_language
        )
        self.lang_switch.grid(row=2, column=0, padx=20, pady=(0, 10), sticky="ew")
        self.lang_switch.set("Tiếng Việt")

        # Font Size Adjuster
        self.font_size_label = ctk.CTkLabel(self.sidebar_frame, text="Cỡ chữ / Font Size:", font=ctk.CTkFont(size=12, weight="bold"))
        self.font_size_label.grid(row=3, column=0, padx=20, pady=(5, 2))
        
        self.font_control_frame = ctk.CTkFrame(self.sidebar_frame, fg_color="transparent")
        self.font_control_frame.grid(row=4, column=0, padx=20, pady=(0, 10), sticky="ew")
        self.font_control_frame.grid_columnconfigure((0, 2), weight=1)
        self.font_control_frame.grid_columnconfigure(1, weight=2)
        
        self.font_dec_btn = ctk.CTkButton(
            self.font_control_frame, 
            text="-", 
            width=36, 
            height=28, 
            font=ctk.CTkFont(size=16, weight="bold"),
            command=lambda: self.change_font_size(-1)
        )
        self.font_dec_btn.grid(row=0, column=0, padx=2)
        
        self.font_val_label = ctk.CTkLabel(
            self.font_control_frame, 
            text=str(self.font_size), 
            font=ctk.CTkFont(size=14, weight="bold")
        )
        self.font_val_label.grid(row=0, column=1, padx=5)
        
        self.font_inc_btn = ctk.CTkButton(
            self.font_control_frame, 
            text="+", 
            width=36, 
            height=28, 
            font=ctk.CTkFont(size=16, weight="bold"),
            command=lambda: self.change_font_size(1)
        )
        self.font_inc_btn.grid(row=0, column=2, padx=2)

        # Column list frame
        self.checkbox_frame = ctk.CTkScrollableFrame(self.sidebar_frame, label_text="Cột hiển thị / Columns")
        self.checkbox_frame.grid(row=5, column=0, padx=10, pady=10, sticky="nsew")
        self.checkbox_frame.grid_columnconfigure(0, weight=0)
        self.checkbox_frame.grid_columnconfigure(1, weight=1)
        self.checkbox_frame.grid_columnconfigure(2, weight=0)
        self.checkbox_frame.grid_columnconfigure(3, weight=0)
        
        self.column_vars = {}
        for col in self.all_columns:
            self.column_vars[col] = ctk.BooleanVar(value=True)

        self.select_pdf_btn = ctk.CTkButton(self.sidebar_frame, text="Chọn file PDF", command=self.select_pdfs)
        self.select_pdf_btn.grid(row=6, column=0, padx=20, pady=5, sticky="ew")

        self.export_btn = ctk.CTkButton(self.sidebar_frame, text="Xuất Excel", command=self.export_excel)
        self.export_btn.grid(row=7, column=0, padx=20, pady=(5, 20), sticky="ew")

        # --- Main Frame ---
        self.main_frame = ctk.CTkFrame(self)
        self.main_frame.grid(row=0, column=1, sticky="nsew", padx=10, pady=10)
        self.main_frame.grid_rowconfigure(0, weight=1)
        self.main_frame.grid_columnconfigure(0, weight=1)

        # Treeview
        self.style = ttk.Style()
        self.style.theme_use("default")
        self.update_treeview_style()
        
        self.tree_scroll_y = ttk.Scrollbar(self.main_frame)
        self.tree_scroll_y.pack(side="right", fill="y")
        
        self.tree_scroll_x = ttk.Scrollbar(self.main_frame, orient="horizontal")
        self.tree_scroll_x.pack(side="bottom", fill="x")

        self.tree = ttk.Treeview(
            self.main_frame, 
            yscrollcommand=self.tree_scroll_y.set, 
            xscrollcommand=self.tree_scroll_x.set,
            show="headings"
        )
        self.tree.pack(fill="both", expand=True)

        self.tree_scroll_y.config(command=self.tree.yview)
        self.tree_scroll_x.config(command=self.tree.xview)

        # Initial draws
        self.draw_column_checklist()
        self.update_treeview_columns()

    def change_font_size(self, delta):
        self.font_size = max(8, min(30, self.font_size + delta))
        self.font_val_label.configure(text=str(self.font_size))
        self.update_treeview_style()

    def update_treeview_style(self):
        row_height = int(self.font_size * 2) + 6
        self.style.configure("Treeview", font=("Segoe UI", self.font_size), rowheight=row_height)
        self.style.configure("Treeview.Heading", font=("Segoe UI", self.font_size, "bold"))

    def change_language(self, val):
        if val == "English":
            self.language = "en"
            self.select_pdf_btn.configure(text="Select PDFs")
            self.export_btn.configure(text="Export to Excel")
            self.checkbox_frame.configure(label_text="Columns")
        else:
            self.language = "vi"
            self.select_pdf_btn.configure(text="Chọn file PDF")
            self.export_btn.configure(text="Xuất Excel")
            self.checkbox_frame.configure(label_text="Cột hiển thị / Columns")
        
        self.draw_column_checklist()
        self.update_treeview_columns()

    def draw_column_checklist(self):
        # Clear checklist frame
        for widget in self.checkbox_frame.winfo_children():
            widget.destroy()

        for idx, col in enumerate(self.all_columns):
            # Header translated name
            display_name = COLUMN_TRANSLATIONS[self.language].get(col, col)
            
            # Checkbox
            var = self.column_vars.setdefault(col, ctk.BooleanVar(value=True))
            cb = ctk.CTkCheckBox(
                self.checkbox_frame, 
                text="", 
                variable=var, 
                command=self.update_treeview_columns,
                width=20,
                checkbox_width=20,
                checkbox_height=20
            )
            cb.grid(row=idx, column=0, padx=(5, 5), pady=3, sticky="w")
            
            # Editable Entry
            entry_var = tk.StringVar(value=display_name)
            entry = ctk.CTkEntry(
                self.checkbox_frame,
                textvariable=entry_var,
                width=140,
                height=24,
                font=ctk.CTkFont(size=11)
            )
            entry.grid(row=idx, column=1, padx=2, pady=3, sticky="ew")
            
            if self.language == "vi":
                entry.configure(state="normal")
                # Bind key release and focus out to update translation
                entry.bind("<KeyRelease>", lambda e, c=col, ev=entry_var: self.update_vietnamese_translation(c, ev.get()))
                entry.bind("<FocusOut>", lambda e, c=col, ev=entry_var: self.update_vietnamese_translation(c, ev.get()))
            else:
                entry.configure(state="disabled")
            
            # Up Button
            up_btn = ctk.CTkButton(
                self.checkbox_frame, 
                text="▲", 
                width=24, 
                height=20,
                fg_color="gray",
                hover_color="darkgray",
                command=lambda c=col: self.move_column_up(c)
            )
            up_btn.grid(row=idx, column=2, padx=2, pady=3)
            
            # Down Button
            down_btn = ctk.CTkButton(
                self.checkbox_frame, 
                text="▼", 
                width=24, 
                height=20,
                fg_color="gray",
                hover_color="darkgray",
                command=lambda c=col: self.move_column_down(c)
            )
            down_btn.grid(row=idx, column=3, padx=2, pady=3)

    def update_vietnamese_translation(self, col, new_val):
        if self.language == "vi":
            COLUMN_TRANSLATIONS["vi"][col] = new_val
            self.update_treeview_columns()

    def move_column_up(self, col):
        idx = self.all_columns.index(col)
        if idx > 0:
            self.all_columns[idx], self.all_columns[idx-1] = self.all_columns[idx-1], self.all_columns[idx]
            self.draw_column_checklist()
            self.update_treeview_columns()

    def move_column_down(self, col):
        idx = self.all_columns.index(col)
        if idx < len(self.all_columns) - 1:
            self.all_columns[idx], self.all_columns[idx+1] = self.all_columns[idx+1], self.all_columns[idx]
            self.draw_column_checklist()
            self.update_treeview_columns()

    def update_treeview_columns(self):
        selected_cols = [col for col in self.all_columns if self.column_vars[col].get()]
        
        self.tree["columns"] = selected_cols
        for col in selected_cols:
            display_name = COLUMN_TRANSLATIONS[self.language].get(col, col)
            self.tree.heading(col, text=display_name)
            self.tree.column(col, width=125, minwidth=100)
            
        self.populate_treeview()

    def select_pdfs(self):
        title = "Chọn các file PDF" if self.language == "vi" else "Select PDF files"
        file_paths = filedialog.askopenfilenames(
            title=title,
            filetypes=[("PDF files", "*.pdf")]
        )
        if file_paths:
            self.pdf_files = list(file_paths)
            self.process_pdfs()

    def process_pdfs(self):
        self.extracted_data = []
        self.display_data = []
        
        for idx, pdf_path in enumerate(self.pdf_files, 1):
            try:
                data = extract_booking_data(pdf_path)
                
                # Resolve Vessel and ETD per business rule
                vessel = data.get("Pre Carrier", "null")
                etd = data.get("ETD_Pre", "null")
                
                if vessel == "null" or not vessel:
                    vessel = data.get("Trunk Vessel", "null")
                    etd = data.get("ETD_Trunk", "null")
                    
                display_row = {
                    "STT": str(idx),
                    "Tên file PDF": data.get("Tên file PDF", "null"),
                    "Booking No": data.get("Booking No", "null"),
                    "Place of Delivery": data.get("Place of Delivery", "null"),
                    "Block": data.get("Block", "null"),
                    "T/S Port": data.get("T/S Port", "null"),
                    "Equipment Type": data.get("Equipment Type", "null"),
                    "Q'ty": data.get("Q'ty", "null"),
                    "Empty Pick Up CY": data.get("Empty Pick Up CY", "null"),
                    "Full return CY": data.get("Full return CY", "null"),
                    "Port Cargo Cut-off": data.get("Port Cargo Cut-off", "null"),
                    "Vessel": vessel,
                    "ETD": etd
                }
                
                self.extracted_data.append(data)
                self.display_data.append(display_row)
            except Exception as e:
                print(f"Failed to process {pdf_path}: {e}")
                
        self.populate_treeview()

    def populate_treeview(self):
        # Clear current items
        for item in self.tree.get_children():
            self.tree.delete(item)
            
        selected_cols = [col for col in self.all_columns if self.column_vars[col].get()]
        
        for row_data in self.display_data:
            values = [row_data.get(col, "null") for col in selected_cols]
            self.tree.insert("", "end", values=values)

    def export_excel(self):
        if not self.display_data:
            msg = "Không có dữ liệu để xuất. Vui lòng chọn file PDF trước." if self.language == "vi" else "No data to export. Please select PDFs first."
            title = "Cảnh báo" if self.language == "vi" else "Warning"
            messagebox.showwarning(title, msg)
            return
            
        title_save = "Lưu file Excel" if self.language == "vi" else "Save Excel File"
        save_path = filedialog.asksaveasfilename(
            defaultextension=".xlsx",
            filetypes=[("Excel files", "*.xlsx")],
            title=title_save
        )
        
        if save_path:
            selected_cols = [col for col in self.all_columns if self.column_vars[col].get()]
            try:
                # Build exported rows with correct order and headers based on active language
                exported_data = []
                for row_data in self.display_data:
                    exported_row = {}
                    for col in selected_cols:
                        display_name = COLUMN_TRANSLATIONS[self.language].get(col, col)
                        exported_row[display_name] = row_data.get(col, "null")
                    exported_data.append(exported_row)
                
                excel_cols = [COLUMN_TRANSLATIONS[self.language].get(col, col) for col in selected_cols]
                
                success = export_to_excel(exported_data, save_path, excel_cols)
                if success:
                    success_msg = f"Xuất dữ liệu thành công ra {save_path}" if self.language == "vi" else f"Data exported successfully to {save_path}"
                    success_title = "Thành công" if self.language == "vi" else "Success"
                    messagebox.showinfo(success_title, success_msg)
                else:
                    err_msg = "Không thể xuất dữ liệu." if self.language == "vi" else "Failed to export data."
                    err_title = "Lỗi" if self.language == "vi" else "Error"
                    messagebox.showerror(err_title, err_msg)
            except Exception as e:
                err_title = "Lỗi" if self.language == "vi" else "Error"
                messagebox.showerror(err_title, f"An error occurred: {e}")

if __name__ == "__main__":
    app = App()
    app.mainloop()
