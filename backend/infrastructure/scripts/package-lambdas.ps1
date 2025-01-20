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
        Write-Host "Packaging $functionName..." -ForegroundColor Cyan
        
        # Create lambda dist directory if it doesn't exist
        $lambdaDir = Join-Path $PSScriptRoot "..\lambda"
        $lambdaDistDir = Join-Path $lambdaDir "dist\lambdas"
        if (-not (Test-Path $lambdaDistDir)) {
            New-Item -ItemType Directory -Force -Path $lambdaDistDir | Out-Null
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

        # Verify required files exist before starting
        $requiredFiles = @(
            @{
                Path = Join-Path $lambdaDir "package.json"
                Name = "package.json"
            },
            @{
                Path = Join-Path $lambdaDir "yarn.lock"
                Name = "yarn.lock"
            },
            @{
                Path = Join-Path $lambdaDir "tsconfig.json"
                Name = "tsconfig.json"
            }
        )

        foreach ($file in $requiredFiles) {
            if (-not (Test-Path $file.Path)) {
                throw "Required file not found: $($file.Name) in $lambdaDir"
            }
        }

        # Copy necessary source files while maintaining directory structure
        $srcFiles = @(
            "lambdas/$sourcePath",
            "types/index.ts",
            "types/enums.ts",
            "config/logger.ts",
            "config/nbaApi.ts",
            "services/nbaService.ts",
            "services/sqsService.ts",
            "services/gameService.ts",            
            "services/mockData.ts"
        )

        $missingFiles = @()
        foreach ($file in $srcFiles) {
            $sourceFile = Join-Path $PSScriptRoot "..\..\src" $file
            $targetDir = Join-Path $tempSrcDir (Split-Path -Parent $file)
            $targetFile = Join-Path $tempSrcDir $file

            if (Test-Path $sourceFile) {
                if (-not (Test-Path $targetDir)) {
                    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
                }
                Copy-Item -Path $sourceFile -Destination $targetFile -Force
            } else {
                $missingFiles += $file
            }
        }

        if ($missingFiles.Count -gt 0) {
            throw "Required source files not found:`n$($missingFiles | ForEach-Object { "- $_" } | Out-String)"
        }


        # Copy package.json and yarn.lock from lambda directory
        Copy-Item -Path (Join-Path $lambdaDir "package.json") -Destination $tempDir
        Copy-Item -Path (Join-Path $lambdaDir "yarn.lock") -Destination $tempDir
        Copy-Item -Path (Join-Path $lambdaDir "tsconfig.json") -Destination $tempDir

        # Install dependencies using yarn
        Push-Location $tempDir
        try {
            Write-Host "Installing dependencies for $functionName..." -ForegroundColor Cyan
            $yarnOutput = yarn install 2>&1
            if ($LASTEXITCODE -ne 0) {
                throw "Yarn install failed with exit code $LASTEXITCODE`n$yarnOutput"
            }
            
            # Compile TypeScript
            Write-Host "Compiling TypeScript for $functionName..." -ForegroundColor Cyan
            $tscOutput = yarn tsc 2>&1
            if ($LASTEXITCODE -ne 0) {
                throw "TypeScript compilation failed with exit code $LASTEXITCODE`n$tscOutput"
            }

            # Verify compilation output exists
            $distPath = Join-Path $tempDir "dist"
            if (-not (Test-Path $distPath) -or (Get-ChildItem $distPath -Recurse -File).Count -eq 0) {
                throw "TypeScript compilation produced no output files"
            }

            # Create a directory for the final package contents
            $packageDir = Join-Path $tempDir "package"
            New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

            # Create index.ts at the root level that imports from lambdas directory
            $indexContent = @"
const { handler } = require('./lambdas/$functionName.js');
exports.handler = handler;
"@
            Set-Content (Join-Path $packageDir "index.js") $indexContent

            # Copy the compiled files maintaining directory structure
            Copy-Item -Path (Join-Path $distPath "*") -Destination $packageDir -Recurse

            # Copy production dependencies
            Push-Location $packageDir
            try {
                Copy-Item -Path (Join-Path $tempDir "package.json") -Destination .
                Copy-Item -Path (Join-Path $tempDir "yarn.lock") -Destination .
                $yarnProdOutput = yarn install --production --frozen-lockfile 2>&1
                if ($LASTEXITCODE -ne 0) {
                    throw "Production dependencies installation failed with exit code $LASTEXITCODE`n$yarnProdOutput"
                }
            }
            finally {
                Pop-Location
            }

            # Create the zip file
            $zipPath = Join-Path $lambdaDistDir $outputPath
            Compress-Archive -Path "$packageDir/*" -DestinationPath $zipPath -Force

            # Verify zip file was created and has content
            if (-not (Test-Path $zipPath) -or (Get-Item $zipPath).Length -eq 0) {
                throw "Failed to create zip file or zip file is empty: $zipPath"
            }

            Write-Host "Successfully packaged $functionName to $zipPath" -ForegroundColor Green
        }
        finally {
            Pop-Location
            # Cleanup temp directory
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
        -sourcePath "gameUpdateHandler.ts" `
        -outputPath "gameUpdateHandler.zip"

    Package-Lambda -functionName "boxScoreHandler" `
        -sourcePath "boxScoreHandler.ts" `
        -outputPath "boxScoreHandler.zip"

    Write-Host "Lambda packaging complete" -ForegroundColor Green
} catch {
    Write-Error "Lambda packaging failed: $($_.Exception.Message)"
    exit 1
}