/**
 * The one spinner this plugin draws.
 *
 * Paseo shows a busy state for the buttons it owns, but a button inside a
 * plugin-drawn card is not one of those, so the pending state has to be drawn
 * here. It is a ring with one lit arc rather than `ActivityIndicator`, because
 * that component takes its look from the platform and would land in the card as
 * an iOS gray on iOS and something else in a browser. This one takes both
 * colours from the caller, so it belongs to the surface it spins on.
 */

import { useEffect, useRef } from "react";
import { Animated, Easing, Platform } from "react-native";

const ROTATION_MS = 720;

export interface SpinnerProps {
  /** The lit arc. */
  color: string;
  /** The rest of the ring. Pass the surface behind it to show the arc alone. */
  trackColor: string;
  size?: number;
}

export function Spinner({ color, trackColor, size = 14 }: SpinnerProps) {
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    turn.setValue(0);
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: ROTATION_MS,
        easing: Easing.linear,
        // React Native Web has no native animated module, and asking for one
        // there costs a warning on every mount.
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: Math.max(1.5, size / 7),
        borderColor: trackColor,
        borderTopColor: color,
        transform: [{ rotate }],
      }}
    />
  );
}
