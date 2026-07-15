export interface PreviewStatusState {
  hasGeometry: boolean;
  rendering: boolean;
  progress?: number;
}

/** Return the model-stage overlay text for the current preview state. */
export function previewStatusText({
  hasGeometry,
  rendering,
  progress,
}: PreviewStatusState): string {
  if (hasGeometry) return "";
  if (!rendering) return "No geometry yet";
  if (progress === undefined || !Number.isFinite(progress)) return "Rendering...";

  const percentage = Math.round(Math.min(100, Math.max(0, progress)));
  return `Rendering... ${percentage}%`;
}
