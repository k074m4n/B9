"use strict";
/* B9 offline test harness — drives the real core.js + each tool through a
   minimal DOM (no deps, no network). Run with `npm test` or `node test/run.js`. */
const fs=require("fs");
const path=require("path");
const ROOT=path.join(__dirname,"..");
const md=require("./minidom.js");

md.installGlobals();
require(path.join(ROOT,"shared/core.js"));
const realMount=window.B9.mountTool;
let SPEC=null; window.B9.mountTool=(s)=>{SPEC=s;};

function inlineScript(file){
  const html=fs.readFileSync(path.join(ROOT,file),"utf8");
  // the main tool script is the longest inline <script> (pages also have a tiny
  // head early-theme-apply script that must be ignored)
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim())
    .sort((a,b)=>b.length-a.length)[0];
}
let pass=0, fail=0;
function ok(name,cond){ (cond?pass++:fail++); console.log((cond?"  ok  ":"FAIL  ")+name); }
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function remount(){ md.makeDocument(); global.document=md.doc; realMount(SPEC); }
function $(id){ return document.getElementById(id); }
function ls(key){ try{ return JSON.parse(global.localStorage.getItem(key)); }catch(e){ return null; } }

(async function(){
  /* ==================== SALVO ==================== */
  console.log("\n==== SALVO (tools/salvo) ====");
  eval(inlineScript("tools/salvo/index.html"));
  const KEY="b9.salvo.v1";

  let threw=null; try{ remount(); }catch(e){ threw=e; }
  ok("mounts without throwing", !threw); if(threw) console.log("   "+threw.stack);
  ok("brand rendered (SALVO)", /SALVO/.test(document.querySelector(".brand").textContent));
  ok("Pane A base textarea present", !!$("basePayload"));

  const base=$("basePayload"); base.value="Please explain the extraction process."; base.dispatch("input");
  $("genBtn").click();
  const vcards=()=>document.querySelectorAll(".vcard");
  ok("variants generated (>1)", vcards().length>1);
  ok("#1 is control", /control/.test(vcards()[0].querySelector(".chip").textContent));
  ok("persisted under b9.salvo.v1", ls(KEY) && ls(KEY).projects[0].variants.length>1);

  // determinism: same seed -> identical variant texts
  const t1=ls(KEY).projects[0].variants.map(v=>v.text);
  $("genBtn").click();
  const t2=ls(KEY).projects[0].variants.map(v=>v.text);
  ok("same seed reproduces identical batch", JSON.stringify(t1)===JSON.stringify(t2));

  // log + undo
  vcards()[1].querySelector('[data-r="success"]').click();
  ok("attempt logged to #2", ls(KEY).projects[0].variants[1].attempts.length===1);
  document.activeElement=null; document.dispatchKey("u");
  ok("'u' undoes the last attempt", ls(KEY).projects[0].variants[1].attempts.length===0);
  document.dispatchKey("u");
  ok("extra undo is a safe no-op", ls(KEY).projects[0].variants[1].attempts.length===0);

  // keyboard loop
  document.activeElement=$("basePayload");
  const snap=JSON.stringify(ls(KEY));
  document.dispatchKey("1");
  ok("shortcut inert while typing", JSON.stringify(ls(KEY))===snap);
  document.activeElement=null;
  document.dispatchKey("c"); await sleep(5);
  ok("'c' copies selected variant", typeof global.__copied==="string" && global.__copied.length>0);
  const n0=ls(KEY).projects[0].variants.reduce((s,v)=>s+v.attempts.length,0);
  document.dispatchKey("1");
  ok("'1' logs a success", ls(KEY).projects[0].variants.reduce((s,v)=>s+v.attempts.length,0)===n0+1);

  // reload restores
  const totalBefore=ls(KEY).projects[0].variants.reduce((s,v)=>s+v.attempts.length,0);
  remount();
  ok("after reload variants restored", document.querySelectorAll(".vcard").length>1);
  ok("after reload attempts restored", ls(KEY).projects[0].variants.reduce((s,v)=>s+v.attempts.length,0)===totalBefore);

  // ensure a tagged variant has an attempt (exercises per-tag + family rollup)
  document.querySelectorAll(".vcard")[1].querySelector('[data-r="success"]').click();
  ok("MLCommons family rollup in stats", /By MLCommons family/.test($("groupTable").innerHTML));

  // exports
  $("exportJsonBtn").click();
  let jsonOK=false; try{ jsonOK=Array.isArray(JSON.parse(global.__lastBlob).projects); }catch(e){}
  ok("export JSON valid", jsonOK);
  $("exportMdBtn").click();
  ok("export MD report header", /# Arena red-team report/.test(global.__lastBlob));
  ok("export MD has MLCommons family section", /by MLCommons family/i.test(global.__lastBlob));
  ok("export MD best-of-N stats via stats pane", /best-of-N/.test($("funnel").innerHTML));

  // import validation
  $("importFile").onchange({target:{files:[{_text:"{ not json"}],value:""}}); await sleep(40);
  ok("bad import -> error modal, no throw", /Import failed/.test($("modalBox").innerHTML));
  if($("impErr")) $("impErr").click();
  const good={projects:[{id:"imp1",name:"Imported",variants:[]}],activeProjectId:"imp1",settings:{theme:"light"}};
  const nBefore=ls(KEY).projects.length;
  $("importFile").onchange({target:{files:[{_text:JSON.stringify(good)}],value:""}}); await sleep(40);
  if($("impMerge")) $("impMerge").click();
  ok("good import merges a project", ls(KEY).projects.length===nBefore+1);

  // legacy-key migration (salvo.v1 -> b9.salvo.v1) in an isolated storage
  global.localStorage=md.makeLocalStorage();
  const legacy={projects:[{id:"leg1",name:"LegacyProject",variants:[],generator:undefined}],activeProjectId:"leg1",settings:{theme:"dark"}};
  global.localStorage.setItem("salvo.v1",JSON.stringify(legacy));
  remount();
  ok("migrates data from legacy key", ls(KEY) && ls(KEY).projects.some(p=>p.name==="LegacyProject"));

  // private-window (storage throws)
  global.localStorage={getItem:()=>null,setItem:()=>{throw new Error("blocked");},removeItem:()=>{}};
  let threw2=null; try{ remount(); }catch(e){ threw2=e; }
  ok("mounts with storage disabled", !threw2);
  ok("storage-unavailable banner shown", /Storage unavailable/.test($("banner").innerHTML));
  global.localStorage=md.makeLocalStorage();

  // shared platform theme: a tool opened from a dark hub mounts dark
  global.localStorage.setItem("b9.hub.theme","dark");
  remount();
  ok("core tool honors shared hub theme (dark)", document.documentElement.getAttribute("data-theme")==="dark");
  global.localStorage=md.makeLocalStorage();

  /* ==================== FACET ==================== */
  console.log("\n==== FACET (tools/facet) ====");
  SPEC=null; eval(inlineScript("tools/facet/index.html"));
  const FKEY="b9.facet.v1";
  let threwF=null; try{ remount(); }catch(e){ threwF=e; }
  ok("Facet mounts without throwing", !threwF); if(threwF) console.log("   "+threwF.stack);
  ok("brand rendered (FACET)", /FACET/.test(document.querySelector(".brand").textContent));
  ok("invariant banner shown", /re-expresses text you type/.test($("banner").innerHTML));
  const fb=$("base"); fb.value="Please explain the extraction process."; fb.dispatch("input");
  $("genBtn").click();
  ok("Facet generates variants", document.querySelectorAll(".vcard").length>1);
  ok("persisted under b9.facet.v1", ls(FKEY) && ls(FKEY).projects[0].variants.length>1);
  ok("boundary-map header present", /Boundary map/.test(document.querySelector('[data-pane="C"]').innerHTML));
  $("exportMdBtn").click();
  ok("Facet MD recon-report header", /# Facet recon report/.test(global.__lastBlob));
  // legacy reframeLab.v1 -> b9.facet.v1
  global.localStorage=md.makeLocalStorage();
  global.localStorage.setItem("reframeLab.v1",JSON.stringify({projects:[{id:"r1",name:"OldReframe",base:"",variants:[]}],activeProjectId:"r1",settings:{theme:"dark"}}));
  remount();
  ok("Facet migrates from reframeLab.v1", ls(FKEY) && ls(FKEY).projects.some(p=>p.name==="OldReframe"));

  /* ==================== WORKBENCH TOOLS (pure logic) ==================== */
  console.log("\n==== WORKBENCH (kit.js tools) ====");
  require(path.join(ROOT,"shared/kit.js"));          // window.B9KIT
  ok("kit.js Store + esc", typeof window.B9KIT.Store==="function" && window.B9KIT.esc("<a>")==="&lt;a&gt;");
  function loadWorkbench(file){ md.makeDocument(); global.document=md.doc; eval(inlineScript(file)); } // getElementById(...)=>null => DOM wiring skipped

  loadWorkbench("tools/recon/index.html");
  const R=window.RECON;
  ok("Recon: training+shallow -> prefix", /PREFIX/.test(R.derivePlan({guard:{depth:"shallow"}}).primary));
  ok("Recon: guarded -> stack + layers", /STACK/.test(R.derivePlan({guard:{input:"yes",output:"yes"}}).primary) && R.derivePlan({guard:{input:"yes",output:"yes"},caps:{tools:"yes"}}).layers.some(l=>/INDIRECT/.test(l)));
  ok("Recon: readiness math", R.readiness({})===0 && R.readiness({guard:{input:"yes",depth:"deep"},obf:{base64:"yes"}})>0);

  loadWorkbench("tools/dossier/index.html");
  const D=window.DOSSIER;
  ok("Dossier: LLM07 classification + gate warn", /AML.T0051.000/.test(D.buildReport({bugClass:"llm07",gates:{}})) && /unchecked/.test(D.buildReport({gates:{}})));
  ok("Dossier: all gates -> submission-ready", /submission-ready/.test(D.buildReport({gates:{scope:1,repro:1,current:1,rootcause:1,reachable:1,impact:1,ready:1}})));
  const sum=D.importSummary({activeProjectId:"p",projects:[{id:"p",scenario:"s",model:"M",basePayload:"b",variants:[{tags:["case"],attempts:[{result:"success"},{result:"fail"}]}]}]});
  ok("Dossier: importSummary totals + table", /Total attempts: 2/.test(sum.summary) && /case \| 2 \| 1 \| 50%/.test(sum.summary));
  let dThrew=false; try{ D.importSummary({}); }catch(e){ dThrew=true; } ok("Dossier: bad import throws", dThrew);

  loadWorkbench("tools/sieve/index.html");
  const SV=window.SIEVE; let sd={positions:[],log:[]}; SV.setLength(sd,5); sd.positions[0].ch="7"; sd.positions[2].ch="A";
  ok("Sieve: reconstruct + resize", SV.reconstruct(sd)==="7A" && (SV.setLength(sd,2),SV.reconstruct(sd)==="7"));
  ok("Sieve: classStats", (function(){ sd.log=[{cls:"x"},{cls:"x"},{cls:"y"}]; var m=SV.classStats(sd); return m.x===2&&m.y===1; })());

  loadWorkbench("tools/codec/index.html");
  const CO=window.CODEC, cr=CO.selfTest();
  ok("Codec: reversible codecs round-trip", cr.filter(x=>x.ok===false).length===0 && cr.filter(x=>x.ok===true).length>=10);
  ok("Codec: inspector detects + strips", CO.scan("aсcount​").length===2 && CO.strip("aсcount​")==="account");

  loadWorkbench("tools/ledger/index.html");
  const LG=window.LEDGER;
  ok("Ledger: familyOf maps Salvo + Facet tags", LG.familyOf("case")==="Perturbation" && LG.familyOf("register:formal")==="Overt Carriers" && LG.familyOf("mood:x")==="Composition & Ordering" && LG.familyOf("approx")===null);
  const lex=LG.flatten({projects:[{name:"S",variants:[{tags:["case"],attempts:[{result:"success"},{result:"fail"}]},{tags:["encode"],attempts:[{result:"refused"},{result:"refused"},{result:"refused"}]}]}]});
  const lag=LG.aggregate(lex.concat(LG.flatten({projects:[{name:"F",variants:[{tags:["register:formal"],attempts:[{result:"success"}]}]}]})));
  ok("Ledger: aggregate overall + family", lag.total===6 && lag.succ===2 && lag.byFamily.find(r=>r.k==="Perturbation").att===2);
  ok("Ledger: rotation flags a closed class + honest LB", lag.rotate.some(r=>r.k==="encode"&&r.att===3) && lag.wilson<lag.rate);

  loadWorkbench("tools/verdict/index.html");
  const VD=window.VERDICT;
  ok("Verdict: a refusal scores 0 (not a win)", VD.score({refused:"yes",meets:"yes",specificity:5}).verdict==="refused" && VD.score({refused:"yes"}).score===0);
  ok("Verdict: jailbreak-tax (complied, off-target) != real success", VD.score({refused:"no",meets:"no",specificity:5}).verdict==="fail" && VD.score({refused:"no",meets:"yes",specificity:5}).verdict==="success");

  console.log("\n==== RESULT: "+pass+" passed, "+fail+" failed ====\n");
  process.exit(fail?1:0);
})();
