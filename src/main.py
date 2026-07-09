import os
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import customtkinter as ctk
import sqlite3
import json

try:
    from src.extractor import extract_booking_data
    from src.exporter import export_to_excel
    from src.database import (
        init_db, create_collection, get_collections, delete_collection, 
        insert_booking, get_bookings, delete_booking, export_backup_data, import_backup_data
    )
except ModuleNotFoundError:
    from extractor import extract_booking_data
    from exporter import export_to_excel
    from database import (
        init_db, create_collection, get_collections, delete_collection, 
        insert_booking, get_bookings, delete_booking, export_backup_data, import_backup_data
    )

# Set appearance mode and color theme
ctk.set_appearance_mode("System")
ctk.set_default_color_theme("blue")

# Column translation dictionary
COLUMN_TRANSLATIONS = {
    "en": {
        "STT": "No.",
        "Tên file PDF": "PDF Filename",
        "Booking No": "Booking No",
        "Port of Discharging": "Port of Discharging",
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
        "Port of Discharging": "Cảng đích",
        "Place of Delivery": "Điểm giao",
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
        self.geometry("1180x680")

        # Initialize SQLite DB
        init_db()
        self.collections = []
        self.active_collection_id = None
        self.active_collection_name = ""

        self.pdf_files = []
        self.display_data = [] # List of dicts loaded from DB
        self.language = "vi"   # Default language is Vietnamese
        self.font_size = 12    # Default font size for Treeview

        self.all_columns = [
            "STT",
            "Tên file PDF",
            "Booking No",
            "Port of Discharging",
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
        self.sidebar_frame.grid_rowconfigure(7, weight=1)

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

        # Collection Manager
        self.collection_label = ctk.CTkLabel(self.sidebar_frame, text="Bộ sưu tập / Collection:", font=ctk.CTkFont(size=12, weight="bold"))
        self.collection_label.grid(row=5, column=0, padx=20, pady=(5, 2))

        self.col_control_frame = ctk.CTkFrame(self.sidebar_frame, fg_color="transparent")
        self.col_control_frame.grid(row=6, column=0, padx=20, pady=(0, 10), sticky="ew")
        self.col_control_frame.grid_columnconfigure(0, weight=1)

        self.collection_menu = ctk.CTkOptionMenu(
            self.col_control_frame,
            values=[],
            command=self.on_collection_changed
        )
        self.collection_menu.grid(row=0, column=0, padx=(0, 5), sticky="ew")

        self.add_col_btn = ctk.CTkButton(
            self.col_control_frame,
            text="+",
            width=32,
            height=28,
            font=ctk.CTkFont(size=16, weight="bold"),
            command=self.prompt_create_collection
        )
        self.add_col_btn.grid(row=0, column=1, padx=2)

        self.delete_col_btn = ctk.CTkButton(
            self.col_control_frame,
            text="Xóa",
            width=50,
            height=28,
            fg_color="#C0392B",
            hover_color="#E74C3C",
            command=self.confirm_delete_collection
        )
        self.delete_col_btn.grid(row=0, column=2, padx=2)

        # Column list frame
        self.checkbox_frame = ctk.CTkScrollableFrame(self.sidebar_frame, label_text="Cột hiển thị / Columns")
        self.checkbox_frame.grid(row=7, column=0, padx=10, pady=10, sticky="nsew")
        self.checkbox_frame.grid_columnconfigure(0, weight=0)
        self.checkbox_frame.grid_columnconfigure(1, weight=1)
        self.checkbox_frame.grid_columnconfigure(2, weight=0)
        self.checkbox_frame.grid_columnconfigure(3, weight=0)
        
        self.column_vars = {}
        for col in self.all_columns:
            self.column_vars[col] = ctk.BooleanVar(value=True)

        self.select_pdf_btn = ctk.CTkButton(self.sidebar_frame, text="Chọn file PDF", command=self.select_pdfs)
        self.select_pdf_btn.grid(row=8, column=0, padx=20, pady=5, sticky="ew")

        self.clear_btn = ctk.CTkButton(self.sidebar_frame, text="Xóa dữ liệu PDF", command=self.clear_data, fg_color="#C0392B", hover_color="#E74C3C")
        self.clear_btn.grid(row=9, column=0, padx=20, pady=5, sticky="ew")

        self.export_btn = ctk.CTkButton(self.sidebar_frame, text="Xuất Excel", command=self.export_excel)
        self.export_btn.grid(row=10, column=0, padx=20, pady=5, sticky="ew")

        # Backup & Restore buttons
        self.backup_control_frame = ctk.CTkFrame(self.sidebar_frame, fg_color="transparent")
        self.backup_control_frame.grid(row=11, column=0, padx=20, pady=(5, 20), sticky="ew")
        self.backup_control_frame.grid_columnconfigure((0, 1), weight=1)

        self.backup_btn = ctk.CTkButton(
            self.backup_control_frame, 
            text="Sao lưu", 
            height=28, 
            fg_color="gray", 
            hover_color="darkgray",
            command=self.backup_db
        )
        self.backup_btn.grid(row=0, column=0, padx=(0, 2), sticky="ew")

        self.restore_btn = ctk.CTkButton(
            self.backup_control_frame, 
            text="Khôi phục", 
            height=28, 
            fg_color="gray", 
            hover_color="darkgray",
            command=self.restore_db
        )
        self.restore_btn.grid(row=0, column=1, padx=(2, 0), sticky="ew")

        # --- Main Frame ---
        self.main_frame = ctk.CTkFrame(self)
        self.main_frame.grid(row=0, column=1, sticky="nsew", padx=10, pady=10)
        self.main_frame.grid_rowconfigure(1, weight=1)
        self.main_frame.grid_columnconfigure(0, weight=1)

        # Search Bar and Top Action Layout
        self.top_action_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        self.top_action_frame.grid(row=0, column=0, padx=10, pady=(10, 5), sticky="ew")
        
        self.search_entry = ctk.CTkEntry(self.top_action_frame, placeholder_text="Tìm kiếm dữ liệu...")
        self.search_entry.pack(side="left", fill="x", expand=True, padx=(0, 5))
        self.search_entry.bind("<Return>", lambda e: self.perform_search())

        self.search_field_menu = ctk.CTkOptionMenu(
            self.top_action_frame,
            values=[],
            width=140
        )
        self.search_field_menu.pack(side="left", padx=5)

        self.search_btn = ctk.CTkButton(self.top_action_frame, text="Tìm", width=80, command=self.perform_search)
        self.search_btn.pack(side="left", padx=5)

        self.refresh_btn = ctk.CTkButton(self.top_action_frame, text="Làm mới", width=90, command=self.refresh_data)
        self.refresh_btn.pack(side="left", padx=5)

        self.delete_row_btn = ctk.CTkButton(self.top_action_frame, text="Xóa dòng", width=110, fg_color="#C0392B", hover_color="#E74C3C", command=self.delete_selected_row)
        self.delete_row_btn.pack(side="right", padx=5)

        self.copy_btn = ctk.CTkButton(self.top_action_frame, text="Sao chép", width=90, command=self.copy_selected_row)
        self.copy_btn.pack(side="right", padx=5)

        # Treeview Scrollbars & Widget
        self.tree_container = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        self.tree_container.grid(row=1, column=0, padx=10, pady=(0, 10), sticky="nsew")
        
        self.tree_scroll_y = ttk.Scrollbar(self.tree_container)
        self.tree_scroll_y.pack(side="right", fill="y")
        
        self.tree_scroll_x = ttk.Scrollbar(self.tree_container, orient="horizontal")
        self.tree_scroll_x.pack(side="bottom", fill="x")

        self.style = ttk.Style()
        self.style.theme_use("clam")

        self.tree = ttk.Treeview(
            self.tree_container, 
            yscrollcommand=self.tree_scroll_y.set, 
            xscrollcommand=self.tree_scroll_x.set,
            show="headings"
        )
        self.tree.pack(fill="both", expand=True)

        self.tree_scroll_y.config(command=self.tree.yview)
        self.tree_scroll_x.config(command=self.tree.xview)

        # Double click to view details
        self.tree.bind("<Double-1>", self.show_row_details)

        self.update_treeview_style()
        self.update_search_fields_ui()

        # Load Collection & Draw checklist
        self.load_collections_to_ui()
        self.draw_column_checklist()
        self.update_treeview_columns()

    def change_font_size(self, delta):
        self.font_size = max(8, min(30, self.font_size + delta))
        self.font_val_label.configure(text=str(self.font_size))
        self.update_treeview_style()

    def update_treeview_style(self):
        row_height = int(self.font_size * 2) + 6
        mode = ctk.get_appearance_mode().lower()
        if mode == "dark":
            self.tree.tag_configure("oddrow", background="#2D3238", foreground="white")
            self.tree.tag_configure("evenrow", background="#1F2326", foreground="white")
            self.style.configure("Treeview", font=("Segoe UI", self.font_size), rowheight=row_height, background="#1F2326", fieldbackground="#1F2326", foreground="white", gridcolor="#3F444A")
            self.style.configure("Treeview.Heading", font=("Segoe UI", self.font_size, "bold"), background="#2D3238", foreground="white")
        else:
            self.tree.tag_configure("oddrow", background="#F2F7FA", foreground="black")
            self.tree.tag_configure("evenrow", background="#FFFFFF", foreground="black")
            self.style.configure("Treeview", font=("Segoe UI", self.font_size), rowheight=row_height, background="#FFFFFF", fieldbackground="#FFFFFF", foreground="black", gridcolor="#D3D3D3")
            self.style.configure("Treeview.Heading", font=("Segoe UI", self.font_size, "bold"), background="#EAEAEA", foreground="black")

    def change_language(self, val):
        if val == "English":
            self.language = "en"
            self.select_pdf_btn.configure(text="Select PDFs")
            self.clear_btn.configure(text="Clear PDF Data")
            self.export_btn.configure(text="Export to Excel")
            self.checkbox_frame.configure(label_text="Columns")
            self.collection_label.configure(text="Collection:")
            self.font_size_label.configure(text="Font Size:")
            self.delete_col_btn.configure(text="Delete")
            self.backup_btn.configure(text="Backup")
            self.restore_btn.configure(text="Restore")
            self.search_entry.configure(placeholder_text="Search data...")
            self.search_btn.configure(text="Search")
            self.delete_row_btn.configure(text="Delete Row")
            self.copy_btn.configure(text="Copy")
            self.refresh_btn.configure(text="Refresh")
        else:
            self.language = "vi"
            self.select_pdf_btn.configure(text="Chọn file PDF")
            self.clear_btn.configure(text="Xóa dữ liệu PDF")
            self.export_btn.configure(text="Xuất Excel")
            self.checkbox_frame.configure(label_text="Cột hiển thị / Columns")
            self.collection_label.configure(text="Bộ sưu tập:")
            self.font_size_label.configure(text="Cỡ chữ:")
            self.delete_col_btn.configure(text="Xóa")
            self.backup_btn.configure(text="Sao lưu")
            self.restore_btn.configure(text="Khôi phục")
            self.search_entry.configure(placeholder_text="Tìm kiếm dữ liệu...")
            self.search_btn.configure(text="Tìm")
            self.delete_row_btn.configure(text="Xóa dòng")
            self.copy_btn.configure(text="Sao chép")
            self.refresh_btn.configure(text="Làm mới")
        
        self.update_search_fields_ui()
        self.draw_column_checklist()
        self.update_treeview_columns()

    # --- Collection Management ---
    def load_collections_to_ui(self, select_newest=False):
        self.collections = get_collections()
        col_names = [col["name"] for col in self.collections]
        
        if not col_names:
            try:
                col_id = create_collection("Default")
                self.collections = get_collections()
                col_names = [col["name"] for col in self.collections]
            except Exception:
                pass
                
        self.collection_menu.configure(values=col_names)
        
        if select_newest and self.collections:
            newest = max(self.collections, key=lambda c: c["id"])
            self.set_active_collection(newest["id"], newest["name"])
        elif self.active_collection_name in col_names:
            self.collection_menu.set(self.active_collection_name)
        elif self.collections:
            self.set_active_collection(self.collections[0]["id"], self.collections[0]["name"])
        else:
            self.active_collection_id = None
            self.active_collection_name = ""
            self.collection_menu.set("")
            self.load_bookings_from_db()

    def set_active_collection(self, col_id, col_name):
        self.active_collection_id = col_id
        self.active_collection_name = col_name
        self.collection_menu.set(col_name)
        self.load_bookings_from_db()

    def on_collection_changed(self, col_name):
        for col in self.collections:
            if col["name"] == col_name:
                self.active_collection_id = col["id"]
                self.active_collection_name = col["name"]
                self.load_bookings_from_db()
                break

    def prompt_create_collection(self):
        title = "Tạo Collection Mới" if self.language == "vi" else "New Collection"
        prompt_text = "Nhập tên cho Collection mới:" if self.language == "vi" else "Enter name for the new collection:"
        dialog = ctk.CTkInputDialog(text=prompt_text, title=title)
        col_name = dialog.get_input()
        if col_name and col_name.strip():
            try:
                create_collection(col_name.strip())
                self.load_collections_to_ui(select_newest=True)
            except Exception:
                err_title = "Lỗi" if self.language == "vi" else "Error"
                err_msg = "Tên Collection đã tồn tại hoặc không hợp lệ." if self.language == "vi" else "Collection name already exists or is invalid."
                messagebox.showerror(err_title, err_msg)

    def confirm_delete_collection(self):
        if self.active_collection_id is None:
            return
            
        title = "Xác nhận xóa" if self.language == "vi" else "Confirm Delete"
        msg = f"Bạn có chắc muốn xóa Collection '{self.active_collection_name}' cùng tất cả dữ liệu bên trong không?" if self.language == "vi" else f"Are you sure you want to delete collection '{self.active_collection_name}' and all its data?"
        
        if messagebox.askyesno(title, msg):
            delete_collection(self.active_collection_id)
            self.active_collection_id = None
            self.active_collection_name = ""
            self.load_collections_to_ui()

    def update_search_fields_ui(self):
        if self.language == "vi":
            self.search_fields_mapping = {
                "Tất cả các cột": "all",
                "Tên file PDF": "pdf_name",
                "Số Booking": "booking_no",
                "Cảng đích": "port_of_discharging",
                "Điểm giao": "place_of_delivery",
                "Block": "block_val",
                "Cảng chuyển tải": "ts_port",
                "Loại cont": "equipment_type",
                "Số lượng": "qty",
                "Bãi cập rỗng": "empty_pickup_cy",
                "Nơi hạ bãi": "full_return_cy",
                "Thời gian cắt máng": "cutoff_time",
                "Số chuyến": "vessel",
                "Ngày tàu chạy": "etd"
            }
        else:
            self.search_fields_mapping = {
                "All Columns": "all",
                "PDF Filename": "pdf_name",
                "Booking No": "booking_no",
                "Port of Discharging": "port_of_discharging",
                "Place of Delivery": "place_of_delivery",
                "Block": "block_val",
                "T/S Port": "ts_port",
                "Equipment Type": "equipment_type",
                "Q'ty": "qty",
                "Empty Pick Up CY": "empty_pickup_cy",
                "Full return CY": "full_return_cy",
                "Port Cargo Cut-off": "cutoff_time",
                "Vessel": "vessel",
                "ETD": "etd"
            }
        
        values = list(self.search_fields_mapping.keys())
        self.search_field_menu.configure(values=values)
        default_val = "Tất cả các cột" if self.language == "vi" else "All Columns"
        self.search_field_menu.set(default_val)

    def load_bookings_from_db(self, query=None, field=None):
        if query is None:
            query = self.search_entry.get().strip()
        if field is None:
            selected_display = self.search_field_menu.get()
            field = self.search_fields_mapping.get(selected_display, "all")
            
        if not query:
            query = None
            field = "all"

        if self.active_collection_id is not None:
            self.display_data = get_bookings(self.active_collection_id, search_query=query, search_field=field)
        else:
            self.display_data = []
        self.populate_treeview()

    # --- Search and Row Actions ---
    def perform_search(self):
        query = self.search_entry.get().strip()
        selected_display = self.search_field_menu.get()
        field_name = self.search_fields_mapping.get(selected_display, "all")
        self.load_bookings_from_db(query if query else None, field_name)

    def refresh_data(self):
        self.search_entry.delete(0, "end")
        default_val = "Tất cả các cột" if self.language == "vi" else "All Columns"
        self.search_field_menu.set(default_val)
        self.load_bookings_from_db(query=None, field="all")

    def delete_selected_row(self):
        selected_items = self.tree.selection()
        if not selected_items:
            title = "Cảnh báo" if self.language == "vi" else "Warning"
            msg = "Vui lòng chọn dòng cần xóa." if self.language == "vi" else "Please select a row to delete."
            messagebox.showwarning(title, msg)
            return
            
        confirm_title = "Xác nhận xóa" if self.language == "vi" else "Confirm Delete"
        confirm_msg = "Bạn có chắc chắn muốn xóa dòng đang chọn khỏi cơ sở dữ liệu không?" if self.language == "vi" else "Are you sure you want to delete the selected row from database?"
        if not messagebox.askyesno(confirm_title, confirm_msg):
            return
            
        for item in selected_items:
            db_id = int(item)
            delete_booking(db_id)
            
        self.load_bookings_from_db()

    def copy_selected_row(self):
        selected_items = self.tree.selection()
        if not selected_items:
            title = "Cảnh báo" if self.language == "vi" else "Warning"
            msg = "Vui lòng chọn dòng cần sao chép." if self.language == "vi" else "Please select a row to copy."
            messagebox.showwarning(title, msg)
            return
            
        db_id = int(selected_items[0])
        row_data = None
        for row in self.display_data:
            if row["id"] == db_id:
                row_data = row
                break
                
        if not row_data:
            return
            
        selected_cols = [col for col in self.all_columns if self.column_vars[col].get()]
        items_list = []
        for idx, col in enumerate(selected_cols, 1):
            display_name = COLUMN_TRANSLATIONS[self.language].get(col, col)
            if col == "STT":
                # Find current row index in display data
                try:
                    display_idx = self.display_data.index(row_data) + 1
                    val = str(display_idx)
                except ValueError:
                    val = "1"
            else:
                val = row_data.get(col, "null")
            items_list.append(f"{display_name}: {val}")
            
        formatted_str = ", ".join(items_list)
        
        self.clipboard_clear()
        self.clipboard_append(formatted_str)
        self.update()
        
        title = "Thành công" if self.language == "vi" else "Success"
        msg = "Đã sao chép dòng dữ liệu vào Clipboard!" if self.language == "vi" else "Row data copied to clipboard!"
        messagebox.showinfo(title, msg)

    def show_row_details(self, event):
        selected_item = self.tree.selection()
        if not selected_item:
            return
            
        db_id = int(selected_item[0])
        row_data = None
        for row in self.display_data:
            if row["id"] == db_id:
                row_data = row
                break
                
        if not row_data:
            return
            
        popup_title = "Chi tiết Booking" if self.language == "vi" else "Booking Details"
        popup_header = "CHI TIẾT DỮ LIỆU BOOKING" if self.language == "vi" else "BOOKING DETAILS"
        copy_text = "Sao chép nhanh" if self.language == "vi" else "Copy Details"
        close_text = "Đóng" if self.language == "vi" else "Close"

        popup = ctk.CTkToplevel(self)
        popup.title(popup_title)
        popup.geometry("600x550")
        popup.attributes("-topmost", True)
        
        scroll_frame = ctk.CTkScrollableFrame(popup)
        scroll_frame.pack(fill="both", expand=True, padx=15, pady=15)
        
        title_label = ctk.CTkLabel(scroll_frame, text=popup_header, font=ctk.CTkFont(size=16, weight="bold"))
        title_label.pack(pady=(10, 15))
        
        for col in self.all_columns:
            if col == "STT":
                continue
            display_name = COLUMN_TRANSLATIONS[self.language].get(col, col)
            val = row_data.get(col, "null")
            
            row_frame = ctk.CTkFrame(scroll_frame, fg_color="transparent")
            row_frame.pack(fill="x", pady=6)
            
            lbl = ctk.CTkLabel(row_frame, text=f"{display_name}:", font=ctk.CTkFont(size=12, weight="bold"), width=180, anchor="w")
            lbl.pack(side="left")
            
            val_box = ctk.CTkEntry(row_frame, height=28, font=ctk.CTkFont(size=12), width=320)
            val_box.insert(0, str(val))
            val_box.configure(state="readonly")
            val_box.pack(side="left", fill="x", expand=True, padx=(10, 0))
        # Actions frame in popup
        btn_frame = ctk.CTkFrame(popup, fg_color="transparent")
        btn_frame.pack(fill="x", pady=10)
        
        def copy_popup_details():
            selected_cols = [col for col in self.all_columns if self.column_vars[col].get()]
            items_list = []
            for col in selected_cols:
                display_name = COLUMN_TRANSLATIONS[self.language].get(col, col)
                if col == "STT":
                    try:
                        display_idx = self.display_data.index(row_data) + 1
                        val = str(display_idx)
                    except ValueError:
                        val = "1"
                else:
                    val = row_data.get(col, "null")
                items_list.append(f"{display_name}: {val}")
            
            formatted_str = ", ".join(items_list)
            self.clipboard_clear()
            self.clipboard_append(formatted_str)
            self.update()
            
            title = "Thành công" if self.language == "vi" else "Success"
            msg = "Đã sao chép dòng dữ liệu vào Clipboard!" if self.language == "vi" else "Row data copied to clipboard!"
            messagebox.showinfo(title, msg, parent=popup)

        popup_copy_btn = ctk.CTkButton(btn_frame, text=copy_text, command=copy_popup_details)
        popup_copy_btn.pack(side="left", expand=True, padx=15)
        
        close_btn = ctk.CTkButton(btn_frame, text=close_text, command=popup.destroy)
        close_btn.pack(side="left", expand=True, padx=15)

    # --- Backup & Restore ---
    def backup_db(self):
        title_save = "Lưu file sao lưu" if self.language == "vi" else "Save Backup File"
        save_path = filedialog.asksaveasfilename(
            defaultextension=".json",
            filetypes=[("JSON files", "*.json")],
            title=title_save
        )
        if save_path:
            try:
                data = export_backup_data()
                with open(save_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                
                title = "Thành công" if self.language == "vi" else "Success"
                msg = f"Đã sao lưu dữ liệu ra file {save_path}" if self.language == "vi" else f"Data backed up successfully to {save_path}"
                messagebox.showinfo(title, msg)
            except Exception as e:
                err_title = "Lỗi" if self.language == "vi" else "Error"
                messagebox.showerror(err_title, f"An error occurred: {e}")

    def restore_db(self):
        title_open = "Chọn file sao lưu để khôi phục" if self.language == "vi" else "Select Backup File to Restore"
        open_path = filedialog.askopenfilename(
            filetypes=[("JSON files", "*.json")],
            title=title_open
        )
        if open_path:
            try:
                with open(open_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    
                import_backup_data(data)
                self.load_collections_to_ui()
                
                title = "Thành công" if self.language == "vi" else "Success"
                msg = "Đã khôi phục dữ liệu thành công!" if self.language == "vi" else "Data restored successfully!"
                messagebox.showinfo(title, msg)
            except Exception as e:
                err_title = "Lỗi" if self.language == "vi" else "Error"
                messagebox.showerror(err_title, f"An error occurred: {e}")

    # --- Treeview and Operations ---
    def draw_column_checklist(self):
        for widget in self.checkbox_frame.winfo_children():
            widget.destroy()

        for idx, col in enumerate(self.all_columns):
            display_name = COLUMN_TRANSLATIONS[self.language].get(col, col)
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
                entry.bind("<KeyRelease>", lambda e, c=col, ev=entry_var: self.update_vietnamese_translation(c, ev.get()))
                entry.bind("<FocusOut>", lambda e, c=col, ev=entry_var: self.update_vietnamese_translation(c, ev.get()))
            else:
                entry.configure(state="disabled")
            
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
            new_paths = [p for p in file_paths if p not in self.pdf_files]
            if new_paths:
                self.pdf_files.extend(new_paths)
                self.process_pdfs(new_paths)

    def process_pdfs(self, new_paths):
        if self.active_collection_id is None:
            self.load_collections_to_ui()
            if self.active_collection_id is None:
                return
                
        for pdf_path in new_paths:
            try:
                data = extract_booking_data(pdf_path)
                
                # Resolve Vessel and ETD per business rule
                vessel = data.get("Pre Carrier", "null")
                etd = data.get("ETD_Pre", "null")
                
                if vessel == "null" or not vessel:
                    vessel = data.get("Trunk Vessel", "null")
                    etd = data.get("ETD_Trunk", "null")
                    
                display_row = {
                    "Tên file PDF": data.get("Tên file PDF", "null"),
                    "Booking No": data.get("Booking No", "null"),
                    "Port of Discharging": data.get("Port of Discharging", "null"),
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
                
                insert_booking(self.active_collection_id, display_row)
            except Exception as e:
                print(f"Failed to process {pdf_path}: {e}")
                
        self.load_bookings_from_db()

    def clear_data(self):
        if self.active_collection_id is None:
            return
            
        title = "Xác nhận xóa sạch" if self.language == "vi" else "Confirm Clear"
        msg = "Bạn có chắc chắn muốn xóa toàn bộ dữ liệu PDF trong Collection này không?" if self.language == "vi" else "Are you sure you want to delete all PDF data in this collection?"
        
        if messagebox.askyesno(title, msg):
            try:
                with sqlite3.connect("booking_data.db") as conn:
                    conn.execute("DELETE FROM bookings WHERE collection_id = ?;", (self.active_collection_id,))
                    conn.commit()
            except Exception as e:
                print(f"Error clearing collection bookings: {e}")
            self.pdf_files = []
            self.load_bookings_from_db()

    def populate_treeview(self):
        # Clear current items
        for item in self.tree.get_children():
            self.tree.delete(item)
            
        selected_cols = [col for col in self.all_columns if self.column_vars[col].get()]
        
        for idx, row_data in enumerate(self.display_data):
            values = []
            for col_idx, col in enumerate(selected_cols):
                val = row_data.get(col, "null")
                if col_idx == 0:
                    if col == "STT":
                        values.append(str(idx + 1))
                    else:
                        values.append(str(val))
                else:
                    if col == "STT":
                        values.append(f"│  {idx + 1}")
                    else:
                        values.append(f"│  {val}")
            
            tag = "evenrow" if idx % 2 == 0 else "oddrow"
            self.tree.insert("", "end", iid=str(row_data["id"]), values=values, tags=(tag,))

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
                exported_data = []
                for row_idx, row_data in enumerate(self.display_data, 1):
                    exported_row = {}
                    for col in selected_cols:
                        display_name = COLUMN_TRANSLATIONS[self.language].get(col, col)
                        if col == "STT":
                            exported_row[display_name] = str(row_idx)
                        else:
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
