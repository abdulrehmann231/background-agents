import React from "react";
import { Composition } from "remotion";
import { Promo, TOTAL_DURATION } from "./Composition";
import { promoSchema, defaultProps } from "./schema";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PromoPortrait"
        component={Promo}
        durationInFrames={TOTAL_DURATION}
        fps={30}
        width={1080}
        height={1920}
        schema={promoSchema}
        defaultProps={defaultProps}
      />
      <Composition
        id="PromoLandscape"
        component={Promo}
        durationInFrames={TOTAL_DURATION}
        fps={30}
        width={1920}
        height={1080}
        schema={promoSchema}
        defaultProps={defaultProps}
      />
    </>
  );
};
