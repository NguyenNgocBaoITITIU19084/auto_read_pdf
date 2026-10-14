"""Tells booking PDFs and photos apart by their content, so a dropped file is read the right way whatever its name."""
import io
import os
from typing import Optional

PDF = "pdf"
IMAGE = "image"

# Formats Gemini Vision and the local OCR engines take as they are; anything else is converted to PNG first
_OCR_READY = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff")
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".jfif", ".webp", ".bmp", ".gif", ".tif", ".tiff"}


def _is_webp(data: bytes) -> bool:
    return data.startswith(b"RIFF") and data[8:12] == b"WEBP"


def _pil_can_open(data: bytes) -> bool:
    from PIL import Image  # lazy import: keeps backend startup fast
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        return True
    except Exception:
        return False


def detect_file_kind(data: bytes, filename: str = "") -> Optional[str]:
    """PDF or IMAGE from the file's bytes (a photo named .pdf is still a photo); None when it is neither."""
    head = data[:1024].lstrip()
    if head.startswith(b"%PDF"):
        return PDF
    if data.startswith(_OCR_READY) or _is_webp(data) or data.startswith((b"BM", b"GIF87a", b"GIF89a",
                                                                       b"II*\x00", b"MM\x00*")):
        return IMAGE
    if b"%PDF" in data[:1024]:  # some generators put a few junk bytes before the header
        return PDF
    if _pil_can_open(data):
        return IMAGE
    # unrecognised content: trust the name and let the PDF reader / OCR report what is wrong with it
    ext = os.path.splitext(filename or "")[1].lower()
    if ext == ".pdf" and data:
        return PDF
    if ext in _IMAGE_EXTENSIONS and data:
        return IMAGE
    return None


def to_ocr_image(data: bytes) -> bytes:
    """The image as PNG/JPEG/WebP bytes that Gemini and the local OCR engines accept (GIF, TIFF, BMP... -> PNG).
    Bytes Pillow cannot read are passed on unchanged for the OCR engines to report."""
    if data.startswith(_OCR_READY) or _is_webp(data):
        return data
    from PIL import Image, ImageSequence
    try:
        with Image.open(io.BytesIO(data)) as im:
            frame = next(ImageSequence.Iterator(im))  # first page / frame
            buf = io.BytesIO()
            frame.convert("RGB").save(buf, format="PNG")
            return buf.getvalue()
    except Exception:
        return data
