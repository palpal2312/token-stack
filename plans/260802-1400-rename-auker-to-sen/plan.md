---
title: Rename Sen to Sen System-wide
description: >-
  Refactor the entire codebase to rename all references, files, directories,
  components, routes, and UI strings from 'Sen' to 'Sen'
status: completed
priority: P1
branch: master
tags:
  - refactor
  - rebranding
blockedBy: []
blocks: []
created: '2026-08-03T04:27:16.966Z'
createdBy: 'ck:plan'
source: skill
---

# Rename Sen to Sen System-wide

## Overview
Rebrand the central AI orchestrator from "Sen" to "Sen". This involves a massive refactor spanning across 51 code files, including directories, API route endpoints, UI components, React context providers, and backend logic. The goal is to perform this renaming safely without breaking existing Agent OS functionality or breaking the TS compiler.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Rename Files and Directories](./phase-01-rename-files-and-directories.md) | Completed |
| 2 | [Update Source Code and Imports](./phase-02-update-source-code-and-imports.md) | Completed |
| 3 | [Update API Routes and URLs](./phase-03-update-api-routes-and-urls.md) | Completed |
| 4 | [Update Documentation and UI Strings](./phase-04-update-documentation-and-ui-strings.md) | Completed |

## Dependencies
None.
