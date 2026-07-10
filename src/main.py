import os
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import customtkinter as ctk
import sqlite3
import json
from datetime import datetime

try:
    from src.extractor import extract_booking_data
    from src.exporter import export_to_excel
    from src.database import (
        init_db, create_collection, get_collections, delete_collection, 
        insert_booking, get_bookings, delete_booking, export_backup_data, import_backup_data,
        insert_vessel_schedules, get_vessel_schedules, delete_vessel_schedule, clear_vessel_schedules,
        get_watchlist, add_to_watchlist, remove_from_watchlist
    )
    from src.eport_client import search_vessels
except ModuleNotFoundError:
    from extractor import extract_booking_data
    from exporter import export_to_excel
    from database import (
        init_db, create_collection, get_collections, delete_collection, 
        insert_booking, get_bookings, delete_booking, export_backup_data, import_backup_data,
        insert_vessel_schedules, get_vessel_schedules, delete_vessel_schedule, clear_vessel_schedules,
        get_watchlist, add_to_watchlist, remove_from_watchlist
    )
    from eport_client import search_vessels

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

VESSEL_COLUMN_TRANSLATIONS = {
    "en": {
        "STT": "No.",
        "site_id": "Site ID",
        "agent": "Agent",
        "vessel_name": "Vessel Name",
        "in_out_voyage": "Voyage",
        "actual_berth_time": "ETA/ETB",
        "actual_departure_time": "ETD",
        "closing_time": "Cut-off Time",
        "closing_time_icd": "Cut-off ICD",
        "in_gate": "Gate",
        "open_ts": "Open Time",
        "reefer_open_ts": "Reefer Open",
        "oog_open_ts": "OOG Open",
        "haz_open_ts": "Haz Open",
        "remarks": "Remarks",
        "queried_at": "Queried At"
    },
    "vi": {
        "STT": "STT",
        "site_id": "Mã cảng",
        "agent": "Đại lý",
        "vessel_name": "Tên tàu",
        "in_out_voyage": "Số chuyến",
        "actual_berth_time": "Cập bến dự kiến",
        "actual_departure_time": "Rời bến dự kiến",
        "closing_time": "Thời gian đóng",
        "closing_time_icd": "Đóng tại ICD",
        "in_gate": "Cổng hạ",
        "open_ts": "Mở cổng hạ",
        "reefer_open_ts": "Mở cổng cont lạnh",
        "oog_open_ts": "Mở cổng cont OOG",
        "haz_open_ts": "Mở cổng cont nguy hiểm",
        "remarks": "Ghi chú",
        "queried_at": "Tra cứu lúc"
    }
}

class VesselWatchlistDialog(ctk.CTkToplevel):
    def __init__(self, parent):
        super().__init__(parent)
        self.parent = parent
        self.title("Danh sách tàu cần theo dõi (Vessel Watchlist)" if parent.language == "vi" else "Vessel Watchlist")
        self.geometry("700x500")
        self.attributes("-topmost", True)
        self.focus()
        
        # Grid layout: 
        # Row 0: Form to add new watchlist item
        # Row 1: Table (Treeview) of current watchlist items
        # Row 2: Bottom actions (Delete selected, Close)
        self.grid_rowconfigure(1, weight=1)
        self.grid_columnconfigure(0, weight=1)
        
        # --- Add Form ---
        self.form_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.form_frame.grid(row=0, column=0, padx=15, pady=(15, 5), sticky="ew")
        
        self.port_label = ctk.CTkLabel(self.form_frame, text="Cảng:" if parent.language == "vi" else "Port:", font=ctk.CTkFont(size=12, weight="bold"))
        self.port_label.pack(side="left", padx=5)
        
        self.port_menu = ctk.CTkOptionMenu(
            self.form_frame,
            values=["Cát Lái (CTL)", "Cát Lái Giang Nam (GNL)"],
            width=150
        )
        self.port_menu.pack(side="left", padx=5)
        self.port_menu.set("Cát Lái (CTL)")
        
        self.vessel_entry = ctk.CTkEntry(self.form_frame, placeholder_text="Tên tàu / Vessel...", width=150)
        self.vessel_entry.pack(side="left", padx=5)
        
        self.voyage_entry = ctk.CTkEntry(self.form_frame, placeholder_text="Chuyến / Voyage...", width=100)
        self.voyage_entry.pack(side="left", padx=5)
        
        self.add_btn = ctk.CTkButton(
            self.form_frame,
            text="Thêm" if parent.language == "vi" else "Add",
            width=80,
            command=self.add_item
        )
        self.add_btn.pack(side="left", padx=5)
        
        # --- Watchlist Table ---
        self.table_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.table_frame.grid(row=1, column=0, padx=15, pady=5, sticky="nsew")
        
        self.scroll_y = ttk.Scrollbar(self.table_frame)
        self.scroll_y.pack(side="right", fill="y")
        
        self.scroll_x = ttk.Scrollbar(self.table_frame, orient="horizontal")
        self.scroll_x.pack(side="bottom", fill="x")
        
        self.tree = ttk.Treeview(
            self.table_frame,
            yscrollcommand=self.scroll_y.set,
            xscrollcommand=self.scroll_x.set,
            show="headings",
            columns=("ID", "Port", "Vessel", "Voyage")
        )
        self.tree.pack(fill="both", expand=True)
        
        self.scroll_y.config(command=self.tree.yview)
        self.scroll_x.config(command=self.tree.xview)
        
        # Setup table headers
        self.tree.heading("ID", text="ID")
        self.tree.heading("Port", text="Cảng / Port")
        self.tree.heading("Vessel", text="Tên tàu / Vessel")
        self.tree.heading("Voyage", text="Chuyến / Voyage")
        
        self.tree.column("ID", width=50, minwidth=50, stretch=False, anchor="center")
        self.tree.column("Port", width=150, minwidth=100, anchor="w")
        self.tree.column("Vessel", width=250, minwidth=150, anchor="w")
        self.tree.column("Voyage", width=150, minwidth=100, anchor="center")
        
        # --- Bottom actions ---
        self.actions_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.actions_frame.grid(row=2, column=0, padx=15, pady=(5, 15), sticky="ew")
        
        self.delete_btn = ctk.CTkButton(
            self.actions_frame,
            text="Xóa mục chọn" if parent.language == "vi" else "Delete Selected",
            fg_color="#C0392B",
            hover_color="#E74C3C",
            command=self.delete_item,
            width=130
        )
        self.delete_btn.pack(side="left", padx=5)
        
        self.close_btn = ctk.CTkButton(
            self.actions_frame,
            text="Đóng" if parent.language == "vi" else "Close",
            command=self.destroy,
            width=100
        )
        self.close_btn.pack(side="right", padx=5)
        
        self.load_watchlist_data()
        
    def load_watchlist_data(self):
        # Clear tree
        for item in self.tree.get_children():
            self.tree.delete(item)
            
        if self.parent.active_collection_id is None:
            return
            
        watchlist = get_watchlist(self.parent.active_collection_id)
        for item in watchlist:
            port_display = "Cát Lái (CTL)" if item["site_id"] == "CTL" else "Cát Lái Giang Nam (GNL)"
            self.tree.insert("", "end", values=(
                item["id"],
                port_display,
                item["vessel_name"],
                item["voyage"]
            ))
            
    def add_item(self):
        if self.parent.active_collection_id is None:
            title = "Cảnh báo" if self.parent.language == "vi" else "Warning"
            msg = "Vui lòng chọn hoặc tạo một Bộ sưu tập trước khi thêm danh sách theo dõi." if self.parent.language == "vi" else "Please select or create a Collection first."
            messagebox.showwarning(title, msg, parent=self)
            return
            
        port_val = self.port_menu.get()
        site_id = "CTL"
        if "GNL" in port_val:
            site_id = "GNL"
            
        vessel = self.vessel_entry.get().strip()
        voyage = self.voyage_entry.get().strip()
        
        if not vessel or not voyage:
            title = "Thiếu thông tin" if self.parent.language == "vi" else "Missing info"
            msg = "Vui lòng điền đầy đủ Tên tàu và Số chuyến!" if self.parent.language == "vi" else "Please fill both Vessel Name and Voyage!"
            messagebox.showwarning(title, msg, parent=self)
            return
            
        add_to_watchlist(self.parent.active_collection_id, site_id, vessel, voyage)
        
        self.vessel_entry.delete(0, "end")
        self.voyage_entry.delete(0, "end")
        
        self.load_watchlist_data()

        # Trigger immediate check if auto is running
        if self.parent.auto_request_running:
            if self.parent.vessel_auto_timer_id is not None:
                self.parent.after_cancel(self.parent.vessel_auto_timer_id)
                self.parent.vessel_auto_timer_id = None
            self.parent.trigger_auto_request()
        
    def delete_item(self):
        selected = self.tree.selection()
        if not selected:
            title = "Cảnh báo" if self.parent.language == "vi" else "Warning"
            msg = "Vui lòng chọn một dòng để xóa!" if self.parent.language == "vi" else "Please select a row to delete!"
            messagebox.showwarning(title, msg, parent=self)
            return
            
        for item in selected:
            val = self.tree.item(item, "values")
            watchlist_id = int(val[0])
            remove_from_watchlist(watchlist_id)
            
        self.load_watchlist_data()

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

        self.vessel_display_data = []
        self.vessel_columns = [
            "STT",
            "site_id",
            "agent",
            "vessel_name",
            "in_out_voyage",
            "actual_berth_time",
            "actual_departure_time",
            "closing_time",
            "closing_time_icd",
            "in_gate",
            "open_ts",
            "reefer_open_ts",
            "oog_open_ts",
            "haz_open_ts",
            "remarks",
            "queried_at"
        ]

        self.vessel_auto_timer_id = None
        self.auto_request_running = False

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

        self.vessel_column_vars = {}
        for col in self.vessel_columns:
            self.vessel_column_vars[col] = ctk.BooleanVar(value=True)

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
        self.main_frame.grid_rowconfigure(0, weight=1)
        self.main_frame.grid_columnconfigure(0, weight=1)

        # Tabview for layout separation
        self.tab_view = ctk.CTkTabview(self.main_frame, command=self.on_tab_changed)
        self.tab_view.pack(fill="both", expand=True, padx=5, pady=5)

        self.tab_booking = self.tab_view.add("Booking (Danh sách Booking)")
        self.tab_vessel = self.tab_view.add("ePort SNP (Lịch tàu)")

        # Grid configuration for Booking Tab
        self.tab_booking.grid_rowconfigure(1, weight=1)
        self.tab_booking.grid_columnconfigure(0, weight=1)

        # Search Bar and Top Action Layout inside Booking Tab
        self.top_action_frame = ctk.CTkFrame(self.tab_booking, fg_color="transparent")
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

        # Treeview Scrollbars & Widget inside Booking Tab
        self.tree_container = ctk.CTkFrame(self.tab_booking, fg_color="transparent")
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

        # --- ePort SNP Tab ---
        self.tab_vessel.grid_rowconfigure(3, weight=1)
        self.tab_vessel.grid_columnconfigure(0, weight=1)

        # Control Panel for Vessel API Lookup inside Vessel Tab (Row 0)
        self.vessel_action_frame = ctk.CTkFrame(self.tab_vessel, fg_color="transparent")
        self.vessel_action_frame.grid(row=0, column=0, padx=10, pady=(10, 5), sticky="ew")

        # Port Menu Label
        self.vessel_port_label = ctk.CTkLabel(self.vessel_action_frame, text="Cảng / Port:", font=ctk.CTkFont(size=12, weight="bold"))
        self.vessel_port_label.pack(side="left", padx=5)

        self.vessel_port_menu = ctk.CTkOptionMenu(
            self.vessel_action_frame,
            values=["Cát Lái (CTL)", "Cát Lái Giang Nam (GNL)"],
            width=180
        )
        self.vessel_port_menu.pack(side="left", padx=5)
        self.vessel_port_menu.set("Cát Lái (CTL)")

        # Vessel Name Entry
        self.vessel_name_entry = ctk.CTkEntry(self.vessel_action_frame, placeholder_text="Tên tàu / Vessel...", width=160)
        self.vessel_name_entry.pack(side="left", padx=5)
        self.vessel_name_entry.bind("<Return>", lambda e: self.search_eport_vessel())

        # Voyage Entry
        self.vessel_voyage_entry = ctk.CTkEntry(self.vessel_action_frame, placeholder_text="Chuyến / Voyage...", width=130)
        self.vessel_voyage_entry.pack(side="left", padx=5)
        self.vessel_voyage_entry.bind("<Return>", lambda e: self.search_eport_vessel())

        # Action Buttons
        self.vessel_search_btn = ctk.CTkButton(self.vessel_action_frame, text="Tra cứu", width=80, command=self.search_eport_vessel)
        self.vessel_search_btn.pack(side="left", padx=5)

        # Auto Lookup Panel (Row 1)
        self.vessel_auto_frame = ctk.CTkFrame(self.tab_vessel, fg_color="transparent")
        self.vessel_auto_frame.grid(row=1, column=0, padx=10, pady=(5, 5), sticky="ew")

        # Auto Request Title/Label
        self.vessel_auto_lbl = ctk.CTkLabel(
            self.vessel_auto_frame, 
            text="Tự động tra cứu / Auto Request:" if self.language == "vi" else "Auto Request:", 
            font=ctk.CTkFont(size=12, weight="bold")
        )
        self.vessel_auto_lbl.pack(side="left", padx=5)

        # Interval label & entry
        self.vessel_interval_lbl = ctk.CTkLabel(self.vessel_auto_frame, text="Chu kỳ (phút):" if self.language == "vi" else "Interval (mins):")
        self.vessel_interval_lbl.pack(side="left", padx=2)

        self.vessel_interval_entry = ctk.CTkEntry(self.vessel_auto_frame, width=60)
        self.vessel_interval_entry.pack(side="left", padx=5)
        self.vessel_interval_entry.insert(0, "5") # default 5 minutes

        # Watchlist Dialog button
        self.vessel_watchlist_btn = ctk.CTkButton(
            self.vessel_auto_frame,
            text="Danh sách theo dõi..." if self.language == "vi" else "Watchlist...",
            width=150,
            command=self.open_watchlist_dialog,
            fg_color="#1ABC9C",
            hover_color="#16A085"
        )
        self.vessel_watchlist_btn.pack(side="left", padx=5)

        # Toggle Switch
        self.vessel_auto_switch = ctk.CTkSwitch(
            self.vessel_auto_frame,
            text="Bật tự động" if self.language == "vi" else "Enable Auto",
            command=self.toggle_auto_request
        )
        self.vessel_auto_switch.pack(side="left", padx=10)

        # Auto Status Label
        self.vessel_auto_status_lbl = ctk.CTkLabel(
            self.vessel_auto_frame, 
            text="Trạng thái: Đang tắt" if self.language == "vi" else "Status: Inactive", 
            text_color="gray"
        )
        self.vessel_auto_status_lbl.pack(side="left", padx=10)

        # Search Bar & Local Actions Panel inside Vessel Tab (Row 2)
        self.vessel_search_action_frame = ctk.CTkFrame(self.tab_vessel, fg_color="transparent")
        self.vessel_search_action_frame.grid(row=2, column=0, padx=10, pady=(5, 5), sticky="ew")

        # Local search entry
        self.vessel_search_entry = ctk.CTkEntry(self.vessel_search_action_frame, placeholder_text="Tìm kiếm lịch tàu...", width=200)
        self.vessel_search_entry.pack(side="left", fill="x", expand=True, padx=(0, 5))
        self.vessel_search_entry.bind("<Return>", lambda e: self.perform_vessel_search())

        # Local search column selector
        self.vessel_search_field_menu = ctk.CTkOptionMenu(
            self.vessel_search_action_frame,
            values=[],
            width=140
        )
        self.vessel_search_field_menu.pack(side="left", padx=5)

        # Search button
        self.vessel_local_search_btn = ctk.CTkButton(self.vessel_search_action_frame, text="Tìm", width=80, command=self.perform_vessel_search)
        self.vessel_local_search_btn.pack(side="left", padx=5)

        # Clear/Reset search button
        self.vessel_local_clear_btn = ctk.CTkButton(self.vessel_search_action_frame, text="Làm mới", width=90, command=self.refresh_vessel_schedule_data)
        self.vessel_local_clear_btn.pack(side="left", padx=5)

        self.vessel_sync_btn = ctk.CTkButton(
            self.vessel_search_action_frame, 
            text="Cập nhật Booking", 
            width=130, 
            command=self.sync_eport_to_bookings,
            fg_color="#2E86C1",
            hover_color="#3498DB"
        )
        self.vessel_sync_btn.pack(side="left", padx=5)

        self.vessel_copy_btn = ctk.CTkButton(
            self.vessel_search_action_frame,
            text="Sao chép nhanh",
            width=110,
            command=self.copy_selected_vessel_schedule
        )
        self.vessel_copy_btn.pack(side="left", padx=5)

        self.vessel_delete_btn = ctk.CTkButton(
            self.vessel_search_action_frame, 
            text="Xóa lịch tàu", 
            width=110, 
            fg_color="#C0392B", 
            hover_color="#E74C3C", 
            command=self.delete_selected_vessel_schedule
        )
        self.vessel_delete_btn.pack(side="right", padx=5)

        # Treeview Scrollbars & Widget inside Vessel Tab (Row 3)
        self.vessel_tree_container = ctk.CTkFrame(self.tab_vessel, fg_color="transparent")
        self.vessel_tree_container.grid(row=3, column=0, padx=10, pady=(0, 10), sticky="nsew")

        self.vessel_tree_scroll_y = ttk.Scrollbar(self.vessel_tree_container)
        self.vessel_tree_scroll_y.pack(side="right", fill="y")

        self.vessel_tree_scroll_x = ttk.Scrollbar(self.vessel_tree_container, orient="horizontal")
        self.vessel_tree_scroll_x.pack(side="bottom", fill="x")

        self.vessel_tree = ttk.Treeview(
            self.vessel_tree_container,
            yscrollcommand=self.vessel_tree_scroll_y.set,
            xscrollcommand=self.vessel_tree_scroll_x.set,
            show="headings"
        )
        self.vessel_tree.pack(fill="both", expand=True)

        self.vessel_tree_scroll_y.config(command=self.vessel_tree.yview)
        self.vessel_tree_scroll_x.config(command=self.vessel_tree.xview)

        # Bind double-click event to show details
        self.vessel_tree.bind("<Double-1>", self.show_vessel_row_details)

        # Setup ePort Vessel Treeview Columns
        self.vessel_tree["columns"] = self.vessel_columns
        self.update_vessel_treeview_columns()

        self.update_treeview_style()
        self.update_search_fields_ui()
        self.update_vessel_search_fields_ui()

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
        
        trees = []
        if hasattr(self, "tree"):
            trees.append(self.tree)
        if hasattr(self, "vessel_tree"):
            trees.append(self.vessel_tree)
            
        if mode == "dark":
            for t in trees:
                t.tag_configure("oddrow", background="#2D3238", foreground="white")
                t.tag_configure("evenrow", background="#1F2326", foreground="white")
            self.style.configure("Treeview", font=("Segoe UI", self.font_size), rowheight=row_height, background="#1F2326", fieldbackground="#1F2326", foreground="white", gridcolor="#3F444A")
            self.style.configure("Treeview.Heading", font=("Segoe UI", self.font_size, "bold"), background="#2D3238", foreground="white")
        else:
            for t in trees:
                t.tag_configure("oddrow", background="#F2F7FA", foreground="black")
                t.tag_configure("evenrow", background="#FFFFFF", foreground="black")
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
            
            # ePort translations
            self.vessel_port_label.configure(text="Port:")
            self.vessel_name_entry.configure(placeholder_text="Vessel name...")
            self.vessel_voyage_entry.configure(placeholder_text="Voyage...")
            self.vessel_search_btn.configure(text="Search")
            
            self.vessel_search_entry.configure(placeholder_text="Search vessel schedule...")
            self.vessel_local_search_btn.configure(text="Search")
            self.vessel_local_clear_btn.configure(text="Refresh")
            self.vessel_sync_btn.configure(text="Sync Bookings")
            self.vessel_copy_btn.configure(text="Copy")
            self.vessel_delete_btn.configure(text="Delete Schedule")
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
            
            # ePort translations
            self.vessel_port_label.configure(text="Cảng / Port:")
            self.vessel_name_entry.configure(placeholder_text="Tên tàu / Vessel...")
            self.vessel_voyage_entry.configure(placeholder_text="Chuyến / Voyage...")
            self.vessel_search_btn.configure(text="Tra cứu")
            
            self.vessel_search_entry.configure(placeholder_text="Tìm kiếm lịch tàu...")
            self.vessel_local_search_btn.configure(text="Tìm")
            self.vessel_local_clear_btn.configure(text="Làm mới")
            self.vessel_sync_btn.configure(text="Cập nhật Booking")
            self.vessel_copy_btn.configure(text="Sao chép nhanh")
            self.vessel_delete_btn.configure(text="Xóa lịch tàu")
        
        self.update_search_fields_ui()
        self.update_vessel_search_fields_ui()
        
        current_tab = self.tab_view.get()
        if "Booking" in current_tab:
            self.draw_column_checklist()
        else:
            self.draw_vessel_column_checklist()
            
        self.update_treeview_columns()
        self.update_vessel_treeview_columns()

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
            if self.auto_request_running:
                self.stop_auto_request_timer()
                self.vessel_auto_switch.deselect()
            self.load_bookings_from_db()
            self.load_vessel_schedules_from_db()

    def set_active_collection(self, col_id, col_name):
        self.active_collection_id = col_id
        self.active_collection_name = col_name
        self.collection_menu.set(col_name)
        if self.auto_request_running:
            self.stop_auto_request_timer()
            self.start_auto_request_timer()
        self.load_bookings_from_db()
        self.load_vessel_schedules_from_db()

    def on_collection_changed(self, col_name):
        for col in self.collections:
            if col["name"] == col_name:
                self.active_collection_id = col["id"]
                self.active_collection_name = col["name"]
                if self.auto_request_running:
                    self.stop_auto_request_timer()
                    self.start_auto_request_timer()
                self.load_bookings_from_db()
                self.load_vessel_schedules_from_db()
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

    def update_vessel_search_fields_ui(self):
        if self.language == "vi":
            self.vessel_search_fields_mapping = {
                "Tất cả các cột": "all",
                "Mã cảng": "site_id",
                "Đại lý": "agent",
                "Tên tàu": "vessel_name",
                "Số chuyến": "in_out_voyage",
                "Cập bến dự kiến": "actual_berth_time",
                "Rời bến dự kiến": "actual_departure_time",
                "Thời gian đóng": "closing_time",
                "Thời gian đóng ICD": "closing_time_icd",
                "Cổng hạ": "in_gate",
                "Mở cổng hạ": "open_ts",
                "Ghi chú": "remarks",
                "Tra cứu lúc": "queried_at"
            }
        else:
            self.vessel_search_fields_mapping = {
                "All Columns": "all",
                "Site ID": "site_id",
                "Agent": "agent",
                "Vessel Name": "vessel_name",
                "Voyage": "in_out_voyage",
                "ETA/ETB": "actual_berth_time",
                "ETD": "actual_departure_time",
                "Cut-off Time": "closing_time",
                "Cut-off ICD": "closing_time_icd",
                "Gate": "in_gate",
                "Open Time": "open_ts",
                "Remarks": "remarks",
                "Queried At": "queried_at"
            }
        
        values = list(self.vessel_search_fields_mapping.keys())
        self.vessel_search_field_menu.configure(values=values)
        default_val = "Tất cả các cột" if self.language == "vi" else "All Columns"
        self.vessel_search_field_menu.set(default_val)

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

    # --- ePort SNP Vessel Schedule Operations ---

    def update_vessel_treeview_columns(self):
        selected_cols = [col for col in self.vessel_columns if self.vessel_column_vars[col].get()]
        self.vessel_tree["columns"] = selected_cols
        for col in selected_cols:
            display_name = VESSEL_COLUMN_TRANSLATIONS[self.language].get(col, col)
            self.vessel_tree.heading(col, text=display_name)
            # Adjust widths for certain fields
            if col == "STT":
                self.vessel_tree.column(col, width=50, minwidth=40, anchor="center")
            elif col in ["site_id", "agent"]:
                self.vessel_tree.column(col, width=80, minwidth=60, anchor="center")
            elif col in ["vessel_name", "in_out_voyage"]:
                self.vessel_tree.column(col, width=160, minwidth=120, anchor="w")
            elif col in ["actual_berth_time", "actual_departure_time", "closing_time", "closing_time_icd", "open_ts", "reefer_open_ts", "oog_open_ts", "haz_open_ts", "queried_at"]:
                self.vessel_tree.column(col, width=150, minwidth=110, anchor="center")
            else:
                self.vessel_tree.column(col, width=120, minwidth=80, anchor="w")
        self.populate_vessel_treeview()

    def destroy(self):
        self.auto_request_running = False
        if self.vessel_auto_timer_id is not None:
            self.after_cancel(self.vessel_auto_timer_id)
            self.vessel_auto_timer_id = None
        super().destroy()

    def open_watchlist_dialog(self):
        # Prevent multiple dialogs
        if hasattr(self, "watchlist_dialog") and self.watchlist_dialog.winfo_exists():
            self.watchlist_dialog.focus()
        else:
            self.watchlist_dialog = VesselWatchlistDialog(self)

    def toggle_auto_request(self):
        if self.vessel_auto_switch.get():
            self.start_auto_request_timer()
        else:
            self.stop_auto_request_timer()

    def start_auto_request_timer(self):
        if self.active_collection_id is None:
            title = "Cảnh báo" if self.language == "vi" else "Warning"
            msg = "Vui lòng chọn hoặc tạo một Bộ sưu tập trước khi bật tự động." if self.language == "vi" else "Please select or create a Collection first."
            messagebox.showwarning(title, msg, parent=self)
            self.vessel_auto_switch.deselect()
            return

        # Read interval
        try:
            val = float(self.vessel_interval_entry.get().strip())
            if val < 1.0:
                raise ValueError("Interval must be at least 1 minute.")
        except Exception:
            title = "Lỗi nhập liệu" if self.language == "vi" else "Input Error"
            msg = "Khoảng thời gian phải là số lớn hơn hoặc bằng 1 phút!" if self.language == "vi" else "Interval must be a number greater than or equal to 1 minute!"
            messagebox.showwarning(title, msg, parent=self)
            self.vessel_auto_switch.deselect()
            return

        self.auto_request_running = True
        self.vessel_interval_entry.configure(state="disabled")
        
        status_text = "Đang chạy..." if self.language == "vi" else "Running..."
        self.vessel_auto_status_lbl.configure(text=f"Trạng thái: {status_text}", text_color="green")
        
        # Trigger immediately on start
        self.trigger_auto_request()

    def stop_auto_request_timer(self):
        self.auto_request_running = False
        if self.vessel_auto_timer_id is not None:
            self.after_cancel(self.vessel_auto_timer_id)
            self.vessel_auto_timer_id = None
        self.vessel_interval_entry.configure(state="normal")
        status_text = "Đang tắt" if self.language == "vi" else "Inactive"
        self.vessel_auto_status_lbl.configure(text=f"Trạng thái: {status_text}", text_color="gray")

    def trigger_auto_request(self):
        if not self.auto_request_running or self.active_collection_id is None:
            return
            
        watchlist = get_watchlist(self.active_collection_id)
        if not watchlist:
            # Nothing to fetch, reschedule
            self.reschedule_auto_request()
            return
            
        import threading
        t = threading.Thread(target=self.run_auto_request_thread, args=(self.active_collection_id, watchlist), daemon=True)
        t.start()

    def run_auto_request_thread(self, col_id, watchlist):
        success_count = 0
        error_messages = []
        
        def update_fetching_status():
            fetching_text = "Đang lấy dữ liệu..." if self.language == "vi" else "Fetching..."
            self.vessel_auto_status_lbl.configure(text=f"Trạng thái: {fetching_text}", text_color="orange")
        self.after(0, update_fetching_status)
        
        for item in watchlist:
            if not self.auto_request_running:
                break
            site_id = item["site_id"]
            vessel_name = item["vessel_name"]
            voyage = item["voyage"]
            
            try:
                # Call search_vessels API using ONLY vessel name as requested to get all voyages, then filter locally
                results = search_vessels(site_id, vessel_name)
                if results:
                    filtered = []
                    for r in results:
                        voyage_val = r.get("IN_OUT_VOYAGE", "")
                        if voyage.lower().strip() in voyage_val.lower().strip():
                            filtered.append(r)
                            
                    if filtered:
                        insert_vessel_schedules(col_id, filtered)
                        success_count += len(filtered)
            except Exception as e:
                error_messages.append(f"{vessel_name}: {e}")
                
        err_msg = "; ".join(error_messages) if error_messages else None
        self.after(0, self.handle_auto_request_result, success_count, err_msg)

    def handle_auto_request_result(self, success_count, error_msg):
        if not self.auto_request_running:
            return
            
        # Refresh treeview/database data on screen (unconditionally so it's always up to date)
        self.load_vessel_schedules_from_db()
            
        # Update status
        now_str = datetime.now().strftime("%H:%M:%S")
        if error_msg:
            status_text = f"Lỗi lúc {now_str} (Lấy {success_count} dòng)" if self.language == "vi" else f"Error at {now_str} (Got {success_count} rows)"
            self.vessel_auto_status_lbl.configure(text=status_text, text_color="red")
        else:
            status_text = f"Cập nhật lúc {now_str} (+{success_count} dòng)" if self.language == "vi" else f"Updated at {now_str} (+{success_count} rows)"
            self.vessel_auto_status_lbl.configure(text=status_text, text_color="green")
            
        self.reschedule_auto_request()

    def reschedule_auto_request(self):
        if not self.auto_request_running:
            return
        try:
            mins = float(self.vessel_interval_entry.get().strip())
            if mins < 1.0:
                mins = 1.0
        except Exception:
            mins = 5.0
            
        ms = int(mins * 60 * 1000)
        self.vessel_auto_timer_id = self.after(ms, self.trigger_auto_request)

    def search_eport_vessel(self):
        if self.active_collection_id is None:
            title = "Cảnh báo" if self.language == "vi" else "Warning"
            msg = "Vui lòng chọn hoặc tạo một Bộ sưu tập trước khi tra cứu lịch tàu." if self.language == "vi" else "Please select or create a Collection before searching vessel schedules."
            messagebox.showwarning(title, msg, parent=self)
            return

        # Read parameters
        port_val = self.vessel_port_menu.get()
        # Extract CTL or GNL from Cát Lái (CTL) / Cát Lái Giang Nam (GNL)
        site_id = "CTL"
        if "GNL" in port_val:
            site_id = "GNL"
            
        vessel_name = self.vessel_name_entry.get().strip()
        voyage = self.vessel_voyage_entry.get().strip()
        
        if not vessel_name:
            title = "Cảnh báo" if self.language == "vi" else "Warning"
            msg = "Vui lòng nhập tên tàu để tra cứu." if self.language == "vi" else "Please enter vessel name to search."
            messagebox.showwarning(title, msg, parent=self)
            return

        # Show loading indicator by changing button text or status
        orig_text = self.vessel_search_btn.cget("text")
        loading_text = "Đang tra cứu..." if self.language == "vi" else "Searching..."
        self.vessel_search_btn.configure(text=loading_text, state="disabled")
        self.update()

        try:
            results = search_vessels(site_id, vessel_name, voyage)
            if not results:
                title = "Thông báo" if self.language == "vi" else "Information"
                msg = "Không tìm thấy thông tin lịch tàu khớp với từ khóa tìm kiếm." if self.language == "vi" else "No matching vessel schedules found."
                messagebox.showinfo(title, msg, parent=self)
            else:
                # Save to database
                insert_vessel_schedules(self.active_collection_id, results)
                
                title = "Thành công" if self.language == "vi" else "Success"
                msg = f"Đã tra cứu thành công và lưu {len(results)} dòng lịch trình tàu!" if self.language == "vi" else f"Successfully fetched and saved {len(results)} vessel schedules!"
                messagebox.showinfo(title, msg, parent=self)
                
            self.refresh_vessel_schedule_data()
        except Exception as e:
            title = "Lỗi" if self.language == "vi" else "Error"
            msg = f"Lỗi tra cứu ePort: {e}" if self.language == "vi" else f"ePort lookup error: {e}"
            messagebox.showerror(title, msg, parent=self)
        finally:
            self.vessel_search_btn.configure(text=orig_text, state="normal")

    def refresh_vessel_schedule_data(self):
        self.vessel_search_entry.delete(0, "end")
        default_val = "Tất cả các cột" if self.language == "vi" else "All Columns"
        self.vessel_search_field_menu.set(default_val)
        self.load_vessel_schedules_from_db(query=None, field="all")

    def load_vessel_schedules_from_db(self, query=None, field=None):
        if query is None:
            query = self.vessel_search_entry.get().strip()
        if field is None:
            selected_display = self.vessel_search_field_menu.get()
            field = self.vessel_search_fields_mapping.get(selected_display, "all")
            
        if self.active_collection_id is None:
            self.vessel_display_data = []
            self.populate_vessel_treeview()
            return
            
        self.vessel_display_data = get_vessel_schedules(self.active_collection_id, search_query=query, search_field=field)
        self.populate_vessel_treeview()

    def perform_vessel_search(self):
        query = self.vessel_search_entry.get().strip()
        selected_display = self.vessel_search_field_menu.get()
        field_name = self.vessel_search_fields_mapping.get(selected_display, "all")
        self.load_vessel_schedules_from_db(query if query else None, field_name)

    def populate_vessel_treeview(self):
        # Clear items
        for item in self.vessel_tree.get_children():
            self.vessel_tree.delete(item)
            
        selected_cols = [col for col in self.vessel_columns if self.vessel_column_vars[col].get()]
        
        for idx, row_data in enumerate(self.vessel_display_data):
            values = []
            for col_idx, col in enumerate(selected_cols):
                val = row_data.get(col, "")
                if val is None or val == "None":
                    val = ""
                    
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
            self.vessel_tree.insert("", "end", iid=str(row_data["id"]), values=values, tags=(tag,))

    def delete_selected_vessel_schedule(self):
        selected_items = self.vessel_tree.selection()
        if not selected_items:
            title = "Cảnh báo" if self.language == "vi" else "Warning"
            msg = "Vui lòng chọn dòng lịch trình cần xóa." if self.language == "vi" else "Please select a vessel schedule row to delete."
            messagebox.showwarning(title, msg, parent=self)
            return
            
        confirm_title = "Xác nhận xóa" if self.language == "vi" else "Confirm Delete"
        confirm_msg = "Bạn có chắc chắn muốn xóa dòng lịch tàu đang chọn khỏi cơ sở dữ liệu không?" if self.language == "vi" else "Are you sure you want to delete the selected vessel schedule row?"
        if not messagebox.askyesno(confirm_title, confirm_msg, parent=self):
            return
            
        for item in selected_items:
            db_id = int(item)
            delete_vessel_schedule(db_id)
            
        self.refresh_vessel_schedule_data()

    def copy_selected_vessel_schedule(self):
        selected = self.vessel_tree.selection()
        if not selected:
            title = "Cảnh báo" if self.language == "vi" else "Warning"
            msg = "Vui lòng chọn lịch tàu cần sao chép." if self.language == "vi" else "Please select a vessel schedule to copy."
            messagebox.showwarning(title, msg, parent=self)
            return
            
        row_id = int(selected[0])
        row_data = None
        for r in self.vessel_display_data:
            if r["id"] == row_id:
                row_data = r
                break
                
        if not row_data:
            return
            
        items_list = []
        for col in self.vessel_columns:
            if col == "STT":
                continue
            display_name = VESSEL_COLUMN_TRANSLATIONS[self.language].get(col, col)
            val = row_data.get(col, "")
            if val is None or val == "None":
                val = ""
            items_list.append(f"{display_name}: {val}")
            
        formatted_str = ", ".join(items_list)
        self.clipboard_clear()
        self.clipboard_append(formatted_str)
        self.update()
        
        title = "Thành công" if self.language == "vi" else "Success"
        msg = "Đã sao chép lịch tàu vào Clipboard!" if self.language == "vi" else "Vessel schedule data copied to clipboard!"
        messagebox.showinfo(title, msg, parent=self)

    def export_vessel_excel(self):
        if not self.vessel_display_data:
            msg = "Không có dữ liệu lịch trình tàu để xuất." if self.language == "vi" else "No vessel schedule data to export."
            title = "Cảnh báo" if self.language == "vi" else "Warning"
            messagebox.showwarning(title, msg, parent=self)
            return
            
        title_save = "Lưu lịch tàu Excel" if self.language == "vi" else "Save Vessel Schedule Excel"
        save_path = filedialog.asksaveasfilename(
            defaultextension=".xlsx",
            filetypes=[("Excel files", "*.xlsx")],
            title=title_save,
            parent=self
        )
        
        if save_path:
            try:
                exported_data = []
                for row_idx, row_data in enumerate(self.vessel_display_data, 1):
                    exported_row = {}
                    for col in self.vessel_columns:
                        display_name = VESSEL_COLUMN_TRANSLATIONS[self.language].get(col, col)
                        if col == "STT":
                            exported_row[display_name] = str(row_idx)
                        else:
                            exported_row[display_name] = row_data.get(col, "")
                    exported_data.append(exported_row)
                
                excel_cols = [VESSEL_COLUMN_TRANSLATIONS[self.language].get(col, col) for col in self.vessel_columns]
                
                # Use the existing export utility
                success = export_to_excel(exported_data, save_path, excel_cols)
                if success:
                    success_msg = f"Xuất lịch tàu thành công ra {save_path}" if self.language == "vi" else f"Vessel schedules exported successfully to {save_path}"
                    success_title = "Thành công" if self.language == "vi" else "Success"
                    messagebox.showinfo(success_title, success_msg, parent=self)
                else:
                    err_msg = "Không thể xuất lịch tàu." if self.language == "vi" else "Failed to export vessel schedules."
                    err_title = "Lỗi" if self.language == "vi" else "Error"
                    messagebox.showerror(err_title, err_msg, parent=self)
            except Exception as e:
                err_title = "Lỗi" if self.language == "vi" else "Error"
                messagebox.showerror(err_title, f"An error occurred: {e}", parent=self)

    def sync_eport_to_bookings(self):
        """
        Scan all bookings in the active collection, match the vessel name,
        and update Port Cargo Cut-off and ETD based on ePort SNP data.
        """
        if self.active_collection_id is None:
            title = "Cảnh báo" if self.language == "vi" else "Warning"
            msg = "Vui lòng chọn Bộ sưu tập Booking để đồng bộ." if self.language == "vi" else "Please select a booking Collection to sync."
            messagebox.showwarning(title, msg, parent=self)
            return

        bookings = get_bookings(self.active_collection_id)
        if not bookings:
            title = "Thông báo" if self.language == "vi" else "Information"
            msg = "Bộ sưu tập hiện tại không có dữ liệu Booking để cập nhật." if self.language == "vi" else "Current collection has no booking data to sync."
            messagebox.showinfo(title, msg, parent=self)
            return

        schedules = get_vessel_schedules(self.active_collection_id)
        if not schedules:
            title = "Thông báo" if self.language == "vi" else "Information"
            msg = "Vui lòng tra cứu lịch tàu từ ePort trước khi đồng bộ." if self.language == "vi" else "Please search and save some vessel schedules from ePort first."
            messagebox.showinfo(title, msg, parent=self)
            return

        # Perform sync matching
        updated_count = 0
        
        # We will open a connection to bookings DB directly to run updates
        with sqlite3.connect("booking_data.db") as conn:
            cursor = conn.cursor()
            
            for b in bookings:
                booking_vessel = b.get("Vessel", "")
                if not booking_vessel or booking_vessel == "null":
                    continue
                    
                # Clean up booking vessel for match (uppercase, clean spaces)
                clean_b_vessel = booking_vessel.strip().upper()
                
                # Look for a matching vessel schedule in DB
                matched_schedule = None
                for s in schedules:
                    s_vessel = s.get("vessel_name", "").strip().upper()
                    s_voyage = s.get("in_out_voyage", "").strip().upper()
                    
                    # Match strategies:
                    # 1. Booking vessel contains vessel name and voyage
                    # 2. Vessel name matches and booking vessel contains voyage (if voyage exists in booking_vessel)
                    # 3. Simple substring match of vessel name
                    if not s_vessel:
                        continue
                        
                    is_match = False
                    # If voyage is in schedule, does booking vessel contain it?
                    if s_voyage:
                        # Split by slash or dash to see if it's there
                        voy_parts = [p.strip() for p in s_voyage.split("-") if p.strip()]
                        if s_vessel in clean_b_vessel and any(vp in clean_b_vessel for vp in voy_parts):
                            is_match = True
                    
                    if not is_match and s_vessel in clean_b_vessel:
                        is_match = True
                        
                    if is_match:
                        matched_schedule = s
                        break
                
                if matched_schedule:
                    new_cutoff = matched_schedule.get("closing_time", "")
                    # Extract ETD or ETA
                    new_etd = matched_schedule.get("actual_departure_time", "")
                    if not new_etd or "EST" in new_etd:
                        # Fallback to berth time if needed
                        berth = matched_schedule.get("actual_berth_time", "")
                        if berth:
                            new_etd = berth
                            
                    # Remove "EST (dự kiến):" prefixes if present for clean display
                    if "EST (dự kiến):" in new_cutoff:
                        new_cutoff = new_cutoff.replace("EST (dự kiến):", "").strip()
                    if "EST (dự kiến):" in new_etd:
                        new_etd = new_etd.replace("EST (dự kiến):", "").strip()
                        
                    # Update database row
                    cursor.execute("""
                        UPDATE bookings 
                        SET cutoff_time = ?, etd = ?
                        WHERE id = ?;
                    """, (new_cutoff, new_etd, b["id"]))
                    updated_count += 1
            
            conn.commit()

        if updated_count > 0:
            # Reload treeview
            self.load_bookings_from_db()
            
            title = "Thành công" if self.language == "vi" else "Success"
            msg = f"Đồng bộ thành công! Đã cập nhật {updated_count} bookings khớp với lịch trình ePort." if self.language == "vi" else f"Sync completed! Updated {updated_count} bookings matching ePort schedules."
            messagebox.showinfo(title, msg, parent=self)
        else:
            title = "Thông báo" if self.language == "vi" else "Information"
            msg = "Không tìm thấy booking nào khớp với danh sách lịch tàu ePort đã tra cứu." if self.language == "vi" else "No bookings matched the fetched ePort vessel schedules."
            messagebox.showinfo(title, msg, parent=self)

    def on_tab_changed(self):
        current_tab = self.tab_view.get()
        if "Booking" in current_tab:
            self.draw_column_checklist()
            self.clear_btn.configure(
                text="Xóa dữ liệu PDF" if self.language == "vi" else "Clear PDF Data",
                command=self.clear_data
            )
            self.export_btn.configure(command=self.export_excel)
        else:
            self.draw_vessel_column_checklist()
            self.clear_btn.configure(
                text="Xóa lịch trình tàu" if self.language == "vi" else "Clear Vessel Data",
                command=self.clear_vessel_data
            )
            self.export_btn.configure(command=self.export_vessel_excel)

    def draw_vessel_column_checklist(self):
        for widget in self.checkbox_frame.winfo_children():
            widget.destroy()

        for idx, col in enumerate(self.vessel_columns):
            display_name = VESSEL_COLUMN_TRANSLATIONS[self.language].get(col, col)
            var = self.vessel_column_vars.setdefault(col, ctk.BooleanVar(value=True))
            cb = ctk.CTkCheckBox(
                self.checkbox_frame, 
                text="", 
                variable=var, 
                command=self.update_vessel_treeview_columns,
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
                entry.bind("<KeyRelease>", lambda e, c=col, ev=entry_var: self.update_vessel_vietnamese_translation(c, ev.get()))
                entry.bind("<FocusOut>", lambda e, c=col, ev=entry_var: self.update_vessel_vietnamese_translation(c, ev.get()))
            else:
                entry.configure(state="disabled")
            
            up_btn = ctk.CTkButton(
                self.checkbox_frame, 
                text="▲", 
                width=24, 
                height=20,
                fg_color="gray",
                hover_color="darkgray",
                command=lambda c=col: self.move_vessel_column_up(c)
            )
            up_btn.grid(row=idx, column=2, padx=2, pady=3)
            
            down_btn = ctk.CTkButton(
                self.checkbox_frame, 
                text="▼", 
                width=24, 
                height=20,
                fg_color="gray",
                hover_color="darkgray",
                command=lambda c=col: self.move_vessel_column_down(c)
            )
            down_btn.grid(row=idx, column=3, padx=2, pady=3)

    def update_vessel_vietnamese_translation(self, col, new_val):
        if self.language == "vi":
            VESSEL_COLUMN_TRANSLATIONS["vi"][col] = new_val
            self.update_vessel_treeview_columns()

    def move_vessel_column_up(self, col):
        idx = self.vessel_columns.index(col)
        if idx > 0:
            self.vessel_columns[idx], self.vessel_columns[idx-1] = self.vessel_columns[idx-1], self.vessel_columns[idx]
            self.draw_vessel_column_checklist()
            self.update_vessel_treeview_columns()

    def move_vessel_column_down(self, col):
        idx = self.vessel_columns.index(col)
        if idx < len(self.vessel_columns) - 1:
            self.vessel_columns[idx], self.vessel_columns[idx+1] = self.vessel_columns[idx+1], self.vessel_columns[idx]
            self.draw_vessel_column_checklist()
            self.update_vessel_treeview_columns()

    def show_vessel_row_details(self, event):
        selected_item = self.vessel_tree.selection()
        if not selected_item:
            return
            
        db_id = int(selected_item[0])
        row_data = None
        for row in self.vessel_display_data:
            if row["id"] == db_id:
                row_data = row
                break
                
        if not row_data:
            return
            
        popup_title = "Chi tiết Lịch Tàu" if self.language == "vi" else "Vessel Schedule Details"
        popup_header = "CHI TIẾT LỊCH TRÌNH TÀU" if self.language == "vi" else "VESSEL SCHEDULE DETAILS"
        copy_text = "Sao chép nhanh" if self.language == "vi" else "Copy Details"
        close_text = "Đóng" if self.language == "vi" else "Close"

        popup = ctk.CTkToplevel(self)
        popup.title(popup_title)
        popup.geometry("600x600")
        popup.attributes("-topmost", True)
        
        scroll_frame = ctk.CTkScrollableFrame(popup)
        scroll_frame.pack(fill="both", expand=True, padx=15, pady=15)
        
        title_label = ctk.CTkLabel(scroll_frame, text=popup_header, font=ctk.CTkFont(size=16, weight="bold"))
        title_label.pack(pady=(10, 15))
        
        for col in self.vessel_columns:
            if col == "STT":
                continue
            display_name = VESSEL_COLUMN_TRANSLATIONS[self.language].get(col, col)
            val = row_data.get(col, "")
            if val is None or val == "None":
                val = ""
            
            row_frame = ctk.CTkFrame(scroll_frame, fg_color="transparent")
            row_frame.pack(fill="x", pady=6)
            
            lbl = ctk.CTkLabel(row_frame, text=f"{display_name}:", font=ctk.CTkFont(size=12, weight="bold"), width=180, anchor="w")
            lbl.pack(side="left")
            
            val_box = ctk.CTkEntry(row_frame, height=28, font=ctk.CTkFont(size=12), width=320)
            val_box.insert(0, str(val))
            val_box.configure(state="readonly")
            val_box.pack(side="left", fill="x", expand=True, padx=(10, 0))
            
        btn_frame = ctk.CTkFrame(popup, fg_color="transparent")
        btn_frame.pack(fill="x", pady=10)
        
        def copy_vessel_popup_details():
            selected_cols = [col for col in self.vessel_columns if self.vessel_column_vars[col].get()]
            items_list = []
            for col in selected_cols:
                display_name = VESSEL_COLUMN_TRANSLATIONS[self.language].get(col, col)
                if col == "STT":
                    try:
                        display_idx = self.vessel_display_data.index(row_data) + 1
                        val = str(display_idx)
                    except ValueError:
                        val = "1"
                else:
                    val = row_data.get(col, "")
                    if val is None or val == "None":
                        val = ""
                items_list.append(f"{display_name}: {val}")
            
            formatted_str = ", ".join(items_list)
            self.clipboard_clear()
            self.clipboard_append(formatted_str)
            self.update()
            
            title = "Thành công" if self.language == "vi" else "Success"
            msg = "Đã sao chép lịch tàu vào Clipboard!" if self.language == "vi" else "Vessel schedule data copied to clipboard!"
            messagebox.showinfo(title, msg, parent=popup)

        popup_copy_btn = ctk.CTkButton(btn_frame, text=copy_text, command=copy_vessel_popup_details)
        popup_copy_btn.pack(side="left", expand=True, padx=15)
        
        close_btn = ctk.CTkButton(btn_frame, text=close_text, command=popup.destroy)
        close_btn.pack(side="left", expand=True, padx=15)

    def clear_vessel_data(self):
        if self.active_collection_id is None:
            return
            
        title = "Xác nhận xóa sạch" if self.language == "vi" else "Confirm Clear"
        msg = "Bạn có chắc chắn muốn xóa toàn bộ lịch trình tàu trong Collection này không?" if self.language == "vi" else "Are you sure you want to delete all vessel schedules in this collection?"
        
        if messagebox.askyesno(title, msg, parent=self):
            try:
                clear_vessel_schedules(self.active_collection_id)
            except Exception as e:
                print(f"Error clearing collection vessel schedules: {e}")
            self.refresh_vessel_schedule_data()

if __name__ == "__main__":
    app = App()
    app.mainloop()
