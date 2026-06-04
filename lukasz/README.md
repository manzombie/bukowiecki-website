# Mr. Lobster Mission Control MVP

Upload the contents of this `lukasz` folder to `mrlobster.co.uk/lukasz`.

Default passcode is set in `mission-data.js`:

```js
passcode: "lobster"
```

This is an MVP static dashboard for one.com file-manager hosting. It stores manual progress in the browser with `localStorage`, so manual ticks are per machine for now.

For cross-machine truth, use GitHub:

1. Create the repo at `https://github.com/manzombie/mr_lobster_rebuild`.
2. Click the `Issue` button beside a Mission Control task to create a matching GitHub issue.
3. Close the issue or merge a PR when the task is complete.
4. Keep `BUILD_LOG.md` in the repo as the rebuild record.

Recommended first repo setup from any machine:

```bash
git clone https://github.com/manzombie/mr_lobster_rebuild.git
cd mr_lobster_rebuild
touch BUILD_LOG.md
mkdir -p DOCS
touch DOCS/decisions.md
git add BUILD_LOG.md DOCS/decisions.md
git commit -m "chore: initialize mr lobster rebuild log"
git push
```

When working from another machine:

```bash
git clone https://github.com/manzombie/mr_lobster_rebuild.git
cd mr_lobster_rebuild
git pull
```

Before starting any session:

```bash
git pull
```

After finishing a session:

```bash
git status
git add .
git commit -m "complete: short task name"
git push
```

## Proper password protection on one.com

The in-page passcode keeps the dashboard out of casual view, but it is not strong security because static files can be inspected. For real protection, use one.com's password-protected directory feature if available in the control panel, or create server-level basic auth for the `/lukasz` directory.

## Next Version

v0.2 should add read-only GitHub sync:

- Fetch open/closed GitHub issues from `manzombie/mr_lobster_rebuild`.
- Match issues to Mission Control task titles.
- Display `GitHub Verified` when a linked issue is closed.
- Keep manual status as an override.
