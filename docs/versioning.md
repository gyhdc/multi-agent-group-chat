# Local Versioning

This project uses a local-only Git workflow for safe rollback.

## Branches

- `main`: stable local baseline
- `feature/<short-name>`: new feature work starts here and returns to `main` after verification

## Tags

- Before a larger feature, create a local tag on `main`
- Format: `pre-<feature-name>-YYYYMMDD`

## Rollback

- To inspect history: `git log --oneline --decorate`
- To switch back to the stable branch: `git switch main`
- To return to a saved point: `git switch --detach <tag-or-commit>`
