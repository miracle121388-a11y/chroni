# ASC CLI 发布操作

核心参考：rorkai/app-store-connect-cli-skills，精确版本见 [来源与维护](sources.md)。`asc` 是社区工具，不是 Apple 官方 CLI。以下命令用于发现正确路径；实际执行前以已安装版本的叶子命令 `--help` 为准，不能默认所有历史命令仍然存在。

## 工具与认证预检

1. 检查 `command -v asc`，从本机帮助确认版本查询方式，记录二进制来源和版本。缺失时从上游链接确认维护者和发行方式，按环境授权规则安装；不要执行来源不明的安装脚本。不安装整套上游 skills 作为运行本 skill 的前提。
2. 先看 `asc --help`、`asc auth status`；需要定位能力时用帮助中存在的 `asc search`、`asc capabilities`、`asc schema`。缺失能力则用已有官方接口、Xcode/Transporter 或 App Store Connect UI。
3. API key 认证、Apple Account web session、Safari 登录是三种不同状态。优先复用 Keychain 中现有 API profile，并核验其可访问的目标；profile 名不表示应用级权限隔离。不要打印环境变量、P8 内容或完整认证日志。
4. 公共 API 不覆盖的具体步骤才考虑 `asc web`。先检查缓存会话、provider 和权限，不为了准备工作退出登录。一个账号同一时刻只维持一个交互登录流程；密码/验证码由用户在可信入口输入。浏览器已登录不能证明 CLI web session 可用。
5. 公司尚无 API key 时，继续可执行的 UI 工作；新建 key 会增加访问权限，须说明用途、实际角色、团队/应用范围并取得适用的授权，使用最小可用权限及仓库外受保护路径。API 私钥不能代替应用签名私钥。

## 确定目标，避免跨应用写入

显式传 app/platform/version 或确切资源 ID，自动化输出明确指定 JSON。查询完整集合时使用该命令支持的分页参数；不能把第一页无结果当作不存在。

```bash
asc apps list --bundle-id "$RELEASE_BUNDLE_ID" --output json
asc versions list --app "$RELEASE_APP_ID" --paginate --output json
asc builds list --app "$RELEASE_APP_ID" --sort -uploadedDate --limit 10 --output json
asc review submissions list --app "$RELEASE_APP_ID" --paginate --output json
```

Bundle ID 字符串、Developer Portal Bundle 资源 ID、ASC App ID、版本字符串、Version ID、build number、Build ID、Submission ID 各不相同。只在结果唯一且关联吻合时继续；多个结果要进一步限定，不能选第一个或全局 latest。

平台从项目确定：macOS 通常为 `MAC_OS`，iOS/iPadOS 共用的商店平台为 `IOS`（设备支持另行记录），在相应命令帮助中核准。某个高层命令若无平台参数，必须验证它能从指定的资源推导目标平台，否则换明确平台的操作；绝不默认 iOS。

## 元数据同步

- 在不会覆盖本地未保存改动的位置 pull 远端快照；保留项目既有资料，避免维护两套互相冲突的文案。
- canonical 格式：`metadata/app-info/<locale>.json` 和 `metadata/version/<version>/<locale>.json`。版权是版本字段，不是 localization 字段。遇到多个 app-info 时先解析确切 ID。
- 执行 `asc metadata validate`，再对 `push`/`apply` 执行 dry-run；检查目标应用、语言、字段差异和删除。远端语言不在本地不意味着用户希望删除。
- 仅当项目已用 Fastlane 才走 migrate；校验正文 `valid/errorCount` 和退出码，部分命令退出 0 仍可能报告无效，导入失败也可能已经部分写入。
- 截图先读取当前支持规格，验证真实截图、尺寸与 alpha，按明确顺序上传；不要硬编码本案例的 2880×1800 到其他平台。

## 选择一条发布路径

| 当前目标 | 优先路径 | 注意 |
|---|---|---|
| 仅上传产物 | `asc builds upload` | iOS IPA 与 macOS PKG 参数不同；不能暗加 submit |
| 已有构建，整理版本 | `asc release stage` | 先 dry-run，再按实际授权执行 confirm；阶段本身不送审 |
| 已准备好的单一版本送审 | `asc review submit` | 先验证和 dry-run，检查确切 Build ID |
| IPA/Xcode 项目端到端发布 | `asc publish appstore` | 只在帮助确认适用时使用；不能把 Electron PKG 强塞进 IPA 路径 |
| 已有草稿或多个审核项目 | 低层 `asc review` | 检查并复用草稿，按 item type + resource ID 去重 |

已开始一条路径后不切另一条高层路径重新创建提交。先读现有资源再恢复。

macOS 上传示例（参数经本机帮助确认后使用）：

```bash
asc builds upload --app "$RELEASE_APP_ID" --pkg "$RELEASE_PKG" \
  --version "$RELEASE_VERSION" --build-number "$RELEASE_BUILD_NUMBER" --wait
```

PKG 的 version/build number 不能凭文件名猜测，读取包中实际值；上游此路径要求显式提供两者。原生 Xcode 项目可用现有 CI、`asc xcode archive/export` 或 xcodebuild；Electron 仍用项目 MAS 打包命令。构建号建议先查询 `asc builds next-build-number`，但它不是全局锁：同一应用/平台的发布流水线应串行，避免并发上传占用相同号码。

上传状态不确定时先查已处理构建和进行中的上传，不能立即重新上传。等待使用有界 timeout/poll 设置，超时保存 ID 和当前状态，恢复时继续查询。

## 送审门槛

附加正确构建后，使用当前版本支持的命令：

```bash
asc validate --app "$RELEASE_APP_ID" --version "$RELEASE_VERSION" --platform "$RELEASE_PLATFORM" --output json
asc review doctor --app "$RELEASE_APP_ID" --version "$RELEASE_VERSION" --platform "$RELEASE_PLATFORM" --output json
asc builds info --build-id "$RELEASE_BUILD_ID" --output json
asc versions view --version-id "$RELEASE_VERSION_ID" --include-build --include-submission --output json
```

构建需为有效状态，所有 blocking issues 均已解决。警告按内容分类：隐私发布状态等未获证实的必要事实仍阻止送审；非阻塞建议记录处理决定即可，不一律套 strict 造成无谓阻塞。初次 stage 前“尚未关联构建”是待完成步骤，不能误判为失败事故。

`--dry-run`/`--confirm` 是工具机制，不等于需要每次重新询问用户：检查计划符合已授权目标后即可运行。它们也不能代替新权限、法律声明等实际需要的确认。禁止绕过失败检查强行提交。

## 公共 API 的边界

- App Privacy：公共 API 校验的 advisory 不能证明隐私已发布。可用 `asc web privacy pull → plan → apply → publish` 或 UI；核对答案与适用确认后才 publish，apply 成功不等于发布。
- 新 App 记录、首次地区可用性、首次订阅审核挂载：先查 capabilities 与当前帮助；不支持则切 web/UI，不伪造 API 覆盖。
- 价格和销售范围是不同资源。首次创建 availability 与后续 edit 不同，逐项核验“新增地区是否自动加入”，不默认扩展市场。

## 有内购、订阅或 Game Center 时

运行当前支持的 `asc validate iap` / `asc validate subscriptions`；检查合同状态、价格、地区、语言、审核截图、购买/恢复/取消及权益行为。免费主应用也可能有付费商品。订阅的条款与隐私入口须按现行规则核验。

首次订阅挂载可能需要 web/UI，不能用版本化产品 API 代替。商品 ID、商品版本 ID、订阅组 ID、组版本 ID 分开记录。已有草稿先列 items；仅添加缺失且本次需送审的资源。Game Center 功能存在才准备组件版本。多项目提交操作顺序：准备各项目 → app 版本通过门槛 → 解析并复用唯一草稿 → 按类型和 ID 去重添加 → 读回审核项目清单 → 提交。任一归属不明确就诊断，不能另建草稿逃避冲突。

## 故障、重试和恢复

- 同时看退出码、JSON 的 success/valid/status/errors、分步骤结果及远端读回；stdout 非空或命令成功退出均不是唯一证据。
- 401 先核验认证与过期，403 核验角色/账号；429 尊重 Retry-After 并有限退避。网络错误后的写操作先查实际结果，不能盲目重放。
- review status/history 用精确 app/platform/version/submission 查询。已在审核中不再提交，排队久不自动撤回。撤回需用户明确意图和准确 Submission ID。
- 已有唯一匹配 `READY_FOR_REVIEW` 草稿则复用；没有匹配草稿和活跃提交才创建；多个候选或版本归属冲突则停止依赖写入。
- 已建立 CI 才考虑 `.asc/workflow.json`，先 validate 和 dry-run；不为一次发布强行改造流水线。记录失败步骤和已完成步骤，恢复不重复副作用。
