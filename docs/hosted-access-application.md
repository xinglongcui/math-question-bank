# 远程订阅接入申请草稿

申请入口：[OpenAI Sign in with ChatGPT interest form](https://openai.com/form/sign-in-with-chatgpt-interest/)。申请由项目所有者自行提交，本项目未提交任何申请或代填个人信息。

能力选择：**Sign in and ChatGPT plan use for AI requests**。

仓库：[xinglongcui/math-question-bank](https://github.com/xinglongcui/math-question-bank)。Website URL 填实际部署后的 Vercel 地址。姓名、邮箱、组织等填写真实信息；个人项目不虚构公司身份。表单面向合作伙伴，是否接受家庭自用项目、是否获批及审批时间均未确认。

产品说明草稿（可按表单语言直接修改）：

> Math Question Bank is a public, open-source, personal family learning application for first-year junior high school mathematics. It is designed for iPad Safari as a PWA, with a web frontend hosted on Vercel and private question and image storage planned on Supabase. With the account holder's explicit permission, it would use their eligible ChatGPT plan for understanding uploaded math exercises, generating new variations, independently verifying generated exercises, and grading submitted solutions. The initial milestone is one authorized test request. We do not plan to use API-key billing as a fallback. We are requesting approval and implementation guidance for remotely hosted ChatGPT plan usage, including supported client registration, HTTPS redirect URIs, token storage, model discovery, and usage management. The account is managed by an adult; student material will remain private.

待获批资料确认：

1. 是否允许该家庭自用、开源、Vercel 托管场景。
2. 对应 client ID、回调注册和计划权限范围。身份登录权限是否同时包含计划调用权限。
3. 云端 token 保存、刷新、撤销和 host ID 生命周期要求。
4. 是否继续使用公共 Responses API，模型目录及请求限制是否不同。

不要把本机 OAuth token、Supabase secret key 或数据库密码填进申请说明，也不要把它们发到公开 GitHub。
