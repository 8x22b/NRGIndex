#!/usr/bin/env bash
# Пересборка сабсетов шрифтов: оставляем только те глифы, что реально нужны сайту.
# Нужен Python с fonttools и brotli:  pip install fonttools brotli
# Набор символов лежит в scripts/font-charset.txt (собран из public/ и контента,
# см. scripts/build-font-charset.js). Имена файлов не меняются, поэтому fonts.css
# и предзагрузка в index.html остаются как есть.
#
#   ./scripts/subset-fonts.sh
set -euo pipefail

cd "$(dirname "$0")/.."

CHARSET="scripts/font-charset.txt"
UNICODES="U+0020-007E,U+00A0-00FF,U+0400-045F,U+0490-0491,U+2010-2027,U+2030-205E,U+2116,U+2190-2193,U+25A0-25CF,U+2605-2606,U+2713-2717"
FONTS=(
  "xn7gYHE41ni1AdIRggOxSuXd.woff2"                                                    # Manrope, кириллица (400–700)
  "xn7gYHE41ni1AdIRggexSg.woff2"                                                      # Manrope, латиница (400–700)
  "co3bmX5slCNuHLi8bLeY9MK7whWMhyjYrXtKgS4.woff2"                                     # Cormorant, кириллица (500/600)
  "co3bmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2"                                        # Cormorant, латиница (500/600)
  "co3smX5slCNuHLi8bLeY9MK7whWMhyjYrGFEsdtdc62E6zd5wDD-iNM8.woff2"                    # Cormorant italic, кириллица
  "co3smX5slCNuHLi8bLeY9MK7whWMhyjYrGFEsdtdc62E6zd5wDD-jNM8Efs.woff2"                 # Cormorant italic, латиница
)

before_all=0
after_all=0
for font in "${FONTS[@]}"; do
  src="public/fonts/$font"
  before=$(stat -c%s "$src")
  python -m fontTools.subset "$src" \
    --text-file="$CHARSET" \
    --unicodes="$UNICODES" \
    --layout-features='*' \
    --no-hinting \
    --flavor=woff2 \
    --output-file="$src.sub"
  mv "$src.sub" "$src"
  after=$(stat -c%s "$src")
  before_all=$((before_all + before))
  after_all=$((after_all + after))
  echo "$font: $((before / 1024))KB -> $((after / 1024))KB"
done

echo "итого: $((before_all / 1024))KB -> $((after_all / 1024))KB"
