# Neru 0.15.0 verification (Android build 8)

Tested on 2026-10-27 with the running Pixel 10a x86_64 Android emulator, Expo SDK 57, React Native 0.86.3 and LiteRT-LM 0.18.1. Metro was kept running. This is an emulator result, not a physical-phone thermal or battery benchmark.

## Results

- TypeScript and full source ESLint: pass, no errors or warnings.
- Local runtime regressions: preload coalescing/invalidation, abort ordering, token listener cleanup, partial tag handling, context reservation, no-thinking configuration and named-connector selection pass.
- Tool/schema regressions: OpenAI/Gemini streams, nested/union schemas, required arguments and Gemma function syntax pass, including 13 live public MCP schemas.
- Notion-style MCP round trip: search/create arguments with nested paragraph content pass against a local fake HTTP server. Server `isError` replies are correctly reported as failures. No journal entry was written as part of this test.
- Google adapters: auth failure handling, Gmail query routing, UTF-8 message decoding, drafts and label validation, Drive Slides export/extraction, Calendar time validation and write approvals pass with mocked API responses. The native Google authorization module compiles; Play services is available on the emulator.
- Native document extraction: DOCX paragraphs/table, PPTX slide/speaker notes, XLSX strings/numeric cells/formulas, text PDF, scanned PDF Latin OCR, CSV and legacy DOC/PPT/XLS pass. Corrupt DOCX and unsupported binary files are rejected. Legacy samples came from Apache POI's public test-data repository.
- Actual in-app updater: downloaded the 104,013,586-byte 0.14.0 release APK inside Neru, verified GitHub's SHA-256 digest, and reached Android's package installer permission dialog. No browser redirect occurred. The old release was not installed over the development build.
- Updater regressions: compatible ABI selection, missing assets, duplicate requests, progress, completed-cache reuse, truncated downloads and checksum failure pass.

## Local model measurements

The installed Qwen3 0.6B model loaded in approximately 0.8–1.0 seconds. Repeating a load with identical engine settings took 1–5 milliseconds. Three sequential capital questions returned visible correct answers; later first-token times were approximately 2 seconds in this emulator.

The converted Qwen3 model resumed an unclosed thinking channel when its native conversation was reused. In non-thinking mode Neru now rebuilds that conversation from visible history while retaining the loaded engine. Other models can retain conversation state. The native 512-token long-prompt regression passes; it previously threw a negative character-count exception.

After a minute in the background, native logs confirmed engine release. App PSS decreased from approximately 2.4 GB to 0.72 GB in the observed run. These figures include a development app and emulator effects; hardware, context, model size and Android memory management change the result.

## Required external setup and remaining limits

Google account access still requires the app owner's Android OAuth registration and enabled Google APIs. No OAuth client existed during this work, so authenticated Gmail/Drive/Calendar operations remain unverified. Follow [the setup guide](google-android.md), including the release signing certificate SHA-1.

Actual Gemma inference, authenticated Notion writes, physical-phone responsiveness/thermal behavior, GPU execution and image-model memory use were not verified in this emulator. Document extraction is text-based with the limits described in the setup guide; it cannot guarantee every encrypted, malformed, image-only or unsupported document is readable.

## Regression commands

From the mobile project: `node scripts/check-local-runtime.cjs`, `node scripts/check-mobile-integrations.cjs`, `node scripts/check-updater.cjs`, `node scripts/check-attachments.cjs`, `node scripts/check-local-models.cjs`, `node src/llm/tools.check.ts`, `node src/llm/vendor.check.ts`, and `node src/mcp/arguments.check.ts`.

The development-only `neru://pocket-check` route supports `performance=1`, `documents=1` (fixture manifest required) and `updater=1`. Native diagnostic results are written to the development app's document directory. Release builds do not execute these diagnostics.
