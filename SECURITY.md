# Security Policy

## Reporting a vulnerability

Please do not open public GitHub issues for suspected security vulnerabilities.

Instead, contact the maintainer privately with:

- a description of the issue
- impact assessment
- reproduction steps
- suggested mitigation if available

## Supported scope

This project includes:

- local model gateway code
- agent tool execution logic
- benchmark runtime and progress handling
- UI flows that expose or control local and remote inference

## Secret handling

- Keep secrets in `.env.local`
- Never commit live API keys
- Public examples should use placeholders only
