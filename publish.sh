#!/usr/bin/env bash
# Publie ce dossier sur GitHub (dépôt public « sptc-bus-mcp »). À lancer par le propriétaire du compte.
# Prérequis : git et gh dans le PATH. L'authentification se fait dans le navigateur (code à saisir sur
# https://github.com/login/device) ; aucun mot de passe ni jeton ne passe par ce script.
set -euo pipefail
cd "$(dirname "$0")"
gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web
USER=$(gh api user --jq .login)
# Lien « Code source » dans le site
perl -pi -e "s#^const REPO = '';#const REPO = 'https://github.com/${USER}/sptc-bus-mcp';#" web/public/index.html
git add -A
git -c user.name="$USER" -c user.email="${USER}@users.noreply.github.com" commit -qm "Site web Cloudflare, documentation et lien du dépôt" || true
gh repo create sptc-bus-mcp --public --source=. --remote=origin --push \
  --description "MCP + site web des horaires de bus SPTC (Seychelles) — intégration non officielle"
echo "Dépôt publié : https://github.com/${USER}/sptc-bus-mcp"
