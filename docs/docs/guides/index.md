---
title: Guides
sidebar_position: 1
---

# Guides

Role-oriented walkthroughs for the three people most likely to open this site:

- **[User guide](/guides/user)** — day-to-day operation
  of a provisioned stack: starting/stopping servers from the dashboard or
  Discord, reading the cost panel, tailing logs.
- **[Maintainer guide](/guides/maintainer)** — working
  on the code: monorepo layout, tests, lint, CI, release/deploy mechanics,
  load-bearing invariants not to break.
- **[Submodule guide](/guides/submodule)** — the
  recommended layout for running the stack for real: wrap this repo as a git
  submodule inside a private parent repo that holds `terraform.tfvars`,
  state, and anything else secret. Includes an interactive scaffolder that
  generates the wrapper Makefile and config files for you.

The [Setup guide](/setup) is still the first stop if
none of the above has happened yet.
