// helper shared by tests: mesh a whole level and check the surface is closed
import { chunkOrigins, meshChunk } from "../src/core/mesher.js";
export function meshAll(world) {
  const chunks = [];
  for (const [x, y, z] of chunkOrigins(world)) { const m = meshChunk(world, x, y, z); if (m) chunks.push(m); }
  return chunks;
}
export function surfaceStats(chunks) {
  const key = (p, i) => `${Math.round(p[i*3]*1000)},${Math.round(p[i*3+1]*1000)},${Math.round(p[i*3+2]*1000)}`;
  const edgeCount = new Map(); let tris = 0, badWinding = 0;
  for (const c of chunks) {
    const P = c.positions, I = c.indices, Nn = c.normals;
    for (let t = 0; t < I.length; t += 3) {
      tris++;
      const ks = [key(P, I[t]), key(P, I[t+1]), key(P, I[t+2])];
      for (let e = 0; e < 3; e++) { const a = ks[e], b = ks[(e+1)%3]; const k = a < b ? a+"|"+b : b+"|"+a; edgeCount.set(k, (edgeCount.get(k)||0)+1); }
      const [a,b,cc] = [I[t],I[t+1],I[t+2]].map(i => [P[i*3],P[i*3+1],P[i*3+2]]);
      const u = [b[0]-a[0],b[1]-a[1],b[2]-a[2]], v = [cc[0]-a[0],cc[1]-a[1],cc[2]-a[2]];
      const fn = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
      const vn = [0,1,2].map(k => Nn[I[t]*3+k]+Nn[I[t+1]*3+k]+Nn[I[t+2]*3+k]);
      if (fn[0]*vn[0]+fn[1]*vn[1]+fn[2]*vn[2] < 0) badWinding++;
    }
  }
  let open = 0, nonManifold = 0;
  for (const n of edgeCount.values()) { if (n === 1) open++; else if (n > 2) nonManifold++; }
  return { tris, open, nonManifold, badWinding };
}
