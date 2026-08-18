#!/usr/bin/env python3
"""
generate_audio.py — TTS narration for every iceboks.site post.

For each posts/*.html:
  1. Extract readable narration (title, subtitle, headings, prose, pull-quotes;
     skips nav, code blocks, tables, scripts).
  2. Synthesize speech via the local Kokoro-FastAPI server (OpenAI-compatible),
     chunked and stitched with ffmpeg into posts/audio/<slug>.mp3.
  3. Inject a styled audio player into the post (idempotent — marker-guarded).

Idempotent: existing audio is skipped unless --force. Player injection is
guarded by an HTML marker so re-runs don't duplicate it.

Usage:
    python3 scripts/generate_audio.py                  # all posts
    python3 scripts/generate_audio.py thought-archaeology   # one slug
    python3 scripts/generate_audio.py --force          # regenerate audio
    KOKORO_VOICE=am_michael python3 scripts/generate_audio.py

Config via env:
    KOKORO_URL   (default http://localhost:8880)
    KOKORO_VOICE (default af_heart)
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
POSTS = ROOT / "posts"
AUDIO = POSTS / "audio"

KOKORO_URL = os.environ.get("KOKORO_URL", "http://localhost:8880")
VOICE = os.environ.get("KOKORO_VOICE", "af_heart")
MODEL = "kokoro"
# 900, not 1600: the Kokoro pod is the CPU image capped at 4Gi, and 1600-char
# chunks OOMKilled it (exit 137) partway through a batch. Smaller requests keep
# peak memory down and shorten each connection over the port-forward.
CHUNK_CHARS = 900
CHUNK_PAUSE = 2      # seconds between chunks, to let the pod release memory
RETRIES = 6          # attempts per chunk before giving up on the post
RETRY_BACKOFF = 5    # seconds, doubled each attempt (capped at 60)

MARKER = "<!-- post-audio -->"

# Posts with no prose body (interactive/demo pages) — nothing to narrate.
SKIP = {"tom-horigachi-interface"}


# ── text extraction ──────────────────────────────────────────────────────────
def extract_narration(html: str) -> tuple[str, str]:
    """Return (title, narration_text) from a post's HTML."""
    soup = BeautifulSoup(html, "html.parser")

    raw_title = (soup.title.string if soup.title else "") or ""
    title = re.sub(r"\s*[—\-|]\s*iceboks\s*$", "", raw_title).strip()

    # Strip everything that shouldn't be read aloud.
    for tag in soup(["script", "style", "canvas", "nav", "pre", "code", "table"]):
        tag.decompose()
    for sel in (".chapter-nav", ".mobile-nav", ".mobile-nav-toggle", ".back-link",
                ".hero-scroll", ".hero-byline", ".code-block", ".code-block-header",
                ".stats-table", ".post-audio", "figcaption", ".card-meta"):
        for el in soup.select(sel):
            el.decompose()

    parts: list[str] = []
    if title:
        parts.append(title + ".")

    sub = soup.select_one(".hero-subtitle")
    if sub:
        parts.append(_clean(sub.get_text(" ", strip=True)))

    container = soup.select_one("main.content") or soup.body or soup
    seen: set[int] = set()
    for el in container.select("h1, h2, h3, h4, p, li, blockquote, .pull-quote"):
        # avoid double-counting nested matches
        if any(id(a) in seen for a in el.parents):
            continue
        seen.add(id(el))
        txt = _clean(el.get_text(" ", strip=True))
        if len(txt) >= 2:
            parts.append(txt)

    # de-dupe consecutive repeats (subtitle sometimes echoes a heading)
    out: list[str] = []
    for p in parts:
        if not out or out[-1] != p:
            out.append(p)
    return title, "\n".join(out)


def _clean(s: str) -> str:
    s = s.replace("—", ", ").replace("–", "-").replace("&", "and")
    s = re.sub(r"\s+", " ", s).strip()
    # ensure sentence-ish termination so chunks flow
    if s and s[-1] not in ".!?:,;":
        s += "."
    return s


def chunk_text(text: str, limit: int = CHUNK_CHARS) -> list[str]:
    chunks: list[str] = []
    cur = ""
    for line in text.split("\n"):
        if len(cur) + len(line) + 1 > limit and cur:
            chunks.append(cur.strip())
            cur = ""
        cur += (" " if cur else "") + line
    if cur.strip():
        chunks.append(cur.strip())
    return chunks


# ── synthesis ────────────────────────────────────────────────────────────────
def synth_chunk(client: httpx.Client, text: str, out: Path) -> None:
    """Synthesize one chunk, retrying through tunnel drops.

    Kokoro is reached over a kubectl port-forward across ZeroTier, which dies
    mid-stream often enough that a long run will not finish without retries
    (httpx raises RemoteProtocolError on the truncated body). systemd restarts
    the forward within seconds, so backing off and retrying rides through it.
    """
    last: Exception | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            r = client.post(
                f"{KOKORO_URL}/v1/audio/speech",
                json={"model": MODEL, "voice": VOICE, "input": text,
                      "response_format": "mp3"},
                timeout=600.0,
            )
            r.raise_for_status()
            if not r.content:
                raise RuntimeError("empty audio body")
            out.write_bytes(r.content)
            return
        except (httpx.HTTPError, RuntimeError) as e:
            last = e
            if attempt == RETRIES:
                break
            wait = min(RETRY_BACKOFF * 2 ** (attempt - 1), 60)
            print(f"      retry {attempt}/{RETRIES - 1} in {wait}s "
                  f"({type(e).__name__})")
            time.sleep(wait)
    raise RuntimeError(f"chunk failed after {RETRIES} attempts: {last}")


def stitch(parts: list[Path], dest: Path) -> None:
    if len(parts) == 1:
        dest.write_bytes(parts[0].read_bytes())
        return
    listfile = dest.with_suffix(".txt")
    listfile.write_text("".join(f"file '{p}'\n" for p in parts))
    # Re-encode rather than "-c copy": some Kokoro builds (e.g. the GPU
    # fastapi v0.2.2 image) emit mp3 frames that stream-copy concatenation
    # corrupts at the chunk boundaries ("Header missing" on decode). Decoding
    # to PCM and re-encoding once with lame produces a clean, seamless file.
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listfile),
         "-c:a", "libmp3lame", "-b:a", "128k", str(dest)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    listfile.unlink(missing_ok=True)


def make_audio(slug: str, text: str, force: bool) -> Path | None:
    dest = AUDIO / f"{slug}.mp3"
    if dest.exists() and not force:
        print(f"  audio exists, skipping ({dest.name}); use --force to regen")
        return dest
    chunks = chunk_text(text)
    # Chunks land in a cache dir rather than a temp dir: synthesis is slow
    # enough (minutes per chunk) that a mid-run failure should not throw away
    # the chunks already done. Cleared only once the post is stitched.
    cache = AUDIO / ".cache" / slug
    cache.mkdir(parents=True, exist_ok=True)
    print(f"  synthesizing {len(chunks)} chunk(s), voice={VOICE} ...")
    with httpx.Client() as client:
        parts = []
        for i, ch in enumerate(chunks):
            p = cache / f"{i:03d}.mp3"
            if p.exists() and p.stat().st_size > 0:
                print(f"    chunk {i + 1}/{len(chunks)} cached")
            else:
                synth_chunk(client, ch, p)
                print(f"    chunk {i + 1}/{len(chunks)} ({len(ch)} chars) ok",
                      flush=True)
                time.sleep(CHUNK_PAUSE)
            parts.append(p)
        stitch(parts, dest)
    shutil.rmtree(cache, ignore_errors=True)
    return dest


# ── player injection ─────────────────────────────────────────────────────────
def player_html(slug: str) -> str:
    return (
        f'{MARKER}\n'
        f'<div class="post-audio">\n'
        f'  <span class="pa-icon">🎧</span>\n'
        f'  <div class="pa-meta">\n'
        f'    <span class="pa-label">Listen</span>\n'
        f'    <span class="pa-sub">narrated · Kokoro TTS</span>\n'
        f'  </div>\n'
        f'  <audio controls preload="none" src="audio/{slug}.mp3"></audio>\n'
        f'</div>\n'
    )


def inject_player(path: Path, slug: str) -> bool:
    html = path.read_text()
    if MARKER in html:
        return False  # already has a player
    block = player_html(slug)
    # Prefer to place it right after the hero section.
    m = re.search(r"</section>", html)
    main_m = re.search(r'<main\b', html)
    if main_m:
        idx = main_m.start()
        new = html[:idx] + block + "\n" + html[idx:]
    elif m:
        idx = m.end()
        new = html[:idx] + "\n" + block + html[idx:]
    else:
        new = html.replace("<body>", "<body>\n" + block, 1)
    path.write_text(new)
    return True


# ── driver ───────────────────────────────────────────────────────────────────
def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    force = "--force" in sys.argv
    AUDIO.mkdir(parents=True, exist_ok=True)

    posts = sorted(POSTS.glob("*.html"))
    if args:
        wanted = set(args)
        posts = [p for p in posts if p.stem in wanted]
    failed: list[str] = []

    for path in posts:
        slug = path.stem
        if slug in SKIP:
            print(f"[{slug}] skipped (no prose body)")
            continue
        print(f"[{slug}]")
        title, text = extract_narration(path.read_text())
        words = len(text.split())
        if words < 20:
            print(f"  too little text ({words} words) — skipping")
            continue
        print(f"  {words} words")
        try:
            make_audio(slug, text, force)
        except Exception as e:
            # Keep going: cached chunks survive, so a re-run resumes this post.
            print(f"  FAILED: {e}")
            failed.append(slug)
            continue
        injected = inject_player(path, slug)
        print(f"  player {'injected' if injected else 'already present'}")
    if failed:
        print(f"done, with {len(failed)} failed: {', '.join(failed)}")
        sys.exit(1)
    print("done.")


if __name__ == "__main__":
    main()
