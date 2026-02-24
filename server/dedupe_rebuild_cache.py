#!/usr/bin/env python3
"""
dedupe_cache_pressplay.py  —  ONE FILE TO FIX IT

Drop this file in your PROJECT ROOT (same level as `cache/`) and press Run in your IDE.

What it does (apply mode by default):
  1) ./cache/articles  (RECURSIVE)
       - Group by *normalized title*
       - KEEP newest by `cached_at` (tie-break by file mtime)
       - MOVE losers → ./cache/articles/_dupes_<ts>/
       - JSON REPAIR: unreadable files are repaired if possible and rewritten (with a .bak). If unrepairable → move to ./cache/articles/_corrupt_<ts>/ (or delete if flag set)

  2) ./cache/relevance and ./cache/analysis  (NON-RECURSIVE)
       - Inside each JSON map, collapse duplicates by normalized title (keep newest `cached_at`)
       - JSON REPAIR: unreadable files repaired & rewritten (with a .bak). If unrepairable → move to ./cache/<dir>/_corrupt_<ts>/ (or delete if flag set)
       - Writes are **ASCII-safe** (ensure_ascii=True) to avoid Windows “charmap” decode errors elsewhere
       - After dedupe/repair, **every** map file is re-saved ASCII-safe (with a .bak) to normalize encoding

No external report file — just logs.
"""

# ------------------- CONFIG -------------------
APPLY_CHANGES = True           # True = apply changes, False = dry run
DELETE_CORRUPT = True         # True = hard-delete unrepairable files; False = move to _corrupt_<ts>/
QUIET = False                  # True = fewer logs
AGGRESSIVE_TITLE_NORMALIZATION = True
PROGRESS_EVERY = 1000          # log progress every N files in articles
# ----------------------------------------------

import os
import re
import json
import shutil
import unicodedata
from datetime import datetime
from collections import defaultdict
from html import unescape
from typing import Optional, Tuple, Dict, Any

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(ROOT_DIR, "cache")
ART_DIR = os.path.join(CACHE_DIR, "articles")
REL_DIR = os.path.join(CACHE_DIR, "relevance")
ANA_DIR = os.path.join(CACHE_DIR, "analysis")

def _ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")

# ---------- Title normalization ----------
_dash_chars = "\u2010\u2011\u2012\u2013\u2014\u2015\u2212"
_quote_singles = "\u2018\u2019\u201B"
_quote_doubles = "\u201C\u201D\u201F"
_zero_width = "\u200B\u200C\u200D\uFEFF"
_nbsp = "\u00A0\u202F"
_ellipsis = "\u2026"

def norm_title_basic(t: str) -> str:
    if not t: return ""
    t = unescape(t)
    t = unicodedata.normalize("NFKC", t).lower()
    t = re.sub(r"\s+", " ", t).strip()
    return t

def norm_title_aggressive(t: str) -> str:
    if not t: return ""
    t = unescape(t)
    t = t.translate({ord(c): " " for c in _nbsp})
    t = t.translate({ord(c): None for c in _zero_width})
    t = unicodedata.normalize("NFKC", t)
    t = t.replace(_ellipsis, "...")
    t = t.translate({ord(c): "-" for c in _dash_chars})
    t = t.translate({ord(c): "'" for c in _quote_singles})
    t = t.translate({ord(c): '"' for c in _quote_doubles})
    t = t.lower()
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode("ascii")
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t

def norm_title(t: str) -> str:
    return norm_title_aggressive(t) if AGGRESSIVE_TITLE_NORMALIZATION else norm_title_basic(t)

# ---------- JSON repair helpers ----------
CTRL_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")  # invalid JSON control chars (except \t \n \r)
TRAILING_COMMA_RE = re.compile(r",\s*([}\]])")         # ", }" or ", ]"
NAN_INF_RE = re.compile(r'\bNaN\b|\bInfinity\b|\b-Infinity\b', re.IGNORECASE)

def _strip_bom(s: str) -> str:
    return s.lstrip("\ufeff")

def _extract_balanced_json(s: str) -> Optional[str]:
    """If extra junk wraps/extends a valid JSON object/array, extract the first balanced one."""
    for opener, closer in (('{', '}'), ('[', ']')):
        start = s.find(opener)
        if start == -1:
            continue
        depth = 0
        for i in range(start, len(s)):
            ch = s[i]
            if ch == opener:
                depth += 1
            elif ch == closer:
                depth -= 1
                if depth == 0:
                    return s[start:i+1]
    return None

def _clean_json_text(s: str) -> str:
    s = _strip_bom(s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = CTRL_RE.sub("", s)
    s = NAN_INF_RE.sub("null", s)
    # cheap trailing comma fixes (run twice)
    for _ in range(2):
        s = TRAILING_COMMA_RE.sub(r"\1", s)
    return s

def _try_loads(s: str) -> Tuple[Optional[Any], Optional[str]]:
    try:
        return json.loads(s), None
    except Exception as e:
        return None, str(e)

def load_json_with_repair(path: str) -> Tuple[Optional[Any], Optional[str], bool]:
    """
    Returns (obj, err, repaired_flag).
    Tries clean fixes if initial load fails. If repaired_flag is True, caller should back up and rewrite.
    """
    # try reading as UTF-8, with robust fallbacks
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except Exception:
        try:
            with open(path, "rb") as fb:
                raw = fb.read()
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                try:
                    text = raw.decode("cp1252")
                except Exception:
                    text = raw.decode("utf-8", errors="replace")
        except Exception as e2:
            return None, f"read-failed: {e2}", False

    obj, err = _try_loads(text)
    if obj is not None:
        return obj, None, False

    repaired_text = _clean_json_text(text)
    obj, err2 = _try_loads(repaired_text)
    if obj is not None:
        return obj, None, True

    candidate = _extract_balanced_json(repaired_text)
    if candidate:
        obj, err3 = _try_loads(candidate)
        if obj is not None:
            return obj, None, True

    last_obj = repaired_text.rfind("}")
    last_arr = repaired_text.rfind("]")
    cut = max(last_obj, last_arr)
    if cut != -1:
        obj, err4 = _try_loads(repaired_text[:cut+1])
        if obj is not None:
            return obj, None, True

    return None, "unrepairable", False

def write_json_ascii(path: str, obj: Any):
    """Write JSON in UTF-8 with ensure_ascii=True to avoid Windows charmap issues elsewhere."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=True)

def backup_file(path: str, ts: str) -> Optional[str]:
    dst = f"{path}.bak_{ts}"
    try:
        shutil.copy2(path, dst)
        return dst
    except Exception as e:
        print(f"[WARN] failed to backup '{path}': {e}")
        return None

def safe_move(src_path: str, dst_dir: str):
    os.makedirs(dst_dir, exist_ok=True)
    base = os.path.basename(src_path)
    name, ext = os.path.splitext(base)
    candidate = os.path.join(dst_dir, base)
    i = 1
    while os.path.exists(candidate):
        candidate = os.path.join(dst_dir, f"{name}__{i}{ext}")
        i += 1
    shutil.move(src_path, candidate)
    return candidate

# ---------- FS iterators ----------
def iter_json_files_recursive(dir_path: str):
    if not os.path.isdir(dir_path): return
    for root, _dirs, files in os.walk(dir_path):
        for name in files:
            if name.endswith(".json"):
                yield os.path.join(root, name)

def iter_json_files(dir_path: str):
    if not os.path.isdir(dir_path): return
    with os.scandir(dir_path) as it:
        for e in it:
            if e.is_file() and e.name.endswith(".json"):
                yield e.path

# ---------- ARTICLES: dedupe by title + repair ----------
def dedupe_articles(art_dir: str, apply: bool, quiet: bool, ts: str) -> Dict[str, int]:
    scanned = 0
    groups: Dict[str, list] = defaultdict(list)   # norm_title -> [(path, obj)]
    corrupt_unfixable = []
    repaired_count = 0

    if not os.path.isdir(art_dir):
        print(f"[ARTICLES] missing dir: {art_dir}")
        return {"scanned":0, "unique_titles":0, "duplicates":0, "moved":0,
                "repaired":0, "corrupt_unfixable":0, "corrupt_moved_or_deleted":0}

    print(f"[ARTICLES] recursive scan: {art_dir}")
    for path in iter_json_files_recursive(art_dir):
        obj, err, repaired = load_json_with_repair(path)
        scanned += 1

        if obj is None:
            corrupt_unfixable.append(path)
        else:
            if repaired and apply:
                if backup_file(path, ts):
                    write_json_ascii(path, obj)
                repaired_count += 1
                if not quiet:
                    print(f"  [REPAIRED] {os.path.basename(path)}")
            title = obj.get("title")
            if not title:
                corrupt_unfixable.append(path)
            else:
                groups[norm_title(title)].append((path, obj))

        if not quiet and scanned % PROGRESS_EVERY == 0:
            print(f"  scanned {scanned:,} files... unique titles={len(groups):,}  repaired={repaired_count:,}  unfixable={len(corrupt_unfixable):,}")

    unique_titles = len(groups)
    losers = []
    keep_map = {}

    def score(item):
        p, o = item
        ca = o.get("cached_at") or 0
        try:
            mt = os.path.getmtime(p)
        except Exception:
            mt = 0
        return (ca, mt)  # newest cached_at, then newest mtime

    for t, items in groups.items():
        if len(items) == 1:
            keep_map[t] = items[0]
            continue
        items_sorted = sorted(items, key=score, reverse=True)
        keep_map[t] = items_sorted[0]
        losers.extend(items_sorted[1:])
        if not quiet:
            kpath, ko = items_sorted[0]
            print(f"  [KEEP] '{ko.get('title')}' -> {os.path.basename(kpath)} (cached_at={ko.get('cached_at')})")
            for lp, lo in items_sorted[1:]:
                print(f"    [DROP] {os.path.basename(lp)} (cached_at={lo.get('cached_at')})")

    print(f"[ARTICLES] total files={scanned:,}  unique titles={unique_titles:,}  dupes={len(losers):,}  repaired={repaired_count:,}  unfixable={len(corrupt_unfixable):,}")

    moved = 0
    if apply and losers:
        dupes_dir = os.path.join(art_dir, f"_dupes_{ts}")
        for p, _o in losers:
            safe_move(p, dupes_dir)
            moved += 1
        print(f"[ARTICLES] moved {moved:,} duplicate files → {dupes_dir}")
    elif losers:
        print(f"[ARTICLES][DRY RUN] would move {len(losers):,} duplicate files into _dupes_{ts}/")

    corrupt_moved_or_deleted = 0
    if apply and corrupt_unfixable:
        if DELETE_CORRUPT:
            for p in corrupt_unfixable:
                try:
                    os.remove(p)
                    corrupt_moved_or_deleted += 1
                except Exception as e:
                    print(f"[WARN] failed to delete corrupt: {p} ({e})")
            print(f"[ARTICLES] deleted {corrupt_moved_or_deleted:,} unrepairable files")
        else:
            corrupt_dir = os.path.join(art_dir, f"_corrupt_{ts}")
            for p in corrupt_unfixable:
                safe_move(p, corrupt_dir)
                corrupt_moved_or_deleted += 1
            print(f"[ARTICLES] moved {corrupt_moved_or_deleted:,} unrepairable files → {corrupt_dir}")
    elif corrupt_unfixable:
        action = "delete" if DELETE_CORRUPT else "move"
        print(f"[ARTICLES][DRY RUN] would {action} {len(corrupt_unfixable):,} unrepairable files")

    return {
        "scanned": scanned,
        "unique_titles": unique_titles,
        "duplicates": len(losers),
        "moved": moved,
        "repaired": repaired_count,
        "corrupt_unfixable": len(corrupt_unfixable),
        "corrupt_moved_or_deleted": corrupt_moved_or_deleted
    }

# ---------- RELEVANCE / ANALYSIS: de-dupe entries per file + repair ----------
def dedupe_map_dir(dir_path: str, apply: bool, quiet: bool, ts: str, label: str) -> Dict[str, int]:
    files = 0
    entries_in = 0
    entries_out = 0
    entries_dropped = 0
    backups = 0
    repaired_count = 0
    corrupt_unfixable = []

    if not os.path.isdir(dir_path):
        print(f"[{label}] missing dir: {dir_path}")
        return dict(files=0, entries_in=0, entries_out=0, entries_dropped=0, backups=0,
                    repaired=0, corrupt_unfixable=0, corrupt_moved_or_deleted=0)

    print(f"[{label}] scan: {dir_path}")
    for path in iter_json_files(dir_path):  # non-recursive
        files += 1
        data, err, repaired = load_json_with_repair(path)
        if data is None:
            corrupt_unfixable.append(path)
            continue

        if repaired and apply:
            if backup_file(path, ts):
                write_json_ascii(path, data)
            repaired_count += 1
            if not quiet:
                print(f"  [REPAIRED] {os.path.basename(path)}")

        if not isinstance(data, dict):
            # not a mapping? treat as bad
            corrupt_unfixable.append(path)
            continue

        entries_in += len(data)

        # Collapse by normalized title, keep newest cached_at; keep the *winning key* as-is
        by_title = {}
        for k, v in data.items():
            title_n = norm_title((v or {}).get("title"))
            ca = (v or {}).get("cached_at") or 0
            prev = by_title.get(title_n)
            if (not prev) or (ca > (prev[1] or 0)):
                by_title[title_n] = (k, ca, v)

        out = {k: v for (k, _, v) in by_title.values()}
        dropped = len(data) - len(out)
        entries_out += len(out)
        entries_dropped += dropped

        if dropped and not quiet:
            print(f"  {os.path.basename(path)}: dropped {dropped} duplicate entries")

        if apply and dropped:
            if backup_file(path, ts):
                backups += 1
            write_json_ascii(path, out)

    # Unrepairable handling
    corrupt_moved_or_deleted = 0
    if apply and corrupt_unfixable:
        if DELETE_CORRUPT:
            for p in corrupt_unfixable:
                try:
                    os.remove(p)
                    corrupt_moved_or_deleted += 1
                except Exception as e:
                    print(f"[WARN] failed to delete corrupt: {p} ({e})")
            print(f"[{label}] deleted {corrupt_moved_or_deleted:,} unrepairable files")
        else:
            corrupt_dir = os.path.join(dir_path, f"_corrupt_{ts}")
            for p in corrupt_unfixable:
                safe_move(p, corrupt_dir)
                corrupt_moved_or_deleted += 1
            print(f"[{label}] moved {corrupt_moved_or_deleted:,} unrepairable files → {corrupt_dir}")
    elif corrupt_unfixable:
        action = "delete" if DELETE_CORRUPT else "move"
        print(f"[{label}][DRY RUN] would {action} {len(corrupt_unfixable):,} unrepairable files")

    print(f"[{label}] files={files:,}  in={entries_in:,}  out={entries_out:,}  dropped={entries_dropped:,}  backups={backups:,}  repaired={repaired_count:,}")
    return dict(files=files, entries_in=entries_in, entries_out=entries_out,
                entries_dropped=entries_dropped, backups=backups,
                repaired=repaired_count, corrupt_unfixable=len(corrupt_unfixable),
                corrupt_moved_or_deleted=corrupt_moved_or_deleted)

# ---------- ASCII-RESAVE ALL MAPS (fixes charmap issues system-wide) ----------
def force_ascii_maps(ts: str):
    """Read + repair then re-save EVERY file in relevance/ and analysis/ using ASCII-safe JSON (with .bak)."""
    for dir_path, label in [(REL_DIR, "RELEVANCE"), (ANA_DIR, "ANALYSIS")]:
        if not os.path.isdir(dir_path):
            print(f"[{label}] missing dir: {dir_path}")
            continue
        changed = 0
        for name in os.listdir(dir_path):
            if not name.endswith(".json"):
                continue
            path = os.path.join(dir_path, name)
            data, err, repaired = load_json_with_repair(path)
            if data is None:
                continue  # handled by the main pass
            # always back up, then write ASCII-safe to prevent Windows charmap errors
            if backup_file(path, ts):
                pass
            write_json_ascii(path, data)
            changed += 1
        print(f"[{label}] ASCII-safe rewrite complete: {changed} files")

# ---------- MAIN ----------
def main():
    print(f"[START] cache root: {CACHE_DIR}")
    if not os.path.isdir(CACHE_DIR):
        print(f"[FATAL] cache dir not found: {CACHE_DIR}")
        return
    ts = _ts()
    print(f"[MODE] {'APPLY' if APPLY_CHANGES else 'DRY RUN'}  |  quiet={QUIET}  |  aggressive_norm={AGGRESSIVE_TITLE_NORMALIZATION}  |  delete_corrupt={DELETE_CORRUPT}")

    art_stats = dedupe_articles(ART_DIR, APPLY_CHANGES, QUIET, ts)
    rel_stats = dedupe_map_dir(REL_DIR, APPLY_CHANGES, QUIET, ts, label="RELEVANCE")
    ana_stats = dedupe_map_dir(ANA_DIR, APPLY_CHANGES, QUIET, ts, label="ANALYSIS")

    # Ensure every map file is ASCII-safe (prevents charmap decode errors in downstream scripts)
    if APPLY_CHANGES:
        force_ascii_maps(ts)

    print("[SUMMARY] "
          f"ARTICLES: files={art_stats['scanned']:,}, unique={art_stats['unique_titles']:,}, "
          f"dupes_moved={art_stats['moved']:,}, repaired={art_stats['repaired']:,}, "
          f"unfixable={art_stats['corrupt_unfixable']:,}  |  "
          f"RELEVANCE: files={rel_stats['files']:,}, dropped={rel_stats['entries_dropped']:,}, backups={rel_stats['backups']:,}, repaired={rel_stats['repaired']:,}  |  "
          f"ANALYSIS: files={ana_stats['files']:,}, dropped={ana_stats['entries_dropped']:,}, backups={ana_stats['backups']:,}, repaired={ana_stats['repaired']:,}")
    print("[DONE]")

if __name__ == "__main__":
    main()
