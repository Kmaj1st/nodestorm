/** A touch screen (no mouse or keyboard to speak of): hints then say "tap" and "Select several" instead of Shift-click. */
export const touchScreen = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
