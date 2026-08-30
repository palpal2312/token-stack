// FIXTURE EVIDENCE ONLY - lane 3 test fixture, not producer code.
package community

// allowlist of permitted metadata keys (fixture).
var allowedMetadataKeys = map[string]bool{"category": true, "tag": true}

// forbidden secret patterns: bearer, jwt, api_key, private_key, password,
// token, secret, pem (fixture stand-ins for producer regexes).
var forbiddenPatterns = []string{"bearer", "jwt", "api_key", "private_key", "password", "token", "secret", "pem"}
