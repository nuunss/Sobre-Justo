# SobreJusto

Web que calcula cuánto vale de verdad un sobre de Pokémon TCG (cartas en español) y te dice si te conviene comprar una carta suelta o abrir sobres para buscarla.

## Qué hace

- **Colecciones**: valor neto y bruto de un sobre, productos sellados con precio editable y veredicto, simulación de 20.000 aperturas (media, mediana, peor y mejor 10 %), concentración del valor y probabilidades editables.
- **Buscador de cartas**: busca por nombre en español o inglés, o por número.
- **¿Single o sobre?**: para cada carta, compara el precio suelta con el coste esperado de sacarla abriendo sobres, y calcula la probabilidad de conseguirla con tu presupuesto.
- **Imágenes** de todas las cartas (en español cuando existen) desde TCGdex, con efecto holográfico.
- **Ajustes**: precio de referencia, ajuste a carta española, comisión, envío, bulk, god pack y gradeo. Se guardan en el navegador.

## Cómo funciona

| Pieza | Archivo |
|---|---|
| Cálculos (valor esperado, simulación, single vs sobre) | `site/ev.js` |
| Web (sin dependencias ni compilación) | `site/index.html`, `site/app.js`, `site/styles.css` |
| Descarga de cartas, imágenes y precios desde TCGdex | `scripts/fetch-data.mjs` |
| Probabilidades por colección | `config/pull-rates.json` |
| Productos sellados y precios de referencia | `config/products.json` |
| Ajuste de precio a carta en español | `config/language-factors.json` |
| Actualización diaria y publicación | `.github/workflows/actualizar-y-publicar.yml` |

Los precios vienen de Cardmarket (vía TCGdex), que mezcla todos los idiomas. La web los ajusta a carta en español con factores calibrados con 51 cartas reales de Héroes Ascendentes (1 nov 2026).

## Publicarla gratis con GitHub Pages

1. Sube este repositorio a GitHub.
2. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
3. En **Settings → Actions → General → Workflow permissions**, marca **Read and write permissions**.
4. Ve a **Actions → Actualizar datos y publicar → Run workflow**.

A partir de ahí los datos se actualizan solos cada día y la web queda en `https://<tu-usuario>.github.io/<repositorio>/`.

## Trabajar en local (Node 20+)

```bash
npm run data           # descarga cartas y precios reales (series me y sv)
npm run preview-data   # datos de ejemplo sin conexión (Héroes Ascendentes)
npm run serve          # http://localhost:8080
npm test
```

## Añadir una colección con probabilidades

Añade una entrada en `config/pull-rates.json` con el nombre en inglés, el identificador de TCGdex y las probabilidades (1 de cada X sobres) del hueco de rara (`rare`) y del hueco especial (`hit`). Si la API etiqueta mal alguna rareza, usa `tierOverrides` con rangos de números.

## Avisos

Las probabilidades son estimaciones de la comunidad, no datos oficiales. Pokémon y sus imágenes son propiedad de The Pokémon Company; esta web no está afiliada a ella.
