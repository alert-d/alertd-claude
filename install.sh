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
