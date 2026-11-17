"""Repository snapshots for training and evaluation: local directories or GitHub tarballs."""
from __future__ import annotations

import json
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path
from typing import Iterable, List, Optional

from .evidence import RepositorySnapshot, index_repository


def harvest(org: str, name: str, dest: Path, ref: str = "HEAD") -> Path:
    """Download org/name at ref from codeload (no API quota) into dest/org__name."""
    root = dest / f"{org}__{name}"
    if root.exists():
        return root
    dest.mkdir(parents=True, exist_ok=True)
    url = f"https://codeload.github.com/{org}/{name}/tar.gz/{ref}"
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "repo.tar.gz"
        urllib.request.urlretrieve(url, archive)
        with tarfile.open(archive, "r:gz") as tar:
            try:
                tar.extractall(tmp, filter="data")
            except TypeError:
                tar.extractall(tmp)
        entries = [entry for entry in Path(tmp).iterdir() if entry.is_dir()]
        if len(entries) != 1:
            raise RuntimeError(f"unexpected tarball layout for {org}/{name}")
        shutil.move(str(entries[0]), str(root))
    return root


def load_repo_list(path: str) -> List[dict]:
    """Accepts eval_repo_list.json / repo_registry.json ([{org,name,...}]) or a plain list of org/name strings."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    specs = []
    for item in data:
        if isinstance(item, str):
            org, name = item.split("/")
            specs.append({"org": org, "name": name})
        else:
            specs.append(item)
    return specs


def iter_snapshots(repos_dir: Optional[str], repo_list: Optional[str], harvest_missing: bool, limit: Optional[int] = None) -> Iterable[RepositorySnapshot]:
    """Yield indexed snapshots from a directory of checkouts and/or a pinned repo list."""
    count = 0
    seen = set()
    if repo_list:
        for spec in load_repo_list(repo_list):
            slug = f"{spec['org']}__{spec['name']}"
            root = Path(repos_dir or "snapshots") / slug
            if not root.exists():
                if not harvest_missing:
                    continue
                harvest(spec["org"], spec["name"], Path(repos_dir or "snapshots"))
            seen.add(slug)
            snapshot = index_repository(str(root), f"{spec['org']}/{spec['name']}")
            if snapshot.files:
                yield snapshot
                count += 1
            if limit and count >= limit:
                return
    if repos_dir and not repo_list:
        for root in sorted(Path(repos_dir).iterdir()):
            if not root.is_dir() or root.name in seen or root.name.startswith("."):
                continue
            snapshot = index_repository(str(root), root.name.replace("__", "/"))
            if snapshot.files:
                yield snapshot
                count += 1
            if limit and count >= limit:
                return
