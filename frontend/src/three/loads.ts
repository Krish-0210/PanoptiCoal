// Counts globe texture arrivals, so a still scene (reduced motion) knows to draw one more frame.
let n = 0
export const textureLoaded = () => {
  n++
}
export const textureLoads = () => n
