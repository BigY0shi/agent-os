# Task Group: Finance-app startup, baseline creation, and blocked document-redesign follow-up

scope: Reuse for `C:\Users\Yoshi\finance-app` startup verification, README corrections, clean-baseline tagging/branching, and the later novice-facing instruction-packet redesign request that was blocked by auth.
applies_to: cwd=C:\Users\Yoshi\finance-app; reuse_rule=safe for this checkout and closely related follow-up work, but treat the exact server command, ports, tags, and auth state as checkout-specific unless rechecked

## Task 1: Verify the working startup path and correct the README

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-qur6-finance_app_startup_readme_baseline_and_doc_redesign_blocked.md (cwd=\\?\C:\Users\Yoshi\finance-app, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-fe7f-7050-bfd3-a18500fb8f2a.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-fe7f-7050-bfd3-a18500fb8f2a, success; corrected docs to match actual app startup)

### keywords

- finance-app, uvicorn, 8765, 127.0.0.1, 0.0.0.0, README.md, full Python 3.11 path, backend/main.py, LAN reachability

## Task 2: Create a known-good baseline before new iteration

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-qur6-finance_app_startup_readme_baseline_and_doc_redesign_blocked.md (cwd=\\?\C:\Users\Yoshi\finance-app, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-fe7f-7050-bfd3-a18500fb8f2a.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-fe7f-7050-bfd3-a18500fb8f2a, success; commit + tag + branch + push baseline pattern)

### keywords

- v1.0-known-good, iterate, git tag -a, baseline, push origin main, push origin iterate, clean restore point

## Task 3: Attempt the novice-facing instruction-packet redesign and capture the auth blocker

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-qur6-finance_app_startup_readme_baseline_and_doc_redesign_blocked.md (cwd=\\?\C:\Users\Yoshi\finance-app, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-fe7f-7050-bfd3-a18500fb8f2a.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-fe7f-7050-bfd3-a18500fb8f2a, partial; redesign brief captured but auth blocked live edits)

### keywords

- instruction packet, infographic, novice user, AI prompts, second page, /login, 401 Invalid authentication credentials, docs redesign

## User preferences

- When the user says "start this program" or asks whether it is listening on `0.0.0.0` -> verify the real command and real binding instead of inferring from docs. [Task 1]
- When the discovered startup path differs from the README -> update the README in the same run, not just the verbal answer. [Task 1]
- When the user says "fork this project" in a local repo-iteration context -> clarify once if needed, but expect they may mean a clean tag/branch baseline rather than a GitHub fork. [Task 2]
- When the user asks for novice-facing docs with AI prompts "for every single line item" -> treat the deliverable as a real instruction packet plus companion prompt artifact, not a light copy edit. [Task 3]

## Reusable knowledge

- The working startup command used the full Python path on this machine and served the app on port `8765`. [Task 1]
- The verified binding answer here was explicit: local access on `127.0.0.1`, remote/LAN only if the app binds to `0.0.0.0`. [Task 1]
- The successful clean-baseline workflow was commit -> annotated tag `v1.0-known-good` -> branch `iterate` -> push both tag and branch. [Task 2]
- The later redesign task was blocked by auth at `/login` with `401 Invalid authentication credentials`, so the durable value from that pass is the brief, not code changes. [Task 3]

## Failures and how to do differently

- Symptom: README startup guidance does not match the working launch path -> cause: docs drift -> fix: verify the real command locally and patch the README immediately. [Task 1]
- Symptom: later experimentation needs an easy rollback point -> cause: no clean baseline before iterating -> fix: create a commit, annotated tag, and dedicated branch before the next round of edits. [Task 2]
- Symptom: document-redesign work cannot be validated in-app -> cause: auth failure at `/login` -> fix: treat `401 Invalid authentication credentials` as a hard blocker and avoid pretending the redesign was implemented. [Task 3]
