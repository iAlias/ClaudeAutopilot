const GIT = String.raw`\bgit(\s+(-[cC]\s+("[^"]*"|'[^']*'|[^\s"']\S*)|--[a-z][\w-]*(=("[^"]*"|'[^']*'|[^\s"']\S*))?))*`

export default {
  safeTools: ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite', 'WebSearch', 'ToolSearch', 'Skill', 'Agent', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput'],
  riskyShell: [
    { id: 'rm-recursive', description: 'deleting files and folders recursively', pattern: String.raw`\brm\s+(-[a-z]+\s+)*(-[a-z]*r[a-z]*|--recursive)\b|\bremove-item\b[^|;&]*-recurse|\brmdir\s+(\/[a-z]+\s+)*\/s\b|\bdel\s+(\/[a-z]+\s+)*\/s\b|\brd\s+(\/[a-z]+\s+)*\/s\b` },
    { id: 'find-delete', description: 'bulk deletion of files', pattern: String.raw`\bfind\b[^|;&]*\s(-delete|-exec\s+rm)\b` },
    { id: 'git-push', description: 'publishing commits to a remote repository', pattern: String.raw`${GIT}\s+push\b` },
    { id: 'git-destructive', description: 'discarding local changes', pattern: String.raw`${GIT}\s+(reset\b[^|;&]*--hard\b|clean\s+(-[a-z]+\s+)*-[a-z]*f[a-z]*\b|checkout\s+(-f\b|--force\b)|checkout\s+(\S+\s+)?--\s+\.(?=\s|$)|checkout\s+\.(?=\s|$)|restore\s+\.|stash\s+(drop|clear))` },
    { id: 'git-destructive', description: 'discarding local changes', pattern: String.raw`${GIT}\s+branch\s+-D\b`, caseSensitive: true },
    { id: 'upload', description: 'sending data to an external server', pattern: String.raw`\bcurl\b[^|;&]*(\s-d\b|\s--data|\s-F\b|\s--form|\s-T\b|\s--upload-file|\s--json\b|\s-X\s*(POST|PUT|PATCH|DELETE))|\bwget\b[^|;&]*--post|\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b[^|;&]*(-method\s+(post|put|patch|delete)|-body|-infile)|(^|[;&|\n]\s*)scp\b|\brsync\b[^|;&]*\S+:|(^|[;&|\n]\s*)sftp\b|(^|[;&|\n]\s*)ftp\b|\baws\s+s3\s+(cp|sync|mv)\b|\baz\s+storage\s+blob\s+upload\b` },
    { id: 'publish', description: 'publishing content online', pattern: String.raw`\bgh\s+(pr|release|repo|gist|issue)\s+(create|edit|merge|delete|comment|close|upload|review)\b|\bgh\s+api\b[^|;&]*(-X|--method)\s*(POST|PUT|PATCH|DELETE)|\b(npm|pnpm|yarn)\s+publish\b|\bdocker\s+push\b` },
    { id: 'pipe-to-shell', description: 'running a script downloaded from the internet', pattern: String.raw`\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^;&]*\|\s*(sh|bash|zsh|iex|invoke-expression|python3?|node|pwsh|powershell)\b|\$\(\s*(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b|<\(\s*(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b|\b(iex|invoke-expression)\b\s*\(*\s*(irm|iwr|invoke-restmethod|invoke-webrequest)\b|\b(iex|invoke-expression)\b[^;&]*\b(downloadstring|webclient)\b` },
    { id: 'global-install', description: 'installing software system-wide', pattern: String.raw`\b(npm|pnpm)\s+(i|install|add)\b[^|;&]*\s(-g|--global)\b|\b(npm|pnpm)\s+(i|install|add)\b[^|;&]*--location[=\s]+global\b|\byarn\s+global\s+add\b|\b(winget|choco|scoop|brew)\s+install\b|\b(apt|apt-get|dnf|yum|pacman)\s+(install|-S)\b|\bpip3?\s+install\b[^|;&]*--user\b|\bcargo\s+install\b|\bgo\s+install\b|\b(install-module|install-package|install-script)\b|\bdotnet\s+tool\s+install\b[^|;&]*(-g|--global)\b|\bpipx\s+install\b|\buv\s+tool\s+install\b` },
    { id: 'system', description: 'changing system settings', pattern: String.raw`\breg\s+(add|delete|import)\b|\b(set|new|remove)-itemproperty\b[^|;&]*\b(hklm|hkcu|registry::)|\b(new|remove)-item\b[^|;&]*\b(hklm|hkcu|registry::)|\bsetx\b|\bsc(\.exe)?\s+(create|delete|config|stop)\b|\b(start|stop|restart|set|new|remove)-service\b|\bschtasks\b[^|;&]*/(create|delete)|(^|[;&|\n]\s*)shutdown\b|\bformat\s+[a-z]:|\bdiskpart\b|\bsudo\b|\bchmod\s+-R\b|\bchown\s+-R\b|\[environment\]::setenvironmentvariable\b|\bset-executionpolicy\b|\bnet\s+(stop|start|user)\b` },
  ],
  credentialPattern: String.raw`(^|[\\/\s"'])(\.env(?!\.(example|sample|template)\b)(\.[\w-]+)?|id_rsa|id_ed25519|id_ecdsa|[\w-]*\.pem|[\w-]*\.pfx|[\w-]*\.p12|credentials\.json|\.git-credentials|\.npmrc|\.pypirc|\.netrc)(["'\s]|$)|[\\/]\.ssh[\\/]|[\\/]\.aws[\\/]`,
  safeShell: [
    String.raw`^(ls|dir|pwd|cat|type|head|tail|wc|echo|grep|rg|which|where|tree|stat|file|du|df|date|whoami|sort|uniq|cut|diff|less|more)\b`,
    String.raw`^(get-childitem|get-content|select-string|get-location|test-path|get-item|resolve-path|measure-object|get-command|write-output|write-host)\b`,
    String.raw`^git\s+(status|diff|log|show|branch|add|commit|checkout|switch|restore\s+--staged|stash(\s+(push|list|show|pop|apply))?|fetch|pull|rev-parse|ls-files|blame|init|remote(\s+-v)?|tag\s+-l|config\s+--get)\b`,
    String.raw`^(npm|pnpm|yarn)\s+(test|run|ci|install|i|ls|list|outdated|view)\b`,
    String.raw`^node\s+(--test|-v|--version)\b`,
    String.raw`^(python3?|py)\s+-m\s+(pytest|unittest|pip\s+(list|show|freeze))\b`,
    String.raw`^(pytest|tsc|eslint|prettier|jest|vitest|mocha|ruff|black|mypy)\b`,
    String.raw`^(cargo|go)\s+(build|test|check|fmt|vet|run)\b`,
    String.raw`^dotnet\s+(build|test|run|restore)\b`,
    String.raw`^(mkdir|cd|touch|new-item\s+-itemtype\s+directory)\b`,
  ],
}
