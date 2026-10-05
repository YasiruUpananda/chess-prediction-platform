# Neuro Chess web client

This is the Neuro Chess web application, built with Vite and React. It uses Asgardeo authentication and calls the FastAPI service at `VITE_API_URL`.

Copy `.env.example` to `.env` and configure the Asgardeo SPA client and API URL. See the repository [README](../README.md) for JWT audience setup, Docker services, PGN ingestion, PDF OCR, and operational commands.

Source is organized by feature under `src/features/`, with shared components, API helpers, styles, and route composition in their own directories. Unit tests stay beside their modules. See the [repository structure](../docs/architecture/REPOSITORY_STRUCTURE.md) for ownership and check commands, and [frontend performance](../docs/architecture/FRONTEND_PERFORMANCE.md) for bundle profiling.
