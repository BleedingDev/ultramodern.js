#!/usr/bin/env python3
"""Run the bundled plan-graph CLI with this plan's exact dependency overlay."""
import json
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
spec = json.loads((root / "graph-spec.json").read_text())
cli = Path("/Users/satan/workspace/bleedingdev/resources/skills/code/skills/plan-graph/scripts/plan_graph.py")
if not cli.is_file():
    raise SystemExit("Set cli to your installed plan-graph/scripts/plan_graph.py before running")
args = sys.argv[1:] or ["summary"]
read_only = "--read-only" in args
args = [arg for arg in args if arg != "--read-only"]
cmd = [sys.executable, "-S", str(cli), *args, "--plans-root", str(root), "--glob", spec["glob"], "--graph-id", spec["graph_id"], "--state-dir", str(root.parent.parent / "plan-graphs"), "--strict"]
if not read_only:
    cmd.append("--write-state")
for edge in spec["edges"]:
    cmd.extend(["--depends", edge])
raise SystemExit(subprocess.call(cmd))
