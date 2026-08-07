# Repository Guidelines

## Project Structure & Module Organization

This repository is a compact Node.js 18+ application. `server.js` contains the Express API, SQLite schema/migrations, authentication, scoring, and static-file serving. The participant interface lives in `index.html`, `app.js`, `styles.css`, and `media.css`; the administrator interface uses `admin.html`, `admin.js`, and `admin.css`. Integration tests are under `test/`, currently in `test/integration.test.js`.

Runtime state is written to `data/emotion.sqlite` and `uploads/`. Both paths are gitignored and must remain persistent in deployments. Do not commit generated databases, uploaded media, dependencies, or local `.env` files.

## Build, Test, and Development Commands

- `npm install --python=/usr/bin/python3` installs dependencies, including the native `better-sqlite3` module.
- `npm start` starts the server at `http://localhost:3000` by default.
- `npm test` runs all `test/*.test.js` files with Node's built-in test runner.
- `npm run check` syntax-checks the three JavaScript entry points.
- `npm audit` checks installed packages for known vulnerabilities.

Set `SESSION_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` in the environment before production use. Tests should use temporary `DATA_DIR` and `UPLOAD_DIR` paths to avoid modifying development data.

## Coding Style & Naming Conventions

Use CommonJS (`require`, `module.exports`) and APIs supported by Node 18. Follow the existing two-space indentation, semicolons, and single-quoted JavaScript strings. Use `camelCase` for variables and functions, `UPPER_SNAKE_CASE` for directory/configuration constants, and kebab-case for CSS classes. Keep API routes resource-oriented under `/api/`; administrator endpoints belong under `/api/admin/`. No formatter or linter is configured, so run `npm run check` and preserve nearby style.

## Testing Guidelines

Write integration tests with `node:test` and `node:assert/strict`. Name files `*.test.js` and describe behavior in each `test(...)` title. Cover successful flows plus authentication, invalid input, conflicts, and persistence-sensitive behavior. Keep tests isolated with temporary directories and close servers/databases during teardown.

## Commit & Pull Request Guidelines

History uses short, direct commit subjects in Chinese or English. Prefer an imperative summary describing one change, such as `修复重复提交校验` or `Add media upload tests`. Pull requests should explain user-visible and API changes, list verification commands, link relevant issues, and include screenshots for participant or admin UI changes. Call out schema, environment, or deployment changes explicitly.
