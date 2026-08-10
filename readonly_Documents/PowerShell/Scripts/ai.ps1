function ai {
    Write-Host "1) codex"
    Write-Host "2) opencode"
    Write-Host "3) pi"
    Write-Host "4) agy"
    Write-Host "5) claude"
    Write-Host "6) copilot"
    Write-Host "7) vibe (mistral)"
    Write-Host "8) kimi"
    Write-Host "9) qwen"
    Write-Host "10) hermes"

    $choice = (Read-Host "Select AI").ToLower()

    switch ($choice) {
        { $_ -in "1","codex" } { codex; break }
        { $_ -in "2","opencode" } { opencode; break }
        { $_ -in "3","pi" } { pi; break }
        { $_ -in "4","agy" } { agy; break }
        { $_ -in "5","claude" } { ccc; break }
        { $_ -in "6","copilot" } { gh copilot; break }
        { $_ -in "7","vibe","mistral" } { vibe; break }
        { $_ -in "8","kimi" } { kimi; break }
        { $_ -in "9","qwen" } { qwen; break }
        { $_ -in "10","hermes" } { hermes; break }
        default { Write-Host "Invalid choice" }
    }
}
