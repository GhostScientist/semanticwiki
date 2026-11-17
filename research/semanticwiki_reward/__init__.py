"""Python mirror of SemanticWiki's page reward (src/eval in the TypeScript harness).

The harness scores pages with the TypeScript implementation; training and offline
evaluation use this module. Both are held equal by tests/fixtures/reward-conformance.json.
"""
from .reward import (  # noqa: F401
    REWARD_VERSION, WEIGHTS, Citation, VerifiedCitation, PageScore,
    extract_citations, verify_citations, score_page, precision_weight,
    check_structure, check_diagrams, check_mermaid_source,
    InMemoryRepository, FilesystemRepository,
)
from .evidence import (  # noqa: F401
    PROMPT_VERSION, SYSTEM_PROMPT, EvidenceWindow, render_evidence, build_page_prompt,
    build_repair_prompt, select_windows, index_repository, RepositorySnapshot,
    evidence_budget_chars, fit_evidence_to_budget, render_evidence_window,
)
