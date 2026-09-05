import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("check_paths", Path(__file__).with_name("check-paths.py"))
check_paths = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_paths)


class ClassificationTests(unittest.TestCase):
    def test_docs_and_ordinary(self):
        self.assertEqual(check_paths.classify(["AGENTS.md", "docs/ci.md"]), "docs")
        for path in ["src/main.ts", "src/client/App.tsx", "src/server/hub.test.ts", "tests/setup-media.test.ts", "src/client/styles.css", "src/client/index.html", "src/server/radio.m3u"]:
            with self.subTest(path=path):
                self.assertEqual(check_paths.classify(["README.md", path]), "ordinary")

    def test_native_dependency_build_and_unknown_inputs(self):
        for path in ["src-tauri/src/lib.rs", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/vendor/video/README.md", "src-tauri/build.rs", "src-tauri/tauri.conf.json", "src-tauri/capabilities/default.json", "scripts/build.ts", "scripts/desktop.ts", ".cargo/config.toml", "rust-toolchain.toml", ".github/workflows/check.yml", ".github/scripts/check-paths.py", "bun.lock", "package.json", "tsconfig.json", "bunfig.toml", "new/input", "src/new.rs"]:
            with self.subTest(path=path):
                self.assertEqual(check_paths.classify(["README.md", "src/main.ts", path]), "native")


class DiffTests(unittest.TestCase):
    def setUp(self):
        self.original = os.getcwd()
        self.directory = tempfile.TemporaryDirectory()
        os.chdir(self.directory.name)
        self.addCleanup(os.chdir, self.original)
        self.addCleanup(self.directory.cleanup)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "ci@example.invalid")
        self.git("config", "user.name", "CI fixtures")
        self.write("README.md")
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", *args], stderr=subprocess.PIPE).decode().strip()

    def write(self, path, value="fixture\n"):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(value)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def pr(self, base, head):
        return {"pull_request": {"base": {"sha": base}, "head": {"sha": head}}}

    def test_stack_and_retarget_use_actual_base(self):
        self.write("src-tauri/src/lib.rs")
        lower = self.commit()
        self.write("docs/ci.md")
        head = self.commit()
        self.assertEqual(check_paths.select("pull_request", self.pr(lower, head))[0], "docs")
        self.assertEqual(check_paths.select("pull_request", self.pr(self.base, head))[0], "native")

    def test_diverged_base_uses_merge_base(self):
        self.write("src/main.ts")
        head = self.commit()
        self.git("checkout", "-q", "--detach", self.base)
        self.write("src-tauri/build.rs")
        base = self.commit()
        self.assertEqual(check_paths.select("pull_request", self.pr(base, head))[0], "ordinary")

    def test_main_covers_the_whole_push(self):
        self.write("src-tauri/build.rs")
        self.commit()
        self.write("README.md", "updated\n")
        head = self.commit()
        event = {"ref": "refs/heads/main", "before": self.base, "after": head}
        self.assertEqual(check_paths.select("push", event)[0], "native")

    def test_rename_and_delete_keep_native_paths(self):
        self.write("src-tauri/native.md")
        before = self.commit()
        self.git("mv", "src-tauri/native.md", "native.md")
        renamed = self.commit()
        self.assertEqual(set(check_paths.changed_paths("pull_request", self.pr(before, renamed))), {"src-tauri/native.md", "native.md"})
        self.assertEqual(check_paths.select("pull_request", self.pr(before, renamed))[0], "native")
        self.git("checkout", "-q", "--detach", before)
        self.git("rm", "src-tauri/native.md")
        deleted = self.commit()
        self.assertEqual(check_paths.select("pull_request", self.pr(before, deleted))[0], "native")

    def test_full_diff_and_unusual_names(self):
        for index in range(3001):
            self.write(f"docs/{index}.md")
        self.write("docs/space\nand tab\t.md")
        self.write("src-tauri/z.rs")
        event = self.pr(self.base, self.commit())
        self.assertEqual(len(check_paths.changed_paths("pull_request", event)), 3003)
        self.assertEqual(check_paths.select("pull_request", event)[0], "native")

    def test_missing_or_invalid_information_selects_native(self):
        for event in [{}, self.pr("0" * 40, self.base), self.pr("f" * 40, self.base), self.pr("--help", self.base)]:
            with self.subTest(event=event):
                self.assertEqual(check_paths.select("pull_request", event)[0], "native")
        self.assertEqual(check_paths.select("unknown", {})[0], "native")
        Path(".git/shallow").write_text(self.base + "\n")
        self.assertEqual(check_paths.select("pull_request", self.pr(self.base, self.base))[0], "native")


if __name__ == "__main__":
    unittest.main()
