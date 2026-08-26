# Scenario 1: Multi-File Bugfix Discovery

## Objective
Find and fix a timeout handling bug in `payment_gateway.go` where `http.Client` lacks a timeout context and causes gateway lockups under high load.

## Target File
`src/services/payment_gateway.go`