import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.secret_guard import violations

SCRIPT = Path(__file__).with_name("secret_guard.py").resolve()


class SecretGuardTests(unittest.TestCase):
    def test_rejects_resend_values_in_any_tracked_text(self):
        for suffix in ["A" * 33, "A" * 9 + "_" + "B" * 23]:
            with self.subTest(suffix_length=len(suffix)):
                token = "re_" + suffix
                result = violations("backend/config.py", f'KEY="{token}"'.encode())
                self.assertTrue(result)
                self.assertNotIn(token, str(result))

    def test_template_requires_empty_resend_setting(self):
        for value in [b"", b'""', b"''", b" # set only in Render"]:
            self.assertEqual(
                violations("backend/.env.example", b"RESEND_API_KEY=" + value), []
            )
        self.assertTrue(
            violations("backend/.env.example", b"RESEND_API_KEY=put-key-here")
        )
        self.assertTrue(
            violations("backend/.env.example", b"RESEND_API_KEY='#not-empty'")
        )
        for newline in [b"\n", b"\r\n"]:
            self.assertEqual(
                violations(
                    "backend/.env.example",
                    b"RESEND_API_KEY=" + newline + b"EMAIL_FROM=sender@example.com",
                ),
                [],
            )

    def test_private_env_files_are_rejected_even_without_a_resend_key(self):
        for path in [".env", "backend/.env.local", "frontend/.env.production"]:
            self.assertTrue(violations(path, b"OTHER_SETTING=value"))
        self.assertEqual(
            violations("frontend/.env.example", b"OTHER_SETTING=example"), []
        )

    def test_index_scan_detects_secret_hidden_by_an_unstaged_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            token = "re_" + "A" * 9 + "_" + "B" * 23
            file = root / ".env.example"
            file.write_text(f"RESEND_API_KEY={token}\n")
            subprocess.run(["git", "add", ".env.example"], cwd=root, check=True)
            file.write_text("RESEND_API_KEY=\n")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--staged"],
                cwd=root,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("Resend credential-shaped value", result.stdout)
            self.assertNotIn(token, result.stdout + result.stderr)
            subprocess.run(["git", "add", ".env.example"], cwd=root, check=True)
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--staged"],
                cwd=root,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_ignored_local_env_is_not_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            (root / ".gitignore").write_text(".env\n")
            (root / ".env").write_text("RESEND_API_KEY=" + "re_" + "A" * 33)
            subprocess.run(["git", "add", ".gitignore"], cwd=root, check=True)
            result = subprocess.run(
                [sys.executable, str(SCRIPT)], cwd=root, capture_output=True, text=True
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
