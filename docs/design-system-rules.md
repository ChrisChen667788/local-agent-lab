# First LLM Studio Design System Rules

Last updated: 2026-04-22

## Purpose

This document captures the current UI system so future Figma-to-code work stays aligned with the existing product language instead of introducing one-off styles.

## Design Tokens

### Color system

The product currently uses a dual-surface model:

- Marketing surfaces: bright slate + white cards
- Workbench surfaces: dark navy glass panels with cyan, violet, emerald, and amber accents

Primary in-use values:

- Base dark background: `#020617`, `#0f172a`
- Panel dark: `bg-slate-950/70`, `bg-slate-950/75`
- Panel border: `border-white/10`
- Cyan accent: `text-cyan-300`, `bg-cyan-400/10`, `border-cyan-400/20`
- Violet accent: `bg-violet-400/10`, `text-violet-100`
- Emerald accent: `bg-emerald-400/10`, `text-emerald-100`
- Amber accent: `bg-amber-300/10`, `text-amber-100`

### Typography

Global stack in [`app/globals.css`](../app/globals.css):

```css
font-family:
  "SF Pro Text",
  "PingFang SC",
  "Hiragino Sans GB",
  "Noto Sans CJK SC",
  "Microsoft YaHei",
  sans-serif;
```

Typography conventions:

- Eyebrows: `text-[11px] uppercase tracking-[0.22em]` to `tracking-[0.28em]`
- Card titles: `text-sm` to `text-base font-semibold`
- Dense metrics: `text-xs` with `leading-6`
- Main product headers: `text-2xl` and above

### Spacing and radius

Common spacing/radius patterns:

- Outer section cards: `rounded-[32px]`, `p-5`
- Mid-level cards: `rounded-3xl`, `p-4`
- Dense utility cards: `rounded-2xl`, `px-3 py-3`
- Action pills: `rounded-full`, `px-3 py-1.5`

## Component Structure

### Admin surfaces

Admin feature sections follow a repeated shell:

- Section wrapper: dark glass card with large radius and shadow
- Intro row: eyebrow + title + subtitle + refresh action
- Utility row: hardware/status/context cards
- Content region: split into 2-column feature grids where practical

Relevant examples:

- [`components/admin/AdminDashboard.tsx`](../components/admin/AdminDashboard.tsx)
- [`components/admin/AdminModelDiscoveryPanel.tsx`](../components/admin/AdminModelDiscoveryPanel.tsx)
- [`components/admin/AdminFineTunePanel.tsx`](../components/admin/AdminFineTunePanel.tsx)
- [`components/admin/AdminTimelinePanel.tsx`](../components/admin/AdminTimelinePanel.tsx)

### Agent surfaces

The agent shell uses a two-column workbench with a heavy dark runtime shell:

- Left rail: target catalog / launcher
- Center column: main task surface
- Right rail: operational context and detailed state

Relevant files:

- [`components/agent/AgentPageShell.tsx`](../components/agent/AgentPageShell.tsx)
- [`components/agent/AgentWorkbench.tsx`](../components/agent/AgentWorkbench.tsx)
- [`components/agent/AgentCompareLab.tsx`](../components/agent/AgentCompareLab.tsx)

## Frameworks and Styling

- Framework: React + Next.js App Router
- Language: TypeScript
- Styling: Tailwind utility classes in component files
- Global styles: [`app/globals.css`](../app/globals.css)
- No CSS Modules or styled-components in the current main surfaces

## Asset Management

- Product screenshots and promo art live under `docs/assets/`
- UI generally prefers code-built gradients and glass surfaces rather than image-heavy panels
- Avoid decorative raster assets in operational workbench views unless they add meaning

## Icon and Badge Language

The current product does not use a centralized SVG icon system for the main studio surfaces. Instead it relies on:

- textual badges
- uppercase eyebrow labels
- semantic color chips
- dense status pills

This means Figma designs should avoid introducing an icon-heavy visual language unless the codebase first adds a shared icon set.

## Interaction Rules

### Dense workbench views

When information density is high:

- prefer matrix or split-panel layouts over long vertical card stacks
- promote one primary reading flow and keep secondary evidence collapsible
- expose status through pills and mini-metrics before showing long prose
- use helper text sparingly; do not let instructional copy dominate operational panels

### Action design

Action hierarchy should remain clear:

- cyan: primary forward action
- white translucent: neutral inspection action
- amber: cleanup / caution action
- rose: destructive / stop action

## Responsive Guidance

- Desktop first for `/agent` and `/admin`, but keep controls wrappable
- Use `xl:` splits for dense admin panels
- On tighter widths, stack cards before shrinking copy beyond readability
- Avoid 5-column metric layouts unless the card remains wider than ~520px

## Current Repo Structure Patterns

- `app/api/**`: route handlers and server-side workflow entry points
- `lib/**`: data stores, orchestration logic, runtime utilities
- `components/admin/**`: operational admin panels
- `components/agent/**`: main workbench UI and compare/chat helpers
- `docs/**`: product planning, release notes, launch assets, and visual collateral

## Figma-to-Code Guidance

When translating future Figma work into this repo:

1. Reuse the existing dark-glass panel language for operational surfaces.
2. Keep cyan as the main orchestration accent; use violet/emerald/amber as semantic supporting accents.
3. Prefer card-within-card hierarchy instead of free-floating blocks.
4. Favor label chips and micro-metrics over large decorative illustrations in `/agent` and `/admin`.
5. If a Figma frame introduces a new layout pattern, implement it first in a bounded feature panel before propagating it globally.
