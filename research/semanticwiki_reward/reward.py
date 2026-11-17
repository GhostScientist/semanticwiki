"""Verifiable page reward, mirroring src/eval/{citations,structure,reward}.ts line for line.

Keep this file free of ML dependencies: it runs inside reward workers and CI.
"""
from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence

REWARD_VERSION = 1

WEIGHTS = {
    "validity": 0.25,
    "grounding": 0.15,
    "precision": 0.15,
    "support": 0.20,
    "density": 0.10,
    "structure": 0.10,
    "diagrams": 0.05,
}

# --- citations.ts -------------------------------------------------------------------------

_PATH = r"(?<![\w./\-:@])((?:\.{0,2}/)?[\w@][\w./\-]*\.[A-Za-z0-9]{1,6})"
CITE_COLON = re.compile(_PATH + r"`?:(\d+)(?:\s*[-–]\s*L?(\d+))?")
CITE_ANCHOR = re.compile(_PATH + r"`?#L(\d+)(?:\s*[-–]\s*L?(\d+))?")
CITE_PROSE = re.compile(_PATH + r"`?\s+lines?\s+(\d+)(?:\s*[-–]\s*(\d+))?", re.IGNORECASE)
MARKDOWN_LINK = re.compile(r"\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
LOOKS_CITED = re.compile(_PATH + r"(?::\d+|#L\d+|\s+lines?\s+\d+)", re.IGNORECASE)
_SCHEME = re.compile(r"^[a-z][a-z\d+.-]*:", re.IGNORECASE)
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")

STOPWORDS = set("""the and for that this with from are was were has have its into then when which each uses use used via can not but all any one two also only see how what where while after before their there these those than such both over under between through returns return function method class file files line lines code module object value values type types data default defined defines calls call called provides provide handles handle contains implementation implements source sources component components system main new set get will does did being been other first last more most some same like just also here they them our your""".split())


def round3(value: float) -> float:
    """JavaScript Math.round(x * 1000) / 1000 (half away from zero for positives)."""
    return math.floor(value * 1000 + 0.5) / 1000


def mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def normalize_citation_path(file: str) -> str:
    file = file.replace("\\", "/")
    while file.startswith("./"):
        file = file[2:]
    return file.lstrip("/")


def strip_fences(markdown: str) -> str:
    out = []
    fence: Optional[tuple] = None
    for line in markdown.split("\n"):
        marker = _FENCE.match(line)
        if marker:
            if fence is None:
                fence = (marker.group(1)[0], len(marker.group(1)))
            elif marker.group(1)[0] == fence[0] and len(marker.group(1)) >= fence[1]:
                fence = None
            out.append("")
            continue
        out.append("" if fence else line)
    return "\n".join(out)


def _claim_around(line: str, raw: str) -> str:
    index = line.find(raw)
    before = "" if index < 0 else line[:index]
    after = line if index < 0 else line[index + len(raw):]
    sentence_start = max(before.rfind(". "), before.rfind("; "))
    end_match = re.search(r"[.;](\s|$)", after)
    sentence = before[0 if sentence_start < 0 else sentence_start + 2:] + raw + (after[: end_match.start() + 1] if end_match else after)
    sentence = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", sentence)
    sentence = re.sub(r"[*_>#|]", " ", sentence)
    sentence = re.sub(r"\s+", " ", sentence).strip()
    return sentence[:600]


def unwrap_citation_links(line: str) -> str:
    def repl(match: re.Match) -> str:
        text, target = match.group(1), match.group(2)
        if LOOKS_CITED.search(text):
            return text
        if LOOKS_CITED.search(target) and not _SCHEME.match(target):
            return re.sub(r"^(\.\.?/)+", "", target)
        return text
    return MARKDOWN_LINK.sub(repl, line)


@dataclass
class Citation:
    raw: str
    file: str
    start: int
    end: int
    page_line: int
    claim: str


def extract_citations(markdown: str) -> List[Citation]:
    citations: List[Citation] = []
    for index, raw_line in enumerate(strip_fences(markdown).split("\n")):
        if not raw_line.strip():
            continue
        line = unwrap_citation_links(raw_line)
        found = []
        for pattern in (CITE_ANCHOR, CITE_COLON, CITE_PROSE):
            for match in pattern.finditer(line):
                raw_path = match.group(1)
                if re.fullmatch(r"\d+(\.\d+)+", raw_path):
                    continue
                start = int(match.group(2))
                end = int(match.group(3)) if match.group(3) else start
                if start < 1:
                    continue
                found.append((match.start(), match.end(), Citation(
                    raw=match.group(0), file=normalize_citation_path(raw_path), start=start, end=max(end, start),
                    page_line=index + 1, claim=_claim_around(line, match.group(0)))))
        found.sort(key=lambda item: (item[0], -item[1]))
        cursor = -1
        for start_at, end_at, citation in found:
            if start_at < cursor:
                continue
            cursor = end_at
            citations.append(citation)
    return citations


_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]{2,}")
_IDENT_SHORT = re.compile(r"[A-Za-z_][A-Za-z0-9_]{1,}")


def identifier_tokens(text: str, strict: bool = False) -> set:
    tokens = set()
    if strict:
        for match in re.finditer(r"`([^`]+)`", text):
            for token in _IDENT_SHORT.finditer(match.group(1)):
                if token.group(0).lower() not in STOPWORDS:
                    tokens.add(token.group(0).lower())
    for match in _IDENT.finditer(re.sub(r"`[^`]*`", " ", text)):
        token = match.group(0)
        if token.lower() in STOPWORDS:
            continue
        if strict and not (re.search(r"[a-z][A-Z]", token) or "_" in token or re.search(r"\d", token) or re.match(r"^[A-Z]{2,}", token)):
            continue
        tokens.add(token.lower())
    return tokens


_CITATION_IN_CLAIM = re.compile(r"(?:[\w@][\w.\-]*/[\w./\-]*|[\w@][\w./\-]*\.[A-Za-z0-9]{1,6}:\d+(?:-\d+)?)(?::\d+(?:-\d+)?)?")


def claim_support_score(claim: str, cited_lines: Sequence[str]) -> Optional[float]:
    claim_tokens = identifier_tokens(_CITATION_IN_CLAIM.sub(" ", claim), strict=True)
    if not claim_tokens:
        return None
    span_tokens = identifier_tokens("\n".join(cited_lines))
    hits = sum(1 for token in claim_tokens if token in span_tokens)
    return round3(hits / len(claim_tokens))


class InMemoryRepository:
    def __init__(self, files: Dict[str, str]):
        self.files = files

    def read_lines(self, file: str) -> Optional[List[str]]:
        return self.files[file].split("\n") if file in self.files else None


class FilesystemRepository:
    """Reads repository files; refuses paths that escape the root (including via symlinks)."""

    def __init__(self, root: str):
        self.root = os.path.realpath(root)
        self._cache: Dict[str, Optional[List[str]]] = {}

    def read_lines(self, file: str) -> Optional[List[str]]:
        if file in self._cache:
            return self._cache[file]
        lines: Optional[List[str]] = None
        if "\0" not in file:
            resolved = os.path.realpath(os.path.join(self.root, file))
            if (resolved == self.root or resolved.startswith(self.root + os.sep)) and os.path.isfile(resolved):
                with open(resolved, "r", encoding="utf-8", errors="replace") as handle:
                    lines = handle.read().replace("\r\n", "\n").split("\n")
        self._cache[file] = lines
        return lines


@dataclass
class VerifiedCitation(Citation):
    status: str = "valid"
    in_context: bool = True
    span_in_context: bool = True
    span_lines: int = 1
    file_lines: int = 0
    claim_support: Optional[float] = None


def verify_citations(citations: Iterable[Citation], repository, context: Optional[Sequence[dict]] = None) -> List[VerifiedCitation]:
    context_files = {normalize_citation_path(span["file"]) for span in context} if context is not None else None
    verified = []
    for citation in citations:
        lines = repository.read_lines(citation.file)
        item = VerifiedCitation(
            **citation.__dict__,
            in_context=(citation.file in context_files) if context_files is not None else True,
            span_in_context=any(normalize_citation_path(span["file"]) == citation.file and citation.start <= span["end"] and citation.end >= span["start"] for span in context) if context is not None else True,
            span_lines=citation.end - citation.start + 1,
            file_lines=len(lines) if lines is not None else 0,
        )
        if ".." in citation.file.split("/"):
            item.status = "outside-repository"
        elif lines is None:
            item.status = "file-not-found"
        else:
            file_lines = len(lines) - 1 if lines and lines[-1] == "" else len(lines)
            item.file_lines = file_lines
            if citation.start > file_lines or citation.end > file_lines:
                item.status = "line-out-of-bounds"
            else:
                span = lines[citation.start - 1: citation.end]
                if all(not line.strip() for line in span):
                    item.status = "empty-cited-lines"
                else:
                    item.status = "valid"
                    item.claim_support = claim_support_score(citation.claim, span)
        verified.append(item)
    return verified


# --- structure.ts --------------------------------------------------------------------------

_HEADING = re.compile(r"^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$")
STUB_PATTERNS = [re.compile(r"\b(?:TODO|TBD|FIXME)\b"), re.compile(r"\(?\.\.\.\s*truncated\)?", re.IGNORECASE),
                 re.compile(r"lorem ipsum", re.IGNORECASE), re.compile(r"\[(?:insert|placeholder)[^\]]*\]", re.IGNORECASE)]


def _headings(markdown: str) -> List[int]:
    levels = []
    fence = None
    for line in markdown.split("\n"):
        marker = _FENCE.match(line)
        if marker:
            if fence is None:
                fence = (marker.group(1)[0], len(marker.group(1)))
            elif marker.group(1)[0] == fence[0] and len(marker.group(1)) >= fence[1]:
                fence = None
            continue
        if fence:
            continue
        match = _HEADING.match(line)
        if match:
            levels.append(len(match.group(1)))
    return levels


def word_count(markdown: str) -> int:
    return len([token for token in re.split(r"\s+", markdown) if token])


def check_structure(markdown: str) -> dict:
    levels = _headings(markdown)
    words = word_count(markdown)
    h1 = sum(1 for level in levels if level == 1)
    fence_markers = sum(1 for line in markdown.split("\n") if _FENCE.match(line))
    checks = {
        "has_h1": h1 >= 1,
        "single_h1": h1 == 1,
        "has_h2": any(level == 2 for level in levels),
        "fences_closed": fence_markers % 2 == 0,
        "no_stub_markers": not any(pattern.search(markdown) for pattern in STUB_PATTERNS),
        "word_count_ok": 150 <= words <= 5000,
    }
    return {"words": words, "checks": checks, "passed": sum(checks.values()), "total": len(checks)}


DIAGRAM_TYPES = re.compile(r"^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta)\b")


def _brackets_balanced(body: str) -> Optional[str]:
    pairs = {"[": "]", "(": ")", "{": "}"}
    closers = set(pairs.values())
    stack: List[str] = []
    for line in body.split("\n"):
        if line.strip().startswith("%%"):
            continue
        quote = None
        for char in line:
            if quote:
                if char == quote:
                    quote = None
                continue
            if char == '"':
                quote = char
                continue
            if char in pairs:
                stack.append(pairs[char])
            elif char in closers:
                if not stack or stack.pop() != char:
                    return f'unexpected "{char}"'
    return f'unclosed "{stack[-1]}"' if stack else None


def check_mermaid_source(source: str) -> dict:
    lines = [line.strip() for line in source.split("\n") if line.strip() and not line.strip().startswith("%%")]
    if not lines:
        return {"type": "unknown", "valid": False, "reason": "empty diagram"}
    header = re.sub(r"^---[\s\S]*?---\s*", "", lines[0])
    type_match = DIAGRAM_TYPES.match(header)
    if not type_match:
        return {"type": "unknown", "valid": False, "reason": f'unknown diagram type "{header[:30]}"'}
    kind = type_match.group(1)
    if len(lines) < 2:
        return {"type": kind, "valid": False, "reason": "diagram has no body"}
    body = "\n".join(lines[1:])
    if kind in ("graph", "flowchart"):
        direction = header[len(kind):].strip()
        if direction and not re.match(r"^(TD|TB|BT|LR|RL)\b", direction):
            return {"type": kind, "valid": False, "reason": f'invalid direction "{direction}"'}
        opened = len(re.findall(r"^\s*subgraph\b", body, re.M))
        closed = len(re.findall(r"^\s*end\b", body, re.M))
        if opened != closed:
            return {"type": kind, "valid": False, "reason": f"subgraph/end mismatch ({opened}/{closed})"}
        if not re.search(r"-->|---|-\.->|==>|--[^-]*-->|-->\|", body) and not re.search(r"^\s*[\w\"]+(\[|\(|\{)", body, re.M):
            return {"type": kind, "valid": False, "reason": "no nodes or edges"}
    if kind == "sequenceDiagram" and not re.search(r"(-->>|->>|-->|->|-x|--x|-\)|--\))", body):
        return {"type": kind, "valid": False, "reason": "no messages"}
    if kind in ("graph", "flowchart", "classDiagram", "stateDiagram", "stateDiagram-v2", "erDiagram"):
        reason = _brackets_balanced(body)
        if reason:
            return {"type": kind, "valid": False, "reason": reason}
    return {"type": kind, "valid": True}


def check_diagrams(markdown: str) -> dict:
    details = []
    lines = markdown.split("\n")
    index = 0
    while index < len(lines):
        open_match = re.match(r"^ {0,3}(`{3,}|~{3,})\s*mermaid\b", lines[index], re.IGNORECASE)
        if not open_match:
            index += 1
            continue
        start = index + 1
        end = start
        closer = open_match.group(1)[0] * len(open_match.group(1))
        while end < len(lines) and not lines[end].startswith(closer):
            end += 1
        details.append({"page_line": start, **check_mermaid_source("\n".join(lines[start:end]))})
        index = end + 1
    valid = sum(1 for detail in details if detail["valid"])
    return {"total": len(details), "valid": valid, "invalid": len(details) - valid, "checker": "lightweight", "details": details}


# --- reward.ts -----------------------------------------------------------------------------

def precision_weight(span_lines: int, file_lines: int) -> float:
    if 0 < file_lines <= 80:
        return 1.0
    if file_lines > 0 and span_lines >= file_lines:
        return 0.0
    weight = 1.0 if span_lines <= 40 else max(0.0, 1 - (span_lines - 40) / 360)
    if file_lines > 0 and span_lines / file_lines > 0.5:
        weight = min(weight, 0.25)
    return round3(weight)


def summarize_citations(citations: Sequence[VerifiedCitation]) -> dict:
    statuses: Dict[str, int] = {}
    for citation in citations:
        statuses[citation.status] = statuses.get(citation.status, 0) + 1
    unique = len({f"{c.file}:{c.start}-{c.end}" for c in citations})
    valid = [c for c in citations if c.status == "valid"]
    return {"total": len(citations), "unique": unique, "valid": len(valid),
            "validInContext": sum(1 for c in valid if c.in_context), "statuses": statuses}


@dataclass
class PageScore:
    reward_version: int
    citations: dict
    components: Dict[str, float]
    base: float
    guards: List[dict]
    reward: float
    structure: dict
    diagrams: dict
    guard_names: List[str] = field(default_factory=list)


def score_page(markdown: str, citations: Sequence[VerifiedCitation], stop_reason: Optional[str] = None) -> PageScore:
    structure = check_structure(markdown)
    diagrams = check_diagrams(markdown)
    summary = summarize_citations(citations)
    valid = [c for c in citations if c.status == "valid"]
    supported = [c for c in valid if c.claim_support is not None]
    expected = max(3, math.floor(structure["words"] / 150 + 0.5))
    components = {
        "validity": round3(summary["valid"] / summary["total"]) if summary["total"] else 0.0,
        "grounding": round3(summary["validInContext"] / summary["total"]) if summary["total"] else 0.0,
        "precision": round3(mean([precision_weight(c.span_lines, c.file_lines) for c in valid])),
        "support": round3(mean([c.claim_support for c in supported])),
        "density": round3(min(1.0, summary["unique"] / expected)),
        "structure": round3(structure["passed"] / structure["total"]),
        "diagrams": 0.5 if diagrams["total"] == 0 else round3(diagrams["valid"] / diagrams["total"]),
    }
    base = round3(sum(WEIGHTS[key] * components[key] for key in WEIGHTS))
    guards: List[dict] = []
    reward = base
    if stop_reason and stop_reason != "end_turn":
        guards.append({"name": "truncated", "effect": "zero", "value": 0, "reason": f"stop reason {stop_reason}"})
        reward = 0.0
    if summary["total"] == 0:
        guards.append({"name": "uncited", "effect": "multiply", "value": 0.25, "reason": "page makes no verifiable claims"})
        reward *= 0.25
    else:
        missing = summary["statuses"].get("file-not-found", 0) + summary["statuses"].get("outside-repository", 0)
        if missing / summary["total"] >= 0.5:
            guards.append({"name": "hallucinated-paths", "effect": "cap", "value": 0.3, "reason": f"{missing}/{summary['total']} citations name files that do not exist"})
            reward = min(reward, 0.3)
        if summary["unique"] / summary["total"] < 0.5:
            guards.append({"name": "duplicate-citations", "effect": "multiply", "value": 0.5, "reason": f"{summary['unique']} unique of {summary['total']} citations"})
            reward *= 0.5
    return PageScore(REWARD_VERSION, summary, components, base, guards, round3(reward), structure, diagrams, [g["name"] for g in guards])


def score_markdown(markdown: str, repository, context: Optional[Sequence[dict]] = None, stop_reason: Optional[str] = None) -> PageScore:
    """Convenience: extract, verify and score in one call."""
    return score_page(markdown, verify_citations(extract_citations(markdown), repository, context), stop_reason)
