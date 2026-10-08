"""Reject Resend credentials and private env files without displaying secrets."""

import argparse
import re
import subprocess
from pathlib import Path

RESEND_TOKEN = re.compile(rb"\bre_[A-Za-z0-9_-]{20,}")
RESEND_SETTING = re.compile(
    rb"^[ \t]*(?:export[ \t]+)?RESEND_API_KEY[ \t]*=[ \t]*([^\r\n]*)\r?$", re.MULTILINE
)


def violations(path: str, content: bytes) -> list[str]:
    name = Path(path).name
    findings = []
    if (name == ".env" or name.startswith(".env.")) and name != ".env.example":
        findings.append("private environment file is tracked")
    if RESEND_TOKEN.search(content):
        findings.append("Resend credential-shaped value; remove it and rotate the key")
    if name == ".env.example":
        for setting in RESEND_SETTING.finditer(content):
            value = setting.group(1).strip()
            if not re.fullmatch(rb"(?:\"\"|'')?[ \t]*(?:#.*)?", value):
                findings.append(
                    "RESEND_API_KEY must be blank in an environment template"
                )
                break
    return findings


def scan_repository(root: Path, *, staged: bool = False) -> list[str]:
    paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).split(b"\0")
    findings = []
    for raw_path in paths:
        if not raw_path:
            continue
        path = raw_path.decode("utf-8", errors="surrogateescape")
        if staged:
            content = subprocess.check_output(
                ["git", "show", f":{path}"], cwd=root, stderr=subprocess.DEVNULL
            )
        else:
            file = root / path
            if not file.exists():
                continue
            content = file.read_bytes()
        findings.extend(f"{path}: {reason}" for reason in violations(path, content))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--staged",
        action="store_true",
        help="scan the index, including new staged files",
    )
    args = parser.parse_args()
    try:
        root = Path(
            subprocess.check_output(
                ["git", "rev-parse", "--show-toplevel"], text=True
            ).strip()
        )
        findings = scan_repository(root, staged=args.staged)
    except (OSError, subprocess.CalledProcessError):
        print("Secret guard could not inspect the repository; refusing to pass.")
        return 2
    if findings:
        print("Secret guard failed:")
        for finding in findings:
            print(f"- {finding}")
        return 1
    print(
        "Secret guard passed: no Resend credentials or private env files in the inspected tracked content."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
