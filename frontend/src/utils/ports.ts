export interface PortOption {
  siteId: string;
  nameVi: string;
  nameEn: string;
}

export const PORT_OPTIONS: PortOption[] = [
  { siteId: 'CTL', nameVi: 'Cát Lái (CTL)', nameEn: 'Cat Lai (CTL)' },
  { siteId: 'GNL', nameVi: 'Cát Lái Giang Nam (GNL)', nameEn: 'Cat Lai Giang Nam (GNL)' },
  { siteId: 'THP', nameVi: 'Tân Cảng Hiệp Phước (THP)', nameEn: 'Tan Cang Hiep Phuoc (THP)' },
  { siteId: 'CMS', nameVi: 'CMS ICD Nhơn Trạch (CMS)', nameEn: 'CMS ICD Nhon Trach (CMS)' },
  { siteId: 'IST', nameVi: 'ICD Tân Cảng Sóng Thần (IST)', nameEn: 'ICD Tan Cang Song Than (IST)' },
  { siteId: 'TNT', nameVi: 'ICD Tân Cảng Nhơn Trạch (TNT)', nameEn: 'ICD Tan Cang Nhon Trach (TNT)' },
];

export const getPortDisplayName = (siteId?: string, lang: 'vi' | 'en' = 'vi'): string => {
  if (!siteId) return '';
  const trimmed = siteId.trim().toUpperCase();
  const port = PORT_OPTIONS.find((p) => p.siteId.toUpperCase() === trimmed);
  if (port) {
    return lang === 'en' ? port.nameEn : port.nameVi;
  }
  return siteId;
};
