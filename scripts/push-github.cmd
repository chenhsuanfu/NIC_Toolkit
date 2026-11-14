@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ============================================================
echo 🚀 正在將 NIC_Toolkit 推送至 GitHub (chenhsuanfu/NIC_Toolkit)...
echo ============================================================
git push -u origin main
echo.
if %ERRORLEVEL% EQU 0 (
  echo ✅ 推送成功！請前往 https://github.com/chenhsuanfu/NIC_Toolkit 查看。
) else (
  echo ⚠️ 推送未完成，請確認是否已於彈出視窗完成 GitHub 登入授權。
)
pause
