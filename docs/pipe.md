# Tulcase Pipe — GitLab Pipelines in VS Code

Tulcase Pipe brings GitLab CI/CD into the editor: watch pipelines across
projects, stream job logs live, trigger and control pipelines, and get
notified when the runs you care about finish.

It replaces the standalone *Tulcase Pipe* extension. If you used that
extension, run **Tulcase: Pipe: Import Scopes from Tulcase Pipe Extension**
and pick your old `scopes.jsonc` — done.

---

## Getting started

1. Click the **Tulcase Pipe** icon in the activity bar.
2. Set your GitLab token (`Tulcase: Pipe: Set GitLab Token`). Use a PAT with
   `api` scope (`read_api` works for read-only use — no run/retry/cancel).
   The token is stored in VS Code's encrypted secret storage; it never lands
   in your settings or in the synced Tulcase data.
3. For self-hosted GitLab, set `tulcase.pipe.url`.
4. Create a scope in the **Pipe Scopes** activity bar view.

## Scopes

A *scope* defines which pipelines appear: one or more projects plus optional
filters (branch, statuses, author, ref/SHA substring, time window, newest N).
Everything is edited through forms — no JSON required:

- **projects** — type a `group/project` path or use the search button
  (queries GitLab for projects you're a member of)
- **statuses / log rules** — toggle chips
- **tags** — attach Tulcase tags via the regular tag picker; they render on
  the scope header in the Pipelines view
- **enabled** — disabled scopes are kept but not polled or shown
- **follow** — see below

Scopes are Tulcase data: they live in the active database
(`pipe_db/scopes.json`), switch with it, and sync via Git Sync.
For power users, **Pipe: Edit Scopes (JSON)** opens the raw file with full
schema validation; the visual editor is the primary surface.

## Follow notifications

Mark a scope as **Follow** (bell icon — in the Pipelines view header or on
the scope card). Whenever a pipeline in that scope finishes you get a VS Code
notification: error toast on failure, warning on cancel, info on success —
with one-click *Open in GitLab*.

Followed scopes keep polling **in the background**, even while the Pipelines
view is hidden. Without followed scopes, polling only runs while the view is
visible.

## Pipelines view

Scopes → pipelines → stages → jobs, with downstream (child) pipelines nested
under their trigger jobs. Filters at the top (text matches branch, author,
SHA, project; plus a status dropdown) apply instantly and persist.

Safe actions (open in GitLab, copy URL, download artifacts) appear on hover.
Everything state-changing lives in the **right-click context menu**, so it
can never be clicked by accident:

| Target   | Right-click menu |
|----------|------------------|
| Scope    | run pipeline, follow/unfollow, manage scopes |
| Pipeline | retry (failed/canceled), cancel (active), open in GitLab, copy URL |
| Job      | open log (here / new tab), play (manual), retry (finished), cancel (active), open in GitLab, copy URL, artifacts |

The follow bell sits at the front of each scope header (subtle when off,
solid while following) and toggles with a click.

**Run Pipeline** (toolbar or scope context menu) walks you through project →
branch (live from the API, or any ref) → optional CI/CD variables, file
variables, and `spec:inputs` values → go.

## Job logs

- **Click** a job: the log opens as a *preview tab* — clicking another job
  replaces it in place (same tab slot, no flicker), so browsing many jobs
  never floods your editor. (With `workbench.editor.enablePreview` disabled,
  the extension swaps the tab manually instead.)
- **Ctrl/Cmd + Click**: the log opens as an additional pinned tab and stays.

Logs are read-only, render ANSI colors, auto-follow the tail while you're at
the bottom, and keep streaming while the job runs (with a notification when
it finishes). The editor title has a save button; closing the last tab of a
log stops its polling.

## Log rules

Regex filters applied line-by-line to job logs, configured in the Pipe
Scopes view and attached per scope. Two modes:

- **remove** — deletes matches; lines emptied by the removal are dropped
- **replace** — regex substitution (`$1`, `$2` … capture groups)

A curated set ships built in: `strip-timestamps`, `strip-section-markers`,
`strip-runner-noise`, `strip-progress-bars`, `strip-debug-lines`,
`redact-secrets`, `shorten-shas`. Editing a built-in creates an override you
can delete to restore the original. The rule editor has a live preview —
paste sample log lines and see the effect while typing.

## Status bar

The current Git branch's latest pipeline status shows in the status bar
(matched against your repo's remote URL). Click to open it in GitLab.
Disable with `tulcase.pipe.statusBar.enabled`.

## AI tools

Chat agents (Copilot Chat, Claude, …) can use:

- `tulcase_pipe_list_scopes` — list scope configurations
- `tulcase_pipe_status` — pipelines + jobs per scope (optionally fresh)
- `tulcase_pipe_job_log` — read a job's log (e.g. *"why did the build fail?"*)
- `tulcase_pipe_trigger_pipeline` — run a pipeline (asks for confirmation)

## Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `tulcase.pipe.url` | `https://gitlab.com` | GitLab base URL |
| `tulcase.pipe.pollIntervalSeconds` | `30` | Pipeline refresh interval |
| `tulcase.pipe.logPollIntervalSeconds` | `2` | Live log refresh interval |
| `tulcase.pipe.maxConcurrentRequests` | `4` | Parallel API requests per poll |
| `tulcase.pipe.notifyOnFinish` | `true` | Toast when an opened job log finishes |
| `tulcase.pipe.statusBar.enabled` | `true` | Branch pipeline status item |
