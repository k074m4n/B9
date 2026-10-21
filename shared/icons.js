/* ============================================================================
   B9 · icons.js — inline line-style SVG glyphs for the tools (offline, no network).
   window.B9ICON(name, {size, stroke}) -> svg string (uses currentColor).
   window.B9ICON.setFavicon(name, color) -> injects a data-URI SVG favicon.
   Matte "Carbon" look: 24-grid, round caps, 1.7 stroke.
   ============================================================================ */
(function(){
"use strict";
var P={
  /* Salvo — a volley: three arrows of varying reach */
  salvo:'<path d="M3 7h10"/><path d="M3 12h13"/><path d="M3 17h10"/><path d="M11 4l3.5 3-3.5 3"/><path d="M13.5 9l3.5 3-3.5 3"/><path d="M11 14l3.5 3-3.5 3"/>',
  /* Facet — a cut gem, one meaning / many faces */
  facet:'<path d="M12 3l7.5 6L12 21 4.5 9z"/><path d="M4.5 9h15"/><path d="M12 3v18"/>',
  /* Recon — a scope / crosshair over the target */
  recon:'<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2"/><path d="M12 1.5v4"/><path d="M12 18.5v4"/><path d="M1.5 12h4"/><path d="M18.5 12h4"/>',
  /* Codec — code brackets with a slash: </> */
  codec:'<path d="M9.5 6.5l-5 5.5 5 5.5"/><path d="M14.5 6.5l5 5.5-5 5.5"/><path d="M13.2 5l-2.4 14"/>',
  /* Sieve — a funnel that filters down to the value */
  sieve:'<path d="M3 5h18l-7 8v5l-4 2v-7z"/>',
  /* Dossier — a document with a verified check */
  dossier:'<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 14l2 2 3.5-4"/>',
  /* Ledger — stacked bars / campaign ledger */
  ledger:'<path d="M4 20V10"/><path d="M9.5 20V5"/><path d="M15 20v-8"/><path d="M20.5 20V7"/><path d="M3 20h18"/>',
  /* Verdict — a score gauge with a needle */
  verdict:'<path d="M3 17a9 9 0 0 1 18 0"/><path d="M12 17l5-6"/><circle cx="12" cy="17" r="1.3"/><path d="M3 17h2"/><path d="M19 17h2"/>',
  /* Climb — multi-turn escalation steps */
  climb:'<path d="M3 20h4v-4h4v-4h4V8h4V4"/><path d="M3 20V12"/>',
  /* Lens — magnifier over a shield (defensive inspection) */
  lens:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15 15l5 5"/><path d="M10.5 7.5l2.5 1.2v2c0 1.8-1.1 3-2.5 3.6-1.4-.6-2.5-1.8-2.5-3.6v-2z"/>',
  /* Atlas — an open playbook / reference */
  atlas:'<path d="M12 6c-2-1.3-4.5-1.3-7-0.5V18c2.5-.8 5-.8 7 .5 2-1.3 4.5-1.3 7-.5V5.5c-2.5-.8-5-.8-7 .5z"/><path d="M12 6v12.5"/>',
  /* B9 — platform mark */
  b9:'<path d="M12 2.4l8.3 4.8v9.6L12 21.6 3.7 16.8V7.2z"/><circle cx="12" cy="12" r="2.4"/>'
};
function icon(name,opts){
  opts=opts||{};
  var s=opts.size||18, sw=opts.stroke||1.7, p=P[name]||P.b9;
  return '<svg class="b9ico b9ico-'+name+'" width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none" '+
    'stroke="currentColor" stroke-width="'+sw+'" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>';
}
icon.paths=P;
icon.has=function(n){ return !!P[n]; };
/* B9 monogram — B and 9 interlock: shared right spine (B's back = 9's tail) and
   shared upper loop (B's top bowl = 9's loop); the lower bowl completes the B.
   Two tones: c1 = the "9" (spine + upper loop), c2 = the bowl that completes the "B". */
icon.b9logo=function(opts){
  opts=opts||{};
  var s=opts.size||48, sw=opts.stroke||6, c1=opts.c1||"var(--accent)", c2=opts.c2||"var(--accent-dim)";
  /* viewBox 0 0 52 56. The "B" bowl (c2) is drawn first so the accent "9"
     (spine + rounder upper loop, c1) sits on top at the shared junctions —
     reading as one mark where the two letters interlock and complete each other. */
  return '<svg class="b9logo" width="'+s+'" height="'+(Math.round(s*56/52))+'" viewBox="0 0 52 56" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-label="B9">'+
    '<path d="M35 28C11 28 11 48 35 48" stroke="'+c2+'" stroke-width="'+sw+'"/>'+
    '<path d="M35 8V48 M35 8C12 8 12 28 35 28" stroke="'+c1+'" stroke-width="'+sw+'"/>'+
    '</svg>';
};
icon.setFavicon=function(name,color){
  try{
    var xml;
    if(name==="b9logo"){
      /* two-tone interlocking monogram with fixed colors (favicons can't resolve CSS vars) */
      var c1=color||"#b23a3a", c2="#8a2626";
      xml='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 56" fill="none" stroke-linecap="round" stroke-linejoin="round">'+
        '<path d="M35 28C11 28 11 48 35 48" stroke="'+c2+'" stroke-width="6"/>'+
        '<path d="M35 8V48 M35 8C12 8 12 28 35 28" stroke="'+c1+'" stroke-width="6"/></svg>';
    } else {
      var svg=icon(name,{size:32,stroke:2}).replace('stroke="currentColor"','stroke="'+(color||"#b23a3a")+'"');
      xml='<svg xmlns="http://www.w3.org/2000/svg"'+svg.slice(4);
    }
    var href="data:image/svg+xml,"+encodeURIComponent(xml);
    var l=document.querySelector('link[rel="icon"]');
    if(!l){ l=document.createElement("link"); l.rel="icon"; document.head.appendChild(l); }
    l.type="image/svg+xml"; l.href=href;
  }catch(e){}
};
window.B9ICON=icon;
})();
