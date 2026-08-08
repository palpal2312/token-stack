# Dify Bridge Threat Model

This document outlines the security architecture and threat model for the Dify Bridge, specifically focusing on the boundaries between personal local environments and external integrations.

## 1. Personal-Local Boundary Constraints

The Dify Bridge operates on a strict personal-local boundary constraint. 
- **Execution Context**: The bridge runs locally with the user's personal context and permissions. 
- **Data Exfiltration**: Data cannot flow from the local environment to the external Dify instance unless explicitly permitted by the user or explicitly designed through restricted channels.
- **Access Control**: External Dify instances cannot arbitrary execute commands or access local resources. Only pre-defined bridge operations are permitted.

## 2. Credential Handling

- **In-Memory Storage**: Credentials (such as Dify API keys or local authentication tokens) are stored in-memory during execution and are never logged.
- **Environment Variables**: Sensitive configuration must be passed via secure environment variables rather than hardcoded configuration files or command-line arguments.
- **Least Privilege**: The API keys provided to the bridge should be scoped to the minimum necessary permissions required for the specific Dify app integrations.

## 3. `localOnly` Requests

- **Definition**: The `localOnly` flag ensures that certain requests or operations are strictly confined to the local execution environment.
- **Enforcement**: When a request is marked as `localOnly`, the bridge prevents any outbound network calls related to that request, even if the user or a connected system attempts to route it externally.
- **Mitigation**: This mitigates the risk of SSRF (Server-Side Request Forgery) or unintentional data leakage by enforcing a hard boundary for sensitive operations.

## 4. URL Loopback Validation

To prevent malicious redirection or exploitation of internal services:
- **Loopback Enforcement**: All URLs provided to the bridge that are intended for local service interaction must strictly resolve to local loopback addresses (e.g., `127.0.0.1`, `::1`, or `localhost`).
- **Validation Rules**: The bridge validates the resolved IP address of any provided hostname before initiating a connection. If the IP address falls outside the allowed loopback ranges, the connection is rejected.
- **DNS Rebinding Protection**: The validation occurs at the time of connection to mitigate DNS rebinding attacks, ensuring the target remains local.

## 5. Capacity Reservations (Anti-DoS)

To protect the local machine from being overwhelmed by a high volume of requests from the external Dify instance (or a compromised connection):
- **Rate Limiting**: The bridge implements rate limiting for incoming requests.
- **Capacity Reservations**: Specific capacity reservations are maintained for critical internal operations to ensure the bridge remains responsive even under heavy load.
- **Connection Limits**: Maximum concurrent connection limits are enforced to prevent resource exhaustion (CPU, Memory, File Descriptors).

## 6. File Upload Limits

File uploads from the Dify instance or processed through the bridge are strictly constrained to prevent storage exhaustion and memory overflow attacks.
- **`DIFY_MAX_STAGED_FILE_BYTES`**: This constant defines the absolute maximum size (in bytes) of any single file that can be staged or processed by the bridge.
- **Early Rejection**: Uploads exceeding this limit are rejected early in the streaming process before the entire file is buffered in memory or written to disk.
- **Storage Quotas**: Staged files are temporarily stored in restricted directories with overall quotas and automated cleanup mechanisms to ensure temporary storage does not grow indefinitely.
