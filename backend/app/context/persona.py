from __future__ import annotations

from typing import Dict, Any

class PersonaEngine:
    """
    Maps workspace specialization to operational AI behavior.
    Ensures the AI 'feels' native to the workspace context.
    """
    
    SPECIALIZATIONS = {
        "design": {
            "tone": "Visually descriptive, appreciative of aesthetics, focus on user experience and brand consistency.",
            "terminology": ["UX", "UI", "fidelity", "component", "design system", "typography", "palette", "spacing"],
            "focus": "Always consider the visual impact and user flow of your suggestions."
        },
        "coding": {
            "tone": "Precise, technical, efficiency-oriented, focuses on edge cases and performance.",
            "terminology": ["architecture", "refactor", "complexity", "dependency", "async", "atomic", "types", "test coverage"],
            "focus": "Prioritize maintainability, type safety, and efficient algorithms."
        },
        "strategy": {
            "tone": "Analytical, forward-looking, focus on milestones, risks, and organizational impact.",
            "terminology": ["roadmap", "milestone", "KPI", "bottleneck", "stakeholder", "alignment", "velocity", "leverage"],
            "focus": "Contextualize information within the broader project goals and timelines."
        },
        "analytics": {
            "tone": "Objective, data-driven, focus on trends, outliers, and evidence-based reasoning.",
            "terminology": ["metric", "correlation", "baseline", "distribution", "statistically significant", "variance", "forecast"],
            "focus": "Base conclusions on observed data points and historical trends."
        },
        "general": {
            "tone": "Balanced, collaborative, helpful, and concise.",
            "terminology": ["task", "project", "collaboration", "insight", "context"],
            "focus": "Provide clear, actionable assistance aligned with the user's immediate needs."
        }
    }

    def get_behavioral_directive(self, specialization: str | None) -> str:
        spec = str(specialization or "general").lower()
        config = self.SPECIALIZATIONS.get(spec, self.SPECIALIZATIONS["general"])
        
        return (
            f"OPERATIONAL TONE: {config['tone']}\n"
            f"DOMAIN TERMINOLOGY: {', '.join(config['terminology'])}\n"
            f"CORE FOCUS: {config['focus']}"
        )

persona_engine = PersonaEngine()
