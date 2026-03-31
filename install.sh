#!/bin/bash
set -e

CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

echo "AlertD - Claude Code Plugin Installer"
echo "======================================"

# Ensure .claude directory exists
mkdir -p "$CLAUDE_DIR"

# Add marketplace to settings.json
if [ -f "$SETTINGS_FILE" ]; then
  # Merge into existing settings using a temp file
  if command -v jq &> /dev/null; then
    jq '.extraKnownMarketplaces["alertd"] = {"source": {"source": "github", "repo": "alert-d/alertd-claude"}}' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
  else
    echo "Warning: jq not found. Please install jq or manually add the marketplace."
    echo "Run inside Claude Code: /plugin marketplace add alert-d/alertd-claude"
    exit 1
  fi
else
  cat > "$SETTINGS_FILE" <<EOF
{
  "extraKnownMarketplaces": {
    "alertd": {
      "source": {
        "source": "github",
        "repo": "alert-d/alertd-claude"
      }
    }
  }
}
EOF
fi

echo "Added alertd marketplace."

# Install the plugin
echo "Installing alertd plugin..."
claude plugin install alertd@alertd --scope user

echo ""
echo "Done! Now open Claude Code and run:"
echo "  /alertd:alertd-setup"
echo ""
echo "to configure your AlertD domain."

claude "please run /alertd:alertd-setup" 
