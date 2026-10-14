"""Renders PDF pages to JPEG data URLs so the review window can show a booking PDF like an image."""
import base64
import io
import threading

# pdfium (behind pdfplumber's page.to_image) is not thread-safe; FastAPI runs sync endpoints in a pool
_RENDER_LOCK = threading.Lock()

MAX_PAGES = 6
RESOLUTION = 140  # dpi: readable when zoomed, ~150-250 KB per A4 page
JPEG_QUALITY = 82


def render_pdf_pages(pdf_bytes: bytes, max_pages: int = MAX_PAGES, resolution: int = RESOLUTION) -> dict:
    """{'pages': [data URL...], 'page_count': total pages, 'truncated': more pages than rendered}."""
    import pdfplumber  # lazy import: keeps backend startup fast

    pages = []
    with _RENDER_LOCK, pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages[:max_pages]:
            image = page.to_image(resolution=resolution).original.convert("RGB")
            buf = io.BytesIO()
            image.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
            pages.append("data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii"))
    return {"pages": pages, "page_count": page_count, "truncated": page_count > max_pages}


OCR_MAX_PAGES = 2
OCR_RESOLUTION = 200  # dpi: small print on booking confirmations stays legible for OCR


def render_pdf_for_ocr(pdf_bytes: bytes, max_pages: int = OCR_MAX_PAGES, resolution: int = OCR_RESOLUTION) -> bytes:
    """The first pages of a scanned PDF stacked into one JPEG, so one OCR / Gemini call reads them together."""
    import pdfplumber
    from PIL import Image

    with _RENDER_LOCK, pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        images = [page.to_image(resolution=resolution).original.convert("RGB") for page in pdf.pages[:max_pages]]
    if not images:
        raise ValueError("PDF has no pages")
    sheet = Image.new("RGB", (max(i.width for i in images), sum(i.height for i in images)), "white")
    y = 0
    for img in images:
        sheet.paste(img, (0, y))
        y += img.height
    buf = io.BytesIO()
    sheet.save(buf, format="JPEG", quality=90)
    return buf.getvalue()
