'use strict';
let library=[],planPoll=null,planId=null,activePlanRun=null,assetTarget=null;
const creativeFields={production_mode:'#production-mode',target_seconds:'#video-length',voice:'#studio-voice',caption_preset:'#caption-preset',music_mood:'#music-mood',style_reference:'#style-reference'};
const modeNotes={stock:'Real footage, a clear story, and a clean edit. Free sources by default.',illustrated:'Consistent artwork with gentle motion. Add your illustrations or enable generated images for selected shots.',character:'Build an original cast with reference images. Animate selected shots when paid visuals are enabled.'};
function creative(){const saved=store.get('creative',{});const prefs={schema_version:2,cast:draft?.cast??saved.cast??[],cast_default_id:draft?.cast_default_id??saved.cast_default_id??'',disabled_sources:saved.disabled_sources||[]};for(const [k,id] of Object.entries(creativeFields))prefs[k]=k==='target_seconds'?Number($(id).value):$(id).value;prefs.ai={enabled:$('#ai-enabled').checked,budget:StudioCore.clamp($('#ai-budget').value,0,0,25),approved_cost:0};return prefs;}
function saveCreative(){const value=creative();store.set('creative',value);if(draft){Object.assign(draft,value);store.set('draft',draft);}$('#mode-note').textContent=modeNotes[value.production_mode];}
const preferences={production_mode:'stock',target_seconds:60,voice:'en-US-AndrewNeural',caption_preset:'documentary',music_mood:'none',style_reference:'',...store.get('creative',{})};
const modeProfiles=store.get('mode-profiles',{});
for(const [k,id]of Object.entries(creativeFields)){$(id).value=preferences[k];$(id).addEventListener('change',()=>{
  if(k==='production_mode'){
    const profile=modeProfiles[$(id).value]||{voice:'en-US-AndrewNeural',caption_preset:$(id).value==='illustrated'?'horror':$(id).value==='character'?'comedy':'documentary',music_mood:'none',style_reference:''};
    for(const key of ['voice','caption_preset','music_mood','style_reference'])$(creativeFields[key]).value=profile[key]||'';
  }
  saveCreative();modeProfiles[$('#production-mode').value]=creative();store.set('mode-profiles',modeProfiles);
});}
$('#ai-enabled').checked=preferences.ai?.enabled===true;$('#ai-budget').value=preferences.ai?.budget||0;
$('#ai-enabled').onchange=saveCreative;$('#ai-budget').onchange=saveCreative;$('#mode-note').textContent=modeNotes[preferences.production_mode];
if(!store.get('creative'))store.set('creative',creative());
function view(name){
  if(name==='settings'){openSettings();return;}
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $('#library-screen').hidden=name!=='library';$('#videos-screen').hidden=name==='library';
  $('#create').hidden=name!=='studio';$('#studio-hero').hidden=name!=='studio';$('#draft').hidden=name!=='studio'||!draft;
  $('#visual-review').hidden=true;
  if(name==='library')loadLibrary();if(name==='videos')$('#videos-screen').scrollIntoView({behavior:'smooth'});
  if(name==='studio'||name==='library')window.scrollTo({top:0,behavior:'smooth'});
}
$$('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
document.addEventListener('studio:draft',()=>{ $('#visual-review').hidden=true; });

async function mediaJSON(path,fallback){const f=await mediaFiles();return f[path]?JSON.parse(await readBlobText(f[path])):fallback;}
async function ensureMedia(){
  if(await mediaHead())return;
  const t=await gh('/git/trees',{method:'POST',body:{tree:[{path:'library/index.json',mode:'100644',type:'blob',content:'{"version":1,"assets":[]}'}]}});
  const c=await gh('/git/commits',{method:'POST',body:{message:'Initialize Shorts Hub library',tree:t.sha,parents:[]}});
  try{await gh('/git/refs',{method:'POST',body:{ref:'refs/heads/media',sha:c.sha}});}catch(e){if(e.status!==422)throw e;}
}
async function loadLibrary(){
  $('#library-status').textContent='Loading your collection…';
  try{if(!configured())throw new Error('Connect your pipeline in Settings to save and reuse media.');library=(await mediaJSON('library/index.json',{assets:[]})).assets||[];$('#library-status').textContent=library.length?`${library.length} reusable assets`:'Your collection starts here. Add a clip, illustration, music track, or sound effect.';renderLibrary();}
  catch(e){$('#library-status').textContent=e.message;}
}
function mediaElement(asset,controls=false){
  const el=document.createElement(asset.kind==='video'?'video':asset.kind==='music'||asset.kind==='sound'?'audio':'img');
  if(el.tagName==='IMG')el.alt=asset.title||'Selected media';else{el.controls=controls;el.preload='metadata';el.muted=asset.kind==='video';el.playsInline=true;}
  const u=asset.kind==='video'||el.tagName==='AUDIO'?asset.url:asset.thumbnail||asset.url;
  if(el.tagName==='VIDEO' && /^https:\/\//i.test(asset.thumbnail||''))el.poster=asset.thumbnail;
  if(asset.release_asset_id){
    // Private release downloads need the GitHub API; token never goes in a URL.
    gh(`/releases/assets/${asset.release_asset_id}`,{accept:'application/octet-stream',raw:true}).then(r=>r.blob()).then(b=>{const url=URL.createObjectURL(b);el.src=url;el.dataset.objectUrl=url;}).catch(()=>{el.title='Preview unavailable; asset is saved.';});
  }else if(u && /^https:\/\//i.test(u))el.src=u;
  return el;
}
function renderLibrary(){
  const q=$('#library-search').value.toLowerCase();const box=$('#library-grid');revokeMedia(box);box.replaceChildren();
  library.filter(a=>JSON.stringify([a.title,a.tags,a.topics,a.aliases]).toLowerCase().includes(q)).forEach(a=>{
    const card=document.createElement('article');card.className='card asset';card.append(mediaElement(a,true));
    const body=document.createElement('div');body.innerHTML=`<h3>${esc(a.title)}</h3><p>${esc((a.tags||[]).join(' · '))}</p><p>${esc(a.creator||'')} · ${esc(a.license||'')}</p><div class="row"><button class="btn sm edit">Edit</button><button class="btn sm danger remove">Remove</button></div>`;
    $('.edit',body).onclick=()=>openAsset(a);$('.remove',body).onclick=async()=>{
      if(!confirm(`Remove “${a.title}” from automatic selection? Its original release file stays available to existing videos.`))return;
      try{await saveLibraryAsset(a,true);await loadLibrary();}catch(e){toast(e.message,true);}
    };const copy=document.createElement('button');copy.className='btn sm';copy.textContent='Copy asset ID';copy.onclick=()=>navigator.clipboard.writeText(a.id).then(()=>toast('Asset ID copied.'));body.append(copy);card.append(body);box.append(card);
  });
}
function revokeMedia(box){$$('[data-object-url]',box).forEach(el=>URL.revokeObjectURL(el.dataset.objectUrl));}
$('#library-search').oninput=renderLibrary;
function openAsset(asset=null,target=null){assetTarget=target;$('#asset-id').value=asset?.id||'';$('#asset-file').value='';$('#asset-url').value=asset?.url||'';$('#asset-title').value=asset?.title||'';$('#asset-kind').value=asset?.kind||'video';$('#asset-tags').value=(asset?.tags||[]).join(', ');$('#asset-creator').value=asset?.creator||'';$('#asset-license').value=asset?.license||'';$('#asset-source').value=asset?.page_url||'';if($('#asset-reference-only'))$('#asset-reference-only').checked=asset?.reference_only===true;$('#asset-status').textContent='Uploads are stored as release assets. Your library keeps only lightweight metadata.';$('#asset-dialog').showModal();}
$('#add-asset').onclick=()=>openAsset();
async function saveLibraryAsset(asset,remove=false){
  await ensureMedia();
  for(let attempt=0;attempt<6;attempt++){
    let prior=null;try{prior=await gh('/contents/library/index.json?ref=media');}catch(e){if(e.status!==404)throw e;}
    const index=prior?JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(prior.content.replace(/\s/g,'')),c=>c.charCodeAt(0)))):{version:1,assets:[]};
    index.assets=index.assets.filter(a=>a.id!==asset.id);if(!remove)index.assets.push(asset);
    try{await gh('/contents/library/index.json',{method:'PUT',body:{message:`library: ${remove?'remove':'save'} ${asset.title}`,branch:'media',...(prior?{sha:prior.sha}:{}),content:b64utf8(JSON.stringify(index,null,2))}});return;}
    catch(e){if(![409,422].includes(e.status)||attempt===5)throw e;}
  }
}
async function uploadAsset(file){
  if(file.size>95_000_000)throw new Error('Choose a file smaller than 95 MB.');
  const extension='.'+file.name.split('.').pop().toLowerCase();
  if(!['.mp4','.webm','.jpg','.jpeg','.png','.webp','.mp3','.wav','.ogg','.m4a'].includes(extension))throw new Error('Use MP4, WebM, JPG, PNG, WebP, MP3, WAV, OGG or M4A.');
  let release;
  try{release=await gh('/releases/tags/shorts-library');}catch(e){if(e.status!==404)throw e;release=await gh('/releases',{method:'POST',body:{tag_name:'shorts-library',name:'Shorts Hub media library',body:'Reusable source media. Keep these files while videos reference them.',draft:false,prerelease:true}});}
  const upload=new URL(release.upload_url.split('{')[0]);if(upload.origin!=='https://uploads.github.com')throw new Error('Unexpected asset upload destination.');
  upload.searchParams.set('name',crypto.randomUUID()+extension);
  let response;try{response=await fetch(upload,{method:'POST',headers:{Authorization:`Bearer ${S.token}`,'Content-Type':file.type||'application/octet-stream'},body:file});}catch{throw new Error('This browser could not upload to GitHub Releases. Upload the file on your repository’s Releases page, then add its direct media URL here.');}
  if(!response.ok)throw new Error(`Media upload failed (${response.status}). Check repository write access.`);
  const asset=await response.json();return {release_asset_id:asset.id,url:asset.browser_download_url,extension,size:file.size};
}
$('#save-asset').onclick=async()=>{
  const btn=$('#save-asset');btn.disabled=true;
  try{
    if(!$('#asset-title').value.trim()||!$('#asset-license').value.trim())throw new Error('Add a name and license or permission.');
    const id=$('#asset-id').value||crypto.randomUUID();const prior=library.find(a=>a.id===id)||{};
    let asset={...prior,id,title:$('#asset-title').value.trim(),kind:$('#asset-kind').value,tags:$('#asset-tags').value.split(',').map(x=>x.trim()).filter(Boolean),creator:$('#asset-creator').value.trim(),license:$('#asset-license').value.trim(),page_url:$('#asset-source').value.trim()};
    const file=$('#asset-file').files[0];$('#asset-status').textContent=file?'Uploading media…':'Saving…';
    asset.reference_only=$('#asset-reference-only')?.checked===true;
    if(file)Object.assign(asset,await uploadAsset(file));else{
      const url=new URL($('#asset-url').value);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Use a direct HTTPS media URL.');asset.url=url.href;asset.extension='.'+url.pathname.split('.').pop().toLowerCase();
      if(prior.url!==asset.url)delete asset.release_asset_id;
    }
    if(!['.mp4','.webm','.jpg','.jpeg','.png','.webp','.mp3','.wav','.ogg','.m4a'].includes(asset.extension))throw new Error('The URL must point directly to a supported media file.');
    if(['.jpg','.jpeg','.png','.webp'].includes(asset.extension))asset.kind='image';
    else if(['.mp4','.webm'].includes(asset.extension))asset.kind='video';
    else if(!['music','sound'].includes(asset.kind))asset.kind='sound';
    if(!asset.release_asset_id && asset.url.startsWith(`https://github.com/${S.owner}/${S.repo}/releases/download/`)){
      const parts=new URL(asset.url).pathname.split('/');const tag=decodeURIComponent(parts[5]);const name=decodeURIComponent(parts.slice(6).join('/'));
      const release=await gh('/releases/tags/'+encodeURIComponent(tag));const found=release.assets.find(a=>a.name===name);if(found)asset.release_asset_id=found.id;
    }
    await saveLibraryAsset(asset);if(assetTarget){assetTarget.selected=asset;assetTarget.locked=true;assetTarget.asset_id=id;store.set('draft',draft);renderShots();}
    $('#asset-dialog').close();await loadLibrary();toast('Saved to your library.');
  }catch(e){$('#asset-status').textContent=e.message;}finally{btn.disabled=false;}
};

async function requestPlan(){
  if(!draft)return;saveDraft();StudioCore.beats(draft);store.set('draft',draft);
  StudioCore.applyCast(draft);store.set('draft',draft);
  if(draft.cast_errors.length){toast(draft.cast_errors.join(' '),true);return;}
  $('#draft').hidden=true;$('#visual-review').hidden=false;$('#render-plan').disabled=true;$('#plan-status').hidden=false;$('#cancel-plan').hidden=false;
  renderShots();$('#visual-review').scrollIntoView({behavior:'smooth'});
  if(draft.scenes.every(s=>s.visual_beats.every(b=>b.selected))){$('#plan-status').textContent='Your selected shots are saved. Replace a shot or render when ready.';$('#render-plan').disabled=false;$('#cancel-plan').hidden=true;return;}
  try{
    if(!configured())throw new Error('Connect your pipeline in Settings to search for footage.');
    const d=new Date().toISOString().replace(/[-:]/g,'');planId=`${d.slice(0,8)}-${d.slice(9,15)}-${slugify(draft.title)}`;
    const input=JSON.stringify(StudioCore.compact(draft));if(new TextEncoder().encode(input).length>43000)throw new Error('This visual plan is too large to send. Shorten the prompts.');
    await dispatch('plan.yml',{job_id:planId,title:draft.title.slice(0,80),script_b64:b64utf8(input)});
    store.set('plan',{id:planId,at:Date.now(),input:StudioCore.compact(draft)});$('#plan-status').textContent='Finding footage in the background. You can leave this screen and return later.';pollPlan();
  }catch(e){$('#plan-status').textContent=e.message;$('#render-plan').disabled=false;$('#cancel-plan').hidden=true;}
}
async function pollPlan(){
  clearTimeout(planPoll);if(!planId)return;
  try{
    const index=await mediaFiles();const base=`plans/${planId}/`;const st=index[base+'status.json']?JSON.parse(await readBlobText(index[base+'status.json'])):null;
    if(st?.status==='ready'&&index[base+'script.json']){
      const result=JSON.parse(await readBlobText(index[base+'script.json']));
      // Do not overwrite narration or edits made while the search was running.
      const original=store.get('plan',{}).input;
      if(draft)result.scenes.forEach((s,i)=>{if(draft.scenes[i]?.text===s.text){
        s.visual_beats.forEach((beat,j)=>{const current=draft.scenes[i].visual_beats[j],before=original?.scenes[i]?.visual_beats[j];
          if(!before || JSON.stringify({...current,candidates:undefined})===JSON.stringify(before))draft.scenes[i].visual_beats[j]=beat;
        });
      }});
      store.set('draft',draft);$('#plan-status').textContent='Your shots are ready. Replace any weak matches, or render as selected.';$('#render-plan').disabled=false;$('#cancel-plan').hidden=true;store.del('plan');planId=null;renderShots();return;
    }
    if(st?.status==='failed')throw new Error(st.error||'Footage search failed. You can try again.');
    if(st?.message)$('#plan-status').textContent=st.message;
    const data=await gh('/actions/runs?event=workflow_dispatch&per_page=30');
    activePlanRun=data.workflow_runs.find(r=>(r.display_title||'').startsWith('plan '+planId+' '));
    if(activePlanRun?.status==='completed'&&activePlanRun.conclusion!=='success')throw new Error('The footage search stopped. Push the new plan workflow, check your source keys, then try again.');
    if(Date.now()-(store.get('plan',{}).at||Date.now())>30*60*1000)throw new Error('Search timed out. Your draft is saved; retry the search.');
    planPoll=setTimeout(pollPlan,8000);
  }catch(e){$('#plan-status').textContent=e.message;$('#render-plan').disabled=false;store.del('plan');planId=null;}
}
$('#btn-plan').onclick=requestPlan;
$('#back-script').onclick=()=>{$('#visual-review').hidden=true;$('#draft').hidden=false;showDraft();};
$('#cancel-plan').onclick=async()=>{clearTimeout(planPoll);if(activePlanRun?.status!=='completed'&&activePlanRun?.id){try{await gh(`/actions/runs/${activePlanRun.id}/cancel`,{method:'POST'});}catch(e){toast(e.message,true);return;}}planId=null;store.del('plan');$('#plan-status').textContent='Search cancelled. Your current shots are saved.';$('#render-plan').disabled=false;};
function renderShots(){
  if(!draft)return;StudioCore.applyCast(draft);const grid=$('#shot-grid');revokeMedia(grid);grid.replaceChildren();
  draft.scenes.forEach((scene,i)=>scene.visual_beats.forEach((b,j)=>{
    const card=document.createElement('article');card.className='card shot';
    card.innerHTML=`<div class="shot-preview"></div><div class="shot-head"><span>SHOT ${i+1}.${j+1}</span><span>${b.duration.toFixed(1)}s estimated</span></div><p>${esc(scene.text)}</p><div class="shot-source">${b.selected?esc([b.selected.title,b.selected.creator,b.selected.license].filter(Boolean).join(' · ')):'Automatic selection'}</div><p class="warning">${esc(b.warning||'')}</p><div class="row"><button class="btn sm replace">Replace</button><button class="btn sm upload">Upload</button><button class="btn sm lock" aria-pressed="${!!b.locked}">${b.locked?'✓ Locked':'Lock shot'}</button><button class="btn sm search">Search again</button></div><details><summary>Shot direction</summary><label class="f">Find footage</label><input class="query" type="text" value="${esc(b.visual)}" aria-label="Footage search"><div class="row"><div style="flex:1"><label class="f">Start at (seconds)</label><input class="trim" type="number" min="0" max="7200" value="${b.clip_start||0}" aria-label="Clip start time"></div><div style="flex:1"><label class="f">Speed</label><input class="speed" type="number" min="0.5" max="2" step="0.1" value="${b.speed||1}" aria-label="Playback speed"></div></div><label class="f">Horizontal subject position</label><input class="focal" type="range" min="0" max="1" step="0.01" value="${b.focal_point?.x??.5}" aria-label="Horizontal crop focal point"><label class="f">Vertical subject position</label><input class="focal-y" type="range" min="0" max="1" step="0.01" value="${b.focal_point?.y??.5}" aria-label="Vertical crop focal point"><label class="f">Motion treatment</label><select class="motion" aria-label="Motion treatment"><option value="auto">Automatic</option><option value="none">Natural footage</option><option value="zoom">Slow zoom</option><option value="punch">Punch in</option><option value="pan">Pan</option><option value="flicker">Light flicker</option><option value="fog">Mist treatment</option><option value="shake">Camera shake</option></select><label class="f">Sound cue from library</label><input class="sound" type="text" aria-label="Sound cue" value="${esc(b.sound_cue||'')}" placeholder="water, impact, horror drone…"><label class="f">Optional generated visual</label><select class="generate" aria-label="Generate image or video"><option value="">Use selected footage</option><option value="image">Generate illustration · allowance $0.02</option><option value="video">Animate reference · allowance from $0.35</option></select><label class="f">Generation direction</label><textarea class="ai-prompt" aria-label="Generation prompt">${esc(b.image_prompt||b.video_prompt||b.visual)}</textarea><label class="f">Reference image URL (for animation)</label><input class="reference" type="text" aria-label="Reference image URL" value="${esc(b.reference_url||'')}" placeholder="https://…/character.jpg"></details>`;
    const preview=$('.shot-preview',card);if(b.cast_required)preview.textContent='Illustrated scene will be generated';else if(b.selected)preview.append(mediaElement(b.selected,true));else preview.textContent='Footage will appear here';
    $('.shot-head + p',card).textContent=b.narration||scene.text;
    const extra=document.createElement('div');extra.innerHTML='<label class="f">Transition</label><select class="transition" aria-label="Shot transition"><option value="">Clean cut</option><option value="fade">Soft fade</option><option value="blur">Brief blur</option></select><label class="f">Transparent foreground PNG (layered parallax)</label><input class="foreground" type="url" aria-label="Transparent foreground URL" placeholder="https://…/foreground.png"><label class="f">End reference image (optional)</label><input class="end-reference" type="url" aria-label="End reference image URL"><label class="f">Reference asset ID (from your library)</label><input class="reference-id" aria-label="Reference asset ID">';
    $('details',card).append(extra);$('.motion',card).add(new Option('Layered parallax · needs foreground','parallax'));
    for(const [selector,key]of [['.transition','transition'],['.foreground','foreground_url'],['.end-reference','end_image_url'],['.reference-id','reference_id']]){const input=$(selector,card);input.value=b[key]||'';input.onchange=()=>{b[key]=input.value;if(key==='reference_id'){delete b.auto_reference_id;delete b.reference_asset;delete b.reference_url;}store.set('draft',draft);updateEstimate();};}
    if(/^https:\/\//i.test(b.selected?.page_url||'')){const link=document.createElement('a');link.href=b.selected.page_url;link.textContent='View source & license';link.target='_blank';link.rel='noopener';$('.shot-source',card).append(document.createElement('br'),link);}
    $('.motion',card).value=b.motion||'auto';$('.generate',card).value=b.generate||'';
    $('.generate',card).options[1].textContent=(b.reference_id||b.reference_url)?'Generate character scene · allowance $0.08':'Generate illustration · allowance $0.02';
    const persist=()=>{store.set('draft',draft);updateEstimate();};
    $('.replace',card).onclick=()=>showCandidates(b);$('.upload',card).onclick=()=>openAsset(null,b);
    $('.lock',card).onclick=()=>{if(!b.selected){toast('Choose footage before locking.',true);return;}b.locked=!b.locked;persist();renderShots();};
    $('.search',card).onclick=()=>{if(b.locked){toast('Unlock the shot to search again.');return;}delete b.selected;delete b.candidates;requestPlan();};
    $('.query',card).onchange=e=>{b.visual=e.target.value;delete b.candidates;if(!b.locked)delete b.selected;persist();};
    $('.trim',card).onchange=e=>{b.clip_start=StudioCore.clamp(e.target.value,0,0,7200);persist();};
    $('.speed',card).onchange=e=>{b.speed=StudioCore.clamp(e.target.value,1,.5,2);persist();};
    $('.focal',card).oninput=e=>{b.focal_point={...(b.focal_point||{}),x:Number(e.target.value)};preview.firstChild?.style&&(preview.firstChild.style.objectPosition=`${b.focal_point.x*100}% ${(b.focal_point.y??.5)*100}%`);persist();};
    $('.focal-y',card).oninput=e=>{b.focal_point={...(b.focal_point||{}),y:Number(e.target.value)};persist();};
    $('.motion',card).onchange=e=>{b.motion=e.target.value;persist();};$('.sound',card).onchange=e=>{b.sound_cue=e.target.value.trim();persist();};
    $('.generate',card).onchange=e=>{delete b.auto_generate;b.generate=e.target.value;persist();};$('.ai-prompt',card).onchange=e=>{b.image_prompt=e.target.value;b.video_prompt=e.target.value;persist();};$('.reference',card).onchange=e=>{b.reference_url=e.target.value.trim();delete b.auto_reference_id;delete b.reference_id;delete b.reference_asset;persist();};
    $('.generate',card).addEventListener('change',()=>{if(b.generate && b.locked){b.locked=false;store.set('draft',draft);toast('Shot unlocked so your generated visual can replace it.');renderShots();}});
    if(window.addCastShotControls)window.addCastShotControls(card,b,scene);
    grid.append(card);
  }));updateEstimate();
}
function updateEstimate(){if(!draft)return;const cost=StudioCore.estimate(draft);$('#render-estimate').textContent=draft.ai?.enabled?`Generation allowance: $${cost.toFixed(2)} · Your cap: $${Number(draft.ai.budget||0).toFixed(2)}`:draft.scenes.some(s=>s.visual_beats?.some(b=>b.cast_required))?`Character story · Enable paid visuals · Allowance $${cost.toFixed(2)}`:'Free footage · Paid generation is off';}
async function showCandidates(beat){
  const box=$('#candidate-grid');revokeMedia(box);box.replaceChildren();$('#candidate-dialog').showModal();
  if(!library.length)try{library=(await mediaJSON('library/index.json',{assets:[]})).assets;}catch{}
  const choices=[...(beat.candidates||[]),...library.filter(a=>['video','image'].includes(a.kind))];
  for(const a of [...new Map(choices.map(x=>[x.id,x])).values()]){const btn=document.createElement('button');btn.className='candidate';btn.append(mediaElement(a));const text=document.createElement('div');text.innerHTML=`${esc(a.title)}<small>${esc(a.source||'Your library')} · ${esc(a.license||'')}</small>`;btn.append(text);btn.onclick=()=>{beat.selected=a;beat.locked=true;beat.asset_id=a.id;store.set('draft',draft);$('#candidate-dialog').close();renderShots();};box.append(btn);}
  if(!choices.length)box.textContent='No candidates yet. Search for shots, or upload your own media.';
}
$('#close-candidates').onclick=()=>$('#candidate-dialog').close();
$('#render-plan').onclick=async()=>{const btn=$('#render-plan');btn.disabled=true;try{await startRender(draft,draft.upload_youtube);draft=null;store.del('draft');showDraft();view('videos');toast('Your video is in production.');}catch(e){toast(e.message,true);}finally{btn.disabled=false;}};
// Settings keeps creator defaults in the creation screen and connection secrets
// in GitHub. No fal credential is collected by this browser.
const note=document.createElement('div');note.className='connections-note';note.innerHTML='Optional footage: add <b>PEXELS_API_KEY</b> and <b>PIXABAY_API_KEY</b> to your pipeline secrets. Optional generated visuals: add <b>FAL_KEY</b>. Music and effects come from your media library. Choose your voice, caption style and spending limit under Creative settings.';$('#settings .card').append(note);
const savedPlan=store.get('plan');if(savedPlan?.id&&draft){planId=savedPlan.id;$('#visual-review').hidden=false;$('#draft').hidden=true;renderShots();pollPlan();}
const sourceOptions=document.createElement('fieldset');sourceOptions.innerHTML='<legend>Automatic footage sources</legend><label class="check"><input type="checkbox" value="pexels" checked> Pexels</label><label class="check"><input type="checkbox" value="pixabay" checked> Pixabay</label><label class="check"><input type="checkbox" value="commons" checked> Wikimedia Commons</label>';
$('#creative-defaults').append(sourceOptions);
for(const input of $$('input',sourceOptions)){input.checked=!(store.get('creative',{}).disabled_sources||[]).includes(input.value);input.onchange=()=>{const disabled=$$('input',sourceOptions).filter(x=>!x.checked).map(x=>x.value);const saved=store.get('creative',{});saved.disabled_sources=disabled;store.set('creative',saved);if(draft){draft.disabled_sources=disabled;store.set('draft',draft);}};}
const defaultsButton=document.createElement('button');defaultsButton.className='btn';defaultsButton.textContent='Edit creator defaults';defaultsButton.onclick=()=>{$('#settings').close();view('studio');$('#creative-defaults').open=true;$('#creative-defaults').scrollIntoView({behavior:'smooth'});};$('#settings .card').append(defaultsButton);
$('#v-cancel').onclick=async()=>{
  const j=currentJob();if(!j||!confirm('Cancel this production? Work already submitted to an AI provider may still be billable.'))return;
  try{await ensureMedia();await commitMedia({[`cancelled/${j.id}.json`]:JSON.stringify({id:j.id,at:new Date().toISOString()})},'hub: cancel production');toast('Cancellation requested. The current local editing step may finish first.');}catch(e){toast(e.message,true);}
};
