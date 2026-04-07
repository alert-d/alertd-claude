#!/bin/bash
set -e

echo "AlertD - Claude Code Plugin Installer"
echo "======================================"

echo "Adding alertd marketplace..."
claude plugin marketplace add alert-d/alertd-claude

echo "Installing alertd plugin..."
claude plugin install alertd@alertd --scope user

echo ""
echo "Done! Now open Claude Code and run:"
echo "  /alertd:setup"
echo ""
echo "to configure your AlertD domain."


echo "Setting up AlertD domain..."
if [ -n "$1" ]; then
  claude "run /alertd:setup and set domain as $1"
else
  claude "run /alertd:setup"
fi

claude   "authenticate alertd mcp, dont call /alertd:setup, once authenticated ask 'what is in my aws?'"
