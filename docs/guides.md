---
title: Guides
nav_order: 4
has_children: true
---

# Guides

Role-oriented walkthroughs for the three people most likely to open this site:

- **[User guide]({{ '/guides/user/' | relative_url }})** — day-to-day operation
  of a provisioned stack: starting/stopping servers from the dashboard or
  Discord, reading the cost panel, tailing logs.
- **[Maintainer guide]({{ '/guides/maintainer/' | relative_url }})** — working
  on the code: monorepo layout, tests, lint, CI, release/deploy mechanics,
  load-bearing invariants not to break.
- **[Submodule guide]({{ '/guides/submodule/' | relative_url }})** — the
  recommended layout for running the stack for real: wrap this repo as a git
  submodule inside a private parent repo that holds `terraform.tfvars`,
  `server_config.json`, state, and anything else secret.

The [Setup guide]({{ '/setup/' | relative_url }}) is still the first stop if
none of the above has happened yet.
