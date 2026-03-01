param(
  [Parameter(Mandatory = $true)][string]$FrontendRepoUrl,
  [Parameter(Mandatory = $true)][string]$BackendRepoUrl,
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

Write-Host "Preparando repo frontend..."
Push-Location "frontend"
if (-not (Test-Path ".git")) {
  git init
}
git add .
git commit -m "chore: setup frontend for deploy" --allow-empty
git branch -M $Branch
git remote remove origin 2>$null
git remote add origin $FrontendRepoUrl
git push -u origin $Branch
Pop-Location

Write-Host "Preparando repo backend..."
Push-Location "backend"
if (-not (Test-Path ".git")) {
  git init
}
git add .
git commit -m "chore: setup backend for deploy" --allow-empty
git branch -M $Branch
git remote remove origin 2>$null
git remote add origin $BackendRepoUrl
git push -u origin $Branch
Pop-Location

Write-Host "Concluido."
