#!/data/data/com.termux/files/usr/bin/bash
# Launcher Termux pour Vie t'Lignes.
#
# Usage :
#   1) Deplacez/copiez (ou "glissez" via votre gestionnaire de fichiers)
#      le DOSSIER du jeu (celui qui contient index.html) ici :
#        ~/vie-t-lignes-www
#      puis lancez simplement :  bash launch-termux.sh
#
#   2) Ou passez directement le chemin du dossier en argument :
#        bash launch-termux.sh /chemin/vers/le/dossier/du/jeu
#      (pour un dossier dans le stockage partage, faites d'abord une fois :
#        termux-setup-storage
#       le dossier Telechargements est alors accessible en
#        ~/storage/downloads/...)
#
#   Important : si le dossier du jeu est sur la carte SD (chemin
#   /storage/XXXX-XXXX/...), executez ce script avec "bash script.sh ..."
#   plutot que de le lancer directement : la carte SD est montee en
#   lecture "noexec", meme avec les droits d'execution.

set -e
PORT=8791
GAMEDIR="${1:-$HOME/tycoon-www}"

if [ ! -f "$GAMEDIR/index.html" ]; then
  echo ""
  echo "  index.html introuvable dans : $GAMEDIR"
  echo ""
  echo "  Deux options :"
  echo "   1) Copiez le dossier du jeu dans : $HOME/tycoon-www"
  echo "      puis relancez : bash $(basename "$0")"
  echo "   2) Ou : bash $(basename "$0") /chemin/vers/le/dossier/du/jeu"
  echo ""
  exit 1
fi

if ! command -v python >/dev/null 2>&1; then
  echo "Installation de Python (une seule fois)..."
  pkg install -y python
fi

echo ""
echo "  Dossier servi : $GAMEDIR"
echo "  Demarrage du serveur local sur le port $PORT ..."
echo "  URL : http://localhost:$PORT"
echo ""
echo "  Laissez Termux ouvert pendant que vous jouez."
echo "  Ctrl+C (ou fermez Termux) pour arreter le serveur."
echo ""

if command -v termux-open-url >/dev/null 2>&1; then
  ( sleep 1; termux-open-url "http://localhost:$PORT" ) &
else
  echo "  Astuce : 'pkg install termux-api' (+ app Termux:API) pour que"
  echo "  Chrome s'ouvre tout seul la prochaine fois."
  echo "  Pour l'instant, ouvrez Chrome et allez sur : http://localhost:$PORT"
  echo ""
fi

cd "$GAMEDIR"
exec python -m http.server "$PORT"
