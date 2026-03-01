#!/bin/bash

echo "========================================"
echo "     职业功能测试系统 - 快速启动"
echo "========================================"
echo ""

cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
    echo "[1/3] 安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "❌ 依赖安装失败，请检查网络连接"
        exit 1
    fi
else
    echo "[1/3] 依赖已安装"
fi

if [ ! -f ".env" ]; then
    echo "[2/3] 创建环境配置文件..."
    cp .env.example .env
    echo ""
    echo "⚠️  请编辑 .env 文件配置 DeepSeek API Key"
    echo ""
else
    echo "[2/3] 环境配置已就绪"
fi

echo "[3/3] 启动服务器..."
echo ""
echo "========================================"
echo "服务器启动后，访问：http://localhost:3000"
echo "按 Ctrl+C 停止服务器"
echo "========================================"
echo ""

npm start
