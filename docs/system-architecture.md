# System Architecture

## Overview
This document outlines the system architecture for Agent OS.

## Integrations

- **Dify Local Workflow Bridge**: (Phase 1-6 implemented) Connects external Dify workflows into the LLMOps ledger. This integration allows the local execution environment to interact with external Dify instances while maintaining strict personal-local boundaries. It includes protections against data exfiltration, loopback validation for local URLs, and capacity reservations for anti-DoS.
