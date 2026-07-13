export type DesignFileFormat = "scad" | "stl" | "3mf";

export function safeFileName(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "openscad-model";
}

export function designFileName(
  designName: string,
  format: DesignFileFormat,
): string {
  const sanitized = safeFileName(designName);
  const stem = sanitized.replace(/\.(?:scad|stl|3mf)$/i, "") || "openscad-model";
  return `${stem}.${format}`;
}

