/* ============================================================================
   B9 · kit.js — tiny shared helpers for standalone utility pages
   (Recon, Dossier, Sieve, Codec). Classic script, offline, exposes window.B9KIT.
   core.js is the tracker engine; kit.js is just plumbing for simple pages.
   ============================================================================ */
(function(){
"use strict";
function uuid(){
  try{ if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
  return "id-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
}
function now(){ return Date.now(); }
function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
function pct(n,d){ return d>0 ? Math.round(n/d*100) : 0; }
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }

function getJSON(key,fallback){
  try{ var raw=localStorage.getItem(key); return raw==null?fallback:JSON.parse(raw); }
  catch(e){ return fallback; }
}
function setJSON(key,obj){
  try{ localStorage.setItem(key,JSON.stringify(obj)); return true; }catch(e){ return false; }
}

/* multi-document store: each doc = {id,name,createdAt, ...tool fields} */
function Store(key,opts){
  opts=opts||{};
  var state=getJSON(key,null);
  if(!state || !Array.isArray(state.docs) || !state.docs.length){
    state={docs:[mk(opts.firstName||"Untitled")], activeId:null};
    state.activeId=state.docs[0].id;
    persist();
  }
  if(typeof opts.migrate==="function") state.docs.forEach(opts.migrate);
  if(!state.docs.some(function(d){return d.id===state.activeId;})) state.activeId=state.docs[0].id;
  function mk(name){ var d=(typeof opts.fresh==="function")?opts.fresh(name):{}; d.id=d.id||uuid(); d.name=d.name||name||"Untitled"; d.createdAt=d.createdAt||now(); return d; }
  function persist(){ return setJSON(key,state); }
  return {
    all:function(){ return state.docs; },
    active:function(){ return state.docs.find(function(d){return d.id===state.activeId;})||state.docs[0]; },
    activeId:function(){ return state.activeId; },
    setActive:function(id){ state.activeId=id; persist(); },
    add:function(name){ var d=mk(name); state.docs.push(d); state.activeId=d.id; persist(); return d; },
    rename:function(id,name){ var d=state.docs.find(function(x){return x.id===id;}); if(d){ d.name=name; persist(); } },
    remove:function(id){ if(state.docs.length<=1) return false; state.docs=state.docs.filter(function(x){return x.id!==id;}); if(state.activeId===id) state.activeId=state.docs[0].id; persist(); return true; },
    save:persist,
    replaceAll:function(docs,activeId){ state.docs=docs; state.activeId=activeId||docs[0].id; persist(); }
  };
}

/* ---- DOM conveniences (no-ops safe if element missing) ---- */
var toastT=null;
function toast(msg){
  var t=document.getElementById("toast"); if(!t) return;
  t.textContent=msg; t.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(function(){ t.classList.remove("show"); },1300);
}
function copy(text){
  function fb(){ try{ var ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.left="-9999px";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); toast("copied"); }catch(e){ toast("copy blocked"); } }
  try{ if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(function(){toast("copied");}).catch(fb); return; } }catch(e){}
  fb();
}
function download(filename,text,type){
  try{
    var blob=new Blob([text],{type:type||"text/plain"}), url=URL.createObjectURL(blob);
    var a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); },1000); toast("downloaded");
  }catch(e){ toast("download blocked — use copy"); }
}
function initTheme(btnId){
  var KEY="b9.hub.theme";
  try{ var t=localStorage.getItem(KEY); if(t) document.documentElement.setAttribute("data-theme",t); }catch(e){}
  var b=document.getElementById(btnId); if(!b) return;
  b.onclick=function(){ var c=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";
    document.documentElement.setAttribute("data-theme",c); try{ localStorage.setItem(KEY,c); }catch(e){} };
}

/* ---- help overlay: self-contained, accessible (Esc / backdrop close, focus restore) ---- */
function escHelp(e){ if(e.key==="Escape"||e.keyCode===27){ e.stopPropagation(); hideHelp(); } }
function hideHelp(){
  var m=document.getElementById("b9help"); if(!m) return;
  m.classList.remove("show"); document.removeEventListener("keydown",escHelp,true);
  try{ if(m._prev && m._prev.focus) m._prev.focus(); }catch(e){}
}
function help(title,bodyHTML){
  var m=document.getElementById("b9help");
  if(!m){
    m=document.createElement("div"); m.id="b9help"; m.className="modal";
    m.setAttribute("role","dialog"); m.setAttribute("aria-modal","true");
    m.innerHTML='<div class="box help-box"><div class="help-body"></div>'+
      '<div class="actions"><button class="btn primary" type="button" data-close>Close</button></div></div>';
    document.body.appendChild(m);
    m.addEventListener("click",function(e){ if(e.target===m || (e.target.getAttribute && e.target.getAttribute("data-close")!=null)) hideHelp(); });
  }
  m.setAttribute("aria-label",(title||"Help")+" — how to use");
  m.querySelector(".help-body").innerHTML='<h2>'+esc(title||"How to use")+'</h2>'+(bodyHTML||"");
  m._prev=document.activeElement; m.classList.add("show");
  var c=m.querySelector("[data-close]"); try{ if(c&&c.focus) c.focus(); }catch(e){}
  document.addEventListener("keydown",escHelp,true);
}
function helpButton(btnId,title,bodyHTML){ var b=document.getElementById(btnId); if(!b) return; b.setAttribute("aria-haspopup","dialog"); b.onclick=function(){ help(title,bodyHTML); }; }

window.B9KIT={uuid:uuid,now:now,clamp:clamp,pct:pct,esc:esc,getJSON:getJSON,setJSON:setJSON,Store:Store,toast:toast,copy:copy,download:download,initTheme:initTheme,help:help,hideHelp:hideHelp,helpButton:helpButton};
})();
