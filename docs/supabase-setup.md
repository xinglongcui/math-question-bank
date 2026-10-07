# V0.2 历史接入记录（已暂停）

用户已选择取消家庭邮箱登录、使用 Windows 本机题库。以下为历史配置与未来恢复时的验收参考，当前页面没有这些入口。客户端实现移至 future/supabase/，不会进入网页构建。未删除既有 Supabase 项目、数据或权限策略。

指定项目：https://hlxishwsrarkvjjvackd.supabase.co。2026-10-07 已完成空项目检查，执行题库迁移和事务回滚的权限测试。两张表 RLS 已启用，math-originals 桶为私有，测试账号与题目无残留。迁移已通过控制台手工执行，勿重复执行同名 CREATE TABLE；未写入 CLI migration history。

## 历史登录流程（当前不启用）

1. 本机题库「设置 → 家庭题库」填写家庭邮箱，发送登录邮件。请求被接受不等于邮件送达。保留邮箱验证，不通过关闭邮箱确认解决邮件问题。
2. Site URL 已改为 https://math-question-bank-nu.vercel.app/，允许返回地址包含该站点 /#settings，以及 http://127.0.0.1:8010/#settings。在发送邮件的同一浏览器打开链接，PKCE 依赖该浏览器的登录事务。首次邮件发送发生于修正地址之前，旧邮件可能返回 localhost:3000。
3. 邮件提供验证码时，可输入验证码完成登录。当前控制台提示需要自定义 SMTP 才能编辑模板，因此尚未改成验证码邮件。配置自己的 SMTP 后，可以在 Confirm signup 和 Magic link or OTP 模板展示 {{ .Token }}，让用户回到发起登录的浏览器输入。
4. 登录后点「检查题库连接」，再勾选「将之后新上传的题目保存到云端私有题库」。本机旧题不会自动迁移，退出登录清空页面私有记录。
5. 原图上传、重新打开记录、刷新及重新登录后读取，均需实际验收后再用于学生数据。AI 分析仍由 Windows 本机已授权模型执行，Vercel 远程 AI 未开放。

正式部署后添加实际 HTTPS 域名的精确返回地址，并更新 Site URL，不设置任意域名通配符。公开 URL/publishable key 给网页使用，secret/service_role 不进入浏览器、仓库或聊天。

## 邮件服务

Supabase 默认 SMTP 仅允许向组织团队邮箱发送，并有严格限流。普通家庭邮箱可能需要自定义 SMTP。遇到 email_address_not_authorized 时，到 Auth → Emails → SMTP Settings 配置自己的邮件服务；SMTP 密码直接在控制台输入，不在聊天发送。验证码模板只能改变内容，不能解决投递权限。

参考：[官方 SMTP 说明](https://supabase.com/docs/guides/auth/auth-smtp)、[邮件模板](https://supabase.com/docs/guides/auth/auth-email-templates)。

## 数据与权限

math_questions 保存来源、日期、编辑版分析、审核状态和版本；math_question_analyses 只追加 AI 原始分析。知识点与数学方法分别保存为数组并分别索引。ChatGPT 与 Supabase 家庭账号独立管理。

原图桶私有，限 8 MB JPEG/PNG/WebP，路径为用户 ID / 题目 ID / original.扩展名，不覆盖原图。通过登录会话或五分钟签名 URL 查看，链接过期后重新打开题目。用户只能读取/编辑自己的记录，关联分析使用带 owner_id 的复合外键。修改已审核内容退回待审核，实际身份由 Supabase Auth 验证，不能由表单邮箱决定。

图片上传和数据库写入不是一个事务：先建记录再上传，失败时保留可修复记录；图片成功但最终确认失败时，重新打开可恢复状态。原图不启用 upsert。当前列表展示最新 100 条，尚无分页；本机也限 100 道，批量题库阶段需增加分页。

## 验收边界

自动测试使用 PGlite PostgreSQL 引擎执行同一迁移与 RLS 断言，附带刻意宽松的原有 Storage 策略检查防护。真实项目执行了表权限测试与匿名 REST 拒绝检查，不能据此声称 Storage HTTP 上传已通过。

仍需两个实际账号验证 REST/Storage：未登录不可读取，A 不可查看/写入 B 的题目和图片，原图不可覆盖，错误类型/超大照片拒绝，重新登录仍能读取自己的记录，网络中断后恢复。只用明确标记的公开例题，不自动上传已有学生照片。

参考：[RLS 与权限](https://supabase.com/docs/guides/database/postgres/row-level-security)、[私有存储访问](https://supabase.com/docs/guides/storage/security/access-control)。
线上页面已通过 Vercel Drop 文件夹上传部署，当前不连接 Git。后续 GitHub 推送不会自动更新网站。新的 dist/vercel.json 保留头部配置，用于下一次文件夹部署。家庭登录的产品方案正在按用户简化登录的要求重新确认；当前未开放匿名访问私有数据。
