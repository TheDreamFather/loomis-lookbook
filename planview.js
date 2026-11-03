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
     {t:'wire', k:legendId, r:'home'|'pair'|'chain', w:wireLabel, c:colour,
            n:[[x,y]...] anchors, d:[symbolId|null...], g:[[h|v, bend|null]...]}
                                           a wiring run: right-angle legs between anchors
                                           (device(s) ... source). Anchors follow their
                                           symbols when they move; g = per-leg bend.
     data.scale = {a:[x,y], b:[x,y], d:feet, u:'ft'}  two points a known distance apart
     data.ar    = plan height / width (for lengths outside the viewer)
     {t:'erase', m:'rect'|'brush', x,y,w,h, c:fill, pts,sw,ar}
                                           opaque patch that hides something printed on
                                           the plan (x,y = top-left). Brush: pts are
                                           [fx,fy] fractions of the box, sw = stroke width
                                           as a fraction of the image width, ar = h/w of
                                           the image. Drawn above the image, below the rest.
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
  breaker:'<rect x="5" y="3" width="14" height="18" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 6.5l-4 6h4l-2 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  rack:'<rect x="5" y="3" width="14" height="18" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8h8M8 12h8M8 16h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  fan:'<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 10c0-4 1-6 3-6s2 3-3 6zM14 12c4 0 6 1 6 3s-3 2-6-3zM12 14c0 4-1 6-3 6s-2-3 3-6zM10 12c-4 0-6-1-6-3s3-2 6 3z" fill="currentColor"/>',
  smoke:'<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>',
  lock:'<rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/>',
  star:'<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>',
  dot:'<circle cx="12" cy="12" r="5" fill="currentColor"/>',
  square:'<rect x="6" y="6" width="12" height="12" fill="currentColor"/>',
  diamond:'<path d="M12 3l9 9-9 9-9-9z" fill="currentColor"/>'
};
const PM_ICON_NAMES={recessed:'Recessed light',pendant:'Pendant',sconce:'Sconce',speaker:'Speaker',sub:'Subwoofer',tv:'TV',wap:'Wi-Fi AP',camera:'Camera',keypad:'Keypad',motion:'Motion sensor',shade:'Shade',outlet:'Outlet',data:'Data drop',thermostat:'Thermostat',doorbell:'Doorbell',rack:'Rack',breaker:'Breaker / panel',fan:'Fan',smoke:'Smoke / CO',lock:'Lock',star:'Star',dot:'Dot',square:'Square',diamond:'Diamond'};
// Same rows as migrations/0001_plans_edit.sql — used only if the legend table isn't there yet.
const PM_DEFAULT_LEGEND=[['lg-recessed','Recessed light','#f2c14e','recessed'],['lg-pendant','Decorative / pendant','#e8913d','pendant'],['lg-speaker','In-ceiling speaker','#4aa3df','speaker'],['lg-sub','Subwoofer','#2e6fa8','sub'],['lg-tv','TV / display','#9b6cd6','tv'],['lg-wap','Wi-Fi access point','#31b6a6','wap'],['lg-camera','Camera','#e05a5a','camera'],['lg-keypad','Keypad / switch','#c9b27c','keypad'],['lg-motion','Motion / occupancy sensor','#f08bb4','motion'],['lg-shade','Motorized shade','#8fbf7f','shade'],['lg-outlet','Outlet','#ff8c42','outlet'],['lg-data','Data / network drop','#5ad1e6','data'],['lg-thermostat','Thermostat','#b3d465','thermostat'],['lg-doorbell','Video doorbell / intercom','#c78bf0','doorbell'],['lg-rack','Rack / head-end','#a8a8a8','rack'],['lg-breaker','Breaker / panel','#6f7d8c','breaker']].map((a,i)=>({id:a[0],name:a[1],color:a[2],icon:a[3],sort:(i+1)*10,wiring:null}));
// Default wiring rules (same JSON as the plan_legend.wiring seed values) — used when a row has none.
const PM_DEFAULT_WIRING={"lg-recessed":{"rule":"chain","to":"panel","wire":"14/2 · Lutron lighting","color":"#d49a00"},"lg-pendant":{"rule":"chain","to":"panel","wire":"14/2 · Lutron lighting","color":"#d49a00"},"lg-speaker":{"rule":"pair","to":"rack","wire":"16/4 speaker","color":"#2f7fd0"},"lg-sub":{"rule":"none"},"lg-tv":{"rule":"home","to":"rack","wire":"Cat6 + HDMI","color":"#7d4fc4"},"lg-wap":{"rule":"home","to":"rack","wire":"Cat6","color":"#179c8c"},"lg-camera":{"rule":"home","to":"rack","wire":"Cat6","color":"#d64545"},"lg-keypad":{"rule":"chain","to":"panel","wire":"Lutron QS link","color":"#9c7a1f"},"lg-motion":{"rule":"none"},"lg-shade":{"rule":"chain","to":"panel","wire":"Lutron QS shade cable","color":"#4f9a45"},"lg-outlet":{"rule":"none"},"lg-data":{"rule":"home","to":"rack","wire":"Cat6","color":"#1597b8"},"lg-thermostat":{"rule":"home","to":"rack","wire":"Cat6","color":"#7f9f2f"},"lg-doorbell":{"rule":"home","to":"rack","wire":"Cat6","color":"#a35bd6"},"lg-rack":{"rule":"source","src":"rack"},"lg-breaker":{"rule":"source","src":"panel"}};
const PM_RULES={home:'Home run',pair:'Pair home run',chain:'Daisy chain to source',none:'No wiring',source:'Source (rack / panel)'};
const PM_SRC={rack:'Rack / head-end',panel:'Breaker / panel'};
const PM_TEXT_COLORS=['#c0392b','#1f5fbf','#1e8449','#111111','#d35400','#7d3c98'];
const PM_ERASE_COLORS=[['#ffffff','White (paper)'],['#f4f1ea','Off-white'],['#e6e6e6','Light grey'],['#000000','Black']];

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
  .pm-er{position:absolute;pointer-events:none;box-sizing:border-box}
  .pm-er svg{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}
  .fv-ov.editing .pm-er{pointer-events:auto;outline:calc(1px * var(--inv)) dashed rgba(224,90,90,.75)}
  .fv-ov.editing.tool-erase .pm-er{pointer-events:none}
  .pm-er.sel{outline:calc(2px * var(--inv)) solid #3da5ff!important}
  .pm-er .pm-rh{border-color:#e05a5a}
  .fv-ov.editing.tool-erase .fv-stage{cursor:crosshair}
  .pm-del{position:absolute;z-index:3;transform-origin:0 0;transform:scale(var(--inv)) translate(6px,-100%);width:34px;height:34px;border-radius:50%;border:2px solid #fff;background:#d64541;color:#fff;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.45);cursor:pointer;pointer-events:auto;touch-action:none;padding:0}
  .pm-del svg{width:18px;height:18px}
  .pm-eopts{display:none;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 12px;border-bottom:1px solid #2a2720;font-size:12px;color:#9a9388}
  .pm-eopts.on{display:flex}
  .pm-eopts input[type=range]{flex:1;min-width:90px;accent-color:#3da5ff}
  .pm-eopts input[type=color]{width:30px;height:26px;padding:0;border:1px solid #3a352a;background:none;border-radius:5px}
  .pm-esw{width:24px;height:24px;border-radius:5px;border:2px solid #3a352a;cursor:pointer;padding:0}
  .pm-esw.on{border-color:#3da5ff;box-shadow:0 0 0 2px #10263a}
  .pm-tb.danger{color:#e07a6a}
  /* wiring runs: one SVG over the plan (0..1000 both ways), constant on-screen stroke */
  .pm-wires{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
  .pm-wires path{fill:none;vector-effect:non-scaling-stroke;stroke-linejoin:round;stroke-linecap:round;pointer-events:none}
  .pm-wires path.cs{stroke:#fff;stroke-opacity:.85;stroke-width:calc(5.5px * var(--inv))}
  .pm-wires path.cs.sel{stroke:#3da5ff;stroke-opacity:1;stroke-width:calc(9px * var(--inv))}
  .pm-wires path.ln{stroke-width:calc(2.8px * var(--inv))}
  .pm-wires path.ln.ch{stroke-dasharray:calc(10px * var(--inv)) calc(5px * var(--inv))}
  .pm-wires path.hit{stroke:transparent;stroke-width:calc(16px * var(--inv))}
  .fv-ov.editing:not(.tool-place):not(.tool-room):not(.tool-erase):not(.tool-scale) .pm-wires path.hit{pointer-events:stroke;cursor:pointer}
  .fv-ov.nowires .pm-wires{display:none}
  .pm-wh{position:absolute;z-index:3;width:18px;height:18px;transform:translate(-50%,-50%) scale(var(--inv));border-radius:50%;background:#fff;border:3px solid #3da5ff;pointer-events:auto;touch-action:none;cursor:move;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.4)}
  .pm-scd{position:absolute;width:14px;height:14px;border-radius:50%;background:#ff3b30;border:2px solid #fff;transform:translate(-50%,-50%) scale(var(--inv));pointer-events:none;box-sizing:border-box}
  .fv-ov.editing.tool-scale .fv-stage{cursor:crosshair}
  .pm-wr{display:flex;align-items:center;gap:6px;width:100%}
  .pm-wr .nm{flex:1;min-width:0;color:#efe9df;font-size:12.5px;line-height:1.25}
  .pm-wr .nm small{display:block;color:#9a9388;font-size:11px}
  .pm-wr .pm-sym{width:22px;height:22px;flex:0 0 auto;border-width:1.5px}.pm-wr .pm-sym svg{width:13px;height:13px}
  .pm-wlist{width:100%;max-height:190px;overflow:auto;display:flex;flex-direction:column;gap:5px}
  .pm-warn{width:100%;box-sizing:border-box;background:#3a1f14;border:1px solid #8a4a2a;color:#f2c9a8;border-radius:7px;padding:6px 8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .pm-wh2{color:#9a9388;font-size:11.5px;width:100%}
  .pm-le{display:flex;flex-direction:column;gap:6px;width:100%}
  .pm-le label{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#9a9388}
  .pm-le .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .pm-le input,.pm-le select{background:#0f0e0b;border:1px solid #3a352a;color:#efe9df;border-radius:6px;padding:6px 7px;font-size:13px;font-family:inherit;box-sizing:border-box}
  .pm-le input[type=color]{padding:0;width:38px;height:32px}
  /* device counter */
  .pm-cnt{position:absolute;z-index:8;right:12px;top:64px;width:310px;max-height:calc(100% - 90px);overflow:auto;background:rgba(20,18,16,.97);border:1px solid #b99a63;border-radius:12px;padding:10px 12px;color:#efe9df;display:none;font-size:12.5px;box-shadow:0 18px 50px rgba(0,0,0,.5);box-sizing:border-box}
  .pm-cnt.on{display:block}
  .pm-insp.on~.pm-cnt{display:none}
  .pm-cnt .pm-ch{display:flex;align-items:center;gap:8px;margin-bottom:4px}
  .pm-cnt .pm-ch b{color:#cbb488;letter-spacing:.1em;text-transform:uppercase;font-size:12px}
  .pm-cnt .pm-x{margin-left:auto;background:none;border:0;color:#cbb488;font-size:20px;cursor:pointer;line-height:1;padding:2px 6px}
  .pm-cnt table{width:100%;border-collapse:collapse}
  .pm-cnt th{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#9a9388;text-align:right;font-weight:700;padding:3px 4px;white-space:nowrap}
  .pm-cnt th:first-child,.pm-cnt td:first-child{text-align:left}
  .pm-cnt td{padding:3px 4px;text-align:right;border-top:1px solid #24211b;white-space:nowrap}
  .pm-cnt td:first-child{white-space:normal}
  .pm-cnt td b{color:#fff}
  .pm-cnt .nmc{display:flex;align-items:center;gap:6px}
  .pm-cnt .pm-sym{width:20px;height:20px;border-width:1.5px;flex:0 0 auto}.pm-cnt .pm-sym svg{width:12px;height:12px}
  .pm-cnt .wsw{display:inline-block;width:18px;height:4px;border-radius:2px;flex:0 0 auto}
  .pm-cnt h4{margin:12px 0 4px;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#cbb488}
  .pm-cnt .ft{color:#9a9388;font-size:11px;margin-top:6px}
  .pm-cnt .tg{display:flex;align-items:center;gap:8px;margin-top:10px;font-weight:700;cursor:pointer}
  .pm-cnt .tg input{width:18px;height:18px;accent-color:#3da5ff}
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
    .pm-del{width:40px;height:40px}
    .pm-eopts{padding:6px 10px}
    .pm-insp{left:0;right:0;width:auto;top:auto;bottom:0;max-height:46%;overflow:auto;border-radius:14px 14px 0 0;z-index:9;box-sizing:border-box}
    .pm-key{left:8px;right:8px;width:auto;bottom:40px}
    .pm-panel{overflow-y:auto}
    .pm-cnt{left:0;right:0;width:auto;top:auto;bottom:0;max-height:50%;border-radius:14px 14px 0 0;z-index:9}
    .pm-wlist{max-height:150px}
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
  if(PM.edit&&PM.sel) pmPosDel();
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
      <button class="fv-btn" id="pmCntBtn" onclick="pmToggleCnt()" hidden title="Device and wiring totals">&#x03A3; Counts</button>
      <button class="fv-btn" id="pmWireBtn" onclick="pmToggleWires()" hidden title="Show or hide the wiring runs">&#x26A1; Wiring</button>
      <button class="fv-btn" id="pmEditBtn" onclick="pmStartEdit()" hidden>&#x270E; Plans edit</button>
      <button class="fv-btn" id="fvCloseBtn" onclick="closeFloorView()">&times; Close</button></div>
    <div class="fv-stage" id="fvStage"><div class="fv-layer" id="fvLayer"><img id="fvImg" alt="" draggable="false"><div class="pm-layer" id="pmLayer"></div></div></div>
    <div class="fv-hint" id="fvHint">Scroll, pinch or +/&minus; to zoom · drag to pan · Esc to close</div>
    <div class="pm-panel" id="pmPanel"></div>
    <div class="pm-insp" id="pmInsp"></div>
    <div class="pm-cnt" id="pmCnt"></div>
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
  document.getElementById('pmCntBtn').hidden=true; document.getElementById('pmWireBtn').hidden=true;
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
  undo:[],redo:[],rooms:null,drag:null,draw:null,loadSeq:0,keyOpen:false,
  eraseMode:'rect',eraseColor:'#ffffff',brushPx:24,
  cntOpen:false,showWires:true,proj:null,legEdit:null,legDraft:null,scalePts:null,pendingGen:null};
async function pmEnsureLegend(force){
  if(PM.legendReady&&!force) return PM.legendReady;
  PM.legendReady=(async()=>{
    try{ const d=await pmApi('plans/legend'); PM.legend=d.items||[]; PM.notMigrated=false; }
    catch(e){ PM.legend=PM_DEFAULT_LEGEND.slice(); PM.notMigrated=!!(e.data&&e.data.not_migrated); }
    PM.legend.forEach(l=>{ if(typeof l.wiring==='string'){ try{ l.wiring=JSON.parse(l.wiring); }catch(e){ l.wiring=null; } } });
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
  pmRender(); pmRenderKey(); pmBarBtns(); pmRenderCnt(); pmLoadProj();
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
  if(it.t==='erase') return pmEraseHTML(it,sel);
  if(it.t==='wire') return '';   // all runs are drawn together by pmWiresHTML
  if(it.t==='room'){ const nm=pmRoomName(it);
    return `<div class="pm-room${sel}${it.room_id||it.name?'':' unassigned'}" data-rid="${pmEsc(it.id)}" style="left:${it.x*100}%;top:${it.y*100}%;width:${it.w*100}%;height:${it.h*100}%">
      <span class="pm-rl" data-id="${pmEsc(it.id)}">${pmEsc(nm||'Unassigned room')}</span>${PM.edit?`<span class="pm-rh" data-id="${pmEsc(it.id)}" data-h="1"></span>`:''}</div>`; }
  return '';
}
function pmBrushPath(pts,w,hh){
  if(!pts||!pts.length) return '';
  const P=p=>(p[0]*w).toFixed(5)+' '+(p[1]*hh).toFixed(5);
  return 'M'+P(pts[0])+(pts.length===1?' L'+P(pts[0]):pts.slice(1).map(p=>' L'+P(p)).join(''));
}
function pmEraseHTML(it,sel){
  const c=pmEsc(it.c||'#ffffff');
  const box=`left:${it.x*100}%;top:${it.y*100}%;width:${it.w*100}%;height:${it.h*100}%`;
  const hd=PM.edit&&sel?`<span class="pm-rh" data-id="${pmEsc(it.id)}" data-h="1"></span>`:'';
  if(it.m==='brush'){ const ar=Number(it.ar)||1, hh=it.h*ar;
    return `<div class="pm-er${sel}" data-id="${pmEsc(it.id)}" data-er="brush" style="${box}"><svg viewBox="0 0 ${it.w} ${hh}" preserveAspectRatio="none" aria-hidden="true"><path d="${pmBrushPath(it.pts,it.w,hh)}" fill="none" stroke="${c}" stroke-width="${Number(it.sw)||0.01}" stroke-linecap="round" stroke-linejoin="round"/></svg>${hd}</div>`; }
  return `<div class="pm-er${sel}" data-id="${pmEsc(it.id)}" data-er="rect" style="${box};background:${c}">${hd}</div>`;
}
/* floating trash button next to the selected item (works without a keyboard) */
function pmPosDel(){
  const b=document.querySelector('#pmLayer .pm-del'); if(!b) return;
  const it=PM.sel?pmItem(PM.sel):null; const ly=document.getElementById('fvLayer');
  const el=it&&(it.t==='room'?document.querySelector(`#pmLayer [data-rid="${CSS.escape(it.id)}"]`):document.querySelector(`#pmLayer [data-id="${CSS.escape(it.id)}"]:not(.pm-rh):not(.pm-rl)`));
  if(!el||!ly){ b.style.display='none'; return; }
  const r=el.getBoundingClientRect(), L=ly.getBoundingClientRect(); if(!L.width) return;
  b.style.display=''; b.style.left=((r.right-L.left)/L.width*100)+'%'; b.style.top=((r.top-L.top)/L.height*100)+'%';
}
function pmRender(){
  const ly=document.getElementById('pmLayer'); if(!ly) return;
  const items=PM.data.items||[];
  // erase patches, then wiring, then rooms, notes/text, and symbols on top
  const order={erase:-1,room:0,note:1,text:2,sym:3};
  let html=items.filter(i=>i.t==='erase').map(pmItemHTML).join('')+pmWiresHTML(items,PM.edit)
    +items.filter(i=>i.t!=='erase'&&i.t!=='wire').sort((a,b)=>(order[a.t]||0)-(order[b.t]||0)).map(pmItemHTML).join('');
  if(PM.edit&&PM.tool==='scale'&&PM.scalePts) PM.scalePts.forEach(p=>{ html+=`<div class="pm-scd" style="left:${p[0]*100}%;top:${p[1]*100}%"></div>`; });
  const R=FV.region; if(R) html+=`<div class="pm-focus" style="left:${R.x*100}%;top:${R.y*100}%;width:${R.w*100}%;height:${R.h*100}%"></div>`;
  if(PM.draw&&PM.draw.rect){ const d=PM.draw.rect; html+=`<div class="pm-draft" style="left:${d.x*100}%;top:${d.y*100}%;width:${d.w*100}%;height:${d.h*100}%"></div>`; }
  if(PM.edit&&PM.sel&&pmItem(PM.sel)) html+=`<button class="pm-del" id="pmDelFloat" type="button" title="Delete this item" aria-label="Delete selected item"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  ly.innerHTML=html;
  if(PM.edit&&PM.sel) pmPosDel();
}
function pmPlaceEl(it){
  if(it.t==='erase'){ const el=document.querySelector(`#pmLayer .pm-er[data-id="${CSS.escape(it.id)}"]`); if(!el) return pmRender();
    el.style.left=it.x*100+'%'; el.style.top=it.y*100+'%'; el.style.width=it.w*100+'%'; el.style.height=it.h*100+'%';
    if(it.m==='brush'){ const sv=el.querySelector('svg'), hh=it.h*(Number(it.ar)||1); sv.setAttribute('viewBox',`0 0 ${it.w} ${hh}`); sv.querySelector('path').setAttribute('d',pmBrushPath(it.pts,it.w,hh)); }
    pmPosDel(); return; }
  if(it.t==='room'){ const el=document.querySelector(`#pmLayer [data-rid="${CSS.escape(it.id)}"]`); if(!el) return pmRender();
    el.style.left=it.x*100+'%'; el.style.top=it.y*100+'%'; el.style.width=it.w*100+'%'; el.style.height=it.h*100+'%'; pmPosDel(); return; }
  const el=document.querySelector(`#pmLayer .pm-it[data-id="${CSS.escape(it.id)}"]`); if(!el) return pmRender();
  el.style.left=it.x*100+'%'; el.style.top=it.y*100+'%';
  if(it.t==='sym'&&(PM.data.items||[]).some(w=>w.t==='wire'&&(w.d||[]).includes(it.id))) pmRenderWires();   // runs follow the device
  pmPosDel();
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
  pmRenderPanel(); pmRender(); pmRenderKey(); pmRenderInsp(); pmBarBtns(); pmRenderCnt();
  const wasFit=FV.atFit; if(wasFit) fvReset(); else fvOnResize();
  if(!PM.rooms){ try{ PM.rooms=(await pmApi('scope?project='+encodeURIComponent(PM.project))).rooms||[]; }catch(e){ PM.rooms=[]; } pmRender(); }
}
function pmEndEdit(discard){
  if(discard&&PM.dirty){ try{ PM.data=JSON.parse(PM.saved); }catch(e){} }
  PM.edit=false; PM.sel=null; PM.drag=null; PM.draw=null; PM.dirty=false; PM.legEdit=null; PM.scalePts=null; PM.pendingGen=null;
  const ov=document.getElementById('fvOverlay'); if(!ov) return;
  ov.classList.remove('editing','tool-place','tool-room','tool-erase','tool-scale');
  document.getElementById('pmPanel').classList.remove('on'); document.getElementById('pmInsp').classList.remove('on');
  document.getElementById('pmEditBtn').hidden=!(PM.canEdit&&!FV.region);
  document.getElementById('pmKeyBtn').hidden=!pmCounts(PM.data.items).length;
  pmRender(); pmRenderKey(); pmBarBtns(); pmRenderCnt();
  if(FV.atFit) fvReset(); else fvOnResize();
}
function pmDone(){ if(PM.dirty&&!confirm('You have unsaved changes. Leave Plans edit and discard them?')) return; pmEndEdit(true); }
function pmSetTool(t){
  PM.tool=t; const ov=document.getElementById('fvOverlay');
  ov.classList.toggle('tool-place',t.indexOf('sym:')===0||t==='text'||t==='note'); ov.classList.toggle('tool-room',t==='room'); ov.classList.toggle('tool-erase',t==='erase'); ov.classList.toggle('tool-scale',t==='scale');
  if(t!=='scale') PM.scalePts=null;
  pmRenderPanel(); if(PM.edit) pmRender();
}
function pmSnapshot(){ PM.undo.push(JSON.stringify(PM.data)); if(PM.undo.length>60) PM.undo.shift(); PM.redo=[]; }
function pmChanged(){ PM.dirty=JSON.stringify(PM.data)!==PM.saved; pmStatus(); pmUpdateCounts(); pmRenderWopts(); pmRenderCnt(); pmBarBtns(); }
function pmUndo(){ if(!PM.undo.length) return; PM.redo.push(JSON.stringify(PM.data)); PM.data=JSON.parse(PM.undo.pop()); if(PM.sel&&!pmItem(PM.sel)) PM.sel=null; pmRender(); pmRenderInsp(); pmChanged(); pmRenderPanel(); }
function pmRedo(){ if(!PM.redo.length) return; PM.undo.push(JSON.stringify(PM.data)); PM.data=JSON.parse(PM.redo.pop()); if(PM.sel&&!pmItem(PM.sel)) PM.sel=null; pmRender(); pmRenderInsp(); pmChanged(); pmRenderPanel(); }
function pmStatus(msg,cls){
  const s=document.getElementById('pmStatus'); if(!s) return;
  if(msg!=null){ s.textContent=msg; s.className='pm-status '+(cls||''); return; }
  if(PM.dirty){ s.textContent='Unsaved changes'; s.className='pm-status dirty'; }
  else { s.textContent=PM.version?('Saved · v'+PM.version):'Not saved yet'; s.className='pm-status'; }
  const u=document.getElementById('pmUndo'), r=document.getElementById('pmRedo'), sv=document.getElementById('pmSave');
  if(u) u.disabled=!PM.undo.length; if(r) r.disabled=!PM.redo.length; if(sv) sv.disabled=!PM.dirty;
  const ds=document.getElementById('pmDelSel'), cl=document.getElementById('pmClear');
  if(ds) ds.disabled=!(PM.sel&&pmItem(PM.sel)); if(cl) cl.disabled=!(PM.data.items||[]).length;
}
function pmUpdateCounts(){ const c={}; (PM.data.items||[]).forEach(it=>{ if(it.t==='sym') c[it.k]=(c[it.k]||0)+1; });
  document.querySelectorAll('#pmPanel .pm-lg[data-k]').forEach(b=>{ const ct=b.querySelector('.ct'); if(ct) ct.textContent=c[b.dataset.k]||''; }); }
function pmRenderPanel(){
  const p=document.getElementById('pmPanel'); if(!p) return;
  p.classList.add('on');
  const T=(t,lbl,title)=>`<button class="pm-tb${PM.tool===t?' on':''}" data-tool="${t}" title="${title||''}">${lbl}</button>`;
  const hist=(PM.history||[]).map(h=>`<option value="${h.version}">v${h.version} · ${pmEsc(new Date(h.saved_at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))}</option>`).join('');
  p.innerHTML=`<div class="pm-ph"><b>Plans edit</b><span class="pm-status" id="pmStatus"></span></div>
    <div class="pm-tools">${T('select','&#x2196; Select / move','Select, drag to move')}${T('text','T&nbsp;Text','Tap the plan to add a text label')}${T('note','&#x1F5C8; Note','Tap the plan to add a note')}${T('room','&#x25AD; Room box','Drag a box around a room, then pick the room')}${T('erase','&#x232B; Erase','Cover something printed on the plan with a patch')}${T('wire','&#x26A1; Wiring','Generate wiring runs for the devices on this plan')}
      <button class="pm-tb" id="pmUndo" onclick="pmUndo()" title="Undo (Ctrl+Z)">&#x21B6;</button><button class="pm-tb" id="pmRedo" onclick="pmRedo()" title="Redo">&#x21B7;</button><button class="pm-tb danger" id="pmDelSel" onclick="pmDelete()" title="Delete the selected item (Del)">&#x1F5D1; Delete</button></div>
    <div class="pm-eopts${PM.tool==='erase'?' on':''}" id="pmEopts">
      <button class="pm-tb${PM.eraseMode==='rect'?' on':''}" data-em="rect" title="Drag a rectangle">&#x25AD; Box</button><button class="pm-tb${PM.eraseMode==='brush'?' on':''}" data-em="brush" title="Paint over it">&#x1F58C; Brush</button>
      <span id="pmBrushRow" style="display:${PM.eraseMode==='brush'?'flex':'none'};align-items:center;gap:6px;flex:1 1 100%">Size<input type="range" id="pmBrush" min="4" max="90" step="1" value="${PM.brushPx}"><span id="pmBrushV">${PM.brushPx}px</span></span>
      <span style="flex:1 1 100%;display:flex;gap:6px;align-items:center">Fill ${PM_ERASE_COLORS.map(([c,n])=>`<button class="pm-esw${PM.eraseColor===c?' on':''}" data-ec="${c}" title="${n}" style="background:${c}"></button>`).join('')}<input type="color" id="pmEraseC" value="${PM.eraseColor}" title="Pick any fill colour"></span>
      <span style="flex:1 1 100%">${PM.eraseMode==='brush'?'Paint over printed marks to hide them.':'Drag a box over printed marks to hide them.'} The original plan file is never changed.</span></div>
    <div class="pm-eopts" id="pmWopts"></div>
    <div class="pm-eopts" id="pmLopts"></div>
    <div class="pm-lh"><span>Legend · tap, then tap the plan</span><button onclick="pmToggleAdd()">+ Add</button></div>
    <div class="pm-leg">${PM.legend.map(l=>`<button class="pm-lg${PM.tool==='sym:'+l.id?' on':''}" data-k="${pmEsc(l.id)}" title="${pmEsc(l.name)}">${pmSymHTML(l)}<span class="nm">${pmEsc(l.name)}</span><span class="ct"></span></button>`).join('')}</div>
    <div class="pm-add" id="pmAdd"><input id="pmAddName" placeholder="Legend name (e.g. Ceiling fan)" style="flex:1 1 100%">
      <input type="color" id="pmAddColor" value="#4aa3df" title="Colour"><select id="pmAddIcon" style="flex:1">${Object.keys(PM_ICONS).map(k=>`<option value="${k}">${PM_ICON_NAMES[k]||k}</option>`).join('')}<option value="text">Letters…</option></select>
      <input id="pmAddLetters" placeholder="AB" maxlength="3" style="width:52px;display:none">
      <button class="pm-tb primary" onclick="pmAddLegend()">Add to legend</button></div>
    <div class="pm-acts">${hist?`<select id="pmHist"><option value="">History…</option>${hist}</select><button class="pm-tb" onclick="pmRestore()" title="Restore the chosen version">Restore</button>`:''}
      <button class="pm-tb danger" id="pmClear" onclick="pmClearAll()" title="Remove all markup on this plan">Clear all</button><span style="flex:1"></span><button class="pm-tb" onclick="pmDone()">Done</button><button class="pm-tb primary" id="pmSave" onclick="pmSave()">Save</button></div>`;
  p.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>pmSetTool(b.dataset.tool));
  p.querySelectorAll('[data-em]').forEach(b=>b.onclick=()=>{ PM.eraseMode=b.dataset.em; pmRenderPanel(); });
  p.querySelectorAll('[data-ec]').forEach(b=>b.onclick=()=>{ PM.eraseColor=b.dataset.ec; pmRenderPanel(); });
  const ec=document.getElementById('pmEraseC'); if(ec) ec.oninput=()=>{ PM.eraseColor=ec.value; p.querySelectorAll('.pm-esw').forEach(x=>x.classList.toggle('on',x.dataset.ec===ec.value)); };
  const br=document.getElementById('pmBrush'); if(br) br.oninput=()=>{ PM.brushPx=Number(br.value)||24; document.getElementById('pmBrushV').textContent=PM.brushPx+'px'; };
  p.querySelectorAll('.pm-lg[data-k]').forEach(b=>b.onclick=()=>pmSetTool(PM.tool==='sym:'+b.dataset.k?'select':'sym:'+b.dataset.k));
  const ic=document.getElementById('pmAddIcon'); if(ic) ic.onchange=()=>{ document.getElementById('pmAddLetters').style.display=ic.value==='text'?'':'none'; };
  pmStatus(); pmUpdateCounts(); pmRenderWopts(); pmRenderLopts();
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
function pmDelete(id){ id=id||PM.sel; if(!id||!pmItem(id)) return; pmSnapshot(); PM.data.items=PM.data.items.filter(i=>i.id!==id); if(PM.sel===id) PM.sel=null; pmRender(); pmRenderInsp(); pmChanged(); pmToast('Deleted · <a href="#" onclick="pmUndo();return false" style="color:#cbb488">Undo</a>',3000); }
function pmClearAll(){
  const n=(PM.data.items||[]).length; if(!n) return;
  if(!confirm(`Clear all ${n} item${n>1?'s':''} on this plan (symbols, text, notes, wiring, erase patches and room boxes)?\n\nNothing is permanent until you press Save, and older versions stay in History.`)) return;
  pmSnapshot(); PM.data.items=[]; PM.sel=null; pmRender(); pmRenderInsp(); pmChanged(); pmStatus(); pmStatus('Cleared — press Save to keep','dirty');
}
function pmSelect(id){
  const prev=PM.sel?pmItem(PM.sel):null;
  if(prev&&prev.id!==id&&(prev.t==='text'||prev.t==='note')&&!String(prev.s||'').trim()){ PM.data.items=PM.data.items.filter(i=>i!==prev); pmChanged(); }   // drop empty labels
  PM.sel=id||null; pmRender(); pmRenderInsp(); pmStatus();
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
  } else if(it.t==='erase'){
    box.innerHTML=`<label>Erase patch · ${it.m==='brush'?'brush':'box'}</label>
      <div class="row">${PM_ERASE_COLORS.map(([c,n])=>`<button class="pm-esw${(it.c||'#ffffff')===c?' on':''}" data-c="${c}" title="${n}" style="background:${c}"></button>`).join('')}<input type="color" id="pmiC" value="${pmEsc(it.c||'#ffffff')}" title="Fill colour"></div>
      <div style="font-size:11.5px;color:#9a9388">Hides what is printed underneath. Drag to move, corner square to resize.</div>
      <div class="row">${del}<span style="flex:1"></span><button class="pm-tb" onclick="pmSelect(null)">Done</button></div>`;
    box.querySelectorAll('.pm-esw').forEach(b=>b.onclick=()=>{ pmSnapshot(); it.c=b.dataset.c; pmRender(); pmRenderInsp(); pmChanged(); });
    const ci=document.getElementById('pmiC'); ci.onfocus=()=>pmSnapshot(); ci.oninput=()=>{ it.c=ci.value; pmRender(); pmChanged(); };
  } else if(it.t==='wire'){
    const l=PM.lmap[it.k], map=pmSymMap(PM.data.items), ar=pmDataAR(PM.data);
    const L=pmLenU(pmWirePts(it,map),ar), ft=pmUToFt(L,PM.data.scale,ar);
    const nd=(it.d||[]).filter(id=>id&&map[id]&&pmRule(map[id].k).rule!=='source').length;
    box.innerHTML=`<label>Wire run · ${pmEsc(PM_RULES[it.r]||'')}</label>
      <div class="row">${pmSymHTML(l)}<b>${pmEsc(l?l.name:'Device')}</b><span style="color:#9a9388">· ${nd} device${nd===1?'':'s'} · <span id="pmiLen">${ft!=null?'≈ '+Math.round(ft)+' ft':'≈ '+Math.round(L)+' u'}</span></span></div>
      <label>Wire / cable</label><input type="text" id="pmiW" maxlength="60" value="${pmEsc(it.w)}">
      <div class="row"><label style="margin-right:auto">Line colour</label><input type="color" id="pmiC" value="${pmEsc(it.c||'#888888')}"></div>
      <div style="font-size:11.5px;color:#9a9388">Drag a white dot to move that bend · tap a dot to flip the corner. The run follows its devices when they move.</div>
      <div class="row">${del}<button class="pm-tb" id="pmiRst" title="Back to plain L-shaped legs">Reset bends</button><span style="flex:1"></span><button class="pm-tb" onclick="pmSelect(null)">Done</button></div>`;
    const wi=document.getElementById('pmiW'); wi.onfocus=()=>pmSnapshot(); wi.oninput=()=>{ it.w=wi.value; pmChanged(); };
    const ci=document.getElementById('pmiC'); ci.onfocus=()=>pmSnapshot(); ci.oninput=()=>{ it.c=ci.value; pmRenderWires(); pmChanged(); };
    document.getElementById('pmiRst').onclick=()=>{ pmSnapshot(); it.g=(it.g||[]).map(()=>['h',null]); pmRenderWires(); pmChanged(); pmRenderInsp(); };
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
  if(e.target&&e.target.closest&&e.target.closest('#pmLayer .pm-del')){ PM.delTap=e.pointerId; return true; }
  if(PM.tool==='scale') return false;   // taps pick the two scale points
  if(PM.tool==='erase'){
    const n=pmNorm(e.clientX,e.clientY), L=document.getElementById('fvLayer').getBoundingClientRect();
    const p0={u:pmClamp(n.u,0,1),v:pmClamp(n.v,0,1)};
    PM.draw={pid:e.pointerId,erase:PM.eraseMode,n0:p0,rect:null,last:{x:e.clientX,y:e.clientY},pts:[p0],lastPx:{x:e.clientX,y:e.clientY},
      sw:PM.brushPx/(L.width||1),ar:FV.nw?FV.nh/FV.nw:(L.height/(L.width||1))};
    if(PM.eraseMode==='brush') pmBrushDraft();
    return true;
  }
  const el=e.target&&e.target.closest?e.target.closest('#pmLayer [data-id]'):null;
  if(el&&PM.tool!=='room'){
    const it=pmItem(el.dataset.id); if(!it) return false;
    if(PM.sel!==it.id) pmSelect(it.id);
    const n=pmNorm(e.clientX,e.clientY);
    PM.drag={pid:e.pointerId,id:it.id,mode:it.t==='wire'?(el.dataset.leg!=null?'leg':'none'):el.dataset.h?'resize':'move',leg:Number(el.dataset.leg),n0:n,o:{x:it.x,y:it.y,w:it.w,h:it.h},moved:false,snap:JSON.stringify(PM.data),last:{x:e.clientX,y:e.clientY},sx:e.clientX,sy:e.clientY};
    return true;
  }
  if(PM.tool==='room'){
    const n=pmNorm(e.clientX,e.clientY);
    PM.draw={pid:e.pointerId,n0:{u:pmClamp(n.u,0,1),v:pmClamp(n.v,0,1)},rect:null,last:{x:e.clientX,y:e.clientY}};
    return true;
  }
  return false;
}
function pmBrushDraft(){
  const g=PM.draw; if(!g) return; const ly=document.getElementById('pmLayer');
  let d=ly.querySelector('.pm-bdraft');
  if(!d){ d=document.createElementNS('http://www.w3.org/2000/svg','svg'); d.setAttribute('class','pm-bdraft'); d.setAttribute('preserveAspectRatio','none');
    d.style.cssText='position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none';
    d.innerHTML='<path fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".85"/>'; ly.appendChild(d); }
  d.setAttribute('viewBox',`0 0 1 ${g.ar}`);
  const pa=d.firstChild; pa.setAttribute('stroke',PM.eraseColor); pa.setAttribute('stroke-width',g.sw);
  pa.setAttribute('d',pmBrushPath(g.pts.map(p=>[p.u,p.v]),1,g.ar));
  d.style.filter='drop-shadow(0 0 calc(1.5px * var(--inv)) rgba(224,90,90,.9))';
}
function pmGestureToPinch(){
  PM.delTap=null;
  const g=PM.drag||PM.draw; if(!g) return;
  if(PM.drag&&PM.drag.moved){ PM.undo.push(PM.drag.snap); pmChanged(); }
  PM.drag=null; PM.draw=null; pmRender();
  FV.ptrs.set(g.pid,{x:g.last.x,y:g.last.y});
}
function pmGestureMove(e){
  if(PM.delTap!=null&&PM.delTap===e.pointerId) return true;
  const g=PM.drag||PM.draw; if(!g||g.pid!==e.pointerId) return false;
  g.last={x:e.clientX,y:e.clientY};
  const n=pmNorm(e.clientX,e.clientY);
  if(PM.drag){
    if(!g.moved&&Math.hypot(e.clientX-g.sx,e.clientY-g.sy)<4) return true;
    const it=pmItem(g.id); if(!it) return true;
    if(it.t==='wire'){ if(g.mode!=='leg') return true; g.moved=true;
      it.g=it.g||[]; const q=it.g[g.leg]||['h',null], o=q[0]==='v'?'v':'h';
      it.g[g.leg]=[o,Math.round(pmClamp(o==='h'?n.u:n.v,0,1)*100000)/100000]; pmRenderWires(); return true; }
    g.moved=true;
    const du=n.u-g.n0.u, dv=n.v-g.n0.v;
    if(it.t==='room'||it.t==='erase'){
      if(g.mode==='resize'){ it.w=pmClamp(g.o.w+du,0.01,1-it.x); it.h=pmClamp(g.o.h+dv,0.01,1-it.y); }
      else { it.x=pmClamp(g.o.x+du,0,1-it.w); it.y=pmClamp(g.o.y+dv,0,1-it.h); }
    } else { it.x=pmClamp(g.o.x+du,0,1); it.y=pmClamp(g.o.y+dv,0,1); }
    pmPlaceEl(it);
  } else if(g.erase==='brush'){
    if(Math.hypot(e.clientX-g.lastPx.x,e.clientY-g.lastPx.y)<2.5) return true;   // thin out points
    g.lastPx={x:e.clientX,y:e.clientY}; if(g.pts.length<2000) g.pts.push({u:pmClamp(n.u,0,1),v:pmClamp(n.v,0,1)}); pmBrushDraft();
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
  if(PM.delTap!=null&&PM.delTap===e.pointerId){ PM.delTap=null; if(e.type==='pointerup') pmDelete(); return true; }
  const g=PM.drag||PM.draw; if(!g||g.pid!==e.pointerId) return false;
  if(PM.drag){ PM.drag=null; if(g.moved){ PM.undo.push(g.snap); if(PM.undo.length>60) PM.undo.shift(); PM.redo=[]; pmChanged(); const mi=pmItem(g.id); if(mi&&mi.t==='wire') pmRenderInsp(); }
    else { const it=pmItem(g.id); if(it&&(it.t==='text'||it.t==='note')) pmFocusInsp();
      if(it&&it.t==='wire'&&g.mode==='leg'){ pmSnapshot(); it.g=it.g||[]; const q=it.g[g.leg]||['h',null]; it.g[g.leg]=[q[0]==='v'?'h':'v',null]; pmRenderWires(); pmChanged(); } } }
  else if(g.erase==='brush'){ PM.draw=null; pmBrushFinish(g); }
  else if(g.erase){ PM.draw=null; const r=g.rect; pmRender();
    if(r&&r.w>0.002&&r.h>0.002) pmAddItem({t:'erase',m:'rect',id:pmUid(),x:r.x,y:r.y,w:r.w,h:r.h,c:PM.eraseColor}); }
  else { PM.draw=null; const r=g.rect; pmRender();
    if(r&&r.w>0.01&&r.h>0.01){ pmAddItem({t:'room',id:pmUid(),x:r.x,y:r.y,w:r.w,h:r.h,room_id:null,name:''}); pmSetTool('select'); } }
  return true;
}
function pmBrushFinish(g){
  const hw=g.sw/2, hv=g.sw/2/(g.ar||1);
  let x0=1,y0=1,x1=0,y1=0; g.pts.forEach(p=>{ x0=Math.min(x0,p.u); y0=Math.min(y0,p.v); x1=Math.max(x1,p.u); y1=Math.max(y1,p.v); });
  x0=Math.max(0,x0-hw); y0=Math.max(0,y0-hv); x1=Math.min(1,x1+hw); y1=Math.min(1,y1+hv);
  const w=Math.max(1e-4,x1-x0), h=Math.max(1e-4,y1-y0);
  const r4=v=>Math.round(v*10000)/10000;
  const pts=g.pts.map(p=>[r4((p.u-x0)/w),r4((p.v-y0)/h)]);
  pmAddItem({t:'erase',m:'brush',id:pmUid(),x:x0,y:y0,w,h,c:PM.eraseColor,pts,sw:g.sw,ar:g.ar});
}
function pmTap(cx,cy,e){
  const n=pmNorm(cx,cy); const inside=n.u>=0&&n.u<=1&&n.v>=0&&n.v<=1;
  if(PM.edit){
    if(!inside){ pmSelect(null); return; }
    const t=PM.tool;
    if(t==='scale'){ pmScaleTap(n.u,n.v); return; }
    if(t.indexOf('sym:')===0){ const k=t.slice(4); pmAddItem({t:'sym',id:pmUid(),k,x:n.u,y:n.v,s:''});
      if(PM.pendingGen&&pmRule(k).rule==='source'){ const w=PM.pendingGen; PM.pendingGen=null; pmSetTool('wire'); pmWireGen(w); }
      return; }
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
    const wm=pmSymMap(items);
    items.forEach(w=>{ if(w.t==='wire'){ w.n=pmWireNodes(w,wm).map(p=>[Math.round(p[0]*100000)/100000,Math.round(p[1]*100000)/100000]); w.x=w.n[0][0]; w.y=w.n[0][1]; } });
    if(FV.nw) PM.data.ar=Math.round(FV.nh/FV.nw*100000)/100000;
    const d=await pmApi('plans/markup',{method:'PUT',body:{project:PM.project,plan:PM.plan,label:PM.label,data:PM.data,base_version:PM.version}});
    PM.data=d.data; PM.version=d.version; PM.saved=JSON.stringify(PM.data); PM.dirty=false;
    try{ const h=await pmApi('plans/markup?project='+encodeURIComponent(PM.project)+'&plan='+encodeURIComponent(PM.plan)); PM.history=h.history||[]; }catch(e){}
    pmRender(); pmRenderPanel(); pmStatus('Saved ✓ v'+PM.version,'ok'); pmLoadProj();
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
    pmRender(); pmRenderInsp(); pmRenderPanel(); pmStatus('Restored v'+v+' as v'+PM.version,'ok'); pmLoadProj();
    window.dispatchEvent(new CustomEvent('pm:saved',{detail:{project:PM.project,plan:PM.plan}}));
  }catch(e){ alert(e.message); }
}

/* ---------------- wiring runs + device counter ---------------- */
/* Wiring rule of a legend item: {rule:'home'|'pair'|'chain'|'none'|'source', to:'rack'|'panel',
   wire, color, max, src}. Stored in plan_legend.wiring; seeded rows fall back to PM_DEFAULT_WIRING. */
function pmRule(k){
  const l=PM.lmap[k]; let w=l&&l.wiring;
  if(typeof w==='string'){ try{ w=JSON.parse(w); }catch(e){ w=null; } }
  if(!w||!w.rule) w=PM_DEFAULT_WIRING[k]||{rule:'none'};
  const rule=PM_RULES[w.rule]?w.rule:'none';
  return {rule,to:w.to==='panel'||w.to==='rack'?w.to:(rule==='chain'?'panel':'rack'),wire:w.wire||'',color:w.color||(l&&l.color)||'#888888',max:Number(w.max)||0,src:w.src==='panel'?'panel':'rack'};
}
function pmWired(k){ return ['home','pair','chain'].includes(pmRule(k).rule); }
function pmSrcLegend(role){ return PM.legend.find(l=>{ const r=pmRule(l.id); return r.rule==='source'&&r.src===role; })||null; }
function pmSymMap(items){ const m={}; (items||[]).forEach(i=>{ if(i.t==='sym') m[i.id]=i; }); return m; }
function pmDataAR(data){ const a=Number(data&&data.ar); if(a>0) return a; return (data===PM.data&&FV.nw)?FV.nh/FV.nw:1; }
/* anchor points of a run, following the symbols they belong to */
function pmWireNodes(w,map){ return (w.n||[]).map((p,i)=>{ const id=w.d&&w.d[i], s=id&&map[id]; return s?[s.x,s.y]:p; }); }
/* one leg A->B: 'h' = horizontal, vertical at x=m, horizontal; 'v' = vertical, horizontal at y=m, vertical.
   Default bend (m=null) gives a plain L. */
function pmLegGeom(A,B,q){
  const o=q&&q[0]==='v'?'v':'h', m=q&&q[1]!=null?q[1]:(o==='h'?B[0]:B[1]);
  return o==='h'?{o,m,pts:[A,[m,A[1]],[m,B[1]],B],mid:[m,(A[1]+B[1])/2]}:{o,m,pts:[A,[A[0],m],[B[0],m],B],mid:[(A[0]+B[0])/2,m]};
}
function pmWirePts(w,map){
  const N=pmWireNodes(w,map), out=[];
  for(let i=0;i<N.length-1;i++) pmLegGeom(N[i],N[i+1],w.g&&w.g[i]).pts.forEach((p,j)=>{
    if(i>0&&j===0) return; const q=out[out.length-1]; if(q&&Math.abs(q[0]-p[0])<1e-9&&Math.abs(q[1]-p[1])<1e-9) return; out.push(p); });
  if(!out.length&&N[0]) out.push(N[0]);
  return out;
}
/* length in plan units (u = 1% of the plan width) and in feet when the plan has a scale */
function pmLenU(P,ar){ let s=0; for(let i=1;i<P.length;i++) s+=Math.abs(P[i][0]-P[i-1][0])*100+Math.abs(P[i][1]-P[i-1][1])*100*ar; return s; }
function pmUToFt(u,sc,ar){ if(!sc||!(sc.d>0)||!sc.a||!sc.b) return null; const du=Math.hypot((sc.b[0]-sc.a[0])*100,(sc.b[1]-sc.a[1])*100*ar); return du>0?u*sc.d/du:null; }
function pmFmtLen(e){ const p=[]; if(e.ft>0) p.push('≈ '+Math.round(e.ft)+' ft'); if(e.un>0) p.push('≈ '+Math.round(e.un)+' u'); return p.join(' + ')||'—'; }
function pmWireTouches(w,R,map){
  if(!R) return true; const P=pmWirePts(w,map), x0=R.x,x1=R.x+R.w,y0=R.y,y1=R.y+R.h;
  if(P.length===1) return P[0][0]>=x0&&P[0][0]<=x1&&P[0][1]>=y0&&P[0][1]<=y1;
  for(let i=1;i<P.length;i++){ const a=P[i-1],b=P[i];
    if(Math.max(a[0],b[0])>=x0&&Math.min(a[0],b[0])<=x1&&Math.max(a[1],b[1])>=y0&&Math.min(a[1],b[1])<=y1) return true; }   // axis-aligned legs
  return false;
}
/* runs per wire type: [{w,c,runs,ft,un}] (R = only runs passing through that region) */
function pmWireSummary(data,R,acc){
  const items=(data&&data.items)||[], map=pmSymMap(items), ar=pmDataAR(data), g=acc||{};
  items.forEach(w=>{ if(w.t!=='wire'||(R&&!pmWireTouches(w,R,map))) return;
    const key=w.w||((PM.lmap[w.k]||{}).name)||'Wire', e=g[key]||(g[key]={w:key,c:w.c,runs:0,ft:0,un:0});
    e.runs++; const L=pmLenU(pmWirePts(w,map),ar), f=pmUToFt(L,data.scale,ar); if(f!=null) e.ft+=f; else e.un+=L; });
  return acc?g:Object.values(g).sort((a,b)=>a.w.localeCompare(b.w));
}
function pmProjCounts(list){ const c={}; (list||[]).forEach(m=>((m.data&&m.data.items)||[]).forEach(it=>{ if(it.t==='sym') c[it.k]=(c[it.k]||0)+1; })); return c; }
function pmWiresHTML(items,edit){
  const ws=(items||[]).filter(i=>i.t==='wire'); if(!ws.length) return '';
  const map=pmSymMap(items), f=v=>(v*1000).toFixed(2);
  let cs='',ln='',hit='';
  ws.forEach(w=>{ const P=pmWirePts(w,map); if(P.length<2) return;
    const d='M'+P.map(p=>f(p[0])+' '+f(p[1])).join(' L'), sel=edit&&PM.sel===w.id?' sel':'';
    cs+=`<path class="cs${sel}" d="${d}"/>`;
    ln+=`<path class="ln${w.r==='chain'?' ch':''}" d="${d}" stroke="${pmEsc(w.c||'#888888')}" data-wk="${pmEsc(w.k)}"/>`;
    if(edit) hit+=`<path class="hit" data-id="${pmEsc(w.id)}" d="${d}"/>`; });
  let h=`<svg class="pm-wires" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">${cs}${ln}${hit}</svg>`;
  const sw=edit&&PM.sel?ws.find(x=>x.id===PM.sel):null;
  if(sw){ const N=pmWireNodes(sw,map);
    for(let i=0;i<N.length-1;i++){ const m=pmLegGeom(N[i],N[i+1],sw.g&&sw.g[i]).mid;
      h+=`<div class="pm-wh" data-id="${pmEsc(sw.id)}" data-leg="${i}" style="left:${m[0]*100}%;top:${m[1]*100}%" title="Drag to move this bend · tap to flip the corner"></div>`; } }
  return h;
}
/* redraw only the runs (keeps the rest of the layer, e.g. while dragging a device) */
function pmRenderWires(){
  const ly=document.getElementById('pmLayer'); if(!ly) return;
  ly.querySelectorAll(':scope > .pm-wires, :scope > .pm-wh').forEach(e=>e.remove());
  const h=pmWiresHTML(PM.data.items||[],PM.edit); if(!h) return;
  const tmp=document.createElement('div'); tmp.innerHTML=h;
  const ref=[...ly.children].find(c=>!c.classList.contains('pm-er'))||null;
  [...tmp.children].forEach(nd=>ly.insertBefore(nd,ref));
  if(PM.edit&&PM.sel) pmPosDel();
}
/* --- generation --- */
function pmGenWiresFor(k){
  const R=pmRule(k); if(!pmWired(k)) return {n:0};
  const items=PM.data.items||[], devs=items.filter(i=>i.t==='sym'&&i.k===k); if(!devs.length) return {n:0};
  const srcs=items.filter(i=>i.t==='sym'&&pmRule(i.k).rule==='source'&&pmRule(i.k).src===R.to);
  if(!srcs.length) return {missing:R.to};
  const ar=pmDataAR(PM.data), P=i=>[i.x,i.y], D=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)*ar;   // right-angle distance
  const near=d=>srcs.reduce((b,s)=>D(d,s)<D(d,b)?s:b,srcs[0]);
  const runs=[];
  if(R.rule==='home') devs.forEach(d=>runs.push([d,near(d)]));
  else if(R.rule==='pair'){
    const pairs=[]; for(let i=0;i<devs.length;i++) for(let j=i+1;j<devs.length;j++) pairs.push([D(devs[i],devs[j]),devs[i],devs[j]]);
    pairs.sort((a,b)=>a[0]-b[0]); const used=new Set();
    pairs.forEach(([,a,b])=>{ if(used.has(a)||used.has(b)) return; used.add(a); used.add(b);
      const sa=near(a), sb=near(b); runs.push(D(a,sa)<=D(b,sb)?[b,a,sa]:[a,b,sb]); });   // link the pair, home-run from the nearer one
    devs.filter(d=>!used.has(d)).forEach(d=>runs.push([d,near(d)]));                     // odd one out gets its own run
  } else {   // daisy chain: nearest-neighbour from the source outwards, optionally max N per circuit
    const groups=new Map(); devs.forEach(d=>{ const s=near(d); if(!groups.has(s)) groups.set(s,[]); groups.get(s).push(d); });
    groups.forEach((g,s)=>{ const rem=g.slice(), lim=R.max>0?R.max:Infinity;
      while(rem.length){ const ch=[s]; let cur=s;
        while(rem.length&&ch.length-1<lim){ let bi=0; rem.forEach((d,i)=>{ if(D(cur,d)<D(cur,rem[bi])) bi=i; }); cur=rem.splice(bi,1)[0]; ch.push(cur); }
        runs.push(ch.reverse()); } });
  }
  PM.data.items=items.filter(i=>!(i.t==='wire'&&i.k===k));
  runs.forEach(r=>PM.data.items.push({t:'wire',id:pmUid(),k,r:R.rule,w:R.wire||'',c:R.color,x:r[0].x,y:r[0].y,n:r.map(P),d:r.map(i=>i.id),g:r.slice(1).map(()=>['h',null])}));
  return {n:runs.length};
}
function pmWireGen(which){
  const items=PM.data.items||[];
  const keys=which==='__all'?[...new Set(items.filter(i=>i.t==='sym').map(i=>i.k))].filter(pmWired):[which];
  if(!keys.length){ pmStatus('Nothing to wire on this plan','err'); return; }
  const before=JSON.stringify(PM.data); let runs=0; const missing=new Set();
  keys.forEach(k=>{ const r=pmGenWiresFor(k); if(r.missing) missing.add(r.missing); else runs+=r.n||0; });
  if(JSON.stringify(PM.data)!==before){ PM.undo.push(before); if(PM.undo.length>60) PM.undo.shift(); PM.redo=[]; PM.showWires=true; }
  PM.sel=null; pmRender(); pmRenderInsp(); pmChanged();
  if(missing.size){ const role=[...missing][0], l=pmSrcLegend(role); PM.pendingGen=which;
    pmToast(`No <b>${PM_SRC[role]}</b> on this plan yet — tap the plan where it is, and the runs are generated.`,6000);
    if(l) pmSetTool('sym:'+l.id);
    pmStatus((runs?runs+' runs · ':'')+'place a '+PM_SRC[role]+' first','err'); }
  else pmStatus(`Generated ${runs} run${runs===1?'':'s'} — press Save to keep`,'dirty');
}
function pmWireClear(which){
  const items=PM.data.items||[]; const n=items.filter(i=>i.t==='wire'&&(which==='__all'||i.k===which)).length; if(!n) return;
  pmSnapshot(); PM.data.items=items.filter(i=>!(i.t==='wire'&&(which==='__all'||i.k===which)));
  if(PM.sel&&!pmItem(PM.sel)) PM.sel=null; pmRender(); pmRenderInsp(); pmChanged(); pmStatus(`Cleared ${n} run${n===1?'':'s'} — press Save to keep`,'dirty');
}
function pmScaleTap(u,v){
  PM.scalePts=(PM.scalePts||[]).concat([[u,v]]); pmRender(); pmRenderWopts();
  if(PM.scalePts.length<2) return;
  const [a,b]=PM.scalePts;
  setTimeout(()=>{
    const r=prompt('Real distance between the two points, in feet (e.g. 14.5):','');
    const d=parseFloat(String(r||'').replace(/[^0-9.]/g,''));
    if(d>0){ pmSnapshot(); PM.data.scale={a:[a[0],a[1]],b:[b[0],b[1]],d:Math.round(d*100)/100,u:'ft'}; pmChanged(); pmStatus('Scale set · '+d+' ft','ok'); }
    pmSetTool('wire');
  },40);
}
/* wiring options row in the edit panel */
function pmRenderWopts(){
  const el=document.getElementById('pmWopts'); if(!el) return;
  const on=PM.edit&&(PM.tool==='wire'||PM.tool==='scale'); el.classList.toggle('on',on);
  if(!on){ el.innerHTML=''; return; }
  const items=PM.data.items||[], cnt={}; items.forEach(i=>{ if(i.t==='sym') cnt[i.k]=(cnt[i.k]||0)+1; });
  const keys=Object.keys(cnt).filter(pmWired).sort((a,b)=>((PM.lmap[a]||{}).sort||0)-((PM.lmap[b]||{}).sort||0));
  const have=r=>items.some(i=>i.t==='sym'&&pmRule(i.k).rule==='source'&&pmRule(i.k).src===r);
  const warn=[...new Set(keys.map(k=>pmRule(k).to))].filter(r=>!have(r)).map(r=>{ const l=pmSrcLegend(r);
    return `<div class="pm-warn">No ${PM_SRC[r]} on this plan yet.${l?` <button class="pm-tb" data-psrc="${pmEsc(l.id)}">${pmSymHTML(l)} Place one</button>`:''}</div>`; }).join('');
  const nW=k=>items.filter(i=>i.t==='wire'&&i.k===k).length, anyW=items.some(i=>i.t==='wire'), sc=PM.data.scale;
  const rows=keys.map(k=>{ const l=PM.lmap[k], R=pmRule(k), n=nW(k);
    return `<div class="pm-wr" data-wk="${pmEsc(k)}">${pmSymHTML(l)}<span class="nm"><b>${pmEsc(l?l.name:k)}</b> ×${cnt[k]}<small>${PM_RULES[R.rule]} · ${pmEsc(R.wire||'wire')} → ${PM_SRC[R.to]}${n?` · ${n} run${n===1?'':'s'}`:''}</small></span><button class="pm-tb" data-wgen="${pmEsc(k)}">${n?'Redo':'Generate'}</button>${n?`<button class="pm-tb danger" data-wclr="${pmEsc(k)}" title="Clear these runs">&#x2715;</button>`:''}</div>`; }).join('');
  el.innerHTML=`<div class="pm-wr"><button class="pm-tb primary" data-wgen="__all"${keys.length?'':' disabled'}>&#x26A1; Generate all</button>${anyW?'<button class="pm-tb danger" data-wclr="__all">Clear wiring</button>':''}</div>${warn}
    <div class="pm-wlist">${rows||'<div class="pm-wh2">Place devices that have a wiring rule (cameras, speakers, lights…), then generate their runs here.</div>'}</div>
    <div class="pm-wr"><button class="pm-tb${PM.tool==='scale'?' on':''}" id="pmScaleBtn">&#x1F4CF; Set scale</button><span class="nm"><small>${PM.tool==='scale'?((PM.scalePts||[]).length?'Now tap the second point…':'Tap two points a known distance apart (e.g. the ends of a dimensioned wall).'):sc?`Scale set (${pmEsc(sc.d)} ft reference) — lengths in feet`:'No scale yet — lengths in plan units (u = 1% of plan width)'}</small></span>${sc&&PM.tool!=='scale'?'<button class="pm-tb danger" id="pmScaleClr" title="Remove the scale">&#x2715;</button>':''}</div>
    <span class="pm-wh2">Tap a run to select it, drag its white dots to move bends. ✎ Edit on a legend item sets its wiring rule.</span>`;
  el.querySelectorAll('[data-wgen]').forEach(b=>b.onclick=()=>pmWireGen(b.dataset.wgen));
  el.querySelectorAll('[data-wclr]').forEach(b=>b.onclick=()=>pmWireClear(b.dataset.wclr));
  el.querySelectorAll('[data-psrc]').forEach(b=>b.onclick=()=>{ PM.pendingGen=null; pmSetTool('sym:'+b.dataset.psrc); });
  document.getElementById('pmScaleBtn').onclick=()=>{ PM.scalePts=[]; pmSetTool(PM.tool==='scale'?'wire':'scale'); };
  const sx=document.getElementById('pmScaleClr'); if(sx) sx.onclick=()=>{ pmSnapshot(); delete PM.data.scale; pmChanged(); };
}
/* legend item row (shown while placing a symbol): wiring summary + editor */
function pmRenderLopts(){
  const el=document.getElementById('pmLopts'); if(!el) return;
  const on=PM.edit&&PM.tool.indexOf('sym:')===0, k=on?PM.tool.slice(4):null, l=k&&PM.lmap[k];
  el.classList.toggle('on',!!l); if(!l){ el.innerHTML=''; return; }
  const R=pmRule(k);
  const sum=R.rule==='source'?PM_SRC[R.src]+' — runs end here':R.rule==='none'?'no wiring':`${PM_RULES[R.rule]} · ${R.wire||'wire'} → ${PM_SRC[R.to]}`;
  const canE=PM.canEdit&&!PM.notMigrated&&PM.legend.some(x=>x.id===k);
  if(PM.legEdit!==k){
    el.innerHTML=`<div class="pm-wr">${pmSymHTML(l)}<span class="nm"><b>${pmEsc(l.name)}</b><small>Tap the plan to place · wiring: ${pmEsc(sum)}</small></span>${canE?'<button class="pm-tb" id="pmLeEdit">&#x270E; Edit</button>':''}</div>`;
    const b=document.getElementById('pmLeEdit'); if(b) b.onclick=()=>{ PM.legEdit=k; PM.legDraft={name:l.name,color:l.color,icon:l.icon,rule:R.rule,to:R.to,src:R.src,wire:R.wire,wcolor:R.color,max:R.max}; pmRenderLopts(); };
    return;
  }
  const D=PM.legDraft, isT=String(D.icon).indexOf('text:')===0, wired=['home','pair','chain'].includes(D.rule);
  el.innerHTML=`<div class="pm-le"><label>Legend item</label><input id="pmLeName" maxlength="60" value="${pmEsc(D.name)}">
    <div class="row"><input type="color" id="pmLeColor" value="${pmEsc(D.color)}" title="Symbol colour"><select id="pmLeIcon" style="flex:1">${Object.keys(PM_ICONS).map(x=>`<option value="${x}"${D.icon===x?' selected':''}>${PM_ICON_NAMES[x]||x}</option>`).join('')}<option value="text"${isT?' selected':''}>Letters…</option></select><input id="pmLeLetters" maxlength="3" placeholder="AB" value="${isT?pmEsc(D.icon.slice(5)):''}" style="width:52px;display:${isT?'':'none'}"></div>
    <label>Wiring rule</label><select id="pmLeRule">${['home','pair','chain','none','source'].map(r=>`<option value="${r}"${D.rule===r?' selected':''}>${PM_RULES[r]}</option>`).join('')}</select>
    ${D.rule==='source'?`<select id="pmLeSrc"><option value="rack"${D.src==='rack'?' selected':''}>Rack / head-end (home runs end here)</option><option value="panel"${D.src==='panel'?' selected':''}>Breaker / panel (daisy chains end here)</option></select>`:''}
    ${wired?`<div class="row"><span style="color:#9a9388">to</span><select id="pmLeTo" style="flex:1"><option value="rack"${D.to==='rack'?' selected':''}>Rack / head-end</option><option value="panel"${D.to==='panel'?' selected':''}>Breaker / panel</option></select></div>
      <div class="row"><input id="pmLeWire" maxlength="40" placeholder="Wire (e.g. Cat6)" value="${pmEsc(D.wire)}" style="flex:1;min-width:0"><input type="color" id="pmLeWc" value="${pmEsc(D.wcolor)}" title="Line colour"></div>
      ${D.rule==='chain'?`<div class="row"><span style="color:#9a9388">Max per circuit</span><input id="pmLeMax" type="number" min="0" max="100" value="${Number(D.max)||0}" style="width:66px"><span style="color:#9a9388;font-size:11px">0 = no limit</span></div>`:''}`:''}
    <div class="row"><button class="pm-tb" id="pmLeCancel">Cancel</button><span style="flex:1"></span><button class="pm-tb primary" id="pmLeSave">Save legend item</button></div></div>`;
  const $=id=>document.getElementById(id), bind=(id,f)=>{ const x=$(id); if(x) x.oninput=()=>{ D[f]=x.value; }; };
  bind('pmLeName','name'); bind('pmLeColor','color'); bind('pmLeWire','wire'); bind('pmLeWc','wcolor'); bind('pmLeMax','max');
  $('pmLeIcon').onchange=()=>{ const v=$('pmLeIcon').value; $('pmLeLetters').style.display=v==='text'?'':'none'; D.icon=v==='text'?'text:'+$('pmLeLetters').value.trim().toUpperCase():v; };
  $('pmLeLetters').oninput=()=>{ D.icon='text:'+$('pmLeLetters').value.trim().toUpperCase(); };
  $('pmLeRule').onchange=()=>{ D.rule=$('pmLeRule').value; if(D.rule==='chain') D.to='panel'; else if(D.rule==='home'||D.rule==='pair') D.to='rack'; pmRenderLopts(); };
  if($('pmLeSrc')) $('pmLeSrc').onchange=()=>{ D.src=$('pmLeSrc').value; };
  if($('pmLeTo')) $('pmLeTo').onchange=()=>{ D.to=$('pmLeTo').value; };
  $('pmLeCancel').onclick=()=>{ PM.legEdit=null; pmRenderLopts(); };
  $('pmLeSave').onclick=pmLegSave;
}
async function pmLegSave(){
  const D=PM.legDraft, k=PM.legEdit; if(!D||!k) return;
  const name=String(D.name||'').trim(); if(!name){ alert('Give the legend item a name.'); return; }
  if(D.icon==='text:'){ alert('Type 1–3 letters for the badge.'); return; }
  const wiring=D.rule==='source'?{rule:'source',src:D.src}:D.rule==='none'?{rule:'none'}:{rule:D.rule,to:D.to,wire:String(D.wire||'').trim(),color:D.wcolor,max:Number(D.max)||0};
  try{
    await pmApi('plans/legend',{method:'POST',body:{id:k,name,color:D.color,icon:D.icon,wiring}});
    await pmEnsureLegend(true);
    const ws=(PM.data.items||[]).filter(i=>i.t==='wire'&&i.k===k);
    if(ws.length&&wiring.color){ pmSnapshot(); ws.forEach(w=>{ w.c=wiring.color; w.w=wiring.wire; w.r=wiring.rule; }); }
    PM.legEdit=null; pmRender(); pmRenderPanel(); pmChanged();
    pmStatus('Legend item saved'+(ws.length?' — runs updated, press Save':''),'ok');
  }catch(e){ alert(e.message); }
}
/* --- device counter (edit + view + room views) --- */
async function pmLoadProj(){
  const p=PM.project; if(!p) return;
  try{ const d=await pmApi('plans/markups?project='+encodeURIComponent(p)); if(PM.project!==p) return; PM.proj={project:p,markups:d.markups||[]}; }
  catch(e){ if(PM.project===p) PM.proj={project:p,markups:[],err:true}; }
  pmRenderCnt();
}
function pmProjList(){
  const o=((PM.proj&&PM.proj.project===PM.project&&PM.proj.markups)||[]).filter(m=>m.plan_key!==PM.plan);
  return o.concat([{plan_key:PM.plan,label:PM.label,data:PM.data}]);
}
function pmToggleCnt(){ PM.cntOpen=!PM.cntOpen; pmRenderCnt(); pmBarBtns(); }
function pmToggleWires(){ PM.showWires=!PM.showWires; pmBarBtns(); pmRenderCnt(); }
function pmBarBtns(){
  const its=PM.data.items||[], hasSym=its.some(i=>i.t==='sym'), hasW=its.some(i=>i.t==='wire');
  const cb=document.getElementById('pmCntBtn'); if(cb){ cb.hidden=!(hasSym||hasW||PM.edit); cb.classList.toggle('on',!!PM.cntOpen); }
  const wb=document.getElementById('pmWireBtn'); if(wb){ wb.hidden=!hasW||PM.edit; wb.classList.toggle('on',PM.showWires); wb.innerHTML=PM.showWires?'&#x26A1; Wiring on':'&#x26A1; Wiring off'; }
  const ov=document.getElementById('fvOverlay'); if(ov) ov.classList.toggle('nowires',!PM.showWires&&!PM.edit);
}
function pmRenderCnt(){
  const k=document.getElementById('pmCnt'); if(!k) return;
  k.classList.toggle('on',!!PM.cntOpen); if(!PM.cntOpen){ k.innerHTML=''; return; }
  const items=PM.data.items||[], R=FV.region, list=pmProjList(), pc=pmProjCounts(list), loaded=!!(PM.proj&&PM.proj.project===PM.project);
  const here={}, plan={}; items.forEach(i=>{ if(i.t!=='sym') return; plan[i.k]=(plan[i.k]||0)+1; if(pmInRegion(i,R)) here[i.k]=(here[i.k]||0)+1; });
  const keys=Object.keys(pc).sort((a,b)=>((PM.lmap[a]||{}).sort||0)-((PM.lmap[b]||{}).sort||0));
  const floors=list.filter(m=>((m.data&&m.data.items)||[]).some(i=>i.t==='sym')).length;
  const cols=R?['Room','Floor','All floors']:['This floor','All floors'];
  const row=kk=>{ const l=PM.lmap[kk]||{id:kk,name:'(removed)',color:'#888888',icon:'dot'};
    const v=R?[here[kk]||0,plan[kk]||0,pc[kk]||0]:[plan[kk]||0,pc[kk]||0];
    return `<tr data-k="${pmEsc(kk)}"><td><span class="nmc">${pmSymHTML(l)}${pmEsc(l.name)}</span></td>${v.map((n,i)=>`<td>${i===0?`<b>${n}</b>`:n}</td>`).join('')}</tr>`; };
  let tot=R?[0,0,0]:[0,0]; keys.forEach(kk=>{ const v=R?[here[kk]||0,plan[kk]||0,pc[kk]||0]:[plan[kk]||0,pc[kk]||0]; v.forEach((n,i)=>tot[i]+=n); });
  const wsHere=pmWireSummary(PM.data,R), acc={}; list.forEach(m=>pmWireSummary(m.data,null,acc)); const wsAll=Object.values(acc).sort((a,b)=>a.w.localeCompare(b.w));
  const allMap={}; wsAll.forEach(w=>allMap[w.w]=w);
  const anyW=items.some(i=>i.t==='wire'), sc=PM.data.scale;
  k.innerHTML=`<div class="pm-ch"><b>Device counts</b><span style="color:#9a9388;font-size:11px">${R?'this room':pmEsc(PM.label||'this floor')}</span><button class="pm-x" onclick="pmToggleCnt()" aria-label="Close counts">&times;</button></div>
    ${keys.length?`<table class="pm-ct"><tr><th>Device</th>${cols.map(c=>`<th>${c}</th>`).join('')}</tr>${keys.map(row).join('')}
      <tr class="tot"><td><b>Total</b></td>${tot.map(n=>`<td><b>${n}</b></td>`).join('')}</tr></table>`:'<div class="ft">No devices placed yet.</div>'}
    <div class="ft">All floors = ${loaded?`${floors} marked-up plan${floors===1?'':'s'} in this project`:'loading…'}.</div>
    <h4>Wire runs${R?' · through this room':' · this floor'}</h4>
    ${wsHere.length?`<table class="pm-wt"><tr><th>Wire</th><th>Runs</th><th>Length</th><th>All floors</th></tr>${wsHere.map(w=>{ const a=allMap[w.w];
      return `<tr data-w="${pmEsc(w.w)}"><td><span class="nmc"><i class="wsw" style="background:${pmEsc(w.c)}"></i>${pmEsc(w.w)}</span></td><td><b>${w.runs}</b></td><td>${pmFmtLen(w)}</td><td>${a?a.runs+' · '+pmFmtLen(a):''}</td></tr>`; }).join('')}</table>`
      :`<div class="ft">${wsAll.length?'No runs here — other floors: '+wsAll.map(w=>pmEsc(w.w)+' ×'+w.runs).join(', '):'No wiring generated yet'+(PM.edit?' — use ⚡ Wiring in the panel.':'.')}</div>`}
    <div class="ft">${sc?`Lengths in feet from the plan scale (${pmEsc(sc.d)} ft reference); approximate — add slack and vertical drops.`:'Lengths in plan units (u = 1% of the plan width). Set a scale in Plans edit → ⚡ Wiring to see feet.'}</div>
    ${anyW&&!PM.edit?`<label class="tg"><input type="checkbox" id="pmCntWires"${PM.showWires?' checked':''}> Show wiring on the plan</label>`:''}`;
  const cw=document.getElementById('pmCntWires'); if(cw) cw.onchange=()=>{ PM.showWires=cw.checked; pmBarBtns(); };
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
  const its=(items||[]).filter(i=>i.t!=='room'), ord={erase:-1,note:1,text:2,sym:3}, s0=PM.sel, e0=PM.edit; PM.sel=null; PM.edit=false;
  const html=its.filter(i=>i.t==='erase').map(pmItemHTML).join('')+pmWiresHTML(its,false)
    +its.filter(i=>i.t!=='erase'&&i.t!=='wire').sort((a,b)=>(ord[a.t]||0)-(ord[b.t]||0)).map(pmItemHTML).join('');
  PM.sel=s0; PM.edit=e0;
  ly.querySelector('.pm-layer').innerHTML=html;
  const lay=()=>{ if(!im.naturalWidth) return; const nw=im.naturalWidth,nh=im.naturalHeight; const cw=wrap.clientWidth||600;
    const s=cw/(nw*R.w); ly.style.width=nw+'px'; ly.style.height=nh+'px';
    ly.style.transform=`translate(${-R.x*nw*s}px,${-R.y*nh*s}px) scale(${s})`; ly.style.setProperty('--inv',String(1/s));
    wrap.style.height=Math.round(R.h*nh*s)+'px'; };
  im.onload=lay; im.src=planKey; if(im.complete) lay();
  if(!pmRenderStatic._ro&&window.ResizeObserver){ pmRenderStatic._ro=new ResizeObserver(es=>es.forEach(en=>en.target._pmLay&&en.target._pmLay())); }
  wrap._pmLay=lay; if(pmRenderStatic._ro) pmRenderStatic._ro.observe(wrap);
}
