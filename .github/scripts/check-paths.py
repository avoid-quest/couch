"""Select Check's work from a complete Git diff, defaulting to native validation."""

import json
import os
from pathlib import PurePosixPath
import re
import subprocess


def git(*args):
    return subprocess.check_output(["git", *args], stderr=subprocess.PIPE)


def changed_paths(event_name, event):
    if git("rev-parse", "--is-shallow-repository").strip() != b"false":
        raise ValueError("shallow history")
    if event_name == "pull_request":
        base = event["pull_request"]["base"]["sha"]
        head = event["pull_request"]["head"]["sha"]
    elif event_name == "push" and event["ref"] == "refs/heads/main":
        base, head = event["before"], event["after"]
    else:
        raise ValueError("unsupported event")
    if not all(isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40}", sha) and int(sha, 16) for sha in (base, head)):
        raise ValueError("missing commit")
    if event_name == "pull_request":
        # Checkout tests GitHub's merge result. A stacked PR's event base can lag
        # behind that merge while GitHub rebases the stack; use the tested base.
        parents = git("rev-list", "--parents", "-n", "1", "HEAD").decode().split()
        if len(parents) != 3 or parents[2] != head:
            raise ValueError("checkout does not merge the event head")
        base = parents[1]
        bases = git("merge-base", "--all", base, head).splitlines()
        if len(bases) != 1:
            raise ValueError("ambiguous merge base")
        base = bases[0].decode()
    # Disabling rename detection includes both the removed and added path.
    # Local Git has no changed-file API pagination or 300/3000-file truncation.
    diff = git("diff", "--no-renames", "--name-only", "-z", base, head, "--")
    return [path.decode("utf-8", errors="strict") for path in diff.split(b"\0") if path]


def classify(paths):
    ordinary = False
    for path in paths:
        parts = PurePosixPath(path).parts
        # Build scripts, native sources/vendor/config, dependencies, toolchains,
        # workflows, and any new path are native unless explicitly allowed here.
        if ((len(parts) == 1 or parts[0] == "docs") and path.endswith(".md")) or path in {"tests/linux/README.md", "tests/preview/README.md"}:
            continue
        if parts[0] in {"src", "tests"} and PurePosixPath(path).suffix in {".ts", ".tsx", ".css", ".html", ".m3u"}:
            ordinary = True
        else:
            return "native"
    return "ordinary" if ordinary else "docs"


def select(event_name, event):
    try:
        paths = changed_paths(event_name, event)
        return classify(paths), f"{len(paths)} changed paths"
    except (KeyError, TypeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        return "native", f"complete diff unavailable: {type(error).__name__}"


if __name__ == "__main__":
    try:
        with open(os.environ["GITHUB_EVENT_PATH"]) as source:
            mode, reason = select(os.environ["GITHUB_EVENT_NAME"], json.load(source))
    except (KeyError, ValueError, OSError) as error:
        mode, reason = "native", f"event unavailable: {type(error).__name__}"
    print(f"Check selection: {mode} ({reason})")
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"mode={mode}\n")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write(f"Check selected **{mode}** validation: {reason}.\n")
