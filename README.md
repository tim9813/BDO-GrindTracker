# BDO-GrindTracker

Static Black Desert Online grind-session tracker for comparing silver, hours, classes, spots, loot items, and screenshot-assisted OCR loot entry.

## Features

- Track grind sessions by spot and class
- Maintain a shared loot item library with prices and tax settings
- Compare total silver, silver per hour, and total hours
- Import and export tracker data as JSON
- Scan screenshots locally with bundled Tesseract.js assets

## Run Locally

Open `index.html` directly for the core tracker, or run the included local server for the OCR worker assets:

```powershell
.\serve.ps1
```

Then open:

```text
http://localhost:5175/
```

All tracker data is stored in your browser's local storage.
