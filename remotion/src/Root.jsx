import React from "react";
import { Composition } from "remotion";
import { AdhdReel } from "./AdhdReel.jsx";
import { loadFont } from "@remotion/google-fonts/Poppins";

const { fontFamily } = loadFont();

// Default props (overridden per-render via --props)
const defaultSegments = [
  { text: "You're not lazy.", keyword: "lazy" },
  { text: "Your brain needs a dopamine spark to start.", keyword: "dopamine" },
  { text: "ADHD brains have lower baseline dopamine.", keyword: "dopamine" },
  { text: "So just start is biologically useless for us.", keyword: "useless" },
  { text: "You're not broken. You're underfueled.", keyword: "underfueled" },
  { text: "Save this for next time.", keyword: "save" },
];

const FPS = 30;
const SEG_SECONDS = 2.5;

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="AdhdReel"
        component={AdhdReel}
        durationInFrames={Math.round(defaultSegments.length * SEG_SECONDS * FPS)}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{
          segments: defaultSegments,
          images: [],
          music: null,
        }}
        calculateMetadata={({ props }) => {
          const segCount = props.segments?.length ?? defaultSegments.length;
          return {
            durationInFrames: Math.round(segCount * SEG_SECONDS * FPS),
          };
        }}
      />
    </>
  );
};
