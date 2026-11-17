import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import {
  Stroke,
  getBoardContentBounds,
  pointsToPath,
} from "@/components/InfiniteBoard";
import { createDeferred } from "@/utils/deferred";

export type BoardSnapshotHandle = {
  capture: () => Promise<string>;
};

type BoardSnapshotProps = {
  strokes: Stroke[];
  maxDimension?: number;
};

const MIN_CAPTURE_DIMENSION = 512;

/**
 * Renders a hidden, cropped copy of the drawing so react-native-svg can
 * rasterize it to PNG. It is deliberately separate from the interactive board:
 * the visible Svg is transformed by pan/zoom, and has no white background.
 */
export const BoardSnapshot = forwardRef<BoardSnapshotHandle, BoardSnapshotProps>(
  function BoardSnapshot({ strokes, maxDimension = 1024 }, ref) {
    const svgRef = useRef<Svg | null>(null);

    const { bounds, width, height } = useMemo(() => {
      const nextBounds = getBoardContentBounds(strokes, []);
      const longestSide = Math.max(nextBounds.width, nextBounds.height);
      const scale = Math.min(
        maxDimension / longestSide,
        Math.max(1, MIN_CAPTURE_DIMENSION / longestSide)
      );

      return {
        bounds: nextBounds,
        width: Math.max(1, Math.round(nextBounds.width * scale)),
        height: Math.max(1, Math.round(nextBounds.height * scale)),
      };
    }, [strokes, maxDimension]);

    useImperativeHandle(
      ref,
      () => ({
        capture: () => {
          const node = svgRef.current;
          if (!node) {
            return Promise.reject(new Error("Board snapshot is not ready"));
          }

          const { promise, resolve, reject } = createDeferred<string>();
          node.toDataURL((base64) => {
            if (!base64) {
              reject(new Error("Board snapshot returned no image"));
              return;
            }
            resolve(
              base64.startsWith("data:")
                ? base64
                : `data:image/png;base64,${base64}`
            );
          }, { width, height });
          return promise;
        },
      }),
      [width, height]
    );

    if (strokes.length === 0) {
      return null;
    }

    return (
      <View pointerEvents="none" style={styles.hidden}>
        <Svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        >
          <Rect
            x={0}
            y={0}
            width={bounds.width}
            height={bounds.height}
            fill="white"
          />
          {strokes.map((stroke) => (
            <Path
              key={stroke.id}
              d={pointsToPath(
                stroke.points.map((point) => ({
                  x: point.x - bounds.x,
                  y: point.y - bounds.y,
                }))
              )}
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </Svg>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  hidden: {
    position: "absolute",
    left: 0,
    top: 0,
  },
});
