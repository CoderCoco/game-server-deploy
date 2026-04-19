---
title: Components
nav_order: 5
has_children: true
---

# Components

Deep-dives on each piece of the stack, for when the guides hand-wave past
something:

- **[Terraform]({{ '/components/terraform/' | relative_url }})** — every
  `.tf` file, variables, outputs, and AWS services touched.
- **[Management app]({{ '/components/management-app/' | relative_url }})** —
  the Nest.js API, React dashboard, and `@gsd/shared` library.
- **[Lambdas]({{ '/components/lambdas/' | relative_url }})** — the four
  Node.js Lambdas (interactions, followup, update-dns, watchdog).

For the big picture, start at the
[architecture overview]({{ '/architecture/' | relative_url }}).
