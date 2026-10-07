# 数学题库 · V0.0

iPad-first 初一数学题库的第一阶段：**先验证 ChatGPT 订阅授权和一次完整模型调用，再开始题库。**

目前实现：响应式首页/设置、PWA manifest/离线页面、Windows 官方 OAuth、账户模型目录、统一模型选择、测试连接、断开连接。没有 OpenAI API key 入口或付费 API 回退。

**当前没有已验证的真实订阅连接。** 自动测试使用模拟账户和响应，Windows DPAPI 使用真实系统加密。题目上传、AI 分析、Supabase 题库和自适应练习尚未实现，页面中的相关入口明确标注后续版本。

## Windows 本机验证

需要 Node.js 24。双击 `start.cmd`，或在项目目录执行：

```powershell
npm ci --ignore-scripts
npm start
```

浏览器打开 [http://127.0.0.1:8010](http://127.0.0.1:8010)。必须使用 `127.0.0.1`，不能改成 `localhost`。端口冲突时设置 `$env:MATHBANK_PORT='8011'`，再启动。

1. 设置 → **Continue with ChatGPT**。
2. 在 OpenAI 官方页面登录并允许使用 ChatGPT 计划，授权后回到设置。
3. **刷新模型**，选择当前账户可用模型。
4. **测试连接**。此操作会消耗 ChatGPT 用量；收到完整 `response.completed` 后才记录成功。
5. “断开连接”删除本机凭据。到 ChatGPT 用量管理中撤销远端访问。

网络代理可通过 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 设置；启动命令启用 Node 环境代理。不要把代理凭据提交到仓库。服务仅监听本机，不能用于 iPad 局域网访问。

凭据默认保存在项目 `.local/profile.dpapi`，由 Windows DPAPI CurrentUser 加密，已被 `.gitignore` 排除；可用 `MATHBANK_DATA_DIR` 指定私有目录。主机标识随重启保留。凭据与 Windows 用户/设备关联；换设备需重新授权。登录事务只在本机内存保留 10 分钟，重启需重新发起登录。服务只支持一个运行进程、一个家庭账户；不适合作为多人云端服务。

## Vercel / iPad 页面

`npm run build` 生成 `dist/`，`vercel.json` 已配置静态部署。在 Vercel 导入仓库或该分支，Framework Preset 为 Other，构建命令 `npm run build`，输出目录 `dist`。**无需密钥或环境变量**。

这个云端版本只有界面/PWA，设置会显示“等待云端接入”，不会偷偷改用其他计费路线。iPad 打开实际 HTTPS 地址 → Safari 分享 → 添加到主屏幕。离线只能查看页面，不能登录或调用模型。浏览器尺寸检查不等于真机 Safari 验证，真机安装仍需用户验证。

官方开源动态授权目前要求 `http://127.0.0.1:<port>/auth/callback`。**本机验证通过不等于 Vercel 订阅调用获准；远程托管需申请并确认支持协议。** 截至 2026-10-07，用户尚未申请/不确定。为避免制造虚假的云端登录入口，本版本不部署 OAuth 服务到 Vercel。

申请草稿：[docs/hosted-access-application.md](docs/hosted-access-application.md)。资格通过后，再实现云端会话/加密令牌存储与 HTTPS 授权；最终验收是 Windows 关闭时 iPad 仍能使用。

## 开发与验证

```powershell
npm test
npm run build
```

测试覆盖 state/PKCE、回调一次性及会话绑定、nonce/账户匹配、权限不足、令牌轮换、账户模型目录、流中断/流内额度错误、Host/CSRF、真实 DPAPI 加密与重启恢复。没有读取其他程序登录凭据、自动登录或真实模型调用。

`src/oauth.js` 处理授权；`src/provider.js` 提供 `ChatGPTProvider`，保留 `analyzeQuestion / generateVariant / verifyQuestion / gradeAnswer` 接口，当前四个数学方法明确返回未实现。借鉴 pi 的 provider/认证生命周期分离，但授权以当前官方协议为准，不使用 ChatGPT backend-api，也不读取浏览器 Cookie。

完整需求和 V0.1–V0.5 顺序：[docs/requirements.md](docs/requirements.md)。

官方参考（核对日期 2026-10-07）：

- [开放范围与远程接入](https://developers.openai.com/siwc/token-sharing-open-source)
- [动态注册、授权、身份验证](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [账户模型目录与完整推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [预览请求限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [pi 的 provider/认证参考](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)
