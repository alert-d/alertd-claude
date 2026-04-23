## Install

### Option 1: Quick Install

```bash
curl -H 'Cache-Control: no-cache' https://raw.githubusercontent.com/alert-d/alertd-claude/main/install.sh | sh
```

### Option 2: Manual Install

```bash
claude

/plugin marketplace add alert-d/alertd-claude

/plugin install alertd
```

### Setup

Then open Claude Code and configure your domain:

```bash
/alertd:setup
```


## Download our Binary 

to run on mac you will need to quarantine.
```bash

xattr -d com.apple.quarantine ./alertd-mcp-macos-arm64  

```