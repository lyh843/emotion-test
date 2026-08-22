# 知境 · 多模态情绪感知测评平台

一个可直接部署的全栈心理测评系统，包含匿名用户测评端、管理员后台、SQLite 数据库存储、多媒体题库、自动评分、报告与 CSV 导出。

## 快速开始

要求 Node.js 18+。首次安装并启动：

```bash
npm install --python=/usr/bin/python3
cp .env.example .env
set -a && . ./.env && set +a
npm start
```

访问地址：

- 用户测评端：`http://localhost:3000/`
- 管理后台：`http://localhost:3000/admin`
- 管理员登录页：`http://localhost:3000/admin/login`

首次启动会自动创建 SQLite 表和初始管理员。务必在公网部署前修改 `SESSION_SECRET` 与 `ADMIN_PASSWORD`。如果未配置，开发环境默认账号为 `admin`、密码为 `admin123!`。

后台复制测试批次的被试链接时，默认使用 `http://8.138.88.239:3000`。如域名或端口变化，可通过环境变量覆盖，例如 `PUBLIC_BASE_URL=https://example.com`。

如需在空题库中生成 5 道演示题，启动时显式设置 `SEED_DEMO_DATA=true`。生产环境不要设置该变量，否则清空题库后重启会再次生成演示题。

报告页支持 OpenAI-compatible 大模型反馈。复制 `.env.example` 为 `.env`，填写 `LLM_API_KEY`、`LLM_BASE_URL` 和 `LLM_MODEL` 后重启服务即可启用；密钥仅由服务端读取。未配置时系统自动使用本地规则反馈。

## 数据目录

- `data/emotion.sqlite`：题库、答卷、评分结果和管理员账号
- `uploads/`：后台上传的图片、音频和视频

这两个目录必须挂载到服务器持久化磁盘。SQLite 已开启 WAL、外键与事务。

备份时停止写入或使用 SQLite 在线备份命令：

```bash
sqlite3 data/emotion.sqlite ".backup '/backup/emotion-$(date +%F).sqlite'"
tar -czf "/backup/uploads-$(date +%F).tar.gz" uploads
```

恢复时先停止服务，替换数据库文件和 `uploads/`，确认目录权限后重新启动。

## 生产部署

### systemd

```ini
[Unit]
Description=Zhijing Emotion Assessment
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/emotion-test
EnvironmentFile=/var/www/emotion-test/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

也可使用 `pm2 start server.js --name emotion-test`。`COOKIE_SECURE=auto` 会根据请求是 HTTP 还是 HTTPS 自动设置登录 Cookie；使用 Nginx 代理 HTTPS 时须保留下方的 `X-Forwarded-Proto` 配置。仅在必须强制限制协议时，将其显式设置为 `true`（仅 HTTPS）或 `false`（允许 HTTP）。

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;
    client_max_body_size 100m;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
        expires 7d;
        add_header Cache-Control "public";
    }

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_pass http://127.0.0.1:3000;
    }
}
```

## 评分规则

每题标签识别占 60%，强度判断占 40%。标签答对得 100 分，否则 0 分；强度得分为 `100 × (1 - |用户强度 - 标准强度| / 4)`。跳题得 0 分。提交时保存题目标准值快照，因此修改题库不会改变历史答卷。

## 检查

```bash
npm run check
npm audit
```

测评结果仅供个人成长和研究参考，不构成医疗或心理诊断。
