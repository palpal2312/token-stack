# Example 07: Quant Financial Backtesting & ClickHouse DataLens

## 📌 Research & Architecture Background
Based on state-of-the-art quantitative infrastructure:
1. **`nautechsystems/nautilus_trader`** — Production-grade, event-driven algorithmic trading engine in Rust & Python.
2. **`tardis-dev/tardis-node`** — High-frequency crypto Level-2 / Level-3 tick and orderbook data pipeline.
3. **`ClickHouse/ClickHouse`** — Ultra-fast open-source columnar database management system for real-time analytical reporting.
4. **`vanna-ai/vanna`** — Zero-Row Context Shield design pattern inspiration for AI data analytics.

## 🚨 The Quantitative Dilemma: Massive Tick Data vs Context Windows
In quantitative research and algorithmic trading backtesting:
* **The Raw Data Bloat**:
  - A single hour of cryptocurrency tick trades (BTC/USDT) contains 25,000 to 100,000+ trade executions.
  - When an AI agent attempts to read, summarize, or backtest raw CSV/Parquet files (`cat BTCUSDT_trades.csv` or reading raw chunks), it dumps **100,000+ to 800,000+ tokens** directly into the context window.
  - Result: Immediate context exhaustion (128k/200k TPM blowout), sluggish multi-second LLM inference, and hallucinations on numerical extrema.
* **The Order Execution Log Bloat**:
  - Backtesting engines (e.g. `nautilus_trader`, `backtesting.py`, `backtrader`) generate thousands of verbose order filling and slippage lines (`[ORDER #1245] FILLED BUY 0.25 BTC...`).
  - Dumps 30,000+ tokens of terminal noise into agent context.

## 🛡️ The Token-Stack Layer 1.5 Solution
* **Zero-Row Data Contract (<100 tokens)**:
  - Invokes ClickHouse Local (`clickhouse local`) or native HTTP (`:8123`) or DuckDB to compute columnar metadata, type definitions, timestamp bounds, and numerical quantiles without deserializing a single row into prompt text.
* **Quant Performance Tear-Sheet (<70 tokens)**:
  - Collapses 10,000+ verbose order lines into 4 high-signal lines (Return, Sharpe, Sortino, Max Drawdown, Win Rate, Profit Factor).
* **Token Savings**: **-99.9% Context Reduction** while preserving 100% mathematical precision for downstream code generation.

## 🚀 How to Run

```bash
node examples/07-quant-clickhouse-datalens/run-example.cjs
```
