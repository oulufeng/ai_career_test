# 职业功能测试系统 - 部署文档

## 📋 目录
- [系统简介](#系统简介)
- [本地开发部署](#本地开发部署)
- [云服务器部署](#云服务器部署)
- [Docker 部署](#docker-部署)
- [配置说明](#配置说明)
- [常见问题](#常见问题)

---

## 系统简介

本系统是一个基于 DeepSeek AI 的职业功能测试平台，包含：
- **20 道多维度职业测试题**
- **DeepSeek AI 智能分析**
- **用户认证与历史记录**
- **个性化学习方案推荐**

### 技术栈
- **后端**: Node.js + Express + SQLite
- **前端**: 原生 HTML/CSS/JavaScript + Chart.js
- **AI**: DeepSeek API
- **部署**: Docker / Docker Compose

---

## 本地开发部署

### 1. 环境要求
- Node.js >= 18.0.0
- npm >= 9.0.0

### 2. 安装步骤

```bash
# 进入项目目录
cd 职业功能测试

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的 DeepSeek API Key

# 启动开发服务器
npm run dev
```

### 3. 访问应用
打开浏览器访问：http://localhost:3000

---

## 云服务器部署

### 方案一：直接使用 Node.js

#### 1. 服务器准备
- 操作系统：Ubuntu 20.04+ / CentOS 7+
- 内存：>= 512MB
- 磁盘：>= 5GB

#### 2. 安装 Node.js
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
```

#### 3. 部署应用
```bash
# 上传项目文件到服务器
scp -r 职业功能测试 root@your-server:/opt/career-test

# 进入目录
cd /opt/career-test

# 安装依赖
npm install --production

# 配置环境变量
cp .env.example .env
vim .env  # 编辑配置

# 使用 PM2 管理进程
npm install -g pm2
pm2 start server.js --name career-test
pm2 save
pm2 startup
```

#### 4. 配置 Nginx 反向代理
```bash
# 安装 Nginx
sudo apt install nginx

# 创建配置文件
sudo vim /etc/nginx/sites-available/career-test
```

Nginx 配置：
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# 启用配置
sudo ln -s /etc/nginx/sites-available/career-test /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 5. 配置 HTTPS（可选）
```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com
```

---

### 方案二：使用 Docker

#### 1. 安装 Docker
```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable docker
sudo systemctl start docker

# 安装 Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

#### 2. 部署应用
```bash
# 进入项目目录
cd 职业功能测试

# 配置环境变量
cp .env.example .env
vim .env  # 编辑配置

# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f
```

#### 3. 使用 Nginx（可选）
```bash
# 创建 SSL 目录
mkdir -p ssl

# 放置 SSL 证书文件到 ssl/ 目录
# fullchain.pem 和 privkey.pem

# 启动带 Nginx 的服务
docker-compose --profile with-nginx up -d
```

---

## 配置说明

### 环境变量 (.env)

| 变量名 | 说明 | 默认值 | 必填 |
|--------|------|--------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | 无 | 是 (AI 功能) |
| `JWT_SECRET` | JWT 签名密钥 | change-in-production | 生产环境必填 |
| `PORT` | 服务器端口 | 3000 | 否 |
| `DATABASE_PATH` | 数据库文件路径 | ./career_test.db | 否 |

### 获取 DeepSeek API Key
1. 访问 https://platform.deepseek.com
2. 注册/登录账号
3. 进入 API 管理页面
4. 创建新的 API Key
5. 复制到 .env 文件中

---

## 常见问题

### 1. 启动失败：端口被占用
```bash
# 查看占用端口的进程
lsof -i :3000
# 杀死进程
kill -9 <PID>
# 或修改 PORT 环境变量
```

### 2. AI 分析失败
- 检查 DEEPSEEK_API_KEY 是否正确
- 检查服务器网络连接
- 查看 API 余额是否充足

### 3. 数据库锁定
```bash
# 删除数据库文件（会清空数据）
rm career_test.db
# 重启服务
pm2 restart career-test
# 或 docker-compose restart
```

### 4. 内存不足
```bash
# 限制 Node.js 内存使用
export NODE_OPTIONS="--max-old-space-size=512"
pm2 restart career-test
```

---

## API 接口文档

### 认证相关
| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/auth/register` | POST | 用户注册 |
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/me` | GET | 获取当前用户信息 |

### 测试相关
| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/test/analyze` | POST | 提交测试获取 AI 分析 |
| `/api/test/guest` | POST | 游客提交测试 |
| `/api/test/history` | GET | 获取历史记录 |
| `/api/test/:sessionId` | GET | 获取单次测试详情 |

### 系统相关
| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 系统状态检查 |

---

## 性能优化建议

### 1. 数据库优化
```sql
-- 添加索引
CREATE INDEX idx_test_results_user_id ON test_results(user_id);
CREATE INDEX idx_test_results_created_at ON test_results(created_at);
```

### 2. 缓存配置
使用 Redis 缓存热点数据（需额外配置）

### 3. 静态资源 CDN
将前端静态资源托管到 CDN 加速

---

## 安全建议

1. **修改 JWT_SECRET**：生产环境务必使用强随机密钥
2. **启用 HTTPS**：保护用户数据传输安全
3. **定期备份数据库**：防止数据丢失
4. **限制 API 调用频率**：防止滥用
5. **更新依赖**：定期检查并更新安全补丁

---

## 技术支持

如有问题，请检查：
1. 服务器日志：`pm2 logs career-test` 或 `docker-compose logs`
2. Nginx 日志：`/var/log/nginx/error.log`
3. 数据库状态：`sqlite3 career_test.db ".tables"`

---

**祝您部署顺利！** 🎉
