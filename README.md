# 数学题库 · V0.1

iPad-first 初一数学题库：ChatGPT 订阅接入已在本机实测，继续完成一道题的上传、分析和人工审核。

目前实现：响应式首页/设置/上传/原题列表、PWA、Windows 官方 OAuth、账户模型目录、统一模型选择、照片保存、AI 分析、修改草稿、人工审核和分类筛选。按用户最新选择，当前取消家庭邮箱登录，使用 Windows 本机题库；云端同步暂停。Supabase 历史实现保留于 future/supabase/，已建项目和数据不删除。没有 OpenAI API key 入口或付费 API 回退。

**2026-10-07 已完成真实本机订阅及公开例题图片分析验证。** GPT-5.6-Sol 返回“数学题库连接成功”，收到 `response.completed`；图片例题得到答案 x = 4。这证明当前账户的本机调用链可用；Vercel 远程订阅接入尚未获批。Supabase 接入暂停，变式与自适应练习尚未实现。

## Windows 本机验证

需要 Node.js 24。双击 `start.cmd`，或在项目目录执行：

```powershell
npm ci --ignore-scripts
npm start
```

浏览器打开 [http://127.0.0.1:8010](http://127.0.0.1:8010)。必须使用 `127.0.0.1`，不能改成 `localhost`。端口冲突时设置 `$env:MATHBANK_PORT='8011'`，再启动。

1. **先用 Edge 或 Chrome 打开本机题库地址**，在设置点 **Continue with ChatGPT**。官方流程使用系统浏览器；不以 Codex 内嵌预览作为登录验证环境。
2. 在 OpenAI 官方页面登录并允许使用 ChatGPT 计划，授权后回到设置。
3. **刷新模型**，选择当前账户可用模型。
4. **测试连接**。此操作会消耗 ChatGPT 用量；收到完整 `response.completed` 后才记录成功。
5. “断开连接”删除本机凭据。到 ChatGPT 用量管理中撤销远端访问。

若官方账户选择页显示 `400 Invalid content type: text/html`：说明该页未得到预期格式的响应，不能据此判断订阅权限。不要只复制已有授权 URL 到另一浏览器，因为回调与发起浏览器绑定；应在 Edge/Chrome 从题库设置重新发起。若系统浏览器也失败，继续检查网络/浏览器会话；根因尚未确认。本应用无法直接修复 OpenAI 域名内的页面。

启动脚本优先使用已有 `HTTP_PROXY` / `HTTPS_PROXY`；没有环境代理时，自动沿用已启用的 Windows HTTP/HTTPS 系统代理，仅传给当前 Node 子进程，不修改系统或输出代理地址。回环请求始终绕过代理。PAC/SOCKS 不会自动转换，需手动提供可用 HTTP 代理。不要把代理凭据提交到仓库。服务仅监听本机，不能用于 iPad 局域网访问。

凭据默认保存在项目 `.local/profile.dpapi`，由 Windows DPAPI CurrentUser 加密，已被 `.gitignore` 排除；可用 `MATHBANK_DATA_DIR` 指定私有目录。主机标识随重启保留。凭据与 Windows 用户/设备关联；换设备需重新授权。登录事务只在本机内存保留 10 分钟，重启需重新发起登录。服务只支持一个运行进程、一个家庭账户；不适合作为多人云端服务。

## Vercel / iPad 页面

已上线的 [Vercel 页面](https://math-question-bank-nu.vercel.app/) 仍是此前上传的版本，尚未同步本次取消家庭登录与空题干修复。当前请使用 Windows 本机地址。

`npm run build` 生成 `dist/`，仅提供响应式页面预览，不上传、保存或分析云端照片。`vercel.json` 配置静态部署；Framework Preset 为 Other，构建命令 `npm run build`，输出目录 `dist`。无需密钥或环境变量。构建不包含 future/ 的 Supabase 客户端代码。

本阶段本机服务必须运行，iPad 独立使用暂缓。离线仅缓存页面外壳，私有题目和照片不进入 Service Worker 缓存。浏览器尺寸检查不等于真机 Safari 验证。

官方开源动态授权目前要求 `http://127.0.0.1:<port>/auth/callback`。**本机验证通过不等于 Vercel 订阅调用获准；远程托管需申请并确认支持协议。** 截至 2026-10-07，用户尚未申请/不确定。为避免制造虚假的云端登录入口，本版本不部署 OAuth 服务到 Vercel。

申请草稿：[docs/hosted-access-application.md](docs/hosted-access-application.md)。资格通过后，再实现云端会话/加密令牌存储与 HTTPS 授权；最终验收是 Windows 关闭时 iPad 仍能使用。

## 开发与验证

```powershell
npm test
npm run build
```

测试覆盖 state/PKCE、回调一次性及会话绑定、nonce/账户匹配、权限不足、令牌轮换、账户模型目录、流中断/流内额度错误、Host/CSRF、真实 DPAPI 加密与重启恢复。自动测试不消耗真实账户用量；真实图片验收使用明确标记的公开生成例题。没有读取其他程序登录凭据。

`src/oauth.js` 处理授权；`src/provider.js` 提供 `ChatGPTProvider`，保留 `analyzeQuestion / generateVariant / verifyQuestion / gradeAnswer` 接口，`analyzeQuestion` 已实现图片分析，其余三个数学方法明确返回未实现。借鉴 pi 的 provider/认证生命周期分离，但授权以当前官方协议为准，不使用 ChatGPT backend-api，也不读取浏览器 Cookie。

完整需求和 V0.1–V0.5 顺序：[docs/requirements.md](docs/requirements.md)。

Supabase 历史配置与验收：[docs/supabase-setup.md](docs/supabase-setup.md)。此功能已暂停，当前页面没有家庭邮箱登录或云端保存入口。既有云端项目、数据库、权限策略和本机记录保留。

官方参考（核对日期 2026-10-07）：

- [开放范围与远程接入](https://developers.openai.com/siwc/token-sharing-open-source)
- [动态注册、授权、身份验证](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [账户模型目录与完整推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [预览请求限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [pi 的 provider/认证参考](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)

## 上传、分析与人工审核

本机页面左侧点击「上传题目」→ 拍照或选择相册 → 填来源/日期 →「保存原图」→「AI 分析题目」。分析会使用设置中已验证的统一模型及 ChatGPT 订阅用量。JPEG/PNG/WebP 最大 8 MB，HEIC 先转为兼容格式；PDF 后续开放。

题干、表达式、第一突破口、步骤、答案、两套标签、难度、易错点均可修改。「保存修改草稿」保留未完成审核；解决所有待确认条件，并勾选已核对后，才能「确认并保存审核」。AI 原始分析单独保留。修改已确认记录会重新进入待审核，避免旧审核状态跟随新内容。

原图和题目记录分开使用 Windows DPAPI 加密，保存于 `.local/questions/`，原图不压缩、不覆盖。服务重启后可在「我的题库」重新打开记录。此阶段最多 100 道题，单一家庭/进程，本机记录未同步到 Supabase，不能当成云端备份。照片、账户令牌、题目内容不会进入 GitHub 或 Vercel 构建。

AI 返回空题干时，保存为条件待确认并保留原始 AI 回复；用户补齐题干和待确认内容后才能审核。格式错误、流中断或额度不足会保留原图；不会自动标为已审核。人工确认不是独立验题，也不会提高 S0–S3 掌握状态。
