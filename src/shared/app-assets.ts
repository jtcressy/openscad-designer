export const DESIGNER_ASSET_ORIGIN_PLACEHOLDER =
  "https://openscad-assets.invalid";

export function resolveDesignerAssetOrigin(
  html: string,
  assetOrigin: string | undefined,
): string {
  if (!html.includes(DESIGNER_ASSET_ORIGIN_PLACEHOLDER)) return html;
  if (!assetOrigin) {
    throw new Error("The designer asset origin is required by the built UI.");
  }

  const normalizedOrigin = new URL(assetOrigin).origin;
  return html.replaceAll(DESIGNER_ASSET_ORIGIN_PLACEHOLDER, normalizedOrigin);
}
