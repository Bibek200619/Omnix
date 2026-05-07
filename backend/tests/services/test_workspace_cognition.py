from __future__ import annotations

from app.services.workspace_cognition import build_workspace_focus_prompt, normalize_workspace_focus
from app.services.workspace_intelligence_service import workspace_intelligence_system_prompt


def test_workspace_focus_normalizes_legacy_values() -> None:
    assert normalize_workspace_focus("coding") == "engineering"
    assert normalize_workspace_focus("analytics") == "research"
    assert normalize_workspace_focus("product") == "strategy"
    assert normalize_workspace_focus("unknown") == "general"


def test_workspace_focus_prompts_are_behaviorally_distinct() -> None:
    engineering = build_workspace_focus_prompt("engineering")
    design = build_workspace_focus_prompt("design")
    research = build_workspace_focus_prompt("research")
    strategy = build_workspace_focus_prompt("strategy")

    assert "Implementation-first systems reasoning" in engineering
    assert "failure modes" in engineering
    assert "UX psychology" in design
    assert "visual hierarchy" in design
    assert "Evidence-oriented exploration" in research
    assert "Separate observations, inferences, assumptions, and unknowns" in research
    assert "Systems-level prioritization" in strategy
    assert "leverage points" in strategy
    assert len({engineering, design, research, strategy}) == 4


def test_workspace_system_prompt_keeps_focus_when_memory_disabled() -> None:
    prompt = workspace_intelligence_system_prompt(
        {
            "workspace_name": "Omnix",
            "workspace_type": "super_workspace",
            "workspace_focus": "engineering",
            "retrieval_scope": "workspace",
            "context_summary": "Omnix is using engineering focus.",
            "intelligence_preferences": {"memory_enabled": False},
            "unresolved_continuity": [{"content": "Do not include this memory", "status": "unresolved"}],
        }
    )

    assert "WORKSPACE COGNITIVE POSTURE" in prompt
    assert "Focus: engineering" in prompt
    assert "Workspace memory is disabled" in prompt
    assert "Do not include this memory" not in prompt


def test_workspace_profile_fragment_can_omit_focus_to_avoid_duplication() -> None:
    prompt = workspace_intelligence_system_prompt(
        {
            "workspace_name": "Omnix",
            "workspace_type": "super_workspace",
            "workspace_focus": "design",
            "retrieval_scope": "workspace",
            "context_summary": "Omnix is using design focus.",
            "intelligence_preferences": {},
        },
        include_focus=False,
    )

    assert "WORKSPACE COGNITIVE POSTURE" not in prompt
    assert "Workspace cognitive focus: design" in prompt
