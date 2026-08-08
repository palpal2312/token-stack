#!/bin/bash
# Phase 1: Rename app directories
mv src/app/auker src/app/sen
mv src/app/api/auker src/app/api/sen

# Phase 1: Rename components
mv src/components/AukerView.tsx src/components/SenView.tsx
mv src/components/AukerKnowledgeBase.tsx src/components/SenKnowledgeBase.tsx

# Phase 1: Rename context
mv src/context/auker-panel-context.tsx src/context/sen-panel-context.tsx

# Phase 1: Rename src/lib files
mv src/lib/auker.ts src/lib/sen.ts
mv src/lib/auker-config.ts src/lib/sen-config.ts
mv src/lib/auker-models.ts src/lib/sen-models.ts
mv src/lib/auker-sessions.ts src/lib/sen-sessions.ts
mv src/lib/aukerKnowledgeFiles.ts src/lib/senKnowledgeFiles.ts

# Phase 1: Rename presets
mv src/lib/agentRuntime/presets/auker.ts src/lib/agentRuntime/presets/sen.ts
mv src/lib/agentRuntime/presets/auker-meta.ts src/lib/agentRuntime/presets/sen-meta.ts
