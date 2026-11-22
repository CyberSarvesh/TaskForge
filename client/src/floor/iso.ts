/** A very small isometric drawing kit: x runs down-right, y down-left, z straight up. */

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Camera {
  scale: number;
  originX: number;
  originY: number;
}

/** Colours for the three visible faces of a box. */
export type Faces = readonly [top: string, left: string, right: string];

const COS = Math.cos(Math.PI / 6);

export const project = (camera: Camera, x: number, y: number, z = 0) => ({
  x: camera.originX + (x - y) * COS * camera.scale,
  y: camera.originY + ((x + y) * 0.5 - z) * camera.scale,
});

/** Chooses the camera that fits a block of world space inside a rectangle of pixels. */
export const fit = (
  world: { width: number; depth: number; above: number; below: number },
  area: { left: number; top: number; width: number; height: number },
): Camera => {
  const spanX = (world.width + world.depth) * COS;
  const spanY = (world.width + world.depth) * 0.5 + world.above + world.below;
  const scale = Math.max(1, Math.min(area.width / spanX, area.height / spanY));
  return {
    scale,
    originX: area.left + (area.width - spanX * scale) / 2 + world.depth * COS * scale,
    originY: area.top + (area.height - spanY * scale) / 2 + world.above * scale,
  };
};

export class Pen {
  readonly ctx: CanvasRenderingContext2D;
  readonly camera: Camera;

  constructor(ctx: CanvasRenderingContext2D, camera: Camera) {
    this.ctx = ctx;
    this.camera = camera;
  }

  polygon(points: readonly (readonly [number, number, number])[], fill: string) {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach(([x, y, z], index) => {
      const at = project(this.camera, x, y, z);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /** A rectangle lying flat. */
  plane(x: number, y: number, z: number, w: number, d: number, fill: string) {
    this.polygon([[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]], fill);
  }

  box(x: number, y: number, z: number, w: number, d: number, h: number, [top, left, right]: Faces) {
    const X = x + w;
    const Y = y + d;
    const Z = z + h;
    this.polygon([[x, Y, z], [X, Y, z], [X, Y, Z], [x, Y, Z]], left);
    this.polygon([[X, y, z], [X, Y, z], [X, Y, Z], [X, y, Z]], right);
    this.plane(x, y, Z, w, d, top);
  }

  /** A tapered bar, narrower on top like a cast ingot. Centred on x and y. */
  ingot(x: number, y: number, z: number, size: number, [top, left, right]: Faces) {
    const w = 0.36 * size;
    const d = 0.22 * size;
    const a = w * 0.72;
    const b = d * 0.65;
    const Z = z + 0.26 * size;
    this.polygon([[x - w, y + d, z], [x + w, y + d, z], [x + a, y + b, Z], [x - a, y + b, Z]], left);
    this.polygon([[x + w, y - d, z], [x + w, y + d, z], [x + a, y + b, Z], [x + a, y - b, Z]], right);
    this.plane(x - a, y - b, Z, a * 2, b * 2, top);
  }

  line(from: readonly [number, number, number], to: readonly [number, number, number], color: string, width: number) {
    const a = project(this.camera, ...from);
    const b = project(this.camera, ...to);
    this.ctx.beginPath();
    this.ctx.moveTo(a.x, a.y);
    this.ctx.lineTo(b.x, b.y);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width * this.camera.scale;
    this.ctx.stroke();
  }

  dot(x: number, y: number, z: number, radius: number, color: string, alpha = 1) {
    const at = project(this.camera, x, y, z);
    this.ctx.globalAlpha = alpha;
    this.ctx.beginPath();
    this.ctx.arc(at.x, at.y, Math.max(0, radius * this.camera.scale), 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
    this.ctx.globalAlpha = 1;
  }

  glow(x: number, y: number, z: number, radius: number, rgb: string, alpha: number) {
    const at = project(this.camera, x, y, z);
    const r = radius * this.camera.scale;
    const gradient = this.ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
    gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(at.x - r, at.y - r, r * 2, r * 2);
  }

  /** Text painted onto the floor, running along the x axis. */
  stencil(text: string, x: number, y: number, size: number, color: string) {
    const { ctx, camera } = this;
    const at = project(camera, x, y);
    const unit = camera.scale / 100;
    ctx.save();
    ctx.transform(COS * unit, 0.5 * unit, -COS * unit, 0.5 * unit, at.x, at.y);
    ctx.font = `800 ${size * 100}px "Big Shoulders Variable", sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}
