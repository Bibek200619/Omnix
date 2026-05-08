from __future__ import annotations

def format_prompt(template: str, **kwargs) -> str:
    """Safely format a prompt template."""
    try:
        return template.format(**kwargs)
    except KeyError as e:
        # Graceful degradation if a key is missing
        return template.replace(f"{{{e.args[0]}}}", "")
