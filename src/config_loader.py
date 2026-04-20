#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
環境變數配置載入器

功能:
  1. 載入 .env 檔案 (如果存在)
  2. 將值提供給應用程式
  3. 提供預設值當 .env 不存在

使用方式:
  from config_loader import config
  
  spreadsheet_id = config['SPREADSHEET_ID']
  token_path = config['TOKEN_PATH']
"""

import os
from pathlib import Path

def _load_env_file(env_path: Path) -> dict:
    """
    從 .env 檔案讀取鍵值對
    
    .env 檔案格式:
      KEY=value
      KEY="value with spaces"
      # 這是註解
    """
    env_vars = {}
    if not env_path.exists():
        return env_vars
    
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            # 跳過空行和註解
            if not line or line.startswith('#'):
                continue
            # 分割 KEY=value
            if '=' in line:
                key, value = line.split('=', 1)
                # 移除引號
                value = value.strip().strip('\"').strip("\'")
                env_vars[key.strip()] = value
    
    return env_vars

def _get(key: str, default: str = None) -> str:
    """取得環境變數，優先使用 .env 檔案的值"""
    env_path = Path(__file__).parent.parent / '.env'
    env_vars = _load_env_file(env_path)
    
    # 優先使用 .env 檔案, 其次使用系統環境變數
    value = env_vars.get(key, os.environ.get(key, default))
    return value

# 全域配置字典
config = {
    # Google Sheets
    'SPREADSHEET_ID': _get('SPREADSHEET_ID', ''),
    'SHEET_NAME': _get('SHEET_NAME', '工作表1'),
    
    # OAuth 憑證路徑
    'TOKEN_PATH': _get('TOKEN_PATH', '/root/.hermes/google_token.json'),
    'CLIENT_SECRET_PATH': _get('CLIENT_SECRET_PATH', '/root/.hermes/google_client_secret.json'),
    
    # API 設定
    'YAHOO_TIMEOUT': int(_get('YAHOO_TIMEOUT', '15')),
    'EXCHANGE_TIMEOUT': int(_get('EXCHANGE_TIMEOUT', '10')),
    
    # 爬取設定
    'MIN_WAIT': int(_get('MIN_WAIT', '6')),
    'MAX_WAIT': int(_get('MAX_WAIT', '15')),
    
    # 其他
    'LOG_LEVEL': _get('LOG_LEVEL', 'INFO'),
}

if __name__ == '__main__':
    print('=== 當前配置 ===')
    for key, value in config.items():
        # 遮蔽敏感資訊
        if 'TOKEN' in key or 'SECRET' in key or 'SPREADSHEET' in key:
            display_value = value if not value else f'{value[:4]}***(已遮蔽)'
        else:
            display_value = value
        print(f'  {key}: {display_value}')
