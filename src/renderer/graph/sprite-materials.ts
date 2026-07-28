import { useCallback, useEffect, useRef } from "react";
import {
  AdditiveBlending,
  CanvasTexture,
  NormalBlending,
  SpriteMaterial,
  Texture,
} from "three";

// white radial falloff shared by every node glow sprite; tinted per node
// via material.color so one texture serves all colors
function makeGlowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

// hollow white circle; tinted per use via material.color
function makeRingTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 8, 0, 2 * Math.PI);
  ctx.stroke();
  return new CanvasTexture(canvas);
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

export type SpriteMaterials = {
  glow: (color: string) => SpriteMaterial;
  ring: (color: string) => SpriteMaterial;
  /** re-tint every live glow material after a nodeOpacity slider change */
  setGlowOpacity: (opacity: number) => void;
};

/**
 * Glow/ring sprite materials, cached one per color and owned by the calling
 * component. react-force-graph flush-disposes node objects on every refresh(),
 * so these shared materials no-op their own dispose and are really disposed on
 * unmount — otherwise a highlight would force a shader recompile twice a second.
 *
 * `lite` (fleet view) switches glows to normal blending: additive glows sum
 * toward white where many overlap, which a dense fleet saturates.
 */
export function useSpriteMaterials(
  lite: boolean,
  nodeOpacity: number,
): SpriteMaterials {
  const glowTexture = useRef<CanvasTexture>();
  const glowMats = useRef(new Map<string, SpriteMaterial>());
  const ringTexture = useRef<CanvasTexture>();
  const ringMats = useRef(new Map<string, SpriteMaterial>());
  // through a ref so materials created after a slider change match the ones
  // the display effect already re-tinted
  const glowOpacity = useRef(nodeOpacity);
  glowOpacity.current = nodeOpacity;

  const glow = useCallback(
    (color: string): SpriteMaterial => {
      if (!glowTexture.current) {
        glowTexture.current = makeGlowTexture();
        glowTexture.current.dispose = noop;
      }
      let m = glowMats.current.get(color);
      if (!m) {
        m = new SpriteMaterial({
          map: glowTexture.current,
          color,
          transparent: true,
          opacity: glowOpacity.current,
          depthWrite: false,
          blending: lite ? NormalBlending : AdditiveBlending,
        });
        m.dispose = noop;
        glowMats.current.set(color, m);
      }
      return m;
    },
    [lite],
  );

  const ring = useCallback((color: string): SpriteMaterial => {
    if (!ringTexture.current) {
      ringTexture.current = makeRingTexture();
      ringTexture.current.dispose = noop;
    }
    let m = ringMats.current.get(color);
    if (!m) {
      m = new SpriteMaterial({
        map: ringTexture.current,
        color,
        transparent: true,
        depthWrite: false,
      });
      m.dispose = noop;
      ringMats.current.set(color, m);
    }
    return m;
  }, []);

  const setGlowOpacity = useCallback((opacity: number) => {
    for (const m of glowMats.current.values()) m.opacity = opacity;
  }, []);

  useEffect(() => {
    const glows = glowMats.current;
    const rings = ringMats.current;
    return () => {
      for (const m of glows.values()) SpriteMaterial.prototype.dispose.call(m);
      glows.clear();
      if (glowTexture.current)
        Texture.prototype.dispose.call(glowTexture.current);
      for (const m of rings.values()) SpriteMaterial.prototype.dispose.call(m);
      rings.clear();
      if (ringTexture.current)
        Texture.prototype.dispose.call(ringTexture.current);
    };
  }, []);

  return { glow, ring, setGlowOpacity };
}
