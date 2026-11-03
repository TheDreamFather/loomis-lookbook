/* ===================================================================
   planview.js — shared floor / room plan viewer + "Plans edit" markup.
   Used by index.html (whole-floor views) and isleworth.html (room views).

   Viewer (FV): FV.scale is relative to the plan image's natural pixel size;
   FV.fit shows the whole plan inside the visible area, FV.rfit shows the
   current room region (room view). Zoom range 0.8x whole-fit .. max(8, 2x fit,
   3x room-fit). Wheel, trackpad pinch (ctrl+wheel / Safari gesture events) and
   touch/pen pinch zoom toward the cursor / pinch centre; one pointer pans.

   Markup (PM): an overlay layer that is transformed together with the plan
   image. Items are stored per plan in D1 (plan_markups) as JSON with
   coordinates normalised 0..1 to the plan image:
     {t:'sym', k:legendId, x,y, s:label}   colour-coded legend symbol
     {t:'text', x,y, s, c:colour, z:size}  free text label
     {t:'note', x,y, s}                    sticky note
     {t:'room', x,y,w,h, room_id, name}    room region (drives room views)
   The plan image is never modified. Only team (admin/sales) can edit; the
   server enforces this too.
   =================================================================== */
const PM_ICONS={
  recessed:'<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  pendant:'<path d="M12 3v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6.5 15a5.5 5.5 0 0 1 11 0z" fill="currentColor"/><circle cx="12" cy="18.3" r="1.7" fill="currentColor"/>',
  sconce:'<path d="M7 4v16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M9 8h6l3 8H9z" fill="currentColor"/>',
  speaker:'<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  sub:'<rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  tv:'<rect x="3" y="5" width="18" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  wap:'<path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.5a7.5 7.5 0 0 1 11 0M9.5 15.5a3 3 0 0 1 5 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="18.5" r="1.6" fill="currentColor"/>',
  camera:'<path d="M3 8h3l2-3h8l2 3h3v11H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  keypad:'<rect x="6" y="3" width="12" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 8h5M9.5 12h5M9.5 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  motion:'<circle cx="6" cy="18" r="2.2" fill="currentColor"/><path d="M6 11a7 7 0 0 1 7 7M6 6a12 12 0 0 1 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  shade:'<path d="M3 5h18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M5 5v11h14V5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 16v3M15 16v3M9 19h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  outlet:'<rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 9v4M14.5 9v4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.2" fill="currentColor"/>',
  data:'<path d="M4 6h16l-8 13z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9.5v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  thermostat:'<path d="M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="17" r="1.8" fill="currentColor"/>',
  doorbell:'<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 20.5h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  rack:'<rect x="5" y="3" width="14" height="18" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8h8M8 12h8M8 16h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  fan:'<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 10c0-4 1-6 3-6s2 3-3 6zM14 12c4 0 6 1 6 3s-3 2-6-3zM12 14c0 4-1 6-3 6s-2-3 3-6zM10 12c-4 0-6-1-6-3s3-2 6 3z" fill="currentColor"/>',
  smoke:'<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>',
  lock:'<rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/>',
  star:'<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>',
  dot:'<circle cx="12" cy="12" r="5" fill="currentColor"/>',
  square:'<rect x="6" y="6" width="12" height="12" fill="currentColor"/>',
  diamond:'<path d="M12 3l9 9-9 9-9-9z" fill="currentColor"/>'
};
const PM_ICON_NAMES={recessed:'Recessed light',pendant:'Pendant',sconce:'Sconce',speaker:'Speaker',sub:'Subwoofer',tv:'TV',wap:'Wi-Fi AP',camera:'Camera',keypad:'Keypad',motion:'Motion sensor',shade:'Shade',outlet:'Outlet',data:'Data drop',thermostat:'Thermostat',doorbell:'Doorbell',rack:'Rack',fan:'Fan',smoke:'Smoke / CO',lock:'Lock',star:'Star',dot:'Dot',square:'Square',diamond:'Diamond'};
// Same rows as migrations/0001_plans_edit.sql — used only if the legend table isn't there yet.
const PM_DEFAULT_LEGEND=[['lg-recessed','Recessed light','#f2c14e','recessed'],['lg-pendant','Decorative / pendant','#e8913d','pendant'],['lg-speaker','In-ceiling speaker','#4aa3df','speaker'],['lg-sub','Subwoofer','#2e6fa8','sub'],['lg-tv','TV / display','#9b6cd6','tv'],['lg-wap','Wi-Fi access point','#31b6a6','wap'],['lg-camera','Camera','#e05a5a','camera'],['lg-keypad','Keypad / switch','#c9b27c','keypad'],['lg-motion','Motion / occupancy sensor','#f08bb4','motion'],['lg-shade','Motorized shade','#8fbf7f','shade'],['lg-outlet','Outlet','#ff8c42','outlet'],['lg-data','Data / network drop','#5ad1e6','data'],['lg-thermostat','Thermostat','#b3d465','thermostat'],['lg-doorbell','Video doorbell / intercom','#c78bf0','doorbell'],['lg-rack','Equipment rack','#a8a8a8','rack']].map((a,i)=>({id:a[0],name:a[1],color:a[2],icon:a[3],sort:(i+1)*10}));
const PM_TEXT_COLORS=['#c0392b','#1f5fbf','#1e8449','#111111','#d35400','#7d3c98'];

function pmEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function pmClamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function pmUid(){ return 'm'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
async function pmApi(path,opts={}){
  const h={'content-type':'application/json'};
  try{ const t=localStorage.getItem('lb_token'); if(t) h.authorization='Bearer '+t; }catch(e){}
  const r=await fetch('/api/'+path,{credentials:'include',cache:'no-store',...opts,headers:h,body:opts.body?JSON.stringify(opts.body):undefined});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){ const e=new Error(d.error||('Request failed ('+r.status+')')); e.status=r.status; e.data=d; throw e; }
  return d;
}
function pmFg(hex){ const n=parseInt(String(hex||'#888888').slice(1),16); const r=(n>>16)&255,g=(n>>8)&255,b=n&255; return (0.299*r+0.587*g+0.114*b)/255>0.6?'#16130d':'#ffffff'; }
function pmSymHTML(leg){
  leg=leg||{color:'#888888',icon:'dot',name:'(removed legend item)'};
  const ic=String(leg.icon||'dot');
  const inner=ic.indexOf('text:')===0?`<b>${pmEsc(ic.slice(5))}</b>`:`<svg viewBox="0 0 24 24" aria-hidden="true">${PM_ICONS[ic]||PM_ICONS.dot}</svg>`;
  return `<span class="pm-sym" style="background:${pmEsc(leg.color)};color:${pmFg(leg.color)}">${inner}</span>`;
}
function pmCurProject(){
  try{ if(typeof CUR_PID!=='undefined'&&CUR_PID) return CUR_PID; }catch(e){}
  try{ if(typeof PID!=='undefined'&&PID) return PID; }catch(e){}
  return null;
}

/* ---------------- CSS ---------------- */
(function pmInjectCSS(){
  const css=`
  .fv-ov{position:fixed;inset:0;background:rgba(8,8,6,.94);z-index:9999;display:none;align-items:center;justify-content:center;flex-direction:column;font-family:Lato,Helvetica,Arial,sans-serif}
  .fv-ov.on{display:flex}
  .fv-stage{position:relative;width:100%;height:100%;overflow:hidden;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}
  .fv-stage.drag{cursor:grabbing}
  .fv-ov.editing .fv-stage{cursor:default}
  .fv-ov.editing.tool-place .fv-stage{cursor:copy}
  .fv-ov.editing.tool-room .fv-stage{cursor:crosshair}
  .fv-layer{position:absolute;top:50%;left:50%;transform-origin:center;transform:translate(-50%,-50%) scale(1);will-change:transform;--inv:1}
  .fv-layer img{display:block;width:100%;height:100%;max-width:none;user-select:none;-webkit-user-drag:none;pointer-events:none}
  .fv-bar{position:absolute;top:14px;left:0;right:0;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;z-index:5;pointer-events:none;padding:0 10px}
  .fv-bar>*{pointer-events:auto}
  .fv-title{color:var(--gold-2,#cbb488);font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;background:rgba(15,14,11,.75);padding:7px 14px;border-radius:999px}
  .fv-btn{background:#0f0e0b;border:1px solid var(--gold,#b99a63);color:var(--gold-2,#cbb488);border-radius:8px;padding:7px 12px;font-size:14px;font-weight:700;cursor:pointer;min-height:36px;touch-action:manipulation;font-family:inherit}
  .fv-btn.fv-fit{background:var(--gold,#b99a63);color:#1a150c}
  .fv-btn.on{background:#3a2f18;color:#f3dfae}
  .fv-btn[hidden]{display:none}
  .fv-hint{position:absolute;bottom:16px;left:0;right:0;text-align:center;color:#8c8678;font-size:12px;z-index:3;pointer-events:none;padding:0 12px}
  .fv-ov.editing .fv-hint{display:none}
  /* markup overlay — symbols/labels keep a constant on-screen size (scale(var(--inv))) */
  .pm-layer{position:absolute;inset:0}
  .pm-it{position:absolute;transform:translate(-50%,-50%) scale(var(--inv));transform-origin:center;pointer-events:auto;touch-action:none}
  .pm-sym{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.35);box-sizing:border-box}
  .pm-sym svg{width:16px;height:16px;display:block}
  .pm-sym b{font-size:10.5px;font-weight:900;letter-spacing:-.02em;line-height:1}
  .pm-s{display:flex;flex-direction:column;align-items:center}
  .pm-s .pm-cap{position:absolute;top:28px;left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(255,255,255,.94);color:#16130d;border:1px solid rgba(0,0,0,.35);border-radius:4px;padding:0 4px;font-size:10.5px;font-weight:700;line-height:15px}
  .pm-t{white-space:pre-wrap;font-size:calc(13px * var(--z,1));font-weight:800;line-height:1.2;background:rgba(255,255,255,.92);border:1.5px solid currentColor;border-radius:5px;padding:2px 6px;max-width:260px;text-align:center}
  .pm-n{white-space:pre-wrap;font-size:12px;line-height:1.3;color:#3b3000;background:#fff3a6;border:1px solid #d8c24a;border-radius:3px;padding:6px 8px 6px 22px;max-width:220px;min-width:60px;box-shadow:0 3px 10px rgba(0,0,0,.3);text-align:left}
  .pm-n:before{content:"";position:absolute;left:7px;top:8px;width:8px;height:8px;border-radius:50%;background:#d9534f}
  .pm-it.sel .pm-sym,.pm-it.sel.pm-t,.pm-it.sel.pm-n{outline:2.5px solid #3da5ff;outline-offset:2px}
  .pm-room{position:absolute;border:calc(2px * var(--inv)) dashed rgba(61,165,255,.9);background:rgba(61,165,255,.06);pointer-events:none;box-sizing:border-box}
  .pm-room.sel{border-style:solid;background:rgba(61,165,255,.14)}
  .pm-room.unassigned{border-color:#e05a5a}
  .pm-rl{position:absolute;left:0;top:0;transform:scale(var(--inv));transform-origin:0 0;background:#3da5ff;color:#fff;font-size:11px;font-weight:800;padding:2px 7px;border-radius:0 0 6px 0;white-space:nowrap;pointer-events:auto;cursor:pointer;touch-action:none}
  .pm-room.unassigned .pm-rl{background:#e05a5a}
  .pm-rh{position:absolute;right:0;bottom:0;width:18px;height:18px;transform:translate(50%,50%) scale(var(--inv));background:#fff;border:2px solid #3da5ff;border-radius:4px;pointer-events:auto;cursor:nwse-resize;touch-action:none}
  .fv-ov:not(.editing) .pm-room{border-width:calc(1.5px * var(--inv));background:transparent}
  .fv-ov:not(.editing) .pm-rl{background:rgba(61,165,255,.85)}
  .fv-ov.roommode .pm-room{display:none}
  .pm-focus{position:absolute;pointer-events:none;box-shadow:0 0 0 200000px rgba(6,6,5,.6);outline:calc(2px * var(--inv)) solid #cbb488}
  .pm-draft{position:absolute;border:calc(2px * var(--inv)) solid #3da5ff;background:rgba(61,165,255,.18);pointer-events:none}
  /* edit panel (legend + tools) */
  .pm-panel{position:absolute;z-index:6;left:12px;top:64px;bottom:12px;width:262px;background:#141210;border:1px solid #2a2720;border-radius:12px;display:none;flex-direction:column;color:#efe9df;box-shadow:0 18px 50px rgba(0,0,0,.5);font-size:13px}
  .pm-panel.on{display:flex}
  .pm-ph{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #2a2720}
  .pm-ph b{color:#cbb488;letter-spacing:.08em;text-transform:uppercase;font-size:12px}
  .pm-status{margin-left:auto;font-size:11.5px;color:#9a9388;text-align:right}
  .pm-status.dirty{color:#f2c14e}.pm-status.ok{color:#8fbf7f}.pm-status.err{color:#e07a6a}
  .pm-tools{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid #2a2720}
  .pm-tb{background:#0f0e0b;border:1px solid #3a352a;color:#efe9df;border-radius:7px;padding:6px 9px;font-size:12.5px;font-weight:700;cursor:pointer;min-height:34px;font-family:inherit;touch-action:manipulation}
  .pm-tb.on{border-color:#3da5ff;background:#10263a;color:#cfe8ff}
  .pm-tb:disabled{opacity:.4;cursor:default}
  .pm-tb.primary{background:#b99a63;border-color:#b99a63;color:#1a150c}
  .pm-lh{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9a9388}
  .pm-lh button{background:none;border:0;color:#cbb488;font-weight:800;cursor:pointer;font-size:12px;font-family:inherit;letter-spacing:0;text-transform:none}
  .pm-leg{overflow:auto;flex:1;padding:2px 8px 8px}
  .pm-lg{display:flex;align-items:center;gap:9px;width:100%;background:none;border:1px solid transparent;border-radius:8px;color:#efe9df;padding:5px 6px;cursor:pointer;font-size:13px;text-align:left;font-family:inherit;touch-action:manipulation}
  .pm-lg:hover{background:#1c1a14}
  .pm-lg.on{border-color:#3da5ff;background:#10263a}
  .pm-lg .pm-sym{flex:0 0 auto}
  .pm-lg .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pm-lg .ct{font-size:11px;color:#9a9388}
  .pm-add{padding:8px 12px;border-top:1px solid #2a2720;display:none;gap:6px;flex-wrap:wrap}
  .pm-add.on{display:flex}
  .pm-add input,.pm-add select,.pm-insp input,.pm-insp select,.pm-insp textarea{background:#0f0e0b;border:1px solid #3a352a;color:#efe9df;border-radius:6px;padding:6px 7px;font-size:13px;font-family:inherit}
  .pm-add input[type=color]{padding:0;width:38px;height:32px}
  .pm-acts{display:flex;gap:6px;padding:10px 12px;border-top:1px solid #2a2720;flex-wrap:wrap;align-items:center}
  .pm-acts select{flex:1;min-width:0;background:#0f0e0b;border:1px solid #3a352a;color:#efe9df;border-radius:6px;padding:6px;font-size:12px}
  /* inspector for the selected item */
  .pm-insp{position:absolute;z-index:7;right:12px;top:64px;width:270px;background:#141210;border:1px solid #3da5ff;border-radius:12px;padding:11px 12px;color:#efe9df;display:none;flex-direction:column;gap:8px;box-shadow:0 18px 50px rgba(0,0,0,.5);font-size:13px}
  .pm-insp.on{display:flex}
  .pm-insp .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .pm-insp label{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#9a9388}
  .pm-insp textarea{min-height:56px;resize:vertical;width:100%;box-sizing:border-box}
  .pm-insp input[type=text],.pm-insp select{width:100%;box-sizing:border-box}
  .pm-sw{width:24px;height:24px;border-radius:50%;border:2px solid #333;cursor:pointer;padding:0}
  .pm-sw.on{border-color:#fff;box-shadow:0 0 0 2px #3da5ff}
  /* view-mode legend key */
  .pm-key{position:absolute;z-index:4;left:12px;bottom:42px;max-height:55%;overflow:auto;width:240px;background:rgba(20,18,16,.95);border:1px solid #2a2720;border-radius:12px;padding:8px;display:none;color:#efe9df}
  .pm-key.on{display:block}
  .pm-key .pm-kh{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9a9388;padding:2px 6px 6px}
  .pm-key .pm-lg{cursor:default}
  .pm-toast{position:absolute;z-index:8;left:50%;bottom:52px;transform:translateX(-50%);background:#141210;border:1px solid #b99a63;color:#efe9df;border-radius:10px;padding:8px 12px;font-size:13px;max-width:80vw;display:none}
  .pm-toast.on{display:block}
  @media (max-width:600px){
    .fv-bar{top:10px;gap:8px}
    .fv-title{order:-1;flex:0 0 100%;text-align:center;font-size:11.5px;padding:6px 10px;background:none}
    .fv-btn{min-height:44px;min-width:44px;font-size:15px;padding:8px 12px}
    .fv-hint{bottom:10px;font-size:11px}
    .pm-panel{left:0;right:0;top:auto;bottom:0;width:auto;max-height:46%;border-radius:14px 14px 0 0}
    .pm-leg{display:flex;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;gap:4px;flex:0 0 auto;padding:4px 8px}
    .pm-lg{flex:0 0 auto;width:auto;flex-direction:column;gap:3px;padding:5px 6px;max-width:82px}
    .pm-lg .nm{font-size:10.5px;white-space:normal;text-align:center;line-height:1.15;max-height:2.4em}
    .pm-lg .ct{display:none}
    .pm-tb{min-height:40px}
    .pm-insp{left:0;right:0;width:auto;top:auto;bottom:0;max-height:46%;overflow:auto;border-radius:14px 14px 0 0;z-index:9;box-sizing:border-box}
    .pm-key{left:8px;right:8px;width:auto;bottom:40px}
  }`;
  const s=document.createElement('style'); s.id='pmCSS'; s.textContent=css; document.head.appendChild(s);
})();

/* ---------------- viewer (zoom / pan / fit) ---------------- */
let FV={scale:1,x:0,y:0,fit:1,rfit:1,min:1,max:8,cx:0,cy:0,atFit:true,fitMode:'whole',nw:0,nh:0,ptrs:new Map(),pinch:null,pan:null,gs:1,region:null,tap:null};
function fvStageBox(){
  const st=document.getElementById('fvStage'); if(!st) return null;
  const r=st.getBoundingClientRect();
  const bar=document.querySelector('#fvOverlay .fv-bar'), hint=document.querySelector('#fvOverlay .fv-hint'), panel=document.querySelector('#fvOverlay .pm-panel.on');
  const top=bar?Math.max(0,bar.getBoundingClientRect().bottom-r.top)+8:12;
  let bot=(hint&&getComputedStyle(hint).display!=='none')?Math.max(0,r.bottom-hint.getBoundingClientRect().top)+8:12, left=12, right=12;
  if(panel){ const p=panel.getBoundingClientRect();
    if(p.width<r.width*0.6) left=Math.max(left,p.right-r.left+10); else bot=Math.max(bot,r.bottom-p.top+8); }
  return {r,top,bot,left,right,w:Math.max(40,r.width-left-right),h:Math.max(40,r.height-top-bot)};
}
function fvComputeFit(){
  const im=document.getElementById('fvImg'), b=fvStageBox();
  if(!im||!b||!im.naturalWidth) return false;
  FV.nw=im.naturalWidth; FV.nh=im.naturalHeight;
  FV.fit=Math.min(b.w/FV.nw,b.h/FV.nh);
  FV.cx=(b.left-b.right)/2; FV.cy=(b.top-b.bot)/2;     // offsets that center the plan in the visible area
  const R=FV.region;
  FV.rfit=R?Math.min(b.w/(FV.nw*R.w),b.h/(FV.nh*R.h)):FV.fit;
  FV.min=FV.fit*0.8;
  FV.max=Math.max(8,FV.fit*2,FV.rfit*3);
  return true;
}
function fvClampPan(){
  const b=fvStageBox(); if(!b||!FV.nw) return;
  const hw=FV.nw*FV.scale/2, hh=FV.nh*FV.scale/2, keep=60;   // keep at least 60px of plan on screen
  const mx=Math.max(0,b.r.width/2+hw-keep), my=Math.max(0,b.r.height/2+hh-keep);
  FV.x=Math.max(-mx,Math.min(mx,FV.x)); FV.y=Math.max(-my,Math.min(my,FV.y));
}
function fvApply(){
  const ly=document.getElementById('fvLayer'); if(!ly) return;
  if(FV.nw){ ly.style.width=FV.nw+'px'; ly.style.height=FV.nh+'px'; }
  ly.style.transform=`translate(calc(-50% + ${FV.x}px), calc(-50% + ${FV.y}px)) scale(${FV.scale})`;
  ly.style.setProperty('--inv',String(1/FV.scale));
}
/* Zoom by factor k toward client point (cx,cy); defaults to the stage center. */
function fvZoomAt(k,cx,cy){
  const st=document.getElementById('fvStage'); if(!st) return;
  const r=st.getBoundingClientRect();
  const px=(cx==null?r.left+r.width/2+FV.cx:cx)-(r.left+r.width/2), py=(cy==null?r.top+r.height/2+FV.cy:cy)-(r.top+r.height/2);
  const ns=Math.max(FV.min,Math.min(FV.max,FV.scale*k)); if(ns===FV.scale) return;
  const f=ns/FV.scale;
  FV.x=px-(px-FV.x)*f; FV.y=py-(py-FV.y)*f; FV.scale=ns; FV.atFit=false;
  if(ns<=FV.fit*1.001){ FV.x=FV.cx; FV.y=FV.cy; }   // at or below fit: keep the whole plan centered
  fvClampPan(); fvApply();
}
function fvZoom(dir){ fvZoomAt(dir>0?1.3:1/1.3); }
function fvCenterOn(u,v){ FV.x=FV.cx-(u-0.5)*FV.nw*FV.scale; FV.y=FV.cy-(v-0.5)*FV.nh*FV.scale; }
/* Fit: the room (room view) or the whole plan (floor view). */
function fvReset(){
  if(!fvComputeFit()) return;
  const R=FV.region;
  if(R){ FV.scale=FV.rfit; fvCenterOn(R.x+R.w/2,R.y+R.h/2); FV.fitMode='room'; }
  else { FV.scale=FV.fit; FV.x=FV.cx; FV.y=FV.cy; FV.fitMode='whole'; }
  FV.atFit=true; fvApply();
}
function fvFitWhole(){ if(!fvComputeFit()) return; FV.scale=FV.fit; FV.x=FV.cx; FV.y=FV.cy; FV.atFit=true; FV.fitMode='whole'; fvApply(); }
function fvOnResize(){
  const ov=document.getElementById('fvOverlay'); if(!ov||!ov.classList.contains('on')) return;
  if(FV.atFit||FV.scale<=FV.fit){ if(FV.fitMode==='whole'&&FV.region) fvFitWhole(); else fvReset(); return; }
  if(fvComputeFit()){ FV.scale=Math.max(FV.min,Math.min(FV.max,FV.scale)); fvClampPan(); fvApply(); }
}
function fvInitStage(stage){
  stage.addEventListener('wheel',e=>{
    e.preventDefault();
    let dy=e.deltaY; if(e.deltaMode===1) dy*=16; else if(e.deltaMode===2) dy*=stage.clientHeight;
    // ctrlKey = trackpad pinch on Chrome/Edge/Firefox (small continuous deltas); otherwise wheel/scroll.
    const k=Math.exp(-dy*(e.ctrlKey?0.01:0.0025));
    fvZoomAt(Math.max(0.5,Math.min(2,k)),e.clientX,e.clientY);
  },{passive:false});
  // Desktop Safari trackpad pinch arrives as gesture events (not ctrl+wheel).
  stage.addEventListener('gesturestart',e=>{e.preventDefault();FV.gs=1;});
  stage.addEventListener('gesturechange',e=>{e.preventDefault(); if(FV.ptrs.size>=2) return; fvZoomAt(e.scale/FV.gs,e.clientX,e.clientY); FV.gs=e.scale;});
  stage.addEventListener('gestureend',e=>{e.preventDefault();});
  stage.addEventListener('dragstart',e=>e.preventDefault());
  const startPinch=()=>{ const [a,b]=[...FV.ptrs.values()]; FV.pinch={d:Math.hypot(b.x-a.x,b.y-a.y)||1,mx:(a.x+b.x)/2,my:(a.y+b.y)/2}; FV.pan=null; };
  stage.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0) return;
    try{stage.setPointerCapture(e.pointerId);}catch(_){}
    if(PM.drag||PM.draw){ pmGestureToPinch(); }                       // 2nd finger during an edit drag -> pinch
    else if(FV.ptrs.size===0&&pmPointerDown(e)) return;               // edit mode: grab an item / draw a room box
    FV.ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(FV.ptrs.size===1){ FV.pan={sx:e.clientX-FV.x,sy:e.clientY-FV.y}; FV.tap={id:e.pointerId,x:e.clientX,y:e.clientY,t:Date.now()}; stage.classList.add('drag'); }
    else { FV.tap=null; if(FV.ptrs.size===2) startPinch(); }
  });
  stage.addEventListener('pointermove',e=>{
    if(pmGestureMove(e)) return;
    if(!FV.ptrs.has(e.pointerId)) return;
    FV.ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(FV.tap&&FV.tap.id===e.pointerId&&Math.hypot(e.clientX-FV.tap.x,e.clientY-FV.tap.y)>6) FV.tap=null;
    if(FV.ptrs.size>=2&&FV.pinch){
      const [a,b]=[...FV.ptrs.values()];
      const d=Math.hypot(b.x-a.x,b.y-a.y)||1, mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
      FV.x+=mx-FV.pinch.mx; FV.y+=my-FV.pinch.my; FV.atFit=false;   // two-finger drag pans
      fvZoomAt(d/FV.pinch.d,mx,my); fvClampPan(); fvApply();
      FV.pinch={d,mx,my};
    } else if(FV.pan){
      FV.x=e.clientX-FV.pan.sx; FV.y=e.clientY-FV.pan.sy; FV.atFit=false; fvClampPan(); fvApply();
    }
  });
  const end=e=>{
    if(pmGestureEnd(e)) return;
    if(!FV.ptrs.delete(e.pointerId)) return;
    const tap=FV.tap; FV.tap=null;
    if(FV.ptrs.size===1){ const p=[...FV.ptrs.values()][0]; FV.pinch=null; FV.pan={sx:p.x-FV.x,sy:p.y-FV.y}; }
    else if(FV.ptrs.size===0){ FV.pinch=null; FV.pan=null; stage.classList.remove('drag');
      if(tap&&tap.id===e.pointerId&&e.type==='pointerup'&&Date.now()-tap.t<700) pmTap(e.clientX,e.clientY,e); }
  };
  stage.addEventListener('pointerup',end); stage.addEventListener('pointercancel',end); stage.addEventListener('lostpointercapture',end);
  window.addEventListener('resize',fvOnResize);
  window.addEventListener('orientationchange',()=>setTimeout(fvOnResize,150));
}
function fvBuildOverlay(){
  let ov=document.getElementById('fvOverlay'); if(ov) return ov;
  ov=document.createElement('div'); ov.id='fvOverlay'; ov.className='fv-ov';
  ov.innerHTML=`<div class="fv-bar"><button class="fv-btn" onclick="fvZoom(-1)" aria-label="Zoom out">&minus;</button>
      <span class="fv-title" id="fvTitle"></span><button class="fv-btn" onclick="fvZoom(1)" aria-label="Zoom in">+</button>
      <button class="fv-btn fv-fit" id="fvFitBtn" onclick="fvReset()">&#x2922; Fit whole plan</button>
      <button class="fv-btn" id="fvWholeBtn" onclick="fvFitWhole()" hidden>&#x25A3; Whole floor</button>
      <button class="fv-btn" id="pmKeyBtn" onclick="pmToggleKey()" hidden>Legend</button>
      <button class="fv-btn" id="pmEditBtn" onclick="pmStartEdit()" hidden>&#x270E; Plans edit</button>
      <button class="fv-btn" id="fvCloseBtn" onclick="closeFloorView()">&times; Close</button></div>
    <div class="fv-stage" id="fvStage"><div class="fv-layer" id="fvLayer"><img id="fvImg" alt="" draggable="false"><div class="pm-layer" id="pmLayer"></div></div></div>
    <div class="fv-hint" id="fvHint">Scroll, pinch or +/&minus; to zoom · drag to pan · Esc to close</div>
    <div class="pm-panel" id="pmPanel"></div>
    <div class="pm-insp" id="pmInsp"></div>
    <div class="pm-key" id="pmKey"></div>
    <div class="pm-toast" id="pmToast"></div>`;
  document.body.appendChild(ov);
  fvInitStage(ov.querySelector('#fvStage'));
  ov.addEventListener('click',e=>{if(e.target===ov)closeFloorView();});
  window.addEventListener('keydown',pmKeydown);
  return ov;
}
/* openFloorView(img, label[, opts])
   opts.project   — project id (defaults to the page's current project)
   opts.planLabel — the floor's name (defaults to label)
   opts.room      — {id, name, region:{x,y,w,h}} opens a ROOM view: fits the room,
                    can zoom out to the whole floor, shows the saved markup. */
function openFloorView(img,label,opts){
  opts=opts||{};
  const ov=fvBuildOverlay();
  if(PM.edit) pmEndEdit(true);
  const proj=opts.project||pmCurProject(); if(proj!==PM.project) PM.rooms=null;
  PM.project=proj; PM.plan=img; PM.label=opts.planLabel||label||'';
  PM.room=opts.room||null; FV.region=PM.room&&PM.room.region?PM.room.region:null;
  ov.classList.toggle('roommode',!!FV.region);
  document.getElementById('fvTitle').textContent=label||'Floor plan';
  document.getElementById('fvFitBtn').innerHTML=FV.region?'&#x2922; Fit room':'&#x2922; Fit whole plan';
  document.getElementById('fvWholeBtn').hidden=!FV.region;
  document.getElementById('pmEditBtn').hidden=true;
  document.getElementById('pmKeyBtn').hidden=true;
  document.getElementById('pmKey').classList.remove('on');
  document.getElementById('fvHint').innerHTML=FV.region?'Fit shows the room · zoom out or “Whole floor” to see the whole plan · drag to pan · Esc to close':'Scroll, pinch or +/&minus; to zoom · drag to pan · Esc to close';
  const im=document.getElementById('fvImg');
  FV.ptrs.clear(); FV.pinch=null; FV.pan=null; FV.nw=0; FV.tap=null;
  PM.data={items:[]}; PM.version=0; PM.sel=null; pmRender();
  im.onload=()=>{ im.style.opacity=''; fvReset(); };
  ov.classList.add('on');
  if(im.getAttribute('src')===img&&im.complete&&im.naturalWidth) fvReset(); else { im.style.opacity='0'; im.src=img; }
  pmLoad();
}
function closeFloorView(){
  if(PM.edit){ if(PM.dirty&&!confirm('Discard unsaved plan markup changes?')) return; pmEndEdit(true); }
  const ov=document.getElementById('fvOverlay'); if(ov) ov.classList.remove('on');
}

/* ---------------- markup state ---------------- */
const PM={project:null,plan:null,label:'',room:null,legend:[],lmap:{},legendReady:null,notMigrated:false,
  data:{items:[]},saved:'{"items":[]}',version:0,canEdit:false,history:[],edit:false,tool:'select',sel:null,dirty:false,
  undo:[],redo:[],rooms:null,drag:null,draw:null,loadSeq:0,keyOpen:false};
async function pmEnsureLegend(force){
  if(PM.legendReady&&!force) return PM.legendReady;
  PM.legendReady=(async()=>{
    try{ const d=await pmApi('plans/legend'); PM.legend=d.items||[]; PM.notMigrated=false; }
    catch(e){ PM.legend=PM_DEFAULT_LEGEND.slice(); PM.notMigrated=!!(e.data&&e.data.not_migrated); }
    PM.lmap={}; PM.legend.forEach(l=>PM.lmap[l.id]=l);
    PM_DEFAULT_LEGEND.forEach(l=>{ if(!PM.lmap[l.id]) PM.lmap[l.id]=l; });   // symbols from a removed item still draw
  })();
  return PM.legendReady;
}
async function pmLoad(){
  const seq=++PM.loadSeq;
  await pmEnsureLegend();
  if(!PM.project||seq!==PM.loadSeq) return;
  try{
    const d=await pmApi('plans/markup?project='+encodeURIComponent(PM.project)+'&plan='+encodeURIComponent(PM.plan));
    if(seq!==PM.loadSeq) return;
    PM.data=d.markup&&d.markup.data?d.markup.data:{items:[]}; PM.version=d.markup?d.markup.version:0;
    PM.history=d.history||[]; PM.canEdit=!!d.can_edit; PM.meta=d.markup?{at:d.markup.updated_at,by:d.markup.updated_by}:null;
  }catch(e){ if(seq!==PM.loadSeq) return; PM.data={items:[]}; PM.version=0; PM.canEdit=false; PM.notMigrated=PM.notMigrated||!!(e.data&&e.data.not_migrated); }
  PM.saved=JSON.stringify(PM.data);
  document.getElementById('pmEditBtn').hidden=!(PM.canEdit&&!FV.region);
  document.getElementById('pmKeyBtn').hidden=!pmCounts(PM.data.items).length;
  pmRender(); pmRenderKey();
}
function pmItem(id){ return (PM.data.items||[]).find(i=>i.id===id); }
function pmInRegion(it,R){ return !R||(it.x>=R.x&&it.x<=R.x+R.w&&it.y>=R.y&&it.y<=R.y+R.h); }
function pmCounts(items,R){
  const c={}; (items||[]).forEach(it=>{ if(it.t==='sym'&&pmInRegion(it,R)) c[it.k]=(c[it.k]||0)+1; });
  return Object.keys(c).map(k=>({leg:PM.lmap[k]||{id:k,name:'(removed)',color:'#888888',icon:'dot'},n:c[k]})).sort((a,b)=>(a.leg.sort||0)-(b.leg.sort||0));
}
function pmRoomName(it){
  if(it.room_id&&PM.rooms){ const r=PM.rooms.find(x=>x.id===it.room_id); if(r) return r.name; }
  return it.name||'';
}
function pmItemHTML(it){
  const sel=PM.edit&&PM.sel===it.id?' sel':'';
  const pos=`left:${(it.x*100).toFixed(4)}%;top:${(it.y*100).toFixed(4)}%`;
  if(it.t==='sym'){ const l=PM.lmap[it.k];
    return `<div class="pm-it pm-s${sel}" data-id="${pmEsc(it.id)}" style="${pos}" title="${pmEsc((l?l.name:'Symbol')+(it.s?' — '+it.s:''))}">${pmSymHTML(l)}${it.s?`<span class="pm-cap">${pmEsc(it.s)}</span>`:''}</div>`; }
  if(it.t==='text') return `<div class="pm-it pm-t${sel}" data-id="${pmEsc(it.id)}" style="${pos};color:${pmEsc(it.c||'#c0392b')};--z:${Number(it.z)||1}">${pmEsc(it.s)}</div>`;
  if(it.t==='note') return `<div class="pm-it pm-n${sel}" data-id="${pmEsc(it.id)}" style="${pos}">${pmEsc(it.s)}</div>`;
  if(it.t==='room'){ const nm=pmRoomName(it);
    return `<div class="pm-room${sel}${it.room_id||it.name?'':' unassigned'}" data-rid="${pmEsc(it.id)}" style="left:${it.x*100}%;top:${it.y*100}%;width:${it.w*100}%;height:${it.h*100}%">
      <span class="pm-rl" data-id="${pmEsc(it.id)}">${pmEsc(nm||'Unassigned room')}</span>${PM.edit?`<span class="pm-rh" data-id="${pmEsc(it.id)}" data-h="1"></span>`:''}</div>`; }
  return '';
}
function pmRender(){
  const ly=document.getElementById('pmLayer'); if(!ly) return;
  const items=PM.data.items||[];
  // rooms underneath, then notes/text, then symbols on top
  const order={room:0,note:1,text:2,sym:3};
  let html=items.slice().sort((a,b)=>(order[a.t]||0)-(order[b.t]||0)).map(pmItemHTML).join('');
  const R=FV.region; if(R) html+=`<div class="pm-focus" style="left:${R.x*100}%;top:${R.y*100}%;width:${R.w*100}%;height:${R.h*100}%"></div>`;
  if(PM.draw&&PM.draw.rect){ const d=PM.draw.rect; html+=`<div class="pm-draft" style="left:${d.x*100}%;top:${d.y*100}%;width:${d.w*100}%;height:${d.h*100}%"></div>`; }
  ly.innerHTML=html;
}
function pmPlaceEl(it){
  if(it.t==='room'){ const el=document.querySelector(`#pmLayer [data-rid="${CSS.escape(it.id)}"]`); if(!el) return pmRender();
    el.style.left=it.x*100+'%'; el.style.top=it.y*100+'%'; el.style.width=it.w*100+'%'; el.style.height=it.h*100+'%'; return; }
  const el=document.querySelector(`#pmLayer .pm-it[data-id="${CSS.escape(it.id)}"]`); if(!el) return pmRender();
  el.style.left=it.x*100+'%'; el.style.top=it.y*100+'%';
}
function pmNorm(cx,cy){ const r=document.getElementById('fvLayer').getBoundingClientRect(); return {u:(cx-r.left)/r.width,v:(cy-r.top)/r.height}; }
function pmToast(html,ms){ const t=document.getElementById('pmToast'); if(!t) return; t.innerHTML=html; t.classList.add('on'); clearTimeout(pmToast._t); pmToast._t=setTimeout(()=>t.classList.remove('on'),ms||2600); }
function pmToggleKey(){ PM.keyOpen=!PM.keyOpen; pmRenderKey(); }
function pmRenderKey(){
  const k=document.getElementById('pmKey'); if(!k) return;
  const counts=pmCounts(PM.data.items,FV.region);
  document.getElementById('pmKeyBtn').classList.toggle('on',PM.keyOpen);
  k.classList.toggle('on',PM.keyOpen&&!PM.edit&&counts.length>0);
  k.innerHTML=`<div class="pm-kh">Legend${FV.region?' · this room':''}</div>`+(counts.map(c=>`<div class="pm-lg">${pmSymHTML(c.leg)}<span class="nm">${pmEsc(c.leg.name)}</span><span class="ct">${c.n}</span></div>`).join('')||'<div class="pm-kh">No symbols here yet</div>');
}

/* ---------------- edit mode ---------------- */
async function pmStartEdit(){
  if(!PM.canEdit||FV.region) return;
  if(PM.notMigrated){ alert('Plans edit is not set up on this database yet — run migrations/0001_plans_edit.sql.'); return; }
  PM.edit=true; PM.tool='select'; PM.sel=null; PM.undo=[]; PM.redo=[]; PM.dirty=false; PM.keyOpen=false;
  const ov=document.getElementById('fvOverlay'); ov.classList.add('editing');
  document.getElementById('pmEditBtn').hidden=true; document.getElementById('pmKeyBtn').hidden=true;
  pmRenderPanel(); pmRender(); pmRenderKey(); pmRenderInsp();
  const wasFit=FV.atFit; if(wasFit) fvReset(); else fvOnResize();
  if(!PM.rooms){ try{ PM.rooms=(await pmApi('scope?project='+encodeURIComponent(PM.project))).rooms||[]; }catch(e){ PM.rooms=[]; } pmRender(); }
}
function pmEndEdit(discard){
  if(discard&&PM.dirty){ try{ PM.data=JSON.parse(PM.saved); }catch(e){} }
  PM.edit=false; PM.sel=null; PM.drag=null; PM.draw=null; PM.dirty=false;
  const ov=document.getElementById('fvOverlay'); if(!ov) return;
  ov.classList.remove('editing','tool-place','tool-room');
  document.getElementById('pmPanel').classList.remove('on'); document.getElementById('pmInsp').classList.remove('on');
  document.getElementById('pmEditBtn').hidden=!(PM.canEdit&&!FV.region);
  document.getElementById('pmKeyBtn').hidden=!pmCounts(PM.data.items).length;
  pmRender(); pmRenderKey();
  if(FV.atFit) fvReset(); else fvOnResize();
}
function pmDone(){ if(PM.dirty&&!confirm('You have unsaved changes. Leave Plans edit and discard them?')) return; pmEndEdit(true); }
function pmSetTool(t){
  PM.tool=t; const ov=document.getElementById('fvOverlay');
  ov.classList.toggle('tool-place',t.indexOf('sym:')===0||t==='text'||t==='note'); ov.classList.toggle('tool-room',t==='room');
  pmRenderPanel();
}
function pmSnapshot(){ PM.undo.push(JSON.stringify(PM.data)); if(PM.undo.length>60) PM.undo.shift(); PM.redo=[]; }
function pmChanged(){ PM.dirty=JSON.stringify(PM.data)!==PM.saved; pmStatus(); pmUpdateCounts(); }
function pmUndo(){ if(!PM.undo.length) return; PM.redo.push(JSON.stringify(PM.data)); PM.data=JSON.parse(PM.undo.pop()); if(PM.sel&&!pmItem(PM.sel)) PM.sel=null; pmRender(); pmRenderInsp(); pmChanged(); pmRenderPanel(); }
function pmRedo(){ if(!PM.redo.length) return; PM.undo.push(JSON.stringify(PM.data)); PM.data=JSON.parse(PM.redo.pop()); if(PM.sel&&!pmItem(PM.sel)) PM.sel=null; pmRender(); pmRenderInsp(); pmChanged(); pmRenderPanel(); }
function pmStatus(msg,cls){
  const s=document.getElementById('pmStatus'); if(!s) return;
  if(msg!=null){ s.textContent=msg; s.className='pm-status '+(cls||''); return; }
  if(PM.dirty){ s.textContent='Unsaved changes'; s.className='pm-status dirty'; }
  else { s.textContent=PM.version?('Saved · v'+PM.version):'Not saved yet'; s.className='pm-status'; }
  const u=document.getElementById('pmUndo'), r=document.getElementById('pmRedo'), sv=document.getElementById('pmSave');
  if(u) u.disabled=!PM.undo.length; if(r) r.disabled=!PM.redo.length; if(sv) sv.disabled=!PM.dirty;
}
function pmUpdateCounts(){ const c={}; (PM.data.items||[]).forEach(it=>{ if(it.t==='sym') c[it.k]=(c[it.k]||0)+1; });
  document.querySelectorAll('#pmPanel .pm-lg[data-k]').forEach(b=>{ const ct=b.querySelector('.ct'); if(ct) ct.textContent=c[b.dataset.k]||''; }); }
function pmRenderPanel(){
  const p=document.getElementById('pmPanel'); if(!p) return;
  p.classList.add('on');
  const T=(t,lbl,title)=>`<button class="pm-tb${PM.tool===t?' on':''}" data-tool="${t}" title="${title||''}">${lbl}</button>`;
  const hist=(PM.history||[]).map(h=>`<option value="${h.version}">v${h.version} · ${pmEsc(new Date(h.saved_at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))}</option>`).join('');
  p.innerHTML=`<div class="pm-ph"><b>Plans edit</b><span class="pm-status" id="pmStatus"></span></div>
    <div class="pm-tools">${T('select','&#x2196; Select / move','Select, drag to move')}${T('text','T&nbsp;Text','Tap the plan to add a text label')}${T('note','&#x1F5C8; Note','Tap the plan to add a note')}${T('room','&#x25AD; Room box','Drag a box around a room, then pick the room')}
      <button class="pm-tb" id="pmUndo" onclick="pmUndo()" title="Undo (Ctrl+Z)">&#x21B6;</button><button class="pm-tb" id="pmRedo" onclick="pmRedo()" title="Redo">&#x21B7;</button></div>
    <div class="pm-lh"><span>Legend · tap, then tap the plan</span><button onclick="pmToggleAdd()">+ Add</button></div>
    <div class="pm-leg">${PM.legend.map(l=>`<button class="pm-lg${PM.tool==='sym:'+l.id?' on':''}" data-k="${pmEsc(l.id)}" title="${pmEsc(l.name)}">${pmSymHTML(l)}<span class="nm">${pmEsc(l.name)}</span><span class="ct"></span></button>`).join('')}</div>
    <div class="pm-add" id="pmAdd"><input id="pmAddName" placeholder="Legend name (e.g. Ceiling fan)" style="flex:1 1 100%">
      <input type="color" id="pmAddColor" value="#4aa3df" title="Colour"><select id="pmAddIcon" style="flex:1">${Object.keys(PM_ICONS).map(k=>`<option value="${k}">${PM_ICON_NAMES[k]||k}</option>`).join('')}<option value="text">Letters…</option></select>
      <input id="pmAddLetters" placeholder="AB" maxlength="3" style="width:52px;display:none">
      <button class="pm-tb primary" onclick="pmAddLegend()">Add to legend</button></div>
    <div class="pm-acts">${hist?`<select id="pmHist"><option value="">History…</option>${hist}</select><button class="pm-tb" onclick="pmRestore()" title="Restore the chosen version">Restore</button>`:''}
      <span style="flex:1"></span><button class="pm-tb" onclick="pmDone()">Done</button><button class="pm-tb primary" id="pmSave" onclick="pmSave()">Save</button></div>`;
  p.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>pmSetTool(b.dataset.tool));
  p.querySelectorAll('.pm-lg[data-k]').forEach(b=>b.onclick=()=>pmSetTool(PM.tool==='sym:'+b.dataset.k?'select':'sym:'+b.dataset.k));
  const ic=document.getElementById('pmAddIcon'); if(ic) ic.onchange=()=>{ document.getElementById('pmAddLetters').style.display=ic.value==='text'?'':'none'; };
  pmStatus(); pmUpdateCounts();
}
function pmToggleAdd(){ const a=document.getElementById('pmAdd'); if(a){ a.classList.toggle('on'); if(a.classList.contains('on')) document.getElementById('pmAddName').focus(); } }
async function pmAddLegend(){
  const name=document.getElementById('pmAddName').value.trim(); if(!name){ alert('Give the legend item a name.'); return; }
  let icon=document.getElementById('pmAddIcon').value;
  if(icon==='text'){ const l=document.getElementById('pmAddLetters').value.trim().toUpperCase(); if(!l){ alert('Type 1–3 letters for the badge.'); return; } icon='text:'+l; }
  try{ const r=await pmApi('plans/legend',{method:'POST',body:{name,color:document.getElementById('pmAddColor').value,icon}});
    await pmEnsureLegend(true); pmSetTool('sym:'+r.id); pmStatus('Added “'+name+'” to the legend','ok'); }
  catch(e){ alert(e.message); }
}
function pmAddItem(it){ pmSnapshot(); PM.data.items=PM.data.items||[]; PM.data.items.push(it); PM.sel=it.id; pmRender(); pmRenderInsp(); pmChanged(); }
function pmDelete(id){ id=id||PM.sel; if(!id) return; pmSnapshot(); PM.data.items=PM.data.items.filter(i=>i.id!==id); if(PM.sel===id) PM.sel=null; pmRender(); pmRenderInsp(); pmChanged(); }
function pmSelect(id){
  const prev=PM.sel?pmItem(PM.sel):null;
  if(prev&&prev.id!==id&&(prev.t==='text'||prev.t==='note')&&!String(prev.s||'').trim()){ PM.data.items=PM.data.items.filter(i=>i!==prev); pmChanged(); }   // drop empty labels
  PM.sel=id||null; pmRender(); pmRenderInsp();
}
function pmRenderInsp(){
  const box=document.getElementById('pmInsp'); if(!box) return;
  const it=PM.edit&&PM.sel?pmItem(PM.sel):null;
  if(!it){ box.classList.remove('on'); box.innerHTML=''; return; }
  box.classList.add('on');
  const del=`<button class="pm-tb" onclick="pmDelete()" style="color:#e07a6a">&#x1F5D1; Delete</button>`;
  if(it.t==='sym'){
    box.innerHTML=`<label>Symbol</label><select id="pmiK">${PM.legend.map(l=>`<option value="${pmEsc(l.id)}"${l.id===it.k?' selected':''}>${pmEsc(l.name)}</option>`).join('')}${PM.lmap[it.k]&&!PM.legend.find(l=>l.id===it.k)?`<option value="${pmEsc(it.k)}" selected>${pmEsc(PM.lmap[it.k].name)}</option>`:''}</select>
      <label>Label (optional)</label><input type="text" id="pmiS" maxlength="200" placeholder="e.g. 4&quot; Ketra D2, qty, zone…" value="${pmEsc(it.s)}"><div class="row">${del}<span style="flex:1"></span><button class="pm-tb" onclick="pmSelect(null)">Done</button></div>`;
    document.getElementById('pmiK').onchange=e=>{ pmSnapshot(); it.k=e.target.value; pmRender(); pmChanged(); };
  } else if(it.t==='text'||it.t==='note'){
    box.innerHTML=`<label>${it.t==='text'?'Text label':'Note'}</label><textarea id="pmiS" maxlength="${it.t==='text'?500:1000}" placeholder="Type here…">${pmEsc(it.s)}</textarea>
      ${it.t==='text'?`<div class="row">${PM_TEXT_COLORS.map(c=>`<button class="pm-sw${(it.c||PM_TEXT_COLORS[0])===c?' on':''}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}
        <span style="flex:1"></span><button class="pm-tb" id="pmiZm" title="Smaller">A&minus;</button><button class="pm-tb" id="pmiZp" title="Larger">A+</button></div>`:''}
      <div class="row">${del}<span style="flex:1"></span><button class="pm-tb" onclick="pmSelect(null)">Done</button></div>`;
    box.querySelectorAll('.pm-sw').forEach(b=>b.onclick=()=>{ pmSnapshot(); it.c=b.dataset.c; pmRender(); pmRenderInsp(); pmChanged(); });
    const z=d=>{ pmSnapshot(); it.z=pmClamp(Math.round(((Number(it.z)||1)+d)*100)/100,0.5,4); pmRender(); pmChanged(); };
    if(document.getElementById('pmiZm')){ document.getElementById('pmiZm').onclick=()=>z(-0.25); document.getElementById('pmiZp').onclick=()=>z(0.25); }
  } else if(it.t==='room'){
    const rooms=PM.rooms||[];
    box.innerHTML=`<label>Room region</label><select id="pmiRoom"><option value="">— choose a room —</option>${rooms.map(r=>`<option value="${pmEsc(r.id)}"${r.id===it.room_id?' selected':''}>${pmEsc(r.name)}${r.floor?' · '+pmEsc(r.floor):''}</option>`).join('')}<option value="__new"${!it.room_id&&it.name?' selected':''}>+ New room…</option></select>
      <input type="text" id="pmiName" maxlength="120" placeholder="New room name" value="${pmEsc(!it.room_id?it.name||'':'')}" style="display:${!it.room_id&&it.name?'':'none'}">
      <div style="font-size:11.5px;color:#9a9388">Saving the plan updates this room's room view. Drag the blue tag to move the box, the corner square to resize.</div>
      <div class="row">${del}<span style="flex:1"></span><button class="pm-tb" onclick="pmSelect(null)">Done</button></div>`;
    const sel=document.getElementById('pmiRoom'), nm=document.getElementById('pmiName');
    sel.onchange=()=>{ pmSnapshot(); if(sel.value==='__new'){ it.room_id=null; nm.style.display=''; nm.focus(); it.name=nm.value.trim(); }
      else { nm.style.display='none'; it.room_id=sel.value||null; const r=rooms.find(x=>x.id===sel.value); it.name=r?r.name:''; } pmRender(); pmChanged(); };
    nm.oninput=()=>{ it.room_id=null; it.name=nm.value.trim(); pmRender(); pmChanged(); };
    nm.onfocus=()=>pmSnapshot();
  }
  const s=document.getElementById('pmiS');
  if(s){ s.onfocus=()=>pmSnapshot(); s.oninput=()=>{ it.s=s.value; pmPlaceText(it); pmChanged(); }; }
}
function pmPlaceText(it){ const el=document.querySelector(`#pmLayer .pm-it[data-id="${CSS.escape(it.id)}"]`); if(!el) return pmRender();
  if(it.t==='sym'){ pmRender(); return; } el.textContent=it.s; }
function pmFocusInsp(){ setTimeout(()=>{ const s=document.getElementById('pmiS'); if(s){ s.focus(); if(s.select) s.select(); } },30); }

/* pointer hooks called by the viewer */
function pmPointerDown(e){
  if(!PM.edit) return false;
  const el=e.target&&e.target.closest?e.target.closest('#pmLayer [data-id]'):null;
  if(el&&PM.tool!=='room'){
    const it=pmItem(el.dataset.id); if(!it) return false;
    if(PM.sel!==it.id) pmSelect(it.id);
    const n=pmNorm(e.clientX,e.clientY);
    PM.drag={pid:e.pointerId,id:it.id,mode:el.dataset.h?'resize':'move',n0:n,o:{x:it.x,y:it.y,w:it.w,h:it.h},moved:false,snap:JSON.stringify(PM.data),last:{x:e.clientX,y:e.clientY},sx:e.clientX,sy:e.clientY};
    return true;
  }
  if(PM.tool==='room'){
    const n=pmNorm(e.clientX,e.clientY);
    PM.draw={pid:e.pointerId,n0:{u:pmClamp(n.u,0,1),v:pmClamp(n.v,0,1)},rect:null,last:{x:e.clientX,y:e.clientY}};
    return true;
  }
  return false;
}
function pmGestureToPinch(){
  const g=PM.drag||PM.draw; if(!g) return;
  if(PM.drag&&PM.drag.moved){ PM.undo.push(PM.drag.snap); pmChanged(); }
  PM.drag=null; PM.draw=null; pmRender();
  FV.ptrs.set(g.pid,{x:g.last.x,y:g.last.y});
}
function pmGestureMove(e){
  const g=PM.drag||PM.draw; if(!g||g.pid!==e.pointerId) return false;
  g.last={x:e.clientX,y:e.clientY};
  const n=pmNorm(e.clientX,e.clientY);
  if(PM.drag){
    if(!g.moved&&Math.hypot(e.clientX-g.sx,e.clientY-g.sy)<4) return true;
    g.moved=true; const it=pmItem(g.id); if(!it) return true;
    const du=n.u-g.n0.u, dv=n.v-g.n0.v;
    if(it.t==='room'){
      if(g.mode==='resize'){ it.w=pmClamp(g.o.w+du,0.01,1-it.x); it.h=pmClamp(g.o.h+dv,0.01,1-it.y); }
      else { it.x=pmClamp(g.o.x+du,0,1-it.w); it.y=pmClamp(g.o.y+dv,0,1-it.h); }
    } else { it.x=pmClamp(g.o.x+du,0,1); it.y=pmClamp(g.o.y+dv,0,1); }
    pmPlaceEl(it);
  } else {
    const u=pmClamp(n.u,0,1), v=pmClamp(n.v,0,1);
    g.rect={x:Math.min(u,g.n0.u),y:Math.min(v,g.n0.v),w:Math.abs(u-g.n0.u),h:Math.abs(v-g.n0.v)};
    let d=document.querySelector('#pmLayer .pm-draft');
    if(!d){ d=document.createElement('div'); d.className='pm-draft'; document.getElementById('pmLayer').appendChild(d); }
    d.style.left=g.rect.x*100+'%'; d.style.top=g.rect.y*100+'%'; d.style.width=g.rect.w*100+'%'; d.style.height=g.rect.h*100+'%';
  }
  return true;
}
function pmGestureEnd(e){
  const g=PM.drag||PM.draw; if(!g||g.pid!==e.pointerId) return false;
  if(PM.drag){ PM.drag=null; if(g.moved){ PM.undo.push(g.snap); if(PM.undo.length>60) PM.undo.shift(); PM.redo=[]; pmChanged(); }
    else { const it=pmItem(g.id); if(it&&(it.t==='text'||it.t==='note')) pmFocusInsp(); } }
  else { PM.draw=null; const r=g.rect; pmRender();
    if(r&&r.w>0.01&&r.h>0.01){ pmAddItem({t:'room',id:pmUid(),x:r.x,y:r.y,w:r.w,h:r.h,room_id:null,name:''}); pmSetTool('select'); } }
  return true;
}
function pmTap(cx,cy,e){
  const n=pmNorm(cx,cy); const inside=n.u>=0&&n.u<=1&&n.v>=0&&n.v<=1;
  if(PM.edit){
    if(!inside){ pmSelect(null); return; }
    const t=PM.tool;
    if(t.indexOf('sym:')===0){ pmAddItem({t:'sym',id:pmUid(),k:t.slice(4),x:n.u,y:n.v,s:''}); return; }
    if(t==='text'){ pmAddItem({t:'text',id:pmUid(),x:n.u,y:n.v,s:'Label',c:PM_TEXT_COLORS[0],z:1}); pmFocusInsp(); return; }
    if(t==='note'){ pmAddItem({t:'note',id:pmUid(),x:n.u,y:n.v,s:'Note'}); pmFocusInsp(); return; }
    pmSelect(null); return;
  }
  // view mode: tap a symbol for its name, tap a room box to open its room view
  const hit=document.elementFromPoint(cx,cy); const el=hit&&hit.closest?hit.closest('#pmLayer .pm-it,#pmLayer .pm-rl'):null;
  if(el&&el.classList.contains('pm-it')){ const it=pmItem(el.dataset.id);
    if(it&&it.t==='sym'){ const l=PM.lmap[it.k]; pmToast(`${pmSymHTML(l)} <b style="vertical-align:middle">${pmEsc(l?l.name:'Symbol')}</b>${it.s?' — '+pmEsc(it.s):''}`); }
    return; }
  if(FV.region||!inside) return;
  const rooms=(PM.data.items||[]).filter(i=>i.t==='room'&&n.u>=i.x&&n.u<=i.x+i.w&&n.v>=i.y&&n.v<=i.y+i.h).sort((a,b)=>a.w*a.h-b.w*b.h);
  if(rooms[0]) pmOpenRoom(rooms[0],PM.plan,PM.label,PM.project);
}
function pmOpenRoom(item,planKey,planLabel,project){
  const nm=item.name||pmRoomName(item)||'Room';
  openFloorView(planKey,nm+(planLabel?' — '+planLabel:''),{project:project||PM.project,planLabel,room:{id:item.room_id,name:nm,region:{x:item.x,y:item.y,w:item.w,h:item.h}}});
}
function pmKeydown(e){
  const ov=document.getElementById('fvOverlay'); if(!ov||!ov.classList.contains('on')) return;
  const typing=/^(INPUT|TEXTAREA|SELECT)$/.test((e.target&&e.target.tagName)||'');
  if(e.key==='Escape'){
    if(PM.edit){ if(typing){ e.target.blur(); return; } if(PM.sel){ pmSelect(null); return; } if(PM.tool!=='select'){ pmSetTool('select'); return; } pmDone(); return; }
    closeFloorView(); return;
  }
  if(!PM.edit||typing) return;
  if((e.key==='Delete'||e.key==='Backspace')&&PM.sel){ e.preventDefault(); pmDelete(); }
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){ e.preventDefault(); e.shiftKey?pmRedo():pmUndo(); }
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){ e.preventDefault(); pmRedo(); }
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){ e.preventDefault(); pmSave(); }
}
async function pmSave(){
  if(!PM.edit) return;
  if(PM.sel) pmSelect(null);
  const items=PM.data.items||[];
  const unassigned=items.filter(i=>i.t==='room'&&!i.room_id&&!String(i.name||'').trim());
  if(unassigned.length){ PM.sel=unassigned[0].id; pmRender(); pmRenderInsp(); pmStatus('Pick a room for each room box','err'); return; }
  pmStatus('Saving…');
  try{
    // Room boxes typed as a new room name create that room (scope_rooms) first.
    const floor=String(PM.label||'').split(/\s+[—–-]\s+/)[0].slice(0,40)||null;
    for(const it of items.filter(i=>i.t==='room'&&!i.room_id)){
      const ex=(PM.rooms||[]).find(r=>r.name.toLowerCase()===it.name.toLowerCase());
      if(ex){ it.room_id=ex.id; continue; }
      const r=await pmApi('scope/room',{method:'POST',body:{project:PM.project,name:it.name,floor}});
      it.room_id=r.id; (PM.rooms=PM.rooms||[]).push({id:r.id,name:it.name,floor});
    }
    const d=await pmApi('plans/markup',{method:'PUT',body:{project:PM.project,plan:PM.plan,label:PM.label,data:PM.data,base_version:PM.version}});
    PM.data=d.data; PM.version=d.version; PM.saved=JSON.stringify(PM.data); PM.dirty=false;
    try{ const h=await pmApi('plans/markup?project='+encodeURIComponent(PM.project)+'&plan='+encodeURIComponent(PM.plan)); PM.history=h.history||[]; }catch(e){}
    pmRender(); pmRenderPanel(); pmStatus('Saved ✓ v'+PM.version,'ok');
    window.dispatchEvent(new CustomEvent('pm:saved',{detail:{project:PM.project,plan:PM.plan}}));
  }catch(e){
    if(e.status===409){ pmStatus('Conflict','err'); if(confirm(e.message+'\n\nReload the latest version now? (your unsaved changes will be lost)')){ PM.dirty=false; pmEndEdit(false); await pmLoad(); } return; }
    pmStatus('Save failed','err'); alert(e.message);
  }
}
async function pmRestore(){
  const sel=document.getElementById('pmHist'); const v=sel&&Number(sel.value); if(!v) return;
  if(PM.dirty&&!confirm('Discard your unsaved changes and restore v'+v+'?')) return;
  if(!PM.dirty&&!confirm('Restore v'+v+'? (the current version is kept in history)')) return;
  try{ const d=await pmApi('plans/markup/restore',{method:'POST',body:{project:PM.project,plan:PM.plan,version:v}});
    PM.data=d.data; PM.version=d.version; PM.saved=JSON.stringify(PM.data); PM.dirty=false; PM.undo=[]; PM.redo=[]; PM.sel=null;
    const h=await pmApi('plans/markup?project='+encodeURIComponent(PM.project)+'&plan='+encodeURIComponent(PM.plan)); PM.history=h.history||[];
    pmRender(); pmRenderInsp(); pmRenderPanel(); pmStatus('Restored v'+v+' as v'+PM.version,'ok');
    window.dispatchEvent(new CustomEvent('pm:saved',{detail:{project:PM.project,plan:PM.plan}}));
  }catch(e){ alert(e.message); }
}

/* ---------------- room views outside the viewer ---------------- */
/* All room regions saved on a project's plans: [{room_id,name,plan_key,label,item}] */
async function pmProjectRooms(project){
  await pmEnsureLegend();
  let d; try{ d=await pmApi('plans/markups?project='+encodeURIComponent(project)); }catch(e){ return {rooms:[],markups:[]}; }
  const rooms=[];
  (d.markups||[]).forEach(m=>((m.data&&m.data.items)||[]).forEach(it=>{ if(it.t==='room') rooms.push({room_id:it.room_id,name:it.name,plan_key:m.plan_key,label:m.label,item:it,markup:m}); }));
  return {rooms,markups:d.markups||[]};
}
/* Static (non-interactive) preview of a room's region with the markup drawn on top. */
function pmRenderStatic(container,planKey,items,R){
  container.innerHTML='<div class="pm-static" style="position:relative;overflow:hidden;width:100%;background:#fff;border-radius:10px"><div class="fv-layer pm-sl" style="left:0;top:0;transform-origin:0 0"><img alt="" draggable="false"><div class="pm-layer"></div></div></div>';
  const wrap=container.firstChild, ly=wrap.firstChild, im=ly.querySelector('img');
  const html=(items||[]).filter(i=>i.t!=='room').map(it=>{ const s=PM.sel; PM.sel=null; const h=pmItemHTML(it); PM.sel=s; return h; }).join('');
  ly.querySelector('.pm-layer').innerHTML=html;
  const lay=()=>{ if(!im.naturalWidth) return; const nw=im.naturalWidth,nh=im.naturalHeight; const cw=wrap.clientWidth||600;
    const s=cw/(nw*R.w); ly.style.width=nw+'px'; ly.style.height=nh+'px';
    ly.style.transform=`translate(${-R.x*nw*s}px,${-R.y*nh*s}px) scale(${s})`; ly.style.setProperty('--inv',String(1/s));
    wrap.style.height=Math.round(R.h*nh*s)+'px'; };
  im.onload=lay; im.src=planKey; if(im.complete) lay();
  if(!pmRenderStatic._ro&&window.ResizeObserver){ pmRenderStatic._ro=new ResizeObserver(es=>es.forEach(en=>en.target._pmLay&&en.target._pmLay())); }
  wrap._pmLay=lay; if(pmRenderStatic._ro) pmRenderStatic._ro.observe(wrap);
}
