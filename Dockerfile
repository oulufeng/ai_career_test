FROM node:18-alpine

WORKDIR /app

# 安装构建依赖
RUN apk add --no-cache python3 make g++

# 复制 package 文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制应用代码
COPY server.js ./
COPY public/ ./public/

# 创建数据目录
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/status || exit 1

# 启动应用
CMD ["node", "server.js"]
