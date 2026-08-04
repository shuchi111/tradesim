"""
Tauric Research — Swing Trade Scanner
Configuration and constants
"""
import os
from pathlib import Path
from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / '.env')

# LLM Configuration (z.ai Anthropic-compatible gateway)
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY', os.getenv('LLM_API_KEY', ''))
ANTHROPIC_BASE_URL = os.getenv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic')
LLM_MODEL = os.getenv('LLM_MODEL', 'glm-5.1')
# Back-compat aliases used by some modules
LLM_API_KEY = ANTHROPIC_API_KEY
LLM_BASE_URL = ANTHROPIC_BASE_URL

# Database
DB_PATH = os.path.join(os.path.dirname(__file__), 'tauric.db')

# Scanner config
MAX_PICKS = 5
MIN_METHODS_FOR_AI = 1  # Stocks passing ≥1 method get AI scoring
LIQUIDITY_MIN_MCAP_CR = 5000  # ₹5000 Cr minimum market cap
LIQUIDITY_MIN_VOL_LAKHS = 5  # 5L shares minimum avg volume

# NSE Sector indices for M5
SECTOR_INDICES = [
    '^CNXIT',      # Nifty IT
    '^CNXBANK',    # Nifty Bank
    '^CNXAUTO',    # Nifty Auto
    '^CNXFMCG',    # Nifty FMCG
    '^CNXPHARMA',  # Nifty Pharma
    '^CNXMETAL',   # Nifty Metal
    '^CNXENERGY',  # Nifty Energy
    '^CNXMEDIA',   # Nifty Media
    '^CNXREALTY',  # Nifty Realty
    '^CNXINFRA',   # Nifty Infra
    '^CNXPSUBANK', # Nifty PSU Bank
    '^CNXFIN',     # Nifty Financial Services
]

# Simplified Nifty 500 universe — top liquid stocks
# In production this would be fetched from NSE API
NIFTY500_UNIVERSE = [
    'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
    'BHARTIARTL.NS', 'SBIN.NS', 'ITC.NS', 'LT.NS', 'HINDUNILVR.NS',
    'AXISBANK.NS', 'KOTAKBANK.NS', 'MARUTI.NS', 'ASIANPAINT.NS', 'WIPRO.NS',
    'TATAMOTORS.NS', 'BAJFINANCE.NS', 'ADANIENT.NS', 'TITAN.NS', 'SUNPHARMA.NS',
    'HCLTECH.NS', 'ULTRACEMCO.NS', 'NESTLEIND.NS', 'TECHM.NS', 'POWERGRID.NS',
    'NTPC.NS', 'ONGC.NS', 'COALINDIA.NS', 'GRASIM.NS', 'HDFCLIFE.NS',
    'JSWSTEEL.NS', 'TATASTEEL.NS', 'BAJAJFINSV.NS', 'DIVISLAB.NS', 'CIPLA.NS',
    'DRREDDY.NS', 'EICHERMOT.NS', 'BRITANNIA.NS', 'HEROMOTOCO.NS', 'BAJAJ-AUTO.NS',
    'ADANIPORTS.NS', 'HINDALCO.NS', 'SBILIFE.NS', 'IOC.NS', 'BPCL.NS',
    'TATACONSUM.NS', 'INDUSLTDK.NS', 'SHRIRAMFIN.NS', 'DMART.NS', 'ZOMATO.NS',
    'PIDILITIND.NS', 'SIEMENS.NS', 'ABB.NS', 'BERGEPAINT.NS', 'DLF.NS',
    'GODREJCP.NS', 'BOSCHLTD.NS', 'ICICIPRULI.NS', 'ICICIGI.NS', 'M&M.NS',
    'LODHA.NS', 'HAL.NS', 'BEL.NS', 'BHEL.NS', 'PNB.NS',
    'BANKBARODA.NS', 'CANBK.NS', 'UNIONBANK.NS', 'INDIGO.NS', 'DABUR.NS',
    'COLPAL.NS', 'MARICO.NS', 'AMBUJACEM.NS', 'ACC.NS', 'SHREECEM.NS',
    'HAVELLS.NS', 'POLYCAB.NS', 'MPHASIS.NS', 'COFORGE.NS', 'PERSISTENT.NS',
    'LTIM.NS', 'CGPOWER.NS', 'TVSMOTOR.NS', 'MOTHERSON.NS', 'ASHOKLEY.NS',
    'TATAPOWER.NS', 'ADANIPOWER.NS', 'VEDL.NS', 'NMDC.NS', 'GAIL.NS',
    'PLNG.NS', 'RECLTD.NS', 'PFC.NS', 'MUTHOOTFIN.NS', 'CHOLAFIN.NS',
    'BAJAJHLDNG.NS', 'SRF.NS', 'PIIND.NS', 'UPL.NS', 'COROMANDEL.NS',
]

# Method definitions
METHODS = [
    {'id': 'M1', 'name': 'Breakout + Volume', 'desc': '52-week high breakout with volume confirmation'},
    {'id': 'M2', 'name': 'Supertrend + MACD', 'desc': 'Supertrend bullish + MACD crossover'},
    {'id': 'M3', 'name': 'RSI Reversal', 'desc': 'Exit from oversold zone with bullish candle'},
    {'id': 'M4', 'name': 'EMA Crossover', 'desc': 'Fresh 20/50 EMA bullish crossover'},
    {'id': 'M5', 'name': 'Sector Momentum', 'desc': 'Stock in top-2 momentum sectors with RS>0 vs Nifty'},
    {'id': 'M6', 'name': 'Bullish Engulfing', 'desc': 'Bullish engulfing pattern near 50EMA support'},
    {'id': 'M7', 'name': 'AI Composite', 'desc': 'Claude AI multi-factor composite scoring'},
]
