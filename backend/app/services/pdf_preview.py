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
