# Architecture diagrams (D2)

Each `.d2` file here is one diagram. They are rendered to SVG at docs-site
build time by `.github/workflows/jekyll-gh-pages.yml` before Jekyll runs;
the Markdown pages then reference the generated `.svg` via standard image
tags.

The SVG outputs are gitignored — the `.d2` files are the single source of
truth.

## Files

| File | Embedded on |
|------|-------------|
| `context.d2`        | `docs/index.md` — high-level context |
| `discord-bot.d2`    | `docs/architecture.md` — serverless Discord bot detail |
| `game-plane.d2`     | `docs/architecture.md` — operator + ECS + EFS + ALB |
| `control-loops.d2`  | `docs/architecture.md` — update-dns + watchdog |
| `server-start.d2`   | `docs/architecture.md` — `/server-start` sequence |

## Edit + preview locally

```bash
# One-time: install D2 (https://d2lang.com)
curl -fsSL https://d2lang.com/install.sh | sh -s --

# Render every .d2 -> .svg
./render.sh

# Preview the docs site
cd ..
bundle exec jekyll serve
```

## Why D2 instead of Mermaid?

Mermaid's dagre layout routes every cross-cluster edge through whatever
subgraphs sit between the endpoints, producing unreadable overlap on
diagrams with more than a handful of nodes. D2 uses ELK by default and
handles the same graphs much more cleanly. Smaller diagrams with fewer
cross-cluster edges also help — this directory splits the old single
overview into focused diagrams.
