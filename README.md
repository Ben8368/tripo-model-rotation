# Tripo Model Rotation

Tripo Studio 3D 模型旋转、录屏与批量导出用户脚本。

脚本适用于：

- Tripo Studio 的模型预览页面
- 固定帧率 MP4 旋转录制
- 透明背景 MOV（PNG 帧）导出
- 单帧 PNG 截图
- 白膜、贴图、法线材质切换
- 线框版本批量导出
- 明亮棚拍光照和白膜提亮
- 按工程名称管理导出文件

## 安装

先安装一个用户脚本管理器：

- [Tampermonkey](https://www.tampermonkey.net/)
- [Violentmonkey](https://violentmonkey.github.io/)

然后点击下面的安装链接：

**[安装 Tripo Model Rotation](https://raw.githubusercontent.com/Ben8368/tripo-model-rotation/master/tripo-model-rotation.user.js)**

也可以打开脚本文件的 [GitHub 页面](https://github.com/Ben8368/tripo-model-rotation/blob/master/tripo-model-rotation.user.js)，点击 `Raw`，由用户脚本管理器接管安装。

## 自动更新

脚本元数据中已配置：

```text
@updateURL   https://raw.githubusercontent.com/Ben8368/tripo-model-rotation/master/tripo-model-rotation.user.js
@downloadURL https://raw.githubusercontent.com/Ben8368/tripo-model-rotation/master/tripo-model-rotation.user.js
@require     https://raw.githubusercontent.com/Ben8368/tripo-model-rotation/v3.9.6/dist/tripo-core.min.js
```

根目录脚本是很小的安装与更新入口，业务核心由 `@require` 从同一 GitHub 仓库的不可变版本标签加载。油猴管理器会缓存远程依赖，不需要注册额外 CDN 账号。

后续发布新版本时，更新 `package.json` 的版本号并执行 `npm run check`，构建器会让入口自动指向对应的 `v版本号` 标签。必须同时推送 `master` 和该版本标签，否则新入口无法取得核心文件。核心每次页面加载还会请求 `master/runtime-status.json`：仓库公开、状态启用且当前版本不低于 `minimumVersion` 时才启动，仓库改为私有后匿名请求失败，缓存核心在刷新后也会停止运行。Tampermonkey 或 Violentmonkey 会按自己的更新周期检查入口；也可以在用户脚本管理器中手动执行“检查更新”。

当前版本：`3.9.6`

`minimumVersion` 必须是稳定版本格式 `major.minor.patch`（例如 `3.9.5`），按三个数值段比较；缺失或格式无效时拒绝启动。该检查从 3.9.6 起生效，不能追溯修复已缓存的 3.9.5 或更早核心。当前最低版本配置保持 3.9.5，不随本次修复自动提高。

单文件备用包的更新和下载地址均指向 `dist/tripo-model-rotation.standalone.user.js`，后续升级仍保持单文件形式。已安装的旧备用包需要手动安装新版一次才能采用新的更新地址。备用包不依赖远程核心，但仍需通过上述在线运行状态检查，并非离线版本。

## 使用方法

1. 打开 [Tripo Studio Generate](https://studio.tripo3d.ai/workspace/generate)。
2. 等待模型预览器加载完成。
3. 页面右下角会出现“Tripo 旋转助手”面板。
4. 选择材质、旋转方向、圈数和时长。
5. 点击“匀速圈”“加速转场”或“截图当前画面”。
6. 首次导出时可为工程命名，文件名会自动带上工程和材质信息。

常用快捷键：

| 快捷键 | 功能 |
| --- | --- |
| `Alt+1` | 匀速圈 |
| `Alt+2` | 加速转场 |
| `Alt+S` | 截图 |
| `Alt+H` | 显示/隐藏面板 |
| `Esc` | 停止当前任务 |

## 导出说明

### 仅模型画面

这是推荐的录制方式。脚本使用 Tripo 的原生 Three.js/Tres 渲染入口按帧设置相机角度，并在渲染完成后采集画面，避免浏览器实时录屏造成的跳帧和角度漂移。

- 普通输出：固定帧率 H.264 MP4
- 透明输出：无损 PNG 帧封装为透明 MOV
- 不再用矩形遮罩擦除坐标轴，避免损伤模型像素；可识别的独立 DOM 坐标轴会在采集期间临时隐藏
- 可在后台继续等待原生渲染恢复

### 整个当前标签页

当前仅支持截图。单项截图选择保存位置后，需要再点击“开始共享”并选择当前标签页；这是浏览器对屏幕共享用户手势的要求。整标签页视频无法可靠保证每一帧与相机角度严格对应，因此脚本会在视频导出前提示切换回“仅模型画面”。批量导出选择为标签页时，也只能选择截图项目。

### 批量导出

点击“一键导出”旁边的下拉按钮，可以选择：

- 单帧截图、匀速圈、加速转场
- 白膜、贴图、法线
- 可选的线框版本

支持目录选择的浏览器会将批量文件保存到指定目录，并自动处理重名文件。

## 环境要求

推荐使用最新版 Chrome，并确保：

- 浏览器支持 WebCodecs，用于固定帧 H.264 编码
- 浏览器允许用户脚本管理器运行在 `studio.tripo3d.ai`
- 透明输出时，Tripo 模型 Canvas 必须支持 Alpha
- 使用整标签页截图时，允许浏览器共享当前标签页

脚本依赖的 `mp4-muxer` 已直接内嵌在远程核心构建物中，不会再向第三方 CDN 请求依赖。

## 数据与隐私

- 工程名称和导出设置保存在当前浏览器的 `localStorage` 中。
- 模型画面和导出文件在本地处理。
- 脚本不会上传模型或导出内容。
- 安装、更新和首次取得对应版本核心时，用户脚本管理器会访问 GitHub Raw 地址。

## 已知限制

脚本需要读取 Tripo Studio 当前页面的 Canvas、Vue 和 Tres/Three.js 渲染上下文。Tripo 前端升级内部结构后，可能需要同步适配。脚本找不到可靠渲染入口时会停止导出，避免生成错帧文件。

## 源码与构建产物

- `src/main.ts`：TypeScript 启动入口，通过运行门禁后启动页面功能。
- `src/runtime/`：运行门禁和最低版本比较。
- `src/types/settings.ts`：设置、导出类型、材质和逐帧计划的数据契约。
- `src/settings/`：默认配置、配置规范化和导出选项。
- `src/rotation/frame-plan.ts`：转场进度和确定性逐帧轨迹。
- `src/batch/`、`src/projects/project-url.ts`、`src/storage/`、`src/utils/`：批量任务规划、工程链接校验、工程记录存储解析、文件名和数值工具。
- `src/app.ts`：已迁移的页面集成代码，包括 DOM UI、Tripo/Tres 适配、录制、保存与取消流程。
- `src/userscript.meta.txt`：用户脚本元数据模板。
- `package.json`：唯一版本来源。
- `scripts/build.mjs`：esbuild 打包脚本。
- `tripo-model-rotation.user.js`：**自动生成的轻量安装入口，不要直接编辑**；通过 `@require` 加载 GitHub Raw 上的版本核心。
- `dist/tripo-core.min.js`：发布到 GitHub 版本标签的压缩核心，是远程依赖源。
- `dist/tripo-model-rotation.standalone.user.js`：完整单文件备用安装包，不依赖远程 `@require`。
- `tests/logic.test.mjs`：直接通过 TS 模块导出接口测试纯逻辑，覆盖未压缩和压缩构建。
- `tests/regression.test.mjs`：页面集成代码的回归测试，暂保留源码截取 harness。
- `tests/artifact.test.mjs`：用户脚本发布格式、运行门禁、模拟页面挂载和可重复构建检查。
- `tests/MANUAL.md`：真实浏览器验收清单。

构建将固定版本的 mp4-muxer 打包进远程核心，压缩代码并缩短局部标识符，移除业务注释，不生成 source map。
第三方 MIT 许可仍保留在核心、单文件备用包和 `THIRD_PARTY_NOTICES.md` 中。
为保证浏览器及 Vue/Three.js 集成稳定，不混淆属性名、不使用 eval、自防御或反调试代码。

### 能否让安装包不暴露源码？

**可以让构建产物不同于可读源码，但不能让客户端 JavaScript 真正保密。**
用户脚本管理器和浏览器都能读取最终 JS；压缩/混淆只能提高理解成本，无法阻止格式化、调试或逆向。
不要把密钥、令牌或必须保密的算法放入客户端脚本。

如果不希望公开可维护源码，建议将源码放在私有仓库，另设仅发布入口和 `dist/` 构建产物的公开仓库（迁移时需调整更新 URL）。
现有公开 Git 历史中的旧源码不会因压缩新版本、删除文件而消失，已有副本也无法收回。
真正需要保密的逻辑应放在服务端；这会改变当前“本地处理、不上传”的架构和隐私约定。

## 开发与发布

需要 Node.js 22 或更新版本。

```powershell
npm ci
npm run check
```

`npm run check` 先执行 `tsc --noEmit`，再生成轻量入口、GitHub 远程核心和单文件备用包，执行回归测试并做语法检查。
依赖由 `package-lock.json` 锁定；运行时只访问本仓库的 GitHub Raw，不访问第三方 CDN。
mp4-muxer 5.2.2 已被上游标记为 deprecated，本次保留原版本以避免同时变更视频封装行为，后续应单独评估迁移。

发布步骤：

1. 修改 `src/`，补充测试。
2. 修改 `package.json` 的版本号，同步本文版本说明。
3. 执行 `npm run check`，按 `tests/MANUAL.md` 在 Tripo 实际验收。
4. 同时提交源码、锁文件、根目录入口和 `dist/` 构建物。
5. 创建与 `package.json` 完全一致的版本标签，例如 `git tag -a v3.9.6 -m "v3.9.6"`。
6. 使用 `git push --atomic origin master v3.9.6` 同时发布入口和远程核心。

不要移动或复用已经发布的版本标签。入口引用版本标签是为了让同一入口版本永久取得同一份核心文件，避免 `master` 更新或缓存造成入口与核心错配。

### TypeScript 迁移状态（已完成）

项目始终以用户脚本形式使用。TS 类型仅用于开发期检查，esbuild 最终仍输出浏览器可执行的 JavaScript IIFE，安装入口、远程核心和 standalone 三种产物的关系保持不变。

已将启动门禁、配置规范化、导出选项、旋转计划、文件名、工程链接校验、工程记录存储解析及批量任务规划迁入严格检查的 TS 模块。网络 JSON 和本地配置以 `unknown` 进入边界，再执行运行时校验；类型不能代替页面兼容性及浏览器能力检查。

`tsconfig.json` 启用 `strict: true`；同时为第三方 Vue/Tres/Three.js 私有运行时边界关闭隐式 any 和严格 null 检查。`src/app.ts` 已纳入 TypeScript 编译，页面适配仍须保留运行时探测。

整个应用现已使用 TypeScript 源码；页面适配层继续做运行时探测，不引入第二份 Three.js 运行时。

本次重构保留配置存储键、配置版本、导出格式和 `mp4-muxer` 版本。当前 package 版本仍为 3.9.6，修改后的本地产物尚未发布；正式发布需按上述流程使用新的版本号和新标签，不能覆盖已有 `v3.9.6`。

### 3.9.6 审查修复

- PNG 和视频共用保存状态跟踪；首次写入、自动重试、保存恢复期间，刷新或关闭页面会请求浏览器离页确认，成功保存或明确放弃后释放保护。浏览器崩溃、强制关闭及浏览器不显示确认的情形不受保证。
- 启动时校验最低版本，拒绝缺失或非法版本策略。
- 单文件备用包更新到自身，不再升级成远程依赖入口。
- 保留用户明确保存的空批量选择，刷新后不再重新全选。
- 补充源码及压缩版本回归测试和安装包运行门禁测试。

### 3.9.5 发布结构

- 根目录安装脚本改为轻量入口，通过 `@require` 从 GitHub Raw 加载核心。
- 核心 URL 固定到 `v版本号` Git 标签，不直接依赖可变的 `master` 核心文件。
- 生成完整单文件备用包，便于手动安装和排查远程核心加载问题；仍依赖 GitHub Raw 运行状态检查。
- 自动测试覆盖入口元数据、远程核心、备用包和可重复构建。
- 增加 GitHub Raw 公开状态检查；仓库私有后，用户刷新页面时脚本不再启动。

### 3.9.3 修复

- 停止非录制旋转时结束动画 Promise，释放导出占用状态。
- 为整个导出任务增加取消状态，覆盖批量截图、材质切换及帧等待；保留已保存文件与保存恢复流程。
- 去掉破坏模型像素的坐标轴矩形遮罩，临时隐藏可识别的 DOM 叠层并恢复原样式。
- 单项标签页截图重新获取共享操作手势，等待共享新帧；共享失败时释放媒体流。
- 拆分源码与压缩安装包，加入自动测试和构建流程。

仓库地址：[Ben8368/tripo-model-rotation](https://github.com/Ben8368/tripo-model-rotation)

## 许可

MIT License
