$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$port = if ($env:PORT) { [int]$env:PORT } else { 5175 }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".txt"  = "text/plain; charset=utf-8"
}

function Write-JsonResponse {
  param(
    [System.Net.HttpListenerContext]$Context,
    [int]$StatusCode,
    [object]$Data
  )
  $json = $Data | ConvertTo-Json -Depth 30
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $Context.Response.StatusCode = $StatusCode
  $Context.Response.ContentType = "application/json; charset=utf-8"
  $Context.Response.Headers.Add("Cache-Control", "no-store")
  $Context.Response.ContentLength64 = $bytes.Length
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Get-RequestJson {
  param([System.Net.HttpListenerRequest]$Request)
  $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
  try {
    $body = $reader.ReadToEnd()
  } finally {
    $reader.Close()
  }
  if (-not $body) { return $null }
  return $body | ConvertFrom-Json
}

function Get-OpenAIConfig {
  $configPath = Join-Path $root "config.local.json"
  $config = [pscustomobject]@{}
  if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  }
  $apiKey = if ($config.openaiApiKey) { $config.openaiApiKey } elseif ($config.apiKey) { $config.apiKey } else { $env:OPENAI_API_KEY }
  if (-not $apiKey) {
    throw "Missing OpenAI API key. Create config.local.json from config.local.example.json, or set OPENAI_API_KEY."
  }
  return [pscustomobject]@{
    ApiKey = $apiKey
    Model = if ($config.model) { $config.model } else { "gpt-5.4-mini" }
  }
}

function Get-ResponseOutputText {
  param([object]$Response)
  if ($Response.output_text) { return [string]$Response.output_text }
  foreach ($out in @($Response.output)) {
    foreach ($content in @($out.content)) {
      if ($content.text) { return [string]$content.text }
    }
  }
  return ""
}

function Invoke-SmartScan {
  param([object]$Scan)

  $cfg = Get-OpenAIConfig
  if (-not $Scan.imageDataUrl -or -not ($Scan.imageDataUrl -match '^data:image/(png|jpeg|jpg|webp);base64,')) {
    throw "Smart Scan needs a PNG/JPEG/WEBP data URL."
  }
  $items = @($Scan.items) | Where-Object { $_.name }
  if (-not $items.Count) { throw "No linked items were provided for Smart Scan." }

  $itemNames = ($items | ForEach-Object { "- $($_.name)" }) -join "`n"
  $itemNameEnum = @($items | ForEach-Object { [string]$_.name } | Select-Object -Unique)
  $slotHints = @($Scan.slots) | Where-Object { $_.slotIndex }
  $slotSection = if ($slotHints.Count) {
    ($slotHints | Sort-Object { [int]$_.slotIndex } | ForEach-Object {
      $qtyText = if ($_.qty) { "local qty guess $($_.qty)" } else { "no local qty" }
      "$($_.slotIndex). $($_.itemName) ($qtyText)"
    }) -join "`n"
  } else {
    "No client slot hints were provided."
  }
  $prompt = @"
Read this Black Desert Online grind tracker screenshot or cropped loot row.

Use ONLY these local Settings item names:
$itemNames

Client-detected slots from left to right:
$slotSection

Return one loot row per visible item slot, in strict left-to-right visual order.
slotIndex is 1 for the leftmost visible item icon, 2 for the next, and so on.
Do not sort by item name, item type, or quantity.
Do not skip a visible item slot. If the item name is uncertain, choose the closest local Settings item and lower confidence.
Read the stack quantity from the bottom-left of that exact same item icon. Do not borrow a quantity from another slot.
The leftmost slot can have a 4-6 digit trash-loot quantity such as 22358; read all digits.
If a quantity is unreadable, use 0.
If grind time is visible, return it; otherwise set detected=false and hours/minutes/seconds to 0.
"@

  $schema = @{
    type = "object"
    additionalProperties = $false
    required = @("time", "loot")
    properties = @{
      time = @{
        type = "object"
        additionalProperties = $false
        required = @("detected", "hours", "minutes", "seconds")
        properties = @{
          detected = @{ type = "boolean" }
          hours = @{ type = "integer" }
          minutes = @{ type = "integer" }
          seconds = @{ type = "integer" }
        }
      }
      loot = @{
        type = "array"
        items = @{
          type = "object"
          additionalProperties = $false
          required = @("slotIndex", "itemName", "qty", "confidence")
          properties = @{
            slotIndex = @{ type = "integer" }
            itemName = @{ type = "string" }
            qty = @{ type = "integer" }
            confidence = @{ type = "number" }
          }
        }
      }
    }
  }

  $schema["properties"]["loot"]["items"]["properties"]["itemName"]["enum"] = $itemNameEnum

  $payload = @{
    model = $cfg.Model
    input = @(
      @{
        role = "user"
        content = @(
          @{ type = "input_text"; text = $prompt },
          @{ type = "input_image"; image_url = [string]$Scan.imageDataUrl; detail = "high" }
        )
      }
    )
    text = @{
      format = @{
        type = "json_schema"
        name = "bdo_grind_scan"
        strict = $true
        schema = $schema
      }
    }
    max_output_tokens = 800
  }

  $headers = @{
    Authorization = "Bearer $($cfg.ApiKey)"
    "Content-Type" = "application/json"
  }
  $body = $payload | ConvertTo-Json -Depth 40
  $apiResponse = Invoke-RestMethod -Method Post -Uri "https://api.openai.com/v1/responses" -Headers $headers -Body $body
  $text = Get-ResponseOutputText $apiResponse
  if (-not $text) { throw "OpenAI returned no text output." }
  $result = $text | ConvertFrom-Json
  return [pscustomobject]@{
    ok = $true
    provider = "openai"
    model = $cfg.Model
    result = $result
    usage = $apiResponse.usage
  }
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.LocalPath
    if ($path -eq "/api/smart-scan") {
      try {
        if ($ctx.Request.HttpMethod -ne "POST") {
          Write-JsonResponse $ctx 405 @{ ok = $false; error = "Use POST for /api/smart-scan." }
        } else {
          $scan = Get-RequestJson $ctx.Request
          $result = Invoke-SmartScan $scan
          Write-JsonResponse $ctx 200 $result
        }
      } catch {
        Write-JsonResponse $ctx 500 @{ ok = $false; error = $_.Exception.Message }
      }
      $ctx.Response.Close()
      continue
    }
    if ($path -eq "/" -or $path -eq "") { $path = "/index.html" }
    $file = Join-Path $root $path.TrimStart("/")
    if (Test-Path -LiteralPath $file -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $ctype = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ctx.Response.ContentType = $ctype
      $ctx.Response.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
      $ctx.Response.Headers.Add("Pragma", "no-cache")
      $ctx.Response.Headers.Add("Expires", "0")
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.Close()
  } catch {
    Write-Host "Error: $_"
  }
}
