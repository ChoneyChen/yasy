#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  if [[ -f "$HOME/.nvm/nvm.sh" ]]; then source "$HOME/.nvm/nvm.sh"; fi
fi
if ! command -v node >/dev/null 2>&1; then
  print '请先安装 Node.js 22.13 或更新版本，再运行 Yasy。'
  read 'reply?按回车关闭…'
  exit 1
fi
node scripts/start-mac.mjs
