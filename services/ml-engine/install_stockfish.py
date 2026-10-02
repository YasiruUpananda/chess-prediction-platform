"""Install the official, checksum-pinned Stockfish 18 x86-64 release."""
import hashlib
import platform
import tarfile
import tempfile
import urllib.request
from pathlib import Path

URL = "https://github.com/official-stockfish/Stockfish/releases/download/sf_18/stockfish-ubuntu-x86-64.tar"
SHA256 = "5c6f38b02a4da5f3ffe763f27da6c3e743eebefd92b50cb3661623b96696adff"

if __name__ == "__main__":
    if platform.machine() not in ("x86_64", "AMD64"):
        raise RuntimeError("This pinned engine image targets x86-64; provide a verified native build for other architectures.")
    target = Path("/opt/stockfish18")
    target.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        archive = Path(directory) / "stockfish.tar"
        with urllib.request.urlopen(URL, timeout=120) as response, archive.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        with archive.open("rb") as downloaded:
            digest = hashlib.file_digest(downloaded, "sha256").hexdigest()
        if digest != SHA256:
            raise RuntimeError("Stockfish archive checksum mismatch")
        with tarfile.open(archive) as bundle:
            bundle.extractall(target, filter="data")
    binary = next(target.rglob("stockfish-ubuntu-x86-64"))
    binary.chmod(0o755)
    Path("/usr/local/bin/stockfish").symlink_to(binary)
    # Retain the complete official bundle, including GPL license/source files.
