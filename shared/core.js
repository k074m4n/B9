/* ============================================================================
   B9 · core.js — shared engine for every tool (Salvo, Reframe, …)
   Classic script (file:// safe — no ES modules, no network). Exposes window.B9.
   A tool calls B9.mountTool(spec); the core builds the identical 3-pane shell,
   owns the variant queue / stats / export / import / keyboard loop / storage,
   and calls back into the tool for its unique Pane A + generation logic.
   ============================================================================ */
(function(){
"use strict";

/* ----------------------------------------------------------------------------
   Utilities
   ---------------------------------------------------------------------------- */
function uuid(){
  try{ if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
  return "id-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
}
function now(){ return Date.now(); }
function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function pct(n,d){ return d>0 ? Math.round(n/d*100) : 0; }
function uniq(a){ return a.filter(function(v,i){ return a.indexOf(v)===i; }); }

/* seedable PRNG — mulberry32 (never Math.random for generation) */
function mulberry32(a){
  return function(){
    a|=0; a=a+0x6D2B79F5|0;
    var t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
/* deterministic string hash (cyrb-ish) */
function hashStr(str){
  var h=1779033703^str.length;
  for(var i=0;i<str.length;i++){
    h=Math.imul(h^str.charCodeAt(i),3432918353);
    h=h<<13|h>>>19;
  }
  return (h^(h>>>16))>>>0;
}
function pick(arr,rng){ return arr[Math.floor(rng()*arr.length)]; }
function pickN(arr,rng,min,max){
  if(!arr.length) return [];
  var pool=arr.slice();
  for(var i=pool.length-1;i>0;i--){ var j=Math.floor(rng()*(i+1)); var t=pool[i]; pool[i]=pool[j]; pool[j]=t; }
  var hi=Math.min(max,pool.length), lo=Math.min(min,hi);
  var n=lo+Math.floor(rng()*(hi-lo+1));
  return pool.slice(0,n);
}
function matchCase(src,repl){
  if(src===src.toUpperCase() && src!==src.toLowerCase()) return repl.toUpperCase();
  if(src[0]===src[0].toUpperCase() && src[0]!==src[0].toLowerCase())
    return repl.charAt(0).toUpperCase()+repl.slice(1);
  return repl;
}
function lowerFirst(s){ return s ? s.charAt(0).toLowerCase()+s.slice(1) : s; }
function upperFirst(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }

/* chip hue — stable hash of a tag key -> one of 3 accent classes.
   magenta is intentionally excluded (reserved for selection / active / success-dot). */
var CHIP_HUES=["cyan","violet","amber"];
function chipHue(key){ return CHIP_HUES[hashStr(String(key))%CHIP_HUES.length]; }

/* ----------------------------------------------------------------------------
   Result vocabulary — shared across all tools (comparable reports)
   ---------------------------------------------------------------------------- */
var RESULTS=["success","partial","refused","flagged","fail"];
var RESULT_LABEL={success:"✓ success",partial:"◐ partial",refused:"⊘ refused",flagged:"⚑ flagged",fail:"✗ fail"};
var RESULT_KEYMAP={"1":"success","2":"partial","3":"refused","4":"flagged","0":"fail"};
function keyFor(r){ for(var k in RESULT_KEYMAP) if(RESULT_KEYMAP[k]===r) return k; return ""; }

var MAX_DIFF_CHARS=6000, MAX_VARIANTS=200;

/* ----------------------------------------------------------------------------
   Word-level diff (variant vs base) — simple LCS, capped
   ---------------------------------------------------------------------------- */
function tokenize(s){ return s.match(/\s+|\S+/g)||[]; }
function diffHTML(base,variant){
  if(base.length>MAX_DIFF_CHARS || variant.length>MAX_DIFF_CHARS)
    return '<span style="color:var(--fg-faint)">(diff disabled — payload too long)</span>';
  var a=tokenize(base), b=tokenize(variant), n=a.length, m=b.length;
  if(n*m>400000) return '<span style="color:var(--fg-faint)">(diff disabled — too many tokens)</span>';
  var dp=[]; for(var x=0;x<=n;x++) dp.push(new Uint32Array(m+1));
  for(var i=n-1;i>=0;i--) for(var j=m-1;j>=0;j--)
    dp[i][j]= a[i]===b[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j],dp[i][j+1]);
  var html="", eqBuf="",delBuf="",insBuf=""; i=0; j=0;
  function flush(tag,buf){ if(buf) html+= tag ? "<span class=\"diff-"+tag+"\">"+esc(buf)+"</span>" : esc(buf); }
  while(i<n && j<m){
    if(a[i]===b[j]){ if(delBuf){flush("del",delBuf);delBuf="";} if(insBuf){flush("add",insBuf);insBuf="";} eqBuf+=a[i]; i++; j++; }
    else if(dp[i+1][j]>=dp[i][j+1]){ if(eqBuf){flush(null,eqBuf);eqBuf="";} delBuf+=a[i]; i++; }
    else { if(eqBuf){flush(null,eqBuf);eqBuf="";} insBuf+=b[j]; j++; }
  }
  flush(null,eqBuf);
  while(i<n){ delBuf+=a[i++]; } flush("del",delBuf);
  while(j<m){ insBuf+=b[j++]; } flush("add",insBuf);
  return html;
}

/* ----------------------------------------------------------------------------
   Deterministic generation loop — shared by every tool.
   seed is derived from (seed + base + signature) so a batch reproduces.
   #1 is always the untouched base (control, tags=[]). makeVariant returns:
     {text,tags}  -> candidate (de-duplicated against base + prior variants)
     null         -> skip this round (dup/empty) and retry
     false        -> hard stop (no more variation possible)
   ---------------------------------------------------------------------------- */
function generate(opts){
  var base=opts.base||"";
  var N=clamp(parseInt(opts.count,10)||1,1,MAX_VARIANTS);
  var seedInt=((parseInt(opts.seed,10)||0) ^ hashStr(base+"|"+(opts.signature||"")))>>>0;
  var rng=mulberry32(seedInt);
  var out=[], seen=Object.create(null);
  function add(text,tags){
    if(seen[text]) return false; seen[text]=1;
    out.push({id:uuid(),text:text,tags:(tags||[]).slice(),createdAt:now(),attempts:[]});
    return true;
  }
  add(base,[]);                              // #1 control
  if(typeof opts.prepare==="function") opts.prepare(rng);
  var guardMax=Math.max(3000,N*60), guard=0, stop=false;
  while(out.length<N && guard++<guardMax && !stop){
    var r=opts.makeVariant(rng,out.length);
    if(r===false){ stop=true; break; }
    if(!r) continue;
    add(r.text, uniq(r.tags||[]));
  }
  return {variants:out, requested:N, produced:out.length, exhausted:out.length<N};
}

/* ----------------------------------------------------------------------------
   mountTool(spec) — build the shell and wire everything
   ---------------------------------------------------------------------------- */
function mountTool(spec){
  var STORE_KEY=spec.storeKey;
  var state=null, storageOK=true, selectedId=null;
  var vUI=new Map();                         // variantId -> {exp,diff}
  var activeTab="A";
  function vuiOf(id){ if(!vUI.has(id)) vUI.set(id,{exp:false,diff:false}); return vUI.get(id); }

  /* ---------- state / persistence ---------- */
  function freshState(){
    var p=mkProject(spec.firstProjectName||"Scenario 1 / Model A");
    return {projects:[p], activeProjectId:p.id, settings:{theme:"light"}};
  }
  function mkProject(name){
    var p=spec.newProject(name||"New project");
    p.id=p.id||uuid();
    p.name=p.name||name||"New project";
    if(typeof p.scenario!=="string") p.scenario="";
    if(typeof p.model!=="string") p.model="";
    if(!p.createdAt) p.createdAt=now();
    p.variants=Array.isArray(p.variants)?p.variants:[];
    return p;
  }
  function migrate(s){
    if(!s||typeof s!=="object"||!Array.isArray(s.projects)) throw new Error("bad shape");
    s.settings=s.settings||{theme:"light"};
    s.projects.forEach(function(p){
      p.variants=Array.isArray(p.variants)?p.variants:[];
      p.variants.forEach(function(v){
        v.attempts=Array.isArray(v.attempts)?v.attempts:[];
        if(!Array.isArray(v.tags)) v.tags = v.strategies||v.axes||[];   // back-compat
      });
      if(typeof spec.migrateProject==="function") spec.migrateProject(p);
    });
    if(!s.activeProjectId || !s.projects.some(function(p){return p.id===s.activeProjectId;}))
      s.activeProjectId = s.projects[0] ? s.projects[0].id : null;
    return s;
  }
  function load(){
    try{
      var raw=localStorage.getItem(STORE_KEY);
      if(raw==null && spec.legacyStoreKey){            // one-time migration from an older key
        var old=localStorage.getItem(spec.legacyStoreKey);
        if(old!=null){ state=migrate(JSON.parse(old)); save(); return; }
      }
      if(raw==null){ state=freshState(); save(); return; }
      state=migrate(JSON.parse(raw));
    }catch(e){
      storageOK=false; state=freshState();
      showBanner("Storage unavailable — session will not be saved.");
    }
  }
  function save(){
    if(!storageOK) return;
    try{ localStorage.setItem(STORE_KEY,JSON.stringify(state)); }
    catch(e){ storageOK=false; showBanner("Storage unavailable or full — session will not be saved. Export to keep your data."); }
  }
  function activeProject(){ return state.projects.find(function(p){return p.id===state.activeProjectId;})||null; }

  /* ---------- DOM shell ---------- */
  /* apply the shared platform theme immediately (before the shell renders) so a
     tool opened from a dark hub doesn't flash light. */
  try{ var _sharedTheme=localStorage.getItem("b9.hub.theme"); if(_sharedTheme) document.documentElement.setAttribute("data-theme",_sharedTheme); }catch(e){}
  var root=document.getElementById("app") || document.body;
  var homeHref=spec.homeHref||"../../index.html";
  root.innerHTML=
    '<div id="banner" class="banner"></div>'+
    '<div class="topbar">'+
      '<a class="home-link" href="'+esc(homeHref)+'" title="Back to B9 hub">B9</a>'+
      '<span class="brand'+(spec.icon?' hasico':'')+'"><span id="b9brandico"></span>'+esc(spec.brand.scheme)+'://'+esc(spec.brand.path)+'<span class="caret">_</span></span>'+
      '<select class="proj" id="projSelect" title="Active project"></select>'+
      '<button class="btn sm" id="newProjBtn" title="New project">+ New</button>'+
      '<button class="btn sm" id="renameProjBtn" title="Rename / delete project">⋯</button>'+
      '<span class="spacer"></span>'+
      '<span class="badge-offline" title="This tool never makes a network request.">offline</span>'+
      '<button class="btn tb-btn" id="infoBtn" title="How to use" aria-label="How to use this tool">ⓘ</button>'+
      '<button class="btn tb-btn" id="helpBtn" title="Keyboard shortcuts">?</button>'+
      '<button class="btn tb-btn" id="themeBtn" title="Toggle theme">◐</button>'+
      '<button class="btn tb-btn" id="exportMdBtn" title="Export Markdown report">↓ MD</button>'+
      '<button class="btn tb-btn" id="exportCsvBtn" title="Export per-variant table as CSV">↓ CSV</button>'+
      '<button class="btn tb-btn" id="exportJsonBtn" title="Export all as JSON">↓ JSON</button>'+
      '<button class="btn tb-btn" id="importBtn" title="Import JSON">↑ JSON</button>'+
      '<input type="file" id="importFile" accept="application/json,.json" style="display:none">'+
    '</div>'+
    '<div class="tabbar">'+
      '<button class="tab active" data-tab="A">'+esc(spec.paneATab||"Base &amp; Setup")+'</button>'+
      '<button class="tab" data-tab="B">Variants</button>'+
      '<button class="tab" data-tab="C">Stats &amp; Log</button>'+
    '</div>'+
    '<div class="layout">'+
      '<section class="pane active" data-pane="A"><div class="pane-title">A · '+esc(spec.paneATitle||"Base &amp; Setup")+'</div><div id="paneAHost"></div></section>'+
      '<section class="pane" data-pane="B"><div class="pane-title">B · Variant Queue</div>'+
        '<div class="queue-top"><button class="btn primary sm" id="copyNextBtn" title="Copy first untried variant &amp; jump to it">⧉ Copy next untried</button><span class="hint" id="queueMeta" style="margin:0"></span></div>'+
        '<div id="variantList"></div></section>'+
      '<section class="pane" data-pane="C"><div class="pane-title">C · Stats &amp; Log</div>'+
        '<div class="card"><h3 class="h-sec">Funnel</h3><div id="funnel"></div></div>'+
        '<div class="card"><h3 class="h-sec">'+esc(spec.groupTableTitle||"Success rate by strategy")+'</h3><div id="groupTable"></div></div>'+
        '<div class="card"><h3 class="h-sec">Cumulative successes</h3><div id="sparkWrap"></div></div>'+
        '<div class="card"><h3 class="h-sec">Recent attempts</h3><div id="logWrap"></div></div></section>'+
    '</div>'+
    '<div class="footer"><b>Offline tool</b> · '+esc(spec.footerText||"no data leaves this page · submit manually per Arena rules")+'</div>'+
    '<div id="toast"></div>'+
    '<div class="modal" id="modal" role="dialog" aria-modal="true" aria-label="Dialog"><div class="box" id="modalBox"></div></div>';

  var $=function(id){ return document.getElementById(id); };
  var els={
    banner:$("banner"), toast:$("toast"), modal:$("modal"), modalBox:$("modalBox"),
    projSelect:$("projSelect"), paneAHost:$("paneAHost"),
    variantList:$("variantList"), queueMeta:$("queueMeta"),
    funnel:$("funnel"), groupTable:$("groupTable"), sparkWrap:$("sparkWrap"), logWrap:$("logWrap")
  };
  if(document.title==="") document.title=spec.title||"B9";

  /* ---------- banner / toast / modal ---------- */
  function showBanner(msg,cls){
    els.banner.className="banner show"+(cls?(" "+cls):"");
    els.banner.innerHTML=esc(msg)+' <button aria-label="dismiss">✕</button>';
    els.banner.querySelector("button").onclick=function(){ els.banner.classList.remove("show"); };
  }
  var toastTimer=null;
  function toast(msg){ els.toast.textContent=msg; els.toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer=setTimeout(function(){ els.toast.classList.remove("show"); },1300); }
  function openModal(html){ els.modalBox.innerHTML=html; els.modal.classList.add("show"); }
  function closeModal(){ els.modal.classList.remove("show"); els.modalBox.innerHTML=""; }
  els.modal.addEventListener("click",function(e){ if(e.target===els.modal) closeModal(); });

  /* ---------- the api handed to the tool ---------- */
  var api={
    el:function(sel,ctx){ return (ctx||els.paneAHost).querySelector(sel); },
    els:function(sel,ctx){ return Array.prototype.slice.call((ctx||els.paneAHost).querySelectorAll(sel)); },
    getProject:activeProject,
    save:save,
    toast:toast, banner:showBanner, openModal:openModal, closeModal:closeModal,
    esc:esc, uuid:uuid, pick:pick, pickN:pickN, uniq:uniq, clamp:clamp,
    matchCase:matchCase, lowerFirst:lowerFirst, upperFirst:upperFirst,
    MAX_VARIANTS:MAX_VARIANTS,
    runGenerate:runGenerate,
    rerenderVariants:renderVariants,
    rerenderStats:renderStats,
    refreshPaneA:renderPaneA,
    switchTab:switchTab
  };

  /* ---------- Pane A (delegated to tool) ---------- */
  function renderPaneA(){
    var p=activeProject(); if(!p) return;
    spec.renderPaneA(els.paneAHost, p, api);
  }
  function commitFields(){
    var p=activeProject(); if(!p) return;
    if(typeof spec.commitFields==="function") spec.commitFields(p, api);
    save();
  }

  /* ---------- tags ---------- */
  function tagInfo(key){
    var info=(typeof spec.tagInfo==="function") ? spec.tagInfo(key) : null;
    info=info||{};
    return {label:info.label||key, hue:info.hue||chipHue(key), approx:!!info.approx};
  }
  function tagChip(key){
    var t=tagInfo(key);
    return '<span class="chip '+(t.approx?"approx":t.hue)+'">'+esc(t.label)+'</span>';
  }

  /* ---------- Pane B — variant queue ---------- */
  function vStatText(v){
    var a=v.attempts.length, s=v.attempts.filter(function(x){return x.result==="success";}).length;
    return "attempts: "+a+" · success: "+s+" ("+pct(s,a)+"%)";
  }
  function renderVariants(){
    var p=activeProject(); if(!p) return;
    var base=p.basePayload||p.base||"";
    if(!p.variants.length){
      els.variantList.innerHTML='<div class="empty">No variants yet.<br>Write a base payload, set up '+(spec.paneANoun||"options")+', and press <b>Generate</b>.</div>';
      els.queueMeta.textContent=""; return;
    }
    var untried=p.variants.filter(function(v){return v.attempts.length===0;}).length;
    els.queueMeta.textContent=p.variants.length+" variants · "+untried+" untried";
    if(selectedId && !p.variants.some(function(v){return v.id===selectedId;})) selectedId=null;
    if(!selectedId) selectedId=p.variants[0].id;

    els.variantList.innerHTML=p.variants.map(function(v,idx){
      var ui=vuiOf(v.id);
      var isCtrl=idx===0 && v.tags.length===0;
      var tags= isCtrl ? '<span class="chip muted">control</span>'
                       : v.tags.map(tagChip).join("");
      var content= ui.diff ? diffHTML(base,v.text) : esc(v.text);
      return '<div class="vcard '+(v.id===selectedId?"sel":"")+" "+(isCtrl?"control":"")+'" data-vid="'+v.id+'" data-idx="'+idx+'">'+
        '<div class="vhead"><span class="vnum">#'+(idx+1)+'</span>'+tags+
          '<span class="vstat" data-stat="'+v.id+'">'+vStatText(v)+'</span></div>'+
        '<div class="code '+(ui.exp?"exp":"")+'" data-text="'+v.id+'">'+content+'</div>'+
        '<div class="vctrls"><button class="btn sm" data-copy="'+v.id+'">⧉ Copy</button>'+
          '<button class="linkbtn" data-exp="'+v.id+'">'+(ui.exp?"collapse":"expand")+'</button>'+
          '<button class="linkbtn" data-diff="'+v.id+'">'+(ui.diff?"hide diff":"diff")+'</button></div>'+
        '<div class="res-row">'+RESULTS.map(function(r){
          return '<button class="resbtn" data-r="'+r+'" data-res="'+v.id+':'+r+'">'+RESULT_LABEL[r]+' <span class="k">'+keyFor(r)+'</span></button>';
        }).join("")+'</div>'+
        '<input class="noteinp" data-note="'+v.id+'" placeholder="optional note (model reply, guard behavior…) — attached to next result">'+
      '</div>';
    }).join("");
    bindVariantEvents();
  }
  function bindVariantEvents(){
    api.els("[data-copy]",els.variantList).forEach(function(b){ b.onclick=function(){ copyVariant(b.dataset.copy,b); }; });
    api.els("[data-exp]",els.variantList).forEach(function(b){ b.onclick=function(){ var u=vuiOf(b.dataset.exp); u.exp=!u.exp; renderVariants(); }; });
    api.els("[data-diff]",els.variantList).forEach(function(b){ b.onclick=function(){ var u=vuiOf(b.dataset.diff); u.diff=!u.diff; renderVariants(); }; });
    api.els("[data-res]",els.variantList).forEach(function(b){ b.onclick=function(){ var parts=b.dataset.res.split(":"); logResult(parts[0],parts[1]); }; });
    api.els(".vcard",els.variantList).forEach(function(c){ c.addEventListener("click",function(e){
      if(e.target.closest("button")||e.target.closest("input")) return;
      selectVariant(c.dataset.vid,false);
    }); });
  }
  function getVariant(id){ var p=activeProject(); return p&&p.variants.find(function(v){return v.id===id;}); }
  function selectVariant(id,scroll){
    selectedId=id;
    api.els(".vcard",els.variantList).forEach(function(c){ c.classList.toggle("sel",c.dataset.vid===id); });
    if(scroll){ var el=els.variantList.querySelector('.vcard[data-vid="'+id+'"]'); if(el) el.scrollIntoView({block:"nearest",behavior:"smooth"}); }
  }
  function currentIndex(){ var p=activeProject(); return p?p.variants.findIndex(function(v){return v.id===selectedId;}):-1; }
  function moveSel(delta){
    var p=activeProject(); if(!p||!p.variants.length) return;
    var i=currentIndex(); if(i<0) i=0; i=clamp(i+delta,0,p.variants.length-1);
    selectVariant(p.variants[i].id,true);
  }
  var undoStack=[];                 // session-only: {vid, aid} per logged attempt
  function updateQueueMeta(){
    var p=activeProject(); if(!p) return;
    els.queueMeta.textContent=p.variants.length+" variants · "+p.variants.filter(function(x){return x.attempts.length===0;}).length+" untried";
  }
  function logResult(id,result){
    var p=activeProject(), v=getVariant(id); if(!v) return;
    var inp=els.variantList.querySelector('[data-note="'+id+'"]');
    var note=inp?inp.value.trim():"";
    var aid=uuid();
    v.attempts.push({id:aid,ts:now(),result:result,note:note});
    undoStack.push({vid:id,aid:aid});
    if(inp) inp.value="";
    save();
    var statEl=els.variantList.querySelector('[data-stat="'+id+'"]'); if(statEl) statEl.textContent=vStatText(v);
    if(result==="success"){ var card=els.variantList.querySelector('.vcard[data-vid="'+id+'"]');
      if(card){ card.classList.remove("win"); void card.offsetWidth; card.classList.add("win"); } }
    renderStats(); updateQueueMeta();
    toast(RESULT_LABEL[result]+" logged  ·  u = undo");
    var i=currentIndex();
    if(i>=0 && i<p.variants.length-1) selectVariant(p.variants[i+1].id,true);
  }
  function undoLast(){
    var p=activeProject(); if(!p) return;
    var last=undoStack.pop();
    if(!last){ toast("Nothing to undo"); return; }
    var v=p.variants.find(function(x){return x.id===last.vid;});
    var removed=null;
    if(v){ var i=v.attempts.findIndex(function(a){return a.id===last.aid;});
      if(i>=0){ removed=v.attempts.splice(i,1)[0]; } }
    if(!removed){ toast("Nothing to undo"); return; }
    save();
    var statEl=els.variantList.querySelector('[data-stat="'+last.vid+'"]'); if(statEl) statEl.textContent=vStatText(v);
    renderStats(); updateQueueMeta();
    toast("Undid "+(removed.result)+" on #"+(p.variants.indexOf(v)+1));
  }

  /* ---------- clipboard (file:// safe) ---------- */
  function doCopy(text,cb){
    var fallback=function(){
      try{
        var ta=document.createElement("textarea");
        ta.value=text; ta.style.position="fixed"; ta.style.opacity="0"; ta.style.left="-9999px";
        document.body.appendChild(ta); ta.focus(); ta.select();
        var ok=document.execCommand("copy"); document.body.removeChild(ta); cb(!!ok);
      }catch(e){ cb(false); }
    };
    if(navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(text).then(function(){cb(true);}).catch(fallback);
    else fallback();
  }
  function copyVariant(id,btn){
    var v=getVariant(id); if(!v) return;
    selectVariant(id,false);
    doCopy(v.text,function(ok){
      if(ok){ toast("Copied — paste into Arena, then log the result");
        if(btn){ btn.classList.add("copied"); setTimeout(function(){ btn.classList.remove("copied"); },700); } }
      else showManualCopy(v.text);
    });
  }
  function copyNextUntried(){
    var p=activeProject(); if(!p) return;
    var v=p.variants.find(function(x){return x.attempts.length===0;});
    if(!v){ toast("No untried variants left"); return; }
    selectVariant(v.id,true);
    doCopy(v.text,function(ok){ if(ok) toast("Copied next untried (#"+(p.variants.indexOf(v)+1)+")"); else showManualCopy(v.text); });
  }
  function showManualCopy(text){
    openModal('<h2>Copy manually</h2><p class="hint" style="margin-top:0">Clipboard access is blocked. Select all and press <kbd>Ctrl/⌘ C</kbd>.</p>'+
      '<textarea class="input textarea" id="manualCopy" readonly>'+esc(text)+'</textarea>'+
      '<div class="actions"><button class="btn" id="mcSelect">Select all</button><button class="btn primary" id="mcClose">Close</button></div>');
    setTimeout(function(){ var t=$("manualCopy"); if(t){ t.focus(); t.select(); }
      var s=$("mcSelect"); if(s) s.onclick=function(){ t.select(); };
      var b=$("mcClose"); if(b) b.onclick=closeModal; },30);
  }

  /* ---------- Pane C — stats ---------- */
  function collectAttempts(p){
    var all=[];
    p.variants.forEach(function(v,idx){ v.attempts.forEach(function(a){ all.push({a:a,v:v,idx:idx}); }); });
    all.sort(function(x,y){ return x.a.ts-y.a.ts; });
    return all;
  }
  function aggregateGroups(p){
    var agg={};
    p.variants.forEach(function(v){
      if(!v.attempts.length) return;
      var s=v.attempts.filter(function(a){return a.result==="success";}).length;
      v.tags.forEach(function(k){ if(!agg[k]) agg[k]={att:0,suc:0}; agg[k].att+=v.attempts.length; agg[k].suc+=s; });
    });
    return Object.keys(agg).map(function(k){ return {k:k,att:agg[k].att,suc:agg[k].suc,rate:agg[k].att?agg[k].suc/agg[k].att:0}; })
      .sort(function(a,b){ return b.rate-a.rate || b.att-a.att; });
  }
  /* roll up by taxonomy family (spec.family(tag) -> label); a variant counts once per family */
  function aggregateFamilies(p){
    if(typeof spec.family!=="function") return null;
    var agg={};
    p.variants.forEach(function(v){
      if(!v.attempts.length) return;
      var s=v.attempts.filter(function(a){return a.result==="success";}).length, fams={};
      v.tags.forEach(function(k){ var f=spec.family(k); if(f) fams[f]=1; });
      Object.keys(fams).forEach(function(f){ if(!agg[f]) agg[f]={att:0,suc:0}; agg[f].att+=v.attempts.length; agg[f].suc+=s; });
    });
    var rows=Object.keys(agg).map(function(f){ return {k:f,att:agg[f].att,suc:agg[f].suc,rate:agg[f].att?agg[f].suc/agg[f].att:0}; })
      .sort(function(a,b){ return b.rate-a.rate || b.att-a.att; });
    return rows.length?rows:null;
  }
  /* Wilson 95% lower bound for a binomial rate — honest with small N */
  function wilsonLB(s,n){
    if(!n) return 0;
    var z=1.959964, ph=s/n, d=1+z*z/n;
    var c=(ph+z*z/(2*n))/d, m=z*Math.sqrt((ph*(1-ph)+z*z/(4*n))/n)/d;
    return Math.max(0,c-m);
  }
  function bonLine(succ,total){
    if(!total) return '<div class="hint" style="margin-top:8px">Log attempts to see the best-of-N estimate.</div>';
    var p=succ/total, lb=wilsonLB(succ,total);
    var bon= p>0 ? "~"+Math.max(1,Math.round(1/p))+" attempts / success" : "no success yet";
    return '<div class="hint" style="margin-top:8px">best-of-N: <b style="color:var(--fg-dim)">'+bon+
      '</b> · success rate 95% lower bound: <b style="color:var(--fg-dim)">'+Math.round(lb*100)+'%</b></div>';
  }
  function renderStats(){
    var p=activeProject(); if(!p) return;
    var all=collectAttempts(p);
    var counts={success:0,partial:0,refused:0,flagged:0,fail:0};
    all.forEach(function(x){ if(counts[x.a.result]!=null) counts[x.a.result]++; });
    var total=all.length, succ=counts.success;
    var bar= total ? RESULTS.filter(function(r){return counts[r]>0;}).map(function(r){
      return '<span style="width:'+(counts[r]/total*100).toFixed(2)+'%;background:var(--r-'+r+');opacity:.85;margin-right:1px" title="'+r+': '+counts[r]+'"></span>';
    }).join("") : "";
    els.funnel.innerHTML=
      '<div class="stat-grid">'+
        '<div class="statbox"><div class="n">'+total+'</div><div class="l">attempts</div></div>'+
        '<div class="statbox"><div class="n" style="color:var(--r-success)">'+succ+'</div><div class="l">successes</div></div>'+
        '<div class="statbox"><div class="n">'+pct(succ,total)+'%</div><div class="l">success rate</div></div>'+
        '<div class="statbox"><div class="n">'+p.variants.length+'</div><div class="l">variants</div></div>'+
      '</div>'+
      '<div class="barwrap">'+(bar||'<span style="width:100%"></span>')+'</div>'+
      '<div class="legend">'+RESULTS.map(function(r){ return '<span><i style="background:var(--r-'+r+')"></i>'+r+' '+counts[r]+'</span>'; }).join("")+'</div>'+
      bonLine(succ,total);

    var rows=aggregateGroups(p);
    els.groupTable.innerHTML= rows.length
      ? '<table class="st"><thead><tr><th>'+esc(spec.groupColLabel||"Strategy")+'</th><th class="num">Att</th><th class="num">Succ</th><th class="num">Rate</th></tr></thead><tbody>'+
        rows.map(function(r){ var t=tagInfo(r.k);
          return '<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:'+(t.approx?"var(--r-partial)":"var(--chip-"+t.hue+")")+'"></span>'+esc(t.label)+'</td>'+
            '<td class="num">'+r.att+'</td><td class="num">'+r.suc+'</td><td class="num">'+Math.round(r.rate*100)+'%</td></tr>'; }).join("")+
        '</tbody></table>'
      : '<div class="empty" style="padding:12px">'+esc(spec.groupEmptyHint||"Log attempts on tagged variants to see which family wins. (The control variant carries no tags.)")+'</div>';
    var fam=aggregateFamilies(p);
    if(fam){
      els.groupTable.innerHTML+='<div class="h-sec" style="margin-top:14px">By MLCommons family</div>'+
        '<table class="st"><thead><tr><th>Family</th><th class="num">Att</th><th class="num">Succ</th><th class="num">Rate</th></tr></thead><tbody>'+
        fam.map(function(r){ return '<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:var(--accent)"></span>'+esc(r.k)+'</td><td class="num">'+r.att+'</td><td class="num">'+r.suc+'</td><td class="num">'+Math.round(r.rate*100)+'%</td></tr>'; }).join("")+
        '</tbody></table>';
    }

    renderSpark(all);

    var recent=all.slice().reverse().slice(0,50);
    els.logWrap.innerHTML= recent.length
      ? '<div class="log">'+recent.map(function(x){
          return '<div class="logrow" data-jump="'+x.idx+'">'+
            '<span class="t">'+new Date(x.a.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})+'</span>'+
            '<span class="vn">#'+(x.idx+1)+'</span>'+
            '<span class="pill '+x.a.result+'">'+x.a.result+'</span>'+
            '<span class="nt">'+esc(x.a.note||"")+'</span></div>';
        }).join("")+'</div>'
      : '<div class="empty" style="padding:12px">No attempts logged yet.</div>';
    api.els("[data-jump]",els.logWrap).forEach(function(row){ row.onclick=function(){
      var idx=+row.dataset.jump, v=p.variants[idx];
      if(v){ switchTab("B"); selectVariant(v.id,true); }
    }; });
  }
  function renderSpark(all){
    var W=300,H=60,pad=4;
    if(!all.length){ els.sparkWrap.innerHTML='<div class="empty" style="padding:8px">—</div>'; return; }
    var cum=0, pts=all.map(function(x,i){ if(x.a.result==="success") cum++; return {i:i,cum:cum}; });
    var maxY=Math.max(1,cum), maxX=Math.max(1,all.length-1);
    var X=function(i){ return pad+(i/maxX)*(W-2*pad); };
    var Y=function(y){ return H-pad-(y/maxY)*(H-2*pad); };
    var line=pts.map(function(p,i){ return (i?"L":"M")+X(p.i).toFixed(1)+" "+Y(p.cum).toFixed(1); }).join(" ");
    var area=pts.length>1 ? "M"+X(0).toFixed(1)+" "+Y(0).toFixed(1)+" "+line.slice(1)+" L"+X(pts[pts.length-1].i).toFixed(1)+" "+Y(0).toFixed(1)+" Z" : "";
    var last=pts[pts.length-1];
    var dots=pts.filter(function(p,i){ return i>0 && p.cum>pts[i-1].cum; }).map(function(p){
      return '<circle cx="'+X(p.i).toFixed(1)+'" cy="'+Y(p.cum).toFixed(1)+'" r="2" fill="var(--r-success)"/>'; }).join("");
    els.sparkWrap.innerHTML='<svg class="spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" shape-rendering="geometricPrecision" role="img" aria-label="cumulative successes: '+cum+'">'+
      '<line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'" stroke="var(--line)" stroke-width="1"/>'+
      (area?'<path d="'+area+'" fill="var(--accent)" opacity="0.08"/>':"")+
      '<path d="'+line+'" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'+
      dots+'<circle cx="'+X(last.i).toFixed(1)+'" cy="'+Y(last.cum).toFixed(1)+'" r="2.5" fill="var(--accent)"/></svg>'+
      '<div class="hint" style="margin-top:2px">'+cum+' success over '+all.length+' attempts</div>';
  }

  /* ---------- Generate ---------- */
  function runGenerate(){
    var p=activeProject(); if(!p) return;
    commitFields();
    var base=p.basePayload||p.base||"";
    if(!base.trim()){ toast("Base payload is empty"); return; }
    var res=spec.generate(p, api);
    p.variants=res.variants; vUI.clear(); undoStack.length=0;
    selectedId=p.variants.length?p.variants[0].id:null;
    save(); renderVariants(); renderStats();
    if(res.note) toast(res.note);
    switchTab("B");
    return res;
  }

  /* ---------- Export / Import ---------- */
  function download(filename,text,type){
    try{
      var blob=new Blob([text],{type:type||"text/plain"});
      var url=URL.createObjectURL(blob);
      var a=document.createElement("a"); a.href=url; a.download=filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); },1000);
    }catch(e){
      openModal('<h2>Download blocked</h2><p class="hint">Copy the content below manually.</p><textarea class="input textarea" readonly>'+esc(text)+'</textarea><div class="actions"><button class="btn primary" id="dlx">Close</button></div>');
      setTimeout(function(){ var b=$("dlx"); if(b) b.onclick=closeModal; },20);
    }
  }
  function slug(s){ return (s||"project").replace(/[^\w.-]+/g,"_").slice(0,50); }
  function exportJSON(){ commitFields(); download(spec.id+"-export.json",JSON.stringify(state,null,2),"application/json"); toast("Exported JSON"); }
  function csvCell(s){ return '"'+String(s==null?"":s).replace(/"/g,'""')+'"'; }
  function exportCSV(){ commitFields(); var p=activeProject(); if(!p) return;
    var head=["variant","tags","text","attempts","success","partial","refused","flagged","fail","success_rate"];
    var lines=[head.join(",")];
    (p.variants||[]).forEach(function(v,i){
      var c={success:0,partial:0,refused:0,flagged:0,fail:0}; var at=v.attempts||[];
      at.forEach(function(a){ if(c[a.result]!=null) c[a.result]++; });
      var n=at.length;
      lines.push([ i+1, (v.tags&&v.tags.length?v.tags.join(" "):"control"), (v.text||"").replace(/\r?\n/g," "),
        n, c.success, c.partial, c.refused, c.flagged, c.fail, (n?Math.round(c.success/n*100):0)+"%" ].map(csvCell).join(","));
    });
    download(spec.id+"-variants-"+slug(p.name)+".csv", lines.join("\r\n"), "text/csv"); toast("Exported CSV");
  }

  function buildMarkdown(p){
    var all=collectAttempts(p);
    var counts={success:0,partial:0,refused:0,flagged:0,fail:0};
    all.forEach(function(x){ if(counts[x.a.result]!=null) counts[x.a.result]++; });
    var total=all.length, S=counts.success;
    var rows=aggregateGroups(p);
    var r=spec.report||{};
    var base=p.basePayload||p.base||"";
    var md="# "+(r.title||"Red-team report")+" — "+p.name+"\n\n";
    md+=(r.scenarioLabel||"Scenario")+": "+(p.scenario||"—")+"\n";
    md+="Model: "+(p.model||"—")+" (anonymized — identity not probed)\n";
    md+="Date: "+new Date().toISOString().slice(0,10)+"\n\n";
    md+="## Base payload\n\n```\n"+base+"\n```\n\n";
    md+="## Results\n\n- Total attempts: "+total+"\n- Successes: "+S+" (rate "+pct(S,total)+"%)\n";
    md+="- Breakdown: success "+counts.success+" · partial "+counts.partial+" · refused "+counts.refused+" · flagged "+counts.flagged+" · fail "+counts.fail+"\n\n";
    md+="## "+(r.groupTableTitle||"Success rate by strategy")+"\n\n| "+(r.groupColLabel||"Strategy")+" | Attempts | Successes | Rate |\n|---|---|---|---|\n";
    md+= rows.length ? rows.map(function(x){ return "| "+tagInfo(x.k).label+" | "+x.att+" | "+x.suc+" | "+Math.round(x.rate*100)+"% |"; }).join("\n")+"\n\n"
                     : "| — | 0 | 0 | 0% |\n\n";
    var fam=aggregateFamilies(p);
    if(fam){ md+="## Success rate by MLCommons family\n\n| Family | Attempts | Successes | Rate |\n|---|---|---|---|\n"+
      fam.map(function(x){ return "| "+x.k+" | "+x.att+" | "+x.suc+" | "+Math.round(x.rate*100)+"% |"; }).join("\n")+"\n\n"; }
    if(r.includeBestVariant!==false){
      var best=null;
      p.variants.forEach(function(v,idx){ if(v.attempts.length>=3){ var s=v.attempts.filter(function(a){return a.result==="success";}).length, rate=s/v.attempts.length;
        if(!best||rate>best.rate) best={idx:idx,v:v,rate:rate,s:s}; } });
      md+="## Best variant (highest success rate, ≥3 attempts)\n\n";
      if(best){ md+="```\n"+best.v.text+"\n```\nTags: "+(best.v.tags.length?best.v.tags.map(function(k){return tagInfo(k).label;}).join(", "):"control")+"  \nRate: "+best.s+"/"+best.v.attempts.length+" ("+Math.round(best.rate*100)+"%)\n\n"; }
      else md+="_No variant has ≥3 attempts yet._\n\n";
    }
    if(r.observationsField && p[r.observationsField]) md+="## Observations\n\n"+p[r.observationsField]+"\n\n";
    md+="## Full attempt log\n\n| # | time | "+(r.logTagsCol||"tags")+" | result | note |\n|---|---|---|---|---|\n";
    md+= all.length ? all.map(function(x,i){ return "| "+(i+1)+" | "+new Date(x.a.ts).toISOString().replace("T"," ").slice(0,19)+" | "+(x.v.tags.length?x.v.tags.join(" "):"control")+" | "+x.a.result+" | "+(x.a.note||"").replace(/\|/g,"\\|").replace(/\n/g," ")+" |"; }).join("\n")+"\n"
                     : "| — | — | — | — | — |\n";
    return md;
  }
  function exportMarkdown(){ commitFields(); var p=activeProject(); if(!p) return;
    download(spec.id+"-report-"+slug(p.name)+".md",buildMarkdown(p),"text/markdown"); toast("Exported Markdown report"); }

  function validateImport(obj){
    if(!obj||typeof obj!=="object") throw new Error("Not an object");
    if(!Array.isArray(obj.projects)) throw new Error("Missing projects[]");
    obj.projects.forEach(function(p,i){
      if(typeof p!=="object"||typeof p.id!=="string") throw new Error("Project "+i+" invalid");
      if(p.variants && !Array.isArray(p.variants)) throw new Error("Project "+i+" variants not an array");
    });
    return migrate(obj);
  }
  function doImport(file){
    var reader=new FileReader();
    reader.onload=function(){
      try{
        var merged=validateImport(JSON.parse(reader.result));
        openModal('<h2>Import JSON</h2><p class="hint" style="margin-top:0">'+merged.projects.length+' project(s) found. How should they be added?</p>'+
          '<div class="actions"><button class="btn" id="impCancel">Cancel</button><button class="btn" id="impMerge">Merge</button><button class="btn primary" id="impReplace">Replace all</button></div>');
        setTimeout(function(){
          $("impCancel").onclick=closeModal;
          $("impReplace").onclick=function(){ state=merged; selectedId=null; vUI.clear(); undoStack.length=0; save(); renderAll(); closeModal(); toast("Imported (replaced)"); };
          $("impMerge").onclick=function(){
            var existing={}; state.projects.forEach(function(p){ existing[p.id]=1; });
            merged.projects.forEach(function(p){ if(existing[p.id]) p.id=uuid(); state.projects.push(p); });
            save(); renderAll(); closeModal(); toast("Imported (merged "+merged.projects.length+")");
          };
        },30);
      }catch(e){
        openModal('<h2>Import failed</h2><p class="hint warn" style="margin-top:0">'+esc(e.message||"Invalid JSON")+'</p><div class="actions"><button class="btn primary" id="impErr">Close</button></div>');
        setTimeout(function(){ var b=$("impErr"); if(b) b.onclick=closeModal; },20);
      }
    };
    reader.onerror=function(){ toast("Could not read file"); };
    reader.readAsText(file);
  }

  /* ---------- theme / tabs / help / projects ---------- */
  function applyTheme(t){ document.documentElement.setAttribute("data-theme",t); state.settings.theme=t;
    try{ localStorage.setItem("b9.hub.theme",t); }catch(e){} save(); }
  function toggleTheme(){ applyTheme(state.settings.theme==="dark"?"light":"dark"); }
  function switchTab(t){
    activeTab=t;
    api.els(".tab",document).forEach(function(b){ b.classList.toggle("active",b.dataset.tab===t); });
    api.els(".pane",document).forEach(function(pn){ pn.classList.toggle("active",pn.dataset.pane===t); });
  }
  function showHelp(){
    var extra=(typeof spec.helpExtraRows==="function") ? spec.helpExtraRows() : "";
    openModal('<h2>Keyboard shortcuts</h2><p class="hint" style="margin-top:0">Inert while typing in a field. The loop: <b>c → 1 → c → 1 …</b></p>'+
      '<div class="khelp">'+
        '<kbd>c</kbd><span>Copy current variant</span>'+
        '<kbd>1</kbd><span>Log ✓ success (then advance)</span>'+
        '<kbd>2</kbd><span>Log ◐ partial</span>'+
        '<kbd>3</kbd><span>Log ⊘ refused</span>'+
        '<kbd>4</kbd><span>Log ⚑ flagged</span>'+
        '<kbd>0</kbd><span>Log ✗ fail</span>'+
        '<kbd>j</kbd><span>Next variant</span>'+
        '<kbd>k</kbd><span>Previous variant</span>'+
        '<kbd>u</kbd><span>Undo last logged attempt</span>'+
        '<kbd>?</kbd><span>This help</span>'+
      '</div>'+extra+
      '<div class="actions"><button class="btn primary" id="helpClose">Got it</button></div>');
    setTimeout(function(){ var b=$("helpClose"); if(b) b.onclick=closeModal; },20);
  }
  function showGuide(){
    if(!spec.guide){ showHelp(); return; }
    openModal('<div class="help-body">'+spec.guide+'</div><div class="actions"><button class="btn primary" id="guideClose">Close</button></div>');
    setTimeout(function(){ var b=$("guideClose"); if(b) b.onclick=closeModal; },20);
  }
  function renderProjectSelect(){
    els.projSelect.innerHTML=state.projects.map(function(p){
      return '<option value="'+p.id+'" '+(p.id===state.activeProjectId?"selected":"")+'>'+esc(p.name)+'</option>'; }).join("");
  }
  function switchProject(id){ commitFields(); state.activeProjectId=id; selectedId=null; vUI.clear(); undoStack.length=0; save(); renderAll(); }
  function doNewProject(){
    commitFields();
    var p=mkProject(spec.nextProjectName ? spec.nextProjectName(state.projects.length) : ("Scenario "+(state.projects.length+1)));
    state.projects.push(p); state.activeProjectId=p.id; selectedId=null; vUI.clear(); undoStack.length=0; save(); renderAll();
  }
  function doRenameProject(){
    var p=activeProject(); if(!p) return;
    openModal('<h2>Project</h2><label class="fld">Name</label><input class="input" id="pname" value="'+esc(p.name)+'">'+
      '<div class="actions"><button class="btn danger" id="delProj" style="margin-right:auto">Delete</button>'+
      '<button class="btn" id="cancelRn">Cancel</button><button class="btn primary" id="saveRn">Save</button></div>');
    setTimeout(function(){
      var nameI=$("pname"); if(nameI){ nameI.focus(); nameI.select(); }
      $("saveRn").onclick=function(){ p.name=($("pname").value.trim()||p.name); save(); renderProjectSelect(); closeModal(); };
      $("cancelRn").onclick=closeModal;
      $("delProj").onclick=function(){
        if(state.projects.length<=1){ toast("Can't delete the only project"); return; }
        if(!confirm('Delete project "'+p.name+'" and all its variants/attempts?')) return;
        state.projects=state.projects.filter(function(x){return x.id!==p.id;});
        state.activeProjectId=state.projects[0].id; selectedId=null; vUI.clear(); undoStack.length=0; save(); renderAll(); closeModal();
      };
    },30);
  }

  /* ---------- render-all / wiring / boot ---------- */
  function renderAll(){
    document.documentElement.setAttribute("data-theme",state.settings.theme||"light");
    renderProjectSelect(); renderPaneA(); renderVariants(); renderStats();
  }
  function bindTop(){
    els.projSelect.onchange=function(){ switchProject(els.projSelect.value); };
    $("newProjBtn").onclick=doNewProject;
    $("renameProjBtn").onclick=doRenameProject;
    $("themeBtn").onclick=toggleTheme;
    $("helpBtn").onclick=showHelp;
    if($("infoBtn")) $("infoBtn").onclick=showGuide;
    $("exportMdBtn").onclick=exportMarkdown;
    if($("exportCsvBtn")) $("exportCsvBtn").onclick=exportCSV;
    $("exportJsonBtn").onclick=exportJSON;
    $("importBtn").onclick=function(){ $("importFile").click(); };
    $("importFile").onchange=function(e){ if(e.target.files[0]) doImport(e.target.files[0]); e.target.value=""; };
    $("copyNextBtn").onclick=copyNextUntried;
    api.els(".tab",document).forEach(function(b){ b.onclick=function(){ switchTab(b.dataset.tab); }; });
  }
  function bindKeys(){
    document.addEventListener("keydown",function(e){
      if(e.key==="Escape"){ closeModal(); return; }
      var ae=document.activeElement, tag=(ae&&ae.tagName)||"";
      if(tag==="TEXTAREA"||tag==="INPUT"||tag==="SELECT"||(ae&&ae.isContentEditable)) return;
      if(e.metaKey||e.ctrlKey||e.altKey) return;
      if(els.modal.classList.contains("show")) return;
      var k=e.key;
      if(k==="?"){ e.preventDefault(); showHelp(); return; }
      if(k==="c"||k==="C"){ e.preventDefault(); if(selectedId) copyVariant(selectedId,null); return; }
      if(k==="j"||k==="J"){ e.preventDefault(); moveSel(1); return; }
      if(k==="k"||k==="K"){ e.preventDefault(); moveSel(-1); return; }
      if(k==="u"||k==="U"){ e.preventDefault(); undoLast(); return; }
      if(k in RESULT_KEYMAP){ e.preventDefault(); if(selectedId) logResult(selectedId,RESULT_KEYMAP[k]); return; }
    });
  }

  load();
  try{ var _bt=localStorage.getItem("b9.hub.theme"); if(_bt==="dark"||_bt==="light") state.settings.theme=_bt; }catch(e){}  // honor the shared platform theme
  renderAll(); bindTop(); bindKeys(); switchTab("A");
  if(spec.bannerText) showBanner(spec.bannerText,"info");
  if(window.B9ICON && spec.icon){
    var bi=document.getElementById("b9brandico"); if(bi) bi.innerHTML=window.B9ICON(spec.icon,{size:16});
    window.B9ICON.setFavicon(spec.icon);
  }
}

/* ----------------------------------------------------------------------------
   Export namespace
   ---------------------------------------------------------------------------- */
window.B9={
  util:{uuid:uuid,now:now,clamp:clamp,esc:esc,pct:pct,uniq:uniq,mulberry32:mulberry32,hashStr:hashStr,
    pick:pick,pickN:pickN,matchCase:matchCase,lowerFirst:lowerFirst,upperFirst:upperFirst,tokenize:tokenize},
  chipHue:chipHue, diffHTML:diffHTML, results:{list:RESULTS,label:RESULT_LABEL,keymap:RESULT_KEYMAP},
  generate:generate, mountTool:mountTool, MAX_VARIANTS:MAX_VARIANTS
};
})();
