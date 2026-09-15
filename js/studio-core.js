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
  function applyCast(script){
    beats(script);script.cast_errors=[];
    const cast=Array.isArray(script.cast)?script.cast:[];
    const words=s=>' '+String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+' ';
    for(const scene of script.scenes)for(const b of scene.visual_beats){
      if(b.auto_reference_id){if(b.reference_id===b.auto_reference_id){delete b.reference_id;delete b.reference_asset;delete b.reference_url;}delete b.auto_reference_id;}
      if(b.auto_generate){delete b.generate;delete b.auto_generate;}
      delete b.cast_direction;delete b.cast_required;
      if(!cast.length||script.production_mode==='stock'||b.locked)continue;
      const explicit=b.cast_ids??scene.cast_ids;
      const find=text=>cast.filter(c=>[c.name,...(c.aliases||[])].some(n=>n&&words(text).includes(words(n))));
      const shotMatches=find([b.image_prompt,b.visual].filter(Boolean).join(' '));
      const matches=shotMatches.length?shotMatches:find(scene.text);
      const ids=Array.isArray(explicit)?explicit:matches.length?matches.map(c=>c.id):script.cast_default_id?[script.cast_default_id]:[];
      const members=ids.map(id=>cast.find(c=>c.id===id));
      if(members.some(c=>!c)){script.cast_errors.push(`${b.id}: a selected character is missing from the cast.`);continue;}
      if(!members.length){b.cast_required=true;b.cast_direction='Create one illustrated environment or object shot matching the story. No recurring characters, no reference sheet, no collage, no text.';if(!b.generate){b.generate='image';b.auto_generate=true;}continue;}
      if(members.length>1&&!b.reference_id&&!b.reference_url){script.cast_errors.push(`${b.id}: choose a combined reference for ${members.map(c=>c.name).join(' and ')}, or split them into separate shots.`);continue;}
      if(!b.reference_id&&!b.reference_url){b.reference_id=members[0].id;b.auto_reference_id=b.reference_id;}
      b.cast_required=true;
      b.cast_direction='Use the reference only for character identity. Create ONE complete scene, never a reference sheet or collage. Preserve face, clothing, colors and proportions. Cast: '+members.map(c=>`${c.name}: ${c.description||'match the reference'}`).join('; ')+'. No text or captions in the image.';
      if(!b.generate){b.generate='image';b.auto_generate=true;}
    }return script;
  }
  function castPrompt(config){return config?.cast?.length?'\nSelected cast: '+JSON.stringify(config.cast)+'. For every visual beat set cast_ids to the array of character IDs visible in that shot; use [] for scenery or objects only. Describe their action and environment in image_prompt. Use separate shots for different characters unless a combined reference is available. Preserve character appearance. Default viewpoint character: '+(config.cast_default_id||'none')+'.':'';}
  const api={beats,estimate,compact,parse,state,clamp,applyCast,castPrompt};root.StudioCore=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
