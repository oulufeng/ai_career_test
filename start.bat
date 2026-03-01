@echo off
chcp 65001 >nul
echo ========================================
echo     职业功能测试系统 - 快速启动
echo ========================================
echo.

cd /d "%~dp0"

if not exist "node_modules" (
    echo [1/3] 安装依赖...
    call npm install
    if errorlevel 1 (
        echo.
        echo ❌ 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
) else (
    echo [1/3] 依赖已安装
)

if not exist ".env" (
    echo [2/3] 创建环境配置文件...
    copy .env.example .env >nul
    echo.
    echo ⚠️  请编辑 .env 文件配置 DeepSeek API Key
    echo.
) else (
    echo [2/3] 环境配置已就绪
)

echo [3/3] 启动服务器...
echo.
echo ========================================
echo 服务器启动后，访问：http://localhost:3000
echo 按 Ctrl+C 停止服务器
echo ========================================
echo.

call npm start

pause
