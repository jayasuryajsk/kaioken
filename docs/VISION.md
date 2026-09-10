# Vision

## Goal

Describe the long-term direction for kaioken and the principles that should guide major
product and architecture decisions.

## What kaioken Is

kaioken is a programmable workspace for coding agents. It should be a system that
users, teams, and agents can shape around their own tools, infrastructure, and
workflows.

## Principles

- **Users and agents are both first-class operators**: kaioken is meant to be used
  directly by users and programmatically by agents. The web app, CLI, managers,
  and future surfaces should expose the same core functionality. The CLI should
  not be treated as a sidecar or an afterthought.
- **Extensible**: kaioken should support custom providers, environments,
  LLM-backed services, CLI integrations, UI surfaces, and future extension
  points. The system should adapt to a user's infrastructure and workflows, not
  force them to fork kaioken.
- **Flexible, not rigid**: kaioken should provide strong defaults and built-in flows
  without forcing users into one blessed way of working. Managed and unmanaged
  flows should both feel natural, and kaioken should be built from reusable
  primitives instead of hard-coded special cases.
- **Works wherever you are**: kaioken should work well on one machine today without
  closing off remote orchestration, cloud execution, peer-backed environments,
  or mobile access later.
- **Fast and understandable**: kaioken should stay responsive, lightweight, and
  understandable. Performance, operational simplicity, and low cognitive
  overhead are part of the product.
- **Easy to trust and adopt**: kaioken should remain easy to evaluate and adopt in a
  local mode, especially for teams with security and trust constraints. Hosted
  features can extend kaioken later, but they should not replace the core product.
