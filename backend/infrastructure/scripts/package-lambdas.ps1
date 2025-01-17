# Enable strict mode and stop on errors
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Package-Lambda {
    param (
        [string]$functionName,
        [string]$sourcePath,
        [string]$outputPath
    )
    
    try {
        Write-Host "Packaging $functionName..."
        $lambdaDir = Join-Path $PSScriptRoot "..\lambda"
        
        # Create lambda dist directory if it doesn't exist
        $lambdaDistDir = Join-Path $lambdaDir "dist\lambdas"
        if (-not (Test-Path $lambdaDistDir)) {
            New-Item -ItemType Directory -Force -Path $lambdaDistDir | Out-Null
        }
        
        # Set the correct output path in the lambda dist directory
        $outputPath = Join-Path $lambdaDistDir "$functionName.zip"
        
        # Remove existing zip if it exists
        if (Test-Path $outputPath) {
            Remove-Item -Path $outputPath -Force
        }

        # Create a temporary directory for the package
        $tempDir = Join-Path $lambdaDir "temp_$functionName"
        if (Test-Path $tempDir) {
            Remove-Item -Path $tempDir -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

        # Create src directory structure in temp
        $tempSrcDir = Join-Path $tempDir "src"
        New-Item -ItemType Directory -Force -Path $tempSrcDir | Out-Null

        # Create a simplified mockData.ts for Lambda
        $mockDataContent = @'
// Simplified mock data for Lambda functions
export const mockScoreboard = { games: [] };
export const mockBoxScore = { game: null };
'@
        $mockDataPath = Join-Path $tempSrcDir "services/mockData.ts"
        $mockDataDir = Split-Path -Parent $mockDataPath
        if (-not (Test-Path $mockDataDir)) {
            New-Item -ItemType Directory -Force -Path $mockDataDir | Out-Null
        }
        Set-Content -Path $mockDataPath -Value $mockDataContent

        # Copy necessary source files while maintaining directory structure
        $srcFiles = @(
            "lambdas/$functionName.ts",
            "services/nbaService.ts",
            "types/index.ts",
            "types/enums.ts",
            "config/logger.ts",
            "config/nbaApi.ts"
        )

        foreach ($file in $srcFiles) {
            $sourcePath = Join-Path $PSScriptRoot "../../src" $file
            $targetDir = Join-Path $tempSrcDir (Split-Path -Parent $file)
            $targetPath = Join-Path $tempSrcDir $file

            if (Test-Path $sourcePath) {
                if (-not (Test-Path $targetDir)) {
                    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
                }
                Copy-Item -Path $sourcePath -Destination $targetPath -Force
            }
        }

        # Copy package.json and tsconfig.json
        Copy-Item -Path (Join-Path $lambdaDir "package.json") -Destination $tempDir
        Copy-Item -Path (Join-Path $PSScriptRoot "../../tsconfig.json") -Destination $tempDir

        # Install dependencies including TypeScript
        Push-Location $tempDir
        try {
            Write-Host "Installing dependencies..."
            yarn install
            yarn add -D typescript @types/node

            # Create dist directory
            $distDir = Join-Path $tempDir "dist"
            New-Item -ItemType Directory -Force -Path $distDir | Out-Null
            
            # Compile TypeScript
            Write-Host "Compiling TypeScript..."
            yarn tsc --outDir dist

            # Create the zip file with proper directory structure
            Write-Host "Creating zip file..."
            $zipDir = Join-Path $tempDir "zip"
            New-Item -ItemType Directory -Force -Path $zipDir | Out-Null

            # Copy compiled JS files to root of zip
            Get-ChildItem -Path (Join-Path $tempDir "dist/lambdas") -Filter "$functionName.js" | 
                Copy-Item -Destination $zipDir -Force
            
            # Copy other compiled files maintaining directory structure
            Copy-Item -Path (Join-Path $tempDir "dist/services") -Destination (Join-Path $zipDir "services") -Recurse -Force
            Copy-Item -Path (Join-Path $tempDir "dist/types") -Destination (Join-Path $zipDir "types") -Recurse -Force
            Copy-Item -Path (Join-Path $tempDir "dist/config") -Destination (Join-Path $zipDir "config") -Recurse -Force
            
            # Copy node_modules
            Copy-Item -Path (Join-Path $tempDir "node_modules") -Destination $zipDir -Recurse -Force

            # Create the final zip file
            Compress-Archive -Path "$zipDir/*" -DestinationPath $outputPath -Force
            
            Write-Host "Successfully packaged $functionName to $outputPath"
        }
        finally {
            Pop-Location
            
            # Cleanup
            if (Test-Path $tempDir) {
                Remove-Item -Path $tempDir -Recurse -Force
            }
        }
    }
    catch {
        Write-Error "Failed to package ${functionName}: $($_.Exception.Message)"
        throw
    }
}

try {
    # Package each Lambda function
    Package-Lambda -functionName "gameUpdateHandler" `
        -sourcePath "src/lambdas/gameUpdateHandler.ts" `
        -outputPath "gameUpdateHandler.zip"

    Package-Lambda -functionName "boxScoreHandler" `
        -sourcePath "src/lambdas/boxScoreHandler.ts" `
        -outputPath "boxScoreHandler.zip"

    Write-Host "Lambda packaging complete"
} catch {
    Write-Error $_.Exception.Message
    exit 1
}