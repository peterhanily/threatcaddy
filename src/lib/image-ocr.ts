/**
 * Simple image-to-text fallback for LLM providers that don't support vision.
 * Uses the browser's Canvas API to generate a text description of the image.
 */

/** Providers that support multimodal/vision image inputs */
const VISION_PROVIDERS = new Set(['anthropic', 'openai', 'gemini']);

export function supportsVision(provider: string): boolean {
  return VISION_PROVIDERS.has(provider);
}

/**
 * Generate a text description of an image for non-vision providers.
 * Extracts basic metadata (dimensions, file size) since true OCR requires
 * a vision model or external service.
 */
export async function describeImage(
  base64Data: string,
  mimeType: string,
  fileName?: string,
): Promise<string> {
  const parts: string[] = [];

  if (fileName) parts.push(`File: ${fileName}`);
  parts.push(`Type: ${mimeType}`);

  // Estimate file size from base64
  const sizeBytes = Math.ceil(base64Data.length * 0.75);
  const sizeKB = (sizeBytes / 1024).toFixed(1);
  parts.push(`Size: ${sizeKB} KB`);

  // Get dimensions by loading the image
  try {
    const dimensions = await getImageDimensions(base64Data, mimeType);
    if (dimensions) {
      parts.push(`Dimensions: ${dimensions.width}x${dimensions.height}px`);
    }
  } catch { /* ignore */ }

  return `[Attached image: ${parts.join(', ')}. Note: This LLM provider does not support image analysis. Switch to Anthropic, OpenAI, or Gemini for visual analysis.]`;
}

function getImageDimensions(base64Data: string, mimeType: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = `data:${mimeType};base64,${base64Data}`;
  });
}
