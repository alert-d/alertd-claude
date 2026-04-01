---
name: alertd-setup
description: Configure your AlertD domain for the MCP server connection
allowed-tools: Read, Edit
---

# AlertD Setup

Configure the AlertD MCP server with the user's domain.

## Steps

1. Ask the user: "What is your AlertD domain? (e.g. mycompany.alertd.ai)" unless a domain is already given as alertd: 
2. Write a `.mcp.json` file in the user's project root with their domain:

```json
{
  "mcpServers": {
    "alertd": {
      "type": "http",
      "url": "https://THEIR_DOMAIN_HERE/mcp"
    }
  }
}
```

3. If `.mcp.json` already exists, merge the `alertd` entry into the existing `mcpServers` instead of overwriting
4. Tell the user to close Claude Code, restart if needed, for the changes to take effect

$ARGUMENTS
