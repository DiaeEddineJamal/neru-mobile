// Port of beUI's shared motion tokens (beui.dev, lib/ease.ts) to Reanimated.
// Motion's spring { stiffness, damping, mass } maps 1:1 onto Reanimated's withSpring config,
// so every ported component keeps beUI's exact physics.
import { Easing, type WithSpringConfig } from 'react-native-reanimated';

export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
export const EASE_DRAWER = Easing.bezier(0.32, 0.72, 0, 1);

/** Press feedback on buttons and other tappable surfaces. */
export const SPRING_PRESS: WithSpringConfig = { stiffness: 500, damping: 30, mass: 0.6 };
/** Content swaps: label/icon slots trading places inside a control. */
export const SPRING_SWAP: WithSpringConfig = { stiffness: 460, damping: 30, mass: 0.55 };
/** Overlay panel entrances: modals and sheets. */
export const SPRING_PANEL: WithSpringConfig = { stiffness: 420, damping: 40, mass: 0.5 };
/** Shared-layout glides: pills, indicators and panels morphing between positions. */
export const SPRING_LAYOUT: WithSpringConfig = { stiffness: 360, damping: 32, mass: 0.6 };
/** Dragged handles and fills: critically damped, never rebounds off an end. */
export const SPRING_GLIDE: WithSpringConfig = { stiffness: 700, damping: 50, mass: 0.5 };

/** beUI's usual press scale for tappable surfaces. */
export const PRESS_SCALE = 0.97;
