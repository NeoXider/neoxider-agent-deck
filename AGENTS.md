# Agent instructions

## Authorship and commits

- **No co-authorship.** Never add a `Co-Authored-By:` trailer or any other co-author, collaborator, or AI attribution to commits, tags, release notes, changelog entries, or generated files. Every commit is authored solely by the repository owner.
- Never append "Generated with ...", "Made with ...", or similar tool/assistant signatures to commit messages, pull requests, documentation, or code.
- Write clear commit messages in the existing imperative style. Do not mention the assistant, the model, or the tooling used to produce the change.

## Verification

- Run `npm test` after changing source and make sure it passes.
- `npm audit --audit-level=high` must pass. A high-severity advisory blocks the release workflow.
- Before tagging `vX.Y.Z`, run `node scripts/verify-release-version.cjs vX.Y.Z` and update `package.json`, `package-lock.json`, `README.md`, and `CHANGELOG.md` together.
