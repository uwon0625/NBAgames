# Function to recursively analyze imports
function Get-FileImports {
    param (
        [string]$filePath,
        [System.Collections.Generic.HashSet[string]]$visitedFiles
    )

    if (-not (Test-Path $filePath) -or $visitedFiles.Contains($filePath)) {
        return
    }

    $visitedFiles.Add($filePath)
    Write-Host "Analyzing $filePath"

    $content = Get-Content $filePath -Raw
    
    # Find all imports using multiple regex patterns
    $patterns = @(
        # ES6 imports
        "(?:import|require)\s*\{?\s*[^}]*\}?\s*from\s*['""]([^'""]+)['""]",
        # require statements
        "require\(['""]([^'""]+)['""]",
        # Direct imports
        "import\s+['""]([^'""]+)['""]",
        # Variable imports
        "import\s+\*\s+as\s+\w+\s+from\s+['""]([^'""]+)['""]"
    )

    foreach ($pattern in $patterns) {
        $imports = [regex]::Matches($content, $pattern)
        foreach ($import in $imports) {
            $importPath = $import.Groups[1].Value
            
            # Skip node_modules imports but log them
            if ($importPath.StartsWith('.')) {
                $dir = Split-Path $filePath
                $resolvedPath = Join-Path $dir $importPath
                
                # Try different extensions
                $extensions = @('.ts', '.js', '.json', '/index.ts', '/index.js')
                foreach ($ext in $extensions) {
                    $fullPath = [System.IO.Path]::GetFullPath("$resolvedPath$ext")
                    if (Test-Path $fullPath) {
                        Get-FileImports -filePath $fullPath -visitedFiles $visitedFiles
                        break
                    }
                }
            } else {
                Write-Host "External dependency: $importPath" -ForegroundColor Yellow
            }
        }
    }

    # Additional check for specific packages in content
    $packagePatterns = @(
        "axios",
        "fetch",
        "node-fetch"
    )

    foreach ($pkg in $packagePatterns) {
        if ($content -match $pkg) {
            Write-Host "Found potential dependency: $pkg" -ForegroundColor Cyan
        }
    }
}

# Start analysis from Lambda handlers
$srcRoot = Join-Path $PSScriptRoot "..\..\src"
$visitedFiles = New-Object System.Collections.Generic.HashSet[string]

Write-Host "`nAnalyzing gameUpdateHandler dependencies:" -ForegroundColor Green
Get-FileImports -filePath (Join-Path $srcRoot "lambdas\gameUpdateHandler.ts") -visitedFiles $visitedFiles

$visitedFiles.Clear()
Write-Host "`nAnalyzing boxScoreHandler dependencies:" -ForegroundColor Green
Get-FileImports -filePath (Join-Path $srcRoot "lambdas\boxScoreHandler.ts") -visitedFiles $visitedFiles 