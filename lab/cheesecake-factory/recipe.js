// ============================================================
//  recipe.js — rule-based, deterministic recipe engine (no API)
//  generate(design) -> recipe object
//  renderHTML(recipe) -> HTML string for the recipe card
//  design = {
//    shape, layers:{ base:{ing,on}, middle:{ing,thickness,on}, top:{ing,thickness,on} },
//    decorations:[id]
//  }   thickness is 0..1 (normalised slider)
// ============================================================

const g = n => `${Math.round(n/5)*5} g`;
const ml = n => `${Math.round(n/10)*10} ml`;

// ---- per-ingredient recipe data ----
const BASE = {
  graham:  { name:"Graham",  crumb:"graham crackers",        crumbG:200, label:"graham cracker crust" },
  biscuit: { name:"Biscuit", crumb:"digestive biscuits",     crumbG:200, label:"biscuit crust" },
  oreo:    { name:"Oreo",    crumb:"chocolate sandwich cookies (cream included)", crumbG:240, label:"Oreo crust", noSugar:true, lessButter:true },
  brownie: { name:"Brownie", crumb:"crumbled brownie",       crumbG:260, label:"fudgy brownie base", noSugar:true },
  nut:     { name:"Nut",     crumb:"toasted nuts + biscuits", crumbG:180, label:"toasted nut crust", nut:true },
};
const MIDDLE = {
  vanilla:    { name:"Vanilla",    flavor:"vanilla", addIns:[["2 tsp","vanilla bean paste"]], note:"classic vanilla filling" },
  strawberry: { name:"Strawberry", flavor:"strawberry", addIns:[["200 g","strawberry purée"],["1 tbsp","lemon juice"]], note:"strawberry-swirled filling" },
  lemon:      { name:"Lemon",      flavor:"lemon", addIns:[["2","lemons, zest + juice"]], note:"bright lemon filling" },
  chocolate:  { name:"Chocolate",  flavor:"chocolate", addIns:[["200 g","dark chocolate, melted"]], note:"rich chocolate filling" },
  raspberry:  { name:"Raspberry",  flavor:"raspberry", addIns:[["200 g","raspberry purée"]], note:"tart raspberry filling" },
};
const TOP = {
  none:   null,
  jelly:  { name:"Jelly",  adj:"Jelly-Topped",  ings:[["250 g","mixed berries"],["1 packet","red fruit jelly"]],
            step:"Dissolve the fruit jelly per packet, fold through the berries, pour over the set filling and chill until firm." },
  mousse: { name:"Mousse", adj:"Mousse-Crowned", ings:[["150 g","white chocolate"],["200 ml","double cream, whipped"]],
            step:"Melt the white chocolate, fold into the whipped cream and spread a cloud of mousse over the chilled filling." },
  glaze:  { name:"Glaze",  adj:"Glazed",        ings:[["150 g","fruit of choice"],["2 tbsp","sugar"],["1 tsp","cornflour"]],
            step:"Simmer the fruit with sugar and cornflour into a glossy glaze, cool slightly, then spoon a mirror-shine layer over the top." },
  fruit:  { name:"Fruit Layer", adj:"Fruit-Layered", ings:[["300 g","fresh seasonal fruit"],["2 tbsp","apricot jam, warmed"]],
            step:"Arrange the fresh fruit over the filling and brush with warmed apricot jam for a bakery-style sheen." },
};
const DECO = {
  strawberries:"fresh strawberries", raspberries:"raspberries", whippedCream:"whipped-cream rosettes",
  mintLeaves:"mint leaves", lemonSlice:"lemon slices", nuts:"toasted nuts", chocCurls:"chocolate curls",
};

const SHAPE_F = { round:1.0, square:1.1, heart:0.85 };
const SHAPE_TIN = { round:'23 cm round springform tin', square:'20 cm square tin', heart:'heart-shaped tin' };

// thickness 0..1 -> multiplier 0.75..1.3
const tMul = t => 0.75 + t*0.55;

export function generate(design){
  const sF = SHAPE_F[design.shape] || 1;
  const L = design.layers;
  const ing = [];     // {amt,name}
  const steps = [];
  let chillMin = 240, bake = false;

  // ---------- CRUST ----------
  let baseName = "", baseLabel = "";
  if(L.base.on){
    const b = BASE[L.base.ing] || BASE.graham;
    baseName = b.name; baseLabel = b.label;
    const crumb = b.crumbG * sF;
    ing.push({ amt:g(crumb), name:b.crumb });
    if(!b.noSugar) ing.push({ amt:g(40*sF), name:"caster sugar" });
    ing.push({ amt:g((b.lessButter?70:100)*sF), name:"butter, melted" });
    const extra = b.nut ? " (pulse the nuts in with the biscuits for crunch)" : "";
    steps.push(`Blitz the ${b.crumb} to fine crumbs, stir through the melted butter${b.noSugar?"":" and sugar"}${extra}, then press firmly into the base of a ${SHAPE_TIN[design.shape]}. Chill 15 minutes while you make the filling.`);
  }

  // ---------- FILLING ----------
  let midName = "", midFlavor = "";
  if(L.middle.on){
    const mm = MIDDLE[L.middle.ing] || MIDDLE.vanilla;
    midName = mm.name; midFlavor = mm.flavor;
    const k = sF * tMul(L.middle.thickness);
    ing.push({ amt:g(600*k), name:"full-fat cream cheese, softened" });
    ing.push({ amt:g(150*k), name:"caster sugar" });
    ing.push({ amt:ml(150*k), name:"sour cream" });
    ing.push({ amt:`${Math.max(2,Math.round(3*k))}`, name:"large eggs" });
    mm.addIns.forEach(a=> ing.push({ amt:a[0], name:a[1] }));
    bake = true;
    steps.push(`Beat the cream cheese and sugar until smooth, then mix in the sour cream and ${mm.addIns.map(a=>a[1]).join(", ")}. Add the eggs one at a time, beating just until combined — don't overwork it.`);
    steps.push(`Pour the ${mm.flavor} filling over the ${L.base.on?"chilled base":"base of the lined tin"} and bake at 160 °C (fan 145 °C) for ${Math.round(50*tMul(L.middle.thickness))} minutes, until set with a gentle wobble in the centre. Cool in the oven with the door ajar, then chill at least 4 hours.`);
  }

  // ---------- TOPPING ----------
  let topAdj = "";
  if(L.top.on && TOP[L.top.ing]){
    const tt = TOP[L.top.ing];
    topAdj = tt.adj;
    const k = sF * tMul(L.top.thickness);
    tt.ings.forEach(a=>{
      // scale numeric leading amounts where sensible
      ing.push({ amt:a[0], name:a[1] });
    });
    steps.push(tt.step);
    if(L.top.ing === "jelly" || L.top.ing === "glaze") chillMin += 60;
  }

  // ---------- DECORATE ----------
  if(design.decorations.length){
    const names = design.decorations.map(d=>DECO[d]).filter(Boolean);
    ing.push({ amt:"to decorate", name:names.join(", ") });
    steps.push(`Just before serving, decorate with ${listJoin(names)}.`);
  }

  // ---------- final chill / serve ----------
  steps.push(`Unmould carefully, slice with a warm knife, and serve chilled.`);

  // ---------- title ----------
  const title = buildTitle({ shape:design.shape, topAdj, midName, baseName,
    layerCount:[L.base.on,L.middle.on,L.top.on].filter(Boolean).length });

  // ---------- times ----------
  const prep = 30 + (L.top.on?10:0);
  const times = {
    prep:`${prep} min`,
    cook: bake ? `${Math.round(50*tMul(L.middle.thickness))} min` : "no-bake",
    chill:`${(chillMin/60).toFixed(chillMin%60?1:0)} hr`,
  };

  return { title, times, ingredients:ing, steps };
}

function buildTitle({ shape, topAdj, midName, baseName, layerCount }){
  const parts = [];
  if(shape === "heart") parts.push("Heart");
  if(topAdj) parts.push(topAdj);
  if(midName) parts.push(midName);
  if(baseName && baseName!==midName) parts.push(baseName);
  if(layerCount === 3 && !topAdj) parts.push("Layered");
  parts.push("Cheesecake");
  // de-dupe consecutive
  return parts.filter((p,i)=>p!==parts[i-1]).join(" ");
}

function listJoin(arr){
  if(arr.length<=1) return arr[0]||"";
  return arr.slice(0,-1).join(", ") + " and " + arr[arr.length-1];
}

// ---- HTML renderer ----
export function renderHTML(r){
  const ings = r.ingredients.map(i=>
    `<li><span class="amt">${esc(i.amt)}</span> ${esc(i.name)}</li>`).join("");
  const steps = r.steps.map(s=>`<li>${esc(s)}</li>`).join("");
  return `
    <h3>${esc(r.title)}</h3>
    <p class="r-times">
      <span>Prep <b>${esc(r.times.prep)}</b></span>
      <span>Bake <b>${esc(r.times.cook)}</b></span>
      <span>Chill <b>${esc(r.times.chill)}</b></span>
    </p>
    <h4>Ingredients</h4>
    <ul class="r-ing">${ings}</ul>
    <h4>Method</h4>
    <ol class="r-steps">${steps}</ol>`;
}

// plain-text version (for export)
export function renderText(r){
  const lines = [r.title.toUpperCase(), ""];
  lines.push(`Prep ${r.times.prep}  ·  Bake ${r.times.cook}  ·  Chill ${r.times.chill}`, "");
  lines.push("INGREDIENTS");
  r.ingredients.forEach(i=>lines.push(`  - ${i.amt}  ${i.name}`));
  lines.push("", "METHOD");
  r.steps.forEach((s,i)=>lines.push(`  ${i+1}. ${s}`));
  return lines.join("\n");
}

function esc(s){ return String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
