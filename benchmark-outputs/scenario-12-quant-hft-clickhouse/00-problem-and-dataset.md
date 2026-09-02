# 📋 Scenario #12: Task Specification & Public Ground Truth Dataset

## 1. Task Information
- **Title:** Scenario 12: High-Frequency Algorithmic Orderbook & Tick Stream Ingestion
- **Objective:** Ingest and profile 25,000 Level-2 tick trades and backtest log using ClickHouse Columnar Engine and Quant Tear-Sheet compressor.
- **Prompt:** "Load 25,000 tick trade records from Nautilus Trader/Tardis feed (BTCUSDT_trades.csv), extract statistical volatility bounds and price quantiles using ClickHouse/DuckDB, and collapse 2,000 backtest order fill lines into a compact Quant Performance Tear-Sheet."

## 2. Public Ground Truth Dataset
- **GitHub Repository:** [nautechsystems/nautilus_trader](https://github.com/nautechsystems/nautilus_trader)
- **Dataset Category:** Tardis.dev L2/L3 Tick Trades Stream (25k rows) + Backtest Log
- **Raw Context Volume:** 42,000 tokens
- **Dominant Optimization Layer:** **L1.5: Data Lens (-99.5%)**
