"""Run only in a disposable subprocess, never in the API event loop."""
import io
import json
import os
import re
import sys

import pymupdf as fitz
import pytesseract
from PIL import Image

SAN_REGEX = r"(?<![^\s.(){}])(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?![A-Za-z0-9])"


OCR_VERSION = "ocr-region-v3"


def image_ocr(image, mode="page"):
    if mode not in ("page", "block", "line"):
        raise ValueError("Invalid OCR segmentation mode")
    width, height = image.size
    if max(width,height)>8192 or width*height>int(os.getenv("OCR_MAX_PIXELS", "16000000")):
        raise ValueError("Page dimensions exceed the OCR limit")
    if mode != "page":
        probe = image.copy()
        probe.thumbnail((400, 400))
        def score(angle):
            candidate = probe.rotate(angle, fillcolor=255).point(lambda p: 255 if p < 160 else 0)
            rows = [sum(candidate.crop((0,y,candidate.width,y+1)).get_flattened_data()) for y in range(candidate.height)]
            mean = sum(rows)/max(1,len(rows))
            return sum((row-mean)**2 for row in rows)
        angle = max(range(-3,4), key=lambda angle: (score(angle), -abs(angle)))
        image = image.rotate(angle, expand=True, fillcolor=255)
        if max(image.size)>8192 or image.width*image.height>int(os.getenv("OCR_MAX_PIXELS", "16000000")):
            raise ValueError("Deskewed region exceeds the OCR limit")
    psm = {"page":3,"block":6,"line":7}[mode]
    data = pytesseract.image_to_data(image, config=f"--psm {psm}", timeout=30,
                                     output_type=pytesseract.Output.DICT)
    items, lines = [], {}
    for i, word in enumerate(data["text"]):
        if not word.strip():
            continue
        confidence = max(0,float(data["conf"][i]))
        item = {"str":word,"x":data["left"][i],"y":data["top"][i],
                "width":data["width"][i],"height":data["height"][i],"confidence":confidence}
        items.append(item)
        key = (data["block_num"][i],data["par_num"][i],data["line_num"][i])
        lines.setdefault(key,[]).append(word)
    text = "\n".join(" ".join(words) for words in lines.values())
    return text,items,sum(i["confidence"] for i in items)/len(items) if items else 0


def extract(path, page):
    items, confidence = [], None
    with open(path,"rb") as source:
        header = source.read(1024)
        is_pdf = not header.startswith((b'\x89PNG\r\n\x1a\n',b'\xff\xd8')) and b"%PDF-" in header
    if is_pdf:
        with fitz.open(path) as doc:
            if not 1 <= page <= len(doc):
                raise ValueError("Page number is outside this PDF")
            page_obj = doc[page-1]
            text = page_obj.get_text()
            if len(text.strip())<10:
                pixels = page_obj.rect.width*page_obj.rect.height*(200/72)**2
                if max(page_obj.rect.width,page_obj.rect.height)*(200/72)>8192 or pixels>int(os.getenv("OCR_MAX_PIXELS","16000000")):
                    raise ValueError("Page dimensions exceed the OCR limit")
                pix = page_obj.get_pixmap(dpi=200,colorspace=fitz.csGRAY,alpha=False)
                with Image.open(io.BytesIO(pix.tobytes("png"))) as img:
                    text,items,confidence = image_ocr(img)
    else:
        with Image.open(path) as img:
            # Check dimensions before decoding/converting the pixels.
            if max(img.size)>8192 or img.width*img.height>int(os.getenv("OCR_MAX_PIXELS","16000000")):
                raise ValueError("Page dimensions exceed the OCR limit")
            text,items,confidence = image_ocr(img.convert("L"), img.info.get("ocr_mode", "page"))
    raw_text = text
    for pieces, symbol in [("\u2654\u265a", "K"), ("\u2655\u265b", "Q"), ("\u2656\u265c", "R"), ("\u2657\u265d", "B"), ("\u2658\u265e", "N"), ("\u2659\u265f", "")]:
        for piece in pieces:
            text = text.replace(piece, symbol)
    # Unknown glyphs remain unknown; never invent a piece.
    text = re.sub(r"[0O]-[0O](-[0O])?", lambda m: m[0].replace("0", "O"), text)
    return {"page":page,"moves":re.findall(SAN_REGEX,text),"text":raw_text,"text_items":items,
            "ocr_confidence":confidence,"extraction_version":OCR_VERSION}


if __name__ == "__main__":
    print(json.dumps(extract(sys.argv[1], int(sys.argv[2]))))
