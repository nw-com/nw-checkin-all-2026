$shell = New-Object -ComObject Shell.Application
$recycleBin = $shell.NameSpace(0xa)
$items = $recycleBin.Items()
foreach ($item in $items) {
    if ($item.Path -like "*nw-finance-2026*index.html") {
        Write-Host "Found: $($item.Path)"
        $item.InvokeVerb("restore")
        Write-Host "Restored"
        exit
    }
}
Write-Host "Not Found"