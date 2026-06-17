import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Img,
  Sequence,
  Audio,
} from "remotion";

// ─── Brand palette ────────────────────────────────────────────────────────────
const PALETTE = {
  lavender: "#E8DEFF",
  cream: "#FFF8F0",
  sage: "#D4E8D4",
  blush: "#FFD4E4",
  sky: "#D4EEFF",
  textDark: "#2a2438",
  textLight: "#ffffff",
  accent: "#9B7FD4",
};

// ─── Split a line into words, mark the "key" word for highlight ──────────────
function splitWithHighlight(text, keyword) {
  const words = text.split(" ");
  return words.map((w) => {
    const clean = w.replace(/[.,!?]/g, "").toLowerCase();
    const isKey = keyword && clean === keyword.toLowerCase();
    return { word: w, isKey };
  });
}

// ─── One text segment with bounce-in + word highlight ────────────────────────
const TextSegment = ({ text, keyword, startFrame, durationInFrames, isHook }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = frame - startFrame;

  // Spring bounce-in
  const enter = spring({
    frame: localFrame,
    fps,
    config: { damping: 12, stiffness: 120, mass: 0.8 },
  });

  // Fade out near the end
  const exit = interpolate(
    localFrame,
    [durationInFrames - 8, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const scale = interpolate(enter, [0, 1], [0.7, 1]);
  const translateY = interpolate(enter, [0, 1], [40, 0]);
  const opacity = Math.min(enter, exit);

  const words = splitWithHighlight(text, keyword);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: "0 14px",
        padding: "0 60px",
        transform: `scale(${scale}) translateY(${translateY}px)`,
        opacity,
      }}
    >
      {words.map((w, i) => {
        // Each word pops in slightly staggered
        const wordEnter = spring({
          frame: localFrame - i * 2,
          fps,
          config: { damping: 14, stiffness: 140 },
        });
        const wordScale = interpolate(wordEnter, [0, 1], [0.85, 1]);
        return (
          <span
            key={i}
            style={{
              fontSize: isHook ? 76 : 64,
              fontWeight: 700,
              lineHeight: 1.25,
              color: w.isKey ? PALETTE.accent : PALETTE.textLight,
              transform: `scale(${wordScale})`,
              display: "inline-block",
              textShadow: "0 2px 20px rgba(0,0,0,0.4)",
              letterSpacing: "-1px",
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
};

// ─── Ken Burns background image ──────────────────────────────────────────────
const KenBurnsBg = ({ src, startFrame, durationInFrames }) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;

  const scale = interpolate(
    localFrame,
    [0, durationInFrames],
    [1.0, 1.12],
    { extrapolateRight: "clamp" }
  );
  const x = interpolate(localFrame, [0, durationInFrames], [0, -20], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {src ? (
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale}) translateX(${x}px)`,
          }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: `linear-gradient(160deg, ${PALETTE.lavender}, ${PALETTE.sky})`,
          }}
        />
      )}
      {/* Dark overlay for text readability */}
      <AbsoluteFill style={{ background: "rgba(30,25,45,0.5)" }} />
    </AbsoluteFill>
  );
};

// ─── Progress bar at top ──────────────────────────────────────────────────────
const ProgressBar = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 6,
        background: "rgba(255,255,255,0.2)",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          background: PALETTE.accent,
        }}
      />
    </div>
  );
};

// ─── Brand watermark ──────────────────────────────────────────────────────────
const Watermark = () => (
  <div
    style={{
      position: "absolute",
      bottom: 50,
      left: 0,
      right: 0,
      textAlign: "center",
      color: "rgba(255,255,255,0.85)",
      fontSize: 30,
      fontWeight: 500,
      letterSpacing: "0.5px",
    }}
  >
    bloom focus
  </div>
);

// ─── Main composition ─────────────────────────────────────────────────────────
export const AdhdReel = ({ segments, images, music }) => {
  const { fps } = useVideoConfig();
  const SEG_DURATION = Math.round(2.5 * fps); // 2.5 sec per segment

  let cursor = 0;
  const timed = segments.map((seg, i) => {
    const start = cursor;
    cursor += SEG_DURATION;
    return { ...seg, start, duration: SEG_DURATION, index: i };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.textDark, fontFamily: "Poppins, sans-serif" }}>
      {/* Backgrounds — cycle through images, change every segment */}
      {timed.map((seg, i) => (
        <Sequence key={`bg${i}`} from={seg.start} durationInFrames={seg.duration}>
          <KenBurnsBg
            src={images && images.length ? images[i % images.length] : null}
            startFrame={0}
            durationInFrames={seg.duration}
          />
        </Sequence>
      ))}

      {/* Text segments */}
      {timed.map((seg, i) => (
        <Sequence key={`txt${i}`} from={seg.start} durationInFrames={seg.duration}>
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <TextSegment
              text={seg.text}
              keyword={seg.keyword}
              startFrame={0}
              durationInFrames={seg.duration}
              isHook={i === 0}
            />
          </AbsoluteFill>
        </Sequence>
      ))}

      <ProgressBar />
      <Watermark />

      {music && <Audio src={music} volume={0.25} />}
    </AbsoluteFill>
  );
};
