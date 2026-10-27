# Google Workspace on Android

Neru uses Google Play services AuthorizationClient and the ordinary Gmail, Drive and Calendar REST APIs. It does not require access to Google's remote MCP developer preview or a client secret embedded in the app.

## One-time Google Cloud setup

1. Create a Google Cloud project and configure its Google Auth Platform consent screen. In testing mode, add the Google accounts that will use Neru as test users.
2. Enable Gmail API, Google Drive API and Google Calendar API in that project.
3. Create an OAuth client of type **Android** with package **dev.neru.mobile** and the release signing certificate SHA-1:
   `44:A9:B7:BF:5D:97:59:21:1A:30:B8:1A:E5:88:75:E5:17:F6:47:FB`.
4. Configure the consent permissions used by enabled connectors: `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/calendar`. Public distribution with sensitive/restricted scopes may require Google's verification process. Testing-mode grants can expire and need renewed consent.
5. Install the signed release, open Settings → Connectors, and sign in to each Google service. Android authorization resolves the OAuth client from the package and certificate; no client ID needs to be pasted into app.json for Android.

Development APKs have a different certificate and require a separate Android OAuth client. The native `googleAuthInfo()` diagnostic returns the running package, SHA-1 and Play services availability. The diagnostic route is development-only. Never share a keystore or its passwords.

Google account access cannot work until this registration exists. Authorization errors explain missing setup rather than hiding Google as unavailable on mobile. Existing saved Google MCP connector URLs are routed to the same REST adapters automatically.

## Capabilities

- Gmail: search/read messages, list labels, change labels and create drafts. Draft creation does not send mail.
- Drive: search files, extract uploaded documents, export Docs/Sheets/Slides, create Google Docs from text.
- Calendar: list calendars/events and create events with explicit timezone offsets.

Write tools use Neru's existing approval controls. Google tokens are kept in secure storage; Play services handles renewal, and silent refresh never opens a consent prompt.

## Document limits

Extraction stays on the phone, off the UI thread. It reads PDF, DOCX/DOCM, PPTX/PPTM, XLSX/XLSM, legacy DOC/PPT/XLS, OpenDocument, RTF, CSV and text. The model receives text, not document layout, macros, embedded media or an editable Office file. Spreadsheet values include cell references, cached values and formula text; formulas are not recalculated.

Files are limited to 50 MB (10 MB for legacy Office), 200,000 extracted characters and 100 PDF pages. Scanned PDF OCR is bundled for Latin script. Password-protected files and unsupported binary formats produce an explicit error. Very long content is truncated and marked; a small model's context may retain only part of it.

References: [Android authorization](https://developer.android.com/identity/authorization), [Google OAuth Android registration](https://developers.google.com/identity/protocols/oauth2/native-app), [Gmail REST](https://developers.google.com/workspace/gmail/api/reference/rest), [Drive REST](https://developers.google.com/workspace/drive/api/reference/rest/v3), [Calendar REST](https://developers.google.com/workspace/calendar/api/v3/reference), [ML Kit OCR](https://developers.google.com/ml-kit/vision/text-recognition/v2/android).
