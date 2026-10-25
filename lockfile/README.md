# Python dependency files

The `.in` files are dependency inputs; the `.txt` files are the generated, hash-locked files used by installs and deployment.

- `requirements.in` → `requirements.txt`: application runtime.
- `requirements-dev.in` → `requirements-dev.txt`: runtime plus pytest.
- `requirements-studio.in` → `requirements-studio.txt`: runtime plus LangGraph CLI.

The dev and Studio inputs include the runtime requirements from this same directory. Regeneration commands are documented in the root `README.md`; run them from `lockfile/` so relative includes resolve correctly. `backend/requirements.txt` remains a separate dependency input used when compiling the runtime lock.
