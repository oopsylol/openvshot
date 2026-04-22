<#
.SYNOPSIS
Automates OpenVshot macOS formal distribution preparation on Windows.

.DESCRIPTION
This script supports three actions:
1. Generate a private key and CSR for Apple Developer certificate requests.
2. Convert the Apple-issued certificate and private key into a P12 bundle.
3. Import the macOS signing and notarization materials into GitHub Actions secrets.
#>

[CmdletBinding(DefaultParameterSetName = "Help")]
param(
  [Parameter(Mandatory = $true, ParameterSetName = "CreateCsr")]
  [switch]$CreateCsr,

  [Parameter(Mandatory = $true, ParameterSetName = "CreateP12")]
  [switch]$CreateP12,

  [Parameter(Mandatory = $true, ParameterSetName = "ImportSecrets")]
  [switch]$ImportSecrets,

  [Parameter(ParameterSetName = "CreateCsr")]
  [Parameter(ParameterSetName = "CreateP12")]
  [string]$OutputDirectory = ".\macos-distribution",

  [Parameter(ParameterSetName = "CreateCsr")]
  [string]$CommonName = "OpenVshot Developer ID",

  [Parameter(ParameterSetName = "CreateCsr")]
  [string]$EmailAddress = "",

  [Parameter(ParameterSetName = "CreateCsr")]
  [string]$Country = "CN",

  [Parameter(ParameterSetName = "CreateCsr")]
  [string]$State = "Guangdong",

  [Parameter(ParameterSetName = "CreateCsr")]
  [string]$City = "Shenzhen",

  [Parameter(ParameterSetName = "CreateCsr")]
  [string]$Organization = "OpenVshot",

  [Parameter(ParameterSetName = "CreateCsr")]
  [string]$OrganizationalUnit = "Engineering",

  [Parameter(Mandatory = $true, ParameterSetName = "CreateP12")]
  [string]$PrivateKeyPath,

  [Parameter(Mandatory = $true, ParameterSetName = "CreateP12")]
  [string]$CertificatePath,

  [Parameter(ParameterSetName = "CreateP12")]
  [string]$P12Password,

  [Parameter(ParameterSetName = "CreateP12")]
  [string]$P12OutputPath = "",

  [Parameter(Mandatory = $true, ParameterSetName = "ImportSecrets")]
  [string]$Repo,

  [Parameter(Mandatory = $true, ParameterSetName = "ImportSecrets")]
  [string]$CertificateName,

  [Parameter(Mandatory = $true, ParameterSetName = "ImportSecrets")]
  [string]$P12Path,

  [Parameter(ParameterSetName = "ImportSecrets")]
  [string]$P12SecretPassword,

  [Parameter(ParameterSetName = "ImportSecrets")]
  [string]$KeychainPassword,

  [Parameter(Mandatory = $true, ParameterSetName = "ImportSecrets")]
  [string]$ApiKeyFile,

  [Parameter(Mandatory = $true, ParameterSetName = "ImportSecrets")]
  [string]$ApiKeyId,

  [Parameter(Mandatory = $true, ParameterSetName = "ImportSecrets")]
  [string]$ApiIssuer,

  [Parameter(ParameterSetName = "ImportSecrets")]
  [switch]$Apply,

  [Parameter(ParameterSetName = "ImportSecrets")]
  [string]$GeneratedImportScriptPath = ".\github-macos-secrets-import.ps1"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Function summary:
# Writes consistent log lines for automation progress.
function Write-Log {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Level,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  Write-Host "[$Level] $Message"
}

# Function summary:
# Throws a terminating error to stop incomplete automation flows.
function Stop-WithError {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  throw $Message
}

# Function summary:
# Ensures that a required command exists before continuing.
function Assert-CommandExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CommandName
  )

  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    Stop-WithError "Missing command: $CommandName"
  }
}

# Function summary:
# Ensures that a directory exists before writing files into it.
function Ensure-Directory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

# Function summary:
# Generates a strong random password for the temporary CI keychain.
function New-RandomSecret {
  param(
    [int]$ByteCount = 24
  )

  $bytes = New-Object byte[] $ByteCount
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes)
}

# Function summary:
# Reads a secret value without echoing it to the console.
function Read-SecretValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt
  )

  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

# Function summary:
# Escapes a string as a single-quoted PowerShell literal.
function ConvertTo-PowerShellSingleQuotedLiteral {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Value
  )

  return "'" + $Value.Replace("'", "''") + "'"
}

# Function summary:
# Generates the private key and CSR used for a Developer ID certificate request.
function New-AppleDeveloperCsr {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetDirectory,

    [Parameter(Mandatory = $true)]
    [string]$Cn,

    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Mail,

    [Parameter(Mandatory = $true)]
    [string]$C,

    [Parameter(Mandatory = $true)]
    [string]$St,

    [Parameter(Mandatory = $true)]
    [string]$L,

    [Parameter(Mandatory = $true)]
    [string]$O,

    [Parameter(Mandatory = $true)]
    [string]$Ou
  )

  Assert-CommandExists -CommandName "openssl"
  Ensure-Directory -Path $TargetDirectory

  $privateKeyPath = Join-Path $TargetDirectory "developer_id_private.key"
  $csrPath = Join-Path $TargetDirectory "developer_id_request.csr"
  $subjectParts = @()
  if (-not [string]::IsNullOrWhiteSpace($Mail)) {
    $subjectParts += "emailAddress=$Mail"
  }
  $subjectParts += "C=$C"
  $subjectParts += "ST=$St"
  $subjectParts += "L=$L"
  $subjectParts += "O=$O"
  $subjectParts += "OU=$Ou"
  $subjectParts += "CN=$Cn"
  $subject = "/" + ($subjectParts -join "/")

  Write-Log -Level "INFO" -Message "Generating Developer ID private key..."
  & openssl genrsa -out $privateKeyPath 2048
  if ($LASTEXITCODE -ne 0) {
    Stop-WithError "Failed to generate the private key."
  }

  Write-Log -Level "INFO" -Message "Generating CSR..."
  & openssl req -new -key $privateKeyPath -out $csrPath -subj $subject
  if ($LASTEXITCODE -ne 0) {
    Stop-WithError "Failed to generate the CSR."
  }

  Write-Log -Level "INFO" -Message "CSR created: $csrPath"
  Write-Log -Level "INFO" -Message "Private key created: $privateKeyPath"
}

# Function summary:
# Builds a P12 file from the Apple-issued certificate and the saved private key.
function New-AppleDeveloperP12 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$KeyPath,

    [Parameter(Mandatory = $true)]
    [string]$CerPath,

    [Parameter(Mandatory = $true)]
    [string]$ExportPassword,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
  )

  Assert-CommandExists -CommandName "openssl"

  if (-not (Test-Path -LiteralPath $KeyPath)) {
    Stop-WithError "Private key file not found: $KeyPath"
  }

  if (-not (Test-Path -LiteralPath $CerPath)) {
    Stop-WithError "Certificate file not found: $CerPath"
  }

  $certificateExtension = [System.IO.Path]::GetExtension($CerPath).ToLowerInvariant()
  $normalizedCertificatePath = $CerPath

  if ($certificateExtension -eq ".cer") {
    $normalizedCertificatePath = [System.IO.Path]::ChangeExtension($CerPath, ".pem")
    Write-Log -Level "INFO" -Message "Converting .cer to PEM..."
    & openssl x509 -inform DER -in $CerPath -out $normalizedCertificatePath
    if ($LASTEXITCODE -ne 0) {
      Stop-WithError "Failed to convert the certificate to PEM."
    }
  }

  Write-Log -Level "INFO" -Message "Generating P12 bundle..."
  & openssl pkcs12 -export -out $OutputPath -inkey $KeyPath -in $normalizedCertificatePath -passout "pass:$ExportPassword"
  if ($LASTEXITCODE -ne 0) {
    Stop-WithError "Failed to generate the P12 bundle."
  }

  Write-Log -Level "INFO" -Message "P12 created: $OutputPath"
}

# Function summary:
# Generates a PowerShell helper script that imports the required GitHub secrets.
function New-GitHubSecretImportScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetPath,

    [Parameter(Mandatory = $true)]
    [hashtable]$SecretValues,

    [Parameter(Mandatory = $true)]
    [string]$Repository
  )

  $lines = @(
    "<#",
    ".SYNOPSIS",
    "Imports OpenVshot macOS formal distribution secrets into the target GitHub repository.",
    "#>",
    '$ErrorActionPreference = "Stop"',
    '$repo = ' + (ConvertTo-PowerShellSingleQuotedLiteral -Value $Repository),
    ""
  )

  foreach ($secretName in $SecretValues.Keys) {
    $secretValue = [string]$SecretValues[$secretName]
    $valueLiteral = ConvertTo-PowerShellSingleQuotedLiteral -Value $secretValue
    $lines += '$value = ' + $valueLiteral
    $lines += "gh secret set $secretName --repo `$repo --body `$value"
    $lines += ""
  }

  $lines += 'Write-Host "GitHub Actions secrets updated for $repo"'
  Set-Content -LiteralPath $TargetPath -Value $lines -Encoding UTF8
}

# Function summary:
# Converts the local signing materials and imports them into GitHub Actions secrets.
function Import-MacDistributionSecrets {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Repository,

    [Parameter(Mandatory = $true)]
    [string]$SigningCertificateName,

    [Parameter(Mandatory = $true)]
    [string]$SigningP12Path,

    [Parameter(Mandatory = $true)]
    [string]$SigningP12Password,

    [Parameter(Mandatory = $true)]
    [string]$CiKeychainPassword,

    [Parameter(Mandatory = $true)]
    [string]$ApiPrivateKeyFile,

    [Parameter(Mandatory = $true)]
    [string]$ApiKeyIdentifier,

    [Parameter(Mandatory = $true)]
    [string]$ApiIssuerIdentifier,

    [Parameter(Mandatory = $true)]
    [bool]$ShouldApply,

    [Parameter(Mandatory = $true)]
    [string]$ImportScriptPath
  )

  Assert-CommandExists -CommandName "gh"

  if (-not (Test-Path -LiteralPath $SigningP12Path)) {
    Stop-WithError "P12 file not found: $SigningP12Path"
  }

  if (-not (Test-Path -LiteralPath $ApiPrivateKeyFile)) {
    Stop-WithError "API key file not found: $ApiPrivateKeyFile"
  }

  $p12Base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $SigningP12Path)))
  $apiKeyContent = Get-Content -LiteralPath $ApiPrivateKeyFile -Raw -Encoding UTF8

  if ([string]::IsNullOrWhiteSpace($p12Base64)) {
    Stop-WithError "Failed to encode the P12 file."
  }

  if ([string]::IsNullOrWhiteSpace($apiKeyContent)) {
    Stop-WithError "API key file is empty: $ApiPrivateKeyFile"
  }

  $secretValues = [ordered]@{
    CSC_NAME                 = $SigningCertificateName
    BUILD_CERTIFICATE_BASE64 = $p12Base64
    P12_PASSWORD             = $SigningP12Password
    KEYCHAIN_PASSWORD        = $CiKeychainPassword
    APPLE_API_KEY            = $apiKeyContent
    APPLE_API_KEY_ID         = $ApiKeyIdentifier
    APPLE_API_ISSUER         = $ApiIssuerIdentifier
  }

  New-GitHubSecretImportScript -TargetPath $ImportScriptPath -SecretValues $secretValues -Repository $Repository
  Write-Log -Level "INFO" -Message "Generated GitHub secret import script: $ImportScriptPath"

  if ($ShouldApply) {
    & gh auth status | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Stop-WithError "gh is not authenticated. Run: gh auth login"
    }

    foreach ($secretName in $secretValues.Keys) {
      $secretValue = [string]$secretValues[$secretName]
      Write-Log -Level "INFO" -Message "Writing GitHub secret: $secretName"
      & gh secret set $secretName --repo $Repository --body $secretValue
      if ($LASTEXITCODE -ne 0) {
        Stop-WithError "Failed to write GitHub secret: $secretName"
      }
    }
  }
  else {
    Write-Log -Level "WARN" -Message "Secrets were not applied automatically. Run this script manually: $ImportScriptPath"
  }
}

switch ($PSCmdlet.ParameterSetName) {
  "CreateCsr" {
    New-AppleDeveloperCsr `
      -TargetDirectory $OutputDirectory `
      -Cn $CommonName `
      -Mail $EmailAddress `
      -C $Country `
      -St $State `
      -L $City `
      -O $Organization `
      -Ou $OrganizationalUnit
  }
  "CreateP12" {
    if ([string]::IsNullOrWhiteSpace($P12Password)) {
      $P12Password = Read-SecretValue -Prompt "Enter the password for the exported P12"
    }

    if ([string]::IsNullOrWhiteSpace($P12OutputPath)) {
      Ensure-Directory -Path $OutputDirectory
      $P12OutputPath = Join-Path $OutputDirectory "openvshot-developer-id.p12"
    }

    New-AppleDeveloperP12 `
      -KeyPath $PrivateKeyPath `
      -CerPath $CertificatePath `
      -ExportPassword $P12Password `
      -OutputPath $P12OutputPath
  }
  "ImportSecrets" {
    if ([string]::IsNullOrWhiteSpace($P12SecretPassword)) {
      $P12SecretPassword = Read-SecretValue -Prompt "Enter the password for the P12 file"
    }

    if ([string]::IsNullOrWhiteSpace($KeychainPassword)) {
      $KeychainPassword = New-RandomSecret
      Write-Log -Level "INFO" -Message "Generated KEYCHAIN_PASSWORD automatically."
    }

    Import-MacDistributionSecrets `
      -Repository $Repo `
      -SigningCertificateName $CertificateName `
      -SigningP12Path $P12Path `
      -SigningP12Password $P12SecretPassword `
      -CiKeychainPassword $KeychainPassword `
      -ApiPrivateKeyFile $ApiKeyFile `
      -ApiKeyIdentifier $ApiKeyId `
      -ApiIssuerIdentifier $ApiIssuer `
      -ShouldApply ([bool]$Apply) `
      -ImportScriptPath $GeneratedImportScriptPath
  }
  default {
    Get-Help -Detailed $PSCommandPath
  }
}
