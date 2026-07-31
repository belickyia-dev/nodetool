/**
 * Standalone template entry point for the HTTP render service.
 * Does not depend on web-demo infrastructure, so it bundles cleanly.
 */
import React from "react";
import { registerRoot, Composition } from "remotion";
import { HookReveal, type HookRevealProps } from "./HookReveal";

const TemplateRoot: React.FC = () => {
  return (
    <>
      {/* HookReveal template for viral content — blurred hook → reveal */}
      <Composition
        id="HookReveal"
        component={HookReveal}
        defaultProps={{
          beforeUrl: "",
          afterUrl: "",
          hookText: "Wait for it...",
        } as HookRevealProps}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={90}
      />
    </>
  );
};

registerRoot(TemplateRoot);
