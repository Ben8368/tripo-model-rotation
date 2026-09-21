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
```

后续发布新版本时，只需更新脚本版本号并推送到 `master` 分支。Tampermonkey 或 Violentmonkey 会按自己的更新周期检查 GitHub Raw 文件；也可以在用户脚本管理器中手动执行“检查更新”。

当前版本：`3.9.2`

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
- 可隐藏右上角坐标轴
- 可在后台继续等待原生渲染恢复

### 整个当前标签页

当前仅支持截图。整标签页视频无法可靠保证每一帧与相机角度严格对应，因此脚本会在视频导出前提示切换回“仅模型画面”。批量导出选择为标签页时，也只能选择截图项目。

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

脚本依赖的 `mp4-muxer` 已直接内嵌，不需要运行时从 CDN 加载额外脚本。

## 数据与隐私

- 工程名称和导出设置保存在当前浏览器的 `localStorage` 中。
- 模型画面和导出文件在本地处理。
- 脚本不会上传模型或导出内容。
- 安装和更新时，用户脚本管理器会访问 GitHub Raw 地址。

## 已知限制

脚本需要读取 Tripo Studio 当前页面的 Canvas、Vue 和 Tres/Three.js 渲染上下文。Tripo 前端升级内部结构后，可能需要同步适配。脚本找不到可靠渲染入口时会停止导出，避免生成错帧文件。

## 开发与发布

修改脚本后：

1. 同时更新用户脚本头部的 `@version` 和 `SCRIPT_VERSION`。
2. 执行语法检查：

   ```powershell
   node --check .\tripo-model-rotation.user.js
   ```

3. 提交并推送到 `master` 分支：

   ```powershell
   git add .
   git commit -m "更新脚本"
   git push origin master
   ```

仓库地址：[Ben8368/tripo-model-rotation](https://github.com/Ben8368/tripo-model-rotation)

## 许可

MIT License
