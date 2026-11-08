"""Fetch pinned upstream schemas; no credentials or store data are used."""
import hashlib
import json
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "specs/manifest.json").read_text())
for source in manifest["sources"]:
    url = "https://raw.githubusercontent.com/vtex/openapi-schemas/" + manifest["commit"] + "/" + quote(source["file"])
    with urlopen(Request(url, headers={"User-Agent": "effect-vtex-sdk-spec-sync"}), timeout=60) as response:
        data = response.read()
    actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if actual != source["blob"]:
        raise RuntimeError("Upstream blob mismatch: " + source["file"])
    json.loads(data)
    (root / "specs" / source["file"]).write_bytes(data)
    print(source["file"], len(data), "bytes; verified")
