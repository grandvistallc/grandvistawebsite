@echo off
echo Installing required Python packages...
pip install flask flask-cors
echo.
echo Starting server...
echo.
python server.py
pause
