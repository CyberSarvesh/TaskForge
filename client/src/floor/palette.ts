import type { Theme } from "../lib/theme";
import type { Faces } from "./iso";

export interface Palette {
  slab: Faces;
  tile: string;
  paint: string;
  stencil: string;
  machine: Faces;
  iron: Faces;
  steel: Faces;
  wood: Faces;
  dead: Faces;
  belt: string;
  beltMark: string;
  hazard: string;
  smoke: string;
  glow: number;
}

export const PALETTES: Record<Theme, Palette> = {
  day: {
    slab: ["#c3d2c3", "#8fa392", "#7c917f"],
    tile: "#b6c7b7",
    paint: "#e3ebdf",
    stencil: "#4c6656",
    machine: ["#4f9a80", "#347260", "#285c4e"],
    iron: ["#56646a", "#37444a", "#283338"],
    steel: ["#e4e9e6", "#a9b5b2", "#8d9b98"],
    wood: ["#d2ab72", "#a98149", "#8c6838"],
    dead: ["#8c9690", "#6b756f", "#59625d"],
    belt: "#2d3a3e",
    beltMark: "#66777b",
    hazard: "#f2c230",
    smoke: "#708078",
    glow: 0.22,
  },
  night: {
    slab: ["#21403a", "#132a26", "#0f221f"],
    tile: "#284a43",
    paint: "#2c5048",
    stencil: "#86aa9b",
    machine: ["#34796a", "#23584d", "#19443b"],
    iron: ["#43545a", "#27343a", "#1a2529"],
    steel: ["#a7b9b5", "#70837f", "#566965"],
    wood: ["#8f744e", "#6b5436", "#54412a"],
    dead: ["#4a5551", "#343d3a", "#28302d"],
    belt: "#101a1c",
    beltMark: "#3c4e50",
    hazard: "#c99f25",
    smoke: "#93a69f",
    glow: 0.5,
  },
};

// Molten while live. Priority is how hot the metal is.
export const INGOT = {
  high: ["#fff3b0", "#ffb238", "#f08a12"],
  normal: ["#ffc04d", "#e8590c", "#b8400a"],
  low: ["#e58a5a", "#a8442a", "#833420"],
  cooling: ["#c9a0a0", "#8c5c60", "#6f464b"],
  shipped: ["#a9cdec", "#4585bb", "#2d6698"],
  scrap: ["#8b7d78", "#5d4f4b", "#463a37"],
} satisfies Record<string, Faces>;
