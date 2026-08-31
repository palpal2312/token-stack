// FIXTURE EVIDENCE ONLY - lane 3 test fixture, not producer code.
package core

// fixture DSN with AO-14 six-pragma set.
const dsn = "file:sen-product.db?_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=cache_size(-64000)&_pragma=temp_store(MEMORY)"
