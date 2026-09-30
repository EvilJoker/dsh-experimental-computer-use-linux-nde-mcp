/**
 * Exclusive DSH computer-use provider that spawns the Nde-adapted
 * static-claude-nde musl binary built by computer-use-linux-nde.
 *
 * The default composition in cordis.patch.yml spawns v0.7.7-nde.3 of the
 * binary. To upgrade, edit cordis.patch.yml and replace the `command`
 * path with the new v0.7.7-nde.N asset; no provider re-install is required.
 *
 * Like the upstream @deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp,
 * this provider reserves the shared computer-use slot and spawns an MCP stdio
 * subprocess. Unlike the Cua Driver flavor, the subprocess is the Rust
 * binary computer-use-linux-nde ships, whose tools match computer-use's Linux
 * capability surface (AT-SPI tree + X11 screenshot + xdotool input + KWin
 * window targeting) and includes Nde-specific patches (KWin caption+coords
 * fallback, SnapshotCache to avoid the Chrome AT-SPI deadlock, AT-SPI scope
 * guard, X11 root-window screenshot).
 *
 * Install via the dsh-market catalog (after the EvilJoker PR to
 * awesome-dsh-plugin merges), or directly:
 *
 *   dsh plugin --profile <name> add @ashtonsun/dsh-experimental-computer-use-linux-nde-mcp
 *
 * or for local development:
 *
 *   dsh plugin --profile <name> add /path/to/this/repo
 * @module @ashtonsun/dsh-experimental-computer-use-linux-nde-mcp
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ComputerUseProviderName } from '@deepseek-ai/dsh-computer-use/brand'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-computer-use'

/** Cordis plugin identity for the Nde-adapted musl binary. */
export const name = 'experimental-computer-use-linux-nde-mcp'

/** The shared reservation and tool registry must exist before connection. */
export const inject = ['computerUse', 'tools']

/**
 * Provider configuration.
 *
 * `command` is the absolute path to a musl-static computer-use-linux-nde
 * binary (build via scripts/release.sh -> v0.7.7-nde.N release, then pick
 * the computer-use-linux.static-claude-nde-x86_64-unknown-linux-musl asset).
 *
 * `args` is forwarded verbatim as the MCP stdio argv; the binary's `mcp`
 * subcommand is the only supported invocation.
 *
 * `env` is merged into the child process environment. Recommended:
 *   NDE_AT_SPI_SCOPE_REQUIRED=1  (refuses unscoped AT-SPI scans that hang
 *                                  the bus on Nde; toggled off in v0.7.7-nde.3
 *                                  binary when scope guard is undesirable).
 */
export interface Config {
  /** Absolute path to the musl-static computer-use-linux-nde binary. */
  command: string
  /** Arguments passed without a shell; defaults to ['mcp']. */
  args: string[]
  /** Per-call timeout in milliseconds; omission uses the MCP client's default. */
  toolCallTimeoutMs?: number
  /** Reconnection overrides; defaults to the MCP client's policy. */
  reconnect: McpClient.ReconnectConfig
  /** Forwarded to the spawned child; NDE_AT_SPI_SCOPE_REQUIRED='1' recommended. */
  env?: Record<string, string>
}

export const Config: z<Partial<Config>, Config> = z.object({
  command: z.string().pattern(/[^\s]/u),
  args: z.array(String).default(['mcp']),
  toolCallTimeoutMs: z.number().min(1),
  reconnect: z.object({
    enabled: z.boolean(),
    initialDelayMs: z.number().min(1),
    maxDelayMs: z.number().min(1),
    maxAttempts: z.number().min(1).step(1),
  }),
  env: z.dict(z.string()),
})

/**
 * Reserve the computer-use slot and activate the spawned musl binary's MCP
 * tools. Initial connection or discovery failure rejects activation and rolls
 * back. Disposal retains the reservation until the MCP child has finished
 * teardown so concurrent Sessions cannot admit another provider mid-shutdown.
 *
 * The MCP server name is fixed at `computer-use-linux-nde-mcp`; tools are
 * exposed to the model under the canonical `mcp__computer-use-linux-nde-mcp__*`
 * namespace (e.g. `mcp__computer-use-linux-nde-mcp__screenshot`).
 *
 * @param ctx - context providing computer use and the tool registry.
 * @param config - validated executable options and optional connection overrides.
 * @returns initial MCP tool-discovery completion.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!config.command) {
    throw new Error('command is required (absolute path to computer-use-linux-nde musl binary)')
  }
  if (!config.args.includes('mcp')) {
    throw new Error(`args must include "mcp" subcommand; got ${JSON.stringify(config.args)}`)
  }

  const connection = McpClient.Config({
    command: config.command,
    args: config.args,
    ...(config.toolCallTimeoutMs === undefined
      ? {}
      : { toolCallTimeoutMs: config.toolCallTimeoutMs }),
    reconnect: config.reconnect,
    transport: 'stdio',
    serverName: 'computer-use-linux-nde-mcp',
    failOnStartupError: true,
  })

  // One effect orders child shutdown before the slot is released.
  let child!: Fiber
  ctx.effect(function* () {
    yield ctx.computerUse.register(
      ComputerUseProviderName('computer-use-linux-nde-mcp'),
    )
    child = ctx.plugin(McpClient, connection)
    yield child.dispose
  }, 'computer-use-linux-nde-mcp.connection')

  await child.await()
}
