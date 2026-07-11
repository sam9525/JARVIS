// three ships no bundled types and @types/three requires a newer TS than
// this project's ~4.5 — declare only what we use (see d3-force-3d.d.ts)
declare module "three" {
  export class Vector2 {
    constructor(x?: number, y?: number);
    set(x: number, y: number): this;
  }

  export class Color {
    constructor(color?: string);
    r: number;
    g: number;
    b: number;
  }

  export const AdditiveBlending: number;

  export class Group extends Object3D {
    add(obj: Object3D): void;
  }

  export class Object3D {
    position: { set(x: number, y: number, z: number): void };
    scale: { setScalar(s: number): void };
    visible: boolean;
  }

  export class Scene {
    add(obj: Object3D): void;
    remove(obj: Object3D): void;
  }

  export class SphereGeometry {
    constructor(
      radius?: number,
      widthSegments?: number,
      heightSegments?: number,
    );
    dispose(): void;
  }

  export class MeshBasicMaterial {
    constructor(params?: {
      color?: string;
      transparent?: boolean;
      opacity?: number;
      depthWrite?: boolean;
    });
    dispose(): void;
  }

  export class Mesh extends Object3D {
    constructor(geometry?: SphereGeometry, material?: MeshBasicMaterial);
    geometry: SphereGeometry;
    material: MeshBasicMaterial;
  }

  export class Texture {
    dispose(): void;
  }

  export class CanvasTexture extends Texture {
    constructor(canvas: unknown);
  }

  export class SpriteMaterial {
    constructor(params?: {
      map?: Texture;
      color?: string;
      transparent?: boolean;
      opacity?: number;
      depthWrite?: boolean;
      blending?: number;
    });
    map: Texture;
    dispose(): void;
  }

  export class Sprite extends Object3D {
    constructor(material?: SpriteMaterial);
    material: SpriteMaterial;
  }
}

declare module "three/examples/jsm/lines/LineGeometry.js" {
  export class LineGeometry {
    setPositions(positions: number[]): this;
    setColors(colors: number[]): this;
    dispose(): void;
  }
}

declare module "three/examples/jsm/lines/LineMaterial.js" {
  import { Vector2 } from "three";
  export class LineMaterial {
    constructor(params?: {
      vertexColors?: boolean;
      linewidth?: number;
      transparent?: boolean;
      opacity?: number;
    });
    resolution: Vector2;
    linewidth: number;
    dispose(): void;
  }
}

declare module "three/examples/jsm/lines/Line2.js" {
  import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
  import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
  export class Line2 {
    constructor(geometry?: LineGeometry, material?: LineMaterial);
    geometry: LineGeometry;
  }
}
