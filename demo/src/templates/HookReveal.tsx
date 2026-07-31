import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type HookRevealProps = {
  /** URL or path to the "before" image (blurred hook frame). */
  beforeUrl: string;
  /** URL or path to the "after" image (revealed result). */
  afterUrl: string;
  /** Hook text overlay on the before image. */
  hookText: string;
  /** Duration of transition in frames (default: 15). */
  transitionFrames?: number;
  /** Font size for hook text (default: 72). */
  fontSize?: number;
  /** Text color (default: white). */
  textColor?: string;
  /** Text stroke color (default: black). */
  strokeColor?: string;
  /** Background blur amount in pixels (default: 20). */
  blurAmount?: number;
};

/**
 * Hook Reveal template: shows a blurred "before" with hook text,
 * then reveals the "after" with a smooth transition.
 *
 * Timeline:
 *   0 → 50%: before image with hook text (blurred bg)
 *   50% → 100%: crossfade to after image
 */
export const HookReveal: React.FC<HookRevealProps> = ({
  beforeUrl,
  afterUrl,
  hookText,
  transitionFrames = 15,
  fontSize = 72,
  textColor = "#ffffff",
  strokeColor = "#000000",
  blurAmount = 20,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Split duration: first half = hook, second half = reveal
  const midPoint = Math.floor(durationInFrames / 2);
  const transitionStart = midPoint - Math.floor(transitionFrames / 2);
  const transitionEnd = midPoint + Math.floor(transitionFrames / 2);

  // Crossfade opacity for after image
  const afterOpacity = interpolate(
    frame,
    [transitionStart, transitionEnd],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Hook text fade out during transition
  const textOpacity = interpolate(
    frame,
    [transitionStart, transitionEnd],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Blur decreases during transition
  const currentBlur = interpolate(
    frame,
    [transitionStart, transitionEnd],
    [blurAmount, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Before image (blurred) */}
      <AbsoluteFill style={{ filter: `blur(${currentBlur}px)` }}>
        <Img
          src={beforeUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>

      {/* After image (fades in) */}
      <AbsoluteFill style={{ opacity: afterOpacity }}>
        <Img
          src={afterUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>

      {/* Hook text overlay */}
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: textOpacity,
        }}
      >
        <div
          style={{
            fontSize,
            fontFamily: "Arial, sans-serif",
            fontWeight: 900,
            color: textColor,
            textAlign: "center",
            padding: "0 40px",
            textShadow: `
              -2px -2px 0 ${strokeColor},
              2px -2px 0 ${strokeColor},
              -2px 2px 0 ${strokeColor},
              2px 2px 0 ${strokeColor},
              0 4px 8px rgba(0,0,0,0.5)
            `,
            maxWidth: "80%",
            lineHeight: 1.2,
          }}
        >
          {hookText}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export default HookReveal;
