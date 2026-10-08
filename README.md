# `@ashtonsun/dsh-experimental-computer-use-linux-nde-mcp`

> DSH Cordis **computer-use** provider，把 [Nde 适配过的
> `computer-use-linux`](https://github.com/EvilJoker/computer-use-linux-zte-nde)
> musl 静态二进制暴露为 DSH 一等公民的 `ctx.computerUse` 提供方。装上
> npm 包，重启 dsh web，模型就能调用
> `mcp__computer-use-linux-nde-mcp__*` 下的 18 个工具。

---

## 它在 DSH 里做什么

DSH 有一个共享的 **computer-use slot** —— `ctx.computerUse.register(name)`，同一
进程里只能有一个 provider 占着它。本 provider 占用这个 slot 后，会 spawn 一个
MCP stdio 子进程，把子进程的工具（截图、AT-SPI 树、xdotool 输入、KWin 窗口控制
等）注入 DSH 的 `tools` registry。模型通过
`mcp__computer-use-linux-nde-mcp__<tool>` 命名空间调用它们。

底层子进程是一个 Rust 静态二进制（musl，~8.9 MB），不是 JS / TS 选手写的。
它的代码维护在另一个 repo（见下文 "它不做什么"）。本仓库只做 DSH 适配。

---

## 安装

### 方式 1：从 npm 安装（推荐，普通用户）

```bash
# 在 DSH profile 目录下
cd ~/.dsh/profiles/<your-profile>

npm install @ashtonsun/dsh-experimental-computer-use-linux-nde-mcp \
  --legacy-peer-deps
```

把 provider 加到 profile 的 `dsh.profile.bundles`：

```json
// ~/.dsh/profiles/<your-profile>/package.json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@ashtonsun/dsh-experimental-computer-use-linux-nde-mcp"
      ]
    }
  }
}
```

把 mount 段写到 `~/.dsh/profiles/<your-profile>/cordis.patch.yml`：

```yaml
- insert:
    - id: computer-use
      name: '@deepseek-ai/dsh-computer-use'
    - id: computer-use-linux-nde-mcp
      name: '@ashtonsun/dsh-experimental-computer-use-linux-nde-mcp'
      config:
        command: bin/computer-use-linux-static-claude-nde-x86_64-unknown-linux-musl
        args: [mcp]
        reconnect:
          enabled: true
          initialDelayMs: 500
          maxDelayMs: 30000
          maxAttempts: 10
        env:
          NDE_AT_SPI_SCOPE_REQUIRED: '1'
```

**注意**：这里的 `command` 是**相对路径**（`bin/...`）。本 provider 在
`apply()` 里用 `import.meta.url` 把它转成绝对路径，所以不依赖 dsh web
进程的 cwd。如果你想指向别的 binary，传绝对路径也行——会被原样使用。

重启 dsh web：

```bash
setsid nohup dsh web --no-open > /tmp/dsh-web.log < /dev/null &
```

### 方式 2：dsh-market catalog（一次性安装）

等本包被收录到 `awesome-dsh-plugin/awesome-dsh-plugin` catalog 后，可以走
DSH 自己的市场安装流程：

> ⚠️ catalog PR 还没合，请用方式 1。

### 方式 3：本地开发

```bash
# 在本仓库根目录
npm install --legacy-peer-deps
npm run build          # tsc → lib/

# 装到 profile（指向本仓库）
cd ~/.dsh/profiles/<your-profile>
npm install /path/to/this/repo --legacy-peer-deps
```

`file:` 安装跟 npm 安装一样会触发 postinstall，从 GH release 拉 binary。

---

## 第一次安装会发生什么（postinstall）

`scripts/install-binary.js` 在 `npm install` 之后自动跑，步骤：

1. 读 `package.json` 里的 `binaryTag`（默认 `v0.7.7-nde.3`）
2. 从 `EvilJoker/computer-use-linux-zte-nde` 的 GitHub Release 拉
   `computer-use-linux-static-claude-nde-x86_64-unknown-linux-musl` 这个 asset
3. 校验 SHA-256（从同目录的 `.sha256` asset 读）
4. chmod +x
5. 跑 `--help` 冒烟测试

失败行为（warn-and-continue，不阻断 install）：
- 无 `binaryTag` → 跳过
- 网络错误 / GitHub 不可达 → 跳过，打印手动下载命令
- `--help` 退出码非 0 → 删 binary，install 报错（不阻断，但提示）
- SHA 不匹配 → 删 binary，install 报错

成功后产物落在：
```
~/.dsh/profiles/<your-profile>/node_modules/@ashtonsun/dsh-experimental-computer-use-linux-nde-mcp/bin/computer-use-linux-static-claude-nde-x86_64-unknown-linux-musl
```

---

## 用法示例

装好重启后，**新会话**直接跟模型说：

> "截一张当前桌面 → 用 `list_windows` 找 krdc → 用 `activate_window`
> 把它拉到前台 → 在它的地址栏里输入 `vnc://10.0.0.5`"

模型会自动拆解成：

```
mcp__computer-use-linux-nde-mcp__screenshot
mcp__computer-use-linux-nde-mcp__list_windows
mcp__computer-use-linux-nde-mcp__activate_window
mcp__computer-use-linux-nde-mcp__type_text
```

**不需要**手动告诉模型工具在哪——它会按 `mcp__*` 命名空间自动发现。

---

## 工具表（v0.7.7-nde.3）

| 工具 | 用途 |
|------|------|
| `doctor` | 报告 Nde/X11/KWin 环境 readiness（accessibility bus、screen reader、capabilities） |
| `setup` | 启用 GNOME accessibility（同 xwalk 版本，需 gsettings 切换） |
| `setup_accessibility` | 同上，明确开启 AT-SPI 总线 |
| `setup_window_targeting` | 安装/启用 GNOME Shell 扩展做窗口列表/聚焦 |
| `screenshot` | 截图；可选 target window 裁剪、`max_bytes` 上限 |
| `apps` | 列出 AT-SPI 看到的 app（每个应用一个 root accessible） |
| `list_windows` | KWin / GNOME Shell 窗口列表（window_id, pid, app_id, wm_class, bounds, focus state） |
| `list_apps` | 同 apps，但带 child_count、object_ref、capabilities 等结构 |
| `activate_window` | 焦点切换到指定窗口（window_id / pid / app_id / wm_class / title 多种 selector） |
| `focused_window` | 当前焦点窗口 |
| `move_window` | 移动窗口到桌面坐标 |
| `resize_window` | 调整窗口大小（先 unmaximize） |
| `scroll` | 滚轮；支持 element_index 或 window 中心坐标 |
| `click` | 单击（默认 element_index，可传坐标） |
| `drag` | 拖拽两点像素 |
| `type_text` | 键入文字（支持中文），可选 window_id / terminal 探测器定位 |
| `press_key` | 按键 / 组合键（含 Ctrl/Shift/Alt/Meta + F1-F12/方向等） |
| `set_value` | 设 AT-SPI editable 元素的值 |
| `perform_action` | 触发 AT-SPI 暴露的 accessibility action |
| `get_app_state` | 单次截屏 + AT-SPI 树快照（**Nde 上带 5s SnapshotCache**，避免 Chrome 反复被唤醒） |

合计 **21 个** tool（含 setup 一族，原始 README 写 18 是少了 setup 这 3 个；以
`tools/list` 实际返回为准）。

---

## Nde 特有的修复点（来自 binary 自身）

这些不是本 provider 加的，是 Nde 适配的 binary 自带：

1. **`list_windows` / `focused_window` / `activate_window` 在 Nde KWin 5.15.5
   上**走 caption+coords fallback**——KWin 没暴露真 uuid / internalId，所以
   用 caption + 坐标作为稳定 selector。
2. **`get_app_state` 是 cache-first**：每个 (app, pid) 5 秒内复用同一次 AT-SPI
   树，避免反复唤醒 Chrome 的 AT-SPI bridge（这是上一版本 Chrome 反复崩溃的
   根因）。
3. **`screenshot` 在 portal 没暴露时**回退到 X11 root window 的 `GetImage`，
   不依赖 xdg-desktop-portal。
4. **`NDE_AT_SPI_SCOPE_REQUIRED=1`** 让没传 scope 的 `get_app_state` 立即
   报错并给清晰提示，而不是 hang 整个 AT-SPI bus（bus hang 是 Nde 上另一类
   常见 deadlock）。

> 这些点都是 binary 层面的补丁，本 provider 只负责 spawn；要看补丁细节请
> 看 [`EvilJoker/computer-use-linux-zte-nde`](https://github.com/EvilJoker/computer-use-linux-zte-nde)。

---

## 升级

### 升级 binary（小版本，推荐每几周一次）

上游 binary 仓库出新 tag（比如 `v0.7.7-nde.4`）时，本 provider 需要
republish 一次：

1. 在本仓库改 `package.json`：
   ```json
   {
     "version": "0.2.10",                              // +1
     "binaryTag": "v0.7.7-nde.4"                       // 新 tag
   }
   ```
2. `git tag v0.2.10 && git push --tags` —— GH Actions 自动 build + publish
3. 各 profile 跑 `npm update @ashtonsun/dsh-experimental-computer-use-linux-nde-mcp`
   就完事。postinstall 重新拉新 binary。**不需要**改 patch.yml 任何东西。

### 升级 provider 本身（接口变化时）

接口微调（cordis mount 写法变了、provider API 改了）走普通 npm semver：

1. `package.json` 里 bump version
2. 更新 `cordis.patch.yml`（如果 mount 接口变了）
3. 发 tag + push

DSH 的 cordis-plugin-loader 在 dsh web 启动时读一次 patch——所以 patch 修改
必须**重启 dsh web** 才生效。

---

## 它不会做什么（避免误用）

- **不编译 binary**。binary 的源码 / 构建 / 打包由
  [`EvilJoker/computer-use-linux-zte-nde`](https://github.com/EvilJoker/computer-use-linux-zte-nde)
  自己负责。本仓库**不**包含 Rust 源码，不构建 binary，不处理上游 patch 合并。
- **不 fork 上游 agent-sh/computer-use-linux**。只是消费它上游的 Nde 配套
  release。
- **不兼容两个 computer-use provider 同存**。DSH 的 `ctx.computerUse.register`
  设计是独占的；如果你已经在用 `@agent-sh/computer-use-linux` 的 npm 包或
  本地 `mcp-computer-use` row，把那段 patch 拿掉再装本包。
- **不替你升级上游**。上游 agent-sh 出新版本后，本包要先等 Nde fork 跟上，
  然后本包 bump `binaryTag` 才能用新工具。

---

## Troubleshooting

### `spawn ./node_modules/.../bin/...musl ENOENT`

**原因**：binary 没下载。检查：

```bash
ls -la ~/.dsh/profiles/<profile>/node_modules/@ashtonsun/dsh-experimental-computer-use-linux-nde-mcp/bin/
```

如果是空的，跑一次手动安装：

```bash
cd ~/.dsh/profiles/<profile>
npm rebuild @ashtonsun/dsh-experimental-computer-use-linux-nde-mcp \
  --build-from-source=false
# 或手动跑 install-binary.js
node ./node_modules/@ashtonsun/dsh-experimental-computer-use-linux-nde-mcp/scripts/install-binary.js
```

### dsh web 重启后没有 `mcp__computer-use-linux-nde-mcp__*` 工具

1. `dsh --dump-config --profile <name>` 看 plugin tree 是不是真有
   `computer-use-linux-nde-mcp` 段。
2. 看 dsh web 启动日志有没有 `entry did not activate` 字样 + 错误原因。
3. 检查 `cordis.patch.yml` 里 `name:` 字段是不是写成了 `@eviljoker/...`
   ——scope 必须跟 npm 包名严格一致。错误写法会让 loader 找不到 module。

### binary `mcp` 子命令启动后秒退

通常是上一行 `Error: ... incompatible: ...` 字样被截。Linux DevTools 会让
binary 自带一个 frontend accessibility hold-open；如果用 `Ctrl-C` 或 SIGTERM
中断，会停在 accessibility 桥上不肯退出。直接 `kill -9 <pid>` 即可，下次
spawn 会自动重连。

### SHA 校验失败（postinstall）

binary 装了一个 `f9f639...` 之类的预期 SHA-256，下载完后会校验对不上。
常见原因：
- GH release tarball 损坏（极罕见，重装即可）
- 你改了 `binarySource` 但忘了改 `binaryTag`，或者反过来
- 用了 mirror（npmmirror）导致 asset 内容不一样 —— **必须**走 npmjs 源：
  ```bash
  npm install @ashtonsun/... --registry=https://registry.npmjs.org
  ```

---

## 开发本仓库

```bash
npm install --legacy-peer-deps
npm run build          # tsc → lib/
```

`tsconfig.json` 是 ES2022 / NodeNext 目标，编译产物 Node 22+ 直接吃，不用
runtime 转译。

### 发布

`git tag v0.2.5 && git push --tags` 触发 `.github/workflows/publish-npm.yml`：
`npm ci → tsc → smoke test → npm publish --provenance`。

需要的 secret：`NPM_TOKEN`（npmjs 上 publish 权限的 automation token，
bypass 2FA）。

### 单测

```bash
npm run build
node -e "import('./lib/index.js').then(m => console.log(m.name))"
# → experimental-computer-use-linux-nde-mcp
```

### 手动 mcp 协议冒烟

```bash
# 让 binary 走 mcp stdio 模式，stdio 上跑 JSON-RPC 2.0
./node_modules/@ashtonsun/dsh-experimental-computer-use-linux-nde-mcp/bin/computer-use-linux-static-claude-nde-x86_64-unknown-linux-musl mcp
```

发 `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"x","version":"0"},"capabilities":{}}}`
然后 `{"jsonrpc":"2.0","method":"notifications/initialized"}` + `tools/list`
就能看到 18+ 个 tool。

---

## 已知版本说明

| provider version | binary tag | 备注 |
|------------------|------------|------|
| 0.1.0 | v0.7.7-nde.1 | 初版；hard-coded binary 路径 |
| 0.2.x | v0.7.7-nde.3 | 引入 postinstall 自动拉 binary；`resolveCommand()` 解析相对路径 |

> ⚠ npm 上 0.2.5 是早期 bug 版本，tar 里包含了 binary（8.9 MB）。后续 0.2.7+
> 修正：binary 改由 postinstall 拉，tar 不再含 binary。如果你装到了 0.2.5
> 跑得起来，但请升到 0.2.7+。