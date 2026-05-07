# BDO-GrindTracker

Static Black Desert Online grind-session tracker for comparing silver, hours, classes, spots, loot items, and screenshot-assisted OCR loot entry.

## Features

- Track grind sessions by spot and class
- Maintain a shared loot item library with prices and icons
- Compare total silver, silver per hour, and total hours
- Import and export tracker data as JSON
- Scan screenshots locally with bundled Tesseract.js assets
- Optional OpenAI Smart Scan for screenshot loot rows
- Local OpenAI Smart Scan usage tracking in Settings

## Run Locally

Open `index.html` directly for the core tracker, or run the included local server for OCR and Smart Scan:

```powershell
.\serve.ps1
```

Then open:

```text
http://localhost:5175/
```

All tracker data is stored in your browser's local storage. Use the Settings data export/import controls when moving your tracker data and uploaded images to another computer.

## OpenAI Smart Scan

Smart Scan is optional. It sends only the uploaded screenshot or selected loot-row crop to OpenAI through the local PowerShell server, then maps returned item names back to your linked Settings items.

1. Create an OpenAI API key from the OpenAI API key page: https://platform.openai.com/api-keys
2. Copy `config.local.example.json` to `config.local.json`.
3. Put your key in `config.local.json`:

```json
{
  "openaiApiKey": "sk-your-openai-api-key-here",
  "model": "gpt-4.1-mini"
}
```

`config.local.json` is ignored by git and should not be committed. Keep using `.\serve.ps1`; Smart Scan will not work by opening `index.html` directly because the API key is kept in the local server.

When moving the app folder to another computer, copy `config.local.json` too if you want Smart Scan to work there.

The Settings page shows local Smart Scan usage based on token counts returned by successful OpenAI calls. This is useful for estimating app usage, but OpenAI's Usage Dashboard or Costs API remains the source of truth for billing across all apps and keys.
