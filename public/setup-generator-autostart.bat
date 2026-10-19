@echo off
chcp 65001 >nul
echo ============================================================
echo  BlockLab 分步动画生成服务 - 一键启动
echo  在本窗口前台运行服务，关闭本窗口即停止服务
echo ============================================================
echo.
set /p GEN_DIR=请输入 generator-server 所在目录完整路径，例如 E:\DevcoProjects\BlockLab\io2glb\tools\ldraw\generator-server 然后回车:

if not exist "%GEN_DIR%\package.json" (
    echo.
    echo [错误] 在 "%GEN_DIR%" 下没有找到 package.json，请确认路径后重新运行。
    pause
    exit /b 1
)

echo.
echo 正在启动服务（目录: %GEN_DIR%）...
start "BlockLab Generator Server" /D "%GEN_DIR%" cmd /k "npm start"

echo 等待服务就绪...
set /a TRIES=0
:waitloop
timeout /t 3 /nobreak >nul
curl -s -m 5 http://127.0.0.1:5177/api/env-check 2>nul | findstr /c:"success" >nul
if %errorlevel%==0 goto ready
set /a TRIES+=1
if %TRIES% lss 10 goto waitloop

echo.
echo [WARN] 等待 30 秒后仍未检测到服务，常见原因：
echo        1. 启动报错：请查看刚才弹出的服务窗口中的具体信息
echo        2. 端口被占用：检查 5177 端口是否已被其他程序使用
echo        3. npm start 失败：到 %GEN_DIR% 手动运行 npm start 查看报错
echo.
pause
exit /b 1

:ready
echo.
echo [OK] 服务已启动并在后台运行！
echo      - 打开管理后台即可正常使用
echo      - 服务窗口请保持开着；关闭它或重启电脑后，需再次运行本脚本启动服务
echo.
echo 按任意键退出本窗口（不影响服务运行）...
pause >nul
exit /b 0
