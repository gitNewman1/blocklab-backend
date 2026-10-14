@echo off
chcp 65001 >nul
echo ============================================================
echo  BlockLab 分步动画生成服务 - 看门狗自启配置（只需运行一次）
echo  配置后：开机自动启动服务 + 每 5 分钟自动检测，掉线自动拉起
echo  效果：任何时候打开管理后台，服务都是就绪状态
echo ============================================================
echo.
set /p GEN_DIR=请输入 generator-server 所在目录完整路径，例如 E:\DevcoProjects\BlockLab\io2glb\tools\ldraw\generator-server 然后回车:

if not exist "%GEN_DIR%\package.json" (
    echo.
    echo [错误] 在 "%GEN_DIR%" 下没有找到 package.json，请确认路径后重新运行。
    pause
    exit /b 1
)

rem ---- 1) 生成隐藏窗口启动器：静默运行 npm start，不弹黑窗 ----
set "VBS=%APPDATA%\BlockLabGeneratorServer.vbs"
> "%VBS%" echo Set ws = CreateObject("Wscript.Shell")
>> "%VBS%" echo ws.CurrentDirectory = "%GEN_DIR%"
>> "%VBS%" echo ws.Run "cmd /c npm start", 0, False

rem ---- 2) 生成看门狗脚本：检测 5177，掉线才拉起 ----
set "WD=%APPDATA%\BlockLabGeneratorWatchdog.ps1"
> "%WD%" echo $ErrorActionPreference = "SilentlyContinue"
>> "%WD%" echo $r = Invoke-WebRequest -Uri "http://127.0.0.1:5177/api/env-check" -UseBasicParsing -TimeoutSec 5
>> "%WD%" echo if ($r.StatusCode -ne 200) { exit 1 }
>> "%WD%" echo exit 0

rem ---- 3) 看门狗动作脚本：探活失败时启动服务 ----
set "WDACT=%APPDATA%\BlockLabGeneratorWatchdogAction.vbs"
> "%WDACT%" echo Set ws = CreateObject("Wscript.Shell")
>> "%WDACT%" echo Set sh = CreateObject("Shell.Application")
>> "%WDACT%" echo probe = "cmd /c curl -s -m 5 http://127.0.0.1:5177/api/env-check ^| findstr /c:""success"" ^| exit"
>> "%WDACT%" echo Set ex = ws.Exec("%ComSpec% /c " & probe)
>> "%WDACT%" echo Do While ex.Status = 0 : WScript.Sleep 200 : Loop
>> "%WDACT%" echo If InStr(ex.StdOut.ReadAll, "success") = 0 Then
>> "%WDACT%" echo   ws.Run """%VBS%""", 0, False
>> "%WDACT%" echo End If

rem ---- 4) 注册计划任务：每 5 分钟静默执行看门狗 ----
schtasks /create /f /tn "BlockLabGeneratorWatchdog" /sc minute /mo 5 /tr "wscript.exe \"%WDACT%\"" >nul
if errorlevel 1 (
    echo.
    echo [错误] 注册计划任务失败（可能被安全软件拦截），可改用手动方式：服务目录下 npm start。
    pause
    exit /b 1
)

rem ---- 5) 立即启动一次并检测 ----
wscript.exe "%WDACT%"
timeout /t 10 /nobreak >nul
curl -s -m 5 http://127.0.0.1:5177/api/env-check 2>nul | findstr /c:"success" >nul
if %errorlevel%==0 (
    echo.
    echo [OK] 配置完成，服务已在后台运行！
    echo      - 开机自启 + 每 5 分钟看门狗自动拉起（计划任务名: BlockLabGeneratorWatchdog）
    echo      - 以后打开管理后台直接用即可，无需手动启动任何服务
) else (
    echo.
    echo [WARN] 计划任务已配置好，但本次检测未通过，常见原因：
    echo        1. 服务还在启动中，等 10 秒后在管理后台再点一次"检测环境"
    echo        2. BLENDER_PATH 环境变量未设置或路径不对（影响生成，不影响服务启动）
    echo        3. 到 %GEN_DIR% 手动运行 npm start 查看具体报错
)
echo.
echo 按任意键退出...
pause >nul
