/* Pure schema helpers shared by UI and offline tests. */
(function(root){
  'use strict';
  const clamp=(v,d=0,min=0,max=1)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):d;
  function beats(script){
    const total=script.scenes.reduce((n,s)=>n+s.text.split(/\s+/).length,0)||1;
    script.scenes.forEach((s,i)=>{
      if(!s.visual_beats?.length){
        const duration=(script.target_seconds||60)*s.text.split(/\s+/).length/total;
        const count=Math.max(1,Math.min(12,Math.round(duration/3.2)));
        s.visual_beats=Array.from({length:count},()=>({visual:s.visual,duration:duration/count,motion:'auto',focal_point:{x:.5,y:.5},locked:false}));
      }
      s.visual_beats.forEach((b,j)=>{b.id=`s${i+1}-b${j+1}`;b.visual||=s.visual;b.duration=clamp(b.duration,3.2,.5,15);const words=s.text.split(/\s+/),n=s.visual_beats.length;b.narration??=words.slice(Math.round(j*words.length/n),Math.round((j+1)*words.length/n)).join(' ');});
    });return script;
  }
  function estimate(script){return Math.round(script.scenes.flatMap(s=>s.visual_beats||[]).reduce((n,b)=>n+(b.locked?0:b.generate==='image'?((b.reference_url||b.reference_id)? .08 : .02):b.generate==='video'?(b.duration>5? .70 : .35):0),0)*100)/100;}
  function compact(script){
    const copy=JSON.parse(JSON.stringify(script));delete copy.resolved_shots;
    copy.scenes.forEach(s=>(s.visual_beats||[]).forEach(b=>{delete b.candidates;}));return copy;
  }
  function parse(text){
    text=String(text).replace(/[\u200B-\u200F\uFEFF]/g,'').trim().replace(/^```(?:json)?\s*|\s*```$/g,'');
    const a=text.indexOf('{'),z=text.lastIndexOf('}');if(a>=0&&z>a)text=text.slice(a,z+1);
    // Remove only commas outside JSON strings. Never eval or rewrite narration.
    let out='',quoted=false,escaped=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];if(!quoted&&c===','&&/^\s*[}\]]/.test(text.slice(i+1)))continue;
      out+=c;if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;
    }return JSON.parse(out);
  }
  function state(status,hasVideo,run){
    if(status?.youtube||hasVideo||status?.status==='done')return 'done';
    if(['failed','cancelled'].includes(status?.status))return 'failed';
    if(run?.status==='completed'&&run.conclusion!=='success')return 'failed';
    if(status?.status)return 'rendering';return null;
  }
  const api={beats,estimate,compact,parse,state,clamp};root.StudioCore=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
