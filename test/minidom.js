/* Minimal, faithful-enough DOM for smoke-testing B9 tools in Node.
   Supports: innerHTML parse, id/class/attr/tag selectors (querySelector[All],
   closest, matches), dataset, classList, value/checked, events (click/change/
   input/keydown), textContent, style, localStorage, Blob capture, FileReader. */
"use strict";

function decodeEntities(s){
  return s.replace(/&(amp|lt|gt|quot|#39|#10|middot|rarr|larr|harr);/g,function(m,e){
    return {amp:"&",lt:"<",gt:">",quot:'"',"#39":"'","#10":"\n",middot:"·",rarr:"→",larr:"←",harr:"↔"}[e];
  });
}

var VOID={input:1,br:1,hr:1,img:1,meta:1,link:1,source:1,col:1,area:1,base:1,embed:1,param:1,track:1,wbr:1};

function TextNode(t){ this.nodeType=3; this.textContent=t; this.parentNode=null; }

function El(tag){
  this.nodeType=1; this.tagName=String(tag).toUpperCase(); this.attributes={}; this.childNodes=[];
  this.parentNode=null; this.style={}; this._value=undefined; this._checked=false;
  this._handlers={}; this.onclick=null; this.onchange=null; this.oninput=null; this.onkeydown=null;
  this.disabled=false; this.files=null;
}
Object.defineProperty(El.prototype,"id",{get:function(){return this.attributes.id||"";},set:function(v){this.attributes.id=v;}});
Object.defineProperty(El.prototype,"className",{get:function(){return this.attributes["class"]||"";},set:function(v){this.attributes["class"]=v;}});
Object.defineProperty(El.prototype,"value",{
  get:function(){ return this._value!=null?this._value:(this.attributes.value!=null?this.attributes.value:""); },
  set:function(v){ this._value=String(v); }});
Object.defineProperty(El.prototype,"checked",{get:function(){return this._checked;},set:function(v){this._checked=!!v;}});
Object.defineProperty(El.prototype,"offsetWidth",{get:function(){return 0;}});
Object.defineProperty(El.prototype,"isContentEditable",{get:function(){return false;}});
Object.defineProperty(El.prototype,"dataset",{get:function(){
  var ds={}; for(var k in this.attributes){ if(k.indexOf("data-")===0){
    var name=k.slice(5).replace(/-([a-z])/g,function(_,c){return c.toUpperCase();}); ds[name]=this.attributes[k];
  } } return ds; }});
El.prototype.classList={}; // replaced per-instance below via getter
Object.defineProperty(El.prototype,"classList",{get:function(){
  var self=this;
  function toks(){ return (self.attributes["class"]||"").split(/\s+/).filter(Boolean); }
  function set(a){ self.attributes["class"]=a.join(" "); }
  return {
    add:function(){ var t=toks(); for(var i=0;i<arguments.length;i++) if(t.indexOf(arguments[i])<0) t.push(arguments[i]); set(t); },
    remove:function(){ var t=toks(); for(var i=0;i<arguments.length;i++){ var x=t.indexOf(arguments[i]); if(x>=0) t.splice(x,1); } set(t); },
    toggle:function(c,f){ var t=toks(), has=t.indexOf(c)>=0, want=(f===undefined?!has:!!f); if(want&&!has)t.push(c); if(!want&&has)t.splice(t.indexOf(c),1); set(t); return want; },
    contains:function(c){ return toks().indexOf(c)>=0; }
  };
}});
El.prototype.getAttribute=function(n){ return this.attributes[n]!=null?this.attributes[n]:null; };
El.prototype.setAttribute=function(n,v){ this.attributes[n]=String(v); if(n==="value") this._value=String(v); };
El.prototype.removeAttribute=function(n){ delete this.attributes[n]; };
El.prototype.hasAttribute=function(n){ return n in this.attributes; };
El.prototype.appendChild=function(c){ c.parentNode=this; this.childNodes.push(c); return c; };
El.prototype.removeChild=function(c){ var i=this.childNodes.indexOf(c); if(i>=0) this.childNodes.splice(i,1); c.parentNode=null; return c; };
El.prototype.remove=function(){ if(this.parentNode) this.parentNode.removeChild(this); };
El.prototype.replaceChildren=function(){ this.childNodes=[]; };
El.prototype.addEventListener=function(t,fn){ (this._handlers[t]=this._handlers[t]||[]).push(fn); };
El.prototype.removeEventListener=function(t,fn){ var h=this._handlers[t]; if(h){ var i=h.indexOf(fn); if(i>=0) h.splice(i,1); } };
El.prototype.dispatch=function(type,ev){ ev=ev||{}; ev.type=type; ev.target=ev.target||this;
  if(!ev.preventDefault) ev.preventDefault=function(){};
  var on=this["on"+type]; if(typeof on==="function") on.call(this,ev);
  var h=this._handlers[type]||[]; h.slice().forEach(function(fn){ fn.call(this,ev); },this); };
El.prototype.click=function(){ this.dispatch("click",{target:this}); };
El.prototype.focus=function(){ doc.activeElement=this; };
El.prototype.select=function(){};
El.prototype.scrollIntoView=function(){};

Object.defineProperty(El.prototype,"textContent",{
  get:function(){ var s=""; (function walk(n){ n.childNodes&&n.childNodes.forEach(function(c){ if(c.nodeType===3) s+=c.textContent; else walk(c); }); })(this); return s; },
  set:function(v){ this.childNodes=[]; this.appendChild(new TextNode(String(v))); }
});
Object.defineProperty(El.prototype,"innerHTML",{
  get:function(){ return serialize(this); },
  set:function(html){ this.childNodes=[]; var frag=parseHTML(String(html)); frag.childNodes.forEach(function(c){ c.parentNode=this; this.childNodes.push(c); },this); }
});

function serialize(el){
  return el.childNodes.map(function(c){
    if(c.nodeType===3) return c.textContent;
    var a=""; for(var k in c.attributes) a+=" "+k+'="'+c.attributes[k]+'"';
    if(VOID[c.tagName.toLowerCase()]) return "<"+c.tagName.toLowerCase()+a+">";
    return "<"+c.tagName.toLowerCase()+a+">"+serialize(c)+"</"+c.tagName.toLowerCase()+">";
  }).join("");
}

function parseHTML(html){
  var root=new El("#frag"); var stack=[root];
  var re=/<!--[\s\S]*?-->|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  var m;
  while((m=re.exec(html))){
    if(m[0].indexOf("<!--")===0) continue;
    if(m[1]){ var tag=m[1].toUpperCase(); for(var i=stack.length-1;i>0;i--){ if(stack[i].tagName===tag){ stack.length=i; break; } } }
    else if(m[2]){
      var el=new El(m[2].toLowerCase()); parseAttrs(el,m[3]||"");
      stack[stack.length-1].appendChild(el);
      if(!m[4] && !VOID[el.tagName.toLowerCase()]) stack.push(el);
    } else if(m[5]!=null){
      var txt=decodeEntities(m[5]); if(txt.length) stack[stack.length-1].appendChild(new TextNode(txt));
    }
  }
  return root;
}
function parseAttrs(el,s){
  var re=/([\w:-]+)(?:\s*=\s*"([^"]*)")?/g, m;
  while((m=re.exec(s))){ if(!m[1]) continue; var name=m[1], val=m[2];
    if(val===undefined){ el.attributes[name]=""; if(name==="checked") el._checked=true; if(name==="disabled") el.disabled=true; }
    else { el.attributes[name]=decodeEntities(val); if(name==="value") el._value=decodeEntities(val); }
  }
}

/* ---- selectors (compound only: tag#id.cls[attr=val], no combinators) ---- */
function parseSelector(sel){
  var spec={tag:null,id:null,classes:[],attrs:[]}, re=/#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:(=)"?([^"\]]*)"?)?\]|([\w:-]+)/g, m;
  while((m=re.exec(sel))){
    if(m[1]) spec.id=m[1];
    else if(m[2]) spec.classes.push(m[2]);
    else if(m[3]) spec.attrs.push({name:m[3],op:m[4],val:m[5]});
    else if(m[6]) spec.tag=m[6].toLowerCase();
  }
  return spec;
}
function matchesSpec(el,spec){
  if(el.nodeType!==1) return false;
  if(spec.tag && el.tagName.toLowerCase()!==spec.tag) return false;
  if(spec.id && el.id!==spec.id) return false;
  for(var i=0;i<spec.classes.length;i++) if(!el.classList.contains(spec.classes[i])) return false;
  for(var j=0;j<spec.attrs.length;j++){ var a=spec.attrs[j];
    if(!el.hasAttribute(a.name)) return false;
    if(a.op==="=" && el.getAttribute(a.name)!==a.val) return false;
  }
  return true;
}
El.prototype.matches=function(sel){ return matchesSpec(this,parseSelector(sel)); };
function collect(el,spec,out,limit){
  for(var i=0;i<el.childNodes.length;i++){ var c=el.childNodes[i]; if(c.nodeType!==1) continue;
    if(matchesSpec(c,spec)){ out.push(c); if(limit && out.length>=limit) return; }
    collect(c,spec,out,limit); if(limit && out.length>=limit) return;
  }
}
El.prototype.querySelectorAll=function(sel){ var out=[]; collect(this,parseSelector(sel),out,0); return out; };
El.prototype.querySelector=function(sel){ var out=[]; collect(this,parseSelector(sel),out,1); return out[0]||null; };
El.prototype.closest=function(sel){ var spec=parseSelector(sel), n=this; while(n&&n.nodeType===1){ if(matchesSpec(n,spec)) return n; n=n.parentNode; } return null; };

/* ---- document / window / globals ---- */
var doc;
function makeDocument(){
  var htmlEl=new El("html"), bodyEl=new El("body"); htmlEl.appendChild(bodyEl);
  var appEl=new El("div"); appEl.setAttribute("id","app"); bodyEl.appendChild(appEl);
  var d={
    documentElement:htmlEl, body:bodyEl, title:"", activeElement:null, _handlers:{},
    getElementById:function(id){ var out=[]; collect(htmlEl,{tag:null,id:id,classes:[],attrs:[]},out,1); return out[0]||null; },
    createElement:function(t){ return new El(String(t).toLowerCase()); },
    querySelector:function(s){ return htmlEl.querySelector(s); },
    querySelectorAll:function(s){ return htmlEl.querySelectorAll(s); },
    addEventListener:function(t,fn){ (d._handlers[t]=d._handlers[t]||[]).push(fn); },
    execCommand:function(){ return true; },
    dispatchKey:function(key,opts){ opts=opts||{}; var ev={key:key,type:"keydown",preventDefault:function(){this.defaultPrevented=true;},defaultPrevented:false,metaKey:!!opts.metaKey,ctrlKey:!!opts.ctrlKey,altKey:!!opts.altKey,target:d.activeElement||bodyEl}; (d._handlers.keydown||[]).forEach(function(fn){ fn(ev); }); return ev; }
  };
  doc=d; return d;
}

function installGlobals(localStorageImpl){
  makeDocument();
  global.window=global;
  global.document=doc;
  Object.defineProperty(global,"navigator",{value:{clipboard:{writeText:function(t){ global.__copied=t; return Promise.resolve(); }}},configurable:true,writable:true});
  if(!global.crypto || !global.crypto.randomUUID)
    Object.defineProperty(global,"crypto",{value:{randomUUID:function(){ return "uuid-"+Math.random().toString(36).slice(2)+Date.now().toString(36); }},configurable:true,writable:true});
  global.confirm=function(){ return true; };
  global.alert=function(){};
  global.__lastBlob=null;
  global.Blob=function(parts){ this._text=(parts||[]).join(""); global.__lastBlob=this._text; };
  global.URL={createObjectURL:function(){ return "blob:x"; },revokeObjectURL:function(){}};
  global.FileReader=function(){ this.readAsText=function(file){ var self=this; this.result=file._text; setTimeout(function(){ if(self.onload) self.onload(); },0); }; };
  global.localStorage=localStorageImpl||makeLocalStorage();
}
function makeLocalStorage(){
  var map={};
  return {
    getItem:function(k){ return k in map?map[k]:null; },
    setItem:function(k,v){ map[k]=String(v); },
    removeItem:function(k){ delete map[k]; },
    _map:map, _throwing:false
  };
}

module.exports={El:El,parseHTML:parseHTML,installGlobals:installGlobals,makeDocument:makeDocument,makeLocalStorage:makeLocalStorage,get doc(){return doc;}};
