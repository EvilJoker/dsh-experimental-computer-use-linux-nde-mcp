# @deepseek-ai/dsh-experimental-computer-use-linux-nde-mcp

DSH Cordis **computer-use** provider that spawns the Nde-adapted musl-static
binary built by
[computer-use-linux-nde](https://github.com/EvilJoker/computer-use-linux-nde).

It reserves the shared `ctx.computerUse` slot — the same slot the upstream
`@deepseek-ai/dsh-experimental-computer-use-cua-driver-*` providers use — and
forks the spawned Rust MCP server into DSH's tool registry. Tools are exposed
under the canonical `mcp__computer-use-linux-nde-mcp__*` namespace (for
example `mcp__computer-use-linux-nde-mcp__screenshot`).

This is **not** the Cua Driver. The backend is the Nde fork of
[agent-sh/computer-use-linux](https://github.com/agent-sh/computer-use-linux)
which already implements 28+ Linux desktop-control tools. This provider is
the thin Cordis glue that lets DSH consume that binary as a first-class
`computer-use` provider.

## Install (local file: protocol — no npm publish required)

### 1. Build the Nde binary (or download a release)

Either build locally from `computer-use-linux-nde` (instructions in its
README) or download the `static-claude-nde` musl asset from a release such
as `v0.7.7-nde.3`. The binary is
`computer-use-linux.static-claude-nde-x86_64-unknown-linux-musl` (about
8.9 MB, statically linked, runs on Nde out of the box).

### 2. Install this provider into a DSH profile

```bash
# either (a) — DSH's plugin manager, picks the right prefix for you
dsh plugin --profile <name> add /path/to/this/repo

# or (b) — direct npm install into a profile's node_modules
npm install --prefix ~/.dsh/profiles/<name> /path/to/this/repo
```

The `file:` install copies the package into `<profile>/node_modules` and
resolves its peer dependencies from the same node_modules tree (DSH's
`@deepseek-ai/dsh-computer-use` and `@deepseek-ai/dsh-mcp-client` are
already there).

### 3. Add the row to your profile's `cordis.patch.yml`

```yaml
- name: '@deepseek-ai/dsh-computer-use'
- name: '@deepseek-ai/dsh-experimental-computer-use-linux-nde-mcp'
  config:
    command: /abs/path/to/computer-use-linux.static-claude-nde-v0.7.7-nde.3-musl
    args: [mcp]
    reconnect:
      enabled: true
      initialDelayMs: 500
      maxDelayMs: 30000
      maxAttempts: 10
    env:
      NDE_AT_SPI_SCOPE_REQUIRED: '1'   # optional but recommended on Nde
```

Restart the profile (or HMR if supported) — the spawned MCP server
registers its 18 tools under `mcp__computer-use-linux-nde-mcp__*`.

## What this gives DSH

* A genuine **first-class `computer-use`** registration through DSH's
  `ctx.computerUse.register(...)` slot. The model-visible surface comes
  from the spawned binary's `tools/list` and is fed into DSH's tool
  registry by `dsh-mcp-client`.
* The Nde-specific patches in the binary:
  * `list_windows` / `focused_window` / `activate_window` /
    `move_window` / `resize_window` work on Nde's KWin 5.15.5 via a
    caption+coords fallback (real uuid/internalId are absent).
  * `get_app_state` is cache-first (`SnapshotCache` per `(app, pid)`); on
    Nde this keeps Chrome's AT-SPI bridge from being touched more than
    once per 5 s, which previously made Chrome crash repeatedly.
  * `screenshot` falls back to capturing the X11 root window with
    `GetImage` when no portal interface is exported (XWayland, Nde,
    older GNOME).
  * `NDE_AT_SPI_SCOPE_REQUIRED=1` makes unscoped `get_app_state` calls
    fail fast (clear hint) rather than hang the AT-SPI bus.

## What this does NOT change

* The binary itself is built and shipped by
  [computer-use-linux-nde](https://github.com/EvilJoker/computer-use-linux-nde);
  this provider does not fork or patch the Rust source.
* The existing `@agent-sh/computer-use-linux` npm package, the
  `mcp-computer-use` cordis row in your current patch, and the static
  Claude flow all keep working unchanged — they are separate binary
  registrations. Two computer-use providers cannot coexist in the
  same DSH instance; switch the cordis patch to use this row when you
  want the Nde one.

## Versioning

This provider tracks the major version of `computer-use-linux-nde` it
spawns. v0.1.0 expects a v0.7.7-nde.N musl binary (the `static-claude-nde`
release series). Any breaking change to the spawned binary's tool surface
will bump the provider major version.

## Develop

```bash
npm install
npm run build          # tsc → lib/
```

`tsconfig.json` targets ES2022 / NodeNext so the compiled output is
consumable directly by Node 22+ without a runtime transpiler.

## License

MIT.
