# 📋 Scenario #5: Task Specification & Public Ground Truth Dataset

## 1. Task Information
- **Title:** Scenario 5: Quant Strategy Backtesting on Historical OHLCV CSV Data
- **Objective:** Load OHLCV candle CSV dataset, implement SMA Crossover with RSI Filter strategy, execute Backtest, and run parameter optimization via backtesting.py.
- **Prompt:** "Write Python code to load OHLCV candle data from CSV (BTCUSDT_1h.csv), configure an SMA Crossover (MA 10/20) with RSI filter (RSI < 70) strategy, run a Backtest using backtesting.py, extract key performance metrics (Return %, Sharpe Ratio, Max Drawdown %, Win Rate %), and optimize parameters."

## 2. Public Ground Truth Dataset
- **GitHub Repository:** [kernc/backtesting.py](https://github.com/kernc/backtesting.py)
- **Dataset Category:** OHLCV Historical 1h Candles CSV + backtesting.py engine
- **Raw Context Volume:** 8,500 tokens
- **Dominant Optimization Layer:** **L0: Graphify (-82.4%) & L3: RTK (-56.7%) & L2: Caveman (-68.0%)**
