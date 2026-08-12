Health status contract:

- OK: required files/config and runtime check pass.
- WARN: partial setup, such as installed but disabled or binary present without route.
- NO: required component absent or disabled.
- UNKNOWN: source is unavailable; never treat unknown as zero savings.

Health is read-only. It must not install packages, edit settings, start/stop processes, or expose secrets.
