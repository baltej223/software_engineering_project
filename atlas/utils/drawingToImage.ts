import {
  PlacedTile,
  Stroke,
  generateBoardSVG,
} from "@/components/InfiniteBoard";
import { Platform } from "react-native";

import { createDeferred } from "@/utils/deferred";

const MAX_IMAGE_DIMENSION = 1024;
const MIN_IMAGE_DIMENSION = 512;
const JPEG_QUALITY = 0.82;

/**
 * Convert board strokes and tiles to a compact raster data URL for a vision API.
 *
 * The drawing is cropped to its content bounds, scaled to 512–1024 px on the
 * long side, and encoded as JPEG on web. Native uses BoardSnapshot instead,
 * because react-native-svg's toDataURL produces PNG.
 */
export async function drawingToBase64Image(
  strokes: Stroke[],
  placedTiles: PlacedTile[],
  width: number = 800,
  height: number = 600
): Promise<string> {
  const svgString = generateBoardSVG(strokes, placedTiles, width, height);

  if (Platform.OS === "web") {
    return svgToJpegDataUrl(svgString);
  }

  throw new Error(
    "Native drawing capture must use BoardSnapshot.toDataURL(), not SVG."
  );
}

/**
 * Convert an SVG string to a resized JPEG data URL using the web canvas.
 */
async function svgToJpegDataUrl(svgString: string): Promise<string> {
  const { promise, resolve, reject } = createDeferred<string>();
  const svgBase64 = btoa(unescape(encodeURIComponent(svgString)));
  const dataUri = `data:image/svg+xml;base64,${svgBase64}`;

  const img = new window.Image();

  img.onload = () => {
    try {
      const naturalWidth = img.naturalWidth || img.width;
      const naturalHeight = img.naturalHeight || img.height;
      if (!naturalWidth || !naturalHeight) {
        throw new Error("Drawing image has no dimensions");
      }

      const longestSide = Math.max(naturalWidth, naturalHeight);
      const scale = Math.min(
        MAX_IMAGE_DIMENSION / longestSide,
        Math.max(1, MIN_IMAGE_DIMENSION / longestSide)
      );
      const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
      const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Could not get canvas context");
      }

      // Vision models handle a white background more reliably than alpha.
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    } catch (error) {
      reject(error);
    }
  };

  img.onerror = () => {
    reject(new Error("Failed to load drawing SVG as an image"));
  };

  img.crossOrigin = "anonymous";
  img.src = dataUri;

  return promise;
}
