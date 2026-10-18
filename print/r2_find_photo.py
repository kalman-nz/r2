"""Finds a photo for an inventory item online and picks the best one with a
local vision model (Ollama).

    python r2_find_photo.py <input.json> <output-base>

input.json holds the item's details: name, code, category, tags,
description and custom ({label: value}). The chosen image is written to
<output-base>.<ext> and a JSON summary goes to stdout:
{"file", "query", "source", "title", "reason"}. On failure the reason is
written to <output-base>.err and the exit code is non-zero.

Standard library only, so it runs in the label printer's venv and the dev
venv without extra installs. Settings come from the environment:

    R2_OLLAMA_URL     default http://localhost:11434
    R2_VISION_MODEL   default gemma4:12b-it-qat (any Ollama model with vision)
"""

import base64
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

OLLAMA_URL = (os.environ.get("R2_OLLAMA_URL") or "http://localhost:11434").rstrip("/")
MODEL = os.environ.get("R2_VISION_MODEL") or "gemma4:12b-it-qat"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
CANDIDATES = 8
MAX_BYTES = 5 * 1024 * 1024  # the items.photo field's limit


class Failure(Exception):
    pass


def fetch(url, timeout=15, limit=MAX_BYTES + 1, headers=None):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(limit)


def image_type(data):
    """The file extension for JPEG/PNG/WebP/GIF bytes, else None."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    return None


def ollama(messages, timeout=180):
    body = json.dumps(
        {"model": MODEL, "messages": messages, "stream": False, "format": "json", "think": False, "options": {"temperature": 0}}
    ).encode()
    request = urllib.request.Request(OLLAMA_URL + "/api/chat", data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            reply = json.loads(response.read())
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:300]
        raise Failure(f"the local AI model ({MODEL}) returned an error: {detail}")
    except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
        raise Failure(f"couldn't reach the local AI model at {OLLAMA_URL} ({getattr(err, 'reason', err)}). Is Ollama running?")
    text = (reply.get("message") or {}).get("content") or ""
    try:
        return json.loads(text)
    except ValueError:
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            raise Failure("the local AI model gave an answer that wasn't JSON")
        return json.loads(match.group(0))


def describe(item):
    lines = [f"Name: {item.get('name', '')}"]
    for key, label in (("code", "Code"), ("category", "Category"), ("tags", "Tags"), ("description", "Description")):
        if item.get(key):
            lines.append(f"{label}: {str(item[key])[:600]}")
    for label, value in (item.get("custom") or {}).items():
        if value not in (None, "", False):
            lines.append(f"{label}: {str(value)[:200]}")
    return "\n".join(lines)


def search_query(item, details):
    """Asks the model for a web image search query; falls back to the name."""
    try:
        answer = ollama(
            [
                {
                    "role": "user",
                    "content": "This is an item in an AV / event equipment hire company's inventory:\n\n"
                    f"{details}\n\n"
                    "Write the web image search query most likely to find a clean product photo of exactly this item "
                    "(manufacturer and model if you can tell them, plus what kind of thing it is). Leave out internal "
                    "codes, quantities and asset numbers. Reply as JSON: {\"query\": \"...\"}",
                }
            ],
            timeout=90,
        )
        query = str(answer.get("query") or "").strip()
        if query:
            return query[:200]
    except Failure:
        raise
    except Exception:
        pass
    return str(item.get("name") or "").strip()


def search_images(query):
    """Bing image results (no API key needed): [{url, thumb, title, page}]."""
    params = urllib.parse.urlencode({"q": query, "first": "0", "count": "35", "adlt": "strict", "qft": "+filterui:photo-photo"})
    try:
        page = fetch("https://www.bing.com/images/async?" + params, limit=4_000_000).decode("utf-8", "replace")
    except Exception as err:
        raise Failure(f"the image search didn't work ({err})")
    results = []
    for raw in re.findall(r'\sm="([^"]+)"', page):
        try:
            data = json.loads(html.unescape(raw))
        except ValueError:
            continue
        if data.get("murl") and data.get("turl"):
            results.append({"url": data["murl"], "thumb": data["turl"], "title": data.get("t") or "", "page": data.get("purl") or ""})
    return results


def thumbnail(candidate):
    try:
        data = fetch(candidate["thumb"], timeout=10)
    except Exception:
        return None
    return data if image_type(data) else None


def full_image(candidate):
    """The full-size image, or Bing's larger thumbnail when the site won't serve it."""
    sources = [candidate["url"], candidate["thumb"].split("&")[0] + "&w=1000&h=1000&c=7&pid=1.7"]
    for url in sources:
        try:
            data = fetch(url, timeout=20)
        except Exception:
            continue
        if len(data) <= MAX_BYTES and image_type(data):
            return data
    return None


def pick(details, images):
    answer = ollama(
        [
            {
                "role": "user",
                "content": "This is an item in an AV / event equipment hire company's inventory:\n\n"
                f"{details}\n\n"
                f"Here are {len(images)} photos from a web image search, numbered 1 to {len(images)} in the order given. "
                "Pick the one that best shows exactly this item as a product photo: the right make and model, the whole "
                "item clearly visible, ideally on a plain background, no people, no heavy text, watermarks or collages. "
                "If none of them shows this item, answer 0. Reply as JSON: "
                '{"best": <number>, "reason": "<one short sentence>"}',
                "images": [base64.b64encode(data).decode() for data in images],
            }
        ]
    )
    try:
        best = int(answer.get("best") or 0)
    except (TypeError, ValueError):
        best = 0
    return best, str(answer.get("reason") or "")[:300]


def main(input_path, output_base):
    with open(input_path, encoding="utf-8") as fh:
        item = json.load(fh)
    if not str(item.get("name") or "").strip():
        raise Failure("the item needs a name to search for")
    details = describe(item)
    query = search_query(item, details)
    results = search_images(query)
    if not results and query != item["name"]:
        query = item["name"]
        results = search_images(query)
    if not results:
        raise Failure(f'no images found online for "{query}"')

    with ThreadPoolExecutor(max_workers=CANDIDATES) as pool:
        thumbs = list(pool.map(thumbnail, results[: CANDIDATES + 4]))
    candidates = [(c, t) for c, t in zip(results, thumbs) if t][:CANDIDATES]
    if not candidates:
        raise Failure("couldn't download any of the images found")

    best, reason = pick(details, [t for _, t in candidates])
    if not 1 <= best <= len(candidates):
        raise Failure(f'the AI model didn\'t think any of the images found for "{query}" show this item' + (f" ({reason})" if reason else ""))

    # The chosen one first, then the rest in search order if it won't download.
    order = [candidates[best - 1]] + [c for i, c in enumerate(candidates) if i != best - 1]
    for candidate, _ in order:
        data = full_image(candidate)
        if data:
            path = f"{output_base}.{image_type(data)}"
            with open(path, "wb") as fh:
                fh.write(data)
            print(json.dumps({"file": path, "query": query, "source": candidate["page"] or candidate["url"], "title": candidate["title"], "reason": reason}))
            return
    raise Failure("couldn't download the chosen image")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: r2_find_photo.py <input.json> <output-base>")
    try:
        main(sys.argv[1], sys.argv[2])
    except Exception as err:
        with open(sys.argv[2] + ".err", "w", encoding="utf-8") as fh:
            fh.write(str(err) if isinstance(err, Failure) else f"unexpected error: {err}")
        sys.exit(1)
