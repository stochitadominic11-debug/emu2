param([string]$ProjectDir)

$ErrorActionPreference = 'Stop'

function New-RandomToken($length) {
    -join ((48..57) + (97..122) | Get-Random -Count $length | ForEach-Object { [char]$_ })
}

try {
    $envPath = Join-Path $ProjectDir '.env'
    $envExamplePath = Join-Path $ProjectDir '.env.example'
    $configPath = Join-Path $ProjectDir 'agent-win\config.json'
    $configExamplePath = Join-Path $ProjectDir 'agent-win\config.example.json'

    $createdPassword = $null

    if (-not (Test-Path $envPath)) {
        Copy-Item $envExamplePath $envPath
        $password = New-RandomToken 8
        $secret = New-RandomToken 16
        (Get-Content $envPath) -replace 'cambiami-subito', $password -replace 'local-demo-secret', $secret |
            Set-Content $envPath
        $createdPassword = $password
    }

    if (-not (Test-Path $configPath)) {
        Copy-Item $configExamplePath $configPath
        $envSecretLine = Get-Content $envPath | Where-Object { $_ -match '^AGENT_SECRET=' }
        $envSecret = ($envSecretLine -split '=', 2)[1]
        (Get-Content $configPath) -replace 'local-demo-secret', $envSecret | Set-Content $configPath
        Write-Host "Configurazione dell'agent creata e collegata automaticamente al sito."
        Write-Host ''
    }

    if ($createdPassword) {
        Write-Host ''
        Write-Host '============================================================'
        Write-Host ' Configurazione creata. Password del sito (la usi anche tu'
        Write-Host ' e il tuo amico per entrare):'
        Write-Host ''
        Write-Host "     $createdPassword"
        Write-Host ''
        Write-Host ' La trovi sempre dentro il file .env se te la dimentichi.'
        Write-Host ' GAMES_DIR di default e'' C:\games: cambialo nel file .env'
        Write-Host ' se i tuoi giochi stanno altrove.'
        Write-Host '============================================================'
        Write-Host ''
    }
}
catch {
    Write-Host ''
    Write-Host 'Qualcosa e'' andato storto durante la configurazione automatica:'
    Write-Host $_.Exception.Message
    Write-Host ''
    Write-Host 'Puoi anche farlo a mano: copia .env.example in .env e'
    Write-Host 'agent-win\config.example.json in agent-win\config.json,'
    Write-Host 'poi apri .env e imposta una password.'
    exit 1
}
