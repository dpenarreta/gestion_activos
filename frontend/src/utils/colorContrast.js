/**
 * Misma fórmula WCAG 2.1 que `backend/apps/branding/color_contrast.py`, para
 * mostrar la advertencia de contraste en vivo antes de guardar. Una pequeña
 * duplicación inevitable entre Python y JS (runtimes distintos) — cualquier
 * cambio de fórmula debe replicarse en ambos lados.
 */

const AA_NORMAL_TEXT_THRESHOLD = 4.5;

function hexToRgb(hex) {
  let value = hex.replace("#", "");
  if (value.length === 3) {
    value = value
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  const int = parseInt(value, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function channelLuminance(channel255) {
  const channel = channel255 / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(hexA, hexB) {
  const luminanceA = relativeLuminance(hexA);
  const luminanceB = relativeLuminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

const HEX_COLOR_PATTERN = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

export function isValidHexColor(value) {
  return HEX_COLOR_PATTERN.test(value);
}

export function evaluateThemeContrast(theme) {
  const pairs = [
    { pair: "Texto principal sobre fondo", foreground: theme.color_text, background: theme.color_background },
    { pair: "Encabezados sobre fondo", foreground: theme.color_headings, background: theme.color_background },
    { pair: "Enlaces sobre fondo", foreground: theme.color_links, background: theme.color_background },
  ];

  return pairs
    .filter(({ foreground, background }) => isValidHexColor(foreground) && isValidHexColor(background))
    .map(({ pair, foreground, background }) => {
      const ratio = Math.round(contrastRatio(foreground, background) * 100) / 100;
      return { pair, foreground, background, ratio, passes: ratio >= AA_NORMAL_TEXT_THRESHOLD };
    });
}
