"""Run only in a disposable subprocess, never in the API event loop."""
import io
import json
import os
import re
import sys

import fitz
import pytesseract
from PIL import Image

SAN_REGEX = r"(?<![A-Za-z0-9])(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?![A-Za-z0-9])"


def extract(path, page):
    with fitz.open(path) as doc:
        if not 1 <= page <= len(doc):
            raise ValueError("Page number is outside this PDF")
        page_obj = doc[page - 1]
        text = page_obj.get_text()
        if len(text.strip()) < 10:
            pixels = page_obj.rect.width * page_obj.rect.height * (200 / 72) ** 2
            if pixels > int(os.getenv("OCR_MAX_PIXELS", "16000000")):
                raise ValueError("Page dimensions exceed the OCR limit")
            pix = page_obj.get_pixmap(dpi=200, colorspace=fitz.csGRAY, alpha=False)
            with Image.open(io.BytesIO(pix.tobytes("png"))) as img:
                text = pytesseract.image_to_string(img, config="--psm 6", timeout=30)
    for pieces, symbol in [("♔♚", "K"), ("♕♛", "Q"), ("♖♜", "R"), ("♗♝", "B"), ("♘♞", "N"), ("♙♟", "")]:
        for piece in pieces:
            text = text.replace(piece, symbol)
    text = text.replace("\ufffd", "Q")
    text = re.sub(r"t(?:ll|t:l|l)\s*(x?[a-h][1-8])", r"N\1", text, flags=re.I)
    text = re.sub(r"(^|[\s.])i\.\s*(x?[a-h][1-8])", r"\1B\2", text, flags=re.I)
    text = re.sub(r"!'W", "Q", text, flags=re.I)
    text = re.sub(r"\bge[l1]\b", "Re1", text, flags=re.I)
    text = re.sub(r"[0O]-[0O](-[0O])?", lambda m: m[0].replace("0", "O"), text)
    return {"page": page, "moves": re.findall(SAN_REGEX, text)}


if __name__ == "__main__":
    print(json.dumps(extract(sys.argv[1], int(sys.argv[2]))))
