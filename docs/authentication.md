# Tripo Studio 密码登录与会话续期调研

调查日期：2026-09-29。适配脚本版本：3.9.8。

## 证据与边界

依据当前登录页已加载、从公开 CDN 下载审阅的前端代码：

- `https://tripo-webapp-assets.tripo3d.ai/studio-prod/_nuxt/Cdzw2Xdy.js`：密码弹窗调用 `$auth.login.submitPassword({ email: email.trim(), password })`。
- `https://tripo-webapp-assets.tripo3d.ai/studio-prod/_nuxt/ClD1QjXJ.js`：认证 SDK、Ory 客户端、JWT 缓存及刷新实现。
- `https://tripo-webapp-assets.tripo3d.ai/studio-prod/_nuxt/Dx6WAnYa.js`：Nuxt 把 `$nuxt` 挂在 Vue app 上，并通过 provide 暴露 `$auth`。

本次浏览器接口不提供 Network 请求/响应捕获。尝试点击用户已填写的原生“继续”后，登录弹窗保持原样，未观察到成功或错误提示。因此上述属于当前前端代码验证，**不等于已抓取该账户的真实登录请求或验证登录成功**。未读取密码值，未导出任何 Cookie、CSRF、设备 ID 或 JWT。脚本适配器的真实页面端到端验证仍需在安装后完成。

## 请求顺序

域名来自网站运行时配置的 `authUrl` / `apiUrl`。未证实生产域名时不硬编码、不猜测。

1. `GET {authUrl}/self-service/login/browser`：创建 browser login flow，获得 `id` 和 `ui.nodes`。在节点 attributes 中查找 `name === "csrf_token"` 的 value。
2. `POST {authUrl}/self-service/login?flow=<id>`：JSON body：

   ```json
   {
     "csrf_token": "<来自本次 flow>",
     "identifier": "<邮箱>",
     "method": "password",
     "password": "<用户输入>",
     "transient_payload": {
       "device_id": "<站点 SDK 设备标识>",
       "journey_id": "<可选旅程标识>"
     }
   }
   ```

   `transient_payload` 及其中字段按 SDK 上下文按需添加。请求使用 `Content-Type: application/json`、`credentials: include`，CSRF 必须与对应 flow / Cookie 一起使用。密码页直接创建登录 flow，不先调用验证码路径的 `check-identifier`。
3. SDK 成功后记录原生 password login signal，让页面原有逻辑处理登录后的状态同步。脚本不伪造这类信号。
4. `GET {apiUrl}/v2/studio/studio/whoami?tokenizeAs=default_jwt`：通过现有 Cookie 获取响应中的 `tokenized`（JWT）。SDK 维护自己的内存缓存。生产配置中的会话 Cookie 名为 `ory_kratos_session`；前端源码不能证明其当前 HttpOnly / SameSite / Expires 属性或实际寿命。

SDK 同时包含 Ory 标准 `GET {authUrl}/sessions/whoami`，但当前站点自定义的 token 刷新走的是上述 Studio 接口，二者不要混用。

## JWT 刷新与 Cookie 保活的区别

当前 SDK 在 JWT 距 `exp` 不足 60 秒时，`token.get()` 会触发刷新；尚未持有 token 时返回空。`token.refresh()` 可主动刷新，内部合并并发请求，并对失败实施约 1 秒的短暂退避。SDK 清除 token 后不会接纳更早刷新请求的结果。

这些代码只证明能够换取新的访问令牌，不能证明服务器会延长登录会话。没有观察到响应中的 `Set-Cookie` 或会话 `expires_at` 是否变化。不要通过重复 password login flow、修改 Cookie 到期日期，或伪造 refresh_token 来模拟“永久登录”。

## 当前脚本实现（3.9.8）

- 从原生 Nuxt app 获取认证 SDK；复用密码登录、令牌缓存和登录事件。
- 用户主动勾选“记住账号密码”并保存时，在站点 localStorage 保存明文邮箱、密码和开关；输入框不回填保存的密码。明确告知同站点代码可读取。未保存的密码只用于本次手动登录。
- 自动保活默认关闭；开启后约每 5 分钟调用 token.refresh()。刷新失败后使用运行时 authUrl 拼接 /sessions/whoami，credentials: include，12 秒超时，不允许重定向。只接受 HTTPS 的 tripo3d.ai 及其子域；其他域返回未知状态。
- 会话探测只有 401 判定为未登录。403、429、5xx、离线和不认识的响应均不自动提交密码，刷新重试采用 5～30 分钟退避。
- 确认未登录后提交保存密码，再刷新 JWT。密码请求失败、后续刷新失败或页面在登录中关闭时停止自动重试，需人工处理后重新保存设置开启。
- Web Locks 互斥账号请求；localStorage 保存跨页面共享的下次检查时间和登录中标记。无 Web Locks 时不自动运行。停止/更换凭据后，未发送的自动登录不再继续；已发出请求不能撤回。
- 订阅原生 signal.onLogout()，主动退出登录时关闭自动保活。不支持此事件时不自动运行。
- 离线、录制导出或保存期间暂缓；每 30 秒做本地调度检查，实际正常网络刷新间隔约 5 分钟。可见性恢复、online、pageshow 时检查到期任务。
- 不复制 Cookie、不返回或持久化 JWT，不输出认证错误原文。网站本身的日志策略不由脚本控制。

## 验证边界

自动化测试使用模拟 SDK 和模拟 HTTP 响应，覆盖节流、多页面竞争、故障退避、凭据删除、登录中断和会话分类。真实 SDK 挂载入口、生产 authUrl 可达性/CORS、账号登录同步及跨日运行仍需浏览器实际验收。

自动重登可以在会话过期后恢复登录，不等于延长服务器 Cookie 的绝对寿命。浏览器关闭或所有 Tripo 页面关闭时脚本无法运行。验证码、账号风控、强制重新验证均需用户处理。
