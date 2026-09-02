# Token-Stack 2.0 Makefile (Inspired by sub2api DX)

.PHONY: all status doctor up down verify clean help

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

clean:
	@powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process headroom -ErrorAction SilentlyContinue | Stop-Process -Force"

help:
	@echo Token-Stack 2.0 DX Tooling
	@echo ---------------------------
	@echo make status   - Check live profile and port status
	@echo make doctor   - Run full 7-layer health inspection
	@echo make up       - Launch all configured Headroom proxies
	@echo make down     - Stop all Headroom proxies
	@echo make verify   - Run automated 3-stage E2E validation
