# Contributing

Thanks for taking a look at Local Agent Lab.

## Development setup

```bash
nvm install 22
nvm use 22
npm install
cp .env.example .env.local
```

Start the UI:

```bash
npm run dev
```

Optional local model gateway:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install mlx mlx-lm fastapi uvicorn
python scripts/local_model_gateway_supervisor.py
```

## Pull request guidelines

- Keep changes focused.
- Include a short verification summary.
- If you change runtime or benchmark behavior, include one real benchmark note.
- Do not commit secrets, local `.env` files, or private endpoints.

## Code style

- TypeScript + Next.js app code should pass:

```bash
./node_modules/.bin/tsc --noEmit
```

- Smoke checks:

```bash
./scripts/smoke-test.sh
```

## Reporting issues

If you hit a bug, include:

- what you expected
- what happened instead
- whether the issue was local, remote, or benchmark-specific
- relevant logs or screenshots if available
