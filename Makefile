# Token-Stack 3.1 Makefile (13-Layer Master Architecture)

.PHONY: all status doctor up down verify test bench clean help

all: status

status:
	@powershell -NoProfile -ExecutionPolicy Bypass -File ./bin/token-stack.ps1 status

doctor:
	@powershell -NoProfile -ExecutionPolicy Bypass -File ./bin/token-stack.ps1 doctor

up:
	@powershell -NoProfile -ExecutionPolicy Bypass -File ./bin/token-stack.ps1 up --all

down:
	@powershell -NoProfile -ExecutionPolicy Bypass -File ./bin/token-stack.ps1 down

verify:
	@powershell -NoProfile -ExecutionPolicy Bypass -File ./bin/token-stack.ps1 verify

test:
	@powershell -NoProfile -ExecutionPolicy Bypass -File ./bin/token-stack.ps1 test

bench:
	@powershell -NoProfile -ExecutionPolicy Bypass -File ./bin/token-stack.ps1 bench

clean:
	@powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process headroom -ErrorAction SilentlyContinue | Stop-Process -Force"

help:
	@echo Token-Stack 3.1 DX Tooling
	@echo ---------------------------
	@echo make status   - Check live profile and port status
	@echo make doctor   - Run full 13-layer health inspection
	@echo make up       - Launch all configured Headroom proxies
	@echo make down     - Stop all Headroom proxies
	@echo make verify   - Run automated 3-stage E2E validation
	@echo make test     - Run all 6 layer test suites (including Data Lens)
	@echo make bench    - Launch interactive 13-layer benchmark TUI
