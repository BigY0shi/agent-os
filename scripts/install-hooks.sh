#!/bin/sh
# Point git at the tracked hooks. Run once per clone.
#
# .git/hooks is not version-controlled, so a hook that lives there protects
# exactly one working copy and silently protects nobody else. core.hooksPath
# moves that to a tracked directory.
git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "core.hooksPath -> $(git config core.hooksPath)"
